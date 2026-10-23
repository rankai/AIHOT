import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { rolldown } from "rolldown";
import { collectionSeedNavigation } from "../app/features/admin/collection-subscription-data.ts";
import type { PlatformOperation } from "../app/features/admin/platform-types.ts";
import type { CollectionSubscription } from "../app/features/admin/collection-subscription-types.ts";

test("source collection entry, legacy redirect, query draft and task return use one editor location", async t => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-collection-entry-")), require = createRequire(import.meta.url), originalFetch = globalThis.fetch;
  // Unrelated creative forms have their own rendering tests; keep the routes and collection/query controls real.
  const unrelated: Record<string,string> = { "image-form": "ImageForm", "video-form": "VideoForm", "ai-search-form": "AiSearchForm", "asset-library": "AssetLibrary", "media-tool-form": "MediaToolForm", "transcription-form": "TranscriptionForm", "xhs-comment-form": "XhsCommentForm", "redfox-costs": "RedfoxCosts" };
  const bundle = await rolldown({ input: Object.fromEntries(["sources", "redfox", "operation"].map(name => [name, new URL(`../app/routes/admin/${name}.tsx`, import.meta.url).pathname])), plugins: [{
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
      const missing = render(createElement(sources.default,{loaderData:{...data,requestedId:999}}),"/admin/sources?view=collections&subscription=999");
      assert(missing.includes("当前列表中没有此订阅"));assert(!missing.includes('aria-label="采集订阅配置"'));
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
      assert(html.includes('href="/admin/sources?view=collections&amp;subscription=12"'));assert(html.includes("返回采集订阅"));
    });
  } finally { globalThis.fetch=originalFetch;await bundle.close();await rm(directory,{recursive:true,force:true}); }
});
