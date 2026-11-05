import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantArtifact, AssistantCall, AssistantCoverChoiceContext, AssistantSession } from "@aihot/contracts/assistant";
import { artifactDeliveries, artifactDisplayName, coverChoiceSchemes, currentArtifactTarget, currentImageTarget, deliverySummary, imageDownloadName, indexArtifactDeliveries, uncoveredArtifactUpdates } from "../app/features/assistant/artifact-display.ts";
import { ArtifactVersionQuery, projectArtifactDeliveries } from "../../../packages/backend/src/assistant/delivery-projection.ts";

const content = { title: "本地样本", body: "", intent: "draft" as const, titles: [], tags: [], sources: [], scope: "合成范围", partial: false };
const image: AssistantArtifact = { artifactId: "current-image", version: 1, kind: "image", schemaVersion: 1, sources: [], content: { ...content, fileKey: "current-image.png" } };
const call = { callId: "call-current", name: "generate_image", state: "completed", input: {}, proposalRevision: 1, quote: null, childRunId: 10, result: { artifactId: image.artifactId, version: 1, kind: "image" } } satisfies AssistantCall;
function snapshot(calls: AssistantCall[], artifacts: AssistantArtifact[] = [image]): AssistantSession {
  return { artifacts, turn: { calls } } as AssistantSession;
}

test("current image uses the completed call's exact identity, never artifact order or previous turn", () => {
  const oldImage = { ...image, artifactId: "old-image" };
  const unrelated = { ...image, artifactId: "unrelated-image" };
  assert.deepEqual(currentImageTarget(snapshot([call], [oldImage, image, unrelated])), { artifactId: image.artifactId, version: 1 });
  assert.equal(currentImageTarget(snapshot([], [oldImage, image])), null);
  assert.equal(currentImageTarget(snapshot([{ ...call, state: "running" }])), null);
  assert.equal(currentImageTarget(snapshot([{ ...call, name: "save_draft" }])), null);
  for (const result of [null, [], {}, { artifactId: image.artifactId }, { ...call.result, version: "1" }, { ...call.result, version: 2 }, { ...call.result, kind: "text-draft" }, { ...call.result, artifactId: "missing" }]) {
    assert.equal(currentImageTarget(snapshot([{ ...call, result }])), null);
  }
  assert.equal(currentImageTarget(snapshot([call], [{ ...image, kind: "text-draft" }])), null);
  assert.equal(currentImageTarget(snapshot([call], [{ ...image, content: { ...content, fileKey: "" } }])), null);
  assert.equal(currentImageTarget(snapshot([call, { ...call, callId: "other", result: { ...call.result, artifactId: unrelated.artifactId } }], [image, unrelated])), null, "multiple distinct results do not imply a latest image by array order");
  assert.deepEqual(currentImageTarget(snapshot([call, { ...call, callId: "replayed" }])), { artifactId: image.artifactId, version: 1 });
});

test("cover comparisons require exact plan version and scheme identity; missing details keep question names", () => {
  const choice: AssistantCoverChoiceContext = { artifactId: "plan", version: 3, schemes: [{ schemeId: "b", name: "问题中的名称" }, { schemeId: "missing", name: "仅名称" }], imageAvailable: true, imageUnavailableReason: null, feeNotice: "" };
  const plan: AssistantArtifact = { ...image, artifactId: "plan", version: 3, kind: "xhs-cover-plan", content: { ...content, coverPlan: { schemes: [{ schemeId: "a", name: "别的方案", layout: "不可错配", palette: "不可错配" }, { schemeId: "b", name: "保存名称", layout: "上文下图", palette: "白底蓝字" }] } as AssistantArtifact["content"]["coverPlan"] } };
  assert.deepEqual(coverChoiceSchemes(choice, [plan]), [{ schemeId: "b", name: "问题中的名称", layout: "上文下图", palette: "白底蓝字" }, { schemeId: "missing", name: "仅名称" }]);
  for (const artifact of [{ ...plan, version: 4 }, { ...plan, artifactId: "other" }, { ...plan, kind: "text-draft" as const }]) {
    assert.deepEqual(coverChoiceSchemes(choice, [artifact]), choice.schemes);
  }
  assert.deepEqual(coverChoiceSchemes(choice, []), choice.schemes);
});

test("only images with a saved plan reference use the cover label", () => {
  assert.equal(artifactDisplayName(image), "生成的图片");
  const cover = { ...image, content: { ...image.content, planReference: { artifactId: "plan", version: 3, schemeId: "b" } } };
  assert.equal(artifactDisplayName(cover), "生成的封面");
  assert.equal(artifactDisplayName({ ...cover, content: { ...cover.content, planReference: { artifactId: "plan", version: 0, schemeId: "b" } } }), "生成的图片");
});

test("the exact image action suppresses only its own pending update", () => {
  const imageTarget = { artifactId: image.artifactId, version: 1 };
  const draftTarget = { artifactId: "new-draft", version: 2 };
  assert.deepEqual(uncoveredArtifactUpdates([imageTarget], imageTarget), []);
  assert.deepEqual(uncoveredArtifactUpdates([imageTarget, draftTarget], imageTarget), [draftTarget]);
  assert.deepEqual(uncoveredArtifactUpdates([imageTarget, draftTarget], null), [imageTarget, draftTarget]);
  assert.deepEqual(uncoveredArtifactUpdates([{ ...imageTarget, version: 2 }], imageTarget), [{ ...imageTarget, version: 2 }]);
});

test("generated delivery projection excludes manual edits and exposes only saved identity and title", () => {
  const generated = { turn_id: "turn-1", artifact_id: "draft", version: 1, kind: "text-draft" as const, title: "保存标题", content: { body: "不得增加的历史正文" }, raw: "不得暴露的工具输入" };
  assert.deepEqual(projectArtifactDeliveries([generated, { ...generated, turn_id: "turn-2", version: 2 }, { ...generated, turn_id: null, version: 3 }]), [
    { turnId: "turn-1", artifactId: "draft", version: 1, kind: "text-draft", title: "保存标题" },
    { turnId: "turn-2", artifactId: "draft", version: 2, kind: "text-draft", title: "保存标题" },
  ]);
});

test("delivery event order requires one saved version and one matching artifact event", () => {
  const row = { turn_id: "turn", artifact_id: "plan", version: 1, kind: "xhs-cover-plan" as const, title: "封面方案", version_count: 1, event_count: 1, event_seq: 30 };
  assert.equal(projectArtifactDeliveries([row])[0]!.eventSeq, 30);
  for (const evidence of [
    { version_count: 2 }, { version_count: undefined }, { event_count: 0 }, { event_count: 2 }, { event_count: null },
    { event_seq: null }, { event_seq: 0 }, { event_seq: -1 }, { event_seq: 1.5 }, { event_seq: Number.NaN },
  ]) {
    assert(!("eventSeq" in projectArtifactDeliveries([{ ...row, ...evidence }])[0]!), "ambiguous or missing event evidence does not imply a version order");
  }
});

test("a cover plan keeps its saved event position when its same-turn choice and image arrive", () => {
  const messages = [
    { id: "request", seq: 1, eventSeq: 10, role: "user" as const, turnId: "turn", text: "做封面" },
    { id: "question", seq: 2, eventSeq: 40, role: "assistant" as const, turnId: "turn", text: "请选择" },
    { id: "choice", seq: 3, eventSeq: 60, role: "user" as const, turnId: "turn", text: "选择方案二" },
  ];
  const plan = { turnId: "turn", artifactId: "plan", version: 1, kind: "xhs-cover-plan" as const, title: "三套方案", eventSeq: 30 };
  const image = { ...plan, artifactId: "image", kind: "image" as const, title: "封面图片", eventSeq: 90 };
  assert.deepEqual(indexArtifactDeliveries(messages.slice(0, 2), [plan]).afterMessage.get("request"), [plan]);
  const afterChoice = indexArtifactDeliveries(messages, [plan, image]);
  assert.deepEqual(afterChoice.afterMessage.get("request"), [plan]);
  assert.deepEqual(afterChoice.afterMessage.get("choice"), [image]);
  assert(!afterChoice.afterMessage.get("question"));
  assert.deepEqual(afterChoice.unanchored, []);
  const afterReply = indexArtifactDeliveries([...messages, { id: "reply", seq: 4, eventSeq: 100, role: "assistant", turnId: "turn", text: "已完成" }], [plan, image]);
  assert.deepEqual([...afterReply.afterMessage], [...afterChoice.afterMessage], "later same-turn messages do not move a saved result");
  assert.deepEqual(indexArtifactDeliveries([messages[0]!], [image, plan]).afterMessage.get("request"), [plan, image], "same-slot items follow verified event order");
});

test("missing or inconsistent event evidence retains the previous end-of-turn fallback", () => {
  const first = { id: "request", seq: 1, eventSeq: 10, role: "user" as const, turnId: "turn", text: "需求" };
  const last = { id: "choice", seq: 2, eventSeq: 60, role: "user" as const, turnId: "turn", text: "选择方案" };
  const plan = { turnId: "turn", artifactId: "plan", version: 1, kind: "xhs-cover-plan" as const, title: "方案", eventSeq: 30 };
  for (const messages of [[{ ...first, eventSeq: undefined }, last], [first, { ...last, eventSeq: undefined }], [first, { ...last, eventSeq: 5 }], [first, { ...last, eventSeq: 30 }]]) {
    assert.deepEqual(indexArtifactDeliveries(messages, [plan]).afterMessage.get("choice"), [plan]);
  }
  const legacy = { ...plan, eventSeq: undefined };
  assert.deepEqual(indexArtifactDeliveries([first, last], [legacy]).afterMessage.get("choice"), [legacy]);
  assert.deepEqual(indexArtifactDeliveries([first, last], [{ ...plan, turnId: "missing" }]).unanchored, [{ ...plan, turnId: "missing" }]);
});

test("exact version query rejects ambiguous, unsafe and nonpositive values without broadening list reads", () => {
  assert.deepEqual(ArtifactVersionQuery.parse({}), {});
  assert.deepEqual(ArtifactVersionQuery.parse({ version: "101" }), { version: 101 });
  for (const version of ["0", "-1", "1.5", "1e2", "Infinity", "9007199254740992", "", ["1", "2"], true]) {
    assert.equal(ArtifactVersionQuery.safeParse({ version }).success, false);
  }
  assert.equal(ArtifactVersionQuery.safeParse({ all: "true" }).success, false);
});

test("delivery ownership survives a later turn and defaults only to a single verified current item", () => {
  const draft = { ...image, kind: "text-draft" as const, artifactId: "draft", version: 2 };
  const deliveries = [
    { turnId: "old", artifactId: draft.artifactId, version: 1, kind: draft.kind, title: "第一版" },
    { turnId: "current", artifactId: draft.artifactId, version: 2, kind: draft.kind, title: "第二版" },
  ];
  const session: AssistantSession = { ...snapshot([], [image, draft]), turn: { turnId: "current", runId: 1, phase: "completed", status: "completed", generation: 0, question: null, canResume: false, calls: [] }, deliveries };
  assert.deepEqual(artifactDeliveries(session), deliveries);
  assert.deepEqual(currentArtifactTarget(session), { artifactId: draft.artifactId, version: 2 });
  assert.equal(currentArtifactTarget({ ...session, artifacts: [{ ...draft, version: 3 }] }), null, "a manual edit is not another generated version");
  assert.equal(currentArtifactTarget({ ...session, deliveries: [...deliveries, { ...deliveries[1]!, artifactId: image.artifactId, kind: "image" }] }), null, "several results do not choose by order");
  assert.deepEqual(artifactDeliveries({ ...session, deliveries: [], turn: { ...session.turn!, calls: [call] } }), [], "an explicit empty projection is authoritative");
  assert.deepEqual(uncoveredArtifactUpdates([{ artifactId: "draft", version: 1 }, { artifactId: "draft", version: 2 }, { artifactId: "draft", version: 3 }], deliveries), [{ artifactId: "draft", version: 3 }]);
  const messages = [
    { id: "old-user", seq: 1, role: "user" as const, turnId: "old", text: "旧需求" },
    { id: "old-reply", seq: 2, role: "assistant" as const, turnId: "old", text: "旧回复" },
    { id: "current-user", seq: 3, role: "user" as const, turnId: "current", text: "改稿需求" },
  ];
  const indexed = indexArtifactDeliveries(messages, deliveries);
  assert.deepEqual(indexed.afterMessage.get("old-reply"), [deliveries[0]]);
  assert.deepEqual(indexed.afterMessage.get("current-user"), [deliveries[1]]);
  assert.deepEqual(indexed.unanchored, []);
});

test("completion descriptions state only the persisted title, version and result type", () => {
  const delivery = { turnId: "turn", artifactId: "draft", version: 1, kind: "text-draft" as const, title: "午休建议" };
  assert.equal(deliverySummary([delivery]), "《午休建议》写好了。");
  assert.equal(deliverySummary([{ ...delivery, version: 2 }]), "已保存第 2 版。");
  assert.equal(deliverySummary([{ ...delivery, kind: "xhs-cover-plan" }]), "三套封面方案已保存。");
  assert.equal(deliverySummary([{ ...delivery, kind: "image" }]), "图片已生成。");
  assert.equal(deliverySummary([delivery, { ...delivery, artifactId: "second" }]), "本次作品已保存。");
});

test("image downloads use a readable versioned name and leave the extension to the real response", () => {
  assert.equal(imageDownloadName("午休封面", 2), "午休封面 · 第 2 版");
  assert.equal(imageDownloadName("../封面:参考\n图?.png", 1), "封面 参考 图 .png · 第 1 版");
  assert.equal(imageDownloadName(" ... ", 3), "图片 · 第 3 版");
  assert(!imageDownloadName("图片", 1).endsWith(".png"));
});
