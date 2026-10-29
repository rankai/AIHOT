import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { rolldown } from "rolldown";
import type { ToolAsset, ToolResult, ToolRunCategory } from "@aihot/contracts/user-tools";
import { availableResultFile, citationSources, resultDetails, resultLinks, resultTitle } from "../app/features/tools/result-data.ts";

const result = (id: number, values: Partial<ToolResult> = {}): ToolResult => ({ id, kind: "unknown_provider_kind", title: "unknown_provider_kind", text: "", url: null, details: {}, links: [], file: null, ...values });
const asset = (key: string, contentType = "image/png", status = "available"): ToolAsset => ({ key, filename: "测试文件", contentType, bytes: 1024, width: 640, height: 480, createdAt: "2026-10-28T00:00:00Z", contentUrl: `/api/tools/assets/${encodeURIComponent(key)}/content`, status });

test("result projections keep zero facts, reject unsafe links/media and preserve explicit citation metadata", () => {
  const answer = result(1, { kind: "ai_search_answer", url: "https://example.test/report", links: [{ label: "resourceUrl", url: "https://example.test/other" }] });
  const citation = result(2, { kind: "ai_search_citation", title: "原始研究报告", text: "原文摘要", url: "https://example.test/report" });
  assert.deepEqual(citationSources([answer, citation]), [
    { label: "原始研究报告", text: "原文摘要", url: "https://example.test/report", host: "example.test" },
    { label: "example.test", text: "", url: "https://example.test/other", host: "example.test" },
  ]);
  assert.equal(resultTitle(result(3)), "查询结果");
  assert.deepEqual(resultDetails(result(4, { details: { likeCount: 0, hasMore: false, hidden: null } })), [{ key: "likeCount", label: "点赞数", value: "0" }, { key: "hasMore", label: "还有更多", value: "否" }]);
  assert.deepEqual(resultLinks(result(5, { url: "javascript:alert(1)", links: [{ label: "不安全", url: "https://user:pass@example.test/" }, { label: "sourceUrl", url: "https://example.test/source" }, { label: "重复", url: "https://example.test/source" }] })), [{ label: "查看来源", url: "https://example.test/source", host: "example.test" }]);
  assert.equal(availableResultFile(result(6, { file: { ...asset("image.png"), contentUrl: "https://example.test/private-image" } })), null);
  assert.equal(availableResultFile(result(7, { file: asset("image.png", "image/png", "expired") })), null);
  assert.equal(availableResultFile(result(8, { file: asset("private/image.png") }))?.contentUrl, "/api/tools/assets/private%2Fimage.png/content");
});

test("tool results render readable business output, safe text, separate media and compact process records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-user-result-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: new URL("../app/features/tools/results.tsx", import.meta.url).pathname, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react-dom", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ file: join(directory, "view.mjs"), format: "esm" });
    const { ToolResults, ToolProcessResults } = await import(pathToFileURL(join(directory, "view.mjs")).href);
    const render = (category: ToolRunCategory, results: ToolResult[]) => renderToStaticMarkup(createElement(ToolResults, { category, results }));
    const query = render("query", [result(1, { kind: "query_summary", title: "query_summary", details: { count: 1 } }), result(2, { title: "真实作品标题", text: '<script>alert("unsafe")</script>', details: { likeCount: 0, authorName: "测试作者" }, url: "javascript:alert(1)", links: [{ label: "workUrl", url: "https://example.test/work" }] })]);
    assert(query.indexOf("真实作品标题") < query.indexOf("查询摘要"));
    assert(query.includes("点赞数")); assert(query.includes(">0<")); assert(query.includes("查看作品"));
    assert(query.includes("&lt;script&gt;")); assert(!query.includes("<script>")); assert(!query.includes('href="javascript:'));
    assert(!query.includes("unknown_provider_kind")); assert(query.includes("查看详细信息"));
    assert(render("query", [result(1, { kind: "query_summary", details: { actualCount: 0 } })]).includes("未查询到符合条件的数据"));

    const ai = render("ai-search", [result(1, { kind: "ai_search_citation", title: "研究报告", text: "摘要文本", url: "https://example.test/report" }), result(2, { kind: "ai_search_answer", title: "ai_search_answer", text: '# 搜索结论\n\n**关键结论**\n\n- 第一项\n- 第二项\n\n| 指标 | 数量 |\n| --- | --- |\n| 示例 | 0 |\n\n[来源](https://example.test/report) [危险链接](javascript:alert)\n\n<img src=x onerror=alert(1)>\n\n```html\n<script>blocked</script>\n```\n\n- ', url: "https://example.test/report" })]);
    assert(ai.indexOf("AI 搜索回答") < ai.indexOf("参考来源")); assert(ai.includes("复制回答")); assert(ai.includes("<strong")); assert(ai.includes("<ul")); assert(ai.includes("<table"));
    assert(ai.includes("参考来源 · 1 条")); assert(ai.includes("研究报告")); assert(ai.includes("摘要文本"));
    assert(!ai.includes('href="javascript:')); assert(!/<(?:img|script)\b/.test(ai)); assert(ai.includes("&lt;img")); assert(ai.includes("&lt;script&gt;"));

    const products = render("ai-search", [result(3, { kind: "ai_search_answer", text: "商品回答", details: { family: "doubaoProducts" }, products: { cardData: [{ title: "测试商品", price: "¥12–20", sales: "1万+", pos: 0, url: "https://example.test/item", image: "javascript:unsafe" }], searchGuid: [{ title: "独立参考", url: "https://example.test/source" }] } })]);
    assert(products.includes("测试商品")); assert(products.includes("¥12–20")); assert(products.includes("1万+"));
    assert(products.includes('href="https://example.test/item"')); assert(products.includes("独立参考")); assert(products.includes("搜索参考（searchGuid）"));
    assert(!products.includes("参考来源 ·")); assert(!products.includes('href="javascript:')); assert(!products.includes("字段诊断"));
    const emptyProducts = render("ai-search", [result(4, { kind: "ai_search_answer", text: "正常回答", details: { family: "qianwenProducts" }, products: { cardData: [], searchGuid: [] } })]);
    assert(emptyProducts.includes("正常回答")); assert(emptyProducts.includes("本次回答未返回商品卡"));

    const images = render("images", [result(1, { kind: "image", title: "image", file: asset("generated/1.png") }), result(2, { kind: "image", title: "image", file: asset("generated/2.png", "image/png", "expired") })]);
    assert.equal((images.match(/<img\b/g) ?? []).length, 1); assert(images.includes("放大查看生成图片 1")); assert(images.includes("下载原图")); assert(images.includes("文件已过期、删除或未保存")); assert(!images.includes("generated%2F2.png"));

    const video = render("videos", [result(1, { kind: "image", title: "image", details: { role: "last_frame" }, file: asset("generated/frame.png") }), result(2, { kind: "video", title: "video", file: asset("generated/video.mp4", "video/mp4"), details: { durationSeconds: 8 } })]);
    assert.equal((video.match(/<video\b/g) ?? []).length, 1); assert.equal((video.match(/<img\b/g) ?? []).length, 1);
    assert(video.indexOf("<video") < video.indexOf("视频末帧")); assert(video.includes("下载视频")); assert(video.includes("下载末帧")); assert(video.includes("8 秒"));
    const missingVideo = render("videos", [result(1, { kind: "video", title: "video", url: "https://example.test/movie.mp4" })]);
    assert(!missingVideo.includes("<video")); assert(missingVideo.includes("任务结果记录仍然保留"));

    const subtitle = render("query", [result(1, { kind: "subtitle_track", title: "subtitle_track", text: "只是视频说明", details: { textMeaning: "video-description", languageName: "中文" }, links: [{ label: "srt", url: "https://example.test/subtitle.srt" }] })]);
    assert(subtitle.includes("以下为视频说明")); assert(subtitle.includes("字幕正文请通过下方字幕文件链接")); assert(subtitle.includes("SRT 文件"));
    const zeroComments = render("xhs-comments", [result(1, { kind: "xhs_comment_task", title: "xhs_comment_task", details: { status: "completed", actualCount: 0 } })]);
    assert(zeroComments.includes("评论查询摘要")); assert(zeroComments.includes("实际数量")); assert(zeroComments.includes(">0<"));

    for (const mime of ["image/png", "video/mp4", "audio/mpeg"]) {
      const upload = render("media-upload", [result(90, { kind: "media_upload", file: asset("upload", mime), links: [{ label: "resourceUrl", url: "https://example.test/uploaded" }] })]);
      assert(upload.includes('href="https://example.test/uploaded"'));
      assert(upload.includes("素材上传结果"));
    }

    const process = renderToStaticMarkup(createElement(ToolProcessResults, { results: [result(1, { kind: "video_task", title: "provider_process_raw", details: { status: "processing", progress: 20 }, file: asset("should-not-render.mp4", "video/mp4") })] }));
    assert(process.includes("视频生成进度")); assert(process.includes("处理中")); assert(process.includes("20")); assert(!process.includes("provider_process_raw")); assert(!/<(?:img|video|audio)\b/.test(process));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});
