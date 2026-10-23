import { platformParameters, safeExternalUrl, type PlatformOperation } from "./platform-types.ts";

export function instagramNativePost(value: unknown): { url: string; id: string } | null {
  const address = safeExternalUrl(value);
  if (!address || typeof value !== "string" || value.includes("#") || !/^https?:\/\/(?:www\.)?instagram\.com\//i.test(value.trim())) return null;
  const url = new URL(address);
  if (url.port || url.hash || url.hostname.replace(/^www\./, "") !== "instagram.com") return null;
  const match = /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  return match ? { url: value, id: match[1]! } : null;
}

export function instagramQueryParameters(operation: PlatformOperation, values: Record<string, string>): Record<string, string | number | boolean> {
  const parameters = platformParameters(operation, values);
  if (operation.id === "GM0TISWI") parameters.paginationToken = values.paginationToken ?? "";
  if (operation.id === "3YJT69FL") {
    if (!parameters.username && !parameters.userId) throw new Error("用户名与用户 ID 至少填写一个；同时填写时上游优先用户 ID");
    if (parameters.userId !== undefined && !/^[0-9]+$/.test(String(parameters.userId))) throw new Error("用户 ID 须为完整数字字符串");
  }
  if (operation.id === "Z9M88QI8" && !/^[A-Za-z0-9_-]+$/.test(String(parameters.codeOrUrl ?? "")) && !instagramNativePost(parameters.codeOrUrl)) throw new Error("请填写帖子短码或 Instagram /p/、/reel/ 原文链接");
  return parameters;
}

export function instagramDetailRequest(resultId: number, kind: string, data: Record<string, unknown>) {
  if (!Number.isSafeInteger(resultId) || resultId <= 0 || kind !== "instagram_work" || data.platform !== "instagram" || data.operationId !== "GM0TISWI" || typeof data.workId !== "string" || !/^[A-Za-z0-9_-]+$/.test(data.workId)) return null;
  return { operationId: "Z9M88QI8", parameters: { codeOrUrl: data.workId }, sourceResultId: resultId };
}

export function instagramImportFields(kind: string, data: Record<string, unknown>, additionalUrl = "") {
  const identity = data.identity && typeof data.identity === "object" && !Array.isArray(data.identity) ? data.identity as Record<string, unknown> : {};
  const userId = typeof identity.userId === "string" && /^[0-9]+$/.test(identity.userId) ? identity.userId : null;
  const receivedUrl = typeof data.url === "string" && data.url ? data.url : null;
  const workId = typeof data.workId === "string" && data.workId ? data.workId : null;
  const account = kind === "instagram_account", work = kind === "instagram_work";
  const native = instagramNativePost(receivedUrl ?? additionalUrl);
  const receivedNative = instagramNativePost(receivedUrl);
  const blockedReason = work && receivedUrl && !receivedNative ? "已收到的地址不是受支持的 Instagram 帖子原文，不能直接替换。请显式查询帖子详情核实；只接受 /p/ 或 /reel/ 原文，不解析短链、主页、Stories 或媒体地址。"
    : work && receivedNative && workId && receivedNative.id !== workId ? "已收到帖子短码与原文中的短码不一致，不能导入或替换；请显式查询详情核实。" : null;
  return { account, work, userId, workId, receivedUrl, receivedNative, native, blockedReason, canImport: account ? !!userId : work && !blockedReason, needsUrl: work && !receivedUrl, needsIdentity: work && !userId };
}

type Supplement = { userId?: string; url?: string; evidence: string };
export function instagramImportSupplement(fields: ReturnType<typeof instagramImportFields>, draft: { userId: string; url: string; evidence: string }): { error: string; supplement?: never } | { error?: undefined; supplement?: Supplement } {
  if (!fields.canImport) return { error: fields.blockedReason ?? "此结果暂不能导入，请显式查询并核实稳定身份" };
  if (!fields.needsUrl && !fields.needsIdentity) return {};
  if (fields.needsUrl) {
    const native = instagramNativePost(draft.url.trim());
    if (!native) return { error: "请填写 Instagram /p/ 或 /reel/ 原生原文，不接受短链、主页、Stories、媒体、凭证、端口或片段" };
    if (fields.workId && fields.workId !== native.id) return { error: "补充原文中的帖子短码必须与已收到的短码一致" };
  }
  const userId = draft.userId.trim(), evidence = draft.evidence.trim();
  if (fields.needsIdentity && !/^[0-9]+$/.test(userId)) return { error: "请填写已核实作者 userId 的完整数字字符串，不使用用户名或显示名称" };
  if (!evidence || evidence.length > 1000) return { error: "请填写缺失字段的核实依据（最多 1000 字）" };
  return { supplement: { ...(fields.needsUrl ? { url: draft.url.trim() } : {}), ...(fields.needsIdentity ? { userId } : {}), evidence } };
}

/** Only links are displayed; video and carousel fields may coexist. */
export function instagramMediaLinks(record: Record<string, unknown>) {
  return ([["imageUrl", "图片"], ["videoUrl", "视频"], ["thumbnailUrl", "缩略图"], ["profilePicUrl", "账号头像"], ["profilePicUrlHd", "高清头像"]] as const).flatMap(([field, label]) => {
    const url = safeExternalUrl(record[field]);
    return url ? [{ field, label, url }] : [];
  });
}
