import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionConfig, collectionDetailsAvailable, collectionDraft, collectionOperations, collectionPagingNote, collectionPreviewBody, collectionPriceNote, collectionSaveCommand, collectionSeedFromState, collectionSeedNavigation, collectionSubscriptionsHref, collectionSummaryRows, isCollectionOperationKey, isWeiboSnapshot } from "../app/features/admin/collection-subscription-data.ts";
import { subscriptionExecutionChanges, type CollectionSubscription } from "../app/features/admin/collection-subscription-types.ts";
import { platformQueryParameters } from "../app/features/admin/platform-query-data.ts";
import type { PlatformOperation } from "../app/features/admin/platform-types.ts";
const weibo: PlatformOperation = { id: "TXQPVGJG", platform: "weibo", label: "微博作品搜索", purpose: "query", schedulableType: "search", collectionCapabilities: { detailEnrichment: true, detailOperations: [{ operationId: "API_1789098514899", label: "微博详情", fields: [], price: null }] }, collectionPrice: { amount: 0.06, currency: "CNY", basis: "estimated" }, fields: [{ name: "keyword", label: "关键词", type: "string", required: true }, { name: "searchType", label: "类型", type: "select", required: true, default: "61", options: [{ value: "61", label: "作品" }, { value: "3", label: "账号" }] }, { name: "page", label: "页码", type: "string", required: true, default: "1", constraints: { pattern: "^[1-9][0-9]*$", max: Number.MAX_SAFE_INTEGER } }] };
const snapshot: PlatformOperation = { id: "UAQ90A1F", platform: "weibo", label: "微博热搜", purpose: "研究快照", schedulableType: "trend", collectionCapabilities: { detailEnrichment: false }, fields: [] };
const douyin: PlatformOperation = { id: "OWIBYU1V", platform: "douyin", label: "抖音作品搜索", purpose: "query", schedulableType: "search", collectionCapabilities: { detailEnrichment: false }, fields: [{ name: "keyword", label: "关键词", type: "string", required: true }, { name: "exactMatch", label: "精准", type: "boolean", required: false, default: false }, { name: "pageNum", label: "页码", type: "integer", required: false, default: 1, constraints: { min: 1 } }] };
const trend: PlatformOperation = { id: "P3W2W18P", platform: "xiaohongshu", label: "小红书榜单", purpose: "作品榜", schedulableType: "trend", collectionCapabilities: { detailEnrichment: false }, fields: [{ name: "category", label: "类别", type: "select", required: true, options: [{ value: "科学探索", label: "科学探索" }] }] };
const insight: PlatformOperation = { id: "3X8FGEEM", platform: "xiaohongshu", label: "洞察", purpose: "作品与研究", schedulableType: "search", fields: [{ name: "keyword", label: "关键词", type: "string", required: false }, { name: "pageNum", label: "页码", type: "integer", required: false, default: 1 }, { name: "pageSize", label: "每页", type: "integer", required: false, default: 10 }] };
const current: CollectionSubscription = { id: 12, platform: "weibo", name: "微博研究", operationId: weibo.id, parameters: { keyword: "AI", searchType: "61", page: "1" }, enabled: true, intervalMinutes: 30, enrichDetails: true, limits: { pages: 3, items: 100, details: 20 }, editVersion: 7, executionVersion: 3, nextRunAt: null, activeRun: null };

test("only explicit schedulable metadata exposes operations, without assuming platform or array size", () => {
  const list = { ...douyin, id: "new-list", schedulableType: "list" as const };
  const future = { ...douyin, id: "future-allowed", platform: "future", schedulableType: "search" as const };
  const unsupported = { ...douyin, id: "not-open", schedulableType: null };
  const absent = { ...douyin, id: "missing-field", schedulableType: undefined } as unknown as PlatformOperation;
  assert.deepEqual(collectionOperations([weibo, snapshot, douyin, trend, list, future, unsupported, absent]).map(row => row.id), [weibo.id, snapshot.id, douyin.id, trend.id, "new-list", "future-allowed"]);
});
test("legacy Weibo bodies retain string page, flags and original defaults; UA alone is the no-param snapshot", () => {
  const initial = collectionDraft(weibo); initial.name = " 微博研究 "; initial.values.keyword = "AI";
  assert.deepEqual(collectionConfig(weibo, initial), { name: "微博研究", operationId: weibo.id, parameters: { keyword: "AI", searchType: "61", page: "1" }, enabled: false, intervalMinutes: 15, enrichDetails: false, limits: { pages: 3, items: 100, details: 20 } });
  assert.equal(isWeiboSnapshot(snapshot), true); assert.equal(isWeiboSnapshot(trend), false);
  const snapDraft = { ...collectionDraft(snapshot), name: "热搜" };
  assert.deepEqual(collectionConfig(snapshot, snapDraft).parameters, {}); assert.deepEqual(collectionConfig(snapshot, snapDraft).limits, { pages: 3, items: 100, details: 20 });
  assert.throws(() => collectionConfig(weibo, { ...initial, values: { ...initial.values, searchType: "3" } }));
});
test("new platforms default disabled/details0 and preserve false/integer wire types without a platform field in body", () => {
  const initial = { ...collectionDraft(douyin), name: "抖音", values: { keyword: "AI", exactMatch: "false", pageNum: "2" }, enrichDetails: true };
  const body = collectionConfig(douyin, initial);
  assert.deepEqual(body.parameters, { keyword: "AI", exactMatch: false, pageNum: 2 }); assert.equal(body.enabled, false); assert.equal(body.enrichDetails, false); assert.equal(body.limits.details, 0); assert(!Object.hasOwn(body, "platform"));
  assert.equal(collectionDetailsAvailable(weibo), true); assert.equal(collectionDetailsAvailable({ ...douyin, collectionCapabilities: undefined }), false);
});
test("non-UA trend keeps descriptor parameters and real item/page limits rather than snapshot behavior", () => {
  const initial = { ...collectionDraft(trend), name: "榜单", values: { category: "科学探索" }, pages: 4, items: 230 };
  const body = collectionConfig(trend, initial);
  assert.deepEqual(body.parameters, { category: "科学探索" }); assert.deepEqual(body.limits, { pages: 4, items: 230, details: 0 });
  assert.equal(isWeiboSnapshot({ ...snapshot, platform: "douyin" }), false);
  assert(!collectionPagingNote(trend, initial.values).includes("微博热搜"));
});
test("only explicit capability opens details, and existing unsupported details limits remain facts on nonexecution edits", () => {
  const existing = { ...current, platform: "douyin", operationId: douyin.id, parameters: { keyword: "AI", exactMatch: false }, enrichDetails: false, limits: { pages: 2, items: 80, details: 20 } };
  const body = collectionConfig(douyin, collectionDraft(douyin, existing), "douyin");
  assert.equal(body.limits.details, 20); assert.equal(body.enrichDetails, false);
  const opened = { ...douyin, collectionCapabilities: { detailEnrichment: true, detailOperations: [{ operationId: "FK67XDVQ", label: "详情", fields: [], price: null }] } };
  assert.equal(collectionConfig(opened, { ...collectionDraft(opened), name: "已接通", values: { keyword: "AI" }, enrichDetails: true, detailOperationId: "FK67XDVQ" }).enrichDetails, true);
});
test("platform lock and configuration/parameter/limit changes preserve CAS execution semantics", () => {
  assert.throws(() => collectionConfig(douyin, { ...collectionDraft(douyin), name: "x", values: { keyword: "AI" } }, "weibo"));
  const old = collectionConfig(weibo, collectionDraft(weibo, current), "weibo");
  assert.equal(subscriptionExecutionChanges(current, { ...old, name: "改名", intervalMinutes: 60 }), false);
  assert.equal(subscriptionExecutionChanges(current, { ...old, parameters: { page: "1", keyword: "AI", searchType: "61" } }), false);
  for (const changed of [{ ...old, operationId: snapshot.id }, { ...old, enabled: false }, { ...old, limits: { ...old.limits, items: 101 } }, { ...old, parameters: { ...old.parameters, keyword: "robot" } }]) assert.equal(subscriptionExecutionChanges(current, changed), true);
  const arrays = { ...old, parameters: { ids: ["1", "2"], flag: false } }; assert.equal(subscriptionExecutionChanges(arrays, { ...arrays, parameters: { flag: false, ids: ["1", "2"] } }), false); assert.equal(subscriptionExecutionChanges(arrays, { ...arrays, parameters: { flag: false, ids: ["2", "1"] } }), true);
});
test("save commands carry exact existing CAS version or create config without manufacturing IDs", () => {
  const config = collectionConfig(weibo, collectionDraft(weibo, current));
  assert.deepEqual(collectionSaveCommand(null, null, config), { method: "POST", path: "/api/admin/redfox/collections", body: config });
  assert.deepEqual(collectionSaveCommand(12, 7, config), { method: "PATCH", path: "/api/admin/redfox/collections/12", body: { editVersion: 7, config } });
  for (const version of [null, 0, -1, 1.5]) assert.throws(() => collectionSaveCommand(12, version, config));
});
test("per-operation drafts and query-seed snapshots are isolated; seed never enables or creates a subscription", () => {
  const values = { keyword: " 原词 ", exactMatch: "false", pageNum: "3" }, seed = { operationId: douyin.id, values, sequence: 1 };
  const seeded = collectionDraft(douyin, null, seed), separate = collectionDraft(weibo, null, seed);
  values.keyword = "changed later"; assert.equal(seeded.values.keyword, " 原词 "); assert.equal(separate.values.keyword, ""); assert.equal(seeded.enabled, false); assert.equal(seeded.details, 0);
  seeded.values.keyword = "edited"; assert.equal(separate.values.keyword, "");
  assert.equal(collectionDraft(weibo, current, { ...seed, operationId: weibo.id }).values.keyword, "AI");
});
test("collection links use the source view and query handoff keeps raw parameters in isolated navigation state", () => {
  assert.equal(collectionSubscriptionsHref(), "/admin/sources?view=collections");
  assert.equal(collectionSubscriptionsHref(12), "/admin/sources?view=collections&subscription=12");
  const values = { keyword: " 原词 & ? ", exactMatch: "false", pageNum: "3" };
  const target = collectionSeedNavigation(douyin.id, values);
  assert.equal(target.to, "/admin/sources?view=collections");
  const seed = collectionSeedFromState(target.state)!;
  assert.deepEqual(seed.values, values);assert.equal(seed.operationId,douyin.id);
  values.keyword = "changed";assert.equal(seed.values.keyword," 原词 & ? ");
  target.state.collectionSeed.values.keyword = "later";assert.equal(seed.values.keyword," 原词 & ? ");
  assert.equal(collectionDraft(douyin,null,seed).enabled,false);
  for (const state of [null, {}, { collectionSeed: null }, { collectionSeed: { operationId: douyin.id, values: "{}", sequence: 1 } }, { collectionSeed: { operationId: douyin.id, values: { keyword: 3 }, sequence: 1 } }]) assert.equal(collectionSeedFromState(state),null);
});
test("preview is a one-off query-only body and uses the same raw/boolean conversions without name, enabled, limits or CAS", () => {
  assert.deepEqual(collectionPreviewBody(douyin, { keyword: "AI", exactMatch: "false", pageNum: "2" }), { operationId: douyin.id, parameters: { keyword: "AI", exactMatch: false, pageNum: 2 } });
  assert.throws(() => collectionPreviewBody({ ...douyin, schedulableType: null }, { keyword: "AI" }));
  assert.throws(() => collectionPreviewBody(douyin, { keyword: "" }));
  const youtube: PlatformOperation = { id: "GC5SC5HS", platform: "youtube", label: "搜索", purpose: "query", schedulableType: "search", fields: [{ name: "searchQuery", label: "词", type: "string", required: true }, { name: "continuationToken", label: "游标", type: "string", required: false }] };
  const parameters = platformQueryParameters(youtube, { searchQuery: "AI", continuationToken: " raw | token " });
  assert.equal(parameters.continuationToken, " raw | token "); assert.deepEqual(collectionPreviewBody(youtube, { searchQuery: "AI", continuationToken: " raw | token " }).parameters, parameters);
});
test("zero request estimate remains visible while missing/null estimates remain unknown and no round total is computed", () => {
  assert.match(collectionPriceNote({ ...douyin, collectionPrice: { amount: 0, currency: "CNY", basis: "estimated" } }), /0 CNY/);
  assert.match(collectionPriceNote({ ...douyin, collectionPrice: { amount: null, currency: "CNY", basis: "estimated" } }), /未知/);
  assert.match(collectionPriceNote({ ...douyin, collectionPrice: undefined }), /未知/);
  assert.match(collectionPriceNote(weibo), /不是整轮总价/);
});
test("insight keyword controls single-page explanation and research counts never become imported work counts", () => {
  assert.match(collectionPagingNote(insight, { keyword: "AI" }), /只查询一页/); assert.match(collectionPagingNote(insight, { keyword: "" }), /无关键词/);
  const rows = collectionSummaryRows({ operationId: insight.id, workCount: 2, selectedCount: 1, researchCount: 3, selectedResearchCount: 2, unprocessedResearchDueToLimit: 1 });
  assert.deepEqual(rows.map(([, value]) => value), ["2", "1", "3", "2", "1"]); assert(rows.some(([label]) => label.includes("研究"))); assert(!rows.some(([label]) => label.includes("入库文章")));
  assert.deepEqual(collectionSummaryRows({ count: 0 }), []); assert(isCollectionOperationKey("redfox.weibo.collection")); assert(isCollectionOperationKey("redfox.platform.collection")); assert(!isCollectionOperationKey("redfox.wechat.collection"));
});
