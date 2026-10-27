import { gate, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { sql, closeDb } from "@aihot/backend/db";
import { paidRequest, logicalKeyFor, ReceiptBusyError, ReceiptUnknownError, StaleReceiptAttemptError } from "@aihot/backend/providers/receipts";
import { advanceRun, claimRun, createRun, receiptOptions, retainCurrentReceipt, saveResult, setRunState, resumeRun, abandonRun, StaleOperationError, type Execution } from "@aihot/backend/providers/operations/store";
import { createSubscription } from "@aihot/backend/sources/subscriptions";
import { bindSourceAccount } from "@aihot/backend/sources/account-bindings";

after(closeDb);
const command = () => ({ actor: "operation-tests", commandKey: tag(), provider: "socialdata", operationKey: "search", contractVersion: 1, input: { query: "synthetic" }, stepKey: "page" });
const request = () => ({ service: "operation-test", purpose: "synthetic", identity: tag() });
const readRun = async (id: number) => (await sql`SELECT * FROM operation_runs WHERE id = ${id}`)[0]!;
async function start(subscriptionIds: number[] = []) {
  const run = await sql.begin((tx) => createRun(tx, { ...command(), subscriptionIds }));
  const execution = await sql.begin((tx) => claimRun(tx, { runId: run.id, stepVersion: 1, generation: 0 }, randomUUID()));
  return execution;
}
async function subscription() {
  const sourceId = `op-${tag()}`;
  await sql`INSERT INTO sources(id, name, kind) VALUES (${sourceId}, 'synthetic', 'x_search')`;
  const id = await sql.begin((tx) => createSubscription(tx, { sourceId, provider: "socialdata", platform: "x", operationKey: "search", contractVersion: 1, config: {}, intervalMinutes: 30, enabled: true }));
  return { id, sourceId };
}

test("command creation is idempotent and mismatched input is rejected", async () => {
  const c = command();
  const runs = await Promise.all([sql.begin((tx) => createRun(tx, c)), sql.begin((tx) => createRun(tx, c))]);
  assert.equal(runs[0].id, runs[1].id);
  await assert.rejects(sql.begin((tx) => createRun(tx, { ...c, input: { query: "changed" } })), /different input/);
});

test("receipt association commits before dispatch; failing association rolls back without sending", async () => {
  const execution = await start();
  const req = request();
  let sent = 0;
  await assert.rejects(paidRequest(req, async () => { sent++; return { response: {} }; }, { onReceipt: async () => { throw new Error("rollback"); } }), /rollback/);
  assert.equal(sent, 0);
  assert.equal((await sql`SELECT id FROM receipts WHERE service = ${req.service} AND logical_key = ${logicalKeyFor(req)}`).length, 0);
  await paidRequest(req, async () => {
    sent++;
    assert.ok((await readRun(execution.runId)).current_receipt_id);
    return { response: { items: [] } };
  }, receiptOptions(execution));
  assert.equal(sent, 1);
});

test("busy, unknown and received reuse associate every consumer without extra dispatch", async () => {
  const a = await start(), b = await start(), c = await start();
  const req = request();
  const entered = gate(), release = gate();
  let sent = 0;
  const first = paidRequest(req, async () => { sent++; entered.open(); await release.promise; throw new Error("lost response"); }, receiptOptions(a));
  const firstRejection = assert.rejects(first, /lost response/);
  await entered.promise;
  await assert.rejects(paidRequest(req, async () => { throw new Error("must not send"); }, receiptOptions(b)), ReceiptBusyError);
  const receiptId = (await readRun(a.runId)).current_receipt_id;
  assert.equal((await readRun(b.runId)).current_receipt_id, receiptId);
  release.open(); await firstRejection;
  await assert.rejects(paidRequest(req, async () => { throw new Error("must not send"); }, receiptOptions(c)), ReceiptUnknownError);
  assert.equal((await readRun(c.runId)).current_receipt_id, receiptId);
  assert.equal(sent, 1);
  // Simulate an explicitly verified recovery result, without external traffic.
  await sql`UPDATE receipts SET status = 'received', response = '{"items":[]}' WHERE id = ${receiptId}`;
  const reused = await paidRequest(req, async () => { throw new Error("must not send"); }, receiptOptions(c));
  assert.equal(reused.reused, true);
});

test("stopped retains occupancy, resume fences old executors, terminal release is conditional", async () => {
  const sub = await subscription();
  const a = await start([sub.id]);
  await sql.begin((tx) => setRunState(tx, a, "stopped", "operator stop"));
  await assert.rejects(start([sub.id]), /occupied/);
  await sql.begin((tx) => resumeRun(tx, a));
  await assert.rejects(sql.begin((tx) => saveResult(tx, a, { itemKey: "late", kind: "page", data: {} })), StaleOperationError);
  const resumed = { ...a, generation: a.generation + 1 };
  await sql.begin((tx) => setRunState(tx, resumed, "failed", "explicit abandonment"));
  const b = await start([sub.id]);
  await assert.rejects(sql.begin((tx) => advanceRun(tx, resumed, null)), StaleOperationError);
  assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id = ${sub.id}`)[0]!.active_run_id, b.runId);
});

test("result idempotence and retained source page survive enrichment and step fencing", async () => {
  const a = await start();
  const page = await paidRequest(request(), async () => ({ response: { items: [1, 2] } }), receiptOptions(a));
  await sql.begin((tx) => retainCurrentReceipt(tx, a, { page: { itemIndex: 0, nextCursor: "synthetic-next" } }));
  const detail = await paidRequest(request(), async () => ({ response: { detail: "synthetic" } }), receiptOptions(a));
  const result = { itemKey: "detail", kind: "item", data: {}, receiptId: detail.receiptId };
  const ids = await sql.begin(async (tx) => [await saveResult(tx, a, result), await saveResult(tx, a, result)]);
  assert.equal(ids[0], ids[1]);
  await assert.rejects(sql.begin((tx) => advanceRun(tx, a, null)), /Unconsumed source page/);
  const progress = (await readRun(a.runId)).progress;
  await sql.begin((tx) => advanceRun(tx, a, { stepKey: "page-rest", progress }));
  assert.deepEqual((await readRun(a.runId)).progress.retainedReceiptIds, [page.receiptId]);
  await assert.rejects(sql.begin((tx) => saveResult(tx, a, result)), StaleOperationError);
  const next: Execution = { ...a, stepVersion: 2 };
  await sql.begin(async (tx) => {
    await saveResult(tx, next, { itemKey: "page", kind: "page", data: { count: 2 }, receiptId: page.receiptId });
    await advanceRun(tx, next, null);
  });
  assert.equal((await readRun(a.runId)).status, "completed");
  assert.equal((await readRun(a.runId)).current_receipt_id, null);
});

test("batch retains eligible members; source version change rejects a single-member write", async () => {
  const a = await subscription(), b = await subscription();
  const execution = await start([a.id, b.id]);
  await sql`UPDATE sources SET execution_version = execution_version + 1 WHERE id = ${a.sourceId}`;
  await sql.begin((tx) => saveResult(tx, execution, { itemKey: "summary", kind: "page", data: {} }));
  await assert.rejects(sql.begin((tx) => saveResult(tx, execution, { itemKey: "stale-member", kind: "item", data: {}, sourceId: a.sourceId })), StaleOperationError);
  await sql`UPDATE sources SET execution_version = execution_version + 1 WHERE id = ${b.sourceId}`;
  await assert.rejects(sql.begin((tx) => saveResult(tx, execution, { itemKey: "late", kind: "page", data: {} })), StaleOperationError);
});

test("late attempt response cannot replace a newer receipt or attempt", async () => {
  const req = request();
  const entered = gate(), release = gate();
  const old = paidRequest(req, async () => { entered.open(); await release.promise; return { response: { old: true } }; });
  const rejected = assert.rejects(old, StaleReceiptAttemptError);
  await entered.promise;
  const [receipt] = await sql`SELECT id FROM receipts WHERE service = ${req.service} AND status = 'pending' ORDER BY id DESC LIMIT 1`;
  await sql`UPDATE receipts SET status = 'failed' WHERE id = ${receipt!.id}`;
  await sql`UPDATE receipt_attempts SET status = 'failed' WHERE receipt_id = ${receipt!.id}`;
  const newer = await paidRequest(req, async () => ({ response: { new: true } }));
  release.open(); await rejected;
  assert.deepEqual((await sql`SELECT response FROM receipts WHERE id = ${newer.receiptId}`)[0]!.response, { new: true });
  assert.deepEqual((await sql`SELECT status FROM receipt_attempts WHERE receipt_id = ${newer.receiptId} ORDER BY attempt`).map((r) => r.status), ["failed", "received"]);
  assert.deepEqual((await sql`SELECT response FROM receipt_attempts WHERE receipt_id = ${newer.receiptId} AND attempt = 1`)[0]!.response, { old: true });
});

test("account identity preserves exact typed values and conflicts do not reassign sources", async () => {
  const a = await subscription(), b = await subscription();
  const input = { platform: "tiktok", idKind: "userId", idValue: `90071992547409931234${tag()}`, sourceId: a.sourceId, evidence: { kind: "audit" as const, reference: "synthetic-audit" } };
  await sql.begin((tx) => bindSourceAccount(tx, input));
  await assert.rejects(sql.begin((tx) => bindSourceAccount(tx, { ...input, sourceId: b.sourceId })), /already belongs/);
  assert.equal((await sql`SELECT source_id FROM source_account_bindings WHERE id_value = ${input.idValue}`)[0]!.source_id, a.sourceId);
});


test("receipt association and business consumption use one lock order", async () => {
  const execution = await start();
  const req = request();
  const receipt = await paidRequest(req, async () => ({ response: {} }), receiptOptions(execution));
  const entered = gate(), release = gate();
  const base = receiptOptions(execution);
  const reuse = paidRequest(req, async () => { throw new Error("no external request"); }, {
    ...base,
    beforeClaim: async (tx) => { await base.beforeClaim!(tx); entered.open(); await release.promise; },
  });
  await entered.promise;
  const consume = sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '2s'`;
    await saveResult(tx, execution, { itemKey: "page", kind: "page", data: {}, receiptId: receipt.receiptId });
    await advanceRun(tx, execution, null);
  });
  release.open();
  await Promise.all([reuse, consume]);
  assert.equal((await readRun(execution.runId)).status, "completed");
});


test("explicit abandonment of an invalidated stopped run releases occupancy but retains unknown evidence", async () => {
  const sub = await subscription();
  const execution = await start([sub.id]);
  await assert.rejects(paidRequest(request(), async () => { throw new Error("unknown"); }, receiptOptions(execution)));
  const receiptId = (await readRun(execution.runId)).current_receipt_id;
  await sql.begin((tx) => setRunState(tx, execution, "stopped", "operator"));
  await sql`UPDATE sources SET execution_version = execution_version + 1 WHERE id = ${sub.sourceId}`;
  await sql.begin((tx) => abandonRun(tx, execution, "explicit abandonment"));
  assert.equal((await readRun(execution.runId)).current_receipt_id, receiptId);
  assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id = ${sub.id}`)[0]!.active_run_id, null);
  await assert.rejects(sql.begin((tx) => resumeRun(tx, execution)), StaleOperationError);
});
