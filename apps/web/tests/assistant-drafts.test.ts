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
  type AssistantDraft,
} from "../app/features/assistant/drafts.ts";
import type { PendingTurn } from "../app/features/assistant/data.ts";

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
      assert.equal(canRejectTurn(current.pendingTurn,later),false);
      assert.equal(rejectedDraft(current,()=>"unused"),current,"cannot restore an unknown automatic attempt into a new manual quote");
    }
    const next={...unknown,text:"下一轮独立草稿"};
    assert.equal(settledDraft(next,{...attempt,commandKey:"other"}),next,"a different command cannot clear the pending identity");
    const settled=settledDraft(next,next.pendingTurn!);
    assert.equal(settled.pendingTurn,undefined);
    assert.equal(settled.text,"下一轮独立草稿");
  }
  const confirmedRejection=failedTurn(freezeTurn(emptyDraft(),attempt),attempt,409);
  assert.equal(canRejectTurn(confirmedRejection.pendingTurn,409),true);
  assert.equal(rejectedDraft(confirmedRejection,()=>"").text,attempt.input.message);
  const other={...attempt,commandKey:"different",quoteId:"different"};
  const draft={...emptyDraft(),pendingTurn:other};
  assert.equal(failedTurn(draft,attempt,null),draft,"late failure cannot mark another pending attempt");
});
