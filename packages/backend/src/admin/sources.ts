import { logicalMpConfig,validateMpSubscriptionConfig } from "../sources/mp-replacement.ts";
import { createRedfoxMpCollection } from "../sources/mp-commands.ts";
import { createCollection } from "../sources/collection-commands.ts";
import { createRedfoxCollection } from "../sources/redfox-commands.ts";
import { logicalXConfig,validateXSubscriptionConfig,UnsupportedReplacement } from "../sources/x-replacement.ts";
// Source administration (F18): list, detail, preview (fetch without storing), edit, create with
// duplicate checks, pause/resume and manual collection. Every change is audited.
import { z } from "zod";
import { sql } from "../db.ts";
import { enqueue, QUEUES } from "../jobs/queue.ts";
import { republishKey } from "../jobs/publication.ts";
import { normalizeUrl } from "../lib/url.ts";
import { fetchJsonList } from "../sources/json-list.ts";
import { fetchRss } from "../sources/rss.ts";
import { assertSupportedConfig } from "../sources/config-keys.ts";
import type { SourceRow } from "../sources/types.ts";
import { fetchWebList } from "../sources/web-list.ts";
import { randomUUID } from "node:crypto";
import { createNativeCollection, createNativePreview } from "../sources/native-commands.ts";
import { createNativeSubscription } from "../sources/native-migration.ts";
import { audit } from "./auth.ts";

function nativeCommandKey(value: string | undefined): string {
  return z.string({ error: "A valid Idempotency-Key is required for native operations" }).regex(/^[A-Za-z0-9._:-]{8,160}$/, "A valid Idempotency-Key is required for native operations").parse(value);
}

export class Conflict extends Error {
  code = "conflict";
}

export interface SourceListFilters {
  q?: string;
  kind?: string;
  health?: string;
  enabled?: "true" | "false";
  mode?: string;
  page?: number;
}

export async function listSources(f: SourceListFilters) {
  const page = Math.max(1, f.page ?? 1);
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const rows = await sql`
    SELECT s.id, s.name, s.kind, s.tier, s.participation_mode, s.enabled, s.health, s.fail_count, coalesce(c.interval_minutes, s.interval_minutes) AS interval_minutes,
           s.last_ok_at, s.last_fetch_at, s.last_error, s.first_party, CASE WHEN c.id IS NOT NULL THEN c.next_run_at ELSE s.next_fetch_at END AS next_fetch_at,
           (SELECT count(*)::int FROM articles a WHERE a.source_id = s.id AND a.discovered_at > now() - interval '7 days') AS items_7d,
           (SELECT count(*)::int FROM publications p WHERE p.source_id = s.id AND p.selected AND p.discovered_at > now() - interval '30 days') AS selected_30d
    FROM sources s LEFT JOIN collection_subscriptions c ON c.control_source_id = s.id
    WHERE (${q}::text IS NULL OR s.name ILIKE ${q} OR s.id ILIKE ${q} OR coalesce(c.config, s.config)::text ILIKE ${q})
      AND (${f.kind ?? null}::text IS NULL OR s.kind = ${f.kind ?? null})
      AND (${f.health ?? null}::text IS NULL OR s.health = ${f.health ?? null})
      AND (${f.mode ?? null}::text IS NULL OR s.participation_mode = ${f.mode ?? null})
      AND (${f.enabled ?? null}::text IS NULL OR s.enabled = (${f.enabled ?? null} = 'true'))
    ORDER BY s.enabled DESC, CASE s.health WHEN 'failing' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END, s.name
    LIMIT 100 OFFSET ${(page - 1) * 100}`;
  const [totals] = await sql<{ total: number; enabled: number; failing: number; degraded: number }[]>`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE enabled)::int AS enabled,
           count(*) FILTER (WHERE health = 'failing')::int AS failing, count(*) FILTER (WHERE health = 'degraded')::int AS degraded
    FROM sources`;
  return { page, rows, totals };
}

export async function sourceDetail(id: string) {
  const [source] = await sql`SELECT s.*, coalesce(c.config, s.config) AS config, coalesce(c.progress, s.cursor) AS cursor,
    coalesce(c.interval_minutes, s.interval_minutes) AS interval_minutes, CASE WHEN c.id IS NOT NULL THEN c.next_run_at ELSE s.next_fetch_at END AS next_fetch_at,
    c.id AS subscription_id, c.active_run_id, c.provider AS collection_provider, c.operation_key AS collection_operation, c.edit_version AS collection_version,
    CASE WHEN s.kind IN ('x_search','mp_account') AND c.id IS NULL THEN 'requires_explicit_migration' ELSE NULL END AS collection_issue FROM sources s LEFT JOIN collection_subscriptions c ON c.control_source_id = s.id WHERE s.id = ${id}`;
  if (!source) return null;
  const runs = await sql`
    SELECT * FROM (
      SELECT id,'fetch'::text AS kind,'fetch:'||id AS history_key,started_at AS occurred_at,
        'fetch_started_at'::text AS time_basis,started_at,finished_at,NULL::timestamptz AS created_at,NULL::timestamptz AS updated_at,
        status,found_count,new_count,NULL::int AS related_material_count,error,detail,NULL::text AS provider,NULL::text AS step,NULL::timestamptz AS next_attempt_at
      FROM fetch_runs WHERE source_id=${id}
      UNION ALL
      SELECT r.id,'operation','operation:'||r.id,r.created_at,'operation_created_at',NULL,NULL,r.created_at,r.updated_at,
        r.status,NULL,NULL,(SELECT count(DISTINCT z.article_id)::int FROM operation_results z WHERE z.run_id=r.id AND z.source_id=${id} AND z.article_id IS NOT NULL),
        r.wait_reason,NULL::jsonb,r.provider,r.step_key,r.next_attempt_at
      FROM operation_runs r WHERE r.input->>'mode'='collection'
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.input->'members') m WHERE m->>'sourceId'=${id})
    ) history ORDER BY occurred_at DESC,kind,id DESC LIMIT 30`;
  const [activeOperation]=source.active_run_id?await sql`SELECT id,status,step_key AS step,wait_reason AS "waitReason",next_attempt_at AS "nextAttemptAt" FROM operation_runs WHERE id=${source.active_run_id}`:[];
  const items = await sql`
    SELECT a.id, a.title, a.url, a.discovered_at, a.published_at, a.processing_state, p.selected, p.visibility, p.title AS title_zh
    FROM articles a LEFT JOIN publications p ON p.article_id = a.id WHERE a.source_id = ${id} ORDER BY a.discovered_at DESC LIMIT 30`;
  const [stats] = await sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE a.discovered_at > now() - interval '7 days')::int AS last7d,
           (SELECT count(*)::int FROM publications p WHERE p.source_id = ${id} AND p.selected) AS selected
    FROM articles a WHERE a.source_id = ${id}`;
  const history = await sql`SELECT created_at, actor, action, reason, before, after FROM audit_log WHERE subject = ${`source:${id}`} ORDER BY created_at DESC LIMIT 20`;
  const [republish] = await sql<{ value: Record<string, unknown> }[]>`SELECT value FROM settings WHERE key = ${republishKey(id)}`;
  return { source, runs, activeOperation:activeOperation??null, items, stats, history, republish: republish?.value ?? null };
}

/** Fetches a source (saved or draft) and returns what it would collect, without storing anything. */
export async function previewSource(draft: Pick<SourceRow, "id" | "kind" | "config"> & Partial<SourceRow>, actor = "admin", commandKey?: string, saved = false) {
  const source = { name: draft.id, enabled: true, cursor: null, tier: "T2", participation_mode: "editorial", ...draft } as SourceRow;
  if(saved && ["x_search","mp_account"].includes(source.kind)) {
    const [sub]=await sql`SELECT provider FROM collection_subscriptions WHERE control_source_id=${source.id}`;
    if(sub?.provider==="redfox"){const run=await (source.kind==="mp_account"?createRedfoxMpCollection:createRedfoxCollection)(source.id,{actor,key:nativeCommandKey(commandKey),reason:"manual",preview:true});return {runId:run.id,status:run.status};}
  }
  assertSupportedConfig(source.kind, source.config);
  const started = Date.now();
  let candidates;
  if (source.kind === "rss") candidates = (await fetchRss(source, { force: true })).candidates;
  else if (source.kind === "web_list") candidates = await fetchWebList(source);
  else if (source.kind === "json_list") candidates = await fetchJsonList(source);
  else if (source.kind === "x_search") { const run = await createNativePreview(source, actor, nativeCommandKey(commandKey), saved); return { runId: run.id, status: run.status }; }
  else throw new Error(`preview is not available for ${source.kind} sources`);
  return {
    ms: Date.now() - started,
    count: candidates.length,
    items: candidates.slice(0, 20).map((c) => ({ title: c.title, url: c.url, publishedAt: c.publishedAt?.toISOString() ?? null, excerpt: (c.excerpt ?? c.bodyText ?? "").slice(0, 200) })),
  };
}

const EDITABLE = z
  .object({
    name: z.string().min(1).max(200),
    enabled: z.boolean(),
    interval_minutes: z.number().int().min(1).max(1440),
    tier: z.enum(["T1", "T1_5", "T2", "EXCLUDE_MP"]),
    participation_mode: z.enum(["editorial", "hot_signal", "isolated"]),
    signal_group_id: z.string().max(120).nullable(),
    first_party: z.boolean(),
    owner_entity_id: z.string().max(120).nullable(),
    site_fulltext: z.boolean(),
    syndicate_fulltext: z.boolean(),
    tags: z.array(z.string().max(60)).max(30),
    config: z.record(z.string(), z.unknown()),
  })
  .partial()
  .strict();

export async function updateSource(id: string, input: { patch: unknown; version: string; reason?: string }, actor: string) {
  const patch = EDITABLE.parse(input.patch);
  return sql.begin(async (tx) => {
    const [subscription] = await tx`SELECT * FROM collection_subscriptions WHERE control_source_id = ${id} FOR UPDATE`;
    const [before] = await tx`SELECT * FROM sources WHERE id = ${id} FOR UPDATE`;
    if (!before) return null;
    if (new Date(before.updated_at as Date).toISOString() !== input.version) throw new Conflict("信源已被其他操作修改，请刷新后再改");
    if(before.kind==="x_search" && subscription?.provider==="redfox" && patch.participation_mode && patch.participation_mode!=="isolated")throw new UnsupportedReplacement("This participation mode requires unsupported X Article extraction; switch collection provider first");
    if (patch.config) {
      assertSupportedConfig(before.kind as SourceRow["kind"],subscription?.provider==="redfox"?(before.kind==="mp_account"?logicalMpConfig(patch.config):logicalXConfig(patch.config)):patch.config);
      if(subscription?.provider==="redfox")patch.config=before.kind==="mp_account"?await validateMpSubscriptionConfig(tx,id,subscription.config,patch.config):await validateXSubscriptionConfig(tx,id,"redfox",patch.config);
    }
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (!keys.length) return before;
    if (["x_search", "mp_account"].includes(before.kind) && !subscription && (patch.config || patch.interval_minutes !== undefined || patch.enabled === true)) throw new Conflict("先显式迁移原生采集订阅");
    const executionChanged = keys.some((k) => ["enabled", "tier", "participation_mode", "first_party", "site_fulltext", "syndicate_fulltext"].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(patch[k]));
    const subscriptionChanged = !!subscription && ((patch.config && JSON.stringify(subscription.config) !== JSON.stringify(patch.config)) || (patch.enabled !== undefined && subscription.enabled !== patch.enabled));
    const requestChanged = !!subscription && !!patch.config && ["query","searchType","ghid","wxid","restId"].some((key) => JSON.stringify(subscription.config?.[key]) !== JSON.stringify(patch.config![key]));
    const exitsMember = requestChanged || (patch.enabled !== undefined && patch.enabled !== before.enabled);
    if (subscription) {
      await tx`UPDATE collection_subscriptions SET config = CASE WHEN ${patch.config !== undefined} THEN ${tx.json((patch.config ?? {}) as never)} ELSE config END,
        interval_minutes = ${patch.interval_minutes ?? subscription.interval_minutes}, enabled = ${patch.enabled ?? subscription.enabled},
        execution_version = execution_version + ${subscriptionChanged ? 1 : 0}, edit_version = edit_version + 1,
        active_run_id = CASE WHEN ${exitsMember} THEN NULL ELSE active_run_id END,
        next_run_at = CASE WHEN ${patch.enabled === true} THEN now() ELSE next_run_at END, updated_at = now() WHERE id = ${subscription.id}`;
    }
    const sourceKeys = subscription ? keys.filter((k) => k !== "config" && k !== "interval_minutes") : keys;
    const values = { ...Object.fromEntries(sourceKeys.map((k) => [k, k === "config" ? tx.json(patch.config as never) : patch[k]])), updated_at: new Date() };
    const [after] = await tx`UPDATE sources SET ${tx(values as never, ...([...sourceKeys, "updated_at"] as string[]))}, execution_version = execution_version + ${executionChanged ? 1 : 0},
      health = CASE WHEN ${patch.enabled ?? null}::boolean IS FALSE THEN 'paused' WHEN ${patch.enabled ?? null}::boolean IS TRUE AND health = 'paused' THEN 'unknown' ELSE health END,
      next_fetch_at = CASE WHEN ${!subscription && patch.enabled === true} THEN now() ELSE next_fetch_at END
      WHERE id = ${id} RETURNING *`;
    await audit(actor, "source.update", `source:${id}`, input.reason ?? null, Object.fromEntries(keys.map((k) => [k, subscription && (k === "config" || k === "interval_minutes") ? subscription[k] : before[k]])), patch);
    // What public exits show for this source's articles is derived from these fields: re-derive them
    // all (in the worker) so a revoked licence or an isolated source stops on every exit.
    if (keys.some((k) => PUBLICATION_FIELDS.includes(k) && JSON.stringify(before[k]) !== JSON.stringify(patch[k]))) {
      await tx`INSERT INTO settings (key, value, updated_by) VALUES (${republishKey(id)}, ${tx.json({ status: "queued", queuedAt: new Date().toISOString() })}, ${actor})
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
      await enqueue(QUEUES.republishSource, { sourceId: id }, { singletonKey: id }, tx);
    }
    return subscription ? { ...after, config: patch.config ?? subscription.config, interval_minutes: patch.interval_minutes ?? subscription.interval_minutes } : after;
  });
}

/** Source fields the public projection reads (publication/rules.ts and the v1 payload). */
const PUBLICATION_FIELDS: string[] = ["participation_mode", "site_fulltext", "syndicate_fulltext", "tier", "name", "first_party"];

const CreateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    name: z.string().min(1).max(200),
    kind: z.enum(["rss", "web_list", "json_list", "x_search", "mp_account", "external"]),
    config: z.record(z.string(), z.unknown()),
    tier: z.enum(["T1", "T1_5", "T2", "EXCLUDE_MP"]).default("T2"),
    participation_mode: z.enum(["editorial", "hot_signal", "isolated"]).default("editorial"),
    interval_minutes: z.number().int().min(1).max(1440).default(30),
    first_party: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    site_fulltext: z.boolean().default(false),
    syndicate_fulltext: z.boolean().default(false),
  })
  .strict();

/** The address a source collects from, used to find duplicates before creating one. */
export function sourceIdentity(kind: string, value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const config = value as Record<string, unknown>;
  const raw = (config.feedUrl ?? config.url ?? config.listUrl ?? config.endpoint ?? null) as string | null;
  if (kind === "x_search") {
    const m = /from:([A-Za-z0-9_]{1,15})/.exec(String(config.query ?? ""));
    return m ? `x:${m[1]!.toLowerCase()}` : null;
  }
  if (!raw) return null;
  try {
    return normalizeUrl(String(raw).replace(/^https:\/\/r\.jina\.ai\//, "")) ?? String(raw);
  } catch {
    return String(raw);
  }
}

export async function findDuplicateSource(kind: string, config: Record<string, unknown>) {
  const identity = sourceIdentity(kind, config);
  if (!identity) return null;
  const rows = await sql<{ id: string; kind: string; config: Record<string, unknown>; name: string }[]>`SELECT s.id, s.kind, coalesce(c.config, s.config) AS config, s.name FROM sources s LEFT JOIN collection_subscriptions c ON c.control_source_id = s.id WHERE s.kind = ${kind}`;
  return rows.find((r) => sourceIdentity(r.kind, r.config) === identity) ?? null;
}

export async function createSource(input: unknown, actor: string) {
  const s = CreateSchema.parse(input);
  assertSupportedConfig(s.kind, s.config);
  const dup = await findDuplicateSource(s.kind, s.config);
  if (dup) return { created: false as const, duplicate: dup };
  const row = await sql.begin(async (tx) => {
  const [row] = await tx`
    INSERT INTO sources (id, name, kind, config, tier, participation_mode, interval_minutes, first_party, tags, site_fulltext, syndicate_fulltext, next_fetch_at)
    VALUES (${s.id}, ${s.name}, ${s.kind}, ${sql.json(s.config as never)}, ${s.tier}, ${s.participation_mode}, ${s.interval_minutes}, ${s.first_party}, ${s.tags},
            ${s.site_fulltext}, ${s.syndicate_fulltext}, now())
    ON CONFLICT (id) DO NOTHING RETURNING *`;
  if (!row) throw new Conflict(`信源 ID ${s.id} 已存在`);
  if (["x_search", "mp_account"].includes(s.kind)) await createNativeSubscription(tx, s.id);
  return row;
  });
  await audit(actor, "source.create", `source:${s.id}`, null, null, s);
  return { created: true as const, source: row };
}

export async function fetchNow(id: string, actor: string, commandKey?: string) {
  const [s] = await sql<{ id: string; kind: string }[]>`SELECT id, kind FROM sources WHERE id = ${id}`;
  if (!s) return null;
  if (["x_search", "mp_account"].includes(s.kind)) {
    const run = await createCollection(id, { actor, key: nativeCommandKey(commandKey), reason: "manual", force: true });
    await audit(actor, "source.fetch", `source:${id}`, null, null, { runId: run.id });
    return { runId: run.id, status: run.status };
  }
  const jobId = await enqueue(QUEUES.fetchSource, { sourceId: id, force: true }, { singletonKey: `manual:${id}` });
  await audit(actor, "source.fetch", `source:${id}`, null, null, { jobId });
  return { jobId };
}
