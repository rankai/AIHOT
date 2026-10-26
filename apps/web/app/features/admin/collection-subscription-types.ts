export interface CollectionSubscriptionConfig {
  name: string; provider: string; operationId: string; parameters: Record<string, string | number | boolean | string[] | number[]>; enabled: boolean;
  autoDownloadVideo?: boolean; intervalMinutes: number; enrichDetails: boolean; detailOperationId?: string; detailPage?: number; limits: { pages: number; items: number; details: number };
}
export interface CollectionSubscription extends Omit<CollectionSubscriptionConfig, "detailOperationId" | "detailPage"> {
  detailOperationId?: string | null; detailPage?: number | null;
  platform: string; id: number; editVersion: number; executionVersion: number; nextRunAt: string | null;
  videoDownloads?: import("./subscription-video-data.ts").VideoDownloadLatest | null;
  activeRun: { id: number; status: string; step: string; waitReason: string | null } | null;
}
export function subscriptionExecutionChanges(before: CollectionSubscriptionConfig | CollectionSubscription, after: CollectionSubscriptionConfig) {
  const target = (value: CollectionSubscriptionConfig | CollectionSubscription) => value.detailOperationId ?? (value.operationId === "TXQPVGJG" && value.enrichDetails ? "API_1789098514899" : undefined);
  return before.provider !== after.provider || before.operationId !== after.operationId || before.enabled !== after.enabled || before.enrichDetails !== after.enrichDetails || (before.autoDownloadVideo ?? false) !== (after.autoDownloadVideo ?? false)
    || target(before) !== target(after) || (before.detailPage ?? undefined) !== after.detailPage
    || [...new Set([...Object.keys(before.parameters), ...Object.keys(after.parameters)])].some(key => JSON.stringify(before.parameters[key]) !== JSON.stringify(after.parameters[key]))
    || (["pages", "items", "details"] as const).some(key => before.limits[key] !== after.limits[key]);
}
