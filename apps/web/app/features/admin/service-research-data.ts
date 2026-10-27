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
  if (operation.platform === "x-research" && operation.fields.some(field => field.name === "search_type") && parameters.keyword !== undefined) parameters.keyword = values.keyword!;
  if (operation.platform === "x-research" && operation.fields.some(field => field.name === "cursor")) {
    if (values.cursor !== undefined && values.cursor !== "") parameters.cursor = values.cursor;
    else delete parameters.cursor;
  }
  if (operation.platform === "x-research" && ["x.account_posts", "x.account_profile"].includes(operation.id)) {
    if ((parameters.screen_name !== undefined) === (parameters.rest_id !== undefined)) throw new Error("账号名与安全整数用户 ID 必须二选一。");
    if (parameters.screen_name !== undefined && !/^[A-Za-z0-9_]{1,15}$/.test(String(parameters.screen_name))) throw new Error("账号名须为 1–15 位字母、数字或下划线，不含 @。");
  }
  if (operation.platform === "redfox-account" && operation.id === "API_1792043329817") for (const key of ["pageNum", "pageSize"]) {
    if (values[key] !== undefined && values[key] !== "") parameters[key] = values[key];
    else delete parameters[key];
  }
  return parameters;
}
export function isServiceResearchResult(kind: string, data: Record<string, unknown>): boolean {
  if (isAgentKeyXResearch(data)) return ["x_research_work", "x_detail_work", "account", "x_comment", "x_followee", "hotspot_research", "query_summary"].includes(kind);
  if (isAgentKeyWeiboResearch(data)) return kind === "query_summary" || kind === (data.operationId === "UAQ90A1F" ? "hotspot_research" : "search_suggestion");
  if (isAgentKeyDouyinHotspot(data) || isAgentKeyBilibiliHotspot(data)) return kind === "hotspot_research";
  if (data.platform === "x-research") return ["x_research_work", "x_comment", "x_followee", "x_account_rank", "query_summary"].includes(kind);
  if (data.platform === "hot-research") return ["hotspot_research", "query_summary"].includes(kind);
  return data.platform === "redfox" && ["API_1792036841619", "API_1792043329817"].includes(String(data.operationId)) && ["redfox_balance", "redfox_consumption", "query_summary"].includes(kind);
}
export function isAgentKeyDouyinHotspot(data: Record<string, unknown>): boolean {
  return data.provider === "agentkey" && data.platform === "douyin" && data.operationId === "douyin.trending" && data.tool === "TikHub/fetch_hot_search_list_api_v1_douyin_app_v3_fetch_hot_search_list_get";
}
export function serviceSummaryRows(data: Record<string, unknown>): Array<[string, string]> {
  return ["count", "replyCount", "total", "pageNum", "pageSize", "pages", "cursor", "nextCursor", "prevCursor", "moreUsers"].flatMap(key => Object.hasOwn(data, key) ? [[key === "count" ? "本次实际结果 count" : `收到 ${key}`, `${researchFactText(data[key])}${typeof data[key] === "string" ? "（string）" : typeof data[key] === "number" ? "（number）" : ""}`]] as Array<[string, string]> : []);
}
export function serviceRecordRows(value: unknown, keys: readonly string[]): Array<[string, string]> {
  const record = researchObject(value);
  return keys.flatMap(key => Object.hasOwn(record, key) ? [[key === "gmtCreate" || key === "createdAt" ? `${key}（原串，时区未由此确定）` : key, researchFactText(record[key])]] as Array<[string, string]> : []);
}
export function serviceRole(kind: string, data: Record<string, unknown>): string {
  if (isAgentKeyWeiboResearch(data)) return kind === "search_suggestion" ? "相关搜索词研究" : "微博热搜研究";
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

export function isAgentKeyBilibiliHotspot(data: Record<string, unknown>): boolean { return data.provider === "agentkey" && data.platform === "bilibili" && data.operationId === "bilibili.hot_search" && data.tool === "TikHub/fetch_hot_search_api_v1_bilibili_web_fetch_hot_search_get"; }

export function isAgentKeyWeiboResearch(data: Record<string, unknown>): boolean {
  const tools: Record<string, string> = { UAQ90A1F: "TikHub/fetch_hot_search_api_v1_weibo_app_fetch_hot_search_get", "weibo.related_search": "TikHub/fetch_similar_search_api_v1_weibo_web_v2_fetch_similar_search_get" };
  return data.provider === "agentkey" && data.platform === "weibo" && typeof data.operationId === "string" && !!tools[data.operationId] && data.tool === tools[data.operationId];
}


/** AgentKey X is a read-only research contract, distinct from Redfox material records. */
export function isAgentKeyXResearch(data: Record<string, unknown>): boolean {
  return data.provider === "agentkey" && data.platform === "x-research";
}
export function agentKeyXRole(kind: string, data: Record<string, unknown>): string {
  if (kind === "x_comment") return "会话中的帖子（非直接回复证明）";
  if (kind === "account") return "查询账号资料";
  if (kind === "hotspot_research") return "趋势词研究";
  if (kind === "x_followee") return ({ follower: "粉丝账号", followee: "关注账号", "list-member": "列表成员账号", "community-member": "社区成员账号" } as Record<string, string>)[String(data.identityRole)] ?? "关系角色未说明";
  return data.role === "retweet-wrapper" ? "转发外层帖子" : kind === "x_detail_work" ? "帖子详情研究" : "实收帖子研究";
}
const xRecordKeys = {
  work: ["tweetId", "tweet_id", "id", "type", "status", "role", "screen_name", "created_at", "conversation_id", "bookmarks", "favorites", "likes", "quotes", "replies", "retweets", "views", "lang", "sensitive", "in_reply_to_screen_name", "in_reply_to_status_id_str", "in_reply_to_user_id_str"],
  author: ["rest_id", "screen_name", "name", "created_at", "description", "followers_count", "followers", "favorites_count", "friends_count", "blue_verified", "verified", "sub_count"],
  profile: ["status", "profile", "rest_id", "id", "name", "desc", "protected", "blue_verified", "location", "friends", "sub_count", "statuses_count", "media_count", "created_at", "pinned_tweet_ids_str"],
  member: ["user_id", "screen_name", "name", "description", "statuses_count", "followers_count", "friends_count", "media_count", "created_at", "location", "blue_verified", "verified"],
  trend: ["name", "description", "context"],
} as const;
export function agentKeyXRecordRows(value: unknown, type: keyof typeof xRecordKeys): Array<[string, string]> {
  const record = researchObject(value);
  return serviceRecordRows(record, xRecordKeys[type]).map(([key, text]) => {
    if (type === "profile" && key === "pinned_tweet_ids_str" && Array.isArray(record[key]) && record[key].every(id => typeof id === "string")) {
      return [key, record[key].length ? JSON.stringify(record[key]) : "[]（空列表，0 项）"];
    }
    return [key === "created_at" ? "created_at（实收原始时间）" : key === "conversation_id" ? "conversation_id（会话根上下文，非直接父帖）" : key, text];
  });
}
export function agentKeyXContextRows(value: unknown): Array<[string, string]> {
  const record = researchObject(value), author = researchObject(record.author), context = researchObject(record.authorContext);
  // Only received account context is displayed; actual conflicting author IDs still exclude it.
  return context.source === "received-account-context" && (author.rest_id == null || context.rest_id == null || author.rest_id === context.rest_id) ? serviceRecordRows(context, ["rest_id", "screen_name", "source"]) : [];
}
export function agentKeyXScopeRows(value: unknown): Array<[string, string]> {
  return serviceRecordRows(value, ["keyword", "search_type", "screen_name", "rest_id", "tweet_id", "list_id", "community_id", "ranking", "country"]);
}
export function agentKeyXSummaryRows(data: Record<string, unknown>): Array<[string, string]> {
  return [...serviceRecordRows(data, ["count"]), ...serviceRecordRows(data.pagination, ["next_cursor", "prev_cursor", "cursor", "more_users"]).map(([key, value]): [string, string] => [`实收 pagination.${key}`, value])];
}
