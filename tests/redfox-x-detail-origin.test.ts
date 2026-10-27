import {createTweetQuery} from '@aihot/backend/providers/redfox/queries';
import {importXDetailResult} from '@aihot/backend/providers/redfox/import-x-detail';
import {resumeRun} from '@aihot/backend/providers/operations/store';
import {tag,assertConfiguredTestDatabase} from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {importXSearchResult} from '@aihot/backend/providers/redfox/import-x-search';
import {createPlatformSubscription,startPlatformSubscription} from '@aihot/backend/sources/platform-subscriptions';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {upsertMaterial} from '@aihot/backend/content/materials';
const requests:Record<string,unknown>[]=[];
let respond:(p:Record<string,unknown>)=>unknown=()=>({tweets:[]});
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const p=JSON.parse(body);requests.push(p);res.end(JSON.stringify({code:2000,data:respond(p)}));});});
let budgets:Record<string,any>[];
function valves(on=true){process.env.REDFOX_CALLS_ENABLED=String(on);process.env.COLLECT_ENABLED=String(on);if(on)process.env.REDFOX_API_KEY='fake-x-search';else delete process.env.REDFOX_API_KEY;}
const chosenWorkSource=tag();
before(async()=>{await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext) VALUES (${chosenWorkSource},'Selected X source','rss','isolated',false)`;const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;config.allowPrivateNetworkFetch=true;valves();budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.query','redfox.collect')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.query','redfox.collect')`;});
after(async()=>{try{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;}finally{valves(false);if(server.listening)await new Promise<void>(r=>server.close(()=>r()));try{await stopBoss();}finally{await closeDb();}}});
const id=()=>BigInt('0x'+randomUUID().replaceAll('-','').slice(0,20)).toString();
const tweet=(uid=id(),tid=id(),text='Synthetic X text')=>({tweetId:tid,text,createdAt:new Date().toISOString(),user:{userId:uid,username:'synthetic_x',displayName:'Synthetic author'}});
const row=async(n:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${n}`)[0]!;
const step=async(n:number)=>{const r=await row(n);await executeOperationStep(n,r.step_version,randomUUID());};
async function finish(n:number){for(let i=0;i<25;i++){const r=await row(n);if(r.status!=='active')return r;await step(n);}throw Error('Bounded fixture exceeded');}
async function query(t:unknown){valves();respond=()=>({tweets:[t]});const r=await createSynchronousQuery({operationId:'5K5EG87P',parameters:{keyword:tag()}},'test',tag());await step(r.id);assert.equal((await row(r.id)).status,'completed');return (await sql`SELECT * FROM operation_results WHERE run_id=${r.id} AND kind='x_research_work'`)[0]!;}
async function source(uid:string,mode='isolated',kind='external'){const sid=tag();await sql`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,enabled) VALUES(${sid},'Synthetic author',${kind},${sql.json(kind==='x_search'?{query:'from:synthetic_x'}:{})},${mode},false,true)`;await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES('x','user_id',${uid},${sid},'{"kind":"audit","reference":"synthetic"}')`;return sid;}
async function collection(p:Record<string,unknown>,pages=2){const sub=await createPlatformSubscription({sourceId:chosenWorkSource,name:tag(),operationId:'5K5EG87P',parameters:p,enabled:true,limits:{pages,items:10,details:0}},'test',tag());return startPlatformSubscription(sub.id,'test',tag());}
for(const collect of [false,true])test(`${collect?'collection':'query'} source → missing-handle detail → offline import preserves raw, time, body and parent`,async()=>{
 const t=tweet();let original;
 if(collect){valves();respond=()=>({tweets:[t]});const r=await collection({keyword:tag()},1);await step(r.id);await sql`UPDATE operation_results SET created_at='2020-01-02T03:04:05Z' WHERE run_id=${r.id} AND kind='query_summary'`;await finish(r.id);original=(await sql`SELECT * FROM operation_results WHERE run_id=${r.id} AND kind='x_research_work'`)[0]!;}
 else{original=await query(t);await sql`UPDATE operation_results SET created_at='2020-01-02T03:04:05Z' WHERE id=${original.id}`;}
 const parent=await row(original.run_id),input={tweetId:t.tweetId,sourceResultId:original.id},key=tag(),run=await createTweetQuery(input,'test',key),calls=requests.length;
 assert.equal((run.input.origin as {discoveredAt:string}).discoveredAt,'2020-01-02T03:04:05.000Z');respond=()=>({tweetId:t.tweetId,author:{userId:t.user.userId,username:null},createdAt:t.createdAt,text:'Shorter detail'});await step(run.id);assert.equal((await row(run.id)).status,'completed');assert.equal(requests.length,calls+1);
 const [d]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(d!.kind,'x_detail_work');assert.equal(d!.data.record.author.username,null);assert.equal(d!.data.context.username,'synthetic_x');assert.equal(d!.data.originResultId,original.id);
 const n=requests.length;valves(false);const importKey=tag(),saved=await importXDetailResult(d!.id,{sourceId:chosenWorkSource,reason:'Same work'},'test',importKey);assert.ok(saved?.articleId);assert.equal((await importXDetailResult(d!.id,{sourceId:chosenWorkSource,reason:'Repeat'},'test',importKey))?.articleId,saved.articleId);assert.equal(requests.length,n);
 const [a]=await sql`SELECT * FROM articles WHERE id=${saved.articleId}`;assert.equal(a!.discovered_at.toISOString(),'2020-01-02T03:04:05.000Z');if(collect){assert.equal(saved.articleId,original.article_id);assert.equal(a!.body_text,t.text);}assert.equal((await row(parent.id)).step_version,parent.step_version);
 await sql`UPDATE operation_results SET data='{}' WHERE id=${original.id}`;assert.equal((await createTweetQuery(input,'test',key)).id,run.id);await assert.rejects(createTweetQuery({...input,tweetId:id()},'test',key),/different input/);
});
test('wrong request/user, missing received identity and foreign page are rejected; bad received raw replays offline',async()=>{
 const t=tweet(),s=await query(t),n=requests.length;await assert.rejects(createTweetQuery({tweetId:id(),sourceResultId:s.id},'test',tag()),/tweet ID/);assert.equal(requests.length,n);
 const run=await createTweetQuery({tweetId:t.tweetId,sourceResultId:s.id},'test',tag());respond=()=>({tweetId:t.tweetId,author:{userId:id()},createdAt:t.createdAt,text:'Wrong author'});await step(run.id);assert.equal((await row(run.id)).status,'needs_review');const count=requests.length;valves(false);const r=await row(run.id);await sql.begin(tx=>resumeRun(tx,{runId:r.id,generation:r.generation,stepVersion:r.step_version}));await step(r.id);assert.equal(requests.length,count);assert.equal((await row(r.id)).status,'needs_review');
 const missing=await query({...tweet(),user:{username:'synthetic_x'}});assert.ok((await createTweetQuery({tweetId:missing.data.record.tweetId,sourceResultId:missing.id},'test',tag())).id);
 valves();const p=tweet();respond=()=>({tweets:[p]});const c=await collection({keyword:tag()},1);await finish(c.id);const [z]=await sql`SELECT * FROM operation_results WHERE run_id=${c.id} AND kind='x_research_work'`;await sql`UPDATE operation_results SET provenance=jsonb_set(provenance,'{sourcePageResultId}',${sql.json(s.id)}) WHERE id=${z!.id}`;await assert.rejects(createTweetQuery({tweetId:p.tweetId,sourceResultId:z!.id},'test',tag()),/page/);
});
test('legacy article and new no-origin detail import; native article is never accepted',async()=>{
 valves();const t=tweet(),run=await createTweetQuery({tweetId:t.tweetId},'test',tag());respond=()=>({tweetId:t.tweetId,author:t.user,createdAt:t.createdAt,text:t.text});await step(run.id);const [d]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(d!.data.originResultId,undefined);
 await sql`UPDATE operation_results SET kind='article',data=${sql.json(d!.data.record)} WHERE id=${d!.id}`;valves(false);assert.ok((await importXDetailResult(d!.id,{sourceId:chosenWorkSource,reason:'Legacy received detail'},'test',tag()))?.articleId);
 await sql`UPDATE operation_runs SET operation_key='native.x.collection' WHERE id=${run.id}`;await assert.rejects(importXDetailResult(d!.id,{reason:'Wrong producer'},'test',tag()),/received X detail/);
});
test('detail Article guard and existing bound x_search author permissions remain enforced',async()=>{
 const t=tweet(undefined,undefined,'Read https://x.com/i/article/123456'),sid=await source(t.user.userId,'editorial','x_search'),s=await query(t),run=await createTweetQuery({tweetId:t.tweetId,sourceResultId:s.id},'test',tag());respond=()=>({tweetId:t.tweetId,author:{userId:t.user.userId},createdAt:t.createdAt,text:t.text});await step(run.id);const [d]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;valves(false);await assert.rejects(importXDetailResult(d!.id,{sourceId:sid,reason:'Not full Article'},'test',tag()),/Article/);assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${d!.id}`)[0]!.article_id,null);
 await sql`UPDATE sources SET enabled=false WHERE id=${sid}`;await assert.rejects(importXDetailResult(d!.id,{sourceId:sid,reason:'Disabled'},'test',tag()),/disabled/);
});
test('HTTP detail origin/import dispatch allows renamed handle but never changes historical material owner/body',async()=>{
 const t=tweet(),s=await query(t),sid=await source(t.user.userId,'editorial','x_search'),historicalSource=tag();
 await sql`INSERT INTO sources(id,name,kind,config,participation_mode,enabled) VALUES(${historicalSource},'Historical owner','external','{}','isolated',true)`;
 const old=await upsertMaterial({sourceId:historicalSource,via:'import',url:`https://x.com/synthetic_x/status/${t.tweetId}`,identityKey:`x:${t.tweetId}`,title:'Preserved',bodyText:'Full original body',bodyHtml:'<p>Full original body</p>',bodyStatus:'ok',discoveredAt:new Date('2019-01-01T00:00:00Z')});
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic X admin'};
 try{
  const payload={tweetId:t.tweetId,sourceResultId:s.id},headers={'x-csrf-token':'dev','idempotency-key':tag()};
  assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/x/tweets/query',payload})).statusCode,403);
  const response=await app.inject({method:'POST',url:'/api/admin/redfox/x/tweets/query',headers,payload});assert.equal(response.statusCode,202,response.body);assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/x/tweets/query',headers,payload:{...payload,tweetId:id()}})).statusCode,409);
  respond=()=>({tweetId:t.tweetId,author:{userId:t.user.userId,username:'renamed_x'},createdAt:t.createdAt,text:'Short detail'});await step(response.json().runId);assert.equal((await row(response.json().runId)).status,'completed');const [d]=await sql`SELECT * FROM operation_results WHERE run_id=${response.json().runId}`;assert.equal(d!.data.context.username,'renamed_x');
  valves(false);const count=requests.length,importHeaders={...headers,'idempotency-key':tag()},url=`/api/admin/operations/results/${d!.id}/import`;
  const saved=await app.inject({method:'POST',url,headers:importHeaders,payload:{sourceId:sid,reason:'Same stable author'}});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().articleId,old.articleId);assert.equal(requests.length,count);
  const [article]=await sql`SELECT source_id,body_text,body_html,discovered_at FROM articles WHERE id=${old.articleId}`;assert.equal(article!.source_id,historicalSource);assert.equal(article!.body_text,'Full original body');assert.equal(article!.body_html,'<p>Full original body</p>');assert.equal(article!.discovered_at.toISOString(),'2019-01-01T00:00:00.000Z');
  await sql`UPDATE operation_results SET kind='article',data=${sql.json(d!.data.record)} WHERE id=${d!.id}`;
  assert.equal((await app.inject({method:'POST',url,headers:importHeaders,payload:{sourceId:sid,reason:'Legacy same detail'}})).statusCode,200);
  await sql`UPDATE operation_runs SET operation_key='native.x.collection' WHERE id=${d!.run_id}`;
  assert.equal((await app.inject({method:'POST',url,headers:{...headers,'idempotency-key':tag()},payload:{sourceId:sid,reason:'Must not route native article'}})).statusCode,422);
  await sql`UPDATE operation_results SET kind='result_attachment' WHERE id=${d!.id}`;assert.equal((await app.inject({method:'POST',url,headers:{...headers,'idempotency-key':tag()},payload:{sourceId:sid,reason:'Linked attachment is not account'}})).statusCode,422);
  assert.equal((await app.inject({method:'POST',url:'/api/admin/operations/results/2147483647/import',headers:{...headers,'idempotency-key':tag()},payload:{sourceId:sid,reason:'Missing result'}})).statusCode,404);
 }finally{config.devAdmin=null;valves();await app.close();}
});
