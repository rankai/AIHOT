import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionPageSummary } from "../app/features/admin/collection-subscription-data.ts";

test("collection page summary owns every platform before one-off summaries; ordinary queries keep their own branch", () => {
  for (const platform of ["youtube", "instagram", "tiktok", "bilibili", "shipinhao", "kuaishou", "toutiao", "qichezhijia", "dongchedi", "yiche", "baijiahao", "zhihu", "weibo", "douyin", "xiaohongshu", "wechat"]) {
    assert(collectionPageSummary("query_summary", { platform, selectedResearchCount: 0 }));
    assert(collectionPageSummary("query_summary", { platform, returnedPage: {} }));
    assert.equal(collectionPageSummary("query_summary", { platform, count: 2, continuationToken: "one-off" }), null);
    assert.equal(collectionPageSummary("youtube_work", { platform, returnedPage: {} }), null);
  }
});
test("two saved YouTube pages show actual processing and nested continuation facts without top-level fallbacks", () => {
  const token = "  opaque|next\n900719925474099312345  ";
  const first = collectionPageSummary("query_summary", { platform: "youtube", page: 1, count: 2, workCount: 2, selectedCount: 2, processedCount: 2, researchCount: 0, selectedResearchCount: 0, returnedPage: { continuationToken: token }, nextParameters: { continuationToken: token }, stopReason: null })!;
  assert.deepEqual(first.returned, [["continuationToken", token]]);
  assert.deepEqual(first.next, [["continuationToken", token]]);
  assert.deepEqual(first.rows.map(([, value]) => value), ["1", "2", "2", "2", "2", "0", "0"]);
  assert.match(first.stop!, /null/);
  const second = collectionPageSummary("query_summary", { platform: "youtube", page: 2, selectedResearchCount: 0, returnedPage: { continuationToken: "" }, nextParameters: null, stopReason: "page-limit" })!;
  assert.deepEqual(second.returned, [["continuationToken", "空字符串"]]);
  assert.deepEqual(second.next, [["nextParameters", "null（本页不续页）"]]);
  assert.match(second.stop!, /达到本轮页数上限/);
});
test("mixed collection pages scope processed count to work candidates while keeping saved research separate", () => {
  const summary = collectionPageSummary("query_summary", { platform: "xiaohongshu", operationId: "3X8FGEEM", page: 1, count: 3, workCount: 1, selectedCount: 1, processedCount: 1, researchCount: 2, selectedResearchCount: 2, returnedPage: {}, nextParameters: null })!;
  assert.deepEqual(summary.rows, [
    ["本地页号", "1"], ["本页实际返回条目", "3"], ["本页作品候选", "1"],
    ["本页选入作品候选", "1"], ["本页已处理作品候选", "1"],
    ["本页研究记录", "2"], ["本页选入研究记录", "2"],
  ]);
});
test("Weibo hot-search snapshot processed count retains its snapshot scope", () => {
  const summary = collectionPageSummary("query_summary", { platform: "weibo", operationId: "UAQ90A1F", page: 1, count: 2, workCount: 0, selectedCount: 2, processedCount: 2, researchCount: 2, selectedResearchCount: 2, returnedPage: {}, nextParameters: null })!;
  assert.deepEqual(summary.rows, [
    ["本地页号", "1"], ["本页实际返回条目", "2"], ["本页作品候选", "0"],
    ["本页选取快照", "2"], ["本页已处理快照", "2"],
    ["本页研究记录", "2"], ["本页选入研究记录", "2"],
  ]);
});
test("returned paging null, false, zero and opaque strings remain distinct; absent fields are not invented", () => {
  const summary = collectionPageSummary("query_summary", { returnedPage: { total: "900719925474099312345", page: "0", hasMore: false, nextCursor: null, offset: 0 }, nextParameters: { cursor: " \n| " }, stopReason: "future-reason" })!;
  assert.deepEqual(summary.returned, [["total", "900719925474099312345"], ["page", "0"], ["hasMore", "false（布尔值）"], ["nextCursor", "null（上游为空）"], ["offset", "0"]]);
  assert.deepEqual(summary.next, [["cursor", " \n| "]]);
  assert.equal(summary.stop, "future-reason");
  assert.deepEqual(summary.rows, []);
  const empty = collectionPageSummary("query_summary", { selectedResearchCount: 0, count: 0, returnedPage: {} })!;
  assert.deepEqual(empty.returned, []); assert.deepEqual(empty.next, []); assert.equal(empty.stop, null);
  assert.deepEqual(empty.rows.map(([, value]) => value), ["0", "0"]);
});
