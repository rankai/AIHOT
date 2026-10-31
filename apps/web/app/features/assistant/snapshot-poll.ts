import type { AssistantTurn } from "@aihot/contracts/assistant";

/** Event-free receipt changes and failed reads must reconcile through the owned snapshot. */
export function shouldReadSnapshot(
  turn: Pick<AssistantTurn, "status" | "phase" | "needsSnapshotRefresh"> | null,
  hasEvents: boolean,
  readFailed: boolean,
): boolean {
  return hasEvents || readFailed || !!turn?.needsSnapshotRefresh ||
    (!!turn && ["active", "waiting"].includes(turn.status) &&
      ["executing", "waiting_child"].includes(turn.phase));
}
