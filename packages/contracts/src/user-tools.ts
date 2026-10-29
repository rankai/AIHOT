import type { PlatformOperationDescriptor } from "./redfox.ts";

export interface ToolAsset {
  uploads?: Array<{ resultId: number; createdAt: string }>;
  key: string;
  filename: string;
  contentType: string;
  bytes: number;
  width?: number;
  height?: number;
  kind?: string;
  createdAt: string;
  contentUrl: string;
  status: string;
}
export interface ToolResult {
  id: number;
  kind: string;
  title: string;
  text: string;
  url: string | null;
  details: Record<string, string | number | boolean | null>;
  links: Array<{ label: string; url: string }>;
  products?: { cardData: Array<Record<string, string | number | null>>; searchGuid: Array<Record<string, string | number | null>> };
  file: ToolAsset | null;
}
export type ToolRunStatus = "active" | "waiting" | "needs_review" | "stopped" | "completed" | "failed";
export type ToolRunAction = "stop" | "resume" | "abandon";
export type ToolRunCategory = "query" | "ai-search" | "images" | "videos" | "transcriptions" | "xhs-comments" | "media-upload";
export interface ToolRunRow {
  id: number;
  provider: string;
  operationKey: string;
  category: ToolRunCategory;
  title: string;
  summary: string;
  status: ToolRunStatus;
  createdAt: string;
  stepVersion: number;
  generation: number;
}
export interface ToolRunDetail extends ToolRunRow {
  message: string;
  canResume: boolean;
  actions: ToolRunAction[];
  results: ToolResult[];
  nextResultCursor: number | null;
  resultCount: number;
  process: ToolResult[];
  nextProcessCursor: number | null;
  processCount: number;
  originRunId: number | null;
  continuationRunId: number | null;
  recoveryKind: "images/query" | "videos/query" | "ai-search/query" | "transcriptions/query" | "xhs-comments/query" | null;
  charge: { amount: number; state: "reserved" | "review" | "settled" | "released"; consumed: number; released: number } | null;
}
export interface ToolRunPage { rows: ToolRunRow[]; nextCursor: number | null }
export interface ToolAssetPage { items: ToolAsset[]; nextCursor: string | null }
export type UserToolOperation = PlatformOperationDescriptor;
