import { platformParameters, safeExternalUrl, type PlatformOperation } from "./platform-types.ts";
import { researchFactText, researchObject } from "./research-platform-data.ts";

export function socialResearchPlatform(operationId: unknown): string | null {
  switch (operationId) {
    case "API_1792651427970": return "zhihu";
    case "ZMFVK589": return "toutiao";
    case "API_1790577699794": case "API_1790581645603": case "API_1791446025175": return "tiktok";
    case "WULKP6JP": return "youtube";
    case "U1SGKF2G": return "instagram";
    default: return null;
  }
}
export function isSocialResearchOperation(operation: Pick<PlatformOperation, "id" | "platform">): boolean {
  return operation.platform === "bilibili" && ["bilibili.comments", "bilibili.comment_replies"].includes(operation.id) || socialResearchPlatform(operation.id) === operation.platform;
}
export function socialAllowsEmptyField(operationId: string, name: string): boolean {
  return operationId === "API_1790577699794" && name === "pageToken";
}
export function socialQueryParameters(operation: PlatformOperation, values: Record<string, string>) {
  if (!isSocialResearchOperation(operation)) throw new Error("此操作不是已开放的评论或关注查询");
  const rawFields = operation.id === "ZMFVK589" ? ["offset"] : operation.id === "API_1790577699794" ? ["minTime", "pageToken"] : operation.id === "WULKP6JP" ? ["continuationToken"] : operation.id === "U1SGKF2G" ? ["paginationToken"] : [];
  const parameters = platformParameters({ ...operation, fields: operation.fields.filter(field => !rawFields.includes(field.name)) }, values);
  for (const name of rawFields) {
    const field = operation.fields.find(field => field.name === name);
    if (!field) continue;
    const value = values[name] ?? "";
    if (value === "" && !socialAllowsEmptyField(operation.id, name)) {
      if (field.required) throw new Error(`请填写${field.label}`);
      continue;
    }
    parameters[name] = value;
  }
  if (operation.id === "API_1790577699794") {
    if (!!parameters.userId === !!parameters.secUserId) throw new Error("userId 与 secUserId 必须且只能填写一个");
    if (parameters.userId && !/^[0-9]+$/.test(String(parameters.userId))) throw new Error("userId 须为完整数字字符串，不转为数值");
  }
  return parameters;
}
export function isSocialResearchResult(kind: string, data: Record<string, unknown>): boolean {
  if (isAgentKeyWeiboSocial(data)) return kind === "query_summary" || kind === (data.operationId === "weibo.following" ? "social_followee" : "social_comment");
  if (isAgentKeyDouyinSocial(data)) return kind === (data.operationId === "douyin.following" ? "social_followee" : "social_comment");
  if (isAgentKeyToutiaoSocial(data) || isAgentKeyXiaohongshuSocial(data) || isAgentKeyBilibiliSocial(data)) return kind === "social_comment";
  const platform = socialResearchPlatform(data.operationId);
  if (!platform || data.platform !== platform) return false;
  if (kind === "query_summary") return data.role === "social-research-summary";
  return kind === (data.operationId === "API_1790577699794" ? "social_followee" : "social_comment");
}
export function isAgentKeyToutiaoSocial(data: Record<string, unknown>): boolean {
  return data.provider === "agentkey" && data.platform === "toutiao" && data.operationId === "toutiao.comments" && data.tool === "TikHub/get_comments_api_v1_toutiao_app_get_comments_get";
}
export function isAgentKeyXiaohongshuSocial(data: Record<string, unknown>): boolean {
  return data.provider === "agentkey" && data.platform === "xiaohongshu" && data.operationId === "xiaohongshu.comments" && data.tool === "TikHub/get_note_comments_api_v1_xiaohongshu_app_v2_get_note_comments_get";
}
export function isAgentKeyDouyinSocial(data: Record<string, unknown>): boolean {
  const tools: Record<string, string> = {
    "douyin.comments": "TikHub/fetch_video_comments_api_v1_douyin_app_v3_fetch_video_comments_get",
    "douyin.comment_replies": "TikHub/fetch_video_comments_reply_api_v1_douyin_app_v3_fetch_video_comment_replies_get",
    "douyin.following": "TikHub/fetch_user_following_list_api_v1_douyin_web_fetch_user_following_list_get",
  };
  return data.provider === "agentkey" && data.platform === "douyin" && typeof data.operationId === "string" && tools[data.operationId] !== undefined && data.tool === tools[data.operationId];
}
export function socialRole(data: Record<string, unknown>): string {
  return data.role === "followee" ? "关注列表中的账号" : (data.role === "comment-reply" || isAgentKeyBilibiliSocial(data) && data.operationId === "bilibili.comment_replies") ? "评论回复" : "作品评论";
}
const labels: Record<string, string> = {
  rootid: "父评论 ID（不是作品 ID）", rootidstr: "父评论 ID 字符串（不是作品 ID）", screen_name: "显示名称", description: "简介", followers_count: "粉丝数", friends_count: "关注数", statuses_count: "微博数", like_counts: "点赞数", total_number: "上游回复数",
  rpid: "评论 ID", oid: "响应作品 OID", mid: "实际 MID", root: "根评论 ID", parent: "父评论 ID", uname: "评论者名称", like: "点赞数", rcount: "上游回复数",
  cid: "评论 ID", commentId: "评论 ID", userid: "用户 ID", note_id: "响应笔记 ID", like_count: "点赞数", sub_comment_count: "上游回复数", uid: "用户 uid", sec_uid: "安全用户 ID", aweme_id: "响应作品 ID", reply_id: "回复关联评论 ID", reply_to_reply_id: "回复对象 ID", reply_to_userid: "回复对象用户 ID", reply_to_user_sec_id: "回复对象安全 ID", digg_count: "点赞数", reply_comment_total: "上游回复数", comment_reply_total: "上游回复数", follower_count: "粉丝数", following_count: "关注数", workId: "响应作品 ID", replyId: "回复 ID", replyToCommentId: "回复对象评论 ID", replyToUserId: "回复对象用户 ID", replyToUserName: "回复对象称呼", replyToUserHandle: "回复对象 handle", threadId: "线程 ID",
  userId: "用户 ID", user_id: "用户 ID", user_name: "用户称呼", id_str: "评论 ID 字符串", reply_count: "上游回复数", secUserId: "安全用户 ID", id: "用户 ID", channelId: "频道 ID", userName: "用户称呼", nickname: "昵称", userHandle: "handle", username: "username", fullName: "称呼", displayName: "显示名称",
  likeNum: "点赞数", likeCount: "点赞数", replyCount: "上游回复数", likedByAuthor: "被作品作者点赞", pinnedByAuthor: "被作品作者置顶", isPinned: "置顶", isEdited: "已编辑", isCreator: "频道创作者", isVerified: "认证", isPrivate: "私密账号", hasMoreReplies: "上游 hasMoreReplies", language: "语言",
  fansCount: "粉丝数", followCount: "关注数", favoritingCount: "收藏数", likedTotal: "获赞数", workCount: "作品数", isSecret: "isSecret", region: "地区", userArea: "用户地区", customVerify: "自定义认证", enterpriseVerifyReason: "企业认证说明", enterpriseVerify: "企业认证", verifyInfo: "认证信息", signature: "简介", userSignature: "用户简介",
};
const mediaFields = ["avatorUrl","avatar", "avatarImage", "avatarUrl", "profilePicUrl", "pictureUrl", "imageUrl", "videoUrl", "shareLink", "channelUrl", "url"];
const timeFields = ["ctime", "createTime", "updateTime", "publishTime", "publishedTime", "createdAt", "created_at", "create_time", "time"];
export function socialRecordRows(value: unknown, data?: Record<string, unknown>): Array<[string, string]> {
  const record = researchObject(value);
  return Object.entries(record).flatMap(([key, value]) => {
    if (["content", "text", ...mediaFields, ...timeFields].includes(key) || value !== null && !["string", "number", "boolean"].includes(typeof value)) return [];
    if (data?.operationId === "API_1792651427970" && key === "id") return [["评论 ID · id", researchFactText(value)]];
    if (data && isAgentKeyWeiboSocial(data) && data.operationId === "weibo.comments" && (key === "id" || key === "idstr")) return [[`${key === "id" ? "评论 ID" : "评论 ID 字符串"} · ${key}`, researchFactText(value)]];
    return [[key === "id" && (Object.hasOwn(record, "id_str") || Object.hasOwn(record, "note_id")) ? "评论 ID · id" : labels[key] ? `${labels[key]} · ${key}` : key, researchFactText(value)]] as Array<[string, string]>;
  });
}
export function socialAuthor(data: Record<string, unknown>): { field: string; record: Record<string, unknown> } | null {
  const record = researchObject(data.record);
  const field = isAgentKeyWeiboSocial(data) ? "user" : isAgentKeyBilibiliSocial(data) ? "member" : (isAgentKeyDouyinSocial(data) && data.operationId !== "douyin.following" || isAgentKeyToutiaoSocial(data) || isAgentKeyXiaohongshuSocial(data)) ? "user" : data.operationId === "WULKP6JP" ? "author" : data.operationId === "U1SGKF2G" ? "user" : ["API_1790581645603", "API_1791446025175"].includes(String(data.operationId)) ? "userData" : null;
  return field ? { field, record: researchObject(record[field]) } : null;
}
export function socialTimeRows(data: Record<string, unknown>): Array<[string, string]> {
  const record = researchObject(data.record), units = researchObject(data.timeUnits);
  return timeFields.flatMap(key => Object.hasOwn(record, key) ? [[isAgentKeyWeiboSocial(data) && data.operationId === "weibo.comments" && key === "created_at" ? "实收原始时间 · created_at" : `原始 ${key}（${units[key] === "seconds" ? "秒" : units[key] === "relative-or-unspecified" ? "相对时间或未说明时区" : "单位 / 时区未说明"}）`, researchFactText(record[key])]] as Array<[string, string]> : []);
}
function typedFact(value: unknown): string {
  return `${researchFactText(value)}${typeof value === "string" ? "（string）" : typeof value === "number" ? "（number）" : ""}`;
}
export function socialPagingRows(data: Record<string, unknown>): Array<[string, string]> {
  const reported = isAgentKeyWeiboSocial(data) ? { data: researchObject(data.pagination) } : researchObject(data.reportedPaging);
  return [...(Object.hasOwn(data, "count") ? [["本次实际返回 count", typedFact(data.count)]] as Array<[string, string]> : []), ...["root", "data"].flatMap(path => Object.entries(researchObject(reported[path])).map(([key, value]): [string, string] => [`${path === "root" ? "响应根" : "响应 data"}.${key}${key === "count" ? "（上游报告值）" : ""}`, typedFact(value)]))];
}
export function socialUnsafeCursor(data: Record<string, unknown>): boolean {
  const cursor = researchObject(researchObject(data.reportedPaging).data).nextCursor;
  return typeof cursor === "number" ? !Number.isSafeInteger(cursor) : typeof cursor === "string" && /^-?[0-9]+$/.test(cursor) && (BigInt(cursor) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(cursor) < BigInt(Number.MIN_SAFE_INTEGER));
}
export function socialLinks(data: Record<string, unknown>) {
  const record = researchObject(data.record), author = socialAuthor(data), links: Array<{ field: string; value: unknown; url: string | null }> = [];
  const add = (field: string, value: unknown) => links.push({ field, value, url: safeExternalUrl(value) });
  const fields = (value: Record<string, unknown>, prefix: string) => {
    for (const key of mediaFields) if (Object.hasOwn(value, key)) add(`${prefix}${key}`, value[key]);
  };
  fields(record, "record.");
  if (author) fields(author.record, `record.${author.field}.`);
  fields(researchObject(record.shareData), "record.shareData.");
  for (const key of ["images", "pictures", "imageList"]) if (Array.isArray(record[key])) record[key].forEach((item: unknown, index: number) => {
    if (typeof item === "string") add(`record.${key}[${index}]`, item);
    else {
      const image = researchObject(item);
      for (const field of ["url", "imageUrl"]) if (Object.hasOwn(image, field)) add(`record.${key}[${index}].${field}`, image[field]);
      if (Array.isArray(image.urlList)) image.urlList.forEach((url: unknown, i: number) => add(`record.${key}[${index}].urlList[${i}]`, url));
    }
  });
  return links;
}

export function isAgentKeyBilibiliSocial(data: Record<string, unknown>): boolean {
  const tools: Record<string, string> = { "bilibili.comments": "TikHub/fetch_video_comments_api_v1_bilibili_app_fetch_video_comments_get", "bilibili.comment_replies": "TikHub/fetch_reply_detail_api_v1_bilibili_app_fetch_reply_detail_get" };
  return data.provider === "agentkey" && data.platform === "bilibili" && typeof data.operationId === "string" && !!tools[data.operationId] && data.tool === tools[data.operationId];
}

export function isAgentKeyWeiboSocial(data: Record<string, unknown>): boolean {
  const tools: Record<string, string> = { "weibo.comments": "TikHub/fetch_status_comments_api_v1_weibo_app_fetch_status_comments_get", "weibo.following": "TikHub/fetch_user_following_api_v1_weibo_app_fetch_user_following_get" };
  return data.provider === "agentkey" && data.platform === "weibo" && typeof data.operationId === "string" && !!tools[data.operationId] && data.tool === tools[data.operationId];
}
