import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { config } from '@aihot/backend/config';
import { sql, closeDb } from '@aihot/backend/db';
import { getBoss, stopBoss, QUEUES } from '@aihot/backend/jobs/queue';
import { prepareUpload, writeUpload, publishUpload, uploadKey, assetPath, deleteAsset, describeGeneratedVideoFile } from '@aihot/backend/operations/assets';
import { probeVideo } from '@aihot/backend/operations/video-probe';
import { createWanGeneration } from '@aihot/backend/providers/aliyun/wan';
import { WanInput, parseWanResponse } from '@aihot/backend/providers/aliyun/wan-contract';
import { wanConfig } from '@aihot/backend/providers/aliyun/wan-config';
import { wanMedia } from '@aihot/backend/providers/aliyun/wan-media';
import { wanTaskCosts } from '@aihot/backend/providers/aliyun/wan-costs';
import { executeOperationStep } from '@aihot/backend/providers/operations/execute';
import { operationDetail, operationResults, controlOperation } from '@aihot/backend/providers/operations/read';
import { releaseOperationReceipt, recoverOperations } from '@aihot/backend/providers/operations/recovery';
import { abandonRun, claimRun, receiptOptions, resumeRun } from '@aihot/backend/providers/operations/store';
import { queueOperationStep } from '@aihot/backend/providers/operations/queue';
import { wanRequest } from '@aihot/backend/providers/aliyun/wan-client';
import { uploadWanObject } from '@aihot/backend/providers/aliyun/wan-oss';
import { paidRequest } from '@aihot/backend/providers/receipts';
import { quoteUserTool, submitUserTool } from '@aihot/backend/users/tools';
import { grantCredits, saveToolPrice, readRunCredits } from '@aihot/backend/users/credits';
import { userToolDetail } from '@aihot/backend/users/tool-read';
const dir = await mkdtemp(path.join(tmpdir(), 'aihot-wan-tests-')); config.dataDir = dir;
const runs: number[] = [], calls: Array<{ method: string; pathname: string; body: any }> = [];
const workspace = `test-${tag()}`;
let video: Buffer, png: Buffer, status = 'SUCCEEDED', fault = '', downloads = 0, taskCounter = 0, outputBad = false;
const server = http.createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
  const url = new URL(req.url!, 'http://localhost'), raw = Buffer.concat(chunks);
  if (url.pathname === '/output.mp4') { downloads++; assert.equal(req.headers.authorization, undefined); res.end(outputBad ? png : video); return; }
  if (req.method === 'PUT') { assert.equal(url.searchParams.get('x-oss-signature-version'), 'OSS4-HMAC-SHA256'); assert.equal(req.headers['x-oss-object-acl'], 'private'); assert.ok(raw.equals(png) || raw.equals(video)); assert.ok(url.pathname.endsWith(raw.equals(video) ? '.mp4' : '.png')); assert.equal(req.headers['content-type'], raw.equals(video) ? 'video/mp4' : 'image/png'); calls.push({ method: 'PUT', pathname: url.pathname, body: null }); res.end(); return; }
  assert.equal(req.headers.authorization, 'Bearer synthetic-wan-key');
  const body = raw.length ? JSON.parse(raw.toString()) : null; calls.push({ method: req.method!, pathname: url.pathname, body });
  if (fault === 'unknown') { req.socket.destroy(); return; }
  if (fault === '429') { res.statusCode = 429; res.end('{}'); return; }
  if (fault === 'malformed') { res.end('{broken'); return; }
  res.setHeader('content-type', 'application/json');
  if (req.method === 'POST') { assert.equal(req.headers['x-dashscope-async'], 'enable'); assert.equal(body.input.watermark, true); assert.equal(body.parameters.check_image, true); assert.match(body.input.image_url, /x-oss-signature=/); res.end(JSON.stringify({ output: { task_id: `task-${++taskCounter}`, task_status: 'PENDING' } })); }
  else res.end(JSON.stringify({ output: { task_id: fault === 'wrong' ? 'other-task' : url.pathname.split('/').at(-1), task_status: status, ...(status === 'SUCCEEDED' ? { results: { video_url: `${process.env.ALIYUN_WAN_TEST_BASE_URL}/output.mp4?Signature=private-output` } } : {}) }, ...(status === 'SUCCEEDED' && fault !== 'no-usage' ? { usage: { video_duration: 3.2, video_ratio: 'standard' } } : {}) }));
}); });
const row = async (id: number) => (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
before(async () => {
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x320:rate=15','-t','3.2','-c:v','libx264','-pix_fmt','yuv420p',path.join(dir,'reference.mp4')]);
  video = await readFile(path.join(dir,'reference.mp4')); png = await sharp({create:{width:300,height:300,channels:3,background:'#487aaf'}}).png().toBuffer();
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r)); const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  Object.assign(process.env, { ALIYUN_WAN_TEST_BASE_URL:base, ALIYUN_WAN_OSS_TEST_BASE_URL:base, ALIYUN_WAN_OSS_BUCKET:'wan-test-bucket', ALIYUN_WAN_WORKSPACE_ID:workspace, DASHSCOPE_API_KEY:'synthetic-wan-key', ALIYUN_WAN_OSS_ACCESS_KEY_ID:'synthetic-oss-id', ALIYUN_WAN_OSS_ACCESS_KEY_SECRET:'synthetic-oss-secret', ALIYUN_WAN_CALLS_ENABLED:'true', MODEL_CALLS_ENABLED:'true' });
  config.allowPrivateNetworkFetch=true;
  await sql`UPDATE budgets SET per_minute=10000,per_hour=100000,per_day=1000000 WHERE service LIKE 'aliyun.wan.%'`;
});
after(async () => { for(const id of runs){const r=await row(id); if(!['completed','failed'].includes(r.status))await sql.begin(tx=>abandonRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation},'test cleanup'));} await sql`UPDATE budgets SET per_minute=0,per_hour=0,per_day=0 WHERE service LIKE 'aliyun.wan.%'`; await new Promise<void>(r=>server.close(()=>r())); await stopBoss(); await closeDb(); await rm(dir,{recursive:true,force:true}); });
async function asset(kind:'image'|'video',actor='wan-test',buffer?:Buffer) { const temp=await prepareUpload(50_000_000); try { const content=await writeUpload(Readable.from(buffer??(kind==='image'?png:video)),temp.file,new AbortController().signal,50_000_000); return await publishUpload({actor,key:uploadKey(actor,tag()),file:temp.file,filename:kind==='image'?'portrait.png':'reference.mp4',mime:kind==='image'?'image/png':'video/mp4',...content}); } finally{await temp.release();} }
async function input(actor='wan-test') {const a=await asset('image',actor), b=await asset('video',actor); return {provider:'aliyun',model:'wan2.2-animate-mix',mode:'wan-std',portraitFileKey:a.key,referenceVideoFileKey:b.key};}
async function create() {const r=await createWanGeneration(await input(),'wan-test',tag());runs.push(r.id);return r;}
async function job(id:number) {const r=await row(id);await sql`UPDATE operation_runs SET next_attempt_at=CASE WHEN status='waiting' THEN now()-interval '1 second' ELSE next_attempt_at END WHERE id=${id}`;await sql`UPDATE pgboss.job SET start_after=now()-interval '1 second',priority=2000000000 WHERE id=${r.job_id}`;const boss=await getBoss(),jobs=await boss.fetch<{runId:number;stepVersion:number}>(QUEUES.operation,{minPriority:2000000000});assert.equal(jobs.length,1);assert.equal(jobs[0]!.id,r.job_id);await executeOperationStep(id,jobs[0]!.data.stepVersion,jobs[0]!.id);await boss.complete(QUEUES.operation,jobs[0]!.id);}
async function resume(id:number){const r=await row(id);await sql.begin(async tx=>{await resumeRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation});await queueOperationStep(tx,id);});}
async function submitted(){const r=await create();await job(r.id);await job(r.id);await job(r.id);assert.equal((await row(r.id)).step_key,'aliyun.wan.poll');return r;}

test('strict two-file contract, real server media facts and malformed media rejection',async()=>{
 const p=await input(),m=await wanMedia(p,'wan-test');assert.equal(m.videoSeconds,4);assert.equal(m.facts.durationMs,3200);
 assert.equal(WanInput.safeParse({...p,duration:1}).success,false);assert.equal(WanInput.safeParse({...p,videoUrl:'https://example.com'}).success,false);
 const small=await asset('image','wan-test',await sharp({create:{width:20,height:20,channels:3,background:'red'}}).png().toBuffer());await assert.rejects(wanMedia({...p,portraitFileKey:small.key},'wan-test'),/人物照片/);
 const fake=path.join(dir,'fake.mp4');await writeFile(fake,png);await assert.rejects(probeVideo(fake));
 const tiny=path.join(dir,'tiny.mp4');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=size=320x320','-t','1','-c:v','libx264',tiny]);const a=await asset('video','wan-test',await readFile(tiny));await assert.rejects(wanMedia({...p,referenceVideoFileKey:a.key},'wan-test'),/2–30/);
});
test('legacy OSS receipt reuses its exact object without another upload after suffix fix', async () => {
 const file=await asset('video'), config=wanConfig(), runId=987654321, role='reference', hash=file.sha256, fileKey=file.key;
 const objectKey=`${config.prefix}${runId}/${role}/${hash}`;
 const prior=await paidRequest({service:'aliyun.wan.media',model:'oss',purpose:'wan.media',identity:{config,runId,role,fileKey,hash}},async()=>({response:{status:200,objectKey,expiresAt:new Date(Date.now()+86400000).toISOString()}}));
 const count=calls.length, gates=[process.env.MODEL_CALLS_ENABLED,process.env.ALIYUN_WAN_CALLS_ENABLED];
 process.env.MODEL_CALLS_ENABLED='false';process.env.ALIYUN_WAN_CALLS_ENABLED='false';
 try { const reused=await uploadWanObject(config,runId,role,fileKey,hash,{}); assert.equal(reused.receiptId,prior.receiptId); assert.equal(reused.object.objectKey,objectKey); assert.equal(calls.length,count); }
 finally { [process.env.MODEL_CALLS_ENABLED,process.env.ALIYUN_WAN_CALLS_ENABLED]=gates; }
});
test('media duration boundaries, audio-only files and bounded probe failure do not call suppliers', async () => {
 const p = await input(), beforeCalls = calls.length;
 for (const seconds of [2, 30, 30.1]) {
  const file = path.join(dir, `boundary-${seconds}.mp4`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=size=320x320:rate=10', '-t', String(seconds), '-c:v', 'libx264', file]);
  const uploaded = await asset('video', 'wan-test', await readFile(file));
  if (seconds > 30) await assert.rejects(wanMedia({ ...p, referenceVideoFileKey: uploaded.key }, 'wan-test'), /2–30/);
  else assert.equal((await wanMedia({ ...p, referenceVideoFileKey: uploaded.key }, 'wan-test')).videoSeconds, seconds);
 }
 const audio = path.join(dir, 'audio-only.mp4');
 execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc', '-t', '2', '-c:a', 'aac', audio]);
 await assert.rejects(probeVideo(audio), /元数据无效/);
 const stalled = path.join(dir, 'stalled-probe');
 await writeFile(stalled, '#!/bin/sh\nexec /bin/sleep 20\n'); await chmod(stalled, 0o700);
 const previous = process.env.FFPROBE_PATH, started = Date.now();
 try { process.env.FFPROBE_PATH = stalled; await assert.rejects(probeVideo(audio), /无法检查视频/); }
 finally { if (previous === undefined) delete process.env.FFPROBE_PATH; else process.env.FFPROBE_PATH = previous; }
 assert.ok(Date.now() - started < 15_000);
 assert.equal(calls.length, beforeCalls);
});
test('complete OSS → one submit → fresh pending/running polls → private output, idempotency and redaction',async()=>{
 const p=await input(),key=tag(),r=await createWanGeneration(p,'wan-test',key);runs.push(r.id);assert.equal((await createWanGeneration(p,'wan-test',key)).id,r.id);await assert.rejects(createWanGeneration({...p,mode:'wan-pro'},'wan-test',key),/different input/);
 await assert.rejects(deleteAsset(p.referenceVideoFileKey),/task/);
 const n=calls.length;await job(r.id);await job(r.id);await job(r.id);status='PENDING';await job(r.id);status='RUNNING';await job(r.id);status='SUCCEEDED';await job(r.id);
 const detail=await operationDetail(r.id);assert.ok(!JSON.stringify(detail).includes('Signature'));assert.ok(!JSON.stringify(detail).includes('x-oss-'));await job(r.id);assert.equal((await row(r.id)).status,'completed');
 assert.equal(calls.slice(n).filter(c=>c.method==='POST').length,1);assert.equal(calls.slice(n).filter(c=>c.method==='PUT').length,2);assert.equal(calls.slice(n).filter(c=>c.method==='GET').length,3);
 const [out]=await sql`SELECT * FROM operation_results WHERE run_id=${r.id} AND kind='video'`;assert.equal(out!.data.durationMs,3200);assert.deepEqual(await readFile(assetPath(out!.file_key)),video);
 const costs=await wanTaskCosts('2020-01-01T00:00:00Z','2100-01-01T00:00:00Z');assert.equal(costs.tasks.find(t=>t.rootRunId===r.id)?.estimatedCny,1.92);
 if(process.env.WAN_TEST_ARTIFACT_DIR){await mkdir(process.env.WAN_TEST_ARTIFACT_DIR,{recursive:true});await writeFile(path.join(process.env.WAN_TEST_ARTIFACT_DIR,'stub-reference.mp4'),video);await writeFile(path.join(process.env.WAN_TEST_ARTIFACT_DIR,'stub-output.mp4'),video);await writeFile(path.join(process.env.WAN_TEST_ARTIFACT_DIR,'stub-portrait.png'),png);await writeFile(path.join(process.env.WAN_TEST_ARTIFACT_DIR,'stub-result.json'),JSON.stringify({notice:'LOCAL STUB ONLY; not a Wan generated character swap',run:await operationDetail(r.id),costs},null,2));}
});
test('both gates, missing credentials, missing/zero budget prevent dispatch and receipt claim',async()=>{
 const n=calls.length;for(const gate of ['MODEL_CALLS_ENABLED','ALIYUN_WAN_CALLS_ENABLED']){process.env[gate]='false';const r=await create();await job(r.id);assert.equal((await row(r.id)).current_receipt_id,null);process.env[gate]='true';}
 delete process.env.DASHSCOPE_API_KEY;const r=await create();await job(r.id);assert.equal((await row(r.id)).current_receipt_id,null);process.env.DASHSCOPE_API_KEY='synthetic-wan-key';
 for(const missing of [false,true]){if(missing)await sql`DELETE FROM budgets WHERE service='aliyun.wan.media'`;else await sql`UPDATE budgets SET per_minute=0 WHERE service='aliyun.wan.media'`;const run=await create();await job(run.id);assert.equal((await row(run.id)).current_receipt_id,null);await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES ('aliyun.wan.media',10000,100000,1000000) ON CONFLICT(service) DO UPDATE SET per_minute=10000`;}
 assert.equal(calls.length,n);
});
test('submit unknown is never automatically released or resubmitted; poll unknown has one 30-minute recovery',async()=>{
 const r=await create();await job(r.id);await job(r.id);fault='unknown';await job(r.id);let held=await row(r.id);assert.equal(held.status,'needs_review');const n=calls.length;await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${held.current_receipt_id}`;assert.equal((await releaseOperationReceipt(held.current_receipt_id,true)).released,false);await resume(r.id);await job(r.id);assert.equal(calls.length,n);fault='';
 const q=await submitted();fault='unknown';await job(q.id);held=await row(q.id);assert.equal(held.status,'waiting');assert.equal((await releaseOperationReceipt(held.current_receipt_id)).released,false);await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${held.current_receipt_id}`;assert.equal((await releaseOperationReceipt(held.current_receipt_id)).released,true);await job(q.id);assert.equal((await row(q.id)).status,'needs_review');fault='';
});
test('429 retries same task, malformed/wrong/new-status response is retained and replay never calls provider',async()=>{
 const q=await submitted();fault='429';await job(q.id);assert.equal((await row(q.id)).status,'waiting');fault='';await resume(q.id);await job(q.id);assert.equal((await row(q.id)).step_key,'aliyun.wan.save');
 for(const f of ['malformed','wrong']){const r=await submitted();fault=f;await job(r.id);assert.equal((await row(r.id)).status,'needs_review');const n=calls.length;await resume(r.id);await job(r.id);assert.equal(calls.length,n);fault='';}
 assert.throws(()=>parseWanResponse({output:{task_id:'x',task_status:'NEW_STATUS'}}));
});
test('save failure recovers save only; complete orphan recovers with external gates closed',async()=>{
 const r=await submitted();await job(r.id);outputBad=true;await job(r.id);assert.equal((await row(r.id)).status,'needs_review');assert.equal((await row(r.id)).step_key,'aliyun.wan.save');const n=calls.length;outputBad=false;await resume(r.id);await job(r.id);assert.equal((await row(r.id)).status,'completed');assert.equal(calls.length,n);
 const q=await submitted();await job(q.id);const held=await row(q.id),temp=await prepareUpload(50_000_000);try{await writeFile(temp.file,video);const prepared=await describeGeneratedVideoFile(temp.file);await assert.rejects(sql.begin(async tx=>{await publishUpload({actor:'wan-test',key:held.progress.expectedFileKey,...prepared},tx);throw new Error('interruption');}),/interruption/);}finally{await temp.release();}
 await sql`UPDATE pgboss.job SET state='completed' WHERE id=${held.job_id}`;const d=downloads;process.env.MODEL_CALLS_ENABLED='false';process.env.ALIYUN_WAN_CALLS_ENABLED='false';await recoverOperations();await job(q.id);assert.equal((await row(q.id)).status,'completed');assert.equal(downloads,d);process.env.MODEL_CALLS_ENABLED='true';process.env.ALIYUN_WAN_CALLS_ENABLED='true';
});
test('retained successful submit replays locally with credentials and gates off',async()=>{
 const r=await create();await job(r.id);await job(r.id);const held=await row(r.id),execution=await sql.begin(tx=>claimRun(tx,{runId:r.id,stepVersion:held.step_version,generation:held.generation},held.job_id));
 const objects=held.progress.objects,identity={runId:r.id,rootRunId:r.id,phase:'submit',parameters:held.input.parameters,objects:objects.map((o:any)=>({fileKey:o.fileKey,hash:o.hash,objectKey:o.objectKey}))};
 await wanRequest(wanConfig(),identity,receiptOptions(execution),async()=>({model:'wan2.2-animate-mix',input:{watermark:true,image_url:'https://example.com/?x-oss-signature=fake'},parameters:{check_image:true}}));
 await sql`UPDATE pgboss.job SET state='completed' WHERE id=${held.job_id}`;const n=calls.length;process.env.MODEL_CALLS_ENABLED='false';delete process.env.DASHSCOPE_API_KEY;await recoverOperations();await job(r.id);assert.equal((await row(r.id)).step_key,'aliyun.wan.poll');assert.equal(calls.length,n);process.env.MODEL_CALLS_ENABLED='true';process.env.DASHSCOPE_API_KEY='synthetic-wan-key';
});
test('frozen total poll/deadline and changed workspace stop without another paid submit',async()=>{
 for(const constraint of ['polls','deadline','config']){const r=await submitted(),n=calls.length;if(constraint==='polls')await sql`UPDATE operation_runs SET progress=progress||'{"pollAttempts":40}'::jsonb WHERE id=${r.id}`;else if(constraint==='deadline')await sql`UPDATE operation_runs SET input=jsonb_set(input,'{startedAt}',${sql.json(new Date(Date.now()-7201_000).toISOString())}) WHERE id=${r.id}`;else process.env.ALIYUN_WAN_WORKSPACE_ID='changed';await job(r.id);assert.equal(calls.length,n);assert.equal((await row(r.id)).status,'needs_review');process.env.ALIYUN_WAN_WORKSPACE_ID=workspace;}
});
test('member quote uses 4 server seconds, ownership, zero-price continuation shares charge, local delivery settles once',async()=>{
 const [u]=await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`wan-${tag()}`},'Wan test','synthetic') RETURNING id`;const id=Number(u!.id),actor=`user:${id}`,p=await input(actor);
 await grantCredits(id,{amount:50,reason:'Wan test'},'test',tag());await saveToolPrice({kind:'videos',provider:'aliyun',model:'wan2.2-animate-mix',tier:'wan-std',parameterMatch:{portraitFileKey:p.portraitFileKey},baseCredits:0,videoSecondCredits:2,enabled:true,reason:'test'},'test');
 const quote=await quoteUserTool(id,{kind:'videos',input:p});assert.equal(quote.amount,8);
 await assert.rejects(quoteUserTool(id,{kind:'videos',input:await input('another-owner')}));
 const result=await submitUserTool(id,'videos',{input:p,quoteId:quote.quoteId},tag());runs.push(result.runId);await job(result.runId);await job(result.runId);await job(result.runId);status='RUNNING';await job(result.runId);status='SUCCEEDED';const held=await row(result.runId);await controlOperation(result.runId,'stop',{stepVersion:held.step_version,generation:held.generation,reason:'continue original'},actor);
 const q=await quoteUserTool(id,{kind:'videos/query',input:{runId:result.runId}});assert.equal(q.amount,0);const continued=await submitUserTool(id,'videos/query',{input:{runId:result.runId},quoteId:q.quoteId},tag());runs.push(continued.runId);assert.equal((await row(continued.runId)).limits.polls,39);assert.equal((await row(continued.runId)).input.startedAt,held.input.startedAt);
 await assert.rejects(resume(result.runId));await job(continued.runId);await job(continued.runId);assert.equal((await row(continued.runId)).status,'completed');const credit=await readRunCredits(id,continued.runId);assert.equal(credit?.state,'settled');
 const detail=await userToolDetail(id,continued.runId);assert.equal(detail?.title,'万相 视频复刻');assert.ok(!JSON.stringify(detail).includes('Signature'));await assert.rejects(userToolDetail(9999999,continued.runId));
});
test('missing usage remains unknown, dedup survives response pruning and interval uses submit attempt',async()=>{
 const r=await submitted();fault='no-usage';await job(r.id);fault='';let costs=await wanTaskCosts('2020-01-01T00:00:00Z','2100-01-01T00:00:00Z');assert.equal(costs.tasks.find(t=>t.rootRunId===r.id)?.estimatedCny,null);
 const [a]=await sql`SELECT * FROM receipt_attempts WHERE usage ? 'wanTask' AND usage->'wanTask'->'configIdentity'->>'workspace'=${workspace} AND (usage->'wanTask'->>'outputSeconds') IS NOT NULL LIMIT 1`;
 const ev=a!.usage.wanTask;await sql`UPDATE receipt_attempts SET response=NULL WHERE id=${a!.id}`;await sql`UPDATE receipts SET response=NULL WHERE id=${a!.receipt_id}`;
 const [other]=await sql`SELECT id FROM receipt_attempts WHERE service='aliyun.wan.poll' AND id<>${a!.id} AND receipt_id IN (SELECT id FROM receipts WHERE request->>'base'=${process.env.ALIYUN_WAN_TEST_BASE_URL!}) LIMIT 1`;await sql`UPDATE receipt_attempts SET usage=${sql.json(a!.usage)} WHERE id=${other!.id}`;
 costs=await wanTaskCosts('2020-01-01T00:00:00Z','2100-01-01T00:00:00Z');assert.equal(costs.tasks.filter(t=>t.rootRunId===ev.rootRunId).length,1);
 await sql`UPDATE receipt_attempts SET started_at='2021-01-01' WHERE receipt_id=${ev.submissionReceiptId} AND attempt=${ev.submissionAttempt}`;const recent=await wanTaskCosts('2026-01-01T00:00:00Z','2100-01-01T00:00:00Z');assert.equal(recent.tasks.some(t=>t.rootRunId===ev.rootRunId),false);
 await sql`UPDATE receipt_attempts SET usage=jsonb_set(usage,'{wanTask,outputSeconds}','99'::jsonb) WHERE id=${other!.id}`;costs=await wanTaskCosts('2020-01-01T00:00:00Z','2100-01-01T00:00:00Z');assert.equal(costs.tasks.find(t=>t.rootRunId===ev.rootRunId)?.estimatedCny,null);
});
test('admin API authentication, CSRF, invalid input and create idempotency',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),old=config.devAdmin;try{config.devAdmin=null;assert.equal((await app.inject({url:'/api/admin/aliyun/videos/options'})).statusCode,401);config.devAdmin={displayName:'Wan test'};const p=await input();assert.equal((await app.inject({method:'POST',url:'/api/admin/aliyun/videos',payload:p})).statusCode,403);const headers={'idempotency-key':tag(),'x-csrf-token':'dev'};assert.equal((await app.inject({method:'POST',url:'/api/admin/aliyun/videos',headers,payload:{...p,taskId:'arbitrary'}})).statusCode,400);const first=await app.inject({method:'POST',url:'/api/admin/aliyun/videos',headers,payload:p});assert.equal(first.statusCode,202,first.body);runs.push(first.json().runId);assert.equal((await app.inject({method:'POST',url:'/api/admin/aliyun/videos',headers,payload:p})).json().runId,first.json().runId);}finally{config.devAdmin=old;await app.close();}
});

test('supplier FAILED releases member reservation; UNKNOWN remains review and stale generation cannot commit',async()=>{
 for(const state of ['FAILED','UNKNOWN']){
  const [u]=await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`wan-${tag()}`},'Wan failure','synthetic') RETURNING id`;const id=Number(u!.id),p=await input(`user:${id}`);
  await grantCredits(id,{amount:20,reason:'test'},'test',tag());await saveToolPrice({kind:'videos',provider:'aliyun',model:'wan2.2-animate-mix',tier:'wan-std',parameterMatch:{portraitFileKey:p.portraitFileKey},baseCredits:5,enabled:true,reason:'test'},'test');
  const q=await quoteUserTool(id,{kind:'videos',input:p}),r=await submitUserTool(id,'videos',{input:p,quoteId:q.quoteId},tag());runs.push(r.runId);await job(r.runId);await job(r.runId);await job(r.runId);status=state;await job(r.runId);status='SUCCEEDED';const credit=await readRunCredits(id,r.runId);assert.equal(credit?.state,state==='FAILED'?'released':'review');
 }
 const r=await submitted(),old=await row(r.id),n=calls.length;await controlOperation(r.id,'stop',{stepVersion:old.step_version,generation:old.generation,reason:'stop stale worker'},'test');await executeOperationStep(r.id,old.step_version,old.job_id);assert.equal(calls.length,n);assert.equal((await row(r.id)).status,'stopped');
});
