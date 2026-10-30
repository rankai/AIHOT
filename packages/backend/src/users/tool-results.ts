import type { ToolResult } from "@aihot/contracts/user-tools";
import type { AssetRow } from "../operations/assets.ts";
import { stripTags } from "../lib/text.ts";
import { toolAssetDto } from "./tool-assets.ts";
import { sql } from "../db.ts";

// The only result/process boundary, reused by detail, counts and complete exports.
// A completed comment task is also its final (possibly empty) result summary.
export function toolBusinessResultSql() {
  const kind = sql`CASE WHEN z.kind='result_expired' THEN COALESCE(z.data->>'originalKind','result_expired') ELSE z.kind END`;
  return sql`(${kind} NOT IN ('image_reference','video_reference','image_task','video_task','ai_search_task','transcription_task','xhs_comment_task')
    OR (${kind}='xhs_comment_task' AND COALESCE(COALESCE(z.data->>'status',z.data->>'originalStatus')='completed',false)))`;
}

const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const firstText = (...values: unknown[]) => values.find(v => typeof v === "string" && v.trim()) as string | undefined;
export function toolSafeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
// Business fields are selected explicitly; vendor extensions/raw response records never cross this DTO.
const detailKeys = [
  "authorUid", "authorNickname", "urlToken", "hotValue", "rank", "label", "nextUrl",
  "platform", "nickname", "username", "screen_name", "nick_name", "authorName", "accountName", "accountId", "userName", "userHandle", "user_nickname", "location",
  "publishTime", "publishedAt", "createdAt", "created_at", "createTime", "create_time", "publishDate", "publicTime", "workPublishTime", "takenAtDate", "gmtCreate",
  "status", "progress", "taskId", "requestedTaskId", "workId", "opusId", "commentId", "tweetId", "uid", "userId", "restId", "rest_id", "mid", "channelId",
  "count", "total", "actualCount", "dataNum", "received", "matchedCount", "recommendedCount", "citationCount", "estimatedResults", "videoCount",
  "likeCount", "likeNum", "commentCount", "replyCount", "shareCount", "viewCount", "playCount", "followersCount", "followerCount", "followingCount", "followers", "following", "mediaCount", "tweetCount",
  "followers_count", "following_count", "friends_count", "comment_count", "elected_comment_count", "digg_count", "reply_count", "share_count", "view_count", "play_count", "like_count", "favorite_count", "collect_count", "statuses_count", "media_count", "likes", "views", "favorites", "quotes", "replies", "retweets", "bookmarks",
  "mode", "durationMs", "hasAudio", "duration", "durationSeconds", "durationUnit", "publishTimeUnit", "width", "height", "resolution", "size", "model", "family", "engine", "languageName", "languageTag", "format", "role", "reportedType", "lastFrameMissing", "textMeaning", "subtitleFilesFetched", "resourceFilesFetched", "visibleAfterTime", "timestampUnit",
  "topSearchName", "topSearchNum", "hotCount", "hot_value", "rankNo", "accountRanking", "rankDate", "rankPeriod", "maxHotScore", "maxPosition", "firstRankTime", "latestRankDate", "platName", "discuss", "discuss_num", "articleCount", "totalInteractiveCount",
  "page", "pageNum", "pageSize", "pages", "hasMore", "has_more", "nextCursor", "prevCursor", "cursor", "next_cursor", "prev_cursor", "offset", "next_offset", "paginationToken", "continuationToken", "pageToken", "minTime", "cursor_score", "moreUsers", "more_users", "snapshot", "bootstrap", "accountState", "profileIsBlank",
];
const urlKeys = ["url", "opusUrl", "workUrl", "sourceUrl", "resourceUrl", "originalUrl", "shareUrl", "share_url", "shareLink", "shareInfoLink", "downloadUrl", "videoUrl", "videoLink", "audioUrl", "imageUrl", "picUrl", "avatarUrl", "avatar", "avatarImage", "avatar_url", "accountAvatar", "cover", "coverUrl", "cover_url", "thumbnailUrl", "profileImageUrl", "profilePicUrl", "profilePicUrlHd", "profile_image", "profileUrl", "homeUrl", "channelUrl", "accountLink", "photoJumpUrl", "userJumpUrl", "articleUrl", "oriUrl", "postUrl", "permalink", "website"];

function listText(raw: unknown, keys: string[]) {
  return Array.isArray(raw) ? raw.slice(0, 1000).map(value => {
    if (typeof value === "string") return value;
    const item = object(value);
    return keys.map(key => item[key]).filter(value => typeof value === "string" || typeof value === "number").join(" · ");
  }).filter(Boolean).join("\n") : "";
}

export function projectToolResult(row: { id: number; kind: string; data: unknown; file?: AssetRow | null }): ToolResult {
  const d = object(row.data), record = object(d.record), result = object(d.result), metadata = object(d.reportedMetadata);
  const author = object(record.author ?? record.authorInfo ?? record.userData ?? d.author), user = object(record.user ?? record.user_info);
  const layers = [d, record, result, author, user, metadata, object(d.identity)];
  const title = firstText(d.title, d.workTitle, d.name, d.nickname, d.displayName, d.username, metadata.title, record.title, record.workTitle, record.articleTitle, record.display_title, record.name, record.nickname, record.fullName, d.topSearchName, record.topSearchName) ?? row.kind;
  const article = firstText(record.articleContent);
  const text = firstText(d.text, d.originalContent, result.content, d.content, d.description, d.desc, d.summary,
    object(record.content).message, record.text, record.full_text, record.display_text, article ? stripTags(article) : undefined, record.content, record.workDesc,
    record.captionText, record.caption, record.aweme_desc, record.description, record.desc, record.articleSummary, record.summary, record.digest,
    record.biography, record.signature, user.description, user.signature, metadata.description, metadata.desc, d.statusText, d.limitation, record.tips) ?? "";
  const details: ToolResult["details"] = {};
  for (const key of detailKeys) {
    const value = layers.map(v => v[key]).find(v => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
    if (value !== undefined) details[key] = typeof value === "string" ? value.slice(0, 4000) : value as number | boolean;
  }
  if (typeof record.follower === "number") details.followerCount = record.follower;
  if (d.platform === "bilibili") {
    const fields = { followerCount: record.follower, likeCount: record.like, replyCount: record.rcount, authorName: object(record.member).uname };
    for (const [key, value] of Object.entries(fields)) if (typeof value === "number" || typeof value === "string") details[key] = typeof value === "string" ? value.slice(0, 4000) : value;
  }
  if (d.platform === "zhihu") {
    if (object(d.timeUnits).publishTime === "seconds") details.publishTimeUnit = "seconds";
    if (row.kind === "social_comment" && typeof record.id === "string") details.commentId = record.id.slice(0, 4000);
  }
  if (row.kind === "subtitle_track") {
    details.textMeaning = "video-description";
    details.subtitleFilesFetched = false;
  }
  // Keep public continuation values usable without returning the original provider envelope.
  const paging = object(d.reportedPaging);
  for (const [scope, page] of [["pagination", object(d.pagination)], ["paging.root", object(paging.root)], ["paging.data", object(paging.data)]] as const) {
    for (const key of detailKeys) {
      const value = page[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") details[`${scope}.${key}`] = typeof value === "string" ? value.slice(0, 4000) : value;
    }
  }
  for (const key of ["prohibitedWordsType", "captionHashtags", "plats"]) {
    const value = layers.map(layer => layer[key]).find(Array.isArray);
    if (Array.isArray(value)) details[key] = value.filter((item): item is string => typeof item === "string").slice(0, 100).join("、").slice(0, 4000);
  }
  const links: ToolResult["links"] = [];
  const seen = new Set<string>();
  const add = (label: string, raw: unknown) => { const url = toolSafeUrl(raw); if (url && !seen.has(url) && links.length < 100) { seen.add(url); links.push({ label, url }); } };
  if (d.platform === "zhihu") add("avatarUrl", record.avatorUrl);
  for (const layer of [d, record, result, metadata, author, user]) {
    for (const key of urlKeys) add(key, layer[key]);
    for (const key of ["images", "picUrl", "pictures", "formats", "media", "medias", "imageUrls", "imageUrlList", "picList", "thumbnails", "carouselItems", "bioLinks", "hotSpotList"]) {
      const values = layer[key];
      if (!Array.isArray(values)) continue;
      values.slice(0, 100).forEach((v, index) => {
        if (typeof v === "string") add(`${key} ${index + 1}`, v);
        else { const item = object(v); for (const name of urlKeys) add(firstText(item.format, item.languageName) ?? `${key} ${index + 1}`, item[name]); }
      });
    }
  }
  const sections = [text,
    listText(d.list, ["topSearchName", "topSearchNum", "title", "name", "word", "hotValue"]),
    listText(record.hotSpotList, ["title", "hotCount", "platName", "maxHotScore"]),
    Array.isArray(record.hotTopics) ? `热门话题\n${listText(record.hotTopics, ["topic", "articleCount", "totalInteractiveCount"])}` : "",
    Array.isArray(record.relatedSearches) ? `相关搜索\n${listText(record.relatedSearches, ["keyword", "articleCount"])}` : "",
  ];
  if (Array.isArray(d.stampSents) && d.stampSents.length) {
    details.segmentCount = d.stampSents.length;
    sections.push(`时间片段（毫秒）\n${listText(d.stampSents, ["start", "end", "textSeg"])}`);
  }
  const products = row.kind === "ai_search_answer" && ["qianwenProducts", "doubaoProducts"].includes(String(d.family)) ? projectSearchProducts(result, d.family === "doubaoProducts") : undefined;
  return { id: row.id, kind: row.kind, title: title.slice(0, 1000), text: sections.filter(Boolean).join("\n\n").slice(0, 500_000), url: toolSafeUrl(d.url ?? d.opusUrl ?? d.workUrl ?? record.url ?? record.workUrl ?? record.shareUrl), details, links, ...(products ? { products } : {}), file: row.file ? toolAssetDto(row.file) : null };
}

function projectSearchProducts(result: Record<string, unknown>, withReferences: boolean): NonNullable<ToolResult["products"]> {
  const select = (raw: unknown, fields: string[], urls: string[]) => (Array.isArray(raw) ? raw : []).slice(0, 1000).map(value => {
    const source = object(value), selected: Record<string, string | number | null> = {};
    for (const key of fields) {
      const field = source[key];
      if (field === null || typeof field === "number" || typeof field === "string") selected[key] = typeof field === "string" ? field.slice(0, 4000) : field;
    }
    for (const key of urls) selected[key] = toolSafeUrl(source[key]);
    return selected;
  });
  return {
    cardData: select(result.cardData, ["title", "price", "originPrice", "shopName", "sales", "sourceSeq", "itemId", "productId", "shortTitle", "pos"], ["url", "image"]),
    searchGuid: withReferences ? select(result.searchGuid, ["id", "index", "title", "name", "text", "content", "snippet", "summary", "siteName", "publishTime"], ["url"]) : [],
  };
}
