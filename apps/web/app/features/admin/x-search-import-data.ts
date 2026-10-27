import type { OperationResult } from "./operation-types.ts";
import { researchObject } from "./research-platform-data.ts";

export function isXSearchWork(kind: string, data: Record<string, unknown>) {
  return (data.provider === undefined || data.provider === "redfox") && kind === "x_research_work" && data.platform === "x-research" && data.operationId === "5K5EG87P";
}
export function isXDetailWork(kind: string, data: Record<string, unknown>) {
  return (data.provider === undefined || data.provider === "redfox") && kind === "x_detail_work" && data.platform === "x" && data.operationId === "QCP75W33";
}
const validXId = (value: unknown): value is string => typeof value === "string" && /^\d{1,30}$/.test(value);
const validXHandle = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_]{1,15}$/.test(value);
const validXTime = (value: unknown) => typeof value === "string" && Number.isFinite(new Date(value).getTime()) && /(?:Z|[+-]\d{2}:?\d{2})(?:\s+\d{4})?$/.test(value);
/** Display guard only: the original response and receipt remain the import authority. */
export function isAgentKeyXImportWork(kind: string, data: Record<string, unknown>) {
  return data.provider === "agentkey" && data.platform === "x-research" && (kind === "x_research_work" && ["5K5EG87P", "x.account_posts", "x.list_posts", "x.community_posts"].includes(String(data.operationId)) || kind === "x_detail_work" && data.operationId === "x.detail");
}
function agentKeyXPostIssue(value: unknown): string | null {
  const record = researchObject(value), author = researchObject(record.user_info ?? record.author), context = researchObject(record.authorContext);
  if (record.role !== "post" || record.roleLimitations !== undefined || record.retweeted !== undefined || record.retweeted_tweet !== undefined) return "转发或未核实角色仅供研究";
  const username = author.screen_name ?? (context.source === "received-account-context" && (author.rest_id === undefined || context.rest_id === undefined || context.rest_id === author.rest_id) ? context.screen_name : undefined);
  if (!validXId(record.tweetId) || !validXHandle(username)) return "缺少实收帖子 ID 或合法账号名，不能用请求范围补齐";
  if (record.urlSource !== "derived-canonical-permalink" || record.url !== `https://x.com/${username}/status/${record.tweetId}`) return "原文地址与实收帖子及作者身份不一致";
  if (typeof record.text !== "string" || !record.text.trim()) return "缺少实收文本";
  return null;
}
export function agentKeyXAccountUsername(kind: string, data: Record<string, unknown>): string | null {
  if (kind !== "account" || data.provider !== "agentkey" || data.platform !== "x-research" || data.operationId !== "x.account_profile") return null;
  const record = researchObject(data.record);
  if (record.rest_id != null && record.id != null && record.rest_id !== record.id) return null;
  return validXId(record.rest_id ?? record.id) && validXHandle(record.profile) ? record.profile : null;
}
export function xSearchImportState(result: Pick<OperationResult, "kind" | "data" | "sourceId" | "articleId">) {
  if (result.data.provider === "agentkey") {
    const supported = isAgentKeyXImportWork(result.kind, result.data), linked = !!(result.articleId || result.sourceId), record = researchObject(result.data.record), issues: string[] = [];
    if (supported) {
      const issue = agentKeyXPostIssue(record);
      if (issue) issues.push(issue);
      if (record.quoted !== undefined) {
        const quoteIssue = agentKeyXPostIssue(record.quoted);
        if (quoteIssue || researchObject(record.quoted).quoted !== undefined) issues.push(`引用帖缺少独立且一致的实收身份、原文或文本${quoteIssue ? `：${quoteIssue}` : "；嵌套引用尚未核实"}`);
      }
    }
    return { supported, linked, canImport: supported && !linked && !issues.length, issues, agentkey: true, unknownTime: !validXTime(record.created_at) };
  }
  const detail = isXDetailWork(result.kind, result.data), supported = isXSearchWork(result.kind, result.data) || detail, linked = !!(result.articleId || result.sourceId);
  const record = researchObject(result.data.record), user = researchObject(detail ? record.author : record.user), issues: string[] = [];
  const username = detail && user.username == null ? researchObject(result.data.context).username : user.username;
  const validId = (value: unknown) => typeof value === "string" && /^\d{1,30}$/.test(value);
  if (supported) {
    if (detail && (result.data.workId !== record.tweetId || researchObject(result.data.identity).userId != null && user.userId != null && researchObject(result.data.identity).userId !== user.userId)) issues.push("详情作品或作者身份与实收记录不一致，请核对后台结果");
    if (!validId(record.tweetId)) issues.push("缺少合法的实收 tweetId");
    if (typeof username !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(username)) issues.push(detail ? "缺少合法的实收 username 或后台核实的同作者上下文" : "缺少合法的实收 username");
    const text = record.text ?? record.content;
    if (typeof text !== "string" || !text.trim()) issues.push("缺少实收正文");
    if (typeof record.createdAt !== "string" || !Number.isFinite(new Date(record.createdAt).getTime()) || !/(?:Z|[+-]\d{2}:?\d{2})(?:\s+\d{4})?$/.test(record.createdAt)) issues.push("缺少合法且带明确时区的实收发布时间");
  }
  return { supported, linked, canImport: supported && !linked && issues.length === 0, issues, agentkey: false, unknownTime: false };
}
export function xSearchImportBody(result: Pick<OperationResult, "kind" | "data" | "sourceId" | "articleId">, rawReason: string) {
  const state = xSearchImportState(result), reason = rawReason.trim();
  if (!state.canImport) throw new Error(state.linked ? "此作品已有真实关联，请查看文章与作者信源。" : state.issues.join("；") || "此结果不支持本地导入。");
  if (!reason || reason.length > 500) throw new Error("请填写 1–500 字符的操作原因。");
  return { reason };
}
