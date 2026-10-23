import type { OperationResult } from "./operation-types.ts";
import type { PrivateAsset } from "./image-types.ts";
import { safeExternalUrl } from "./platform-types.ts";
import { researchObject } from "./research-platform-data.ts";
import { isTranscriptionResult } from "./transcription-data.ts";
import { isMediaToolResult } from "./media-tool-data.ts";

export interface ResultAttachmentRow {
  id: number; data: Record<string, unknown>; file_key: string | null; article_id: string | null; source_id: string | null;
  file_status: string | null; content_type: string | null; bytes: number | null; metadata: PrivateAsset["metadata"] | null; article_revision: number | null;
}
export function attachmentChoices(result: Pick<OperationResult, "kind" | "data">): Array<{ label: string; formatIndex?: number }> {
  const { kind, data } = result, record = researchObject(data.record);
  if (kind === "transcription" && isTranscriptionResult(kind, data) && data.status === "succeeded" && typeof data.text === "string" && data.text.trim()) return [{ label: "TXT" }];
  if (!isMediaToolResult(kind, data)) return [];
  if (kind === "subtitle_track" && Array.isArray(record.urls)) return record.urls.flatMap((entry, formatIndex) => {
    const item = researchObject(entry);
    return ["srt", "vtt", "json", "json3"].includes(String(item.format)) && safeExternalUrl(item.url) ? [{ label: String(item.format).toUpperCase(), formatIndex }] : [];
  });
  if (kind === "media_resource" && ["image", "audio", "video", "mp3"].includes(String(record.type)) && safeExternalUrl(record.downloadUrl)) return [{ label: "媒体" }];
  return [];
}
export function saveAttachmentBody(result: Pick<OperationResult, "kind" | "data">, formatIndex: number | undefined, rawReason: string) {
  if (!attachmentChoices(result).some(choice => choice.formatIndex === formatIndex)) throw new Error("请从本条结果实际支持的格式中选择附件。");
  const reason = rawReason.trim();
  if (!reason || reason.length > 500) throw new Error("请填写 1–500 字符的保存原因。");
  return { ...(formatIndex !== undefined ? { formatIndex } : {}), reason };
}
export function resultUseCapabilities(result: Pick<OperationResult, "kind" | "data" | "file">) {
  if (result.kind === "transcription") { const usable = attachmentChoices(result).length > 0; return { attach: usable, fillBody: usable }; }
  const text = result.kind === "result_attachment" && result.file?.status === "available" && ["text/plain", "text/vtt", "application/x-subrip", "application/json"].includes(result.file.contentType.split(";")[0]!.trim()) && ["txt", "srt", "vtt", "json", "json3"].includes(String(result.data.format));
  return { attach: !!text, fillBody: !!text && ["txt", "srt", "vtt"].includes(String(result.data.format)) && result.data.bodyUsable === true };
}
export function resultPageLink(pathname: string, resultId: number) { return `${pathname}?cursor=${resultId - 1}#result-${resultId}`; }
export async function readResultLocal<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", signal });
  if (response.status === 401) { window.location.href = `/api/auth/login?return=${encodeURIComponent(window.location.pathname)}`; throw new Error("请重新登录。"); }
  const body = await response.json();
  if (!response.ok) throw new Error(body?.detail ?? `读取失败（${response.status}）`);
  return body as T;
}
