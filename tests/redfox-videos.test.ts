import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import http from 'node:http';
import {mkdtemp,rm,readFile,writeFile,unlink,stat,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import sharp from 'sharp';
import {config} from '@aihot/backend/config';
import {sql,closeDb} from '@aihot/backend/db';
import {getBoss,stopBoss,QUEUES} from '@aihot/backend/jobs/queue';
import {prepareUpload,writeUpload,publishUpload,uploadKey,assetPath,deleteAsset,describeGeneratedVideoFile,cleanupAssets} from '@aihot/backend/operations/assets';
import {createVideoGeneration,createVideoQuery} from '@aihot/backend/providers/redfox/videos';
import {VideoInput,parseVideoPoll} from '@aihot/backend/providers/redfox/video-contract';
import {createMediaUpload} from '@aihot/backend/providers/redfox/media-upload';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {releaseOperationReceipt,recoverOperations} from '@aihot/backend/providers/operations/recovery';
import {abandonRun,claimRun,receiptOptions,resumeRun} from '@aihot/backend/providers/operations/store';
import {queueOperationStep} from '@aihot/backend/providers/operations/queue';
import {redfoxRequest} from '@aihot/backend/providers/redfox/client';
const dir=await mkdtemp(path.join(tmpdir(),'aihot-videos-'));config.dataDir=dir;
const runs:number[]=[],calls:Array<{url:string;body:any;type:string}>=[];let video:Buffer,png:Buffer,mode='ok',lastFrame=true,downloadMode='ok',downloads=0;
const server=http.createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
 if(req.url!.startsWith('/output/')){downloads++;assert.equal(req.headers.redfox_api_key,undefined);if(downloadMode==='disconnect'){res.writeHead(200,{'content-length':99999});res.write(video.subarray(0,12));res.destroy();return;}if(downloadMode==='oversize'){res.writeHead(200,{'content-length':50000001});res.end();return;}res.setHeader('content-type','image/bogus');res.end(req.url!.endsWith('frame')||downloadMode==='fake'?png:video);return;}
 assert.equal(req.method,'POST');assert.equal(req.headers.redfox_api_key,'synthetic-video-key');const raw=Buffer.concat(chunks),type=String(req.headers['content-type']),body=type.startsWith('multipart/')?raw:JSON.parse(raw.toString());calls.push({url:req.url!,body,type});
 if(mode==='unknown'){req.socket.destroy();return;}res.setHeader('content-type','application/json');if(mode==='bad'){res.end('{broken');return;}
 let data:any;if(req.url!.includes('uploadFile'))data={imageUrl:`https://supplier.example.test/reference-${calls.length}`,format:new URL(req.url!,'http://localhost').searchParams.get('format')};else if(req.url!.endsWith('seedanceSubmit'))data={taskId:'generated-task'};else data={taskId:mode==='wrong'?'wrong':body.taskId,status:mode==='queued'?'queued':mode==='in_progress'?'in_progress':mode==='pending'?'processing':mode==='failed'?'failed':'completed',progress:['queued','pending'].includes(mode)?0:100,seed:null,model:'upstream-model-label',usage:{unknownUnit:0},failReason:mode==='conflict'?'failure':null,...(!['queued','in_progress','pending','failed'].includes(mode)?{videoUrl:`${process.env.REDFOX_TEST_BASE_URL}/output/video`,lastFrameUrl:lastFrame?`${process.env.REDFOX_TEST_BASE_URL}/output/frame`:null}:{})};
 res.end(JSON.stringify({code:2000,data}));
});});
let budgets:any[]=[];
before(async()=>{video=Buffer.from(JSON.parse(await readFile(new URL('./fixtures/operation-media.json',import.meta.url),'utf8')).files.find((f:any)=>f.filename==='tiny.mp4').base64,'base64');png=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='synthetic-video-key';process.env.REDFOX_CALLS_ENABLED='true';process.env.MODEL_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.video','redfox.media','redfox.poll')`;await sql`UPDATE budgets SET per_minute=10000,per_hour=100000,per_day=1000000 WHERE service IN ('redfox.video','redfox.media','redfox.poll')`;});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
after(async()=>{for(const id of runs){const r=await row(id);if(!['completed','failed'].includes(r.status))await sql.begin(tx=>abandonRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation},'test cleanup'));}for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();await rm(dir,{recursive:true,force:true});});
const input=(refs:Array<{fileKey:string;role:string;uploadResultId?:number}>=[])=>({prompt:' Synthetic video ',aspectRatio:'adaptive',duration:4,resolution:'720p',generateAudio:false,returnLastFrame:true,imageWithRoles:refs});
async function create(refs:Parameters<typeof input>[0]=[]){const r=await createVideoGeneration(input(refs),'video-test',tag());runs.push(r.id);return r;}
async function query(){const r=await createVideoQuery({taskId:' opaque | task '},'test',tag());runs.push(r.id);return r;}
async function asset(){const temp=await prepareUpload();try{const content=await writeUpload(Readable.from(png),temp.file,new AbortController().signal);return await publishUpload({actor:'test',key:uploadKey('test',tag()),file:temp.file,filename:'ref.png',mime:'image/png',...content});}finally{await temp.release();}}
async function job(id:number,due=false){const r=await row(id);if(due){await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${id}`;await sql`UPDATE pgboss.job SET start_after=now()-interval '1 second' WHERE id=${r.job_id}`;}await sql`UPDATE pgboss.job SET priority=2000000000 WHERE id=${r.job_id}`;const boss=await getBoss(),jobs=await boss.fetch<{runId:number;stepVersion:number}>(QUEUES.operation,{minPriority:2000000000});assert.equal(jobs.length,1);assert.equal(jobs[0]!.id,r.job_id);await executeOperationStep(id,jobs[0]!.data.stepVersion,jobs[0]!.id);await boss.complete(QUEUES.operation,jobs[0]!.id);}
async function recover(id:number){await sql`UPDATE operation_runs SET next_attempt_at=CASE WHEN next_attempt_at IS NULL THEN NULL ELSE now()-interval '1 second' END WHERE id=${id}`;const [count]=await sql`SELECT count(*)::int n FROM operation_runs WHERE status IN ('active','waiting')`;for(let i=0;i<Math.ceil(count!.n/200)+3;i++){await recoverOperations();const r=await row(id),[j]=await sql`SELECT state FROM pgboss.job WHERE id=${r.job_id}`;if(j?.state==='created'||j?.state==='retry')return;}assert.fail('video recovery did not enqueue');}
async function resume(id:number){const r=await row(id);await sql.begin(async tx=>{await resumeRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation});await queueOperationStep(tx,id);});}

test('Seedance fixed submit/poll maps ordered roles using one upload per asset and saves video plus last frame',async()=>{
 const a=await asset(),r=await create([{fileKey:a.key,role:'last_frame'},{fileKey:a.key,role:'first_frame'},{fileKey:a.key,role:'reference_image'}]),n=calls.length;assert.equal(r.limits.steps,80);assert.equal(r.limits.saveAttempts,12);await assert.rejects(deleteAsset(a.key),/task/);await job(r.id);assert.equal((await row(r.id)).step_key,'redfox.video.submit');assert.match(calls[n]!.type,/multipart/);assert.ok(calls[n]!.body.includes(png));await job(r.id);assert.equal(calls[n+1]!.url,'/story/api/parseWork/videoGen/seedanceSubmit');const body=calls[n+1]!.body;assert.equal(body.prompt,' Synthetic video ');assert.deepEqual(body.imageWithRoles.map((r:any)=>r.role),['last_frame','first_frame','reference_image']);assert.equal(new Set(body.imageWithRoles.map((r:any)=>r.url)).size,1);assert.equal(body.fileKeys,undefined);assert.equal(body.generateAudio,false);
 mode='pending';await job(r.id,true);assert.equal((await row(r.id)).progress.pollSequence,1);mode='ok';await job(r.id,true);await job(r.id);await job(r.id);assert.equal((await row(r.id)).status,'completed');const results=await sql`SELECT z.*,f.content_type,f.metadata FROM operation_results z LEFT JOIN stored_files f ON f.key=z.file_key WHERE run_id=${r.id}`;const out=results.find(z=>z.kind==='video')!,frame=results.find(z=>z.kind==='image')!;assert.equal(out.content_type,'video/mp4');assert.equal(out.metadata.validation,'type-and-header');assert.equal(out.data.lastFrameMissing,false);assert.equal(frame.content_type,'image/png');assert.equal(frame.data.role,'last_frame');await deleteAsset(a.key);
 const [receipt]=await sql`SELECT p.* FROM receipts p JOIN operation_results z ON z.receipt_id=p.id WHERE z.run_id=${r.id} AND z.item_key='submission'`;assert.equal(receipt!.service,'redfox.video');assert.equal(Number(receipt!.cost),15);assert.equal(receipt!.cost_basis,'estimated');assert.ok(!JSON.stringify({results,receipt,run:await row(r.id)}).includes('synthetic-video-key'));
});
test('explicit selected upload is reused, text-only works and absent requested last frame is stated',async()=>{
 const a=await asset(),upload=await createMediaUpload({fileKey:a.key},'test',tag());runs.push(upload.id);await job(upload.id);const [selected]=await sql`SELECT id FROM operation_results WHERE run_id=${upload.id}`;const r=await create([{fileKey:a.key,role:'first_frame',uploadResultId:selected!.id}]),n=calls.length;await job(r.id);assert.equal(calls.length,n);const [ref]=await sql`SELECT data FROM operation_results WHERE run_id=${r.id}`;assert.equal(ref!.data.reusedResultId,selected!.id);
 lastFrame=false;const text=await create();await job(text.id);assert.deepEqual(calls.at(-1)!.body.imageWithRoles,[]);await job(text.id,true);await job(text.id);assert.equal((await row(text.id)).status,'completed');const [video]=await sql`SELECT data FROM operation_results WHERE run_id=${text.id} AND kind='video'`;assert.equal(video!.data.lastFrameMissing,true);lastFrame=true;
});
test('role limits and strict commands reject before runs; HTTP options/auth/CSRF/idempotency are local',async()=>{
 const a=await asset(),eleven=[{fileKey:a.key,role:'first_frame'},{fileKey:a.key,role:'last_frame'},...Array.from({length:9},()=>({fileKey:a.key,role:'reference_image'}))];assert.equal(VideoInput.safeParse(input(eleven)).success,true);
 for(const bad of [{...input(),duration:3},{...input(),duration:16},{...input(),resolution:'1080p'},{...input(),audioWithRoles:[]},input([{fileKey:a.key,role:'first_frame'},{fileKey:a.key,role:'first_frame'}]),input([{fileKey:a.key,role:'first_frame',uploadResultId:1},{fileKey:a.key,role:'last_frame',uploadResultId:2}])])assert.equal(VideoInput.safeParse(bad).success,false);
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),old=config.devAdmin,before=calls.length;try{config.devAdmin=null;assert.equal((await app.inject({url:'/api/admin/redfox/videos/options'})).statusCode,401);config.devAdmin={displayName:'Video test'};assert.equal((await app.inject({url:'/api/admin/redfox/videos/options'})).json().roles.reference_image,9);assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/videos',payload:input()})).statusCode,403);const headers={'idempotency-key':tag(),'x-csrf-token':'dev'},payload=input();assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/videos',headers,payload:{...payload,duration:3}})).statusCode,400);const first=await app.inject({method:'POST',url:'/api/admin/redfox/videos',headers,payload});assert.equal(first.statusCode,202);runs.push(first.json().runId);assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/videos',headers,payload})).json().runId,first.json().runId);assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/videos',headers,payload:{...payload,duration:5}})).statusCode,409);assert.equal(calls.length,before);}finally{config.devAdmin=old;await app.close();}
});
test('strict poll preserves zero/null/extra fields, rejects conflicting success and wrong task; failed task is terminal',async()=>{
 const base={taskId:'x',status:'processing',progress:0,seed:null,usage:null,extra:{zero:0}};assert.deepEqual(parseVideoPoll(base,'x'),base);for(const status of ['in_progress','queued']){const raw={...base,status};assert.deepEqual(parseVideoPoll(raw,'x'),base);assert.equal(raw.status,status);assert.throws(()=>parseVideoPoll({...raw,taskId:'other'},'x'));}for(const bad of [{...base,taskId:'y'},{...base,status:'unknown'},{...base,status:'completed'},{...base,status:'completed',videoUrl:'https://example.test/v',failReason:'failure'},{...base,status:'completed',videoUrl:'https://secret@example.test/v'}])assert.throws(()=>parseVideoPoll(bad,'x'));
 mode='failed';const r=await query();await job(r.id);assert.equal((await row(r.id)).status,'failed');mode='ok';
});
test('unknown upload/submit remain manual; poll waits thirty minutes and retries the original receipt once',async()=>{
 mode='unknown';const a=await asset();for(const r of [await create([{fileKey:a.key,role:'first_frame'}]),await create()]){await job(r.id);const held=await row(r.id);assert.equal(held.status,'needs_review');await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${held.current_receipt_id}`;assert.equal((await releaseOperationReceipt(held.current_receipt_id,true)).released,false);}
 const q=await query();await job(q.id);const held=await row(q.id);assert.equal(held.status,'waiting');assert.equal((await releaseOperationReceipt(held.current_receipt_id)).released,false);await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${held.current_receipt_id}`;assert.equal((await releaseOperationReceipt(held.current_receipt_id)).released,true);await job(q.id);assert.equal((await row(q.id)).status,'needs_review');assert.equal((await row(q.id)).current_receipt_id,held.current_receipt_id);mode='ok';
});
test('both generation gates and budgets prevent attempts; standalone general upload ignores MODEL and missing local file rolls back',async()=>{
 const before=calls.length;for(const gate of ['MODEL_CALLS_ENABLED','REDFOX_CALLS_ENABLED']){process.env[gate]='false';try{const r=await create(),q=await query();for(const run of [r,q]){await job(run.id);assert.equal((await row(run.id)).current_receipt_id,null);}}finally{process.env[gate]='true';}}assert.equal(calls.length,before);
 await sql`UPDATE budgets SET per_minute=0,per_hour=0,per_day=0 WHERE service='redfox.video'`;try{const r=await create();await job(r.id);assert.equal((await row(r.id)).current_receipt_id,null);assert.equal(calls.length,before);}finally{await sql`UPDATE budgets SET per_minute=10000,per_hour=100000,per_day=1000000 WHERE service='redfox.video'`;}
 const a=await asset(),r=await create([{fileKey:a.key,role:'reference_image'}]);await unlink(assetPath(a.key));await job(r.id);assert.equal((await row(r.id)).current_receipt_id,null);
 const b=await asset(),standalone=await createMediaUpload({fileKey:b.key},'test',tag());runs.push(standalone.id);process.env.MODEL_CALLS_ENABLED='false';try{await job(standalone.id);assert.equal((await row(standalone.id)).status,'completed');}finally{process.env.MODEL_CALLS_ENABLED='true';}
});
test('malformed received poll replays without new call; a received lost-job poll recovers with both gates/key off',async()=>{
 mode='bad';const r=await query();await job(r.id);const held=await row(r.id);assert.equal(held.status,'needs_review');const [receipt]=await sql`SELECT * FROM receipts WHERE id=${held.current_receipt_id}`;assert.equal(receipt!.status,'received');const count=calls.length;process.env.MODEL_CALLS_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;try{await resume(r.id);await job(r.id);assert.equal((await row(r.id)).status,'needs_review');assert.equal(calls.length,count);}finally{mode='ok';process.env.MODEL_CALLS_ENABLED='true';process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-video-key';}
 const q=await query(),initial=await row(q.id),execution=await sql.begin(tx=>claimRun(tx,{runId:q.id,stepVersion:initial.step_version,generation:initial.generation},initial.job_id));await redfoxRequest('VBALJNC7',{taskId:initial.progress.taskId},`run:${q.id}:poll:0`,'poll',receiptOptions(execution));await sql`UPDATE pgboss.job SET state='completed' WHERE id=${initial.job_id}`;const n=calls.length;process.env.MODEL_CALLS_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;try{await recover(q.id);await job(q.id);assert.equal((await row(q.id)).step_key,'redfox.video.save');const d=downloads;await job(q.id);assert.equal((await row(q.id)).status,'waiting');assert.equal(downloads,d);assert.equal(calls.length,n);}finally{process.env.MODEL_CALLS_ENABLED='true';process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-video-key';}
});
test('download failures remain save-only; actual bytes reject false video/oversize/disconnect then reuse completed video',async()=>{
 const q=await query();await job(q.id);const n=calls.length,d=downloads;for(const failure of ['fake','oversize','disconnect']){downloadMode=failure;await job(q.id);assert.equal((await row(q.id)).status,'needs_review');assert.equal((await row(q.id)).step_key,'redfox.video.save');assert.equal((await sql`SELECT 1 FROM operation_results WHERE run_id=${q.id} AND kind='video'`).length,0);await resume(q.id);}downloadMode='ok';await job(q.id);assert.equal((await row(q.id)).progress.saveIndex,1);await job(q.id);assert.equal((await row(q.id)).status,'completed');assert.equal(calls.length,n);assert.equal(downloads,d+5);
});
test('complete orphan is pinned through cleanup and recovered locally, while frozen save limit cannot expand',async()=>{
 lastFrame=false;const q=await query();await job(q.id);const saving=await row(q.id),key=saving.progress.expectedFileKey,temp=await prepareUpload(50_000_000);try{await writeFile(temp.file,video);const description=await describeGeneratedVideoFile(temp.file);await assert.rejects(sql.begin(async tx=>{await publishUpload({actor:'test',key,...description},tx);throw new Error('synthetic interruption');}),/interruption/);}finally{await temp.release();}
 const old=new Date(Date.now()-3*86400_000);await utimes(assetPath(key),old,old);await cleanupAssets();await stat(assetPath(key));await sql`UPDATE pgboss.job SET state='completed' WHERE id=${saving.job_id}`;const before=downloads;process.env.MODEL_CALLS_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='false';try{await recover(q.id);await job(q.id);assert.equal((await row(q.id)).status,'completed');assert.equal(downloads,before);}finally{process.env.MODEL_CALLS_ENABLED='true';process.env.REDFOX_CALLS_ENABLED='true';lastFrame=true;}
 const small=await query();await sql`UPDATE operation_runs SET limits=limits||'{"saveAttempts":0}'::jsonb WHERE id=${small.id}`;await job(small.id);await job(small.id);assert.equal((await row(small.id)).status,'needs_review');assert.equal(downloads,before);
});
test('downloaded container bytes choose canonical MIME and filename independently of URL and Content-Type',async()=>{
 const original=video;lastFrame=false;try{const fixtures=JSON.parse(await readFile(new URL('./fixtures/operation-media.json',import.meta.url),'utf8')).files;for(const [format,mime] of [['webm','video/webm'],['mov','video/quicktime']]){video=Buffer.from(fixtures.find((f:any)=>f.filename===`tiny.${format}`).base64,'base64');const q=await query();await job(q.id);await job(q.id);assert.equal((await row(q.id)).status,'completed');const [file]=await sql`SELECT z.data,f.content_type,f.metadata FROM operation_results z JOIN stored_files f ON f.key=z.file_key WHERE z.run_id=${q.id} AND z.kind='video'`;assert.equal(file!.data.lastFrameMissing,undefined);assert.equal(file!.content_type,mime);assert.equal(file!.metadata.filename,`generated.${format}`);assert.equal(file!.metadata.validation,'type-and-header');}}finally{video=original;lastFrame=true;}
});

test('member video continuation preserves required last frame and settles only full delivery',async()=>{
 const {grantCredits,saveToolPrice,readRunCredits}=await import('@aihot/backend/users/credits');
 const {quoteUserTool,submitUserTool,controlUserTool}=await import('@aihot/backend/users/tools');
 for(const deliveredFrame of [false,true]){
  const unique=tag(),prompt=`Continuation ${unique}`;
  const [user]=await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`video-${unique}`},'Video recovery','synthetic') RETURNING id`;
  await grantCredits(user.id,{amount:30,reason:'Recovery test'},'test',tag());
  await saveToolPrice({kind:'videos',provider:'redfox',model:'seedance',tier:'720p',parameterMatch:{prompt},baseCredits:9,enabled:true,reason:'Recovery test'},'test');
  const submit=async(kind:string,value:unknown)=>{const request={kind,input:value},q=await quoteUserTool(user.id,request);const r=await submitUserTool(user.id,kind,{input:value,quoteId:q.quoteId},tag());runs.push(r.runId);return r.runId;};
  const root=await submit('videos',{...input(),prompt});await job(root);
  const stopped=await row(root);await controlUserTool(user.id,root,'stop',{stepVersion:stopped.step_version,generation:stopped.generation,reason:'Continue polling'});
  const child=await submit('videos/query',{runId:root});
  assert.equal((await row(child)).input.deliveryParameters.returnLastFrame,true);
  lastFrame=deliveredFrame;
  try{await job(child);
   if(!deliveredFrame)await sql`UPDATE operation_runs SET input=input-'deliveryParameters',progress=progress-'lastFrameMissing' WHERE id=${child}`;
   await job(child);if(deliveredFrame)await job(child);
   const charge=await readRunCredits(user.id,child);
   assert.equal(charge?.state,deliveredFrame?'settled':'review');assert.equal(charge?.consumed,deliveredFrame?9:0);
   const [saved]=await sql`SELECT data FROM operation_results WHERE run_id=${child} AND kind='video'`;
   assert.equal(saved.data.lastFrameMissing,!deliveredFrame);
  }finally{lastFrame=true;}
 }
});


test('observed queued and in_progress keep one member generation polling until delivery and charge once',async()=>{
 const {grantCredits,saveToolPrice,readRunCredits}=await import('@aihot/backend/users/credits');
 const {quoteUserTool,submitUserTool}=await import('@aihot/backend/users/tools');
 const unique=tag(),prompt=`Pending alias ${unique}`;
 const [user]=await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`video-${unique}`},'Polling test','synthetic') RETURNING id`;
 await grantCredits(user.id,{amount:30,reason:'Polling regression'},'test',tag());
 await saveToolPrice({kind:'videos',provider:'redfox',model:'seedance',tier:'720p',parameterMatch:{prompt},baseCredits:9,enabled:true,reason:'Polling regression'},'test');
 const value={...input(),prompt},q=await quoteUserTool(user.id,{kind:'videos',input:value});
 const r=await submitUserTool(user.id,'videos',{input:value,quoteId:q.quoteId},tag());runs.push(r.runId);
 const before=calls.length;await job(r.runId);
 try{
  for(const status of ['queued','in_progress','pending']){mode=status;await job(r.runId,true);assert.equal((await row(r.runId)).status,'waiting');assert.equal((await row(r.runId)).step_key,'redfox.video.poll');assert.equal((await readRunCredits(user.id,r.runId))?.consumed,0);}
  assert.equal((await row(r.runId)).progress.pollSequence,3);
  mode='ok';await job(r.runId,true);await job(r.runId);await job(r.runId);
  assert.equal((await row(r.runId)).status,'completed');assert.equal((await readRunCredits(user.id,r.runId))?.consumed,9);
  assert.equal(calls.slice(before).filter(call=>call.url.endsWith('seedanceSubmit')).length,1);
  assert.equal(calls.slice(before).filter(call=>call.url.endsWith('seedanceResult')).length,4);
  for(const status of ['queued','in_progress']){const [raw]=await sql`SELECT p.response FROM receipts p JOIN operation_results s ON s.receipt_id=p.id WHERE s.run_id=${r.runId} AND p.response::text LIKE ${`%${status}%`} LIMIT 1`;assert.ok(raw);assert.equal(JSON.parse(raw.response.body).data.status,status);}
 }finally{mode='ok';}
});
