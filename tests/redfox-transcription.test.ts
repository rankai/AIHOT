import { tag, allowTestBudgetScope } from './setup.ts';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import http from 'node:http';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { getBoss, stopBoss, QUEUES } from '@aihot/backend/jobs/queue';
import { createTranscription, createTranscriptionQuery, parseTranscriptionPoll, pollTranscription } from '@aihot/backend/providers/redfox/transcription';
import { transcriptionPairs, transcriptionPaths } from '@aihot/backend/providers/redfox/transcription-contract';
import { executeOperationStep } from '@aihot/backend/providers/operations/execute';
import { recoverOperations, releaseOperationReceipt } from '@aihot/backend/providers/operations/recovery';
import { abandonRun, resumeRun, claimRun, receiptOptions } from '@aihot/backend/providers/operations/store';
let mode='success'; const calls:Array<{path:string;body:Record<string,string>}> = [], runs:number[]=[];
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  assert.equal(req.method,'POST');assert.equal(req.headers.redfox_api_key,'synthetic-asr-key');
  const input=JSON.parse(body);calls.push({path:req.url!,body:input});
  if(mode==='disconnect'){req.socket.destroy();return;}
  res.setHeader('content-type','application/json');
  if(mode==='invalid'){res.end('{"code":2000,//broken');return;}
  const data=input.url?{taskId:'task-'+calls.length}:['processing','asr_processing','running'].includes(mode)?{status:mode,taskId:input.taskId}:mode==='failed'?{status:'failed',failReason:null}:mode==='wrong'?{status:'succeeded',taskId:'wrong',text:'Synthetic'}:{status:'succeeded',taskId:input.taskId,text:'Synthetic transcript',stampSents:[{textSeg:'Synthetic transcript',start:0,end:1500}],failReason:null};
  res.end(JSON.stringify({code:2000,data}));
});});
let budgets:any[]=[];let restoreAdminScope:()=>Promise<void>=async()=>{};
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='synthetic-asr-key';process.env.REDFOX_CALLS_ENABLED='true';process.env.MODEL_CALLS_ENABLED='false';config.allowPrivateNetworkFetch=true;
 budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.transcript','redfox.poll')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.transcript','redfox.poll')`;
 restoreAdminScope=await allowTestBudgetScope(['redfox.transcript','redfox.poll'],'admin');
});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
after(async()=>{for(const id of runs){const r=await row(id);if(!['completed','failed'].includes(r.status))await sql.begin(tx=>abandonRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation},'synthetic cleanup'));}for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await restoreAdminScope();await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
async function query(){const r=await createTranscriptionQuery({platform:'douyin',taskId:tag()},'asr-test',tag());runs.push(r.id);return r;}
async function job(id:number,due=false){const r=await row(id);if(due){await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${id}`;await sql`UPDATE pgboss.job SET start_after=now()-interval '1 second' WHERE id=${r.job_id}`;}await sql`UPDATE pgboss.job SET priority=2000000000 WHERE id=${r.job_id}`;const boss=await getBoss(),jobs=await boss.fetch<{runId:number;stepVersion:number}>(QUEUES.operation,{minPriority:2000000000});assert.equal(jobs.length,1);assert.equal(jobs[0]!.id,r.job_id);await executeOperationStep(id,jobs[0]!.data.stepVersion,jobs[0]!.id);await boss.complete(QUEUES.operation,jobs[0]!.id);}
async function missingJob(id:number){const r=await row(id);await sql`UPDATE pgboss.job SET state='completed' WHERE id=${r.job_id}`;await sql`UPDATE operation_runs SET job_id=NULL WHERE id=${id}`;}
async function recoverFixture(id:number){const [count]=await sql`SELECT count(*)::int AS n FROM operation_runs WHERE status IN ('active','waiting')`;for(let i=0;i<Math.ceil(count!.n/200)+3;i++){await recoverOperations();if((await row(id)).job_id)return;}assert.fail('fixture not recovered after bounded complete scan');}

test('all twelve fixed endpoints submit and poll via due pg-boss jobs with MODEL disabled',async()=>{
 mode='success';for(const [platform,pair] of Object.entries(transcriptionPairs)){const text=' Synthetic sharing prose https://example.invalid/video ';
 const r=await createTranscription({platform,url:text},'asr-test',tag());runs.push(r.id);let n=calls.length;await job(r.id);assert.deepEqual(calls[n],{path:transcriptionPaths[pair.submit],body:{url:text}});assert.equal((await row(r.id)).status,'waiting');await job(r.id,true);assert.equal(calls[n+1]!.path,transcriptionPaths[pair.poll]);assert.deepEqual(Object.keys(calls[n+1]!.body),['taskId']);assert.equal((await row(r.id)).status,'completed');const [out]=await sql`SELECT * FROM operation_results WHERE run_id=${r.id} AND kind='transcription'`;assert.equal(out!.data.stampSents[0].start,0);assert.equal(out!.data.text,'Synthetic transcript');}
});
test('processing advances sequence only after consumption; explicit task query never submits; failed preserves null',async()=>{mode='processing';const r=await query(),n=calls.length;await job(r.id);let current=await row(r.id);assert.equal(current.progress.pollSequence,1);assert.equal(current.status,'waiting');assert.ok(current.next_attempt_at>Date.now());assert.equal(calls[n]!.body.url,undefined);mode='failed';await job(r.id,true);assert.equal((await row(r.id)).status,'failed');const [out]=await sql`SELECT data FROM operation_results WHERE run_id=${r.id} AND item_key='poll:1'`;assert.equal(out!.data.failReason,null);});
test('schemas reject empty text, wrong task and malformed segments while preserving huge millisecond lexemes',()=>{assert.throws(()=>parseTranscriptionPoll({status:'succeeded'},'x'));assert.throws(()=>parseTranscriptionPoll({status:'succeeded',text:'ok',taskId:'other'},'x'));assert.throws(()=>parseTranscriptionPoll({status:'processing',stampSents:[{textSeg:'x',start:3,end:2}]},'x'));assert.equal(parseTranscriptionPoll({status:'processing'},'x').taskId,undefined);assert.equal(parseTranscriptionPoll({status:'succeeded',text:'x',stampSents:[{textSeg:'x',start:'90071992547409930',end:'90071992547409931'}]},'x').stampSents![0]!.start,'90071992547409930');});
test('stable commands reuse, changed input conflicts and strict input rejects before run/call',async()=>{mode='success';const key=tag(),input={platform:'douyin',url:'Synthetic share'};const r=await createTranscription(input,'asr-test',key);runs.push(r.id);assert.equal((await createTranscription(input,'asr-test',key)).id,r.id);await assert.rejects(createTranscription({...input,url:'other'},'asr-test',key),/different input/);const n=calls.length;assert.throws(()=>createTranscription({...input,apiKey:'forbidden'},'asr-test',tag()));assert.throws(()=>createTranscription({platform:'other',url:'x'},'asr-test',tag()));assert.equal(calls.length,n);});
test('unknown submit remains review; poll unknown retries original receipt once after thirty minutes',async()=>{mode='disconnect';const r=await createTranscription({platform:'bilibili',url:'Synthetic share'},'asr-test',tag());runs.push(r.id);await job(r.id);let state=await row(r.id);assert.equal(state.status,'needs_review');assert.equal((await releaseOperationReceipt(state.current_receipt_id,true)).released,false);
 const q=await query();await job(q.id);state=await row(q.id);assert.equal(state.status,'waiting');assert.equal((await releaseOperationReceipt(state.current_receipt_id)).released,false);const receipt=state.current_receipt_id;process.env.REDFOX_CALLS_ENABLED='false';try{assert.equal((await releaseOperationReceipt(receipt,true)).released,false);}finally{process.env.REDFOX_CALLS_ENABLED='true';}await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${receipt}`;assert.equal((await releaseOperationReceipt(receipt)).released,true);await job(q.id);state=await row(q.id);assert.equal(state.current_receipt_id,receipt);assert.equal(state.status,'needs_review');assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${receipt}`)[0]!.attempts,2);});
test('recovery finds ASR missing jobs, honors waiting time and consumes stored raw with all outbound disabled',async()=>{mode='success';const r=await createTranscription({platform:'douyin',url:'Synthetic recovery'},'asr-test',tag());runs.push(r.id);await missingJob(r.id);await recoverFixture(r.id);await job(r.id);await missingJob(r.id);await recoverOperations();assert.equal((await row(r.id)).job_id,null);await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${r.id}`;await recoverFixture(r.id);await job(r.id);assert.equal((await row(r.id)).status,'completed');
 mode='invalid';const q=await query();await job(q.id);const state=await row(q.id);assert.equal(state.status,'needs_review');const [raw]=await sql`SELECT response FROM receipts WHERE id=${state.current_receipt_id}`;assert.match(raw!.response.body,/broken/);
 const n=calls.length;process.env.REDFOX_CALLS_ENABLED='false';
 try{await sql.begin(tx=>resumeRun(tx,{runId:q.id,stepVersion:state.step_version,generation:state.generation}));await missingJob(q.id);await recoverFixture(q.id);await job(q.id);assert.equal((await row(q.id)).status,'needs_review');assert.equal(calls.length,n);}finally{process.env.REDFOX_CALLS_ENABLED='true';}
 // Real localhost answer persisted by paidRequest; simulate interruption before saveResult/advanceRun.
 mode='success';const local=await query(),initial=await row(local.id);
 const execution=await sql.begin(tx=>claimRun(tx,{runId:local.id,stepVersion:initial.step_version,generation:initial.generation},initial.job_id));
 const received=await pollTranscription('douyin',initial.progress.taskId,`run:${local.id}:poll:0`,receiptOptions(execution));
 await missingJob(local.id);process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;const before=calls.length;
 try{await recoverFixture(local.id);await job(local.id);assert.equal((await row(local.id)).status,'completed');assert.equal(calls.length,before);assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${received.receiptId}`)[0]!.attempts,1);}finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-asr-key';}
});
test('budget prevents new attempts and wrong-task raw stays reusable without repurchase',async()=>{mode='success';await sql`UPDATE budgets SET per_minute=0 WHERE service='redfox.poll'`;const q=await query(),n=calls.length;try{await job(q.id);assert.equal((await row(q.id)).status,'waiting');assert.equal((await row(q.id)).current_receipt_id,null);assert.equal(calls.length,n);}finally{await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.poll'`;}
 mode='wrong';const bad=await query();await job(bad.id);let r=await row(bad.id);assert.equal(r.status,'needs_review');const before=calls.length;process.env.REDFOX_CALLS_ENABLED='false';try{await sql.begin(tx=>resumeRun(tx,{runId:bad.id,stepVersion:r.step_version,generation:r.generation}));await missingJob(bad.id);await recoverFixture(bad.id);await job(bad.id);assert.equal((await row(bad.id)).status,'needs_review');assert.equal(calls.length,before);}finally{process.env.REDFOX_CALLS_ENABLED='true';}
});
test('HTTP authentication/CSRF and frozen smaller limits use existing errors and read DTO without calls',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),{operationDetail}=await import('@aihot/backend/providers/operations/read');const app=await buildApp(),n=calls.length;
 const payload={platform:'douyin',url:'Synthetic sharing prose'};
 try{config.devAdmin=null;assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/transcriptions',payload})).statusCode,401);
 config.devAdmin={displayName:'ASR synthetic'};assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/transcriptions',payload})).statusCode,403);
 const headers={'x-csrf-token':'dev','idempotency-key':tag()};const one=await app.inject({method:'POST',url:'/api/admin/redfox/transcriptions',payload,headers});assert.equal(one.statusCode,202);runs.push(one.json().runId);
 assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/transcriptions',payload:{...payload,url:'changed'},headers})).statusCode,409);
 assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/transcriptions',payload:{...payload,platform:'unknown'},headers:{...headers,'idempotency-key':tag()}})).statusCode,400);
 const existing=await app.inject({method:'POST',url:'/api/admin/redfox/transcriptions/query',payload:{platform:'bilibili',taskId:tag()},headers:{...headers,'idempotency-key':tag()}});assert.equal(existing.statusCode,202);runs.push(existing.json().runId);
 const options=await app.inject({url:'/api/admin/redfox/transcriptions/options'});assert.equal(options.statusCode,200);assert.equal(options.json().platforms.length,6);assert.equal(calls.length,n);
 await sql`UPDATE operation_runs SET limits=limits||'{"polls":1,"pollDeadlineSeconds":120}'::jsonb WHERE id=${existing.json().runId}`;
 const detail=await operationDetail(existing.json().runId);assert.equal(detail!.inputs.transcriptionPlan!.pollLimit,1);assert.equal(detail!.inputs.transcriptionPlan!.pollDeadlineSeconds,120);
 mode='processing';await job(existing.json().runId);const after=calls.length;await job(existing.json().runId,true);assert.equal((await row(existing.json().runId)).status,'needs_review');assert.equal(calls.length,after);
 }finally{await app.close();config.devAdmin=null;}
});


for(const pendingStatus of ['asr_processing','running'])test(`observed Bilibili ${pendingStatus} schedules another poll without resubmitting`,async()=>{
 mode='success';const r=await createTranscription({platform:'bilibili',url:'Synthetic alias regression'},'asr-test',tag());runs.push(r.id);
 const before=calls.length;await job(r.id);const taskId=(await row(r.id)).progress.taskId;
 try{
  mode=pendingStatus;await job(r.id,true);
  const waiting=await row(r.id);assert.equal(waiting.status,'waiting');assert.equal(waiting.progress.taskId,taskId);assert.equal(waiting.progress.pollSequence,1);assert.ok(waiting.next_attempt_at>Date.now());
  mode='success';await job(r.id,true);assert.equal((await row(r.id)).status,'completed');
  assert.equal(calls.slice(before).filter(call=>call.body.url).length,1);assert.equal(calls.slice(before).filter(call=>call.body.taskId===taskId).length,2);
  assert.equal(parseTranscriptionPoll({status:pendingStatus,taskId},taskId).status,'processing');
  assert.throws(()=>parseTranscriptionPoll({status:pendingStatus,taskId:'wrong'},taskId));
  assert.throws(()=>parseTranscriptionPoll({status:'unknown'},taskId));
 }finally{mode='success';}
});


test('retained running response recovers offline and continues the original task without resubmitting',async()=>{
 mode='success';const r=await createTranscription({platform:'bilibili',url:'Synthetic retained running'},'asr-test',tag());runs.push(r.id);
 const start=calls.length;await job(r.id);const waiting=await row(r.id),taskId=waiting.progress.taskId;
 await missingJob(r.id);
 await sql.begin(tx=>resumeRun(tx,{runId:r.id,stepVersion:waiting.step_version,generation:waiting.generation}));
 const initial=await row(r.id);
 const execution=await sql.begin(tx=>claimRun(tx,{runId:r.id,stepVersion:initial.step_version,generation:initial.generation},initial.job_id));
 mode='running';const received=await pollTranscription('bilibili',taskId,`run:${r.id}:poll:0`,receiptOptions(execution));
 assert.equal(received.data.status,'processing');
 await missingJob(r.id);process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;const before=calls.length;
 try{
  await recoverFixture(r.id);await job(r.id);
  const waiting=await row(r.id);assert.equal(waiting.status,'waiting');assert.equal(waiting.progress.taskId,taskId);assert.equal(waiting.progress.pollSequence,1);
  assert.equal(calls.length,before);assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${received.receiptId}`)[0]!.attempts,1);
 }finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-asr-key';mode='success';}
 await job(r.id,true);assert.equal((await row(r.id)).status,'completed');
 assert.equal(calls.slice(start).filter(call=>call.body.url).length,1);
 assert.equal(calls.slice(start).filter(call=>call.body.taskId===taskId).length,2);
});
