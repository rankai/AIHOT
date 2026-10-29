import type { ToolAsset, ToolResult } from "@aihot/contracts/user-tools";
import { safeExternalUrl } from "../admin/platform-types.ts";

const TITLES: Record<string, string> = {
  image: "生成图片", video: "生成视频", ai_search_answer: "AI 搜索回答", ai_search_citation: "参考来源",
  transcription: "转写正文", subtitle_track: "字幕文件", media_upload: "上传结果", query_summary: "查询摘要",
  result_expired: "结果内容已过期", xhs_comment: "评论", xhs_comment_reply: "评论回复", xhs_comment_task: "评论查询摘要",
};

export function resultTitle(result: ToolResult, fallback = "查询结果"): string {
  const title = result.title.trim();
  if (title && title !== result.kind) return title;
  return TITLES[result.kind] ?? fallback;
}

/** Only the authenticated local asset endpoint can supply inline media or downloads. */
export function availableResultFile(result: ToolResult): ToolAsset | null {
  const file = result.file;
  return file?.status === "available" && file.contentUrl === `/api/tools/assets/${encodeURIComponent(file.key)}/content` ? file : null;
}

const LINK_LABELS: Record<string, string> = {
  url: "查看来源", opusUrl: "查看作品", workUrl: "查看作品", sourceUrl: "查看来源", originalUrl: "查看原文",
  resourceUrl: "查看资源", downloadUrl: "下载资源", videoUrl: "视频资源", videoLink: "视频资源", audioUrl: "音频资源",
  imageUrl: "图片资源", picUrl: "图片资源", articleUrl: "查看文章", oriUrl: "查看原文", postUrl: "查看原文", permalink: "查看原文",
  shareUrl: "查看作品", share_url: "查看作品", shareLink: "查看作品", shareInfoLink: "查看作品",
  avatarUrl: "查看头像", avatar: "查看头像", avatarImage: "查看头像", avatar_url: "查看头像", accountAvatar: "查看头像",
  profileImageUrl: "查看头像", profilePicUrl: "查看头像", profilePicUrlHd: "查看头像", profile_image: "查看头像",
  cover: "查看封面", coverUrl: "查看封面", cover_url: "查看封面", thumbnailUrl: "查看缩略图",
  profileUrl: "账号主页", homeUrl: "账号主页", channelUrl: "频道主页", accountLink: "账号主页", userJumpUrl: "账号主页",
  photoJumpUrl: "查看作品", website: "网站",
};
function linkLabel(value: string, fallback: string): string {
  if (LINK_LABELS[value]) return LINK_LABELS[value];
  if (/^(?:txt|srt|vtt|ass|lrc|json|mp4|mp3|wav|png|jpg|webp)$/i.test(value)) return `${value.toUpperCase()} 文件`;
  const numbered = /^(images|picUrl|pictures|formats|media|medias|imageUrls|imageUrlList|picList|thumbnails|carouselItems|bioLinks|hotSpotList) (\d+)$/.exec(value);
  if (numbered) return `${/image|pic|thumbnail|carousel/i.test(numbered[1]!) ? "图片" : "资源"} ${numbered[2]}`;
  return value && !/^[a-z]+(?:[A-Z_][a-zA-Z_]*)+$/.test(value) ? value : fallback;
}

export interface ResultLink { url: string; label: string; host: string }
export function resultLinks(result: ToolResult): ResultLink[] {
  const links: ResultLink[] = [], seen = new Set<string>();
  for (const item of [{ label: "查看来源", url: result.url }, ...result.links]) {
    const url = safeExternalUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const host = new URL(url).hostname;
    links.push({ url, label: linkLabel(item.label, host), host });
  }
  return links;
}

export function citationSources(results: ToolResult[]): Array<ResultLink & { text: string }> {
  const sources: Array<ResultLink & { text: string }> = [], seen = new Set<string>();
  // Explicit citations retain their titles and excerpts when an answer repeats the same URL.
  const ordered = [...results.filter(result => result.kind === "ai_search_citation"), ...results.filter(result => result.kind !== "ai_search_citation")];
  for (const result of ordered) {
    for (const link of resultLinks(result)) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      sources.push({ ...link, label: result.kind === "ai_search_citation" && result.title.trim() && result.title !== result.kind ? result.title : link.host, text: result.kind === "ai_search_citation" ? result.text : "" });
    }
  }
  return sources;
}

const LABELS: Record<string, string> = {
  authorUid: "作者 ID", authorNickname: "作者", urlToken: "主页标识", hotValue: "热度", rank: "排名", label: "标签", nextUrl: "下一页地址",
  platform: "平台", nickname: "昵称", username: "账号", screen_name: "账号", nick_name: "昵称", authorName: "作者", accountName: "账号", accountId: "账号 ID", userName: "账号", userHandle: "账号", user_nickname: "昵称", location: "地区",
  publishedAt: "发布时间", publishTime: "发布时间", createdAt: "创建时间", created_at: "创建时间", createTime: "创建时间", create_time: "创建时间", publishDate: "发布日期", publicTime: "发布时间", workPublishTime: "发布时间", takenAtDate: "拍摄日期", gmtCreate: "创建时间",
  status: "状态", progress: "进度", taskId: "任务 ID", requestedTaskId: "原任务 ID", workId: "作品 ID", opusId: "作品 ID", commentId: "评论 ID", tweetId: "帖子 ID", uid: "用户 ID", userId: "用户 ID", restId: "记录 ID", rest_id: "记录 ID", mid: "记录 ID", channelId: "频道 ID",
  count: "数量", total: "总量", actualCount: "实际数量", dataNum: "数据量", received: "返回数量", matchedCount: "匹配数量", recommendedCount: "推荐数量", citationCount: "引用数量", estimatedResults: "预计结果数", videoCount: "视频数",
  likeCount: "点赞数", likeNum: "点赞数", commentCount: "评论数", replyCount: "回复数", shareCount: "分享数", viewCount: "浏览数", playCount: "播放数", followersCount: "粉丝数", followerCount: "粉丝数", followingCount: "关注数", followers: "粉丝数", following: "关注数", mediaCount: "媒体数", tweetCount: "帖子数",
  followers_count: "粉丝数", following_count: "关注数", friends_count: "好友数", comment_count: "评论数", elected_comment_count: "精选评论数", digg_count: "点赞数", reply_count: "回复数", share_count: "分享数", view_count: "浏览数", play_count: "播放数", like_count: "点赞数", favorite_count: "收藏数", collect_count: "收藏数", statuses_count: "帖子数", media_count: "媒体数", likes: "点赞数", views: "浏览数", favorites: "收藏数", quotes: "引用数", replies: "回复数", retweets: "转发数", bookmarks: "收藏数",
  duration: "时长", durationSeconds: "时长（秒）", durationUnit: "时长单位", publishTimeUnit: "时间单位", width: "宽度", height: "高度", resolution: "分辨率", size: "尺寸", model: "模型", family: "模型系列", engine: "搜索引擎", languageName: "语言", languageTag: "语言代码", format: "格式", segmentCount: "时间片段数", reportedType: "资源类型", lastFrameMissing: "末帧缺失", visibleAfterTime: "可见时间", timestampUnit: "时间单位",
  topSearchName: "热搜词", topSearchNum: "热度", hotCount: "热度", hot_value: "热度", rankNo: "排名", accountRanking: "账号排名", rankDate: "榜单日期", rankPeriod: "榜单周期", maxHotScore: "最高热度", maxPosition: "最高排名", firstRankTime: "首次上榜", latestRankDate: "最近上榜", platName: "平台", discuss: "讨论数", discuss_num: "讨论数", articleCount: "文章数", totalInteractiveCount: "互动量",
  page: "页码", pageNum: "页码", pageSize: "每页数量", pages: "总页数", hasMore: "还有更多", has_more: "还有更多", nextCursor: "下一页游标", prevCursor: "上一页游标", cursor: "游标", next_cursor: "下一页游标", prev_cursor: "上一页游标", offset: "偏移量", next_offset: "下一页偏移量", paginationToken: "翻页标识", continuationToken: "后续页标识", pageToken: "页面标识", minTime: "最早时间", cursor_score: "游标分值", moreUsers: "还有更多用户", more_users: "还有更多用户", snapshot: "快照", bootstrap: "初始页", accountState: "账号状态", profileIsBlank: "资料为空",
  prohibitedWordsType: "违规词类型", captionHashtags: "话题标签", plats: "平台",
};
const HIDDEN = new Set(["textMeaning", "subtitleFilesFetched", "resourceFilesFetched", "role"]);
const METRICS = /^(?:count|total|actualCount|dataNum|received|matchedCount|recommendedCount|citationCount|estimatedResults|videoCount|.*Count|.*_count|likeNum|likes|views|favorites|quotes|replies|retweets|bookmarks|followers|following|hotCount|hot_value|topSearchNum)$/;
export function resultDetails(result: ToolResult, metricsOnly = false): Array<{ key: string; label: string; value: string }> {
  return Object.entries(result.details).flatMap(([key, value]) => {
    if (value === null || value === "" || HIDDEN.has(key) || (metricsOnly && !METRICS.test(key))) return [];
    const bare = key.replace(/^(?:pagination|paging\.root|paging\.data)\./, "");
    return [{ key, label: `${bare !== key ? "分页 · " : ""}${LABELS[bare] ?? "其他信息"}`, value: typeof value === "boolean" ? value ? "是" : "否" : typeof value === "number" ? value.toLocaleString("zh-CN") : value }];
  });
}

export function processStage(result: ToolResult): string {
  if (result.kind.endsWith("_reference")) return "准备参考素材";
  if (result.kind === "image_task") return "图片生成进度";
  if (result.kind === "video_task") return "视频生成进度";
  if (result.kind === "ai_search_task") return "AI 搜索进度";
  if (result.kind === "transcription_task") return "转写进度";
  if (result.kind === "xhs_comment_task") return "评论查询进度";
  return "执行记录";
}

export function resultStatus(value: unknown): string {
  const statuses: Record<string, string> = { pending: "等待处理", queued: "排队中", waiting: "等待结果", active: "执行中", running: "执行中", processing: "处理中", in_progress: "处理中", submitted: "已提交", succeeded: "已完成", success: "已完成", completed: "已完成", done: "已完成", failed: "失败", error: "失败", cancelled: "已取消", canceled: "已取消", stopped: "已停止", ready: "已就绪", uploaded: "已上传" };
  return typeof value === "string" ? statuses[value.toLowerCase()] ?? (/[^\x00-\x7F]/.test(value) ? value : "已记录") : "已记录";
}
