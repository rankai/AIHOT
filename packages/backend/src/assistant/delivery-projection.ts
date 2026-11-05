import type { AssistantArtifactDelivery } from "@aihot/contracts/assistant";
import { z } from "zod";

export const ArtifactVersionQuery = z.object({
  version: z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger).optional(),
}).strict();

export interface ArtifactDeliveryRow {
  turn_id: string | null; artifact_id: string; version: number;
  kind: AssistantArtifactDelivery["kind"]; title: string;
  version_count?: number; event_count?: number | null; event_seq?: number | null;
}

/** Project persisted ownership, never infer a generation from the latest artifact. */
export function projectArtifactDeliveries(rows: readonly ArtifactDeliveryRow[]): AssistantArtifactDelivery[] {
  return rows.filter((row) => !!row.turn_id).map((row) => ({
    turnId: row.turn_id!, artifactId: row.artifact_id, version: row.version,
    kind: row.kind, title: row.title,
    // Artifact events contain no version. Multiple saved versions (including manual edits)
    // or duplicate/missing events cannot prove which event published this version.
    ...(row.version_count === 1 && row.event_count === 1 && Number.isSafeInteger(row.event_seq) && row.event_seq! > 0
      ? { eventSeq: row.event_seq! } : {}),
  }));
}
