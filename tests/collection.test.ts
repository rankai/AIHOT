// Collection picks up where it stopped: an X search longer than one run continues in later runs until
// it meets the old watermark (no post in between is skipped, no page is bought twice), and a WeChat body
// that failed for a passing reason is fetched again on the next check.
import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { collectNative } from "./native-helpers.ts";
import { migrateNativeSources } from "@aihot/backend/sources/native-migration";

const T = tag();
const X_SOURCE = `test-x-${T}`;
const MP_SOURCE = `test-mp-${T}`;

// SocialData: 450 posts newer than the watermark, newest first, 20 a page; `cursor` is the page number.
const BASE = BigInt(Date.now()) * 1000n;
const WATERMARK = BASE + 100n;
const POSTS = Array.from({ length: 450 }, (_, i) => BASE + 550n - BigInt(i));
const tweet = (id: bigint) => ({
  id_str: String(id), tweet_created_at: new Date(Date.now() - Number(BASE + 550n - id) * 60_000).toISOString(),
  full_text: `Post ${id} ${T}`, lang: "en", user: { name: "Test account", screen_name: `acct${T}` },
});
const socialdata = await stub((_hit, req) => {
  const u = new URL(req.url, "http://stub");
  const since = BigInt(/since_id:(\d+)/.exec(u.searchParams.get("query") ?? "")?.[1] ?? "0");
  const page = Number(u.searchParams.get("cursor") ?? 0);
  const ids = POSTS.filter((id) => id > since);
  return { tweets: ids.slice(page * 20, page * 20 + 20).map(tweet), next_cursor: (page + 1) * 20 < ids.length ? String(page + 1) : null };
});

// Dajiala: one new post whose body answers 503 the first time.
const MP_URL = `https://mp.weixin.qq.com/s/test-${T}`;
let bodyCalls = 0;
const dajiala = await stub((_hit, req) => {
  if (req.url.startsWith("/fbmain/monitor/v3/post_history")) {
    return { code: 0, data: [{ position: 1, url: MP_URL, title: `公众号文章 ${T}`, post_time: Math.floor(Date.now() / 1000) - 3600, digest: "摘要", sn: `sn-${T}` }], remain_money: 100 };
  }
  bodyCalls += 1;
  if (bodyCalls === 1) return new Reply(503, { error: "busy" });
  return { code: 0, title: `公众号文章 ${T}`, content: `<p>正文第一段 ${T}</p><p>正文第二段</p>`, author: "作者", desc: "描述" };
});

process.env.SOCIALDATA_BASE_URL = socialdata.url;
process.env.SOCIALDATA_API_KEY = "test-key";
process.env.DAJIALA_BASE_URL = dajiala.url;
process.env.DAJIALA_KEY = "test-key";
config.allowPrivateNetworkFetch = true;
process.env.COLLECT_ENABLED = "true";

let savedBudgets: Array<{ service: string; per_minute: number; per_hour: number; per_day: number }> = [];
before(async () => {
  savedBudgets = await sql`SELECT service, per_minute, per_hour, per_day FROM budgets WHERE service IN ('socialdata', 'dajiala')`;
  await sql`UPDATE budgets SET per_minute = 1000, per_hour = 10000, per_day = 100000 WHERE service IN ('socialdata', 'dajiala')`;
  await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, cursor, next_fetch_at)
            VALUES (${X_SOURCE}, 'Test X', 'x_search', ${sql.json({ query: `from:acct${T}` })}, 'T1', 'editorial',
                    ${sql.json({ initializedAt: new Date().toISOString(), lastTweetId: String(WATERMARK) })}, '2100-01-01'),
                   (${MP_SOURCE}, 'Test mp', 'mp_account', ${sql.json({ ghid: `gh_${T}` })}, 'T1', 'editorial',
                    ${sql.json({ lastCheckedAt: new Date().toISOString() })}, '2100-01-01')`;
  await migrateNativeSources({ oldWritersStopped: true, sourceIds: [X_SOURCE, MP_SOURCE] });
});
after(async () => {
  for (const b of savedBudgets) await sql`UPDATE budgets SET per_minute = ${b.per_minute}, per_hour = ${b.per_hour}, per_day = ${b.per_day} WHERE service = ${b.service}`;
  await socialdata.close();
  await dajiala.close();
  await stopBoss();
  await closeDb();
});

test("an X search longer than one run is read to the old watermark over the next runs", async () => {
  const stored = async () => Number((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${X_SOURCE}`)[0]!.n);
  const cursor = async () => (await sql<{ cursor: { lastTweetId: string; xBacklog?: unknown[] } }[]>`SELECT progress AS cursor FROM collection_subscriptions WHERE control_source_id = ${X_SOURCE}`)[0]!.cursor;

  const first = await collectNative(X_SOURCE);
  assert.equal(first.status, "completed");
  assert.equal(await stored(), 400, "a run reads its own pages and ten more of the stretch left over");
  assert.equal((await cursor()).lastTweetId, String(BASE + 550n), "the watermark moves to the newest post");
  assert.equal((await cursor()).xBacklog?.length, 1, "the unread stretch is kept for the next run");
  assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results WHERE run_id = ${first.id} AND kind = 'page'`)[0]!.n, 20);


  const second = await collectNative(X_SOURCE);
  assert.equal(second.status, "completed");
  assert.equal(await stored(), 450, "every post between the old watermark and the newest is stored");
  assert.equal((await cursor()).xBacklog?.length, 0, "nothing is left to read");
  assert.equal(socialdata.hits(), 20 + 1 + 3, "no page is requested twice");
});

test("a WeChat body that failed for a passing reason is fetched on the next check and analysed again", async () => {
  const article = async () =>
    (await sql<{ body_status: string; revision: number; retry: { attempts: number } | null }[]>`
      SELECT body_status, revision, raw->'dajiala'->'bodyRetry' AS retry FROM articles WHERE source_id = ${MP_SOURCE}`)[0]!;

  const first = await collectNative(MP_SOURCE);
  assert.equal(first.status, "completed");
  assert.deepEqual({ ...(await article()) }, { body_status: "none", revision: 1, retry: { attempts: 1, error: "dajiala HTTP 503" } });

  const second = await collectNative(MP_SOURCE);
  assert.equal(second.status, "completed");
  assert.equal(bodyCalls, 2, "the body is asked for once more");
  const now = await article();
  assert.deepEqual([now.body_status, now.revision, now.retry], ["ok", 2, null], "the body arrives as a new revision and retrying stops");
  const [queued] = await sql<{ processing_state: string }[]>`SELECT processing_state FROM articles WHERE source_id = ${MP_SOURCE}`;
  assert.equal(queued!.processing_state, "new", "the article goes back to analysis");

  await collectNative(MP_SOURCE);
  assert.equal(bodyCalls, 2, "a body already stored is not bought again");
});
