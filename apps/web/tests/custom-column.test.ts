import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { rolldown } from "rolldown";
import type { PoolResponse } from "@aihot/contracts/site";
import { DEFAULT_SITE_PRESENTATION } from "../app/lib/presentation.ts";
import { poolHref } from "../app/features/feed/pool-navigation.ts";
import { newCustomColumn, insertCustomColumn, restorePresentationDefaults } from "../app/features/admin/presentation-draft.ts";

const uuid = "12345678-1234-4234-8234-123456789abc";
const id = `custom-${uuid}` as const, base = `/columns/${id}` as const;
const result: PoolResponse = { column: { id, label: "产品 Agent", scope: "all", category: "ai-products", tag: "Agent" }, filters: { channel: "all", category: "ai-products", tag: "Agent", q: "工具", tab: "relevance", videosOnly: false }, items: [], page: 2, pageSize: 7, pageCount: 3, total: 15, todayCount: 0, freshness: "2026-10-24T02:00:00Z", generatedAt: "2026-10-24T02:00:00Z" };

test("restoring defaults preserves saved custom identities and definitions at content end", () => {
  const defaults = structuredClone(DEFAULT_SITE_PRESENTATION);
  const row = { ...newCustomColumn(defaults, uuid), label: "产品 Agent", visible: true, category: "ai-products", tag: "Agent", pageSize: 7 };
  const presentation = insertCustomColumn(defaults, row);
  const restored = restorePresentationDefaults({ defaults, presentation });
  assert.deepEqual(restored.navigation.find((entry) => entry.id === id), { ...row, visible: false });
  assert.equal(presentation.navigation.find((entry) => entry.id === id)?.visible, true);
  const customIndex = restored.navigation.findIndex((entry) => entry.id === id);
  assert(customIndex > restored.navigation.findIndex((entry) => entry.id === "starred"));
  assert.equal(newCustomColumn(defaults, uuid).visible, false);
});

test("custom route uses saved scope through its actual loader, SSR, meta and busy recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-custom-column-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: { column: new URL("../app/routes/column.tsx", import.meta.url).pathname, busy: new URL("../app/features/feed/SearchBusy.tsx", import.meta.url).pathname, all: new URL("../app/routes/all.tsx", import.meta.url).pathname }, plugins: [{ name: "existing-react-runtime", resolveId(name) { if (["react", "react-dom", "react/jsx-runtime", "react-router", "motion/react"].includes(name)) return { id: require.resolve(name), external: true }; } }] });
  const originalFetch = globalThis.fetch;
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const column = await import(pathToFileURL(join(directory, "column.mjs")).href);
    const all = await import(pathToFileURL(join(directory, "all.mjs")).href);
    const { SearchBusy } = await import(pathToFileURL(join(directory, "busy.mjs")).href);
    const queries: URL[] = [];
    globalThis.fetch = async (input) => { queries.push(new URL(String(input))); return Response.json(result); };
    const loaded = await column.loader({ params: { id }, request: new Request(`http://example.test${base}?q=工具&tab=relevance&page=2&pageSize=7`) });
    assert.deepEqual(loaded.data, result);
    assert.deepEqual([...queries[0]!.searchParams.keys()].sort(), ["columnId", "page", "pageSize", "q", "tab"]);
    assert.equal(queries[0]!.searchParams.get("columnId"), id);
    for (const key of ["category", "tag", "channel", "topic", "videosOnly"]) await assert.rejects(column.loader({ params: { id }, request: new Request(`http://example.test${base}?${key}=product`) }), (error: any) => error.init.status === 400);
    assert.equal(queries.length, 1);
    const render = (element: ReturnType<typeof createElement>, path: string) => {
      const router = createMemoryRouter([{ id: "root", element: createElement(Outlet), children: [{ id: "view", path: "*", element, loader: () => loaded }] }], { initialEntries: [path], hydrationData: { loaderData: { root: { presentation: DEFAULT_SITE_PRESENTATION }, view: loaded } } });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const html = render(createElement(column.default), `${base}?q=工具&tab=relevance&page=2&pageSize=7`);
    assert(html.includes("栏目范围：产品 · #Agent · 全部公开内容"));
    assert(html.includes(`action="${base}"`));
    assert(!html.includes('name="category"')); assert(!html.includes('name="tag"'));
    assert(html.includes(`href="${base}?pageSize=7"`));
    assert(html.includes("没有找到相关内容"));
    const canonical = column.meta({ loaderData: loaded, params: { id } }).find((entry: any) => entry.rel === "canonical").href;
    const url = new URL(canonical);
    assert.equal(url.pathname, base); assert(!url.searchParams.has("category")); assert(!url.searchParams.has("tag"));
    assert.equal(url.searchParams.get("pageSize"), "7");
    const presentation = structuredClone(DEFAULT_SITE_PRESENTATION);
    presentation.navigation = presentation.navigation.map((entry) => entry.id === "all" ? { ...entry, label: "动态汇总" } : entry);
    assert(all.meta({ loaderData: { data: { ...result, column: undefined, filters: { ...result.filters, q: null } } }, matches: [undefined, { id: "root", loaderData: { presentation } }] }).some((entry: any) => entry.title?.includes("动态汇总")));
    const params = new URLSearchParams("q=工具&tab=relevance&page=2&category=paper&tag=wrong&videosOnly=true");
    const clear = new URL(poolHref(base, params, 7, { q: null, tab: null, page: null }), "http://example.test");
    assert.equal(clear.search, "?pageSize=7");
    const busy = render(createElement(SearchBusy, { base, search: "?q=工具&tab=relevance&page=2&pageSize=7&tag=wrong" }), base);
    assert(busy.includes(`href="${base}?q=%E5%B7%A5%E5%85%B7&amp;tab=relevance&amp;page=2&amp;pageSize=7"`));
    assert(busy.includes(`href="${base}?pageSize=7"`)); assert(!busy.includes("tag=wrong"));
    for (const [code, status] of [["search_busy", 503], ["temporarily_unavailable", 503], ["not_found", 404]] as const) {
      globalThis.fetch = async () => Response.json({ code }, { status });
      await assert.rejects(column.loader({ params: { id }, request: new Request(`http://example.test${base}?q=工具&pageSize=7`) }), (error: any) => {
        if (code === "search_busy") { assert.equal(error.status, 302); assert.equal(error.headers.get("Location"), `${base}/search-busy?q=%E5%B7%A5%E5%85%B7&pageSize=7`); }
        else assert.equal(error.init.status, status);
        return true;
      });
    }
  } finally { globalThis.fetch = originalFetch; await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});
