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
import type { OperationDetail, OperationResult } from "../app/features/admin/operation-types.ts";
import type { PlatformOperation } from "../app/features/admin/platform-types.ts";
import type { TranscriptionOptions } from "../app/features/admin/transcription-types.ts";

test("actual result dispatcher renders parent anchors and private text child links without media or supplier-upload actions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-result-attachment-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: { mediaForm: new URL("../app/features/admin/media-tool-form.tsx", import.meta.url).pathname, result: new URL("../app/features/admin/operation-result.tsx", import.meta.url).pathname, progress: new URL("../app/features/admin/transcription-progress.tsx", import.meta.url).pathname, form: new URL("../app/features/admin/transcription-form.tsx", import.meta.url).pathname }, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const { OperationResultView } = await import(pathToFileURL(join(directory, "result.mjs")).href);
    const { TranscriptionProgress } = await import(pathToFileURL(join(directory, "progress.mjs")).href);
    const { MediaToolForm } = await import(pathToFileURL(join(directory, "mediaForm.mjs")).href);
    const { TranscriptionForm } = await import(pathToFileURL(join(directory, "form.mjs")).href);
    const base: OperationResult = { id: 11, kind: "transcription", data: { platform: "douyin", status: "succeeded", text: "正文 🦊" }, sourceId: null, articleId: null, receiptId: 4, fileKey: null, file: null, imported: false };
    const renderElement = (element: ReactElement) => {
      const router = createMemoryRouter([{ path: "/admin/operations/200", element }], { initialEntries: ["/admin/operations/200"] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const render = (result: OperationResult) => renderElement(createElement(OperationResultView, { result }));
    const transcription = render(base);
    assert(transcription.includes('id="result-11"')); assert(transcription.includes("保存TXT附件")); assert(transcription.includes("结果关联材料"));
    const processing = render({ ...base, kind: "transcription_task", data: { platform: "douyin", status: "processing", text: null } });
    assert(!processing.includes("保存TXT附件")); assert(!processing.includes("结果关联材料"));
    const subtitle = render({ ...base, id: 12, kind: "subtitle_track", data: { platform: "tools", group: "subtitle", operationId: "API_1792051516512", languageName: "英语", languageTag: "en", record: { urls: [{ format: "srt", url: "https://example.com/subtitle" }] } } });
    assert(subtitle.includes('id="result-12"')); assert(subtitle.includes("保存所选字幕附件"));
    const child: OperationResult = { ...base, id: 13, kind: "result_attachment", data: { parentResultId: 12, format: "json3", acquisition: "subtitle-download", bodyUsable: false }, fileKey: "private/file", file: { key: "private/file", status: "available", contentType: "application/json", bytes: 5, filename: "result.json3", width: null, height: null } };
    const attachment = render(child);
    assert(attachment.includes('id="result-13"')); assert(attachment.includes('href="/admin/operations/200?cursor=11#result-12"'));
    assert(attachment.includes("下载文本附件")); assert(attachment.includes("关联已有材料")); assert(!attachment.includes("填入缺失正文</button>"));
    assert(!/<(?:img|video|audio)\b/.test(attachment)); assert(!attachment.includes("上传到 Redfox")); assert(!attachment.includes("用作参考"));
    assert(attachment.includes("/api/admin/assets/private%2Ffile/content"));
    const deleted = render({ ...child, articleId: "linked-article", file: { ...child.file!, status: "deleted" } });
    assert(!deleted.includes("/api/admin/assets/private%2Ffile/content")); assert(deleted.includes("/admin/content/linked-article")); assert(!deleted.includes("结果关联材料"));
    const collection = render({ ...base, kind: "query_summary", data: { platform: "youtube", selectedResearchCount: 0, returnedPage: { continuationToken: " raw|token " }, count: 0 } });
    assert(collection.includes("采集页摘要")); assert(!collection.includes("保存TXT附件"));
    const operation: OperationDetail = { id: 200, provider: "redfox", operationKey: "redfox.transcript.submit", status: "completed", step: "redfox.transcript.poll", stepVersion: 2, generation: 1, waitReason: null, nextAttemptAt: null, createdAt: "2026-10-21T00:00:00Z", subscriptionId: null, currentReceiptId: null, receiptId: null, receipt: null, jobState: null, nextAction: "view-results", nextResultCursor: null, results: [base], progress: {}, inputs: { platform: "douyin", transcriptionPlan: { submissionLimit: 1, pollLimit: 60, pollDeadlineSeconds: 7200 } }, attempts: [] };
    const progress = renderElement(createElement(TranscriptionProgress, { operation }));
    assert(progress.includes("关联已有材料")); assert(progress.includes("填入缺失正文")); assert(!progress.includes("尚未提供"));
    assert(progress.includes("不会取消供应商已受理转写，也不保证退款")); assert(progress.includes("不自动写入文章")); assert(progress.includes("不发布、不改变权限"));
    const options: TranscriptionOptions = { platforms: [{ platform: "douyin", label: "抖音", submit: "submit", poll: "poll", submitEstimatedCny: 0.6, pollEstimatedCny: 0 }], limits: { steps: 80, polls: 60, retries: 1, pollDeadlineSeconds: 7200, externalAttempts: 80, pollIntervalSeconds: 30, maxPollIntervalSeconds: 120 }, services: { submission: "redfox.transcript", poll: "redfox.poll" }, timestampUnit: "milliseconds", inputHint: "完整分享文案", resultPurpose: "本地研究结果，不自动写入材料" };
    const form = renderElement(createElement(TranscriptionForm, { options }));
    assert(form.includes("保存 TXT 附件")); assert(form.includes("关联已有材料")); assert(!form.includes("尚未提供")); assert(form.includes("不自动写入文章"));
    for (const id of ["9Q2PQBKU", "API_1792051516512", "API_1791881343238"]) {
      const text = id === "API_1791881343238";
      const tool: PlatformOperation = { id, platform: "tools", label: id, purpose: "本次查询仅保存研究结果，不下载文件或自动导入材料", schedulableType: null, fields: [{ name: text ? "content" : "url", label: "输入", type: "string", required: true }] };
      const toolForm = renderElement(createElement(MediaToolForm, { operations: [tool] }));
      assert(!toolForm.includes("不提供导入、绑定或材料附件关联动作"));
      assert(!/<(?:img|video|audio)\b/.test(toolForm));
      if (text) {
        assert(toolForm.includes("只展示文本检查与安全标注")); assert(!toolForm.includes("显式保存"));
      } else {
        assert(toolForm.includes("本次查询不会下载或保存本地文件")); assert(toolForm.includes("不自动加载媒体、读取字幕内容或写入材料"));
        assert(toolForm.includes("显式保存")); assert(toolForm.includes("TXT/SRT/VTT 可填入缺失正文")); assert(toolForm.includes("JSON/json3 仅可关联")); assert(toolForm.includes("媒体附件仅供私有保存"));
        assert(toolForm.includes("不发布、不改变权限")); assert(!toolForm.includes("结果关联材料</button>"));
      }
    }
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});
