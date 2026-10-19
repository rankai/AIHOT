import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { sql, closeDb } from "@aihot/backend/db";
import { autoReleaseUnknownReceipts, releaseReceipt } from "@aihot/backend/admin/runs";
import { Conflict } from "@aihot/backend/admin/sources";
import { CAPABILITIES } from "@aihot/backend/editorial/models";
import { analyzeArticle, loadAnalyzeInput, runAnalysis } from "@aihot/backend/editorial/analyze";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { paidRequest, ReceiptUnknownError } from "@aihot/backend/providers/receipts";
import { processArticle, registerContentJobs } from "@aihot/backend/jobs/content";
import { ensureQueue, getBoss, QUEUES, QUEUE_OPTIONS, stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const SOURCE = `recovery-${T}`;
const provider = await stub((hit) => ({ choices: [{ message: { content: JSON.stringify({ label: "BLOCK", reason: `Unrelated material ${hit}` }) } }] }));
process.env.DASHSCOPE_BASE_URL = `${provider.url}/v1`;
process.env.DASHSCOPE_API_KEY = "test-key";
const analyzeOptions = QUEUE_OPTIONS[QUEUES.analyze]!;
Object.assign(QUEUES, { analyze: `test.recovery-${T}` });
before(async () => {
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode) VALUES (${SOURCE},'Recovery','rss','T1','editorial')`;
  await ensureQueue(QUEUES.analyze, analyzeOptions);
});
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

async function article() {
  return (await upsertMaterial({ sourceId: SOURCE, url: `https://example.org/${tag()}`, title: `Unrelated cooking ${tag()}`,
    bodyText: "A detailed cooking recipe with ingredients and preparation instructions. ".repeat(20), bodyStatus: "ok", via: "fetch", publishedAt: new Date() })).articleId;
}
async function lost(articleId: string, purpose: string, revision = 1, attemptTag?: string) {
  const req = { service: "recovery:test", model: "test:model:with:colons", purpose, subject: `article:${articleId}@${revision}`, identity: { unique: tag() }, attemptTag };
  await assert.rejects(paidRequest(req, async () => { throw new Error("lost answer"); }));
  const [r] = await sql`SELECT id FROM receipts WHERE subject=${req.subject} AND purpose=${purpose} ORDER BY id DESC LIMIT 1`;
  const id = Number(r!.id);
  await sql`UPDATE articles SET processing_state='failed', processing_attempts=3, processing_error=${`receipt ${id} outcome unknown`} WHERE id=${articleId}`;
  return { id, req };
}
const jobs = (articleId: string) => sql`SELECT id,state,data FROM pgboss.job WHERE name=${QUEUES.analyze} AND data->>'articleId'=${articleId}`;
const state = async (articleId: string) => (await sql`SELECT revision,processing_state,processing_attempts,processing_error,processing_queued_at FROM articles WHERE id=${articleId}`)[0]!;
const release = (id: number) => releaseReceipt(id, { billed: false, note: "Checked test provider" }, "test");
let workerStarted = false;
async function startWorker() {
  if (workerStarted) return;
  await registerContentJobs(await getBoss(), 1);
  workerStarted = true;
}

for (const capability of [CAPABILITIES.prefilter, CAPABILITIES.score, CAPABILITIES.structure, CAPABILITIES.understand, CAPABILITIES.summarize]) {
  for (const purpose of capability.purposes) test(`${purpose}: release atomically resets and queues the current failed article`, async () => {
    const articleId = await article();
    const { id, req } = await lost(articleId, purpose);
    assert.equal((await release(id))!.requeued, true);
    const a = await state(articleId);
    assert.equal(a.processing_state, "new"); assert.equal(a.processing_attempts, 0); assert.equal(a.processing_error, null);
    assert.ok(a.processing_queued_at);
    assert.deepEqual((await jobs(articleId)).map(j => j.data), [{ articleId }]);
    assert.equal((await sql`SELECT status FROM receipt_attempts WHERE receipt_id=${id}`)[0]!.status, "failed");
    await assert.rejects(release(id), Conflict);
    assert.equal((await jobs(articleId)).length, 1);
    const retried = await paidRequest(req, async () => ({ response: { recovered: true } }));
    assert.equal(retried.receiptId, id); assert.equal(retried.reused, false);
  });
}

for (const [purpose, suffix] of [
  ["prefilter_article", undefined], ["score_article", "score-1"], ["score_article", "score-2"],
  ["structure_article", "structure"], ["understand_article", "understand"], ["summarize_article", "summarize"],
] as const) {
  test(`${purpose}/${suffix ?? "no suffix"}: restores only the explicit admin workflow tag`, async () => {
    for (const workflow of [undefined, `admin:${tag()}`]) {
      const articleId = await article();
      const attemptTag = [workflow, suffix].filter(Boolean).join(":") || undefined;
      const { id } = await lost(articleId, purpose, 1, attemptTag);
      assert.equal((await release(id))!.requeued, true);
      assert.deepEqual((await jobs(articleId)).map(j => j.data), [workflow ? { articleId, attemptTag: workflow } : { articleId }]);
    }
  });
}

test("recovery does not strip arbitrary suffixes or accept invalid admin request ids", async () => {
  for (const [purpose, attemptTag] of [
    ["score_article", "admin:request_123:structure"],
    ["score_article", "admin:request_123:score-3"],
    ["score_article", "admin:request_123"],
    ["prefilter_article", "admin:request_123:score-1"],
    ["prefilter_article", "admin:short"],
    ["prefilter_article", `admin:${"a".repeat(81)}`],
    ["prefilter_article", "admin:request:123"],
    ["summarize_article", "custom:request_123:summarize"],
  ]) {
    const articleId = await article();
    const { id } = await lost(articleId, purpose!, 1, attemptTag);
    await release(id);
    assert.deepEqual((await jobs(articleId)).map(j => j.data), [{ articleId }]);
  }
});

test("enqueue failure rolls back receipt, attempt and article; the same release can then succeed", async () => {
  const articleId = await article();
  const attemptTag = `admin:${tag()}`;
  const { id } = await lost(articleId, CAPABILITIES.score.purposes[0]!, 1, `${attemptTag}:score-2`);
  const prior = await state(articleId);
  // A temporary test-only DB constraint fails the actual pg-boss INSERT after the business writes.
  const constraint = `recovery_enqueue_${T}`;
  await sql.unsafe(`ALTER TABLE pgboss.job ADD CONSTRAINT ${constraint} CHECK ((data->>'articleId') IS DISTINCT FROM '${articleId}') NOT VALID`);
  try { await assert.rejects(release(id), /check constraint/); }
  finally { await sql.unsafe(`ALTER TABLE pgboss.job DROP CONSTRAINT ${constraint}`); }
  assert.equal((await sql`SELECT status FROM receipts WHERE id=${id}`)[0]!.status, "unknown");
  assert.equal((await sql`SELECT status FROM receipt_attempts WHERE receipt_id=${id}`)[0]!.status, "unknown");
  assert.deepEqual(await state(articleId), prior);
  assert.equal((await jobs(articleId)).length, 0);
  assert.equal((await release(id))!.requeued, true);
  assert.deepEqual((await jobs(articleId)).map(j => j.data), [{ articleId, attemptTag }]);
});

test("old revisions, manual processing states and unrelated purposes are not reset", async () => {
  for (const kind of ["revision", "manual", "unrelated"]) {
    const articleId = await article();
    const { id } = await lost(articleId, kind === "unrelated" ? "translate_body" : "score_article");
    if (kind === "revision") await sql`UPDATE articles SET revision=2 WHERE id=${articleId}`;
    if (kind === "manual") await sql`UPDATE articles SET processing_state='blocked',processing_error='manual decision' WHERE id=${articleId}`;
    const prior = await state(articleId);
    assert.equal((await release(id))!.requeued, false);
    assert.deepEqual(await state(articleId), prior);
    assert.equal((await jobs(articleId)).length, 0);
  }
});

test("automatic recovery requeues once; a second lost answer waits for manual release", async () => {
  const articleId = await article();
  const attemptTag = `admin:${tag()}`;
  const { id, req } = await lost(articleId, "structure_article", 1, `${attemptTag}:structure`);
  const age = () => sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${id}`;
  await age(); await autoReleaseUnknownReceipts();
  assert.equal((await state(articleId)).processing_state, "new");
  assert.equal((await jobs(articleId)).length, 1);
  assert.deepEqual((await jobs(articleId)).map(j => j.data), [{ articleId, attemptTag }]);
  await assert.rejects(paidRequest(req, async () => { throw new Error("lost again"); }));
  await sql`UPDATE articles SET processing_state='failed' WHERE id=${articleId}`;
  await age(); await autoReleaseUnknownReceipts();
  assert.equal((await state(articleId)).processing_state, "failed");
  assert.equal((await sql`SELECT status FROM receipts WHERE id=${id}`)[0]!.status, "unknown");
  await assert.rejects(paidRequest(req, async () => ({ response: {} })), ReceiptUnknownError);
  await release(id);
  assert.equal((await state(articleId)).processing_state, "new");
  assert.equal((await jobs(articleId)).length, 1, "existing singleton is reused");
});

test("actual content worker finishes an article stopped on its real prefilter receipt", async () => {
  const articleId = await article();
  const initial = await analyzeArticle(articleId);
  assert.equal(initial!.output!.relevance, "block");
  const id = initial!.receiptIds[0]!;
  await sql`DELETE FROM analyses WHERE article_id=${articleId}`;
  await sql`UPDATE receipts SET status='unknown',response=NULL WHERE id=${id}`;
  await sql`UPDATE receipt_attempts SET status='unknown' WHERE receipt_id=${id}`;
  await sql`UPDATE articles SET processing_state='new' WHERE id=${articleId}`;
  assert.equal((await processArticle(articleId)).state, "unknown-receipt");
  assert.equal((await state(articleId)).processing_state, "failed");
  await release(id);
  // Only this job is made runnable; the other fixtures assert enqueue without processing.
  await sql`UPDATE pgboss.job SET start_after=now()+interval '1 day' WHERE name=${QUEUES.analyze} AND data->>'articleId'<>${articleId}`;
  const hits = provider.hits();
  await startWorker();
  const deadline = Date.now() + 20_000;
  while ((await jobs(articleId))[0]?.state !== "completed") {
    assert.ok(Date.now() < deadline, "worker did not complete recovery");
    await delay(50);
  }
  assert.equal(provider.hits() - hits, 1);
  assert.equal((await state(articleId)).processing_state, "blocked");
  assert.equal((await sql`SELECT status,attempts FROM receipts WHERE id=${id}`)[0]!.status, "completed");
  assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${id}`)[0]!.attempts, 2);
  assert.equal((await sql`SELECT count(*)::int AS n FROM analyses WHERE article_id=${articleId}`)[0]!.n, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM publications WHERE article_id=${articleId}`)[0]!.n, 1);
});

test("actual worker resumes the admin request despite completed ordinary receipts for the same revision", async () => {
  const articleId = await article();
  const ordinary = (await analyzeArticle(articleId))!;
  const ordinaryId = ordinary.receiptIds[0]!;
  const [oldAnalysis] = await sql`SELECT output FROM analyses WHERE id=${ordinary.analysisId!}`;
  const attemptTag = `admin:${tag()}`;
  // Persist the real tagged request, then simulate a lost response before business commit.
  const tagged = await runAnalysis((await loadAnalyzeInput(articleId))!, { attemptTag });
  const id = tagged.prefilter.receiptId;
  assert.notEqual(id, ordinaryId);
  await sql`UPDATE receipts SET status='unknown',response=NULL WHERE id=${id}`;
  await sql`UPDATE receipt_attempts SET status='unknown' WHERE receipt_id=${id}`;
  assert.equal((await processArticle(articleId, { attemptTag })).state, "unknown-receipt");
  assert.equal((await state(articleId)).processing_state, "failed");
  assert.equal((await sql`SELECT status FROM receipts WHERE id=${ordinaryId}`)[0]!.status, "completed");
  const hits = provider.hits();
  // Start here as well so this regression can run alone with --test-name-pattern.
  await startWorker();
  assert.equal((await release(id))!.requeued, true);
  assert.deepEqual((await jobs(articleId)).map(j => j.data), [{ articleId, attemptTag }]);
  const deadline = Date.now() + 20_000;
  while ((await jobs(articleId))[0]?.state !== "completed") {
    assert.ok(Date.now() < deadline, "worker did not complete admin recovery");
    await delay(50);
  }
  assert.equal(provider.hits() - hits, 1, "retry must call the provider instead of reusing the ordinary response");
  assert.equal((await state(articleId)).processing_state, "blocked");
  const [recovered] = await sql`SELECT status,attempts FROM receipts WHERE id=${id}`;
  assert.equal(recovered!.status, "completed");
  assert.equal(recovered!.attempts, 2, "the original admin receipt is retried");
  const [unchanged] = await sql`SELECT status,attempts FROM receipts WHERE id=${ordinaryId}`;
  assert.equal(unchanged!.status, "completed");
  assert.equal(unchanged!.attempts, 1);
  const analyses = await sql`SELECT input_revision,receipt_ids,output FROM analyses WHERE article_id=${articleId} ORDER BY id`;
  assert.equal(analyses.length, 2, "only the original analysis and the recovered re-evaluation are committed");
  assert.equal(analyses[0]!.input_revision, analyses[1]!.input_revision);
  assert.deepEqual(analyses[1]!.receipt_ids, [id]);
  assert.notDeepEqual(analyses[1]!.output, oldAnalysis!.output);
  assert.equal(analyses[1]!.output.prefilter.reason, `Unrelated material ${hits + 1}`);
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts WHERE subject=${`article:${articleId}@1`}`)[0]!.n, 2);
  assert.equal((await sql`SELECT count(*)::int AS n FROM publications WHERE article_id=${articleId}`)[0]!.n, 1);
});
