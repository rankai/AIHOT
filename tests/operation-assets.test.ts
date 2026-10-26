import { Readable } from "node:stream";
import { tag, gate } from "./setup.ts";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readdir, readFile, rename, mkdir, rmdir, writeFile, utimes, stat, mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { createRun } from "@aihot/backend/providers/operations/store";
import { deleteAsset, cleanupAssets, prepareUpload, assetPath, ASSET_BACKUP_LOCK, UPLOAD_BYTES, publishUpload, writeUpload } from "@aihot/backend/operations/assets";
import { withAssetBackupLock } from "@aihot/backend/operations/backup";
import { buildApp } from "../apps/api/src/app.ts";
const testDir=await mkdtemp(path.join(tmpdir(),"aihot-operation-assets-"));
config.dataDir=testDir;
const app = await buildApp();
let image: Buffer;
let port: number;
before(async () => { image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer(); await app.listen({ port: 0, host: "127.0.0.1" }); port = (app.server.address() as {port:number}).port; });
after(async () => { await app.close(); await closeDb(); await rm(testDir,{recursive:true,force:true}); });
function body(data: Buffer, mime = "image/png", filename = "synthetic.png") {
  return Buffer.concat([Buffer.from(`--asset-test\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`), data, Buffer.from("\r\n--asset-test--\r\n")]);
}
const headers = (key = tag()) => ({ "content-type": "multipart/form-data; boundary=asset-test", "idempotency-key": key, "x-csrf-token": "dev" });
test("upload publishes a complete private image; same command reuses bytes and rejects changed content", async () => {
  config.devAdmin = {displayName:"Asset test"}; const h = headers();
  const first = await app.inject({method:"POST",url:"/api/admin/assets",headers:h,payload:body(image)});
  assert.equal(first.statusCode,201,first.body); const asset = first.json();
  assert.equal(asset.status,"available"); assert.equal(asset.metadata.width,2);
  assert.deepEqual(await readFile(`${config.dataDir}/${asset.key}`),image);
  const second = await app.inject({method:"POST",url:"/api/admin/assets",headers:h,payload:body(image)});
  assert.equal(second.statusCode,201); assert.equal(second.json().key,asset.key);
  const different = await sharp({create:{width:2,height:2,channels:3,background:"blue"}}).png().toBuffer();
  assert.equal((await app.inject({method:"POST",url:"/api/admin/assets",headers:h,payload:body(different)})).statusCode,409);
  assert.equal((await sql`SELECT count(*)::int AS n FROM stored_files WHERE key=${asset.key}`)[0]!.n,1);
  assert.deepEqual(await readdir(`${config.dataDir}/operation-tmp`),[]);
});
test("authentication and CSRF reject before the client sends a body", async () => {
  for (const [admin,csrf,status] of [[null,"dev",401],[{displayName:"Asset test"},"wrong",403]] as const) {
    config.devAdmin=admin;
    const result = await new Promise<number>((resolve,reject) => {
      const req=http.request({hostname:"127.0.0.1",port,path:"/api/admin/assets",method:"POST",headers:{...headers(),"x-csrf-token":csrf,"content-length":10000000}},res=>{res.resume();resolve(res.statusCode!);req.destroy();});
      req.on("error",reject);req.flushHeaders();
    }); assert.equal(result,status);
  }
  config.devAdmin={displayName:"Asset test"};
});
test("fake MIME, invalid image and over-limit stream leave no temporary files", async () => {
  assert.equal((await app.inject({method:"POST",url:"/api/admin/assets",headers:headers(),payload:body(image,"image/jpeg")})).statusCode,415);
  assert.equal((await app.inject({method:"POST",url:"/api/admin/assets",headers:headers(),payload:body(image.subarray(0,15))})).statusCode,422);
  const over = await app.inject({method:"POST",url:"/api/admin/assets",headers:headers(),payload:body(Buffer.alloc(10*1024*1024+1))});
  assert.equal(over.statusCode,413,over.body);
  assert.deepEqual(await readdir(`${config.dataDir}/operation-tmp`),[]);
});
test("chunked file limit and mid-file disconnect clean their temporary files", async () => {
  const over = await new Promise<number>((resolve,reject) => {
    const req=http.request({hostname:"127.0.0.1",port,path:"/api/admin/assets",method:"POST",headers:headers()},res=>{res.resume();resolve(res.statusCode!);});
    req.on("error",reject);
    const payload=body(Buffer.alloc(10*1024*1024+1));
    for(let offset=0;offset<payload.length;offset+=65536)req.write(payload.subarray(offset,offset+65536));
    req.end();
  });
  assert.equal(over,413);
  await new Promise<void>((resolve,reject) => {
    const req=http.request({hostname:"127.0.0.1",port,path:"/api/admin/assets",method:"POST",headers:headers()});
    req.on("error",()=>{});
    req.write(body(image).subarray(0,-20));
    const check=setInterval(async()=>{
      try { if ((await readdir(`${config.dataDir}/operation-tmp`)).length) { clearInterval(check); req.destroy(); resolve(); } }
      catch(error) { clearInterval(check); reject(error); }
    },10);
    setTimeout(()=>{clearInterval(check);req.destroy();reject(new Error("upload did not start"));},3000).unref();
  });
  for(let i=0;i<100;i++) {
    if(!(await readdir(`${config.dataDir}/operation-tmp`)).length)return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail("disconnected upload left a temporary file");
});
test("chunked multipart preamble total limit returns a complete 413 before closing", async () => {
  const result = await new Promise<{status:number;body:string;connection:string|undefined}>((resolve,reject) => {
    const req=http.request({hostname:"127.0.0.1",port,path:"/api/admin/assets",method:"POST",headers:headers()},res=>{
      const chunks:Buffer[]=[];res.on("data",c=>chunks.push(c));res.on("error",reject);
      res.on("end",()=>resolve({status:res.statusCode!,body:Buffer.concat(chunks).toString(),connection:res.headers.connection}));
    });
    req.on("error",reject);
    // No file part and no terminal chunk: the server must reject without draining.
    req.write(Buffer.alloc(UPLOAD_BYTES+1,65));
  });
  assert.equal(result.status,413);assert.equal(result.connection,"close");
  assert.match(result.body,/64 KiB/);
  assert.deepEqual(await readdir(`${config.dataDir}/operation-tmp`),[]);
});
test("upload deadline uses the same response-preserving cancellation and clears a partial file", async t => {
  const original=setTimeout;
  let fire:(()=>void)|undefined;
  // Capture only this route's deadline; normal HTTP/timers remain real.
  t.mock.method(globalThis,"setTimeout",((callback:(...args:unknown[])=>void,delay?:number,...args:unknown[])=>{
    if(delay===60_000){fire=()=>callback(...args);return original(()=>{},60_000);}
    return original(callback,delay,...args);
  }) as typeof setTimeout);
  const resultPromise = new Promise<{status:number;body:string}>((resolve,reject) => {
    const req=http.request({hostname:"127.0.0.1",port,path:"/api/admin/assets",method:"POST",headers:headers()},res=>{
      const chunks:Buffer[]=[];res.on("data",c=>chunks.push(c));res.on("error",reject);
      res.on("end",()=>resolve({status:res.statusCode!,body:Buffer.concat(chunks).toString()}));
    });
    req.on("error",reject);req.write(body(image).subarray(0,-20));
  });
  for(let i=0;i<100;i++) {
    if(fire && (await readdir(`${config.dataDir}/operation-tmp`)).length)break;
    await new Promise(resolve=>original(resolve,10));
  }
  assert.ok(fire);assert.equal((await readdir(`${config.dataDir}/operation-tmp`)).length,1);
  fire();
  const result=await resultPromise;
  assert.equal(result.status,408);assert.match(result.body,/60 seconds/);
  assert.deepEqual(await readdir(`${config.dataDir}/operation-tmp`),[]);
});

async function uploaded() {
  config.devAdmin={displayName:"Asset test"};
  const response=await app.inject({method:"POST",url:"/api/admin/assets",headers:headers(),payload:body(image)});
  assert.equal(response.statusCode,201,response.body);return response.json();
}
const assetUrl=(key:string)=>`/api/admin/assets/${encodeURIComponent(key)}`;
const newRun=(tx:Parameters<typeof createRun>[0],key:string)=>createRun(tx,{actor:"asset-test",commandKey:tag(),provider:"redfox",operationKey:"redfox.test.assets",contractVersion:1,input:{fileKeys:[key]},stepKey:"synthetic"});
test("private metadata/list/content support HEAD and single ranges; no public asset route",async()=>{
  const asset=await uploaded(),url=assetUrl(asset.key);
  assert.equal((await app.inject({url})).json().key,asset.key);
  const listing=await app.inject({url:"/api/admin/assets"});assert.equal(listing.statusCode,200);assert.ok(Array.isArray(listing.json().items));
  const all=await app.inject({url:`${url}/content`});assert.deepEqual(all.rawPayload,image);
  const head=await app.inject({method:"HEAD",url:`${url}/content`});assert.equal(head.statusCode,200);assert.equal(head.body,"");assert.equal(Number(head.headers["content-length"]),image.length);
  for(const [range,start,end] of [["bytes=2-5",2,6],["bytes=-4",image.length-4,image.length],["bytes=3-",3,image.length]] as const){
    const response=await app.inject({url:`${url}/content`,headers:{range}});assert.equal(response.statusCode,206);assert.deepEqual(response.rawPayload,image.subarray(start,end));
  }
  for(const range of ["bytes=999999-","bytes=0-1,3-4","bytes=-0"]){const r=await app.inject({url:`${url}/content`,headers:{range}});assert.equal(r.statusCode,416);assert.equal(r.headers["content-range"],`bytes */${image.length}`);}
  assert.equal((await app.inject({url:`/${asset.key}`})).statusCode,404);
  config.devAdmin=null;assert.equal((await app.inject({url:`${url}/content`})).statusCode,401);config.devAdmin={displayName:"Asset test"};
});
test("run creation and deletion serialize on the input asset; stopped retains and terminal releases",async()=>{
  const asset=await uploaded(),locked=gate(),commit=gate();
  const creating=sql.begin(async tx=>{const run=await newRun(tx,asset.key);locked.open();await commit.promise;return run;});
  await locked.promise;
  let settled=false;const deleting=deleteAsset(asset.key).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(settled,false);commit.open();const run=await creating;
  assert.equal((await deleting).statusCode,409);
  await sql`UPDATE operation_runs SET status='stopped' WHERE id=${run.id}`;
  await assert.rejects(deleteAsset(asset.key),/recoverable/);
  await sql`UPDATE operation_runs SET status='completed' WHERE id=${run.id}`;
  const deleted=await deleteAsset(asset.key);assert.equal(deleted.status,"deleted");assert.equal(deleted.metadata.filename,asset.metadata.filename);
  await assert.rejects(sql.begin(tx=>newRun(tx,asset.key)),/unavailable/);
  assert.equal((await deleteAsset(asset.key)).status,"deleted");
  const second=await uploaded(),marked=gate(),release=gate();
  const marking=sql.begin(async tx=>{await tx`SELECT key FROM stored_files WHERE key=${second.key} FOR UPDATE`;await tx`UPDATE stored_files SET status='deleting' WHERE key=${second.key}`;marked.open();await release.promise;});
  await marked.promise;let created=false;const blocked=sql.begin(tx=>newRun(tx,second.key)).then(()=>{created=true;return null;},e=>e);
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(created,false);release.open();await marking;assert.match((await blocked).message,/unavailable/);await deleteAsset(second.key);
});
test("failed unlink remains deleting and cleanup retries; only aged inactive temporary/orphan files are removed",async()=>{
  const asset=await uploaded(),file=assetPath(asset.key),saved=`${config.dataDir}/operation-tmp/${tag()}`;
  await rename(file,saved);await mkdir(file);await assert.rejects(deleteAsset(asset.key));
  assert.equal((await sql`SELECT status FROM stored_files WHERE key=${asset.key}`)[0]!.status,"deleting");
  await rmdir(file);await rename(saved,file);
  const old=new Date(Date.now()-2*86400_000);
  const orphan=`${config.dataDir}/uploads/redfox/${"a".repeat(64)}`,fresh=`${config.dataDir}/uploads/redfox/${"b".repeat(64)}`;
  const stale=`${config.dataDir}/operation-tmp/${randomUUID()}`;
  await writeFile(orphan,image);await utimes(orphan,old,old);await writeFile(fresh,image);await writeFile(stale,image);await utimes(stale,old,old);
  const active=await prepareUpload();await writeFile(active.file,image);await utimes(active.file,old,old);
  try {const report=await cleanupAssets();assert.ok(report.deleted>=1);assert.ok(report.orphans>=1);assert.ok(report.temporary>=1);assert.deepEqual(report.failures,[]);
    await assert.rejects(stat(orphan));await assert.rejects(stat(stale));await stat(fresh);await stat(active.file);
    assert.equal((await sql`SELECT status FROM stored_files WHERE key=${asset.key}`)[0]!.status,"deleted");
  } finally {await active.release();}
});

test("backup session lock blocks formal deletion but permits uploads, and releases after failure",async()=>{
  const asset=await uploaded(),entered=gate(),release=gate();
  const backup=withAssetBackupLock(async()=>{entered.open();await release.promise;throw new Error("synthetic archive failure");}).then(()=>null,error=>error);
  await entered.promise;
  let removed=false;const deleting=deleteAsset(asset.key).then(value=>{removed=true;return value;});
  try {
    for(let i=0;i<100;i++){if((await sql`SELECT status FROM stored_files WHERE key=${asset.key}`)[0]!.status==="deleting")break;await new Promise(r=>setTimeout(r,10));}
    assert.equal((await sql`SELECT status FROM stored_files WHERE key=${asset.key}`)[0]!.status,"deleting");
    assert.equal(removed,false);await stat(assetPath(asset.key));
    const next=await uploaded();assert.equal(next.status,"available");
    const temp=await prepareUpload();await writeFile(temp.file,image);await temp.release();
  } finally {release.open();}
  assert.match((await backup).message,/synthetic archive failure/);
  assert.equal((await deleting).status,"deleted");
  const free=await sql.begin(async tx=>{const [row]=await tx`SELECT pg_try_advisory_xact_lock(${ASSET_BACKUP_LOCK}) AS acquired`;return row!.acquired;});
  assert.equal(free,true);
});
test("successful upload and delete audit actor and asset once across idempotent retries",async()=>{
  config.devAdmin={displayName:"Asset test"};const h=headers();
  const upload=()=>app.inject({method:"POST",url:"/api/admin/assets",headers:h,payload:body(image)});
  const first=await upload();assert.equal(first.statusCode,201);const key=first.json().key;
  assert.equal((await upload()).statusCode,201);
  for(let i=0;i<2;i++)assert.equal((await app.inject({method:"DELETE",url:assetUrl(key),headers:{"x-csrf-token":"dev"}})).statusCode,200);
  const records=await sql`SELECT actor,action,"after" FROM audit_log WHERE subject=${key} ORDER BY id`;
  assert.deepEqual(records.map(r=>r.action),["asset.upload","asset.delete_requested","asset.delete"]);
  assert.ok(records.every(r=>r.actor.includes("Asset test")));assert.equal(records[0]!.after.bytes,image.length);
  assert.equal(records[2]!.after.status,"deleted");
});
test("persistent cleanup cursors advance past 200 registered files and 50 failed deletions",async()=>{
  await mkdir(path.join(config.dataDir,"uploads/redfox"),{recursive:true});
  const saved=await sql`SELECT * FROM settings WHERE key IN ('assets.temp-cursor','assets.orphan-cursor','assets.deletion-cursor')`;
  await sql`DELETE FROM settings WHERE key IN ('assets.temp-cursor','assets.orphan-cursor','assets.deletion-cursor')`;
  const registered=Array.from({length:201},(_,i)=>`uploads/redfox/${(i+1000).toString(16).padStart(64,"0")}`);
  const blocked=Array.from({length:50},(_,i)=>`uploads/redfox/1${(i+1000).toString(16).padStart(63,"0")}`);
  const orphan=`uploads/redfox/${"f".repeat(64)}`,last=`uploads/redfox/2${"0".repeat(63)}`;
  const old=new Date(Date.now()-2*86400_000);
  try {
    await sql`INSERT INTO stored_files ${sql(registered.map(key=>({key,content_type:"image/png",bytes:image.length,purpose:"operation-input",status:"available"})))}`;
    for(const key of registered){await writeFile(assetPath(key),image);await utimes(assetPath(key),old,old);}
    await writeFile(assetPath(orphan),image);await utimes(assetPath(orphan),old,old);
    await sql`INSERT INTO stored_files ${sql([...blocked,last].map(key=>({key,content_type:"image/png",bytes:image.length,purpose:"operation-input",status:"deleting"})))}`;
    for(const key of blocked)await mkdir(assetPath(key));
    await writeFile(assetPath(last),image);
    const first=await cleanupAssets();assert.equal(first.failures.length,50);await stat(assetPath(orphan));
    const [cursor]=await sql`SELECT value FROM settings WHERE key='assets.orphan-cursor'`;assert.ok(cursor!.value);
    const second=await cleanupAssets();assert.ok(second.orphans>=1);await assert.rejects(stat(assetPath(orphan)));
    assert.equal((await sql`SELECT status FROM stored_files WHERE key=${last}`)[0]!.status,"deleted");
    assert.ok(first.deleted>=1);assert.equal(second.failures.filter(key=>blocked.includes(key)).length,50);
  } finally {
    for(const key of [...registered,...blocked,orphan,last])await rm(assetPath(key),{recursive:true,force:true});
    await sql`DELETE FROM stored_files WHERE key = ANY(${sql.array([...registered,...blocked,last])})`;
    await sql`DELETE FROM settings WHERE key IN ('assets.temp-cursor','assets.orphan-cursor','assets.deletion-cursor')`;
    for(const row of saved)await sql`INSERT INTO settings(key,value,updated_by) VALUES (${row.key},${sql.json(row.value)},${row.updated_by})`;
  }
});

test("documented media inputs publish canonical MIME, image-only dimensions and private ranges",async()=>{
  const fixtures=JSON.parse(await readFile(new URL('./fixtures/operation-media.json',import.meta.url),'utf8')).files as Array<{filename:string;mime:string;base64:string}>;
  for(const f of fixtures){const bytes=Buffer.from(f.base64,'base64'),response=await app.inject({method:'POST',url:'/api/admin/assets',headers:headers(),payload:body(bytes,f.mime,f.filename)});
    if(f.filename.endsWith('.m4a')){assert.equal(response.statusCode,415,response.body);continue;}
    assert.equal(response.statusCode,201,`${f.filename}: ${response.body}`);const asset=response.json();
    if(f.mime.startsWith('image/')){assert.ok(asset.metadata.width>0);assert.ok(asset.metadata.height>0);if(f.filename==='animated.gif'){assert.equal(asset.metadata.pages,3);assert.equal(asset.metadata.height,32);}}
    else {assert.equal(asset.metadata.width,undefined);assert.equal(asset.metadata.height,undefined);assert.equal(asset.metadata.validation,'type-and-header');}
    if(f.filename.endsWith('.wav'))assert.equal(asset.content_type,'audio/wav');if(f.filename.endsWith('.avi'))assert.equal(asset.content_type,'video/vnd.avi');
    const range=await app.inject({url:`/api/admin/assets/${encodeURIComponent(asset.key)}/content`,headers:{range:'bytes=0-3'}});assert.equal(range.statusCode,206);assert.deepEqual(range.rawPayload,bytes.subarray(0,4));assert.equal(range.headers['x-content-type-options'],'nosniff');
  }
});
test("media rejects bare signatures, disguised content, truncated BMP and category limits without temp leaks",async()=>{
 const fixtures=JSON.parse(await readFile(new URL('./fixtures/operation-media.json',import.meta.url),'utf8')).files as Array<{filename:string;mime:string;base64:string}>;
 for(const [bytes,mime,name] of [[Buffer.from('BM'),'image/bmp','short.bmp'],[Buffer.from([255,241]),'audio/aac','short.aac'],[Buffer.from([255,251]),'audio/mpeg','short.mp3']] as const)assert.equal((await app.inject({method:'POST',url:'/api/admin/assets',headers:headers(),payload:body(bytes,mime,name)})).statusCode,422);
 assert.equal((await app.inject({method:'POST',url:'/api/admin/assets',headers:headers(),payload:body(image,'video/mp4','fake.mp4')})).statusCode,415);
 const bmp=Buffer.from(fixtures.find(f=>f.filename==='tiny.bmp')!.base64,'base64');bmp.writeUInt32LE(bmp.length+100,2);assert.equal((await app.inject({method:'POST',url:'/api/admin/assets',headers:headers(),payload:body(bmp,'image/bmp','broken.bmp')})).statusCode,422);
 for(const [limit,mime,name] of [[10_000_000,'image/png','large.png'],[20_000_000,'audio/wav','large.wav']] as const)assert.equal((await app.inject({method:'POST',url:'/api/admin/assets',headers:headers(),payload:body(Buffer.alloc(limit+1),mime,name)})).statusCode,413);
 assert.equal((await app.inject({method:'POST',url:'/api/admin/assets',headers:headers(),payload:body(image,'application/octet-stream','x.png')})).statusCode,415);
 assert.deepEqual(await readdir(`${config.dataDir}/operation-tmp`),[]);
});
test("m4a is explicit output only; Windows basename is sanitized and nonimage idempotency remains immutable",async()=>{
 const fixtures=JSON.parse(await readFile(new URL('./fixtures/operation-media.json',import.meta.url),'utf8')).files as Array<{filename:string;mime:string;base64:string}>;
 const f=fixtures.find(f=>f.filename==='tiny.m4a')!,bytes=Buffer.from(f.base64,'base64'),temp=await prepareUpload(),key=`uploads/redfox/${'a'.repeat(32)}${randomUUID().replaceAll('-','')}`;
 try{const content=await writeUpload(Readable.from(bytes),temp.file,new AbortController().signal);const input={actor:'synthetic',key,file:temp.file,filename:'C:\\fake\\tiny.m4a',mime:f.mime,...content,purpose:'operation-output' as const};const one=await publishUpload(input);assert.equal(one.metadata.filename,'tiny.m4a');assert.equal(one.metadata.kind,'audio');assert.equal(one.metadata.width,undefined);assert.equal((await publishUpload(input)).key,key);}finally{await temp.release();}
});
test("private upload options expose actual input limits and MOV permits an eight-byte leading box", async () => {
  config.devAdmin=null;
  assert.equal((await app.inject({method:"GET",url:"/api/admin/assets/options"})).statusCode,401);
  config.devAdmin={displayName:"Asset test"};
  const response=await app.inject({method:"GET",url:"/api/admin/assets/options"});
  assert.equal(response.statusCode,200);const options=response.json();
  assert.deepEqual(options.limits,{imageBytes:10_000_000,audioBytes:20_000_000,videoBytes:50_000_000,imagePixels:16_000_000});
  assert.equal(options.formats.some((f:{format:string})=>f.format==="m4a"),false);
  assert.deepEqual(options.imageValidation.bmp.dibHeaders,[12,40,108,124]);
  assert.equal(options.imageValidation.gif.totalFramePixels,16_000_000);
  const fixtures=JSON.parse(await readFile(new URL("./fixtures/operation-media.json",import.meta.url),"utf8"));
  const mov=Buffer.from(fixtures.files.find((f:{filename:string})=>f.filename==="tiny.mov").base64,"base64");
  for(const kind of ["wide","free"]){
    const box=Buffer.alloc(8);box.writeUInt32BE(8);box.write(kind,4);
    const upload=await app.inject({method:"POST",url:"/api/admin/assets",headers:headers(),payload:body(Buffer.concat([box,mov]),"video/quicktime","tiny.mov")});
    assert.equal(upload.statusCode,201,upload.body);assert.equal(upload.json().content_type,"video/quicktime");
  }
});

test("one retention pass drains expired pages, attempts failures once and defers later expiry",async()=>{
  const [cursor]=await sql`SELECT value FROM settings WHERE key='assets.deletion-cursor'`;
  const keys=Array.from({length:54},()=>`uploads/redfox/${randomUUID().replaceAll("-","")+randomUUID().replaceAll("-","")}`).sort();
  const blocked=keys[0]!,protectedKey=keys[51]!,later=keys[53]!,cutoff=new Date(Date.now()-1000);
  let runId:number|undefined;
  try{
    await mkdir(path.dirname(assetPath(blocked)),{recursive:true});
    for(const key of keys){
      if(key===blocked)await mkdir(assetPath(key));else await writeFile(assetPath(key),image);
      await sql`INSERT INTO stored_files(key,content_type,bytes,purpose,metadata,expires_at) VALUES(${key},'video/mp4',${image.length},'operation-output',${sql.json({filename:"synthetic.mp4",origin:"subscription-video",kind:"video"})},now()+interval '1 day')`;
    }
    runId=(await sql.begin(tx=>newRun(tx,protectedKey))).id;
    await sql`UPDATE stored_files SET expires_at=${new Date(cutoff.getTime()-1000)} WHERE key IN ${sql(keys.filter(key=>key!==later))}`;
    await sql`UPDATE stored_files SET expires_at=${new Date(cutoff.getTime()+500)} WHERE key=${later}`;
    // Resume after a failed key: more than 50 upper keys and the lower key belong to this pass.
    await sql`INSERT INTO settings(key,value) VALUES('assets.deletion-cursor',${sql.json(blocked)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    const first=await cleanupAssets(cutoff);
    assert.equal(first.failures.filter(key=>key===blocked).length,1);assert.equal(first.failures.filter(key=>key===protectedKey).length,1);
    const remaining=await sql`SELECT key FROM stored_files WHERE key IN ${sql(keys)} AND status<>'deleted' ORDER BY key`;
    assert.deepEqual(remaining.map(r=>r.key),[blocked,protectedKey,later]);
    for(const key of keys.filter(key=>![blocked,protectedKey,later].includes(key)))await assert.rejects(stat(assetPath(key)));
    await rmdir(assetPath(blocked));await writeFile(assetPath(blocked),image);
    await sql`UPDATE operation_runs SET status='completed' WHERE id=${runId}`;
    const second=await cleanupAssets();assert.ok(!second.failures.includes(blocked)&&!second.failures.includes(protectedKey));
    assert.equal((await sql`SELECT key FROM stored_files WHERE key IN ${sql(keys)} AND status<>'deleted'`).length,0);
  }finally{
    if(runId)await sql`UPDATE operation_runs SET status='completed' WHERE id=${runId}`;
    for(const key of keys)await rm(assetPath(key),{recursive:true,force:true});
    await sql`DELETE FROM stored_files WHERE key IN ${sql(keys)}`;
    if(cursor)await sql`UPDATE settings SET value=${sql.json(cursor.value)} WHERE key='assets.deletion-cursor'`;else await sql`DELETE FROM settings WHERE key='assets.deletion-cursor'`;
  }
});
