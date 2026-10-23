import { stub, tag, gate } from "./setup.ts";
import http from "node:http";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss, QUEUES } from "@aihot/backend/jobs/queue";
import { updateSource } from "@aihot/backend/admin/sources";
import { migrateNativeSources } from "@aihot/backend/sources/native-migration";
import { createSubscription } from "@aihot/backend/sources/subscriptions";
import { createNativeCollection } from "@aihot/backend/sources/native-commands";
import { executeNativeStep } from "@aihot/backend/sources/native-execution";
import { searchTweets } from "@aihot/backend/providers/socialdata";
import { receiptOptions, abandonRun } from "@aihot/backend/providers/operations/store";

const T = tag();
const XID = String(BigInt(Date.now()) * 10000n);
let override: ((req: { url: string; body: string }) => unknown) | null = null;
const provider = await stub((_hit, req) => {
  if (override) return override(req);
  if (req.url.includes("post_history")) return { code: 0, data: [{ position: 1, url: `https://mp.weixin.qq.com/s?__biz=${T}&mid=1&idx=1&sn=synthetic`, title: "Synthetic MP post", post_time: Math.floor(Date.now() / 1000), sn: T }], remain_money: 10 };
  if (req.url.includes("article_detail")) return { code: 0, title: "Synthetic MP post", content: "<p>Synthetic article body for isolated testing.</p>" };
  return { tweets: [{ id_str: XID, tweet_created_at: new Date().toISOString(), full_text: "Synthetic X post", user: { name: "Synthetic", screen_name: "synthetic" } }], next_cursor: null };
});
process.env.SOCIALDATA_API_KEY = "test-key";
process.env.SOCIALDATA_BASE_URL = provider.url;
process.env.DAJIALA_KEY = "test-key";
process.env.DAJIALA_BASE_URL = provider.url;
config.allowPrivateNetworkFetch = true;
process.env.COLLECT_ENABLED = "true";
let savedBudgets: Array<{ service: string; per_minute: number; per_hour: number; per_day: number }> = [];
before(async () => {
  savedBudgets = await sql`SELECT service, per_minute, per_hour, per_day FROM budgets WHERE service IN ('socialdata','dajiala')`;
  await sql`UPDATE budgets SET per_minute = 1000, per_hour = 10000, per_day = 100000 WHERE service IN ('socialdata','dajiala')`;
});
after(async () => {
  for (const b of savedBudgets) await sql`UPDATE budgets SET per_minute = ${b.per_minute}, per_hour = ${b.per_hour}, per_day = ${b.per_day} WHERE service = ${b.service}`;
  process.env.COLLECT_ENABLED = "false"; await provider.close(); await stopBoss(); await closeDb(); });
const runOf = async (id: number) => (await sql`SELECT * FROM operation_runs WHERE id = ${id}`)[0]!;
async function source(kind: "x_search" | "mp_account") {
  const id = `native-${tag()}`;
  const sourceConfig = kind === "x_search" ? { query: `from:synthetic ${id}` } : { ghid: id };
  await sql`INSERT INTO sources(id, name, kind, config, participation_mode) VALUES (${id}, 'Synthetic', ${kind}, ${sql.json(sourceConfig)}, 'isolated')`;
  await sql.begin((tx) => createSubscription(tx, { sourceId: id, provider: kind === "x_search" ? "socialdata" : "dajiala", platform: kind === "x_search" ? "x" : "wechat", operationKey: kind === "x_search" ? "x.search" : "mp.history", contractVersion: 1, config: sourceConfig, enabled: true, intervalMinutes: 30 }));
  return id;
}
async function command(id: string) { return createNativeCollection(id, { actor: "test", key: tag(), reason: "schedule" }); }
async function step(id: number) { const run = await runOf(id); return executeNativeStep(id, run.step_version, randomUUID()); }

test("native X commits materials, consumed receipt and subscription progress together", async () => {
  const id = await source("x_search"), run = await command(id);
  await step(run.id);
  assert.equal((await runOf(run.id)).status, "completed");
  assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id = ${id}`)[0]!.n, 1);
  assert.equal((await sql`SELECT cursor FROM sources WHERE id = ${id}`)[0]!.cursor, null, "legacy source progress stays historical");
  const [sub] = await sql`SELECT progress, active_run_id FROM collection_subscriptions WHERE control_source_id = ${id}`;
  assert.equal(sub!.progress.lastTweetId, XID);
  assert.equal(sub!.active_run_id, null);
});

test("MP list and body are separate durable steps; source page survives until article commit", async () => {
  const id = await source("mp_account"), run = await command(id);
  await step(run.id);
  const waiting = await runOf(run.id);
  assert.equal(waiting.step_key, "mp.body");
  assert.equal(waiting.progress.retainedReceiptIds.length, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id = ${id}`)[0]!.n, 0);
  await step(run.id);
  assert.equal((await runOf(run.id)).status, "completed");
  const [article] = await sql`SELECT body_status, body_text FROM articles WHERE source_id = ${id}`;
  assert.equal(article!.body_status, "ok");
  assert.match(article!.body_text, /Synthetic article body/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results WHERE run_id = ${run.id}`)[0]!.n, 2);
});

for (const kind of ["x_search", "mp_account"] as const) test(`${kind}: repaired null migration config collects new material and queues processing`, async () => {
  const id = `native-repair-${tag()}`, tweetId = String(BigInt(Date.now()) * 100000n);
  const sourceConfig = kind === "x_search" ? { query: `from:synthetic ${id}` } : { ghid: id };
  const mode = kind === "x_search" ? "isolated" : "editorial";
  await sql`INSERT INTO sources(id,name,kind,config,enabled,participation_mode)
    VALUES (${id},'Synthetic repaired migration',${kind},'null'::jsonb,false,${mode})`;
  assert.deepEqual(await migrateNativeSources({ oldWritersStopped: true, sourceIds: [id] }), { inspected: 1, created: 1, blocked: 1 });
  const [original] = await sql`SELECT * FROM sources WHERE id=${id}`;
  const [blocked] = await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${id}`;
  assert.equal(blocked!.config,null);assert.ok(blocked!.active_run_id);
  const repaired = await updateSource(id, { version: original!.updated_at.toISOString(), patch: { config: sourceConfig } }, "test");
  assert.deepEqual(repaired!.config,sourceConfig);
  const enabled = await updateSource(id, { version: repaired!.updated_at.toISOString(), patch: { enabled: true } }, "test");
  assert.equal(enabled!.enabled,true);
  const [ready] = await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${id}`;
  assert.deepEqual(ready!.config,sourceConfig);assert.equal(ready!.active_run_id,null);assert.equal(ready!.enabled,true);
  override = (req) => {
    if (kind === "x_search") return { tweets: [{ id_str: tweetId, tweet_created_at: new Date().toISOString(), full_text: "Synthetic repaired migration post", user: { name: "Synthetic", screen_name: "synthetic" } }], next_cursor: null };
    if (req.url.includes("post_history")) return { code: 0, data: [{ position: 1, url: `https://mp.weixin.qq.com/s?__biz=${id}&mid=1&idx=1&sn=synthetic`, title: "Synthetic repaired migration post", post_time: Math.floor(Date.now() / 1000), sn: id }], remain_money: 10 };
    return { code: 0, title: "Synthetic repaired migration post", content: "<p>Synthetic repaired migration body.</p>" };
  };
  try {
    const input = { actor: "test", key: tag(), reason: "schedule" as const };
    const run = await createNativeCollection(id,input), before = provider.hits();
    const snapshot = await runOf(run.id);
    assert.deepEqual(snapshot.input.sources[0].config,sourceConfig);
    for (let i=0;i<3 && (await runOf(run.id)).status==="active";i++) await step(run.id);
    const completed = await runOf(run.id);
    assert.equal(completed.status,"completed",completed.wait_reason);
    assert.equal(completed.current_receipt_id,null);
    assert.equal(provider.hits()-before,kind==="x_search"?1:2);
    const articles = await sql`SELECT * FROM articles WHERE source_id=${id}`;
    assert.equal(articles.length,1);
    const article = articles[0]!;
    assert.ok(article.processing_queued_at);assert.equal(article.backfill,true);
    if (kind==="mp_account") { assert.equal(article.body_status,"ok");assert.match(article.body_text,/Synthetic repaired migration body/); }
    const jobs = await sql`SELECT name,data FROM pgboss.job WHERE data->>'articleId'=${article.id}`;
    assert.equal(jobs.length,1);assert.equal(jobs[0]!.name,kind==="x_search"?QUEUES.group:QUEUES.analyze);
    if (kind==="x_search") assert.equal(jobs[0]!.data.signalOnly,true);
    const results = await sql`SELECT z.kind,z.article_id,r.status FROM operation_results z JOIN receipts r ON r.id=z.receipt_id WHERE z.run_id=${run.id}`;
    assert.equal(results.length,2);assert.ok(results.every(r=>r.status==="completed"));
    assert.equal(results.find(r=>r.kind==="article")!.article_id,article.id);
    const [sub] = await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${id}`;
    assert.equal(sub!.active_run_id,null);assert.deepEqual(sub!.config,sourceConfig);
    if (kind==="x_search") assert.equal(sub!.progress.lastTweetId,tweetId);else assert.ok(sub!.progress.lastCheckedAt);
    const [source] = await sql`SELECT config,participation_mode,site_fulltext,syndicate_fulltext FROM sources WHERE id=${id}`;
    assert.equal(source!.config,null);assert.equal(source!.participation_mode,original!.participation_mode);
    assert.equal(source!.site_fulltext,original!.site_fulltext);assert.equal(source!.syndicate_fulltext,original!.syndicate_fulltext);
    assert.equal((await createNativeCollection(id,input)).id,run.id);
    assert.equal(provider.hits()-before,kind==="x_search"?1:2);
  } finally { override=null; }
});

test("received native page replays locally with outbound collection disabled", async () => {
  const id = await source("x_search"), run = await command(id);
  const snapshot = await runOf(run.id);
  await searchTweets(snapshot.input.sources[0].config.query, { purpose: "source_fetch", subject: snapshot.input.subject, window: snapshot.input.window,
    paid: receiptOptions({ runId: run.id, stepVersion: 1, generation: 0 }) });
  const hits = provider.hits();
  process.env.COLLECT_ENABLED = "false";
  delete process.env.SOCIALDATA_API_KEY;
  try {
    await step(run.id);
    assert.equal((await runOf(run.id)).status, "completed");
    assert.equal(provider.hits(), hits);
  } finally { process.env.COLLECT_ENABLED = "true"; process.env.SOCIALDATA_API_KEY = "test-key"; }
});


test("missing credentials roll back native receipt placeholders and attempts before dispatch", async () => {
  const { mpHistory, mpArticle } = await import("@aihot/backend/providers/dajiala");
  const marker = `missing-key-${tag()}`;
  const before = provider.hits();
  delete process.env.SOCIALDATA_API_KEY; delete process.env.DAJIALA_KEY;
  try {
    await assert.rejects(searchTweets(marker, { purpose: marker, subject: marker, window: marker }), /not configured/);
    await assert.rejects(mpHistory(marker, { subject: marker, window: marker }), /not configured/);
    await assert.rejects(mpArticle(`https://example.test/${marker}`, { subject: marker, identity: marker }), /not configured/);
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts WHERE subject = ${marker}`)[0]!.n, 0);
    assert.equal(provider.hits(), before);
  } finally { process.env.SOCIALDATA_API_KEY = "test-key"; process.env.DAJIALA_KEY = "test-key"; }
});


test("command identity excludes frozen clock and subsequent subscription progress", async () => {
  const id = await source("x_search"), key = tag();
  const command = { actor: "test", key, reason: "manual" as const, force: true };
  const first = await createNativeCollection(id, command);
  await step(first.id);
  await sql`UPDATE collection_subscriptions SET progress = progress || '{"lastTweetId":"123"}', interval_minutes = 45 WHERE control_source_id = ${id}`;
  assert.equal((await createNativeCollection(id, command)).id, first.id);
  await assert.rejects(createNativeCollection(id, { ...command, reason: "schedule" }), /different input/);
});

test("saved preview keeps its first snapshot; draft identity ignores runtime cursor and interval", async () => {
  const { createNativePreview } = await import("@aihot/backend/sources/native-commands");
  const { sourceDetail, previewSource } = await import("@aihot/backend/admin/sources");
  const id = await source("x_search");
  const original = (await sourceDetail(id))!.source;
  const savedKey = tag();
  const saved = await createNativePreview(original as never, "test", savedKey, true);
  await sql`UPDATE collection_subscriptions SET config = '{"query":"changed-after-preview"}', progress = '{"lastTweetId":"456"}' WHERE control_source_id = ${id}`;
  assert.equal((await createNativePreview((await sourceDetail(id))!.source as never, "test", savedKey, true)).id, saved.id);
  const draftKey = tag();
  const draft = await createNativePreview(original as never, "test", draftKey);
  assert.equal((await createNativePreview({ ...original, cursor: { lastTweetId: "999" }, interval_minutes: 90 } as never, "test", draftKey)).id, draft.id);
  assert.equal((await runOf(draft.id)).input.sources[0].cursor, null);
  await assert.rejects(createNativePreview({ ...original, config: { query: "different draft" } } as never, "test", draftKey), /different input/);
  await assert.rejects(previewSource(original as never, "test"), /Idempotency-Key/);
});

test("shared unknown receipt is governed and globally auto-released only once", async () => {
  const { paidRequest } = await import("@aihot/backend/providers/receipts");
  const { releaseOperationReceipt } = await import("@aihot/backend/providers/operations/recovery");
  const { autoReleaseUnknownReceipts } = await import("@aihot/backend/admin/runs");
  const a = await command(await source("x_search")), b = await command(await source("x_search"));
  const req = { service: "socialdata", purpose: "source_fetch", identity: { syntheticUnknown: tag() } };
  await assert.rejects(paidRequest(req, async () => { throw new Error("lost"); }, receiptOptions({ runId: a.id, stepVersion: 1, generation: 0 })));
  await assert.rejects(paidRequest(req, async () => { throw new Error("must not send"); }, receiptOptions({ runId: b.id, stepVersion: 1, generation: 0 })));
  const receiptId = (await runOf(a.id)).current_receipt_id;
  await sql`UPDATE operation_runs SET status = 'waiting' WHERE id IN ${sql([a.id,b.id])}`;
  await sql`UPDATE receipts SET updated_at = now() - interval '31 minutes' WHERE id = ${receiptId}`;
  await autoReleaseUnknownReceipts();
  assert.equal((await sql`SELECT status FROM receipts WHERE id = ${receiptId}`)[0]!.status, "unknown");
  assert.equal((await releaseOperationReceipt(receiptId)).released, true);
  assert.equal((await runOf(a.id)).status, "active"); assert.equal((await runOf(b.id)).status, "active");
  const current = await runOf(a.id);
  await assert.rejects(paidRequest(req, async () => { throw new Error("lost again"); }, receiptOptions({ runId: a.id, stepVersion: current.step_version, generation: current.generation })));
  await sql`UPDATE receipts SET updated_at = now() - interval '31 minutes' WHERE id = ${receiptId}`;
  assert.equal((await releaseOperationReceipt(receiptId)).released, false);
});

test("coordinated migration preserves ambiguous receipt governance for every affected source", async () => {
  const { migrateNativeSources } = await import("@aihot/backend/sources/native-migration");
  const { paidRequest } = await import("@aihot/backend/providers/receipts");
  const ids = [`legacy-${tag()}`,`legacy-${tag()}`];
  for (const id of ids) await sql`INSERT INTO sources(id,name,kind,config,cursor) VALUES (${id},'Synthetic legacy','x_search',${sql.json({query:id})},'{"lastTweetId":"100"}')`;
  await assert.rejects(paidRequest({ service:"socialdata",purpose:"source_fetch",subject:`x-shard:legacy-${tag()}`,identity:tag() },async () => { throw new Error("legacy unknown"); }));
  const result = await migrateNativeSources({oldWritersStopped:true,sourceIds:ids});
  assert.equal(result.blocked,2);
  const rows = await sql`SELECT c.control_source_id,c.active_run_id,o.input,o.current_receipt_id FROM collection_subscriptions c JOIN operation_runs o ON o.id=c.active_run_id WHERE c.control_source_id IN ${sql(ids)}`;
  assert.equal(rows.length,2); assert.equal(rows[0]!.current_receipt_id,rows[1]!.current_receipt_id);
  await sql`UPDATE collection_subscriptions SET progress = '{"lastTweetId":"200"}' WHERE control_source_id IN ${sql(ids)}`;
  const repeated = await migrateNativeSources({oldWritersStopped:true,sourceIds:ids});
  assert.equal(repeated.created,0);
  assert.equal(repeated.blocked,2,"rerun still reports unresolved migration blockers");
  for (const row of rows) {
    assert.deepEqual((await runOf(row.active_run_id)).input,row.input);
    assert.equal((await sql`SELECT progress FROM collection_subscriptions WHERE control_source_id=${row.control_source_id}`)[0]!.progress.lastTweetId,"200");
  }
  await sql`UPDATE receipts SET status = 'completed' WHERE id = ${rows[0]!.current_receipt_id}`;
});


test("a paused batch member cannot receive a late page; other members finish", async () => {
  const { createNativeBatch } = await import("@aihot/backend/sources/native-commands");
  const { updateSource, sourceDetail } = await import("@aihot/backend/admin/sources");
  const a = await source("x_search"), b = await source("x_search");
  const started = gate(), release = gate();
  const suffix = Date.now().toString(36);
  const handles = [`one_${suffix}`, `two_${suffix}`];
  for (const [i,id] of [a,b].entries()) await sql`UPDATE collection_subscriptions SET config = ${sql.json({query:`from:${handles[i]} -filter:replies`})}, progress = '{"lastTweetId":"1","initializedAt":"2026-01-01"}' WHERE control_source_id = ${id}`;
  const run = await createNativeBatch([a,b], { actor:"test", key:tag(), shardKey:tag() });
  override = async () => { started.open(); await release.promise; return { tweets: handles.map((handle,i) => ({ id_str: String(BigInt(XID)+100n+BigInt(i)), tweet_created_at: new Date().toISOString(), full_text:"Synthetic batch", user:{name:handle,screen_name:handle} })), next_cursor:null }; };
  try {
    const executing = step(run.id); await started.promise;
    await updateSource(a, { patch:{enabled:false}, version:new Date((await sourceDetail(a))!.source.updated_at).toISOString(), reason:"pause synthetic member" }, "test");
    release.open(); await executing;
    assert.equal((await runOf(run.id)).status,"completed");
    assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id = ${a}`)[0]!.n,0);
    assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id = ${b}`)[0]!.n,1);
  } finally { release.open(); override = null; }
});

test("interval edits preserve an active run; explicit manual force can collect a paused source", async () => {
  const { updateSource, sourceDetail } = await import("@aihot/backend/admin/sources");
  const { abandonRun } = await import("@aihot/backend/providers/operations/store");
  const id = await source("x_search"), run = await command(id);
  await updateSource(id, {patch:{interval_minutes:99},version:new Date((await sourceDetail(id))!.source.updated_at).toISOString()},"test");
  assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE control_source_id = ${id}`)[0]!.active_run_id,run.id);
  await sql.begin((tx) => abandonRun(tx,{runId:run.id,stepVersion:1,generation:0},"synthetic cleanup"));
  await updateSource(id,{patch:{enabled:false},version:new Date((await sourceDetail(id))!.source.updated_at).toISOString()},"test");
  await assert.rejects(command(id),/disabled/);
  const forced = await createNativeCollection(id,{actor:"test",key:tag(),reason:"manual",force:true});
  await step(forced.id);
  assert.equal((await runOf(forced.id)).status,"completed");
  assert.equal((await sql`SELECT enabled FROM sources WHERE id = ${id}`)[0]!.enabled,false);
});

test("malformed paid JSON is persisted as received and replay never dispatches again", async () => {
  const { createServer } = await import("node:http");
  const { mpHistory, mpArticle } = await import("@aihot/backend/providers/dajiala");
  let hits = 0;
  const raw = createServer((_req,res) => { hits++; res.end("{broken-json"); });
  await new Promise<void>((resolve) => raw.listen(0,"127.0.0.1",resolve));
  const address = raw.address() as {port:number};
  const oldSd = process.env.SOCIALDATA_BASE_URL, oldMp = process.env.DAJIALA_BASE_URL;
  process.env.SOCIALDATA_BASE_URL = process.env.DAJIALA_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const marker = tag();
    const calls = [() => searchTweets(marker,{purpose:"source_fetch",subject:marker,window:marker}), () => mpHistory(marker,{subject:marker,window:marker}), () => mpArticle(`https://example.test/${marker}`,{subject:marker,identity:marker})];
    for (const call of calls) { await assert.rejects(call(),/Invalid/); await assert.rejects(call(),/Invalid/); }
    assert.equal(hits,3);
    const receipts = await sql`SELECT status,response FROM receipts WHERE subject = ${marker}`;
    assert.equal(receipts.length,3);
    assert.ok(receipts.every((r) => r.status === "received" && r.response._invalidJson === "{broken-json"));
  } finally {
    process.env.SOCIALDATA_BASE_URL = oldSd; process.env.DAJIALA_BASE_URL = oldMp;
    await new Promise<void>((resolve,reject) => raw.close((e) => e ? reject(e) : resolve()));
  }
});


test("partial migration cancels only owned single-source jobs and fully included batches", async () => {
  const { migrateNativeSources } = await import("@aihot/backend/sources/native-migration");
  const { enqueue } = await import("@aihot/backend/jobs/queue");
  const ids = [`scope-${tag()}`,`scope-${tag()}`];
  for (const id of ids) await sql`INSERT INTO sources(id,name,kind,config) VALUES (${id},'Synthetic scope','mp_account',${sql.json({ghid:id})})`;
  const a = await enqueue("sources.mp",{sourceId:ids[0]});
  const b = await enqueue("sources.mp",{sourceId:ids[1]});
  const mixed = await enqueue("sources.fetch-x",{sourceIds:ids});
  await migrateNativeSources({oldWritersStopped:true,sourceIds:[ids[0]!]});
  const state = async (id:string|null) => (await sql`SELECT state FROM pgboss.job WHERE id=${id}`)[0]!.state;
  assert.equal(await state(a),"cancelled"); assert.equal(await state(b),"created"); assert.equal(await state(mixed),"created");
  await migrateNativeSources({oldWritersStopped:true,sourceIds:ids});
  assert.equal(await state(b),"cancelled"); assert.equal(await state(mixed),"cancelled");
});


test("unknown occupancy survives permission tightening and interval changes", async () => {
  const { paidRequest } = await import("@aihot/backend/providers/receipts");
  const { updateSource, sourceDetail } = await import("@aihot/backend/admin/sources");
  const id = await source("x_search");
  await sql`UPDATE sources SET site_fulltext = true WHERE id = ${id}`;
  const run = await command(id);
  await assert.rejects(paidRequest({service:"socialdata",purpose:"source_fetch",identity:tag()},async()=>{throw new Error("unknown");},receiptOptions({runId:run.id,stepVersion:1,generation:0})));
  const receiptId = (await runOf(run.id)).current_receipt_id;
  await updateSource(id,{patch:{site_fulltext:false,tier:"T1"},version:new Date((await sourceDetail(id))!.source.updated_at).toISOString()},"test");
  await updateSource(id,{patch:{interval_minutes:120},version:new Date((await sourceDetail(id))!.source.updated_at).toISOString()},"test");
  assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE control_source_id=${id}`)[0]!.active_run_id,run.id);
  assert.equal((await runOf(run.id)).current_receipt_id,receiptId);
  await assert.rejects(command(id),/occupied/);
});

test("budget waits preserve retry allowance and resume the same frozen command", async () => {
  const { recoverOperations } = await import("@aihot/backend/providers/operations/recovery");
  const id = await source("x_search"), run = await command(id);
  const frozen = (await runOf(run.id)).input;
  await sql`UPDATE budgets SET per_minute = 0 WHERE service = 'socialdata'`;
  try { await step(run.id); } finally { await sql`UPDATE budgets SET per_minute = 1000 WHERE service = 'socialdata'`; }
  const waiting = await runOf(run.id);
  assert.equal(waiting.status,"waiting"); assert.equal(waiting.retry_count,0);
  assert.equal(waiting.current_receipt_id,null);
  await sql`UPDATE operation_runs SET next_attempt_at = now() - interval '1 minute' WHERE id = ${run.id}`;
  // Recovery deliberately scans bounded keyset batches; other synthetic active runs may precede this fixture.
  const [population]=await sql`SELECT count(*)::integer AS count FROM operation_runs WHERE status IN ('active','waiting')`;
  for(let i=0;i<Math.ceil(population!.count/200)+2;i++){
    await recoverOperations();
    if((await runOf(run.id)).status==="active")break;
  }
  await step(run.id);
  assert.equal((await runOf(run.id)).status,"completed");
  assert.deepEqual((await runOf(run.id)).input,frozen);
});

test("hot signal batch applies sixty minutes unless the operator changed its interval", async () => {
  const { createNativeBatch } = await import("@aihot/backend/sources/native-commands");
  const { updateSource, sourceDetail } = await import("@aihot/backend/admin/sources");
  const a = await source("x_search"), b = await source("x_search");
  for (const [i,id] of [a,b].entries()) {
    await sql`UPDATE sources SET participation_mode = 'hot_signal' WHERE id = ${id}`;
    await sql`UPDATE collection_subscriptions SET config = ${sql.json({query:`from:cadence_${i} -filter:replies`})}, progress = '{"lastTweetId":"1"}' WHERE control_source_id = ${id}`;
  }
  const run = await createNativeBatch([a,b],{actor:"test",key:tag(),shardKey:tag()});
  await updateSource(b,{patch:{interval_minutes:90},version:new Date((await sourceDetail(b))!.source.updated_at).toISOString()},"test");
  override = () => ({tweets:[],next_cursor:null});
  try { await step(run.id); } finally { override = null; }
  assert.equal((await runOf(run.id)).status,"completed");
  for (const [id,minutes] of [[a,60],[b,90]] as const) {
    const [sub] = await sql`SELECT interval_minutes, extract(epoch FROM(next_run_at-now()))/60 AS minutes FROM collection_subscriptions WHERE control_source_id = ${id}`;
    assert.equal(sub!.interval_minutes,minutes); assert.ok(Math.abs(Number(sub!.minutes)-minutes)<1);
  }
});

test("native first transport loss is waiting from persisted unknown receipt",async()=>{
  const broken=http.createServer(req=>req.socket.destroy());await new Promise<void>(resolve=>broken.listen(0,"127.0.0.1",resolve));
  process.env.SOCIALDATA_BASE_URL=`http://127.0.0.1:${(broken.address() as {port:number}).port}`;
  try {
    const run=await command(await source("x_search"));await step(run.id);const state=await runOf(run.id);
    const [receipt]=await sql`SELECT status,updated_at FROM receipts WHERE id=${state.current_receipt_id}`;
    assert.equal(receipt!.status,"unknown");assert.equal(state.status,"waiting");assert.equal(state.next_attempt_at.getTime(),receipt!.updated_at.getTime()+30*60_000);
    // Leave no runnable synthetic network task for later recovery tests.
    await sql.begin(tx=>abandonRun(tx,{runId:run.id,stepVersion:state.step_version,generation:state.generation},"synthetic test cleanup"));
  } finally {process.env.SOCIALDATA_BASE_URL=provider.url;await new Promise<void>(resolve=>broken.close(()=>resolve()));}
});
