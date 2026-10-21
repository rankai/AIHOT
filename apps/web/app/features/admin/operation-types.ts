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

export const operationLabel: Record<string, string> = { "redfox.platform.collection": "平台采集订阅", "redfox.xhs_comments.submit": "小红书异步评论", "redfox.xhs_comments.query": "查询已有小红书评论任务", "redfox.video.generate": "视频创作", "redfox.video.query": "查询已有视频任务", "redfox.ai_search.submit": "AI 搜索", "redfox.ai_search.query": "查询已有 AI 搜索任务", "redfox.media.upload": "上传素材到 Redfox", "redfox.transcript.submit": "语音转写", "redfox.transcript.query": "查询已有转写任务", "x.search": "X 搜索采集", "mp.history": "公众号采集", "redfox.x.timeline": "X 账号采集", "redfox.x.account": "X 账号查询", "redfox.x.detail": "X 推文详情查询", "redfox.image.generate": "图片创作", "redfox.image.query": "查询已有图片任务", "redfox.sync.query": "平台查询", "redfox.weibo.collection": "微博定时采集", "redfox.wechat.collection": "公众号 Redfox 采集", "agentkey.douyin.search": "AgentKey 抖音搜索" };
