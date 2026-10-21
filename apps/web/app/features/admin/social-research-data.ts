import { platformParameters, safeExternalUrl, type PlatformOperation } from "./platform-types.ts";
import { researchFactText, researchObject } from "./research-platform-data.ts";

export function socialResearchPlatform(operationId: unknown): string | null {
  switch (operationId) {
    case "ZMFVK589": return "toutiao";
    case "API_1790577699794": case "API_1790581645603": case "API_1791446025175": return "tiktok";
    case "WULKP6JP": return "youtube";
    case "U1SGKF2G": return "instagram";
    default: return null;
  }
}
export function isSocialResearchOperation(operation: Pick<PlatformOperation, "id" | "platform">): boolean {
  return socialResearchPlatform(operation.id) === operation.platform;
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
  const platform = socialResearchPlatform(data.operationId);
  if (!platform || data.platform !== platform) return false;
  if (kind === "query_summary") return data.role === "social-research-summary";
  return kind === (data.operationId === "API_1790577699794" ? "social_followee" : "social_comment");
}
export function socialRole(data: Record<string, unknown>): string {
  return data.role === "followee" ? "关注列表中的账号" : data.role === "comment-reply" ? "评论回复" : "作品评论";
}
const labels: Record<string, string> = {
  cid: "评论 ID", commentId: "评论 ID", uid: "评论者 uid", workId: "响应作品 ID", replyId: "回复 ID", replyToCommentId: "回复对象评论 ID", replyToUserId: "回复对象用户 ID", replyToUserName: "回复对象称呼", replyToUserHandle: "回复对象 handle", threadId: "线程 ID",
  userId: "用户 ID", secUserId: "安全用户 ID", id: "用户 ID", channelId: "频道 ID", userName: "用户称呼", nickname: "昵称", userHandle: "handle", username: "username", fullName: "称呼", displayName: "显示名称",
  likeNum: "点赞数", likeCount: "点赞数", replyCount: "上游回复数", likedByAuthor: "被作品作者点赞", pinnedByAuthor: "被作品作者置顶", isPinned: "置顶", isEdited: "已编辑", isCreator: "频道创作者", isVerified: "认证", isPrivate: "私密账号", hasMoreReplies: "上游 hasMoreReplies", language: "语言",
  fansCount: "粉丝数", followCount: "关注数", favoritingCount: "收藏数", likedTotal: "获赞数", workCount: "作品数", isSecret: "isSecret", region: "地区", userArea: "用户地区", customVerify: "自定义认证", enterpriseVerifyReason: "企业认证说明", enterpriseVerify: "企业认证", verifyInfo: "认证信息", signature: "简介", userSignature: "用户简介",
};
const mediaFields = ["avatar", "avatarImage", "avatarUrl", "profilePicUrl", "pictureUrl", "imageUrl", "videoUrl", "shareLink", "channelUrl", "url"];
const timeFields = ["createTime", "updateTime", "publishTime", "publishedTime", "createdAt"];
export function socialRecordRows(value: unknown): Array<[string, string]> {
  return Object.entries(researchObject(value)).flatMap(([key, value]) => {
    if (["content", "text", ...mediaFields, ...timeFields].includes(key) || value !== null && !["string", "number", "boolean"].includes(typeof value)) return [];
    return [[labels[key] ? `${labels[key]} · ${key}` : key, researchFactText(value)]] as Array<[string, string]>;
  });
}
export function socialAuthor(data: Record<string, unknown>): { field: string; record: Record<string, unknown> } | null {
  const record = researchObject(data.record);
  const field = data.operationId === "WULKP6JP" ? "author" : data.operationId === "U1SGKF2G" ? "user" : ["API_1790581645603", "API_1791446025175"].includes(String(data.operationId)) ? "userData" : null;
  return field ? { field, record: researchObject(record[field]) } : null;
}
export function socialTimeRows(data: Record<string, unknown>): Array<[string, string]> {
  const record = researchObject(data.record), units = researchObject(data.timeUnits);
  return timeFields.flatMap(key => Object.hasOwn(record, key) ? [[`原始 ${key}（${units[key] === "seconds" ? "秒" : units[key] === "relative-or-unspecified" ? "相对时间或未说明时区" : "单位 / 时区未说明"}）`, researchFactText(record[key])]] as Array<[string, string]> : []);
}
function typedFact(value: unknown): string {
  return `${researchFactText(value)}${typeof value === "string" ? "（string）" : typeof value === "number" ? "（number）" : ""}`;
}
export function socialPagingRows(data: Record<string, unknown>): Array<[string, string]> {
  const reported = researchObject(data.reportedPaging);
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
