import { safeExternalUrl } from "./platform-types.ts";

/** Presentation classification only; imports recheck the saved upstream response. */
export function tiktokNativeVideo(value: unknown): { url: string; id: string } | null {
  const address = safeExternalUrl(value);
  if (!address || typeof value !== "string" || value.includes("#")) return null;
  const url = new URL(address);
  if (url.port || url.hash || url.hostname.replace(/^www\./, "") !== "tiktok.com") return null;
  const match = /^\/@[A-Za-z0-9_.-]+\/video\/([0-9]+)\/?$/.exec(url.pathname);
  return match ? { url: value, id: match[1]! } : null;
}

export function tiktokImportFields(kind: string, data: Record<string, unknown>, additionalUrl = "") {
  const identity = data.identity && typeof data.identity === "object" && !Array.isArray(data.identity) ? data.identity as Record<string, unknown> : {};
  const userId = typeof identity.userId === "string" && identity.userId ? identity.userId : null;
  const secUserId = typeof identity.secUserId === "string" && identity.secUserId ? identity.secUserId : null;
  const receivedUrl = typeof data.url === "string" && data.url ? data.url : null;
  const workId = typeof data.workId === "string" && data.workId ? data.workId : null;
  const account = kind === "tiktok_account", work = kind === "tiktok_work";
  const native = tiktokNativeVideo(receivedUrl ?? additionalUrl);
  const receivedNative = tiktokNativeVideo(receivedUrl);
  const blockedReason = work && receivedUrl && !receivedNative ? "已收到的地址不是受支持的 TikTok 原生 video 作品链接，不能直接替换。请显式查询作品详情核实；短链、photo 地址、主页和占位地址不会自动解析。"
    : work && receivedNative && workId && receivedNative.id !== workId ? "已收到作品 ID 与原生链接中的 ID 不一致，不能导入或替换；请显式查询详情核实。" : null;
  const hasIdentity = !!userId || !!secUserId;
  return { account, work, userId, secUserId, hasIdentity, receivedUrl, workId, native, receivedNative, blockedReason, needsUrl: work && !receivedUrl, canImport: account ? hasIdentity : work && !blockedReason };
}

type Supplement = { url?: string; evidence: string };
export function tiktokImportSupplement(fields: ReturnType<typeof tiktokImportFields>, draft: { url: string; evidence: string }): { error: string; supplement?: never } | { error?: undefined; supplement?: Supplement } {
  if (!fields.canImport) return { error: fields.blockedReason ?? "此结果暂不能导入，请显式查询并核实" };
  if (!fields.needsUrl) return {};
  if (fields.needsUrl) {
    const native = tiktokNativeVideo(draft.url.trim());
    if (!native) return { error: "请填写无凭证、端口或片段的 tiktok.com/@handle/video/数字ID 原文链接" };
    if (fields.workId && fields.workId !== native.id) return { error: "补充链接中的作品 ID 必须与已收到的作品 ID 完全一致" };
  }
  const evidence = draft.evidence.trim();
  if (!evidence || evidence.length > 1000) return { error: "请填写缺失字段的核实依据（最多 1000 字）" };
  return { supplement: { ...(fields.needsUrl ? { url: draft.url.trim() } : {}), evidence } };
}

/** The upstream field is seconds; do not interpret it as browser-local wall time. */
export function tiktokPublicationTime(value: unknown): string | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^-?\d+$/.test(value))) return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
