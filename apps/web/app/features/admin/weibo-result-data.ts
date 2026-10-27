import { researchFactText, researchObject } from "./research-platform-data.ts";

const workTools: Record<string, string> = {
  TXQPVGJG: "TikHub/fetch_search_all_api_v1_weibo_app_fetch_search_all_get",
  "weibo.account_posts": "TikHub/fetch_user_timeline_api_v1_weibo_app_fetch_user_timeline_get",
  API_1789098514899: "TikHub/fetch_status_detail_api_v1_weibo_app_fetch_status_detail_get",
};
const numericId = (value: unknown): value is string => typeof value === "string" && /^\d{1,100}$/.test(value);
/** Display eligibility only; original response and receipt validation remain backend authority. */
export function weiboImportFields(kind: string, data: Record<string, unknown>) {
  const account = kind === "weibo_account", work = kind === "weibo_work", agentkey = data.provider === "agentkey";
  const receivedUid = typeof data.uid === "string" && data.uid ? data.uid : null;
  const receivedUrl = typeof data.opusUrl === "string" && data.opusUrl ? data.opusUrl : typeof data.url === "string" && data.url ? data.url : null;
  const exactWork = typeof data.operationId === "string" && !!workTools[data.operationId] && data.tool === workTools[data.operationId];
  const exactAccount = data.operationId === "API_1789098515117" && data.tool === "TikHub/fetch_user_info_api_v1_weibo_app_fetch_user_info_get";
  let canonical = false;
  if (receivedUrl && numericId(data.opusId)) {
    try { const url = new URL(receivedUrl), parts = url.pathname.split("/").filter(Boolean); canonical = ["http:", "https:"].includes(url.protocol) && ["weibo.com", "www.weibo.com"].includes(url.hostname) && !url.username && !url.password && !url.port && !url.hash && parts.length === 2 && /^\d+$/.test(parts[0]!) && (!receivedUid || parts[0] === receivedUid) && [data.opusId, data.mblogid].includes(parts[1]); } catch { /* Unsupported original. */ }
  }
  const canImport = agentkey ? data.platform === "weibo" && (account ? exactAccount && numericId(receivedUid) : work && exactWork && data.role === "status" && canonical) : account ? !!receivedUid : work && !!data.opusId;
  return { account, work, agentkey, receivedUid, receivedUrl, missingUrl: work && !receivedUrl, canImport, allowSupplement: !agentkey };
}
export function weiboReceivedRows(data: Record<string, unknown>): Array<[string, string]> {
  const record = researchObject(data.record);
  const fields = [["nickname", "账号名称"], ["screen_name", "账号显示名称"], ["description", "账号简介"], ["followers_count", "粉丝数"], ["friends_count", "关注数"], ["statuses_count", "微博数"], ["verified", "认证"], ["following", "已关注"], ["reposts_count", "转发数"], ["comments_count", "评论数"], ["attitudes_count", "点赞数"]];
  return fields.flatMap(([key, label]) => Object.hasOwn(record, key!) ? [[`${label} · ${key}`, researchFactText(record[key!])]] as Array<[string, string]> : []);
}
export function weiboTextNote(data: Record<string, unknown>): string {
  if (data.textScope === "received-excerpt" || data.isLongText === true) return "实收长微博片段；完整正文未证实，入库正文保持待补。";
  return data.isLongText === false ? "实收文本；非长微博标记已返回，正文是否完整由后端复核。" : "实收文本；未证实完整正文，入库正文保持待补。";
}

/** Received list identity only; navigation never submits a query. */
export function weiboDetailSeed(data: Record<string, unknown>) {
  if (data.provider !== "agentkey" || data.platform !== "weibo" || !["TXQPVGJG", "weibo.account_posts"].includes(String(data.operationId)) || data.tool !== workTools[String(data.operationId)] || data.role !== "status" || !numericId(data.opusId)) return null;
  return { platform: "weibo", provider: "agentkey", operationId: "API_1789098514899", parameters: { status_id: data.opusId } };
}
