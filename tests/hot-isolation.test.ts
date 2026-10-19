import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { sql, closeDb } from "@aihot/backend/db";
import { updateSource } from "@aihot/backend/admin/sources";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { computeHotRanking } from "@aihot/backend/events/hot";
import { latestHotRanking, rankingExtras } from "@aihot/backend/events/hot-read";
import { proxiedImage } from "@aihot/backend/media/imgproxy";
import { registerPublicationJobs, republishKey } from "@aihot/backend/jobs/publication";
import { ensureQueue, getBoss, QUEUES, QUEUE_OPTIONS, stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const republishOptions = QUEUE_OPTIONS[QUEUES.republishSource]!;
Object.assign(QUEUES, { republishSource: `test.isolation-${T}` });
const rankingIds: number[] = [];
before(async () => {
  await ensureQueue(QUEUES.republishSource, republishOptions);
  await registerPublicationJobs(await getBoss());
});
after(async () => {
  await stopBoss();
  if (rankingIds.length) await sql`DELETE FROM hot_rankings WHERE id=ANY(${rankingIds}::bigint[])`;
  await closeDb();
});

async function fixture(modes: Array<"editorial" | "hot_signal">) {
  const prefix = `isolation-${tag()}`;
  const [story] = await sql`INSERT INTO stories(public_id,title,first_report_at,latest_at) VALUES (${randomUUID()},${prefix},now(),now()) RETURNING id`;
  const storyId = Number(story!.id);
  const [fact] = await sql`INSERT INTO facts(public_id,story_id,title) VALUES (${randomUUID()},${storyId},${prefix}) RETURNING id`;
  const sources: Array<{ id: string; name: string; icon: string; articleId: string }> = [];
  for (const [i, mode] of modes.entries()) {
    const id = `${prefix}-${i}`;
    const name = `${prefix} source ${i}`;
    const icon = `https://example.org/${id}.png`;
    await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,icon_url,next_fetch_at)
      VALUES (${id},${name},'rss','T1',${mode},${icon},'2100-01-01')`;
    const { articleId } = await upsertMaterial({ sourceId: id, url: `https://example.org/${id}`, title: name, bodyText: name.repeat(30), bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
    await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected)
      VALUES (${articleId},1,'rule','pass','ai-models',${name},${name},40,false)`;
    await publishArticle(articleId);
    await sql`INSERT INTO fact_articles(fact_id,article_id,role) VALUES (${fact!.id},${articleId},'report')`;
    await sql`INSERT INTO story_signals(story_id,article_id,participant_key,source_id,kind,observed_at)
      VALUES (${storyId},${articleId},${id},${id},${mode === "editorial" ? "editorial" : "signal"},${new Date(Date.now() - 60_000)})`;
    sources.push({ id, name, icon, articleId });
  }
  return { storyId, sources };
}
async function patch(id: string, change: Record<string, unknown>) {
  const [source] = await sql`SELECT updated_at FROM sources WHERE id=${id}`;
  return updateSource(id, { patch: change, version: (source!.updated_at as Date).toISOString(), reason: "Isolation test" }, "test");
}
async function ranking() {
  const r = await latestHotRanking();
  assert.ok(r); rankingIds.push(r.id);
  return r;
}
async function isolate(id: string) {
  await patch(id, { participation_mode: "isolated" });
  const deadline = Date.now() + 20_000;
  while ((await sql`SELECT value FROM settings WHERE key=${republishKey(id)}`)[0]?.value.status !== "done") {
    assert.ok(Date.now() < deadline, "republish-source worker did not finish");
    await delay(50);
  }
  const [progress] = await sql`SELECT value FROM settings WHERE key=${republishKey(id)}`;
  assert.equal(progress!.value.reduced, 1, "real callback withdraws the source and reranks");
  return ranking();
}

test("three sources become two: paused editorial and hot_signal remain, isolated name/avatar/count disappear", async () => {
  const { storyId, sources } = await fixture(["editorial", "editorial", "hot_signal"]);
  const [isolated, paused, signal] = sources;
  await patch(paused!.id, { enabled: false });
  await computeHotRanking();
  const initial = await ranking();
  const before = initial.entries.find(e => e.storyId === storyId)!;
  assert.ok(before);
  assert.deepEqual([before.participantCount, before.sourceCount, before.signalCount], [3, 2, 1]);
  assert.deepEqual(new Set(before.sourceNames), new Set([isolated!.name, paused!.name]));
  assert.equal((await rankingExtras(initial)).participants(before).find(p => p.name === isolated!.name)!.iconUrl, proxiedImage(isolated!.icon, "avatar"));

  const next = await isolate(isolated!.id);
  assert.notEqual(next.id, initial.id);
  const entry = next.entries.find(e => e.storyId === storyId)!;
  assert.ok(entry, "two valid participants keep the event on the board");
  assert.deepEqual([entry.participantCount, entry.sourceCount, entry.signalCount, entry.reportCount], [2, 1, 1, 1]);
  assert.ok(entry.heat < before.heat);
  assert.deepEqual(entry.sourceNames, [paused!.name]);
  assert.deepEqual(entry.participants.map(p => [p.name, p.kind]), [[paused!.name, "editorial"], [signal!.name, "signal"]]);
  const people = (await rankingExtras(next)).participants(entry);
  assert.deepEqual(people.map(p => p.iconUrl), [proxiedImage(paused!.icon, "avatar"), proxiedImage(signal!.icon, "avatar")]);
  assert.ok(!JSON.stringify(entry).includes(isolated!.name));
  assert.ok(!people.some(p => p.name === isolated!.name));
  assert.equal((await sql`SELECT visibility FROM publications WHERE article_id=${isolated!.articleId}`)[0]!.visibility, "withdrawn");
  assert.equal((await sql`SELECT count(*)::int AS n FROM story_signals WHERE story_id=${storyId}`)[0]!.n, 3, "stored evidence stays intact");
});

test("two sources become one and fall below the existing minimum", async () => {
  const { storyId, sources } = await fixture(["editorial", "editorial"]);
  await computeHotRanking();
  const before = (await ranking()).entries.find(e => e.storyId === storyId)!;
  assert.ok(before); assert.equal(before.participantCount, 2);
  const next = await isolate(sources[0]!.id);
  assert.ok(!next.entries.some(e => e.storyId === storyId));
  assert.equal((await sql`SELECT visibility FROM publications WHERE article_id=${sources[1]!.articleId}`)[0]!.visibility, "public");
  assert.equal((await sql`SELECT count(*)::int AS n FROM story_signals WHERE story_id=${storyId}`)[0]!.n, 2);
});
