import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {updateSource} from '@aihot/backend/admin/sources';
import {createNativeSubscription} from '@aihot/backend/sources/native-migration';
import {preflightMpReplacement,switchMpCollection} from '@aihot/backend/sources/mp-replacement';
import {createCollection} from '@aihot/backend/sources/collection-commands';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {wechatArticlesRoute} from '@aihot/backend/providers/agentkey/wechat-contract';
import {requestAgentKey} from '@aihot/backend/providers/agentkey/request';
import {importWechatResult} from '@aihot/backend/providers/redfox/import-wechat';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {recoverOperations,governedReceipt,releaseOperationReceipt} from '@aihot/backend/providers/operations/recovery';
import {abandonRun,claimRun,requireExecution,receiptOptions,setRunState,StaleOperationError,type RunRow} from '@aihot/backend/providers/operations/store';
import {paidRequest} from '@aihot/backend/providers/receipts';
import {getBoss,stopBoss,QUEUES} from '@aihot/backend/jobs/queue';
import {assertConfiguredTestDatabase,stub,tag} from './setup.ts';

const actor=`mp-closeout-${tag()}`,sourceIds:string[]=[];
const originalEnv={...process.env};
let server:Awaited<ReturnType<typeof stub>>,calls=0,cursor:unknown;
let budgets:Array<{service:string;per_minute:number;per_hour:number;per_day:number}>=[];
const row=async(id:number)=>(await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
before(async()=>{
 const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;
 assertConfiguredTestDatabase(db!.name,db!.port);
 cursor=(await sql`SELECT value FROM settings WHERE key='operations.recovery-cursor'`)[0]?.value;
 budgets=await sql`SELECT service,per_minute,per_hour,per_day FROM budgets WHERE service IN ('agentkey.query','agentkey.collect')`;
 await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('agentkey.query','agentkey.collect')`;
 server=await stub((_hit,request)=>{
  const q=JSON.parse(request.body);
  if(q.method?.startsWith('notifications/'))return {};
  if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'closeout-stub',version:'1'}}};
  calls++;
  const args=q.params.arguments;
  const data=args.name===wechatArticlesRoute.tool
   ?{biz_username:args.params.username,count:0,is_end:1,next_offset:null,articles:[]}
   :{user_name:args.params.username,nick_name:'Synthetic closeout account'};
  return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:{provider:'TikHub',credits_charged:2,data:{code:200,data}}}};
 });
 Object.assign(process.env,{AGENTKEY_API_KEY:'fake-closeout-only',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'true'});
});
after(async()=>{
 try{
  for(const run of await sql<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND status NOT IN ('completed','failed')`)
   await sql.begin(tx=>abandonRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},'Synthetic test cleanup'));
  const jobs=await sql`SELECT id,name FROM pgboss.job WHERE state IN ('created','retry','active') AND (
   (name=${QUEUES.operation} AND data->>'runId' IN (SELECT id::text FROM operation_runs WHERE actor=${actor}))
   OR (name=${QUEUES.republishSource} AND data->>'sourceId' IN ${sql(sourceIds.length?sourceIds:['unused'])}))`;
  for(const job of jobs)await(await getBoss()).cancel(job.name,job.id);
  if(sourceIds.length){await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE control_source_id IN ${sql(sourceIds)}`;await sql`UPDATE sources SET enabled=false WHERE id IN ${sql(sourceIds)}`;}
  for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;
  if(cursor===undefined)await sql`DELETE FROM settings WHERE key='operations.recovery-cursor'`;
  else await sql`UPDATE settings SET value=${sql.json(cursor as never)} WHERE key='operations.recovery-cursor'`;
 }finally{
  if(server)await server.close();await stopBoss();await closeDb();
  for(const k of Object.keys(process.env))if(!(k in originalEnv))delete process.env[k];Object.assign(process.env,originalEnv);
 }
});

async function sourceSubscription(){
 const suffix=tag(),id=`closeout-${suffix}`,username=`gh_${suffix}`;sourceIds.push(id);
 const sub=await sql.begin(async tx=>{
  await tx`INSERT INTO sources(id,name,kind,config,participation_mode) VALUES (${id},'Synthetic closeout','mp_account',${tx.json({ghid:username})},'isolated')`;
  return createNativeSubscription(tx,id);
 });
 const profile=await createAgentKeyQuery({provider:'agentkey',operationId:'KUQYSQNX',parameters:{username}},actor,tag());
 await executeOperationStep(profile.id,profile.step_version,randomUUID());
 const [result]=await sql`SELECT id FROM operation_results WHERE run_id=${profile.id} AND kind='wechat_account'`;
 assert.ok(result);await importWechatResult(result.id,{sourceId:id,reason:'Received fixture account'},actor,tag());
 const preview=await preflightMpReplacement(id,'agentkey');assert.equal(preview!.supported,true,JSON.stringify(preview!.checks));
 await switchMpCollection(id,{target:'agentkey',sourceVersion:preview!.sourceVersion,subscriptionVersion:preview!.subscriptionVersion,mappingVersion:preview!.mappingVersion,reason:'Synthetic test'},actor);
 return {id,sub};
}

for(const [mode,patch] of [
 ['active',{tier:'T1'}],['waiting-unknown',{site_fulltext:true}],['received',{participation_mode:'editorial'}],
] as const)test(`permission change closes ${mode} MP primary run, releases occupancy and keeps original evidence`,async()=>{
 process.env.AGENTKEY_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';
 const {id,sub}=await sourceSubscription();
 const run=await createCollection(id,{actor,key:tag(),reason:'manual'});
 const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));
 const current=await row(run.id);
 if(mode==='waiting-unknown'){
  await assert.rejects(paidRequest({service:'agentkey.collect',purpose:wechatArticlesRoute.operationKey,model:wechatArticlesRoute.tool,
   subject:`operation:${run.id}`,identity:{runId:run.id,stepVersion:run.step_version,synthetic:tag()}},async()=>{throw new Error('Synthetic incomplete answer');},receiptOptions(execution)),/Synthetic incomplete/);
  await sql.begin(tx=>setRunState(tx,execution,'waiting','Synthetic unknown waiting',new Date(Date.now()+30*60_000)));
 }else if(mode==='received')await requestAgentKey(execution,current,wechatArticlesRoute,current.input.parameters as Record<string,unknown>);
 const before=await row(run.id),[source]=await sql`SELECT updated_at FROM sources WHERE id=${id}`;
 const receipts=before.current_receipt_id?await sql`SELECT id,status,attempts,usage FROM receipts WHERE id=${before.current_receipt_id}`:[];
 await updateSource(id,{patch,version:new Date(source!.updated_at).toISOString(),reason:'Synthetic permission edit'},actor);
 await assert.rejects(sql.begin(tx=>requireExecution(tx,execution)),StaleOperationError);
 process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';
 const countBefore=calls;
 await sql`INSERT INTO settings(key,value,updated_by) VALUES ('operations.recovery-cursor',${sql.json(run.id-1)},${actor}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
 await recoverOperations();
 assert.equal((await row(run.id)).status,'stopped');
 assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub}`)[0]!.active_run_id,null);
 assert.equal(calls,countBefore,'local closeout must not dispatch');
 if(before.current_receipt_id){
  assert.deepEqual(await sql`SELECT id,status,attempts,usage FROM receipts WHERE id=${before.current_receipt_id}`,receipts);
  assert.equal((await sql`SELECT ${governedReceipt(before.current_receipt_id)} AS protected`)[0]!.protected,true);
  assert.equal((await releaseOperationReceipt(before.current_receipt_id)).released,false);
 }
 assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);
 await executeOperationStep(run.id,run.step_version,randomUUID());assert.equal(calls,countBefore,'stale execution cannot consume retained evidence');
 const next=await createCollection(id,{actor,key:tag(),reason:'manual'});
 assert.notEqual(next.id,run.id);assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub}`)[0]!.active_run_id,next.id);
 await recoverOperations();
 assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub}`)[0]!.active_run_id,next.id,'old closeout must not clear new occupancy');
 assert.equal(calls,countBefore);
});
