import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "@aihot/backend/db";
import { sessionSnapshot } from "@aihot/backend/assistant/sessions";
import { recoverAssistantChildren } from "@aihot/backend/assistant/execution";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";

/** Drive already-authorized worker steps; deliberately never approve a child or answer a question. */
export async function finishResearchTask(userId: number, sessionId: string, rootId: number, until: "completed" | "needs_review" = "completed") {
  for (let i = 0; i < 28; i++) {
    const view = await sessionSnapshot(userId, sessionId), turn = view.turn!;
    if (turn.status === until) return view;
    assert(!["failed", "needs_review", "stopped"].includes(turn.status), JSON.stringify({status:turn.status,phase:turn.phase,calls:turn.calls.map(c=>c.state)}));
    assert(!["waiting_question", "waiting_approval"].includes(turn.phase));
    const child = turn.calls.find(c => c.state === "running")?.childRunId;
    const [r] = await sql`SELECT status,step_version FROM operation_runs WHERE id=${child ?? rootId}`;
    if (child && !["active","waiting"].includes(r!.status)) {
      await recoverAssistantChildren(child);
      const [root] = await sql`SELECT step_version FROM operation_runs WHERE id=${rootId}`;
      await executeOperationStep(rootId,root!.step_version,randomUUID());
    } else {
      await executeOperationStep(child ?? rootId,r!.step_version,randomUUID());
      if (child) { await recoverAssistantChildren(child); await recoverAssistantChildren(child); }
    }
  }
  throw new Error("Research task did not finish within the fixture step limit");
}
