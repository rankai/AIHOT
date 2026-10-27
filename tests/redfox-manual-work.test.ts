import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {createPlatformSubscription,startPlatformSubscription} from '@aihot/backend/sources/platform-subscriptions';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {importManualWorkResult as load,isKuaishouWorkUrl} from '@aihot/backend/providers/redfox/import-manual-work';
import {upsertMaterial} from '@aihot/backend/content/materials';
let data:unknown,hits=0,saved:Record<string,unknown>;
const server=http.createServer((req,res)=>{hits++;req.resume();req.on('end',()=>res.end(JSON.stringify({code:2000,data})));});
let savedCollect:Record<string,unknown>;
before(async()=>{savedCollect=(await sql`SELECT * FROM budgets WHERE service='redfox.collect'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.collect'`;await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-manual';process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${savedCollect.per_minute as number},per_hour=${savedCollect.per_hour as number},per_day=${savedCollect.per_day as number} WHERE service='redfox.collect'`;await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function query(operationId:string,parameters:Record<string,unknown>,response:unknown,sourceResultId?:number){data=response;const run=await createSynchronousQuery({operationId,parameters,...(sourceResultId?{sourceResultId}:{})},'manual-test',tag());await step(run.id);assert.equal((await row(run.id)).status,'completed',(await row(run.id)).wait_reason);return {run,results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};}
async function source(mode='isolated',kind='external',enabled=true){const id=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode,enabled,site_fulltext) VALUES (${id},'Synthetic manual source',${kind},${mode},${enabled},false)`;return id;}
const body=(sourceId:string,url:string)=>({sourceId,reason:'Verified per-item attribution',supplement:{url,evidence:'Synthetic independently checked source and original'}});
const sphUrl=()=>`https://weixin.qq.com/sph/${randomUUID().replaceAll('-','')}`;
const ksUrl=()=>`https://www.kuaishou.com/short-video/${randomUUID().replaceAll('-','')}`;
test('both fixed origins preserve received/request distinction and old discovery through local manual import',async()=>{
 for(const platform of ['shipinhao','kuaishou']){
  const sph=platform==='shipinhao',id='opaque_'+tag(),op=sph?'E7G00COY':'ZWR31P2A',target=sph?'OE4KUEUO':'UOM99OQI',field=sph?'videoId':'photoId';
  const first=await query(op,{keyword:tag()},{list:[{[field]:id,...(sph?{description:'Synthetic first'}:{caption:'Synthetic first'}),nickname:'Same display name'}]});
  const original=first.results[0]!,when=new Date(Date.now()-5*86400000);await sql`UPDATE operation_results SET created_at=${when} WHERE id=${original.id}`;
  const parameters={[field]:id},command={operationId:target,parameters,sourceResultId:Number(original.id)},key=tag();
  const before=hits;await assert.rejects(createSynchronousQuery({...command,parameters:{[field]:'wrong'}},'manual-test',tag()),/differs/);assert.equal(hits,before);
  const run=await createSynchronousQuery(command,'manual-test',key);assert.deepEqual(run.input.origin,{resultId:Number(original.id),workId:id,workIdKind:field,discoveredAt:when.toISOString()});assert.equal((await row(run.id)).subscription_id,null);
  await sql`UPDATE operation_results SET data='{}' WHERE id=${original.id}`;assert.equal((await createSynchronousQuery(command,'manual-test',key)).id,run.id);
  const received=sph?{description:'Synthetic detail body',nickname:'Display only',publishTime:'2020-01-01 12:00:00',videoUrl:'https://example.com/video',thumbUrl:'https://example.com/cover'}:{caption:'Synthetic detail body',nickname:'Display only',publishTime:'2020-01-01 12:00:00',videoUrl:'https://example.com/video',coverUrl:'https://example.com/cover'};
  data=received;await step(run.id);assert.equal((await row(run.id)).status,'completed');
  const [r]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(r!.data.workId,null);assert.equal(r!.data.requestedWorkId,id);assert.deepEqual(r!.data.identity,{});assert.equal(r!.data.originResultId,Number(original.id));
  const selected=await source(),url=sph?sphUrl():ksUrl(),initial=hits;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
  try{const imported=await load(r!.id,body(selected,url),'manual-test',tag());const [a]=await sql`SELECT * FROM articles WHERE id=${imported!.articleId}`;assert.equal(a!.discovered_at.toISOString(),when.toISOString());assert.equal(a!.backfill,true);assert.equal(a!.body_text,'Synthetic detail body');assert.equal(a!.raw.provider,'redfox');assert.equal(a!.media[0].poster,'https://example.com/cover');assert.ok(a!.identity_key.startsWith('url:'));assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE source_id=${selected}`).length,0);assert.equal((await sql`SELECT 1 FROM article_identity_aliases WHERE article_id=${a!.id}`).length,0);assert.deepEqual((await sql`SELECT data FROM operation_results WHERE id=${r!.id}`)[0]!.data.record,received);assert.equal((await row(first.run.id)).status,'completed');assert.equal(hits,initial);}finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-manual';}
 }
});
test('origin accepts only received IDs from approved lists; no export/request/normalized identity upgrades',async()=>{
 const selected=await query('MH5YA9DL',{url:sphUrl()},{exportId:'export-only',description:'Synthetic'});
 await assert.rejects(createSynchronousQuery({operationId:'OE4KUEUO',parameters:{videoId:'export-only'},sourceResultId:Number(selected.results[0]!.id)},'manual-test',tag()),/approved/);
 const list=await query('27DQ6SF9',{kwaiId:'display'},{list:[{caption:'No received ID'}]});
 await sql`UPDATE operation_results SET data=data||'{"workId":"fake","identity":{"photoId":"fake"}}'::jsonb WHERE id=${list.results[0]!.id}`;
 await assert.rejects(createSynchronousQuery({operationId:'UOM99OQI',parameters:{photoId:'fake'},sourceResultId:Number(list.results[0]!.id)},'manual-test',tag()),/received work ID/);
 const valid=await query('OVUTOTCV',{nickname:'display'},{list:[{videoId:'real-id',description:'Synthetic'}]});
 await sql`UPDATE receipts SET model='wrong' WHERE id=${valid.results[0]!.receipt_id}`;
 await assert.rejects(createSynchronousQuery({operationId:'OE4KUEUO',parameters:{videoId:'real-id'},sourceResultId:Number(valid.results[0]!.id)},'manual-test',tag()),/confirmed/);
});
test('current permission checks, strict native links, and fixed share scope reject without partial writes',async()=>{
 const share=sphUrl(),q=await query('MH5YA9DL',{url:share},{exportId:'received-export',description:'Synthetic'}),id=q.results[0]!.id,isolated=await source();
 await assert.rejects(load(id,body(await source('isolated','external',false),share),'manual-test',tag()),/停用/);
 for(const url of ['https://example.com/video','https://weixin.qq.com:443/sph/test',share+'#fragment','https://u@weixin.qq.com/sph/test'])await assert.rejects(load(id,body(isolated,url),'manual-test',tag()));
 await assert.rejects(load(id,body(isolated,sphUrl()),'manual-test',tag()),{code:'conflict'});
 for(const url of ['https://kuaishou.com:443/short-video/x','https://u@kuaishou.com/short-video/x','https://kuaishou.com/short-video/x#hash','https://kuaishou.com/profile/x','https://v.kuaishou.com/x'])assert.equal(isKuaishouWorkUrl(url),false);
 assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${id}`)[0]!.article_id,null);
 await assert.rejects(load(id,{...body(isolated,share),supplement:{...body(isolated,share).supplement,authorId:'fake'}},'manual-test',tag()));
 const account=await query('GU17EVLV',{accountName:'display'},{list:[{nickname:'Only display'}]});await assert.rejects(load(account.results[0]!.id,body(isolated,ksUrl()),'manual-test',tag()),/Only received/);
});
test('concurrent import is idempotent; changed evidence or target conflicts, existing article ownership and time survive',async()=>{
 const q=await query('UOM99OQI',{photoId:'opaque-supplier'},{caption:'Synthetic body'}),r=q.results[0]!,selected=await source(),url=ksUrl(),input=body(selected,url),key=tag(),before=hits;
 const results=await Promise.all([load(r.id,input,'manual-test',key),load(r.id,input,'manual-test',key)]);assert.equal(results[0]!.articleId,results[1]!.articleId);
 assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${`result:${r.id}`} AND action='material.import'`)[0]!.n,1);
 await assert.rejects(load(r.id,{...input,supplement:{...input.supplement,evidence:'Changed evidence'}},'manual-test',key),{code:'conflict'});
 await assert.rejects(load(r.id,body(await source(),url),'manual-test',tag()),{code:'conflict'});
 const owner=await source('editorial'),oldTime=new Date('2020-01-01T00:00:00Z'),legacyUrl=ksUrl();const legacy=await upsertMaterial({sourceId:owner,url:legacyUrl,title:'Legacy',bodyText:'Legacy body',bodyStatus:'ok',discoveredAt:oldTime,via:'import'});
 const next=await query('UOM99OQI',{photoId:'another-opaque'},{caption:'New received body'}),loaded=await load(next.results[0]!.id,body(selected,legacyUrl),'manual-test',tag());assert.equal(loaded!.articleId,legacy.articleId);
 const [a]=await sql`SELECT * FROM articles WHERE id=${legacy.articleId}`;assert.equal(a!.source_id,owner);assert.equal(a!.body_text,'Legacy body');assert.equal(a!.discovered_at.toISOString(),oldTime.toISOString());assert.equal(hits,before+1);
});
test('HTTP import requires CSRF, strict input, exposes conflicts, and local mutation does not call suppliers',async()=>{
 const q=await query('OE4KUEUO',{videoId:'requested-only'},{description:'Synthetic'}),r=q.results[0]!,selected=await source(),payload=body(selected,sphUrl());const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic admin'};
 try{const initial=hits,url=`/api/admin/operations/results/${r.id}/import`,headers={'x-csrf-token':'dev','idempotency-key':tag()};assert.equal((await app.inject({method:'POST',url,payload})).statusCode,403);assert.equal((await app.inject({method:'POST',url,headers,payload:{sourceId:selected,reason:'Missing evidence'}})).statusCode,422);assert.equal((await app.inject({method:'POST',url,headers,payload})).statusCode,200);assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,supplement:{...payload.supplement,url:sphUrl()}}})).statusCode,409);assert.equal(hits,initial);}finally{config.devAdmin=null;await app.close();}
});
test('concurrent different targets commit one attribution only and later permission changes are rechecked',async()=>{
 const q=await query('27DQ6SF9',{threeXId:'locator-only'},{list:[{photoId:'opaque-'+tag(),caption:'Synthetic'}]}),r=q.results[0]!,a=await source(),b=await source(),url=ksUrl();
 const outcomes=await Promise.allSettled([load(r.id,body(a,url),'manual-test',tag()),load(r.id,body(b,url),'manual-test',tag())]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);const rejected=outcomes.find(x=>x.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.code,'conflict');
 const [stored]=await sql`SELECT source_id,article_id FROM operation_results WHERE id=${r.id}`;assert.ok([a,b].includes(stored!.source_id));assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${`result:${r.id}`} AND action='material.import'`)[0]!.n,1);
 await sql`UPDATE sources SET enabled=false WHERE id=${stored!.source_id}`;await assert.rejects(load(r.id,body(stored!.source_id,url),'manual-test',tag()),/停用/);
 assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE source_id IN (${a},${b})`).length,0);
});

test('new manual SPH and KS descriptions fill missing bodies but preserve full same-source material',async()=>{
 for(const sph of [true,false]){
  const selected=await source(),url=sph?sphUrl():ksUrl(),record=sph?{description:'Synthetic caption'}:{caption:'Synthetic caption'};
  const op=sph?'OE4KUEUO':'UOM99OQI',params=sph?{videoId:tag()}:{photoId:tag()};
  const first=await query(op,params,record),input=body(selected,url),a=await load(first.results[0]!.id,input,'body-test',tag());
  const [old]=await sql`SELECT * FROM articles WHERE id=${a!.articleId}`;assert.equal(old!.body_text,'Synthetic caption');
  await upsertMaterial({sourceId:selected,url,title:old!.title,bodyText:'Complete verified body',bodyHtml:'<p>Complete verified body</p>',via:'fetch'});
  await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${a!.articleId}`;
  const [before]=await sql`SELECT * FROM articles WHERE id=${a!.articleId}`;
  const next=await query(op,params,record),r=next.results[0]!;assert.notEqual(r.id,first.results[0]!.id);
  const initialHits=hits;process.env.REDFOX_CALLS_ENABLED='false';
  try{assert.equal((await load(r.id,input,'body-test',tag()))!.articleId,a!.articleId);}finally{process.env.REDFOX_CALLS_ENABLED='true';}
  const [after]=await sql`SELECT * FROM articles WHERE id=${a!.articleId}`;
  for(const field of ['body_text','body_html','body_status','content_hash','revision','processing_state','discovered_at','backfill'])assert.deepEqual(after![field],before![field],field);
  assert.equal(hits,initialHits);assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${r.id}`)[0]!.article_id,a!.articleId);
 }
});

test('work attribution accepts configured editorial RSS sources without author identity or duplicate share evidence',async()=>{
 const selected=await source('editorial','rss'),share=sphUrl();
 const q=await query('MH5YA9DL',{url:share},{exportId:'received-'+tag(),description:'Synthetic ownerless author'}),r=q.results[0]!;
 await assert.rejects(load(r.id,{reason:'No selection'},'manual-test',tag()),/所属信源/);
 const imported=await load(r.id,{sourceId:selected,reason:'Use the received share scope'},'manual-test',tag());
 assert.equal(imported!.sourceId,selected);
 assert.equal((await sql`SELECT participation_mode FROM sources WHERE id=${selected}`)[0]!.participation_mode,'editorial');
 assert.equal((await sql`SELECT source_id FROM articles WHERE id=${imported!.articleId}`)[0]!.source_id,selected);
});

test('Channels and Kuaishou collections inherit the source and keep missing originals pending until explicitly proven',async()=>{
 for(const sph of [true,false]){
  const selected=await source('editorial','rss'),operationId=sph?'E7G00COY':'ZWR31P2A';
  data={list:[sph?{videoId:'opaque-'+tag(),description:'No author, no original'}:{photoId:'opaque-'+tag(),caption:'No author, no original'}]};
  const sub=await createPlatformSubscription({name:tag(),sourceId:selected,operationId,parameters:{keyword:'synthetic'},enabled:true,limits:{pages:1,items:1,details:0}},'test',tag());
  process.env.COLLECT_ENABLED='true';const run=await startPlatformSubscription(sub.id,'test',tag());
  try{for(let i=0;i<5&&(await row(run.id)).status==='active';i++)await step(run.id);}finally{process.env.COLLECT_ENABLED='false';}
  const [r]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind=${sph?'shipinhao_work':'kuaishou_work'}`;
  assert.equal(r!.article_id,null);assert.match(r!.data.pendingReason,/原文/);assert.doesNotMatch(r!.data.pendingReason,/作者|隔离/);
  const url=sph?sphUrl():ksUrl(),before=hits,imported=await load(r!.id,{reason:'Verified original',supplement:{url,evidence:'Synthetic verified native original'}},'test',tag());
  assert.equal(imported!.sourceId,selected);assert.equal((await sql`SELECT source_id FROM articles WHERE id=${imported!.articleId}`)[0]!.source_id,selected);assert.equal(hits,before);
 }
});

test('completed manual work command replays after source disable without new writes',async()=>{
 const selected=await source(),id=tag(),q=await query('ZWR31P2A',{keyword:tag()},{list:[{photoId:id,caption:'Authorless replay'}]}),r=q.results[0]!,key=tag(),input=body(selected,ksUrl());
 const saved=await load(r.id,input,'manual-test',key),before=hits;
 await sql`UPDATE sources SET enabled=false,execution_version=execution_version+1 WHERE id=${selected}`;
 assert.deepEqual(await load(r.id,input,'manual-test',key),saved);assert.equal(hits,before);
 await assert.rejects(load(r.id,{...input,supplement:{...input.supplement,evidence:'Changed'}},'manual-test',key),{code:'conflict'});
 await assert.rejects(load(r.id,input,'manual-test',tag()),/停用|失效/);
});
