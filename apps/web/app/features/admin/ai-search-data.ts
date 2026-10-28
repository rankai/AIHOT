import { safeExternalUrl } from "./platform-types.ts";
import { researchFactText } from "./research-platform-data.ts";
import type { AiSearchMode, AiSearchOptions } from "./ai-search-types.ts";
export const aiSearchFamilies: Record<string, string> = { kimi: "Kimi（K3 / K2.5 共用）", yuanbao: "元宝", qianwen: "千问", baidu: "百度", doubao: "豆包", deepseek: "DeepSeek", qianwenProducts: "千问（含商品卡）", doubaoProducts: "豆包（含商品卡）" };
export function isAiSearchOperation(key: string) { return key === "redfox.ai_search.submit" || key === "redfox.ai_search.query"; }
export function isAiSearchResult(kind: string, data: Record<string, unknown>) { return ["ai_search_task", "ai_search_answer", "ai_search_citation"].includes(kind) && typeof data.family === "string" && Object.hasOwn(aiSearchFamilies, data.family); }
export function aiSearchCommand(mode: AiSearchMode, selection: string, value: string, options: AiSearchOptions) {
  if (!value.trim()) throw new Error(mode === "submit" ? "请填写搜索问题。" : "请填写已有任务 ID。");
  if (value.length > (mode === "submit" ? options.inquiryMaxCharacters : 500)) throw new Error(`最多 ${mode === "submit" ? options.inquiryMaxCharacters : 500} 字符。`);
  if (mode === "submit") {
    if (!options.engines.some(engine => engine.engine === selection)) throw new Error("请选择可用搜索引擎。");
    return { path: "/api/admin/redfox/ai-searches", body: { engine: selection, inquiryText: value } };
  }
  if (!options.queries.some(query => query.family === selection)) throw new Error("请选择任务所属系列。");
  return { path: "/api/admin/redfox/ai-searches/query", body: { family: selection, taskId: value } };
}
export function aiSearchStatus(data: Record<string, unknown>) {
  if (!Object.hasOwn(data, "status")) return "提交已记录";
  return ({ processing: "处理中", queued: "排队中", running: "处理中", completed: "回答完成", succeeded: "回答完成", failed: "失败" } as Record<string, string>)[String(data.status)] ?? `上游状态：${researchFactText(data.status)}`;
}
export function aiSearchAnswer(data: Record<string, unknown>) {
  const result = data.result;
  if (result === null) return { content: null, fact: "result 为 null（尚无回答）" };
  if (!result || typeof result !== "object" || Array.isArray(result)) return { content: null, fact: Object.hasOwn(data, "result") ? "回答字段格式未识别" : "未提供回答" };
  const content = (result as Record<string, unknown>).content;
  return { content: typeof content === "string" ? content : null, fact: Object.hasOwn(result, "content") ? researchFactText(content) : "未提供正文" };
}
export function aiSearchCitationUrl(data: Record<string, unknown>) { return safeExternalUrl(data.url); }
export function aiSearchCitationRows(data: Record<string, unknown>): Array<[string, string]> {
  const record = data.record;
  return record && typeof record === "object" && !Array.isArray(record) ? Object.entries(record).filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => [key, researchFactText(value)]) : [];
}
export function aiSearchTaskFacts(operation: { progress: Record<string, unknown>; inputs: { family?: string; parameters?: Record<string, unknown> }; results: Array<{ kind: string; data: Record<string, unknown> }> }) {
  const rows = operation.results.filter(row => isAiSearchResult(row.kind, row.data));
  const actual = rows.findLast(row => typeof row.data.taskId === "string" && !!row.data.taskId.trim());
  const requested = rows.findLast(row => typeof row.data.requestedTaskId === "string" && !!row.data.requestedTaskId.trim());
  const input = operation.inputs.parameters?.taskId;
  const actualTaskId = actual ? actual.data.taskId as string : null;
  const requestedTaskId = typeof input === "string" && input.trim() ? input : requested ? requested.data.requestedTaskId as string : null;
  const executionTaskId = typeof operation.progress.taskId === "string" && operation.progress.taskId.trim() ? operation.progress.taskId : requestedTaskId ?? actualTaskId;
  return { actualTaskId, requestedTaskId, executionTaskId, latest: rows.findLast(row => row.kind !== "ai_search_citation") ?? null };
}

export function aiSearchFailureRows(data: Record<string, unknown>): Array<[string, string]> {
  if (data.status !== "failed" && !(typeof data.failReason === "string" && data.failReason.trim())) return [];
  return [["上游失败原因", Object.hasOwn(data, "failReason") ? researchFactText(data.failReason) : "未提供"]];
}

/** Product references remain independent facts; no guessed correspondence to answer markers. */
export function aiSearchProducts(data: Record<string, unknown>) {
  if (!["qianwenProducts", "doubaoProducts"].includes(String(data.family))) return null;
  const result = data.result && typeof data.result === "object" && !Array.isArray(data.result) ? data.result as Record<string, unknown> : {};
  const records = Array.isArray(result.cardData) ? result.cardData : [];
  const cards = records.filter((record): record is Record<string, unknown> => !!record && typeof record === "object" && !Array.isArray(record)).map(record => ({
    title: typeof record.title === "string" ? record.title : "商品标题未提供", url: safeExternalUrl(record.url), imageUrl: safeExternalUrl(record.image),
    rows: ["price", "originPrice", "shopName", "sales", "sourceSeq", "itemId", "productId", "shortTitle", "pos"].flatMap(key => Object.hasOwn(record, key) ? [[({price:"价格（原值）",originPrice:"原价（原值）",shopName:"店铺",sales:"销量（原值）",sourceSeq:"来源标识 sourceSeq",itemId:"商品 itemId",productId:"商品 productId",shortTitle:"短标题",pos:"上游位置 pos"} as Record<string,string>)[key]!,researchFactText(record[key])]] as Array<[string,string]> : []),
  }));
  const references = data.family === "doubaoProducts" && Array.isArray(result.searchGuid) ? result.searchGuid.filter((record): record is Record<string, unknown> => !!record && typeof record === "object" && !Array.isArray(record)).map(record => ({url:safeExternalUrl(record.url),rows:aiSearchCitationRows({record})})) : [];
  return {cards,references};
}
