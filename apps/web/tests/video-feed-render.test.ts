import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { rolldown } from "rolldown";
import type { FeedItemSummary, PoolResponse, SiteItemDetail } from "@aihot/contracts/site";

const news: FeedItemSummary = { id: "news-video", title: "模型演示视频", summary: "公开视频摘要", reason: null, publishedAt: "2026-10-24T02:00:00Z", timelineAt: "2026-10-24T02:00:00Z", category: "paper", tags: ["演示"], score: null, selected: false, channel: "news", source: { name: "示例来源" }, x: null, video: { poster: "/licensed-poster.jpg" } };
const result: PoolResponse = { filters: { channel: "all", category: "paper", tag: null, q: "演示", tab: "relevance", videosOnly: true }, items: [news], page: 667, pageSize: 3, pageCount: 667, total: 2000, todayCount: 1, freshness: "2026-10-24T02:00:00Z", generatedAt: "2026-10-24T02:00:00Z" };

test("shared video list preserves scoped search/pagination and renders stills without duplicate X media", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-video-feed-")), require = createRequire(import.meta.url);
  const input = Object.fromEntries(Object.entries({ pool: "features/feed/PoolPage.tsx", card: "features/feed/FeedItem.tsx", item: "routes/item.tsx", loader: "features/feed/pool.server.ts" }).map(([key, path]) => [key, new URL(`../app/${path}`, import.meta.url).pathname]));
  const bundle = await rolldown({ input, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react-dom", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const { PoolPage } = await import(pathToFileURL(join(directory, "pool.mjs")).href);
    const { FeedItem } = await import(pathToFileURL(join(directory, "card.mjs")).href);
    const { default: ItemPage } = await import(pathToFileURL(join(directory, "item.mjs")).href);
    const { loadPool } = await import(pathToFileURL(join(directory, "loader.mjs")).href);
    const render = (element: ReactElement, path = "/videos", data: unknown = {}) => {
      const router = createMemoryRouter([{ id: "root", element: createElement(Outlet), children: [{ id: "view", path: "*", element, loader: () => data }] }], { initialEntries: [path], hydrationData: { loaderData: { root: {}, view: data } } });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const card = render(createElement(FeedItem, { item: news, showTags: true, linkBase: "/videos" }));
    const sizedCard = render(createElement(FeedItem, { item: news, showTags: true, linkBase: "/videos", listPageSize: 3 }));
    assert(sizedCard.includes('href="/videos?category=paper&amp;pageSize=3"'));
    assert(sizedCard.includes('href="/videos?tag=%E6%BC%94%E7%A4%BA&amp;pageSize=3"'));
    assert(!card.includes("pageSize="));
    assert(card.includes('src="/licensed-poster.jpg"')); assert(card.includes('href="/items/news-video"')); assert(card.includes('href="/videos?category=paper"')); assert(!/<video\b/.test(card));
    const noPoster = render(createElement(FeedItem, { item: { ...news, video: { poster: null } } }));
    assert(noPoster.includes("视频 · 原站观看")); assert(!noPoster.includes("视频封面"));
    const x: FeedItemSummary = { ...news, id: "x-video", channel: "x", x: { authorName: "示例作者", handle: "author", avatarUrl: null, media: [{ kind: "video", url: "/legacy-x-poster.jpg", poster: "/legacy-x-poster.jpg", width: 200, height: 100, alt: null }], quoted: null } };
    const xCard = render(createElement(FeedItem, { item: x }));
    assert.equal((xCard.match(/src="\/legacy-x-poster.jpg"/g) ?? []).length, 1); assert(!xCard.includes("licensed-poster"));
    const oldGif = render(createElement(FeedItem, { item: { ...x, video: null } }));
    assert(oldGif.includes('src="/legacy-x-poster.jpg"')); assert(!oldGif.includes("视频封面"));
    const html = render(createElement(PoolPage, { data: result, base: "/videos" }), "/videos?q=演示&category=paper&tab=relevance&page=667&pageSize=40");
    assert(html.includes('href="/videos?category=paper&amp;pageSize=3"'));
    assert(html.includes('href="/videos?tag=%E6%BC%94%E7%A4%BA&amp;pageSize=3"'));
    assert(html.includes('action="/videos"')); assert.equal((html.match(/name="pageSize" value="3"/g) ?? []).length, 2);
    assert(html.includes("最近 2,000 条内容（每页 3 条）")); assert(!html.includes("最多提供 50 页"));
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!.replaceAll("&amp;", "&"));
    const paged = links.filter((href) => href.startsWith("/videos?") && new URL(href, "http://example.test").searchParams.has("page"));
    assert(paged.length > 0); for (const href of paged) assert.equal(new URL(href, "http://example.test").searchParams.get("pageSize"), "3");
    const empty = render(createElement(PoolPage, { data: { ...result, filters: { ...result.filters, q: null }, items: [], page: 1, pageCount: 1, total: 0 }, base: "/videos" }));
    assert(empty.includes("暂时没有视频内容")); assert(empty.includes("已确认含视频的公开内容"));
    const detail: SiteItemDetail = { ...news, x: null, revision: 1, originalTitle: null, source: { id: "source", name: "示例来源", kind: "rss", iconUrl: null, firstParty: true }, links: { aihot: "/items/news-video", original: "https://example.test/watch" }, discoveredAt: news.timelineAt, story: null, readingMode: "full", author: null, language: "zh", body: null, outline: [], relatedStories: [], indexable: true, markdownAvailable: false, group: null, hasTranslation: false, bodyLanguage: "zh" };
    const detailHtml = render(createElement(ItemPage), "/items/news-video", { item: detail });
    assert(detailHtml.includes("去原站观看")); assert(detailHtml.includes('href="https://example.test/watch"')); assert(!/<video\b/.test(detailHtml));
    const xDetail = render(createElement(ItemPage), "/items/x-video", { item: { ...detail, ...x } });
    assert(!xDetail.includes("licensed-poster")); assert.equal((xDetail.match(/src="\/legacy-x-poster.jpg"/g) ?? []).length, 1);
    const actualFetch = globalThis.fetch;
    const queries: URL[] = [];
    globalThis.fetch = async (input) => { queries.push(new URL(String(input))); return Response.json(result); };
    try {
      await loadPool(new Request("http://example.test/videos?q=演示&tab=relevance&page=667&pageSize=3"), true);
      await loadPool(new Request("http://example.test/all?videosOnly=true"));
      assert.equal(queries[0]?.pathname, "/api/site/pool"); assert.equal(queries[0]?.searchParams.get("videosOnly"), "true"); assert.equal(queries[0]?.searchParams.get("pageSize"), "3"); assert.equal(queries[0]?.searchParams.get("page"), "667"); assert.equal(queries[0]?.searchParams.get("tab"), "relevance");
      assert(!queries[1]?.searchParams.has("videosOnly")); assert(!queries[1]?.searchParams.has("pageSize"));
    } finally { globalThis.fetch = actualFetch; }
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});
