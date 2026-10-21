import { safeExternalUrl, type PlatformOperation } from "./platform-types.ts";
import { researchFactText, researchObject } from "./research-platform-data.ts";
import type { MediaToolGroup, MediaToolLink, MediaToolSpec } from "./media-tool-types.ts";

const mediaIds = ["9Q2PQBKU", "AWUTFI4V", "D52IUEIM", "7UW1PT1F", "MQMDU19Q", "QPNFJRG1", "U2NJ13MW", "0W27H3O6", "0ZIWOO8P", "CWX77QIH", "UUSP1G1P"];
export const mediaToolGroupLabels: Record<MediaToolGroup, string> = { media: "媒体地址与元数据", subtitle: "字幕轨道元数据", "text-check": "文本检查" };
export function mediaToolSpec(operationId: unknown): MediaToolSpec | null {
  if (typeof operationId !== "string") return null;
  const group = mediaIds.includes(operationId) ? "media" : ["API_1792053861083", "API_1792051516512"].includes(operationId) ? "subtitle" : operationId === "API_1791881343238" ? "text-check" : null;
  return group ? { group, purpose: group === "subtitle" ? "transcript" : group === "text-check" ? "query" : "media", estimatedCny: operationId === "9Q2PQBKU" ? 0.12 : 0.06, inputName: group === "text-check" ? "content" : "url" } : null;
}
export function mediaToolChoices(operations: readonly PlatformOperation[]): PlatformOperation[] {
  return operations.filter(operation => operation.platform === "tools" && mediaToolSpec(operation.id));
}
export function mediaToolCommand(operation: PlatformOperation, value: string) {
  const spec = mediaToolSpec(operation.id), field = operation.fields[0];
  if (operation.platform !== "tools" || !spec || operation.fields.length !== 1 || field?.type !== "string" || field.name !== spec.inputName) throw new Error("此工具参数尚不可用，请刷新目录");
  if (!value.trim()) throw new Error(spec.inputName === "content" ? "请输入待检查文本" : "请输入链接或完整分享文案");
  if (field.constraints?.maxLength !== undefined && value.length > field.constraints.maxLength) throw new Error(`最多 ${field.constraints.maxLength} 字符`);
  return { operationId: operation.id, parameters: { [spec.inputName]: value } };
}
export function isMediaToolResult(kind: string, data: Record<string, unknown>): boolean {
  const spec = mediaToolSpec(data.operationId);
  if (!spec || data.platform !== "tools" || data.group !== spec.group) return false;
  return spec.group === "text-check" ? kind === "text_check" : kind === "query_summary" || kind === (spec.group === "subtitle" ? "subtitle_track" : "media_resource");
}
export function mediaToolResourceRows(data: Record<string, unknown>): Array<[string, string]> {
  const record = researchObject(data.record);
  return [...(Object.hasOwn(data, "reportedType") ? [["实际资源类型（reportedType）", researchFactText(data.reportedType)]] as Array<[string, string]> : []), ...(Object.hasOwn(data, "durationSeconds") ? [["时长 durationSeconds（秒）", data.durationSeconds === null ? "未知（上游 null，不是 0 秒）" : researchFactText(data.durationSeconds)]] as Array<[string, string]> : []), ...(Object.hasOwn(record, "audioExt") ? [["音频格式 audioExt（实收）", researchFactText(record.audioExt)]] as Array<[string, string]> : [])];
}
export function mediaToolLink(label: string, reportedValue: unknown, resourceValue = reportedValue): MediaToolLink {
  return { label, reportedValue, resourceValue, url: safeExternalUrl(resourceValue) };
}
export function mediaToolResourceLinks(data: Record<string, unknown>): MediaToolLink[] {
  const record = researchObject(data.record);
  return [mediaToolLink("资源地址 downloadUrl（仅媒体）", record.downloadUrl, Object.hasOwn(data, "resourceUrl") ? data.resourceUrl : null), ...["coverUrl", "cover"].flatMap(key => Object.hasOwn(record, key) ? [mediaToolLink(`封面 ${key}（仅链接）`, record[key])] : [])];
}
export function mediaToolFormats(data: Record<string, unknown>) {
  return Array.isArray(data.formats) ? data.formats.map(value => {
    const format = researchObject(value);
    return { format: researchFactText(format.format), link: mediaToolLink("字幕资源地址（未读取文件）", format.reportedUrl, Object.hasOwn(format, "resourceUrl") ? format.resourceUrl : null) };
  }) : [];
}
export function mediaToolMetadataRows(data: Record<string, unknown>): Array<[string, string]> {
  const metadata = researchObject(data.reportedMetadata), rows: Array<[string, string]> = [];
  for (const key of ["title", "id", "site", "platform", "awemeType", "audioExt"]) if (Object.hasOwn(metadata, key)) rows.push([`上游 ${key}`, researchFactText(metadata[key])]);
  if (Object.hasOwn(metadata, "duration")) rows.push([`原始 duration（${data.group === "subtitle" ? "秒" : "单位未说明"}）`, metadata.duration === null ? "未知（上游 null）" : researchFactText(metadata.duration)]);
  if (Object.hasOwn(metadata, "createdAt")) rows.push([data.group === "subtitle" ? "原始 createdAt（保留原串；文档为 UTC）" : "原始 createdAt（单位 / 时区未说明）", researchFactText(metadata.createdAt)]);
  if (Object.hasOwn(metadata, "imageUrls")) rows.push(["上游 imageUrls（原值，未在前端解析或修复）", Array.isArray(metadata.imageUrls) ? JSON.stringify(metadata.imageUrls) : researchFactText(metadata.imageUrls)]);
  return rows;
}
export function mediaToolMetadataBodies(data: Record<string, unknown>): Array<[string, string]> {
  const metadata = researchObject(data.reportedMetadata);
  return ["desc", "description"].flatMap(key => Object.hasOwn(metadata, key) ? [[key, researchFactText(metadata[key])]] as Array<[string, string]> : []);
}
export function mediaToolMetadataLinks(data: Record<string, unknown>): MediaToolLink[] {
  const metadata = researchObject(data.reportedMetadata);
  return ["cover", "videoUrl", "audioUrl", "thumbnailUrl"].flatMap(key => Object.hasOwn(metadata, key) ? [mediaToolLink(`上游 ${key}（媒体 / 封面，不是作品原文）`, metadata[key])] : []);
}
/** Only the server-generated sanitized field may enter an HTML container. Raw record.content is never selected. */
export function mediaToolTextView(data: Record<string, unknown>) {
  return { original: typeof data.originalContent === "string" ? data.originalContent : null, highlightHtml: typeof data.sanitizedHighlightHtml === "string" && data.sanitizedHighlightHtml.length ? data.sanitizedHighlightHtml : null, types: Array.isArray(data.prohibitedWordsType) ? data.prohibitedWordsType.filter((value): value is string => typeof value === "string") : [] };
}
