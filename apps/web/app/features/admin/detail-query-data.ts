import { platformParameters, type PlatformOperation } from "./platform-types.ts";
import type { DetailQueryChoice, DetailQueryOptions } from "./detail-query-types.ts";
export function isDetailQueryWork(kind: string, data: Record<string, unknown>) {
  if (data.platform === "zhihu") return kind === "zhihu_work" && data.operationId === "API_1789095347662" && (data.requestContext as Record<string, unknown> | undefined)?.vertical === "article";
  return typeof data.platform === "string" && ["douyin", "xiaohongshu", "wechat", "tiktok", "bilibili", "weibo", "qichezhijia", "dongchedi", "yiche"].includes(data.platform) && kind === `${data.platform}_work`;
}
export function isDetailQueryResult(kind: string, data: Record<string, unknown>) {
  return isDetailQueryWork(kind, data) || (data.platform === "baijiahao" && kind === "baijiahao_work") ||
    (typeof data.platform === "string" && ["weibo", "douyin", "xiaohongshu", "wechat", "bilibili", "baijiahao"].includes(data.platform) && kind === `${data.platform}_account`);
}
export function detailQueryOperation(choice: DetailQueryChoice): PlatformOperation {
  if (choice.purpose !== "query" || choice.fields.some(field => choice.operationId !== "LLCI8QTE" || field.name !== "page" || field.type !== "integer" || Object.hasOwn(choice.parameters, field.name))) throw new Error("本选项的可编辑字段尚不受支持，请重新读取补全接口。");
  return { id: choice.operationId, label: choice.label, platform: "qichezhijia", purpose: "query", schedulableType: null, fields: choice.fields.map(field => ({ ...field, default: undefined, required: true })) };
}
export function detailQueryPrice(choice: DetailQueryChoice) {
  return choice.price.amount === null ? `文档估算金额未知；币种 ${choice.price.currency ?? "未知"}` : `文档估算 ${choice.price.amount} ${choice.price.currency ?? "币种未知"}/请求`;
}
export function detailQueryBody(resultId: number, options: DetailQueryOptions | null, operationId: string, values: Record<string, string>) {
  if (!Number.isSafeInteger(resultId) || resultId < 1 || options?.resultId !== resultId) throw new Error("补全接口与当前结果不匹配，请重新读取。");
  const choice = options.choices.find(choice => choice.operationId === operationId);
  if (!choice) throw new Error("请选择本结果已确认的补全接口；不会自动改用其他目标。");
  const operation = detailQueryOperation(choice);
  if (Object.keys(values).some(name => !operation.fields.some(field => field.name === name))) throw new Error("只能填写本选项明确开放的字段，不能修改冻结身份或原文。");
  return { operationId: choice.operationId, parameters: { ...choice.parameters, ...platformParameters(operation, values) }, sourceResultId: resultId };
}
