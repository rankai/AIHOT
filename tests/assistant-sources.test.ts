import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AssistantArtifactContent, AssistantSource } from "@aihot/contracts/assistant";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { createSession, quoteTurn, submitTurn, sessionSnapshot, editArtifact, artifactVersions } from "@aihot/backend/assistant/sessions";
import { saveArtifact } from "@aihot/backend/assistant/store";
import { sourceCandidates } from "@aihot/backend/assistant/tools";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";

const original: AssistantSource[] = [
  { id: "search:90001", kind: "research", label: "原版参考一", url: "https://www.xiaohongshu.com/explore/original-one" },
  { id: "search:90002", kind: "research", label: "原版参考二", url: "https://www.xiaohongshu.com/explore/original-two" },
];
const newer: AssistantSource[] = [
  { id: "search:90003", kind: "research", label: "新版参考一", url: "https://www.xiaohongshu.com/explore/newer-one" },
  { id: "search:90004", kind: "research", label: "新版参考二", url: "https://www.xiaohongshu.com/explore/newer-two" },
];
const content = (sources: AssistantSource[]): AssistantArtifactContent => ({
  title: "保存过来源的稿件", body: "已确认的稿件正文", intent: "draft",
  titles: ["标题一", "标题二", "标题三"], tags: ["写作", "材料", "来源", "改稿", "测试"],
  sources: sources.map((source) => source.id), partial: false, scope: "已保存的两条研究引用",
});
const completion = (name: string, input: unknown) => ({
  id: "fixture", created: 1, model: "fixture",
  choices: [{ index: 0, message: { role: "assistant", content: null,
    tool_calls: [{ id: "call_0", type: "function", function: { name, arguments: JSON.stringify(input) } }],
  }, finish_reason: "tool_calls" }],
});

test("assistant revisions preserve exact-version research sources without another search", async (t) => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db.name, db.port);
  const restoreBudgetScope = await allowTestBudgetScope(["assistant.text"], "member");
  const unique = tag(), model = `sources-${unique}`;
  let draftId = "", expectedSources = original;
  const requests: any[] = [];
  const supplier = await stub((_hit, req) => {
    const body = JSON.parse(req.body);
    requests.push(body);
    if (!body.tools.some((tool: any) => tool.function.name === "save_draft"))
      return completion("load_skill", { skillId: "xiaohongshu-creator", moduleId: "M1" });
    const loaded = body.messages.find((message: any) => message.role === "tool" && message.content.includes("activationId"));
    return completion("save_draft", {
      activationId: JSON.parse(loaded.content).activationId, kind: "xhs-note", artifactId: draftId, baseVersion: 2,
      content: { ...content(expectedSources), body: `按已有来源修改：${expectedSources[0]!.url}` },
    });
  });
  try {
    Object.assign(process.env, {
      ASSISTANT_ENABLED: "true", ASSISTANT_CALLS_ENABLED: "true", ASSISTANT_MODEL_VERIFIED: "true",
      ASSISTANT_MODEL: "default", LLM_MODEL: model, LLM_BASE_URL: supplier.url + "/v1",
      LLM_API_KEY: "synthetic-source-test-key", ASSISTANT_TOKENIZER: "cl100k_base", MODEL_CALLS_ENABLED: "true",
    });
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='assistant.text'`;
    await saveToolPrice({ kind: "assistant-turn", provider: "assistant", model, baseCredits: 7,
      enabled: true, reason: "Synthetic source propagation fixture" }, "test");
    const user = await createSiteUser({ username: `sources_${unique}`, displayName: "Sources",
      password: "synthetic-source-test-password" }, "test");
    await grantCredits(user.id, { amount: 100, reason: "Source propagation fixture" }, "test", randomUUID());

    for (const explicitOldVersion of [false, true]) {
      await t.test(explicitOldVersion ? "explicit v1 overrides automatic v2 and retains its URLs" : "automatic latest version retains its URLs", async () => {
        const { sessionId } = await createSession(user.id, { assistantId: "xiaohongshu" }, randomUUID());
        const first = await sql.begin((tx) => saveArtifact(tx, {
          sessionId, baseVersion: 0, kind: "xhs-note", content: content(original), sourceSnapshot: original,
        }));
        await sql.begin((tx) => saveArtifact(tx, {
          sessionId, artifactId: first.artifactId, baseVersion: 1, kind: "xhs-note",
          content: content(newer), sourceSnapshot: newer,
        }));
        draftId = first.artifactId;
        expectedSources = explicitOldVersion ? original : newer;
        const reference = { artifactId: draftId, version: 1 };
        const input = {
          message: "只修改这份稿件，保留已有研究链接，不重新检索", expectedRevision: 1,
          ...(explicitOldVersion ? { artifactVersions: [reference, reference] } : {}),
        };
        const quote = await quoteTurn(user.id, sessionId, input);
        const turn = await submitTurn(user.id, sessionId, { ...input, quoteId: quote.quoteId }, randomUUID());
        const [savedTurn] = await sql`SELECT * FROM assistant_turns WHERE id=${turn.turnId}`;
        const selected = savedTurn.snapshot.selected;
        assert.equal(selected.length, 1, "duplicate explicit references and implicit latest do not add extra versions");
        assert.equal(selected[0].version, explicitOldVersion ? 1 : 2);
        assert.deepEqual(selected[0].source_snapshot, expectedSources);

        // Projection keeps the frozen input intact and deduplicates shared source IDs.
        const duplicates = { ...savedTurn, snapshot: { ...savedTurn.snapshot, selected: [...selected, ...selected] } };
        const candidates = await sql.begin((tx) => sourceCandidates(tx, duplicates));
        assert.equal(candidates.length, 4);
        assert.deepEqual(candidates.filter((source) => source.kind === "research"), expectedSources);
        assert.equal(duplicates.snapshot.selected.length, 2);
        const requestStart = requests.length;
        for (let step = 0; step < 4; step++) {
          const [run] = await sql`SELECT step_version FROM operation_runs WHERE id=${turn.runId}`;
          await executeOperationStep(turn.runId, run.step_version, randomUUID());
        }
        const snapshot = await sessionSnapshot(user.id, sessionId);
        assert.equal(snapshot.turn?.status, "completed");
        assert.equal(snapshot.artifacts[0]!.version, 3);
        assert.deepEqual(snapshot.artifacts[0]!.sources, expectedSources);
        assert.equal(requests.length - requestStart, 2);
        for (const request of requests.slice(requestStart)) {
          const material = request.messages.find((message: any) => message.role === "user" && message.content.startsWith("以下为本会话参考资料"));
          const referenceInput = JSON.parse(material.content.slice(material.content.indexOf("\n") + 1));
          assert.deepEqual(referenceInput.selected[0].source_snapshot, expectedSources);
        }
        const saveTool = requests.at(-1).tools.find((tool: any) => tool.function.name === "save_draft").function;
        assert.deepEqual(saveTool.parameters.properties.content.properties.sources.items.enum,
          ["current-message", `artifact:${draftId}:${explicitOldVersion ? 1 : 2}`, ...expectedSources.map((source) => source.id)]);
        for (const source of expectedSources) assert(saveTool.description.includes(source.url));
        for (const source of explicitOldVersion ? newer : original) assert(!saveTool.description.includes(source.url));
        const [searches] = await sql`SELECT count(*)::int n FROM assistant_tool_calls WHERE turn_id=${turn.turnId} AND name='search_xhs_notes'`;
        assert.equal(searches.n, 0);
        assert.deepEqual((await artifactVersions(user.id, sessionId, draftId)).versions[0]!.sources, expectedSources);

        if (explicitOldVersion) {
          // Already accepted snapshots before this change contain only the version pointer.
          const legacy = { ...savedTurn, snapshot: { ...savedTurn.snapshot, selected: selected.map(({ source_snapshot, ...row }: any) => row) } };
          const oldCandidates = await sql.begin((tx) => sourceCandidates(tx, legacy));
          assert.deepEqual(oldCandidates.filter((source) => source.kind === "research"), original, "fallback reads v1 even though v3 now exists");
          assert(!Object.hasOwn(legacy.snapshot.selected[0], "source_snapshot"), "legacy snapshot is not mutated");
          const foreign = await createSession(user.id, { assistantId: "xiaohongshu" }, randomUUID());
          await assert.rejects(quoteTurn(user.id, foreign.sessionId, { ...input, artifactVersions: [reference] }), /选定稿件不存在/);
          await assert.rejects(quoteTurn(user.id + 999999, sessionId, { ...input, expectedRevision: snapshot.revision }), /不可访问/);
          const crossSession = await sql.begin((tx) => sourceCandidates(tx, { ...legacy, id: randomUUID(), session_id: foreign.sessionId }));
          assert.equal(crossSession.filter((source) => source.kind === "research").length, 0, "legacy fallback cannot read another session's version");
          await assert.rejects(quoteTurn(user.id, sessionId, { ...input, expectedRevision: snapshot.revision,
            artifactVersions: [{ ...reference, source_snapshot: newer }] }));
          const artifact = snapshot.artifacts[0]!;
          await assert.rejects(editArtifact(user.id, sessionId, draftId, {
            baseVersion: 3, kind: "xhs-note", content: { ...artifact.content, sources: ["https://untrusted.invalid/source"] },
          }), /稿件来源不在已保存材料范围/);
          await assert.rejects(editArtifact(user.id, sessionId, draftId, {
            baseVersion: 3, kind: "xhs-note", content: artifact.content, sourceSnapshot: newer,
          }));
          const edited = await editArtifact(user.id, sessionId, draftId, {
            baseVersion: 3, kind: "xhs-note", content: { ...artifact.content, body: "手工正文 https://untrusted.invalid/source" },
          });
          assert.deepEqual(edited.sources, original, "editable text cannot promote a URL into trusted source metadata");
        }
      });
    }
  } finally {
    await supplier.close();
    await stopBoss();
    await restoreBudgetScope();
    await closeDb();
  }
});
