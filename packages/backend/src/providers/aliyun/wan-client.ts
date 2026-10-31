import { credential } from "../../config.ts";
import type { Tx } from "../../db.ts";
import { guardedFetch } from "../../lib/http-fetch.ts";
import { stableJson } from "../../lib/ids.ts";
import { paidRequest, type BudgetContext, type PaidRequestOptions, type PriceSnapshot, type ReceiptRequest } from "../receipts.ts";
import { assertWanOutbound, wanConfig, type WanConfig } from "./wan-config.ts";
import { WAN_MODEL, WanTaskId } from "./wan-contract.ts";
export class WanTemporaryError extends Error { readonly receiptId: number; readonly attempt: number; readonly response: unknown; constructor(receiptId: number, attempt: number, response: unknown) { super("万相查询暂时拒绝，请稍后继续原任务"); this.receiptId = receiptId; this.attempt = attempt; this.response = response; } }
export function assertWanConfig(expected: WanConfig) { if (stableJson(wanConfig()) !== stableJson(expected)) throw new Error("万相配置已变更，请核对原任务业务空间及 OSS 配置"); }

export type WanPriceRule = {
  unit: "second";
  perSecondCny: "0.6" | "0.9";
  currency: "CNY";
  basis: "documented-estimate";
  ruleVersion: string;
  date: string;
  sourceUrl: string | null;
};

function validPriceDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function wanPriceRule(value: unknown): WanPriceRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rule = value as Record<string, unknown>;
  if (rule.unit !== "second" || (rule.perSecondCny !== "0.6" && rule.perSecondCny !== "0.9") ||
      rule.currency !== "CNY" || rule.basis !== "documented-estimate" ||
      typeof rule.ruleVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(rule.ruleVersion) ||
      !validPriceDate(rule.date) || (rule.sourceUrl !== undefined && rule.sourceUrl !== null && typeof rule.sourceUrl !== "string")) return null;
  return {
    unit: "second",
    perSecondCny: rule.perSecondCny,
    currency: "CNY",
    basis: "documented-estimate",
    ruleVersion: rule.ruleVersion,
    date: rule.date,
    sourceUrl: typeof rule.sourceUrl === "string" ? rule.sourceUrl : null,
  };
}

export function wanReadyPriceSnapshot(req: Pick<ReceiptRequest, "service" | "model">, rule: WanPriceRule, selectedAt: Date): PriceSnapshot {
  const snapshot: Extract<PriceSnapshot, { state: "ready" }> & {
    unit: "second";
    perSecondCny: "0.6" | "0.9";
    ruleVersion: string;
    date: string;
  } = {
    version: 1,
    state: "ready",
    service: req.service,
    model: req.model ?? "",
    currency: rule.currency,
    perRequest: null,
    inputPerMtok: null,
    cachedInputPerMtok: null,
    outputPerMtok: null,
    sourceUrl: rule.sourceUrl,
    verifiedOn: rule.date,
    selectedAt: selectedAt.toISOString(),
    unit: rule.unit,
    perSecondCny: rule.perSecondCny,
    ruleVersion: rule.ruleVersion,
    date: rule.date,
  };
  return snapshot;
}

async function resolveWanPriceSnapshot(tx: Tx, req: ReceiptRequest, attemptTime: Date, execution: BudgetContext): Promise<PriceSnapshot> {
  const fallback = (reason: "missing_price" | "invalid_price"): PriceSnapshot => ({
    version: 1, state: "unavailable", service: req.service, model: req.model ?? "", reason, selectedAt: attemptTime.toISOString(),
  });
  if (execution.operationRunId == null) return fallback("missing_price");
  const [row] = await tx<{ price_snapshot: unknown; mode: string | null }[]>`
    SELECT input->'priceSnapshot' AS price_snapshot,input->'parameters'->>'mode' AS mode
    FROM operation_runs WHERE id=${execution.operationRunId}`;
  if (!row) return fallback("missing_price");
  const rule = wanPriceRule(row.price_snapshot);
  if (!rule || (row.mode === "wan-std" ? rule.perSecondCny !== "0.6" : row.mode === "wan-pro" ? rule.perSecondCny !== "0.9" : true)) return fallback("invalid_price");
  return wanReadyPriceSnapshot(req, rule, attemptTime);
}

export async function wanRequest(config: WanConfig, identity: Record<string, unknown>, options: PaidRequestOptions, body?: () => Promise<unknown>, taskId?: string) {
  const path = taskId ? `/api/v1/tasks/${WanTaskId.parse(taskId)}` : "/api/v1/services/aigc/image2video/video-synthesis";
  const result = await paidRequest({ service: taskId ? "aliyun.wan.poll" : "aliyun.wan.video", model: WAN_MODEL, costIdentity: { billingProvider: "aliyun", operation: taskId ? "wan.poll" : "wan.submit", model: WAN_MODEL }, purpose: taskId ? "wan.poll" : "wan.submit", identity: { config, ...identity }, requestSummary: { base: config.base, ...identity } }, async () => {
    assertWanOutbound(); assertWanConfig(config);
    const key = credential("models", "DASHSCOPE_API_KEY"); if (!key) throw new Error("Missing DASHSCOPE_API_KEY");
    try {
      const response = await guardedFetch(`${config.base}${path}`, { method: taskId ? "GET" : "POST", route: "direct", maxRedirects: 0, timeoutMs: 30_000, maxBytes: 2 * 1024 * 1024, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(taskId ? {} : { "X-DashScope-Async": "enable" }) }, ...(taskId ? {} : { body: JSON.stringify(await body?.()) }) });
      return { response: { status: response.status, body: response.text().split(key).join("[REDACTED]") } };
    } catch { throw new Error("Wan transport outcome unknown; inspect retained receipt"); }
  }, {
    ...options,
    resolvePriceSnapshot: async (tx, context) =>
      (await options.resolvePriceSnapshot?.(tx, context)) ??
      resolveWanPriceSnapshot(tx, context.req, context.attemptTime, context.execution),
  });
  const raw = result.response as { status: number; body: string };
  if (taskId && [429, 500, 502, 503, 504].includes(raw.status)) throw new WanTemporaryError(result.receiptId, result.attempt, raw);
  if (raw.status < 200 || raw.status >= 300) throw new Error(`Wan HTTP ${raw.status}; receipt ${result.receiptId}`);
  return { ...result, data: JSON.parse(raw.body) as unknown };
}
