import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionConfig, collectionDetailsAvailable, collectionDraft, collectionOperations, collectionPagingNote, collectionPreviewBody, collectionPriceNote, collectionProviders, collectionSaveCommand, collectionProviderCommand, collectionProviderPreflightMatches, collectionSeedFromState, collectionSeedNavigation, collectionSubscriptionsHref, collectionSummaryRows, collectionPageSummary, isCollectionOperationKey, isAgentKeySinglePageSnapshot, isWeiboSnapshot } from "../app/features/admin/collection-subscription-data.ts";
import type { PlatformCollectionProviderPreflight } from "@aihot/contracts/redfox";
import { subscriptionExecutionChanges, type CollectionSubscription } from "../app/features/admin/collection-subscription-types.ts";
import { platformQueryParameters } from "../app/features/admin/platform-query-data.ts";
import type { PlatformOperation } from "../app/features/admin/platform-types.ts";
const weibo: PlatformOperation = { id: "TXQPVGJG", platform: "weibo", label: "微博作品搜索", purpose: "query", schedulableType: "search", collectionCapabilities: { detailEnrichment: true, detailOperations: [{ operationId: "API_1789098514899", label: "微博详情", fields: [], price: null }] }, collectionPrice: { amount: 0.06, currency: "CNY", basis: "estimated" }, fields: [{ name: "keyword", label: "关键词", type: "string", required: true }, { name: "searchType", label: "类型", type: "select", required: true, default: "61", options: [{ value: "61", label: "作品" }, { value: "3", label: "账号" }] }, { name: "page", label: "页码", type: "string", required: true, default: "1", constraints: { pattern: "^[1-9][0-9]*$", max: Number.MAX_SAFE_INTEGER } }] };
const snapshot: PlatformOperation = { id: "UAQ90A1F", platform: "weibo", label: "微博热搜", purpose: "研究快照", schedulableType: "trend", collectionCapabilities: { detailEnrichment: false }, fields: [] };
const douyin: PlatformOperation = { id: "OWIBYU1V", platform: "douyin", label: "抖音作品搜索", purpose: "query", schedulableType: "search", collectionCapabilities: { detailEnrichment: false }, fields: [{ name: "keyword", label: "关键词", type: "string", required: true }, { name: "exactMatch", label: "精准", type: "boolean", required: false, default: false }, { name: "pageNum", label: "页码", type: "integer", required: false, default: 1, constraints: { min: 1 } }] };
const trend: PlatformOperation = { id: "P3W2W18P", platform: "xiaohongshu", label: "小红书榜单", purpose: "作品榜", schedulableType: "trend", collectionCapabilities: { detailEnrichment: false }, fields: [{ name: "category", label: "类别", type: "select", required: true, options: [{ value: "科学探索", label: "科学探索" }] }] };
const insight: PlatformOperation = { id: "3X8FGEEM", platform: "xiaohongshu", label: "洞察", purpose: "作品与研究", schedulableType: "search", fields: [{ name: "keyword", label: "关键词", type: "string", required: false }, { name: "pageNum", label: "页码", type: "integer", required: false, default: 1 }, { name: "pageSize", label: "每页", type: "integer", required: false, default: 10 }] };
const current: CollectionSubscription = { id: 12, provider: "redfox", platform: "weibo", name: "微博研究", operationId: weibo.id, parameters: { keyword: "AI", searchType: "61", page: "1" }, enabled: true, intervalMinutes: 30, enrichDetails: true, limits: { pages: 3, items: 100, details: 20 }, editVersion: 7, executionVersion: 3, nextRunAt: null, activeRun: null };

test("only explicit schedulable metadata exposes operations, without assuming platform or array size", () => {
  const list = { ...douyin, id: "new-list", schedulableType: "list" as const };
  const future = { ...douyin, id: "future-allowed", platform: "future", schedulableType: "search" as const };
  const unsupported = { ...douyin, id: "not-open", schedulableType: null };
  const absent = { ...douyin, id: "missing-field", schedulableType: undefined } as unknown as PlatformOperation;
  assert.deepEqual(collectionOperations([weibo, snapshot, douyin, trend, list, future, unsupported, absent]).map(row => row.id), [weibo.id, snapshot.id, douyin.id, trend.id, "new-list", "future-allowed"]);
});
test("legacy Weibo bodies retain string page, flags and original defaults; UA alone is the no-param snapshot", () => {
  const initial = collectionDraft(weibo); initial.name = " 微博研究 "; initial.values.keyword = "AI";
  assert.deepEqual(collectionConfig(weibo, initial), { autoDownloadVideo: false, name: "微博研究", provider: "redfox", operationId: weibo.id, parameters: { keyword: "AI", searchType: "61", page: "1" }, enabled: false, intervalMinutes: 15, enrichDetails: false, limits: { pages: 3, items: 100, details: 20 } });
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
test("provider options come from the operation capability and future providers require no frontend branch", () => {
  const future = { ...douyin, collectionProviders: [{ id: "redfox", label: "Redfox" }, { id: "agentkey", label: "AgentKey" }] };
  assert.deepEqual(collectionProviders(future).map(provider => provider.id), ["redfox", "agentkey"]);
  const draft = { ...collectionDraft(future), name: "未来供应商", values: { keyword: "AI" }, provider: "agentkey" };
  assert.equal(collectionConfig(future, draft).provider, "agentkey");
  assert.throws(() => collectionConfig(future, { ...draft, provider: "unsupported" }), /不支持所选供应商/);
  assert.throws(() => collectionConfig({ ...future, collectionProviders: [] }, { ...draft, provider: "" }), /不支持所选供应商/);
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
  for (const changed of [{ ...old, provider: "agentkey" }, { ...old, operationId: snapshot.id }, { ...old, enabled: false }, { ...old, limits: { ...old.limits, items: 101 } }, { ...old, parameters: { ...old.parameters, keyword: "robot" } }]) assert.equal(subscriptionExecutionChanges(current, changed), true);
  const arrays = { ...old, parameters: { ids: ["1", "2"], flag: false } }; assert.equal(subscriptionExecutionChanges(arrays, { ...arrays, parameters: { flag: false, ids: ["1", "2"] } }), false); assert.equal(subscriptionExecutionChanges(arrays, { ...arrays, parameters: { flag: false, ids: ["2", "1"] } }), true);
});
test("save commands carry exact existing CAS version or create config without manufacturing IDs", () => {
  const config = collectionConfig(weibo, collectionDraft(weibo, current));
  assert.deepEqual(collectionSaveCommand(null, null, config), { method: "POST", path: "/api/admin/redfox/collections", body: config });
  assert.deepEqual(collectionSaveCommand(12, 7, config), { method: "PATCH", path: "/api/admin/redfox/collections/12", body: { editVersion: 7, config } });
  for (const version of [null, 0, -1, 1.5]) assert.throws(() => collectionSaveCommand(12, version, config));
});
test("provider commands carry only saved CAS and target, and stale or mismatched preflights cannot authorize switching", () => {
  assert.deepEqual(collectionProviderCommand(12, 7, "agentkey"), {path: "/api/admin/redfox/collections/12/provider/preflight", body: {editVersion: 7, targetProvider: "agentkey"}});
  assert.deepEqual(collectionProviderCommand(12, 7, "agentkey", "明确选择"), {path: "/api/admin/redfox/collections/12/provider/switch", body: {editVersion: 7, targetProvider: "agentkey", reason: "明确选择"}});
  const preflight: PlatformCollectionProviderPreflight = {subscriptionId: current.id, editVersion: 7, currentProvider: "redfox", targetProvider: "agentkey", supported: true, checks: [], impact: {activeRunId: null, enabled: true, intervalMinutes: 30, limits: current.limits, note: "影响"}};
  assert.equal(collectionProviderPreflightMatches(preflight, current, 7, "agentkey"), true);
  for (const candidate of [{...preflight, supported: false}, {...preflight, editVersion: 6}, {...preflight, subscriptionId: 13}, {...preflight, currentProvider: "agentkey"}, {...preflight, targetProvider: "redfox" as const}]) assert.equal(collectionProviderPreflightMatches(candidate, current, 7, "agentkey"), false);
  assert.equal(collectionProviderPreflightMatches(preflight, {...current, editVersion: 8}, 7, "agentkey"), false);
  assert.equal(collectionProviderPreflightMatches(preflight, current, 8, "agentkey"), false);
  const updated: CollectionSubscription = {...current, provider: "agentkey", platform: "douyin", operationId: "OWIBYU1V", parameters: {keyword: "目标词"}, editVersion: 8, enrichDetails: false};
  const synced = collectionDraft(douyin, updated);
  assert.equal(synced.provider, "agentkey");
  assert.deepEqual(synced.values, {keyword: "目标词"});
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
  assert.deepEqual(collectionPreviewBody(douyin, { keyword: "AI", exactMatch: "false", pageNum: "2" }), { provider:"redfox",operationId: douyin.id, parameters: { keyword: "AI", exactMatch: false, pageNum: 2 } });
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
  assert(isCollectionOperationKey("agentkey.douyin.search", "agentkey", "collection"));
  assert(!isCollectionOperationKey("agentkey.douyin.search", "agentkey", "query"));
});

test("provider-specific account draft and list metadata preserve the selected execution contract", () => {
  const base: PlatformOperation = {id:"QEQLCKD6",platform:"douyin",label:"账号作品（优质库 T+1）",purpose:"Redfox",schedulableType:"list",
    fields:[{name:"secUserId",label:"安全 ID",type:"string",required:true}],
    collectionCapabilities:{detailEnrichment:false,detailOperations:[]},
    collectionProviders:[{id:"redfox",label:"Redfox"},{id:"agentkey",label:"AgentKey · TikHub",operationLabel:"抖音账号作品（TikHub）",
      fields:[{name:"sec_user_id",label:"安全 ID",type:"string",required:true},{name:"count",label:"条数",type:"integer",required:false,default:20}],
      purpose:"normal 通道",collectionPrice:{amount:0.2,currency:"credits",basis:"estimated"},
      collectionCapabilities:{detailEnrichment:true,detailOperations:[{operationId:"FK67XDVQ",label:"详情 V2",fields:[],price:{amount:0.2,currency:"credits",basis:"estimated"}}]}}]};
  const draft=collectionDraft(base,null,{provider:"agentkey",operationId:base.id,sequence:1,values:{sec_user_id:"public-account"}});
  assert.equal(draft.provider,"agentkey"); assert.deepEqual(draft.values,{sec_user_id:"public-account",count:"20"});
  assert.equal(draft.enabled,false); assert.equal(draft.details,20);
  const config=collectionConfig(base,{...draft,name:"账号作品"});
  assert.deepEqual(config.parameters,{sec_user_id:"public-account",count:20}); assert.equal(config.provider,"agentkey"); assert.equal(config.enrichDetails,false);
  assert(isCollectionOperationKey("agentkey.douyin.account_posts","agentkey","collection"));
  assert(!isCollectionOperationKey("agentkey.douyin.detail","agentkey","query"));
});


test("historical AgentKey one-off summaries do not become collection pages or work counts", () => {
  assert.equal(collectionPageSummary("query_summary",{provider:"agentkey",stopReason:"single-request",returnedPage:{},selectedCount:1}),null);
  assert(collectionPageSummary("query_summary",{provider:"agentkey",stopReason:"page-limit",returnedPage:{cursor:1},selectedCount:1}));
});


test("AgentKey single-page snapshot forms fix page/detail limits and retain actual item limits", () => {
  for (const id of ["douyin.trending", "douyin.comments", "douyin.comment_replies", "douyin.topic_posts", "douyin.following", "toutiao.comments", "xiaohongshu.comments", "xiaohongshu.topic_posts", "xiaohongshu.recommendations"]) {
    const operation: PlatformOperation = {id,platform:id.split(".")[0]!,label:id,purpose:"single snapshot",schedulableType:"list",fields:[],collectionProviders:[{id:"agentkey",label:"AgentKey · TikHub"}],collectionCapabilities:{detailEnrichment:false,detailOperations:[]}};
    const draft=collectionDraft(operation); assert.equal(draft.pages,1); assert.equal(draft.details,0); assert.equal(draft.enabled,false);
    const config=collectionConfig(operation,{...draft,name:"快照",items:7,pages:9,details:30,enrichDetails:true});
    assert.deepEqual(config.limits,{pages:1,items:7,details:0}); assert.equal(config.enrichDetails,false);
    assert.equal(isCollectionOperationKey(`agentkey.${id}`, "agentkey", "collection"), true);
    assert.equal(isCollectionOperationKey(`agentkey.${id}`, "agentkey", "query"), false);
  }
  const rows=collectionSummaryRows({provider:"agentkey",snapshot:true,operationId:"douyin.following",returnedPage:{},count:19,selectedCount:10,unprocessedDueToLimit:9});
  assert(rows.some(([label,value])=>label==="本页选取快照"&&value==="10")); assert(rows.some(([label,value])=>label==="因限额未选快照"&&value==="9"));
});

test("AgentKey Xiaohongshu one-page lists preserve only explicitly chosen bounded details",()=>{
  for(const id of ["384C6W6B","XN3ULENA"]){
    const target={operationId:"KR1LPTBF",label:"统一笔记详情",fields:[],price:{amount:2,currency:"credits",basis:"estimated" as const}};
    const operation:PlatformOperation={id,platform:"xiaohongshu",label:id,purpose:"笔记首页",schedulableType:"list",fields:[],collectionProviders:[{id:"agentkey",label:"AgentKey · TikHub"}],collectionCapabilities:{detailEnrichment:true,detailOperations:[target]}};
    const draft=collectionDraft(operation); assert.equal(draft.pages,1); assert.equal(draft.details,0); assert.equal(draft.enrichDetails,false);
    const disabled=collectionConfig(operation,{...draft,name:"列表",pages:8,details:4}); assert.deepEqual(disabled.limits,{pages:1,items:100,details:0});
    const explicit=collectionConfig(operation,{...draft,name:"列表",pages:8,details:1,enrichDetails:true,detailOperationId:"KR1LPTBF"}); assert.equal(explicit.enrichDetails,true); assert.deepEqual(explicit.limits,{pages:1,items:100,details:1});
    assert.throws(()=>collectionConfig(operation,{...draft,name:"列表",enrichDetails:true,details:1}),/请选择.*详情目标/);
    const key=id==="384C6W6B"?"agentkey.xiaohongshu.search":"agentkey.xiaohongshu.account_posts";
    assert.equal(isCollectionOperationKey(key,"agentkey","collection"),true); assert.equal(isCollectionOperationKey(key,"agentkey","query"),false);
  }
});


test("Bilibili nine snapshots fix pages and three lists retain explicit bounded detail choices", () => {
  const lists = ["LEN9QXR3", "VPA67I98", "bilibili.typed_search"];
  for (const id of [...lists, "bilibili.comments", "bilibili.comment_replies", "bilibili.relation_stats", "bilibili.dynamics", "bilibili.trending", "bilibili.hot_search"]) {
    const enrich = lists.includes(id);
    const operation: PlatformOperation = { id, platform: "bilibili", label: id, purpose: "snapshot", schedulableType: "list", fields: [], collectionProviders: [{ id: "agentkey", label: "AgentKey" }], collectionCapabilities: { detailEnrichment: enrich, detailOperations: enrich ? [{ operationId: "TIN1NMTZ", label: "详情", fields: [], price: null }] : [] } };
    const draft = collectionDraft(operation); assert.equal(draft.pages, 1); assert.equal(draft.details, 0);
    const config = collectionConfig(operation, { ...draft, name: "快照", pages: 8, details: 2, enrichDetails: enrich, detailOperationId: enrich ? "TIN1NMTZ" : "" });
    assert.deepEqual(config.limits, { pages: 1, items: 100, details: enrich ? 2 : 0 });
    const saved = collectionDraft(operation, { ...current, ...config, platform: "bilibili", id: 1 });
    assert.equal(saved.details, enrich ? 2 : 0); assert.equal(saved.enrichDetails, enrich); assert.equal(saved.detailOperationId, enrich ? "TIN1NMTZ" : "");
  }
});

test("all six AgentKey Weibo subscriptions keep homepage, details0 by default and explicit saved detail recipe", () => {
  for (const id of ["TXQPVGJG", "weibo.account_posts", "weibo.comments", "weibo.following", "UAQ90A1F", "weibo.related_search"]) {
    const detail = ["TXQPVGJG", "weibo.account_posts"].includes(id), operation: PlatformOperation = { id, platform: "weibo", label: id, purpose: "query", schedulableType: "list", fields: [], collectionProviders: [{ id: "agentkey", label: "AgentKey", fields: [], collectionCapabilities: { detailEnrichment: detail, detailOperations: detail ? [{ operationId: "API_1789098514899", label: "实收数字 ID 详情", fields: [], price: null }] : [] } }] };
    assert.equal(isAgentKeySinglePageSnapshot(operation, "agentkey"), true);
    assert.equal(isAgentKeySinglePageSnapshot(operation, "redfox"), false);
    const draft = { ...collectionDraft(operation), name: "微博订阅" };
    assert.equal(draft.pages, 1); assert.equal(draft.details, 0); assert.equal(draft.enrichDetails, false); assert.equal(draft.detailOperationId, "");
    assert.deepEqual(collectionConfig(operation, { ...draft, pages: 3 }).limits, { pages: 1, items: 100, details: 0 });
    if (detail) {
      assert.throws(() => collectionConfig(operation, { ...draft, enrichDetails: true, details: 2 }), /请选择.*详情目标/);
      const config = collectionConfig(operation, { ...draft, enrichDetails: true, details: 2, detailOperationId: "API_1789098514899" });
      assert.equal(config.detailOperationId, "API_1789098514899"); assert.equal(config.limits.details, 2);
      const saved = collectionDraft(operation, { ...current, ...config, platform: "weibo", id: 12 });
      assert.equal(saved.enrichDetails, true); assert.equal(saved.detailOperationId, "API_1789098514899"); assert.equal(saved.details, 2);
    }
  }
  for (const key of ["search", "account_posts", "comments", "following", "trending", "related_search"]) assert.equal(isCollectionOperationKey(`agentkey.weibo.${key}`, "agentkey", "collection"), true);
  assert.equal(isCollectionOperationKey("agentkey.weibo.detail", "agentkey", "collection"), false);
});

test("X query provider metadata preserves Redfox queries while only actual collection providers can seed subscriptions", async () => {
  const { queryProviders, providerOperation, collectionInputIssue } = await import("../app/features/admin/collection-subscription-data.ts");
  const variant = { id: "agentkey", label: "AgentKey · TikHub", operationLabel: "X 会话评论", fields: [{ name: "tweet_id", label: "会话根帖 ID", type: "string" as const, required: true }], collectionCapabilities: { detailEnrichment: false }, collectionPrice: { amount: .2, currency: "credits", basis: "estimated" as const } };
  const operation: PlatformOperation = { id: "ABJQXHUE", platform: "x-research", label: "RF评论", purpose: "query", schedulableType: "list", fields: [{ name: "tweetId", label: "推文ID", type: "string", required: true }], queryProviders: [{ id: "redfox", label: "Redfox" }, variant], collectionProviders: [variant] };
  assert.deepEqual(queryProviders(operation).map(row => row.id), ["redfox", "agentkey"]);
  assert.deepEqual(collectionProviders(operation).map(row => row.id), ["agentkey"]);
  assert.equal(providerOperation(operation, "redfox").fields[0]?.name, "tweetId");
  assert.equal(providerOperation(operation, "agentkey").fields[0]?.name, "tweet_id");
  assert.equal(collectionDraft(operation).provider, "agentkey");
  assert.match(collectionInputIssue(operation, { tweetId: "123" }, "redfox")!, /仅支持单次查询/);
  assert.throws(() => collectionConfig(operation, { ...collectionDraft(operation), name: "bad", provider: "redfox", values: { tweetId: "123" } }), /不支持所选供应商/);
  const seed = collectionSeedFromState(collectionSeedNavigation(operation.id, { tweet_id: "123" }, "agentkey").state)!;
  const draft = { ...collectionDraft(operation, null, seed), name: "首页评论" };
  assert.deepEqual(collectionConfig(operation, draft).parameters, { tweet_id: "123" });
  assert.equal(draft.enabled, false);
  assert.deepEqual(queryProviders(douyin), collectionProviders(douyin));
  assert.equal(collectionDraft(douyin, null, seed).provider, "redfox", "seed provider belongs only to its operation");
});

test("all ten X AgentKey snapshots freeze homepage and zero details without changing Redfox bounds", async () => {
  const { providerOperation } = await import("../app/features/admin/collection-subscription-data.ts");
  const ids = ["5K5EG87P", "x.account_posts", "ABJQXHUE", "x.followers", "5QY3G5TY", "x.list_posts", "x.community_posts", "x.trending", "x.list_members", "x.community_members"];
  for (const id of ids) {
    const operation: PlatformOperation = { id, platform: "x-research", label: id, purpose: "query", schedulableType: "list", fields: [], collectionProviders: [{ id: "agentkey", label: "AgentKey", fields: [] }] };
    const values: Record<string, string> = id === "5K5EG87P" ? { keyword: "AI" } : id === "x.account_posts" ? { screen_name: "actual_user" } : {};
    const view: PlatformOperation = { ...operation, collectionProviders: [{ id: "agentkey", label: "AgentKey", fields: Object.keys(values).map(name => ({ name, label: name, type: "string", required: true })) }] };
    const draft = { ...collectionDraft(view), name: id, values };
    const config = collectionConfig(view, draft);
    assert(isAgentKeySinglePageSnapshot(operation, "agentkey"), id);
    assert.deepEqual(config.limits, { pages: 1, items: 100, details: 0 }, id);
    assert.equal(config.provider, "agentkey"); assert.equal(config.enabled, false); assert.equal(config.enrichDetails, false);
    assert.match(collectionPagingNote(providerOperation(view, "agentkey"), draft.values, "agentkey"), /置顶、转发与研究/);
    assert.throws(() => collectionConfig(view, { ...draft, pages: 2 }), /首页一次/);
    for (const patch of [{ details: 1 }, { enrichDetails: true }, { detailOperationId: "x.detail" }, { detailPage: "1" }]) assert.throws(() => collectionConfig(view, { ...draft, ...patch }), /零详情/);
  }
  for (const id of ["x.detail", "x.account_profile"]) assert.equal(isAgentKeySinglePageSnapshot({ ...douyin, id, platform: "x-research" }, "agentkey"), false);
  const rf: PlatformOperation = { ...douyin, id: "5K5EG87P", platform: "x-research" };
  assert.equal(isAgentKeySinglePageSnapshot(rf, "redfox"), false);
  assert.equal(collectionDraft(rf).pages, 3);
  for (const key of ["search", "account_posts", "comments", "followers", "following", "list_posts", "community_posts", "trending", "list_members", "community_members"]) {
    assert(isCollectionOperationKey(`agentkey.x.${key}`, "agentkey", "collection"));
    assert.equal(isCollectionOperationKey(`agentkey.x.${key}`, "agentkey", "query"), false);
  }
});

test("X subscription restrictions preserve raw basic keywords and refuse extra input without narrowing one-off queries", async () => {
  const { providerOperation, collectionInputIssue } = await import("../app/features/admin/collection-subscription-data.ts");
  const fields: PlatformOperation["fields"] = [{ name: "keyword", label: "关键词", type: "string", required: true }, { name: "search_type", label: "排序", type: "select", required: true, default: "Top", options: ["Top", "Latest"].map(value => ({ value, label: value })) }];
  const base: PlatformOperation = { id: "5K5EG87P", platform: "x-research", label: "搜索", purpose: "query", schedulableType: "search", fields: [], collectionProviders: [{ id: "redfox", label: "Redfox" }, { id: "agentkey", label: "AgentKey", fields }] };
  const operation = providerOperation(base, "agentkey");
  for (const keyword of ["  中文 AI 2026\n新技术\t ", "über 東京 １２３"]) {
    const values = { keyword, search_type: "Latest" }, draft = { ...collectionDraft(base, null, { operationId: base.id, provider: "agentkey", values, sequence: 1 }), name: "基础搜索" };
    assert.equal(collectionInputIssue(operation, values, "agentkey"), null);
    assert.deepEqual(collectionConfig(base, draft).parameters, values);
    assert.equal(platformQueryParameters(operation, values).keyword, keyword);
  }
  for (const keyword of ["AI OR models", "AI AND models", "NOT AI", "from:author", "AI -reply", "AI#", "AI+ML", "AI,ML", '"AI"']) {
    const values = { keyword, search_type: "Top" };
    assert.match(collectionInputIssue(operation, values, "agentkey")!, /基础关键词/);
    assert.throws(() => collectionConfig(base, { ...collectionDraft(base), provider: "agentkey", pages: 1, name: "拒绝", values }), /基础关键词/);
    assert.equal(platformQueryParameters(operation, values).keyword, keyword, "Q keeps its existing broader input");
  }
  const values = { keyword: "AI", search_type: "Top", cursor: " opaque " };
  assert.throws(() => collectionConfig(base, { ...collectionDraft(base), provider: "agentkey", pages: 1, name: "拒绝", values }), /不会自动丢弃/);
  assert.throws(() => collectionConfig(base, { ...collectionDraft(base), provider: "agentkey", pages: 1, name: "拒绝", values: { keyword: "AI", search_type: "Top", requiredUnknown: "actual" } }), /不会自动丢弃/);
  assert.throws(() => collectionConfig(base, { ...collectionDraft(base), provider: "agentkey", pages: 1, name: "拒绝", values: { keyword: "AI" } }), /排序/);
  const rf: PlatformOperation = { ...base, fields: [{ name: "keyword", label: "关键词", type: "string", required: true }, { name: "searchType", label: "排序", type: "select", required: false, options: ["Top", "Latest", "People"].map(value => ({ value, label: value })) }, { name: "cursor", label: "游标", type: "string", required: false }] };
  const rfValues = { keyword: "  AI OR ML  ", searchType: "Latest", cursor: "  opaque  " };
  assert.deepEqual(collectionConfig(rf, { ...collectionDraft(rf), name: "RF原有采集", values: rfValues }).parameters, rfValues);
  assert.equal(platformQueryParameters(rf, { ...rfValues, searchType: "People" }).searchType, "People");
});

test("X collection summaries retain count, selected entries and omitted entries independently of article totals", () => {
  const data = { platform: "x-research", provider: "agentkey", operationId: "x.account_posts", count: 7, selectedCount: 3, unprocessedDueToLimit: 4, returnedPage: { next_cursor: "  next  ", more_users: false }, nextParameters: null };
  const summary = collectionPageSummary("query_summary", data)!;
  assert.deepEqual(summary.rows, [["本页实际返回条目", "7"], ["本页选取条目（含置顶、转发与研究）", "3"], ["因限额未选条目", "4"]]);
  assert.deepEqual(summary.returned, [["next_cursor", "  next  "], ["more_users", "false（布尔值）"]]);
  assert.deepEqual(summary.next, [["nextParameters", "null（本页不续页）"]]);
  assert.equal(collectionPageSummary("query_summary", { ...data, returnedPage: {}, count: 0, selectedCount: 0, unprocessedDueToLimit: 0 })!.rows[0]?.[1], "0");
  assert.equal(summary.rows.some(([label]) => label.includes("文章")), false);
});

test("video saving defaults off, roundtrips in execution config and never enters one-off preview", () => {
  const draft = { ...collectionDraft(douyin), name: "视频订阅", values: { keyword: "AI" } };
  assert.equal(draft.autoDownloadVideo, false);
  assert.equal(collectionDraft(weibo, current).autoDownloadVideo, false);
  const enabled = collectionConfig(douyin, { ...draft, autoDownloadVideo: true });
  const command = collectionSaveCommand(null, null, enabled);
  assert.equal("config" in command.body ? command.body.config.autoDownloadVideo : command.body.autoDownloadVideo, true);
  const saved: CollectionSubscription = { ...enabled, id: 91, platform: "douyin", editVersion: 2, executionVersion: 2, nextRunAt: null, activeRun: null };
  const readback = collectionDraft(douyin, saved);
  assert.equal(readback.autoDownloadVideo, true);
  assert.equal(subscriptionExecutionChanges(saved, collectionConfig(douyin, { ...readback, name: "改名" })), false);
  assert.equal(subscriptionExecutionChanges(saved, collectionConfig(douyin, { ...readback, autoDownloadVideo: false })), true);
  assert.equal(subscriptionExecutionChanges({ ...saved, autoDownloadVideo: undefined }, { ...enabled, autoDownloadVideo: false }), false);
  assert(!Object.hasOwn(collectionPreviewBody(douyin, readback.values), "autoDownloadVideo"));
});
