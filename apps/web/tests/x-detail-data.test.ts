import assert from "node:assert/strict";
import { test } from "node:test";
import { xSearchDetailBody } from "../app/features/admin/x-detail-data.ts";
import { xSearchImportBody, xSearchImportState } from "../app/features/admin/x-search-import-data.ts";
import { detailQueryBody, isDetailQueryResult } from "../app/features/admin/detail-query-data.ts";
import type { OperationResult } from "../app/features/admin/operation-types.ts";
const id = "000900719925474099312345", userId = "12345678901234567890";
const base: OperationResult = { id: 42, kind: "x_research_work", data: { platform: "x-research", operationId: "5K5EG87P", record: { tweetId: id, user: { userId } } }, sourceId: null, articleId: null, receiptId: 1, fileKey: null, file: null, imported: false };
const detail = (author: Record<string, unknown> = { userId, username: null }): OperationResult => ({ ...base, kind: "x_detail_work", data: { platform: "x", operationId: "QCP75W33", workId: id, identity: { userId }, context: { username: "source_handle" }, record: { tweetId: id, author, text: "收到正文🦊", createdAt: "2026-10-20T08:00:00+08:00" } } });
test("search detail uses actual decimal tweet ID and resultPK while author ID, body and username are optional", () => {
  assert.deepEqual(xSearchDetailBody(base), { tweetId: id, sourceResultId: 42 });
  for (const record of [{ tweetId: id, user: { userId: 123 } }, { tweetId: "invalid", user: { userId } }]) assert.throws(() => xSearchDetailBody({ ...base, data: { ...base.data, record, identity: { userId }, requestedScreenName: "handle" } }));
  for (const user of [null, {}, { username: "handle" }]) assert.deepEqual(xSearchDetailBody({ ...base, data: { ...base.data, record: { tweetId: id, user } } }), { tweetId: id, sourceResultId: 42 });
  for (const kind of ["article", "x_comment", "x_detail_work"]) assert.throws(() => xSearchDetailBody({ ...base, kind }));
});
test("detail import accepts only received Tweet and same-author context fallback; context never replaces invalid raw handle", () => {
  const received = detail(); assert.equal(xSearchImportState(received).canImport, true); assert.deepEqual(xSearchImportBody(received, " 核实 "), { reason: "核实" });
  assert.equal((received.data.record as any).author.username, null);
  assert.equal(xSearchImportState(detail({ userId, username: "received" })).canImport, true);
  assert.equal(xSearchImportState(detail({ username: "source_handle" })).canImport, true);
  assert.equal(xSearchImportState(detail({ userId, username: "bad handle" })).canImport, false);
  for (const patch of [{ context: {} }, { identity: { userId: "other" } }, { workId: "999" }]) assert.equal(xSearchImportState({ ...received, data: { ...received.data, ...patch } }).canImport, false);
  for (const patch of [{ text: "" }, { createdAt: "2026-10-20" }]) assert.equal(xSearchImportState({ ...received, data: { ...received.data, record: { ...(received.data.record as object), ...patch } } }).canImport, false);
  assert.equal(xSearchImportState({ ...received, kind: "article" }).supported, false);
  for (const link of [{ sourceId: "owner" }, { articleId: "article" }]) { const linked = { ...received, ...link, data: { ...received.data, pendingReason: "old" } }; assert.equal(xSearchImportState(linked).canImport, false); assert.throws(() => xSearchImportBody(linked, "reason")); }
});
test("six received account kinds and Baijia work can request options; ranks and summaries cannot; account query sends frozen locator only", () => {
  for (const platform of ["weibo", "douyin", "xiaohongshu", "wechat", "bilibili", "baijiahao"]) {
    assert.equal(isDetailQueryResult(`${platform}_account`, { platform }), true);
    for (const kind of [`${platform}_account_rank`, `${platform}_research`, "query_summary"]) assert.equal(isDetailQueryResult(kind, { platform }), false);
  }
  assert.equal(isDetailQueryResult("baijiahao_work", { platform: "baijiahao" }), true);
  assert.equal(isDetailQueryResult("tiktok_account", { platform: "tiktok" }), false);
  const choice = { operationId: "account-detail", label: "已证实账号详情", parameters: { uk: " raw opaque " }, fields: [], price: { amount: "0", currency: "CNY", basis: "estimated" as const }, purpose: "query" as const };
  assert.deepEqual(detailQueryBody(42, { resultId: 42, choices: [choice] }, choice.operationId, {}), { operationId: choice.operationId, parameters: choice.parameters, sourceResultId: 42 });
  assert.throws(() => detailQueryBody(42, { resultId: 42, choices: [choice] }, choice.operationId, { nickname: "guess" }));
});
