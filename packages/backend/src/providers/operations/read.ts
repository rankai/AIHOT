import {inheritedSourceMembers} from "../../sources/subscriptions.ts";
import { z } from "zod";
import { sql } from "../../db.ts";
import { audit } from "../../admin/auth.ts";
import { queueOperationStep } from "./queue.ts";
import { abandonRun, lockRun, lockRunAdmission, resumeRun, StaleOperationError } from "./store.ts";

const OperationFilters = z.object({
  subscriptionId: z.coerce.number().int().safe().positive().optional(),
  status: z.enum(["active", "waiting", "needs_review", "stopped", "completed", "failed"]).optional(),
}).strict();

export async function videoDownloadSummaries(subscriptionIds:number[]) {
  if(!subscriptionIds.length)return new Map<number,Record<string,unknown>>();
  const rows=await sql`WITH latest AS (SELECT DISTINCT ON(subscription_id) * FROM operation_runs
    WHERE subscription_id IN ${sql(subscriptionIds)} AND operation_key='subscription.video.download' ORDER BY subscription_id,id DESC)
    SELECT r.subscription_id,r.id AS "lastRunId",r.status,
    coalesce(sum((z.data->>'saved')::int),0)::int AS saved,coalesce(sum((z.data->>'notSaved')::int),0)::int AS "notSaved",
    coalesce((array_agg(z.data->>'reason' ORDER BY z.id DESC) FILTER(WHERE z.data->>'reason' IS NOT NULL))[1],r.wait_reason) AS reason
    FROM latest r LEFT JOIN operation_results z ON z.run_id=r.id AND z.kind='subscription_video'
    GROUP BY r.subscription_id,r.id,r.status,r.wait_reason`;
  return new Map(rows.map(({subscription_id,...summary})=>[Number(subscription_id),summary]));
}
export async function videoDownloadSummary(subscriptionId:number) {return (await videoDownloadSummaries([subscriptionId])).get(subscriptionId)??null;}
export async function listOperations(raw: unknown = {}) {
  const { subscriptionId, status } = OperationFilters.parse(raw);
  return sql`SELECT id, subscription_id AS "subscriptionId", status, provider, operation_key AS "operationKey", step_key AS step, step_version AS "stepVersion",
    generation, wait_reason AS "waitReason", next_attempt_at AS "nextAttemptAt", created_at AS "createdAt"
    FROM operation_runs
    WHERE (${subscriptionId ?? null}::bigint IS NULL OR subscription_id = ${subscriptionId ?? null}
      OR input->'members' @> ${sql.json(subscriptionId ? [{ subscriptionId }] : [])}::jsonb)
      AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
    ORDER BY id DESC LIMIT 100`;
}
export async function operationDetail(id: number) {
  const [run] = await sql`SELECT id, subscription_id AS "subscriptionId", status, provider, operation_key AS "operationKey", step_key AS step,
    step_version AS "stepVersion", generation, wait_reason AS "waitReason", next_attempt_at AS "nextAttemptAt", input,
    current_receipt_id AS "receiptId", progress, limits, created_at AS "createdAt" FROM operation_runs WHERE id = ${id}`;
  if (!run) return null;
  // Inputs were authored by the server; expose only the execution parameters needed by the operator.
  const { members:ownMembers, mode, window, parameters, fileKeys, recoveryUnavailable, operationId, platform, family } = run.input;
  const draft = mode === "preview" && run.input.commandIntent?.kind !== "saved-preview";
  const {tool,upstream}=run.input;
  const members=(await inheritedSourceMembers(sql,run.input,run.provider,id))?.members??ownMembers;
  const frozenSourceIds = [...new Set((members ?? []).flatMap((member: {sourceId: string | null}) => member.sourceId ? [member.sourceId] : []))] as string[];
  const sources = run.input.sources ?? (run.input.source ? [run.input.source] : frozenSourceIds.length ? await sql`SELECT id,name FROM sources WHERE id IN ${sql(frozenSourceIds)} ORDER BY id` : undefined);
  const { polls: pollLimit, pollDeadlineSeconds } = run.limits;
  const videoDownload = run.operationKey === "subscription.video.download" ? {
    mediaRole:run.input.mediaRole??"own",workId:run.input.workId,collector:run.input.collector,resolver:run.input.resolver,resolverUsed:run.progress.resolverUsed===true,parentRunId:run.input.parentRunId,parentResultId:run.input.parentResultId,
    articleId:run.input.articleId,originalUrl:run.input.originalUrl,retentionDays:30,maxBytes:50_000_000,normalParserAttempts:1,maxParserAttempts:2,
  } : undefined;
  if(videoDownload)run.progress={transferAttempts:run.progress.transferAttempts??0,targetIndex:run.progress.targetIndex??0,
    candidateIndex:run.progress.candidateIndex??0,targetsTotal:run.progress.targets?.length??run.input.manifest?.targets?.length??1,
    saved:run.progress.saved??0,notSaved:run.progress.notSaved??0,transferredBytes:run.progress.totalTransferBytes??0};
  if(videoDownload&&["completed","failed"].includes(run.status)) {
    // Completion clears progress. Only per-media outcomes count; the optional summary
    // repeats those totals and the parser result contributes evidence, not saved files.
    const [totals]=await sql`SELECT count(*)::int AS targets,
      coalesce(sum((data->>'saved')::int),0)::int AS saved,
      coalesce(sum((data->>'notSaved')::int),0)::int AS "notSaved",
      coalesce(sum((data->>'transferredBytes')::bigint),0)::float8 AS bytes
      FROM operation_results WHERE run_id=${id} AND kind='subscription_video'`;
    const [parser]=await sql`SELECT 1 FROM operation_results WHERE run_id=${id} AND kind='subscription_video_parse' LIMIT 1`;
    videoDownload.resolverUsed=!!parser;
    run.progress={...run.progress,saved:totals!.saved,notSaved:totals!.notSaved,transferredBytes:totals!.bytes,
      targetIndex:totals!.targets,targetsTotal:totals!.targets||run.progress.targetsTotal};
  }
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
  return { ...run, progress:run.progress, currentReceiptId, receipt: receipt ?? null, jobState: job?.state ?? null, nextAction, nextResultCursor: page.nextCursor, inputs: { members, videoDownload, tool, upstream, mode, draft, window, sources, parameters, fileKeys, recoveryUnavailable, operationId, platform, family, ...(["ai-search","ai-search-query"].includes(mode)?{aiSearchPlan:{submissionLimit:mode==="ai-search"?1:0,pollLimit,pollDeadlineSeconds}}:{}), ...(["transcript","transcript-query"].includes(mode)?{transcriptionPlan:{submissionLimit:mode==="transcript"?1:0,pollLimit,pollDeadlineSeconds}}:{}), ...(["xhs-comments","xhs-comments-query"].includes(mode)?{xhsCommentPlan:{submissionLimit:mode==="xhs-comments"?1:0,pollLimit,pollDeadlineSeconds,submissionCost:null}}:{}), ...(["video","video-query"].includes(mode)?{videoPlan:{referenceUploadLimit:fileKeys?.length??0,submissionLimit:mode==="video"?1:0,pollLimit,pollDeadlineSeconds,submissionCost:null}}:{}), ...(["image","image-query"].includes(mode)?{imagePlan:{referenceUploadLimit:fileKeys?.length??0,submissionLimit:mode==="image"?1:0,pollLimit,pollDeadlineSeconds,submissionCost:null}}:{}) }, results, attempts };
}
export async function operationResults(id: number, cursor = 0, limit = 100) {
  z.number().int().nonnegative().parse(cursor);
  z.number().int().min(1).max(200).parse(limit);
  const rows = await sql`SELECT z.id, z.kind, z.data, z.provenance->'videoDownloadRunId' AS "videoDownloadRunId",z.provenance->'videoDownloadRunIds' AS "videoDownloadRunIds", z.receipt_id AS "receiptId", z.article_id AS "articleId", a.title AS "articleTitle", z.source_id AS "sourceId", z.file_key AS "fileKey",
    (z.article_id IS NOT NULL OR z.source_id IS NOT NULL OR z.file_key IS NOT NULL) AS imported,
    CASE WHEN f.key IS NULL THEN NULL ELSE jsonb_build_object('key',f.key,'status',f.status,'contentType',f.content_type,'bytes',f.bytes,'filename',f.metadata->>'filename','width',f.metadata->'width','height',f.metadata->'height','kind',f.metadata->>'kind','origin',f.metadata->>'origin','createdAt',f.created_at,'expiresAt',f.expires_at,'source',(SELECT jsonb_build_object('articleId',vr.input->>'articleId','sourceId',vr.input->'videoDownloadOwnership'->>'sourceId','subscriptionId',vr.subscription_id,'runId',vr.id) FROM operation_results vz JOIN operation_runs vr ON vr.id=vz.run_id WHERE vz.file_key=f.key AND vr.operation_key='subscription.video.download' ORDER BY vz.id LIMIT 1),'expired',f.metadata->>'origin'='subscription-video' AND f.expires_at<=now()) END AS file FROM operation_results z
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
    if (action === "resume") await lockRunAdmission(tx, [id]);
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
