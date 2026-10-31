import type { AssistantActivity } from "@aihot/contracts/assistant";
import type { Tx } from "../db.ts";

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
  "save_draft",
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
    CASE WHEN c.name='search_xhs_notes' AND jsonb_typeof(c.input->'keyword')='string'
      THEN left(c.input->>'keyword',120) END AS keyword,
    r.status AS child_status,p.status AS child_receipt_status
    FROM assistant_tool_calls c JOIN assistant_model_steps s ON s.id=c.model_step_id
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
      activities.push({
        id: `call:${call.id}`,
        kind: call.name,
        state,
        callId: call.id,
        ...(call.name === "search_xhs_notes" && typeof call.keyword === "string" ? { keyword: call.keyword } : {}),
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
