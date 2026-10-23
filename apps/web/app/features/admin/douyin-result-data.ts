import { safeExternalUrl } from "./platform-types.ts";
/** UI classification only; the import command remains the authority for native identity. */
export function douyinNativeVideo(value: unknown): { url: string; id: string } | null {
  const address = safeExternalUrl(value);
  if (!address || typeof value !== "string" || value.includes("#")) return null;
  const url = new URL(address);
  if (url.port || url.hash) return null;
  const host = url.hostname.replace(/^www\./, "");
  const match = host === "douyin.com" ? /^\/video\/([0-9]+)\/?$/.exec(url.pathname)
    : host === "iesdouyin.com" ? /^\/share\/video\/([0-9]+)\/?$/.exec(url.pathname) : null;
  return match ? { url: url.href, id: match[1]! } : null;
}
export function douyinImportFields(kind: string, data: Record<string, unknown>, additionalUrl = "") {
  const identity = data.identity && typeof data.identity === "object" && !Array.isArray(data.identity) ? data.identity as Record<string, unknown> : {};
  const uid = typeof identity.uid === "string" && identity.uid ? identity.uid : null;
  const secUserId = typeof identity.secUserId === "string" && identity.secUserId ? identity.secUserId : null;
  const receivedUrl = typeof data.url === "string" && data.url ? data.url : null;
  const workId = typeof data.workId === "string" && data.workId ? data.workId : null;
  const account = kind === "douyin_account", work = kind === "douyin_work";
  const native = douyinNativeVideo(receivedUrl ?? additionalUrl);
  const receivedNative = douyinNativeVideo(receivedUrl);
  const hasIdentity = !!uid || !!secUserId;
  const blockedReason = work && data.provider === "agentkey" && (!hasIdentity || !workId) ? "AgentKey 结果缺少稳定作者 ID 或作品 ID，暂不能导入；必须由上游结果提供可靠身份，不能人工补齐。"
    : work && receivedUrl && !receivedNative ? "已收到的地址不是受支持的抖音原生作品链接，不能直接替换。请显式查询作品详情或解析结果后再导入；短链、主页和占位地址不会自动解析。"
    : work && receivedNative && workId && receivedNative.id !== workId ? "已收到作品 ID 与原生链接中的 ID 不一致，不能导入或替换；请显式查询详情核实。" : null;
  return { account, work, uid, secUserId, hasIdentity, receivedUrl, workId, native, receivedNative, blockedReason, needsUrl: work && !receivedUrl, needsIdentity: work && !hasIdentity, canImport: account ? hasIdentity : work && !blockedReason };
}
