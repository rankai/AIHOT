import { randomUUID } from "node:crypto";
import { sql } from "../db.ts";
import { createNativeBatch } from "./native-commands.ts";
import { createCollection } from "./collection-commands.ts";
import { planXShards } from "./x.ts";
import { UnsupportedReplacement } from "./x-replacement.ts";
import type { SourceRow } from "./types.ts";

export async function scheduleNativeCollections(kind: "x_search" | "mp_account", now = new Date()) {
  if (process.env.COLLECT_ENABLED === "false") return { enqueued: 0, shards: 0 };
  const blocked: {sourceId:string;reason:string}[] = [];
  let blockedCount = 0;
  const rows = await sql<Array<SourceRow & { due: boolean; provider:string }>>`SELECT s.id, s.kind, s.participation_mode, c.provider,
    c.config, c.progress AS cursor, c.interval_minutes,
    (c.next_run_at IS NULL OR c.next_run_at <= ${now}) AS due
    FROM collection_subscriptions c JOIN sources s ON s.id = c.control_source_id
    WHERE s.kind = ${kind} AND c.provider IN ('socialdata','dajiala','redfox')
      AND (c.provider <> 'redfox' OR ${process.env.REDFOX_CALLS_ENABLED === "true"}) AND s.enabled AND c.enabled AND c.active_run_id IS NULL`;
  const due = new Set(rows.filter((r) => r.due).map((r) => r.id));
  let enqueued = 0, shards = 0;
  const batched = new Set<string>();
  for (const shard of kind === "x_search" ? planXShards(rows.filter(r=>r.provider==="socialdata")) : []) {
    shard.sourceIds.forEach((id) => batched.add(id));
    if (!shard.sourceIds.some((id) => due.has(id))) continue;
    try { await createNativeBatch(shard.sourceIds, { actor: "scheduler", key: randomUUID(), shardKey: shard.key }); shards++; }
    catch (error) { if (!(error instanceof Error && /occupied|disabled/.test(error.message))) throw error; }
  }
  for (const row of rows.filter((r) => due.has(r.id) && !batched.has(r.id))) {
    try { await createCollection(row.id, { actor: "scheduler", key: randomUUID(), reason: "schedule" }); enqueued++; }
    catch (error) {
      if (error instanceof UnsupportedReplacement) {
        blockedCount++;
        if (blocked.length < 50) blocked.push({sourceId:row.id,reason:error.message.slice(0,500)});
        continue;
      }
      if (!(error instanceof Error && /occupied|disabled/.test(error.message))) throw error;
    }
  }
  return { enqueued, shards, blocked, blockedCount };
}
