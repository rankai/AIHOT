import { tag, stub, assertConfiguredTestDatabase } from "./setup.ts";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createPlatformSubscription, startPlatformSubscription, listPlatformSubscriptions, updatePlatformSubscription } from "@aihot/backend/sources/platform-subscriptions";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { operationDetail } from "@aihot/backend/providers/operations/read";
import { assetPath, getAsset, cleanupAssets, deleteAsset, prepareUpload, writeUpload, publishUpload } from "@aihot/backend/operations/assets";
import { subscriptionVideoFileKey } from "@aihot/backend/sources/subscription-video-candidates";
import { queryMediaTool } from "@aihot/backend/providers/redfox/media-tools";
import { releaseOperationReceipt } from "@aihot/backend/providers/operations/recovery";
import { resumeRun, receiptOptions } from "@aihot/backend/providers/operations/store";

let item:Record<string,unknown>, parserData:unknown, parserCalls=0, downloads=0, rejectParser=false, loseParser=false;
let agent:Awaited<ReturnType<typeof stub>>, media:http.Server, mediaUrl:string, mediaBytes:Buffer;
let budgets:Record<string,any>[]=[];
const state=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
async function step(id:number){const run=await state(id);await executeOperationStep(id,run.step_version,randomUUID());return state(id);}
const input=(autoDownloadVideo?:boolean)=>({name:"Synthetic download",provider:"agentkey",operationId:"OWIBYU1V",parameters:{keyword:"synthetic-video"},enabled:true,limits:{pages:1,items:10,details:0},...(autoDownloadVideo===undefined?{}:{autoDownloadVideo})});
function newWork(video=true){const id=`${Date.now()}${Math.floor(Math.random()*10000)}`;item={AwemeId:id,Desc:"Synthetic video",CreateTime:"1729400000000",Author:{Uid:id+"1",SecUid:"sec-"+id,Nickname:"Synthetic author"},...(video?{Video:{ItemID:id,Cover:{UrlList:["https://example.test/cover.jpg"]}}}:{})};return id;}
async function collect(subId:number){const run=await startPlatformSubscription(subId,"video-test",tag());await step(run.id);const done=await state(run.id);assert.equal(done.status,"completed",done.wait_reason);return run;}
async function child(parentId:number){const [run]=await sql`SELECT * FROM operation_runs WHERE operation_key='subscription.video.download' AND input->>'parentRunId'=${String(parentId)}`;return run;}
before(async()=>{
  const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
  budgets=await sql`SELECT * FROM budgets WHERE service IN ('agentkey.collect','redfox.media')`;
  await sql`UPDATE budgets SET per_minute=10000,per_hour=10000,per_day=10000 WHERE service IN ('agentkey.collect','redfox.media')`;
  agent=await stub((_n,req)=>{const q=JSON.parse(req.body);if(q.method?.startsWith("notifications/"))return {};
    return {jsonrpc:"2.0",id:q.id,result:q.method==="initialize"?{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"synthetic",version:"1"}}:{content:[],structuredContent:{provider:"TikHub",data:{code:200,data:{code:0,data:{itemList:[{AwemeInfo:item}],hasMore:false,cursor:0}}}}}};
  });
  const fixtures=JSON.parse(await readFile(new URL("./fixtures/operation-media.json",import.meta.url),"utf8"));
  mediaBytes=Buffer.from(fixtures.files.find((f:{filename:string})=>f.filename==="tiny.mp4").base64,"base64");
  media=http.createServer((req,res)=>{if(req.method==="GET"){downloads++;res.writeHead(200,{"content-type":"video/mp4"});res.end(mediaBytes);return;}
    parserCalls++;if(loseParser){req.socket.destroy();return;}req.resume();req.on("end",()=>{res.writeHead(rejectParser?429:200,{"content-type":"application/json","retry-after":"0"});res.end(JSON.stringify({code:2000,data:parserData}));});});
  await new Promise<void>(resolve=>media.listen(0,"127.0.0.1",resolve));mediaUrl=`http://127.0.0.1:${(media.address() as {port:number}).port}`;
  Object.assign(process.env,{AGENTKEY_API_KEY:"synthetic-only-key",AGENTKEY_MCP_URL:agent.url,AGENTKEY_CALLS_ENABLED:"true",REDFOX_API_KEY:"synthetic-only-key",REDFOX_TEST_BASE_URL:mediaUrl,REDFOX_CALLS_ENABLED:"true",COLLECT_ENABLED:"true"});
  config.allowPrivateNetworkFetch=true;
});
after(async()=>{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await agent?.close();await new Promise<void>(resolve=>media?.close(()=>resolve()));await stopBoss();await closeDb();});

test("V4 material import registers one separate low-priority save, Redfox resolves once, private bytes expire in 30 days",async()=>{
  newWork();parserData={resources:[{type:"image",downloadUrl:mediaUrl+"/cover"},{type:"video",downloadUrl:mediaUrl+"/video?signature=private"}]};
  const sub=await createPlatformSubscription(input(true),"video-test",tag());
  assert.equal((await listPlatformSubscriptions("douyin")).find(s=>s.id===sub.id)!.autoDownloadVideo,true);
  const parent=await collect(sub.id),run=await child(parent.id);assert.ok(run);
  assert.equal(run.provider,"local");assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub.id}`)[0]!.active_run_id,null);
  assert.equal((await sql`SELECT priority FROM pgboss.job WHERE id=${run.job_id}`)[0]!.priority,-1);
  assert.equal((await sql`SELECT priority FROM pgboss.job WHERE id=${(await state(parent.id)).job_id}`)[0]?.priority??0,0);
  const before=parserCalls;assert.equal((await step(run.id)).step_key,"subscription.video.save");
  const detail=await operationDetail(run.id);assert.equal(JSON.stringify(detail).includes("signature=private"),false);
  assert.equal((await step(run.id)).status,"completed");assert.equal(parserCalls,before+1);
  const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='subscription_video'`;assert.equal(result!.data.saved,1);assert.equal(result!.data.resolverUsed,true);
  const completedDetail=await operationDetail(run.id);assert.equal(completedDetail!.progress.saved,1);assert.equal(completedDetail!.progress.transferredBytes,mediaBytes.length);assert.equal(completedDetail!.inputs.videoDownload!.resolverUsed,true);
  const asset=await getAsset(result!.file_key);assert.equal(asset.metadata.origin,"subscription-video");assert.equal(asset.purpose,"operation-output");
  assert.equal(new Date(asset.expires_at!).getTime()-new Date(asset.created_at!).getTime(),30*86400_000);
  assert.deepEqual(await readFile(assetPath(asset.key)),mediaBytes);
  const again=await collect(sub.id);assert.equal(await child(again.id),undefined);assert.equal(parserCalls,before+1);
  assert.equal((await sql`SELECT provenance->'videoDownloadRunId' AS id FROM operation_results WHERE run_id=${again.id} AND kind='douyin_work'`)[0]!.id,run.id);
  const second=await createPlatformSubscription(input(true),"video-test",tag()),p2=await collect(second.id),r2=await child(p2.id);
  const gets=downloads;await step(r2.id);assert.equal((await state(r2.id)).status,"completed");assert.equal(parserCalls,before+1);assert.equal(downloads,gets);
  assert.equal((await getAsset(asset.key)).expires_at!.getTime(),asset.expires_at!.getTime());
  await deleteAsset(asset.key);
  const third=await createPlatformSubscription(input(true),"video-test",tag()),p3=await collect(third.id),r3=await child(p3.id);await step(r3.id);
  assert.equal(parserCalls,before+1);assert.equal(downloads,gets);assert.equal((await sql`SELECT data FROM operation_results WHERE run_id=${r3.id}`)[0]!.data.reason,"deleted");
});

test("old config, false config and unconfirmed work do not register downloads",async()=>{
  for(const enabled of [undefined,false]){newWork();const sub=await createPlatformSubscription(input(enabled),"video-test",tag());const parent=await collect(sub.id);assert.equal(await child(parent.id),undefined);assert.equal((await listPlatformSubscriptions("douyin")).find(s=>s.id===sub.id)!.autoDownloadVideo,false);}
  newWork(false);const sub=await createPlatformSubscription(input(true),"video-test",tag());assert.equal(await child((await collect(sub.id)).id),undefined);
});

test("empty parsing consumes its receipt and ends honestly with zero saved",async()=>{
  newWork();parserData={title:"Only a cover",resources:[{type:"image",downloadUrl:mediaUrl+"/cover"}]};
  const sub=await createPlatformSubscription(input(true),"video-test",tag()),run=await child((await collect(sub.id)).id),gets=downloads;
  assert.equal((await step(run.id)).step_key,"subscription.video.save");assert.equal((await step(run.id)).status,"completed");assert.equal(downloads,gets);
  const [result]=await sql`SELECT data FROM operation_results WHERE run_id=${run.id} AND kind='subscription_video'`;assert.equal(result!.data.saved,0);assert.equal(result!.data.reason,"no_video_address");
  const [receipt]=await sql`SELECT p.status FROM receipts p JOIN operation_results z ON z.receipt_id=p.id WHERE z.run_id=${run.id}`;assert.equal(receipt!.status,"completed");
});

test("temporary rejection and manual resume share the two actual parser attempt cap",async()=>{
  newWork();rejectParser=true;const sub=await createPlatformSubscription(input(true),"video-test",tag()),run=await child((await collect(sub.id)).id),calls=parserCalls;
  try {
    assert.equal((await step(run.id)).status,"waiting");let current=await state(run.id);
    await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:current.step_version,generation:current.generation}));
    assert.equal((await step(run.id)).status,"needs_review");assert.equal(parserCalls,calls+2);
    current=await state(run.id);await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:current.step_version,generation:current.generation}));
    assert.equal((await step(run.id)).status,"needs_review");assert.equal(parserCalls,calls+2);
  }finally{rejectParser=false;}
});

test("config close stops derived runs while completed collection stays completed",async()=>{
  newWork();const sub=await createPlatformSubscription(input(true),"video-test",tag()),parent=await collect(sub.id),run=await child(parent.id),calls=parserCalls;
  await updatePlatformSubscription(sub.id,{editVersion:1,config:input(false)},"video-test");
  assert.equal((await state(run.id)).status,"stopped");assert.equal((await state(parent.id)).status,"completed");await step(run.id);assert.equal(parserCalls,calls);
});

test("expiry blocks reads before physical cleanup and retains its tombstone",async()=>{
  newWork();parserData={resources:[{type:"video",downloadUrl:mediaUrl+"/video"}]};
  const sub=await createPlatformSubscription(input(true),"video-test",tag()),run=await child((await collect(sub.id)).id);await step(run.id);await step(run.id);
  const [result]=await sql`SELECT file_key FROM operation_results WHERE run_id=${run.id} AND kind='subscription_video'`;assert.ok(result!.file_key);
  await sql`UPDATE stored_files SET expires_at=now()-interval '1 second' WHERE key=${result!.file_key}`;
  await assert.rejects(getAsset(result!.file_key),/expired/);await cleanupAssets();
  assert.equal((await sql`SELECT status FROM stored_files WHERE key=${result!.file_key}`)[0]!.status,"deleted");
});


test("received parser response replays locally, then a complete unregistered file recovers with outbound disabled",async()=>{
  newWork();parserData={resources:[{type:"video",downloadUrl:mediaUrl+"/recover?signature=secret"}]};
  const sub=await createPlatformSubscription(input(true),"video-test",tag()),run=await child((await collect(sub.id)).id);
  const calls=parserCalls;
  await queryMediaTool("0W27H3O6",{url:run.input.originalUrl},`subscription-video:${run.id}`,receiptOptions({runId:run.id,stepVersion:run.step_version,generation:run.generation}));
  assert.equal(parserCalls,calls+1);
  process.env.REDFOX_CALLS_ENABLED="false";process.env.COLLECT_ENABLED="false";
  try {
    assert.equal((await step(run.id)).step_key,"subscription.video.save");assert.equal(parserCalls,calls+1);
    const current=await state(run.id),key=current.progress.expectedFileKey,temp=await prepareUpload(50_000_000);
    try {
      const written=await writeUpload(Readable.from([mediaBytes]),temp.file,AbortSignal.timeout(1000),50_000_000);
      await assert.rejects(sql.begin(async tx=>{await publishUpload({actor:"synthetic",key,file:temp.file,filename:"recovered.mp4",mime:"video/mp4",purpose:"operation-output",origin:"subscription-video",...written},tx);throw Error("synthetic rollback after immutable file link");}),/synthetic rollback/);
    }finally{await temp.release();}
    assert.equal((await sql`SELECT key FROM stored_files WHERE key=${key}`).length,0);
    const gets=downloads;assert.equal((await step(run.id)).status,"completed");assert.equal(downloads,gets);assert.equal(parserCalls,calls+1);
    assert.equal((await getAsset(key)).metadata.origin,"subscription-video");
  }finally{process.env.REDFOX_CALLS_ENABLED="true";process.env.COLLECT_ENABLED="true";}
});

test("unknown outcome waits thirty minutes, retries once, and remains governed after the second loss",async()=>{
  newWork();loseParser=true;const sub=await createPlatformSubscription(input(true),"video-test",tag()),run=await child((await collect(sub.id)).id),calls=parserCalls;
  try {
    let current=await step(run.id);assert.equal(current.status,"waiting");const id=current.current_receipt_id;assert.ok(id);
    assert.equal((await releaseOperationReceipt(id)).released,false);
    await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${id}`;
    assert.equal((await releaseOperationReceipt(id)).released,true);
    current=await step(run.id);assert.equal(current.status,"needs_review");assert.equal(parserCalls,calls+2);
    await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${id}`;
    assert.equal((await releaseOperationReceipt(id,true)).released,false);
    assert.equal((await state(run.id)).current_receipt_id,id);
    assert.equal((await sql`SELECT status FROM receipts WHERE id=${id}`)[0]!.status,"unknown");
  }finally{loseParser=false;}
});

for(const orphan of [false,true])test(`received parser is consumed before offline ${orphan?'complete orphan':'other subscription saved file'} recovery`,async()=>{
 newWork();parserData={resources:[{type:"video",downloadUrl:mediaUrl+'/already-local'}]};
 const a=await child((await collect((await createPlatformSubscription(input(true),'video-test',tag())).id)).id);
 await queryMediaTool('0W27H3O6',{url:a.input.originalUrl},`subscription-video:${a.id}`,receiptOptions({runId:a.id,stepVersion:a.step_version,generation:a.generation}));
 const receiptId=(await state(a.id)).current_receipt_id;
 const b=await child((await collect((await createPlatformSubscription(input(true),'video-test',tag())).id)).id);await step(b.id);
 const key=(await state(b.id)).progress.expectedFileKey;
 if(orphan){const temp=await prepareUpload(50_000_000);try{const written=await writeUpload(Readable.from([mediaBytes]),temp.file,AbortSignal.timeout(1000),50_000_000);await assert.rejects(sql.begin(async tx=>{await publishUpload({actor:'synthetic',key,file:temp.file,filename:'orphan.mp4',mime:'video/mp4',purpose:'operation-output',origin:'subscription-video',...written},tx);throw Error('orphan rollback');}),/orphan rollback/);}finally{await temp.release();}}
 else assert.equal((await step(b.id)).status,'completed');
 const calls=parserCalls,gets=downloads;process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';
 try{for(let n=0;n<3&&(await state(a.id)).status==='active';n++)await step(a.id);const done=await state(a.id);assert.equal(done.status,'completed',done.wait_reason);assert.equal(parserCalls,calls);assert.equal(downloads,gets);assert.equal((await sql`SELECT status FROM receipts WHERE id=${receiptId}`)[0]!.status,'completed');assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results WHERE run_id=${a.id} AND kind='subscription_video_parse' AND receipt_id=${receiptId}`)[0]!.n,1);const dto=await operationDetail(a.id);assert.equal(dto!.progress.saved,1);assert.equal(dto!.progress.transferredBytes,0);assert.equal(dto!.inputs.videoDownload!.resolverUsed,true);}
 finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';}
});

for(const response of ["empty","duplicate","ambiguous"] as const)for(const local of ["shared","orphan","deleted","missing"] as const)test(`${response} received parser checks ${local} before ending without a new candidate`,async()=>{
  newWork();const url=mediaUrl+"/old-candidate";
  parserData={resources:response==="empty"?[]:response==="duplicate"?[{type:"video",downloadUrl:url}]:[{type:"video",downloadUrl:url},{type:"video",downloadUrl:mediaUrl+"/other"}]};
  const a=await child((await collect((await createPlatformSubscription(input(true),"video-test",tag())).id)).id);
  if(response==="duplicate")await sql`UPDATE operation_runs SET progress=${sql.json({targets:[{selection:"single-video-main",stable:true,candidates:[{url,provider:"redfox",field:"synthetic",quality:"unknown"}]}],candidateIndex:1})} WHERE id=${a.id}`;
  await queryMediaTool("0W27H3O6",{url:a.input.originalUrl},`subscription-video:${a.id}`,receiptOptions({runId:a.id,stepVersion:a.step_version,generation:a.generation}));
  const receiptId=(await state(a.id)).current_receipt_id;
  const key=subscriptionVideoFileKey("douyin",a.input.workId,"single-video-main");
  if(local!=="missing"){
    const temp=await prepareUpload(50_000_000);
    try{
      const written=await writeUpload(Readable.from([mediaBytes]),temp.file,AbortSignal.timeout(1000),50_000_000);
      const publish=()=>sql.begin(async tx=>{await publishUpload({actor:"synthetic",key,file:temp.file,filename:"shared.mp4",mime:"video/mp4",purpose:"operation-output",origin:"subscription-video",...written},tx);if(local==="orphan")throw Error("synthetic publication rollback");});
      if(local==="orphan")await assert.rejects(publish(),/synthetic publication rollback/);else await publish();
    }finally{await temp.release();}
    if(local==="deleted")await deleteAsset(key);
  }
  const calls=parserCalls,gets=downloads;process.env.REDFOX_CALLS_ENABLED="false";process.env.COLLECT_ENABLED="false";
  try{
    for(let n=0;n<3&&(await state(a.id)).status==="active";n++)await step(a.id);
    assert.equal((await state(a.id)).status,"completed");assert.equal(parserCalls,calls);assert.equal(downloads,gets);
    const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${a.id} AND kind='subscription_video'`;
    assert.equal(result!.data.saved,local==="shared"||local==="orphan"?1:0);
    assert.equal(result!.data.reason,local==="shared"?"reused":local==="orphan"?"saved":local==="deleted"?"deleted":response==="empty"?"no_video_address":response==="duplicate"?"no_new_video_address":"media_identity_insufficient");
    assert.equal(result!.file_key,local==="shared"||local==="orphan"?key:null);
    assert.equal((await sql`SELECT status FROM receipts WHERE id=${receiptId}`)[0]!.status,"completed");
    assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results WHERE run_id=${a.id} AND kind='subscription_video_parse' AND receipt_id=${receiptId}`)[0]!.n,1);
  }finally{process.env.REDFOX_CALLS_ENABLED="true";process.env.COLLECT_ENABLED="true";}
});
