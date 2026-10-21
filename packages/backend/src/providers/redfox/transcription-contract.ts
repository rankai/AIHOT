import { z } from "zod";

export const transcriptionPairs = {
  douyin: { label: "抖音", submit: "8DCJW2ZF", poll: "D4YT0XVJ" },
  xiaohongshu: { label: "小红书", submit: "DCZW5V7A", poll: "9UHXOXSF" },
  shipinhao: { label: "视频号", submit: "HR8CU3GG", poll: "6QSXFDZV" },
  kuaishou: { label: "快手", submit: "8TUUDDCJ", poll: "PNNXJ463" },
  bilibili: { label: "哔哩哔哩", submit: "SQ4FHFZX", poll: "YYXG62WO" },
  videoUrl: { label: "视频播放直链", submit: "API_1792033347215", poll: "3J8LSOJZ" },
} as const;
export const TranscriptionPlatform = z.enum(["douyin", "xiaohongshu", "shipinhao", "kuaishou", "bilibili", "videoUrl"]);
// Preserve sharing prose and whitespace; the fixed upstream endpoint resolves it, never this server.
const Source = z.string().min(1).max(10000).refine(v => v.trim().length > 0, "请输入链接或分享文案");
export const TranscriptionTaskId = z.string().min(1).max(500).refine(v => v.trim().length > 0);
export const TranscriptionInput = z.object({ platform: TranscriptionPlatform, url: Source }).strict();
export const TranscriptionQuery = z.object({ platform: TranscriptionPlatform, taskId: TranscriptionTaskId }).strict();
export const TRANSCRIPTION_LIMITS = { steps: 62, polls: 60, retries: 3, pollDeadlineSeconds: 7200, externalAttempts: 100, pollIntervalSeconds: 10, maxPollIntervalSeconds: 30 };

export const transcriptionPaths = {
  "8DCJW2ZF": "/story/api/parseWork/audioTextExtract/submit/douyin",
  "D4YT0XVJ": "/story/api/parseWork/audioTextExtract/result/douyin",
  "DCZW5V7A": "/story/api/parseWork/audioTextExtract/submit/xhs",
  "9UHXOXSF": "/story/api/parseWork/audioTextExtract/result/xhs",
  "HR8CU3GG": "/story/api/parseWork/sphSubtitle/submit",
  "6QSXFDZV": "/story/api/parseWork/sphSubtitle/result",
  "8TUUDDCJ": "/story/api/parseWork/audioTextExtract/submit/kuaishou",
  "PNNXJ463": "/story/api/parseWork/audioTextExtract/result/kuaishou",
  "SQ4FHFZX": "/story/api/parseWork/bilibiliSubtitle/submit",
  "YYXG62WO": "/story/api/parseWork/bilibiliSubtitle/result",
  "API_1792033347215": "/story/api/parseWork/audioTextExtract/submit/videoUrl",
  "3J8LSOJZ": "/story/api/parseWork/audioTextExtract/result",
} as const;
