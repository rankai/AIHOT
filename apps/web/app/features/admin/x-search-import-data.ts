import type { OperationResult } from "./operation-types.ts";
import { researchObject } from "./research-platform-data.ts";

export function isXSearchWork(kind: string, data: Record<string, unknown>) {
  return kind === "x_research_work" && data.platform === "x-research" && data.operationId === "5K5EG87P";
}
export function isXDetailWork(kind: string, data: Record<string, unknown>) {
  return kind === "x_detail_work" && data.platform === "x" && data.operationId === "QCP75W33";
}
export function xSearchImportState(result: Pick<OperationResult, "kind" | "data" | "sourceId" | "articleId">) {
  const detail = isXDetailWork(result.kind, result.data), supported = isXSearchWork(result.kind, result.data) || detail, linked = !!(result.articleId || result.sourceId);
  const record = researchObject(result.data.record), user = researchObject(detail ? record.author : record.user), issues: string[] = [];
  const username = detail && user.username == null ? researchObject(result.data.context).username : user.username;
  const validId = (value: unknown) => typeof value === "string" && /^\d{1,30}$/.test(value);
  if (supported) {
    if (detail && (result.data.workId !== record.tweetId || researchObject(result.data.identity).userId !== user.userId)) issues.push("详情作品或作者身份与实收记录不一致，请核对后台结果");
    if (!validId(record.tweetId)) issues.push("缺少合法的实收 tweetId");
    if (!validId(user.userId)) issues.push(`缺少 ${detail ? "author" : "user"}.userId 稳定作者身份，不能用请求或 handle 补齐`);
    if (typeof username !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(username)) issues.push(detail ? "缺少合法的实收 username 或后台核实的同作者上下文" : "缺少合法的实收 username");
    const text = record.text ?? record.content;
    if (typeof text !== "string" || !text.trim()) issues.push("缺少实收正文");
    if (typeof record.createdAt !== "string" || !Number.isFinite(new Date(record.createdAt).getTime()) || !/(?:Z|[+-]\d{2}:?\d{2})(?:\s+\d{4})?$/.test(record.createdAt)) issues.push("缺少合法且带明确时区的实收发布时间");
  }
  return { supported, linked, canImport: supported && !linked && issues.length === 0, issues };
}
export function xSearchImportBody(result: Pick<OperationResult, "kind" | "data" | "sourceId" | "articleId">, rawReason: string) {
  const state = xSearchImportState(result), reason = rawReason.trim();
  if (!state.canImport) throw new Error(state.linked ? "此作品已有真实关联，请查看文章与作者信源。" : state.issues.join("；") || "此结果不支持本地导入。");
  if (!reason || reason.length > 500) throw new Error("请填写 1–500 字符的操作原因。");
  return { reason };
}
