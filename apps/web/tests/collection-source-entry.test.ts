import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { act, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider, useLoaderData } from "react-router";
import { rolldown } from "rolldown";
import { collectionSeedNavigation } from "../app/features/admin/collection-subscription-data.ts";
import type { PlatformOperation } from "../app/features/admin/platform-types.ts";
import type { CollectionSubscription } from "../app/features/admin/collection-subscription-types.ts";

test("source collection entry, legacy redirect, query draft and task return use one editor location", async t => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-collection-entry-")), require = createRequire(import.meta.url), originalFetch = globalThis.fetch;
  // Unrelated creative forms have their own rendering tests; keep the routes and collection/query controls real.
  const unrelated: Record<string,string> = { "image-form": "ImageForm", "video-form": "VideoForm", "ai-search-form": "AiSearchForm", "asset-library": "AssetLibrary", "media-tool-form": "MediaToolForm", "transcription-form": "TranscriptionForm", "xhs-comment-form": "XhsCommentForm", "redfox-costs": "RedfoxCosts" };
  const bundle = await rolldown({ input: { ...Object.fromEntries(["sources", "source", "redfox", "operation", "operations"].map(name => [name, new URL(`../app/routes/admin/${name}.tsx`, import.meta.url).pathname])), collection: new URL("../app/features/admin/collection-subscriptions.tsx", import.meta.url).pathname }, plugins: [{
    name: "existing-runtime-and-unrelated-forms",
    resolveId(id) {
      if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true };
      const name = id.split("/").at(-1)!;
      if (unrelated[name]) return `\0unrelated:${name}`;
    },
    load(id) { if (id.startsWith("\0unrelated:")) return `export function ${unrelated[id.slice("\0unrelated:".length)]}(){return null}`; },
  }] });
  const operation: PlatformOperation = { id: "OWIBYU1V", platform: "douyin", label: "作品搜索", purpose: "query", schedulableType: "search", collectionCapabilities: { detailEnrichment: false }, fields: [{ name: "keyword", label: "关键词", type: "string", required: true }] };
  const subscription: CollectionSubscription = { id: 12, provider: "redfox", platform: "douyin", name: "已有订阅", operationId: operation.id, parameters: { keyword: "服务端条件" }, enabled: true, enrichDetails: false, intervalMinutes: 15, limits: { pages: 3, items: 100, details: 0 }, editVersion: 7, executionVersion: 3, nextRunAt: null, activeRun: null };
  const render = (element: ReactElement, entry: string | { pathname: string; search: string; state: unknown }) => {
    const router = createMemoryRouter([{ path: "*", element }], { initialEntries: [entry] });
    try { return renderToStaticMarkup(createElement(RouterProvider,{router})); } finally { router.dispose(); }
  };
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const sources = await import(pathToFileURL(join(directory,"sources.mjs")).href), redfox = await import(pathToFileURL(join(directory,"redfox.mjs")).href), task = await import(pathToFileURL(join(directory,"operation.mjs")).href);
    const operationList = await import(pathToFileURL(join(directory, "operations.mjs")).href), sourceDetail = await import(pathToFileURL(join(directory, "source.mjs")).href);
    await t.test("operation list forwards server filters, preserves subscription scope and renders status-aware links", async () => {
      const calls: string[] = [], statuses = ["active", "waiting", "needs_review", "stopped", "completed", "failed"];
      globalThis.fetch = async input => { calls.push(new URL(String(input)).pathname + new URL(String(input)).search); return Response.json({ rows: statuses.map((status, id) => ({ id: id + 1, status, operationKey: "synthetic.query", provider: "redfox", createdAt: "2026-10-21T00:00:00Z" })) }); };
      const data = await operationList.loader({ request: new Request("http://local.test/admin/operations?subscriptionId=12&status=waiting&unrelated=ignore") });
      assert.deepEqual(calls, ["/api/admin/operations/runs?subscriptionId=12&status=waiting"]);
      const html = render(createElement(operationList.default, { loaderData: data }), "/admin/operations?subscriptionId=12&status=waiting");
      assert(html.includes('name="subscriptionId" value="12"')); assert(html.includes('<option value="waiting" selected="">等待中</option>'));
      assert(html.includes("采集订阅 #12 的执行历史与结果")); assert(html.includes("清除筛选"));
      for (const id of [1,2,3,4]) assert(html.includes(`href="/admin/operations/${id}#progress"`));
      for (const id of [5,6]) assert(html.includes(`href="/admin/operations/${id}#results"`));
      assert(html.includes('href="/admin/operations/5"')); assert(html.includes("查看进度")); assert(html.includes("查看结果"));
      const empty = render(createElement(operationList.default, { loaderData: { ...data, rows: [] } }), "/admin/operations?subscriptionId=12&status=waiting");
      assert(empty.includes("当前筛选条件下没有执行记录"));
      await operationList.loader({ request: new Request("http://local.test/admin/operations?subscriptionId=12&status=") });
      assert.equal(calls.at(-1), "/api/admin/operations/runs?subscriptionId=12");
      globalThis.fetch = async input => { assert.equal(new URL(String(input)).search, "?subscriptionId=bad&status=made-up"); return Response.json({ detail: "invalid filters" }, { status: 400 }); };
      await assert.rejects(() => operationList.loader({ request: new Request("http://local.test/admin/operations?subscriptionId=bad&status=made-up") }), error => (error as { init: { status: number } }).init.status === 400);
    });
    await t.test("source primary history uses its subscription and legacy fetch history stays separate", () => {
      const source = { id: "native-x", name: "原生信源", kind: "x_search", config: { query: "from:synthetic" }, tags: [], participation_mode: "isolated", tier: "T2", enabled: false, health: "ok", interval_minutes: 30, created_at: "2026-10-21T00:00:00Z", updated_at: "2026-10-21T00:00:00Z", subscription_id: 77 };
      const data = { source, runs: [{ id: 101, history_key: "operation:101", kind: "operation", status: "completed", occurred_at: "2026-10-21T00:00:00Z", related_material_count: 0, provider: "redfox" }, { id: 102, history_key: "fetch:102", kind: "fetch", status: "ok", occurred_at: "2026-10-21T00:00:00Z", started_at: "2026-10-21T00:00:00Z", finished_at: null }], items: [], stats: { total: 0, last7d: 0, selected: 0 }, history: [], activeOperation: null };
      const html = render(createElement(sourceDetail.default, { loaderData: data }), "/admin/sources/native-x");
      assert(html.includes('href="/admin/operations?subscriptionId=77"')); assert(!html.includes('href="/admin/operations"')); assert(html.includes("执行历史与结果"));
      assert(html.includes('href="/admin/operations/101#results"')); assert(html.includes("查看结果")); assert(!html.includes('/admin/operations/102'));
      const rss = render(createElement(sourceDetail.default, { loaderData: { ...data, source: { ...source, kind: "rss", subscription_id: null }, runs: [data.runs[1]] } }), "/admin/sources/native-x");
      assert(rss.includes("历史采集记录")); assert(!rss.includes('/admin/operations?subscriptionId=')); assert(!rss.includes('/admin/operations/102'));
    });
    await t.test("source list keeps exact search/filter/page API query and detail links",async()=>{
      const calls: string[] = [], search = "?kind=rss&health=paused&mode=isolated&q=synthetic&page=2";
      const row = { id: "synthetic-source", name: "原信源", kind: "rss", tier: "T2", participation_mode: "isolated", enabled: false, health: "paused", fail_count: 0, interval_minutes: 30, first_party: false, items_7d: 0, selected_30d: 0 };
      globalThis.fetch = async input => { calls.push(new URL(String(input)).pathname+new URL(String(input)).search);return Response.json({ page:2, rows:Array.from({length:100},(_,index)=>({...row,id:`${row.id}-${index}`})),totals:{total:150,enabled:0,failing:0,degraded:0} }); };
      const data = await sources.loader({request:new Request(`http://local.test/admin/sources${search}`)});
      assert.deepEqual(calls,[`/api/admin/sources${search}`]);assert.equal(data.view,"sources");
      const html = render(createElement(sources.default,{loaderData:data}),`/admin/sources${search}`);
      assert(html.includes('href="/admin/sources/synthetic-source-0"'));assert(html.includes('name="kind" value="rss"'));assert(html.includes('name="mode" value="isolated"'));
      assert(html.includes("page=3"));assert(html.includes('href="/admin/sources?view=collections"'));assert(!html.includes('aria-label="采集订阅配置"'));
    });
    await t.test("direct collection URL loads shared APIs and selects one existing editor",async()=>{
      const calls: string[] = [];
      globalThis.fetch = async input => { const path=new URL(String(input)).pathname;calls.push(path);return Response.json(path.endsWith("/collections")?[subscription]:[operation]); };
      const data = await sources.loader({request:new Request("http://local.test/admin/sources?view=collections&subscription=12")});
      assert.deepEqual(calls.sort(),["/api/admin/redfox/collections","/api/admin/redfox/operations"]);assert.equal(data.requestedId,12);
      const html = render(createElement(sources.default,{loaderData:data}),"/admin/sources?view=collections&subscription=12");
      assert.equal((html.match(/aria-label="采集订阅配置"/g)??[]).length,1);assert(html.includes("编辑订阅 #12"));assert(html.includes('value="服务端条件"'));
      assert(html.includes('aria-label="启用定时采集"'));assert(html.includes('checked=""'));assert(html.includes("刷新状态（保留草稿）"));
      assert.equal((html.match(/href="\/admin\/operations\?subscriptionId=12"/g) ?? []).length, 2); assert(html.includes("执行历史与结果")); assert(html.includes("无在途执行"));
      const missing = render(createElement(sources.default,{loaderData:{...data,requestedId:999}}),"/admin/sources?view=collections&subscription=999");
      assert(missing.includes("当前列表中没有此订阅"));assert(!missing.includes('aria-label="采集订阅配置"'));
    });
    await t.test("source-context entry verifies source, inherits once, filters associated subscriptions and keeps global navigation", async () => {
      const calls: string[] = [], source = { id: "owner-rss", name: "已确认所属信源", kind: "rss", enabled: true, participation_mode: "editorial" };
      globalThis.fetch = async input => {
        const path = new URL(String(input)).pathname; calls.push(path);
        if (path === "/api/admin/redfox/collections") return Response.json([{ ...subscription, name: "该源关联订阅", sourceId: source.id }, { ...subscription, id: 13, name: "别的信源订阅", sourceId: "other" }, { ...subscription, id: 14, name: "旧无源订阅", sourceId: null }]);
        if (path === "/api/admin/redfox/operations") return Response.json([{ ...operation, collectionCapabilities: { detailEnrichment: false, sourceRequired: true } }]);
        if (path === `/api/admin/sources/${source.id}`) return Response.json({ source });
        throw new Error(`unexpected ${path}`);
      };
      const data = await sources.loader({ request: new Request("http://local.test/admin/sources?view=collections&sourceId=owner-rss") });
      assert.deepEqual(calls.sort(), ["/api/admin/redfox/collections", "/api/admin/redfox/operations", "/api/admin/sources/owner-rss"].sort());
      const html = render(createElement(sources.default, { loaderData: data }), "/admin/sources?view=collections&sourceId=owner-rss");
      assert(html.includes("该源关联订阅")); assert(!html.includes("别的信源订阅")); assert(!html.includes("旧无源订阅"));
      assert(html.includes("已确认所属信源")); assert(html.includes("订阅保存后不能换归属")); assert(!html.includes('aria-label="搜索所属信源"'));
      assert(html.includes('href="/admin/sources?view=collections"'));
      const mismatched = render(createElement(sources.default, { loaderData: { ...data, requestedId: 13 } }), "/admin/sources?view=collections&sourceId=owner-rss&subscription=13");
      assert(mismatched.includes("当前列表中没有此订阅")); assert(!mismatched.includes('value="别的信源订阅"'));
    });
    await t.test("direct subscription and seeded entry focus the editor once while state refresh retains focus", async () => {
      const { parseHTML } = await import("linkedom"), { createRoot } = await import("react-dom/client");
      const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
      const keys = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"] as const;
      const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
      Object.defineProperties(globalThis, { window: { configurable: true, value: window }, document: { configurable: true, value: window.document }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true } });
      let scrolls = 0, focuses = 0;
      window.HTMLElement.prototype.scrollIntoView = function () { assert(this.querySelector('input[aria-label="订阅名称"]')); scrolls++; };
      window.HTMLElement.prototype.focus = function () { assert.equal(this.getAttribute("aria-label"), "订阅名称"); focuses++; };
      try {
        for (const entry of ["selected", "seeded", "unscoped"]) {
          const element = window.document.getElementById("root")!, root = createRoot(element);
          let props = { subscriptions: [subscription], operations: [operation], requestedId: entry === "selected" ? 12 : null, seed: entry === "seeded" ? { operationId: operation.id, values: { keyword: "query seed" }, sequence: 0 } : null };
          // Render the real collection component under a data router; update its props without remounting it.
          const { CollectionSubscriptions } = await import(pathToFileURL(join(directory, "collection.mjs")).href);
          const router = createMemoryRouter([{ path: "*", loader: () => props, HydrateFallback: () => null, Component: () => createElement(CollectionSubscriptions, useLoaderData()) }]);
          const before = focuses;
          await act(async () => { root.render(createElement(RouterProvider, { router })); });
          assert.equal(focuses - before, entry === "unscoped" ? 0 : 1); assert.equal(scrolls, focuses);
          props = { ...props, subscriptions: [{ ...subscription, name: "刷新后的订阅", nextRunAt: "2026-10-23T00:00:00Z" }] };
          await act(async () => { await router.revalidate(); });
          assert(element.textContent.includes("刷新后的订阅"));
          assert.equal(focuses - before, entry === "unscoped" ? 0 : 1);
          await act(async () => { root.unmount(); }); router.dispose();
        }
      } finally {
        for (const key of keys) { const descriptor = descriptors.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
      }
    });
    await t.test("query navigation state fills an unsaved disabled draft without API writes or JSON in URL",async()=>{
      const calls: string[] = [], target = collectionSeedNavigation(operation.id,{keyword:" 原词 & ? "});
      globalThis.fetch = async input => { const path=new URL(String(input)).pathname;calls.push(path);return Response.json(path.endsWith("/collections")?[subscription]:[operation]); };
      const data = await sources.loader({request:new Request(`http://local.test${target.to}`)});
      const html = render(createElement(sources.default,{loaderData:data}),{pathname:"/admin/sources",search:"?view=collections",state:target.state});
      assert.equal(target.to,"/admin/sources?view=collections");assert.equal(calls.length,2);
      assert.equal((html.match(/aria-label="采集订阅配置"/g)??[]).length,1);assert(html.includes("新建采集订阅"));assert(html.includes('value=" 原词 &amp; ? "'));
      assert(!/aria-label="启用定时采集"[^>]*checked/.test(html));assert(!html.includes("编辑订阅 #12"));
      const query = render(createElement((await import(pathToFileURL(join(directory,"redfox.mjs")).href)).default,{loaderData:{operations:[operation],initialView:"platforms"}}),"/admin/data-tools?view=platforms");
      assert(query.includes("带入新采集订阅"));assert(query.includes("带入信源页的采集订阅草稿"));assert(!query.includes('aria-label="采集订阅配置"'));assert(query.includes('href="/admin/sources?view=collections"'));
    });
    await t.test("data tools workspace follows URL while all eight workspaces remain mounted", () => {
      const html = render(createElement(redfox.default, { loaderData: { operations: [operation], initialView: "x" } }), "/admin/data-tools?view=platforms");
      assert(html.includes("进度与结果")); assert(html.includes("辅助工具"));
      assert.match(html, /aria-pressed="true"[^>]*>平台查询<\/button>/);
      assert.equal((html.match(/aria-pressed=/g) ?? []).length, 8);
      assert(html.includes("X 账号查询")); assert(html.includes("X 推文详情查询")); assert(html.includes("带入新采集订阅"));
      assert(html.includes("本地素材上传后在私有素材库查看"));
      const nav = html.slice(0, html.indexOf('aria-label="数据工具工作区"'));
      assert(nav.includes('href="/admin/operations"')); assert(!nav.includes('href="/admin/settings"')); assert(!nav.includes('href="/admin/runs"'));
      assert(html.includes('href="/admin/settings"')); assert(html.includes('href="/admin/runs"'));
    });
    await t.test("legacy Redfox URL redirects to data tools without reading APIs",async()=>{
      globalThis.fetch = async()=>{throw new Error("redirect must not read APIs");};
      const result = await redfox.loader({request:new Request("http://local.test/admin/redfox?view=platforms&reference=synthetic")});
      assert.equal(result.status,308);assert.equal(result.headers.get("location"),"/admin/data-tools?view=platforms&reference=synthetic");
    });
    await t.test("legacy subscription view redirects before reading options or subscriptions",async()=>{
      globalThis.fetch = async()=>{throw new Error("redirect must not read APIs");};
      for (const [query,location] of [["?view=subscriptions&subscription=12","/admin/sources?view=collections&subscription=12"],["?view=subscriptions","/admin/sources?view=collections"]]) {
        const result = await redfox.loader({request:new Request(`http://local.test/admin/data-tools${query}`)});
        assert.equal(result.status,302);assert.equal(result.headers.get("location"),location);
      }
    });
    await t.test("Redfox workspace loader no longer fetches subscription state",async()=>{
      const calls: string[] = [];
      globalThis.fetch = async input=>{const path=new URL(String(input)).pathname;calls.push(path);return Response.json(path.endsWith("/operations")?[operation]:{});};
      const data = await redfox.loader({request:new Request("http://local.test/admin/data-tools?view=platforms")});
      assert(!calls.includes("/api/admin/redfox/collections"));assert(!("subscriptions" in data));
    });
    await t.test("collection task returns to selected subscription in source collection view",()=>{
      const data={id:9,provider:"redfox",operationKey:"redfox.platform.collection",subscriptionId:12,status:"completed",step:"query",inputs:{},progress:{},attempts:[],results:[],nextResultCursor:null,resultCursor:"0",nextAction:"view-results",createdAt:"2026-10-21T00:00:00Z"};
      const html=render(createElement(task.default,{loaderData:data}),"/admin/operations/9");
      assert(html.includes('href="/admin/sources?view=collections&amp;subscription=12"'));assert(html.includes("返回采集订阅")); assert(html.includes('href="/admin/operations?subscriptionId=12"'));
      assert(html.includes('id="progress"')); assert(html.includes('id="results"')); assert(html.includes('href="#results"')); assert(html.includes("本轮已完成，本页没有已保存的内容结果"));
      for (const [status, copy] of [["stopped", "本轮已停止"], ["needs_review", "本轮需要核对"], ["failed", "本轮已结束"]]) {
        const stopped = render(createElement(task.default, { loaderData: { ...data, status } }), "/admin/operations/9");
        assert(stopped.includes(copy)); assert(stopped.includes("诊断：参数、执行版本与回执尝试"));
        if (status !== "failed") { assert(stopped.includes("恢复本轮执行")); assert(stopped.includes("放弃本轮")); }
      }
      for (const operationKey of ["x.search", "mp.history", "redfox.wechat.collection", "redfox.x.timeline"]) {
        const native = render(createElement(task.default, { loaderData: { ...data, operationKey, inputs: { sources: [{ id: "native-source", name: "原信源" }] } } }), "/admin/operations/9");
        assert(native.includes('href="/admin/sources/native-source"')); assert(native.includes('href="/admin/operations?subscriptionId=12"')); assert(!native.includes('view=collections'));
      }
      const frozenSources = [{ id: "batch-first", name: "第一条信源" }, { id: "batch-second", name: "第二条信源" }];
      const batch = render(createElement(task.default, { loaderData: { ...data, operationKey: "x.search", inputs: { sources: frozenSources } } }), "/admin/operations/9");
      assert(batch.includes("选择相关信源：")); assert(!batch.includes("返回信源："));
      for (const source of frozenSources) assert.equal((batch.match(new RegExp(`href="/admin/sources/${source.id}"`, "g")) ?? []).length, 1);
      const draft = render(createElement(task.default, { loaderData: { ...data, operationKey: "x.search", inputs: { sources: frozenSources, draft: true } } }), "/admin/operations/9");
      assert(draft.includes("草稿 batch-first（未保存）")); assert(draft.includes("草稿 batch-second（未保存）")); assert(!draft.includes('href="/admin/sources/batch-'));
      for (const [operationKey, view] of [["redfox.x.account", "x"], ["redfox.sync.query", "platforms"], ["redfox.image.generate", "images"], ["redfox.video.generate", "videos"], ["redfox.transcript.submit", "tools"], ["redfox.ai_search.submit", "ai-search"], ["redfox.media.upload", "assets"]]) {
        const returned = render(createElement(task.default, { loaderData: { ...data, operationKey, inputs: {}, subscriptionId: null } }), "/admin/operations/9");
        assert(returned.includes(`href="/admin/data-tools?view=${view}"`), operationKey);
      }
    });
  } finally { globalThis.fetch=originalFetch;await bundle.close();await rm(directory,{recursive:true,force:true}); }
});
