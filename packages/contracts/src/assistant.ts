import type { ToolQuote } from "./credits.ts";
export type AssistantId = "creative" | "xiaohongshu";
export type AssistantAdditionalFeeKind = "search" | "image" | "vision";
export interface AssistantTurnQuote extends ToolQuote {
  /** Display-only scope of the frozen candidates; optional for persisted older quotes. */
  readonly additionalFeeKinds?: readonly AssistantAdditionalFeeKind[];
}
export type AssistantPhase =
  | "executing"
  | "waiting_question"
  | "waiting_approval"
  | "waiting_child"
  | "completed"
  | "failed"
  | "stopped"
  | "needs_review";
export type AssistantSkillSelection = { skillId: string; actionId?: never } | { actionId: string; skillId?: never };
export interface AssistantTaskChoice { skillId: string; moduleId: string; delivery: "writing" | "plans-only" | "image"; size?: string }
export interface AssistantTaskOption { actionId?: string; choice: AssistantTaskChoice; label: string; sizes: string[] }
export interface AssistantTaskHint {
  actionId: string;
}
export interface AssistantAction {
  actionId: string;
  skillId: string;
  skillName: string;
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
  taskOptions?: AssistantTaskOption[];
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
export interface AssistantCoverScheme {
  schemeId:string; name:string; layout:string; palette:string; prompt:string; aspectRatio:"3:4"; sourceIds:string[];
}
export interface AssistantCoverPlan {
  summary:string; schemes:AssistantCoverScheme[];
  evidence:{queryRunId:number;visionRunId:number;reportId:number;candidateCount:number;selectedCount:number;downloadedCount:number;analyzedCount:number;observedCount:number;keyword:string;startDate:string;scope:string;
    failed:Array<{sourceId:string;status:string;error?:string}>;unreadable:Array<{sourceId:string;uncertainties:string[]}>;
    samples:Array<{sourceId:string;resultId:number;title:string|null;url:string;coverUrl:string;authorName:string|null;userId:string|null;publicTime:string|null;fans:number|null;collectedCount:number|null;useShareCount:number|null;useCommentCount:number|null;useLikeCount:number|null;interactiveCount:number|null;sha256:string;fileKey:string;observation:{sourceId:string;status:"observed"|"unreadable";text:string;subject:string;colors:string;layout:string;uncertainties:string[]}}>};
}
export interface AssistantCoverChoiceContext { artifactId:string;version:number;schemes:Array<{schemeId:string;name:string}>;imageAvailable:boolean;imageUnavailableReason:string|null;feeNotice:string }
export interface AssistantArtifactContent {
  coverPlan?: AssistantCoverPlan;
  planReference?: {artifactId:string;version:number;schemeId:string};
  prompt?: string;
  resultId?: number;
  fileKey?: string;
  width?: number;
  height?: number;
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
  kind: "text-draft" | "xhs-note" | "image" | "xhs-cover-plan";
  schemaVersion: 1;
  content: AssistantArtifactContent;
  sources: AssistantSource[];
}
/** Saved generated versions only; manual edits have no generating turn. */
export interface AssistantArtifactDelivery {
  turnId: string;
  artifactId: string;
  version: number;
  kind: AssistantArtifact["kind"];
  title: string;
  /** Session event order, only when the saved version has an unambiguous artifact event. */
  eventSeq?: number;
}
export interface AssistantMessage {
  id: string;
  seq: number;
  /** Shares the session event order with deliveries; seq remains the message-only order. */
  eventSeq?: number;
  role: "user" | "assistant" | "tool";
  text: string;
  turnId: string | null;
}
/** Safe image parameters used for approval and history display. */
export interface AssistantImageParameters {
  prompt: string;
  size: string;
  resolution: string;
  count: number;
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
  imageParameters?: AssistantImageParameters | null;
  result: unknown;
}
/** Safe, read-only history of persisted actions; never contains execution payloads. */
export interface AssistantActivity {
  id: string;
  kind: "request_received" | "model_request" | "load_skill" | "read_skill_reference" | "ask_question" | "analyze_xhs_covers" | "search_xhs_covers" | "search_xhs_notes" | "analyze_xhs_research" | "search_wechat_articles" | "analyze_wechat_research" | "save_draft" | "save_xhs_cover_plan" | "generate_image";
  state: "preparing" | "running" | "waiting" | "completed" | "rejected" | "stopped" | "failed" | "needs_review";
  callId?: string;
  keyword?: string;
  artifactLabel?: string;
  failureMessage?: string;
}
export interface AssistantTurn {
  credits?: { amount: number; consumed: number; released: number; state: "reserved" | "review" | "settled" | "released" } | null;
  turnId: string;
  runId: number;
  phase: AssistantPhase;
  status: string;
  generation: number;
  question: { questionId: string; text: string; coverPlan?:AssistantCoverChoiceContext } | null;
  calls: AssistantCall[];
  /** Optional only for clients receiving a snapshot from an older API during rollout. */
  activities?: AssistantActivity[];
  /** Pending/unknown receipts can reconcile without an assistant event, even after stop. */
  needsSnapshotRefresh?: boolean;
  canResume: boolean;
}
export interface AssistantQueuedMessage {
  taskSelectionRequired?: boolean; skillSelection?: AssistantSkillSelection | null; taskHint?: AssistantTaskHint | null;
  id: string; position: number; message: string; state: "pending" | "quoted" | "submitted" | "cancelled";
  quote: AssistantTurnQuote | null; error: string | null; turnId: string | null; commandKey: string;
}
export interface AssistantInitialRequest {
  commandKey: string;
  input: { message: string; expectedRevision: number; skillSelection: AssistantSkillSelection | null; taskHint?: AssistantTaskHint | null; taskChoice?: AssistantTaskChoice; inputIds: string[]; artifactVersions: { artifactId: string; version: number }[] };
  quote: AssistantTurnQuote | null;
}
export interface AssistantSession {
  /** Explicit recovery only; never automatically submits or resurrects a dismissed quote. */
  initialRequest?: AssistantInitialRequest | null;
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
  /** Optional for older API snapshots. Contains no tool inputs or artifact bodies. */
  deliveries?: AssistantArtifactDelivery[];
  turn: AssistantTurn | null;
  eventSeq: number;
}
export interface AssistantEvent {
  seq: number;
  type: string;
  entityId: string;
}

export interface AssistantSkillAdminRow {
  skillId: string; name: string; version: string;
  modules: { id: string; name: string }[];
  acceptingNew: boolean; revision: number; policyValid: boolean; available: boolean; reasons: string[];
  updatedBy: string | null; updatedAt: string | null;
  source: Record<string, unknown> | null; packageHash: string | null; dependencies: string[];
  capabilities: string[]; openScope: string[];
}
