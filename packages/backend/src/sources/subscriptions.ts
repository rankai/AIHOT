import type {SourceRow} from "./types.ts";
import type { Db, Tx } from "../db.ts";

const researchSubscriptionOperations = new Set([
  "UAQ90A1F", "9Y4EX7RW", "W94P1QH1", "S28Q6HUD",
  "douyin.trending", "douyin.comments", "douyin.comment_replies", "douyin.following",
  "toutiao.comments", "xiaohongshu.recommendations", "xiaohongshu.comments", "weibo.comments", "weibo.following", "weibo.related_search",
  "bilibili.dynamics", "bilibili.comments", "bilibili.comment_replies", "bilibili.relation_stats", "bilibili.trending", "bilibili.hot_search",
  "ABJQXHUE", "x.followers", "5QY3G5TY", "x.trending", "x.list_members", "x.community_members",
]);

/** Research snapshots do not require a material owner; work lists do. */
export function contentSubscription(sub: { platform?: unknown; config: Record<string, unknown> }): boolean {
  return typeof sub.config.operationId === "string" && sub.platform !== "hot-research" && !researchSubscriptionOperations.has(sub.config.operationId);
}

/** The control column belongs only to native main subscriptions. */
export function subscriptionSourceId(sub: { control_source_id?: unknown; config: Record<string, unknown> }): string | null {
  if (typeof sub.control_source_id === "string") return sub.control_source_id;
  return typeof sub.config.sourceId === "string" && sub.config.sourceId.length > 0 ? sub.config.sourceId : null;
}

export interface SubscriptionMember {
  subscriptionId: number;
  executionVersion: number;
  sourceId: string | null;
  sourceExecutionVersion: number | null;
}

/** Called inside the run creation transaction, in ascending subscription ID order. */
export async function lockSubscription(tx: Tx, id: number) {
  const [row] = await tx<{ id: number; control_source_id: string | null; config: Record<string, unknown>; platform: string; provider: string; operation_key: string; contract_version: number; enabled: boolean; execution_version: number; active_run_id: number | null }[]>`SELECT * FROM collection_subscriptions WHERE id = ${id} FOR UPDATE`;
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
    const forced = members.length === 1 && sub.control_source_id === forceSourceId && member.sourceId === forceSourceId && forceSourceId !== null;
    if ((!sub.enabled && !forced) || sub.active_run_id !== runId || sub.execution_version !== member.executionVersion || subscriptionSourceId(sub) !== member.sourceId || (contentSubscription(sub) && !member.sourceId)) continue;
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
  const owner = input.sourceId ?? (typeof input.config.sourceId === "string" ? input.config.sourceId : null);
  if (owner) {
    const [source] = await tx`SELECT id FROM sources WHERE id=${owner} FOR SHARE`;
    if (!source) throw new Error("Associated source not found");
  }
  const [row] = await tx`INSERT INTO collection_subscriptions(control_source_id, provider, platform, operation_key,
    contract_version, config, interval_minutes, enabled, limits)
    VALUES (${input.sourceId ?? null}, ${input.provider}, ${input.platform}, ${input.operationKey}, ${input.contractVersion},
    ${tx.json(input.config as never)}, ${input.intervalMinutes}, ${input.enabled ?? false}, ${tx.json((input.limits ?? {}) as never)}) RETURNING id`;
  return row!.id;
}

/** Explicit detail queries keep their own identity. Follow only server-validated,
 * same-provider work origins, backwards through run IDs, to display/use frozen owners. */
export async function inheritedSourceMembers(db: Db, input: {members?: SubscriptionMember[]; forceSourceId?: string | null; origin?: {resultId?: number; sourceResultId?: number}}, provider: string, runId: number): Promise<{members: SubscriptionMember[]; forceSourceId: string | null} | null> {
  let current=input,currentRunId=runId;
  while (!current.members?.length && (current.origin?.resultId ?? current.origin?.sourceResultId) !== undefined) {
    const originId=current.origin?.resultId??current.origin?.sourceResultId;
    if (!Number.isSafeInteger(originId)) return null;
    const [parent]=await db`SELECT z.kind,r.id,r.input FROM operation_results z JOIN operation_runs r ON r.id=z.run_id WHERE z.id=${originId!} AND r.provider=${provider} AND r.id<${currentRunId}`;
    if (!parent || !String(parent.kind).endsWith("_work")) return null;
    current=parent.input;currentRunId=parent.id;
  }
  return {members:current.members??[],forceSourceId:current.forceSourceId??null};
}

/** Lock an import's frozen owners without requiring an already-completed run to
 * still occupy the subscription. Null means missing, changed or disabled ownership.
 * A legacy/query result with no frozen source requires an explicit administrator choice. */
export async function importSource(tx: Tx, members: SubscriptionMember[], explicitSourceId?: string, forceSourceId: string | null = null, verifiedOrigin?: {resultId:number;provider:string;runId:number}): Promise<(SourceRow & {execution_version:number}) | null> {
  if (!members.length && verifiedOrigin) {
    const inherited=await inheritedSourceMembers(tx,{origin:{resultId:verifiedOrigin.resultId}},verifiedOrigin.provider,verifiedOrigin.runId);
    return inherited?importSource(tx,inherited.members,explicitSourceId,inherited.forceSourceId):null;
  }
  const ordered = [...members].sort((a, b) => a.subscriptionId - b.subscriptionId);
  const subscriptions = new Map<number, Awaited<ReturnType<typeof lockSubscription>>>();
  for (const member of ordered) subscriptions.set(member.subscriptionId, await lockSubscription(tx, member.subscriptionId));
  const frozen = [...new Set(members.flatMap(member => member.sourceId ? [member.sourceId] : []))];
  if (frozen.length > 1 || (explicitSourceId && frozen.length && explicitSourceId !== frozen[0])) return null;
  const sourceId = frozen[0] ?? explicitSourceId;
  if (!sourceId) return null;
  const [source] = await tx<(SourceRow & {execution_version:number})[]>`SELECT * FROM sources WHERE id=${sourceId} FOR SHARE`;
  const forced = members.length === 1 && members[0]!.sourceId === forceSourceId && forceSourceId !== null
    && subscriptions.get(members[0]!.subscriptionId)!.control_source_id === forceSourceId;
  if (!source || (!source.enabled && !forced)) return null;
  for (const member of members) {
    // Legacy unowned results may be explicitly imported after their subscription
    // was repaired; never take the repair's source as evidence for this old run.
    if (!member.sourceId) continue;
    const sub = subscriptions.get(member.subscriptionId)!;
    if ((!sub.enabled && !forced) || sub.execution_version !== member.executionVersion || subscriptionSourceId(sub) !== member.sourceId
      || source.execution_version !== member.sourceExecutionVersion) return null;
  }
  return source;
}

/** Hold this lock until deletion finishes. SHARE locks used by association commands
 * serialize the JSON reference, while publication foreign keys can still KEY SHARE. */
export async function lockSourceDeletion(tx: Tx, ids: string[]): Promise<void> {
  const ordered = [...new Set(ids)].sort();
  if (!ordered.length) return;
  await tx`SELECT id FROM sources WHERE id IN ${tx(ordered)} ORDER BY id FOR NO KEY UPDATE`;
  const [reference] = await tx`SELECT id FROM collection_subscriptions WHERE control_source_id IN ${tx(ordered)} OR config->>'sourceId' IN ${tx(ordered)} LIMIT 1`;
  const [run] = await tx`SELECT id FROM operation_runs WHERE status NOT IN ('completed','failed','stopped') AND
    (input->'videoDownloadOwnership'->>'sourceId' IN ${tx(ordered)} OR EXISTS
      (SELECT 1 FROM jsonb_array_elements(input->'members') m WHERE m->>'sourceId' IN ${tx(ordered)})) LIMIT 1`;
  const [binding] = await tx`SELECT source_id FROM source_account_bindings WHERE source_id IN ${tx(ordered)} LIMIT 1`;
  const [result] = await tx`SELECT z.id FROM operation_results z LEFT JOIN articles a ON a.id=z.article_id WHERE z.source_id IN ${tx(ordered)} OR a.source_id IN ${tx(ordered)} LIMIT 1`;
  if (reference || run || binding || result) throw new Error("Source is referenced by a subscription, operation result or account binding; disable it instead");
}
