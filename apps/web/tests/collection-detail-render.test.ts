import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { rolldown } from "rolldown";
import type { PlatformOperation } from "../app/features/admin/platform-types.ts";
import type { CollectionSubscription } from "../app/features/admin/collection-subscription-types.ts";
test("actual subscription editor requires explicit target and blank LL page, displays legacy fact and preview scope without fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-collection-detail-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: new URL("../app/features/admin/collection-subscriptions.tsx", import.meta.url).pathname, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ file: join(directory, "view.mjs"), format: "esm" });
    const { CollectionSubscriptions } = await import(pathToFileURL(join(directory, "view.mjs")).href);
    const render = (operation: PlatformOperation, patch: Partial<CollectionSubscription> = {}, extra: PlatformOperation[] = []) => {
      const row: CollectionSubscription = { id: 1, provider: "redfox", platform: operation.platform, name: "订阅", operationId: operation.id, parameters: {}, enabled: false, enrichDetails: true, intervalMinutes: 15, limits: { pages: 3, items: 100, details: 20 }, editVersion: 1, executionVersion: 1, nextRunAt: null, activeRun: null, ...patch };
      const router = createMemoryRouter([{ path: "/admin/sources", element: createElement(CollectionSubscriptions, { subscriptions: [row], operations: [operation, ...extra], requestedId: 1 }) }], { initialEntries: ["/admin/sources?view=collections&subscription=1"] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const target = (operationId: string) => ({ operationId, label: `${operationId}已证库`, fields: [], price: { amount: 0, currency: "CNY", basis: "estimated" as const } });
    const operation: PlatformOperation = { id: "PW97QFBS", platform: "wechat", label: "搜索", purpose: "query", schedulableType: "search", fields: [], collectionProviders: [{ id: "redfox", label: "Redfox" }, { id: "agentkey", label: "AgentKey" }], collectionCapabilities: { detailEnrichment: true, detailOperations: [target("XEO0QQNF"), target("I3CIBRI2")] } };
    const blank = render(operation);
    assert.match(blank, /<th[^>]*>订阅 \/ 平台与供应商<\/th>/); assert.match(blank, /aria-label="供应商"[^>]*disabled=""/); assert(blank.includes('<option value="redfox" selected="">Redfox</option>')); assert(blank.includes("AgentKey")); assert(blank.includes("Redfox"));
    assert.match(blank, /aria-label="详情目标 \/ 库"[^>]*required=""/); assert.match(blank, /<option value="" selected="">请选择详情目标/);
    const switchable = render({...operation, id: "OWIBYU1V", platform: "douyin"}, {parameters: {keyword: "AI"}, enrichDetails: false});
    assert.match(switchable, /aria-label="目标供应商"/);
    assert(switchable.includes("预检切换"));
    assert(switchable.includes("未保存草稿不参与预检"));
    assert.match(switchable, /aria-label="供应商"[^>]*disabled=""/);
    assert(!switchable.includes(">查看影响并切换</button>"));
    assert(!/<option value="XEO0QQNF" selected/.test(blank)); assert(blank.includes("不调用已配置的详情补全"));
    const selected = render(operation, { detailOperationId: "XEO0QQNF" });
    assert(selected.includes("详情文档估算 0 CNY/请求")); assert(selected.includes("XEO0QQNF已证库")); assert(selected.includes("每轮最多 20 个详情步骤"));
    const variant = (operationLabel: string) => ({id:"agentkey",label:"AgentKey · TikHub",operationLabel,fields:[],purpose:"TikHub"});
    const account: PlatformOperation = {...operation,id:"QEQLCKD6",platform:"douyin",label:"Redfox 账号作品",collectionProviders:[{id:"redfox",label:"Redfox"},variant("TikHub 账号作品")]};
    const search: PlatformOperation = {...account,id:"OWIBYU1V",label:"Redfox 搜索",collectionProviders:[{id:"redfox",label:"Redfox"},variant("TikHub 搜索")]};
    const mixed = render(account,{provider:"agentkey",enrichDetails:false},[search]);
    assert.match(mixed, /<option value="QEQLCKD6" selected="">TikHub 账号作品<\/option>/);
    assert.match(mixed, /<option value="OWIBYU1V">Redfox 搜索<\/option>/);
    assert(!mixed.includes('>TikHub 搜索</option>'),"unvisited operation keeps its own default provider label");
    const xhs:PlatformOperation={...operation,id:"384C6W6B",platform:"xiaohongshu",label:"笔记首页",collectionProviders:[{id:"agentkey",label:"AgentKey · TikHub"}],collectionCapabilities:{detailEnrichment:true,detailOperations:[target("KR1LPTBF")]}};
    const xhsSelected=render(xhs,{provider:"agentkey",enrichDetails:true,detailOperationId:"KR1LPTBF",limits:{pages:1,items:2,details:1}});
    assert(xhsSelected.includes("每轮仅查询一次首页，不连续翻页")); assert(!xhsSelected.includes('aria-label="每轮最多页数"')); assert.match(xhsSelected,/aria-label="每轮最多详情调用"[^>]*value="1"/); assert(xhsSelected.includes("KR1LPTBF已证库"));
    for (const id of ["LEN9QXR3", "VPA67I98", "bilibili.typed_search"]) {
      const bili: PlatformOperation = {...xhs,id,platform:"bilibili",collectionCapabilities:{detailEnrichment:true,detailOperations:[target("TIN1NMTZ")]}};
      const html=render(bili,{provider:"agentkey",enrichDetails:true,detailOperationId:"TIN1NMTZ",limits:{pages:1,items:2,details:1}});
      assert(html.includes("每轮仅查询一次首页，不连续翻页")); assert(!html.includes('aria-label="每轮最多页数"')); assert.match(html,/aria-label="每轮最多详情调用"[^>]*value="1"/); assert(html.includes("TIN1NMTZ已证库"));
    }
    for (const id of ["TXQPVGJG", "weibo.account_posts", "weibo.comments", "weibo.following", "UAQ90A1F", "weibo.related_search"]) {
      const details = ["TXQPVGJG", "weibo.account_posts"].includes(id), caps = { detailEnrichment: details, detailOperations: details ? [target("API_1789098514899")] : [] };
      const wb: PlatformOperation = { ...xhs, id, platform: "weibo", collectionCapabilities: caps };
      const home = render(wb, { provider: "agentkey", enrichDetails: false, limits: { pages: 1, items: 2, details: 0 } });
      assert(home.includes("每轮仅查询一次首页，不连续翻页")); assert(!home.includes('aria-label="每轮最多页数"')); assert(!home.includes('aria-label="每轮最多详情调用"')); assert(home.includes('aria-label="每轮最多条目"'));
      if (details) {
        const selected = render(wb, { provider: "agentkey", enrichDetails: true, detailOperationId: "API_1789098514899", limits: { pages: 1, items: 2, details: 1 } });
        assert.match(selected, /aria-label="每轮最多详情调用"[^>]*value="1"/); assert(selected.includes('<option value="API_1789098514899" selected="">'));
      } else assert(!home.includes('aria-label="开启必要详情补全"'));
    }
    for (const id of ["5K5EG87P", "x.account_posts", "ABJQXHUE", "x.followers", "5QY3G5TY", "x.list_posts", "x.community_posts", "x.trending", "x.list_members", "x.community_members"]) {
      const x: PlatformOperation = { id, platform: "x-research", label: id, purpose: "首页研究", fields: [], schedulableType: "list", collectionProviders: [{ id: "agentkey", label: "AgentKey · TikHub", fields: [], collectionPrice: { amount: .2, currency: "credits", basis: "estimated" }, collectionCapabilities: { detailEnrichment: false } }] };
      const home = render(x, { provider: "agentkey", enrichDetails: false, limits: { pages: 1, items: 2, details: 0 } });
      assert(home.includes("每轮仅查询一次首页，不连续翻页"), id);
      assert(home.includes('aria-label="每轮最多条目"'), id);
      assert(!home.includes('aria-label="每轮最多页数"'), id);
      assert(!home.includes('aria-label="每轮最多详情调用"'), id);
      assert(!home.includes('aria-label="开启必要详情补全"'), id);
      assert(!home.includes('aria-label="目标供应商"'), id);
      assert(home.includes("没有已确认等价的其他采集供应商"), id);
      assert(home.includes("不代表原生 X 连续主采集"), id);
      assert(home.includes("置顶、转发与研究记录"), id);
      assert(home.includes("0.2 credits/请求（估算，非实扣），不是整轮总价"), id);
    }
    const xSwitch: PlatformOperation = { id: "5K5EG87P", platform: "x-research", label: "X搜索", purpose: "搜索", fields: [], schedulableType: "search", collectionProviders: [{ id: "redfox", label: "Redfox" }, { id: "agentkey", label: "AgentKey", fields: [], collectionCapabilities: { detailEnrichment: false } }] };
    const xRf = render(xSwitch, { parameters: { keyword: "AI", searchType: "Top" }, enrichDetails: false });
    assert(xRf.includes('aria-label="每轮最多页数"')); assert(xRf.includes('aria-label="目标供应商"')); assert(xRf.includes("预检切换"));
    const xAk = render(xSwitch, { provider: "agentkey", parameters: { keyword: "AI", search_type: "Top" }, enrichDetails: false, limits: { pages: 1, items: 2, details: 0 } });
    assert(!xAk.includes('aria-label="每轮最多页数"')); assert(xAk.includes('aria-label="目标供应商"')); assert(xAk.includes("未保存草稿不参与预检"));
    const car: PlatformOperation = { ...operation, id: "CI7VW144", platform: "qichezhijia", collectionCapabilities: { detailEnrichment: true, detailOperations: [target("TE6AGWAF"), { ...target("LLCI8QTE"), fields: [{ name: "page", label: "页码", type: "integer", required: true }] }] } };
    const html = render(car, { parameters: { sourceType: "article" }, detailOperationId: "LLCI8QTE" });
    assert.match(html, /aria-label="车家号详情页码"[^>]*value=""/); assert(html.includes("没有默认页码")); assert(!html.includes('<option value="TE6AGWAF"'));
    const unavailable = render(car, { parameters: { sourceType: "video" }, detailOperationId: "LLCI8QTE" });
    assert(unavailable.includes("原目标不适用当前条件，请重新选择")); assert(!unavailable.includes('aria-label="车家号详情页码"'));
    const weibo: PlatformOperation = { ...operation, id: "TXQPVGJG", platform: "weibo", collectionCapabilities: { detailEnrichment: true, detailOperations: [target("API_1789098514899")] } };
    const legacy = render(weibo, { detailOperationId: null });
    assert(legacy.includes("旧配置兼容")); assert(legacy.includes("旧微博订阅未存目标")); assert(!legacy.includes("首次保存显式目标将登记"));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});
