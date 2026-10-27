import { assertConfiguredTestDatabase, tag } from "./setup.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { LightMyRequestResponse } from "fastify";
import type { PoolResponse } from "@aihot/contracts/site";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadPool, SearchBusyError } from "@aihot/backend/publication/pool";
import { savePresentation, loadPresentationSettings } from "@aihot/backend/admin/presentation";
import { DEFAULT_PRESENTATION } from "@aihot/industry/presentation";
import { siteHandler } from "../apps/api/src/routes/site.ts";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const source = `video-pool-${T}`;
const filter = { channel: "all" as const, category: null, tag: T };
const now = new Date();
let app: Awaited<ReturnType<typeof buildApp>>;
let originalSettings: { value: unknown; updated_at: Date; updated_by: string | null } | undefined;
let sequence = 0;
const ids: string[] = [];
before(async () => {
  const [database] = await sql`SELECT current_database() AS name, inet_server_port() AS port`;
  assertConfiguredTestDatabase(database!.name, database!.port);
  [originalSettings] = await sql`SELECT value, updated_at, updated_by FROM settings WHERE key = 'site_presentation'`;
  await sql`INSERT INTO sources (id,name,kind,participation_mode,site_fulltext,enabled) VALUES (${source},'Video test','rss','editorial',true,false)`;
  app = await buildApp();
  app.get('/test-search-busy', siteHandler(async () => { throw new SearchBusyError(5); }));
});
after(async () => {
  await app?.close();
  await sql`DELETE FROM articles WHERE source_id = ${source}`;
  await sql`DELETE FROM sources WHERE id = ${source}`;
  await sql`DELETE FROM settings WHERE key = 'site_presentation'`;
  if (originalSettings) await sql`INSERT INTO settings(key,value,updated_by,updated_at) VALUES ('site_presentation',${sql.json(originalSettings.value as never)},${originalSettings.updated_by},${originalSettings.updated_at})`;
  await sql`DELETE FROM audit_log WHERE actor = ${source}`;
  await stopBoss();
  await closeDb();
});
async function article(media: unknown[], x = false, category = "ai-models", tags = [T]) {
  sequence++;
  const result = await upsertMaterial({ sourceId: source, url: `https://example.invalid/${T}/${sequence}`, title: `Video match ${sequence}`, bodyText: 'A public video fixture', bodyHtml: '<p>A public video fixture</p>', bodyStatus: 'ok', via: 'fetch', publishedAt: now });
  ids.push(result.articleId);
  await sql`UPDATE articles SET media = ${sql.json(media as never)}, x_post = ${x ? sql.json({ handle: 'video_fixture', text: 'Video match', media: [] }) : null} WHERE id = ${result.articleId}`;
  await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,tags,score,selected) VALUES (${result.articleId},1,'rule','pass',${category},'Video match','中文视频摘要',${tags},80,false)`;
  await publishArticle(result.articleId);
  // Explicit publication channel fixture avoids depending on unrelated source parser behavior.
  if (x) await sql`UPDATE publications SET channel = 'x' WHERE article_id = ${result.articleId}`;
  return result.articleId;
}

test("confirmed news/X video pool and detail share facts, licence rules and unchanged public exports", async () => {
  const news = await article([{ kind: 'video', confirmed: true, url: 'https://cdn.example.invalid/private.mp4', poster: 'https://cdn.example.invalid/poster.jpg' }]);
  const x = await article([{ kind: 'video', confirmed: true }], true);
  await article([{ kind: 'video', url: 'https://cdn.example.invalid/legacy.gif' }]);
  await article([{ kind: 'image', url: 'https://cdn.example.invalid/image.jpg', confirmed: true }, { kind: 'video' }]);
  await article([{ kind: 'video', confirmed: 'true' }]);
  for (const tab of ['time', 'relevance'] as const) {
    const pool = await loadPool({ ...filter, videosOnly: true, q: 'Video', tab, now: new Date() });
    assert.equal(pool.total, 2);
    assert.deepEqual(new Set(pool.items.map(row => row.id)), new Set([news, x]));
    assert.equal(pool.todayCount, 2);
    assert.equal(pool.pageSize, 40);
  }
  const all = await loadPool({ ...filter });
  const videos = await loadPool({ ...filter, videosOnly: true });
  assert.equal(all.total, 5);
  assert.equal(videos.total, 2, 'video count must not reuse all-items cache');
  const item = (await app.inject(`/api/site/items/${news}`)).json();
  assert.ok(item.video.poster.includes('poster.jpg'));
  assert.ok(!JSON.stringify(item).includes('private.mp4'));
  assert.deepEqual((await app.inject(`/api/site/items/${x}`)).json().video, { poster: null });
  await sql`UPDATE publications SET body_mode = 'summary' WHERE article_id = ${news}`;
  assert.deepEqual((await app.inject(`/api/site/items/${news}`)).json().video, { poster: null });
  const v1 = (await app.inject(`/api/v1/items?mode=all&q=Video`)).json();
  assert.ok(!JSON.stringify(v1).includes('poster.jpg'));
  assert.ok(!JSON.stringify(v1).includes('"video":'));
});

test("settings choose initial page sizes while explicit sizes retain stable pagination and invalid parameters fail", async () => {
  await savePresentation({ ...DEFAULT_PRESENTATION, pageSizes: { selected: 1, all: 3, videos: 1 } }, source);
  const pool = (await app.inject(`/api/site/pool?tag=${T}`)).json();
  assert.equal(pool.pageSize, 3); assert.equal(pool.items.length, 3); assert.equal(pool.pageCount, 2);
  const videos = (await app.inject(`/api/site/pool?videosOnly=true&tag=${T}`)).json();
  assert.equal(videos.pageSize, 1); assert.equal(videos.items.length, 1); assert.equal(videos.pageCount, 2);
  const stable = (await app.inject(`/api/site/pool?videosOnly=true&tag=${T}&pageSize=2&page=1`)).json();
  assert.equal(stable.pageSize, 2); assert.equal(stable.items.length, 2);
  for (const value of ['0', '41', '1.5', 'NaN', '1e1', '-1', '']) assert.equal((await app.inject(`/api/site/pool?pageSize=${value}`)).statusCode, 400);
  assert.equal((await app.inject('/api/site/pool?videosOnly=yes')).statusCode, 400);
  await sql`UPDATE publications SET selected = true, visible_after = now() - interval '1 minute' WHERE article_id IN ${sql(ids.slice(0, 2))}`;
  const selected = (await app.inject(`/api/site/timeline?tag=${T}`)).json();
  assert.equal(selected.cards.length, 1);
  assert.equal((await app.inject(`/api/site/timeline?tag=${T}&limit=2`)).json().cards.length, 2);
});

test("all three pool paths cap non-divisible pagination at 2,000 items", async () => {
  const bulkTag = `${T}-bulk`;
  await sql`INSERT INTO articles (id,source_id,identity_key,url,title,discovered_at,timeline_at,media)
    SELECT ${T} || '-bulk-' || n, ${source}, ${T} || '-bulk-' || n, 'https://example.invalid/bulk/' || n,
      'Bulk searchable', now() - n * interval '1 second', now() - n * interval '1 second', '[{"kind":"video","confirmed":true}]'::jsonb
    FROM generate_series(1,2005) n`;
  await sql`INSERT INTO publications (article_id,source_id,title,summary,channel,url,discovered_at,timeline_at,sort_at,eligible,tags,search_text)
    SELECT id,source_id,title,'Bulk searchable','news',url,discovered_at,timeline_at,timeline_at,true,${[bulkTag]},'bulk searchable'
    FROM articles WHERE source_id = ${source} AND id LIKE ${`${T}-bulk-%`}`;
  await sql`INSERT INTO pool_search (article_id,direct,body)
    SELECT article_id,search_text,'' FROM publications WHERE tags @> ${[bulkTag]}::text[]`;
  for (const search of [{}, { q: 'Bulk', tab: 'time' as const }, { q: 'Bulk', tab: 'relevance' as const }, { q: 'Bulk', tab: 'relevance' as const, split: true }]) {
    const query = { ...filter, tag: 'split' in search ? null : bulkTag, videosOnly: true, pageSize: 30, now: new Date(), ...search };
    const first = await loadPool({ ...query, page: 1 });
    const last = await loadPool({ ...query, page: 67 });
    assert.equal(first.items.length, 30);
    assert.equal(last.pageCount, 67); assert.equal(last.page, 67); assert.equal(last.total, 2000); assert.equal(last.items.length, 20);
    assert.equal(new Set([...first.items, ...last.items].map(item => item.id)).size, 50);
    assert.equal((await loadPool({ ...query, page: 999 })).page, 67);
  }
  const empty = await loadPool({ ...filter, tag: `${T}-empty`, videosOnly: true, pageSize: 7 });
  assert.equal(empty.total, 0); assert.equal(empty.pageCount, 1); assert.equal(empty.items.length, 0);
});

test("video facts do not override release gates, publication eligibility or image permission", async () => {
  const id = await article([{ kind: 'video', confirmed: true, poster: 'https://cdn.example.invalid/private.mp4' }]);
  const query = { ...filter, videosOnly: true, now: new Date() };
  assert.equal((await app.inject(`/api/site/items/${id}`)).json().video.poster, null, 'video playback URL must not become an image proxy URL');
  await sql`UPDATE publications SET selected=true, visible_after=now()+interval '1 hour' WHERE article_id=${id}`;
  assert.ok(!(await loadPool(query)).items.some(item => item.id === id));
  await sql`UPDATE publications SET selected=false, eligible=false WHERE article_id=${id}`;
  assert.ok(!(await loadPool(query)).items.some(item => item.id === id));
  await sql`UPDATE publications SET eligible=true, visibility='summary-only' WHERE article_id=${id}`;
  assert.ok(!(await loadPool(query)).items.some(item => item.id === id));
  assert.equal((await app.inject(`/api/site/items/${id}`)).json().video, null);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${id}`;
  assert.ok(!(await loadPool(query)).items.some(item => item.id === id));
  assert.equal((await app.inject(`/api/site/items/${id}`)).statusCode, 404);
});


test("source isolation immediately removes video rows and fresh counts while old count cache expires normally", async () => {
  const cached = await loadPool({ ...filter, videosOnly: true });
  assert.ok(cached.total > 0);
  try {
    for (const mode of ['isolated', 'hot_signal']) {
      await sql`UPDATE sources SET participation_mode = ${mode} WHERE id = ${source}`;
      const withCache = await loadPool({ ...filter, videosOnly: true });
      assert.equal(withCache.items.length, 0);
      assert.equal(withCache.todayCount, 0);
      assert.equal(withCache.total, cached.total, 'existing count cache is bounded to 30 seconds, not an immediate revocation promise');
      for (const search of [{}, { q: 'Video', tab: 'time' as const }, { q: 'Video', tab: 'relevance' as const }]) {
        const fresh = await loadPool({ ...filter, videosOnly: true, now: new Date(), ...search });
        assert.equal(fresh.items.length, 0); assert.equal(fresh.total, 0); assert.equal(fresh.todayCount, 0);
      }
    }
  } finally {
    await sql`UPDATE sources SET participation_mode = 'editorial' WHERE id = ${source}`;
  }
});


test("saved hidden product + Agent column reads the fixed intersection through the site API", async () => {
  const column = { id: `custom-${randomUUID()}`, label: "产品 Agent", visible: false, scope: "all", category: "ai-products", tag: "Agent", pageSize: 1 };
  const input = { ...DEFAULT_PRESENTATION, navigation: [...DEFAULT_PRESENTATION.navigation, column] };
  const match = await article([{ kind: 'video', confirmed: true }], false, 'ai-products', ['Agent']);
  await article([], false, 'ai-models', ['Agent']);
  await article([], false, 'ai-products', ['Other']);
  await savePresentation(input, source);
  const response = await app.inject(`/api/site/pool?columnId=${column.id}`);
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(body.items.map((row: { id: string }) => row.id), [match]);
  assert.equal(body.total, 1); assert.equal(body.todayCount, 1); assert.equal(body.pageSize, 1);
  assert.deepEqual(body.column, { id: column.id, label: column.label, scope: 'all', category: 'ai-products', tag: 'Agent' });
});


test("custom fixed filters survive search, pagination and scope edits; invalid overrides fail closed", async () => {
  const saved = await loadPresentationSettings();
  const column = saved.presentation.navigation.at(-1)!;
  assert.ok('scope' in column);
  const match2 = await article([], true, 'ai-products', ['Agent']);
  for (const tab of ['time', 'relevance']) {
    const first: LightMyRequestResponse = await app.inject(`/api/site/pool?columnId=${column.id}&q=Video&tab=${tab}&pageSize=1`);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().total, 2); assert.equal(first.json().todayCount, 2); assert.equal(first.json().pageCount, 2);
    const second: PoolResponse = (await app.inject(`/api/site/pool?columnId=${column.id}&q=Video&tab=${tab}&pageSize=1&page=2`)).json();
    assert.equal(second.items.length, 1);
    assert.notEqual(first.json().items[0].id, second.items[0].id);
  }
  const changed = { ...saved.presentation, navigation: saved.presentation.navigation.map(row => row.id === column.id ? { ...column, scope: 'videos' as const } : row) };
  await savePresentation(changed, source);
  for (const suffix of ['', '&q=Video&tab=time', '&q=Video&tab=relevance']) {
    const result: PoolResponse = (await app.inject(`/api/site/pool?columnId=${column.id}${suffix}`)).json();
    assert.equal(result.total, 1); assert.equal(result.todayCount, 1);
    assert.equal(result.filters.videosOnly, true); assert.equal(result.column?.scope, 'videos');
    assert.ok(!result.items.some((row: { id: string }) => row.id === match2));
  }
  for (const param of ['category=ai-models', 'tag=Other', 'videosOnly=false', 'channel=x', 'topic=agent', 'category=', 'extra=true']) {
    assert.equal((await app.inject(`/api/site/pool?columnId=${column.id}&${param}`)).statusCode, 400);
  }
  for (const value of ['0', '41', '1.5', 'NaN', '1e1', '-1', '']) assert.equal((await app.inject(`/api/site/pool?columnId=${column.id}&pageSize=${value}`)).statusCode, 400);
  assert.equal((await app.inject('/api/site/pool?columnId=missing')).statusCode, 404);
  assert.equal((await app.inject('/api/site/pool?columnId=all')).statusCode, 404);
  assert.equal((await app.inject(`/api/site/pool?columnId=${column.id}&q=nomatch`)).json().total, 0);
});

test("unavailable column categories are isolated, corrupt settings fail closed, actual search busy has its own code", async () => {
  const saved = (await loadPresentationSettings()).presentation;
  const column = saved.navigation.at(-1)!;
  const broken = { ...column, id: `custom-${randomUUID()}`, category: 'retired-category' };
  const stored = { ...saved, navigation: [...saved.navigation, broken] };
  await sql`UPDATE settings SET value=${sql.json(stored as never)} WHERE key='site_presentation'`;
  assert.equal((await app.inject(`/api/site/pool?columnId=${column.id}`)).statusCode, 200);
  const retired = await app.inject(`/api/site/pool?columnId=${broken.id}`);
  assert.equal(retired.statusCode, 503); assert.equal(retired.json().code, 'temporarily_unavailable');
  assert.deepEqual((await loadPresentationSettings()).presentation, stored);
  await sql`UPDATE settings SET value='{"navigation":null}'::jsonb WHERE key='site_presentation'`;
  const corrupt = await app.inject(`/api/site/pool?columnId=${column.id}`);
  assert.equal(corrupt.statusCode, 503); assert.equal(corrupt.json().code, 'temporarily_unavailable');
  assert.equal((await app.inject('/api/site/pool?columnId=missing')).statusCode, 503);
  const busy = await app.inject('/test-search-busy');
  assert.equal(busy.statusCode, 503); assert.equal(busy.json().code, 'search_busy'); assert.equal(busy.headers['retry-after'], '5');
});
