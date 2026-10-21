import { platformParameters, safeExternalUrl, type PlatformOperation } from "./platform-types.ts";
import { researchFactText, researchObject } from "./research-platform-data.ts";

export type ServiceResearchParameters = Record<string, string | number | boolean | string[] | number[]>;
export function isServiceResearchPlatform(value: unknown): boolean { return ["x-research", "hot-research", "redfox-account"].includes(String(value)); }
export function serviceResearchParameters(operation: PlatformOperation, values: Record<string, string>): ServiceResearchParameters {
  const parameters: ServiceResearchParameters = platformParameters({ ...operation, fields: operation.fields.filter(field => field.type !== "string-array" && field.type !== "integer-array") }, values);
  for (const field of operation.fields) {
    if (field.type === "string-array") {
      const lines = (values[field.name] ?? "").split(/\r?\n/);
      if (lines.some(line => !line.trim())) throw new Error(`${field.label}每行填写一个非空词，删除空行；逗号不拆分，保留词的首尾空白`);
      parameters[field.name] = lines;
    } else if (field.type === "integer-array") {
      const selected = values[field.name] ? values[field.name]!.split("\n") : [];
      if (field.required && !selected.length) throw new Error(`请选择${field.label}`);
      if (selected.some(value => !/^-?[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || !field.options?.some(option => option.value === value))) throw new Error(`请选择有效的${field.label}`);
      if (selected.length) parameters[field.name] = selected.map(Number);
    }
  }
  if (operation.platform === "x-research" && operation.fields.some(field => field.name === "cursor")) {
    if (values.cursor !== undefined && values.cursor !== "") parameters.cursor = values.cursor;
    else delete parameters.cursor;
  }
  if (operation.platform === "redfox-account" && operation.id === "API_1792043329817") for (const key of ["pageNum", "pageSize"]) {
    if (values[key] !== undefined && values[key] !== "") parameters[key] = values[key];
    else delete parameters[key];
  }
  return parameters;
}
export function isServiceResearchResult(kind: string, data: Record<string, unknown>): boolean {
  if (data.platform === "x-research") return ["x_research_work", "x_comment", "x_followee", "x_account_rank", "query_summary"].includes(kind);
  if (data.platform === "hot-research") return ["hotspot_research", "query_summary"].includes(kind);
  return data.platform === "redfox" && ["API_1792036841619", "API_1792043329817"].includes(String(data.operationId)) && ["redfox_balance", "redfox_consumption", "query_summary"].includes(kind);
}
export function serviceSummaryRows(data: Record<string, unknown>): Array<[string, string]> {
  return ["count", "replyCount", "total", "pageNum", "pageSize", "pages", "cursor", "nextCursor", "prevCursor", "moreUsers"].flatMap(key => Object.hasOwn(data, key) ? [[key === "count" ? "本次实际结果 count" : `收到 ${key}`, `${researchFactText(data[key])}${typeof data[key] === "string" ? "（string）" : typeof data[key] === "number" ? "（number）" : ""}`]] as Array<[string, string]> : []);
}
export function serviceRecordRows(value: unknown, keys: readonly string[]): Array<[string, string]> {
  const record = researchObject(value);
  return keys.flatMap(key => Object.hasOwn(record, key) ? [[key === "gmtCreate" || key === "createdAt" ? `${key}（原串，时区未由此确定）` : key, researchFactText(record[key])]] as Array<[string, string]> : []);
}
export function serviceRole(kind: string, data: Record<string, unknown>): string {
  if (kind === "x_comment") return data.role === "thread-root" ? "线程根推文" : data.role === "reply" ? "评论回复" : "评论角色未说明";
  return kind === "x_followee" ? "关注列表中的账号" : kind === "x_account_rank" ? "账号研究榜单" : kind === "x_research_work" ? "实际收到的推文结果" : kind === "redfox_balance" ? "积分余额快照" : kind === "redfox_consumption" ? "积分调用记录" : "热点研究结果";
}
export function serviceLink(value: unknown): { value: string; url: string | null } | null {
  return typeof value === "string" ? { value, url: safeExternalUrl(value) } : null;
}
export function serviceXMedia(value: unknown) {
  const record = researchObject(value);
  return Array.isArray(record.medias) ? record.medias.map(item => {
    const media = researchObject(item);
    return { fields: serviceRecordRows(media, ["type", "durationMillis"]), links: [
      ...(Object.hasOwn(media, "coverUrl") ? [{ label: "媒体封面", ...serviceLink(media.coverUrl) }] : []),
      ...(Array.isArray(media.variants) ? media.variants.flatMap((variant, index) => {
        const link = serviceLink(researchObject(variant).url);
        return link ? [{ label: `媒体清晰度 ${index + 1}`, ...link }] : [];
      }) : []),
    ].filter((link): link is { label: string; value: string; url: string | null } => typeof link.value === "string") };
  }) : [];
}
export function serviceHotItems(data: Record<string, unknown>): Record<string, unknown>[] {
  const record = researchObject(data.record);
  return data.operationId === "9Y4EX7RW" ? Array.isArray(record.hotSpotList) ? record.hotSpotList.map(researchObject) : [] : [record];
}
