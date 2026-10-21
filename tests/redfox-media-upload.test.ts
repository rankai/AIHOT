import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {before,after,test} from "node:test";
import http from "node:http";
import {mkdtemp,rm,readFile,unlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {Readable} from "node:stream";
import sharp from "sharp";
import {config} from "@aihot/backend/config";
import {sql,closeDb} from "@aihot/backend/db";
import {stopBoss} from "@aihot/backend/jobs/queue";
import {prepareUpload,writeUpload,publishUpload,uploadKey,assetPath,deleteAsset} from "@aihot/backend/operations/assets";
import {createMediaUpload} from "@aihot/backend/providers/redfox/media-upload";
import {executeOperationStep} from "@aihot/backend/providers/operations/execute";
import {releaseOperationReceipt,recoverOperations} from "@aihot/backend/providers/operations/recovery";
import {abandonRun,claimRun,receiptOptions,resumeRun} from "@aihot/backend/providers/operations/store";
import {queueOperationStep} from "@aihot/backend/providers/operations/queue";
import {inputMediaFormat} from "@aihot/backend/operations/asset-media";
import {assetUploadOptions} from "@aihot/backend/operations/assets";
import {redfoxRequest} from "@aihot/backend/providers/redfox/client";
import {buildApp} from "../apps/api/src/app.ts";
const dir=await mkdtemp(path.join(tmpdir(),"aihot-media-upload-"));config.dataDir=dir;
const runs:number[]=[];let hits=0,mode="ok",wire:Buffer,wireType="",wireUrl="";
const server=http.createServer((req,res)=>{const chunks:Buffer[]=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{
 hits++;wire=Buffer.concat(chunks);wireType=String(req.headers["content-type"]);wireUrl=req.url!;
 assert.equal(req.method,"POST");assert.equal(req.headers.redfox_api_key,"synthetic-media-upload-key");
 if(mode==="unknown"){req.socket.destroy();return;}res.setHeader("content-type","application/json");
 if(mode==="bad"){res.end("{broken");return;}
 res.end(JSON.stringify({code:2000,data:{imageUrl:"https://supplier.example.test/asset",format:mode==="mismatch"?"other":new URL(req.url!,"http://localhost").searchParams.get("format")}}));
});});
let budgets:Array<{per_minute:number;per_hour:number;per_day:number}>=[];
const app=await buildApp();
before(async()=>{await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY="synthetic-media-upload-key";process.env.REDFOX_CALLS_ENABLED="true";process.env.MODEL_CALLS_ENABLED="false";process.env.COLLECT_ENABLED="false";config.allowPrivateNetworkFetch=true;config.devAdmin={displayName:"Media test"};budgets=await sql`SELECT * FROM budgets WHERE service='redfox.media'`;await sql`UPDATE budgets SET per_minute=10000,per_hour=100000,per_day=1000000 WHERE service='redfox.media'`;});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const execute=async(id:number)=>{const r=await row(id);return executeOperationStep(id,r.step_version,r.job_id);};
after(async()=>{for(const id of runs){const r=await row(id);if(!["completed","failed"].includes(r.status))await sql.begin(tx=>abandonRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation},"test cleanup"));}for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service='redfox.media'`;await app.close();await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();await rm(dir,{recursive:true,force:true});});
async function asset(ext="png"){
 let bytes:Buffer,mime:string;if(ext==="png"){bytes=await sharp({create:{width:2,height:2,channels:3,background:"red"}}).png().toBuffer();mime="image/png";}else{const f=JSON.parse(await readFile(new URL("./fixtures/operation-media.json",import.meta.url),"utf8")).files.find((f:{filename:string})=>f.filename===`tiny.${ext}`);bytes=Buffer.from(f.base64,"base64");mime=f.mime;}
 const temp=await prepareUpload();try{const content=await writeUpload(Readable.from(bytes),temp.file,new AbortController().signal);return {bytes,asset:await publishUpload({actor:"test",key:uploadKey("test",tag()),file:temp.file,filename:`tiny.${ext}`,mime,...content})};}finally{await temp.release();}
}
async function command(key:string){const run=await createMediaUpload({fileKey:key},"test",tag());runs.push(run.id);return run;}
test("PNG audio video multipart uses fixed query, actual MIME and immutable bytes; zero-price media receipts",async()=>{
 for(const ext of ["png","mp3","mp4"]){const a=await asset(ext),run=await command(a.asset.key);await assert.rejects(deleteAsset(a.asset.key),/task/);await execute(run.id);assert.equal((await row(run.id)).status,"completed");assert.match(wireType,/multipart\/form-data; boundary=/);assert.equal(wireUrl,`/story/api/parseWork/videoGen/uploadFile?format=${ext}`);assert.ok(wire.includes(a.bytes));assert.ok(wire.toString().includes(`Content-Type: ${a.asset.content_type}`));
 const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(result!.kind,"media_upload");assert.equal(result!.file_key,a.asset.key);assert.equal(result!.data.sha256,a.asset.sha256);
 const [receipt]=await sql`SELECT * FROM receipts WHERE id=${result!.receipt_id}`;assert.equal(receipt!.service,"redfox.media");assert.equal(receipt!.model,"6L178PZD");assert.equal(Number(receipt!.cost),0);assert.equal(receipt!.currency,"CNY");assert.equal(receipt!.cost_basis,"estimated");assert.ok(!JSON.stringify({run:await row(run.id),receipt,result}).includes("synthetic-media-upload-key"));await deleteAsset(a.asset.key);
 }
});
test("HTTP options are free; auth CSRF strict input and command idempotency",async()=>{
 for(const format of assetUploadOptions().formats)assert.equal(inputMediaFormat(format.mime,100),format.format);
 assert.throws(()=>inputMediaFormat("audio/x-m4a",100));
 const count=hits;config.devAdmin=null;assert.equal((await app.inject({method:"GET",url:"/api/admin/redfox/media/uploads/options"})).statusCode,401);config.devAdmin={displayName:"Media test"};assert.equal((await app.inject({method:"GET",url:"/api/admin/redfox/media/uploads/options"})).statusCode,200);
 const a=await asset(),b=await asset(),headers={"idempotency-key":tag(),"x-csrf-token":"dev"},url="/api/admin/redfox/media/uploads";
 assert.equal((await app.inject({method:"POST",url,payload:{fileKey:a.asset.key}})).statusCode,403);
 assert.equal((await app.inject({method:"POST",url,headers,payload:{fileKey:a.asset.key,apiKey:"not-allowed"}})).statusCode,400);
 const first=await app.inject({method:"POST",url,headers,payload:{fileKey:a.asset.key}});assert.equal(first.statusCode,202,first.body);runs.push(first.json().runId);
 const repeat=await app.inject({method:"POST",url,headers,payload:{fileKey:a.asset.key}});assert.equal(repeat.json().runId,first.json().runId);assert.equal((await app.inject({method:"POST",url,headers,payload:{fileKey:b.asset.key}})).statusCode,409);assert.equal(hits,count);
});
test("missing local file, disabled outbound and zero budget roll back all placeholders",async()=>{
 const count=hits;
 for(const reason of ["missing","disabled","budget"]){const a=await asset(),run=await command(a.asset.key);if(reason==="missing")await unlink(assetPath(a.asset.key));if(reason==="disabled")process.env.REDFOX_CALLS_ENABLED="false";if(reason==="budget")await sql`UPDATE budgets SET per_minute=0,per_hour=0,per_day=0 WHERE service='redfox.media'`;
 try{await execute(run.id);assert.equal((await row(run.id)).current_receipt_id,null);const [n]=await sql`SELECT count(*)::int n FROM receipts WHERE request->>'window'=${`run:${run.id}:upload`}`;assert.equal(n!.n,0);}finally{process.env.REDFOX_CALLS_ENABLED="true";await sql`UPDATE budgets SET per_minute=10000,per_hour=100000,per_day=1000000 WHERE service='redfox.media'`;}}
 assert.equal(hits,count);
});
test("unknown upload is manual even after thirty minutes; malformed and mismatched replies remain retained",async()=>{
 for(const failure of ["unknown","bad","mismatch"]){mode=failure;const a=await asset(),run=await command(a.asset.key);await execute(run.id);const r=await row(run.id);assert.equal(r.status,"needs_review");const [receipt]=await sql`SELECT * FROM receipts WHERE id=${r.current_receipt_id}`;assert.equal(receipt!.status,failure==="unknown"?"unknown":"received");
 if(failure==="unknown"){await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${receipt!.id}`;assert.equal((await releaseOperationReceipt(receipt!.id,true)).released,false);}else {
 assert.ok(receipt!.response.body);const before=hits;process.env.REDFOX_CALLS_ENABLED="false";
 try{await sql.begin(async tx=>{await resumeRun(tx,{runId:run.id,stepVersion:r.step_version,generation:r.generation});await queueOperationStep(tx,run.id);});await execute(run.id);assert.equal((await row(run.id)).status,"needs_review");assert.equal(hits,before);const [same]=await sql`SELECT attempts FROM receipts WHERE id=${receipt!.id}`;assert.equal(same!.attempts,1);}finally{process.env.REDFOX_CALLS_ENABLED="true";}
 }}
 mode="ok";
});
test("received upload survives lost job then completes via recovery with no file, key or outbound access",async()=>{
 const a=await asset(),run=await command(a.asset.key),r=await row(run.id);
 const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:r.step_version,generation:r.generation},r.job_id));const p=r.input.parameters;
 await redfoxRequest("6L178PZD",p,`run:${run.id}:upload`,"media",receiptOptions(execution),{file:assetPath(p.fileKey),format:p.format,mime:p.contentType});
 await sql`UPDATE pgboss.job SET state='completed' WHERE id=${r.job_id}`;await unlink(assetPath(a.asset.key));const count=hits;delete process.env.REDFOX_API_KEY;process.env.REDFOX_CALLS_ENABLED="false";
 try{for(let i=0;i<20&&(await row(run.id)).job_id===r.job_id;i++)await recoverOperations();assert.notEqual((await row(run.id)).job_id,r.job_id);await execute(run.id);assert.equal((await row(run.id)).status,"completed");assert.equal(hits,count);}finally{process.env.REDFOX_API_KEY="synthetic-media-upload-key";process.env.REDFOX_CALLS_ENABLED="true";}
});
