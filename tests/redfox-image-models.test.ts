import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import http from 'node:http';
import {mkdtemp,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import sharp from 'sharp';
import {config} from '@aihot/backend/config';
import {sql,closeDb} from '@aihot/backend/db';
import {getBoss,stopBoss,QUEUES} from '@aihot/backend/jobs/queue';
import {prepareUpload,writeUpload,publishUpload,uploadKey,assetPath} from '@aihot/backend/operations/assets';
import {createImageGeneration,createImageQuery,parseImagePoll,pollImage,submitImage} from '@aihot/backend/providers/redfox/images';
import {ImageInput,imagePairs,newImagePaths,type ImageModel} from '@aihot/backend/providers/redfox/image-models';
import {createMediaUpload} from '@aihot/backend/providers/redfox/media-upload';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {releaseOperationReceipt,recoverOperations} from '@aihot/backend/providers/operations/recovery';
import {abandonRun,claimRun,receiptOptions,type RunRow} from '@aihot/backend/providers/operations/store';
const dir=await mkdtemp(path.join(tmpdir(),'aihot-new-images-'));config.dataDir=dir;
const calls:Array<{url:string;body:any;type:string}>=[],runs:number[]=[];let output:Buffer,mode='ok',outputs=1,downloads=0;
const server=http.createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
 if(req.url!.startsWith('/output/')){downloads++;assert.equal(req.headers.redfox_api_key,undefined);res.setHeader('content-type','image/png');res.end(output);return;}
 assert.equal(req.headers.redfox_api_key,'synthetic-new-images');const raw=Buffer.concat(chunks),type=String(req.headers['content-type']),body=type.startsWith('multipart/')?raw:JSON.parse(raw.toString());calls.push({url:req.url!,body,type});
 if(mode==='disconnect'){req.socket.destroy();return;}res.setHeader('content-type','application/json');if(mode==='bad'){res.end('{broken');return;}
 let data;
 if(req.url!.includes('uploadFile'))data={imageUrl:'https://example.test/reference',format:new URL(req.url!,'http://localhost').searchParams.get('format')};
 else if(req.url!.endsWith('Submit'))data={taskId:'generated-task'};
 else {const seed=req.url!.includes('/ark'),status=mode==='pending'?(seed?'running':'in_progress'):mode==='failed'?'failed':seed?'succeeded':'completed';data={taskId:mode==='wrong'?'different':body.taskId,status,failReason:mode==='conflict'?'failure':null,model:'upstream-varying-label',...(seed?{usage:{generatedImages:999,outputTokens:0}}:{metadata:{retained:true}}),...(status==='completed'||status==='succeeded'?{imageUrls:Array.from({length:outputs},(_,i)=>`${process.env.REDFOX_TEST_BASE_URL}/output/${i}`)}:{})};}
 res.end(JSON.stringify({code:2000,data}));
});});
let budgets:any[]=[];
before(async()=>{output=await sharp({create:{width:2,height:2,channels:3,background:'blue'}}).png().toBuffer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='synthetic-new-images';process.env.REDFOX_CALLS_ENABLED='true';process.env.MODEL_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.media','redfox.image','redfox.poll')`;await sql`UPDATE budgets SET per_minute=10000,per_hour=100000,per_day=1000000 WHERE service IN ('redfox.media','redfox.image','redfox.poll')`;});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
after(async()=>{for(const id of runs){const r=await row(id);if(!['completed','failed'].includes(r.status))await sql.begin(tx=>abandonRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation},'test cleanup'));}for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();await rm(dir,{recursive:true,force:true});});
async function job(id:number,due=false){const r=await row(id);if(due){await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${id}`;await sql`UPDATE pgboss.job SET start_after=now()-interval '1 second' WHERE id=${r.job_id}`;}await sql`UPDATE pgboss.job SET priority=2000000000 WHERE id=${r.job_id}`;const boss=await getBoss(),jobs=await boss.fetch<{runId:number;stepVersion:number}>(QUEUES.operation,{minPriority:2000000000});assert.equal(jobs.length,1);assert.equal(jobs[0]!.id,r.job_id);await executeOperationStep(id,jobs[0]!.data.stepVersion,jobs[0]!.id);await boss.complete(QUEUES.operation,jobs[0]!.id);}
const params=(model:string,fileKeys:string[]=[])=>({model,prompt:' Synthetic prompt ',fileKeys,...(model==='gptImage25'?{resolution:'2k',size:'16:9'}:model==='geminiBanana21'?{metadata:{resolution:'2K'},size:'16:9'}:model==='seedreamLite'?{size:'2K',sequentialImageGeneration:'auto',sequentialImageGenerationOptions:{maxImages:10}}:{size:'1K',watermark:false})});
async function create(model:string,fileKeys:string[]=[],extra={}){const r=await createImageGeneration({...params(model,fileKeys),...extra},'new-image-test',tag());runs.push(r.id);return r;}
async function asset(width=2,height=2){const bytes=await sharp({create:{width,height,channels:3,background:'red'}}).png().toBuffer(),temp=await prepareUpload();try{const content=await writeUpload(Readable.from(bytes),temp.file,new AbortController().signal);return await publishUpload({actor:'test',key:uploadKey('test',tag()),file:temp.file,filename:'synthetic.png',mime:'image/png',...(width>2?{purpose:'operation-output' as const}:{}),...content});}finally{await temp.release();}}
async function query(model:ImageModel){const r=await createImageQuery({model,taskId:' opaque task | '},'test',tag());runs.push(r.id);return r;}
async function recover(id:number){const [count]=await sql`SELECT count(*)::int n FROM operation_runs WHERE status IN ('active','waiting')`;for(let i=0;i<Math.ceil(count!.n/200)+3;i++){await recoverOperations();if((await row(id)).job_id)return;}assert.fail('missing recovery job');}

test('available models use their fixed endpoints and general reference upload; output uses existing private save',async()=>{
 mode='ok';for(const model of ['gptImage25','geminiBanana21','seedreamPro'] as const){const a=await asset(),r=await create(model,[a.key]),n=calls.length;assert.equal(r.limits.steps,80);assert.equal(r.limits.saveAttempts,30);await job(r.id);assert.equal(calls[n]!.url,'/story/api/parseWork/videoGen/uploadFile?format=png');assert.match(calls[n]!.type,/multipart/);await job(r.id);const submit=calls[n+1]!;assert.equal(submit.url,newImagePaths[imagePairs[model].submit]);assert.equal(submit.body.prompt,' Synthetic prompt ');assert.equal(submit.body.n,undefined);assert.equal(submit.body.model,undefined);assert.equal(submit.body.referenceUploads,undefined);if(model==='gptImage25')assert.equal(submit.body.referenceImages.length,1);else if(model==='geminiBanana21'){assert.equal(submit.body.imageUrls.length,1);assert.equal(submit.body.metadata.resolution,'2K');}else{assert.equal(submit.body.image.length,1);assert.equal(submit.body.responseFormat,'url');}
 await job(r.id,true);assert.equal(calls[n+2]!.url,newImagePaths[imagePairs[model].poll]);await job(r.id);assert.equal((await row(r.id)).status,'completed');const [out]=await sql`SELECT * FROM operation_results WHERE run_id=${r.id} AND kind='image'`;assert.ok(out!.file_key);}
});
test('explicit same-asset upload is frozen; unselected historical upload is not automatically reused',async()=>{
 const a=await asset(),upload=await createMediaUpload({fileKey:a.key},'test',tag());runs.push(upload.id);await job(upload.id);const [result]=await sql`SELECT id FROM operation_results WHERE run_id=${upload.id}`;
 const key=tag(),input={...params('gptImage25',[a.key]),referenceUploads:[{fileKey:a.key,resultId:result!.id}]};const r=await createImageGeneration(input,'test',key);runs.push(r.id);assert.equal((await createImageGeneration(input,'test',key)).id,r.id);assert.equal((r.input.confirmedReferenceUploads as any[])[0].resultId,result!.id);
 const n=calls.length;await job(r.id);assert.equal(calls.length,n);const [ref]=await sql`SELECT data FROM operation_results WHERE run_id=${r.id}`;assert.equal(ref!.data.reusedResultId,result!.id);
 const second=await create('gptImage25',[a.key]);await job(second.id);assert.equal(calls.length,n+1);
 const other=await asset();await assert.rejects(createImageGeneration({...params('gptImage25',[other.key]),referenceUploads:[{fileKey:other.key,resultId:result!.id}]},'test',tag()),/Selected upload/);
});
test('strict parameters, local dimensions and single-frame guard reject before run or outbound',async()=>{
 for(const bad of [{...params('gptImage25'),n:1},{...params('gptImage25'),background:'white'},{...params('geminiBanana21'),metadata:{resolution:'2k'}},{...params('seedreamLite'),sequentialImageGeneration:'disabled'},{...params('seedreamPro'),size:'0x10'},{...params('seedreamLite'),size:'10x10'},{...params('seedreamPro'),responseFormat:'b64_json'}])assert.equal(ImageInput.safeParse(bad).success,false);
 const a=await asset(4096,4096),n=calls.length;assert.ok(a.bytes<10_000_000);await assert.rejects(createImageGeneration(params('gptImage25',[a.key]),'test',tag()),/16 MP/);assert.equal(calls.length,n);
 const legacy={prompt:'Synthetic legacy',resolution:'1k',size:'1:1',n:1,fileKeys:[]},key=tag(),old=await createImageGeneration(legacy,'test',key);runs.push(old.id);assert.equal((old.input.parameters as Record<string,unknown>).model,undefined);assert.equal(old.limits.steps,70);assert.equal((await createImageGeneration(legacy,'test',key)).id,old.id);
});
test('family poll schemas preserve failed/null and reject success contradictions, wrong IDs and string arrays',()=>{
 for(const model of ['gptImage25','geminiBanana21','seedreamPro','seedreamLite'] as const){const success=model.startsWith('seedream')?'succeeded':'completed',pending=model.startsWith('seedream')?'running':'in_progress';assert.equal(parseImagePoll({taskId:'x',status:pending},'x',model).status,pending);assert.equal(parseImagePoll({taskId:'x',status:'failed',failReason:null},'x',model).failReason,null);for(const data of [{taskId:'x',status:success,imageUrls:[]},{taskId:'x',status:success,imageUrls:'["https://example.test/a"]'},{taskId:'wrong',status:pending},{taskId:'x',status:success,imageUrls:['https://example.test/a'],failReason:'failure'}])assert.throws(()=>parseImagePoll(data,'x',model));}
});
test('ten outputs save separately; usage is not a progress or count authority and small frozen save limit applies',async()=>{
 outputs=10;mode='ok';const r=await query('seedreamLite');await job(r.id);for(let i=0;i<10;i++)await job(r.id);assert.equal((await row(r.id)).status,'completed');assert.equal((await sql`SELECT count(*)::int n FROM operation_results WHERE run_id=${r.id} AND kind='image'`)[0]!.n,10);
 outputs=1;const small=await query('seedreamPro');await sql`UPDATE operation_runs SET limits=limits||'{"saveAttempts":0}'::jsonb WHERE id=${small.id}`;await job(small.id);const n=calls.length;await job(small.id);assert.equal((await row(small.id)).status,'needs_review');assert.equal(calls.length,n);
});
test('generation gates cover uploads, polls and remote save; received response recovers without either gate or key',async()=>{
 const a=await asset();process.env.MODEL_CALLS_ENABLED='false';const n=calls.length;
 try{const r=await create('geminiBanana21',[a.key]);await job(r.id);assert.equal((await row(r.id)).current_receipt_id,null);const q=await query('seedreamPro');await job(q.id);assert.equal((await row(q.id)).current_receipt_id,null);assert.equal(calls.length,n);}finally{process.env.MODEL_CALLS_ENABLED='true';}
 const q=await query('seedreamPro'),initial=await row(q.id),execution=await sql.begin(tx=>claimRun(tx,{runId:q.id,stepVersion:initial.step_version,generation:initial.generation},initial.job_id));await pollImage(initial.progress.taskId,`run:${q.id}:poll:0`,receiptOptions(execution),'seedreamPro');await sql`UPDATE pgboss.job SET state='completed' WHERE id=${initial.job_id}`;await sql`UPDATE operation_runs SET job_id=NULL WHERE id=${q.id}`;process.env.REDFOX_CALLS_ENABLED='false';process.env.MODEL_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;const count=calls.length,before=downloads;
 try{await recover(q.id);await job(q.id);assert.equal((await row(q.id)).step_key,'redfox.image.save');await job(q.id);assert.equal((await row(q.id)).status,'waiting');assert.equal(calls.length,count);assert.equal(downloads,before);}finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.MODEL_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-new-images';}
});
test('new uploads and submits remain manual unknown; readonly poll retries original identity only once',async()=>{
 mode='disconnect';const a=await asset(),u=await create('gptImage25',[a.key]),s=await create('seedreamPro');for(const r of [u,s]){await job(r.id);const current=await row(r.id);assert.equal(current.status,'needs_review');assert.equal((await releaseOperationReceipt(current.current_receipt_id,true)).released,false);}
 const q=await query('geminiBanana21');await job(q.id);const current=await row(q.id);assert.equal(current.status,'waiting');assert.equal((await releaseOperationReceipt(current.current_receipt_id)).released,false);await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${current.current_receipt_id}`;assert.equal((await releaseOperationReceipt(current.current_receipt_id)).released,true);await job(q.id);assert.equal((await row(q.id)).status,'needs_review');assert.equal((await row(q.id)).current_receipt_id,current.current_receipt_id);mode='ok';
});
test('malformed received response replays locally without another attempt; new model HTTP options and intent remain explicit',async()=>{
 mode='bad';const q=await query('gptImage25');await job(q.id);const held=await row(q.id);assert.equal(held.status,'needs_review');const [receipt]=await sql`SELECT * FROM receipts WHERE id=${held.current_receipt_id}`;assert.equal(receipt!.status,'received');const before=calls.length;
 process.env.MODEL_CALLS_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{const {resumeRun}=await import('@aihot/backend/providers/operations/store'),{queueOperationStep}=await import('@aihot/backend/providers/operations/queue');await sql.begin(async tx=>{await resumeRun(tx,{runId:q.id,stepVersion:held.step_version,generation:held.generation});await queueOperationStep(tx,q.id);});await job(q.id);assert.equal((await row(q.id)).status,'needs_review');assert.equal(calls.length,before);assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${receipt!.id}`)[0]!.attempts,1);
 }finally{mode='ok';process.env.MODEL_CALLS_ENABLED='true';process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-new-images';}
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();const oldAdmin=config.devAdmin;
 try{config.devAdmin={displayName:'New images'};const before=calls.length;const options=await app.inject({url:'/api/admin/redfox/images/options'});assert.equal(options.statusCode,200);assert.equal(options.json().models.length,5);assert.deepEqual(options.json().models.find((m:any)=>m.model==='seedreamLite').outputFormats,['png','jpeg']);assert.equal(calls.length,before);
 const headers={'idempotency-key':tag(),'x-csrf-token':'dev'},payload=params('gptImage25');const response=await app.inject({method:'POST',url:'/api/admin/redfox/images',headers,payload});assert.equal(response.statusCode,202);runs.push(response.json().runId);assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/images',headers,payload})).json().runId,response.json().runId);assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/images',headers,payload:{...payload,prompt:'other'}})).statusCode,409);assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/images',headers:{...headers,'idempotency-key':tag()},payload:{...payload,n:1}})).statusCode,400);assert.equal(calls.length,before);
 }finally{config.devAdmin=oldAdmin;await app.close();}
});
test('each fixed family advances a pending poll then persists terminal failure; frozen step limit is authoritative',async()=>{
 for(const model of ['gptImage25','geminiBanana21','seedreamPro','seedreamLite'] as const){mode='pending';const q=await query(model);await job(q.id);assert.equal((await row(q.id)).progress.pollSequence,1);mode='failed';await job(q.id,true);assert.equal((await row(q.id)).status,'failed');assert.equal((await sql`SELECT count(*)::int n FROM operation_results WHERE run_id=${q.id} AND kind='image_task'`)[0]!.n,2);}
 mode='ok';const q=await query('gptImage25');await sql`UPDATE operation_runs SET limits=limits||'{"steps":0}'::jsonb WHERE id=${q.id}`;const before=calls.length;await job(q.id);assert.equal((await row(q.id)).status,'needs_review');assert.equal(calls.length,before);
});

// Freeze the same persisted input that a Lite command created before retirement.
async function legacyLite(fileKeys:string[]=[]){
 const r=await create('seedreamPro',fileKeys),parameters=ImageInput.parse(params('seedreamLite',fileKeys));
 const input={...r.input,parameters,commandIntent:{operation:'redfox.image.generate',parameters}};
 await sql`UPDATE operation_runs SET input=${sql.json(input as never)} WHERE id=${r.id}`;
 return await row(r.id);
}
test('Lite new commands reject before asset access; historical idempotency and query stay available',async()=>{
 const before=calls.length;
 await assert.rejects(createImageGeneration(params('seedreamLite',['missing-asset']),'test',tag()),/已停止新生成/);
 const r=await legacyLite();
 assert.equal((await createImageGeneration(r.input.parameters,r.actor,r.command_key)).id,r.id);
 await assert.rejects(createImageGeneration({...r.input.parameters,prompt:'changed'},r.actor,r.command_key),/different input/);
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),oldAdmin=config.devAdmin;
 try{config.devAdmin={displayName:'Lite retirement'};const response=await app.inject({method:'POST',url:'/api/admin/redfox/images',headers:{'idempotency-key':tag(),'x-csrf-token':'dev'},payload:params('seedreamLite')});assert.equal(response.statusCode,400);
 const options=await app.inject({url:'/api/admin/redfox/images/options'});assert.equal(options.json().models.find((m:any)=>m.model==='seedreamLite').generationAvailable,false);
 }finally{config.devAdmin=oldAdmin;await app.close();}
 assert.equal(calls.length,before);
});
test('queued Lite upload and submit stop without outbound, receipts or automatic waiting',async()=>{
 const a=await asset();
 for(const files of [[a.key],[]]){const r=await legacyLite(files),before=calls.length;await job(r.id);const held=await row(r.id);assert.equal(held.status,'needs_review');assert.match(held.wait_reason,/已停止新生成/);assert.equal(held.next_attempt_at,null);assert.equal(held.current_receipt_id,null);assert.equal(calls.length,before);}
});
test('Lite received submit replays task ID without resubmitting; original endpoint polls and saves',async()=>{
 mode='ok';outputs=1;const r=await legacyLite(),execution=await sql.begin(tx=>claimRun(tx,{runId:r.id,stepVersion:r.step_version,generation:r.generation},r.job_id));
 await submitImage(ImageInput.parse(r.input.parameters),[],`run:${r.id}:submit`,receiptOptions(execution));
 await sql`UPDATE pgboss.job SET state='completed' WHERE id=${r.job_id}`;await sql`UPDATE operation_runs SET job_id=NULL WHERE id=${r.id}`;
 const before=calls.length;process.env.MODEL_CALLS_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{await recover(r.id);await job(r.id);assert.equal(calls.length,before);const current=await row(r.id);assert.equal(current.step_key,'redfox.image.poll');assert.equal(current.progress.taskId,'generated-task');}
 finally{process.env.MODEL_CALLS_ENABLED='true';process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-new-images';}
 await job(r.id,true);assert.equal(calls.at(-1)!.url,newImagePaths.WH5U8KZE);await job(r.id);assert.equal((await row(r.id)).status,'completed');
 const [saved]=await sql`SELECT file_key FROM operation_results WHERE run_id=${r.id} AND kind='image'`;assert.ok(saved!.file_key);assert.ok(await (await import('node:fs/promises')).stat(assetPath(saved!.file_key)));
});
test('Lite unknown submit remains manual and cannot release into automatic regeneration',async()=>{
 mode='disconnect';const r=await legacyLite(),execution=await sql.begin(tx=>claimRun(tx,{runId:r.id,stepVersion:r.step_version,generation:r.generation},r.job_id));
 await assert.rejects(submitImage(ImageInput.parse(r.input.parameters),[],`run:${r.id}:submit`,receiptOptions(execution)));
 await sql`UPDATE pgboss.job SET state='completed' WHERE id=${r.job_id}`;await sql`UPDATE operation_runs SET job_id=NULL WHERE id=${r.id}`;
 const before=calls.length;await recoverOperations();const held=await row(r.id);assert.equal(held.status,'needs_review');assert.equal((await releaseOperationReceipt(held.current_receipt_id,true)).released,false);assert.equal(calls.length,before);mode='ok';
});

test('Lite retirement wins over closed outbound gates and exhausted budgets without waiting',async()=>{
 const a=await asset(),before=calls.length;
 const stop=async(files:string[])=>{const r=await legacyLite(files);await job(r.id);const held=await row(r.id);assert.equal(held.status,'needs_review');assert.match(held.wait_reason,/已停止新生成/);assert.equal(held.next_attempt_at,null);assert.equal(held.current_receipt_id,null);};
 process.env.MODEL_CALLS_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{await stop([a.key]);await stop([]);}finally{process.env.MODEL_CALLS_ENABLED='true';process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-new-images';}
 const budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.media','redfox.image')`;
 try{await sql`UPDATE budgets SET per_minute=0,per_hour=0,per_day=0 WHERE service IN ('redfox.media','redfox.image')`;await stop([a.key]);await stop([]);}
 finally{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;}
 assert.equal(calls.length,before);
});

test('Lite busy and unknown receipts bypass retirement, budgets and outbound gates',async()=>{
 mode='ok';const r=await legacyLite(),execution=await sql.begin(tx=>claimRun(tx,{runId:r.id,stepVersion:r.step_version,generation:r.generation},r.job_id));
 const submitted=await submitImage(ImageInput.parse(r.input.parameters),[],`run:${r.id}:submit`,receiptOptions(execution));
 const {executeImageStep}=await import('@aihot/backend/providers/redfox/image-execution');
 const {ReceiptBusyError,ReceiptUnknownError}=await import('@aihot/backend/providers/receipts');
 const [budget]=await sql`SELECT * FROM budgets WHERE service='redfox.image'`,before=calls.length;
 process.env.MODEL_CALLS_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{
  await sql`UPDATE budgets SET per_minute=0 WHERE service='redfox.image'`;
  await sql`UPDATE receipts SET status='pending',updated_at=now() WHERE id=${submitted.receiptId}`;
  await assert.rejects(executeImageStep(execution,(await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${r.id}`)[0]!),ReceiptBusyError);
  await sql`UPDATE receipts SET status='unknown' WHERE id=${submitted.receiptId}`;
  await assert.rejects(executeImageStep(execution,(await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${r.id}`)[0]!),ReceiptUnknownError);
  assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${submitted.receiptId}`)[0]!.attempts,1);assert.equal(calls.length,before);
 }finally{await sql`UPDATE budgets SET per_minute=${budget!.per_minute} WHERE service='redfox.image'`;process.env.MODEL_CALLS_ENABLED='true';process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-new-images';}
});
