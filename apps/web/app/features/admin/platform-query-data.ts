import { isSocialResearchOperation, socialQueryParameters } from "./social-research-data.ts";
import { isServiceResearchPlatform, serviceResearchParameters, type ServiceResearchParameters } from "./service-research-data.ts";
import { isResearchPlatform, researchQueryParameters } from "./research-platform-data.ts";
import { toutiaoQueryParameters } from "./toutiao-result-data.ts";
import { shipinhaoQueryParameters } from "./shipinhao-result-data.ts";
import { kuaishouQueryParameters } from "./kuaishou-result-data.ts";
import { instagramQueryParameters } from "./instagram-result-data.ts";
import { youtubeQueryParameters } from "./youtube-result-data.ts";
import { platformParameters, type PlatformOperation } from "./platform-types.ts";
/** Existing per-operation wire conversions, shared by one-off query and explicit collection drafts. */
export function platformQueryParameters(operation: PlatformOperation, values: Record<string, string>): ServiceResearchParameters {
  return isSocialResearchOperation(operation) ? socialQueryParameters(operation, values) : isServiceResearchPlatform(operation.platform) ? serviceResearchParameters(operation, values) : isResearchPlatform(operation.platform) ? researchQueryParameters(operation, values) : operation.platform === "toutiao" ? toutiaoQueryParameters(operation, values) : operation.platform === "shipinhao" ? shipinhaoQueryParameters(operation, values) : operation.platform === "kuaishou" ? kuaishouQueryParameters(operation, values) : operation.platform === "instagram" ? instagramQueryParameters(operation, values) : operation.platform === "youtube" ? youtubeQueryParameters(operation, values) : platformParameters(operation, values);
}

/** Internal Bilibili detail navigation: validate before filling the existing form. */
export function bilibiliQuerySeed(state: unknown, operations: PlatformOperation[]) {
  if (!state || typeof state !== "object" || !("bilibiliDetailSeed" in state)) return null;
  const seed = state.bilibiliDetailSeed;
  if (!seed || typeof seed !== "object" || !("platform" in seed) || seed.platform !== "bilibili" || !("provider" in seed) || seed.provider !== "agentkey" || !("operationId" in seed) || seed.operationId !== "TIN1NMTZ" || !("parameters" in seed)) return null;
  const parameters = seed.parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return null;
  const entries = Object.entries(parameters);
  if (entries.length !== 1) return null;
  const [key, value] = entries[0]!;
  if (typeof value !== "string" || !(key === "bv_id" && /^BV[A-Za-z0-9]{10}$/.test(value) || key === "av_id" && /^[0-9]+$/.test(value))) return null;
  const operation = operations.find(item => item.platform === "bilibili" && item.id === "TIN1NMTZ");
  const variant = operation?.collectionProviders?.find(item => item.id === "agentkey");
  if (!operation || !variant?.fields || !variant.fields.some(field => field.name === key)) return null;
  try { platformQueryParameters({ ...operation, fields: variant.fields }, { [key]: value }); } catch { return null; }
  return { platform: "bilibili", operationId: "TIN1NMTZ", provider: "agentkey", values: { [key]: value } };
}

/** Internal Weibo detail navigation: accept only the available AgentKey status query. */
export function weiboQuerySeed(state: unknown, operations: PlatformOperation[]) {
  if (!state || typeof state !== "object" || !("weiboDetailSeed" in state)) return null;
  const seed = state.weiboDetailSeed;
  if (!seed || typeof seed !== "object" || !("platform" in seed) || seed.platform !== "weibo" || !("provider" in seed) || seed.provider !== "agentkey" || !("operationId" in seed) || seed.operationId !== "API_1789098514899" || !("parameters" in seed)) return null;
  const parameters = seed.parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || Object.keys(parameters).length !== 1 || !("status_id" in parameters) || typeof parameters.status_id !== "string" || !/^\d{1,100}$/.test(parameters.status_id)) return null;
  const operation = operations.find(item => item.platform === "weibo" && item.id === "API_1789098514899");
  const variant = operation?.collectionProviders?.find(item => item.id === "agentkey");
  if (!operation || !variant?.fields || !variant.fields.some(field => field.name === "status_id" && field.type === "string")) return null;
  const values = { status_id: parameters.status_id };
  try { platformQueryParameters({ ...operation, fields: variant.fields }, values); } catch { return null; }
  return { platform: "weibo", operationId: "API_1789098514899", provider: "agentkey", values };
}
