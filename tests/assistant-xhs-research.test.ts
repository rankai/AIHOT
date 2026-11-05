import { currentSkillVersions } from "@aihot/backend/assistant/bindings";
import { researchDateRange } from "@aihot/backend/assistant/research-window";
import { finishResearchTask } from "./assistant-research-window-fixture.ts";
import { quoteLegacyTurn, submitLegacyTurn as submitTurn } from "./assistant-legacy-fixture.ts";
import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { createSession, quoteTurn as currentQuoteTurn, submitTurn as currentSubmitTurn, sessionSnapshot, editArtifact } from "@aihot/backend/assistant/sessions";
import { answerTurn, controlAssistantOperation, controlTurn } from "@aihot/backend/assistant/controls";
import { claimRun, setRunState } from "@aihot/backend/providers/operations/store";
import { decideCall, localCall, activeTools, sourceCandidates, prepareSearch, DraftArgumentsError } from "@aihot/backend/assistant/tools";
import { analyzeResearch, researchClock, researchResults, validateResearchWindow, verifyResearchDelivery } from "@aihot/backend/assistant/xhs-research";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { recoverAssistantChildren } from "@aihot/backend/assistant/execution";
import { projectToolResult } from "@aihot/backend/users/tool-results";
import { contextTokens } from "@aihot/backend/assistant/context";
import { projectArticleVersions } from "@aihot/backend/assistant/article-research";
import { buildApp } from "../apps/api/src/app.ts";
import { loginSiteUser } from "@aihot/backend/users/auth";
import { config } from "@aihot/backend/config";
const completion = (name: string, input: unknown) => ({ id: "fixture", created: 1, model: "fixture", choices: [{ index: 0,
  message: { role: "assistant", content: null, tool_calls: [{ id: "call_0", type: "function", function: { name, arguments: JSON.stringify(input) } }] }, finish_reason: "tool_calls" }] });
const analysisInput = (activationId: string, ids: string[]) => ({ activationId, topic: "相机选购", samples: ids.map(sourceId => ({ sourceId, relevance: "真实关键词检索中讨论相机选购，适用新手选购主题" })),
  titlePattern: { sampleIds: ids, observation: "标题使用数字与新手人群" }, contentPattern: { sampleIds: ids, observation: "正文先场景再步骤" },
  tagPattern: { sampleIds: ids, observation: "标签包含相机选购" }, interactionPattern: { sampleIds: ids, observation: "接口没有给出互动数据，不能据此比较热度" },
  applicationPlan: "用新手标题、场景开头和相机标签表达选购建议", limitations: [] });
const publishableBody = "先确定拍摄场景，再按需求选择。";
const draft = (ids: string[], _urls: string[]) => ({ title: "新手选相机的3个步骤", body: publishableBody,
  intent: "draft" as const, titles: ["新手选相机的3个步骤", "先选场景再选相机", "相机新手指南"], tags: ["相机", "选购", "新手", "摄影", "场景"], sources: ids, partial: true, scope: `${ids.length}条已确认有限研究样本；未执行网页热点验证` });
const application = (analysisCallId: string) => ({ analysisCallId, explanation: "采用样本的人群定位和场景结构，用自己的措辞写成笔记" });
const researchDraft = (ids: string[], urls: string[]) => { const { partial, scope, ...content } = draft(ids, urls); return content; };

test("research projection preserves 50 notes plus metadata and Shanghai replay date", () => {
  const clock = researchClock(new Date("2026-10-31T18:00:00Z"));
  assert.deepEqual(clock, { timeZone: "Asia/Shanghai", today: "2026-11-01", earliestDate: "2026-10-02", latestDate: "2026-10-31", defaultStartDate: "2026-10-25" });
  assert.equal(researchDateRange("查询相机笔记，写一篇《只查一次》", clock).maximumQueries, 2);
  assert.equal(researchDateRange("查询相机笔记，写一篇《只查一次》，不要扩大时间范围", clock).maximumQueries, 1);
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
  const sparse = researchResults([{ id: 60, kind: "xiaohongshu_work", data: { role: "keyword_match", title: "真实标题", record: { title: "真实标题", likedCount: 0 } } },
    { id: 61, kind: "xiaohongshu_work", data: { role: "keyword_match", title: "小红书洞察笔记", record: { id: "missing-title" } } }]);
  assert.deepEqual(sparse.validSampleIds, ["search:60"]);
  assert.deepEqual(sparse.results[0]!.availableDimensions, ["titlePattern", "interactionPattern"]);
  assert.equal(sparse.results[0]!.url, null);
  const longTitle = "真实标题".repeat(30) + "#未显示标签";
  const clipped = researchResults([{ id: 62, kind: "xiaohongshu_work", data: { role: "keyword_match", title: longTitle, record: { title: longTitle } } }]);
  assert.equal(clipped.results[0]!.title.length, 120);
  assert(!clipped.results[0]!.title.includes("#"));
  assert.deepEqual(clipped.results[0]!.availableDimensions, ["titlePattern"], "a tag beyond the displayed title cannot support tag analysis");
  const capped = researchResults(Array.from({ length: 51 }, (_, i) => ({ id: 100 + i, kind: "xiaohongshu_work", data: { role: "keyword_match", title: i ? "真实标题" : "小红书洞察笔记", record: i ? { title: "真实标题" } : { id: "missing-title" } } })));
  assert.equal(capped.validSampleIds.length, 49);
  assert(!capped.validSampleIds.includes("search:150"), "unshown notes do not enter the eligible evidence set");
});

test("M1 persisted search → analysis → draft → credits; bypasses cannot deliver", async (t) => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db.name, db.port);
  const [priorXhsPolicy] = await sql`SELECT value FROM settings WHERE key='assistant.skills.xiaohongshu-creator'`;
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
      content: { ...researchDraft(reuseSources, reuseUrls), intent: "rewrite", titles: [], tags: [] }, researchApplication: application(reuseId) });
    if (messages.some((m: any) => m.rejected)) return completion("ask_question", { text: "你已拒绝付费检索，创作暂停。" });
    const search = messages.filter((m: any) => m.results).at(-1);
    if (!search) {
      const system = body.messages.find((m: any) => m.role === "system").content;
      const clock = JSON.parse(system.slice(system.indexOf("\n可信的冻结目录及限制：") + "\n可信的冻结目录及限制：".length)).researchClock;
      return completion("search_xhs_notes", { activationId, keyword, startDate: clock.defaultStartDate, endDate: clock.latestDate });
    }
    const analysis = messages.find((m: any) => m.analysisCallId);
    const ids = search.results.filter((r: any) => r.details.role === "keyword_match").map((r: any) => `search:${r.id}`);
    if (!ids.length) return completion("ask_question", { text: "未取得可用主题样本，创作暂停。" });
    if (!analysis) {
      if (mode === "case55") {
        // Same relative positions as the real 708…757 results. 717 has no body;
        // 732 is a returned note but was not among the sixteen explicitly listed samples.
        const selected = [0,5,11,32,36,37,34,12,23,8,4,9,15,21,47,1];
        const proposal = analysisInput(activationId, selected.map(i => ids[i]!));
        proposal.interactionPattern.sampleIds = [ids[0]!, ids[24]!];
        return completion("analyze_xhs_research", proposal);
      }
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
  const windows: Record<string,string>[] = [];
  const redfox = await stub((_n,req) => { windows.push(JSON.parse(req.body)); return ({ articles: Array.from({ length: mode==="expand-hit" && windows.length===1 ? 0 : sampleCount }, (_, index) => index + 1).map(i => ({ id: `fixture-${i}`, title: `新手选相机${i}`, desc: mode === "case55" && (i === 10 || i === 50) ? "" : "先看拍摄场景，再做选购比较。#相机 #选购".repeat(sampleCount === 50 ? 50 : 1), shareInfoLink: `https://www.xiaohongshu.com/explore/fixture-${i}`, ...(mode === "case55" ? { likedCount: i } : {}) })),
    latestHotArticles: mode === "case55" ? [] : [{ id: "recommendation", title: "无关美妆推荐", desc: "推荐", shareInfoLink: "https://www.xiaohongshu.com/explore/unrelated" }], keyword, hotTopics: [{ topic: "相机选购" }] }); });
  const [priorQueryPrice]=await sql`SELECT * FROM member_tool_prices WHERE kind='query' AND provider='redfox' AND model='3X8FGEEM' AND tier='' AND parameter_match='{}'::jsonb`;
  const previous = config.allowPrivateNetworkFetch;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await sql`INSERT INTO settings(key,value,updated_by) VALUES ('assistant.skills.xiaohongshu-creator','{"acceptingNew":true,"revision":1}'::jsonb,'test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    Object.assign(process.env, { ASSISTANT_ENABLED: "true", ASSISTANT_CALLS_ENABLED: "true", ASSISTANT_MODEL_VERIFIED: "true", ASSISTANT_MODEL: "default", LLM_MODEL: model,
      LLM_BASE_URL: supplier.url + "/v1", LLM_API_KEY: "synthetic-key", ASSISTANT_TOKENIZER: "cl100k_base", MODEL_CALLS_ENABLED: "true",
      REDFOX_TEST_BASE_URL: redfox.url, REDFOX_API_KEY: "synthetic-key", REDFOX_CALLS_ENABLED: "true" });
    config.allowPrivateNetworkFetch = true;
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('assistant.text','redfox.query')`;
    await saveToolPrice({ kind: "assistant-turn", provider: "assistant", model, baseCredits: 7, enabled: true, reason: "Synthetic M1 research fixture" }, "test");
    await saveToolPrice({...(priorQueryPrice?{id:priorQueryPrice.id,expectedVersion:priorQueryPrice.version}:{}),kind:'query',provider:'redfox',model:'3X8FGEEM',baseCredits:3,enabled:true,reason:'Synthetic task query ceiling'},'test');
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
    assert.equal(snap.turn?.phase, "waiting_child");
    assert.equal(redfox.hits(), 0);
    const proposal = snap.turn!.calls[0]!;
    assert.equal(quote.amount,13);assert.equal(quote.task.items.length,2);
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
    const smallRequests = await sql`SELECT request_snapshot FROM assistant_model_steps WHERE turn_id=${turn.turnId}`;
    assert(smallRequests.every(step => !JSON.stringify(step.request_snapshot).includes('"contextProjection"')), "requests within the frozen limit keep their full original context");
    const [frozen] = await sql`SELECT * FROM assistant_turns WHERE id=${turn.turnId}`;
    const [activation] = await sql`SELECT * FROM assistant_activations WHERE turn_id=${turn.turnId}`;
    for (const dates of [{ startDate: "2026-02-30", endDate: frozen.snapshot.researchClock.latestDate },
      { startDate: frozen.snapshot.researchClock.today, endDate: frozen.snapshot.researchClock.today }]) {
      await assert.rejects(prepareSearch(frozen, { name: "search_xhs_notes", input: { activationId: activation.id, keyword, ...dates } }), DraftArgumentsError);
    }
    const sources = await sql.begin(tx => sourceCandidates(tx, frozen));
    const ids = analysis.result.samples.map((s: any) => s.sourceId), urls = analysis.result.samples.map((s: any) => s.url);
    const content = draft(ids, urls);
    await t.test("title and interaction evidence deliver without bodies or links and cannot support missing dimensions", async () => {
      await assert.rejects(sql.begin(async tx => {
        for (const [index, id] of ids.entries()) await tx`UPDATE operation_results SET data=${tx.json({ role: "keyword_match", title: `真实标题${index}`, record: { title: `真实标题${index}`, likedCount: 0 } })} WHERE id=${Number(id.slice(7))}`;
        const actual = await analyzeResearch(tx, frozen, analysis.id, analysisInput(activation.id, ids));
        assert.equal(actual.samples.length, 2); assert(actual.samples.every(s => !s.text && s.url === null));
        assert.deepEqual(actual.patterns.title.sampleIds, ids); assert.deepEqual(actual.patterns.interaction.sampleIds, ids);
        assert.deepEqual(actual.patterns.content.sampleIds, []); assert.deepEqual(actual.patterns.tags.sampleIds, []);
        assert.match(actual.limitations.join("；"), /未返回正文/); assert.match(actual.limitations.join("；"), /未返回可验证原文链接/);
        await tx`UPDATE assistant_tool_calls SET result=${tx.json(actual)} WHERE id=${analysis.id}`;
        const verified = await verifyResearchDelivery(tx, frozen, activation.id, content, await sourceCandidates(tx, frozen), application(analysis.id));
        assert.match(verified.content.body, /原文链接未返回/); assert.match(verified.content.body, /内容结构：本维度没有可用研究依据/);
        assert(!verified.content.body.includes("：null"));
        throw new Error("rollback sparse evidence fixture");
      }), /rollback sparse evidence fixture/);
    });
    await t.test("draft uses actual analyzed samples and excludes forged or recommended sources", async () => {
      const check = (raw: unknown) => sql.begin(tx => verifyResearchDelivery(tx, frozen, activation.id, content, sources, raw));
      await assert.rejects(check(application(randomUUID())), /真实检索/);
      const verified = await check(application(analysis.id));
      assert.equal(verified.content.partial, true);
      assert.match(verified.content.scope, /2条实际研究样本/);
      for (const citations of [[ids[0]], ["current-message"]]) {
        const v = await sql.begin(tx => verifyResearchDelivery(tx, frozen, activation.id, { ...content, sources: citations }, sources, application(analysis.id)));
        const evidence = v.sources.filter((s: any) => v.content.sources.includes(s.id) && s.research?.analysisCallId === analysis.id);
        assert(evidence.length > 0 && evidence.every((s: any) => ids.includes(s.id)));
        if (citations[0] === ids[0]) assert.equal(evidence.length, 1, "one real source is sufficient");
      }
      await assert.rejects(sql.begin(tx => analyzeResearch(tx, frozen, randomUUID(), analysisInput(activation.id, ["search:999999999"]))));
      const recommendation = sources.find(s => s.label === "无关美妆推荐")!;
      await assert.rejects(sql.begin(tx => analyzeResearch(tx, frozen, randomUUID(), analysisInput(activation.id, [recommendation.id]))));
      await sql`UPDATE assistant_tool_calls SET state='failed' WHERE id=${searchCall.id}`;
      await assert.rejects(sql.begin(tx => analyzeResearch(tx, frozen, randomUUID(), analysisInput(activation.id, ids))));
      await sql`UPDATE assistant_tool_calls SET state='completed' WHERE id=${searchCall.id}`;
    });
    assert.equal((await sql`SELECT count(*)::int n FROM assistant_tool_calls WHERE turn_id=${turn.turnId} AND name='analyze_xhs_research' AND state='completed'`)[0]!.n, 1);
    assert.equal(redfox.hits(), 1);
    // Accepted command replay freezes date and must neither duplicate search nor reserve again.
    assert.deepEqual(await currentSubmitTurn(user.id, sessionId, { ...input, quoteId: quote.quoteId }, key), turn);
    for (let i = 0; i < 2; i++) await advance(turn.runId);
    snap = await sessionSnapshot(user.id, sessionId);
    assert.equal(snap.turn?.status, "completed"); assert.equal(snap.artifacts.length, 1);
    assert.equal((await sql`SELECT count(*)::int n FROM assistant_tool_calls WHERE turn_id=${turn.turnId} AND name='ask_question'`)[0]!.n, 0, "two usable samples deliver without a scope question");
    assert.equal(snap.artifacts[0]!.sources[0]!.research!.analysisCallId, analysis.id);
    const [persisted] = await sql`SELECT content,source_snapshot FROM assistant_artifact_versions WHERE session_id=${sessionId} AND artifact_id=${snap.artifacts[0]!.artifactId} AND version=1`;
    assert.equal(persisted!.content.body, publishableBody, "new module persists exactly the publishable model body, without a system appendix");
    assert.equal(persisted!.content.research.analysisCallId, analysis.id);
    assert.equal(persisted!.content.research.application, application(analysis.id).explanation);
    assert(persisted!.content.research.patterns.some((pattern: any) => pattern.label === "标题" && pattern.observation === analysis.result.patterns.title.observation));
    assert.deepEqual(persisted!.content.research.references.map((reference: any) => reference.url), urls);
    assert.deepEqual(snap.artifacts[0]!.content, persisted!.content, "newly saved versions need no body cleanup on read");
    await t.test("legacy research is separated only for a complete appendix matching that version's verified evidence", async () => {
      const legacy = await sql.begin(tx => verifyResearchDelivery(tx, frozen, activation.id, content, sources, application(analysis.id)));
      assert(legacy.content.body.includes("### 爆款公式来源（已验证研究）"));
      const row = { content: legacy.content, source_snapshot: legacy.sources };
      const [projected] = await projectArticleVersions(sql, sessionId, [row]);
      assert.equal(projected!.content.body, publishableBody);
      assert.deepEqual(projected!.content.research, persisted!.content.research);
      assert.equal(row.content.body, legacy.content.body, "historical read projection never rewrites the stored input");
      for (const uncertain of [
        { ...row, content: { ...content, body: `${publishableBody}\n\n### 爆款公式来源（已验证研究）\n这是作者自己写的引用说明：${urls[0]}` } },
        { ...row, content: { ...legacy.content, body: legacy.content.body + "\n作者补充的段落" } },
        { ...row, source_snapshot: legacy.sources.map(({ research, ...source }) => source) },
      ]) {
        const [unchanged] = await projectArticleVersions(sql, sessionId, [uncertain]);
        assert.equal(unchanged!.content.body, uncertain.content.body, "similar headings, edited suffixes and unverified copies remain intact");
        assert.equal(unchanged!.content.research, undefined);
      }
    });
    assert(snap.turn!.activities!.some(a => a.kind === "analyze_xhs_research" && a.state === "completed"));
    const charges = await sql`SELECT id,amount,consumed,released,state FROM member_credit_charges WHERE root_run_id IN (${turn.runId},${searchCall.child_run_id})`;
    assert.deepEqual(charges.map(c => [c.amount,c.consumed,c.released]), [[13,10,3]]);
    const [ledger]=await sql`SELECT count(*)::int n FROM member_credit_entries WHERE charge_id=${charges[0]!.id} AND kind='reserve'`;assert.equal(ledger!.n,1); assert(charges.every(c => c.state === "settled"));
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
      assert.equal(saved.artifacts[0]!.content.intent, "rewrite");
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
      for (let i = 0; i < 3; i++) await advance(run.runId);
      // A new step also observes its complete context budget, even when an older
      // persisted search transcript used much larger excerpts than today's projection.
      const [searchRow] = await sql`SELECT result FROM assistant_tool_calls WHERE id=${pending.callId}`;
      const legacyProjection = structuredClone(searchRow!.result);
      for (const note of legacyProjection.results) note.text = "先看拍摄场景，再做选购比较。#相机 #选购".repeat(50).slice(0, 1000);
      await sql`UPDATE assistant_tool_calls SET result=${sql.json(legacyProjection)} WHERE id=${pending.callId}`;
      await sql`UPDATE assistant_messages SET model_message=jsonb_set(model_message,'{content,0,output,value}',${sql.json(legacyProjection)})
        WHERE turn_id=${run.turnId} AND role='tool' AND model_message#>>'{content,0,toolName}'='search_xhs_notes'`;
      for (let i = 0; i < 2; i++) await advance(run.runId);
      const result = await sessionSnapshot(user.id, session.sessionId);
      assert.equal(result.turn?.status, "completed");
      const [analyzed] = await sql`SELECT result FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='analyze_xhs_research'`;
      assert.equal(analyzed.result.samples.length, 50);
      assert.equal((await sql`SELECT count(*)::int n FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='ask_question'`)[0]!.n, 0, "truncated samples disclose limits without an extra scope confirmation");
      assert(analyzed.result.samples.some((sample: any) => sample.textTruncated));
      const steps = await sql`SELECT request_snapshot FROM assistant_model_steps WHERE turn_id=${run.turnId}`;
      for (const step of steps) assert(contextTokens(JSON.stringify(step.request_snapshot)) + 256 <= 24000);
      assert(steps.some(step => JSON.stringify(step.request_snapshot).includes('"contextProjection"')));
      assert.equal(result.artifacts[0]!.content.partial, true, "no web hotspot verification cannot be claimed complete upstream research");
      assert(result.artifacts[0]!.content.research?.references.every(reference => reference.authorUrl === undefined));
      assert(result.artifacts[0]!.content.research?.patterns.some(pattern => pattern.label === "标题" && pattern.observation.includes("标题使用数字与新手人群")));
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
      } })), /不能静默降级/);
      await controlTurn(user.id, session.sessionId, run.turnId, "stop", { generation: result.turn!.generation });
    });
    await t.test("skill-scoped M2 hint remains rewrite without research", async () => {
      mode = "m2";
      const rewriteUser = await createSiteUser({ username: `rewrite_${unique}`, displayName: "Rewrite", password: "synthetic-password" }, "test");
      await grantCredits(rewriteUser.id, { amount: 20, reason: "Independent M2 fixture" }, "test", randomUUID());
      const session = await createSession(rewriteUser.id, { assistantId: "xiaohongshu" }, randomUUID());
      const raw = { message: "改写我的原稿", expectedRevision: 1, skillSelection: { skillId: "xiaohongshu-creator" }, taskHint: { actionId: "xiaohongshu-rewrite" } };
      const q = await quoteTurn(rewriteUser.id, session.sessionId, raw), run = await submitTurn(rewriteUser.id, session.sessionId, { ...raw, quoteId: q.quoteId }, randomUUID());
      const [frozenScope] = await sql`SELECT snapshot FROM assistant_turns WHERE id=${run.turnId}`;
      assert.deepEqual(frozenScope.snapshot.candidates.map((candidate: any) => candidate.moduleId), ["M1", "M2"]);
      assert.deepEqual(frozenScope.snapshot.taskHint, raw.taskHint);
      for (let i = 0; i < 4; i++) await advance(run.runId);
      const result = await sessionSnapshot(rewriteUser.id, session.sessionId);
      assert.equal(result.turn?.status, "completed"); assert.equal(redfox.hits(), 3);
    });
    await t.test("task 55 replay: the same completed search and 220-credit reservation survive repeated recovery", async () => {
      // Everything below is synthetic, including database-generated task, receipt and note IDs.
      for (const [kind, provider, name, match, amount] of [
        ["assistant-turn", "assistant", model, {}, 200],
        ["query", "redfox", "3X8FGEEM", {}, 20],
        ["query", "redfox", "3X8FGEEM", { "parameters.keyword": keyword }, 20],
      ] as const) {
        const [price] = await sql`SELECT id,version FROM member_tool_prices WHERE kind=${kind} AND provider=${provider} AND model=${name} AND parameter_match=${sql.json(match)}`;
        await saveToolPrice({ id: price!.id, expectedVersion: price!.version, kind, provider, model: name, baseCredits: amount, parameterMatch: match, enabled: true, reason: "Task 55 isolated replay" }, "test");
      }
      sampleCount = 50; mode = "case55";
      const u = await createSiteUser({ username: `case55_${tag()}`, displayName: "Case 55", password: "synthetic-password" }, "test");
      await grantCredits(u.id, { amount: 280, reason: "Task 55 isolated replay" }, "test", randomUUID());
      const { sessionId: sid } = await createSession(u.id, { assistantId: "xiaohongshu" }, randomUUID());
      const raw = { message: "为上班族写一篇小红书笔记：AI时代下，人如何才能不被替代？先研究再写作，不提供风格样本。", expectedRevision: 1, skillSelection: { actionId: "xiaohongshu-write" } };
      // Admit a real v7 contract in this serial fixture, then restore the current catalog before execution/recovery.
      const currentVersion=currentSkillVersions["xiaohongshu-creator"]!;
      const run=await (async()=>{
        currentSkillVersions["xiaohongshu-creator"]="7";
        try {
          const q=await currentQuoteTurn(u.id,sid,raw);
          assert.equal(q.amount,220);
          return await currentSubmitTurn(u.id,sid,{...raw,quoteId:q.quoteId},randomUUID());
        } finally { currentSkillVersions["xiaohongshu-creator"]=currentVersion; }
      })();
      const hits = redfox.hits();
      for (let i = 0; i < 4; i++) await advance(run.runId);
      const search = (await sessionSnapshot(u.id, sid)).turn!.calls[0]!;
      await advance(search.childRunId!);
      await recoverAssistantChildren(search.childRunId!);
      await advance(run.runId);
      // Old runs have no eligibility hint in either the saved search or its transcript.
      await sql`UPDATE assistant_tool_calls SET result=result-'validSampleIds' WHERE id=${search.callId}`;
      await sql`UPDATE assistant_messages SET model_message=model_message #- '{content,0,output,value,validSampleIds}'
        WHERE turn_id=${run.turnId} AND role='tool' AND model_message#>>'{content,0,toolName}'='search_xhs_notes'`;
      await advance(run.runId);
      const [pending] = await sql`SELECT state FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='analyze_xhs_research'`;
      assert.equal(pending!.state, "pending");
      const [r] = await sql`SELECT step_key,step_version,generation FROM operation_runs WHERE id=${run.runId}`;
      assert.equal(r!.step_key, "assistant.tools");
      const expected = { runId: run.runId, stepVersion: r!.step_version, generation: r!.generation };
      // Reproduce the old worker's catch at the exact pending tool; no real run is copied or touched.
      const paused = await sql.begin(async tx => { const e = await claimRun(tx, expected, randomUUID()); await setRunState(tx, e, "needs_review", "assistant:review"); return e; });
      const [charge] = await sql`SELECT id,amount,consumed,state FROM member_credit_charges WHERE root_run_id=${run.runId}`;
      assert.deepEqual([charge!.amount, charge!.consumed, charge!.state], [220, 0, "review"]);
      const quotes = async () => (await sql`SELECT count(*)::int n FROM member_tool_quotes WHERE user_id=${u.id}`)[0]!.n;
      const before = await quotes();
      const resume = () => sql.begin(tx => controlAssistantOperation(tx, paused, "resume", "admin:test", "原任务引用纠错隔离验收"));
      const doubleClick = await Promise.allSettled([resume(), resume()]);
      assert.equal(doubleClick.filter(x => x.status === "fulfilled").length, 1);
      await advance(run.runId);
      const [ready] = await sql`SELECT * FROM operation_runs WHERE id=${run.runId}`;
      assert.deepEqual([ready!.step_key, ready!.step_version, ready!.current_receipt_id], ["assistant.model", 7, null]);
      const [savedAnalysis] = await sql`SELECT result FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='analyze_xhs_research' AND state='completed'`;
      assert(savedAnalysis!.result.samples.length > 0);
      const [frozen] = await sql`SELECT * FROM assistant_turns WHERE id=${run.turnId}`;
      const [previousStep] = await sql`SELECT * FROM assistant_model_steps WHERE turn_id=${run.turnId} ORDER BY model_ordinal DESC LIMIT 1`;
      const transcript = await sql`SELECT model_message FROM assistant_messages WHERE turn_id=${run.turnId} AND model_message IS NOT NULL ORDER BY seq`;
      const { tools } = await sql.begin(tx => activeTools(tx, frozen!));
      const oldRequest = { ...previousStep!.request_snapshot, tools,
        messages: [previousStep!.request_snapshot.messages[0], ...transcript.map(m => m.model_message)] };
      const searchResult = oldRequest.messages.find((m: any) => m.role === "tool" && m.content[0]?.toolName === "search_xhs_notes").content[0].output;
      const oldProjection = structuredClone(searchResult.value);
      // Reproduce legacy large excerpts using only the synthetic supplier's returned body.
      const legacyText = "先看拍摄场景，再做选购比较。#相机 #选购".repeat(50);
      let lower = 0, upper = 1000;
      const setExcerpts = (length: number) => { for (const [index, note] of oldProjection.results.entries()) note.text = index === 9 || index === 49 ? "" : legacyText.slice(0, length); };
      searchResult.value = oldProjection;
      while (lower < upper) {
        const middle = Math.floor((lower + upper) / 2); setExcerpts(middle);
        if (contextTokens(JSON.stringify(oldRequest)) + 256 < 26943) lower = middle + 1;
        else upper = middle;
      }
      setExcerpts(lower);
      const oldTokens = contextTokens(JSON.stringify(oldRequest)) + 256;
      assert(oldTokens >= 26943 && oldTokens < 27050);
      await sql`UPDATE assistant_tool_calls SET result=${sql.json(oldProjection)} WHERE id=${search.callId}`;
      const stepId = randomUUID();
      await sql`INSERT INTO assistant_model_steps(id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash,cost_context_version)
        VALUES(${stepId},${run.turnId},4,7,${sql.json(oldRequest)},'case55-undispatched',1)`;
      await sql`INSERT INTO assistant_model_step_activations SELECT ${stepId},activation_id FROM assistant_model_step_activations WHERE model_step_id=${previousStep!.id}`;
      const pauseModel = async () => {
        const [current] = await sql`SELECT step_version,generation FROM operation_runs WHERE id=${run.runId}`;
        return sql.begin(async tx => { const e = await claimRun(tx, { runId: run.runId, stepVersion: current!.step_version, generation: current!.generation }, randomUUID());
          await setRunState(tx, e, "needs_review", "assistant:review"); return e; });
      };
      const modelHits = supplier.hits();
      await pauseModel();
      const [evidence] = await sql`INSERT INTO receipts(logical_key,service,purpose,status,request)
        VALUES(${randomUUID()},'assistant.text','synthetic.preflight.guard','completed','{}') RETURNING id`;
      const guards = [
        { name: "step receipt", set: () => sql`UPDATE assistant_model_steps SET receipt_id=${previousStep!.receipt_id} WHERE id=${stepId}`,
          clear: () => sql`UPDATE assistant_model_steps SET receipt_id=NULL WHERE id=${stepId}` },
        { name: "saved decision", set: () => sql`UPDATE assistant_model_steps SET decision='{"calls":[]}'::jsonb WHERE id=${stepId}`,
          clear: () => sql`UPDATE assistant_model_steps SET decision=NULL WHERE id=${stepId}` },
        { name: "current receipt", set: () => sql`UPDATE operation_runs SET current_receipt_id=${previousStep!.receipt_id} WHERE id=${run.runId}`,
          clear: () => sql`UPDATE operation_runs SET current_receipt_id=NULL WHERE id=${run.runId}` },
        { name: "receipt subject", set: () => sql`UPDATE receipts SET subject=${stepId} WHERE id=${evidence!.id}`,
          clear: () => sql`UPDATE receipts SET subject=NULL WHERE id=${evidence!.id}` },
        { name: "receipt step identity", set: () => sql`UPDATE receipts SET request=${sql.json({ stepId })} WHERE id=${evidence!.id}`,
          clear: () => sql`UPDATE receipts SET request='{}' WHERE id=${evidence!.id}` },
        { name: "saved operation receipt", set: () => sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id)
            VALUES(${run.runId},7,'synthetic:guard','assistant_model',${sql.json({ stepId })},${evidence!.id})`,
          clear: () => sql`DELETE FROM operation_results WHERE run_id=${run.runId} AND item_key='synthetic:guard'` },
        { name: "unassigned same-run attempt", set: () => sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,status,operation_run_id)
            VALUES(${evidence!.id},1,'assistant.text','received',${run.runId})`,
          clear: () => sql`UPDATE receipt_attempts SET operation_run_id=NULL WHERE receipt_id=${evidence!.id}` },
      ];
      for (const guard of guards) {
        await guard.set();
        const [expected] = await sql`SELECT step_version,generation FROM operation_runs WHERE id=${run.runId}`;
        const recover = () => sql.begin(tx => controlAssistantOperation(tx, { runId: run.runId, stepVersion: expected!.step_version, generation: expected!.generation }, "resume", "admin:test", "已外发证据守卫的合成隔离验收"));
        if (guard.name === "saved decision") await assert.rejects(recover(), /未提供可执行工具或稿件/);
        else { await recover(); await advance(run.runId); }
        const [unchanged] = await sql`SELECT request_snapshot,request_hash FROM assistant_model_steps WHERE id=${stepId}`;
        assert.equal(unchanged!.request_hash, "case55-undispatched", `${guard.name} must prevent rewriting a request identity`);
        assert.deepEqual(unchanged!.request_snapshot, oldRequest);
        assert.equal(supplier.hits(), modelHits);
        assert.equal((await sql`SELECT status FROM operation_runs WHERE id=${run.runId}`)[0]!.status, "needs_review");
        await guard.clear();
      }
      const [preflightRun] = await sql`SELECT step_version,generation FROM operation_runs WHERE id=${run.runId}`;
      const preflight = { runId: run.runId, stepVersion: preflightRun!.step_version, generation: preflightRun!.generation };
      // An otherwise unrelated receipt with the same hash is not evidence that this step dispatched.
      await sql`UPDATE receipts SET request='{"requestHash":"case55-undispatched"}' WHERE id=${evidence!.id}`;
      const resumeModel = () => sql.begin(tx => controlAssistantOperation(tx, preflight, "resume", "admin:test", "已完成分析且未外发的原请求上下文隔离验收"));
      const repeatedRecovery = await Promise.allSettled([resumeModel(), resumeModel()]);
      assert.equal(repeatedRecovery.filter(x => x.status === "fulfilled").length, 1);
      // Repeated worker delivery cannot issue the repaired model request twice.
      await advance(run.runId); await advance(run.runId); await advance(run.runId);
      assert.equal(supplier.hits(), modelHits + 1);
      const [repaired] = await sql`SELECT * FROM assistant_model_steps WHERE id=${stepId}`;
      const repairedTokens = contextTokens(JSON.stringify(repaired!.request_snapshot)) + 256;
      assert(repairedTokens <= 24000);
      assert.notEqual(repaired!.request_hash, "case55-undispatched");
      assert.equal(repaired!.model_ordinal, 4); assert.equal(repaired!.operation_step_version, 7);
      assert.deepEqual(repaired!.request_snapshot.model, oldRequest.model);
      assert.deepEqual(repaired!.request_snapshot.tools, oldRequest.tools);
      assert.equal(repaired!.request_snapshot.system, oldRequest.system);
      const preserved = (messages: any[]) => messages.filter(m => !(m.role === "tool" && m.content[0]?.toolName === "search_xhs_notes"));
      assert.deepEqual(preserved(repaired!.request_snapshot.messages), preserved(oldRequest.messages), "skill, analysis arguments/results, user requirements and selected materials remain exact");
      const repairedProjection = repaired!.request_snapshot.messages.find((m: any) => m.role === "tool" && m.content[0]?.toolName === "search_xhs_notes").content[0].output.value;
      assert.deepEqual(repairedProjection.results.map((s: any) => [s.id,s.title,s.url]), oldProjection.results.map((s: any) => [s.id,s.title,s.url]));
      assert.deepEqual((await sql`SELECT result FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='analyze_xhs_research'`)[0]!.result, savedAnalysis!.result);
      assert.deepEqual((await sql`SELECT result FROM assistant_tool_calls WHERE id=${search.callId}`)[0]!.result, oldProjection, "full search remains persisted");
      assert.equal((await sql`SELECT count(*)::int n FROM receipts WHERE service='assistant.text' AND subject=${stepId}`)[0]!.n, 1);
      assert.equal((await sql`SELECT count(*)::int n FROM assistant_model_steps WHERE turn_id=${run.turnId}`)[0]!.n, 4);
      t.diagnostic(`synthetic task 55 model v7 context ${oldTokens} -> ${repairedTokens}/24000; original 220-credit reservation retained`);
      const done = await sessionSnapshot(u.id, sid);
      assert.equal(done.turn!.status, "completed"); assert.equal(done.artifacts.length, 1);
      assert.deepEqual(done.turn!.credits, { amount: 220, consumed: 220, released: 0, state: "settled" });
      const analyses = await sql`SELECT state,result FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='analyze_xhs_research'`;
      assert.equal(analyses.length, 1, "accept the original analysis without another model correction");
      const result = analyses[0]!.result;
      const returned = (done.turn!.calls[0]!.result as { results: { id: number }[] }).results;
      const idAt = (i: number) => `search:${returned[i]!.id}`;
      assert(result.samples.some((s: any) => s.sourceId === idAt(9)), "a real returned title remains usable evidence");
      assert(!result.patterns.content.sampleIds.includes(idAt(9)), "a missing body cannot support content structure");
      assert(result.samples.some((s: any) => s.sourceId === idAt(24)), "a real pattern-only reference counts");
      assert(result.patterns.interaction.sampleIds.includes(idAt(24)));
      assert.deepEqual(done.turn!.calls.map(c => [c.childRunId, c.state]), [[search.childRunId, "completed"]]);
      assert.equal(redfox.hits(), hits + 1);
      assert.equal(await quotes(), before);
      assert.equal((await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${u.id}`)[0]!.n, 1);
      const entries = await sql`SELECT kind,amount FROM member_credit_entries WHERE charge_id=${charge!.id} ORDER BY id`;
      assert.deepEqual(entries.map(e => [e.kind,e.amount]), [["reserve",220],["consume",220]]);
    });
    await t.test("current M1 expands recommendations with the same term; empty settles queries only", async () => {
      for (const outcome of ["empty","expand-hit","fixed","stop","stop-before-absorb"] as const) {
        const u=await createSiteUser({username:`window_${tag()}`,displayName:"Window fixture",password:"synthetic-password"},"test");
        await grantCredits(u.id,{amount:240,reason:"Synthetic research window"},"test",randomUUID());
        mode=outcome; sampleCount=outcome==="expand-hit"?1:0; windows.length=0;
        const {sessionId:sid}=await createSession(u.id,{assistantId:"xiaohongshu"},randomUUID());
        const raw={message:"为相机写一篇笔记，不提供风格样本。"+(outcome==="fixed"?"只查昨天的笔记。":""),expectedRevision:1,skillSelection:{actionId:"xiaohongshu-write"}};
        const q=await currentQuoteTurn(u.id,sid,raw), key=randomUUID();
        const fixed=outcome==="fixed", written=outcome==="expand-hit";
        assert.equal(q.amount,fixed?220:240);
        const run=await currentSubmitTurn(u.id,sid,{...raw,quoteId:q.quoteId},key);
        if(outcome==="stop" || outcome==="stop-before-absorb"){
          for(let i=0;i<4;i++)await advance(run.runId);
          const first=(await sessionSnapshot(u.id,sid)).turn!.calls[0]!;
          await advance(first.childRunId!);await recoverAssistantChildren(first.childRunId!);
          if(outcome==="stop") await advance(run.runId);
          const waiting=(await sessionSnapshot(u.id,sid)).turn!;
          assert.equal(windows.length,1);
          await controlTurn(u.id,sid,run.turnId,"stop",{generation:waiting.generation});
          await controlTurn(u.id,sid,run.turnId,"stop",{generation:waiting.generation});
          await recoverAssistantChildren(first.childRunId!);
          const stopped=await sessionSnapshot(u.id,sid);
          assert.equal(stopped.turn!.status,"stopped");assert.equal(stopped.artifacts.length,0);
          assert.deepEqual(stopped.turn!.credits,{amount:240,consumed:20,released:220,state:"settled"});
          assert.equal(windows.length,1);
          continue;
        }
        const result=await finishResearchTask(u.id,sid,run.runId);
        const [t]=await sql`SELECT snapshot FROM assistant_turns WHERE id=${run.turnId}`;
        const clock=t!.snapshot.researchClock;
        assert.deepEqual(windows.map(w=>[w.keyword,w.startDate,w.endDate]),fixed?[[keyword,clock.latestDate,clock.latestDate]]:[[keyword,clock.defaultStartDate,clock.latestDate],[keyword,clock.earliestDate,clock.latestDate]]);
        assert.equal(result.artifacts.length,written?1:0);
        if(!written) assert.match(result.messages.filter(m=>m.role==="assistant").map(m=>m.text).join(" "),/未查询到相关热门笔记/);
        assert.equal(result.turn!.credits!.consumed,(written?200:0)+windows.length*20);
        assert.equal(result.turn!.credits!.released,q.amount-result.turn!.credits!.consumed);
        assert.deepEqual(await currentSubmitTurn(u.id,sid,{...raw,quoteId:q.quoteId},key),run);
        assert.equal((await sql`SELECT count(*)::int n FROM member_credit_entries e JOIN member_credit_charges c ON c.id=e.charge_id WHERE c.root_run_id=${run.runId} AND e.kind='reserve'`)[0]!.n,1);
      }
    });
  } finally {
    if(priorQueryPrice)await sql`UPDATE member_tool_prices SET base_credits=${priorQueryPrice.base_credits},enabled=${priorQueryPrice.enabled} WHERE id=${priorQueryPrice.id}`;
    else await sql`UPDATE member_tool_prices SET enabled=false WHERE kind='query' AND provider='redfox' AND model='3X8FGEEM' AND tier='' AND parameter_match='{}'::jsonb`;
    if (priorXhsPolicy) await sql`UPDATE settings SET value=${sql.json(priorXhsPolicy.value)} WHERE key='assistant.skills.xiaohongshu-creator'`;
    else await sql`DELETE FROM settings WHERE key='assistant.skills.xiaohongshu-creator'`;

    await app?.close();
    config.allowPrivateNetworkFetch = previous;
    await supplier.close(); await redfox.close(); await stopBoss(); await restore(); await closeDb();
  }
});

const quoteTurn=(userId:number,sessionId:string,raw:unknown)=>quoteLegacyTurn(userId,sessionId,raw,{"xiaohongshu-creator":"3"});
