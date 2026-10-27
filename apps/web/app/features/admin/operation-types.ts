import type { XhsCommentPlan } from "./xhs-comment-types";
import type { VideoPlan } from "./video-types";
import type { AiSearchPlan } from "./ai-search-types";
import type { TranscriptionPlan } from "./transcription-types";
export interface OperationAccepted { runId: number; status: string }
export interface SourcePreview { ms: number; count: number; items: Array<{ title: string; url: string; publishedAt: string | null; excerpt: string }> }
export type PreviewResponse = SourcePreview | OperationAccepted;
export interface OperationRow {
  id: number; status: string; provider: string; operationKey: string; step: string; stepVersion: number;
  generation: number; waitReason: string | null; nextAttemptAt: string | null; createdAt: string;
}
export interface OperationFile { key: string; status: string; contentType: string; bytes: number; filename: string; width: number | null; height: number | null }
export interface OperationResult {
  id: number; kind: string; data: Record<string, unknown>; receiptId: number | null;
  articleId: string | null; articleTitle?: string | null; sourceId: string | null; fileKey: string | null; imported: boolean; file: OperationFile | null;
}
export interface OperationDetail extends OperationRow {
  subscriptionId: number | null;
  currentReceiptId: number | null; receiptId: number | null; receipt: { status: string; attempts: number; model?: string | null } | null; jobState: string | null;
  nextAction: string; nextResultCursor: number | null; results: OperationResult[];
  inputs: { tool?:string;upstream?:string;xhsCommentPlan?: XhsCommentPlan; videoPlan?: VideoPlan; family?: string; aiSearchPlan?: AiSearchPlan; operationId?: string; platform?: string; mode?: string; draft?: boolean; window?: string; sources?: Array<{ id: string; name?: string; config?: Record<string, unknown>; interval_minutes?: number }>; parameters?: Record<string, unknown>; fileKeys?: string[]; transcriptionPlan?: TranscriptionPlan; imagePlan?: { referenceUploadLimit: number; submissionLimit: number; pollLimit: number; pollDeadlineSeconds: number; submissionCost: null }; recoveryUnavailable?: boolean };
  progress: Record<string, unknown>;
  attempts: Array<{ id: number; attempt: number; status: string; started_at: string; finished_at: string | null; error: string | null; has_retained_response: boolean }>;
}
export const operationStatus: Record<string, string> = { active: "进行中", waiting: "等待中", needs_review: "需要核对", stopped: "已停止", completed: "已完成", failed: "已结束" };
export const operationAction: Record<string, string> = { "view-results": "查看结果", "review-unknown": "核对未知回执", "review-or-resume": "核对后恢复或放弃", "local-recovery": "等待本地恢复已收响应", "wait-for-job": "等待队列执行", "wait-for-recovery": "等待恢复调度" };
export function operationEnded(status: string) { return status === "completed" || status === "failed"; }

export const operationLabel: Record<string, string> = {
  "agentkey.x.search": "AgentKey X 帖子搜索",
  "agentkey.x.account_posts": "AgentKey X 账号帖子",
  "agentkey.x.detail": "AgentKey X 帖子详情",
  "agentkey.x.comments": "AgentKey X 会话评论",
  "agentkey.x.account_profile": "AgentKey X 账号资料",
  "agentkey.x.followers": "AgentKey X 粉丝列表",
  "agentkey.x.following": "AgentKey X 关注列表",
  "agentkey.x.list_posts": "AgentKey X 列表帖子",
  "agentkey.x.community_posts": "AgentKey X 社区帖子",
  "agentkey.x.trending": "AgentKey X 趋势词",
  "agentkey.x.list_members": "AgentKey X 列表成员",
  "agentkey.x.community_members": "AgentKey X 社区成员",
  "agentkey.weibo.search": "AgentKey 微博作品搜索", "agentkey.weibo.account_posts": "AgentKey 微博账号作品", "agentkey.weibo.detail": "AgentKey 微博作品详情", "agentkey.weibo.account_profile": "AgentKey 微博用户资料", "agentkey.weibo.comments": "AgentKey 微博评论快照", "agentkey.weibo.following": "AgentKey 微博关注快照", "agentkey.weibo.trending": "AgentKey 微博热搜快照", "agentkey.weibo.related_search": "AgentKey 微博相关搜索词", "agentkey.bilibili.search": "AgentKey B站搜索", "agentkey.bilibili.typed_search": "AgentKey B站视频分类搜索", "agentkey.bilibili.account_posts": "AgentKey B站账号视频", "agentkey.bilibili.detail": "AgentKey B站视频详情", "agentkey.bilibili.account_profile": "AgentKey B站账号资料", "agentkey.bilibili.comments": "AgentKey B站评论快照", "agentkey.bilibili.comment_replies": "AgentKey B站回复快照", "agentkey.bilibili.relation_stats": "AgentKey B站关系统计", "agentkey.bilibili.dynamics": "AgentKey B站动态研究", "agentkey.bilibili.trending": "AgentKey B站推荐研究", "agentkey.bilibili.hot_search": "AgentKey B站热搜快照", "redfox.platform.collection": "平台采集订阅", "redfox.xhs_comments.submit": "小红书异步评论", "redfox.xhs_comments.query": "查询已有小红书评论任务", "redfox.video.generate": "视频创作", "redfox.video.query": "查询已有视频任务", "redfox.ai_search.submit": "AI 搜索", "redfox.ai_search.query": "查询已有 AI 搜索任务", "redfox.media.upload": "上传素材到 Redfox", "redfox.transcript.submit": "语音转写", "redfox.transcript.query": "查询已有转写任务", "x.search": "X 搜索采集", "mp.history": "公众号采集", "redfox.x.timeline": "X 账号采集", "redfox.x.account": "X 账号查询", "redfox.x.detail": "X 推文详情查询", "redfox.image.generate": "图片创作", "redfox.image.query": "查询已有图片任务", "redfox.sync.query": "平台查询", "redfox.weibo.collection": "微博定时采集", "redfox.wechat.collection": "公众号 Redfox 采集", "agentkey.douyin.search": "AgentKey 抖音搜索", "agentkey.douyin.account_posts": "AgentKey 抖音账号作品", "agentkey.douyin.detail": "AgentKey 抖音作品详情", "agentkey.douyin.account_search": "AgentKey 抖音账号搜索", "agentkey.douyin.suggest": "AgentKey 抖音搜索建议", "agentkey.wechat_mp.account_articles": "AgentKey 公众号文章列表", "agentkey.wechat_mp.detail": "AgentKey 公众号 H5 详情", "agentkey.wechat_mp.account_profile": "AgentKey 公众号资料", "agentkey.wechat_mp.comments": "AgentKey 公众号评论", "agentkey.wechat_mp.comment_replies": "AgentKey 公众号评论回复", "agentkey.wechat_mp.article_stats": "AgentKey 公众号评论统计", "agentkey.douyin.trending": "AgentKey 抖音热点快照", "agentkey.douyin.comments": "AgentKey 抖音评论快照", "agentkey.douyin.comment_replies": "AgentKey 抖音回复快照", "agentkey.douyin.topic_posts": "AgentKey 抖音话题作品快照", "agentkey.douyin.following": "AgentKey 抖音关注快照", "agentkey.douyin.account_profile": "AgentKey 抖音账号资料（仅注销态）", "agentkey.toutiao.article_detail": "AgentKey 头条文章详情", "agentkey.toutiao.comments": "AgentKey 头条评论快照", "agentkey.toutiao.account_profile": "AgentKey 头条账号资料（仅查询）", "agentkey.xiaohongshu.search": "AgentKey 小红书笔记搜索", "agentkey.xiaohongshu.account_posts": "AgentKey 小红书账号笔记", "agentkey.xiaohongshu.detail": "AgentKey 小红书统一笔记详情", "agentkey.xiaohongshu.account_search": "AgentKey 小红书账号搜索", "agentkey.xiaohongshu.account_profile": "AgentKey 小红书账号资料", "agentkey.xiaohongshu.topic_posts": "AgentKey 小红书话题笔记", "agentkey.xiaohongshu.comments": "AgentKey 小红书评论快照", "agentkey.xiaohongshu.suggest": "AgentKey 小红书搜索建议", "agentkey.xiaohongshu.recommendations": "AgentKey 小红书推荐研究" };
