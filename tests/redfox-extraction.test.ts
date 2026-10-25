import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import { config } from '@aihot/backend/config';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { queueProcessing } from '@aihot/backend/jobs/content';
import { stopBoss, QUEUES } from '@aihot/backend/jobs/queue';
import { collectSource } from "@aihot/backend/sources/collect";
import { extractArticleBody } from '@aihot/backend/content/extract';

const T = tag();
let hits = 0;
const server = http.createServer((_req, res) => {
  hits++;
  if (_req.url === '/feed') {
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    res.end(`<rss><channel><item><title>Synthetic video article</title><link>${base}/collected-video</link><enclosure type="image/jpeg" url="https://example.com/list-cover.jpg"/></item></channel></rss>`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<html><head><title>Synthetic article</title></head><body><article><h1>Synthetic article</h1><p>${'A synthetic article describes a local experiment and its observable results in enough detail to extract the complete text. '.repeat(12)}</p><video src="https://example.com/video.mp4"></video></article></body></html>`);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await stopBoss(); await closeDb(); });
async function fixture(name: string, raw: object = { provider: 'redfox' }) {
  const sourceId = `test-redfox-extract-${T}-${name}`;
  await sql`INSERT INTO sources(id,name,kind,config,tier,participation_mode,site_fulltext) VALUES(${sourceId},${name},'external','{}','T1','editorial',true)`;
  const result = await upsertMaterial({ sourceId, url: `${base}/${T}/${name}`, title: 'Synthetic extraction material', raw, via: 'import', bodyStatus: 'pending' });
  return { id: result.articleId, sourceId };
}

test('Redfox external material forbids implicit GET and leaves extraction routing', async () => {
  const { id } = await fixture('import');
  const before = hits;
  assert.equal(await extractArticleBody(id, false), 'unconfirmed');
  assert.equal(await extractArticleBody(id, false), 'unconfirmed');
  assert.equal(hits, before);
  const [a] = await sql`SELECT body_status,revision FROM articles WHERE id=${id}`;
  assert.equal(a!.body_status, 'unconfirmed');
  assert.equal(a!.revision, 1);
  await queueProcessing(id);
  const jobs = await sql`SELECT name FROM pgboss.job WHERE data->>'articleId'=${id}`;
  assert.ok(jobs.some(j => j.name === QUEUES.analyze));
  assert.ok(!jobs.some(j => j.name === QUEUES.extractBody));
});

test('formal Redfox subscription also settles pending without touching an existing complete body', async () => {
  const { id, sourceId } = await fixture('subscription', {});
  await sql`INSERT INTO collection_subscriptions(control_source_id,provider,platform,operation_key,contract_version,interval_minutes)
    VALUES(${sourceId},'redfox','x','redfox.x.collection',1,30)`;
  const before = hits;
  assert.equal(await extractArticleBody(id, false), 'unconfirmed');
  assert.equal((await sql`SELECT body_status FROM articles WHERE id=${id}`)[0]!.body_status, 'unconfirmed');
  await sql`UPDATE articles SET body_status='ok',body_text='Already complete',revision=2 WHERE id=${id}`;
  assert.equal(await extractArticleBody(id, false), 'skipped');
  assert.equal((await sql`SELECT body_text FROM articles WHERE id=${id}`)[0]!.body_text, 'Already complete');
  assert.equal(hits, before);
});

test('ordinary external material still extracts from the local page', async () => {
  const { id } = await fixture('ordinary', { provider: 'ordinary' });
  const before = hits;
  assert.equal(await extractArticleBody(id, false), 'ok');
  assert.equal(hits - before, 1);
});

test('a blocked old extraction cannot mark a newer revision unconfirmed', async () => {
  const { id } = await fixture('revision');
  const before = hits;
  let extraction: Promise<string> | undefined;
  await sql.begin(async tx => {
    const [holder] = await tx`SELECT pg_backend_pid() AS pid`;
    await tx`SELECT id FROM articles WHERE id=${id} FOR UPDATE`;
    extraction = extractArticleBody(id, false);
    let waiting = false;
    for (let n = 0; n < 200; n++) {
      const [blocked] = await sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${holder!.pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (blocked!.waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, 'extraction reached its conditional update while the old revision was visible');
    await tx`UPDATE articles SET revision=revision+1,body_text='New revision awaiting its own decision' WHERE id=${id}`;
  });
  assert.equal(await extraction, 'unconfirmed');
  const [a] = await sql`SELECT body_status,revision,body_text FROM articles WHERE id=${id}`;
  assert.equal(a!.body_status, 'pending');
  assert.equal(a!.revision, 2);
  assert.equal(a!.body_text, 'New revision awaiting its own decision');
  assert.equal(hits, before);
});

test('collection reuses extracted video fact alongside an existing feed image without another fetch', async () => {
  const sourceId = `test-extract-collect-${T}`;
  await sql`INSERT INTO sources(id,name,kind,config,tier,participation_mode)
    VALUES(${sourceId},'Extract reuse','rss',${sql.json({feedUrl: `${base}/feed`, detail: {publishedAtSelector: 'time', maxFetches: 1}})},'T1','editorial')`;
  const before = hits;
  const result = await collectSource(sourceId);
  assert.equal(result.created, 1, result.error ?? "collection created one material");
  assert.equal(hits - before, 2, 'one feed and its already-needed detail, no media fetch');
  const [row] = await sql`SELECT media,body_status FROM articles WHERE source_id=${sourceId}`;
  assert.equal(row!.body_status, 'ok');
  assert.deepEqual(row!.media, [{kind:'image',url:'https://example.com/list-cover.jpg'}, {kind:'video',confirmed:true}]);
});
