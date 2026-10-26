import type { Tx } from "../db.ts";
import { lockSubscription, type SubscriptionMember } from "./subscriptions.ts";

export const SUBSCRIPTION_VIDEO_DOWNLOAD = "subscription.video.download";
export interface VideoDownloadOwnership {
  articleId: string;
  identityKey: string;
  sourceId: string;
  sourceExecutionVersion: number;
  collector: string;
}

/** Subscription → control/author sources → material → run, including platform subscriptions
 * without a control source. A download never acquires the collector's active_run_id. */
export async function lockVideoDownloadOwners(tx: Tx, subscriptionId: number, articleId: string): Promise<{
  member: SubscriptionMember; ownership: VideoDownloadOwnership;
} | null> {
  const sub = await lockSubscription(tx, subscriptionId);
  if (!sub.enabled || sub.config.autoDownloadVideo !== true) return null;
  const [snapshot] = await tx`SELECT source_id FROM articles WHERE id = ${articleId}`;
  if (!snapshot) return null;
  const sources = new Map<string, { enabled: boolean; execution_version: number }>();
  for (const id of [...new Set([sub.control_source_id, snapshot.source_id].filter((id): id is string => typeof id === "string"))].sort()) {
    const [source] = await tx<{ enabled: boolean; execution_version: number }[]>`SELECT enabled, execution_version FROM sources WHERE id = ${id} FOR SHARE`;
    if (!source?.enabled) return null;
    sources.set(id, source);
  }
  const [article] = await tx`SELECT source_id, identity_key FROM articles WHERE id = ${articleId} FOR SHARE`;
  if (!article || article.source_id !== snapshot.source_id || !sources.has(article.source_id)) return null;
  return {
    member: { subscriptionId, executionVersion: sub.execution_version, sourceId: sub.control_source_id,
      sourceExecutionVersion: sources.get(sub.control_source_id)?.execution_version ?? null },
    ownership: { articleId, identityKey: article.identity_key, sourceId: article.source_id,
      sourceExecutionVersion: sources.get(article.source_id)!.execution_version, collector: sub.provider },
  };
}

export async function eligibleVideoDownloadMembers(tx: Tx, members: SubscriptionMember[], ownership: VideoDownloadOwnership | undefined): Promise<SubscriptionMember[]> {
  // Fail closed for malformed legacy/manual rows; an empty member set is never authorization.
  if (members.length !== 1 || !ownership || typeof ownership.articleId !== "string") return [];
  const current = await lockVideoDownloadOwners(tx, members[0]!.subscriptionId, ownership.articleId);
  const member = members[0]!;
  if (!current || current.member.executionVersion !== member.executionVersion || current.member.sourceId !== member.sourceId
    || current.member.sourceExecutionVersion !== member.sourceExecutionVersion
    || current.ownership.identityKey !== ownership.identityKey || current.ownership.sourceId !== ownership.sourceId
    || current.ownership.sourceExecutionVersion !== ownership.sourceExecutionVersion || current.ownership.collector !== ownership.collector) return [];
  return [member];
}
