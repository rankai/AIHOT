import { credential } from "../../config.ts";
import { guardedFetch } from "../../lib/http-fetch.ts";
import { stableJson } from "../../lib/ids.ts";
import { paidRequest, type PaidRequestOptions } from "../receipts.ts";
import { assertWanOutbound, wanConfig, type WanConfig } from "./wan-config.ts";
import { WAN_MODEL, WanTaskId } from "./wan-contract.ts";
export class WanTemporaryError extends Error { readonly receiptId: number; readonly attempt: number; readonly response: unknown; constructor(receiptId: number, attempt: number, response: unknown) { super("万相查询暂时拒绝，请稍后继续原任务"); this.receiptId = receiptId; this.attempt = attempt; this.response = response; } }
export function assertWanConfig(expected: WanConfig) { if (stableJson(wanConfig()) !== stableJson(expected)) throw new Error("万相配置已变更，请核对原任务业务空间及 OSS 配置"); }
export async function wanRequest(config: WanConfig, identity: Record<string, unknown>, options: PaidRequestOptions, body?: () => Promise<unknown>, taskId?: string) {
  const path = taskId ? `/api/v1/tasks/${WanTaskId.parse(taskId)}` : "/api/v1/services/aigc/image2video/video-synthesis";
  const result = await paidRequest({ service: taskId ? "aliyun.wan.poll" : "aliyun.wan.video", model: WAN_MODEL, purpose: taskId ? "wan.poll" : "wan.submit", identity: { config, ...identity }, requestSummary: { base: config.base, ...identity } }, async () => {
    assertWanOutbound(); assertWanConfig(config);
    const key = credential("models", "DASHSCOPE_API_KEY"); if (!key) throw new Error("Missing DASHSCOPE_API_KEY");
    try {
      const response = await guardedFetch(`${config.base}${path}`, { method: taskId ? "GET" : "POST", route: "direct", maxRedirects: 0, timeoutMs: 30_000, maxBytes: 2 * 1024 * 1024, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(taskId ? {} : { "X-DashScope-Async": "enable" }) }, ...(taskId ? {} : { body: JSON.stringify(await body?.()) }) });
      return { response: { status: response.status, body: response.text().split(key).join("[REDACTED]") } };
    } catch { throw new Error("Wan transport outcome unknown; inspect retained receipt"); }
  }, options);
  const raw = result.response as { status: number; body: string };
  if (taskId && [429, 500, 502, 503, 504].includes(raw.status)) throw new WanTemporaryError(result.receiptId, result.attempt, raw);
  if (raw.status < 200 || raw.status >= 300) throw new Error(`Wan HTTP ${raw.status}; receipt ${result.receiptId}`);
  return { ...result, data: JSON.parse(raw.body) as unknown };
}
