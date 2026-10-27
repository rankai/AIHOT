import assert from "node:assert/strict";
import { test } from "node:test";
import { detailQueryBody, detailQueryOperation, detailQueryPrice, isDetailQueryWork } from "../app/features/admin/detail-query-data.ts";
import type { DetailQueryChoice, DetailQueryOptions } from "../app/features/admin/detail-query-types.ts";
const price = { amount: "0.04", currency: "CNY", basis: "estimated" as const };
const choice = (operationId: string, parameters: Record<string, unknown>): DetailQueryChoice => ({ operationId, label: "已证详情库", parameters, fields: [], price, purpose: "query" });
const huge = "000900719925474099312345";

test("only matching work kinds on the nine accepted platforms own this action, never account/rank/topic/summary or other platforms", () => {
  for (const platform of ["douyin", "xiaohongshu", "wechat", "tiktok", "bilibili", "weibo", "qichezhijia", "dongchedi", "yiche"]) {
    assert(isDetailQueryWork(`${platform}_work`, { platform }));
    for (const kind of [`${platform}_account`, `${platform}_account_rank`, `${platform}_topic`, "query_summary", "transcription", "result_attachment"]) assert(!isDetailQueryWork(kind, { platform }));
  }
  for (const platform of ["youtube", "instagram", "toutiao", "shipinhao", "kuaishou", "x", "baijiahao", "zhihu"]) assert(!isDetailQueryWork(`${platform}_work`, { platform }));
  assert(!isDetailQueryWork("douyin_work", { platform: ["douyin"] }));
});
test("each platform command copies server-frozen parameters without rounding IDs, rewriting URLs or adding authors/time", () => {
  const targets: Array<[string, Record<string, unknown>]> = [["FK67XDVQ", { videoId: huge }], ["KR1LPTBF", { workLink: "https://www.xiaohongshu.com/explore/opaque?xsec_token=raw%2Bvalue" }], ["I3CIBRI2", { articleUrl: "https://mp.weixin.qq.com/s?__biz=opaque&mid=000123&idx=1" }], ["6SE9WIHJ", { awemeId: huge }], ["TIN1NMTZ", { bvId: "BV1ghJg6hEWV" }], ["API_1789098514899", { opusId: huge }], ["TE6AGWAF", { videoId: "opaque-video", videoType: 0 }], ["QQ5E3EZ9", { workId: "opaque-work", workType: "article" }], ["VYSP68M2", { url: "https://news.yiche.com/native-original" }]];
  for (const [operationId, parameters] of targets) {
    const options = { resultId: 42, choices: [choice(operationId, parameters)] }, before = JSON.stringify(options);
    assert.deepEqual(detailQueryBody(42, options, operationId, {}), { operationId, parameters, sourceResultId: 42 });
    assert.equal(JSON.stringify(options), before);
  }
});
test("LL page is the only editable field and starts blank with no invented default or positive-only bound", () => {
  const ll: DetailQueryChoice = { ...choice("LLCI8QTE", { workId: huge }), fields: [{ name: "page", label: "页码", type: "integer", required: true, default: 1 }] };
  const options = { resultId: 42, choices: [ll] };
  assert.equal(detailQueryOperation(ll).fields[0]!.default, undefined);
  assert.equal(detailQueryOperation(ll).fields[0]!.required, true);
  assert.throws(() => detailQueryBody(42, options, ll.operationId, {}));
  for (const page of ["0", "-1", " 2 "]) assert.deepEqual(detailQueryBody(42, options, ll.operationId, { page }).parameters, { workId: huge, page: Number(page) });
  for (const page of ["", "1.5", "9007199254740993"]) assert.throws(() => detailQueryBody(42, options, ll.operationId, { page }));
  assert.throws(() => detailQueryBody(42, options, ll.operationId, { page: "1", workId: "replacement" }));
  assert.throws(() => detailQueryOperation({ ...ll, parameters: { workId: huge, page: 1 } }));
  assert.throws(() => detailQueryOperation({ ...ll, fields: [{ name: "workId", label: "ID", type: "string", required: true }] }));
  assert.throws(() => detailQueryOperation({ ...ll, operationId: "other-operation" }));
});
test("mismatched result, removed choice and empty options never fallback or emit a query command", () => {
  const options: DetailQueryOptions = { resultId: 42, choices: [choice("A", { workId: "first" }), choice("B", { workId: "second" })] };
  for (const resultId of [43, 0, -1, 1.5]) assert.throws(() => detailQueryBody(resultId, options, "A", {}));
  assert.throws(() => detailQueryBody(42, null, "A", {}));
  assert.throws(() => detailQueryBody(42, options, "", {}));
  assert.throws(() => detailQueryBody(42, { resultId: 42, choices: [], reason: "来源未通过" }, "A", {}));
  assert.throws(() => detailQueryBody(42, options, "removed", {}));
  assert.throws(() => detailQueryBody(42, options, "A", { authorId: "manual" }));
});
test("independent target values are consumed without mutating stored drafts and prices preserve zero/precision/unknown", () => {
  const ll: DetailQueryChoice = { ...choice("LLCI8QTE", { workId: "frozen" }), fields: [{ name: "page", label: "页码", type: "integer", required: true }] };
  const options = { resultId: 42, choices: [ll, choice("TE6AGWAF", { videoId: "video", videoType: 0 })] }, drafts = { LLCI8QTE: { page: "7" }, TE6AGWAF: {} };
  assert.equal(detailQueryBody(42, options, "LLCI8QTE", drafts.LLCI8QTE).parameters.page, 7);
  assert.deepEqual(detailQueryBody(42, options, "TE6AGWAF", drafts.TE6AGWAF).parameters, { videoId: "video", videoType: 0 });
  assert.equal(drafts.LLCI8QTE.page, "7");
  for (const amount of ["0", "0.00000000000000001", "900719925474099312345.6"]) assert(detailQueryPrice({ ...ll, price: { ...price, amount } }).includes(amount));
  assert.match(detailQueryPrice({ ...ll, price: { amount: null, currency: null, basis: "estimated" } }), /金额未知.*币种 未知/);
});
