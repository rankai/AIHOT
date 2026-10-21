import type { Tx } from "../db.ts";

export interface SubscriptionMember {
  subscriptionId: number;
  executionVersion: number;
  sourceId: string | null;
  sourceExecutionVersion: number | null;
}

/** Called inside the run creation transaction, in ascending subscription ID order. */
export async function lockSubscription(tx: Tx, id: number) {
  const [row] = await tx`SELECT * FROM collection_subscriptions WHERE id = ${id} FOR UPDATE`;
  if (!row) throw new Error("Subscription not found");
  return row;
}

export async function releaseSubscriptions(tx: Tx, runId: number): Promise<void> {
  await tx`UPDATE collection_subscriptions SET active_run_id = NULL, updated_at = now() WHERE active_run_id = ${runId}`;
}

/** Locks current permission/configuration owners; no permission is copied into a run. */
export async function eligibleMembers(tx: Tx, runId: number, members: SubscriptionMember[], forceSourceId: string | null = null): Promise<SubscriptionMember[]> {
  const eligible: SubscriptionMember[] = [];
  const subscriptions = new Map<number, Awaited<ReturnType<typeof lockSubscription>>>();
  for (const member of [...members].sort((a, b) => a.subscriptionId - b.subscriptionId)) {
    subscriptions.set(member.subscriptionId, await lockSubscription(tx, member.subscriptionId));
  }
  const sources = new Map<string, { enabled: boolean; execution_version: number }>();
  for (const id of [...new Set(members.flatMap((m) => m.sourceId ? [m.sourceId] : []))].sort()) {
    const [source] = await tx<{ enabled: boolean; execution_version: number }[]>`SELECT enabled, execution_version FROM sources WHERE id = ${id} FOR SHARE`;
    if (source) sources.set(id, source);
  }
  for (const member of members) {
    const sub = subscriptions.get(member.subscriptionId)!;
    const forced = members.length === 1 && member.sourceId === forceSourceId && forceSourceId !== null;
    if ((!sub.enabled && !forced) || sub.active_run_id !== runId || sub.execution_version !== member.executionVersion || sub.control_source_id !== member.sourceId) continue;
    if (member.sourceId) {
      const source = sources.get(member.sourceId);
      if ((!source?.enabled && !forced) || source?.execution_version !== member.sourceExecutionVersion) continue;
    }
    eligible.push(member);
  }
  return eligible;
}

export async function createSubscription(tx: Tx, input: {
  sourceId?: string; provider: string; platform: string; operationKey: string; contractVersion: number;
  config: Record<string, unknown>; intervalMinutes: number; enabled?: boolean; limits?: Record<string, unknown>;
}): Promise<number> {
  const [row] = await tx`INSERT INTO collection_subscriptions(control_source_id, provider, platform, operation_key,
    contract_version, config, interval_minutes, enabled, limits)
    VALUES (${input.sourceId ?? null}, ${input.provider}, ${input.platform}, ${input.operationKey}, ${input.contractVersion},
    ${tx.json(input.config as never)}, ${input.intervalMinutes}, ${input.enabled ?? false}, ${tx.json((input.limits ?? {}) as never)}) RETURNING id`;
  return row!.id;
}
