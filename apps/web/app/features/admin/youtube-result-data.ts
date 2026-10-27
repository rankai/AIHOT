import { platformParameters, safeExternalUrl, type PlatformOperation } from "./platform-types.ts";

export function youtubeNativeVideo(value: unknown): { url: string; id: string } | null {
  const address = safeExternalUrl(value);
  if (!address || typeof value !== "string" || value.includes("#") || !/^https?:\/\/(?:www\.)?youtube\.com\//i.test(value.trim())) return null;
  const url = new URL(address);
  if (url.port || url.hash || url.hostname.replace(/^www\./, "") !== "youtube.com" || url.pathname !== "/watch" || url.searchParams.getAll("v").length !== 1) return null;
  const id = url.searchParams.get("v")!;
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? { url: value, id } : null;
}

/** Keep the opaque continuation token byte-for-byte; other fields retain existing form semantics. */
export function youtubeQueryParameters(operation: PlatformOperation, values: Record<string, string>): Record<string, string | number | boolean> {
  const parameters = platformParameters(operation, values);
  if (operation.id === "GC5SC5HS") parameters.continuationToken = values.continuationToken ?? "";
  if (operation.id === "609DF2IR" && !/^[A-Za-z0-9_-]{11}$/.test(String(parameters.videoId ?? ""))) throw new Error("视频 ID 须为 11 位字母、数字、下划线或短横线");
  return parameters;
}

/** Explicit paid detail lookup: only the saved result PK and received video ID cross the boundary. */
export function youtubeDetailRequest(resultId: number, kind: string, data: Record<string, unknown>) {
  if (!Number.isSafeInteger(resultId) || resultId <= 0 || kind !== "youtube_work" || data.platform !== "youtube" || data.operationId !== "GC5SC5HS" || typeof data.workId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(data.workId)) return null;
  return { operationId: "609DF2IR", parameters: { videoId: data.workId }, sourceResultId: resultId };
}

export function youtubeImportFields(kind: string, data: Record<string, unknown>, additionalUrl = "") {
  const identity = data.identity && typeof data.identity === "object" && !Array.isArray(data.identity) ? data.identity as Record<string, unknown> : {};
  const channelId = typeof identity.channelId === "string" && /^[A-Za-z0-9_-]+$/.test(identity.channelId) ? identity.channelId : null;
  const receivedUrl = typeof data.url === "string" && data.url ? data.url : null;
  const workId = typeof data.workId === "string" && data.workId ? data.workId : null;
  const work = kind === "youtube_work";
  const native = youtubeNativeVideo(receivedUrl ?? additionalUrl);
  const receivedNative = youtubeNativeVideo(receivedUrl);
  const blockedReason = work && receivedUrl && !receivedNative ? "已收到的地址不是受支持的 YouTube 原生 watch 原文，不能直接替换。请显式查询同视频详情核实；不解析 youtu.be、Shorts 或图片地址。"
    : work && receivedNative && workId && receivedNative.id !== workId ? "已收到视频 ID 与原文中的 v 不一致，不能导入或替换；请显式查询详情核实。" : null;
  return { work, channelId, workId, receivedUrl, receivedNative, native, blockedReason, canImport: work && !blockedReason, needsUrl: work && !receivedUrl};
}

type Supplement = { url?: string; evidence: string };
export function youtubeImportSupplement(fields: ReturnType<typeof youtubeImportFields>, draft: { url: string; evidence: string }): { error: string; supplement?: never } | { error?: undefined; supplement?: Supplement } {
  if (!fields.canImport) return { error: fields.blockedReason ?? "此结果不能导入作品" };
  if (!fields.needsUrl) return {};
  if (fields.needsUrl) {
    const native = youtubeNativeVideo(draft.url.trim());
    if (!native) return { error: "请填写仅含一个有效 v 的 youtube.com/watch 原文；不接受短链、shorts、图片、凭证、端口或片段" };
    if (fields.workId && fields.workId !== native.id) return { error: "补充原文中的视频 ID 必须与已收到的视频 ID 一致" };
  }
  const evidence = draft.evidence.trim();
  if (!evidence || evidence.length > 1000) return { error: "请填写缺失字段的核实依据（最多 1000 字）" };
  return { supplement: { ...(fields.needsUrl ? { url: draft.url.trim() } : {}), evidence } };
}
