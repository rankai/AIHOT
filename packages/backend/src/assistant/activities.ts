import type { AssistantActivity } from "@aihot/contracts/assistant";
import type { Tx } from "../db.ts";
import { resolveCandidate } from "./catalog.ts";

type State = AssistantActivity["state"];
interface Turn {
  id: string;
  status: string;
  phase: string;
  step_key: string;
  step_version: number;
  pending_question: { questionId: string } | null;
}
const publicTools = new Set<AssistantActivity["kind"]>([
  "load_skill",
  "read_skill_reference",
  "ask_question",
  "search_xhs_notes",
  "analyze_xhs_covers",
  "search_xhs_covers",
  "search_wechat_articles",
  "generate_image",
  "analyze_wechat_research",
  "analyze_xhs_research",
  "save_draft",
  "save_xhs_cover_plan",
]);
function interrupted(status: string): State | null {
  if (status === "stopped" || status === "failed" || status === "needs_review") return status;
  return status === "completed" ? "needs_review" : null;
}
/** Called only after ownedSession, inside the snapshot's read-only repeatable-read transaction. */
export async function readActivities(tx: Tx, turn: Turn): Promise<{ activities: AssistantActivity[]; needsSnapshotRefresh: boolean }> {
  const steps = await tx`SELECT s.id,s.model_ordinal,s.operation_step_version,
    s.decision IS NOT NULL AS processed,p.status AS receipt_status
    FROM assistant_model_steps s LEFT JOIN receipts p ON p.id=s.receipt_id
    WHERE s.turn_id=${turn.id} ORDER BY s.model_ordinal`;
  const calls = await tx`SELECT c.id,c.model_step_id,c.name,c.state,
    CASE WHEN c.name IN ('analyze_xhs_covers','search_xhs_covers','search_xhs_notes','search_wechat_articles') AND jsonb_typeof(c.input->'keyword')='string'
      THEN left(c.input->>'keyword',120) END AS keyword,
    a.candidate AS candidate, r.status AS child_status,p.error AS child_error,p.status AS child_receipt_status
    FROM assistant_tool_calls c JOIN assistant_model_steps s ON s.id=c.model_step_id
    LEFT JOIN assistant_activations a ON c.name='save_draft' AND a.id::text=lower(c.input->>'activationId')
    LEFT JOIN operation_runs r ON r.id=c.child_run_id
    LEFT JOIN receipts p ON p.id=r.current_receipt_id
    WHERE c.turn_id=${turn.id} ORDER BY s.model_ordinal,c.ordinal`;
  const activities: AssistantActivity[] = [
    { id: `request:${turn.id}`, kind: "request_received", state: "completed" },
  ];
  for (const step of steps) {
    let state: State;
    if (step.processed || ["received", "completed"].includes(step.receipt_status)) state = "completed";
    else if (step.receipt_status === "unknown") state = "needs_review";
    else if (step.receipt_status === "failed") state = "failed";
    else if (interrupted(turn.status)) state = interrupted(turn.status)!;
    else if (turn.status === "waiting") state = "waiting";
    else if (step.receipt_status === "pending" && turn.status === "active" &&
      turn.step_key === "assistant.model" && turn.step_version === step.operation_step_version) state = "running";
    else state = "preparing";
    activities.push({ id: `model:${step.id}`, kind: "model_request", state });
    for (const call of calls.filter((call) => call.model_step_id === step.id)) {
      if (!publicTools.has(call.name)) continue;
      if (call.state === "completed") {
        state = call.name === "ask_question" && turn.phase === "waiting_question" &&
          turn.status === "waiting" && turn.pending_question?.questionId === call.id ? "waiting" : "completed";
      } else if (call.state === "failed") state = "failed";
      else if (call.state === "rejected") state = "rejected";
      else if (call.child_receipt_status === "unknown") state = "needs_review";
      else if (call.child_receipt_status === "failed") state = "failed";
      else if (interrupted(call.child_status) && call.child_status !== "completed") state = interrupted(call.child_status)!;
      else if (interrupted(turn.status)) state = interrupted(turn.status)!;
      else if (call.state === "proposed") state = "waiting";
      else if (call.state === "running" && call.child_status === "completed") state = "waiting";
      else if (call.state === "running" && call.child_status === "active")
        state = call.child_receipt_status === "pending" ? "running" :
          ["received", "completed"].includes(call.child_receipt_status) ? "waiting" : "preparing";
      else if (call.state === "running" && call.child_status === "waiting") state = "waiting";
      else if (call.state === "pending") state = "preparing";
      else state = "needs_review";
      const delivery = call.name === "save_draft" && call.candidate
        ? (await resolveCandidate([call.candidate], call.candidate.skillId, call.candidate.moduleId)).module : null;
      activities.push({
        id: `call:${call.id}`,
        kind: call.name,
        state,
        callId: call.id,
        ...(call.name === "search_wechat_articles" && call.child_error?.includes("Redfox insufficient balance") ? { failureMessage:"数据查询暂不可用，请稍后重新发起" } : {}),
        ...(call.name === "save_draft" && delivery?.deliveryContract === "wechat-research-writing@1" && delivery.outputKinds.includes("text-draft") ? { artifactLabel:"公众号稿件" } : {}),
        ...(["search_xhs_covers", "search_xhs_notes", "search_wechat_articles"].includes(call.name) && typeof call.keyword === "string" ? { keyword: call.keyword } : {}),
      });
    }
  }
  // Receipt reconciliation can finish after stop without emitting an assistant event.
  // Unknown receipts remain observable until an administrator resolves them.
  const unresolved = (status: string) => ["pending", "unknown"].includes(status);
  return {
    activities,
    needsSnapshotRefresh: steps.some((step) => unresolved(step.receipt_status)) ||
      calls.some((call) => unresolved(call.child_receipt_status)),
  };
}
