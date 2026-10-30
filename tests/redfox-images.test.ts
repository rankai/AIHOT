import {allowTestBudgetScope,tag} from "./setup.ts";
import assert from "node:assert/strict";
import {before,after,test} from "node:test";
import http from "node:http";
import {mkdtemp,rm,unlink,utimes,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {Readable} from "node:stream";
import sharp from "sharp";
import {config} from "@aihot/backend/config";
import {sql,closeDb} from "@aihot/backend/db";
import {getBoss,stopBoss,QUEUES} from "@aihot/backend/jobs/queue";
import {prepareUpload,writeUpload,publishUpload,uploadKey,assetPath,cleanupAssets,describeGeneratedFile} from "@aihot/backend/operations/assets";
import {createImageGeneration,createImageQuery} from "@aihot/backend/providers/redfox/images";
import {executeOperationStep} from "@aihot/backend/providers/operations/execute";
import {releaseOperationReceipt,recoverOperations} from "@aihot/backend/providers/operations/recovery";
import {abandonRun,resumeRun} from "@aihot/backend/providers/operations/store";
const dir=await mkdtemp(path.join(tmpdir(),"aihot-image-operation-"));config.dataDir=dir;
let uploaded=0,submitted=0,polled=0,loseSubmit=false,downloads=0,minimalPoll=false,completedPoll=false,missingImages=false;
let generated:Buffer;let uploadBody:Buffer,uploadType="";
const server=http.createServer((req,res)=>{const chunks:Buffer[]=[];req.on("data",chunk=>chunks.push(chunk));req.on("end",()=>{
  if(req.url?.startsWith("/synthetic-output")){downloads++;assert.equal(req.headers.redfox_api_key,undefined);res.setHeader("content-type","image/png");res.end(generated);return;}
  assert.equal(req.headers.redfox_api_key,"synthetic-image-key");const body=Buffer.concat(chunks);let data;
  if(req.url?.includes("uploadImage")){uploaded++;assert.match(req.url,/format=png/);uploadBody=body;uploadType=String(req.headers["content-type"]);data={format:"png",imageUrl:"https://images.example.test/synthetic-reference.png"};}
  else if(req.url?.endsWith("gptImage2Submit")){submitted++;if(loseSubmit){req.socket.destroy();return;}const input=JSON.parse(body.toString());assert.ok(Array.isArray(input.referenceImages));data={taskId:`synthetic-${submitted}`};}
  else {polled++;const input=JSON.parse(body.toString());data=completedPoll?{taskId:input.taskId,status:"completed",...(missingImages?{}:{imageUrls:[`${process.env.REDFOX_TEST_BASE_URL}/synthetic-output.png`]})}:minimalPoll?{taskId:input.taskId,status:"queued"}:{taskId:input.taskId,status:"in_progress",progress:20,imageUrls:[],failReason:null,model:"synthetic-redfox-label",resolution:"4k",size:"1:1"};}
  res.setHeader("content-type","application/json");res.end(JSON.stringify({code:2000,data}));
});});
let budgets:Array<{service:string;per_minute:number;per_hour:number;per_day:number}>=[];const runs:number[]=[];
before(async()=>{
  generated=await sharp({create:{width:4096,height:4096,channels:3,background:"green"}}).png().toBuffer();
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  process.env.REDFOX_API_KEY="synthetic-image-key";process.env.REDFOX_CALLS_ENABLED="true";process.env.MODEL_CALLS_ENABLED="true";config.allowPrivateNetworkFetch=true;
  budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.media','redfox.image','redfox.poll')`;
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.media','redfox.image','redfox.poll')`;
});
after(async()=>{
  for(const id of runs){const r=await row(id);if(!["failed","completed"].includes(r.status))await sql.begin(tx=>abandonRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation},"synthetic cleanup"));}
  for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;
  await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();await rm(dir,{recursive:true,force:true});
});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const input=(fileKeys:string[]=[])=>({prompt:"Synthetic colored square",resolution:"4k",size:"1:1",n:1,fileKeys});
async function runJob(id:number,due=false){
  const run=await row(id),boss=await getBoss(),priority=2000000000;
  await sql`UPDATE pgboss.job SET priority=${priority} WHERE id=${run.job_id}`;
  if(due){await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${id}`;await sql`UPDATE pgboss.job SET start_after=now()-interval '1 second' WHERE id=${run.job_id}`;}
  const jobs=await boss.fetch<{runId:number;stepVersion:number}>(QUEUES.operation,{minPriority:priority});
  assert.equal(jobs.length,1);assert.equal(jobs[0]!.id,run.job_id);
  await executeOperationStep(jobs[0]!.data.runId,jobs[0]!.data.stepVersion,jobs[0]!.id);await boss.complete(QUEUES.operation,jobs[0]!.id);
}
async function recoverWaiting(id:number){
  await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${id}`;
  const [count]=await sql`SELECT count(*)::int n FROM operation_runs WHERE status IN ('active','waiting')`;
  for(let i=0;i<Math.ceil(count!.n/200)+3;i++){await recoverOperations();const r=await row(id);const [j]=await sql`SELECT state FROM pgboss.job WHERE id=${r.job_id}`;if(j?.state==='created'||j?.state==='retry')return;}
  assert.fail('waiting image was not recovered');
}
test("asset multipart upload and submit advance to serial delayed polls through actual due jobs",async()=>{
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:"blue"}}).png().toBuffer(),temp=await prepareUpload();
  let asset;
  try {const content=await writeUpload(Readable.from(bytes),temp.file,new AbortController().signal);asset=await publishUpload({actor:"test",key:uploadKey("test",tag()),file:temp.file,filename:"synthetic.png",mime:"image/png",...content});}finally{await temp.release();}
  const key=tag(),run=await createImageGeneration(input([asset.key]),"test",key);runs.push(run.id);
  assert.equal((await createImageGeneration(input([asset.key]),"test",key)).id,run.id);
  await assert.rejects(createImageGeneration({...input([asset.key]),prompt:"different"},"test",key),/different input/);
  await runJob(run.id);assert.equal(uploaded,1);assert.match(uploadType,/multipart\/form-data; boundary=/);assert.ok(uploadBody.includes(bytes));
  assert.equal((await row(run.id)).step_key,"redfox.image.submit");await runJob(run.id);assert.equal(submitted,1);
  const waiting=await row(run.id);assert.equal(waiting.status,"waiting");assert.equal(waiting.progress.pollSequence,0);
  await sql`UPDATE pgboss.job SET priority=2000000000 WHERE id=${waiting.job_id}`;
  assert.equal((await (await getBoss()).fetch(QUEUES.operation,{minPriority:2000000000})).length,0);
  process.env.MODEL_CALLS_ENABLED="false";
  try {await runJob(run.id,true);assert.equal((await row(run.id)).progress.pollSequence,0);assert.equal(polled,0);assert.equal((await row(run.id)).current_receipt_id,null);}
  finally{process.env.MODEL_CALLS_ENABLED="true";}
  await recoverWaiting(run.id);await runJob(run.id,true);assert.equal((await row(run.id)).progress.pollSequence,1);
  await runJob(run.id,true);assert.equal((await row(run.id)).progress.pollSequence,2);assert.equal(polled,2);
  const receipts=await sql`SELECT DISTINCT receipt_id FROM operation_results WHERE run_id=${run.id} AND item_key LIKE 'poll:%'`;assert.equal(receipts.length,2);
});
test("unknown submit cannot be released or repurchased; explicit task query never submits",async()=>{
  loseSubmit=true;const before=submitted;
  const run=await createImageGeneration(input(),"test",tag());runs.push(run.id);await runJob(run.id);
  const state=await row(run.id);assert.equal(state.status,"needs_review");
  await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${state.current_receipt_id}`;
  assert.equal((await releaseOperationReceipt(state.current_receipt_id)).released,false);
  assert.equal((await releaseOperationReceipt(state.current_receipt_id,true)).released,false);
  await executeOperationStep(run.id,state.step_version,"duplicate");assert.equal(submitted,before+1);
  loseSubmit=false;const query=await createImageQuery({taskId:"synthetic-existing"},"test",tag());runs.push(query.id);
  process.env.MODEL_CALLS_ENABLED="false";try{await runJob(query.id);assert.equal((await row(query.id)).status,"waiting");assert.equal(submitted,before+1);}finally{process.env.MODEL_CALLS_ENABLED="true";}
});

test("minimal queued response advances but completed without images stays review",async()=>{
  minimalPoll=true;const run=await createImageQuery({taskId:tag()},"test",tag());runs.push(run.id);
  try {await runJob(run.id);assert.equal((await row(run.id)).progress.pollSequence,1);completedPoll=true;missingImages=true;
    await runJob(run.id,true);assert.equal((await row(run.id)).status,"needs_review");assert.equal((await row(run.id)).progress.pollSequence,1);
  }finally{minimalPoll=false;completedPoll=false;missingImages=false;}
});
test("missing local reference rolls back attempt; confirmed same-asset upload result is reused",async()=>{
  const temp=await prepareUpload();let asset;
  try{const image=await sharp({create:{width:2,height:2,channels:3,background:"yellow"}}).png().toBuffer();const content=await writeUpload(Readable.from(image),temp.file,new AbortController().signal);asset=await publishUpload({actor:"test",key:uploadKey("test",tag()),file:temp.file,filename:"synthetic.png",mime:"image/png",...content});}finally{await temp.release();}
  const run=await createImageGeneration(input([asset.key]),"test",tag());runs.push(run.id);
  await unlink(assetPath(asset.key));const before=uploaded;await runJob(run.id);
  assert.equal((await row(run.id)).status,"needs_review");assert.equal((await row(run.id)).current_receipt_id,null);assert.equal(uploaded,before);
  const [count]=await sql`SELECT count(*)::int AS n FROM receipts WHERE request->>'window'=${`run:${run.id}:reference:0`}`;assert.equal(count!.n,0);
  // Reuse a real confirmed upload result from the first chain, even when its local file is unavailable.
  const [confirmed]=await sql`SELECT file_key FROM operation_results WHERE kind='image_reference' AND file_key IS NOT NULL AND data ? 'sha256' ORDER BY id DESC LIMIT 1`;
  assert.ok(confirmed);await unlink(assetPath(confirmed.file_key)).catch(()=>{});
  const reuse=await createImageGeneration(input([confirmed.file_key]),"test",tag());runs.push(reuse.id);await runJob(reuse.id);
  assert.equal((await row(reuse.id)).step_key,"redfox.image.submit");assert.equal(uploaded,before);
  const [result]=await sql`SELECT data FROM operation_results WHERE run_id=${reuse.id}`;assert.ok(result!.data.reusedResultId);
});
test("4k output saves privately and result file status follows deletion",async()=>{
  completedPoll=true;const before=submitted,downloadBefore=downloads;
  try{const run=await createImageGeneration(input(),"test",tag());runs.push(run.id);await runJob(run.id);await runJob(run.id,true);
    assert.equal((await row(run.id)).step_key,"redfox.image.save");process.env.MODEL_CALLS_ENABLED="false";
    await runJob(run.id);assert.equal((await row(run.id)).status,"waiting");assert.equal(downloads,downloadBefore);process.env.MODEL_CALLS_ENABLED="true";await recoverWaiting(run.id);await runJob(run.id,true);assert.equal((await row(run.id)).status,"completed");assert.equal(submitted,before+1);assert.equal(downloads,downloadBefore+1);
    const {operationResults}=await import("@aihot/backend/providers/operations/read");const page=await operationResults(run.id);const output=page.results.find(r=>r.kind==="image")!;
    assert.equal(output.file.status,"available");assert.equal(output.file.width,4096);assert.equal(output.file.height,4096);
    const {deleteAsset}=await import("@aihot/backend/operations/assets");await deleteAsset(output.fileKey,"test");
    assert.equal((await operationResults(run.id)).results.find(r=>r.kind==="image")!.file.status,"deleted");
  }finally{completedPoll=false;process.env.MODEL_CALLS_ENABLED="true";}
});
test("published orphan is protected by expected key and recovered without network after restart",async()=>{
  completedPoll=true;const before=downloads;
  try{const run=await createImageQuery({taskId:tag()},"test",tag());runs.push(run.id);await runJob(run.id);const saving=await row(run.id),key=saving.progress.expectedFileKey;
    const temp=await prepareUpload(64*1024*1024);
    try{const {writeFile}=await import("node:fs/promises");await writeFile(temp.file,generated);const description=await describeGeneratedFile(temp.file);
      await assert.rejects(sql.begin(async tx=>{await publishUpload({actor:"test",key,...description},tx);throw new Error("synthetic interrupted registration");}),/interrupted/);
    }finally{await temp.release();}
    assert.equal((await sql`SELECT 1 FROM stored_files WHERE key=${key}`).length,0);
    const old=new Date(Date.now()-2*86400_000);await utimes(assetPath(key),old,old);await cleanupAssets();await stat(assetPath(key));
    await (await getBoss()).complete(QUEUES.operation,saving.job_id);await sql`UPDATE pgboss.job SET state='completed' WHERE id=${saving.job_id}`;
    process.env.REDFOX_CALLS_ENABLED="false";process.env.MODEL_CALLS_ENABLED="false";
    for(let i=0;i<10&&(await row(run.id)).job_id===saving.job_id;i++)await recoverOperations();
    assert.notEqual((await row(run.id)).job_id,saving.job_id);await runJob(run.id);
    assert.equal((await row(run.id)).status,"completed");assert.equal(downloads,before);
  }finally{completedPoll=false;process.env.REDFOX_CALLS_ENABLED="true";process.env.MODEL_CALLS_ENABLED="true";}
});

test("forbidden download stays on save; retry downloads without another submission",async()=>{
  completedPoll=true;const beforeSubmit=submitted,beforeDownloads=downloads;
  try{const run=await createImageGeneration(input(),"test",tag());runs.push(run.id);await runJob(run.id);await runJob(run.id,true);
    config.allowPrivateNetworkFetch=false;await runJob(run.id);const held=await row(run.id);assert.equal(held.status,"needs_review");assert.equal(held.step_key,"redfox.image.save");assert.equal(downloads,beforeDownloads);
    config.allowPrivateNetworkFetch=true;await sql.begin(async tx=>{await resumeRun(tx,{runId:run.id,stepVersion:held.step_version,generation:held.generation});const {queueOperationStep}=await import("@aihot/backend/providers/operations/queue");await queueOperationStep(tx,run.id);});
    process.env.MODEL_CALLS_ENABLED="false";await runJob(run.id);assert.equal((await row(run.id)).status,"waiting");assert.equal(downloads,beforeDownloads);process.env.MODEL_CALLS_ENABLED="true";await recoverWaiting(run.id);await runJob(run.id,true);assert.equal((await row(run.id)).status,"completed");assert.equal(submitted,beforeSubmit+1);assert.equal(downloads,beforeDownloads+1);
  }finally{config.allowPrivateNetworkFetch=true;completedPoll=false;process.env.MODEL_CALLS_ENABLED="true";}
});
test("budget and cumulative attempt limit roll back new dispatch; image APIs keep auth and conflict mapping",async()=>{
  const {buildApp}=await import("../apps/api/src/app.ts");const app=await buildApp();const before=submitted+polled+uploaded;
  try{
    config.devAdmin=null;assert.equal((await app.inject({method:"POST",url:"/api/admin/redfox/images",payload:input(),headers:{"idempotency-key":tag()}})).statusCode,401);
    config.devAdmin={displayName:"Image test"};assert.equal((await app.inject({method:"POST",url:"/api/admin/redfox/images",payload:input(),headers:{"idempotency-key":tag()}})).statusCode,403);
    const headers={"idempotency-key":tag(),"x-csrf-token":"dev"};assert.equal((await app.inject({method:"POST",url:"/api/admin/redfox/images",payload:input(),headers:{...headers,"idempotency-key":tag()}})).statusCode,409);const one=await app.inject({method:"POST",url:"/api/admin/redfox/images",payload:{...input(),resolution:"1k"},headers});assert.equal(one.statusCode,202);runs.push(one.json().runId);
    assert.equal((await app.inject({method:"POST",url:"/api/admin/redfox/images",payload:{...input(),n:2},headers})).statusCode,409);
    assert.equal((await app.inject({method:"POST",url:"/api/admin/redfox/images",payload:{...input(),n:5},headers:{...headers,"idempotency-key":tag()}})).statusCode,400);
    assert.equal((await app.inject({method:"POST",url:"/api/admin/redfox/images",payload:{...input([`uploads/redfox/${"9".repeat(64)}`]),resolution:"1k"},headers:{...headers,"idempotency-key":tag()}})).statusCode,409);
    assert.equal((await app.inject({url:"/api/admin/redfox/images/options"})).statusCode,200);assert.equal(submitted+polled+uploaded,before);
    await sql`UPDATE budgets SET per_minute=0 WHERE service='redfox.image'`;await runJob(one.json().runId);assert.equal((await row(one.json().runId)).current_receipt_id,null);assert.equal(submitted+polled+uploaded,before);
    const limited=await createImageQuery({taskId:tag()},"test",tag());runs.push(limited.id);await sql`UPDATE operation_runs SET progress=progress||'{"externalAttempts":1}'::jsonb,limits=limits||'{"externalAttempts":1,"polls":2,"pollDeadlineSeconds":120}'::jsonb WHERE id=${limited.id}`;await runJob(limited.id);
    const {operationDetail}=await import("@aihot/backend/providers/operations/read");const detail=await operationDetail(limited.id);assert.equal(detail?.inputs.imagePlan?.pollLimit,2);assert.equal(detail?.inputs.imagePlan?.pollDeadlineSeconds,120);assert.equal(Object.hasOwn(detail!,"limits"),false);
    assert.equal((await row(limited.id)).status,"needs_review");assert.equal((await row(limited.id)).current_receipt_id,null);assert.equal(submitted+polled+uploaded,before);
  }finally{await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.image'`;await app.close();config.devAdmin=null;}
});

test("recovery keyset advances past a full batch of future waiting image tasks",async()=>{
  const marker=tag(),[prior]=await sql`SELECT value FROM settings WHERE key='operations.recovery-cursor'`;
  const rows=await sql<{id:number}[]>`INSERT INTO operation_runs(actor,command_key,provider,operation_key,contract_version,input,input_hash,status,step_key,next_attempt_at)
    SELECT ${marker},${marker}||g::text,'redfox','redfox.image.query',1,'{"members":[],"mode":"image-query"}'::jsonb,'synthetic','waiting','redfox.image.poll',now()+interval '1 day' FROM generate_series(1,201) g RETURNING id`;
  const last=await createImageQuery({taskId:tag()},"test",tag());runs.push(last.id);const state=await row(last.id);
  await (await getBoss()).cancel(QUEUES.operation,state.job_id);await sql`UPDATE operation_runs SET job_id=NULL WHERE id=${last.id}`;
  await sql`INSERT INTO settings(key,value,updated_by) VALUES ('operations.recovery-cursor',${sql.json(rows[0]!.id-1)},'test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
  try {
    await recoverOperations();assert.equal((await row(last.id)).job_id,null);
    const [cursor]=await sql`SELECT value FROM settings WHERE key='operations.recovery-cursor'`;assert.equal(cursor!.value,rows[199]!.id);
    await recoverOperations();assert.ok((await row(last.id)).job_id);
  }finally{await sql`DELETE FROM operation_runs WHERE actor=${marker}`;if(prior)await sql`UPDATE settings SET value=${sql.json(prior.value)} WHERE key='operations.recovery-cursor'`;else await sql`DELETE FROM settings WHERE key='operations.recovery-cursor'`;}
});

test("real admin actor reaches local image delivery with admin-scoped attempts",async()=>{
 const restore=await allowTestBudgetScope(['redfox.image','redfox.poll'],'admin');
 const oldCompleted=completedPoll,oldMissing=missingImages;completedPoll=true;missingImages=false;
 try {
  const r=await createImageGeneration({...input(),resolution:'1k'},'admin:4242',tag());runs.push(r.id);
  await runJob(r.id);await runJob(r.id,true);await runJob(r.id);
  assert.equal((await row(r.id)).status,'completed');
  const attempts=await sql`SELECT DISTINCT a.id,a.budget_scope FROM receipt_attempts a JOIN operation_results z ON z.receipt_id=a.receipt_id WHERE z.run_id=${r.id}`;
  assert.ok(attempts.length>=2);assert.ok(attempts.every(a=>a.budget_scope==='admin'));
  assert.equal((await sql`SELECT * FROM member_credit_charges WHERE root_run_id=${r.id}`).length,0);
 }finally{completedPoll=oldCompleted;missingImages=oldMissing;await restore();}
});
