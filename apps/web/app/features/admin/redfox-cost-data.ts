import type { RedfoxBillRecord, RedfoxCostInput } from "./redfox-cost-types.ts";
export function redfoxCostDefaults(now: Date) { return { start: new Date(now.getTime() - 86400000).toISOString(), end: now.toISOString() }; }
export function redfoxCostInputKey(input: RedfoxCostInput) { return JSON.stringify([input.start, input.end, input.billRunId]); }
export function redfoxCostQuery(input: RedfoxCostInput) {
  const explicitZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (![input.start, input.end].every(value => explicitZone.test(value) && Number.isFinite(Date.parse(value)))) throw new Error("起止时间须为有效 ISO 时间并包含 Z 或明确时区偏移，例如 2026-10-21T00:00:00+08:00。");
  if (Date.parse(input.start) >= Date.parse(input.end)) throw new Error("开始时间必须早于结束时间。");
  if (input.billRunId && (!/^[1-9]\d*$/.test(input.billRunId) || !Number.isSafeInteger(Number(input.billRunId)))) throw new Error("请从已存清单选择有效账单页。");
  const parameters = new URLSearchParams({ start: input.start, end: input.end });
  if (input.billRunId) parameters.set("billRunId", input.billRunId);
  return `/api/admin/redfox/costs?${parameters}`;
}
export function billParameterText(parameters: Record<string, unknown>, key: string): string {
  if (!Object.hasOwn(parameters, key)) return "省略（上游默认未声明）";
  const value = parameters[key];
  return value === null ? "null" : value === "" ? "空字符串" : typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function redfoxCostText(value: string | null) { return value === null ? "未知" : value; }
export function redfoxCostBasis(basis: "actual" | "estimated" | null) { return basis === "actual" ? "实收成本（actual）" : basis === "estimated" ? "文档估算（estimated）" : "未知（null）"; }
export function redfoxCostEnvironment(environment: "production" | "other" | "unknown") { return environment === "production" ? "官方生产地址（登记）" : environment === "other" ? "测试或其他端点（other，未判定具体用途）" : "地址未知"; }
export function billRecordPage(records: readonly RedfoxBillRecord[], requestedPage: number) {
  const pages = Math.ceil(records.length / 100), page = Number.isSafeInteger(requestedPage) ? Math.max(0, Math.min(requestedPage, Math.max(0, pages - 1))) : 0;
  return { page, pages, start: page * 100, rows: records.slice(page * 100, (page + 1) * 100) };
}
