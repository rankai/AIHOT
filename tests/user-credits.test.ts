import { assertConfiguredTestDatabase, gate, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import type { ToolAuthorization, ToolCreditIntent, ToolPrice, ToolPriceInput } from "@aihot/contracts/credits";
import { sql, closeDb, type Tx } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { uploadKey } from "@aihot/backend/operations/assets";
import { quoteUserTool, submitUserTool } from "@aihot/backend/users/tools";
import { controlOperation } from "@aihot/backend/providers/operations/read";
import { loginSiteUser } from "@aihot/backend/users/auth";
import { passwordLogin, sessionPrincipal } from "@aihot/backend/admin/auth";
import { assertRunCredit, getCreditPage, grantCredits, listCreditCharges, quoteTool, readRunCredits, reconcileCreditCharge, saveToolPrice, settleForRun } from "@aihot/backend/users/credits";
import { advanceRun, createRun, requireExecution, saveResult, setRunState, type RunRow } from "@aihot/backend/providers/operations/store";
import { registerUserCredits } from "../apps/api/src/routes/user-credits.ts";
import { registerAdminCredits } from "../apps/api/src/routes/admin-credits.ts";

const actor = "test:member-credits";
before(async () => {
  const [db] = await sql<{ name: string; port: number }[]>`SELECT current_database() AS name, inet_server_port() AS port`;
  assertConfiguredTestDatabase(db!.name, db!.port);
});
after(async () => { try { await stopBoss(); } finally { await closeDb(); } });

async function member() {
  const [user] = await sql`INSERT INTO site_users(username, display_name, password_hash) VALUES (${`credit-${tag()}`}, 'Credit test user', 'synthetic-not-a-login-hash') RETURNING id`;
  return Number(user!.id);
}
async function price(overrides: Partial<ToolPriceInput> = {}) {
  return saveToolPrice({ kind: "query", provider: "redfox", model: `tool-${tag()}`, tier: "", parameterMatch: {}, baseCredits: 7,
    imageCredits: 0, videoSecondCredits: 0, referenceCredits: 0, enabled: true, reason: "Synthetic test price", ...overrides }, actor);
}
function intentFor(p: ToolPrice, input: Record<string, unknown> = { parameters: { query: "synthetic" } }): ToolCreditIntent {
  return { kind: p.kind, provider: p.provider, model: p.model, tier: p.tier, input };
}
function command(userId: number, intent: ToolCreditIntent, authorization?: ToolAuthorization, key = tag()) {
  return { actor: `user:${userId}`, commandKey: key, provider: intent.provider, operationKey: `test.credits.${intent.kind}`, contractVersion: 1,
    input: { parameters: intent.input }, stepKey: "test.credits.execute", limits: { polls: 4, externalAttempts: 6, pollDeadlineSeconds: 3600 }, authorization };
}
async function reserve(userId: number, intent: ToolCreditIntent, key = tag()) {
  const quote = await quoteTool(userId, intent), authorization = { quoteId: quote.quoteId, intent };
  const run = await sql.begin(tx => createRun(tx, command(userId, intent, authorization, key)));
  return { run, quote, authorization };
}
const execution = (run: RunRow) => ({ runId: run.id, stepVersion: run.step_version, generation: run.generation });
async function blockedBy(pid: number): Promise<number> {
  for (let i = 0; i < 250; i++) {
    const [waiting] = await sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND ${pid}=ANY(pg_blocking_pids(pid))`;
    if (waiting) return waiting.pid as number;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Expected database lock contention did not occur");
}
async function charge(runId: number) {
  return (await sql`SELECT c.* FROM member_credit_charges c JOIN member_credit_run_links l ON l.charge_id = c.id WHERE l.run_id = ${runId}`)[0]!;
}
async function receipt(tx: Tx, runId: number, status: "unknown" | "pending" | "received" | "failed" | "completed") {
  const [row] = await tx`INSERT INTO receipts(logical_key, service, purpose, status) VALUES (${tag()}, 'credits-test', 'test', ${status}) RETURNING id`;
  await tx`UPDATE operation_runs SET current_receipt_id = ${row!.id} WHERE id = ${runId}`;
  return Number(row!.id);
}

test("new accounts start at zero; grants, adjustments and immutable history are idempotent", async () => {
  const user = await member();
  assert.deepEqual((await getCreditPage(user)).balance, { userId: user, available: 0, reserved: 0 });
  const key = tag(), body = { amount: 50, reason: "Trial allocation" };
  await Promise.all([grantCredits(user, body, actor, key), grantCredits(user, body, actor, key)]);
  await assert.rejects(grantCredits(user, { ...body, amount: 60 }, actor, key), /幂等/);
  assert.equal((await getCreditPage(user)).balance.available, 50);
  await grantCredits(user, { kind: "adjustment", amount: -10, reason: "Correct allocation" }, actor, tag());
  await assert.rejects(grantCredits(user, { kind: "adjustment", amount: -41, reason: "Cannot overdraw" }, actor, tag()), /不足/);
  const page = await getCreditPage(user, { limit: 1 });
  assert.equal(page.balance.available, 40);
  assert.equal(page.entries[0]!.kind, "adjustment");
  assert.ok(page.nextCursor);
  const next = await getCreditPage(user, { limit: 1, before: page.nextCursor });
  assert.equal(next.entries[0]!.kind, "grant");
  assert.equal(next.nextCursor, null);
  await assert.rejects(sql`UPDATE member_credit_entries SET amount = 1 WHERE id = ${next.entries[0]!.id}`, /append-only/);
  await assert.rejects(sql`DELETE FROM member_credit_entries WHERE id = ${next.entries[0]!.id}`, /append-only/);
});

test("prices are explicit, exact and versioned; parameter tiers and quantities are included", async () => {
  const user = await member(), p = await price({ kind: "images", tier: "2K", baseCredits: 3, imageCredits: 4, referenceCredits: 2 });
  const intent = { ...intentFor(p, { resolution: "2K", n: 2 }), imageCount: 2, referenceCount: 1 };
  const q = await quoteTool(user, intent);
  assert.equal(q.amount, 13); assert.equal(q.affordable, false);
  await assert.rejects(quoteTool(user, { ...intent, tier: "4K" }), /尚未设置/);
  const specific = await price({ kind: p.kind, model: p.model, tier: p.tier, parameterMatch: { resolution: "2K" }, baseCredits: 9 });
  assert.equal((await quoteTool(user, intent)).priceId, specific.id);
  await price({ kind: p.kind, model: p.model, tier: p.tier, parameterMatch: { n: 2 }, baseCredits: 8 });
  await assert.rejects(quoteTool(user, intent), /冲突/);
  const { version: _, updatedAt: __, ...editable } = p;
  await assert.rejects(saveToolPrice({ ...editable, expectedVersion: 999, reason: "Stale edit" }, actor), /价格已被修改/);
});

test("quotes bind user, parameters, expiry and current price; no quote reserves nothing", async () => {
  const user = await member(), other = await member(), p = await price(), intent = intentFor(p);
  await grantCredits(user, { amount: 100, reason: "Test allocation" }, actor, tag());
  const quote = await quoteTool(user, intent);
  await assert.rejects(sql.begin(tx => createRun(tx, command(user, intent))), /积分报价/);
  await assert.rejects(sql.begin(tx => createRun(tx, command(other, intent, { quoteId: quote.quoteId, intent }))), /报价不存在/);
  const changed = { ...intent, input: { query: "different" } };
  await assert.rejects(sql.begin(tx => createRun(tx, command(user, changed, { quoteId: quote.quoteId, intent: changed }))), /参数已变化/);
  await sql`UPDATE member_tool_quotes SET expires_at = now() - interval '1 second' WHERE id = ${quote.quoteId}`;
  await assert.rejects(sql.begin(tx => createRun(tx, command(user, intent, { quoteId: quote.quoteId, intent }))), /过期/);
  const q2 = await quoteTool(user, intent);
  const { version, updatedAt: _, ...editable } = p;
  await saveToolPrice({ ...editable, expectedVersion: version, baseCredits: 8, reason: "Updated test price" }, actor);
  await assert.rejects(sql.begin(tx => createRun(tx, command(user, intent, { quoteId: q2.quoteId, intent }))), /价格已变化/);
  assert.deepEqual((await getCreditPage(user)).balance, { userId: user, available: 100, reserved: 0 });
});

test("concurrent admission cannot overdraw; retries cannot reserve twice or reuse a quote", async () => {
  const user = await member(), p = await price(), intent = intentFor(p);
  await grantCredits(user, { amount: 10, reason: "Concurrency allocation" }, actor, tag());
  const [q1, q2] = await Promise.all([quoteTool(user, intent), quoteTool(user, intent)]);
  const attempts = await Promise.allSettled([q1, q2].map(q => sql.begin(tx => createRun(tx, command(user, intent, { quoteId: q.quoteId, intent })))));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.deepEqual((await getCreditPage(user)).balance, { userId: user, available: 3, reserved: 7 });
  const winner = attempts.find(result => result.status === "fulfilled")! as PromiseFulfilledResult<RunRow>;
  const [run] = await sql`SELECT * FROM operation_runs WHERE id = ${winner.value.id}`;
  const q = q1.quoteId === (await charge(run!.id)).quote_id ? q1 : q2;
  const again = await sql.begin(tx => createRun(tx, command(user, intent, { quoteId: q.quoteId, intent }, run!.command_key)));
  assert.equal(again.id, run!.id);
  await assert.rejects(sql.begin(tx => createRun(tx, command(user, intent, { quoteId: q.quoteId, intent }))), /已用于另一任务/);
  assert.equal((await getCreditPage(user)).entries.filter(entry => entry.kind === "reserve").length, 1);
});

test("transaction rollback removes task and reservation; accepted prices remain frozen", async () => {
  const user = await member(), p = await price(), intent = intentFor(p);
  await grantCredits(user, { amount: 20, reason: "Rollback allocation" }, actor, tag());
  const q = await quoteTool(user, intent), key = tag();
  await assert.rejects(sql.begin(async tx => {
    await createRun(tx, command(user, intent, { quoteId: q.quoteId, intent }, key));
    throw new Error("synthetic queue failure");
  }), /queue failure/);
  assert.equal((await sql`SELECT id FROM operation_runs WHERE actor = ${`user:${user}`} AND command_key = ${key}`).length, 0);
  assert.deepEqual((await getCreditPage(user)).balance, { userId: user, available: 20, reserved: 0 });
  const run = await sql.begin(tx => createRun(tx, command(user, intent, { quoteId: q.quoteId, intent }, key)));
  const { version, updatedAt: _, ...editable } = p;
  await saveToolPrice({ ...editable, expectedVersion: version, baseCredits: 99, reason: "Price changed after acceptance" }, actor);
  await sql.begin(async tx => { await saveResult(tx, execution(run), { itemKey: "empty", kind: "query_summary", data: { count: 0 } }); await advanceRun(tx, execution(run), null); });
  assert.equal((await charge(run.id)).consumed, 7);
  await sql.begin(tx => settleForRun(tx, { runId: run.id, outcome: "completed" }));
  assert.deepEqual((await getCreditPage(user)).balance, { userId: user, available: 13, reserved: 0 });
  assert.equal((await getCreditPage(user)).entries.filter(entry => entry.kind === "consume").length, 1);
});

test("confirmed failure without delivery releases once; stopped tasks retain reservation", async () => {
  const user = await member(), p = await price(), intent = intentFor(p);
  await grantCredits(user, { amount: 20, reason: "Failure allocation" }, actor, tag());
  const { run } = await reserve(user, intent);
  await sql.begin(tx => setRunState(tx, execution(run), "failed", "Definitive local rejection before request"));
  assert.equal((await charge(run.id)).state, "released");
  await sql.begin(tx => settleForRun(tx, { runId: run.id, outcome: "failed" }));
  assert.equal((await getCreditPage(user)).balance.available, 20);
  await assert.rejects(sql.begin(tx => assertRunCredit(tx, run.id)), /已结算或释放/);
  const stopped = (await reserve(user, intent)).run;
  await sql.begin(tx => setRunState(tx, execution(stopped), "stopped", "User paused"));
  assert.equal((await charge(stopped.id)).state, "review");
  assert.equal((await getCreditPage(user)).balance.reserved, 7);
});

test("unknown response, partial output and successful provider save failure never auto-refund", async () => {
  for (const kind of ["unknown", "partial", "save-failure"] as const) {
    const user = await member(), p = await price(), intent = intentFor(p);
    await grantCredits(user, { amount: 20, reason: "Review allocation" }, actor, tag());
    const { run } = await reserve(user, intent);
    await sql.begin(async tx => {
      if (kind === "unknown") await receipt(tx, run.id, "unknown");
      else if (kind === "save-failure") await receipt(tx, run.id, "received");
      else await saveResult(tx, execution(run), { itemKey: "part", kind: "query_item", data: { text: "partial" } });
      await setRunState(tx, execution(run), "failed", "Synthetic incomplete outcome");
    });
    const c = await charge(run.id);
    assert.equal(c.state, "review", kind);
    assert.equal((await getCreditPage(user)).balance.reserved, 7, kind);
    assert.ok((await listCreditCharges({ state: "review", userId: user })).charges.some(row => row.id === c.id));
  }
});

test("completed status alone cannot settle a missing image delivery", async () => {
  const user = await member(), p = await price({ kind: "images" }), intent = { ...intentFor(p), imageCount: 2 };
  await grantCredits(user, { amount: 20, reason: "Image review allocation" }, actor, tag());
  const { run } = await reserve(user, intent);
  await sql.begin(async tx => { await saveResult(tx, execution(run), { itemKey: "task", kind: "image_task", data: { status: "completed", imageUrls: ["https://example.test/image"] } }); await advanceRun(tx, execution(run), null); });
  assert.equal((await charge(run.id)).state, "review");
  assert.equal((await getCreditPage(user)).balance.reserved, 7);
});

test("manual reconciliation is bounded, audited and idempotent, and fences future execution", async () => {
  const user = await member(), p = await price(), intent = intentFor(p);
  await grantCredits(user, { amount: 20, reason: "Manual review allocation" }, actor, tag());
  const { run } = await reserve(user, intent), c = await charge(run.id);
  await assert.rejects(reconcileCreditCharge(c.id, { consume: 3, reason: "Cannot settle active task" }, actor, tag()), /仍可执行/);
  await sql.begin(tx => setRunState(tx, execution(run), "stopped", "Operator reviewed partial delivery"));
  await assert.rejects(reconcileCreditCharge(c.id, { consume: 8, reason: "Too large deduction" }, actor, tag()), /超过/);
  const key = tag(), body = { consume: 3, reason: "Verified partial delivery: three credits" };
  const rows = await Promise.all([reconcileCreditCharge(c.id, body, actor, key), reconcileCreditCharge(c.id, body, actor, key)]);
  assert.equal(rows[0].consumed, 3); assert.equal(rows[1].released, 4);
  assert.deepEqual((await getCreditPage(user)).balance, { userId: user, available: 17, reserved: 0 });
  assert.equal((await sql`SELECT id FROM audit_log WHERE action = 'credits.reconcile' AND subject = ${`credit-charge:${c.id}`}`).length, 1);
  const recordedActors = await sql`SELECT actor FROM member_credit_entries WHERE charge_id = ${c.id} AND kind IN ('consume','release')`;
  assert.deepEqual(recordedActors.map(row => row.actor), [actor, actor], "manual ledger records the reviewing actor");
  await assert.rejects(reconcileCreditCharge(c.id, { ...body, consume: 4 }, actor, key), /幂等/);
  await assert.rejects(sql.begin(tx => assertRunCredit(tx, run.id)), /已结算或释放/);
});

test("normalized AI failure reason can confirm failure even before provider status changes", async () => {
  const user = await member(), p = await price({ kind: "ai-search" }), intent = intentFor(p);
  await grantCredits(user, { amount: 20, reason: "AI failure allocation" }, actor, tag());
  const { run } = await reserve(user, intent);
  await sql.begin(async tx => {
    const receiptId = await receipt(tx, run.id, "received");
    await saveResult(tx, execution(run), { itemKey: "failed-poll", kind: "ai_search_task", data: { status: "processing", failReason: "Provider rejected this task" }, receiptId });
    await setRunState(tx, execution(run), "failed", "Provider rejected this task");
  });
  assert.equal((await charge(run.id)).state, "released");
  assert.equal((await getCreditPage(user)).balance.available, 20);
});

test("manual reconciliation refuses an in-flight provider request", async () => {
  const user = await member(), p = await price(), intent = intentFor(p);
  await grantCredits(user, { amount: 20, reason: "Pending allocation" }, actor, tag());
  const { run } = await reserve(user, intent);
  await sql.begin(async tx => { await receipt(tx, run.id, "pending"); await setRunState(tx, execution(run), "stopped", "Local stop only"); });
  const c = await charge(run.id);
  await assert.rejects(reconcileCreditCharge(c.id, { consume: 0, reason: "No safe refund yet" }, actor, tag()), /仍在处理中/);
  assert.equal((await getCreditPage(user)).balance.reserved, 7);
});

test("explicit free prices still record a task authorization without requiring a balance", async () => {
  const user = await member(), p = await price({ baseCredits: 0 }), intent = intentFor(p);
  const { run, quote } = await reserve(user, intent);
  assert.equal(quote.amount, 0); assert.equal(quote.affordable, true);
  await sql.begin(async tx => { await saveResult(tx, execution(run), { itemKey: "empty", kind: "query_summary", data: { count: 0 } }); await advanceRun(tx, execution(run), null); });
  assert.equal((await charge(run.id)).state, "settled");
  assert.deepEqual((await getCreditPage(user)).balance, { userId: user, available: 0, reserved: 0 });
});

test("one recovery child shares the original charge and prevents original execution", async () => {
  const user = await member(), p = await price({ kind: "images" }), intent = { ...intentFor(p), imageCount: 1 };
  await grantCredits(user, { amount: 20, reason: "Recovery allocation" }, actor, tag());
  const { run } = await reserve(user, intent);
  await sql`UPDATE operation_runs SET step_key = 'redfox.image.poll', status = 'stopped' WHERE id = ${run.id}`;
  const recovery: ToolCreditIntent = { ...intent, kind: "images/query", input: { runId: run.id, taskId: "synthetic-task" }, recoveryRunId: run.id };
  const q = await quoteTool(user, recovery);
  assert.equal(q.amount, 0);
  const child = await sql.begin(tx => createRun(tx, { ...command(user, recovery, { quoteId: q.quoteId, intent: recovery }), stepKey: "redfox.image.poll" }));
  assert.equal((await charge(child.id)).id, (await charge(run.id)).id);
  assert.equal((await getCreditPage(user)).entries.filter(entry => entry.kind === "reserve").length, 1);
  await assert.rejects(sql.begin(tx => assertRunCredit(tx, run.id)), /已有恢复记录/);
  await sql.begin(tx => assertRunCredit(tx, child.id));
  await assert.rejects(quoteTool(user, recovery), /已建立恢复记录/);
  assert.equal(await readRunCredits(await member(), child.id), null);
});

test("quote storage is bounded and expired unused quotes are removed", async () => {
  const user = await member(), p = await price(), intent = intentFor(p);
  const old = await quoteTool(user, intent);
  await sql`UPDATE member_tool_quotes SET expires_at = now() - interval '1 second' WHERE id = ${old.quoteId}`;
  await quoteTool(user, intent);
  assert.equal((await sql`SELECT id FROM member_tool_quotes WHERE id = ${old.quoteId}`).length, 0);
  for (let i = 0; i < 29; i++) await quoteTool(user, intent);
  await assert.rejects(quoteTool(user, intent), /报价请求较多/);
  const [count] = await sql`SELECT count(*) AS n FROM member_tool_quotes WHERE user_id = ${user}`;
  assert.equal(count!.n, 30);
});

test("HTTP balances are private, writes need admin and CSRF, and users cannot select another account", async () => {
  const original = { siteUrl: config.siteUrl, devAdmin: config.devAdmin, adminPassword: config.adminPassword };
  const app = Fastify({ logger: false });
  try {
    config.siteUrl = "https://credits.test"; config.devAdmin = null; config.adminPassword = `synthetic-admin-${tag()}`;
    const user = await createSiteUser({ username: `credit-${tag()}`, displayName: "Member", password: "synthetic-credit-password" }, actor);
    const session = await loginSiteUser({ username: user.username, password: "synthetic-credit-password" });
    const cookie = `aihot_user=${session.token}`;
    const admin = await passwordLogin(config.adminPassword, "/admin", "test"), adminCookie = `aihot_admin=${admin.token}`;
    const adminMe = await sessionPrincipal(adminCookie);
    registerUserCredits(app); registerAdminCredits(app); await app.ready();
    assert.equal((await app.inject({ url: "/api/account/credits" })).statusCode, 401);
    const own = await app.inject({ url: "/api/account/credits?userId=999", headers: { cookie } });
    assert.equal(own.statusCode, 200); assert.equal(own.json().balance.userId, user.id); assert.match(String(own.headers["cache-control"]), /no-store/);
    assert.equal((await app.inject({ url: `/api/admin/users/${user.id}/credits`, headers: { cookie } })).statusCode, 401);
    const endpoint = `/api/admin/users/${user.id}/credits`, payload = { amount: 25, reason: "Authorized trial grant" }, key = tag();
    assert.equal((await app.inject({ method: "POST", url: endpoint, headers: { cookie: adminCookie }, payload })).statusCode, 403);
    const headers = { cookie: adminCookie, "x-csrf-token": adminMe!.csrf, origin: config.siteUrl, "idempotency-key": key };
    assert.equal((await app.inject({ method: "POST", url: endpoint, headers: { ...headers, origin: "https://other.test" }, payload })).statusCode, 403);
    const response = await app.inject({ method: "POST", url: endpoint, headers, payload });
    assert.equal(response.statusCode, 200); assert.equal(response.json().balance.available, 25);
    assert.equal((await app.inject({ method: "POST", url: endpoint, headers, payload })).json().balance.available, 25);
  } finally {
    await app.close(); Object.assign(config, original);
  }
});

test("member resume shares new-task admission and serializes concurrent resumes", async () => {
  const { resumeRun } = await import("@aihot/backend/providers/operations/store");
  const user = await member(), intent = intentFor(await price());
  await grantCredits(user, { amount: 100, reason: "Resume admission" }, actor, tag());
  const paused = [];
  for (let i = 0; i < 2; i++) {
    const { run } = await reserve(user, intent);
    await sql`UPDATE operation_runs SET status=${i === 0 ? "stopped" : "needs_review"} WHERE id=${run.id}`;
    paused.push(run);
  }
  for (let i = 0; i < 4; i++) await reserve(user, intent);
  const attempts = await Promise.allSettled(paused.map(run => sql.begin(tx => resumeRun(tx, execution(run)))));
  assert.equal(attempts.filter(row => row.status === "fulfilled").length, 1);
  const [count] = await sql`SELECT count(*)::int AS n FROM operation_runs WHERE actor=${`user:${user}`} AND status IN ('active','waiting')`;
  assert.equal(count.n, 5);
  const winner = paused[attempts.findIndex(row => row.status === "fulfilled")];
  const [current] = await sql<RunRow[]>`UPDATE operation_runs SET status='waiting' WHERE id=${winner.id} RETURNING *`;
  await sql.begin(tx => resumeRun(tx, execution(current)));
});

test("member new-task and manual resume compete for the same last slot", async () => {
  const user = await member(), intent = intentFor(await price());
  await grantCredits(user, { amount: 100, reason: "Mixed admission" }, actor, tag());
  const { run: paused } = await reserve(user, intent);
  await sql`UPDATE operation_runs SET status='stopped' WHERE id=${paused.id}`;
  for (let i = 0; i < 4; i++) await reserve(user, intent);
  const quote = await quoteTool(user, intent);
  const attempts = await Promise.allSettled([
    controlOperation(paused.id, "resume", { stepVersion: paused.step_version, generation: paused.generation, reason: "Resume test" }, `user:${user}`),
    sql.begin(tx => createRun(tx, command(user, intent, { quoteId: quote.quoteId, intent }))),
  ]);
  assert.equal(attempts.filter(row => row.status === "fulfilled").length, 1);
  const rejected = attempts.find(row => row.status === "rejected");
  assert(rejected?.status === "rejected"); assert.match(rejected.reason.message, /同时最多执行 5 个任务/);
  const [count] = await sql`SELECT count(*)::int AS n FROM operation_runs WHERE actor=${`user:${user}`} AND status IN ('active','waiting')`;
  assert.equal(count.n, 5);
});

test("member result saving and a real same-asset submission both commit without deadlock", async () => {
  for (const withStaleResume of [false, true]) {
    const user = await member(), owner = `user:${user}`, fileKey = uploadKey(owner, tag());
    await grantCredits(user, { amount: 20, reason: "Concurrent media admission" }, actor, tag());
    await sql`INSERT INTO stored_files(key,content_type,bytes,purpose,status,sha256,metadata,owner_actor)
      VALUES (${fileKey},'image/png',100,'operation-input','available',${"0".repeat(64)},${sql.json({ filename: "synthetic.png", kind: "image", width: 64, height: 64 })},${owner})`;
    await price({ kind: "media-upload", model: "", parameterMatch: { fileKey }, baseCredits: 1 });
    const input = { fileKey }, firstQuote = await quoteUserTool(user, { kind: "media-upload", input });
    const first = await submitUserTool(user, "media-upload", { input, quoteId: firstQuote.quoteId }, tag());
    const nextQuote = await quoteUserTool(user, { kind: "media-upload", input });
    const [run] = await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${first.runId}`;
    let submission: Promise<void> | undefined, outcome: PromiseSettledResult<{ runId: number }> | undefined;
    let resume: Promise<PromiseSettledResult<unknown>> | undefined;
    try {
      const worker = await sql.begin(async tx => {
        await requireExecution(tx, execution(run));
        const [connection] = await tx`SELECT pg_backend_pid() AS pid`;
        let blockingPid = connection.pid;
        if (withStaleResume) {
          resume = controlOperation(run.id, "resume", { stepVersion: run.step_version, generation: run.generation, reason: "Stale resume" }, owner)
            .then(value => ({ status: "fulfilled", value } as const), reason => ({ status: "rejected", reason } as const));
          blockingPid = await blockedBy(connection.pid);
        }
        submission = submitUserTool(user, "media-upload", { input, quoteId: nextQuote.quoteId }, tag())
          .then(value => { outcome = { status: "fulfilled", value }; }, reason => { outcome = { status: "rejected", reason }; });
        // The old lock order blocks the real submission on this worker; the fixed path can finish.
        let ready = false;
        for (let i = 0; i < 250; i++) {
          if (outcome || (await sql`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND ${blockingPid}=ANY(pg_blocking_pids(pid))`).length) { ready = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert(ready, "Submission must finish or reach the contended database lock");
        await saveResult(tx, execution(run), { itemKey: "upload", kind: "media_upload", fileKey, data: { resourceUrl: "https://supplier.example.test/upload" } });
        await advanceRun(tx, execution(run), null);
      }).then(value => ({ status: "fulfilled", value } as const), reason => ({ status: "rejected", reason } as const));
      await submission;
      const resumed = await resume;
      if (worker.status === "rejected") throw worker.reason;
      assert(outcome); if (outcome.status === "rejected") throw outcome.reason;
      if (withStaleResume) { assert(resumed?.status === "rejected"); assert.equal(resumed.reason.code, "conflict"); }
      assert.notEqual(outcome.value.runId, first.runId);
      assert.equal((await sql`SELECT file_key FROM operation_results WHERE run_id=${first.runId}`)[0].file_key, fileKey);
      assert.equal((await charge(first.runId)).state, "settled");
      assert.equal((await charge(first.runId)).consumed, 1);
      assert.equal((await charge(outcome.value.runId)).state, "reserved");
      assert.deepEqual((await getCreditPage(user)).balance, { userId: user, available: 18, reserved: 1 });
    } finally {
      await submission;
      await resume;
      await sql`UPDATE operation_runs SET status='stopped' WHERE actor=${owner} AND status IN ('active','waiting')`;
    }
  }
});

test("member resume waits for reconciliation without blocking its ledger foreign keys", async () => {
  const user = await member(), intent = intentFor(await price());
  await grantCredits(user, { amount: 20, reason: "Concurrent reconciliation" }, actor, tag());
  const { run } = await reserve(user, intent), c = await charge(run.id);
  await sql`UPDATE operation_runs SET status='stopped' WHERE id=${run.id}`;
  const ready = gate<number>(), release = gate();
  const blocker = sql.begin(async tx => {
    await tx`SELECT user_id FROM member_credit_accounts WHERE user_id=${user} FOR UPDATE`;
    ready.open((await tx`SELECT pg_backend_pid() AS pid`)[0].pid);
    await release.promise;
  });
  let reconciliation: ReturnType<typeof reconcileCreditCharge> | undefined;
  let resume: Promise<PromiseSettledResult<unknown>> | undefined;
  try {
    const walletPid = await ready.promise;
    reconciliation = reconcileCreditCharge(c.id, { consume: 0, reason: "Confirmed no delivery" }, actor, tag());
    const reviewPid = await blockedBy(walletPid);
    resume = controlOperation(run.id, "resume", { stepVersion: run.step_version, generation: run.generation, reason: "Concurrent resume" }, `user:${user}`)
      .then(value => ({ status: "fulfilled", value } as const), reason => ({ status: "rejected", reason } as const));
    await blockedBy(reviewPid);
  } finally { release.open(); await blocker; }
  assert(reconciliation); assert(resume);
  assert.equal((await reconciliation).state, "released");
  const attempt = await resume;
  assert.equal(attempt.status, "rejected");
  if (attempt.status === "rejected") assert.equal(attempt.reason.code, "credits_finalized");
  assert.equal((await sql`SELECT status FROM operation_runs WHERE id=${run.id}`)[0].status, "stopped");
  assert.deepEqual((await getCreditPage(user)).balance, { userId: user, available: 20, reserved: 0 });
});
