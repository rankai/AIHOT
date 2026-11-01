import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { createSession, quoteTurn, submitTurn, sessionSnapshot, editArtifact } from "@aihot/backend/assistant/sessions";
import { answerTurn, controlTurn } from "@aihot/backend/assistant/controls";
import { decideCall, localCall, activeTools, sourceCandidates } from "@aihot/backend/assistant/tools";
import { analyzeResearch, researchClock, researchResults, validateResearchWindow, verifyResearchDelivery } from "@aihot/backend/assistant/xhs-research";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { recoverAssistantChildren } from "@aihot/backend/assistant/execution";
import { projectToolResult } from "@aihot/backend/users/tool-results";
import { contextTokens } from "@aihot/backend/assistant/context";
import { buildApp } from "../apps/api/src/app.ts";
import { loginSiteUser } from "@aihot/backend/users/auth";
import { config } from "@aihot/backend/config";
const completion = (name: string, input: unknown) => ({ id: "fixture", created: 1, model: "fixture", choices: [{ index: 0,
  message: { role: "assistant", content: null, tool_calls: [{ id: "call_0", type: "function", function: { name, arguments: JSON.stringify(input) } }] }, finish_reason: "tool_calls" }] });
const analysisInput = (activationId: string, ids: string[]) => ({ activationId, topic: "相机选购", samples: ids.map(sourceId => ({ sourceId, relevance: "真实关键词检索中讨论相机选购，适用新手选购主题" })),
  titlePattern: { sampleIds: ids, observation: "标题使用数字与新手人群" }, contentPattern: { sampleIds: ids, observation: "正文先场景再步骤" },
  tagPattern: { sampleIds: ids, observation: "标签包含相机选购" }, interactionPattern: { sampleIds: ids, observation: "样本互动字段未知，不推算收藏率或热度排名" },
  applicationPlan: "用新手标题、场景开头和相机标签表达选购建议", limitations: [] });
const draft = (ids: string[], urls: string[]) => ({ title: "新手选相机的3个步骤", body: `先确定拍摄场景，再按需求选择。\n\n爆款公式来源：参考真实样本的数字标题和场景结构；互动数据未知。\n${urls.join("\n")}`,
  intent: "draft" as const, titles: ["新手选相机的3个步骤", "先选场景再选相机", "相机新手指南"], tags: ["相机", "选购", "新手", "摄影", "场景"], sources: ids, partial: true, scope: `${ids.length}条已确认有限研究样本；未执行网页热点验证` });
const application = (analysisCallId: string) => ({ analysisCallId, explanation: "采用样本的人群定位和场景结构，用自己的措辞写成笔记" });
const researchDraft = (ids: string[], urls: string[]) => { const { partial, scope, ...content } = draft(ids, urls); return content; };

test("research projection preserves 50 notes plus metadata and Shanghai replay date", () => {
  const clock = researchClock(new Date("2026-10-31T18:00:00Z"));
  assert.deepEqual(clock, { timeZone: "Asia/Shanghai", today: "2026-11-01", earliestDate: "2026-10-02", latestDate: "2026-10-31", defaultStartDate: "2026-10-25" });
  validateResearchWindow(clock, "2026-10-25", "2026-10-31");
  assert.throws(() => validateResearchWindow(clock, "2026-04-01", "2026-04-30"), /不得静默改期/);
  assert.throws(() => validateResearchWindow(clock, "2026-11-01", "2026-11-01"));
  const result = projectToolResult({ id: 1, kind: "xiaohongshu_work", data: { record: { likedCount: 0, collectedCount: 9, commentsCount: 2, totalScore: 11.5 } } });
  assert.equal(result.details.likedCount, 0); assert.equal(result.details.totalScore, 11.5);
  assert.equal(result.details.sharedCount, undefined);
  const projected = researchResults([...Array.from({ length: 50 }, (_, i) => ({ id: i, kind: "xiaohongshu_work", data: { role: "keyword_match", title: "相机", record: { desc: "正文" } } })),
    { id: 51, kind: "xiaohongshu_research", data: { matchedCount: 50, recommendedCount: 3, record: { keyword: "相机", hotTopics: [{ topic: "摄影", articleCount: 10 }], relatedSearches: [{ keyword: "相机选购" }] } } }]);
  assert.equal(projected.results.length, 50); assert.equal(projected.metadata.length, 1);
  assert.equal(projected.metadata[0]!.details.matchedCount, 50);
  assert.match(projected.metadata[0]!.text, /相机选购/);
});

test("M1 persisted search → analysis → draft → credits; bypasses cannot deliver", async (t) => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db.name, db.port);
  const restore = await allowTestBudgetScope(["assistant.text", "redfox.query"], "member");
  const unique = tag(), model = `research-${unique}`, keyword = `相机-${unique}`;
  let sampleCount = 2, invalidAnalysisSent = false;
  let mode = "new", reuseId = "", reuseSources: string[] = [], reuseUrls: string[] = [], artifactId = "";
  const supplier = await stub((_hit, req) => {
    const body = JSON.parse(req.body), messages = body.messages.filter((m: any) => m.role === "tool").map((m: any) => JSON.parse(m.content));
    const loaded = messages.find((m: any) => m.activationId && m.entry);
    if (!loaded) return completion("load_skill", { skillId: "xiaohongshu-creator", moduleId: mode === "m2" ? "M2" : "M1" });
    const activationId = loaded.activationId;
    if (mode === "downgrade") {
      const rewrite = messages.find((m: any) => m.moduleId === "M2" && m.entry);
      return rewrite ? completion("save_draft", { activationId: rewrite.activationId, kind: "xhs-note", baseVersion: 0,
        content: { ...draft(["current-message"], []), intent: "rewrite" } }) : completion("load_skill", { skillId: "xiaohongshu-creator", moduleId: "M2" });
    }
    if (mode === "m2") return completion("save_draft", { activationId, kind: "xhs-note", baseVersion: 0,
      content: { ...draft(["current-message"], []), intent: "rewrite", partial: false, titles: [] } });
    if (mode === "reuse") return completion("save_draft", { activationId, kind: "xhs-note", artifactId, baseVersion: 2,
      content: researchDraft(reuseSources, reuseUrls), researchApplication: application(reuseId) });
    if (messages.some((m: any) => m.rejected)) return completion("ask_question", { text: "你已拒绝付费检索，创作暂停。" });
    const search = messages.find((m: any) => m.results);
    if (!search) {
      const system = body.messages.find((m: any) => m.role === "system").content;
      const clock = JSON.parse(system.slice(system.indexOf("\n可信的冻结目录及限制：") + "\n可信的冻结目录及限制：".length)).researchClock;
      return completion("search_xhs_notes", { activationId, keyword, startDate: clock.defaultStartDate, endDate: clock.latestDate });
    }
    const analysis = messages.find((m: any) => m.analysisCallId);
    const ids = search.results.filter((r: any) => r.details.role === "keyword_match").map((r: any) => `search:${r.id}`);
    if (!ids.length) return completion("ask_question", { text: "未取得可用主题样本，创作暂停。" });
    if (!analysis) {
      if (mode === "new" && sampleCount === 2 && !invalidAnalysisSent) {
        invalidAnalysisSent = true;
        const { interactionPattern, ...invalid } = analysisInput(activationId, ids);
        return completion("analyze_xhs_research", invalid);
      }
      return completion("analyze_xhs_research", analysisInput(activationId, ids));
    }
    return completion("save_draft", { activationId, kind: "xhs-note", baseVersion: 0,
      content: researchDraft(ids.slice(0, 2), search.results.slice(0, 2).map((r: any) => r.url)), researchApplication: application(analysis.analysisCallId) });
  });
  const redfox = await stub(() => ({ articles: Array.from({ length: sampleCount }, (_, index) => index + 1).map(i => ({ id: `fixture-${i}`, title: `新手选相机${i}`, desc: "先看拍摄场景，再做选购比较。#相机 #选购".repeat(sampleCount === 50 ? 50 : 1), shareInfoLink: `https://www.xiaohongshu.com/explore/fixture-${i}` })),
    latestHotArticles: [{ id: "recommendation", title: "无关美妆推荐", desc: "推荐", shareInfoLink: "https://www.xiaohongshu.com/explore/unrelated" }], keyword, hotTopics: [{ topic: "相机选购" }] }));
  const previous = config.allowPrivateNetworkFetch;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    Object.assign(process.env, { ASSISTANT_ENABLED: "true", ASSISTANT_CALLS_ENABLED: "true", ASSISTANT_MODEL_VERIFIED: "true", ASSISTANT_MODEL: "default", LLM_MODEL: model,
      LLM_BASE_URL: supplier.url + "/v1", LLM_API_KEY: "synthetic-key", ASSISTANT_TOKENIZER: "cl100k_base", MODEL_CALLS_ENABLED: "true",
      REDFOX_TEST_BASE_URL: redfox.url, REDFOX_API_KEY: "synthetic-key", REDFOX_CALLS_ENABLED: "true" });
    config.allowPrivateNetworkFetch = true;
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('assistant.text','redfox.query')`;
    await saveToolPrice({ kind: "assistant-turn", provider: "assistant", model, baseCredits: 7, enabled: true, reason: "Synthetic M1 research fixture" }, "test");
    await saveToolPrice({ kind: "query", provider: "redfox", model: "3X8FGEEM", parameterMatch: { "parameters.keyword": keyword }, baseCredits: 3, enabled: true, reason: "Synthetic M1 research fixture" }, "test");
    const user = await createSiteUser({ username: `research_${unique}`, displayName: "Research", password: "synthetic-password" }, "test");
    await grantCredits(user.id, { amount: 100, reason: "Synthetic M1 credits" }, "test", randomUUID());
    app = await buildApp();
    const login = await loginSiteUser({ username: user.username, password: "synthetic-password" });
    const headers = { cookie: `aihot_user=${login.token}`, "x-csrf-token": login.principal.csrf };
    const post = async (path: string, payload: any, commandKey = randomUUID()) => {
      const response = await app!.inject({ method: "POST", url: `/api/assistant/${path}`, headers: { ...headers, "idempotency-key": commandKey }, payload });
      assert(response.statusCode >= 200 && response.statusCode < 300, response.body); return response.json();
    };
    const { sessionId } = await post("sessions", { assistantId: "xiaohongshu" });
    const input = { message: "用相机关键词写笔记，个人风格不提供", expectedRevision: 1, skillSelection: { actionId: "xiaohongshu-write" } };
    const quote = await post(`sessions/${sessionId}/quote`, input), key = randomUUID();
    const turn = await post(`sessions/${sessionId}/turns`, { ...input, quoteId: quote.quoteId }, key);
    const advance = async (id: number) => { const [run] = await sql`SELECT step_version FROM operation_runs WHERE id=${id}`; return executeOperationStep(id, run.step_version, randomUUID()); };
    for (let i = 0; i < 4; i++) await advance(turn.runId);
    let snap = await sessionSnapshot(user.id, sessionId);
    assert.equal(snap.turn?.phase, "waiting_approval");
    assert.equal(redfox.hits(), 0);
    const proposal = snap.turn!.calls[0]!;
    await post(`sessions/${sessionId}/tool-calls/${proposal.callId}/approve`, { proposalRevision: 1 });
    const [searchCall] = await sql`SELECT * FROM assistant_tool_calls WHERE id=${proposal.callId}`;
    await advance(searchCall.child_run_id);
    await recoverAssistantChildren(searchCall.child_run_id);
    for (let i = 0; i < 5; i++) await advance(turn.runId);
    snap = await sessionSnapshot(user.id, sessionId);
    assert.equal(snap.turn?.phase, "executing");
    const [analysis] = await sql`SELECT * FROM assistant_tool_calls WHERE turn_id=${turn.turnId} AND name='analyze_xhs_research' AND state='completed'`;
    assert.equal(analysis.state, "completed"); assert.equal(analysis.result.samples.length, 2);
    const [invalidAnalysis] = await sql`SELECT result FROM assistant_tool_calls WHERE turn_id=${turn.turnId} AND name='analyze_xhs_research' AND state='failed'`;
    assert.equal(invalidAnalysis.result.error, "invalid_tool_arguments");
    const [correction] = await sql`SELECT count(*)::int n FROM assistant_messages WHERE turn_id=${turn.turnId} AND role='tool' AND model_message::text LIKE '%invalid_tool_arguments%'`;
    assert.equal(correction.n, 1, "failed analysis arguments reach the model for correction instead of crashing summary projection");
    assert.equal(analysis.result.samples[0].metrics.likedCount, null);
    assert.equal(snap.artifacts.length, 0); assert.equal(redfox.hits(), 1);
    const [frozen] = await sql`SELECT * FROM assistant_turns WHERE id=${turn.turnId}`;
    const [activation] = await sql`SELECT * FROM assistant_activations WHERE turn_id=${turn.turnId}`;
    const sources = await sql.begin(tx => sourceCandidates(tx, frozen));
    const ids = analysis.result.samples.map((s: any) => s.sourceId), urls = analysis.result.samples.map((s: any) => s.url);
    const content = draft(ids, urls);
    await t.test("server rejects missing analysis, forged samples and recommendation fallback", async () => {
      const check = (raw: unknown) => sql.begin(tx => verifyResearchDelivery(tx, frozen, activation.id, content, sources, raw));
      await assert.rejects(check(undefined));
      await assert.rejects(check(application(randomUUID())), /真实检索/);
      const verified = await check(application(analysis.id));
      assert.equal(verified.content.partial, true);
      assert.match(verified.content.scope, /2条实际研究样本/);
      await assert.rejects(sql.begin(tx => analyzeResearch(tx, frozen, randomUUID(), analysisInput(activation.id, ["search:999999999"]))), /分析样本/);
      const recommendation = sources.find(s => s.label === "无关美妆推荐")!;
      await assert.rejects(sql.begin(tx => analyzeResearch(tx, frozen, randomUUID(), analysisInput(activation.id, [recommendation.id]))), /推荐结果不能代替/);
      const { tools } = await sql.begin(tx => activeTools(tx, frozen));
      for (const partial of [true, false]) await assert.rejects(sql.begin(tx => localCall(tx, frozen, { request_snapshot: { tools } }, { name: "save_draft", input: { activationId: activation.id, kind: "xhs-note", baseVersion: 0, content: { ...content, partial, sources: ["current-message"] } } })));
      await sql`UPDATE assistant_tool_calls SET state='failed' WHERE id=${searchCall.id}`;
      await assert.rejects(sql.begin(tx => analyzeResearch(tx, frozen, randomUUID(), analysisInput(activation.id, ids))), /分析样本/);
      await sql`UPDATE assistant_tool_calls SET state='completed' WHERE id=${searchCall.id}`;
    });
    await controlTurn(user.id, sessionId, turn.turnId, "stop", { generation: snap.turn!.generation });
    snap = await sessionSnapshot(user.id, sessionId);
    await controlTurn(user.id, sessionId, turn.turnId, "resume", { generation: snap.turn!.generation });
    snap = await sessionSnapshot(user.id, sessionId);
    assert.equal(snap.turn?.phase, "executing");
    assert.equal((await sql`SELECT count(*)::int n FROM assistant_tool_calls WHERE turn_id=${turn.turnId} AND name='analyze_xhs_research' AND state='completed'`)[0]!.n, 1);
    assert.equal(redfox.hits(), 1);
    // Accepted command replay freezes date and must neither duplicate search nor reserve again.
    assert.deepEqual(await submitTurn(user.id, sessionId, { ...input, quoteId: quote.quoteId }, key), turn);
    for (let i = 0; i < 2; i++) await advance(turn.runId);
    snap = await sessionSnapshot(user.id, sessionId);
    assert.equal(snap.turn?.status, "completed"); assert.equal(snap.artifacts.length, 1);
    assert.equal((await sql`SELECT count(*)::int n FROM assistant_tool_calls WHERE turn_id=${turn.turnId} AND name='ask_question'`)[0]!.n, 0, "two usable samples deliver without a scope question");
    assert.equal(snap.artifacts[0]!.sources[0]!.research!.analysisCallId, analysis.id);
    assert(snap.turn!.activities!.some(a => a.kind === "analyze_xhs_research" && a.state === "completed"));
    const charges = await sql`SELECT amount,state FROM member_credit_charges WHERE root_run_id IN (${turn.runId},${searchCall.child_run_id})`;
    assert.deepEqual(charges.map(c => c.amount).sort(), [3, 7]); assert(charges.every(c => c.state === "settled"));
    assert.equal(redfox.hits(), 1);
    await t.test("manual edits cannot mint verification; exact selected verified version reuses analysis without research", async () => {
      artifactId = snap.artifacts[0]!.artifactId; reuseId = analysis.id; reuseSources = ids; reuseUrls = urls;
      await editArtifact(user.id, sessionId, artifactId, { baseVersion: 1, kind: "xhs-note", content: { ...content, body: content.body + "\n手工修订" } });
      const revision = (await sessionSnapshot(user.id, sessionId)).revision;
      mode = "reuse";
      const revise = { message: "按已有分析修订", expectedRevision: revision, artifactVersions: [{ artifactId, version: 1 }], skillSelection: { actionId: "xiaohongshu-write" } };
      const quoted = await quoteTurn(user.id, sessionId, revise);
      const next = await submitTurn(user.id, sessionId, { ...revise, quoteId: quoted.quoteId }, randomUUID());
      for (let i = 0; i < 4; i++) await advance(next.runId);
      const saved = await sessionSnapshot(user.id, sessionId);
      assert.equal(saved.turn?.status, "completed"); assert.equal(saved.artifacts[0]!.version, 3); assert.equal(redfox.hits(), 1);
      assert.equal(saved.artifacts[0]!.sources[0]!.research!.analysisCallId, analysis.id);
      const [newTurn] = await sql`SELECT * FROM assistant_turns WHERE id=${next.turnId}`;
      for (const target of [undefined, { baseVersion: 0 }, { artifactId, baseVersion: 0 }, { artifactId: randomUUID(), baseVersion: 1 }])
        await assert.rejects(sql.begin(tx => verifyResearchDelivery(tx, newTurn, randomUUID(), content, sources, application(analysis.id), target)), /选定的已验证/);
      const offered = await sql.begin(tx => activeTools(tx, newTurn));
      assert(offered.tools.save_draft.schema.required.includes("artifactId"));
      assert.deepEqual(offered.tools.save_draft.schema.properties.artifactId.enum, [artifactId]);
      await assert.rejects(sql.begin(async tx => {
        // An existing version with the same URLs but no server verification must never upgrade.
        const bare = saved.artifacts[0]!.sources.map(({ research, ...source }) => source);
        await tx`UPDATE assistant_artifact_versions SET source_snapshot=${tx.json(bare as never)} WHERE session_id=${sessionId} AND artifact_id=${artifactId} AND version=1`;
        await assert.rejects(verifyResearchDelivery(tx, newTurn, randomUUID(), content, sources, application(analysis.id), { artifactId, baseVersion: 2 }), /选定的已验证/);
        throw new Error("rollback historical unverified fixture");
      }), /rollback historical/);

      await assert.rejects(sql.begin(tx => verifyResearchDelivery(tx, { ...newTurn, snapshot: { ...newTurn.snapshot, selected: [] } }, randomUUID(), content, sources, application(analysis.id))), /选定的已验证/);
    });
    await t.test("empty search and declined paid search pause; ordinary questions can answer and resume", async () => {
      for (const state of ["empty", "decline"]) {
        mode = state; sampleCount = state === "empty" ? 0 : 2;
        const session = await createSession(user.id, { assistantId: "xiaohongshu" }, randomUUID());
        const raw = { message: "相机笔记，风格不提供", expectedRevision: 1, skillSelection: { actionId: "xiaohongshu-write" } };
        const q = await quoteTurn(user.id, session.sessionId, raw), run = await submitTurn(user.id, session.sessionId, { ...raw, quoteId: q.quoteId }, randomUUID());
        for (let i = 0; i < 4; i++) await advance(run.runId);
        const pending = (await sessionSnapshot(user.id, session.sessionId)).turn!.calls[0]!;
        const callsBefore = redfox.hits();
        await decideCall(user.id, session.sessionId, pending.callId, state !== "decline", { proposalRevision: 1 }, randomUUID());
        if (state === "empty") {
          const [child] = await sql`SELECT child_run_id FROM assistant_tool_calls WHERE id=${pending.callId}`;
          await advance(child.child_run_id); await recoverAssistantChildren(child.child_run_id);
        }
        for (let i = 0; i < 5; i++) await advance(run.runId);
        let result = await sessionSnapshot(user.id, session.sessionId);
        assert.equal(result.turn?.phase, "waiting_question"); assert.equal(result.artifacts.length, 0);
        if (state === "empty") {
          await answerTurn(user.id, session.sessionId, run.turnId, { questionId: result.turn!.question!.questionId, expectedRevision: result.revision, answer: "稍后再处理" });
          const [record] = await sql`SELECT snapshot FROM assistant_turns WHERE id=${run.turnId}`;
          assert.equal(Object.keys(record.snapshot.answers).length, 1);
          for (let i = 0; i < 2; i++) await advance(run.runId);
          result = await sessionSnapshot(user.id, session.sessionId);
          assert.equal(result.turn?.phase, "waiting_question"); assert.equal(result.artifacts.length, 0);
        } else assert.equal(redfox.hits(), callsBefore, "declined fee approval never dispatches search");
        const [loaded] = await sql`SELECT * FROM assistant_turns WHERE id=${run.turnId}`;
        const visible = await sql.begin(tx => activeTools(tx, loaded));
        assert(!visible.tools.save_draft, "save is unavailable without real usable research");
        await controlTurn(user.id, session.sessionId, run.turnId, "stop", { generation: result.turn!.generation });
      }
    });
    await t.test("50 realistic Chinese notes reach save within the frozen 24k context", async () => {
      sampleCount = 50; mode = "new";
      const session = await createSession(user.id, { assistantId: "xiaohongshu" }, randomUUID());
      const raw = { message: "相机选购，个人风格不提供", expectedRevision: 1, skillSelection: { actionId: "xiaohongshu-write" } };
      const q = await quoteTurn(user.id, session.sessionId, raw), run = await submitTurn(user.id, session.sessionId, { ...raw, quoteId: q.quoteId }, randomUUID());
      for (let i = 0; i < 4; i++) await advance(run.runId);
      const pending = (await sessionSnapshot(user.id, session.sessionId)).turn!.calls[0]!;
      await decideCall(user.id, session.sessionId, pending.callId, true, { proposalRevision: 1 }, randomUUID());
      const [child] = await sql`SELECT child_run_id FROM assistant_tool_calls WHERE id=${pending.callId}`;
      await advance(child.child_run_id); await recoverAssistantChildren(child.child_run_id);
      for (let i = 0; i < 5; i++) await advance(run.runId);
      const result = await sessionSnapshot(user.id, session.sessionId);
      assert.equal(result.turn?.status, "completed");
      const [analyzed] = await sql`SELECT result FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='analyze_xhs_research'`;
      assert.equal(analyzed.result.samples.length, 50);
      assert.equal((await sql`SELECT count(*)::int n FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='ask_question'`)[0]!.n, 0, "truncated samples disclose limits without an extra scope confirmation");
      assert(analyzed.result.samples.some((sample: any) => sample.textTruncated));
      const steps = await sql`SELECT request_snapshot FROM assistant_model_steps WHERE turn_id=${run.turnId}`;
      for (const step of steps) assert(contextTokens(JSON.stringify(step.request_snapshot)) + 256 <= 24000);
      assert.equal(result.artifacts[0]!.content.partial, true, "no web hotspot verification cannot be claimed complete upstream research");
      assert.match(result.artifacts[0]!.content.body, /作者主页：未知/);
      assert.match(result.artifacts[0]!.content.body, /标题：标题使用数字与新手人群/);
    });
    await t.test("automatic routing cannot silently downgrade activated M1 through M2", async () => {
      mode = "downgrade";
      const session = await createSession(user.id, { assistantId: "creative" }, randomUUID());
      const raw = { message: "帮我写小红书笔记", expectedRevision: 1 };
      const q = await quoteTurn(user.id, session.sessionId, raw), run = await submitTurn(user.id, session.sessionId, { ...raw, quoteId: q.quoteId }, randomUUID());
      for (let i = 0; i < 6; i++) await advance(run.runId);
      const result = await sessionSnapshot(user.id, session.sessionId);
      assert.equal(result.artifacts.length, 0);
      const [frozen] = await sql`SELECT * FROM assistant_turns WHERE id=${run.turnId}`;
      const [rewrite] = await sql`SELECT id FROM assistant_activations WHERE turn_id=${run.turnId} AND candidate->>'moduleId'='M2'`;
      assert(rewrite);
      await assert.rejects(sql.begin(tx => localCall(tx, frozen, { request_snapshot: { tools: { save_draft: {} } } }, { name: "save_draft", input: {
        activationId: rewrite.id, kind: "xhs-note", baseVersion: 0, content: { ...draft(["current-message"], []), intent: "rewrite" },
      } })), /不能改用其他模块静默降级/);
      await controlTurn(user.id, session.sessionId, run.turnId, "stop", { generation: result.turn!.generation });
    });
    await t.test("M2 remains rewrite without research", async () => {
      mode = "m2";
      const rewriteUser = await createSiteUser({ username: `rewrite_${unique}`, displayName: "Rewrite", password: "synthetic-password" }, "test");
      await grantCredits(rewriteUser.id, { amount: 20, reason: "Independent M2 fixture" }, "test", randomUUID());
      const session = await createSession(rewriteUser.id, { assistantId: "xiaohongshu" }, randomUUID());
      const raw = { message: "改写我的原稿", expectedRevision: 1, skillSelection: { actionId: "xiaohongshu-rewrite" } };
      const q = await quoteTurn(rewriteUser.id, session.sessionId, raw), run = await submitTurn(rewriteUser.id, session.sessionId, { ...raw, quoteId: q.quoteId }, randomUUID());
      for (let i = 0; i < 4; i++) await advance(run.runId);
      const result = await sessionSnapshot(rewriteUser.id, session.sessionId);
      assert.equal(result.turn?.status, "completed"); assert.equal(redfox.hits(), 3);
    });
  } finally {
    await app?.close();
    config.allowPrivateNetworkFetch = previous;
    await supplier.close(); await redfox.close(); await stopBoss(); await restore(); await closeDb();
  }
});
