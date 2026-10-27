import { gate, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { sql, closeDb } from "@aihot/backend/db";
import { newArticleId } from "@aihot/backend/lib/ids";
import { createSubscription } from "@aihot/backend/sources/subscriptions";
import { SUBSCRIPTION_VIDEO_DOWNLOAD } from "@aihot/backend/sources/subscription-video-ownership";
import { advanceRun, abandonRun, claimRun, createRun, lockRun, receiptOptions, resumeRun, saveResult, setRunState, StaleOperationError } from "@aihot/backend/providers/operations/store";
import { paidRequest } from "@aihot/backend/providers/receipts";

after(closeDb);
async function fixture(enabled: boolean | undefined = true, control = false) {
  const sourceId = `video-${tag()}`, articleId = newArticleId();
  await sql`INSERT INTO sources(id,name,kind) VALUES (${sourceId},'Synthetic video author','external')`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at)
    VALUES (${articleId},${sourceId},${`douyin:${tag()}`},${`https://www.douyin.com/video/${tag()}`},'Synthetic video',now(),now())`;
  const subscriptionId = await sql.begin(tx => createSubscription(tx, { ...(control ? { sourceId } : {}), provider: "agentkey", platform: "douyin", operationKey: "synthetic.collect", contractVersion: 1,
    config: enabled === undefined ? {} : { autoDownloadVideo: enabled }, enabled: true, intervalMinutes: 30 }));
  const command = { actor: "video-tests", commandKey: tag(), provider: "local", operationKey: SUBSCRIPTION_VIDEO_DOWNLOAD,
    contractVersion: 1, subscriptionIds: [subscriptionId], input: { articleId }, stepKey: "subscription.video.resolve" };
  return { sourceId, articleId, subscriptionId, command };
}
const readSub = async (id: number) => (await sql`SELECT * FROM collection_subscriptions WHERE id=${id}`)[0]!;
const execution = (run: {id:number;step_version:number;generation:number}) => ({runId:run.id,stepVersion:run.step_version,generation:run.generation});

test("download has an independent owner and never acquires or releases collector occupancy", async () => {
  for (const control of [false, true]) {
    const f = await fixture(true, control);
    const collector = await sql.begin(tx => createRun(tx, { ...f.command, commandKey: tag(), provider: "agentkey", operationKey: "synthetic.collect" }));
    const run = await sql.begin(tx => createRun(tx, f.command));
    assert.equal((await readSub(f.subscriptionId)).active_run_id, collector.id);
    assert.equal((await sql.begin(tx => createRun(tx, f.command))).id, run.id);
    const claimed = await sql.begin(tx => claimRun(tx, execution(run), randomUUID()));
    await sql.begin(async tx => {
      await saveResult(tx, claimed, { itemKey: "summary", kind: "video", data: { saved: 0 }, articleId: f.articleId, sourceId: f.sourceId });
      await advanceRun(tx, claimed, null);
    });
    assert.equal((await readSub(f.subscriptionId)).active_run_id, collector.id);
  }
});

test("missing/false download config and missing member authority fail closed at creation and claim", async () => {
  for (const enabled of [false, undefined]) {
    const f = await fixture(enabled);
    if (enabled === undefined) await sql`UPDATE collection_subscriptions SET config='{}' WHERE id=${f.subscriptionId}`;
    await assert.rejects(sql.begin(tx => createRun(tx, f.command)), StaleOperationError);
  }
  const f = await fixture();
  await assert.rejects(sql.begin(tx => createRun(tx, { ...f.command, subscriptionIds: [] })), StaleOperationError);
  await assert.rejects(sql.begin(tx => createRun(tx, { ...f.command, provider: "agentkey" })), StaleOperationError);
  const run = await sql.begin(tx => createRun(tx, f.command));
  await sql`UPDATE operation_runs SET input=jsonb_set(input,'{members}','[]') WHERE id=${run.id}`;
  await assert.rejects(sql.begin(tx => claimRun(tx, execution(run), randomUUID())), StaleOperationError);
});

test("subscription, author and material changes fence claim, payment, commit and resume", async () => {
  for (const change of ["disabled", "option", "version", "provider", "source", "source-version", "material"]) {
    const f = await fixture();
    const run = await sql.begin(tx => createRun(tx, f.command));
    const e = execution(run);
    await sql.begin(tx => setRunState(tx, e, "waiting", "synthetic wait"));
    if (change === "disabled") await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${f.subscriptionId}`;
    if (change === "option") await sql`UPDATE collection_subscriptions SET config='{}' WHERE id=${f.subscriptionId}`;
    if (change === "version") await sql`UPDATE collection_subscriptions SET execution_version=execution_version+1 WHERE id=${f.subscriptionId}`;
    if (change === "provider") await sql`UPDATE collection_subscriptions SET provider='redfox' WHERE id=${f.subscriptionId}`;
    if (change === "source") await sql`UPDATE sources SET enabled=false WHERE id=${f.sourceId}`;
    if (change === "source-version") await sql`UPDATE sources SET execution_version=execution_version+1 WHERE id=${f.sourceId}`;
    if (change === "material") await sql`UPDATE articles SET identity_key=${tag()} WHERE id=${f.articleId}`;
    assert.deepEqual((await sql.begin(tx => lockRun(tx, run.id))).eligible, []);
    await assert.rejects(sql.begin(tx => resumeRun(tx, e)), StaleOperationError);
    await sql`UPDATE operation_runs SET status='active' WHERE id=${run.id}`;
    await assert.rejects(sql.begin(tx => claimRun(tx, e, randomUUID())), StaleOperationError);
    let sends = 0;
    await assert.rejects(paidRequest({ service: "video-ownership-test", purpose: "synthetic", identity: tag() }, async () => { sends++; return { response: {} }; }, receiptOptions(e)), StaleOperationError);
    assert.equal(sends, 0);
    await assert.rejects(sql.begin(tx => saveResult(tx, e, { itemKey: "late", kind: "video", data: {} })), StaleOperationError);
    await assert.rejects(sql.begin(tx => advanceRun(tx, e, null)), StaleOperationError);
    await sql.begin(tx => abandonRun(tx, e, "invalid owner"));
  }
});

test("closing one subscription does not invalidate another download of the same material", async () => {
  const f = await fixture();
  const other = await sql.begin(tx => createSubscription(tx, { provider: "agentkey", platform: "douyin", operationKey: "synthetic.collect", contractVersion: 1,
    config: { autoDownloadVideo: true }, enabled: true, intervalMinutes: 30 }));
  const a = await sql.begin(tx => createRun(tx, f.command));
  const b = await sql.begin(tx => createRun(tx, { ...f.command, commandKey: tag(), subscriptionIds: [other] }));
  await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${f.subscriptionId}`;
  await assert.rejects(sql.begin(tx => claimRun(tx, execution(a), randomUUID())), StaleOperationError);
  await sql.begin(tx => claimRun(tx, execution(b), randomUUID()));
  assert.equal((await readSub(other)).active_run_id, null);
});

test("late paid response remains governed after owner invalidation and cannot publish a result", async () => {
  const f = await fixture();
  const run = await sql.begin(tx => createRun(tx, f.command));
  const e = execution(run), entered = gate(), release = gate();
  const pending = paidRequest({ service: "video-ownership-test", purpose: "synthetic", identity: tag() }, async () => {
    entered.open(); await release.promise; return { response: { video: "synthetic" } };
  }, receiptOptions(e));
  await entered.promise;
  await sql`UPDATE collection_subscriptions SET enabled=false,execution_version=execution_version+1 WHERE id=${f.subscriptionId}`;
  release.open();
  const response = await pending;
  await assert.rejects(sql.begin(tx => saveResult(tx, e, { itemKey: "late", kind: "video", data: {}, receiptId: response.receiptId })), StaleOperationError);
  await sql.begin(tx => abandonRun(tx, e, "invalidated"));
  const [stored] = await sql`SELECT r.status,r.response,o.current_receipt_id FROM receipts r JOIN operation_runs o ON o.current_receipt_id=r.id WHERE o.id=${run.id}`;
  assert.equal(stored!.status, "received");
  assert.deepEqual(stored!.response, { video: "synthetic" });
  assert.equal(stored!.current_receipt_id, response.receiptId);
});
