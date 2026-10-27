import assert from "node:assert/strict";
import { test } from "node:test";
import { xSearchImportBody, xSearchImportState } from "../app/features/admin/x-search-import-data.ts";
import { collectionConfig, collectionDraft, collectionInputIssue, collectionPreviewBody } from "../app/features/admin/collection-subscription-data.ts";
import { platformQueryParameters } from "../app/features/admin/platform-query-data.ts";
import type { PlatformOperation } from "../app/features/admin/platform-types.ts";
import type { OperationResult } from "../app/features/admin/operation-types.ts";

const huge = "000900719925474099312345";
const record = { tweetId: huge, user: { userId: "001900719925474099312345", username: "received_user" }, text: "收到的正文 🦊", createdAt: "2026-10-20T08:00:00+08:00" };
const result: OperationResult = { id: 7, kind: "x_research_work", data: { platform: "x-research", operationId: "5K5EG87P", record }, sourceId: null, articleId: null, receiptId: 4, fileKey: null, file: null, imported: false };
const withRecord = (patch: Record<string, unknown>): OperationResult => ({ ...result, data: { ...result.data, record: { ...record, ...patch } } });

test("only actual 5K X search works can import, not comments/followees/ranks/summaries/other platforms", () => {
  assert.equal(xSearchImportState(result).canImport, true);
  for (const kind of ["x_comment", "x_followee", "x_account_rank", "query_summary"]) assert.equal(xSearchImportState({ ...result, kind }).canImport, false);
  assert.equal(xSearchImportState({ ...result, data: { ...result.data, operationId: "ABJQXHUE" } }).supported, false);
  assert.equal(xSearchImportState({ ...result, data: { ...result.data, platform: "other" } }).supported, false);
});
test("received decimal string IDs and valid username are mandatory, never filled by request/identity/handle", () => {
  assert.deepEqual(xSearchImportBody(result, " 本地核实 "), { reason: "本地核实" });
  for (const tweetId of [null, 123, "", "invalid", "1".repeat(31)]) assert.equal(xSearchImportState(withRecord({ tweetId })).canImport, false);
  for (const user of [null, { userId: null, username: "handle" }, { userId: 123, username: "handle" }, { userId: huge, username: "bad handle" }, { userId: huge, username: "a".repeat(16) }]) assert.equal(xSearchImportState(withRecord({ user })).canImport, false);
  const missing = withRecord({ user: null }); missing.data.identity = { userId: huge }; missing.data.requestedScreenName = "received_user";
  assert.equal(xSearchImportState(missing).canImport, false);
  assert.equal(record.tweetId, huge);
});
test("text-null uses received content but empty text does not silently override backend precedence", () => {
  assert.equal(xSearchImportState(withRecord({ text: null, content: "完整收到的正文" })).canImport, true);
  for (const patch of [{ text: null, content: null }, { text: " " }, { text: "", content: "另一字段不能覆盖空 text" }]) assert.equal(xSearchImportState(withRecord(patch)).canImport, false);
});
test("publication time must be a valid received timezone-bearing string, preserving original facts", () => {
  for (const createdAt of ["2026-10-20T00:00:00Z", "2026-10-20T08:00:00+0800", "Tue Oct 20 00:00:00 +0000 2026"]) assert.equal(xSearchImportState(withRecord({ createdAt })).canImport, true);
  for (const createdAt of [null, 0, "", "2026-10-20", "2026-10-20T08:00:00", "invalidZ"]) assert.equal(xSearchImportState(withRecord({ createdAt })).canImport, false);
});
test("commands contain only trimmed reason; real source/article associations prevent repeats despite old pending fields", () => {
  const pending = { ...result, data: { ...result.data, pendingReason: "旧核实原因", sourceId: "raw-not-relation" } };
  assert.deepEqual(xSearchImportBody(pending, "verified"), { reason: "verified" });
  for (const association of [{ sourceId: "bound-author" }, { articleId: "legacy" }, { sourceId: "bound-author", articleId: "legacy" }]) {
    const linked = { ...pending, ...association };
    assert.equal(xSearchImportState(linked).linked, true);
    assert.equal(xSearchImportState(linked).canImport, false);
    assert.throws(() => xSearchImportBody(linked, "verified"));
    assert.equal(linked.data.pendingReason, "旧核实原因");
  }
  for (const reason of [" ", "a".repeat(501)]) assert.throws(() => xSearchImportBody(result, reason));
});
test("5K subscription permits Top/Latest only, while all five ordinary queries and single previews remain valid", () => {
  const operation: PlatformOperation = { id: "5K5EG87P", platform: "x-research", label: "X搜索", purpose: "query", schedulableType: "search", fields: [{ name: "keyword", label: "词", type: "string", required: true }, { name: "searchType", label: "类型", type: "select", required: false, default: "Top", options: ["Top", "Latest", "Media", "People", "Lists"].map(value => ({ value, label: value })) }, { name: "cursor", label: "游标", type: "string", required: false }] };
  for (const searchType of ["Top", "Latest", "Media", "People", "Lists"]) {
    const values = { keyword: "query", searchType, cursor: " raw|cursor\n " };
    const allowed = ["Top", "Latest"].includes(searchType);
    assert.equal(collectionInputIssue(operation, values) === null, allowed);
    const parameters = platformQueryParameters(operation, values);
    assert.equal(parameters.searchType, searchType); assert.equal(parameters.cursor, values.cursor);
    assert.deepEqual(collectionPreviewBody(operation, values), { provider: "redfox", operationId: operation.id, parameters });
    const draft = { ...collectionDraft(operation), name: "订阅", values };
    if (allowed) assert.deepEqual(collectionConfig(operation, draft).parameters, parameters);
    else assert.throws(() => collectionConfig(operation, draft));
  }
  assert.equal(collectionInputIssue(operation, { keyword: "query" }), null);
  assert.equal(collectionInputIssue({ ...operation, id: "another-operation" }, { searchType: "Media" }), null);
});
