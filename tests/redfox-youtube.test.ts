import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {resumeRun} from '@aihot/backend/providers/operations/store';
import {youtubeOperations,type YoutubeOperation} from '@aihot/backend/providers/redfox/youtube-contract';
import {parseYoutube,youtubeVideoId,youtubeChannelId} from '@aihot/backend/providers/redfox/youtube';
const videoId='Abc123_-DEF',channelId='UC_synthetic-001',token=' cursor/+== keep spaces ';
const search={videos:[{videoId,channelId,title:'Synthetic video',description:'Synthetic description',author:'Synthetic channel',publishedTime:'2 weeks ago',thumbnails:[{url:'https://example.com/thumbnail.jpg',width:360,height:200}]}],continuationToken:token,estimatedResults:20,query:'synthetic',videoCount:1};
const detail={videoId,title:'Synthetic detail',videoUrl:`https://www.youtube.com/watch?v=${videoId}`,channelUrl:`https://www.youtube.com/channel/${channelId}`,channelHandle:'@synthetic',date:'首播开始于 2022年1月29日',relativeDate:'4年前',viewCount:'9,228次观看',lengthSeconds:''};
let operation:YoutubeOperation='GC5SC5HS',parameters:Record<string,unknown>={searchQuery:'synthetic',continuationToken:token},data:unknown=search,raw:string|undefined,hits=0,saved:Record<string,unknown>;
const server=http.createServer((req,res)=>{hits++;let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{assert.equal(req.method,'POST');assert.equal(req.url,operation==='GC5SC5HS'?'/story/api/youtube/searchVideo':'/story/api/youtube/videoDetail');assert.equal(req.headers.redfox_api_key,'fake-youtube');assert.deepEqual(JSON.parse(body),parameters);res.end(raw??JSON.stringify({code:2000,data}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}});});
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-youtube';process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function query(){const run=await createSynchronousQuery({operationId:operation,parameters},'youtube-test',tag());await step(run.id);return {run:await row(run.id),results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};}
test('two fixed POST operations preserve raw cursor, identity, original URL and unparsed dates',async()=>{
 const initial=hits;operation='GC5SC5HS';parameters={searchQuery:'synthetic',continuationToken:token};data=search;const a=await query();assert.equal(a.run.status,'completed');assert.equal(a.results[0]!.kind,'youtube_work');assert.equal(a.results[0]!.data.url,detail.videoUrl);assert.deepEqual(a.results[0]!.data.identity,{channelId});assert.equal(a.results[0]!.data.record.publishedTime,'2 weeks ago');assert.equal(a.results[0]!.data.publishedAt,undefined);assert.equal(a.results[1]!.data.continuationToken,token);
 operation='609DF2IR';parameters={videoId};data=detail;const b=await query();assert.equal(b.run.status,'completed');assert.deepEqual(b.results[0]!.data.identity,{channelId});assert.equal(b.results[0]!.data.record.date,detail.date);assert.equal(b.results[0]!.data.record.viewCount,detail.viewCount);assert.equal(hits,initial+2);
});
test('schemas allow nullable continuation but reject fabricated pagination and nonstring IDs',()=>{
 for(const p of [{searchQuery:'x'},{searchQuery:'x',continuationToken:null},{searchQuery:'x',continuationToken:token}])assert.ok(youtubeOperations.GC5SC5HS.schema.safeParse(p).success);
 for(const p of [{searchQuery:'x',page:1},{searchQuery:'x',count:10},{searchQuery:'x',order:'time'},{searchQuery:'x',continuationToken:1},{}])assert.equal(youtubeOperations.GC5SC5HS.schema.safeParse(p).success,false);
 assert.equal(youtubeOperations['609DF2IR'].schema.safeParse({videoId:123}).success,false);assert.equal(youtubeOperations['609DF2IR'].schema.safeParse({videoId,url:detail.videoUrl}).success,false);
});
test('strict native watch and channel paths do not infer shorts, shortened URLs, duplicate v or handle ownership',()=>{
 assert.equal(youtubeVideoId(`http://youtube.com/watch?v=${videoId}&share=test`),videoId);assert.equal(youtubeChannelId(`https://youtube.com/channel/${channelId}/`),channelId);
 for(const u of [`https://youtu.be/${videoId}`,`https://youtube.com/shorts/${videoId}`,`https://youtube.com/watch?v=${videoId}&v=${videoId}`,detail.videoUrl+'#x',`https://youtube.com:443/watch?v=${videoId}`,`https://u:p@youtube.com/watch?v=${videoId}`])assert.equal(youtubeVideoId(u),null);
 assert.equal(youtubeChannelId('https://youtube.com/@synthetic'),null);
 assert.throws(()=>parseYoutube('609DF2IR',{...detail,videoId:'Other123456'},{videoId}));assert.throws(()=>parseYoutube('609DF2IR',{...detail,videoUrl:'https://youtube.com/watch?v=Other123456'},{videoId}));assert.throws(()=>parseYoutube('609DF2IR',{...detail,videoUrl:'https://example.com/video.mp4'},{videoId}));
});
test('missing author or video remains pending and channel handles never become stable identities',()=>{
 const a=parseYoutube('609DF2IR',{videoId,title:'No stable channel',channelHandle:'@synthetic',channelUrl:'https://youtube.com/@synthetic'},{videoId})[0]!;assert.deepEqual(a.data.identity,{});assert.equal((a.data.missing as string[]).some(s=>s.includes('channelId')),false);
 const b=parseYoutube('GC5SC5HS',{videos:[{title:'No video ID',author:'Name only'}]},{});assert.equal(b[0]!.data.url,null);assert.equal(b[0]!.data.workId,null);assert.equal((b[0]!.data.missing as string[]).length,1);
 assert.throws(()=>parseYoutube('GC5SC5HS',{videos:[{videoId,channelId,channelUrl:'https://youtube.com/channel/OtherChannel'}]},{}));
});
test('empty pages commit summary, null continuation, and receipt consumption',async()=>{operation='GC5SC5HS';parameters={searchQuery:'empty',continuationToken:null};data={videos:[],continuationToken:null,videoCount:0};const q=await query();assert.equal(q.run.status,'completed');assert.equal(q.results.length,1);assert.equal(q.results[0]!.kind,'query_summary');assert.equal(q.results[0]!.data.count,0);assert.equal(q.results[0]!.data.continuationToken,null);assert.equal((await sql`SELECT status FROM receipts WHERE id=${q.results[0]!.receipt_id}`)[0]!.status,'completed');});
test('bad raw and mismatched details remain received; disabled local replay never adds a call',async()=>{
 operation='609DF2IR';parameters={videoId};try{for(const response of ['{broken',JSON.stringify({code:2000,data:{videoId:'Other123456'}}),JSON.stringify({code:2000,data:{}})]){raw=response;const q=await query();assert.equal(q.run.status,'needs_review');const initial=hits;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await sql.begin(tx=>resumeRun(tx,{runId:q.run.id,stepVersion:q.run.step_version,generation:q.run.generation}));await step(q.run.id);assert.equal(hits,initial);const [r]=await sql`SELECT status,response,attempts FROM receipts WHERE id=${q.run.current_receipt_id}`;assert.equal(r!.status,'received');assert.equal(r!.response.body,response);assert.equal(r!.attempts,1);process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-youtube';}}finally{raw=undefined;}
});
test('HTTP catalog remains free, retains two video operations, and query commands are idempotent',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic YouTube admin'};operation='GC5SC5HS';parameters={searchQuery:'synthetic'};data=search;
 try{const initial=hits,catalog=await app.inject({url:'/api/admin/redfox/operations'});assert.deepEqual(catalog.json().filter((o:{id:string})=>o.id in youtubeOperations).map((o:{id:string})=>o.id).sort(),['609DF2IR','GC5SC5HS']);assert.equal(hits,initial);const headers={'x-csrf-token':'dev','idempotency-key':tag()},payload={operationId:operation,parameters};const a=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload});assert.equal(a.statusCode,202,a.body);assert.deepEqual((await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload})).json(),a.json());assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload:{...payload,parameters:{searchQuery:'changed'}}})).statusCode,409);await step(a.json().runId);assert.equal((await row(a.json().runId)).status,'completed');}finally{config.devAdmin=null;await app.close();}
});
test('explicit same-video detail freezes minimal origin, including optional channel and original discovery time',async()=>{
 for(const known of [true,false]){
  operation='GC5SC5HS';parameters={searchQuery:'origin'};data={videos:[{videoId,title:'Origin',...(known?{channelId}:{})}]};const source=await query(),result=source.results[0]!,before=hits;
  const body={operationId:'609DF2IR',parameters:{videoId},sourceResultId:Number(result.id)},key=tag();
  await assert.rejects(createSynchronousQuery({...body,parameters:{videoId:'Other123456'}},'youtube-origin',tag()),/differs/);
  await assert.rejects(createSynchronousQuery({...body,operationId:'GC5SC5HS',parameters:{searchQuery:'x'}},'youtube-origin',tag()),/only/);
  assert.equal(hits,before);
  const run=await createSynchronousQuery(body,'youtube-origin',key);
  assert.deepEqual(run.input.origin,{resultId:Number(result.id),videoId,...(known?{channelId}:{}),discoveredAt:result.created_at.toISOString()});
  assert.equal((await row(run.id)).subscription_id,null);
  // A repeated command must not consult a source result that has since lost its proof.
  await sql`UPDATE operation_results SET data='{}'::jsonb WHERE id=${result.id}`;
  assert.equal((await createSynchronousQuery(body,'youtube-origin',key)).id,run.id);
  operation='609DF2IR';parameters={videoId};data={videoId,title:'Detail',...(known?{}:{channelUrl:`https://youtube.com/channel/${channelId}`})};
  await step(run.id);assert.equal((await row(run.id)).status,'completed');
  const [savedResult]=await sql`SELECT data FROM operation_results WHERE run_id=${run.id}`;
  assert.deepEqual(savedResult!.data.identity,{channelId});assert.equal(savedResult!.data.originResultId,Number(result.id));
  assert.equal((await row(source.run.id)).status,'completed');
 }
 const origin={resultId:1,videoId,channelId,discoveredAt:new Date().toISOString()};
 assert.throws(()=>parseYoutube('609DF2IR',{videoId,channelUrl:'https://youtube.com/channel/OtherChannel'},{videoId},origin),/author differs/);
});
test('origin detail imports locally via HTTP with original discovery, description and no outbound; import is idempotent',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic YouTube admin'};
 operation='GC5SC5HS';parameters={searchQuery:'import-origin'};const id=randomUUID().replaceAll('-','').slice(0,11),channel='UC_'+tag();data={videos:[{videoId:id,channelId:channel,title:'Source candidate'}]};const source=await query(),result=source.results[0]!;
 await sql`UPDATE operation_results SET created_at=now()-interval '9 days' WHERE id=${result.id}`;
 const run=await createSynchronousQuery({operationId:'609DF2IR',parameters:{videoId:id},sourceResultId:Number(result.id)},'youtube-import',tag());
 operation='609DF2IR';parameters={videoId:id};data={videoId:id,title:'Synthetic detail import',description:'Description, not subtitles',thumbnails:[{url:'https://example.com/synthetic.jpg'}],date:'2020年1月1日'};await step(run.id);
 const [detailResult]=await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`,before=hits;
 process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{
  const headers={'x-csrf-token':'dev','idempotency-key':tag()},payload={sourceId:await makeWorkSource(),reason:'Confirmed synthetic import'},url=`/api/admin/operations/results/${detailResult!.id}/import`;
  const response=await app.inject({method:'POST',url,headers,payload});assert.equal(response.statusCode,200,response.body);const imported=response.json();
  assert.deepEqual((await app.inject({method:'POST',url,headers,payload})).json(),imported);
  assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,supplement:{channelId:channel,evidence:'different intent'}}})).statusCode,409);
  const [article]=await sql`SELECT * FROM articles WHERE id=${imported.articleId}`;
  assert.equal(article!.discovered_at.toISOString(),(run.input.origin as {discoveredAt:string}).discoveredAt);assert.equal(article!.backfill,true);assert.equal(article!.backfill_reason,'redfox-import-unknown-time');assert.equal(article!.body_text,'Description, not subtitles');assert.equal(article!.media.length,2);assert.equal(article!.media.find((m:{kind:string;confirmed?:boolean})=>m.kind==="video")?.confirmed,true);
  const [owner]=await sql`SELECT * FROM sources WHERE id=${imported.sourceId}`;assert.equal(owner!.participation_mode,'isolated');assert.equal(owner!.site_fulltext,false);assert.equal(hits,before);
 }finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-youtube';config.devAdmin=null;await app.close();}
});
test('independent detail requires explicit source; missing author is allowed and disabled source rejects',async()=>{
 const {importYoutubeResult}=await import('@aihot/backend/providers/redfox/import-youtube');
 const id=randomUUID().replaceAll('-','').slice(0,11),channel='UC_'+tag();operation='609DF2IR';parameters={videoId:id};data={videoId:id,title:'Independent',channelHandle:'@not-proof'};const q=await query(),resultId=Number(q.results[0]!.id),before=hits;
 await assert.rejects(importYoutubeResult(resultId,{reason:'No author'},'youtube-import',tag()),/associated source/);
 const sourceId=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext) VALUES (${sourceId},'Synthetic channel','external','editorial',true)`;
 await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES ('youtube','channelId',${channel},${sourceId},'{"kind":"audit","reference":"synthetic"}')`;
 const input={sourceId,reason:'Explicit source'};
 await sql`UPDATE sources SET participation_mode='isolated',enabled=false WHERE id=${sourceId}`;
 await assert.rejects(importYoutubeResult(resultId,input,'youtube-import',tag()),/disabled/);
 await sql`UPDATE sources SET enabled=true WHERE id=${sourceId}`;
 const imported=await importYoutubeResult(resultId,input,'youtube-import',tag());assert.equal(imported!.sourceId,sourceId);assert.equal(hits,before);
 // Search missing both video and channel accepts only explicit native original + evidence.
 operation='GC5SC5HS';parameters={searchQuery:'missing'};data={videos:[{title:'Missing identifiers'}]};const missing=await query();
 await assert.rejects(importYoutubeResult(Number(missing.results[0]!.id),{reason:'Bad original',supplement:{channelId:channel,url:'https://youtu.be/Abc123_-DEF',evidence:'x'}},'youtube-import',tag()));
 const otherId=randomUUID().replaceAll('-','').slice(0,11);const completed=await importYoutubeResult(Number(missing.results[0]!.id),{sourceId,reason:'Verified missing original',supplement:{channelId:channel,url:`https://youtube.com/watch?v=${otherId}`,evidence:'Verified native original'}},'youtube-import',tag());assert.ok(completed!.articleId);
 await assert.rejects(importYoutubeResult(Number(missing.results[1]!.id),{reason:'Summary'},'youtube-import',tag()),/summaries/);
});
test('legacy ownership conflicts roll back import source, binding and result relation',async()=>{
 const {importYoutubeResult}=await import('@aihot/backend/providers/redfox/import-youtube'),{newArticleId}=await import('@aihot/backend/lib/ids');
 const id=randomUUID().replaceAll('-','').slice(0,11),channel='UC_'+tag(),owner=tag();await sql`INSERT INTO sources(id,name,kind) VALUES (${owner},'Synthetic legacy','external')`;
 for(const variant of ['a','b']){const address=`https://youtube.com/watch?v=${id}&token=${variant}`;await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES (${newArticleId()},${owner},${'url:'+address},${address},'Legacy conflict',now(),now())`;}
 operation='GC5SC5HS';parameters={searchQuery:'conflict'};data={videos:[{videoId:id,channelId:channel,title:'Conflict'}]};const q=await query();
 await assert.rejects(importYoutubeResult(Number(q.results[0]!.id),{sourceId:owner,reason:'Conflict proof'},'youtube-import',tag()),{code:'conflict'});
 assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE platform='youtube' AND id_value=${channel}`).length,0);
 assert.equal((await sql`SELECT source_id FROM operation_results WHERE id=${q.results[0]!.id}`)[0]!.source_id,null);
});

async function makeWorkSource(){const id=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext) VALUES (${id},'Synthetic work owner','rss','isolated',false)`;return id;}
