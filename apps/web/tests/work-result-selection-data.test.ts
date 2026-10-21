import assert from "node:assert/strict";
import { test } from "node:test";
import { importSelectedWorks, pageWorkCandidates, selectableWorkResult, workResultTitle } from "../app/features/admin/work-result-selection-data.ts";
import { weiboImportFields } from "../app/features/admin/weibo-result-data.ts";
import type { OperationResult } from "../app/features/admin/operation-types.ts";
export const work = (id: number, kind = "weibo_work", data: Record<string, unknown> = {}): OperationResult => ({ id, kind, data: { platform: "weibo", opusId: "900719925474099312345", uid: "123", opusUrl: "https://weibo.com/123/received", ...data }, receiptId: 1, sourceId: null, articleId: null, fileKey: null, file: null, imported: false });
const nativeWorks = [
  work(1, "douyin_work", { identity: { uid: "123" }, workId: "42", url: "https://www.douyin.com/video/42" }),
  work(2, "xiaohongshu_work", { identity: { userId: "opaque" }, workId: "AbC_42", url: "https://www.xiaohongshu.com/explore/AbC_42" }),
  work(3, "wechat_work", { identity: { wxId: "received" }, url: "https://mp.weixin.qq.com/s/received" }),
  work(4, "tiktok_work", { identity: { userId: "123" }, workId: "42", url: "https://www.tiktok.com/@received/video/42" }),
  work(5, "bilibili_work", { identity: { mid: "123" }, workId: "BV1ghJg6hEWV", url: "https://www.bilibili.com/video/BV1ghJg6hEWV" }),
  work(6, "youtube_work", { identity: { channelId: "UC_received" }, workId: "ABc123_-abc", url: "https://www.youtube.com/watch?v=ABc123_-abc" }),
  work(7, "instagram_work", { identity: { userId: "123" }, workId: "received_42", url: "https://www.instagram.com/p/received_42" }),
  work(8, "toutiao_work", { identity: { uid: "123" }, workId: "42", url: "https://www.toutiao.com/article/42" }),
];
test("fixed work kinds reuse current per-item completeness and exclude anything requiring manual fields or already linked articles", () => {
  for (const result of nativeWorks) {
    assert.equal(selectableWorkResult(result), true, result.kind);
    assert.equal(selectableWorkResult({ ...result, articleId: "already" }), false, result.kind);
    assert.equal(selectableWorkResult({ ...result, data: { ...result.data, identity: {} } }), false, `${result.kind} missing identity`);
    assert.equal(selectableWorkResult({ ...result, data: { ...result.data, url: null } }), false, `${result.kind} missing URL`);
  }
  for (const kind of ["shipinhao_work", "kuaishou_work", "qichezhijia_work", "dongchedi_work", "yiche_work", "baijiahao_work", "zhihu_work", "weibo_account", "weibo_trend", "query_summary", "result_expired", "result_attachment", "image", "video", "media_resource", "transcription", "x_account_rank"]) assert.equal(selectableWorkResult(work(20, kind)), false, kind);
  assert.equal(selectableWorkResult({ ...nativeWorks[0]!, data: { ...nativeWorks[0]!.data, url: "https://example.com/cdn.jpg" } }), false);
  assert.equal(selectableWorkResult(work(0)), false);
  const urlAuthor = { ...nativeWorks[2]!, data: { identity: {}, url: "https://mp.weixin.qq.com/s?__biz=received&mid=1&idx=1" } };
  assert.equal(selectableWorkResult(urlAuthor), true, "preserve existing WX URL identity evidence");
});
test("shared Weibo checks retain exact old inline semantics; X requires its existing full import gate", () => {
  assert.equal(selectableWorkResult(work(1)), true);
  assert.equal(workResultTitle(work(1, "weibo_work", { title: "已收标题", text: "正文" })), "已收标题");
  assert.equal(workResultTitle(work(1, "weibo_work", { title: "", record: { title: "记录标题", text: "记录正文" } })), "记录标题");
  assert.equal(workResultTitle(work(1, "weibo_work", { text: "🦊".repeat(81) })), "🦊".repeat(80));
  assert.equal(workResultTitle(work(1, "weibo_work", { record: { text: "实收记录正文" } })), "实收记录正文");
  assert.equal(workResultTitle(work(1, "weibo_work", { text: " ", record: { content: "实收内容" } })), "实收内容");
  assert.equal(workResultTitle(work(1)), "作品");
  for (const patch of [{ uid: null }, { opusUrl: null }, { opusId: null }]) assert.equal(selectableWorkResult(work(1, "weibo_work", patch)), false);
  assert.equal(weiboImportFields("weibo_work", { opusId: 1, uid: "received", url: "raw-original" }).canImport, true, "do not tighten existing per-item ID/URL rules in extraction");
  const record = { tweetId: "9007199254740993123", user: { userId: "123", username: "received" }, text: "正文", createdAt: "2026-10-21T00:00:00Z" };
  const search = work(2, "x_research_work", { platform: "x-research", operationId: "5K5EG87P", record });
  assert.equal(selectableWorkResult(search), true);
  assert.equal(selectableWorkResult({ ...search, data: { ...search.data, record: { ...record, text: null } } }), false);
  const detail = work(3, "x_detail_work", { platform: "x", operationId: "QCP75W33", record: { ...record, user: undefined, author: { userId: "123", username: null } }, workId: record.tweetId, identity: { userId: "123" }, context: { username: "received" } });
  assert.equal(selectableWorkResult(detail), true);
  assert.equal(selectableWorkResult({ ...detail, data: { ...detail.data, context: {} } }), false);
});
test("page limit is exactly first100 and selection cannot cross pages or emit unsupported/stale commands", async () => {
  const results = Array.from({ length: 101 }, (_, i) => work(i + 1));
  assert.equal(pageWorkCandidates(results).length, 100);
  let calls = 0;
  for (const selectedIds of [[101], [], [1, 999]]) await assert.rejects(() => importSelectedWorks({ results, selectedIds, reason: "核实", isCurrent: () => true, submit: async () => { calls++; return true; } }));
  await assert.rejects(() => importSelectedWorks({ results, selectedIds: [1], reason: " ", isCurrent: () => true, submit: async () => { calls++; return true; } }));
  assert.equal(calls, 0);
});
test("explicit batch preserves page order, exact reason-only body, stops first failure, and retains failure plus not attempted IDs", async () => {
  const calls: Array<[number, unknown]> = [];
  const outcome = await importSelectedWorks({ results: [work(3), work(1), work(2)], selectedIds: [2, 3, 1], reason: " 核实🦊 ", isCurrent: () => true, submit: async (id, body) => { calls.push([id, body]); return id !== 1; } });
  assert.deepEqual(calls, [[3, { reason: "核实🦊" }], [1, { reason: "核实🦊" }]]);
  assert.deepEqual(outcome, { succeeded: [3], remaining: [1, 2], failedId: 1, interrupted: false });
  const thrown = await importSelectedWorks({ results: [work(1), work(2)], selectedIds: [1, 2], reason: "reason", isCurrent: () => true, submit: async () => { throw new Error("network unknown"); } });
  assert.deepEqual(thrown.remaining, [1, 2]); assert.equal(thrown.failedId, 1);
});
test("navigation/unmount stops later commands while allowing the in-flight command to finish without rollback claims", async () => {
  let current = true, release: (success: boolean) => void = () => {}, calls: number[] = [];
  const pending = importSelectedWorks({ results: [work(1), work(2)], selectedIds: [1, 2], reason: "reason", isCurrent: () => current, submit: id => { calls.push(id); return new Promise(resolve => { release = resolve; }); } });
  assert.deepEqual(calls, [1]); current = false; release(true);
  const outcome = await pending;
  assert.deepEqual(calls, [1]); assert.deepEqual(outcome, { succeeded: [1], remaining: [2], failedId: null, interrupted: true });
  const before = await importSelectedWorks({ results: [work(1)], selectedIds: [1], reason: "reason", isCurrent: () => false, submit: async () => { throw new Error("must not run"); } });
  assert.deepEqual(before.succeeded, []); assert.equal(before.interrupted, true);
});
