import { lockAssetInputs } from "../../operations/assets.ts";
import type { Tx } from "../../db.ts";
import { sha256, stableJson } from "../../lib/ids.ts";
import { eligibleMembers, lockSubscription, releaseSubscriptions, type SubscriptionMember } from "../../sources/subscriptions.ts";
import { completeReceipt, type PaidRequestOptions } from "../receipts.ts";

export class StaleOperationError extends Error { readonly code = "conflict"; }
export interface Execution { runId: number; stepVersion: number; generation: number }
export interface OperationProgress extends Record<string, unknown> {
  /** Unconsumed source pages survive switching the current request to enrichment. */
  retainedReceiptIds?: number[];
}
export interface RunInput extends Record<string, unknown> { members: SubscriptionMember[]; forceSourceId?: string | null }
export interface RunRow {
  id: number; provider: string; status: string; step_key: string; step_version: number; generation: number;
  operation_key?: string; contract_version?: number;
  limits: Record<string, number>;
  input: RunInput; input_hash: string; progress: OperationProgress; current_receipt_id: number | null;
}

export async function createRun(tx: Tx, command: {
  actor: string; commandKey: string; provider: string; operationKey: string; contractVersion: number;
  input: Record<string, unknown>; stepKey: string; subscriptionIds?: number[]; limits?: Record<string, unknown>; forceSourceId?: string;
}): Promise<RunRow> {
  const ids = [...new Set(command.subscriptionIds ?? [])].sort((a, b) => a - b);
  const hash = sha256(stableJson({ ...command, subscriptionIds: ids }));
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${command.actor}:${command.commandKey}`}))`;
  const [existing] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor = ${command.actor} AND command_key = ${command.commandKey}`;
  if (existing) {
    if (existing.input_hash !== hash) throw new StaleOperationError("Command key reused with different input");
    return existing;
  }
  await lockAssetInputs(tx, command.input.fileKeys);
  const members: SubscriptionMember[] = [];
  const subscriptions = [];
  for (const id of ids) subscriptions.push(await lockSubscription(tx, id));
  const sources = new Map<string, { enabled: boolean; execution_version: number }>();
  for (const id of [...new Set(subscriptions.flatMap((sub) => sub.control_source_id ? [sub.control_source_id as string] : []))].sort()) {
    const [source] = await tx<{ enabled: boolean; execution_version: number }[]>`SELECT enabled, execution_version FROM sources WHERE id = ${id} FOR SHARE`;
    if (source) sources.set(id, source);
  }
  for (const sub of subscriptions) {
    const id = sub.id as number;
    const forced = ids.length === 1 && sub.control_source_id === command.forceSourceId;
    if ((!sub.enabled && !forced) || sub.active_run_id !== null) throw new StaleOperationError("Subscription disabled or occupied");
    if (sub.provider !== command.provider || sub.operation_key !== command.operationKey || sub.contract_version !== command.contractVersion) throw new StaleOperationError("Subscription contract changed");
    const source = sources.get(sub.control_source_id);
    if (sub.control_source_id && !source?.enabled && !forced) throw new StaleOperationError("Source disabled");
    members.push({ subscriptionId: id, executionVersion: sub.execution_version, sourceId: sub.control_source_id,
      sourceExecutionVersion: source?.execution_version ?? null });
  }
  const [run] = await tx<RunRow[]>`INSERT INTO operation_runs(actor, command_key, subscription_id, provider, operation_key,
    contract_version, input, input_hash, step_key, limits)
    VALUES (${command.actor}, ${command.commandKey}, ${ids.length === 1 ? ids[0]! : null}, ${command.provider},
    ${command.operationKey}, ${command.contractVersion}, ${tx.json({ ...command.input, members, forceSourceId: command.forceSourceId ?? null } as never)}, ${hash},
    ${command.stepKey}, ${tx.json((command.limits ?? {}) as never)}) RETURNING *`;
  if (ids.length) await tx`UPDATE collection_subscriptions SET active_run_id = ${run!.id}, updated_at = now() WHERE id IN ${tx(ids)}`;
  return run!;
}

export async function lockRun(tx: Tx, id: number): Promise<{ run: RunRow; eligible: SubscriptionMember[] }> {
  // Frozen input may be read without locking; lock order is subscriptions, sources, run, receipt.
  const [snapshot] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id = ${id}`;
  if (!snapshot) throw new StaleOperationError("Operation not found");
  const eligible = await eligibleMembers(tx, id, snapshot.input.members, snapshot.input.forceSourceId);
  const [run] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id = ${id} FOR UPDATE`;
  if (!run) throw new StaleOperationError("Operation not found");
  return { run, eligible };
}

export async function requireExecution(tx: Tx, execution: Execution): Promise<RunRow> {
  const { run, eligible } = await lockRun(tx, execution.runId);
  if (!run || run.status !== "active" || run.step_version !== execution.stepVersion || run.generation !== execution.generation) throw new StaleOperationError("Operation execution is stale");
  if (run.input.members.length && !eligible.length) throw new StaleOperationError("No eligible subscription members");
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
  if (result.sourceId && run.input.members.some((m) => m.sourceId === result.sourceId)) {
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
}

/** Explicit resume; terminal runs never regain their released subscription occupancy. */
export async function resumeRun(tx: Tx, expected: Execution): Promise<void> {
  const { run, eligible } = await lockRun(tx, expected.runId);
  if (!run || !["waiting", "needs_review", "stopped"].includes(run.status) || run.step_version !== expected.stepVersion || run.generation !== expected.generation) throw new StaleOperationError("Run cannot resume");
  if (run.input.members.length && !eligible.length) throw new StaleOperationError("No eligible subscription members");
  await tx`UPDATE operation_runs SET status = 'active', generation = generation + 1, wait_reason = NULL,
    next_attempt_at = NULL, job_id = NULL, updated_at = now() WHERE id = ${run.id}`;
}


/** Explicit abandonment also works for stopped/invalidated runs; unknown references remain for governance. */
export async function abandonRun(tx: Tx, expected: Execution, reason: string): Promise<void> {
  const { run } = await lockRun(tx, expected.runId);
  if (["completed", "failed"].includes(run.status) || run.step_version !== expected.stepVersion || run.generation !== expected.generation) throw new StaleOperationError("Run cannot be abandoned");
  await tx`UPDATE operation_runs SET status = 'failed', wait_reason = ${reason}, next_attempt_at = NULL,
    job_id = NULL, updated_at = now() WHERE id = ${run.id}`;
  await releaseSubscriptions(tx, run.id);
}
