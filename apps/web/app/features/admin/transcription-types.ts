export type TranscriptionPlatform = "douyin" | "xiaohongshu" | "shipinhao" | "kuaishou" | "bilibili" | "videoUrl";
export type TranscriptionMode = "submit" | "query";
export interface TranscriptionPlan { submissionLimit: 0 | 1; pollLimit: number; pollDeadlineSeconds: number }
export interface TranscriptionOptions {
  platforms: Array<{ platform: TranscriptionPlatform; label: string; submit: string; poll: string; submitEstimatedCny: number; pollEstimatedCny: number }>;
  limits: { steps: number; polls: number; retries: number; pollDeadlineSeconds: number; externalAttempts: number; pollIntervalSeconds: number; maxPollIntervalSeconds: number };
  services: { submission: string; poll: string };
  timestampUnit: "milliseconds";
  inputHint: string;
  resultPurpose: string;
}
