import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag, gate } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { config } from "@aihot/backend/config";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { passwordLogin, sessionPrincipal, SESSION_COOKIE } from "@aihot/backend/admin/auth";
import { createSession, quoteTurn, submitTurn, submitTurnTx, assistantOptions, sessionSnapshot, editArtifact, artifactVersions } from "@aihot/backend/assistant/sessions";
import { answerTurn, controlTurn } from "@aihot/backend/assistant/controls";
import { enqueueMessage, approveQueuedMessage, refreshQueuedQuote, cancelQueuedMessage } from "@aihot/backend/assistant/message-queue";
import { skillAdmission, readSkillPolicies, updateAssistantSkill, listAssistantSkills } from "@aihot/backend/assistant/skill-policy";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { buildApp } from "../apps/api/src/app.ts";
const completion = (name: string, input: unknown) => ({ id: "policy-fixture", created: 1, model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "call_0", type: "function", function: { name, arguments: JSON.stringify(input) } }] }, finish_reason: "tool_calls" }] });
test("skill policy admission, administration, concurrency and grandfathered work", async t => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`; assertConfiguredTestDatabase(db.name, db.port);
  const prior = await sql`SELECT * FROM settings WHERE key LIKE 'assistant.skills.%'`;
  const restoreBudget = await allowTestBudgetScope(["assistant.text"], "member");
  const priorPassword = config.adminPassword, priorDev = config.devAdmin;
  const unique = tag(), model = `policy-${unique}`;
  const supplier = await stub((_n, req) => {
    const body = JSON.parse(req.body), results = body.messages.filter((m: any) => m.role === "tool").map((m: any) => JSON.parse(m.content));
    const loaded = results.find((m: any) => m.activationId);
    if (!loaded) return completion("load_skill", { skillId: "general-writing", moduleId: "write" });
    if (!results.some((m: any) => m.question)) return completion("ask_question", { text: "采用什么风格？" });
    return completion("save_draft", { activationId: loaded.activationId, kind: "text-draft", baseVersion: 0,
      content: { title: "冻结范围交付", body: "来自用户材料的内容。", intent: "draft", titles: [], tags: [], sources: ["current-message"], partial: false, scope: "用户材料" } });
  });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    Object.assign(process.env, { ASSISTANT_ENABLED: "true", ASSISTANT_CALLS_ENABLED: "true", ASSISTANT_MODEL_VERIFIED: "true", ASSISTANT_MODEL: "default", LLM_MODEL: model, LLM_BASE_URL: supplier.url + "/v1", LLM_API_KEY: "synthetic-policy-key", ASSISTANT_TOKENIZER: "cl100k_base", MODEL_CALLS_ENABLED: "true", REDFOX_CALLS_ENABLED: "false" });
    await sql`UPDATE budgets SET per_minute=10000,per_hour=100000,per_day=1000000 WHERE service='assistant.text'`;
    await saveToolPrice({ kind: "assistant-turn", provider: "assistant", model, baseCredits: 7, enabled: true, reason: "Synthetic policy price" }, "test");
    for (const id of ["general-writing", "xiaohongshu-creator"]) await sql`INSERT INTO settings(key,value,updated_by) VALUES (${`assistant.skills.${id}`},'{"acceptingNew":true,"revision":1}'::jsonb,'test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    const user = await createSiteUser({ username: `policy_${unique}`, displayName: "Policy", password: "synthetic-policy-password" }, "test");
    await grantCredits(user.id, { amount: 1000, reason: "Synthetic policy credits" }, "test", randomUUID());
    const fresh = async () => ({ ...(await createSession(user.id, { assistantId: "creative" }, randomUUID())), input: { message: "写一篇用户材料稿", expectedRevision: 1, skillSelection: { actionId: "general-writing" } } });
    const change = async (acceptingNew: boolean, id = "general-writing") => updateAssistantSkill(id, { acceptingNew, expectedRevision: (await readSkillPolicies()).find(p => p.skillId === id)!.revision, reason: "测试运营调整" }, "test:policy");
    const charges = async () => (await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${user.id}`)[0]!.n;
    await t.test("admin authentication, CSRF, stale revision, unknown id and audit without external work", async () => {
      config.devAdmin = null; config.adminPassword = "synthetic-admin-policy-password";
      const login = await passwordLogin(config.adminPassword, "/admin", "policy-test"), cookie = `${SESSION_COOKIE}=${login.token}`;
      const principal = await sessionPrincipal(cookie); app = await buildApp();
      const payload = { acceptingNew: false, expectedRevision: 1, reason: "暂停新任务测试" };
      assert.equal((await app.inject({ url: "/api/admin/assistant-skills" })).statusCode, 401);
      assert.equal((await app.inject({ method: "PUT", url: "/api/admin/assistant-skills/general-writing", headers: { cookie }, payload })).statusCode, 403);
      const headers = { cookie, "x-csrf-token": principal!.csrf };
      const before = (await sql`SELECT count(*)::int n FROM settings`)[0]!.n;
      const read = await app.inject({ url: "/api/admin/assistant-skills", headers });
      assert.equal(read.statusCode, 200); assert.match(String(read.headers["cache-control"]), /no-store/);
      assert.equal((await sql`SELECT count(*)::int n FROM settings`)[0]!.n, before);
      assert.equal((await app.inject({ method: "PUT", url: "/api/admin/assistant-skills/unknown", headers, payload })).statusCode, 404);
      assert.equal((await app.inject({ method: "PUT", url: "/api/admin/assistant-skills/general-writing", headers, payload: { ...payload, acceptingNew: "false" } })).statusCode, 400);
      assert.equal((await app.inject({ method: "PUT", url: "/api/admin/assistant-skills/general-writing", headers, payload })).statusCode, 200);
      assert.equal((await app.inject({ method: "PUT", url: "/api/admin/assistant-skills/general-writing", headers, payload })).statusCode, 409);
      const [audit] = await sql`SELECT * FROM audit_log WHERE action='assistant.skill.update' AND subject='assistant-skill:general-writing' ORDER BY id DESC LIMIT 1`;
      assert.deepEqual(audit.before, { acceptingNew: true, revision: 1 }); assert.deepEqual(audit.after, { acceptingNew: false, revision: 2 }); assert.equal(audit.reason, payload.reason);
      assert.equal(supplier.hits(), 0); await change(true);
    });
    await t.test("unrelated skill policy does not stale a manually scoped quote", async () => {
      const f = await fresh(), q = await quoteTurn(user.id, f.sessionId, f.input);
      await change(false, "xiaohongshu-creator");
      const accepted = await submitTurn(user.id, f.sessionId, { ...f.input, quoteId: q.quoteId }, randomUUID());
      const [run] = await sql`SELECT generation FROM operation_runs WHERE id=${accepted.runId}`;
      await controlTurn(user.id, f.sessionId, accepted.turnId, "stop", { generation: run.generation });
      await sql`UPDATE settings SET value='{"acceptingNew":true,"revision":10}'::jsonb WHERE key='assistant.skills.xiaohongshu-creator'`;
    });
    await t.test("close/reopen invalidates quotes; idempotent accepted command survives closure", async () => {
      const f = await fresh(), q = await quoteTurn(user.id, f.sessionId, f.input), count = await charges();
      await change(false);
      await assert.rejects(submitTurn(user.id, f.sessionId, { ...f.input, quoteId: q.quoteId }, randomUUID()), /暂停/);
      await change(true);
      await assert.rejects(submitTurn(user.id, f.sessionId, { ...f.input, quoteId: q.quoteId }, randomUUID()), /报价/);
      assert.equal(await charges(), count);
      const q2 = await quoteTurn(user.id, f.sessionId, f.input), key = randomUUID();
      const accepted = await submitTurn(user.id, f.sessionId, { ...f.input, quoteId: q2.quoteId }, key);
      await change(false);
      assert.deepEqual(await submitTurn(user.id, f.sessionId, { ...f.input, quoteId: q2.quoteId }, key), accepted);
      assert.equal(await charges(), count + 1);
      const [run] = await sql`SELECT generation FROM operation_runs WHERE id=${accepted.runId}`;
      await controlTurn(user.id, f.sessionId, accepted.turnId, "stop", { generation: run.generation });
      await change(true);
    });
    await t.test("close waits for an admitted transaction; close-first rejects new admission", async () => {
      const f = await fresh(), q = await quoteTurn(user.id, f.sessionId, f.input), locked = gate(), release = gate();
      const admission = sql.begin(async tx => { const result = await submitTurnTx(tx, user.id, f.sessionId, { ...f.input, quoteId: q.quoteId }, randomUUID()); locked.open(); await release.promise; return result; });
      await locked.promise; let closed = false;
      const closing = change(false).then(() => { closed = true; });
      await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(closed, false); release.open();
      const accepted = await admission; await closing;
      const next = await fresh(); await assert.rejects(enqueueMessage(user.id, next.sessionId, next.input, randomUUID()), /暂停/);
      const [run] = await sql`SELECT generation FROM operation_runs WHERE id=${accepted.runId}`; await controlTurn(user.id, f.sessionId, accepted.turnId, "stop", { generation: run.generation });
      await change(true);
    });
    await t.test("accepted queue continues through load, question, answer, stop/resume and saved artifact after closure", async () => {
      const f = await fresh(), key = randomUUID(), queued = await enqueueMessage(user.id, f.sessionId, f.input, key);
      await change(false); assert.equal((await enqueueMessage(user.id, f.sessionId, f.input, key)).entryId, queued.entryId);
      const quote = await refreshQueuedQuote(user.id, f.sessionId, queued.entryId);
      const submitted = await approveQueuedMessage(user.id, f.sessionId, queued.entryId, { quoteId: quote.quote.quoteId });
      assert("turnId" in submitted);
      const advance = async () => { const [r] = await sql`SELECT r.id,r.step_version FROM operation_runs r JOIN assistant_turns t ON t.parent_operation_run_id=r.id WHERE t.id=${submitted.turnId}`; await executeOperationStep(r.id, r.step_version, randomUUID()); };
      for (let i = 0; i < 4; i++) await advance();
      let snapshot = await sessionSnapshot(user.id, f.sessionId); assert.equal(snapshot.turn!.phase, "waiting_question");
      await answerTurn(user.id, f.sessionId, submitted.turnId!, { expectedRevision: snapshot.revision, questionId: snapshot.turn!.question!.questionId, answer: "简洁" });
      snapshot = await sessionSnapshot(user.id, f.sessionId);
      await controlTurn(user.id, f.sessionId, submitted.turnId!, "stop", { generation: snapshot.turn!.generation });
      snapshot = await sessionSnapshot(user.id, f.sessionId); assert.equal(snapshot.turn!.canResume, true);
      await controlTurn(user.id, f.sessionId, submitted.turnId!, "resume", { generation: snapshot.turn!.generation });
      for (let i = 0; i < 2; i++) await advance();
      snapshot = await sessionSnapshot(user.id, f.sessionId); assert.equal(snapshot.turn!.status, "completed"); assert.equal(snapshot.artifacts.length, 1);
      const count = await charges(), artifact = snapshot.artifacts[0]!;
      await editArtifact(user.id, f.sessionId, artifact.artifactId, { baseVersion: artifact.version, kind: artifact.kind, content: { ...artifact.content, title: "手工修改" } });
      assert.equal((await artifactVersions(user.id, f.sessionId, artifact.artifactId)).versions.length, 2); assert.equal(await charges(), count);
      await change(true);
    });
    await t.test("migration-marked queue freezes explicit legacy scope once, even after closing", async () => {
      const f = await fresh();
      await sql`UPDATE assistant_sessions SET queue_paused=true WHERE id=${f.sessionId}`;
      const entry = await enqueueMessage(user.id, f.sessionId, f.input, randomUUID());
      // Reproduce the exact migration output for a pre-0093 accepted pending row.
      await sql`UPDATE assistant_message_queue SET admission_snapshot='{"legacy":"0093"}'::jsonb WHERE id=${entry.entryId}`;
      await change(false);
      await sql`UPDATE assistant_sessions SET queue_paused=false WHERE id=${f.sessionId}`;
      await refreshQueuedQuote(user.id, f.sessionId, entry.entryId);
      const [frozen] = await sql`SELECT admission_snapshot FROM assistant_message_queue WHERE id=${entry.entryId}`;
      assert.equal(frozen.admission_snapshot.version, 1);
      assert.deepEqual(frozen.admission_snapshot.candidates.map((c: any) => [c.skillId, c.version]), [["general-writing", "2"]]);
      assert.equal(frozen.admission_snapshot.legacy, undefined);
      await change(true); await change(false);
      await refreshQueuedQuote(user.id, f.sessionId, entry.entryId);
      assert.deepEqual((await sql`SELECT admission_snapshot FROM assistant_message_queue WHERE id=${entry.entryId}`)[0]!.admission_snapshot, frozen.admission_snapshot);
      await cancelQueuedMessage(user.id, f.sessionId, entry.entryId);
      await change(true);
    });
    await t.test("concurrent first writes to an absent key serialize expectedRevision and admission", async () => {
      await sql`DELETE FROM settings WHERE key='assistant.skills.general-writing'`;
      const before = (await sql`SELECT count(*)::int n FROM audit_log WHERE action='assistant.skill.update' AND subject='assistant-skill:general-writing'`)[0]!.n;
      const input = { acceptingNew: false, expectedRevision: 0, reason: "并发首次建立暂停配置" };
      const writes = await Promise.allSettled([
        updateAssistantSkill("general-writing", input, "test:first-a"),
        updateAssistantSkill("general-writing", input, "test:first-b"),
        sql.begin(tx => skillAdmission(tx, "creative", { actionId: "general-writing" }, true)),
      ]);
      assert.equal(writes.slice(0, 2).filter(r => r.status === "fulfilled").length, 1);
      assert.equal(writes[2]!.status, "rejected");
      const loser = writes.slice(0, 2).find(r => r.status === "rejected") as PromiseRejectedResult;
      assert.equal(loser.reason.code, "conflict");
      const policy = (await readSkillPolicies()).find(p => p.skillId === "general-writing")!;
      assert.equal(policy.revision, 1); assert.equal(policy.acceptingNew, false);
      assert.equal((await sql`SELECT count(*)::int n FROM audit_log WHERE action='assistant.skill.update' AND subject='assistant-skill:general-writing'`)[0]!.n, before + 1);
      await change(true);
    });
    await t.test("policy scope, action health, absent/bad settings and forged queued scope fail safely", async () => {
      await change(false, "xiaohongshu-creator");
      const scope = await skillAdmission(sql, "creative"); assert(scope.candidates.every(c => c.skillId === "general-writing")); assert.equal(scope.unavailableSkills[0]!.skillId, "xiaohongshu-creator");
      await assert.rejects(skillAdmission(sql, "xiaohongshu"), /暂停/);
      const options = await assistantOptions(user.id); assert.equal(options.assistants.find(a => a.id === "xiaohongshu")!.available, false);
      await sql`UPDATE settings SET value='{"acceptingNew":true,"revision":20}'::jsonb WHERE key='assistant.skills.xiaohongshu-creator'`;
      const actions = (await assistantOptions(user.id)).assistants[0]!.actions;
      assert.equal(actions.find(a => a.actionId === "xiaohongshu-write")!.available, false);
      assert.equal(actions.find(a => a.actionId === "xiaohongshu-rewrite")!.available, true);
      const f = await fresh(); await assert.rejects(enqueueMessage(user.id, f.sessionId, { ...f.input, admission_snapshot: scope }, randomUUID()));
      const entry = await enqueueMessage(user.id, f.sessionId, f.input, randomUUID());
      await sql`UPDATE assistant_message_queue SET admission_snapshot=NULL WHERE id=${entry.entryId}`;
      await assert.rejects(refreshQueuedQuote(user.id, f.sessionId, entry.entryId), /受理范围/); await cancelQueuedMessage(user.id, f.sessionId, entry.entryId);
      await sql`DELETE FROM settings WHERE key='assistant.skills.general-writing'`;
      const count = (await sql`SELECT count(*)::int n FROM settings`)[0]!.n;
      await listAssistantSkills(); assert.equal((await sql`SELECT count(*)::int n FROM settings`)[0]!.n, count);
      await assert.rejects(skillAdmission(sql, "creative", { actionId: "general-writing" }), /暂停/);
      await updateAssistantSkill("general-writing", { acceptingNew: true, expectedRevision: 0, reason: "首次建立配置" }, "test");
      await sql`UPDATE settings SET value='{"acceptingNew":"yes","revision":99}'::jsonb WHERE key='assistant.skills.general-writing'`;
      await assert.rejects(skillAdmission(sql, "creative", { actionId: "general-writing" }), /暂停/);
      await updateAssistantSkill("general-writing", { acceptingNew: false, expectedRevision: 0, reason: "修复损坏配置为暂停" }, "test");
      assert.equal((await readSkillPolicies()).find(p => p.skillId === "general-writing")!.acceptingNew, false);
      await change(true);
    });
  } finally {
    if (app) await app.close(); config.adminPassword = priorPassword; config.devAdmin = priorDev;
    for (const row of prior) await sql`INSERT INTO settings(key,value,updated_by,updated_at) VALUES (${row.key},${sql.json(row.value)},${row.updated_by},${row.updated_at}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`;
    await restoreBudget(); await supplier.close(); await stopBoss(); await closeDb();
  }
});
