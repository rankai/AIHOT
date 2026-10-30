import { lockAssetInputs } from "../../operations/assets.ts";
import type { Tx } from "../../db.ts";
import { sha256, stableJson } from "../../lib/ids.ts";
import { eligibleMembers, contentSubscription, subscriptionSourceId, lockSubscription, releaseSubscriptions, type SubscriptionMember } from "../../sources/subscriptions.ts";
import { completeReceipt, type PaidRequestOptions } from "../receipts.ts";
import { SUBSCRIPTION_VIDEO_DOWNLOAD, lockVideoDownloadOwners, eligibleVideoDownloadMembers, type VideoDownloadOwnership } from "../../sources/subscription-video-ownership.ts";
import { reserveForRun, settleForRun, assertRunCredit, type ToolAuthorization } from "../../users/credits.ts";

export class StaleOperationError extends Error { readonly code = "conflict"; }
export interface Execution { runId: number; stepVersion: number; generation: number }
export interface OperationProgress extends Record<string, unknown> {
  /** Unconsumed source pages survive switching the current request to enrichment. */
  retainedReceiptIds?: number[];
}
export interface RunInput extends Record<string, unknown> { members: SubscriptionMember[]; forceSourceId?: string | null; videoDownloadOwnership?: VideoDownloadOwnership }
export interface RunRow {
  id: number; actor: string; provider: string; status: string; step_key: string; step_version: number; generation: number;
  operation_key?: string; contract_version?: number;
  limits: Record<string, number>;
  input: RunInput; input_hash: string; progress: OperationProgress; current_receipt_id: number | null;
}

export async function createRun(tx: Tx, command: {
  actor: string; commandKey: string; provider: string; operationKey: string; contractVersion: number;
  input: Record<string, unknown>; stepKey: string; subscriptionIds?: number[]; limits?: Record<string, unknown>; forceSourceId?: string;
  authorization?: ToolAuthorization;
}): Promise<RunRow> {
  const ids = [...new Set(command.subscriptionIds ?? [])].sort((a, b) => a - b);
  const download = command.operationKey === SUBSCRIPTION_VIDEO_DOWNLOAD;
  if (download && (command.provider !== "local" || command.contractVersion !== 1 || ids.length !== 1 || command.forceSourceId || typeof command.input.articleId !== "string")) {
    throw new StaleOperationError("Video download requires one subscription and material owner");
  }
  // A replacement quote does not change the business identity of an idempotent command.
  const { authorization, ...identity } = command;
  const hash = sha256(stableJson({ ...identity, subscriptionIds: ids }));
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${command.actor}:${command.commandKey}`}))`;
  const member = /^user:([1-9][0-9]*)$/.exec(command.actor);
  if (member) {
    const user = await lockMemberAdmission(tx, command.actor);
    if (user?.status !== "active") throw new StaleOperationError("账号已停用，请重新登录");
  }
  const [existing] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor = ${command.actor} AND command_key = ${command.commandKey}`;
  if (existing) {
    if (existing.input_hash !== hash) throw new StaleOperationError("Command key reused with different input");
    return existing;
  }
  if (member) {
    const [counts] = await tx`SELECT count(*) FILTER (WHERE status IN ('active','waiting'))::int AS running,
      count(*) FILTER (WHERE created_at>now()-interval '1 minute')::int AS recent FROM operation_runs WHERE actor=${command.actor}`;
    if (counts!.running >= 5 || counts!.recent >= 10) throw new StaleOperationError("同时最多执行 5 个任务，每分钟最多新建 10 个任务，请稍后再试");
  }
  let limits = command.limits ?? {};
  if (authorization?.intent.recoveryRunId !== undefined) {
    const [parent] = await tx`SELECT * FROM operation_runs WHERE id=${authorization.intent.recoveryRunId} AND actor=${command.actor} FOR UPDATE`;
    const [receipt] = parent?.current_receipt_id ? await tx`SELECT status FROM receipts WHERE id=${parent.current_receipt_id}` : [];
    const [job] = parent?.job_id ? await tx`SELECT state FROM pgboss.job WHERE id=${parent.job_id}` : [];
    if (!parent || !["stopped", "needs_review"].includes(parent.status) || !parent.step_key.endsWith(".poll") || ["pending", "unknown"].includes(receipt?.status) || job?.state === "active") {
      throw new StaleOperationError("原任务状态已变化，请刷新后再续查");
    }
    if (command.operationKey === "redfox.video.query") command.input.deliveryParameters = parent.input.parameters;
    const [used] = await tx`SELECT
      (SELECT count(*)::int FROM operation_results WHERE run_id=${parent.id} AND item_key LIKE 'poll:%' AND kind IN ('image_task','video_task','ai_search_task','ai_search_answer','transcription_task','transcription','xhs_comment_task')) AS polls,
      (SELECT count(*)::int FROM receipt_attempts WHERE receipt_id IN (SELECT receipt_id FROM operation_results WHERE run_id=${parent.id} AND receipt_id IS NOT NULL UNION SELECT current_receipt_id FROM operation_runs WHERE id=${parent.id} AND current_receipt_id IS NOT NULL)) AS attempts`;
    const polls = Number(parent.limits.polls) - Math.max(Number(used!.polls), parent.provider === "aliyun" ? Number(parent.progress.pollAttempts ?? 0) : 0);
    const externalAttempts = Number(parent.limits.externalAttempts) - Math.max(Number(used!.attempts), Number(parent.progress.externalAttempts ?? 0));
    if (!Number.isSafeInteger(polls) || polls <= 0 || !Number.isSafeInteger(externalAttempts) || externalAttempts <= 0) throw new StaleOperationError("原任务的总查询次数已用尽，请联系管理员核对");
    limits = { ...limits, polls, externalAttempts, pollDeadlineSeconds: parent.limits.pollDeadlineSeconds };
  }
  await lockAssetInputs(tx, command.input.fileKeys);
  const members: SubscriptionMember[] = [];
  let videoDownloadOwnership: VideoDownloadOwnership | undefined;
  if (download) {
    const owners = await lockVideoDownloadOwners(tx, ids[0]!, command.input.articleId as string);
    if (!owners) throw new StaleOperationError("Video download subscription or material is no longer eligible");
    members.push(owners.member);
    videoDownloadOwnership = owners.ownership;
  }
  const subscriptions = [];
  for (const id of download ? [] : ids) subscriptions.push(await lockSubscription(tx, id));
  const sources = new Map<string, { enabled: boolean; execution_version: number }>();
  for (const id of [...new Set(subscriptions.flatMap((sub) => subscriptionSourceId(sub) ? [subscriptionSourceId(sub)!] : []))].sort()) {
    const [source] = await tx<{ enabled: boolean; execution_version: number }[]>`SELECT enabled, execution_version FROM sources WHERE id = ${id} FOR SHARE`;
    if (source) sources.set(id, source);
  }
  for (const sub of subscriptions) {
    const id = sub.id as number;
    const forced = ids.length === 1 && sub.control_source_id === command.forceSourceId;
    if ((!sub.enabled && !forced) || sub.active_run_id !== null) throw new StaleOperationError("Subscription disabled or occupied");
    if (sub.provider !== command.provider || sub.operation_key !== command.operationKey || sub.contract_version !== command.contractVersion) throw new StaleOperationError("Subscription contract changed");
    const sourceId = subscriptionSourceId(sub);
    if (contentSubscription(sub) && !sourceId) throw new StaleOperationError("Subscription requires an associated source");
    const source = sourceId ? sources.get(sourceId) : undefined;
    if (sourceId && !source?.enabled && !forced) throw new StaleOperationError("Source disabled");
    members.push({ subscriptionId: id, executionVersion: sub.execution_version, sourceId,
      sourceExecutionVersion: source?.execution_version ?? null });
  }
  const [run] = await tx<RunRow[]>`INSERT INTO operation_runs(actor, command_key, subscription_id, provider, operation_key,
    contract_version, input, input_hash, step_key, limits)
    VALUES (${command.actor}, ${command.commandKey}, ${ids.length === 1 ? ids[0]! : null}, ${command.provider},
    ${command.operationKey}, ${command.contractVersion}, ${tx.json({ ...command.input, members, forceSourceId: command.forceSourceId ?? null,
      ...(download ? { videoDownloadOwnership } : {}), ...(authorization?.intent.recoveryRunId ? { memberRecovery: { parentRunId: authorization.intent.recoveryRunId } } : {}) } as never)}, ${hash},
    ${command.stepKey}, ${tx.json(limits as never)}) RETURNING *`;
  if (ids.length && !download) await tx`UPDATE collection_subscriptions SET active_run_id = ${run!.id}, updated_at = now() WHERE id IN ${tx(ids)}`;
  await reserveForRun(tx, { actor: command.actor, runId: run!.id, authorization });
  if (authorization?.intent.recoveryRunId !== undefined) await tx`UPDATE operation_runs SET status='stopped',generation=generation+1,job_id=NULL,next_attempt_at=NULL,wait_reason='Continued in an owned recovery run',updated_at=now() WHERE id=${authorization.intent.recoveryRunId}`;
  return run!;
}

/** New member commands take admission before assets/origin results; result writes do not take it.
 * NO KEY UPDATE serializes admission while allowing settlement's user foreign keys. */
export async function lockMemberAdmission(tx: Tx, actor: string): Promise<{ status: string } | null> {
  const member = /^user:([1-9][0-9]*)$/.exec(actor);
  if (!member) return null;
  const [user] = await tx<{ status: string }[]>`SELECT status FROM site_users WHERE id=${member[1]} FOR NO KEY UPDATE`;
  return user ?? null;
}

/** Call before run/receipt locks when a transaction may resume tasks, including shared receipts. */
export async function lockRunAdmission(tx: Tx, runIds: number[]): Promise<void> {
  if (!runIds.length) return;
  const rows = await tx<{ actor: string }[]>`SELECT actor FROM operation_runs WHERE id IN ${tx(runIds)}`;
  for (const actor of [...new Set(rows.map(row => row.actor))].sort()) await lockMemberAdmission(tx, actor);
}

export async function lockRun(tx: Tx, id: number): Promise<{ run: RunRow; eligible: SubscriptionMember[] }> {
  // Frozen input may be read without locking; lock order is subscriptions, sources, run, receipt.
  const [snapshot] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id = ${id}`;
  if (!snapshot) throw new StaleOperationError("Operation not found");
  const eligible = snapshot.operation_key === SUBSCRIPTION_VIDEO_DOWNLOAD
    ? await eligibleVideoDownloadMembers(tx, snapshot.input.members, snapshot.input.videoDownloadOwnership)
    : await eligibleMembers(tx, id, snapshot.input.members, snapshot.input.forceSourceId);
  const [run] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id = ${id} FOR UPDATE`;
  if (!run) throw new StaleOperationError("Operation not found");
  return { run, eligible };
}

export async function requireExecution(tx: Tx, execution: Execution): Promise<RunRow> {
  const { run, eligible } = await lockRun(tx, execution.runId);
  if (!run || run.status !== "active" || run.step_version !== execution.stepVersion || run.generation !== execution.generation) throw new StaleOperationError("Operation execution is stale");
  if ((run.input.members.length || run.operation_key === SUBSCRIPTION_VIDEO_DOWNLOAD) && !eligible.length) throw new StaleOperationError("No eligible subscription members");
  await assertRunCredit(tx, run.id);
  return run;
}

/** The queue owner supplies the last observed generation; duplicate delivery loses the CAS. */
export async function claimRun(tx: Tx, expected: Execution, jobId: string): Promise<Execution> {
  await requireExecution(tx, expected);
  await tx`UPDATE operation_runs SET generation = generation + 1, job_id = ${jobId}, updated_at = now() WHERE id = ${expected.runId}`;
  return { ...expected, generation: expected.generation + 1 };
}

/** Runs in paidRequest's placeholder/reuse transaction, before any external request. */
export function receiptOptions(execution: Execution): PaidRequestOptions {
  return { beforeClaim: async (tx) => { await requireExecution(tx, execution); }, onReceipt: async (tx, receiptId) => {
    // beforeClaim owns the business locks in this same transaction.
    const [run] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id = ${execution.runId}`;
    if (!run) throw new StaleOperationError("Operation not found");
    if (run.current_receipt_id !== null && run.current_receipt_id !== receiptId) throw new Error("Consume or retain current receipt before replacing it");
    await tx`UPDATE operation_runs SET current_receipt_id = ${receiptId}, updated_at = now() WHERE id = ${run.id}`;
  } };
}

export async function saveResult(tx: Tx, execution: Execution, result: {
  itemKey: string; kind: string; data: Record<string, unknown>; receiptId?: number;
  articleId?: string; sourceId?: string; fileKey?: string;
}): Promise<number> {
  const run = await requireExecution(tx, execution);
  if (run.operation_key === SUBSCRIPTION_VIDEO_DOWNLOAD && ((result.sourceId && result.sourceId !== run.input.videoDownloadOwnership!.sourceId)
    || (result.articleId && result.articleId !== run.input.videoDownloadOwnership!.articleId))) throw new StaleOperationError("Video download result owner changed");
  if (run.operation_key !== SUBSCRIPTION_VIDEO_DOWNLOAD && result.sourceId && run.input.members.some((m) => m.sourceId === result.sourceId)) {
    const eligible = await eligibleMembers(tx, run.id, run.input.members, run.input.forceSourceId);
    if (!eligible.some((m) => m.sourceId === result.sourceId)) throw new StaleOperationError("Result source is no longer eligible");
  }
  if (result.receiptId && run.current_receipt_id !== result.receiptId && !run.progress.retainedReceiptIds?.includes(result.receiptId)) throw new Error("Receipt is not associated with this execution");
  const [row] = await tx`INSERT INTO operation_results(run_id, step_version, item_key, kind, data, receipt_id, article_id, source_id, file_key, expires_at)
    VALUES (${run.id}, ${execution.stepVersion}, ${result.itemKey}, ${result.kind}, ${tx.json(result.data as never)},
    ${result.receiptId ?? null}, ${result.articleId ?? null}, ${result.sourceId ?? null}, ${result.fileKey ?? null}, now()+interval '30 days')
    ON CONFLICT (run_id, step_version, item_key) DO UPDATE SET item_key = EXCLUDED.item_key RETURNING id`;
  return row!.id;
}

/** Preserve page context before replacing current_receipt_id with an enrichment request. */
export async function retainCurrentReceipt(tx: Tx, execution: Execution, context: Record<string, unknown>): Promise<void> {
  const run = await requireExecution(tx, execution);
  if (!run.current_receipt_id) throw new Error("No current receipt to retain");
  const progress = { ...run.progress, ...context, retainedReceiptIds: [...new Set([...(run.progress.retainedReceiptIds ?? []), run.current_receipt_id])] };
  await tx`UPDATE operation_runs SET progress = ${tx.json(progress as never)}, current_receipt_id = NULL, updated_at = now() WHERE id = ${run.id}`;
}

export async function setRunState(tx: Tx, execution: Execution, state: "waiting" | "needs_review" | "stopped" | "failed", reason: string, nextAttemptAt: Date | null = null): Promise<void> {
  await requireExecution(tx, execution);
  await tx`UPDATE operation_runs SET status = ${state}, wait_reason = ${reason}, next_attempt_at = ${nextAttemptAt}, updated_at = now() WHERE id = ${execution.runId}`;
  if (state === "failed") await releaseSubscriptions(tx, execution.runId);
  if (state !== "waiting") await settleForRun(tx, { runId: execution.runId, outcome: state, evidence: reason });
}

/** Result writes, receipt consumption and the next job must use this same caller-owned transaction. */
export async function advanceRun(tx: Tx, execution: Execution, next: { stepKey: string; progress: OperationProgress } | null): Promise<void> {
  const run = await requireExecution(tx, execution);
  if (run.current_receipt_id !== null) {
    const [consumed] = await tx`SELECT id FROM operation_results WHERE run_id = ${run.id} AND step_version = ${run.step_version} AND receipt_id = ${run.current_receipt_id} LIMIT 1`;
    if (!consumed) throw new Error("Current receipt has no committed result");
  }
  const retained = run.progress.retainedReceiptIds ?? [];
  if (next?.progress.retainedReceiptIds?.some((id) => !retained.includes(id))) throw new Error("Cannot introduce unassociated retained receipts");
  for (const id of retained.filter((id) => !next?.progress.retainedReceiptIds?.includes(id))) {
    const [consumed] = await tx`SELECT id FROM operation_results WHERE run_id = ${run.id} AND receipt_id = ${id} LIMIT 1`;
    if (!consumed) throw new Error("Unconsumed source page cannot be released");
  }
  const consumedIds = [...retained.filter((id) => !next?.progress.retainedReceiptIds?.includes(id)), ...(run.current_receipt_id ? [run.current_receipt_id] : [])];
  if (consumedIds.length) {
    const receipts = await tx`SELECT id, status FROM receipts WHERE id IN ${tx(consumedIds)} FOR UPDATE`;
    if (receipts.some((r) => !["received", "completed"].includes(r.status))) throw new Error("Receipt response is not available for consumption");
    for (const id of new Set(consumedIds)) await completeReceipt(tx, id);
  }
  await tx`UPDATE operation_runs SET status = ${next ? "active" : "completed"}, step_key = ${next?.stepKey ?? run.step_key},
    step_version = step_version + 1, progress = ${tx.json((next?.progress ?? {}) as never)}, current_receipt_id = NULL,
    job_id = NULL, next_attempt_at = NULL, wait_reason = NULL, updated_at = now() WHERE id = ${run.id}`;
  if (!next) await releaseSubscriptions(tx, run.id);
  if (!next) await settleForRun(tx, { runId: run.id, outcome: "completed" });
}

/** Explicit resume; terminal runs never regain their released subscription occupancy. */
export async function resumeRun(tx: Tx, expected: Execution): Promise<void> {
  await lockRunAdmission(tx, [expected.runId]);
  const { run, eligible } = await lockRun(tx, expected.runId);
  if (!run || !["waiting", "needs_review", "stopped"].includes(run.status) || run.step_version !== expected.stepVersion || run.generation !== expected.generation) throw new StaleOperationError("Run cannot resume");
  if ((run.input.members.length || run.operation_key === SUBSCRIPTION_VIDEO_DOWNLOAD) && !eligible.length) throw new StaleOperationError("No eligible subscription members");
  if (/^user:[1-9][0-9]*$/.test(run.actor) && run.status !== "waiting") {
    const [count] = await tx`SELECT count(*)::int AS n FROM operation_runs WHERE actor=${run.actor} AND status IN ('active','waiting')`;
    if (count!.n >= 5) throw new StaleOperationError("同时最多执行 5 个任务，请稍后恢复");
  }
  await assertRunCredit(tx, run.id);
  await tx`UPDATE operation_runs SET status = 'active' , generation = generation + 1, wait_reason = NULL,
    next_attempt_at = NULL, job_id = NULL, updated_at = now() WHERE id = ${run.id}`;
}


/** Explicit abandonment also works for stopped/invalidated runs; unknown references remain for governance. */
export async function abandonRun(tx: Tx, expected: Execution, reason: string): Promise<void> {
  const { run } = await lockRun(tx, expected.runId);
  if (["completed", "failed"].includes(run.status) || run.step_version !== expected.stepVersion || run.generation !== expected.generation) throw new StaleOperationError("Run cannot be abandoned");
  await tx`UPDATE operation_runs SET status = 'failed', wait_reason = ${reason}, next_attempt_at = NULL,
    job_id = NULL, updated_at = now() WHERE id = ${run.id}`;
  await releaseSubscriptions(tx, run.id);
  await settleForRun(tx, { runId: run.id, outcome: "failed", evidence: reason });
}
