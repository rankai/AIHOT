import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentChoices, resultPageLink, resultUseCapabilities, saveAttachmentBody } from "../app/features/admin/result-attachment-data.ts";
import { assetKind } from "../app/features/admin/asset-data.ts";
import { referenceIssue } from "../app/features/admin/image-types.ts";

const transcription = { kind: "transcription", data: { platform: "douyin", status: "succeeded", text: "完整转写 🦊\n原行" }, file: null };
test("only successful known-platform transcription can save deterministic TXT without format or URL fields", () => {
  assert.deepEqual(attachmentChoices(transcription), [{ label: "TXT" }]);
  assert.deepEqual(saveAttachmentBody(transcription, undefined, " 核实保存 "), { reason: "核实保存" });
  assert.throws(() => saveAttachmentBody(transcription, 0, "保存"));
  for (const data of [{ ...transcription.data, platform: "unknown" }, { ...transcription.data, status: "processing" }, { ...transcription.data, text: " " }]) assert.deepEqual(attachmentChoices({ kind: "transcription", data }), []);
  assert.deepEqual(attachmentChoices({ kind: "transcription_task", data: { platform: "douyin", status: "processing", text: null } }), []);
});
test("subtitle saves actual record.urls index, retaining unsupported gaps, duplicate formats and separate same-language tracks", () => {
  const data = { platform: "tools", operationId: "API_1792051516512", group: "subtitle", languageTag: "en", record: { urls: [{ format: "unsupported", url: "https://example.com/a" }, { format: "srt", url: "https://example.com/a" }, { format: "srt", url: "https://example.com/b" }, { format: "vtt", url: "javascript:bad" }, { format: "json3", url: "https://example.com/c" }] } };
  const row = { kind: "subtitle_track", data };
  assert.deepEqual(attachmentChoices(row), [{ label: "SRT", formatIndex: 1 }, { label: "SRT", formatIndex: 2 }, { label: "JSON3", formatIndex: 4 }]);
  assert.deepEqual(saveAttachmentBody(row, 2, "保存第二份"), { formatIndex: 2, reason: "保存第二份" });
  assert.throws(() => saveAttachmentBody(row, 0, "保存")); assert.throws(() => saveAttachmentBody(row, undefined, "保存"));
  assert.deepEqual(attachmentChoices({ ...row, data: { ...data, languageTag: "en", record: { urls: [{ format: "vtt", url: "https://example.com/other-track" }] } } }), [{ label: "VTT", formatIndex: 0 }]);
});
test("media save requires explicit reported type and actual safe resource URL, never covers or tool name guesses", () => {
  for (const type of ["image", "audio", "video", "mp3"]) {
    const row = { kind: "media_resource", data: { platform: "tools", group: "media", operationId: "AWUTFI4V", record: { type, downloadUrl: "https://example.com/resource" } } };
    assert.deepEqual(saveAttachmentBody(row, undefined, "保存"), { reason: "保存" });
    assert.throws(() => saveAttachmentBody(row, 0, "保存"));
  }
  for (const record of [{ type: "unknown", downloadUrl: "https://example.com/file" }, { type: "video", coverUrl: "https://example.com/cover.jpg" }, { type: "audio", downloadUrl: "//example.com/asset" }, { type: "video", downloadUrl: "https://user:pass@example.com/file" }]) assert.deepEqual(attachmentChoices({ kind: "media_resource", data: { platform: "tools", group: "media", operationId: "AWUTFI4V", record } }), []);
});
test("text attachment capability separates JSON association from verified body fill and excludes unavailable/media files", () => {
  const file = { key: "private/key", status: "available", contentType: "application/json", bytes: 5, filename: "result.json", width: null, height: null };
  const row = { kind: "result_attachment", data: { format: "json", bodyUsable: true }, file };
  assert.deepEqual(resultUseCapabilities(row), { attach: true, fillBody: false });
  assert.deepEqual(resultUseCapabilities({ ...row, data: { format: "srt", bodyUsable: true }, file: { ...file, contentType: "application/x-subrip" } }), { attach: true, fillBody: true });
  assert.deepEqual(resultUseCapabilities({ ...row, data: { format: "srt", bodyUsable: false }, file: { ...file, contentType: "application/x-subrip" } }), { attach: true, fillBody: false });
  for (const status of ["deleting", "deleted"]) assert.deepEqual(resultUseCapabilities({ ...row, file: { ...file, status } }), { attach: false, fillBody: false });
  assert.deepEqual(resultUseCapabilities({ ...row, file: { ...file, contentType: "video/mp4" } }), { attach: false, fillBody: false });
  assert.deepEqual(resultUseCapabilities(transcription), { attach: true, fillBody: true });
});
test("text asset display stays separate from upload/reference media and result links use exact known result cursor", () => {
  const asset = { key: "private/txt", status: "available", content_type: "text/plain", bytes: 50, purpose: "operation-output", metadata: { filename: "result.txt", kind: "text" as const } };
  assert.equal(assetKind(asset), "text");
  assert.equal(assetKind({ ...asset, metadata: { filename: "legacy.json" }, content_type: "application/json" }), "text");
  assert(referenceIssue(asset, { referenceBytes: 10000000, referencePixels: 16000000 }));
  assert.equal(resultPageLink("/admin/operations/200", 315), "/admin/operations/200?cursor=314#result-315");
  for (const reason of [" ", "a".repeat(501)]) assert.throws(() => saveAttachmentBody(transcription, undefined, reason));
});
