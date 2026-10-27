import assert from "node:assert/strict";
import { test } from "node:test";
import { resultUseBody, type ResultArticle } from "../app/features/admin/result-use-data.ts";
import type { OperationResult } from "../app/features/admin/operation-types.ts";
const result: OperationResult = { id: 9, kind: "transcription", data: { platform: "douyin", status: "succeeded", text: "正文" }, file: null, fileKey: null, sourceId: null, articleId: null, imported: false, receiptId: 2 };
const article: ResultArticle = { id: "actual-article", title: "原标题", url: "https://example.com/original", source_name: "原作者来源", source_id: "original-owner", revision: 7, has_body: false, source_enabled: true };
const input = { article, selectedId: article.id, loading: false, action: "attach" as const, reason: " 核实关联 ", evidence: " 同一作品依据 " };
test("use body carries only selected article latest CAS and explicit action/evidence/reason, never source/URL guesses", () => {
  assert.deepEqual(resultUseBody(result, input), { articleId: article.id, expectedRevision: 7, action: "attach", evidence: "同一作品依据", reason: "核实关联" });
  assert.deepEqual(resultUseBody(result, { ...input, article: { ...article, revision: 8 }, action: "fill-body", evidence: "" }), { articleId: article.id, expectedRevision: 8, action: "fill-body", reason: "核实关联" });
});
test("loading, missing/old selection and invalid revisions cannot be submitted or revive previous candidate", () => {
  for (const patch of [{ loading: true }, { article: null }, { selectedId: "changed-input" }, { article: { ...article, id: "old-response" } }, { article: { ...article, revision: 0 } }]) assert.throws(() => resultUseBody(result, { ...input, ...patch }));
  assert.throws(() => resultUseBody({ ...result, articleId: "already-linked" }, input));
  assert.deepEqual(resultUseBody({ ...result, articleId: article.id }, input).articleId, article.id);
});
test("disabled/unknown source blocks all writes and existing/unknown body blocks fill only", () => {
  for (const source_enabled of [false, undefined]) assert.throws(() => resultUseBody(result, { ...input, article: { ...article, source_enabled } as ResultArticle }));
  assert.equal(resultUseBody(result, { ...input, article: { ...article, has_body: true } }).action, "attach");
  for (const has_body of [true, undefined]) assert.throws(() => resultUseBody(result, { ...input, article: { ...article, has_body } as ResultArticle, action: "fill-body" }));
});
test("JSON/media cannot supply body; required reason and optional evidence validation retain server same-work authority", () => {
  const attachment: OperationResult = { ...result, kind: "result_attachment", data: { format: "json3", bodyUsable: false }, file: { key: "file", status: "available", contentType: "application/json", bytes: 5, filename: "r.json3", width: null, height: null } };
  assert.equal(resultUseBody(attachment, { ...input, evidence: "" }).action, "attach");
  assert.throws(() => resultUseBody(attachment, { ...input, action: "fill-body" }));
  for (const patch of [{ reason: " " }, { reason: "a".repeat(501) }, { evidence: "a".repeat(2001) }]) assert.throws(() => resultUseBody(result, { ...input, ...patch }));
});
