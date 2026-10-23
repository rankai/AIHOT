// X accounts share searches: one request reads a shard of accounts, each post goes to
// the source whose handle wrote it, every account keeps its own fetch run and watermark, and a failed
// search moves no watermark.
import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { scheduleDueSources } from "@aihot/backend/sources/collect";
import { collectBatch, drainNative } from "./native-helpers.ts";
import { migrateNativeSources } from "@aihot/backend/sources/native-migration";
import { controlOperation } from "@aihot/backend/providers/operations/read";
import { planXShards, shardQuery } from "@aihot/backend/sources/x";

const T = tag();
const HANDLES = [`sa${T}`, `sb${T}`, `sc${T}`];
const IDS = HANDLES.map((h) => `test-xs-${h}`);
const BASE = BigInt(Date.now()) * 1000n;
const WATERMARK = BASE + 100n;
// Newer than the watermark: three posts by the first account, one by the second, none by the third.
const POSTS = [
  { id: BASE + 104n, handle: HANDLES[0]! },
  { id: BASE + 103n, handle: HANDLES[1]! },
  { id: BASE + 102n, handle: HANDLES[0]! },
  { id: BASE + 101n, handle: HANDLES[0]! },
];
const tweet = (p: { id: bigint; handle: string }) => ({
  id_str: String(p.id), tweet_created_at: new Date().toISOString(), full_text: `Post ${p.id} ${T}`, lang: "en", user: { name: p.handle, screen_name: p.handle },
});

let failNext = false;
let failPage2 = 0;
const queries: string[] = [];
const socialdata = await stub((_hit, req) => {
  const q = new URL(req.url, "http://stub").searchParams.get("query") ?? "";
  queries.push(q);
  if (failNext) {
    failNext = false;
    return new Reply(500, { error: "down" });
  }
  const handles = new Set([...q.matchAll(/from:(\w+)/g)].map((m) => m[1]!.toLowerCase()));
  const since = BigInt(/since_id:(\d+)/.exec(q)?.[1] ?? "0");
  // Two posts a page; `cursor` is the page number.
  const page = Number(new URL(req.url, "http://stub").searchParams.get("cursor") ?? 0);
  if (page === 1 && failPage2 > 0) {
    failPage2 -= 1;
    return new Reply(500, { error: "slow" });
  }
  const ids = POSTS.filter((p) => handles.has(p.handle.toLowerCase()) && p.id > since);
  return { tweets: ids.slice(page * 2, page * 2 + 2).map(tweet), next_cursor: (page + 1) * 2 < ids.length ? String(page + 1) : null };
});
process.env.SOCIALDATA_BASE_URL = socialdata.url;
process.env.SOCIALDATA_API_KEY = "test-key";
config.allowPrivateNetworkFetch = true;
process.env.COLLECT_ENABLED = "true";

const cursorOf = async (id: string) => (await sql<{ cursor: { lastTweetId: string } }[]>`SELECT progress AS cursor FROM collection_subscriptions WHERE control_source_id = ${id}`)[0]!.cursor;

let savedBudget: Array<{ per_minute: number; per_hour: number; per_day: number }> = [];
before(async () => {
  savedBudget = await sql`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = 'socialdata'`;
  await sql`UPDATE budgets SET per_minute = 1000, per_hour = 10000, per_day = 100000 WHERE service = 'socialdata'`;
  for (const [i, id] of IDS.entries()) {
    await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, cursor, next_fetch_at)
              VALUES (${id}, ${HANDLES[i]!}, 'x_search', ${sql.json({ query: `from:${HANDLES[i]!} -filter:replies`, searchType: "Latest" })}, 'T1', 'editorial',
                      ${sql.json({ initializedAt: new Date().toISOString(), lastTweetId: String(WATERMARK) })}, '2100-01-01')`;
  }
  await migrateNativeSources({ oldWritersStopped: true, sourceIds: IDS });
});
after(async () => {
  const b = savedBudget[0];
  if (b) await sql`UPDATE budgets SET per_minute = ${b.per_minute}, per_hour = ${b.per_hour}, per_day = ${b.per_day} WHERE service = 'socialdata'`;
  await sql`UPDATE sources SET enabled = false WHERE id IN ${sql(IDS)}`;
  await socialdata.close();
  await stopBoss();
  await closeDb();
});

test("shards keep to the query length and account limits, per participation mode", () => {
  const long = Array.from({ length: 60 }, (_, i) => ({
    id: `s${String(i).padStart(2, "0")}`, kind: "x_search" as const, participation_mode: (i % 2 ? "hot_signal" : "editorial") as "hot_signal" | "editorial",
    config: { query: `from:handle_${String(i).padStart(8, "0")} -filter:replies` }, cursor: { lastTweetId: "1" },
  }));
  const own = { id: "s99", kind: "x_search" as const, participation_mode: "editorial" as const, config: { query: "from:elonmusk -filter:replies (Grok OR xAI)" }, cursor: { lastTweetId: "1" } };
  const fresh = { id: "s98", kind: "x_search" as const, participation_mode: "editorial" as const, config: { query: "from:newaccount -filter:replies" }, cursor: null };
  const shards = planXShards([...long, own, fresh]);
  assert.deepEqual(shards.flatMap((s) => s.sourceIds).sort(), long.map((s) => s.id).sort(), "a query of its own and a first fetch stay out");
  for (const s of shards) {
    const handles = s.sourceIds.map((id) => /handle_\d+/.exec(long.find((l) => l.id === id)!.config.query)![0]);
    assert.ok(shardQuery(handles).length <= 470, "room is left for the since_id watermark under 512 characters");
    assert.ok(s.sourceIds.length <= 24);
    assert.ok(s.sourceIds.every((id) => long.find((l) => l.id === id)!.participation_mode === s.mode), "modes are not mixed");
  }
  assert.deepEqual(planXShards([...long].reverse()).map((s) => s.key), shards.map((s) => s.key), "the same sources give the same shards");
});

test("one operation batches accounts without splitting paid pages; each source keeps ownership", async () => {
  const before = queries.length;
  const run = await collectBatch(IDS);
  assert.equal(run.status, "completed");
  assert.equal(queries.length - before, 2);
  const stored = await sql`SELECT source_id, count(*)::int AS n FROM articles WHERE source_id IN ${sql(IDS)} GROUP BY source_id`;
  assert.deepEqual(Object.fromEntries(stored.map((r) => [r.source_id, r.n])), { [IDS[0]!]: 3, [IDS[1]!]: 1 });
  for (const id of IDS) assert.equal((await cursorOf(id)).lastTweetId, String(BASE + 104n));
});

test("a rejected later page retains the same run and frozen request until safe resume", async () => {
  await sql`UPDATE collection_subscriptions SET progress = (progress - 'lastOkAt') || ${sql.json({ lastTweetId: String(WATERMARK - 1n) })} WHERE control_source_id IN ${sql(IDS)}`;
  failPage2 = 1;
  const run = await collectBatch(IDS);
  assert.equal(run.status, "waiting");
  for (const id of IDS) assert.equal((await cursorOf(id)).lastTweetId, String(WATERMARK - 1n), "formal watermark waits for the run");
  await controlOperation(run.id, "resume", { stepVersion: run.step_version, generation: run.generation, reason: "local stub recovered" }, "test");
  assert.equal((await drainNative(run.id)).status, "completed");
  for (const id of IDS) assert.equal((await cursorOf(id)).lastTweetId, String(BASE + 104n));
});

test("quiet accounts use the successful check watermark to bound batch queries", async () => {
  const checked = Date.now() - 45 * 60_000;
  await sql`UPDATE collection_subscriptions SET progress = progress || ${sql.json({ lastTweetId: String(WATERMARK - 3n), lastOkAt: new Date(checked).toISOString() })} WHERE control_source_id IN ${sql(IDS)}`;
  await sql`UPDATE collection_subscriptions SET progress = progress || '{"lastTweetId":"1000"}' WHERE control_source_id = ${IDS[2]!}`;
  const before = queries.length;
  await collectBatch(IDS);
  const since = BigInt(/since_id:(\d+)/.exec(queries[before]!)![1]!);
  const expected = BigInt(checked - 10 * 60_000 - 1288834974657) << 22n;
  assert.equal(since, expected > WATERMARK - 3n ? expected : WATERMARK - 3n);
});

test("due accounts enqueue a shared operation and retain formal occupancy", async () => {
  await sql`UPDATE collection_subscriptions SET next_run_at = now() - interval '1 minute' WHERE control_source_id = ${IDS[1]!}`;
  await scheduleDueSources(1000);
  const rows = await sql`SELECT active_run_id FROM collection_subscriptions WHERE control_source_id IN ${sql(IDS)}`;
  assert.ok(rows.every((r) => r.active_run_id !== null));
  assert.equal(new Set(rows.map((r) => r.active_run_id)).size, 1);
  const [job] = await sql`SELECT name FROM pgboss.job WHERE data->>'runId' = ${String(rows[0]!.active_run_id)} ORDER BY created_on DESC LIMIT 1`;
  assert.equal(job!.name, "operations.execute");
});
