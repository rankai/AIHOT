// Commands freeze native request inputs. Existing subscriptions are mandatory; migration is explicit.
import { sql, type Tx } from "../db.ts";
import { stableJson } from "../lib/ids.ts";
import { createRun, StaleOperationError, type RunRow } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import type { SourceRow } from "./types.ts";

export type NativeSourceInput = Pick<SourceRow, "id" | "kind" | "config" | "cursor" | "interval_minutes">;
const freezeSource = (source: NativeSourceInput): NativeSourceInput => ({ id: source.id, kind: source.kind, config: source.config, cursor: source.cursor, interval_minutes: source.interval_minutes });

async function existingCommand(tx: Tx, actor: string, key: string, intent: unknown): Promise<RunRow | null> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${key}`}))`;
  const [run] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor = ${actor} AND command_key = ${key}`;
  if (run && stableJson(run.input.commandIntent) !== stableJson(intent)) throw new StaleOperationError("Command key reused with different input");
  return run ?? null;
}


export async function createNativeCollection(sourceId: string, command: { actor: string; key: string; reason: "schedule" | "manual"; force?: boolean }) {
  return sql.begin(async (tx) => {
    const intent = { sourceId, reason: command.reason, force: command.force ?? false };
    const existing = await existingCommand(tx, command.actor, command.key, intent);
    if (existing) return existing;
    const [sub] = await tx`SELECT * FROM collection_subscriptions WHERE control_source_id = ${sourceId} FOR UPDATE`;
    if (!sub) throw new StaleOperationError("Native source requires explicit subscription migration");
    const [source] = await tx<SourceRow[]>`SELECT * FROM sources WHERE id = ${sourceId} FOR SHARE`;
    if (!source || !["x_search", "mp_account"].includes(source.kind)) throw new Error("Not a native collection source");
    const now = Date.now();
    const x = source.kind === "x_search";
    const run = await createRun(tx, { actor: command.actor, commandKey: command.key, provider: sub.provider,
      operationKey: sub.operation_key, contractVersion: sub.contract_version, subscriptionIds: [sub.id],
      ...(command.force && command.reason === "manual" ? { forceSourceId: sourceId } : {}),
      stepKey: x ? "x.page" : "mp.list", limits: { steps: x ? 24 : 12, retries: 3 },
      input: { commandIntent: intent, mode: "collection", reason: command.reason, sources: [freezeSource({ ...source, config: sub.config, cursor: sub.progress, interval_minutes: sub.interval_minutes })],
        window: x ? new Date(Math.floor(now / 1_800_000) * 1_800_000).toISOString() : `${command.reason === "schedule" ? "s" : "m"}:${Math.floor(now / 600_000)}`,
        startedAt: new Date(now).toISOString(), subject: x ? `source:${sourceId}` : sourceId },
    });
    await queueOperationStep(tx, run.id);
    return run;
  });
}

/** A preview is a durable one-time operation with no formal subscription occupancy. */
export async function createNativePreview(source: SourceRow, actor: string, key: string, saved = false) {
  if (source.kind !== "x_search") throw new Error("Native preview supports X search");
  return sql.begin(async (tx) => {
    const intent = saved ? { sourceId: source.id, kind: "saved-preview" } : { id: source.id, kind: source.kind, config: source.config };
    const existing = await existingCommand(tx, actor, key, intent);
    if (existing) return existing;
    const run = await createRun(tx, { actor, commandKey: key, provider: "socialdata", operationKey: "x.search", contractVersion: 1,
      stepKey: "x.page", input: { commandIntent: intent, mode: "preview", sources: [freezeSource(saved ? source : { ...source, cursor: null })], window: new Date(Math.floor(Date.now() / 1_800_000) * 1_800_000).toISOString(),
        startedAt: new Date().toISOString(), subject: `source:${source.id}` }, limits: { steps: 24, retries: 3 } });
    await queueOperationStep(tx, run.id);
    return run;
  });
}

export async function createNativeBatch(sourceIds: string[], command: { actor: string; key: string; shardKey: string }) {
  return sql.begin(async (tx) => {
    const intent = { sourceIds: [...sourceIds].sort(), shardKey: command.shardKey };
    const existing = await existingCommand(tx, command.actor, command.key, intent);
    if (existing) return existing;
    const subs = await tx`SELECT * FROM collection_subscriptions WHERE control_source_id IN ${tx(sourceIds)} ORDER BY id FOR UPDATE`;
    if (subs.length !== sourceIds.length) throw new StaleOperationError("Native source requires explicit subscription migration");
    const rows = await tx<SourceRow[]>`SELECT * FROM sources WHERE id IN ${tx(sourceIds)} ORDER BY id FOR SHARE`;
    const sources = rows.map((source) => { const sub = subs.find((s) => s.control_source_id === source.id)!; return { ...source, config: sub.config, cursor: sub.progress, interval_minutes: sub.interval_minutes }; });
    const { shardHandle, shardQuery, coveredTo } = await import("./x.ts");
    if (!sources.length || sources.length > 24 || sources.some((s) => !shardHandle(s) || s.participation_mode !== sources[0]!.participation_mode)) throw new Error("Invalid native X batch");
    const query = shardQuery(sources.map((s) => shardHandle(s)!));
    if (query.length > 470) throw new Error("X batch query too long");
    const backlog = [...new Map(sources.flatMap((s) => s.cursor?.xBacklog ?? []).map((b) => [`${b.query} ${b.next}`, b])).values()];
    const lastId = String(sources.map(coveredTo).reduce((a, b) => a < b ? a : b));
    const run = await createRun(tx, { actor: command.actor, commandKey: command.key, provider: "socialdata", operationKey: "x.search", contractVersion: 1,
      subscriptionIds: subs.map((s) => s.id), stepKey: "x.page", input: { commandIntent: intent, mode: "collection", sources: sources.map(freezeSource),
        xPlan: { query, lastId, backlog, batch: true, intervalMinutes: sources[0]!.participation_mode === "hot_signal" ? 60 : 30 }, window: new Date(Math.floor(Date.now() / 1_800_000) * 1_800_000).toISOString(),
        startedAt: new Date().toISOString(), subject: `x-shard:${command.shardKey}` }, limits: { steps: 24, retries: 3 } });
    await queueOperationStep(tx, run.id); return run;
  });
}
