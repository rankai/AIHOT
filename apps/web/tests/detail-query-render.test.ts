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
import type { OperationResult } from "../app/features/admin/operation-types.ts";
import { detailQueryOperation } from "../app/features/admin/detail-query-data.ts";

test("real work and six account result cards show local options lookup without paid controls; research and old details remain separate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-detail-query-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: { result: new URL("../app/features/admin/operation-result.tsx", import.meta.url).pathname, fields: new URL("../app/features/admin/platform-fields.tsx", import.meta.url).pathname }, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const { OperationResultView } = await import(pathToFileURL(join(directory, "result.mjs")).href), { PlatformFields } = await import(pathToFileURL(join(directory, "fields.mjs")).href);
    const renderElement = (element: ReactElement) => { const router = createMemoryRouter([{ path: "/admin/operations/200", element }], { initialEntries: ["/admin/operations/200"] }); try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); } };
    const render = (platform: string, kind: string, data: Record<string, unknown> = {}) => { const result: OperationResult = { id: 42, kind, data: { platform, title: "已收作品", record: {}, ...data }, receiptId: 7, sourceId: null, articleId: null, file: null, fileKey: null, imported: false }; return renderElement(createElement(OperationResultView, { result })); };
    for (const platform of ["douyin", "xiaohongshu", "wechat", "tiktok", "bilibili", "weibo", "qichezhijia", "dongchedi", "yiche"]) {
      const html = render(platform, `${platform}_work`);
      assert.equal((html.match(/查看可用详情接口/g) ?? []).length, 1, platform);
      assert(!html.includes("查询补充详情并查看任务"), platform);
      assert.equal(render(platform, `${platform}_account`).includes("查看可用详情接口"), ["douyin", "xiaohongshu", "wechat", "bilibili", "weibo"].includes(platform), `${platform} account`);
    }
    for (const [platform, kind] of [["xiaohongshu", "xiaohongshu_research"], ["xiaohongshu", "xiaohongshu_account_rank"], ["wechat", "wechat_account_rank"], ["weibo", "weibo_trend"], ["tiktok", "tiktok_topic"], ["youtube", "youtube_work"], ["instagram", "instagram_work"], ["toutiao", "toutiao_work"], ["shipinhao", "shipinhao_work"], ["kuaishou", "kuaishou_work"], ["zhihu", "zhihu_work"]]) assert(!render(platform!, kind!).includes("查看可用详情接口"), kind);
    for (const kind of ["baijiahao_work", "baijiahao_account"]) assert.equal((render("baijiahao", kind).match(/查看可用详情接口/g) ?? []).length, 1, kind);
    for (const data of [{identity: {}, workId: "123", url: "https://www.douyin.com/video/123"}, {identity: {uid: "456"}, workId: null, url: "https://www.douyin.com/video/123"}]) {
      const html = render("douyin", "douyin_work", {...data, provider: "agentkey"});
      assert.match(html, /AgentKey.*稳定/);
      assert.match(html, /<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/);
      assert(!html.includes("本原生链接含作品 ID，可由服务端据此核实"));
      const redfox = render("douyin", "douyin_work", {...data, provider: "redfox"});
      assert(!/<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/.test(redfox));
    }
    const xRecord = { tweetId: "9007199254740993123", author: { userId: "123", username: null }, text: "<script>plain</script>🦊", createdAt: "2026-10-20T00:00:00Z", url: "https://x.com/received/status/9007199254740993123" };
    const xData = { operationId: "QCP75W33", workId: xRecord.tweetId, identity: { userId: "123" }, context: { username: "context_handle" }, originResultId: 8, record: xRecord };
    const xHtml = render("x", "x_detail_work", xData);
    assert(xHtml.includes("X 推文详情")); assert(xHtml.includes("后台核实的作者上下文")); assert(xHtml.includes("context_handle")); assert(xHtml.includes("null"));
    assert(xHtml.includes("&lt;script&gt;plain&lt;/script&gt;")); assert(!xHtml.includes("<script>plain</script>")); assert(xHtml.includes("本地导入作品")); assert(xHtml.includes("本次实收原文地址"));
    assert(!render("x", "article", xData).includes("本地导入作品"));
    const linked: OperationResult = { id: 43, kind: "x_detail_work", data: { platform: "x", ...xData, pendingReason: "stale-pending-reason" }, sourceId: "owner", articleId: "legacy", articleTitle: "原文章", receiptId: 1, fileKey: null, file: null, imported: true };
    const linkedHtml = renderElement(createElement(OperationResultView, { result: linked }));
    assert(!linkedHtml.includes("本地导入作品")); assert(!linkedHtml.includes("本地处理待核实原因")); assert(linkedHtml.includes('/admin/content/legacy')); assert(linkedHtml.includes('/admin/sources/owner'));
    const searchHtml = render("x-research", "x_research_work", { operationId: "5K5EG87P", record: { tweetId: xRecord.tweetId, user: { userId: "123" } } });
    assert(searchHtml.includes("查询该作品详情")); assert(!/disabled=""[^>]*>查询该作品详情/.test(searchHtml));
    assert(!render("x-research", "x_comment", { operationId: "ABJQXHUE" }).includes("查询该作品详情"));
    const collection = render("youtube", "query_summary", { returnedPage: { continuationToken: "opaque" }, selectedResearchCount: 0 });
    assert(collection.includes("采集页摘要")); assert(!collection.includes("查看可用详情接口"));
    const operation = detailQueryOperation({ operationId: "LLCI8QTE", label: "车家号详情", parameters: { workId: "frozen" }, fields: [{ name: "page", label: "页码", type: "integer", required: true }], price: { amount: "0.06", currency: "CNY", basis: "estimated" }, purpose: "query" });
    const fields = renderElement(createElement(PlatformFields, { operation, values: {}, onChange: () => {} }));
    assert(fields.includes('aria-label="页码"')); assert(fields.includes('required=""')); assert(fields.includes('value=""')); assert(!fields.includes('value="1"'));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});
