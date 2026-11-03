import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag, gate } from "./setup.ts";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishUpload, uploadKey } from "@aihot/backend/operations/assets";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { config } from "@aihot/backend/config";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { passwordLogin, sessionPrincipal, SESSION_COOKIE } from "@aihot/backend/admin/auth";
import { createSession, quoteTurn, submitTurn, submitTurnTx, assistantOptions, sessionSnapshot, editArtifact, artifactVersions, sessionEvents } from "@aihot/backend/assistant/sessions";
import { answerTurn, controlTurn, handoff, archiveSession } from "@aihot/backend/assistant/controls";
import { enqueueMessage, approveQueuedMessage, refreshQueuedQuote, cancelQueuedMessage } from "@aihot/backend/assistant/message-queue";
import { capabilityActions, lockSkillPolicies, skillAdmission, readSkillPolicies, updateAssistantSkill, listAssistantSkills } from "@aihot/backend/assistant/skill-policy";
import { saveArtifact } from "@aihot/backend/assistant/store";
import { shouldReadSnapshot } from "../apps/web/app/features/assistant/snapshot-poll.ts";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { buildApp } from "../apps/api/src/app.ts";
const completion = (name: string, input: unknown) => ({ id: "policy-fixture", created: 1, model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "call_0", type: "function", function: { name, arguments: JSON.stringify(input) } }] }, finish_reason: "tool_calls" }] });
test("dependency recipients follow current capability bindings across action IDs", () => {
  const packages = [{skillId:"one",version:"1",modules:[{actionId:"first",capabilities:["search-wechat-hot@1" as const]}]},
    {skillId:"two",version:"2",modules:[{actionId:"second",capabilities:["search-wechat-hot@1" as const]},{actionId:"xhs",capabilities:["search-xhs-notes@1" as const]}]},
    {skillId:"two",version:"1",modules:[{actionId:"retired",capabilities:["search-wechat-hot@1" as const]}]}];
  assert.deepEqual(capabilityActions("search-wechat-hot@1",packages,{one:"1",two:"2"}),["first","second"]);
  assert.deepEqual(capabilityActions("search-xhs-notes@1",packages,{one:"1",two:"2"}),["xhs"]);
  assert.deepEqual(capabilityActions("search-wechat-hot@1"),["wechat-write"]);
  assert.deepEqual(capabilityActions("search-xhs-notes@1"),["xiaohongshu-write"]);
});
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
    await t.test("handoff replays its accepted target after closure but rejects a new paused target", async () => {
      const source = await fresh();
      const saved = await sql.begin(tx => saveArtifact(tx, { sessionId: source.sessionId, baseVersion: 0, kind: "text-draft",
        content: { title: "转交测试", body: "用户提供的材料", intent: "draft", titles: [], tags: [], sources: ["current-message"], partial: false, scope: "用户材料" },
        sourceSnapshot: [{ id: "current-message", kind: "user-material", label: "本次材料", url: null }] }));
      const input = { targetAssistantId: "xiaohongshu", artifactId: saved.artifactId, version: saved.version }, key = randomUUID();
      const target = await handoff(user.id, source.sessionId, input, key);
      const before = (await sql`SELECT count(*)::int n FROM assistant_sessions WHERE owner_user_id=${user.id}`)[0]!.n;
      const credits = await charges();
      const [originalPolicy] = await sql`SELECT value FROM settings WHERE key='assistant.skills.xiaohongshu-creator'`;
      await change(false, "xiaohongshu-creator");
      try {
        assert.deepEqual(await handoff(user.id, source.sessionId, input, key), target);
        await assert.rejects(handoff(user.id, source.sessionId, input, randomUUID()), /暂停/);
        assert.equal((await sql`SELECT count(*)::int n FROM assistant_sessions WHERE owner_user_id=${user.id}`)[0]!.n, before);
        assert.equal(await charges(), credits);
        assert((await skillAdmission(sql, "creative")).candidates.some(candidate => candidate.skillId === "general-writing"));
      } finally { await sql`UPDATE settings SET value=${sql.json(originalPolicy!.value)} WHERE key='assistant.skills.xiaohongshu-creator'`; }
    });
    await t.test("archive emits an event that refreshes another idle window's owned snapshot", async () => {
      const source = await fresh(), otherWindow = await sessionSnapshot(user.id, source.sessionId);
      assert.equal(shouldReadSnapshot(otherWindow.turn, false, false), false);
      await archiveSession(user.id, source.sessionId, false);
      const page = await sessionEvents(user.id, source.sessionId, { after: otherWindow.eventSeq });
      assert(page.events.some(event => event.type === "session" && event.entityId === source.sessionId));
      assert.equal(shouldReadSnapshot(otherWindow.turn, page.events.length > 0, false), true);
      const refreshed = await sessionSnapshot(user.id, source.sessionId);
      assert(refreshed.archived); assert(refreshed.queue?.paused); assert(refreshed.eventSeq > otherWindow.eventSeq);
    });
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
    await t.test("initial request rolls back rejection, binds material once and replays the exact quote after pause", async () => {
      const originalDir = config.dataDir, directory = await mkdtemp(path.join(tmpdir(), "assistant-initial-"));
      config.dataDir = directory;
      try {
        const text = "首次材料，不产生模型调用", file = path.join(directory, "fixture.md");
        await writeFile(file, text);
        const asset = await publishUpload({ actor: `user:${user.id}`, key: uploadKey(`user:${user.id}`, randomUUID()), file, filename: "fixture.md", mime: "text/markdown", bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") });
        const raw = { assistantId: "creative", initialRequest: { message: "用材料写稿", skillSelection: { skillId: "general-writing" }, taskHint: { actionId: "general-writing" }, attachments: [{ assetKey: asset.key }] } };
        const counts = async () => (await sql`SELECT (SELECT count(*) FROM assistant_sessions WHERE owner_user_id=${user.id})::int sessions, (SELECT count(*) FROM member_tool_quotes WHERE user_id=${user.id})::int quotes, (SELECT count(*) FROM member_credit_charges WHERE user_id=${user.id})::int charges, (SELECT count(*) FROM receipts)::int receipts`)[0];
        const before = await counts(), hits = supplier.hits();
        await change(false);
        await assert.rejects(createSession(user.id, raw, randomUUID()), /暂停/);
        assert.deepEqual(await counts(), before);
        await change(true);
        await assert.rejects(createSession(user.id, { ...raw, initialRequest: { ...raw.initialRequest, attachments: [{ assetKey: "uploads/redfox/" + "0".repeat(64) }] } }, randomUUID()), /missing|unavailable/);
        assert.deepEqual(await counts(), before);
        const other = await createSiteUser({ username: `initial_${unique}`, displayName: "Other", password: "synthetic-initial-password" }, "test");
        await assert.rejects(createSession(other.id, raw, randomUUID()), { statusCode: 404 });
        assert.equal((await sql`SELECT count(*)::int n FROM assistant_sessions WHERE owner_user_id=${other.id}`)[0].n, 0);
        const key = randomUUID(), created = await createSession(user.id, raw, key);
        assert(created.initialRequest);
        assert.deepEqual(created.initialRequest.input.skillSelection, { skillId: "general-writing" });
        assert.deepEqual(created.initialRequest.input.taskHint, { actionId: "general-writing" });
        assert.deepEqual(created.initialRequest.quote.additionalFeeKinds, []);
        assert.equal(created.initialRequest.input.expectedRevision, 2);
        assert.equal(created.initialRequest.input.inputIds.length, 1);
        assert.equal((await sessionSnapshot(user.id, created.sessionId)).inputs[0].text, text);
        assert.deepEqual((await sessionSnapshot(user.id, created.sessionId)).initialRequest, created.initialRequest);
        await change(false);
        assert.deepEqual(await createSession(user.id, raw, key), created);
        const after = await counts();
        assert.equal(after.sessions, before.sessions + 1); assert.equal(after.quotes, before.quotes + 1);
        assert.equal(after.charges, before.charges); assert.equal(after.receipts, before.receipts); assert.equal(supplier.hits(), hits);
        await change(true);
        const saved = created.initialRequest;
        await assert.rejects(submitTurn(user.id, created.sessionId, { ...saved.input, quoteId: saved.quote.quoteId }, saved.commandKey), /报价/);
        const quote = await quoteTurn(user.id, created.sessionId, saved.input);
        const accepted = await submitTurn(user.id, created.sessionId, { ...saved.input, quoteId: quote.quoteId }, saved.commandKey);
        assert.equal((await sessionSnapshot(user.id, created.sessionId)).initialRequest, null);
        const [run] = await sql`SELECT generation FROM operation_runs WHERE id=${accepted.runId}`;
        await controlTurn(user.id, created.sessionId, accepted.turnId, "stop", { generation: run.generation });
        // Pruning an expired quote never removes the durable create result or creates a replacement quote.
        const expired = await createSession(user.id, raw, randomUUID()), expiredKey = randomUUID();
        const expiry = await createSession(user.id, raw, expiredKey);
        await sql`UPDATE member_tool_quotes SET expires_at=now()-interval '1 second' WHERE id=${expiry.initialRequest!.quote.quoteId}`;
        assert.deepEqual((await quoteTurn(user.id, expired.sessionId, expired.initialRequest!.input)).additionalFeeKinds, []);
        assert.equal((await sql`SELECT id FROM member_tool_quotes WHERE id=${expiry.initialRequest!.quote.quoteId}`).length, 0);
        assert.deepEqual(await createSession(user.id, raw, expiredKey), expiry);
      } finally { config.dataDir = originalDir; await rm(directory, { recursive: true, force: true }); }
    });
    await t.test("pause-first race rejects atomic creation without leaving a session", async () => {
      const locked = gate(), release = gate();
      const pause = sql.begin(async tx => {
        await lockSkillPolicies(tx, ["general-writing"]);
        await tx`UPDATE settings SET value=jsonb_set(value,'{acceptingNew}','false') WHERE key='assistant.skills.general-writing'`;
        locked.open(); await release.promise;
      });
      await locked.promise;
      const key = randomUUID();
      const creation = createSession(user.id, { assistantId: "creative", initialRequest: { message: "竞态需求", skillSelection: { actionId: "general-writing" } } }, key);
      const rejected = assert.rejects(creation, /暂停/);
      release.open(); await pause; await rejected;
      assert.equal((await sql`SELECT id FROM assistant_sessions WHERE command_key=${key}`).length, 0);
      await change(true);
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
      const scope = await skillAdmission(sql, "creative"); assert(scope.candidates.every(c => c.skillId === "general-writing")); assert(scope.unavailableSkills.some(s => s.skillId === "xiaohongshu-creator"));
      await assert.rejects(skillAdmission(sql, "xiaohongshu"), /暂停/);
      const options = await assistantOptions(user.id); assert(options.assistants.every(a => !a.actions.some(action => action.actionId.startsWith("xiaohongshu-")))); assert.equal(options.assistants.find(a => a.id === "xiaohongshu")!.available, false);
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
      const listed = (await listAssistantSkills()).skills;
      assert.equal((await sql`SELECT count(*)::int n FROM settings`)[0]!.n, count);
      for (const skillId of ["image-generator", "claude-image-generation", "ai-image-generator"]) {
        const dependencies = listed.find(skill => skill.skillId === skillId)!.dependencies.join(" ");
        assert.match(dependencies, /gptImage2/); assert.match(dependencies, /redfox\.image/); assert.match(dependencies, /redfox\.poll/);
        assert.deepEqual(listed.find(skill => skill.skillId === skillId)!.capabilities,["generate_image@1"]);
        assert.match(listed.find(skill => skill.skillId === skillId)!.openScope.join(" "),/1K、单张、无参考图.*本地图片作品/);
      }
      assert.match(listed.find(skill => skill.skillId === "wechat-write")!.dependencies.join(" "), /wechat\.hotArticleNew/);
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
