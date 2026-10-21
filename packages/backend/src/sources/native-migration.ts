// Run only after the old API/worker writers are stopped. Never called by startup or seed.
import { sql, type Tx } from "../db.ts";
import { createSubscription } from "./subscriptions.ts";
import { unsupportedConfig } from "./config-keys.ts";
import { createRun } from "../providers/operations/store.ts";

export async function createNativeSubscription(tx: Tx, sourceId: string): Promise<number> {
  const [source] = await tx`SELECT * FROM sources WHERE id = ${sourceId}`;
  if (!source || !["x_search", "mp_account"].includes(source.kind)) throw new Error("Not a native source");
  const x = source.kind === "x_search";
  // JSON null must remain JSON null, not become SQL NULL in the JSON parameter encoder.
  const id = await createSubscription(tx, { sourceId, provider: x ? "socialdata" : "dajiala", platform: x ? "x" : "wechat",
    operationKey: x ? "x.search" : "mp.history", contractVersion: 1, config: source.config ?? {}, intervalMinutes: source.interval_minutes, enabled: source.enabled });
  await tx`UPDATE collection_subscriptions SET config = ${JSON.stringify(source.config)}::text::jsonb,
    progress = ${tx.json(source.cursor ?? {})}, next_run_at = ${source.next_fetch_at} WHERE id = ${id}`;
  return id;
}

export async function migrateNativeSources(options: { oldWritersStopped: true; sourceIds?: string[] }) {
  if (options.oldWritersStopped !== true) throw new Error("Stop old native API and worker writers before migration");
  if (options.sourceIds && (!options.sourceIds.length || options.sourceIds.some(id => typeof id !== "string" || !id.trim()))) throw new Error("sourceIds must contain non-empty source IDs");
  const sources = await sql`SELECT id, kind FROM sources WHERE kind IN ('x_search','mp_account')
    ${options.sourceIds ? sql`AND id IN ${sql(options.sourceIds)}` : sql``} ORDER BY id`;
  let created = 0, blocked = 0;
  for (const source of sources) {
    const outcome = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`native-migration:${source.id}`}))`;
      const [existing] = await tx`SELECT c.id, o.step_key, o.status FROM collection_subscriptions c
        LEFT JOIN operation_runs o ON o.id = c.active_run_id WHERE c.control_source_id = ${source.id}`;
      if (existing) return existing.step_key === "migration.review" && existing.status === "needs_review" ? "existing-blocked" : "existing";
      const id = await createNativeSubscription(tx, source.id);
      // Old receipts do not retain the complete window/cursor input. Preserve evidence and block;
      // never fabricate a runnable request, even where the subject identifies its source.
      const receipts = await tx`SELECT r.id FROM receipts r WHERE (
        r.status IN ('pending','unknown') OR (r.status = 'received' AND NOT EXISTS (
          SELECT 1 FROM fetch_runs f WHERE f.source_id = ${source.id} AND f.status = 'ok' AND f.finished_at >= coalesce(r.received_at,r.updated_at))))
        AND NOT EXISTS (SELECT 1 FROM operation_runs o WHERE o.actor <> 'native-migration' AND (o.current_receipt_id = r.id OR o.progress->'retainedReceiptIds' @> jsonb_build_array(r.id)))
        AND NOT EXISTS (SELECT 1 FROM operation_results z WHERE z.receipt_id = r.id) AND (
        (service = 'socialdata' AND purpose = 'source_fetch' AND ${source.kind === "x_search"} AND (subject = ${`source:${source.id}`} OR subject LIKE 'x-shard:%' OR subject IS NULL))
        OR (service = 'dajiala' AND purpose IN ('mp_history','mp_article') AND ${source.kind === "mp_account"} AND (subject = ${source.id} OR subject IS NULL))) ORDER BY r.id`;
      const [sub] = await tx`SELECT * FROM collection_subscriptions WHERE id = ${id}`;
      const config = sub!.config;
      const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
      const configured = config !== null && typeof config === "object" && !Array.isArray(config) &&
        unsupportedConfig(source.kind, config).length === 0 && (source.kind === "x_search"
        ? nonempty(config.query) && (config.searchType === undefined || ["Latest", "Top"].includes(config.searchType))
        : nonempty(config.ghid ?? config.wxid));
      if (!receipts.length && configured) return "created";
      const run = await createRun(tx, { actor: "native-migration", commandKey: `source:${source.id}:legacy:${receipts[0]?.id ?? "config"}`, provider: sub!.provider,
        operationKey: sub!.operation_key, contractVersion: 1, subscriptionIds: [id], forceSourceId: source.id,
        stepKey: "migration.review", input: { recoveryUnavailable: true }, limits: { steps: 0, retries: 0 } });
      await tx`UPDATE operation_runs SET status = 'needs_review', wait_reason = ${configured ? 'Legacy input cannot be safely reconstructed; verify or abandon explicitly' : 'Legacy configuration is invalid; verify configuration and abandon this review run explicitly'},
        current_receipt_id = ${receipts[0]?.id ?? null}, progress = ${tx.json({ retainedReceiptIds: receipts.slice(1).map((r) => r.id) })} WHERE id = ${run.id}`;
      return "blocked";
    });
    if (outcome === "created" || outcome === "blocked") created++;
    if (outcome === "blocked" || outcome === "existing-blocked") blocked++;
  }
  // Queued old native jobs must not regain execution after coordinated cutover.
  const [queueSchema] = await sql`SELECT to_regclass('pgboss.job') AS name`;
  if (queueSchema?.name && sources.length) await sql`UPDATE pgboss.job SET state = 'cancelled', completed_on = now()
    WHERE state IN ('created','retry') AND ((name IN ('sources.mp','sources.fetch') AND data->>'sourceId' IN ${sql(sources.map((s) => s.id))}) OR (name = 'sources.fetch-x' AND jsonb_array_length(data->'sourceIds') > 0 AND data->'sourceIds' <@ ${sql.json(sources.map((s) => s.id))}))`;
  if (!options.sourceIds && queueSchema?.name) await sql`UPDATE pgboss.job SET state = 'cancelled', completed_on = now()
    WHERE state IN ('created','retry') AND name IN ('sources.fetch-x','sources.mp')`;
  return { inspected: sources.length, created, blocked };
}
