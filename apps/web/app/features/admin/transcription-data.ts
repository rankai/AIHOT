import { safeExternalUrl } from "./platform-types.ts";
import type { TranscriptionMode, TranscriptionPlatform } from "./transcription-types.ts";

export const transcriptionPlatforms: Readonly<Record<TranscriptionPlatform, string>> = { douyin: "抖音", xiaohongshu: "小红书", shipinhao: "视频号", kuaishou: "快手", bilibili: "哔哩哔哩", videoUrl: "视频播放直链" };
export function isTranscriptionPlatform(value: unknown): value is TranscriptionPlatform {
  return typeof value === "string" && Object.hasOwn(transcriptionPlatforms, value);
}
export function isTranscriptionOperation(operationKey: string): boolean {
  return operationKey === "redfox.transcript.submit" || operationKey === "redfox.transcript.query";
}
export function isTranscriptionResult(kind: string, data: Record<string, unknown>): boolean {
  return ["transcription", "transcription_task"].includes(kind) && isTranscriptionPlatform(data.platform);
}
export function transcriptionCommand(mode: TranscriptionMode, platform: string, value: string) {
  if (!isTranscriptionPlatform(platform)) throw new Error("请选择开放的转写平台");
  if (!value.trim()) throw new Error(mode === "submit" ? "请输入链接或完整分享文案" : "请输入已有转写任务 ID");
  if (value.length > (mode === "submit" ? 10000 : 500)) throw new Error(mode === "submit" ? "链接或分享文案最多 10000 字" : "任务 ID 最多 500 字");
  return mode === "submit" ? { path: "/api/admin/redfox/transcriptions", body: { platform, url: value } } : { path: "/api/admin/redfox/transcriptions/query", body: { platform, taskId: value } };
}
/** A sharing paragraph stays a paragraph: never extract its URL or silently trim it. */
export function transcriptionSourceLink(value: unknown): string | null {
  return typeof value === "string" && !/\s/.test(value) && /^https?:\/\//i.test(value) ? safeExternalUrl(value) : null;
}
interface SavedTranscription { id: number; kind: string; data: Record<string, unknown> }
function retained(results: SavedTranscription[], platform: unknown) {
  return results.filter(result => isTranscriptionResult(result.kind, result.data) && result.data.platform === platform).toSorted((a, b) => b.id - a.id);
}
function idString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
export function transcriptionTaskFacts(operation: { progress: Record<string, unknown>; inputs: { platform?: string; parameters?: Record<string, unknown> }; results: SavedTranscription[] }) {
  const results = retained(operation.results, operation.inputs.platform);
  const actualTaskId = results.map(result => idString(result.data.taskId)).find(Boolean) ?? null;
  const requestedTaskId = idString(operation.inputs.parameters?.taskId) ?? results.map(result => idString(result.data.requestedTaskId)).find(Boolean) ?? null;
  return { actualTaskId, requestedTaskId, executionTaskId: idString(operation.progress.taskId) ?? actualTaskId ?? requestedTaskId, latest: results[0] ?? null };
}
export function transcriptionProviderStatus(kind: string, data: Record<string, unknown>): string {
  if (data.status === "processing") return "供应商返回：处理中";
  if (data.status === "succeeded") return "供应商返回：转写成功";
  if (data.status === "failed") return "供应商返回：转写失败";
  return kind === "transcription_task" && idString(data.taskId) && !Object.hasOwn(data, "status") ? "提交回执已保存" : "未提供处理状态";
}
export function transcriptionRunStage(status: string, step: string): string {
  if (status === "completed") return "本轮已完成，可查看已保存的转写结果";
  if (status === "failed") return "本轮已结束，请查看最近记录与失败原因";
  if (status === "stopped") return "本地转写任务已停止";
  if (status === "needs_review") return "需要核对当前回执";
  return step === "redfox.transcript.submit" ? "等待并提交转写请求" : status === "waiting" ? "等待下一次转写查询" : "等待并查询转写结果";
}
export function transcriptionTextField(data: Record<string, unknown>, key: "text" | "failReason") {
  if (!Object.hasOwn(data, key)) return { state: "absent" as const, text: "上游未提供" };
  if (data[key] === null) return { state: "null" as const, text: "null（上游为空）" };
  return typeof data[key] === "string" ? { state: "text" as const, text: data[key] as string } : { state: "invalid" as const, text: "上游字段不是文本，详见诊断" };
}
export function transcriptionTextPresentation(kind: string, data: Record<string, unknown>) {
  const field = transcriptionTextField(data, "text");
  const hasText = field.state === "text" && field.text.trim().length > 0;
  return { field, hasText, needsReview: field.state === "invalid" || kind === "transcription" && !hasText };
}
/** Only slice presentation; milliseconds and segment text remain untouched. */
export function transcriptionSegmentPage(data: Record<string, unknown>, requestedPage: number, size = 25) {
  const segments = Array.isArray(data.stampSents) ? data.stampSents : [];
  const pageSize = Number.isSafeInteger(size) && size > 0 ? size : 25;
  const pages = Math.ceil(segments.length / pageSize);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(0, Math.min(requestedPage, Math.max(0, pages - 1))) : 0;
  const start = page * pageSize;
  return { rows: segments.slice(start, start + pageSize) as Array<{ textSeg: string; start: number | string; end: number | string }>, total: segments.length, pages, page, start, end: Math.min(start + pageSize, segments.length) };
}
