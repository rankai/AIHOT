import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {claimRun,resumeRun} from '@aihot/backend/providers/operations/store';
import {importToutiaoResult} from '@aihot/backend/providers/redfox/import-toutiao';
import {createPlatformSubscription,schedulePlatformSubscriptions,collectionProviderOptions} from '@aihot/backend/sources/platform-subscriptions';
import {agentKeyToutiaoOperations,toutiaoArticleRoute,toutiaoCommentsRoute,toutiaoProfileRoute} from '@aihot/backend/providers/agentkey/toutiao-contract';
import {parseAgentKeyToutiao} from '@aihot/backend/providers/agentkey/toutiao-parser';
import {parseLosslessJson} from '@aihot/backend/providers/agentkey/response';
import {agentKeyRouteFor} from '@aihot/backend/providers/agentkey/routes';
import {toutiaoWorkId} from '@aihot/backend/lib/url';
import {config as backendConfig} from '@aihot/backend/config';
import {requestAgentKey} from '@aihot/backend/providers/agentkey/request';
import {stub,tag,assertConfiguredTestDatabase} from './setup.ts';
const group='9876543210123456789',uid='7000000001';
function article(g=group,u=uid){return {message:'success',data:{group_id:g,share_info:{title:'分享标题'},user_info:{user_id:u,name:'作者'},media_info:{user_id:u},itemCell:{articleBase:{gidStr:g},userInfo:{userID:u}},share_url:`https://m.toutiao.com/article/${g}/?source=test`,display_url:`https://www.toutiao.com/group/${g}/`,url:'https://publisher.example/story',context:'{"text":"not body"}',script:'never body',content:'unproved body',publish_time:1700000000}};}
function comments(){return {err_no:0,message:'success',group:{group_id:group},data:Array.from({length:20},(_,i)=>({cell_type:1,comment:{id:String(BigInt(group)+BigInt(i)),id_str:String(BigInt(group)+BigInt(i)),text:'评论 '+i,user_id:uid,user_name:'评论作者',create_time:1700000000,digg_count:0,reply_count:0}})),has_more:true,offset:20,total_number:50};}
const profile={errno:0,message:'success',data:{user_id:uid,name:'',description:'',avatar_url:'',big_avatar_url:'',publish_count:0,digg_count:0,followers_count:0,followings_count:0}};
const response=(body:unknown)=>({httpStatus:200,mcp:{},envelope:{provider:'TikHub',data:{code:200,data:body}}});
let budgets:any[]=[];
before(async()=>{const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);budgets=await sql`SELECT * FROM budgets WHERE service IN ('agentkey.query','agentkey.collect')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('agentkey.query','agentkey.collect')`;});
after(async()=>{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await stopBoss();await closeDb();});
async function withStub(body:unknown,run:(calls:any[])=>Promise<void>){
 const calls:any[]=[];const server=await stub(async(_hit,req)=>{const q=JSON.parse(req.body);if(q.method?.startsWith('notifications/'))return {};if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}};calls.push(q.params.arguments);return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:{provider:'TikHub',credits_charged:.2,data:{code:200,data:body}}}};});
 const previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-toutiao-test-key',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'true',REDFOX_CALLS_ENABLED:'false'});
 try{await run(calls);}finally{await server.close();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
}
async function step(id:number){const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,randomUUID());return (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;}
test('exact contracts, mobile native URL and lossless IDs preserve only proven article facts',()=>{
 assert.equal(agentKeyToutiaoOperations.length,3);assert.equal(toutiaoWorkId(`https://m.toutiao.com/article/${group}/?a=1`),group);
 for(const url of [`http://m.toutiao.com/article/${group}/`,`https://m.toutiao.com/group/${group}/`,`https://m.toutiao.com/article/${group}/#x`,`https://u@m.toutiao.com/article/${group}/`,`https://m.toutiao.com:88/article/${group}/`,`https://evil.example/article/${group}/`])assert.equal(toutiaoWorkId(url),null);
 const raw=JSON.stringify(response(article())).replace(`"group_id":"${group}"`,`"group_id":${group}`);
 const page=parseAgentKeyToutiao(parseLosslessJson(raw),toutiaoArticleRoute,{group_id:group});assert.equal(page.candidates[0]!.data.workId,group);assert.equal(page.candidates[0]!.data.publishedAt,null);assert.deepEqual(page.candidates[0]!.data.record,{workId:group,workUrl:`https://m.toutiao.com/article/${group}/?source=test`,title:'分享标题',authorName:'作者',uid});
 // gidStr is a witnessed string, unlike unsafe numeric group_id.
});
test('contradictions, business errors, unsupported profile shapes and offsets fail closed',()=>{
 const a=article();a.data.media_info.user_id='9';assert.throws(()=>parseAgentKeyToutiao(response(a),toutiaoArticleRoute,{group_id:group}));
 const c=comments();c.data[0]!.comment.id_str='4';assert.throws(()=>parseAgentKeyToutiao(response(c),toutiaoCommentsRoute,{group_id:group}));
 for(const body of [{err_no:10400,data:null},{message:'success',data:null},{...comments(),group:{group_id:'5'}}])assert.throws(()=>parseAgentKeyToutiao(response(body),toutiaoCommentsRoute,{group_id:group}));
 const populated=parseAgentKeyToutiao(response({...profile,data:{...profile.data,name:'离线构造同结构姓名',followers_count:3}}),toutiaoProfileRoute,{user_id:uid});assert.equal(populated.candidates.length,0);assert.equal(populated.summary.profileIsBlank,false);assert.equal((populated.summary.record as Record<string,unknown>).followers_count,3);
 assert.throws(()=>parseAgentKeyToutiao(response({...profile,data:{...profile.data,followers_count:-1}}),toutiaoProfileRoute,{user_id:uid}));
 const p=parseAgentKeyToutiao(response(profile),toutiaoProfileRoute,{user_id:uid});assert.equal(p.candidates.length,0);assert.equal(p.summary.count,0);assert.match(String(p.summary.statusText),/不能据此推断/);
 const empty=parseAgentKeyToutiao(response({...comments(),data:[],has_more:false,offset:0,total_number:0}),toutiaoCommentsRoute,{group_id:group});assert.equal(empty.summary.count,0);assert.deepEqual(empty.summary.pagination,{has_more:false,offset:0,total_number:0});
 assert.throws(()=>agentKeyToutiaoOperations[1].schema.parse({group_id:group,offset:'20'}));assert.equal(agentKeyRouteFor({provider:'agentkey',contract_version:1,operation_key:'agentkey.toutiao.video',step_key:'agentkey.toutiao.video.query',input:{mode:'query'}}),undefined);
 assert.deepEqual(collectionProviderOptions('28CFGF5I').map(p=>p.id),['redfox']);assert.deepEqual(collectionProviderOptions('R1IGR09H').map(p=>p.id),['redfox']);
});
test('three Q routes complete via dispatcher, retain receipt and never bind blank profiles/comments',async()=>{
 for(const [index,body,parameters,kind] of [[0,article(),{group_id:group},'toutiao_work'],[1,comments(),{group_id:group},'social_comment'],[2,profile,{user_id:uid},null]] as const)await withStub(body,async calls=>{
  const op=agentKeyToutiaoOperations[index],run=await createAgentKeyQuery({provider:'agentkey',operationId:op.operationId,parameters},'toutiao-test',tag());assert.equal(run.input.platform,'toutiao');const state=await step(run.id);assert.equal(state.status,'completed',JSON.stringify(state));assert.equal(calls.length,1);assert.equal(calls[0].name,op.route.tool);assert.deepEqual(calls[0].params,op.schema.parse(parameters));
  const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`,summary=rows.find(r=>r.kind==='query_summary')!;const [receipt]=await sql`SELECT status,usage FROM receipts WHERE id=${summary.receipt_id}`;assert.equal(receipt!.status,'completed');assert.equal(receipt!.usage.chargedCredits,.2);
  assert.equal(rows.filter(r=>r.kind!=='query_summary').length,index===1?20:kind?1:0);assert.ok(rows.every(r=>r.source_id===null&&r.article_id===null));
  if(index!==0)await assert.rejects(importToutiaoResult(rows[0]!.id,{reason:'not importable'},'test',tag()));
 });
});
test('article import revalidates receipt, isolates actual uid and deduplicates without body or invented time',async()=>{
 const g=String(Date.now())+'41',u=String(Date.now())+'42';await withStub(article(g,u),async()=>{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'PAB6Z75Y',parameters:{group_id:g}},'test',tag());assert.equal((await step(run.id)).status,'completed');
  const [r]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='toutiao_work'`;
  await assert.rejects(importToutiaoResult(r!.id,{reason:'bad override',supplement:{url:`https://www.toutiao.com/group/1/`,evidence:'manual'}},'test',tag()));
  const imported=await importToutiaoResult(r!.id,{sourceId:await selectedSource(),reason:'test import'},'test',tag());assert.ok(imported?.articleId);
  const [s]=await sql`SELECT participation_mode,site_fulltext,syndicate_fulltext FROM sources WHERE id=${imported!.sourceId}`;assert.deepEqual({...s},{participation_mode:'isolated',site_fulltext:false,syndicate_fulltext:false});
  const [a]=await sql`SELECT published_at,body_status,body_text,backfill,raw FROM articles WHERE id=${imported!.articleId}`;assert.equal(a!.published_at,null);assert.equal(a!.body_status,'pending');assert.equal(a!.body_text,null);assert.equal(a!.backfill,true);assert.equal(a!.raw.provider,'agentkey');
  assert.equal((await importToutiaoResult(r!.id,{sourceId:await selectedSource(),reason:'repeat'},'test',tag()))!.articleId,imported!.articleId);
  const q=await createAgentKeyQuery({provider:'agentkey',operationId:'PAB6Z75Y',parameters:{group_id:g}},'test',tag());await step(q.id);const [r2]=await sql`SELECT * FROM operation_results WHERE run_id=${q.id} AND kind='toutiao_work'`;
  await sql`UPDATE operation_results SET data=jsonb_set(data,'{title}','"forged"') WHERE id=${r2!.id}`;await assert.rejects(importToutiaoResult(r2!.id,{reason:'tamper'},'test',tag()),/differs/);
  await sql`UPDATE operation_results SET data=${sql.json(r2!.data)} WHERE id=${r2!.id}`;assert.equal((await importToutiaoResult(r2!.id,{sourceId:await selectedSource(),reason:'dedup'},'test',tag()))!.articleId,imported!.articleId);
 });
});
test('received mobile article import reuses a pre-upgrade URL row and preserves its source history',async()=>{
 const g=String(Date.now())+'51',u=String(Date.now())+'52',oldSource=`legacy-tt-${tag()}`,oldId=randomUUID(),url=`https://m.toutiao.com/article/${g}`;
 // Reproduce the old persisted identity explicitly; do not pass the fixture through today's resolver.
 await sql.begin(async tx=>{
  await tx`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext,syndicate_fulltext) VALUES (${oldSource},'Legacy mobile source','external','isolated',false,false)`;
  await tx`INSERT INTO articles(id,source_id,identity_key,url,title,body_text,body_status,revision,discovered_at,timeline_at) VALUES (${oldId},${oldSource},${`url:${url}`},${url},'Legacy title','Legacy body','ok',1,now(),now())`;
  await tx`INSERT INTO article_revisions(article_id,revision,content_hash,title,body_text) VALUES (${oldId},1,'legacy-mobile-fixture','Legacy title','Legacy body')`;
 });
 await withStub(article(g,u),async calls=>{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'PAB6Z75Y',parameters:{group_id:g}},'test',tag());assert.equal((await step(run.id)).status,'completed');
  const [r]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='toutiao_work'`;
  process.env.AGENTKEY_CALLS_ENABLED='false';
  const imported=await importToutiaoResult(r!.id,{sourceId:await selectedSource(),reason:'legacy mobile import'},'test',tag());assert.equal(imported!.articleId,oldId);
  const [a]=await sql`SELECT identity_key,url,source_id,title,body_text,revision FROM articles WHERE id=${oldId}`;
  assert.deepEqual({...a},{identity_key:`url:${url}`,url,source_id:oldSource,title:'Legacy title',body_text:'Legacy body',revision:1});
  const [s]=await sql`SELECT participation_mode,site_fulltext,syndicate_fulltext FROM sources WHERE id=${oldSource}`;assert.deepEqual({...s},{participation_mode:'isolated',site_fulltext:false,syndicate_fulltext:false});
  assert.equal((await sql`SELECT 1 FROM article_revisions WHERE article_id=${oldId}`).length,1);
  assert.equal((await sql`SELECT 1 FROM article_discoveries WHERE article_id=${oldId} AND source_id=${imported!.sourceId}`).length,1);
  assert.equal((await importToutiaoResult(r!.id,{sourceId:await selectedSource(),reason:'repeat legacy import'},'test',tag()))!.articleId,oldId);assert.equal(calls.length,1);
 });
});
test('comments S is one homepage, respects item limit, releases active subscription and schedules next round',async()=>{
 await withStub(comments(),async calls=>{
 const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:'头条评论快照',provider:'agentkey',operationId:'toutiao.comments',parameters:{group_id:group},enabled:true,limits:{pages:9,items:3,details:9}},'test',tag());
 try{await schedulePlatformSubscriptions();const [s]=await sql`SELECT active_run_id,limits FROM collection_subscriptions WHERE id=${sub.id}`;assert.deepEqual(s!.limits,{pages:1,items:3,details:0});const state=await step(s!.active_run_id);assert.equal(state.status,'completed',JSON.stringify(state));assert.equal(calls.length,1);
 const [done]=await sql`SELECT active_run_id,next_run_at>now() AS scheduled FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(done!.active_run_id,null);assert.equal(done!.scheduled,true);
 const rows=await sql`SELECT * FROM operation_results WHERE run_id=${state.id}`,summary=rows.find(r=>r.kind==='query_summary')!;assert.equal(summary.data.count,20);assert.equal(summary.data.selectedCount,3);assert.equal(summary.data.unprocessedDueToLimit,17);assert.equal(summary.data.nextParameters,null);assert.equal(summary.data.stopReason,'single-request');assert.deepEqual(summary.data.returnedPage,{has_more:true,offset:20,total_number:50});assert.ok(rows.every(r=>r.source_id===null&&r.article_id===null));
 const bindings=await sql`SELECT id_value FROM source_account_bindings WHERE evidence->>'reference' IN ${sql(rows.map(r=>String(r.id)))}`;assert.equal(bindings.length,0);
 }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
 });
 for(const operationId of ['PAB6Z75Y','toutiao.account_profile','toutiao.video'])await assert.rejects(createPlatformSubscription({sourceId:await selectedSource(),name:'invalid',provider:'agentkey',operationId,parameters:{}},'test',tag()));
 await assert.rejects(createPlatformSubscription({sourceId:await selectedSource(),name:'invalid',provider:'agentkey',operationId:'toutiao.comments',parameters:{group_id:group,offset:'20'}},'test',tag()));
});
test('unknown scope retains received evidence; local resume with valves closed never repurchases',async()=>{
 await withStub({...comments(),group:{group_id:'1'}},async calls=>{
 const run=await createAgentKeyQuery({provider:'agentkey',operationId:'toutiao.comments',parameters:{group_id:group}},'test',tag());const failed=await step(run.id);assert.equal(failed.status,'needs_review');assert.equal((await sql`SELECT status FROM receipts WHERE id=${failed.current_receipt_id}`)[0]!.status,'received');
 process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:failed.step_version,generation:failed.generation}));assert.equal((await step(run.id)).status,'needs_review');assert.equal(calls.length,1);
 });
});

test('received success completes locally after interruption with both outbound valves closed',async()=>{
 await withStub(article(),async calls=>{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'PAB6Z75Y',parameters:{group_id:group}},'test',tag());
  const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));
  await requestAgentKey(execution,run,toutiaoArticleRoute,{group_id:group});
  assert.equal((await sql`SELECT status FROM receipts WHERE subject=${`operation:${run.id}`}`)[0]!.status,'received');
  assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);
  process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';
  assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);
 });
});
test('admin API advertises exact variants and freezes accepted query through completed result',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),previous=backendConfig.devAdmin;
 backendConfig.devAdmin={displayName:'Toutiao synthetic API'};
 const headers={'x-csrf-token':'dev','idempotency-key':tag()};
 try{
  const options=await app.inject({method:'GET',url:'/api/admin/redfox/operations'});assert.equal(options.statusCode,200,options.body);
  const ops=options.json() as any[];assert.deepEqual(ops.find(o=>o.id==='PAB6Z75Y').collectionProviders.map((p:any)=>p.id),['redfox','agentkey']);assert.deepEqual(ops.find(o=>o.id==='toutiao.comments').collectionProviders.map((p:any)=>p.id),['agentkey']);assert.equal(ops.some(o=>o.id==='toutiao.video'),false);assert.equal(ops.find(o=>o.id==='toutiao.comments').schedulableType,'list');assert.equal(ops.find(o=>o.id==='toutiao.account_profile').schedulableType,null);
  await withStub(profile,async calls=>{const reply=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload:{provider:'agentkey',operationId:'toutiao.account_profile',parameters:{user_id:uid}}});assert.equal(reply.statusCode,202,reply.body);assert.equal((await step(reply.json().runId)).status,'completed');assert.equal(calls.length,1);});
  for(const parameters of [{group_id:group,offset:'20'},{group_id:group,offset:0}]){const reply=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers:{...headers,'idempotency-key':tag()},payload:{provider:'agentkey',operationId:'toutiao.comments',parameters}});assert.equal(reply.statusCode,400,reply.body);}
 }finally{backendConfig.devAdmin=previous;await app.close();}
});

const chosenWorkSource=tag();
async function selectedSource(){await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext,syndicate_fulltext) VALUES (${chosenWorkSource},'Synthetic chosen source','external','isolated',false,false) ON CONFLICT(id) DO NOTHING`;return chosenWorkSource;}
