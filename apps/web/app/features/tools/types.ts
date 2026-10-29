import type { PlatformOperationDescriptor } from "@aihot/contracts/redfox";
import type { ImageOptions } from "../admin/image-types";
import type { VideoOptions } from "../admin/video-types";
import type { AiSearchOptions } from "../admin/ai-search-types";
import type { TranscriptionOptions } from "../admin/transcription-types";
import type { XhsCommentOptions } from "../admin/xhs-comment-types";
import type { AssetUploadOptions } from "../admin/asset-types";

export interface ToolOptions {
  operations: PlatformOperationDescriptor[];
  images: ImageOptions;
  videos: VideoOptions;
  aiSearch: AiSearchOptions;
  transcriptions: TranscriptionOptions;
  xhsComments: XhsCommentOptions;
  assets: AssetUploadOptions;
  limits: { activeRuns: number; submissionsPerMinute: number; storageBytes: number; storageFiles: number };
}

export const TOOL_STATUS: Record<string, string> = {
  active: "执行中", queued: "排队中", running: "执行中", waiting: "等待结果", succeeded: "已完成", completed: "已完成", failed: "执行失败",
  paused: "已暂停", stopped: "已停止", abandoned: "已放弃", cancelled: "已取消", blocked: "等待处理", needs_review: "需要处理",
};
export const activeRun = (status: string) => ["active", "queued", "running", "waiting", "waiting_budget", "waiting_poll", "waiting_retry"].includes(status);
export function toolTitle(key: string) {
  if (key.includes("image")) return "图片创作";
  if (key.includes("video.generate") || key.includes("video.query")) return "视频创作";
  if (key.includes("ai_search")) return "AI 搜索";
  if (key.includes("transcript")) return "视频转写";
  if (key.includes("xhs_comments")) return "小红书评论";
  if (key.includes("media.upload")) return "素材上传";
  return "数据查询";
}
