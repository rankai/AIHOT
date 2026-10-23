import { randomUUID } from "node:crypto";
import { sql } from "@aihot/backend/db";
import { createNativeCollection, createNativeBatch } from "@aihot/backend/sources/native-commands";
import { executeNativeStep } from "@aihot/backend/sources/native-execution";

export async function drainNative(runId: number) {
  for (let i = 0; i < 30; i++) {
    const [run] = await sql`SELECT * FROM operation_runs WHERE id = ${runId}`;
    if (run!.status !== "active") return run!;
    await executeNativeStep(runId, run!.step_version, randomUUID());
  }
  throw new Error("Native run did not settle within its bounded steps");
}
export async function collectNative(sourceId: string) {
  return drainNative((await createNativeCollection(sourceId, { actor: "test", key: randomUUID(), reason: "manual", force: true })).id);
}
export async function collectBatch(sourceIds: string[]) {
  return drainNative((await createNativeBatch(sourceIds, { actor: "test", key: randomUUID(), shardKey: "synthetic" })).id);
}
