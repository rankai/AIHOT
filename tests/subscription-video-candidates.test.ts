import { operationDetail } from "@aihot/backend/providers/operations/read";
import { tag, assertConfiguredTestDatabase } from "./setup.ts";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { newArticleId } from "@aihot/backend/lib/ids";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSubscription } from "@aihot/backend/sources/subscriptions";
import { registerSubscriptionVideo } from "@aihot/backend/sources/subscription-video";
import { collectedVideoCandidates, frozenVideoManifest, resolvedVideoCandidates, videoResolvers, type VideoManifest } from "@aihot/backend/sources/subscription-video-candidates";
import { parseMediaTool } from "@aihot/backend/providers/redfox/media-tools";
import { createRun, receiptOptions, saveResult, advanceRun } from "@aihot/backend/providers/operations/store";
import { paidRequest } from "@aihot/backend/providers/receipts";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { recoverOperations } from "@aihot/backend/providers/operations/recovery";
import { deleteAsset, getAsset } from "@aihot/backend/operations/assets";

let server:http.Server,base:string,bytes:Buffer,large:Buffer,compressed:Buffer;
let parserData:unknown,parseHits=0;
const hits:string[]=[];
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
async function step(id:number){const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());return row(id);}
async function drain(id:number){for(let n=0;n<16;n++){const r=await row(id);if(r.status!=="active")return r;await step(id);}throw Error("Synthetic video did not settle in bounded steps");}
async function results(id:number){return sql`SELECT * FROM operation_results WHERE run_id=${id} AND kind='subscription_video' ORDER BY id`;}
let savedBudget:any;
before(async()=>{
  const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
  [savedBudget]=await sql`SELECT * FROM budgets WHERE service='redfox.media'`;
  await sql`UPDATE budgets SET per_minute=10000,per_hour=10000,per_day=10000 WHERE service='redfox.media'`;
  const f=JSON.parse(await readFile(new URL("./fixtures/operation-media.json",import.meta.url),"utf8")).files.find((f:{filename:string})=>f.filename==="tiny.mp4");
  bytes=Buffer.from(f.base64,"base64");large=Buffer.alloc(50_000_001);bytes.copy(large);compressed=gzipSync(large);
  server=http.createServer((req,res)=>{
    const path=new URL(req.url!,"http://localhost").pathname;hits.push(path);
    if(req.method==="POST"){parseHits++;req.resume();req.on("end",()=>res.end(JSON.stringify({code:2000,data:parserData})));return;}
    if(path==="/header-large"){res.writeHead(200,{"content-length":"50000001"});res.end(bytes);return;}
    if(path==="/exact"){res.writeHead(200,{"content-length":"50000000"});res.end(large.subarray(0,50_000_000));return;}
    if(path==="/chunked-large"){res.writeHead(200,{"transfer-encoding":"chunked"});res.end(large);return;}
    if(path==="/small-declared-expanded"){res.writeHead(200,{"content-encoding":"gzip","content-length":String(compressed.length)});res.end(compressed);return;}
    if(path==="/false-short"){res.writeHead(200,{"content-length":"8"});res.end(bytes);return;}
    if(path==="/playlist"){res.end("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10\nx.ts");return;}
    if(path==="/missing"){res.writeHead(404);res.end("missing");return;}
    res.writeHead(200,{"content-type":"video/mp4"});res.end(bytes);
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  Object.assign(process.env,{REDFOX_API_KEY:"synthetic-candidate-key",REDFOX_TEST_BASE_URL:base,REDFOX_CALLS_ENABLED:"true",COLLECT_ENABLED:"true"});config.allowPrivateNetworkFetch=true;
});
after(async()=>{if(savedBudget)await sql`UPDATE budgets SET per_minute=${savedBudget.per_minute},per_hour=${savedBudget.per_hour},per_day=${savedBudget.per_day} WHERE service='redfox.media'`;await new Promise<void>(resolve=>server.close(()=>resolve()));await stopBoss();await closeDb();});

async function fixture(platform:string,operationId:string,record:unknown,singleVideo=true,options:{workId?:string;manifest?:(receiptId:number,attempt:number)=>VideoManifest;provider?:string}={}) {
  const sourceId=`candidate-${tag()}`,articleId=newArticleId(),workId=options.workId??tag(),provider=options.provider??"redfox";
  await sql`INSERT INTO sources(id,name,kind) VALUES(${sourceId},'Synthetic candidate author','external')`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES(${articleId},${sourceId},${`synthetic:${tag()}`},${`https://example.test/${platform}/${workId}`},'Synthetic video',now(),now())`;
  const subscriptionId=await sql.begin(tx=>createSubscription(tx,{provider,platform,operationKey:"synthetic.collect",contractVersion:1,enabled:true,intervalMinutes:30,config:{sourceId,autoDownloadVideo:true}}));
  const parent=await sql.begin(tx=>createRun(tx,{actor:"candidate-test",commandKey:tag(),provider,operationKey:"synthetic.collect",contractVersion:1,stepKey:"synthetic.page",subscriptionIds:[subscriptionId],input:{mode:"collection",operationId,platform}}));
  const e={runId:parent.id,stepVersion:parent.step_version,generation:parent.generation};
  const receipt=await paidRequest({service:"candidate-fixture",purpose:"synthetic",identity:tag()},async()=>({response:record}),receiptOptions(e));
  const manifest=options.manifest?.(receipt.receiptId,receipt.attempt)??collectedVideoCandidates({provider,platform,operationId,record,receiptId:receipt.receiptId,attempt:receipt.attempt,singleVideo});
  const run=await sql.begin(async tx=>{
    const resultId=await saveResult(tx,e,{itemKey:"work",kind:"synthetic_work",data:{record},receiptId:receipt.receiptId,articleId,sourceId});
    const run=await registerSubscriptionVideo(tx,{parentRunId:parent.id,parentResultId:resultId,articleId,sourceId,workId,originalUrl:`https://example.test/${platform}/${workId}`,platform,singleVideo,videoProof:"synthetic verified work",manifest});
    await advanceRun(tx,e,null);return run!;
  });return {run,workId,subscriptionId};
}

test("extractors use only verified fields, exclude GIF/HLS/pages, and keep variant semantics",()=>{
  const e={receiptId:1,attempt:1,provider:"redfox"};
  const x=collectedVideoCandidates({...e,platform:"x",operationId:"QCP75W33",singleVideo:false,record:{medias:[{type:"video",isGif:true,variants:[{contentType:"video/mp4",url:base+"/also-gif"}]},{type:"animated_gif",variants:[{contentType:"video/mp4",url:base+"/gif"}]},{type:"video",variants:[{contentType:"application/x-mpegURL",url:base+"/playlist"},{contentType:"video/mp4",url:base+"/low",bitrate:10},{contentType:"video/mp4",url:base+"/high",bitrate:100}]}]}});
  assert.equal(x.targets.length,1);assert.deepEqual(x.targets[0]!.candidates.map(c=>c.bitrate),[100,10]);assert.equal(x.targets[0]!.stable,false);
  const tt=collectedVideoCandidates({...e,platform:"tiktok",operationId:"API_1790581450500",singleVideo:true,record:{videoData:{downloadNoMarkAddress:base+"/clean",downloadAddress:base+"/watermark",playAddress:base+"/play"}}});
  assert.deepEqual(tt.targets[0]!.candidates.map(c=>[c.field,c.quality]),[["videoData.downloadNoMarkAddress","unknown"],["videoData.downloadAddress","unknown"],["videoData.playAddress","unknown"]]);
  for(const [platform,operationId,record] of [["toutiao","R1IGR09H",{downloadUrl:[{url:base+"/unknown"}]}],["youtube","609DF2IR",{videoUrl:base+"/watch"}],["instagram","GM0TISWI",{carouselItems:[{videoUrl:base+"/unknown"}]}]] as const){assert.equal(collectedVideoCandidates({...e,platform,operationId,record,singleVideo:true}).targets[0]!.candidates.length,0);}
  assert.equal(Object.keys(videoResolvers).length,9);
  const parsed=resolvedVideoCandidates(parseMediaTool("0W27H3O6",{videoUrl:base+"/top",resources:[{type:"image",downloadUrl:base+"/cover"}]},{url:"synthetic"}),1,1,true);
  assert.equal(parsed.manifest.targets[0]!.candidates[0]!.url,base+"/top");
  assert.equal(resolvedVideoCandidates(parseMediaTool("0W27H3O6",{resources:[{type:"video",downloadUrl:base+"/a"},{type:"video",downloadUrl:base+"/b"}]},{url:"synthetic"}),1,1,true).reason,"media_identity_insufficient");
});

test("X lower bitrate retries persist their index and save without paying a parser",async()=>{
  const before=parseHits,start=hits.length;
  const {run}=await fixture("x","QCP75W33",{medias:[{type:"video",variants:[{contentType:"video/mp4",url:base+"/header-large",bitrate:1000},{contentType:"video/mp4",url:base+"/low",bitrate:100}]}]});
  let current=await step(run.id);assert.equal(current.progress.candidateIndex,1);assert.equal(current.progress.failures[0].reason,"too_large");assert.equal(current.progress.failures[0].transferredBytes,0);
  assert.equal((await drain(run.id)).status,"completed");assert.deepEqual(hits.slice(start),["/header-large","/low"]);assert.equal(parseHits,before);
  const [result]=await results(run.id);assert.equal(result!.data.saved,1);assert.equal(result!.data.selectedCandidate.bitrate,100);assert.equal(result!.data.transferredBytes,bytes.length);
});

test("multiple distinct X videos each get a result/file; manifest identity binds the exact attempt",async()=>{
  const {run}=await fixture("x","QCP75W33",{medias:[{type:"video",variants:[{contentType:"video/mp4",url:base+"/one",bitrate:100}]},{type:"video",variants:[{contentType:"video/mp4",url:base+"/two",bitrate:100}]}]},false);
  assert.equal((await drain(run.id)).status,"completed");const saved=await results(run.id);assert.equal(saved.length,2);assert.equal(saved.every(r=>r.data.saved===1),true);assert.notEqual(saved[0]!.file_key,saved[1]!.file_key);
  const detail=await operationDetail(run.id);assert.equal(detail!.progress.saved,2);assert.equal(detail!.progress.notSaved,0);assert.equal(detail!.progress.transferredBytes,bytes.length*2);assert.equal(detail!.progress.targetsTotal,2);assert.equal(detail!.inputs.videoDownload!.resolverUsed,false);
  const a=frozenVideoManifest(8,1,{same:true},[{candidates:[]}],false),b=frozenVideoManifest(8,2,{same:true},[{candidates:[]}],false);assert.notEqual(a.targets[0]!.selection,b.targets[0]!.selection);
});

test("unknown media tombstone prevents changed manifest and subscription from resurrecting a work",async()=>{
  const original=await fixture("x","QCP75W33",{medias:[{type:"video",variants:[{contentType:"video/mp4",url:base+"/old"}]}]},false);await drain(original.run.id);
  const [saved]=await results(original.run.id);await deleteAsset(saved!.file_key);const count=hits.length;
  const replacement=await fixture("x","QCP75W33",{medias:[{type:"video",variants:[{contentType:"video/mp4",url:base+"/new-signature"}]}]},false,{workId:original.workId});await drain(replacement.run.id);
  assert.equal(hits.length,count);assert.equal((await results(replacement.run.id))[0]!.data.reason,"deleted");
  const nowSingle=await fixture("x","QCP75W33",{medias:[{type:"video",variants:[{contentType:"video/mp4",url:base+"/new-single"}]}]},true,{workId:original.workId});await drain(nowSingle.run.id);
  assert.equal(hits.length,count);assert.equal((await results(nowSingle.run.id))[0]!.data.reason,"deleted");
});

test("known distinct media IDs keep independent tombstones",async()=>{
  const manifest=(mediaId:string)=>(receiptId:number,attempt:number)=>frozenVideoManifest(receiptId,attempt,{mediaId},[{mediaId,candidates:[{url:base+"/known-"+mediaId,provider:"redfox",field:"verified-media",quality:"unknown"}]}],false);
  const first=await fixture("x","QCP75W33",{},false,{manifest:manifest("one")});await drain(first.run.id);await deleteAsset((await results(first.run.id))[0]!.file_key);
  const second=await fixture("x","QCP75W33",{},false,{workId:first.workId,manifest:manifest("two")});await drain(second.run.id);
  assert.equal((await results(second.run.id))[0]!.data.saved,1);
});

test("direct candidate failure buys the one fixed parser and top video can coexist with cover resources",async()=>{
  parserData={videoUrl:base+"/top",resources:[{type:"image",downloadUrl:base+"/cover"}]};const count=parseHits;
  const {run}=await fixture("tiktok","6SE9WIHJ",{videoData:{downloadNoMarkAddress:base+"/missing"}});assert.equal((await drain(run.id)).status,"completed");
  assert.equal(parseHits,count+1);const [saved]=await results(run.id);assert.equal(saved!.data.saved,1);assert.equal(saved!.data.selectedCandidate.field,"videoUrl");assert.equal(saved!.data.resolver.operationId,"MQMDU19Q");
});

test("exact 50 MB succeeds; absent and undersized headers cannot bypass the streaming byte cap",async()=>{
  const exact=await fixture("yiche","3BXWEB6Y",{resources:[{downloadUrl:base+"/exact"}]});assert.equal((await drain(exact.run.id)).status,"completed");
  const [saved]=await results(exact.run.id);assert.equal(saved!.data.bytes,50_000_000);await deleteAsset(saved!.file_key);
  for(const endpoint of ["/chunked-large","/small-declared-expanded"]){
    const f=await fixture("yiche","3BXWEB6Y",{resources:[{downloadUrl:base+endpoint}]});await drain(f.run.id);const [result]=await results(f.run.id);assert.equal(result!.data.reason,"too_large");assert.ok(result!.data.transferredBytes>50_000_000);assert.equal(result!.file_key,null);
  }
  assert.deepEqual(await readdir(config.dataDir+"/operation-tmp"),[]);
});

test("Yiche versions keep unknown quality and distinguish too large from invalid or unavailable",async()=>{
  const f=await fixture("yiche","3BXWEB6Y",{resources:[{downloadUrl:base+"/header-large"},{downloadUrl:base+"/low"}]});await drain(f.run.id);assert.equal((await results(f.run.id))[0]!.data.selectedCandidate.quality,"unknown");
  for(const [endpoint,reason] of [["/playlist","unsupported_format"],["/false-short","unsupported_format"],["/missing","download_unavailable"]]){
    const f=await fixture("yiche","3BXWEB6Y",{resources:[{downloadUrl:base+endpoint}]});await drain(f.run.id);assert.equal((await results(f.run.id))[0]!.data.reason,reason);
  }
  const mixed=await fixture("yiche","3BXWEB6Y",{resources:[{downloadUrl:base+"/header-large"},{downloadUrl:base+"/missing"}]});await drain(mixed.run.id);assert.equal((await results(mixed.run.id))[0]!.data.versionConclusion,"other_versions_unverified");
});

test("candidate retry exhaustion is bounded, and a direct native candidate uses its own outbound switch",async()=>{
  const exhausted=await fixture("yiche","3BXWEB6Y",{resources:[{downloadUrl:base+"/never"}]});await sql`UPDATE operation_runs SET progress='{"transferAttempts":2}' WHERE id=${exhausted.run.id}`;
  const count=hits.length;await drain(exhausted.run.id);assert.equal(hits.length,count);assert.equal((await results(exhausted.run.id))[0]!.data.reason,"transfer_retry_exhausted");
  const native=await fixture("wechat","synthetic",{},true,{provider:"dajiala",manifest:(receiptId,attempt)=>frozenVideoManifest(receiptId,attempt,{video:true},[{candidates:[{url:base+"/native",provider:"dajiala",field:"video.src",quality:"unknown"}]}],true)});
  process.env.REDFOX_CALLS_ENABLED="false";
  try{assert.equal((await drain(native.run.id)).status,"completed");assert.equal((await results(native.run.id))[0]!.data.saved,1);}finally{process.env.REDFOX_CALLS_ENABLED="true";}
});

test("recovery queues existing tombstones and local no-parser outcomes with outbound closed",async()=>{
  const old=await fixture("yiche","3BXWEB6Y",{resources:[{downloadUrl:base+"/old-expired"}]});await drain(old.run.id);
  await deleteAsset((await results(old.run.id))[0]!.file_key);
  const count=hits.length;
  process.env.REDFOX_CALLS_ENABLED="false";process.env.COLLECT_ENABLED="false";
  try {
    for(const record of [{resources:[{downloadUrl:base+"/never-again"}]},{resources:[]}]) {
      const pending=await fixture("yiche","3BXWEB6Y",record,true,record.resources.length?{workId:old.workId}:{});
      const current=await row(pending.run.id);
      await sql`UPDATE pgboss.job SET state='completed' WHERE id=${current.job_id}`;
      await sql`INSERT INTO settings(key,value,updated_by) VALUES('operations.recovery-cursor',${sql.json(pending.run.id-1)},'synthetic') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
      assert.equal((await recoverOperations()).requeued,1);
      assert.equal((await drain(pending.run.id)).status,"completed");
    }
    assert.equal(hits.length,count);
  }finally{process.env.REDFOX_CALLS_ENABLED="true";process.env.COLLECT_ENABLED="true";}
});

test("reuse must not attribute an untried high bitrate candidate", async()=>{
 const a=await fixture('x','QCP75W33',{medias:[{type:'video',variants:[{contentType:'video/mp4',url:base+'/header-large',bitrate:1000},{contentType:'video/mp4',url:base+'/low',bitrate:100}]}]});
 assert.equal((await drain(a.run.id)).status,'completed');const [ar]=await results(a.run.id);assert.equal(ar.data.selectedCandidate.bitrate,100);
 const b=await fixture('x','QCP75W33',{medias:[{type:'video',variants:[{contentType:'video/mp4',url:base+'/high',bitrate:1000}]}]},true,{workId:a.workId});
 const before=hits.length;assert.equal((await drain(b.run.id)).status,'completed');const [br]=await results(b.run.id);
 assert.equal(br.data.selectedCandidate,null);assert.equal(br.file_key,ar.file_key);assert.equal(br.data.reused,true);assert.equal(hits.length,before);
});
