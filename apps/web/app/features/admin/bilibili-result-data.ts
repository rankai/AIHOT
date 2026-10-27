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
  const agentkey = data.provider === "agentkey";
  const eligible = account ? data.operationId === "EH53TOT7" && !!mid : work && data.operationId === "TIN1NMTZ" && data.role !== "provider_recommendation" && !!workId && receivedNative?.id === workId;
  const blockedReason = agentkey && !eligible ? "此结果仅供研究；需显式查询详情，实际收到BV 与匹配原文后才可导入，不能人工补齐身份或地址。" : work && receivedUrl && !receivedNative ? "已有地址不是受支持的 B站原生 BV 作品链接，不能直接替换。请显式查询作品详情核实；b23 短链、AV 地址和封面不能作为人工补充原文。"
    : work && receivedNative && workId && receivedNative.id !== workId ? "已收到 BV 与原生链接中的 BV 不一致，不能导入或替换；请显式查询详情核实。" : null;
  return { agentkey, account, work, mid, receivedUrl, workId, native, receivedNative, blockedReason, needsUrl: !agentkey && work && !receivedUrl, canImport: agentkey ? eligible && !blockedReason : account ? !!mid : work && !blockedReason };
}

type Supplement = { url?: string; evidence: string };
export function bilibiliImportSupplement(fields: ReturnType<typeof bilibiliImportFields>, draft: { url: string; evidence: string }): { error: string; supplement?: never } | { error?: undefined; supplement?: Supplement } {
  if (!fields.canImport) return { error: fields.blockedReason ?? "此结果暂不能导入，请显式查询并核实" };
  if (!fields.needsUrl) return {};
  if (fields.needsUrl) {
    const native = bilibiliNativeVideo(draft.url.trim());
    if (!native) return { error: "请填写无凭证、端口或片段的 bilibili.com/video/BV号 原文；不接受 b23 短链、AV 地址或封面" };
    if (fields.workId && fields.workId !== native.id) return { error: "补充原文中的 BV 必须与已收到的 BV 完全一致" };
  }
  const evidence = draft.evidence.trim();
  if (!evidence || evidence.length > 1000) return { error: "请填写缺失字段的核实依据（最多 1000 字）" };
  return { supplement: { ...(fields.needsUrl ? { url: draft.url.trim() } : {}), evidence } };
}

/** Only received aliases may seed a separate, explicitly submitted detail query. */
export function bilibiliDetailSeed(data: Record<string, unknown>) {
  if (data.provider !== "agentkey" || data.platform !== "bilibili" || !["LEN9QXR3", "bilibili.typed_search", "VPA67I98"].includes(String(data.operationId))) return null;
  const bv = data.workId, av = data.avId;
  const parameters = typeof bv === "string" && /^BV[A-Za-z0-9]{10}$/.test(bv) ? { bv_id: bv } : typeof av === "string" && /^[0-9]+$/.test(av) ? { av_id: av } : null;
  return parameters ? { platform: "bilibili", provider: "agentkey", operationId: "TIN1NMTZ", parameters } : null;
}
