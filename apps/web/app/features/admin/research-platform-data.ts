import { platformParameters, safeExternalUrl, type PlatformOperation } from "./platform-types.ts";

const platforms = ["qichezhijia", "dongchedi", "yiche", "baijiahao", "zhihu"] as const;
export function isResearchPlatform(value: unknown): boolean { return typeof value === "string" && platforms.some(platform => platform === value); }
export function isResearchResult(kind: string, data: Record<string, unknown>): boolean {
  return isResearchPlatform(data.platform) && ["query_summary", `${data.platform}_account`, `${data.platform}_work`].includes(kind);
}
export function researchQueryParameters(operation: PlatformOperation, values: Record<string, string>) {
  if (operation.id === "API_1789097000885") {
    const page = values.page ?? "";
    if (!page) throw new Error("请填写页码");
    // This operation's page is an opaque nonempty string, including whitespace.
    const parameters = platformParameters({ ...operation, fields: operation.fields.filter(field => field.name !== "page") }, values);
    return { ...parameters, page };
  }
  const parameters = platformParameters(operation, values);
  if (operation.id === "YGYYT0G0" && values.timestamp !== undefined) parameters.timestamp = values.timestamp;
  return parameters;
}
export function researchObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function researchFactText(value: unknown): string {
  if (value === null) return "null（上游为空）";
  if (typeof value === "boolean") return value ? "true（布尔值）" : "false（布尔值）";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value === "" ? "空字符串" : value;
  return "未提供";
}
export function researchScalarRows(value: unknown): Array<[string, string]> {
  return Object.entries(researchObject(value)).flatMap(([key, item]) => item === null || ["string", "number", "boolean"].includes(typeof item) ? [[key, researchFactText(item)]] as Array<[string, string]> : []);
}
export function researchRecordRows(data: Record<string, unknown>): Array<[string, string]> {
  const record = researchObject(data.record), rows: Array<[string, string]> = [];
  const add = (key: string, label: string) => { if (Object.hasOwn(record, key)) rows.push([label, researchFactText(record[key])]); };
  for (const key of ["workId", "opusId", "id", "videoId", "articleVideoId", "authorId", "userId", "uid", "uk", "secUid", "authorName", "nickname", "displayName", "name", "workType", "infoType", "contentType", "articleType", "articleTypeStr", "threadTitle"]) add(key, `响应 ${key}`);
  const seconds = data.platform === "dongchedi" && ["W86F8SSK", "API_1791793668086"].includes(String(data.operationId));
  const milliseconds = data.platform === "yiche" && data.operationId === "YGYYT0G0";
  add("publishTime", `原始 publishTime（${milliseconds ? "毫秒" : seconds ? "秒" : "单位 / 时区未由此确定"}）`);
  add("updateTime", "原始 updateTime（单位 / 时区未由此确定）");
  const durationSeconds = data.platform === "qichezhijia" && data.operationId === "4BOZ9DLE" || data.platform === "baijiahao" && data.operationId === "API_1789097000761";
  add("duration", `响应 duration（${milliseconds ? "毫秒" : durationSeconds ? "秒" : "单位未说明"}）`);
  add("durationSeconds", "响应 durationSeconds（秒）");
  add("articleVideoDurationSeconds", "响应 articleVideoDurationSeconds（秒）");
  add("isEnd", "本项 isEnd（不合成为整页状态）");
  for (const key of ["playCount", "viewCount", "likeCount", "commentCount", "readCount", "shareCount", "collectCount", "followers", "fansNum", "authDesc", "location", "topics"]) add(key, `上游 ${key}`);
  for (const key of ["imageList", "imageUrlList", "resources"]) if (Object.hasOwn(record, key)) rows.push([`响应 ${key}`, Array.isArray(record[key]) ? `${record[key].length} 项` : researchFactText(record[key])]);
  return rows;
}
export function researchBodyFields(data: Record<string, unknown>): Array<[string, string]> {
  const record = researchObject(data.record);
  return ["content", "clearContent", "description", "introduction", "bio", "signature"].flatMap(key => Object.hasOwn(record, key) ? [[key, researchFactText(record[key])]] as Array<[string, string]> : []);
}
export function researchSummaryRows(data: Record<string, unknown>): Array<[string, string]> {
  return ["count", "total", "accountCount", "workCount", "offset", "page", "hasMore"].flatMap(key => {
    if (!Object.hasOwn(data, key)) return [];
    const value = data[key];
    return [[key === "count" ? "本次实际返回 count" : `上游 ${key}`, `${researchFactText(value)}${typeof value === "string" ? "（string）" : typeof value === "number" ? "（number）" : ""}`]] as Array<[string, string]>;
  });
}
export function researchLinks(data: Record<string, unknown>) {
  const record = researchObject(data.record);
  const links: Array<{ key: string; label: string; value: unknown; url: string | null; role: string }> = [];
  const add = (key: string, value: unknown, role: string) => links.push({ key, label: key, value, url: safeExternalUrl(value), role });
  for (const key of ["coverUrl", "cover", "thumbnail", "posterImage", "videoUrl", "playUrl", "authorAvatar", "avatar", "avatarUrl", "shareImageUrl"]) if (Object.hasOwn(record, key)) add(key, record[key], "媒体 / 头像，不是原文");
  for (const key of ["imageList", "imageUrlList"]) if (Array.isArray(record[key])) record[key].forEach((value: unknown, index: number) => add(`${key}[${index}]`, value, "图片媒体，不是原文"));
  if (Array.isArray(record.resources)) record.resources.forEach((item: unknown, index: number) => {
    const resource = researchObject(item);
    if (Object.hasOwn(resource, "downloadUrl")) add(`resources[${index}].downloadUrl`, resource.downloadUrl, "资源下载，不是原文");
  });
  for (const key of ["workUrl", "opusUrl", "titleLink", "cjhUrl", "ycUrl", "communityUrl", "articleUrl"]) if (Object.hasOwn(record, key)) add(key, record[key], "收到的候选地址，仅 data.url 作为本条原文展示");
  for (const key of ["authorUrl", "accountUrl", "homeUrl"]) if (Object.hasOwn(record, key)) add(key, record[key], "账号主页 / 定位，不是作品原文");
  const author = researchObject(record.authorInfo);
  if (Object.hasOwn(author, "avatar")) add("authorInfo.avatar", author.avatar, "嵌套作者头像，不是原文");
  if (Object.hasOwn(record, "url")) add("url", record.url, data.platform === "baijiahao" && data.operationId === "API_1789097000761" ? "视频响应中的作者主页，不是作品原文" : "上游地址，未作为本条原文");
  return links;
}
export function researchCaution(platform: unknown): string {
  switch (platform) {
    case "qichezhijia": return "club、article、video 及原创账号 / 车家号的标识范围各自保留；不按同名 workId 或 authorId 跨范围归并。";
    case "dongchedi": return "请求作品类型与响应 workType 分别保留；外层 accountContext 单独展示，同页账号证据由后台核对，不按请求定位猜作者。";
    case "yiche": return "authorInfo.userId 与顶层 authorId 分开展示，不推定相等；duration 与 durationSeconds 使用各自字段单位，不互相替代。";
    case "baijiahao": return "uk、uid、secUid 仅在本操作范围内展示，不互相替代；视频响应中的 url 是作者主页，播放链接也不是作品原文。";
    case "zhihu": return "answer、article、zvide 内容范围保留；没有收到原文时不按 ID 猜地址，发布时间单位未知，isEnd 仅属于本项。";
    default: return "标识仅按收到的本操作事实展示。";
  }
}
