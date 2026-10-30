import { z } from "zod";
export const WAN_MODEL = "wan2.2-animate-mix";
export const WAN_GENERATE = "aliyun.wan.animate-mix.generate", WAN_QUERY = "aliyun.wan.animate-mix.query";
const FileKey = z.string().regex(/^uploads\/redfox\/[a-f0-9]{64}$/);
export const WanInput = z.object({ provider: z.literal("aliyun"), model: z.literal(WAN_MODEL), mode: z.enum(["wan-std", "wan-pro"]), portraitFileKey: FileKey, referenceVideoFileKey: FileKey }).strict();
export type WanParameters = z.infer<typeof WanInput>;
export const WanTaskId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const WAN_LIMITS = { polls: 40, pollDeadlineSeconds: 7200, externalAttempts: 48, steps: 48, retries: 3, saveAttempts: 3, downloadTimeoutMs: 120000 };
export function parseWanResponse(raw: unknown, taskId?: string) {
  const data = z.object({ output: z.object({ task_id: WanTaskId, task_status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"]), results: z.object({ video_url: z.string().url() }).optional(), code: z.string().optional() }), usage: z.object({ video_duration: z.number().finite().positive().optional(), video_ratio: z.enum(["standard", "pro"]).optional() }).optional() }).parse(raw);
  if (taskId && taskId !== data.output.task_id) throw new Error("Wan task identity mismatch");
  const url = data.output.results?.video_url;
  if (url) { const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Invalid Wan output URL"); }
  if (data.output.task_status === "SUCCEEDED" && (!url || data.output.code)) throw new Error("Wan success lacks a valid output");
  return data;
}
export function wanOptions() { return { model: WAN_MODEL, modes: ["wan-std", "wan-pro"], imageBytes: 5_000_000, videoBytes: 50_000_000, durationSeconds: { min: 2, max: 30 }, watermark: true, limits: WAN_LIMITS }; }
