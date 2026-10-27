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
import type { OperationResult } from "../app/features/admin/operation-types.ts";
test("actual current-page toolbar renders only qualified work checkboxes; pure research/linked/expired pages have no toolbar", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-work-selection-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: { view: new URL("../app/features/admin/work-result-selection.tsx", import.meta.url).pathname, ownership: new URL("../app/features/admin/source-ownership.tsx", import.meta.url).pathname }, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const { WorkSourceProvider } = await import(pathToFileURL(join(directory, "ownership.mjs")).href);
    const { WorkResultSelection } = await import(pathToFileURL(join(directory, "view.mjs")).href);
    const base: OperationResult = { id: 1, kind: "weibo_work", data: { platform: "weibo", uid: "123", opusId: "42", url: "https://weibo.com/123/received", record: { title: "收到标题<script>plain</script>🦊" } }, sourceId: null, articleId: null, receiptId: 1, fileKey: null, file: null, imported: false };
    const render = (results: OperationResult[]) => {
      const router = createMemoryRouter([{ path: "/admin/operations/200", element: createElement(WorkSourceProvider, { inputs: { members: [{ sourceId: "test-source" }], sources: [{ id: "test-source", name: "已有所属信源" }] }, results, children: createElement(WorkResultSelection, { results }) }) }], { initialEntries: ["/admin/operations/200?cursor=12"] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const unqualified = [
      { ...base, id: 2, articleId: "already-linked" },
      { ...base, id: 3, kind: "weibo_account" },
      { ...base, id: 4, kind: "result_expired" },
      { ...base, id: 5, kind: "shipinhao_work" },
      { ...base, id: 6, kind: "kuaishou_work" },
      { ...base, id: 7, kind: "qichezhijia_work" },
      { ...base, id: 8, kind: "query_summary" },
      { ...base, id: 9, data: { ...base.data, opusId: null } },
      { ...base, id: 10, kind: "image" },
    ];
    const html = render([base, ...unqualified]);
    assert(html.includes('aria-label="本页作品多选导入"')); assert(html.includes('aria-label="选择结果 #1"')); assert(html.includes("本页可多选导入 1 项，已选 0 项"));
    for (const result of unqualified) assert(!html.includes(`aria-label="选择结果 #${result.id}"`));
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 1);
    assert(html.includes("收到标题&lt;script&gt;plain&lt;/script&gt;🦊")); assert(!html.includes("<script>plain</script>"));
    assert(html.includes('href="/admin/operations/200?cursor=12#result-1"')); assert(!html.includes('checked=""'));
    for (const result of unqualified) assert.equal(render([result]), "", `${result.kind} has no empty toolbar`);
    const bodyHtml = render([{ ...base, data: { ...base.data, record: {}, text: "实收微博正文<script>plain</script>🦊" } }]);
    assert(bodyHtml.includes("实收微博正文&lt;script&gt;plain&lt;/script&gt;🦊")); assert(!bodyHtml.includes("weibo_work"));
    const fallback = render([{ ...base, data: { ...base.data, record: {} } }]);
    assert(fallback.includes("#1 · 作品")); assert(!fallback.includes("weibo_work"));
    assert.equal(render([]), "");
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

test("AgentKey Weibo actual result cards distinguish derived work, unknown retweet, nested researchers and zero metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-weibo-results-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: { view: new URL("../app/features/admin/operation-result.tsx", import.meta.url).pathname, ownership: new URL("../app/features/admin/source-ownership.tsx", import.meta.url).pathname }, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const { WorkSourceProvider } = await import(pathToFileURL(join(directory, "ownership.mjs")).href);
    const { OperationResultItem } = await import(pathToFileURL(join(directory, "view.mjs")).href);
    const render = (kind: string, data: Record<string, unknown>) => {
      const result: OperationResult = { id: 1, kind, data, sourceId: null, articleId: null, receiptId: 1, fileKey: null, file: null, imported: false };
      const router = createMemoryRouter([{ path: "/admin/operations/200", element: createElement(WorkSourceProvider, { inputs: { members: [{ sourceId: "test-source" }], sources: [{ id: "test-source", name: "已有所属信源" }] }, results: [result], children: createElement(OperationResultItem, { result }) }) }], { initialEntries: ["/admin/operations/200"] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const common = { provider: "agentkey", platform: "weibo" };
    const work = { ...common, operationId: "TXQPVGJG", tool: "TikHub/fetch_search_all_api_v1_weibo_app_fetch_search_all_get", role: "status", uid: "123", opusId: "456", opusUrl: "https://weibo.com/123/456", mblogid: "LinkId", urlSource: "derived-canonical-permalink", text: "实收片段<script>plain</script>", textScope: "received-excerpt", isLongText: true, publishTime: "Thu Oct 22 08:00:00 +0800 2026", publishedAt: "2026-10-22T00:00:00.000Z", record: { attitudes_count: 0 }, importable: false };
    const html = render("weibo_work", work);
    assert(html.includes("带入已收微博 ID 到平台查询")); assert(!html.includes("查看可用详情接口"));
    assert(render("weibo_work", { ...work, provider: "redfox" }).includes("查看可用详情接口"));
    for (const patch of [{ opusId: null }, { role: "outer-status-unparsed-retweet" }, { tool: "other" }]) assert(!render("weibo_work", { ...work, ...patch }).includes("带入已收微博 ID 到平台查询"));
    assert(html.includes("由实收身份组成的规范原文")); assert(html.includes('href="https://weibo.com/123/456"')); assert(html.includes("收到的链接 ID（mblogid）")); assert(html.includes("实收长微博片段")); assert(html.includes("已按原始时区转换的时间")); assert(html.includes("+0800")); assert(html.includes("attitudes_count"));
    assert(html.includes("实收片段&lt;script&gt;plain&lt;/script&gt;")); assert(!html.includes("<script>plain</script>"));
    assert.match(html, /<button(?![^>]*\sdisabled(?:\s|=|>))[^>]*>本地导入材料<\/button>/);
    for (const patch of [{ opusId: null }, { role: "outer-status-unparsed-retweet" }, { opusUrl: "sinaweibo://status?id=456" }]) {
      const blocked = render("weibo_work", { ...work, ...patch, importable: true });
      assert.match(blocked, /<button[^>]*disabled=""[^>]*>本地导入材料<\/button>/);
      assert(blocked.includes("不能人工补 ID 或地址")); assert(!blocked.includes('aria-label="补充已核实作者 UID"')); assert(!blocked.includes('aria-label="补充已核实原文地址"'));
    }
    const profile = render("weibo_account", { ...common, operationId: "API_1789098515117", tool: "TikHub/fetch_user_info_api_v1_weibo_app_fetch_user_info_get", uid: "123", record: { description: "实收简介", followers_count: 0, friends_count: 0, verified: false } });
    assert(profile.includes("实收简介")); assert(profile.includes("followers_count")); assert(profile.includes("friends_count")); assert(!profile.includes("statuses_count"));
    const comments = render("social_comment", { ...common, operationId: "weibo.comments", tool: "TikHub/fetch_status_comments_api_v1_weibo_app_fetch_status_comments_get", title: "评论", commentId: "111", requestedScope: { status_id: "999" }, receivedScope: null, record: { id: "8000123", idstr: "8000123", created_at: "Thu Oct 22 08:00:00 +0800 2026", text: "评论正文", rootid: "222", like_counts: 0, user: { id: "7004567", uid: "333", screen_name: "实收评论者" } } });
    assert(comments.includes("评论 ID · id")); assert(comments.includes("评论 ID 字符串 · idstr")); assert(comments.includes("用户 ID · id")); assert(comments.includes("实收原始时间 · created_at")); assert(comments.includes("+0800")); assert(!comments.includes("原始 created_at（单位 / 时区未说明）"));
    assert(comments.includes("实收评论者")); assert(comments.includes("响应未返回作品范围")); assert(comments.includes("父评论 ID（不是作品 ID）")); assert(comments.includes("本条评论者字段")); assert(!comments.includes(">本地导入材料</button>"));
    const follow = render("social_followee", { ...common, operationId: "weibo.following", tool: "TikHub/fetch_user_following_api_v1_weibo_app_fetch_user_following_get", title: "关注账号", role: "followee", identity: { uid: "444" }, record: { user: { uid: "444", screen_name: "实收关注账号", followers_count: 0 } } });
    assert(follow.includes("本条关注列表账号字段")); assert(follow.includes("实收关注账号")); assert(!follow.includes(">绑定或新建隔离信源</button>"));
    const hot = render("hotspot_research", { ...common, operationId: "UAQ90A1F", tool: "TikHub/fetch_hot_search_api_v1_weibo_app_fetch_hot_search_get", title: "实收热词", record: { desc: "实收热词", desc_extr: 0 } });
    assert(hot.includes("desc_extr")); assert(hot.includes("本接口未确认排名")); assert(!hot.includes(">本地导入材料</button>"));
    const related = render("search_suggestion", { ...common, operationId: "weibo.related_search", tool: "TikHub/fetch_similar_search_api_v1_weibo_web_v2_fetch_similar_search_get", title: "实收相关词", record: { suggestion: "实收相关词", count: 0, discuss: 0 } });
    assert(related.includes("相关搜索词研究")); assert(related.includes("suggestion")); assert(related.includes("discuss")); assert(!related.includes(">本地导入材料</button>"));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});
