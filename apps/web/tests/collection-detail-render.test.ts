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
    const render = (operation: PlatformOperation, patch: Partial<CollectionSubscription> = {}) => {
      const row: CollectionSubscription = { id: 1, provider: "redfox", platform: operation.platform, name: "订阅", operationId: operation.id, parameters: {}, enabled: false, enrichDetails: true, intervalMinutes: 15, limits: { pages: 3, items: 100, details: 20 }, editVersion: 1, executionVersion: 1, nextRunAt: null, activeRun: null, ...patch };
      const router = createMemoryRouter([{ path: "/admin/sources", element: createElement(CollectionSubscriptions, { subscriptions: [row], operations: [operation], requestedId: 1 }) }], { initialEntries: ["/admin/sources?view=collections&subscription=1"] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const target = (operationId: string) => ({ operationId, label: `${operationId}已证库`, fields: [], price: { amount: 0, currency: "CNY", basis: "estimated" as const } });
    const operation: PlatformOperation = { id: "PW97QFBS", platform: "wechat", label: "搜索", purpose: "query", schedulableType: "search", fields: [], collectionProviders: [{ id: "redfox", label: "Redfox" }, { id: "agentkey", label: "AgentKey" }], collectionCapabilities: { detailEnrichment: true, detailOperations: [target("XEO0QQNF"), target("I3CIBRI2")] } };
    const blank = render(operation);
    assert.match(blank, /<th[^>]*>供应商<\/th>/); assert.match(blank, /aria-label="供应商"[^>]*disabled=""/); assert(blank.includes('<option value="redfox" selected="">Redfox</option>')); assert(blank.includes("AgentKey")); assert(blank.includes("Redfox"));
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
