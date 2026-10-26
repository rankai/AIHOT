export interface VideoDownloadLatest { lastRunId: number; status: string; saved: number; notSaved: number; reason: string | null }
export interface VideoDownloadInput {
  collector: string; resolver: { provider: string; operationId: string; budget: string } | null; resolverUsed: boolean;
  parentRunId: number; parentResultId: number; articleId: string; originalUrl: string; retentionDays: number; maxBytes: number;
  normalParserAttempts: number; maxParserAttempts: number; mediaRole: "own" | "quoted"; workId: string;
}
export function nativeVideoConfig(json: string): Record<string, unknown> | null {
  try { const value: unknown = JSON.parse(json); return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
}
export function nativeVideoConfigChange(json: string, enabled: boolean): string | null {
  const config = nativeVideoConfig(json);
  return config ? JSON.stringify({ ...config, autoDownloadVideo: enabled }, null, 2) : null;
}
export function videoDownloadRunIds(result: { videoDownloadRunIds?: number[] | null; videoDownloadRunId?: number | null }): number[] {
  const ids = result.videoDownloadRunIds?.length ? result.videoDownloadRunIds : [result.videoDownloadRunId];
  return [...new Set(ids.filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0))];
}
const reasons: Record<string, string> = {
  saved: "已私有保存", reused: "复用已保存文件", too_large: "原视频过大，未保存", unavailable: "视频地址不可用或传输未完成",
  download_unavailable: "视频传输不可用", unsupported_format: "文件格式不受支持或未通过校验", transfer_retry_exhausted: "文件传输重试次数已用完",
  no_video_address: "未取得可用的视频文件地址", no_new_video_address: "解析未提供新的可用视频地址", media_identity_insufficient: "视频归属或版本关系证据不足",
  expired: "已保存文件已过期，不自动重新保存", deleted: "已保存文件已删除或正在删除，不自动重新保存", missing_file: "本地文件缺失，需要核对",
};
export function videoDownloadReason(value: unknown): string { return typeof value === "string" ? reasons[value] ?? value : "—"; }
export function lowerBitrateSaved(data: Record<string, unknown>): boolean {
  const selected = data.selectedCandidate as { bitrate?: unknown; quality?: unknown } | null;
  return typeof selected?.bitrate === "number" && selected.quality === "bitrate" && Array.isArray(data.attempts) && data.attempts.some(attempt => typeof attempt?.bitrate === "number" && attempt.bitrate > Number(selected.bitrate));
}
