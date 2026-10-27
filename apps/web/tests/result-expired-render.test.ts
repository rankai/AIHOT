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

test("expired results dispatch before original platform/summary facts and expose only local retained metadata, never old actions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-result-expired-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: new URL("../app/features/admin/operation-result.tsx", import.meta.url).pathname, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ file: join(directory, "view.mjs"), format: "esm" });
    const { OperationResultItem } = await import(pathToFileURL(join(directory, "view.mjs")).href);
    const render = (element: ReactElement) => {
      const router = createMemoryRouter([{ path: "/admin/operations/200", element }], { initialEntries: ["/admin/operations/200"] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const base: OperationResult = { id: 11, kind: "result_expired", data: { originalKind: "transcription", expiredAt: "2026-10-21T04:05:06.000Z" }, sourceId: null, articleId: null, receiptId: 4, fileKey: null, file: null, imported: false };
    for (const originalKind of ["transcription", "subtitle_track", "media_resource", "x_detail_work", "wechat_work", "query_summary", "image", "result_attachment"]) {
      const result = { ...base, data: { ...base.data, originalKind, platform: "wechat", operationId: "PW97QFBS", selectedResearchCount: 0, returnedPage: { token: "PRIVATE-OLD-DATA" }, text: "PRIVATE-OLD-DATA", url: "https://example.com/PRIVATE-OLD-DATA", status: "succeeded" }, fileKey: "private/old", file: { key: "private/old", status: "available", contentType: "image/png", bytes: 100, width: 1, height: 1, filename: "old.png" } };
      const html = render(createElement(OperationResultItem, { result }));
      assert(html.includes("结果内容已过期")); assert(html.includes(originalKind)); assert(html.includes("2026-10-21T04:05:06.000Z")); assert(html.includes("本地保留元数据"));
      assert.equal((html.match(/id="result-11"/g) ?? []).length, 1);
      assert(!html.includes("PRIVATE-OLD-DATA")); assert(!html.includes("采集页摘要")); assert(!html.includes("/api/admin/assets/"));
      assert(!/<(?:button|img|video|audio)\b/.test(html));
      assert(!html.includes("查看可用详情接口")); assert(!html.includes("本地导入作品")); assert(!html.includes("保存TXT附件"));
      assert(html.includes('href="/admin/data-tools?view=platforms"')); assert(html.includes("不会自动重新购买"));
    }
    const parent: OperationResult = { ...base, kind: "subtitle_track", id: 12, data: { platform: "tools", group: "subtitle", operationId: "API_1792051516512", languageTag: "en", record: { urls: [{ format: "srt", url: "https://example.com/subtitle" }] } } };
    const child: OperationResult = { ...base, id: 13, kind: "result_attachment", data: { parentResultId: 12, format: "srt", acquisition: "subtitle-download", bodyUsable: true } };
    const ordinary: OperationResult = { ...base, id: 14, kind: "page", data: { count: 0 } };
    const record: OperationResult = { ...base, id: 15, kind: "image_task", data: { status: "processing" } };
    const transcription: OperationResult = { ...base, id: 16, kind: "transcription_task", data: { platform: "douyin", status: "processing", text: null } };
    const html = render(createElement("div", {}, createElement("div", { className: "space-y-4", "aria-label": "primary-results" }, [parent, child, ordinary].map(result => createElement(OperationResultItem, { key: result.id, result }))), createElement("div", { className: "space-y-4", "aria-label": "history-results" }, [record, transcription].map(result => createElement(OperationResultItem, { key: result.id, result })))));
    assert(html.includes('href="/admin/operations/200?cursor=11#result-12"'));
    for (const id of [12, 13, 14, 15, 16]) assert.equal((html.match(new RegExp(`id="result-${id}"`, "g")) ?? []).length, 1, `unique actual target ${id}`);
    assert.match(html, /id="result-14"[^>]*><article/); assert.match(html, /id="result-15"[^>]*><article/);
    assert(html.includes('aria-label="primary-results"')); assert(html.includes('aria-label="history-results"'));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});
