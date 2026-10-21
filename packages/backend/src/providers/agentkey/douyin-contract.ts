import { z } from "zod";

/** Catalog snapshot, official V4 docs and a verified read-only response; no date/sort/transcript guarantees. */
export const douyinSearchRoute = {
  operationKey: "agentkey.douyin.search", stepKey: "agentkey.douyin.search.query", contractVersion: 1,
  provider: "agentkey", upstream: "TikHub", recovery: "readOnly", estimatedCredits: 0.2,
  tool: "TikHub/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post",
  evidence: "docs/reviews/2026-10-21-agentkey-output-evidence.md#t1-抖音搜索",
} as const;

export const douyinSearchInput = z.strictObject({
  keyword: z.string().trim().min(1),
  cursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});
export type DouyinSearchInput = z.input<typeof douyinSearchInput>;

/** The only implemented AgentKey execution/recovery profile. Never infer from prefixes. */
export function agentKeyRouteFor(run: { provider: string; operation_key?: string; step_key: string; contract_version?: number }) {
  return run.provider === douyinSearchRoute.provider && run.operation_key === douyinSearchRoute.operationKey
    && run.step_key === douyinSearchRoute.stepKey && run.contract_version === douyinSearchRoute.contractVersion ? douyinSearchRoute : undefined;
}
export function agentKeyOutboundAllowed(run: Parameters<typeof agentKeyRouteFor>[0] & { input: Record<string, unknown> }, env: NodeJS.ProcessEnv = process.env) {
  return !!agentKeyRouteFor(run) && env.AGENTKEY_CALLS_ENABLED === "true"
    && (run.input.mode !== "collection" || env.COLLECT_ENABLED !== "false");
}

export const douyinKeywordInput = z.strictObject({keyword: z.string().trim().min(1)});
export const douyinProviderVariant = {
  id: "agentkey", label: "AgentKey · TikHub",
  fields: [{name:"keyword",label:"关键词",type:"string",required:true}],
  purpose: "TikHub 抖音 V4 搜索；仅关键词，不支持日期、排序、精确匹配、转写或详情补全",
  collectionPrice: {amount:0.2,currency:"credits",basis:"estimated"},
  collectionCapabilities: {detailEnrichment:false,detailOperations:[]},
} as const;
