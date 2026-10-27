import {tag,stub,assertConfiguredTestDatabase} from './setup.ts';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {importInstagramResult} from '@aihot/backend/providers/redfox/import-instagram';
import {scanVideoHistory,applyVideoHistoryEntry,restoreVideoHistoryEntry,reconcileVideoHistoryEntry} from '@aihot/backend/content/video-history';
import {importManualWorkResult} from '@aihot/backend/providers/redfox/import-manual-work';
import {newArticleId} from '@aihot/backend/lib/ids';
let saved:Record<string,unknown>;
let server:Awaited<ReturnType<typeof stub>>,record:Record<string,unknown>;
before(async()=>{
 const [db]=await sql`SELECT current_database() AS name`;assertConfiguredTestDatabase(db!.name);
 saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;
 server=await stub(()=>({code:2000,data:record}));
 process.env.REDFOX_TEST_BASE_URL=server.url;process.env.REDFOX_API_KEY='fake-history';process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;
});
after(async()=>{await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;await server.close();await stopBoss();await closeDb();});
async function imported(mediaFormat='video'){
 const code='H_'+tag();record={code,user:{id:'9384756271'},captionText:'Retained video proof',mediaType:2,mediaFormat};
 const run=await createSynchronousQuery({operationId:'Z9M88QI8',parameters:{codeOrUrl:code}},'video-history',tag());
 await executeOperationStep(run.id,run.step_version,randomUUID());
 const [result]=await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`;
 const article=await importInstagramResult(result!.id,{reason:'Local historical fixture'},'video-history',tag());
 await sql`UPDATE articles SET media='[{"kind":"image","url":"https://example.test/private-image"}]'::jsonb WHERE id=${article!.articleId}`;
 return {...article!,resultId:result!.id};
}
async function scan(){return sql.begin('read only',tx=>scanVideoHistory(tx,5000));}
test('retained receipt dry-run/apply/restore changes only one fact; evidence and stale snapshots are rechecked',async()=>{
 const good=await imported(),conflict=await imported('photo'),stale=await imported(),forged=await imported();
 const before=(await sql`SELECT revision,content_hash,processing_state,media FROM articles WHERE id=${good.articleId}`)[0]!;
 const hits=server.hits(),receipts=(await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n;
 const manifest=await scan(),entry=manifest.entries.find(e=>e.articleId===good.articleId)!;
 assert.ok(entry);assert.equal(entry.evidence.kind,'result');
 assert.equal(manifest.entries.some(e=>e.articleId===conflict.articleId),false);
 assert.equal(JSON.stringify(manifest).includes('private-image'),false);
 assert.deepEqual((await sql`SELECT media FROM articles WHERE id=${good.articleId}`)[0]!.media,before.media);
 const applied=await sql.begin(tx=>applyVideoHistoryEntry(tx,entry));
 const after=(await sql`SELECT revision,content_hash,processing_state,media FROM articles WHERE id=${good.articleId}`)[0]!;
 assert.deepEqual({...after,media:before.media},before);assert.deepEqual(after.media,[...before.media,{kind:'video',confirmed:true}]);
 await sql.begin(tx=>restoreVideoHistoryEntry(tx,applied));
 assert.deepEqual((await sql`SELECT media FROM articles WHERE id=${good.articleId}`)[0]!.media,before.media);
 const staleEntry=manifest.entries.find(e=>e.articleId===stale.articleId)!;
 await sql`UPDATE articles SET revision=revision+1 WHERE id=${stale.articleId}`;
 await assert.rejects(sql.begin(tx=>applyVideoHistoryEntry(tx,staleEntry)),/ordering-unproven|snapshot-changed/);
 const forgedEntry=manifest.entries.find(e=>e.articleId===forged.articleId)!;
 await sql`UPDATE receipts SET response=jsonb_set(response,'{body}',to_jsonb('{"code":2000,"data":{}}'::text)) WHERE id=(SELECT receipt_id FROM operation_results WHERE id=${forged.resultId})`;
 await assert.rejects(sql.begin(tx=>applyVideoHistoryEntry(tx,forgedEntry)));
 const again=await sql.begin(tx=>applyVideoHistoryEntry(tx,entry));
 await sql`UPDATE articles SET media=media||'[{"kind":"image","url":"https://example.test/later"}]'::jsonb WHERE id=${good.articleId}`;
 await assert.rejects(sql.begin(tx=>restoreVideoHistoryEntry(tx,again)),/snapshot-changed/);
 assert.equal(server.hits(),hits);assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n,receipts);
});
test('current stored body supports revised RSS material and rejects changed body, source clock, links and examples',async()=>{
 const sourceId='history-'+tag();await sql`INSERT INTO sources(id,name,kind) VALUES (${sourceId},'Body history','rss')`;
 const make=async(html:string)=>{const id=newArticleId(),url=`https://example.test/${id}`;await sql`INSERT INTO articles(id,source_id,identity_key,url,title,body_html,revision,source_updated_at,discovered_at,timeline_at) VALUES (${id},${sourceId},${'url:'+url},${url},'Stored body',${html},3,'2026-01-01T00:00:00Z',now(),now())`;return id;};
 const good=await make('<video src="/v.mp4"></video>'),changed=await make('<video src="/v.mp4"></video>'),clock=await make('<video src="/v.mp4"></video>'),unknown=await make('<a href="/v.mp4">Video</a><pre><video src="/v.mp4"></video></pre>');
 const manifest=await scan(),entry=manifest.entries.find(e=>e.articleId===good)!;
 assert.equal(entry.evidence.kind,'body');assert.equal(entry.revision,3);assert.equal(manifest.entries.some(e=>e.articleId===unknown),false);
 const applied=await sql.begin(tx=>applyVideoHistoryEntry(tx,entry));await sql.begin(tx=>restoreVideoHistoryEntry(tx,applied));
 assert.deepEqual((await sql`SELECT media FROM articles WHERE id=${good}`)[0]!.media,[]);
 await sql`UPDATE articles SET body_html='<p>Changed after scan</p>' WHERE id=${changed}`;
 await assert.rejects(sql.begin(tx=>applyVideoHistoryEntry(tx,manifest.entries.find(e=>e.articleId===changed)!)));
 await sql`UPDATE articles SET source_updated_at='2026-01-02T00:00:00Z' WHERE id=${clock}`;
 await assert.rejects(sql.begin(tx=>applyVideoHistoryEntry(tx,manifest.entries.find(e=>e.articleId===clock)!)),/snapshot-changed/);
});

test('file-before-commit recovery reconciles only exact before/after snapshots',async()=>{
 const fixture=await imported(),entry=(await scan()).entries.find(e=>e.articleId===fixture.articleId)!;
 let fileEntry=entry;
 await assert.rejects(sql.begin(async tx=>{fileEntry=await applyVideoHistoryEntry(tx,entry);throw new Error('crash before DB commit');}));
 assert.equal(fileEntry.status,'applied');
 const recovered=await sql.begin(tx=>reconcileVideoHistoryEntry(tx,fileEntry));assert.equal(recovered.status,'planned');
 fileEntry=await sql.begin(tx=>applyVideoHistoryEntry(tx,recovered));
 assert.deepEqual(await sql.begin(tx=>reconcileVideoHistoryEntry(tx,fileEntry)),fileEntry);
 await assert.rejects(sql.begin(async tx=>{fileEntry=await restoreVideoHistoryEntry(tx,fileEntry);throw new Error('crash before restore commit');}));
 assert.equal(fileEntry.status,'restored');
 fileEntry=await sql.begin(tx=>reconcileVideoHistoryEntry(tx,fileEntry));assert.equal(fileEntry.status,'applied');
 fileEntry=await sql.begin(tx=>restoreVideoHistoryEntry(tx,fileEntry));
 assert.deepEqual(await sql.begin(tx=>reconcileVideoHistoryEntry(tx,fileEntry)),fileEntry);
 await sql`UPDATE articles SET media='[{"kind":"image","url":"https://example.test/newer"}]'::jsonb WHERE id=${fixture.articleId}`;
 await assert.rejects(sql.begin(tx=>reconcileVideoHistoryEntry(tx,fileEntry)),/snapshot-changed/);
});

test('scan cursor advances past an empty candidate batch to later video evidence',async()=>{
 const prefix='zz-history-'+tag(),sourceId=prefix;
 await sql`INSERT INTO sources(id,name,kind) VALUES (${sourceId},'Cursor history','rss')`;
 for(const [suffix,body] of [['1','<p>Unknown video status</p>'],['2','<video src="/v.mp4"></video>']] as const){
  const id=prefix+suffix,url=`https://example.test/${id}`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,body_html,discovered_at,timeline_at) VALUES (${id},${sourceId},${'url:'+url},${url},'Cursor body',${body},now(),now())`;
 }
 const first=await sql.begin('read only',tx=>scanVideoHistory(tx,1,prefix+'0'));
 assert.equal(first.entries.length,0);assert.equal(first.skipped['no-retained-video-evidence'],1);assert.equal(first.nextCursor,prefix+'1');
 const second=await sql.begin('read only',tx=>scanVideoHistory(tx,1,first.nextCursor!));
 assert.equal(second.entries[0]!.articleId,prefix+'2');
 const repeat=await sql.begin('read only',tx=>scanVideoHistory(tx,1,first.nextCursor!));assert.deepEqual(repeat.entries,second.entries);
 const end=await sql.begin('read only',tx=>scanVideoHistory(tx,5000,prefix+'2'));
 assert.equal(end.nextCursor,null);
});


test('Shipinhao retained manual evidence accepts absent IDs and rejects a different received ID',async()=>{
 const sourceId=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode) VALUES (${sourceId},'Synthetic manual history','external','isolated')`;
 for(const operationId of ['E7G00COY','OVUTOTCV','OE4KUEUO'])for(const withId of [false,true]){
  const videoId=tag(),work={...(withId?{videoId}:{}),description:'Retained list video',videoUrl:'https://example.test/video.mp4'};
  record=operationId==='OE4KUEUO'?work:{list:[work]};
  const parameters=operationId==='E7G00COY'?{keyword:tag()}:operationId==='OVUTOTCV'?{nickname:tag()}:{videoId};
  const run=await createSynchronousQuery({operationId,parameters},'video-history',tag());await executeOperationStep(run.id,run.step_version,randomUUID());
  const [result]=await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND kind='shipinhao_work'`;
  const imported=await importManualWorkResult(result!.id,{sourceId,reason:'Synthetic evidence',supplement:{url:`https://weixin.qq.com/sph/${tag()}`,evidence:'Verified original and author'}},'video-history',tag());
  await sql`UPDATE articles SET media='[]'::jsonb WHERE id=${imported!.articleId}`;
  const entry=(await scan()).entries.find(e=>e.articleId===imported!.articleId);assert.ok(entry,`${operationId} received ID=${withId}`);
  if(withId){await sql`UPDATE operation_results SET provenance=jsonb_set(provenance,'{manualWorkImport,receivedWorkId}',to_jsonb('different-id'::text)) WHERE id=${result!.id}`;await assert.rejects(sql.begin(tx=>applyVideoHistoryEntry(tx,entry)),/manual-original-evidence-missing/);}
 }
});
