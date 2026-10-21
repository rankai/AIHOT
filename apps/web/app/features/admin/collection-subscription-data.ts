import { defaultPlatformValues, type PlatformOperation } from "./platform-types.ts";
import { platformQueryParameters } from "./platform-query-data.ts";
import type { CollectionSubscription, CollectionSubscriptionConfig } from "./collection-subscription-types.ts";
import { researchFactText } from "./research-platform-data.ts";
import { beijingDate, addDays } from "@aihot/contracts/time";
import type { PlatformCollectionProviderPreflight } from "@aihot/contracts/redfox";
const hotSnapshotIds = ["9Y4EX7RW", "W94P1QH1", "S28Q6HUD"];
export function isHotSnapshot(operation: PlatformOperation) { return operation.platform === "hot-research" && hotSnapshotIds.includes(operation.id); }
export function providerOperation(operation: PlatformOperation,provider:string):PlatformOperation {
  const variant=operation.collectionProviders?.find(option=>option.id===provider);
  return variant?.fields?{...operation,fields:variant.fields,purpose:variant.purpose??operation.purpose,collectionPrice:variant.collectionPrice,collectionCapabilities:variant.collectionCapabilities}:operation;
}
export function collectionFormOperation(operation: PlatformOperation) {
  return isHotSnapshot(operation) ? { ...operation, fields: operation.fields.filter(field => field.name !== "startDate" && field.name !== "endDate") } : operation;
}
export interface CollectionSeed { provider?:string; operationId: string; values: Record<string, string>; sequence: number }
export function collectionSubscriptionsHref(id: number | null = null) {
  return `/admin/sources?${new URLSearchParams({ view: "collections", ...(id ? { subscription: String(id) } : {}) })}`;
}
export function collectionSeedNavigation(operationId: string, values: Record<string, string>,provider?:string) {
  const filters = hotSnapshotIds.includes(operationId) ? Object.fromEntries(Object.entries(values).filter(([key]) => key !== "startDate" && key !== "endDate")) : { ...values };
  return { to: collectionSubscriptionsHref(), state: { collectionSeed: { ...(provider?{provider}:{}),operationId, values: filters, sequence: Date.now() } satisfies CollectionSeed } };
}
export function collectionSeedFromState(state: unknown): CollectionSeed | null {
  if (!state || typeof state !== "object" || !("collectionSeed" in state)) return null;
  const seed = state.collectionSeed;
  if (!seed || typeof seed !== "object" || !("operationId" in seed) || typeof seed.operationId !== "string" ||
    !("sequence" in seed) || typeof seed.sequence !== "number" || !("values" in seed) || !seed.values || typeof seed.values !== "object" || Array.isArray(seed.values) || Object.values(seed.values).some(value => typeof value !== "string")) return null;
  return { ...("provider" in seed&&typeof seed.provider==="string"?{provider:seed.provider}:{}),operationId: seed.operationId, sequence: seed.sequence, values: { ...seed.values } as Record<string, string> };
}
export interface CollectionDraft { name: string; provider: string; values: Record<string, string>; enabled: boolean; intervalMinutes: number; enrichDetails: boolean; detailOperationId: string; detailPage: string; pages: number; items: number; details: number }
export function isCollectionOperation(operation: PlatformOperation) { return ["search", "trend", "list"].includes(operation.schedulableType ?? ""); }
export function collectionProviders(operation: PlatformOperation) {
  return operation.collectionProviders ?? [{ id: "redfox", label: "Redfox" }];
}
export function collectionProviderLabel(operation: PlatformOperation, provider: string) {
  return collectionProviders(operation).find(option => option.id === provider)?.label ?? provider;
}
export function collectionInputIssue(operation: PlatformOperation, values: Record<string, string>): string | null {
  return operation.platform === "x-research" && operation.id === "5K5EG87P" && !["", "Top", "Latest"].includes((values.searchType ?? "").trim()) ? "X 搜索采集订阅仅支持 Top / Latest；Media、People、Lists 可继续单次查询。" : null;
}
export function collectionOperations(operations: readonly PlatformOperation[]) { return operations.filter(isCollectionOperation); }
export function isWeiboSnapshot(operation: PlatformOperation) { return operation.platform === "weibo" && operation.id === "UAQ90A1F"; }
export function collectionDetailsAvailable(operation: PlatformOperation) { return operation.collectionCapabilities?.detailEnrichment === true; }
export type CollectionDetailOperation = NonNullable<NonNullable<PlatformOperation["collectionCapabilities"]>["detailOperations"]>[number];
export function collectionDetailOperations(operation: PlatformOperation, values?: Record<string, string>) {
  const choices = operation.collectionCapabilities?.detailEnrichment ? operation.collectionCapabilities.detailOperations ?? [] : [];
  if (!values) return choices;
  const type = values.sourceType?.trim();
  if (operation.id === "CI7VW144") return choices.filter(choice => choice.operationId === (type === "video" ? "TE6AGWAF" : type === "article" ? "LLCI8QTE" : ""));
  if (operation.id === "YIGCY5US") return choices.filter(choice => choice.operationId === (type === "shipin" ? "3BXWEB6Y" : type === "xinwen" ? "VYSP68M2" : ""));
  return choices;
}
export function collectionLegacyDetail(operation: PlatformOperation, initial: CollectionSubscription | null) {
  const choices = collectionDetailOperations(operation);
  return initial?.operationId === "TXQPVGJG" && operation.id === "TXQPVGJG" && initial.enrichDetails && !initial.detailOperationId && choices.length === 1 && choices[0]?.operationId === "API_1789098514899" ? choices[0] : null;
}
export function collectionDetailPriceNote(choice: CollectionDetailOperation | null | undefined) {
  return choice?.price && typeof choice.price.amount === "number" ? `详情文档估算 ${choice.price.amount} ${choice.price.currency}/请求，非实扣、非整轮总价。` : "详情请求估价未知，以 collect 次数预算与回执为准。";
}
export function collectionDraft(operation: PlatformOperation, initial: CollectionSubscription | null = null, seed?: CollectionSeed | null): CollectionDraft {
  const sameOperation = initial?.operationId === operation.id;
  const hot = isHotSnapshot(operation), defaults = defaultPlatformValues(collectionFormOperation(operation)), providers = collectionProviders(operation);
  return { name: initial?.name ?? "", provider: sameOperation ? initial.provider : seed?.provider??providers[0]?.id ?? "", values: sameOperation ? Object.fromEntries(Object.entries(initial.parameters).map(([key, value]) => [key, Array.isArray(value) ? value.join("\n") : String(value)])) : seed?.operationId === operation.id ? { ...defaults, ...seed.values } : defaults, enabled: initial?.enabled ?? false, intervalMinutes: initial?.intervalMinutes ?? (hot ? 60 : 15), enrichDetails: sameOperation ? initial.enrichDetails : false, detailOperationId: sameOperation ? initial.detailOperationId ?? collectionLegacyDetail(operation, initial)?.operationId ?? "" : "", detailPage: sameOperation && initial.detailPage != null ? String(initial.detailPage) : "", pages: sameOperation ? initial.limits.pages : hot ? 1 : 3, items: sameOperation ? initial.limits.items : 100, details: sameOperation ? initial.limits.details : operation.platform === "weibo" || collectionDetailsAvailable(operation) ? 20 : 0 };
}
export function collectionConfig(operation: PlatformOperation, draft: CollectionDraft, lockedPlatform?: string): CollectionSubscriptionConfig {
  operation=providerOperation(operation,draft.provider);
  if (!isCollectionOperation(operation)) throw new Error("请选择已接通定时采集的操作。");
  if (lockedPlatform && lockedPlatform !== operation.platform) throw new Error("已有订阅不能切换平台，请另建订阅。");
  if (!collectionProviders(operation).some(provider => provider.id === draft.provider)) throw new Error("当前采集任务不支持所选供应商。");
  const issue = collectionInputIssue(operation, draft.values);
  if (issue) throw new Error(issue);
  const parameters = platformQueryParameters(collectionFormOperation(operation), draft.values);
  if (operation.platform === "weibo" && parameters.searchType === "3") throw new Error("账号搜索类别不能用于定时材料采集。");
  if (!draft.name.trim()) throw new Error("请填写订阅名称。");
  for (const [label, value, min, max] of [["周期", draft.intervalMinutes, 1, 10080], ["页数", draft.pages, 1, 10], ["条目数", draft.items, 1, 500], ["详情数", draft.details, 0, 100]] as const) if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}超出允许范围。`);
  const enrichDetails = collectionDetailsAvailable(operation) && draft.enrichDetails;
  const target = enrichDetails ? collectionDetailOperations(operation, draft.values).find(choice => choice.operationId === draft.detailOperationId) : undefined;
  if (enrichDetails && !target) throw new Error("请选择当前采集条件已接通的详情目标；不会自动选库或回退。");
  let detailPage: number | undefined;
  if (target?.operationId === "LLCI8QTE") {
    const rawPage = draft.detailPage.trim();
    if (!/^-?\d+$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage))) throw new Error("请显式填写车家号详情页码（安全整数），没有默认页码。");
    detailPage = Number(rawPage);
  }
  return { name: draft.name.trim(), provider: draft.provider, operationId: operation.id, parameters, enabled: draft.enabled, intervalMinutes: draft.intervalMinutes, enrichDetails, ...(target ? { detailOperationId: target.operationId } : {}), ...(detailPage !== undefined ? { detailPage } : {}), limits: { pages: draft.pages, items: draft.items, details: draft.details } };
}
export function collectionPagingNote(operation: PlatformOperation, values: Record<string, string>) {
  if (isHotSnapshot(operation)) return "每轮查询一次研究快照，不翻页、不补全详情，也不自动成为文章；条目上限可能截断本次返回记录，TOP10 以聚合组计条目。";
  if (isWeiboSnapshot(operation)) return "微博热搜每轮只保存一次研究快照，不作为文章，不使用分页或详情补全限额。";
  if (operation.id === "3X8FGEEM") return values.keyword?.trim() ? "带关键词时本轮只查询一页，页码与每页条数不用于续页。作品候选与相关话题、推荐研究分别保存。" : "无关键词时可按已确认的 pageNum 规则继续查询；最多页数仍是上限，不保证有后页。作品候选与研究分别保存。";
  return "最多页数只是已接通分页的上限，不保证有后页；没有分页或尚未确认续页的接口每轮只查询一次。实际查询范围以任务结果为准。";
}
export function collectionPriceNote(operation: PlatformOperation) {
  const price = operation.collectionPrice;
  return price && typeof price.amount === "number" ? `本地公开估价 ${price.amount} ${price.currency}/请求（估算，非实扣），不是整轮总价。` : "当前请求估价未知，请查看 collect 次数预算与回执。";
}
export function collectionSummaryRows(data: Record<string, unknown>): Array<[string, string]> {
  if (!Object.hasOwn(data, "selectedResearchCount") && !Object.hasOwn(data, "returnedPage")) return [];
  const snapshot = data.operationId === "UAQ90A1F" || data.platform === "hot-research";
  const fields = [["page", "本地页号"], ["count", "本页实际返回条目"], ["workCount", "本页作品候选"], ["selectedCount", snapshot ? "本页选取快照" : "本页选入作品候选"], ["processedCount", snapshot ? "本页已处理快照" : "本页已处理作品候选"], ["researchCount", "本页研究记录"], ["selectedResearchCount", "本页选入研究记录"], ["unprocessedDueToLimit", snapshot ? "因限额未选快照" : "因限额未选作品候选"], ["unprocessedResearchDueToLimit", "因限额未选研究记录"], ["truncated", "本页限额截断"]];
  return fields.flatMap(([key, label]) => Object.hasOwn(data, key!) ? [[label!, researchFactText(data[key!])]] as Array<[string, string]> : []);
}

/** Collection-page facts must be selected before any platform's one-off query summary. */
export function collectionPageSummary(kind: string, data: Record<string, unknown>) {
  if (kind !== "query_summary" || (!Object.hasOwn(data, "selectedResearchCount") && !Object.hasOwn(data, "returnedPage"))) return null;
  const fields = (key: string): Array<[string, string]> => {
    if (!Object.hasOwn(data, key)) return [];
    const value = data[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return Object.entries(value).map(([name, fact]) => [name, fact !== null && typeof fact === "object" ? JSON.stringify(fact, null, 2) : researchFactText(fact)]);
    return [[key, key === "nextParameters" && value === null ? "null（本页不续页）" : researchFactText(value)]];
  };
  const reasons: Record<string, string> = { "empty-work-page": "本页没有作品候选", "item-limit": "达到本轮条目上限", "page-limit": "达到本轮页数上限", "upstream-no-more": "上游明确没有后页", "no-next-token": "未收到可继续使用的下一页令牌", "missing-next-token-needs-review": "上游表示有后页但缺少下一页令牌，需核对", "repeated-next-token-needs-review": "下一页令牌重复，需核对", "pagination-mapping-unverified": "分页映射尚未核实，本轮不继续翻页", "single-request": "此操作本轮只查询一次", "page-number-limit": "页码达到可安全处理的范围" };
  return { rows: collectionSummaryRows(data), window: fields("queryWindow"), returned: fields("returnedPage"), next: fields("nextParameters"), stop: !Object.hasOwn(data, "stopReason") ? null : data.stopReason === null ? "null（本页未记录停止原因）" : typeof data.stopReason === "string" && reasons[data.stopReason] ? `${reasons[data.stopReason]}（${data.stopReason}）` : researchFactText(data.stopReason) };
}

export function collectionPreviewBody(operation: PlatformOperation, values: Record<string, string>, now = new Date(),provider="redfox") {
  operation=providerOperation(operation,provider);
  if (!isCollectionOperation(operation)) throw new Error("请选择已接通采集的操作。");
  if (isHotSnapshot(operation)) {
    const start = beijingDate(now), end = addDays(start, 1), suffix = operation.id === "9Y4EX7RW" ? " 00:00:00" : "";
    return { provider, operationId: operation.id, parameters: { ...platformQueryParameters(collectionFormOperation(operation), values), startDate: start + suffix, endDate: end + suffix } };
  }
  return { provider, operationId: operation.id, parameters: platformQueryParameters(operation, values) };
}
export function isCollectionOperationKey(key: string, provider?: string, mode?: string) {
  return key === "redfox.weibo.collection" || key === "redfox.platform.collection"
    || (provider === "agentkey" && key === "agentkey.douyin.search" && mode === "collection");
}
export function collectionSaveCommand(id: number | null, editVersion: number | null, config: CollectionSubscriptionConfig) {
  if (id === null) return { method: "POST" as const, path: "/api/admin/redfox/collections", body: config };
  if (!Number.isSafeInteger(editVersion) || !editVersion || editVersion < 1) throw new Error("请先刷新并核对订阅配置版本。");
  return { method: "PATCH" as const, path: `/api/admin/redfox/collections/${id}`, body: { editVersion, config } };
}
export function collectionProviderCommand(id: number, editVersion: number, targetProvider: string, reason?: string) {
  if (!Number.isSafeInteger(editVersion) || editVersion < 1) throw new Error("请先刷新并核对订阅配置版本。");
  return {path: `/api/admin/redfox/collections/${id}/provider/${reason === undefined ? "preflight" : "switch"}`,
    body: {editVersion, targetProvider, ...(reason === undefined ? {} : {reason})}};
}
export function collectionProviderPreflightMatches(preflight: PlatformCollectionProviderPreflight | null, subscription: CollectionSubscription | undefined, editVersion: number | null, targetProvider: string) {
  return !!preflight && !!subscription && preflight.supported && preflight.subscriptionId === subscription.id
    && preflight.editVersion === editVersion && subscription.editVersion === editVersion
    && preflight.currentProvider === subscription.provider && preflight.targetProvider === targetProvider;
}
