import type {
  AssistantActivity,
  AssistantArtifactContent,
  AssistantId,
  AssistantMessage,
  AssistantSession,
} from "@aihot/contracts/assistant";
import type { ThreadMessageLike } from "@assistant-ui/react";

export interface SessionRow {
  sessionId: string;
  assistantId: AssistantId;
  assistantName: string;
  title: string;
  createdAt: string;
}
export interface SessionPage {
  sessions: SessionRow[];
}
export interface TurnInput {
  message: string;
  expectedRevision: number;
  skillSelection: { actionId: string } | null;
  inputIds: string[];
  artifactVersions: { artifactId: string; version: number }[];
  autoAuthorizationId?: string;
}
export interface PendingTurn {
  commandKey: string;
  /** Once a response is lost, later rejection cannot disprove the original commit. */
  hasUnknownResult?: boolean;
  input: TurnInput;
  quoteId: string;
  attachments?: import("./materials-data").DraftAttachment[];
}
export const assistantHref = (id: AssistantId) =>
  id === "creative" ? "/assistant" : "/assistant/xiaohongshu";
export const sessionHref = (id: string) =>
  `/assistant/sessions/${encodeURIComponent(id)}`;
export const sessionApi = (id: string) =>
  `/api/assistant/sessions/${encodeURIComponent(id)}`;
export const PHASE_LABELS: Record<string, string> = {
  executing: "正在处理你的创作需求",
  waiting_question: "等待你的回答",
  waiting_approval: "等待检索批准",
  waiting_child: "正在获取参考资料",
  completed: "已处理完成",
  stopped: "已停止",
  needs_review: "本次结果需要核对",
};
export const SEARCH_STATE_LABELS: Record<string, string> = {
  proposed: "等待批准",
  running: "已批准，检索中",
  completed: "检索结果已保存",
  rejected: "你已拒绝检索",
  failed: "检索失败",
  needs_review: "检索需要核对",
};
export function turnActive(session: AssistantSession): boolean {
  return (
    !!session.turn &&
    ["active", "waiting", "needs_review"].includes(session.turn.status)
  );
}
/** Persisted IDs are the runtime identity; a read never appends an optimistic message. */
export function runtimeMessage(message: AssistantMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    content: message.text,
    ...(message.role !== "user"
      ? { status: { type: "complete" as const, reason: "stop" as const } }
      : {}),
  };
}
export function safeSourceHref(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function artifactText(content: AssistantArtifactContent): string {
  return [
    content.title,
    content.body,
    content.titles.length ? `备选标题\n${content.titles.join("\n")}` : "",
    content.tags.length
      ? content.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
/** Handoff inputs are server-owned text snapshots; known drafts get a readable projection. */
export function materialText(text: string): string {
  try {
    const value = JSON.parse(text);
    if (typeof value?.title === "string" && typeof value?.body === "string") {
      return [
        value.title,
        value.body,
        Array.isArray(value.titles) ? value.titles.join("\n") : "",
        Array.isArray(value.tags) ? value.tags.join(" · ") : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  } catch {
    /* User text is already readable. */
  }
  return text;
}

export interface ResearchResult {
  id: string;
  title: string;
  text: string;
  url: string | null;
}
/** Read only the public ToolResult projection, never normalized tool requests. */
export function researchResults(raw: unknown): {
  rows: ResearchResult[];
  limited: boolean;
} {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("results" in raw) ||
    !Array.isArray(raw.results)
  )
    return { rows: [], limited: false };
  const rows: ResearchResult[] = [];
  for (const value of raw.results.slice(0, 50)) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.title !== "string" ||
      typeof value.text !== "string"
    )
      continue;
    rows.push({
      id: String(value.id ?? rows.length),
      title: value.title,
      text: value.text,
      url: typeof value.url === "string" ? safeSourceHref(value.url) : null,
    });
  }
  return { rows, limited: "limited" in raw && raw.limited === true };
}

/** Match complete route segments; /agent and /assistant-other retain their existing shells. */
export const isAssistantPath = (pathname: string) =>
  /^\/assistant(?:\/|$)/.test(pathname);

/** A quote and its command receive the same immutable selection of saved versions. */
export function makeTurnInput(
  message: string,
  expectedRevision: number,
  actionId: string | null,
  references: ReadonlyArray<{ artifactId: string; version: number }> = [],
  inputIds: readonly string[] = [],
  autoAuthorizationId?: string,
): TurnInput {
  return {
    message: message.trim(),
    expectedRevision,
    skillSelection: actionId ? { actionId } : null,
    inputIds: [...inputIds],
    artifactVersions: references.map(({ artifactId, version }) => ({ artifactId, version })),
    ...(autoAuthorizationId ? { autoAuthorizationId } : {}),
  };
}

/** Labels describe only persisted action evidence, never inferred thinking or vendor details. */
export function activityLabel(activity: AssistantActivity, activities?: readonly AssistantActivity[]): string {
  const { kind, state } = activity;
  if (kind === "request_received") return "已收到请求";
  if (kind === "model_request" && state === "completed" && activities) {
    const index = activities.findIndex((item) => item.id === activity.id);
    if (index >= 0) {
      const tools = new Set<Exclude<AssistantActivity["kind"], "request_received" | "model_request">>();
      for (const next of activities.slice(index + 1)) {
        if (next.kind === "model_request") break;
        if (next.kind !== "request_received") tools.add(next.kind);
      }
      if (tools.size > 1) return "已返回下一步处理安排";
      const [tool] = tools;
      if (tool) return {
        load_skill: "已选择创作技能",
        save_draft: "稿件内容已返回",
        ask_question: "已提出需要补充的问题",
        search_xhs_notes: "已提出笔记检索需求",
        analyze_xhs_research: "爆款规律分析已返回",
        read_skill_reference: "已选择创作参考",
      }[tool];
    }
  }
  const action = {
    model_request: "调用创作接口", load_skill: "加载创作技能",
    read_skill_reference: "读取创作参考", ask_question: "补充信息",
    search_xhs_notes: `查询${activity.keyword ? `“${activity.keyword}”` : "参考笔记"}`,
    analyze_xhs_research: "整理爆款规律",
    save_draft: "保存稿件",
  }[kind];
  if (state === "completed") return {
    model_request: "创作接口已返回", load_skill: "已加载创作技能",
    read_skill_reference: "已读取创作参考", ask_question: "已提出补充问题",
    search_xhs_notes: `${action} · 查询结果已返回`, save_draft: "稿件已保存",
    analyze_xhs_research: "已保存爆款规律分析",
  }[kind];
  if (state === "running") return `正在${action}`;
  if (state === "preparing") return `准备${action}`;
  if (state === "waiting") return kind === "ask_question" ? "等待补充信息" : `等待处理 · ${action}`;
  return `${action} · ${{ rejected: "已拒绝", stopped: "已停止", failed: "失败", needs_review: "需要核对" }[state]}`;
}
export function activityIcon(state: AssistantActivity["state"]): "done" | "active" | "waiting" | "attention" | "stopped" {
  if (state === "completed") return "done";
  if (state === "running") return "active";
  if (state === "failed" || state === "needs_review") return "attention";
  if (state === "stopped" || state === "rejected") return "stopped";
  return "waiting";
}
