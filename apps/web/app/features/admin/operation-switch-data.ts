export type MpLibrary = "wide" | "premium";
export type CollectionTarget = "redfox" | "socialdata" | "dajiala";
export interface CollectionPreflight {
  sourceId: string; target: CollectionTarget; library?: MpLibrary; mappingVersion: number; sourceVersion: string;
  subscriptionVersion: number | null; supported: boolean; mapping: Record<string, unknown>;
  checks: Array<{ key: string; source: string; conclusion: "supported" | "unsupported" | "unverified" | "unavailable"; evidence: string }>;
  impact?: { firstImport?: boolean; firstImportNote?: string | null; delay: "T+1" | null; intervalMinutes: number; activeRunId: number | null; sourceId: string; subscriptionId: number | null; note: string };
}
export const mpLibraryLabel: Record<MpLibrary, string> = { wide: "广域库", premium: "优质库" };
export const mpCollectionCost = "正常流程最多 1 次列表 + 8 次正文，按文档基价约 0.04–0.36 元；缓存复用与重试会影响请求数及估算，实际实扣未核对，受 collect 次数预算控制，重试也计入预算。";
export function collectionTargets(kind: string): CollectionTarget[] {
  return kind === "mp_account" ? ["redfox", "dajiala"] : kind === "x_search" ? ["redfox", "socialdata"] : [];
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
    && (source.kind !== "mp_account" || preflight.library === library);
}
