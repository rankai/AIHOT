import {randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {agentKeyOperation,agentKeyRouteInput} from '@aihot/backend/providers/agentkey/routes';
import {AgentKeyPayloadError, executeDouyinSearch} from '@aihot/backend/providers/agentkey/douyin-search';
import {executeAgentKeyToutiao} from '@aihot/backend/providers/agentkey/toutiao-execution';
import {executeAgentKeyWechat} from '@aihot/backend/providers/agentkey/wechat-execution';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {claimRun,receiptOptions} from '@aihot/backend/providers/operations/store';
import {paidRequest} from '@aihot/backend/providers/receipts';
import {assertConfiguredTestDatabase,tag} from './setup.ts';

const actor=`agentkey-local-429-${tag()}`;
let budgets:Array<{service:string;per_minute:number;per_hour:number;per_day:number}>=[];const runIds:number[]=[];

before(async()=>{
 const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;
 assertConfiguredTestDatabase(db!.name,db!.port);
 budgets=await sql`SELECT service,per_minute,per_hour,per_day FROM budgets WHERE service IN ('agentkey.query','agentkey.collect')`;
 await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('agentkey.query','agentkey.collect')`;
});

after(async()=>{
 await sql`UPDATE operation_runs SET status='stopped',next_attempt_at=NULL WHERE actor=${actor} AND status IN ('active','waiting','needs_review')`;
 for(const budget of budgets)await sql`UPDATE budgets SET per_minute=${budget.per_minute},per_hour=${budget.per_hour},per_day=${budget.per_day} WHERE service=${budget.service}`;
 await stopBoss();
 await closeDb();
});

test('local received 429 recovery uses the shared retry classification on all seven platforms',async()=>{
const cases=[
 {platform:'抖音',operationId:'OWIBYU1V',parameters:{keyword:'local rate limit'}},
 {platform:'今日头条',operationId:'PAB6Z75Y',parameters:{group_id:'9876543210123456789'}},
 {platform:'小红书',operationId:'384C6W6B',parameters:{keyword:'local rate limit'}},
 {platform:'B站',operationId:'TIN1NMTZ',parameters:{av_id:'876543210'}},
 {platform:'微博',operationId:'TXQPVGJG',parameters:{query:'local rate limit'}},
 {platform:'X',operationId:'x.detail',parameters:{tweet_id:'9876543210123456789'}},
 {platform:'公众号',operationId:'8IQD0BJC',parameters:{username:'gh_local_rate_limit'}},
] as const;
const previous=process.env.AGENTKEY_CALLS_ENABLED;
process.env.AGENTKEY_CALLS_ENABLED='false';
try{
 for(const item of cases){
  const operation=agentKeyOperation(item.operationId)!;
  const params=agentKeyRouteInput(operation.route,item.parameters);
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:item.operationId,parameters:item.parameters},actor,tag());
  runIds.push(run.id);
  const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));
  const endpoint='http://127.0.0.1:10000/v1/mcp';
  await paidRequest({
   service:'agentkey.query',purpose:operation.route.operationKey,model:operation.route.tool,
   subject:`operation:${run.id}`,
   identity:{runId:run.id,stepVersion:run.step_version,endpoint,contractVersion:operation.route.contractVersion,
    tool:operation.route.tool,params},
   estimatedUsage:{estimatedCredits:operation.route.estimatedCredits},
   requestSummary:{tool:operation.route.tool,endpoint,params},
  },async()=>({response:{httpStatus:429,mcp:{},envelope:{error:'rate_limited'},retryAfter:'7'}}),receiptOptions(execution));

  const result=await executeOperationStep(run.id,run.step_version,randomUUID());
  assert.match(String(result.error),/rate limited/,item.platform);
  const [state]=await sql`SELECT status,retry_count,next_attempt_at,current_receipt_id,step_version FROM operation_runs WHERE id=${run.id}`;
  assert.equal(state!.status,'waiting',item.platform);
  assert.equal(state!.retry_count,1,item.platform);
  assert.equal(state!.step_version,run.step_version,item.platform);
  assert.ok(state!.next_attempt_at.getTime()>Date.now()+5_000,item.platform);
  const [receipt]=await sql`SELECT status,attempts,response FROM receipts WHERE id=${state!.current_receipt_id}`;
  assert.equal(receipt!.status,'failed',item.platform);
  assert.equal(receipt!.attempts,1,item.platform);
  assert.equal(receipt!.response,null,item.platform);
  const [attempt]=await sql`SELECT status,response FROM receipt_attempts WHERE receipt_id=${state!.current_receipt_id} AND attempt=1`;
  assert.equal(attempt!.status,'failed',item.platform);
  assert.equal(attempt!.response.httpStatus,429,item.platform);
  assert.equal(attempt!.response.retryAfter,'7',item.platform);
 }
}finally{
 if(previous===undefined)delete process.env.AGENTKEY_CALLS_ENABLED;
 else process.env.AGENTKEY_CALLS_ENABLED=previous;
}
});

test('local Douyin 429 refuses a receipt associated with another route',async()=>{
 const previous=process.env.AGENTKEY_CALLS_ENABLED;
 process.env.AGENTKEY_CALLS_ENABLED='false';
 try{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'OWIBYU1V',parameters:{keyword:'wrong route'}},actor,tag());
  runIds.push(run.id);
  const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));
  const endpoint='http://127.0.0.1:10000/v1/mcp';
  await paidRequest({
   service:'agentkey.query',purpose:'agentkey.other.query',model:'TikHub/other',
   subject:`operation:${run.id}`,identity:{runId:run.id,stepVersion:run.step_version,endpoint},
  },async()=>({response:{httpStatus:429,mcp:{},envelope:{error:'rate_limited'},retryAfter:'7'}}),receiptOptions(execution));
  const [before]=await sql`SELECT id,status,attempts FROM receipts WHERE subject=${`operation:${run.id}`}`;

  await assert.rejects(executeDouyinSearch(execution),AgentKeyPayloadError);

  const [after]=await sql`SELECT status,attempts FROM receipts WHERE id=${before!.id}`;
  const [state]=await sql`SELECT status,retry_count,next_attempt_at FROM operation_runs WHERE id=${run.id}`;
  assert.deepEqual({...after},{status:'received',attempts:1});
  assert.deepEqual({...state},{status:'active',retry_count:0,next_attempt_at:null});
 }finally{
  if(previous===undefined)delete process.env.AGENTKEY_CALLS_ENABLED;
  else process.env.AGENTKEY_CALLS_ENABLED=previous;
 }
});

test('local 429 recovery requires the full frozen request identity for Douyin, Toutiao and WeChat',async()=>{
 const previous=process.env.AGENTKEY_CALLS_ENABLED;
 process.env.AGENTKEY_CALLS_ENABLED='false';
 const cases=[
  {platform:'抖音',operationId:'OWIBYU1V',parameters:{keyword:'full identity'},execute:executeDouyinSearch},
  {platform:'今日头条',operationId:'PAB6Z75Y',parameters:{group_id:'9876543210123456789'},execute:executeAgentKeyToutiao},
  {platform:'公众号',operationId:'8IQD0BJC',parameters:{username:'gh_full_identity'},execute:executeAgentKeyWechat},
 ] as const;
 try{
  for(const item of cases){
   const operation=agentKeyOperation(item.operationId)!;
   const params=agentKeyRouteInput(operation.route,item.parameters);
   for(const mismatch of ['subject','params'] as const){
    const run=await createAgentKeyQuery({provider:'agentkey',operationId:item.operationId,parameters:item.parameters},actor,tag());
    runIds.push(run.id);
    const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));
    const endpoint='http://127.0.0.1:10000/v1/mcp',requestedParams=mismatch==='params'?{...params,page:99}:params;
    await paidRequest({
     service:'agentkey.query',purpose:operation.route.operationKey,model:operation.route.tool,
     subject:mismatch==='subject'?'operation:another-run':`operation:${run.id}`,
     identity:{runId:run.id,stepVersion:run.step_version,endpoint,contractVersion:operation.route.contractVersion,
      tool:operation.route.tool,params:requestedParams},
     requestSummary:{tool:operation.route.tool,endpoint,params:requestedParams},
    },async()=>({response:{httpStatus:429,mcp:{},envelope:{error:'rate_limited'},retryAfter:'7'}}),receiptOptions(execution));
    const [held]=await sql`SELECT current_receipt_id FROM operation_runs WHERE id=${run.id}`;
    const [before]=await sql`SELECT id,status,attempts FROM receipts WHERE id=${held!.current_receipt_id}`;

    await assert.rejects(item.execute(execution),AgentKeyPayloadError,`${item.platform} ${mismatch}`);

    const [after]=await sql`SELECT status,attempts FROM receipts WHERE id=${before!.id}`;
    const [state]=await sql`SELECT status,retry_count,next_attempt_at FROM operation_runs WHERE id=${run.id}`;
    assert.deepEqual({...after},{status:'received',attempts:1},`${item.platform} ${mismatch}`);
    assert.deepEqual({...state},{status:'active',retry_count:0,next_attempt_at:null},`${item.platform} ${mismatch}`);
   }
  }
 }finally{
  if(previous===undefined)delete process.env.AGENTKEY_CALLS_ENABLED;
  else process.env.AGENTKEY_CALLS_ENABLED=previous;
 }
});
