import { safeExternalUrl } from "./platform-types.ts";
export function wechatArticleLink(value: unknown): string | null {
  const address = safeExternalUrl(value);
  if (!address) return null;
  const url = new URL(address);
  return url.hostname === "mp.weixin.qq.com" && !url.port ? address : null;
}
export function wechatUrlIdentity(value: unknown): boolean {
  const address = wechatArticleLink(value);
  if (!address) return false;
  const url = new URL(address), biz = url.searchParams.get("__biz");
  return url.pathname === "/s" && !!biz && !/\s/.test(biz) && /^\d+$/.test(url.searchParams.get("mid") ?? "") && /^\d+$/.test(url.searchParams.get("idx") ?? "");
}
export function wechatImportFields(kind: string, data: Record<string, unknown>, additionalUrl = "") {
  const identity = data.identity && typeof data.identity === "object" && !Array.isArray(data.identity) ? data.identity as Record<string, unknown> : {};
  const wxId = typeof identity.wxId === "string" && identity.wxId ? identity.wxId : null;
  const bizInfo = typeof identity.bizInfo === "string" && identity.bizInfo ? identity.bizInfo : null;
  const account = kind === "wechat_account" || kind === "wechat_account_rank";
  const original = wechatArticleLink(data.url);
  const hasIdentity = !!wxId || !!bizInfo;
  const urlIdentity = !account && wechatUrlIdentity(original ?? additionalUrl);
  return { account, wxId, bizInfo, original, hasIdentity, urlIdentity, canImport: account ? hasIdentity : kind === "wechat_work", needsUrl: !account && !original, needsIdentity: !account && !hasIdentity && !urlIdentity };
}
