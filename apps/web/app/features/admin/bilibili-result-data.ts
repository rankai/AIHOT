import { safeExternalUrl } from "./platform-types.ts";

/** Classify the documented BV permalink; import rechecks the retained response. */
export function bilibiliNativeVideo(value: unknown): { url: string; id: string } | null {
  const address = safeExternalUrl(value);
  if (!address || typeof value !== "string" || value.includes("#") || !/^https?:\/\/(?:www\.)?bilibili\.com\//i.test(value.trim())) return null;
  const url = new URL(address);
  if (url.port || url.hash || url.hostname.replace(/^www\./, "") !== "bilibili.com") return null;
  const match = /^\/video\/(BV[A-Za-z0-9]{10})\/?$/.exec(url.pathname);
  return match ? { url: value, id: match[1]! } : null;
}

export function bilibiliImportFields(kind: string, data: Record<string, unknown>, additionalUrl = "") {
  const identity = data.identity && typeof data.identity === "object" && !Array.isArray(data.identity) ? data.identity as Record<string, unknown> : {};
  const mid = typeof identity.mid === "string" && /^[0-9]+$/.test(identity.mid) ? identity.mid : null;
  const receivedUrl = typeof data.url === "string" && data.url ? data.url : null;
  const workId = typeof data.workId === "string" && data.workId ? data.workId : null;
  const account = kind === "bilibili_account", work = kind === "bilibili_work";
  const native = bilibiliNativeVideo(receivedUrl ?? additionalUrl);
  const receivedNative = bilibiliNativeVideo(receivedUrl);
  const blockedReason = work && receivedUrl && !receivedNative ? "已有地址不是受支持的 B站原生 BV 作品链接，不能直接替换。请显式查询作品详情核实；b23 短链、AV 地址和封面不能作为人工补充原文。"
    : work && receivedNative && workId && receivedNative.id !== workId ? "已收到 BV 与原生链接中的 BV 不一致，不能导入或替换；请显式查询详情核实。" : null;
  return { account, work, mid, receivedUrl, workId, native, receivedNative, blockedReason, needsUrl: work && !receivedUrl, needsIdentity: work && !mid, canImport: account ? !!mid : work && !blockedReason };
}

type Supplement = { mid?: string; url?: string; evidence: string };
export function bilibiliImportSupplement(fields: ReturnType<typeof bilibiliImportFields>, draft: { mid: string; url: string; evidence: string }): { error: string; supplement?: never } | { error?: undefined; supplement?: Supplement } {
  if (!fields.canImport) return { error: fields.blockedReason ?? "此结果暂不能导入，请显式查询并核实" };
  if (!fields.needsUrl && !fields.needsIdentity) return {};
  if (fields.needsUrl) {
    const native = bilibiliNativeVideo(draft.url.trim());
    if (!native) return { error: "请填写无凭证、端口或片段的 bilibili.com/video/BV号 原文；不接受 b23 短链、AV 地址或封面" };
    if (fields.workId && fields.workId !== native.id) return { error: "补充原文中的 BV 必须与已收到的 BV 完全一致" };
  }
  const mid = draft.mid.trim(), evidence = draft.evidence.trim();
  if (fields.needsIdentity && !/^[0-9]+$/.test(mid)) return { error: "请填写已核实作者 MID 的完整数字字符串" };
  if (!evidence || evidence.length > 1000) return { error: "请填写缺失字段的核实依据（最多 1000 字）" };
  return { supplement: { ...(fields.needsIdentity ? { mid } : {}), ...(fields.needsUrl ? { url: draft.url.trim() } : {}), evidence } };
}
