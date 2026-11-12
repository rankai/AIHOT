import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentBatchIssue, attachmentInputIds, attachmentIssue, attachmentSelectionCount, attachmentsReady, patchAttachment, type DraftAttachment } from "../app/features/assistant/materials-data.ts";
import { makeTurnInput, type PendingTurn } from "../app/features/assistant/data.ts";
import { emptyDraft, freezeTurn, rejectedDraft } from "../app/features/assistant/drafts.ts";

const capabilities = { fileTypes: [".txt", ".md"], maxAttachments: 10, maxFileBytes: 2097152 };
test("a whole excess selection is rejected before adding any card or uploading", () => {
  for (const state of ["queued", "uploading", "processing", "ready", "error"] as const) {
    const existing: DraftAttachment[] = Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: `${i}.txt`, state }));
    assert.equal(attachmentBatchIssue(existing.length, 1, 10), null);
    assert.match(attachmentBatchIssue(existing.length, 2, 10)!, /还可添加1个/);
    assert.equal(existing.length, 9);
    assert.equal(patchAttachment(existing, "0", { state: "queued" }).length, 9, "retry retains its slot");
    assert.equal(attachmentBatchIssue(existing.filter((row) => row.id !== "0").length, 2, 10), null, "remove releases its slot");
  }
});
test("existing selected inputs and in-flight cards share one ten-slot allowance without double-counting bound cards", () => {
  const selected = Array.from({ length: 9 }, (_, i) => `saved-${i}`);
  const cards: DraftAttachment[] = [{ id: "queued", name: "new.md", state: "queued" }];
  assert.equal(attachmentSelectionCount(cards, selected), 10);
  assert.match(attachmentBatchIssue(attachmentSelectionCount(cards, selected), 1, 10)!, /还可添加0个/);
  assert.equal(attachmentSelectionCount([{ ...cards[0]!, inputId: "saved-0", state: "ready" }], selected), 9);
  assert.equal(attachmentSelectionCount([], [...selected, "saved-0"]), 9);
});
test("text files use the declared format and byte cap; unfinished or failed selected cards block quoting", () => {
  assert.equal(attachmentIssue({ name: "NOTES.MD", size: 2097152 }, capabilities), null);
  for (const file of [{ name: "empty.txt", size: 0 }, { name: "big.md", size: 2097153 }, { name: "doc.pdf", size: 10 }]) assert(attachmentIssue(file, capabilities));
  assert(attachmentsReady());
  for (const state of ["queued", "uploading", "processing", "error"] as const) assert(!attachmentsReady([{ id: "a", name: "a.txt", state }]));
  assert(attachmentsReady([{ id: "a", name: "a.txt", state: "ready" }]));
  assert.deepEqual(patchAttachment([], "removed", { state: "ready" }), [], "a late result cannot restore a removed card");
});
test("explicit removal stays empty and frozen skill, files, versions and fee authority cannot follow future edits", () => {
  const attachment: DraftAttachment = { id: "file", name: "facts.md", state: "ready", inputId: "material", assetKey: "private-file" };
  const draft = { ...emptyDraft(), text: "修改旧稿", actionId: "xiaohongshu-rewrite", attachments: [attachment], references: [{ artifactId: "draft", version: 2, title: "旧稿" }] };
  const input = makeTurnInput(draft.text, 5, draft.actionId, draft.references, attachmentInputIds(draft.attachments), "consent-v1");
  const attempt: PendingTurn = { commandKey: "attempt", input, quoteId: "quote", attachments: [{ ...attachment }], hasUnknownResult: false, rejectionCode: "quote_expired" };
  const frozen = freezeTurn(draft, attempt);
  assert.equal(frozen.actionId, "xiaohongshu-rewrite", "session preference survives submission");
  assert.deepEqual(makeTurnInput("另一篇", 6, null), { message: "另一篇", expectedRevision: 6, skillSelection: null, inputIds: [], artifactVersions: [] });
  assert.deepEqual(input.inputIds, ["material"]);
  assert.deepEqual(input.artifactVersions, [{ artifactId: "draft", version: 2 }]);
  assert.equal(input.autoAuthorizationId, "consent-v1");
  const restored = rejectedDraft(frozen, () => "旧稿");
  assert.equal(restored.text, "修改旧稿");
  assert.equal(restored.pendingTurn, undefined);
  assert.deepEqual(restored.inputIds, [], "attachment identity must not also remain in the independent selection");
  assert.deepEqual(attachmentInputIds(restored.attachments?.filter((card) => card.id !== "file"), restored.inputIds), []);
  const future = { ...frozen, attachments: [{ ...attachment, id: "new", inputId: "new-material" }] };
  assert.deepEqual(rejectedDraft(future, () => "unused"), { ...future, pendingTurn: undefined });
});
