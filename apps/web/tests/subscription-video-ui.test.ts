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
import { nativeVideoConfig, nativeVideoConfigChange, lowerBitrateSaved, videoDownloadRunIds } from "../app/features/admin/subscription-video-data.ts";
import { operationFileAsset } from "../app/features/admin/asset-data.ts";

test("native JSON remains authoritative and invalid drafts cannot be overwritten by checkbox changes", () => {
  const json = JSON.stringify({ query: "from:account", custom: { keep: true }, autoDownloadVideo: true });
  assert.equal(nativeVideoConfig(json)?.autoDownloadVideo, true);
  assert.deepEqual(JSON.parse(nativeVideoConfigChange(json, false)!), { query: "from:account", custom: { keep: true }, autoDownloadVideo: false });
  for (const invalid of ["{unfinished", "[]", "null", "false"]) {
    assert.equal(nativeVideoConfig(invalid), null); assert.equal(nativeVideoConfigChange(invalid, true), null);
  }
});

test("real result cards render large files, actual expiry, normal videos and all parent run links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-subscription-video-ui-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: { progress: new URL("../app/features/admin/subscription-video-result.tsx", import.meta.url).pathname, result: new URL("../app/features/admin/operation-result.tsx", import.meta.url).pathname, form: new URL("../app/features/admin/subscription-video-ui.tsx", import.meta.url).pathname }, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ dir: directory, format: "esm", entryFileNames: "[name].mjs" });
    const { OperationResultItem } = await import(pathToFileURL(join(directory, "result.mjs")).href);
    const { SubscriptionVideoProgress } = await import(pathToFileURL(join(directory, "progress.mjs")).href);
    const { NativeVideoDownloadSetting } = await import(pathToFileURL(join(directory, "form.mjs")).href);
    const render = (element: ReactElement) => {
      const router = createMemoryRouter([{ path: "/admin/operations/200", element }], { initialEntries: ["/admin/operations/200"] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const result: OperationResult = { id: 11, kind: "subscription_video", data: { collector: "agentkey", resolver: { provider: "redfox", operationId: "parser", budget: "redfox.media" }, resolverUsed: false, originalUrl: "https://example.com/work/1", parentRunId: 12, parentResultId: 13, saved: 0, notSaved: 1, reason: "too_large", versionConclusion: "no_provided_version_within_limit" }, articleId: "article-1", sourceId: "source-1", receiptId: null, fileKey: null, file: null, imported: false };
    const renderResult = (r: OperationResult) => render(createElement(OperationResultItem, { result: r }));
    let html = renderResult(result);
    assert(html.includes("原视频过大，未保存")); assert(html.includes("当前接口无 50 MB 内可用版本")); assert(html.includes("未记录已收解析"));
    assert(html.includes('href="/admin/content/article-1"')); assert(html.includes('href="/admin/operations/12?cursor=12#result-13"')); assert(html.includes('href="https://example.com/work/1"')); assert(!html.includes("<video"));
    html = renderResult({ ...result, data: { ...result.data, versionConclusion: "other_versions_unverified" } }); assert(html.includes("其它版本无法验证"));
    html = renderResult({ ...result, data: { ...result.data, reason: "unsupported_format", versionConclusion: undefined } }); assert(html.includes("文件格式不受支持或未通过校验")); assert(!html.includes("原视频过大"));
    const file: NonNullable<OperationResult["file"]> = { key: "uploads/redfox/private.mp4", kind: "video", origin: "subscription-video", contentType: "video/mp4", bytes: 1024, filename: "private.mp4", status: "available", width: null, height: null, createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-10-31T00:00:00.000Z", expired: false, source: { articleId: "article-1", sourceId: "source-1", subscriptionId: 14, runId: 200 } };
    const normal = { ...result, file, fileKey: file.key, data: { ...result.data, reason: "saved", saved: 1, notSaved: 0 } };
    html = renderResult(normal);
    assert(html.includes("<video")); assert(html.includes("下载视频")); assert(html.includes("首次保存")); assert(html.includes("实际到期")); assert(html.includes("重复发现或引用不续期")); assert(html.includes('href="/admin/operations?subscriptionId=14"'));
    assert.equal(operationFileAsset(file)?.metadata.kind, "video"); assert.equal(operationFileAsset(file)?.created_at, file.createdAt);
    html = renderResult({ ...normal, file: { ...file, expired: true } });
    assert(!html.includes("<video")); assert(!html.includes("下载视频")); assert(!html.includes("用作参考")); assert(html.includes("已过期，文件可能正在删除或因使用保护而延期清理"));
    html = renderResult({ ...normal, file: { ...file, expired: true, status: "deleted" } }); assert(html.includes("已删除，历史记录保留"));
    const parent = { ...result, kind: "page", data: { count: 1 }, file: null, videoDownloadRunId: 15, videoDownloadRunIds: [16, 17, 16] };
    html = renderResult(parent); assert(html.includes('href="/admin/operations/16"')); assert(html.includes('href="/admin/operations/17"')); assert(!html.includes('href="/admin/operations/15"'));
    assert.deepEqual(videoDownloadRunIds({ ...parent, videoDownloadRunIds: null }), [15]);
    assert(!renderResult({ ...parent, videoDownloadRunId: undefined, videoDownloadRunIds: undefined }).includes("视频保存记录"));
    assert(!lowerBitrateSaved({ selectedCandidate: { quality: "unknown", bitrate: null, watermark: "none" }, attempts: [{ bitrate: 1000 }] }));
    html = renderResult({ ...normal, data: { ...normal.data, selectedCandidate: { quality: "bitrate", bitrate: 1000 }, attempts: [{ bitrate: 2000, reason: "too_large" }], mediaRole: "quoted" } });
    assert(html.includes("较低码率版本")); assert(html.includes("视频真实来源"));
    const reused = { ...normal, data: { ...normal.data, reason: "reused", reused: true, selectedCandidate: null, attempts: [{ bitrate: 2000, reason: "too_large" }] } };
    html = renderResult(reused);
    assert(html.includes("复用已保存文件")); assert(html.includes("下载视频")); assert(html.includes("实际到期"));
    assert(!html.includes("版本码率")); assert(!html.includes("候选供应商 / 字段")); assert(!html.includes("较低码率版本"));
    assert(!lowerBitrateSaved(reused.data));
    html = render(createElement(NativeVideoDownloadSetting, { json: '{"autoDownloadVideo":true}', onChange() {} })); assert(html.includes('checked=""')); assert(html.includes("redfox.media"));
    html = render(createElement(NativeVideoDownloadSetting, { json: '{unfinished', onChange() {} })); assert(html.includes('disabled=""')); assert(html.includes("当前草稿已保留"));
    const input = { collector: "agentkey", resolver: null, resolverUsed: false, parentRunId: 12, parentResultId: 13, articleId: "article-1", originalUrl: "https://example.com/work/1", retentionDays: 30, maxBytes: 50000000, normalParserAttempts: 1, maxParserAttempts: 2, mediaRole: "own", workId: "work-1" };
    html = render(createElement(SubscriptionVideoProgress, { input, progress: { saved: 0, notSaved: 0, targetsTotal: 1 } }));
    assert(html.includes("没有对应解析接口")); assert(!html.includes("正常 1 次"));
    html = render(createElement(SubscriptionVideoProgress, { input: { ...input, resolver: { provider: "redfox", operationId: "parser", budget: "redfox.media" } }, progress: {} }));
    assert(html.includes("正常 1 次")); assert(html.includes("最多 2 次"));
    assert(html.includes("当前候选传输尝试"));
    html = render(createElement(SubscriptionVideoProgress, { input, progress: { saved: 1, transferredBytes: 912, transferAttempts: 1 }, ended: true }));
    assert(!html.includes("传输尝试")); assert(html.includes("912"));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});
