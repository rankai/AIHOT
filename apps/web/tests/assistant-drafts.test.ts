import { draftSelection, editDraftText, chooseDraftAction } from "../app/features/assistant/drafts.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyDraft,
  readDraft,
  rememberDraft,
  draftKey,
  freezeTurn,
  failedTurn,
  canRejectTurn,
  settledDraft,
  rejectedDraft,
  restoreDraftInput,
  rejectedQueueDraft,
  rejectedCreateDraft,
  type AssistantDraft,
  hasUnsavedAssistantContent,
} from "../app/features/assistant/drafts.ts";
import type { PendingTurn } from "../app/features/assistant/data.ts";

test("a saved quote alone permits account navigation while new content and unresolved work stay protected", () => {
  const input = { message: "已保存需求", expectedRevision: 1, skillSelection: null, inputIds: ["material"], artifactVersions: [{ artifactId: "draft", version: 2 }] };
  const quote = { commandKey: "original", input, quote: { quoteId: "quote", amount: 200, available: 20, affordable: false, expiresAt: "2030-01-01T00:00:00Z", priceId: null, priceVersion: 1, recoveryOfRunId: null } };
  const saved = { ...emptyDraft(), pendingQuote: quote, recoveryCount: 1 };
  assert.equal(hasUnsavedAssistantContent(saved), false);
  for (const edit of [
    { text: "新草稿" }, { attachments: [{ id: "upload", name: "材料.md", state: "uploading" as const }] },
    { references: [{ artifactId: "draft", version: 3, title: "新引用" }] }, { inputIds: ["other"] },
    { answer: { questionId: "question", text: "补答" } },
    { pendingTurn: { commandKey: "unknown", input, quoteId: "quote", hasUnknownResult: true } },
    { pendingQueue: { kind: "approve" as const, key: "unknown-queue", entryId: "entry", quoteId: "quote", unknown: true } },
    { recoveryCount: 2 }, { pendingLifecycle: "archive" as const },
  ]) assert.equal(hasUnsavedAssistantContent({ ...saved, ...edit }), true);
  assert.equal(saved.pendingQuote.commandKey, "original");
  assert.deepEqual(saved.pendingQuote.input, input);
});

test("confirmed input, quote and artifact version remain frozen while the next draft changes", () => {
  const original: AssistantDraft = {
    text: "修改原稿",
    actionId: "general-writing",
    references: [{ artifactId: "a", version: 2, title: "原稿" }],
  };
  const attempt: PendingTurn = { commandKey: "attempt",
    input: {
      message: original.text,
      expectedRevision: 7,
      inputIds: [],
      skillSelection: { actionId: original.actionId! },
      artifactVersions: [{ artifactId: "a", version: 2 }],
    },
    quoteId: "confirmed-quote",
  };
  const frozen = freezeTurn(original, attempt);
  assert.equal(frozen.text, "");
  assert.deepEqual(frozen.references, []);
  const next = {
    ...frozen,
    text: "下一轮另写一篇",
    actionId: "xiaohongshu-rewrite",
    references: [{ artifactId: "b", version: 4, title: "另一稿" }],
    answer: { questionId: "question", text: "补充事实" },
  };
  const settled = settledDraft(next, attempt);
  assert.equal(settled.pendingTurn, undefined);
  assert.equal(settled.text, "下一轮另写一篇");
  assert.deepEqual(settled.references, [
    { artifactId: "b", version: 4, title: "另一稿" },
  ]);
  assert.equal(settled.answer?.text, "补充事实");
  assert.deepEqual(attempt.input.artifactVersions, [
    { artifactId: "a", version: 2 },
  ]);
  assert.equal(attempt.quoteId, "confirmed-quote");
  assert.equal(original.text, "修改原稿");
});

test("a late result cannot clear a different pending command or a newer draft", () => {
  const first: PendingTurn = { commandKey: "first",
    input: { message: "first", expectedRevision: 1, skillSelection: null, inputIds: [], artifactVersions: [] },
    quoteId: "q1",
  };
  const second: PendingTurn = { commandKey: "second",
    input: { message: "second", expectedRevision: 2, skillSelection: null, inputIds: [], artifactVersions: [] },
    quoteId: "q2",
  };
  const current = { ...emptyDraft(), text: "第三轮", pendingTurn: second };
  assert.equal(settledDraft(current, first), current);
  assert.equal(settledDraft(current, second).text, "第三轮");
});

test("a rejected frozen submission restores its explicit references without merging a later draft", () => {
  const attempt: PendingTurn = { commandKey: "attempt",
    input: {
      message: "修改旧版本",
      expectedRevision: 4,
      inputIds: [],
      skillSelection: { actionId: "general-writing" },
      artifactVersions: [{ artifactId: "draft", version: 2 }],
    },
    quoteId: "expired-quote",
    hasUnknownResult: false,
    rejectionCode: "quote_expired",
  };
  const frozen = freezeTurn(emptyDraft(), attempt);
  const restored = rejectedDraft(frozen, () => "旧稿件");
  assert.equal(restored.text, "修改旧版本");
  assert.equal(restored.actionId, "general-writing");
  assert.deepEqual(restored.references, [
    { artifactId: "draft", version: 2, title: "旧稿件" },
  ]);
  const future = {
    ...frozen,
    text: "完全不同的下一轮",
    actionId: "xiaohongshu-write",
    references: [{ artifactId: "other", version: 5, title: "另一稿件" }],
  };
  assert.deepEqual(
    rejectedDraft(future, () => "ignored"),
    { ...future, pendingTurn: undefined },
  );
});

test("unknown submit remains frozen after a later 4xx and only successful replay releases it", () => {
  const attempt: PendingTurn = { commandKey: "attempt",input:{message:"已确认需求",expectedRevision:1,inputIds:[],artifactVersions:[],skillSelection:null,autoAuthorizationId:"frozen-auth"},quoteId:"q"};
  for (const status of [null, 500, 503]) {
    const frozen=freezeTurn(emptyDraft(),attempt);
    const unknown=failedTurn(frozen,attempt,status);
    assert.equal(unknown.pendingTurn!.hasUnknownResult,true);
    assert.equal(unknown.pendingTurn!.input,attempt.input);
    assert.equal(unknown.pendingTurn!.quoteId,attempt.quoteId);
    for(const later of [400,403,409,429]) {
      const current=failedTurn(unknown,unknown.pendingTurn!,later);
      assert.equal(current,unknown);
      assert.equal(canRejectTurn(current.pendingTurn),false);
      assert.equal(rejectedDraft(current,()=>"unused"),current,"cannot restore an unknown automatic attempt into a new manual quote");
    }
    const next={...unknown,text:"下一轮独立草稿"};
    assert.equal(settledDraft(next,{...attempt,commandKey:"other"}),next,"a different command cannot clear the pending identity");
    const settled=settledDraft(next,next.pendingTurn!);
    assert.equal(settled.pendingTurn,undefined);
    assert.equal(settled.text,"下一轮独立草稿");
  }
  assert.equal(canRejectTurn(failedTurn(freezeTurn(emptyDraft(),attempt),attempt,409).pendingTurn),false,"HTTP status alone cannot prove a business rejection");
  const confirmedRejection=freezeTurn(emptyDraft(),{...attempt,hasUnknownResult:false,rejectionCode:"insufficient_credits"});
  assert.equal(canRejectTurn(confirmedRejection.pendingTurn),true);
  assert.equal(rejectedDraft(confirmedRejection,()=>"").text,attempt.input.message);
  const other={...attempt,commandKey:"different",quoteId:"different"};
  const draft={...emptyDraft(),pendingTurn:other};
  assert.equal(failedTurn(draft,attempt,null),draft,"late failure cannot mark another pending attempt");
});

test("editing preserves the chosen quick action but clears priced scope; reselection clears scope", () => {
  const action = { actionId: "xiaohongshu-rewrite", skillId: "xiaohongshu-creator", skillName: "小红书创作", label: "改写", available: true, reason: null };
  const selected = chooseDraftAction(emptyDraft(), action);
  assert.deepEqual(draftSelection(selected), { skillId: "xiaohongshu-creator" });
  assert.deepEqual(selected.taskHint, { actionId: "xiaohongshu-rewrite" });
  assert.equal(selected.text, "");
  const cover = { ...action, actionId: "xiaohongshu-cover", label: "做封面" };
  assert.equal(chooseDraftAction(selected, cover).text, "");
  const material = " 用户自己填写的主题与原文 \n";
  for (const nextAction of [cover, null, action]) assert.equal(chooseDraftAction({ ...selected, text: material }, nextAction).text, material);
  const priced = { ...selected, taskChoice: { skillId: action.skillId, moduleId: "M2", delivery: "writing" as const } };
  const edited = editDraftText(priced, "我要研究后写笔记");
  assert.deepEqual(edited.taskHint, selected.taskHint);
  assert.equal(edited.taskChoice, undefined);
  assert.equal(chooseDraftAction(priced, null).taskHint, undefined);
  assert.equal(chooseDraftAction(priced, null).taskChoice, undefined);
  assert.equal(chooseDraftAction(priced, action).taskChoice, undefined); assert.deepEqual(draftSelection(edited), draftSelection(selected));
  assert.deepEqual(draftSelection({ actionId: "xiaohongshu-rewrite" }), { actionId: "xiaohongshu-rewrite" });
  assert.deepEqual(draftSelection({ actionId: "xiaohongshu-rewrite", skillSelection: { skillId: "xiaohongshu-creator" } }), { skillId: "xiaohongshu-creator" });
});


test("cancelled quotes and rejected create, queue and turn restore the explicit scope only to an empty composer", () => {
  const input: PendingTurn["input"] = { message: "春季穿搭封面", expectedRevision: 4, skillSelection: { skillId: "xiaohongshu-creator" },
    taskHint: { actionId: "xiaohongshu-cover" }, taskChoice: { skillId: "xiaohongshu-creator", moduleId: "M4", delivery: "plans-only" },
    inputIds: ["material"], artifactVersions: [{ artifactId: "plan", version: 2 }] };
  const turn: PendingTurn = { commandKey: "turn", input, quoteId: "old-quote", hasUnknownResult: false, rejectionCode: "quote_changed" };
  const queue = { kind: "enqueue" as const, key: "queue", input, unknown: false, rejectionCode: "conflict" as const };
  const creation = { creationKey: "create", text: input.message, actionId: null, skillSelection: input.skillSelection, taskHint: input.taskHint, taskChoice: input.taskChoice };
  const frozen = emptyDraft();
  const restore = [
    (draft: AssistantDraft) => restoreDraftInput(draft, input, () => "原方案"),
    (draft: AssistantDraft) => rejectedDraft({ ...draft, pendingTurn: turn }, () => "原方案"),
    (draft: AssistantDraft) => rejectedQueueDraft({ ...draft, pendingQueue: queue }),
    (draft: AssistantDraft) => rejectedCreateDraft({ ...draft, pendingCreate: creation }),
  ];
  for (const operation of restore) {
    const restored = operation(frozen);
    assert.equal(restored.text, input.message);
    assert.deepEqual(restored.taskHint, input.taskHint);
    assert.deepEqual(restored.taskChoice, input.taskChoice);
    assert.equal(restored.pendingTurn, undefined);
    assert.equal(restored.pendingQueue, undefined);
    assert.equal(restored.pendingCreate, undefined);
    assert.equal(restored.pendingQuote, undefined, "return to editing does not reuse the cancelled quote");
    assert.equal(editDraftText(restored, "另一个主题").taskChoice, undefined);
    assert.equal(chooseDraftAction(restored, null).taskChoice, undefined);
    for (const newer of [{ text: "新草稿" }, { references: [{ artifactId: "new", version: 1, title: "新稿" }] }, { inputIds: ["new-input"] }]) {
      const next = { ...emptyDraft(), ...newer };
      const retained = operation(next);
      assert.equal(retained.text, next.text);
      assert.deepEqual(retained.taskChoice, next.taskChoice);
      assert.deepEqual(retained.references, next.references);
      assert.deepEqual(retained.inputIds, next.inputIds);
    }
  }
  const unknownTurn = { ...frozen, pendingTurn: { ...turn, hasUnknownResult: true, rejectionCode: undefined } };
  assert.equal(rejectedDraft(unknownTurn, () => ""), unknownTurn);
  const unknownQueue = { ...frozen, pendingQueue: { ...queue, unknown: true, rejectionCode: undefined } };
  assert.equal(rejectedQueueDraft(unknownQueue), unknownQueue);
  const unknownCreate = { ...frozen, pendingCreate: { ...creation, unknown: true } };
  assert.equal(rejectedCreateDraft(unknownCreate), unknownCreate);
});
