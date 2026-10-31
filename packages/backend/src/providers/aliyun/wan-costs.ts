import { z } from "zod";
import { sql, type Tx } from "../../db.ts";
import { stableJson } from "../../lib/ids.ts";
import type { ReceiptResult } from "../receipts.ts";
import type { RunRow } from "../operations/store.ts";
import type { parseWanResponse } from "./wan-contract.ts";
/** Called only after parsing and requireExecution, in the same transaction as consuming this poll. */
export async function recordWanUsage(tx: Tx, run: RunRow, receipt: ReceiptResult, data: ReturnType<typeof parseWanResponse>) {
  if (!["SUCCEEDED", "FAILED", "CANCELED"].includes(data.output.task_status)) return;
  const parameters = run.input.parameters as { mode: string };
  const ratio = parameters.mode === "wan-std" ? "standard" : "pro";
  const wanTask = { provider: "aliyun", configIdentity: run.input.configIdentity, taskId: data.output.task_id, rootRunId: run.progress.rootRunId ?? run.input.rootRunId ?? run.id,
    submissionReceiptId: run.progress.submissionReceiptId, submissionAttempt: run.progress.submissionAttempt, terminal: data.output.task_status,
    outputSeconds: data.usage?.video_duration ?? null, priceSnapshot: run.input.priceSnapshot,
    usageValid: data.usage?.video_duration !== undefined && (!data.usage.video_ratio || data.usage.video_ratio === ratio) };
  const [attempt] = await tx`SELECT usage FROM receipt_attempts WHERE receipt_id=${receipt.receiptId} AND attempt=${receipt.attempt} FOR UPDATE`;
  if (!attempt) throw new Error("Missing Wan poll attempt");
  if (attempt.usage?.wanTask && stableJson(attempt.usage.wanTask) !== stableJson(wanTask)) throw new Error("Conflicting Wan task usage evidence");
  await tx`UPDATE receipt_attempts SET usage=coalesce(usage,'{}'::jsonb)||${tx.json({ wanTask } as never)} WHERE receipt_id=${receipt.receiptId} AND attempt=${receipt.attempt}`;
}
const Evidence = z.object({ provider: z.literal("aliyun"), configIdentity: z.record(z.string(), z.unknown()), taskId: z.string(), rootRunId: z.number().int().positive(), submissionReceiptId: z.number().int().positive(), submissionAttempt: z.number().int().positive(), terminal: z.enum(["SUCCEEDED","FAILED","CANCELED"]), outputSeconds: z.number().positive().nullable(), usageValid: z.boolean(), priceSnapshot: z.object({ perSecondCny: z.enum(["0.6","0.9"]), currency: z.literal("CNY"), basis: z.literal("documented-estimate"), date: z.string() }) });
export async function wanTaskCosts(start: string, end: string) {
  // Deduplicate all terminal observations before filtering by the original submission attempt.
  const rows = await sql`SELECT usage->'wanTask' AS evidence FROM receipt_attempts WHERE service='aliyun.wan.poll' AND usage ? 'wanTask'`;
  const groups = new Map<string, Array<z.infer<typeof Evidence>>>(); let invalidEvidence = 0;
  for (const row of rows) { const p = Evidence.safeParse(row.evidence); if (!p.success) { invalidEvidence++; continue; } const e = p.data, key = stableJson([e.provider, e.configIdentity, e.taskId]); groups.set(key, [...(groups.get(key) ?? []), e]); }
  const tasks: Array<{ taskId: string; rootRunId: number; submittedAt: string; status: string; outputSeconds: number | null; estimatedCny: number | null; needsReview: boolean }> = [];
  for (const evidence of groups.values()) {
    const first = evidence[0]!;
    const [attempt] = await sql`SELECT started_at FROM receipt_attempts WHERE receipt_id=${first.submissionReceiptId} AND attempt=${first.submissionAttempt} AND service='aliyun.wan.video'`;
    if (!attempt) { invalidEvidence++; continue; }
    if (attempt.started_at.getTime() < Date.parse(start) || attempt.started_at.getTime() >= Date.parse(end)) continue;
    const conflict = evidence.some(e => stableJson(e) !== stableJson(first));
    const known = !conflict && first.usageValid && first.outputSeconds !== null;
    tasks.push({ taskId: first.taskId, rootRunId: first.rootRunId, submittedAt: attempt.started_at.toISOString(), status: first.terminal, outputSeconds: known ? first.outputSeconds : null, estimatedCny: known ? Number((first.outputSeconds! * Number(first.priceSnapshot.perSecondCny)).toFixed(6)) : null, needsReview: !known });
  }
  return { timeBasis: "submission_attempt_started_at", basis: "documented-estimate", currency: "CNY", tasks, estimatedCny: Number(tasks.reduce((sum, task) => sum + (task.estimatedCny ?? 0), 0).toFixed(6)), unknownTasks: tasks.filter(t => t.needsReview).length, invalidEvidence, excludes: "OSS storage/traffic; pending or unparsed tasks; not a supplier bill" };
}
