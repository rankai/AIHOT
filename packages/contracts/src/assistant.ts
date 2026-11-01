import type { ToolQuote } from "./credits.ts";
export type AssistantId = "creative" | "xiaohongshu";
export type AssistantPhase =
  | "executing"
  | "waiting_question"
  | "waiting_approval"
  | "waiting_child"
  | "completed"
  | "stopped"
  | "needs_review";
export interface AssistantTaskHint {
  actionId: string;
}
export interface AssistantAction {
  actionId: string;
  label: string;
  available: boolean;
  reason: string | null;
}
export interface AssistantProfileDto {
  id: AssistantId;
  name: string;
  version: string;
  welcome: string;
  available: boolean;
  reason: string | null;
  actions: AssistantAction[];
}
export interface AssistantFeePrice { priceId: string; priceVersion: number; amount: number }
export interface AssistantFeeAuthorization {
  id: string; version: number; enabled: boolean; totalLimit: number; allowSearch: boolean;
  used: number; remaining: number; turnPrice: AssistantFeePrice; searchPrice: AssistantFeePrice | null; perTurnLimit: number;
}
export interface AssistantFeeSettings { authorization: AssistantFeeAuthorization | null; prices: { turn: AssistantFeePrice; search: AssistantFeePrice | null } }
export interface AssistantOptions {
  inputCapabilities: { fileTypes: string[]; maxAttachments: number; maxFileBytes: number };
  assistants: AssistantProfileDto[];
  limits: { modelCalls: number; activeTurns: number; inputCharacters: number };
}
export interface AssistantArtifactContent {
  title: string;
  body: string;
  intent: "outline" | "draft" | "rewrite";
  titles: string[];
  tags: string[];
  sources: string[];
  partial: boolean;
  scope: string;
}
export interface AssistantSource {
  id: string;
  kind: "user-material" | "artifact" | "research";
  label: string;
  url: string | null;
  /** Server-owned verification; never accepted from editable content. */
  research?: { analysisCallId: string; application: { explanation: string } };
}
export interface AssistantArtifact {
  artifactId: string;
  version: number;
  kind: "text-draft" | "xhs-note";
  schemaVersion: 1;
  content: AssistantArtifactContent;
  sources: AssistantSource[];
}
export interface AssistantMessage {
  id: string;
  seq: number;
  role: "user" | "assistant" | "tool";
  text: string;
  turnId: string | null;
}
export interface AssistantCall {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  proposalRevision: number;
  state: string;
  quote: ToolQuote | null;
  approvalBlockedReason?: string | null;
  childRunId: number | null;
  result: unknown;
}
/** Safe, read-only history of persisted actions; never contains execution payloads. */
export interface AssistantActivity {
  id: string;
  kind: "request_received" | "model_request" | "load_skill" | "read_skill_reference" | "ask_question" | "search_xhs_notes" | "analyze_xhs_research" | "save_draft";
  state: "preparing" | "running" | "waiting" | "completed" | "rejected" | "stopped" | "failed" | "needs_review";
  callId?: string;
  keyword?: string;
}
export interface AssistantTurn {
  turnId: string;
  runId: number;
  phase: AssistantPhase;
  status: string;
  generation: number;
  question: { questionId: string; text: string } | null;
  calls: AssistantCall[];
  /** Optional only for clients receiving a snapshot from an older API during rollout. */
  activities?: AssistantActivity[];
  /** Pending/unknown receipts can reconcile without an assistant event, even after stop. */
  needsSnapshotRefresh?: boolean;
  canResume: boolean;
}
export interface AssistantQueuedMessage {
  id: string; position: number; message: string; state: "pending" | "quoted" | "submitted" | "cancelled";
  quote: ToolQuote | null; error: string | null; turnId: string | null; commandKey: string;
}
export interface AssistantSession {
  queue?: { paused: boolean; entries: AssistantQueuedMessage[] };
  sessionId: string;
  feeAuthorization?: AssistantFeeAuthorization | null;
  assistantId: AssistantId;
  assistantName: string;
  title: string;
  brief: string;
  revision: number;
  archived: boolean;
  inputs: { id: string; text: string; source: Record<string, unknown> }[];
  messages: AssistantMessage[];
  artifacts: AssistantArtifact[];
  turn: AssistantTurn | null;
  eventSeq: number;
}
export interface AssistantEvent {
  seq: number;
  type: string;
  entityId: string;
}
