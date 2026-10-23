export type MpLibrary = "wide" | "premium";
export type CollectionTarget = "redfox" | "socialdata" | "dajiala" | "agentkey";
export interface CollectionPreflight {
  sourceId: string; target: CollectionTarget; library?: MpLibrary | null; mappingVersion: number; sourceVersion: string;
  subscriptionVersion: number | null; supported: boolean; mapping: Record<string, unknown>;
  checks: Array<{ key: string; source: string; conclusion: "supported" | "unsupported" | "unverified" | "unavailable"; evidence: string }>;
  impact?: { firstImport?: boolean; firstImportNote?: string | null; delay: string | null; intervalMinutes: number; activeRunId: number | null; sourceId: string; subscriptionId: number | null; note: string };
}
export const mpLibraryLabel: Record<MpLibrary, string> = { wide: "广域库", premium: "优质库" };
export const mpCollectionCost = "正常流程最多 1 次列表 + 8 次正文，按文档基价约 0.04–0.36 元；缓存复用与重试会影响请求数及估算，实际实扣未核对，受 collect 次数预算控制，重试也计入预算。";
export const mpAgentKeyCost = "AgentKey · TikHub 每次估算 2 credits；正常流程最多 1 次列表 + 8 次必要详情，合计最多 18 credits。缓存复用与重试影响请求数，重试仍计预算；实际扣费以回执为准。";
export function collectionTargets(kind: string): CollectionTarget[] {
  return kind === "mp_account" ? ["redfox", "dajiala", "agentkey"] : kind === "x_search" ? ["redfox", "socialdata"] : [];
}
export function mpLibrary(value: unknown): MpLibrary | null {
  return value === "wide" || value === "premium" ? value : null;
}
export function sameCollectionTarget(kind: string, provider: string | null, target: CollectionTarget, savedLibrary: unknown, selectedLibrary: MpLibrary): boolean {
  return provider === target && (kind !== "mp_account" || target !== "redfox" || savedLibrary === selectedLibrary);
}
export function collectionPreflightMatches(preflight: CollectionPreflight, source: { id: string; kind: string; version: string; subscriptionVersion: number | null }, library: MpLibrary): boolean {
  return preflight.sourceId === source.id && collectionTargets(source.kind).includes(preflight.target)
    && preflight.sourceVersion === new Date(source.version).toISOString() && preflight.subscriptionVersion === source.subscriptionVersion
    && (source.kind !== "mp_account" || preflight.target !== "redfox" || preflight.library === library);
}
