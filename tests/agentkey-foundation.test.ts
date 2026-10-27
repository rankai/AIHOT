import { readFileSync } from "node:fs";
import { queueOperationStep } from "@aihot/backend/providers/operations/queue";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { releaseOperationReceipt, recoverOperations } from "@aihot/backend/providers/operations/recovery";
import { ensureQueue, getBoss, stopBoss, QUEUES } from "@aihot/backend/jobs/queue";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { assertConfiguredTestDatabase, tag } from "./setup.ts";
import { closeDb, sql } from "@aihot/backend/db";
import { agentKeyConfig, AGENTKEY_MAX_RESPONSE_BYTES } from "@aihot/backend/providers/agentkey/config";
import { agentKeyTransport } from "@aihot/backend/providers/agentkey/transport";
import { parseLosslessJson } from "@aihot/backend/providers/agentkey/response";
import { executeDouyinSearch, parseDouyinSearch, douyinSearchRoute, douyinSearchInput, AgentKeyPayloadError } from "@aihot/backend/providers/agentkey/douyin-search";
import { createRun, receiptOptions, requireExecution, StaleOperationError, type Execution } from "@aihot/backend/providers/operations/store";
import { BudgetExceededError, paidRequest, ProviderRejectedError, StaleReceiptAttemptError } from "@aihot/backend/providers/receipts";

const actor = `test-agentkey-${tag()}`;
const fakeKey = "test-agentkey-foundation-fake-key";
const envFor = (url: string): NodeJS.ProcessEnv => ({ NODE_ENV: "test", AIHOT_ENVIRONMENT: "test", AGENTKEY_CALLS_ENABLED: "true", AGENTKEY_API_KEY: fakeKey, AGENTKEY_MCP_URL: url });
const envelope = (itemList: unknown[] = [], cursor = 12, hasMore = false) => ({ provider: "TikHub", category: "social/douyin", credits_charged: 0.2, took_ms: 12, request_id: "test-agentkey-request",
  data: { code: 200, data: { code: 0, msg: "success", data: { itemList, cursor, hasMore } } } });
const douyinItem = (overrides: Record<string, unknown> = {}) => ({ AwemeInfo: {
  AwemeId: "7460000000000000001", Desc: "测试作品说明", CreateTime: "1729400000000",
  Author: { Uid: "1234567890123456789", SecUid: "test-sec-uid", Nickname: "测试作者" },
  Video: { ItemID: "7460000000000000001", Title: "测试作品说明", CreateTime: "1729400000", Cover: { UrlList: ["https://p3.douyinpic.com/test.jpeg"] } },
  ...overrides,
} });
const item = douyinItem();

type ResponseSpec = { result?: unknown; error?: unknown; status?: number; headers?: Record<string,string>; raw?: string; sse?: boolean; truncated?: boolean; redirect?: string };
async function mcpStub(answer: () => ResponseSpec) {
  const requests: { method: string; authorization: string | undefined; body: Record<string, any> }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (req.method === "GET") { res.writeHead(405).end(); return; }
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      requests.push({ method: req.method!, authorization: req.headers.authorization, body });
      if (body.method === "notifications/initialized" || body.method === "notifications/cancelled") { res.writeHead(202).end(); return; }
      let spec: ResponseSpec;
      if (body.method === "initialize") spec = { result: { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "test-mcp", version: "1" } } };
      else spec = answer();
      const payload = spec.raw?.replace("$REQUEST_ID", JSON.stringify(body.id)) ?? JSON.stringify({ jsonrpc: "2.0", id: body.id, ...(spec.error ? { error: spec.error } : { result: spec.result }) });
      res.writeHead(spec.status ?? 200, { "content-type": spec.sse ? "text/event-stream" : "application/json", ...spec.headers, ...(spec.redirect ? { location: spec.redirect } : {}) });
      if (spec.truncated) { res.write(payload); setImmediate(() => res.destroy()); }
      else res.end(spec.sse ? `event: message\ndata: ${payload}\n\n` : payload);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/mcp`;
  return { url, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

let savedBudget: { per_minute: number; per_hour: number; per_day: number } | undefined;
let budgetConfigured = false;
before(async () => {
  const [db] = await sql`SELECT current_database() AS name, inet_server_port() AS port`;
  assertConfiguredTestDatabase(db.name, db.port);
  [savedBudget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='agentkey.query'`;
  await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES('agentkey.query',1000,1000,1000)
    ON CONFLICT(service) DO UPDATE SET per_minute=1000,per_hour=1000,per_day=1000`;
  budgetConfigured = true;
});
after(async () => {
  if (budgetConfigured) {
    if (savedBudget) await sql`UPDATE budgets SET per_minute=${savedBudget.per_minute},per_hour=${savedBudget.per_hour},per_day=${savedBudget.per_day} WHERE service='agentkey.query'`;
    else await sql`DELETE FROM budgets WHERE service='agentkey.query'`;
  }
  await sql`UPDATE operation_runs SET status='stopped',next_attempt_at=NULL WHERE actor=${actor} AND status IN ('active','waiting','needs_review')`;
  const [queue] = await sql`SELECT to_regclass('pgboss.job') AS name`;
  if (queue.name) {
    const jobs = await sql`SELECT id FROM pgboss.job WHERE name=${QUEUES.operation} AND data->>'runId' IN (SELECT id::text FROM operation_runs WHERE actor=${actor}) AND state IN ('created','retry','active')`;
    for (const job of jobs) await (await getBoss()).cancel(QUEUES.operation, job.id);
  }
  await stopBoss();
  await closeDb();
});

async function runFor(input: Record<string, unknown> = { keyword: "测试" }): Promise<Execution> {
  const run = await sql.begin((tx) => createRun(tx, { actor, commandKey: tag(), provider: "agentkey",
    operationKey: douyinSearchRoute.operationKey, contractVersion: 1, input, stepKey: douyinSearchRoute.stepKey }));
  return { runId: run.id, stepVersion: run.step_version, generation: run.generation };
}

test("configuration rejects disabled/missing credentials and non-allowlisted URLs before any fetch", async () => {
  const server = await mcpStub(() => ({ result: { content: [] } }));
  try {
    const good = envFor(server.url);
    for (const env of [{ ...good, AGENTKEY_CALLS_ENABLED: undefined }, { ...good, AGENTKEY_API_KEY: "" },
      ...["https://example.com/v1/mcp", "https://api.agentkey.app/v1/mcp?x=1", "https://u:p@api.agentkey.app/v1/mcp", "https://api.agentkey.app/v1/mcp#x", "https://api.agentkey.app/v1/mcp/", "http://192.0.2.1/v1/mcp"].map((url) => ({ ...good, AGENTKEY_MCP_URL: url })),
      { ...good, NODE_ENV: "production" }, { ...good, NODE_ENV: "development" }, { ...good, AIHOT_ENVIRONMENT: "production" }]) {
      assert.throws(() => agentKeyTransport({ env }), /disabled|key|endpoint/);
    }
    assert.equal(server.requests.length, 0);
    assert.equal(agentKeyConfig({ ...good, AGENTKEY_MCP_URL: undefined }).url.href, "https://api.agentkey.app/v1/mcp");
    assert.throws(() => douyinSearchInput.parse({ keyword: "test", sort: "new" }));
    assert.throws(() => douyinSearchInput.parse({ keyword: "test", cursor: -1 }));
  } finally { await server.close(); }
});

test("real SDK sends Bearer, fixed execute_tool and exact parameters; results and summary consume the receipt", async () => {
  const server = await mcpStub(() => ({ result: { content: [], structuredContent: envelope([item]) } }));
  try {
    const execution = await runFor();
    const result = await executeDouyinSearch(execution, { env: envFor(server.url) });
    const calls = server.requests.filter((request) => request.body.method === "tools/call");
    assert.equal(calls.length, 1);
    assert.ok(server.requests.every((request) => request.authorization === `Bearer ${fakeKey}`));
    assert.deepEqual(calls[0].body.params, { name: "execute_tool", arguments: { name: douyinSearchRoute.tool,
      params: { keyword: "测试", cursor: 0 } } });
    assert.equal(result.candidates[0].data.aweme_id, item.AwemeInfo.AwemeId);
    assert.deepEqual(result.candidates[0].data.author, { uid: item.AwemeInfo.Author.Uid, sec_uid: item.AwemeInfo.Author.SecUid, name: item.AwemeInfo.Author.Nickname });
    assert.equal(result.candidates[0].data.create_time, 1729400000);
    assert.deepEqual(result.candidates[0].data.missingFields, []);
    const results = await sql`SELECT kind,data,receipt_id FROM operation_results WHERE run_id=${execution.runId} ORDER BY id`;
    assert.deepEqual(results.map((row) => row.kind), ["query_summary", "douyin_work"]);
    assert.ok(results.every((row) => row.receipt_id === result.receiptId));
    assert.equal(results[0].data.stopReason, "single-request");
    const [receipt] = await sql`SELECT model,status,usage,cost,request FROM receipts WHERE id=${result.receiptId}`;
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.model,douyinSearchRoute.tool);
    assert.equal((await sql`SELECT model FROM receipt_attempts WHERE receipt_id=${result.receiptId} AND attempt=1`)[0].model,douyinSearchRoute.tool);
    assert.equal(receipt.usage.chargedCredits, 0.2);
    assert.equal(receipt.cost, null, "credits do not establish a monetary cost");
    assert.ok(!JSON.stringify(receipt).includes(fakeKey));
    assert.equal((await sql`SELECT status,current_receipt_id FROM operation_runs WHERE id=${execution.runId}`)[0].status, "completed");
  } finally { await server.close(); }
});

test("text fallback and SSE preserve integer literals; an empty successful page still writes count zero", async () => {
  for (const sse of [false, true]) {
    const big = "9223372036854775807123456789";
    const e = envelope([douyinItem({ AwemeId: "BIG_WORK", Author: { Uid: "BIG_AUTHOR", SecUid: "test-sec" }, Video: { ItemID: "BIG_WORK" } })]);
    const content = JSON.stringify(e).replaceAll('"BIG_WORK"', big).replace('"BIG_AUTHOR"', big);
    const server = await mcpStub(() => ({ sse, result: { content: [{ type: "text", text: content }] } }));
    try {
      const result = await executeDouyinSearch(await runFor(), { env: envFor(server.url) });
      assert.equal(result.candidates[0].data.aweme_id, big);
      assert.deepEqual(result.candidates[0].data.author, {uid:big,sec_uid:"test-sec"});
    } finally { await server.close(); }
  }
  const server = await mcpStub(() => ({ result: { content: [], structuredContent: envelope() } }));
  try {
    const execution = await runFor();
    const result = await executeDouyinSearch(execution, { env: envFor(server.url) });
    const rows = await sql`SELECT kind,data,receipt_id FROM operation_results WHERE run_id=${execution.runId}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "query_summary");
    assert.equal(rows[0].data.count, 0);
    assert.equal(rows[0].receipt_id, result.receiptId);
  } finally { await server.close(); }
});

test("structured numeric literals retain original identity, while already rounded objects block import", async () => {
  const big = "9223372036854775807123456789";
  const e = envelope([douyinItem({ AwemeId: "BIG", Video: { ItemID: "BIG" } })]);
  const rawEnvelope = JSON.stringify(e).replaceAll('"BIG"', big);
  const server = await mcpStub(() => ({ raw: `{"jsonrpc":"2.0","id":$REQUEST_ID,"result":{"content":[],"structuredContent":${rawEnvelope}}}` }));
  try {
    const result = await executeDouyinSearch(await runFor(), { env: envFor(server.url) });
    assert.equal(result.candidates[0].data.aweme_id, big);
    const [saved] = await sql`SELECT response FROM receipts WHERE id=${result.receiptId}`;
    assert.equal(saved.response.envelope.data.data.data.itemList[0].AwemeInfo.AwemeId, big);
  } finally { await server.close(); }
  assert.equal((parseLosslessJson(`{"id":${big}}`) as { id: string }).id, big);
  const parsed = parseDouyinSearch({ envelope: envelope([douyinItem({ AwemeId: Number(big), Author: {}, Video: {} })]) }, { keyword: "x" });
  assert.ok(parsed.candidates[0].data.importBlockers.includes("lossless_work_id_required"));
  assert.equal(parsed.candidates[0].data.importBlockers.includes("lossless_author_id_required"),false);
  assert.equal(parsed.candidates[0].data.aweme_id, undefined);
});

test("complete tool, HTTP and JSON-RPC errors retain bounded redacted evidence on failed receipt and attempt", async () => {
  const errorEnvelope = { ...envelope(), disabled: true, error: "test-disabled", api_key: fakeKey, message: `Bearer ${fakeKey}` };
  for (const spec of [
    { result: { isError: true, content: [], structuredContent: errorEnvelope } },
    { status: 402, raw: JSON.stringify(errorEnvelope) },
    { error: { code: -32602, message: "test-invalid", data: errorEnvelope } },
  ]) {
    const server = await mcpStub(() => spec);
    try {
      const execution = await runFor();
      await assert.rejects(executeDouyinSearch(execution, { env: envFor(server.url) }), (error: unknown) => {
        assert.ok(error instanceof ProviderRejectedError);
        assert.equal(error.retryable, false);
        assert.equal(error.evidence?.requestId, "test-agentkey-request");
        assert.equal(error.evidence?.usage?.chargedCredits, 0.2);
        assert.ok(!JSON.stringify(error.evidence).includes(fakeKey));
        return true;
      });
      const [row] = await sql`SELECT r.status,r.response,r.request_id,r.usage,r.cost,
        a.status AS attempt_status,a.response AS attempt_response,a.request_id AS attempt_request_id,a.usage AS attempt_usage,a.cost AS attempt_cost
        FROM receipts r JOIN receipt_attempts a ON a.receipt_id=r.id JOIN operation_runs o ON o.current_receipt_id=r.id WHERE o.id=${execution.runId}`;
      assert.equal(row.status, "failed");
      assert.equal(row.attempt_status, "failed");
      assert.deepEqual(row.response, row.attempt_response);
      assert.equal(row.request_id, "test-agentkey-request");
      assert.equal(row.attempt_request_id, row.request_id);
      assert.deepEqual(row.usage, row.attempt_usage);
      assert.equal(row.usage.chargedCredits, 0.2);
      assert.equal(row.cost, null);
      assert.equal(row.attempt_cost, null);
      assert.ok(!JSON.stringify(row).includes(fakeKey));
    } finally { await server.close(); }
  }
});

test("a complete HTTP 429 retains evidence and uses the existing bounded Retry-After flow", async () => {
  const rejected = { ...envelope(), error: "rate_limited", message: "Synthetic throttle" };
  const server = await mcpStub(() => ({ status: 429, headers: { "retry-after": "7" }, raw: JSON.stringify(rejected) }));
  try {
    await withDispatcherEnv(server.url, async () => {
      const execution = await runFor();
      const result = await executeQueued(execution);
      assert.match(String(result.error), /rate limited/);
      const [run] = await sql`SELECT status,retry_count,next_attempt_at,current_receipt_id FROM operation_runs WHERE id=${execution.runId}`;
      assert.equal(run.status, "waiting");
      assert.equal(run.retry_count, 1);
      assert.ok(run.next_attempt_at.getTime() > Date.now() + 5_000);
      assert.ok(run.current_receipt_id);
      const [receipt] = await sql`SELECT status,response FROM receipts WHERE id=${run.current_receipt_id}`;
      assert.equal(receipt.status, "failed");
      assert.equal(receipt.response, null);
      const [attempt] = await sql`SELECT status,response FROM receipt_attempts WHERE receipt_id=${run.current_receipt_id} AND attempt=1`;
      assert.equal(attempt.status, "failed");
      assert.equal(attempt.response.httpStatus, 429);
      assert.equal(attempt.response.retryAfter, "7");
      assert.equal(attempt.response.envelope.error, "rate_limited");
      assert.equal(server.requests.filter((request) => request.body.method === "tools/call").length, 1);
    });
  } finally { await server.close(); }
});

test("ProviderRejectedError remains compatible and preserves known monetary cost in both existing tables", async () => {
  const subject = `agentkey-rejection-contract-${tag()}`;
  assert.equal(new ProviderRejectedError("legacy", 400, false).evidence, undefined);
  const evidence = { response: { error: "test-complete-rejection" }, requestId: "test-rejection-id", usage: { chargedCredits: 0 }, cost: { amount: 0.125, currency: "USD", basis: "actual" as const } };
  await assert.rejects(paidRequest({ service: "agentkey.query", purpose: "test", subject, identity: subject }, async () => {
    throw new ProviderRejectedError("test-complete-rejection", 429, false, evidence);
  }), ProviderRejectedError);
  const rows = await sql`SELECT r.response,r.cost,r.currency,r.cost_basis,a.response AS attempt_response,a.cost AS attempt_cost,a.currency AS attempt_currency,a.cost_basis AS attempt_cost_basis
    FROM receipts r JOIN receipt_attempts a ON a.receipt_id=r.id WHERE r.subject=${subject}`;
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].response, evidence.response);
  assert.deepEqual(rows[0].attempt_response, evidence.response);
  assert.equal(rows[0].cost, 0.125);
  assert.equal(rows[0].attempt_cost, 0.125);
  assert.equal(rows[0].currency, "USD");
  assert.equal(rows[0].attempt_currency, "USD");
  assert.equal(rows[0].attempt_cost_basis, "actual");
});

test("a complete unrecognized payload stays received and reusable; incomplete protocol becomes unknown", async () => {
  for (const spec of [
    { result: { content: [], structuredContent: { provider: "TikHub", data: { unexpected: [] } } } },
    { raw: '{"jsonrpc":"2.0",', truncated: true },
  ]) {
    const server = await mcpStub(() => spec);
    try {
      const execution = await runFor();
      await assert.rejects(executeDouyinSearch(execution, { env: envFor(server.url) }));
      const [row] = await sql`SELECT r.id,r.status,r.response,o.status AS run_status FROM receipts r JOIN operation_runs o ON o.current_receipt_id=r.id WHERE o.id=${execution.runId}`;
      if (spec.result) {
        assert.equal(row.status, "received");
        assert.equal(row.run_status, "needs_review");
        await sql`UPDATE operation_runs SET status='active' WHERE id=${execution.runId}`;
        await assert.rejects(executeDouyinSearch(execution, { env: envFor(server.url) }), AgentKeyPayloadError);
        assert.equal(server.requests.filter((r) => r.body.method === "tools/call").length, 1, "retained payload was reused");
      } else assert.equal(row.status, "unknown");
      assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results WHERE run_id=${execution.runId}`)[0].n, 0);
    } finally { await server.close(); }
  }
});

test("deterministic byte limits and redirects fail receipts without entering unknown replay", async (t) => {
  for (const spec of [
    { result: { content: [{ type: "text", text: "x".repeat(AGENTKEY_MAX_RESPONSE_BYTES + 1) }] } },
    { status: 307, redirect: "http://192.0.2.1/never-follow", raw: "{}" },
  ]) {
    await t.test(spec.status===307?"redirect is a complete rejection":"oversize is a deterministic rejection",async()=>{
    const server = await mcpStub(() => spec);
    try {
      const execution = await runFor();
      await assert.rejects(executeDouyinSearch(execution, { env: envFor(server.url) }), ProviderRejectedError);
      const [run] = await sql`SELECT status,current_receipt_id FROM operation_runs WHERE id=${execution.runId}`;
      assert.equal(run.status, "needs_review");
      const [receipt] = await sql`SELECT status,error FROM receipts WHERE id=${run.current_receipt_id}`;
      assert.equal(receipt.status, "failed");
      assert.match(receipt.error, spec.status===307?/HTTP/:/byte limit/);
      assert.equal(server.requests.filter((r) => r.body.method === "tools/call").length, 1);
    } finally { await server.close(); }
    });
  }
});

test("absent AgentKey budgets block dispatch before any call", async () => {
  let dispatched = false;
  await assert.rejects(paidRequest({ service: "agentkey.unconfigured-test", purpose: "test", identity: tag() }, async () => {
    dispatched = true; return { response: {} };
  }), BudgetExceededError);
  assert.equal(dispatched, false);
});

test("AgentKey budget migration adds only zero seeds and preserves configured budgets", async () => {
  const rollback = new Error("rollback seed probe");
  await assert.rejects(sql.begin(async (tx) => {
    const before = await tx`SELECT * FROM schema_migrations ORDER BY name`;
    const other = await tx`SELECT * FROM budgets WHERE service NOT IN ('agentkey.collect','agentkey.query') ORDER BY service`;
    await tx`DELETE FROM budgets WHERE service IN ('agentkey.collect','agentkey.query')`;
    const migration = readFileSync(new URL("../database/migrations/0078_agentkey_budgets.sql", import.meta.url), "utf8");
    await tx.unsafe(migration);
    assert.deepEqual(Array.from(await tx`SELECT service,per_minute,per_hour,per_day FROM budgets WHERE service IN ('agentkey.collect','agentkey.query') ORDER BY service`), [
      { service: "agentkey.collect", per_minute: 0, per_hour: 0, per_day: 0 }, { service: "agentkey.query", per_minute: 0, per_hour: 0, per_day: 0 },
    ]);
    await tx`UPDATE budgets SET per_day=7 WHERE service='agentkey.query'`;
    await tx.unsafe(migration);
    assert.equal((await tx`SELECT per_day FROM budgets WHERE service='agentkey.query'`)[0].per_day, 7);
    assert.deepEqual(await tx`SELECT * FROM schema_migrations ORDER BY name`, before);
    assert.deepEqual(await tx`SELECT * FROM budgets WHERE service NOT IN ('agentkey.collect','agentkey.query') ORDER BY service`, other);
    throw rollback;
  }), (error) => error === rollback);
});

test("zero budget prevents dispatch; approved request saves estimates before sending and merges actual zero", async () => {
  const subject = tag(), req = { service: "agentkey.query", purpose: "estimate-test", subject, identity: subject, estimatedUsage: { estimatedCredits: 0.2 } };
  let hits = 0;
  const call = async () => {
    hits++;
    const [row] = await sql`SELECT r.usage,a.usage AS attempt_usage FROM receipts r JOIN receipt_attempts a ON a.receipt_id=r.id AND a.attempt=r.attempts WHERE r.subject=${subject}`;
    assert.deepEqual(row.usage, { estimatedCredits: 0.2 }); assert.deepEqual(row.attempt_usage, row.usage);
    return { response: { ok: true }, usage: { chargedCredits: 0 } };
  };
  await sql`UPDATE budgets SET per_minute=0 WHERE service='agentkey.query'`;
  try { await assert.rejects(paidRequest(req, call), BudgetExceededError); assert.equal(hits, 0); }
  finally { await sql`UPDATE budgets SET per_minute=1000 WHERE service='agentkey.query'`; }
  const result = await paidRequest(req, call);
  await paidRequest(req, call);
  assert.equal(hits, 1);
  const [row] = await sql`SELECT usage,cost FROM receipts WHERE id=${result.receiptId}`;
  assert.deepEqual(row.usage, { estimatedCredits: 0.2, chargedCredits: 0 }); assert.equal(row.cost, null);
});

test("unknown estimates survive and superseded late evidence belongs only to its original attempt", async () => {
  for (const rejected of [false, true]) {
    const subject = tag(), req = { service: "agentkey.query", purpose: "late-estimate", subject, identity: subject, estimatedUsage: { estimatedCredits: 0.2 } };
    let resolve!: (value: any) => void, reject!: (value: unknown) => void, entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    const response = new Promise<any>((r, j) => { resolve = r; reject = j; });
    const old = paidRequest(req, async () => { entered(); return response; });
    const oldAssertion = assert.rejects(old, rejected ? ProviderRejectedError : StaleReceiptAttemptError);
    await started;
    const [head] = await sql`SELECT id FROM receipts WHERE subject=${subject}`;
    await sql`UPDATE receipts SET status='unknown' WHERE id=${head.id}`;
    await sql`UPDATE receipt_attempts SET status='unknown' WHERE receipt_id=${head.id}`;
    assert.deepEqual((await sql`SELECT usage FROM receipts WHERE id=${head.id}`)[0].usage, { estimatedCredits: 0.2 });
    await sql`UPDATE receipts SET status='failed' WHERE id=${head.id}`;
    await sql`UPDATE receipt_attempts SET status='failed' WHERE receipt_id=${head.id}`;
    await paidRequest({ ...req, estimatedUsage: { estimatedCredits: 0.3 } }, async () => {
      const [pending] = await sql`SELECT status,usage,response,request_id,cost,received_at FROM receipts WHERE id=${head.id}`;
      assert.equal(pending.status, "pending"); assert.deepEqual(pending.usage, { estimatedCredits: 0.3 });
      assert.equal(pending.response, null); assert.equal(pending.request_id, null); assert.equal(pending.cost, null); assert.equal(pending.received_at, null);
      return { response: { current: true }, usage: { chargedCredits: 0.4 } };
    });
    const evidence = { response: { old: true }, usage: { chargedCredits: 0.1 }, requestId: "old-attempt" };
    if (rejected) reject(new ProviderRejectedError("late rejection", 400, false, evidence)); else resolve(evidence);
    await oldAssertion;
    const [current] = await sql`SELECT attempts,response,usage FROM receipts WHERE id=${head.id}`;
    assert.equal(current.attempts, 2); assert.deepEqual(current.response, { current: true });
    assert.deepEqual(current.usage, { estimatedCredits: 0.3, chargedCredits: 0.4 });
    const attempts = await sql`SELECT attempt,usage,response FROM receipt_attempts WHERE receipt_id=${head.id} ORDER BY attempt`;
    assert.deepEqual(attempts[0].usage, { estimatedCredits: 0.2, chargedCredits: 0.1 });
    assert.deepEqual(attempts[0].response, evidence.response);
    assert.deepEqual(attempts[1].usage, current.usage);
  }
});

async function withDispatcherEnv(url: string, action: () => Promise<void>) {
  const values = { ...envFor(url), COLLECT_ENABLED: "false" };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { await action(); } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
const runRow = async (id: number) => (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0];
async function executeQueued(run: Execution) {
  await sql.begin((tx) => queueOperationStep(tx, run.runId));
  const queued = await runRow(run.runId);
  assert.ok(queued.job_id);
  return executeOperationStep(run.runId, run.stepVersion, queued.job_id);
}

test("dispatcher executes only the fixed profile; query ignores collect valve and collection obeys it", async () => {
  const server = await mcpStub(() => ({ result: { content: [], structuredContent: envelope() } }));
  try { await withDispatcherEnv(server.url, async () => {
    const query = await runFor();
    await executeQueued(query);
    assert.equal((await runRow(query.runId)).status, "completed");
    for (const patch of [sql`operation_key='agentkey.other'`, sql`step_key='agentkey.other.query'`, sql`contract_version=2`]) {
      const run = await runFor(); await sql`UPDATE operation_runs SET ${patch} WHERE id=${run.runId}`;
      await executeQueued(run);
      assert.equal((await runRow(run.runId)).status, "needs_review");
    }
    const collect = await runFor({ keyword: "test", mode: "collection" });
    await executeQueued(collect);
    assert.equal((await runRow(collect.runId)).status, "waiting");
    process.env.AGENTKEY_CALLS_ENABLED = "false";
    const disabled = await runFor(); await executeQueued(disabled);
    assert.equal((await runRow(disabled.runId)).status, "waiting");
    assert.equal(server.requests.filter((r) => r.body.method === "tools/call").length, 1);
  }); } finally { await server.close(); }
});

test("parser recovery consumes received evidence with valves off and stale generation cannot commit", async () => {
  const server = await mcpStub(() => ({ result: { content: [], structuredContent: { provider: "TikHub", data: {} } } }));
  try { await withDispatcherEnv(server.url, async () => {
    const run = await runFor();
    await executeQueued(run);
    const held = await runRow(run.runId);
    assert.equal(held.status, "needs_review");
    const [receipt] = await sql`SELECT status,response FROM receipts WHERE id=${held.current_receipt_id}`;
    assert.equal(receipt.status, "received");
    // Simulate repaired parser-compatible evidence; no new paid identity/attempt is created.
    await sql`UPDATE receipts SET response=${sql.json({ ...receipt.response, envelope: envelope() })} WHERE id=${held.current_receipt_id}`;
    await sql`UPDATE operation_runs SET status='active' WHERE id=${run.runId}`;
    process.env.AGENTKEY_CALLS_ENABLED = "false";
    await assert.rejects(executeDouyinSearch(run), StaleOperationError);
    assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results WHERE run_id=${run.runId}`)[0].n, 0);
    await executeQueued(run);
    assert.equal((await runRow(run.runId)).status, "completed");
    const [summary] = await sql`SELECT data,receipt_id FROM operation_results WHERE run_id=${run.runId}`;
    assert.equal(summary.data.count, 0); assert.equal(summary.receipt_id, held.current_receipt_id);
    assert.equal(server.requests.filter((r) => r.body.method === "tools/call").length, 1);
    assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${held.current_receipt_id}`)[0].attempts, 1);
  }); } finally { await server.close(); }
});

test("recovery uses exact profiles, permits one timed unknown release and queues local evidence while disabled", async () => {
  await ensureQueue(QUEUES.operation);
  const cursor = (await sql`SELECT value FROM settings WHERE key='operations.recovery-cursor'`)[0]?.value;
  const recoverFrom = async (id: number) => {
    await sql`INSERT INTO settings(key,value,updated_by) VALUES('operations.recovery-cursor',${sql.json(id - 1)},${actor}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    return recoverOperations();
  };
  try { await withDispatcherEnv("http://127.0.0.1:10000/v1/mcp", async () => {
    const run = await runFor();
    const req = { service: "agentkey.query", purpose: douyinSearchRoute.operationKey, model:douyinSearchRoute.tool, identity: tag(), estimatedUsage: { estimatedCredits: 0.2 } };
    const unknown = async () => { throw new Error("synthetic no complete response"); };
    await assert.rejects(paidRequest(req, unknown, receiptOptions(run)), /synthetic/);
    const receiptId = (await runRow(run.runId)).current_receipt_id;
    assert.equal((await releaseOperationReceipt(receiptId)).released, false, "not before 30 minutes");
    await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${receiptId}`;
    process.env.AGENTKEY_CALLS_ENABLED = "false";
    assert.equal((await releaseOperationReceipt(receiptId)).released, false, "disabled valve cannot release");
    process.env.AGENTKEY_CALLS_ENABLED = "true";
    assert.equal((await releaseOperationReceipt(receiptId)).released, true);
    const resumed = await runRow(run.runId);
    await assert.rejects(paidRequest(req, unknown, receiptOptions({ ...run, generation: resumed.generation })), /synthetic/);
    await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${receiptId}`;
    assert.equal((await releaseOperationReceipt(receiptId)).released, false);
    assert.equal((await runRow(run.runId)).status, "needs_review");
    assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${receiptId}`)[0].attempts, 2);
    for (const patch of [sql`operation_key='agentkey.other'`, sql`step_key='agentkey.other.query'`]) {
      const bad = await runFor();
      await assert.rejects(paidRequest({ ...req, identity: tag() }, unknown, receiptOptions(bad)), /synthetic/);
      const badReceipt = (await runRow(bad.runId)).current_receipt_id;
      await sql`UPDATE operation_runs SET ${patch} WHERE id=${bad.runId}`;
      await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${badReceipt}`;
      assert.equal((await releaseOperationReceipt(badReceipt)).released, false);
      await recoverFrom(bad.runId);
      assert.equal((await sql`SELECT status FROM receipts WHERE id=${badReceipt}`)[0].status, "unknown");
      await sql`UPDATE operation_runs SET status='stopped' WHERE id=${bad.runId}`;
    }
    const local = await runFor();
    const localParams=douyinSearchInput.parse({keyword:"测试"}),localEndpoint="http://127.0.0.1:10000/v1/mcp";
    await paidRequest({...req,subject:`operation:${local.runId}`,
      identity:{runId:local.runId,stepVersion:local.stepVersion,endpoint:localEndpoint,contractVersion:1,
        tool:douyinSearchRoute.tool,params:localParams},
      requestSummary:{tool:douyinSearchRoute.tool,endpoint:localEndpoint,params:localParams},
    },async () => ({ response: { envelope: envelope() } }), receiptOptions(local));
    process.env.AGENTKEY_CALLS_ENABLED = "false";
    await recoverFrom(local.runId);
    const queued = await runRow(local.runId); assert.ok(queued.job_id);
    await executeOperationStep(local.runId, local.stepVersion, queued.job_id);
    assert.equal((await runRow(local.runId)).status, "completed");
    const [summary] = await sql`SELECT data FROM operation_results WHERE run_id=${local.runId}`;
    assert.equal(summary.data.count, 0);
  }); } finally {
    if (cursor === undefined) await sql`DELETE FROM settings WHERE key='operations.recovery-cursor'`;
    else await sql`UPDATE settings SET value=${sql.json(cursor as never)} WHERE key='operations.recovery-cursor'`;
  }
});

test("retry replaces rejected head evidence with the new estimate while retaining the old attempt", async () => {
  const subject = tag(), req = { service: "agentkey.query", purpose: "retry-estimate", subject, identity: subject, estimatedUsage: { estimatedCredits: 0.2 } };
  const evidence = { response: { rejected: true }, requestId: "rejected-attempt", usage: { chargedCredits: 0.1 }, cost: { amount: 0.01, currency: "USD", basis: "actual" as const } };
  await assert.rejects(paidRequest(req, async () => { throw new ProviderRejectedError("complete rejection", 429, false, evidence); }), ProviderRejectedError);
  const [old] = await sql`SELECT id,usage FROM receipts WHERE subject=${subject}`;
  assert.deepEqual(old.usage, { estimatedCredits: 0.2, chargedCredits: 0.1 });
  await paidRequest({ ...req, estimatedUsage: { estimatedCredits: 0.3 } }, async () => {
    const [pending] = await sql`SELECT status,usage,response,request_id,cost,currency,cost_basis,received_at FROM receipts WHERE id=${old.id}`;
    assert.equal(pending.status, "pending"); assert.deepEqual(pending.usage, { estimatedCredits: 0.3 });
    for (const field of ["response", "request_id", "cost", "currency", "cost_basis", "received_at"]) assert.equal(pending[field], null, field);
    const [prior] = await sql`SELECT response,request_id,usage,cost FROM receipt_attempts WHERE receipt_id=${old.id} AND attempt=1`;
    assert.deepEqual(prior.response, evidence.response); assert.equal(prior.request_id, evidence.requestId);
    assert.deepEqual(prior.usage, old.usage); assert.equal(prior.cost, evidence.cost.amount);
    return { response: { accepted: true } };
  });
  const [current] = await sql`SELECT usage,cost FROM receipts WHERE id=${old.id}`;
  assert.deepEqual(current.usage, { estimatedCredits: 0.3 }); assert.equal(current.cost, null);
});

test("an in-flight response from a stale generation is retained without committing business results", async () => {
  const server = await mcpStub(() => ({ result: { content: [], structuredContent: envelope() } }));
  let sent!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => { sent = r; });
  const held = new Promise<void>((r) => { release = r; });
  try {
    const run = await runFor();
    const pending = executeDouyinSearch(run, { env: envFor(server.url), fetch: async (url, init) => {
      const response = await fetch(url, init);
      if (JSON.parse(String(init?.body ?? "{}")).method === "tools/call") { sent(); await held; }
      return response;
    } });
    const rejected = assert.rejects(pending, StaleOperationError);
    await entered;
    await sql`UPDATE operation_runs SET generation=generation+1 WHERE id=${run.runId}`;
    release(); await rejected;
    const current = await runRow(run.runId);
    assert.equal(current.generation, run.generation + 1); assert.equal(current.status, "active");
    assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results WHERE run_id=${run.runId}`)[0].n, 0);
    const [receipt] = await sql`SELECT status,attempts,usage FROM receipts WHERE id=${current.current_receipt_id}`;
    assert.equal(receipt.status, "received"); assert.equal(receipt.attempts, 1);
    assert.equal(receipt.usage.estimatedCredits, 0.2); assert.equal(receipt.usage.chargedCredits, 0.2);
    assert.equal(server.requests.filter((r) => r.body.method === "tools/call").length, 1);
  } finally { release(); await server.close(); }
});


test("dispatcher retries the same paid receipt after an unknown request is released", async () => {
  let calls = 0;
  const server = await mcpStub(() => ++calls === 1
    ? {raw: '{"jsonrpc":"2.0","id":$REQUEST_ID', truncated: true}
    : {result: {content: [], structuredContent: envelope()}});
  try { await withDispatcherEnv(server.url, async () => {
    const run = await runFor();
    await executeQueued(run);
    const held = await runRow(run.runId);
    assert.equal(held.status, "waiting");
    assert.equal((await sql`SELECT status FROM receipts WHERE id=${held.current_receipt_id}`)[0].status, "unknown");
    await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${held.current_receipt_id}`;
    assert.equal((await releaseOperationReceipt(held.current_receipt_id)).released, true);
    const resumed = await runRow(run.runId);
    await executeOperationStep(run.runId, resumed.step_version, resumed.job_id);
    assert.equal((await runRow(run.runId)).status, "completed");
    const [receipt] = await sql`SELECT status,attempts FROM receipts WHERE id=${held.current_receipt_id}`;
    assert.deepEqual(receipt, {status: "completed", attempts: 2});
    assert.equal(calls, 2);
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts WHERE subject=${`operation:${run.runId}`}`)[0].n, 1);
  }); } finally { await server.close(); }
});


test("APP account query uses the fixed tool and persists linked importable receipt evidence",async()=>{
  const {douyinAccountPostsRoute}=await import("@aihot/backend/providers/agentkey/douyin-contract");
  const {importDouyinResult}=await import("@aihot/backend/providers/redfox/import-douyin");
  const server=await mcpStub(()=>({result:{content:[],structuredContent:{provider:"TikHub",credits_charged:0.2,data:{code:200,data:{status_code:0,uid:"7000123",sec_uid:"synthetic-account",aweme_list:[{aweme_id:"7000123456789",desc:"synthetic description",create_time:1729400000,author:{uid:"7000123",sec_uid:"synthetic-account",nickname:"Synthetic"}}],has_more:0}}}}}));
  try{
    const run=await sql.begin(tx=>createRun(tx,{actor,commandKey:tag(),provider:"agentkey",operationKey:douyinAccountPostsRoute.operationKey,stepKey:douyinAccountPostsRoute.stepKey,contractVersion:1,input:{mode:"query",operationId:"QEQLCKD6",parameters:{sec_user_id:"synthetic-account"}}}));
    await executeDouyinSearch({runId:run.id,stepVersion:run.step_version,generation:run.generation},{env:envFor(server.url)});
    const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='douyin_work'`;
    assert.ok(result.data.querySummaryId);
    assert.equal(server.requests.find(r=>r.body.method==="tools/call")?.body.params.arguments.name,douyinAccountPostsRoute.tool);
    const sourceId=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext) VALUES (${sourceId},'Selected APP owner','rss','isolated',false)`;
    await sql`UPDATE operation_results SET data=data||'{"importBlockers":["lossless_author_id_required"]}'::jsonb WHERE id=${result.id}`;
    const imported=await importDouyinResult(result.id,{sourceId,reason:"Synthetic APP query test"},actor,tag());
    assert.ok(imported?.articleId);
    const [source]=await sql`SELECT participation_mode,site_fulltext FROM sources WHERE id=${imported!.sourceId}`;
    assert.equal(source.participation_mode,"isolated");assert.equal(source.site_fulltext,false);
  }finally{await server.close();}
});

test("standalone detail query and unavailable response use the exact contract with no fallback purchase",async()=>{
  const {createAgentKeyQuery}=await import("@aihot/backend/providers/agentkey/queries");
  const {douyinDetailRoute}=await import("@aihot/backend/providers/agentkey/douyin-contract");
  for(const available of [true,false]){
    const server=await mcpStub(()=>({result:{content:[],structuredContent:{provider:"TikHub",data:{code:200,data:available?{aweme_detail:{aweme_id:"76543210001",desc:"synthetic detail",author:{uid:"7654321",sec_uid:"synthetic-detail"}}}:{filter_list:[{reason:8}]}}}}}));
    try{
      const run=await createAgentKeyQuery({provider:"agentkey",operationId:"FK67XDVQ",parameters:{aweme_id:"76543210001"}},actor,tag());
      const execution={runId:run.id,stepVersion:run.step_version,generation:run.generation};
      if(available)await executeDouyinSearch(execution,{env:envFor(server.url)});
      else await assert.rejects(executeDouyinSearch(execution,{env:envFor(server.url)}),AgentKeyPayloadError);
      const calls=server.requests.filter(r=>r.body.method==="tools/call");assert.equal(calls.length,1);assert.equal(calls[0]!.body.params.arguments.name,douyinDetailRoute.tool);
      const [state]=await sql`SELECT status FROM operation_runs WHERE id=${run.id}`;assert.equal(state.status,available?"completed":"needs_review");
      const [receipt]=await sql`SELECT status FROM receipts WHERE subject=${`operation:${run.id}`}`;assert.equal(receipt.status,available?"completed":"received");
    }finally{await server.close();}
  }
  for(const parameters of [{videoId:"76543210001"},{aweme_id:76543210001},{aweme_id:"76543210001",fallback:true}])await assert.rejects(createAgentKeyQuery({provider:"agentkey",operationId:"FK67XDVQ",parameters},actor,tag()));
});

test("research queries freeze parameters, retain receipts across interruption and bind accounts only explicitly",async()=>{
  const {createAgentKeyQuery}=await import("@aihot/backend/providers/agentkey/queries");
  const {agentKeyOperation}=await import("@aihot/backend/providers/agentkey/douyin-contract");
  const {importDouyinResult}=await import("@aihot/backend/providers/redfox/import-douyin");
  const suffix=String(Date.now()),uid=`96${suffix}`,sec=`synthetic-research-${suffix}`;
  for(const operationId of ["douyin.suggest","P5CHB3BZ"]){
    const account=operationId==="P5CHB3BZ",body=account?{status_code:0,user_list:[{dynamic_patch:{raw_data:JSON.stringify({user_info:{uid,sec_uid:sec,nickname:"Synthetic research",follower_count:12},room_id:9007199254740992}),schema:"https://example.invalid/never-fetch"}}],has_more:1,cursor:20}:{status_code:0,sug_list:[{content:"synthetic suggestion"}]};
    const server=await mcpStub(()=>({result:{content:[],structuredContent:{provider:"TikHub",credits_charged:0.2,data:{code:200,data:body}}}}));
    try{
      const run=await createAgentKeyQuery({provider:"agentkey",operationId,parameters:{keyword:" synthetic "}},actor,tag());
      const route=agentKeyOperation(operationId)!.route,params=run.input.parameters as Record<string,unknown>,transport=agentKeyTransport({env:envFor(server.url)});
      const expected=account?{keyword:"synthetic",cursor:0,douyin_user_fans:"",douyin_user_type:"",search_id:""}:{keyword:"synthetic"};
      assert.deepEqual(params,expected);
      const execution={runId:run.id,stepVersion:run.step_version,generation:run.generation};
      // A completed raw receipt survives process interruption before business consumption.
      await paidRequest({service:"agentkey.query",purpose:route.operationKey,model:route.tool,subject:`operation:${run.id}`,
        identity:{runId:run.id,stepVersion:run.step_version,endpoint:transport.endpoint,contractVersion:1,tool:route.tool,params},
        requestSummary:{tool:route.tool,endpoint:transport.endpoint,params}},()=>transport.execute(params,route),receiptOptions(execution));
      await executeDouyinSearch(execution,{env:{...envFor(server.url),AGENTKEY_CALLS_ENABLED:"false",COLLECT_ENABLED:"false"}});
      const calls=server.requests.filter(r=>r.body.method==="tools/call");assert.equal(calls.length,1);assert.equal(calls[0]!.body.params.arguments.name,route.tool);assert.deepEqual(calls[0]!.body.params.arguments.params,expected);
      const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`;assert.equal(rows.length,2);
      const summary=rows.find(r=>r.kind==="query_summary")!,result=rows.find(r=>r.kind!=="query_summary")!;
      assert.equal(summary.data.count,1);assert.equal(summary.data.operationId,operationId);
      for(const field of ["returnedPage","selectedCount","unprocessedDueToLimit","nextParameters"])assert.equal(Object.hasOwn(summary.data,field),false,`query summary must omit collection field ${field}`);
      assert.equal(summary.data.stopReason,"single-request");assert.equal(result.data.querySummaryId,summary.id);assert.equal(result.source_id,null);assert.equal(result.article_id,null);
      assert.equal((await sql`SELECT status FROM operation_runs WHERE id=${run.id}`)[0].status,"completed");
      assert.equal((await sql`SELECT status FROM receipts WHERE id=${result.receipt_id}`)[0].status,"completed");
      if(account){
        assert.equal((await sql`SELECT source_id FROM source_account_bindings WHERE platform='douyin' AND id_kind='uid' AND id_value=${uid}`).length,0);
        const key=tag(),bound=await importDouyinResult(result.id,{reason:"Explicit synthetic account bind"},actor,key);assert.ok(bound?.sourceId);assert.equal(bound.articleId,null);
        const [source]=await sql`SELECT kind,participation_mode,site_fulltext,syndicate_fulltext FROM sources WHERE id=${bound.sourceId}`;
        assert.deepEqual(source,{kind:"external",participation_mode:"isolated",site_fulltext:false,syndicate_fulltext:false});
        assert.equal((await sql`SELECT id FROM articles WHERE source_id=${bound.sourceId}`).length,0);
        assert.deepEqual(await importDouyinResult(result.id,{reason:"Repeat synthetic bind"},actor,key),bound);
        await assert.rejects(importDouyinResult(result.id,{reason:"Changed intent",sourceId:bound.sourceId},actor,key),/key reused/);
        await assert.rejects(importDouyinResult(result.id,{reason:"No invented account IDs",supplement:{uid:"111",evidence:"synthetic"}},actor,tag()),/received stable IDs/);
        await sql`UPDATE operation_results SET data=jsonb_set(data,'{identity,uid}','"111"') WHERE id=${result.id}`;
        await assert.rejects(importDouyinResult(result.id,{reason:"Forged account"},actor,tag()),/differs/);
      }else{
        await assert.rejects(importDouyinResult(result.id,{reason:"Suggestion is not an account"},actor,tag()),/importable/);
        await sql`UPDATE operation_results SET kind='douyin_account' WHERE id=${result.id}`;
        await assert.rejects(importDouyinResult(result.id,{reason:"Forged suggestion kind"},actor,tag()),/kind/);
      }
    }finally{await server.close();}
  }
});

test("research queries preserve valid empty summaries and reject malformed account patches without repurchase",async()=>{
  const {createAgentKeyQuery}=await import("@aihot/backend/providers/agentkey/queries");
  const {importDouyinResult}=await import("@aihot/backend/providers/redfox/import-douyin");
  for(const spec of [
    {operationId:"douyin.suggest",body:{status_code:0,sug_list:[]},valid:true},
    {operationId:"P5CHB3BZ",body:{status_code:0,user_list:[]},valid:true},
    {operationId:"P5CHB3BZ",body:{status_code:0,user_list:[{user_info:{nickname:"No stable ID"}}]},valid:true},
    {operationId:"P5CHB3BZ",body:{status_code:0,user_list:[{dynamic_patch:{raw_data:"malformed"}}]},valid:false},
  ]){
    const server=await mcpStub(()=>({result:{content:[],structuredContent:{provider:"TikHub",data:{code:200,data:spec.body}}}}));
    try{
      const run=await createAgentKeyQuery({provider:"agentkey",operationId:spec.operationId,parameters:{keyword:"synthetic"}},actor,tag());
      const execution={runId:run.id,stepVersion:run.step_version,generation:run.generation};
      if(spec.valid)await executeDouyinSearch(execution,{env:envFor(server.url)});
      else{
        await assert.rejects(executeDouyinSearch(execution,{env:envFor(server.url)}),AgentKeyPayloadError);
        await sql`UPDATE operation_runs SET status='active' WHERE id=${run.id}`;
        await assert.rejects(executeDouyinSearch(execution,{env:{...envFor(server.url),AGENTKEY_CALLS_ENABLED:"false"}}),AgentKeyPayloadError);
      }
      assert.equal(server.requests.filter(r=>r.body.method==="tools/call").length,1);
      const [receipt]=await sql`SELECT status FROM receipts WHERE subject=${`operation:${run.id}`}`;assert.equal(receipt.status,spec.valid?"completed":"received");
      const summaries=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='query_summary'`;
      if(spec.valid){assert.equal(summaries.length,1);assert.equal(summaries[0]!.data.count,spec.body.user_list?.length??0);
        const [result]=await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND kind='douyin_account'`;
        if(result)await assert.rejects(importDouyinResult(result.id,{reason:"Missing stable account ID"},actor,tag()),/stable/);
      }else assert.equal(summaries.length,0);
    }finally{await server.close();}
  }
});

test("research query zero budget and unsupported kwargs block before transport",async()=>{
  const {createAgentKeyQuery}=await import("@aihot/backend/providers/agentkey/queries");
  const server=await mcpStub(()=>({result:{content:[]}}));
  try{
    await sql`UPDATE budgets SET per_minute=0,per_hour=0,per_day=0 WHERE service='agentkey.query'`;
    for(const operationId of ["douyin.suggest","P5CHB3BZ"]){
      const run=await createAgentKeyQuery({provider:"agentkey",operationId,parameters:{keyword:"synthetic"}},actor,tag());
      await assert.rejects(executeDouyinSearch({runId:run.id,stepVersion:run.step_version,generation:run.generation},{env:envFor(server.url)}),BudgetExceededError);
    }
    assert.equal(server.requests.length,0);
    for(const parameters of [{keyword:"x",cursor:1},{keyword:"x",search_id:"not-proven"},{keyword:"x",douyin_user_fans:"1"},{keyword:"x",offset:0}])await assert.rejects(createAgentKeyQuery({provider:"agentkey",operationId:"P5CHB3BZ",parameters},actor,tag()));
    await assert.rejects(createAgentKeyQuery({provider:"agentkey",operationId:"douyin.suggest",parameters:{keyword:"x",cursor:0}},actor,tag()));
  }finally{await sql`UPDATE budgets SET per_minute=1000,per_hour=1000,per_day=1000 WHERE service='agentkey.query'`;await server.close();}
});

test("research account binding serializes competing targets and preserves existing permissions on conflicts",async()=>{
  const {createAgentKeyQuery}=await import("@aihot/backend/providers/agentkey/queries");
  const {importDouyinResult}=await import("@aihot/backend/providers/redfox/import-douyin");
  const suffix=String(Date.now()),uid=`97${suffix}`,sec=`synthetic-cas-${suffix}`,targets=[`research-left-${suffix}`,`research-right-${suffix}`];
  let user={uid,sec_uid:sec,nickname:"Synthetic binding race"};
  const server=await mcpStub(()=>({result:{content:[],structuredContent:{provider:"TikHub",data:{code:200,data:{status_code:0,user_list:[{user_info:user}]}}}}}));
  const query=async()=>{
    const run=await createAgentKeyQuery({provider:"agentkey",operationId:"P5CHB3BZ",parameters:{keyword:"synthetic"}},actor,tag());
    await executeDouyinSearch({runId:run.id,stepVersion:run.step_version,generation:run.generation},{env:envFor(server.url)});
    return (await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='douyin_account'`)[0]!;
  };
  try{
    for(const sourceId of targets)await sql`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled) VALUES(${sourceId},'Synthetic existing source','external',${sql.json({platform:"douyin"})},'isolated',false,false,false)`;
    const result=await query();
    const outcomes=await Promise.allSettled(targets.map(sourceId=>importDouyinResult(result.id,{sourceId,reason:"Competing explicit bind"},actor,tag())));
    assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);assert.equal(outcomes.filter(o=>o.status==="rejected").length,1);
    const [bound]=await sql`SELECT source_id,article_id FROM operation_results WHERE id=${result.id}`;assert.ok(targets.includes(bound.source_id));assert.equal(bound.article_id,null);
    const bindings=await sql`SELECT DISTINCT source_id FROM source_account_bindings WHERE platform='douyin' AND (id_value=${uid} OR id_value=${sec})`;
    assert.deepEqual([...bindings],[{source_id:bound.source_id}]);
    const before=await sql`SELECT id,participation_mode,site_fulltext,syndicate_fulltext,enabled FROM sources WHERE id IN ${sql(targets)} ORDER BY id`;
    assert.ok(before.every(s=>s.participation_mode==="isolated"&&!s.site_fulltext&&!s.syndicate_fulltext&&!s.enabled));
    user={...user,sec_uid:`conflicting-${sec}`};
    const conflict=await query();
    await assert.rejects(importDouyinResult(conflict.id,{reason:"Conflicting received identity"},actor,tag()),/another identity/);
    assert.equal((await sql`SELECT source_id FROM operation_results WHERE id=${conflict.id}`)[0].source_id,null);
    assert.deepEqual(await sql`SELECT id,participation_mode,site_fulltext,syndicate_fulltext,enabled FROM sources WHERE id IN ${sql(targets)} ORDER BY id`,before);
    assert.equal((await sql`SELECT id FROM articles WHERE source_id IN ${sql(targets)}`).length,0);
  }finally{await server.close();}
});
