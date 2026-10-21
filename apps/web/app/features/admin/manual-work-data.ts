import { candidateSelectionValid } from "./candidate-selection.ts";
import { shipinhaoShareUrl } from "./shipinhao-result-data.ts";

export type ManualWorkPlatform = "shipinhao" | "kuaishou";
type Candidate = { id: string; participation_mode: string };
function record(data: Record<string, unknown>): Record<string, unknown> {
  return data.record && typeof data.record === "object" && !Array.isArray(data.record) ? data.record as Record<string, unknown> : {};
}
export function manualWorkPlatform(kind: string, data: Record<string, unknown>): ManualWorkPlatform | null {
  if (kind === "shipinhao_work" && data.platform === "shipinhao" && ["E7G00COY", "OVUTOTCV", "OE4KUEUO", "MH5YA9DL"].includes(String(data.operationId))) return "shipinhao";
  if (kind === "kuaishou_work" && data.platform === "kuaishou" && ["27DQ6SF9", "ZWR31P2A", "UOM99OQI"].includes(String(data.operationId))) return "kuaishou";
  return null;
}
export function manualWorkNativeUrl(platform: ManualWorkPlatform, value: string): string | null {
  if (platform === "shipinhao") return shipinhaoShareUrl(value);
  if (!/^https?:\/\/(?:www\.)?kuaishou\.com\//i.test(value) || value.includes("#")) return null;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.port && !url.hash && /^\/short-video\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? value : null;
  } catch { return null; }
}
export function manualWorkDefaultUrl(data: Record<string, unknown>): string {
  return data.platform === "shipinhao" && data.operationId === "MH5YA9DL" && typeof data.inputUrl === "string" && shipinhaoShareUrl(data.inputUrl) ? data.inputUrl : "";
}
export function manualWorkCandidates<T extends Candidate>(rows: readonly T[] | null | undefined): T[] {
  return rows?.filter(source => source.participation_mode === "isolated") ?? [];
}
export function manualWorkImportRequest(kind: string, data: Record<string, unknown>, draft: { sourceId: string; url: string; evidence: string; reason: string }, state: string, rows: readonly Candidate[] | null | undefined) {
  const platform = manualWorkPlatform(kind, data);
  if (!platform) return { error: "只有本平台作品结果可以逐项人工导入，账号结果不能绑定" } as const;
  if (!candidateSelectionValid(draft.sourceId, state, "external", "external", manualWorkCandidates(rows))) return { error: "请等待搜索完成，并从当前候选页选择已核实的隔离 external 信源" } as const;
  const url = draft.url.trim(), evidence = draft.evidence.trim(), reason = draft.reason.trim();
  if (!manualWorkNativeUrl(platform, url)) return { error: platform === "shipinhao" ? "请填写 weixin.qq.com/sph/ 原生分享链接，不接受短链、主页、媒体、凭证、端口或片段" : "请填写 kuaishou.com/short-video/ 原生作品链接，不接受短链、主页、媒体、凭证、端口或片段" } as const;
  if (!evidence || evidence.length > 1000) return { error: "请记录此项作品原文与所选作者信源关系的核实依据（最多 1000 字）" } as const;
  if (!reason || reason.length > 500) return { error: "请填写操作原因（最多 500 字）" } as const;
  return { body: { sourceId: draft.sourceId, reason, supplement: { url, evidence } } };
}
export function manualWorkDetailRequest(resultId: number, kind: string, data: Record<string, unknown>) {
  if (!Number.isSafeInteger(resultId) || resultId <= 0) return null;
  const platform = manualWorkPlatform(kind, data), raw = record(data);
  if (platform === "shipinhao" && ["E7G00COY", "OVUTOTCV"].includes(String(data.operationId)) && typeof raw.videoId === "string" && raw.videoId) return { operationId: "OE4KUEUO", parameters: { videoId: raw.videoId }, sourceResultId: resultId };
  if (platform === "kuaishou" && ["27DQ6SF9", "ZWR31P2A"].includes(String(data.operationId)) && typeof raw.photoId === "string" && raw.photoId) return { operationId: "UOM99OQI", parameters: { photoId: raw.photoId }, sourceResultId: resultId };
  return null;
}
