import { safeExternalUrl } from "./platform-types.ts";

/** UI classification; the import command rechecks the saved upstream response. */
export function xiaohongshuNativeNote(value: unknown): { url: string; id: string } | null {
  const address = safeExternalUrl(value);
  if (!address || typeof value !== "string" || value.includes("#") || !/^https?:\/\/(?:www\.)?xiaohongshu\.com\//i.test(value)) return null;
  const url = new URL(address);
  if (url.port || url.hash || url.hostname.replace(/^www\./, "") !== "xiaohongshu.com") return null;
  const match = /^\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (url.pathname.startsWith("/discovery/") && url.protocol !== "https:") return null;
  // Preserve signed query strings exactly as received, including their encoding.
  return match ? { url: value, id: match[1]! } : null;
}

export function xiaohongshuRoleLabel(role: unknown): string | null {
  return role === "keyword_match" ? "主查询结果" : role === "provider_recommendation" ? "上游推荐候选" : role === "native_note" ? "原生笔记" : null;
}

export function xiaohongshuImportFields(kind: string, data: Record<string, unknown>, additionalUrl = "") {
  const identity = data.identity && typeof data.identity === "object" && !Array.isArray(data.identity) ? data.identity as Record<string, unknown> : {};
  const userId = typeof identity.userId === "string" && identity.userId ? identity.userId : null;
  const receivedUrl = typeof data.url === "string" && data.url ? data.url : null;
  const workId = typeof data.workId === "string" && data.workId ? data.workId : null;
  const account = kind === "xiaohongshu_account", work = kind === "xiaohongshu_work";
  const agentKey = data.provider === "agentkey", recommendation = agentKey && data.role === "provider_recommendation";
  const native = xiaohongshuNativeNote(receivedUrl ?? additionalUrl);
  const receivedNative = xiaohongshuNativeNote(receivedUrl);
  const blockedReason = work && receivedUrl && !receivedNative ? "已收到的地址不是受支持的小红书原生笔记链接，不能直接替换。请显式查询详情或核实解析结果后再导入；短链、主页和占位地址不会自动解析。"
    : work && receivedNative && workId && receivedNative.id !== workId ? "已收到作品 ID 与原生链接中的 ID 不一致，不能导入或替换；请显式查询详情核实。"
    : agentKey && recommendation ? "上游推荐仅供研究，不作为文章导入或绑定账号。"
    : agentKey && work && (!userId || !workId || !receivedNative) ? "AgentKey 导入必须有实收稳定作者、笔记 ID 和匹配的原生链接，不能用手工输入代替响应证据；可另行显式查询统一笔记详情。" : null;
  return { account, work, agentKey, recommendation, userId, receivedUrl, workId, native, receivedNative, blockedReason, needsUrl: work && !receivedUrl && !agentKey, needsIdentity: work && !userId && !agentKey, canImport: !recommendation && (account ? !!userId : work && !blockedReason) };
}
