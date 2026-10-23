import { z } from "zod";
import { sql } from "../../db.ts";
import { audit } from "../../admin/auth.ts";
import { queueOperationStep } from "./queue.ts";
import { abandonRun, lockRun, resumeRun, StaleOperationError } from "./store.ts";

export async function listOperations() {
  return sql`SELECT id, status, provider, operation_key AS "operationKey", step_key AS step, step_version AS "stepVersion",
    generation, wait_reason AS "waitReason", next_attempt_at AS "nextAttemptAt", created_at AS "createdAt"
    FROM operation_runs ORDER BY id DESC LIMIT 100`;
}
export async function operationDetail(id: number) {
  const [run] = await sql`SELECT id, subscription_id AS "subscriptionId", status, provider, operation_key AS "operationKey", step_key AS step,
    step_version AS "stepVersion", generation, wait_reason AS "waitReason", next_attempt_at AS "nextAttemptAt", input,
    current_receipt_id AS "receiptId", progress, limits, created_at AS "createdAt" FROM operation_runs WHERE id = ${id}`;
  if (!run) return null;
  // Inputs were authored by the server; expose only the execution parameters needed by the operator.
  const { mode, window, parameters, fileKeys, recoveryUnavailable, operationId, platform, family } = run.input;
  const draft = mode === "preview" && run.input.commandIntent?.kind !== "saved-preview";
  const {tool,upstream}=run.input;
  const sources = run.input.sources ?? (run.input.source ? [run.input.source] : undefined);
  const { polls: pollLimit, pollDeadlineSeconds } = run.limits;
  delete run.input;
  delete run.limits;
  const page = await operationResults(id);
  const results = page.results;
  const currentReceiptId = run.receiptId;
  if (!run.receiptId && ["completed", "failed"].includes(run.status)) {
    const [lastResult] = await sql`SELECT receipt_id FROM operation_results WHERE run_id = ${id} AND receipt_id IS NOT NULL ORDER BY id DESC LIMIT 1`;
    run.receiptId = lastResult?.receipt_id ?? null;
  }
  const attempts = run.receiptId ? await sql`SELECT a.id, a.attempt, a.status, a.started_at, a.finished_at, a.error,
    (a.response IS NOT NULL OR (a.attempt=p.attempts AND p.response IS NOT NULL)) AS has_retained_response
    FROM receipt_attempts a JOIN receipts p ON p.id=a.receipt_id WHERE a.receipt_id = ${run.receiptId} ORDER BY a.attempt` : [];
  const [receipt] = run.receiptId ? await sql`SELECT status, attempts, model FROM receipts WHERE id = ${run.receiptId}` : [];
  const [job] = await sql`SELECT j.state FROM operation_runs r JOIN pgboss.job j ON j.id = r.job_id WHERE r.id = ${id}`;
  const nextAction = run.status === "completed" || run.status === "failed" ? "view-results"
    : receipt?.status === "unknown" ? "review-unknown"
    : run.status === "stopped" || run.status === "needs_review" ? "review-or-resume"
    : ["received","completed"].includes(receipt?.status) ? "local-recovery"
    : job && ["created","retry","active"].includes(job.state) ? "wait-for-job" : "wait-for-recovery";
  return { ...run, currentReceiptId, receipt: receipt ?? null, jobState: job?.state ?? null, nextAction, nextResultCursor: page.nextCursor, inputs: { tool, upstream, mode, draft, window, sources, parameters, fileKeys, recoveryUnavailable, operationId, platform, family, ...(["ai-search","ai-search-query"].includes(mode)?{aiSearchPlan:{submissionLimit:mode==="ai-search"?1:0,pollLimit,pollDeadlineSeconds}}:{}), ...(["transcript","transcript-query"].includes(mode)?{transcriptionPlan:{submissionLimit:mode==="transcript"?1:0,pollLimit,pollDeadlineSeconds}}:{}), ...(["xhs-comments","xhs-comments-query"].includes(mode)?{xhsCommentPlan:{submissionLimit:mode==="xhs-comments"?1:0,pollLimit,pollDeadlineSeconds,submissionCost:null}}:{}), ...(["video","video-query"].includes(mode)?{videoPlan:{referenceUploadLimit:fileKeys?.length??0,submissionLimit:mode==="video"?1:0,pollLimit,pollDeadlineSeconds,submissionCost:null}}:{}), ...(["image","image-query"].includes(mode)?{imagePlan:{referenceUploadLimit:fileKeys?.length??0,submissionLimit:mode==="image"?1:0,pollLimit,pollDeadlineSeconds,submissionCost:null}}:{}) }, results, attempts };
}
export async function operationResults(id: number, cursor = 0, limit = 100) {
  z.number().int().nonnegative().parse(cursor);
  z.number().int().min(1).max(200).parse(limit);
  const rows = await sql`SELECT z.id, z.kind, z.data, z.receipt_id AS "receiptId", z.article_id AS "articleId", a.title AS "articleTitle", z.source_id AS "sourceId", z.file_key AS "fileKey",
    (z.article_id IS NOT NULL OR z.source_id IS NOT NULL OR z.file_key IS NOT NULL) AS imported,
    CASE WHEN f.key IS NULL THEN NULL ELSE jsonb_build_object('key',f.key,'status',f.status,'contentType',f.content_type,'bytes',f.bytes,'filename',f.metadata->>'filename','width',f.metadata->'width','height',f.metadata->'height') END AS file FROM operation_results z
    LEFT JOIN articles a ON a.id = z.article_id LEFT JOIN stored_files f ON f.key=z.file_key
    WHERE z.run_id = ${id} AND z.id > ${cursor} ORDER BY z.id LIMIT ${limit + 1}`;
  const more = rows.length > limit;
  const results = rows.slice(0,limit);
  return { results, nextCursor: more ? results.at(-1)!.id as number : null };
}

const Command = z.object({ stepVersion: z.number().int().positive(), generation: z.number().int().nonnegative(), reason: z.string().min(1).max(500) }).strict();
export async function controlOperation(id: number, action: "resume" | "stop" | "abandon", raw: unknown, actor: string) {
  const input = Command.parse(raw), expected = { runId: id, stepVersion: input.stepVersion, generation: input.generation };
  await sql.begin(async (tx) => {
    const { run } = await lockRun(tx, id);
    if (run.step_version !== expected.stepVersion || run.generation !== expected.generation) throw new StaleOperationError("Operation changed; refresh first");
    if (action === "resume") {
      if (run.input.recoveryUnavailable) throw new Error("Legacy request input is unavailable; verification or abandonment is required");
      await resumeRun(tx, expected); await queueOperationStep(tx, id);
    } else if (action === "abandon") await abandonRun(tx, expected, input.reason);
    else {
      if (["completed", "failed"].includes(run.status)) throw new Error("Operation already ended");
      await tx`UPDATE operation_runs SET status = 'stopped', generation = generation + 1, wait_reason = ${input.reason}, next_attempt_at = NULL WHERE id = ${id}`;
    }
  });
  await audit(actor, `operation.${action}`, `operation:${id}`, input.reason, null, null);
  return operationDetail(id);
}
