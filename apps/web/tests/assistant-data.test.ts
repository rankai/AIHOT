import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityLabel,
  artifactText,
  assistantHref,
  materialText,
  makeTurnInput,
  isAssistantPath,
  runtimeMessage,
  researchResults,
  safeSourceHref,
  sessionHref,
  turnActive,
} from "../app/features/assistant/data.ts";
import { shouldReadSnapshot } from "../app/features/assistant/snapshot-poll.ts";
import { runDetailHref } from "../app/features/tools/run-history-data.ts";
import type {
  AssistantActivity,
  AssistantArtifactContent,
  AssistantSession,
} from "@aihot/contracts/assistant";

test("completed model labels stay neutral without matching persisted activity context", () => {
  const model: AssistantActivity = { id: "model:known", kind: "model_request", state: "completed" };
  const nextModel: AssistantActivity = { ...model, id: "model:next" };
  const save: AssistantActivity = { id: "call:save", kind: "save_draft", state: "completed" };
  assert.equal(activityLabel(model), "创作接口已返回");
  assert.equal(activityLabel(model, []), "创作接口已返回");
  assert.equal(activityLabel(model, [nextModel, save]), "创作接口已返回");
  assert.equal(activityLabel(model, [model, nextModel, save]), "创作接口已返回");
  assert.equal(activityLabel(nextModel, [model, nextModel, save]), "稿件内容已返回");
});

test("assistant entry links and canonical history never reassign a session identity", () => {
  assert.equal(assistantHref("creative"), "/assistant");
  assert.equal(assistantHref("xiaohongshu"), "/assistant/xiaohongshu");
  assert.equal(sessionHref("session/1"), "/assistant/sessions/session%2F1");
  const filters = { q: "keyword", category: "" as const, status: "" as const };
  assert.equal(
    runDetailHref(5, filters, "owned-session"),
    "/assistant/sessions/owned-session",
  );
  assert.equal(runDetailHref(5, filters), "/tools/runs/5?history=q%3Dkeyword");
});

test("runtime messages preserve server IDs and only show committed text", () => {
  const value = {
    id: "stable-message",
    seq: 2,
    role: "assistant" as const,
    text: "已保存的结果",
    turnId: "turn",
  };
  assert.deepEqual(runtimeMessage(value), {
    id: "stable-message",
    role: "assistant",
    content: "已保存的结果",
    status: { type: "complete", reason: "stop" },
  });
  assert.equal(runtimeMessage({ ...value, role: "tool" }).id, "stable-message");
  assert.equal(runtimeMessage({ ...value, role: "user" }).role, "user");
});

test("only safe HTTP sources become external links", () => {
  for (const url of [
    null,
    "",
    "javascript:alert(1)",
    "data:text/html,hi",
    "/relative",
    "https://user:secret@example.com",
    "file:///tmp/file",
  ])
    assert.equal(safeSourceHref(url), null);
  assert.equal(
    safeSourceHref("https://example.com/note?q=1"),
    "https://example.com/note?q=1",
  );
  assert.equal(
    safeSourceHref("http://example.com/note"),
    "http://example.com/note",
  );
});

test("draft copying and handoff material projection stay readable without executing imported text", () => {
  const content: AssistantArtifactContent = {
    title: "标题",
    body: "正文\n第二段",
    intent: "draft",
    titles: ["另一个标题"],
    tags: ["AI", "#写作"],
    sources: ["current-message"],
    partial: true,
    scope: "仅给定材料",
  };
  assert.equal(
    artifactText(content),
    "标题\n\n正文\n第二段\n\n备选标题\n另一个标题\n\n#AI #写作",
  );
  assert.equal(
    materialText(JSON.stringify(content)),
    "标题\n\n正文\n第二段\n\n另一个标题\n\nAI · #写作",
  );
  assert.equal(
    materialText("<script>untrusted</script>"),
    "<script>untrusted</script>",
  );
  assert.equal(materialText('{"unexpected":true}'), '{"unexpected":true}');
});

test("waiting and review phases block new turns and artifact editing until handled", () => {
  for (const status of ["active", "waiting", "needs_review"])
    assert.equal(turnActive({ turn: { status } } as AssistantSession), true);
  for (const status of ["completed", "stopped", "failed"])
    assert.equal(turnActive({ turn: { status } } as AssistantSession), false);
  assert.equal(turnActive({ turn: null } as AssistantSession), false);
});

test("research result cards only project saved results and safe source links", () => {
  assert.deepEqual(
    researchResults({ normalized: { commandInput: "not public" } }),
    { rows: [], limited: false },
  );
  assert.deepEqual(
    researchResults({
      results: [
        {
          id: 5,
          title: "真实笔记",
          text: "摘要",
          url: "https://example.com/note",
          secret: "ignored",
        },
        { id: 6, title: "无效URL", text: "文本", url: "javascript:alert(1)" },
        { invalid: true },
      ],
      limited: true,
    }),
    {
      rows: [
        {
          id: "5",
          title: "真实笔记",
          text: "摘要",
          url: "https://example.com/note",
        },
        { id: "6", title: "无效URL", text: "文本", url: null },
      ],
      limited: true,
    },
  );
});

test("assistant workspace route matching uses full path segments", () => {
  for (const path of [
    "/assistant",
    "/assistant/xiaohongshu",
    "/assistant/sessions/owned",
  ])
    assert.equal(isAssistantPath(path), true);
  for (const path of [
    "/agent",
    "/assistant-other",
    "/tools",
    "/tools/assistant",
  ])
    assert.equal(isAssistantPath(path), false);
});

test("quote identities bind the explicit saved reference and session revision", () => {
  const references = [{ artifactId: "first", version: 2 }];
  const input = makeTurnInput(
    "  调整这篇稿件  ",
    4,
    "general-writing",
    references,
  );
  references[0]!.version = 9;
  assert.deepEqual(input, {
    message: "调整这篇稿件",
    expectedRevision: 4,
    skillSelection: { actionId: "general-writing" },
    inputIds: [],
    artifactVersions: [{ artifactId: "first", version: 2 }],
  });
  assert.notDeepEqual(
    input,
    makeTurnInput("调整这篇稿件", 4, "general-writing", references),
  );
  assert.notDeepEqual(
    input,
    makeTurnInput("调整这篇稿件", 5, "general-writing", [
      { artifactId: "first", version: 2 },
    ]),
  );
  assert.deepEqual(makeTurnInput("自由描述", 3, null), {
    message: "自由描述",
    expectedRevision: 3,
    skillSelection: null,
    inputIds: [],
    artifactVersions: [],
  });
});


test("snapshot polling reconciles event-free receipts and retries failures until a snapshot succeeds", () => {
  for (const status of ["stopped", "needs_review", "completed", "failed"]) {
    const turn = { status, phase: "stopped" as const, needsSnapshotRefresh: true };
    assert.equal(shouldReadSnapshot(turn, false, false), true, `${status}: unresolved receipt`);
    const resolved = { ...turn, needsSnapshotRefresh: false };
    assert.equal(shouldReadSnapshot(resolved, false, false), false, `${status}: stable receipt`);
    assert.equal(shouldReadSnapshot(resolved, false, true), true, `${status}: snapshot still failed`);
    assert.equal(shouldReadSnapshot(resolved, true, false), true, `${status}: new event`);
  }
  for (const phase of ["waiting_question", "waiting_approval"] as const) {
    const turn = { status: "waiting", phase };
    assert.equal(shouldReadSnapshot(turn, false, false), false);
    assert.equal(shouldReadSnapshot(turn, false, true), true);
  }
  for (const phase of ["executing", "waiting_child"] as const)
    assert.equal(shouldReadSnapshot({ status: "active", phase }, false, false), true);
  assert.equal(shouldReadSnapshot(null, false, false), false);
  assert.equal(shouldReadSnapshot(null, false, true), true);
});
