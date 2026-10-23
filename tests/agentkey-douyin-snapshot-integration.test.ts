import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {resumeRun} from '@aihot/backend/providers/operations/store';
import {importDouyinResult} from '@aihot/backend/providers/redfox/import-douyin';
import {createPlatformSubscription,schedulePlatformSubscriptions} from '@aihot/backend/sources/platform-subscriptions';
import {douyinSnapshotOperations} from '@aihot/backend/providers/agentkey/douyin-contract';
import {stub,tag,assertConfiguredTestDatabase} from './setup.ts';
let budgets:any[]=[];
before(async()=>{
 const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
 budgets=await sql`SELECT * FROM budgets WHERE service IN ('agentkey.query','agentkey.collect')`;
 await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('agentkey.query','agentkey.collect')`;
});
after(async()=>{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await stopBoss();await closeDb();});
async function mcp(body:unknown){
 const calls:Array<{name:string;params:Record<string,unknown>}>=[];
 const server=await stub(async(_hit,req)=>{const q=JSON.parse(req.body);if(q.method?.startsWith('notifications/'))return {};if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}};
 calls.push(q.params.arguments);return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:{provider:'TikHub',credits_charged:.37,data:{code:200,data:typeof body==='function'?body(q.params.arguments):body}}}};});
 return {...server,calls};
}
async function withStub(body:unknown,run:(server:Awaited<ReturnType<typeof mcp>>)=>Promise<void>){
 const server=await mcp(body),previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-douyin-snapshot-key',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'true',REDFOX_CALLS_ENABLED:'false'});
 try{await run(server);}finally{await server.close();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
}
async function step(id:number){const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,randomUUID());return (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;}
const user={uid:'8000000001',sec_uid:'synthetic-safe',nickname:'测试',signature:'简介',follower_count:12,following_count:2};
const scenarios=[
 {id:'douyin.trending',parameters:{},body:{data:{word_list:[{word:'热点',sentence_id:'123',hot_value:25}]}},kind:'hotspot_research'},
 {id:'douyin.comments',parameters:{aweme_id:'987'},body:{comments:[{cid:'999',text:'评论',aweme_id:'987',comment_token:'must-redact'}]},kind:'social_comment'},
 {id:'douyin.comment_replies',parameters:{item_id:'987',comment_id:'111'},body:{comments:[{cid:'999',text:'回复',aweme_id:'987',reply_id:'111'}]},kind:'social_comment'},
 {id:'douyin.topic_posts',parameters:{ch_id:'444'},body:{aweme_list:[],mix_list:[{type:1,aweme_info:{aweme_id:'987',desc:'说明',author:user,create_time:1700000000}}]},kind:'douyin_work'},
 {id:'douyin.following',parameters:{sec_user_id:'synthetic-safe'},body:{followings:Array.from({length:19},()=>user),max_time:12,has_more:true},kind:'social_followee'},
 {id:'XUT4CECZ',parameters:{sec_user_id:'synthetic-safe'},body:{user:{uid:'123',nickname:'已注销',user_deleted:true}},kind:null},
];
test('six dispatcher Q routes freeze exact input, retain actual charge and persist completed summary/candidates',async()=>{
 for(const scenario of scenarios)await withStub({status_code:0,...scenario.body},async server=>{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:scenario.id,parameters:scenario.parameters},'douyin-snapshot-test',tag());
  const state=await step(run.id);assert.equal(state.status,'completed',JSON.stringify(state));assert.equal(server.calls.length,1);
  const op=douyinSnapshotOperations.find(o=>o.operationId===scenario.id)!;assert.equal(server.calls[0]!.name,op.route.tool);assert.deepEqual(server.calls[0]!.params,op.schema.parse(scenario.parameters));
  const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;const summary=rows.find(r=>r.kind==='query_summary')!;assert.equal(summary.data.snapshot,true);assert.equal(summary.data.stopReason,'single-request');
  assert.equal(rows.filter(r=>r.kind!=='query_summary').length,scenario.id==='douyin.following'?19:scenario.kind?1:0);
  if(scenario.kind)assert.equal(rows.find(r=>r.kind!=='query_summary')!.kind,scenario.kind);
  const [receipt]=await sql`SELECT status,usage,response FROM receipts WHERE id=${summary.receipt_id}`;assert.equal(receipt!.status,'completed');assert.equal(receipt!.usage.chargedCredits,.37);assert.equal(JSON.stringify(receipt!.response).includes('must-redact'),false);
  if(scenario.id==='XUT4CECZ'){assert.equal(summary.data.accountState,'deleted');await assert.rejects(importDouyinResult(summary.id,{reason:'must not bind'},'test',tag()),/Not an importable/);}
  else if(scenario.kind!=='douyin_work')await assert.rejects(importDouyinResult(rows.find(r=>r.kind!=='query_summary')!.id,{reason:'must not import'},'test',tag()),/Not an importable/);
 });
});
test('received malformed scope stays reviewable and local retry with valves off never repurchases',async()=>{
 await withStub({status_code:0,comments:[{cid:'999',text:'bad scope',aweme_id:'123'}]},async server=>{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'douyin.comments',parameters:{aweme_id:'987'}},'douyin-snapshot-test',tag());
  const failed=await step(run.id);assert.equal(failed.status,'needs_review');
  const [receipt]=await sql`SELECT status FROM receipts WHERE id=${failed.current_receipt_id}`;assert.equal(receipt!.status,'received');assert.equal(server.calls.length,1);
  process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';
  await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:failed.step_version,generation:failed.generation}));
  assert.equal((await step(run.id)).status,'needs_review');assert.equal(server.calls.length,1);
  assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);
 });
});
test('scheduled research snapshots finish one request with no material/binding and release subscription',async()=>{
 for(const scenario of scenarios.filter(s=>s.kind&&s.kind!=='douyin_work'))await withStub({status_code:0,...scenario.body},async server=>{
  const sub=await createPlatformSubscription({name:'研究单页快照',provider:'agentkey',operationId:scenario.id,parameters:scenario.parameters,enabled:true,limits:{pages:9,items:10,details:8}},'douyin-snapshot-test',tag());
  try{
   assert.ok(await schedulePlatformSubscriptions()>=1);
   const [s]=await sql`SELECT active_run_id,limits FROM collection_subscriptions WHERE id=${sub.id}`;assert.ok(s!.active_run_id);assert.deepEqual(s!.limits,{pages:1,items:10,details:0});
   const state=await step(s!.active_run_id);assert.equal(state.status,'completed',JSON.stringify(state));assert.equal(server.calls.length,1);
   const [done]=await sql`SELECT active_run_id,next_run_at>now() AS scheduled,progress FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(done!.active_run_id,null);assert.equal(done!.scheduled,true);assert.equal(done!.progress.stopReason,'single-request');
   const rows=await sql`SELECT * FROM operation_results WHERE run_id=${state.id}`;assert.ok(rows.every(r=>r.source_id===null&&r.article_id===null));
   const summary=rows.find(r=>r.kind==='query_summary')!;assert.equal(summary.data.nextParameters,null);assert.equal(summary.data.selectedCount,scenario.id==='douyin.following'?10:1);
   const bindings=await sql`SELECT id_value FROM source_account_bindings WHERE evidence->>'reference' IN ${sql(rows.map(r=>String(r.id)))}`;assert.equal(bindings.length,0);
  }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
 });
});
test('scheduled topic imports isolated native works once, preserves discovery and unknown-time backfill',async()=>{
 const id=String(Date.now())+'55',uid=String(Date.now())+'66',author={uid,sec_uid:'topic-'+tag(),nickname:'Topic author'};
 await withStub({status_code:0,aweme_list:[],mix_list:[{type:1,aweme_info:{aweme_id:id,desc:'Description, not transcript',create_time:1700000000,share_url:'https://v.douyin.com/test/',author}}],has_more:1,cursor:10},async server=>{
  const sub=await createPlatformSubscription({name:'话题单页',provider:'agentkey',operationId:'douyin.topic_posts',parameters:{ch_id:'444'},enabled:true},'douyin-snapshot-test',tag());
  try{
   await schedulePlatformSubscriptions();const [s]=await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub.id}`;const state=await step(s!.active_run_id);assert.equal(state.status,'completed',JSON.stringify(state));assert.equal(server.calls.length,1);
   const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${state.id} AND kind='douyin_work'`;assert.ok(result!.article_id);assert.ok(result!.source_id);
   const [source]=await sql`SELECT participation_mode,site_fulltext,syndicate_fulltext FROM sources WHERE id=${result!.source_id}`;assert.equal(source!.participation_mode,'isolated');assert.equal(source!.site_fulltext,false);assert.equal(source!.syndicate_fulltext,false);
   const [article]=await sql`SELECT published_at,discovered_at,backfill,url FROM articles WHERE id=${result!.article_id}`;assert.equal(article!.published_at,null);assert.equal(article!.backfill,true);assert.equal(article!.url,`https://www.douyin.com/video/${id}`);
   const again=await importDouyinResult(result!.id,{reason:'idempotence'},'test',tag());assert.equal(again!.articleId,result!.article_id);
   const q=await createAgentKeyQuery({provider:'agentkey',operationId:'douyin.topic_posts',parameters:{ch_id:'444'}},'douyin-snapshot-test',tag());await step(q.id);const [r]=await sql`SELECT id FROM operation_results WHERE run_id=${q.id} AND kind='douyin_work'`;const duplicate=await importDouyinResult(r!.id,{reason:'URL dedup'},'test',tag());assert.equal(duplicate!.articleId,result!.article_id);
   const [after]=await sql`SELECT discovered_at FROM articles WHERE id=${result!.article_id}`;assert.equal(after!.discovered_at.toISOString(),article!.discovered_at.toISOString());
  }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
 });
});
test('unsupported modes, followers and snapshot enrichment fail before paid requests',async()=>{
 await assert.rejects(createAgentKeyQuery({provider:'agentkey',operationId:'douyin.followers',parameters:{}},'test',tag()));
 for(const operationId of ['XUT4CECZ','douyin.comments'])await assert.rejects(createPlatformSubscription({name:'invalid',provider:'agentkey',operationId,parameters:operationId==='XUT4CECZ'?{sec_user_id:'x'}:{aweme_id:'987'},enrichDetails:true,detailOperationId:'FK67XDVQ'},'test',tag()));
 await assert.rejects(createPlatformSubscription({name:'invalid',provider:'redfox',operationId:'douyin.comments',parameters:{aweme_id:'987'}},'test',tag()));
});
