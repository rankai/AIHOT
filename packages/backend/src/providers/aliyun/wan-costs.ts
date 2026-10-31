import { z } from "zod";
import { sql, type Db, type Tx } from "../../db.ts";
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
export async function wanTaskCosts(start: string, end: string, db: Db = sql) {
  // Start from submissions in the requested fee-time window, then read terminal evidence from any date.
  // This preserves the required "submission attempt owns the task cost" rule without an N+1 lookup.
  const rows = await db<{
    submission_receipt_id: number;
    submission_attempt: number;
    submission_attempt_id: number;
    submitted_at: Date;
    evidence: unknown;
  }[]>`
    SELECT s.receipt_id AS submission_receipt_id,s.attempt AS submission_attempt,s.id AS submission_attempt_id,
      s.started_at AS submitted_at,p.usage->'wanTask' AS evidence
    FROM receipt_attempts s
    LEFT JOIN receipt_attempts p
      ON p.service='aliyun.wan.poll'
      AND p.usage->'wanTask'->>'submissionReceiptId'=s.receipt_id::text
      AND p.usage->'wanTask'->>'submissionAttempt'=s.attempt::text
    WHERE s.service='aliyun.wan.video'
      AND s.started_at>=${new Date(start)}
      AND s.started_at<${new Date(end)}
    ORDER BY s.started_at,s.id,p.id
  `;
  type Submission = {
    submissionReceiptId: number;
    submissionAttempt: number;
    submissionAttemptId: number;
    submittedAt: Date;
    evidence: z.infer<typeof Evidence>[];
    invalid: number;
  };
  const submissions = new Map<string, Submission>();
  for (const row of rows) {
    const key = `${row.submission_receipt_id}:${row.submission_attempt}`;
    const current = submissions.get(key) ?? {
      submissionReceiptId: row.submission_receipt_id,
      submissionAttempt: row.submission_attempt,
      submissionAttemptId: row.submission_attempt_id,
      submittedAt: row.submitted_at,
      evidence: [],
      invalid: 0,
    };
    if (row.evidence !== null) {
      const parsed = Evidence.safeParse(row.evidence);
      if (parsed.success) current.evidence.push(parsed.data);
      else current.invalid += 1;
    }
    submissions.set(key, current);
  }

  const groups = new Map<string, Submission[]>();
  for (const submission of submissions.values()) {
    const first = submission.evidence[0];
    const key = first
      ? stableJson([first.provider, first.configIdentity, first.taskId])
      : `submission:${submission.submissionReceiptId}:${submission.submissionAttempt}`;
    groups.set(key, [...(groups.get(key) ?? []), submission]);
  }

  let invalidEvidence = 0;
  const tasks: Array<{
    taskId: string;
    rootRunId: number | null;
    submissionAttemptId: number;
    submissionReceiptId: number;
    submissionAttempt: number;
    submittedAt: string;
    status: string;
    outputSeconds: number | null;
    estimatedCny: number | null;
    needsReview: boolean;
  }> = [];
  for (const grouped of groups.values()) {
    invalidEvidence += grouped.reduce((sum, item) => sum + item.invalid, 0);
    const observations = grouped.flatMap((item) => item.evidence);
    const first = observations[0];
    const firstSubmission = grouped
      .slice()
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || a.submissionAttemptId - b.submissionAttemptId)[0]!;
    const conflict =
      grouped.length > 1 ||
      grouped.some((item) => item.invalid > 0) ||
      observations.some((item) => stableJson(item) !== stableJson(first));
    const known = !conflict && first?.usageValid === true && first.outputSeconds !== null;
    const outputSeconds = known ? first.outputSeconds : null;
    tasks.push({
      taskId: first?.taskId ?? `unknown:${firstSubmission.submissionReceiptId}:${firstSubmission.submissionAttempt}`,
      rootRunId: first?.rootRunId ?? null,
      submissionAttemptId: firstSubmission.submissionAttemptId,
      submissionReceiptId: firstSubmission.submissionReceiptId,
      submissionAttempt: firstSubmission.submissionAttempt,
      submittedAt: firstSubmission.submittedAt.toISOString(),
      status: first?.terminal ?? "UNKNOWN",
      outputSeconds,
      estimatedCny:
        outputSeconds === null
          ? null
          : Number((outputSeconds * Number(first!.priceSnapshot.perSecondCny)).toFixed(6)),
      needsReview: !known,
    });
  }
  tasks.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.submissionAttemptId - a.submissionAttemptId);
  return { timeBasis: "submission_attempt_started_at", basis: "documented-estimate", currency: "CNY", tasks, estimatedCny: Number(tasks.reduce((sum, task) => sum + (task.estimatedCny ?? 0), 0).toFixed(6)), unknownTasks: tasks.filter(t => t.needsReview).length, invalidEvidence, excludes: "OSS storage/traffic; pending or unparsed tasks; not a supplier bill" };
}
