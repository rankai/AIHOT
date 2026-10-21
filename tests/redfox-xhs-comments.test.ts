import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import http from 'node:http';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {getBoss,stopBoss,QUEUES} from '@aihot/backend/jobs/queue';
import {createXhsComments,createXhsCommentQuery} from '@aihot/backend/providers/redfox/xhs-comments';
import {XhsCommentInput,parseXhsCommentPoll} from '@aihot/backend/providers/redfox/xhs-comments-contract';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {releaseOperationReceipt,recoverOperations} from '@aihot/backend/providers/operations/recovery';
import {abandonRun,claimRun,receiptOptions,resumeRun} from '@aihot/backend/providers/operations/store';
import {queueOperationStep} from '@aihot/backend/providers/operations/queue';
import {operationResults} from '@aihot/backend/providers/operations/read';
import {redfoxRequest} from '@aihot/backend/providers/redfox/client';
const runs:number[]=[],calls:Array<{url:string;body:string}>=[];let mode='ok',empty=false;
const comments=[{commentId:'90071992547409931234',commenterId:'synthetic-author',noteId:'synthetic-note',content:'Synthetic comment',nickname:'Synthetic nickname',createTime:'2020-01-02 03:04:05',avatar:'javascript:alert(1)',likeNum:0,subCommentCount:0,pictures:[{originUrl:'https://media.example.test/img',url:'https://secret@media.example.test/img',width:'100',height:'100',fileId:''}]},{commentId:'opaque-two',content:'Synthetic second comment',pictures:[]}];
const server=http.createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{assert.equal(req.method,'POST');assert.equal(req.headers.redfox_api_key,'synthetic-comments-key');const body=Buffer.concat(chunks).toString();calls.push({url:req.url!,body});if(mode==='unknown'){req.socket.destroy();return;}res.setHeader('content-type','application/json');if(mode==='bad'){res.end('{broken');return;}let data;if(req.url==='/story/api/xhs/commentSubmit'){const p=JSON.parse(body);assert.equal(typeof p.opusId,'string');data={status:'pending',taskId:' task | opaque ',visibleAfterTime:'2026-08-08 15:56:58'};}else{assert.equal(body,'');const u=new URL(req.url!,'http://localhost');assert.equal(u.pathname,'/story/api/xhs/commentResult');data={taskId:mode==='wrong'?'wrong':u.searchParams.get('taskId'),status:mode==='pending'?'pending':mode==='processing'?'processing':mode==='invalid'?'failed':'completed',dataNum:empty?0:50,received:empty?0:52,commentList:empty?[]:comments};}res.end(JSON.stringify({code:2000,data}));});});
let budgets:any[]=[];
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='synthetic-comments-key';process.env.REDFOX_CALLS_ENABLED='true';process.env.MODEL_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';config.allowPrivateNetworkFetch=true;budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.query','redfox.poll')`;await sql`UPDATE budgets SET per_minute=10000,per_hour=100000,per_day=1000000 WHERE service IN ('redfox.query','redfox.poll')`;});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
after(async()=>{for(const id of runs){const r=await row(id);if(!['completed','failed'].includes(r.status))await sql.begin(tx=>abandonRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation},'test cleanup'));}for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
async function submit(){const r=await createXhsComments({opusId:' opaque note | ',dataNum:-1},'test',tag());runs.push(r.id);return r;}
async function query(){const r=await createXhsCommentQuery({taskId:' task | opaque '},'test',tag());runs.push(r.id);return r;}
async function job(id:number,due=false){const r=await row(id);if(due){await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${id}`;await sql`UPDATE pgboss.job SET start_after=now()-interval '1 second' WHERE id=${r.job_id}`;}await sql`UPDATE pgboss.job SET priority=2000000000 WHERE id=${r.job_id}`;const boss=await getBoss(),jobs=await boss.fetch<{runId:number;stepVersion:number}>(QUEUES.operation,{minPriority:2000000000});assert.equal(jobs.length,1);assert.equal(jobs[0]!.id,r.job_id);await executeOperationStep(id,jobs[0]!.data.stepVersion,jobs[0]!.id);await boss.complete(QUEUES.operation,jobs[0]!.id);}
async function scan(){const [count]=await sql`SELECT count(*)::int n FROM operation_runs WHERE status IN ('active','waiting')`;for(let i=0;i<Math.ceil(count!.n/200)+3;i++)await recoverOperations();}
async function resume(id:number){const r=await row(id);await sql.begin(async tx=>{await resumeRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation});await queueOperationStep(tx,id);});}

test('submission keeps cost unknown and schedules receipt-time plus 24h; missing-job recovery does not poll early',async()=>{
 const r=await submit(),before=calls.length;await job(r.id);assert.equal(calls.length,before+1);assert.deepEqual(JSON.parse(calls.at(-1)!.body),{opusId:' opaque note | ',dataNum:-1});const waiting=await row(r.id),[result]=await sql`SELECT * FROM operation_results WHERE run_id=${r.id}`,[receipt]=await sql`SELECT * FROM receipts WHERE id=${result!.receipt_id}`;assert.equal(waiting.status,'waiting');assert.equal(result!.data.visibleAfterTime,'2026-08-08 15:56:58');assert.equal(waiting.next_attempt_at.getTime()-receipt!.received_at.getTime(),86400000);assert.equal(receipt!.cost,null);assert.equal(receipt!.service,'redfox.query');await sql`UPDATE pgboss.job SET priority=2000000000 WHERE id=${waiting.job_id}`;assert.equal((await (await getBoss()).fetch(QUEUES.operation,{minPriority:2000000000})).length,0);await sql`UPDATE pgboss.job SET state='completed' WHERE id=${waiting.job_id}`;await scan();assert.equal((await row(r.id)).job_id,waiting.job_id);assert.equal(calls.length,before+1);
 await sql`UPDATE receipts SET received_at=now()-interval '25 hours' WHERE id=${result!.receipt_id}`; await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${r.id}`;await scan();assert.notEqual((await row(r.id)).job_id,waiting.job_id);await job(r.id);assert.equal((await row(r.id)).status,'completed');assert.equal(calls.at(-1)!.body,'');assert.equal(new URL(calls.at(-1)!.url,'http://localhost').searchParams.get('taskId'),' task | opaque ');
 const rows=await sql`SELECT z.*,p.cost,p.service FROM operation_results z JOIN receipts p ON p.id=z.receipt_id WHERE run_id=${r.id} AND item_key='poll:0'`;assert.equal(rows[0]!.service,'redfox.poll');assert.equal(Number(rows[0]!.cost),0);assert.equal(rows[0]!.data.actualCount,2);assert.equal(rows[0]!.data.dataNum,50);assert.equal(rows[0]!.data.received,52);assert.equal(rows[0]!.data.commentList,undefined);
});
test('individual comments retain raw facts, safe links and task provenance without article/file/source effects; pagination works',async()=>{
 const q=await query();await job(q.id);const first=await operationResults(q.id,0,2);assert.equal(first.results.length,2);assert.ok(first.nextCursor);const next=await operationResults(q.id,first.nextCursor!,2);assert.equal(next.results.length,1);const [comment]=await sql`SELECT * FROM operation_results WHERE run_id=${q.id} AND kind='xhs_comment' ORDER BY id`;assert.deepEqual(comment!.data.record,comments[0]);assert.equal(comment!.data.avatarUrl,null);assert.equal(comment!.data.pictures[0].url,null);assert.equal(comment!.data.pictures[0].originUrl,'https://media.example.test/img');assert.equal(comment!.data.pollSequence,0);assert.equal(comment!.article_id,null);assert.equal(comment!.source_id,null);assert.equal(comment!.file_key,null);assert.equal((await row(q.id)).progress.commentList,undefined);
});
test('pending then processing consume distinct polls hourly; empty completion preserves zero counts and explicit query never submits',async()=>{
 const n=calls.filter(c=>c.url.endsWith('commentSubmit')).length,q=await query();mode='pending';await job(q.id);let r=await row(q.id);assert.equal(r.progress.pollSequence,1);assert.ok(r.next_attempt_at.getTime()-Date.now()>3590000);mode='processing';await job(q.id,true);assert.equal((await row(q.id)).progress.pollSequence,2);mode='ok';empty=true;await job(q.id,true);assert.equal((await row(q.id)).status,'completed');const [summary]=await sql`SELECT data FROM operation_results WHERE run_id=${q.id} AND item_key='poll:2'`;assert.equal(summary!.data.actualCount,0);assert.equal(summary!.data.dataNum,0);assert.equal(summary!.data.received,0);assert.equal(calls.filter(c=>c.url.endsWith('commentSubmit')).length,n);empty=false;
});
test('strict inputs, task matching, unknown state and large numeric lexemes do not invent response facts',()=>{
 for(const input of [{opusId:'',dataNum:20},{opusId:'x',dataNum:0},{opusId:'x',dataNum:-2},{opusId:'x',dataNum:9007199254740992},{opusId:'x',dataNum:1.5},{opusId:'x',dataNum:20,apiKey:'no'}])assert.equal(XhsCommentInput.safeParse(input).success,false);assert.equal(XhsCommentInput.parse({opusId:'x',dataNum:Number.MAX_SAFE_INTEGER}).dataNum,Number.MAX_SAFE_INTEGER);
 for(const data of [{taskId:'other',status:'pending'},{taskId:'x',status:'failed'},{taskId:'x',status:'completed'},{taskId:'x',status:'completed',commentList:[{}]}])assert.throws(()=>parseXhsCommentPoll(data,'x'));const huge=parseXhsCommentPoll({taskId:'x',status:'completed',commentList:[{content:'',likeNum:'90071992547409931234'}],received:'90071992547409931235',dataNum:0},'x');assert.equal(huge.received,'90071992547409931235');
});
test('unknown submission never auto-retries, while unknown poll retries original receipt globally once after 30m',async()=>{
 mode='unknown';const r=await submit();await job(r.id);const held=await row(r.id);assert.equal(held.status,'needs_review');await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${held.current_receipt_id}`;assert.equal((await releaseOperationReceipt(held.current_receipt_id,true)).released,false);const q=await query();await job(q.id);const waiting=await row(q.id);assert.equal(waiting.status,'waiting');assert.equal((await releaseOperationReceipt(waiting.current_receipt_id)).released,false);await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${waiting.current_receipt_id}`;assert.equal((await releaseOperationReceipt(waiting.current_receipt_id)).released,true);await job(q.id);assert.equal((await row(q.id)).status,'needs_review');assert.equal((await row(q.id)).current_receipt_id,waiting.current_receipt_id);mode='ok';
});
test('malformed raw remains received and locally reusable; lost-job received data completes with no key or outbound',async()=>{
 mode='bad';const q=await query();await job(q.id);const r=await row(q.id),[receipt]=await sql`SELECT * FROM receipts WHERE id=${r.current_receipt_id}`;assert.equal(receipt!.status,'received');assert.equal(receipt!.response.body,'{broken');const count=calls.length;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;try{await resume(q.id);await job(q.id);assert.equal((await row(q.id)).status,'needs_review');assert.equal(calls.length,count);}finally{mode='ok';process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-comments-key';}
 const local=await query(),initial=await row(local.id),execution=await sql.begin(tx=>claimRun(tx,{runId:local.id,stepVersion:initial.step_version,generation:initial.generation},initial.job_id));await redfoxRequest('LO93CE5K',{taskId:initial.progress.taskId},`run:${local.id}:poll:0`,'poll',receiptOptions(execution));await sql`UPDATE pgboss.job SET state='completed' WHERE id=${initial.job_id}`;const n=calls.length;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;try{await scan();assert.notEqual((await row(local.id)).job_id,initial.job_id);await job(local.id);assert.equal((await row(local.id)).status,'completed');assert.equal(calls.length,n);}finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-comments-key';}
});
test('expired deadlines, disabled gate and budget zero produce no attempt; HTTP options and commands stay strict/local',async()=>{
 const n=calls.length;for(const kind of ['deadline','gate','budget']){const q=await query();if(kind==='deadline')await sql`UPDATE operation_runs SET input=jsonb_set(input,'{startedAt}',${sql.json(new Date(Date.now()-49*3600_000).toISOString())}) WHERE id=${q.id}`;if(kind==='gate')process.env.REDFOX_CALLS_ENABLED='false';if(kind==='budget')await sql`UPDATE budgets SET per_minute=0,per_hour=0,per_day=0 WHERE service='redfox.poll'`;try{await job(q.id);assert.equal((await row(q.id)).current_receipt_id,null);assert.equal((await row(q.id)).status,kind==='deadline'?'needs_review':'waiting');}finally{process.env.REDFOX_CALLS_ENABLED='true';await sql`UPDATE budgets SET per_minute=10000,per_hour=100000,per_day=1000000 WHERE service='redfox.poll'`;}}assert.equal(calls.length,n);
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),old=config.devAdmin,url='/api/admin/redfox/xiaohongshu/comments';try{config.devAdmin=null;assert.equal((await app.inject({url:url+'/options'})).statusCode,401);config.devAdmin={displayName:'Comment test'};const options=await app.inject({url:url+'/options'});assert.equal(options.json().billing.submissionCost,null);assert.equal((await app.inject({method:'POST',url,payload:{opusId:'x',dataNum:20}})).statusCode,403);const headers={'idempotency-key':tag(),'x-csrf-token':'dev'},payload={opusId:'x',dataNum:20};assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,dataNum:0}})).statusCode,400);const one=await app.inject({method:'POST',url,headers,payload});assert.equal(one.statusCode,202);runs.push(one.json().runId);assert.equal((await app.inject({method:'POST',url,headers,payload})).json().runId,one.json().runId);assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,dataNum:-1}})).statusCode,409);assert.equal(calls.length,n);}finally{config.devAdmin=old;await app.close();}
});
test('recovery expires overdue gated waiting jobs without dropping task ID or releasing unknown receipt',async()=>{
 const q=await query();mode='unknown';await job(q.id);mode='ok';const held=await row(q.id);await sql`UPDATE operation_runs SET input=jsonb_set(input,'{startedAt}',${sql.json(new Date(Date.now()-49*3600_000).toISOString())}) WHERE id=${q.id}`;process.env.REDFOX_CALLS_ENABLED='false';const n=calls.length;try{await scan();const expired=await row(q.id);assert.equal(expired.status,'needs_review');assert.equal(expired.progress.taskId,' task | opaque ');assert.equal(expired.current_receipt_id,held.current_receipt_id);assert.equal((await sql`SELECT status FROM receipts WHERE id=${held.current_receipt_id}`)[0]!.status,'unknown');assert.equal(calls.length,n);assert.equal((await releaseOperationReceipt(held.current_receipt_id,true)).released,false);}finally{process.env.REDFOX_CALLS_ENABLED='true';}
});

test('HTTP stop/resume cannot bypass first receipt-time window with a lost or retained job',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),oldAdmin=config.devAdmin;config.devAdmin={displayName:'Comment delay test'};
 async function control(id:number,action:string){const r=await row(id);const response=await app.inject({method:'POST',url:`/api/admin/operations/runs/${id}/${action}`,headers:{'x-csrf-token':'dev'},payload:{stepVersion:r.step_version,generation:r.generation,reason:'Synthetic stop/resume'}});assert.equal(response.statusCode,200,response.body);}
 try{for(const retainJob of [false,true]){
  const run=await submit();await job(run.id);const initial=await row(run.id),[submission]=await sql`SELECT receipt_id FROM operation_results WHERE run_id=${run.id} AND item_key='submission'`;
  const deadline=initial.next_attempt_at.getTime(),n=calls.length,[attempts]=await sql`SELECT count(*)::int n FROM receipt_attempts`;
  for(let repeat=0;repeat<2;repeat++){
   const waiting=await row(run.id),oldJob=waiting.job_id;await control(run.id,'stop');
   if(!retainJob||repeat===1)await sql`DELETE FROM pgboss.job WHERE id=${oldJob}`;
   await control(run.id,'resume');
   if(retainJob&&repeat===0){
    // The old queue deadline is not the business authority: simulate early delivery of that job.
    await sql`UPDATE pgboss.job SET start_after=now()-interval '1 second',priority=2000000000 WHERE id=${oldJob}`;
    const boss=await getBoss(),jobs=await boss.fetch<{runId:number;stepVersion:number}>(QUEUES.operation,{minPriority:2000000000});assert.equal(jobs[0]!.id,oldJob);
    await executeOperationStep(run.id,jobs[0]!.data.stepVersion,oldJob);await boss.complete(QUEUES.operation,oldJob);
   }else{
    if(repeat===1)process.env.REDFOX_CALLS_ENABLED='false';
    try{await job(run.id);}finally{process.env.REDFOX_CALLS_ENABLED='true';}
   }
   const deferred=await row(run.id);assert.equal(deferred.status,'waiting');assert.equal(deferred.next_attempt_at.getTime(),deadline);
   assert.equal(deferred.step_version,initial.step_version);assert.equal(deferred.progress.pollSequence,0);assert.equal(deferred.progress.externalAttempts,initial.progress.externalAttempts);assert.equal(deferred.retry_count,initial.retry_count);assert.equal(deferred.current_receipt_id,null);assert.equal(calls.length,n);
   assert.equal((await sql`SELECT count(*)::int n FROM receipt_attempts`)[0]!.n,attempts!.n);
  }
  await sql`UPDATE receipts SET received_at=now()-interval '25 hours' WHERE id=${submission!.receipt_id}`;
  const deferred=await row(run.id);await sql`DELETE FROM pgboss.job WHERE id=${deferred.job_id}`;await control(run.id,'stop');await control(run.id,'resume');await job(run.id);
  assert.equal((await row(run.id)).status,'completed');assert.equal(calls.length,n+1);
 }}finally{config.devAdmin=oldAdmin;process.env.REDFOX_CALLS_ENABLED='true';await app.close();}
});

test('previously received first-poll raw is consumed locally despite the reconstructed future window',async()=>{
 const r=await submit();await job(r.id);const waiting=await row(r.id);
 await sql`DELETE FROM pgboss.job WHERE id=${waiting.job_id}`;await resume(r.id);const active=await row(r.id);
 const e=await sql.begin(tx=>claimRun(tx,{runId:r.id,stepVersion:active.step_version,generation:active.generation},active.job_id));
 // Simulate an already received response from an interrupted old executor; no business state advance.
 await redfoxRequest('LO93CE5K',{taskId:active.progress.taskId},`run:${r.id}:poll:0`,'poll',receiptOptions(e));
 const n=calls.length;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{await job(r.id);assert.equal((await row(r.id)).status,'completed');assert.equal(calls.length,n);}finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-comments-key';}
});
