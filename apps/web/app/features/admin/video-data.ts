import { imageUploadReferenceLink } from "./image-model-data.ts";
import { referenceIssue, type ImageOptions, type PrivateAsset } from "./image-types.ts";
import type { OperationResult } from "./operation-types.ts";
import { researchFactText, researchObject } from "./research-platform-data.ts";
import type { VideoDraft, VideoOptions, VideoReferences, VideoRole } from "./video-types.ts";
export const videoRoleLabels: Record<VideoRole, string> = { first_frame: "首帧", last_frame: "末帧", reference_image: "参考图片" };
export function isVideoOperation(key: string) { return key === "redfox.video.generate" || key === "redfox.video.query"; }
export function isVideoResult(kind: string, data: Record<string, unknown>) { return ["video_task", "video_reference"].includes(kind) || kind === "video" && data.role === "video" || kind === "image" && data.role === "last_frame"; }
export function videoDraft(options: VideoOptions): VideoDraft { return { prompt: "", aspectRatio: options.aspectRatios.includes("16:9") ? "16:9" : options.aspectRatios[0] ?? "", duration: options.durationSeconds.min, resolution: options.resolutions.includes("720p") ? "720p" : options.resolutions[0] ?? "", generateAudio: false, returnLastFrame: false, selected: [], roles: [], confirmedUploads: {} }; }
export function videoFileKeys(roles: ReadonlyArray<{ fileKey: string }>) { return [...new Set(roles.map(row => row.fileKey))]; }
export function removeVideoAsset<T extends VideoReferences>(draft: T, fileKey: string): T { const confirmedUploads = { ...draft.confirmedUploads }; delete confirmedUploads[fileKey]; return { ...draft, selected: draft.selected.filter(row => row.key !== fileKey), roles: draft.roles.filter(row => row.fileKey !== fileKey), confirmedUploads }; }
export function removeVideoRole<T extends VideoReferences>(draft: T, id: number): T {
  const removed = draft.roles.find(row => row.id === id), roles = draft.roles.filter(row => row.id !== id);
  return removed && !roles.some(row => row.fileKey === removed.fileKey) ? removeVideoAsset(draft, removed.fileKey) : { ...draft, roles };
}
export function videoReferenceIssue(draft: VideoReferences, options: VideoOptions): string | null {
  if (draft.roles.length > options.maxReferenceRoles) return `最多 ${options.maxReferenceRoles} 个角色行，请移除多余角色。`;
  for (const role of Object.keys(videoRoleLabels) as VideoRole[]) if (draft.roles.filter(row => row.role === role).length > options.roles[role]) return `${videoRoleLabels[role]}最多 ${options.roles[role]} 个角色行，请调整或移除。`;
  for (const row of draft.roles) {
    if (!Object.hasOwn(videoRoleLabels, row.role)) return "请选择支持的图片角色。";
    const asset = draft.selected.find(asset => asset.key === row.fileKey);
    if (!asset) return "有角色行缺少对应本地素材，请移除后重新选择。";
    const issue = referenceIssue(asset, options); if (issue) return issue;
    const id = draft.confirmedUploads[row.fileKey];
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) return "已选择的上传复用记录无效，请重新从上传结果打开。";
  }
  return null;
}
export function videoGenerationBody(draft: VideoDraft, options: VideoOptions) {
  if (!draft.prompt.trim() || draft.prompt.length > 10000) throw new Error("请填写视频描述，最多 10000 字符。");
  if (!options.aspectRatios.includes(draft.aspectRatio) || !options.resolutions.includes(draft.resolution)) throw new Error("请选择支持的画面比例和分辨率。");
  if (!Number.isSafeInteger(draft.duration) || draft.duration < options.durationSeconds.min || draft.duration > options.durationSeconds.max) throw new Error(`输出时长须为 ${options.durationSeconds.min}–${options.durationSeconds.max} 秒的整数。`);
  if (typeof draft.generateAudio !== "boolean" || typeof draft.returnLastFrame !== "boolean") throw new Error("请核对生成音频和返回末帧选择。");
  const issue = videoReferenceIssue(draft, options); if (issue) throw new Error(issue);
  return { prompt: draft.prompt, aspectRatio: draft.aspectRatio, duration: draft.duration, resolution: draft.resolution, generateAudio: draft.generateAudio, returnLastFrame: draft.returnLastFrame, imageWithRoles: draft.roles.map(row => ({ fileKey: row.fileKey, role: row.role, ...(draft.confirmedUploads[row.fileKey] !== undefined ? { uploadResultId: draft.confirmedUploads[row.fileKey] } : {}) })) };
}
export function videoQueryBody(taskId: string) { if (!taskId.trim() || taskId.length > 500) throw new Error("请填写已有视频任务 ID，最多 500 字符。"); return { taskId }; }
export function videoUploadReferenceLink(result: Pick<OperationResult, "id" | "kind" | "data" | "file" | "fileKey">, options: ImageOptions | null) {
  // Both creation paths require exactly the same qualified local image upload.
  if (!imageUploadReferenceLink(result, options)) return null;
  return `/admin/data-tools?${new URLSearchParams({ view: "videos", reference: result.fileKey!, referenceUploadResult: String(result.id) })}`;
}
export const videoProviderStatuses: Record<string, string> = { processing: "生成中", completed: "供应商生成完成", failed: "生成失败" };
export function videoFailureRows(data: Record<string, unknown>): Array<[string, string]> { return data.status === "failed" || typeof data.failReason === "string" && !!data.failReason.trim() ? [["上游失败原因", Object.hasOwn(data, "failReason") ? researchFactText(data.failReason) : "未提供"]] : []; }
export function videoFactRows(data: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, label] of [["taskId", "实收任务 ID"], ["seed", "实收 seed"], ["model", "实收模型字段"], ["duration", "实收 duration（秒）"], ["aspectRatio", "实收比例"], ["resolution", "实收分辨率"], ["generateAudio", "实收音频标记"]]) if (Object.hasOwn(data, key!)) rows.push([label!, researchFactText(data[key!])]);
  const metadata = researchObject(data.metadata);
  for (const key of Object.keys(metadata)) if (metadata[key] === null || ["string", "number", "boolean"].includes(typeof metadata[key])) rows.push([`metadata.${key}（原值，不作本地验证）`, researchFactText(metadata[key])]);
  return rows;
}
export function videoLastFrameMissing(data: Record<string, unknown>) { return Object.hasOwn(data, "lastFrameMissing") && data.lastFrameMissing === true; }
export function videoTaskFacts(operation: { progress: Record<string, unknown>; inputs: { parameters?: Record<string, unknown> }; results: Array<{ kind: string; data: Record<string, unknown> }> }) {
  const latest = operation.results.findLast(row => row.kind === "video_task");
  const savedId = operation.results.findLast(row => isVideoResult(row.kind, row.data) && typeof row.data.taskId === "string");
  const taskId = typeof operation.progress.taskId === "string" ? operation.progress.taskId : typeof operation.inputs.parameters?.taskId === "string" ? operation.inputs.parameters.taskId : savedId ? savedId.data.taskId as string : null;
  const progress = typeof operation.progress.providerProgress === "number" ? operation.progress.providerProgress : latest?.data.progress;
  return { taskId, latest, progress: typeof progress === "number" && Number.isFinite(progress) && progress >= 0 && progress <= 100 ? progress : null };
}
export function videoReferenceAssets(selected: readonly PrivateAsset[], updates: readonly PrivateAsset[]) { return selected.map(asset => updates.find(update => update.key === asset.key) ?? asset); }
