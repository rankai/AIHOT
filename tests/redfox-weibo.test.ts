import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { before,after,test } from "node:test";
import { sql,closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSynchronousQuery } from "@aihot/backend/providers/redfox/synchronous";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { importWeiboResult } from "@aihot/backend/providers/redfox/import-weibo";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { resumeRun } from "@aihot/backend/providers/operations/store";
import { releaseOperationReceipt } from "@aihot/backend/providers/operations/recovery";
import { WeiboOperationId } from "@aihot/backend/providers/redfox/weibo-contract";
const uid=`991${Date.now()}`,opusId=`992${Date.now()}`,mblogid=`T${tag().replace(/[^A-Za-z0-9]/g,"")}`;
let hits=0,disconnect=false,malformed=false;
let responseOverride:unknown=undefined;
const requests:{url:string;body:Record<string,unknown>}[]=[];
const work={opusId,mblogid,uid,nickname:"Synthetic author",text:"Synthetic work only",opusUrl:`https://weibo.com/${uid}/${opusId}`,publishTime:"Tue Oct 20 12:00:00 +0800 2026"};
const server=http.createServer((req,res)=>{hits++;if(disconnect){req.socket.destroy();return;}assert.equal(req.headers.redfox_api_key,"fake-weibo");let body="";req.on("data",chunk=>{body+=chunk;});req.on("end",()=>{requests.push({url:req.url!,body:JSON.parse(body)});
  const data=req.url?.endsWith("opusDetail")?work:req.url?.endsWith("userDetail")?{uid,nickname:"Synthetic author"}:req.url?.endsWith("accountSearch")?[{uid:Number(uid),name:"Synthetic author"}]:req.url?.endsWith("searchWork")?[{...work,mblogid:undefined,url:work.opusUrl}]:{cursor:"",hasMore:false,list:[{topSearchName:"Synthetic topic",topSearchNum:"10"}]};
  res.setHeader("content-type","application/json");res.end(malformed?"{bad":JSON.stringify({code:2000,data:responseOverride===undefined?data:typeof responseOverride==="function"?responseOverride(req.url):responseOverride}));
});});
let budget:Record<string,unknown>;let collectBudget:Record<string,unknown>;
before(async()=>{await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY="fake-weibo";process.env.REDFOX_CALLS_ENABLED="true";config.allowPrivateNetworkFetch=true;collectBudget=(await sql`SELECT * FROM budgets WHERE service='redfox.collect'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.collect'`;budget=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${collectBudget.per_minute as number},per_hour=${collectBudget.per_hour as number},per_day=${collectBudget.per_day as number} WHERE service='redfox.collect'`;await sql`UPDATE budgets SET per_minute=${budget.per_minute as number},per_hour=${budget.per_hour as number},per_day=${budget.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED="false";delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const run=await row(id);return executeOperationStep(id,run.step_version,randomUUID());};
async function query(operationId:string,parameters:Record<string,unknown>){const run=await createSynchronousQuery({operationId,parameters},"weibo-test",tag());await step(run.id);return {run:await row(run.id),results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};}
test("five fixed query APIs persist typed results; GET is free and commands are idempotent",async()=>{
  const {buildApp}=await import("../apps/api/src/app.ts");const app=await buildApp();
  try{config.devAdmin=null;assert.equal((await app.inject({url:"/api/admin/redfox/operations"})).statusCode,401);config.devAdmin={displayName:"Weibo test"};const beforeHits=hits;
    const catalog=await app.inject({url:"/api/admin/redfox/operations"});assert.equal(catalog.statusCode,200);assert.equal(catalog.json().filter((x:{id:string})=>WeiboOperationId.safeParse(x.id).success).length,5);assert.equal(hits,beforeHits);
    const cases:[string,Record<string,unknown>,string][]=[["API_1789098514899",{opusId},"weibo_work"],["API_1789098515117",{userId:uid},"weibo_account"],["API_1789098515245",{page:1,keyword:"synthetic"},"weibo_account"],["TXQPVGJG",{page:"1",keyword:"synthetic",searchType:"3"},"weibo_work"],["UAQ90A1F",{},"weibo_trend"]];
    for(const [operationId,parameters,kind] of cases){const payload={operationId,parameters},headers={"x-csrf-token":"dev","idempotency-key":tag()};
      assert.equal((await app.inject({method:"POST",url:"/api/admin/redfox/queries",payload,headers:{"idempotency-key":tag()}})).statusCode,403);
      const response=await app.inject({method:"POST",url:"/api/admin/redfox/queries",payload,headers});assert.equal(response.statusCode,202);const id=response.json().runId;
      assert.equal((await app.inject({method:"POST",url:"/api/admin/redfox/queries",payload,headers})).json().runId,id);await step(id);assert.equal((await row(id)).status,"completed");assert.equal((await sql`SELECT kind FROM operation_results WHERE run_id=${id}`)[0]!.kind,kind);
    }
    assert.equal(hits,beforeHits+5);
  }finally{config.devAdmin=null;await app.close();}
});
test("account binding and detail import preserve a legacy short URL and source permissions without network",async()=>{
  const source=`weibo-existing-${tag()}`;await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext) VALUES (${source},'Legacy author','external','editorial',true)`;
  const old=await upsertMaterial({sourceId:source,url:`https://weibo.com/${uid}/${mblogid}`,title:"Legacy body",via:"fetch"});
  const account=await query("API_1789098515117",{userId:uid});await importWeiboResult(account.results[0]!.id,{sourceId:source,reason:"Synthetic verified account"},"test",tag());
  const detail=await query("API_1789098514899",{opusId});const key=tag(),beforeHits=hits;
  const result=await importWeiboResult(detail.results[0]!.id,{reason:"Synthetic verified work"},"test",key);assert.equal(result?.articleId,old.articleId);
  assert.deepEqual(await importWeiboResult(detail.results[0]!.id,{reason:"Synthetic verified work"},"test",key),result);assert.equal(hits,beforeHits);
  assert.equal((await sql`SELECT site_fulltext FROM sources WHERE id=${source}`)[0]!.site_fulltext,true);
  assert.equal((await sql`SELECT url FROM articles WHERE id=${old.articleId}`)[0]!.url,`https://weibo.com/${uid}/${mblogid}`);
  await sql`UPDATE sources SET enabled=false WHERE id=${source}`;const another=await query("API_1789098514899",{opusId});await assert.rejects(importWeiboResult(another.results[0]!.id,{reason:"Disabled must block"},"test",tag()),/disabled/);
});
test("first unknown waits and received malformed raw is locally recoverable without repurchase",async()=>{
  disconnect=true;let run;try{run=await createSynchronousQuery({operationId:"UAQ90A1F",parameters:{}},"test",tag());await step(run.id);}finally{disconnect=false;}
  assert.equal((await row(run.id)).status,"waiting");assert.equal((await releaseOperationReceipt((await row(run.id)).current_receipt_id)).released,false);
  malformed=true;let broken;try{broken=await query("UAQ90A1F",{});}finally{malformed=false;}
  assert.equal(broken.run.status,"needs_review");const beforeHits=hits;await sql.begin(tx=>resumeRun(tx,{runId:broken.run.id,stepVersion:broken.run.step_version,generation:broken.run.generation}));process.env.REDFOX_CALLS_ENABLED="false";try{await step(broken.run.id);assert.equal((await row(broken.run.id)).status,"needs_review");assert.equal(hits,beforeHits);}finally{process.env.REDFOX_CALLS_ENABLED="true";}
});

test("empty account and work searches commit a receipt-linked summary and complete",async()=>{
  responseOverride=[];
  try {
    for(const [operation,parameters] of [["API_1789098515245",{page:1,keyword:"empty"}],["TXQPVGJG",{page:"1",searchType:"61",keyword:"empty"}]] as const){
      const result=await query(operation,parameters);assert.equal(result.run.status,"completed");assert.equal(result.results.length,1);
      assert.equal(result.results[0]!.kind,"query_summary");assert.equal(result.results[0]!.data.count,0);
      assert.equal((await sql`SELECT status FROM receipts WHERE id=${result.results[0]!.receipt_id}`)[0]!.status,"completed");
    }
  }finally{responseOverride=undefined;}
});
test("documented and ISO dates plus media survive import; unzoned or broken dates remain unknown",async()=>{
  const cases=[
    ["Mon Oct 19 12:00:00 +0800 2026","2026-10-19T04:00:00.000Z"],
    ["2026-10-19T12:00:00+08:00","2026-10-19T04:00:00.000Z"],
    ["2026-10-19 12:00:00",null],
    ["Mon Oct 99 99:00:00 +0800 2026",null],
  ] as const;
  const author=`993${Date.now()}`;
  try{for(const [i,[publishTime,expected]] of cases.entries()){
    const id=`994${Date.now()}${i}`;
    responseOverride={opusId:id,uid:author,text:"Synthetic media work",opusUrl:`https://weibo.com/${author}/${id}`,publishTime,
      picUrl:["https://example.com/synthetic.png","javascript:bad","not a URL"],videoUrl:"https://example.com/synthetic.mp4",cover:"https://example.com/synthetic-cover.png"};
    const result=await query("API_1789098514899",{opusId:id});assert.equal(result.run.status,"completed");
    const imported=await importWeiboResult(result.results[0]!.id,{reason:"Synthetic dated media"},"test",tag());
    const [article]=await sql`SELECT published_at,published_at_claim,media,raw FROM articles WHERE id=${imported!.articleId!}`;
    assert.equal(article!.published_at?.toISOString()??null,expected);assert.equal(article!.published_at_claim?.toISOString()??null,expected);
    assert.equal(article!.raw.publishTime,publishTime);
    assert.deepEqual(article!.media,[{kind:"image",url:"https://example.com/synthetic.png"},{kind:"video",url:"https://example.com/synthetic.mp4",poster:"https://example.com/synthetic-cover.png",confirmed:true}]);
  }}finally{responseOverride=undefined;}
});


test("bounded collection retains its page through a budget stop, completes detail and records truncation",async()=>{
  const {createWeiboSubscription,startWeiboSubscription,listWeiboSubscriptions}=await import("@aihot/backend/sources/weibo-subscriptions");
  const author=`996${Date.now()}`,id=`997${Date.now()}`;let pages=0,details=0;
  responseOverride=(url:string)=>{if(url.endsWith("searchWork")){pages++;return [0,1].map(i=>({opusId:String(BigInt(id)+BigInt(i)),uid:author,text:"Synthetic bounded item",url:`https://weibo.com/${author}/${BigInt(id)+BigInt(i)}`}));}details++;return {opusId:id,uid:author,mblogid:`Bound${tag().replace(/[^A-Za-z0-9]/g,"")}`,text:"Synthetic complete detail",opusUrl:`https://weibo.com/${author}/${id}`};};
  process.env.COLLECT_ENABLED="true";
  try{
    const sub=await createWeiboSubscription({name:"Bounded fixture",operationId:"TXQPVGJG",parameters:{searchType:"61",page:"1",keyword:"fixture"},enabled:true,intervalMinutes:1,enrichDetails:true,limits:{pages:2,items:1,details:1}},"test",tag());
    const run=await startWeiboSubscription(sub.id,"test",tag());await step(run.id);const pageState=await row(run.id);assert.equal(pageState.step_key,"redfox.weibo.item");assert.equal(pageState.progress.retainedReceiptIds.length,1);assert.equal(pageState.progress.items,undefined);assert.equal(pageState.progress.selectedCount,1);assert.equal(JSON.stringify(pageState.progress).includes("Synthetic bounded item"),false);
    await step(run.id);await sql`UPDATE budgets SET per_minute=0 WHERE service='redfox.collect'`;await step(run.id);const stopped=await row(run.id);assert.equal(stopped.status,"waiting");assert.equal(stopped.progress.index,0);assert.equal(details,0);
    await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.collect'`;await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:stopped.step_version,generation:stopped.generation}));await step(run.id);
    assert.equal((await row(run.id)).status,"completed");assert.equal(pages,1);assert.equal(details,1);
    const [summary]=await sql`SELECT data FROM operation_results WHERE run_id=${run.id} AND kind='query_summary'`;assert.equal(summary!.data.truncated,true);assert.equal(summary!.data.unprocessedDueToLimit,1);assert.equal(summary!.data.processedCount,1);
    const [result]=await sql`SELECT article_id,source_id FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work'`;assert.ok(result!.article_id);
    const [source]=await sql`SELECT participation_mode,site_fulltext FROM sources WHERE id=${result!.source_id}`;assert.equal(source!.participation_mode,"isolated");assert.equal(source!.site_fulltext,false);
    assert.equal((await listWeiboSubscriptions()).find(s=>s.id===sub.id)!.activeRun,null);
  }finally{process.env.COLLECT_ENABLED="false";responseOverride=undefined;await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.collect'`;}
});
test("subscription APIs default disabled; interval edits keep the run and config edits fence late execution",async()=>{
  const {buildApp}=await import("../apps/api/src/app.ts");const app=await buildApp();config.devAdmin={displayName:"Weibo subscriptions"};
  const payload={name:"Trend fixture",operationId:"UAQ90A1F",parameters:{}};
  try{
    const created=await app.inject({method:"POST",url:"/api/admin/redfox/subscriptions",headers:{"x-csrf-token":"dev","idempotency-key":tag()},payload});assert.equal(created.statusCode,201);const id=created.json().id;
    let list=(await app.inject({url:"/api/admin/redfox/subscriptions"})).json();assert.equal(list.find((s:{id:number})=>s.id===id).enabled,false);
    const configValue={...payload,enabled:true,intervalMinutes:1};const update=async(editVersion:number,config:unknown)=>app.inject({method:"PATCH",url:`/api/admin/redfox/subscriptions/${id}`,headers:{"x-csrf-token":"dev"},payload:{editVersion,config}});
    assert.equal((await update(1,configValue)).statusCode,200);assert.equal((await update(1,configValue)).statusCode,409);
    const started=await app.inject({method:"POST",url:`/api/admin/redfox/subscriptions/${id}/run`,headers:{"x-csrf-token":"dev","idempotency-key":tag()}});assert.equal(started.statusCode,202);const runId=started.json().runId;
    assert.equal((await update(2,{...configValue,intervalMinutes:3})).statusCode,200);assert.equal((await row(runId)).status,"active");
    assert.equal((await update(3,{...configValue,enabled:false})).statusCode,200);const beforeHits=hits;await step(runId);assert.equal(hits,beforeHits);assert.equal((await row(runId)).status,"stopped");
    list=(await app.inject({url:"/api/admin/redfox/subscriptions"})).json();assert.equal(list.find((s:{id:number})=>s.id===id).activeRun,null);
  }finally{config.devAdmin=null;await app.close();}
});

test("lost item job recovers from retained page with outbound closed; next empty page ends the bounded round",async()=>{
  const {createWeiboSubscription,startWeiboSubscription}=await import("@aihot/backend/sources/weibo-subscriptions");
  const {getBoss,QUEUES}=await import("@aihot/backend/jobs/queue");const {recoverOperations}=await import("@aihot/backend/providers/operations/recovery");
  const [oldCursor]=await sql`SELECT value FROM settings WHERE key='operations.recovery-cursor'`;
  const author=`998${Date.now()}`,id=`999${Date.now()}`;let pages=0;
  responseOverride=()=>++pages===1?[{uid:author,opusId:id,text:"Synthetic replay",url:`https://weibo.com/${author}/${id}`}]:[];
  process.env.COLLECT_ENABLED="true";
  try{
    const sub=await createWeiboSubscription({name:"Replay fixture",operationId:"TXQPVGJG",parameters:{page:"1",searchType:"61",keyword:"replay"},enabled:true,limits:{pages:2,items:5,details:0}},"test",tag());
    const run=await startWeiboSubscription(sub.id,"test",tag());await step(run.id);const state=await row(run.id);await (await getBoss()).cancel(QUEUES.operation,state.job_id);await sql`UPDATE operation_runs SET job_id=NULL WHERE id=${run.id}`;
    await sql`INSERT INTO settings(key,value,updated_by) VALUES ('operations.recovery-cursor',${sql.json(run.id-1)},'test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    process.env.REDFOX_CALLS_ENABLED="false";const recovered=await recoverOperations();assert.ok(recovered.requeued>=1);await step(run.id);assert.equal(pages,1);assert.equal((await row(run.id)).step_key,"redfox.weibo.page");
    process.env.REDFOX_CALLS_ENABLED="true";await step(run.id);assert.equal((await row(run.id)).status,"completed");assert.equal(pages,2);
    const summaries=await sql`SELECT data FROM operation_results WHERE run_id=${run.id} AND kind='query_summary' ORDER BY id`;assert.deepEqual(summaries.map(s=>s.data.count),[1,0]);
  }finally{responseOverride=undefined;process.env.REDFOX_CALLS_ENABLED="true";process.env.COLLECT_ENABLED="false";if(oldCursor)await sql`UPDATE settings SET value=${sql.json(oldCursor.value)} WHERE key='operations.recovery-cursor'`;}
});

test("scheduled trends remain snapshots and disabled authors leave pending results without material",async()=>{
  const {createWeiboSubscription,startWeiboSubscription,scheduleWeiboSubscriptions}=await import("@aihot/backend/sources/weibo-subscriptions");
  const author=`995${Date.now()}`,id=`994${Date.now()}`,source=`disabled-weibo-${tag()}`;
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES (${source},'Disabled author','external',false)`;
  await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES ('weibo','uid',${author},${source},'{"kind":"audit","reference":"synthetic"}')`;
  process.env.COLLECT_ENABLED="true";
  try{
    const trend=await createWeiboSubscription({name:"Trend schedule",operationId:"UAQ90A1F",parameters:{},enabled:true},"test",tag());
    // Shared task databases may contain older due subscriptions; make this fixture deterministically first.
    await sql`UPDATE collection_subscriptions SET next_run_at=(SELECT COALESCE(min(next_run_at),now())-interval '1 second' FROM collection_subscriptions WHERE operation_key IN ('redfox.weibo.collection','redfox.platform.collection') AND enabled AND active_run_id IS NULL AND next_run_at<=now()) WHERE id=${trend.id}`;
    await scheduleWeiboSubscriptions();const [scheduled]=await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${trend.id}`;assert.ok(scheduled!.active_run_id);
    await step(scheduled!.active_run_id);assert.equal((await row(scheduled!.active_run_id)).status,"completed");
    const trendResults=await sql`SELECT kind,article_id FROM operation_results WHERE run_id=${scheduled!.active_run_id}`;assert.ok(trendResults.some(r=>r.kind==='weibo_trend'));assert.ok(trendResults.every(r=>r.article_id===null));
    responseOverride=[{uid:author,opusId:id,text:"Disabled synthetic work",url:`https://weibo.com/${author}/${id}`}];
    const sub=await createWeiboSubscription({name:"Disabled author fixture",operationId:"TXQPVGJG",parameters:{page:"1",searchType:"61",keyword:"disabled"},enabled:true,limits:{pages:1,items:1,details:0}},"test",tag());
    const run=await startWeiboSubscription(sub.id,"test",tag());await step(run.id);await step(run.id);assert.equal((await row(run.id)).status,"completed");
    const [result]=await sql`SELECT article_id,data FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work'`;assert.equal(result!.article_id,null);assert.match(result!.data.pendingReason,/disabled/);
    assert.equal((await sql`SELECT 1 FROM articles WHERE identity_key=${`weibo:opusId:${id}`}`).length,0);
  }finally{responseOverride=undefined;process.env.COLLECT_ENABLED="false";}
});

test("detail import refuses two legacy owners and rolls back result and new source binding",async()=>{
  const author=`981${Date.now()}`,id=`982${Date.now()}`,short=`Conflict${tag().replace(/[^A-Za-z0-9]/g,"")}`,source=`legacy-conflict-${tag()}`;
  await sql`INSERT INTO sources(id,name,kind) VALUES (${source},'Legacy conflict fixture','external')`;
  const a=await upsertMaterial({sourceId:source,url:`https://weibo.com/${author}/${short}`,title:"Old short",via:"fetch"});
  const b=await upsertMaterial({sourceId:source,url:`https://weibo.com/${author}/${id}`,identityKey:`weibo:opusId:${id}`,title:"Old numeric",via:"fetch"});
  responseOverride={uid:author,opusId:id,mblogid:short,text:"Synthetic conflicting detail",opusUrl:`https://weibo.com/${author}/${id}`};
  try{
    const result=await query("API_1789098514899",{opusId:id});const beforeHits=hits;
    await assert.rejects(importWeiboResult(result.results[0]!.id,{reason:"Do not merge legacy owners"},"test",tag()),/different articles/);assert.equal(hits,beforeHits);
    const [stored]=await sql`SELECT article_id,source_id FROM operation_results WHERE id=${result.results[0]!.id}`;assert.equal(stored!.article_id,null);assert.equal(stored!.source_id,null);
    assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE platform='weibo' AND id_value=${author}`).length,0);
    assert.equal((await sql`SELECT 1 FROM articles WHERE id IN (${a.articleId},${b.articleId})`).length,2);
  }finally{responseOverride=undefined;}
});


test("subscription HTTP creation is atomic across concurrent retries and stays stable after edits",async()=>{
  const {buildApp}=await import("../apps/api/src/app.ts");const app=await buildApp();config.devAdmin={displayName:"Creation fixture"};
  const headers={"x-csrf-token":"dev","idempotency-key":tag()},payload={name:"Unique creation",operationId:"UAQ90A1F",parameters:{},enabled:true};
  const create=(body=payload)=>app.inject({method:"POST",url:"/api/admin/redfox/subscriptions",headers,payload:body});
  try{
    const responses=await Promise.all([create(),create(),create()]);assert.ok(responses.every(r=>r.statusCode===201));const id=responses[0]!.json().id;assert.ok(responses.every(r=>r.json().id===id));
    assert.equal((await create()).json().id,id);assert.equal((await create({...payload,name:"Different intent"})).statusCode,409);
    const edit=await app.inject({method:"PATCH",url:`/api/admin/redfox/subscriptions/${id}`,headers,payload:{editVersion:1,config:{...payload,name:"Edited later",intervalMinutes:30}}});assert.equal(edit.statusCode,200);
    const retry=await create();assert.deepEqual(retry.json(),{id,editVersion:2});
    const [stored]=await sql`SELECT config,creation_command_key FROM collection_subscriptions WHERE id=${id}`;assert.equal(stored!.config.name,"Edited later");assert.equal((await sql`SELECT 1 FROM collection_subscriptions WHERE creation_command_key=${stored!.creation_command_key}`).length,1);
    assert.equal((await sql`SELECT 1 FROM audit_log WHERE action='subscription.create' AND subject=${`subscription:${id}`}`).length,1);
    await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id=${id}`;
  }finally{config.devAdmin=null;await app.close();}
});
test("a missing retained raw page pauses locally instead of fetching it again",async()=>{
  const {createWeiboSubscription,startWeiboSubscription}=await import("@aihot/backend/sources/weibo-subscriptions");
  const author=`971${Date.now()}`,id=`972${Date.now()}`;responseOverride=[{uid:author,opusId:id,text:"Retained only",url:`https://weibo.com/${author}/${id}`}];process.env.COLLECT_ENABLED="true";
  try{
    const sub=await createWeiboSubscription({name:"Missing raw fixture",operationId:"TXQPVGJG",parameters:{page:"1",searchType:"61",keyword:"missing"},enabled:true,limits:{pages:1,items:2,details:0}},"test",tag());
    const run=await startWeiboSubscription(sub.id,"test",tag());await step(run.id);const saved=await row(run.id);const beforeHits=hits;
    await sql`UPDATE receipts SET response=NULL WHERE id=${saved.progress.pageReceipt}`;await step(run.id);const result=await row(run.id);assert.equal(result.status,"needs_review");assert.match(result.wait_reason,/missing or expired/);assert.equal(hits,beforeHits);assert.equal(result.progress.index,0);
  }finally{responseOverride=undefined;process.env.COLLECT_ENABLED="false";}
});

test("safe positive starting pages cross 99 and 100 without imposing an undocumented provider cap",async()=>{
  const {createWeiboSubscription,startWeiboSubscription}=await import("@aihot/backend/sources/weibo-subscriptions");
  process.env.COLLECT_ENABLED="true";
  try{
    for(const start of [99,100]){
      const author=`961${Date.now()}${start}`,id=`962${Date.now()}${start}`;let pages=0;
      responseOverride=()=>++pages===1?[{uid:author,opusId:id,text:"High-page fixture",url:`https://weibo.com/${author}/${id}`}]:[];
      const beforeRequests=requests.length;
      const sub=await createWeiboSubscription({name:"High starting page",operationId:"TXQPVGJG",parameters:{page:String(start),searchType:"61",keyword:"high page"},enabled:true,limits:{pages:2,items:5,details:0}},"test",tag());
      const run=await startWeiboSubscription(sub.id,"test",tag());await step(run.id);await step(run.id);await step(run.id);
      assert.equal((await row(run.id)).status,"completed");assert.deepEqual(requests.slice(beforeRequests).map(r=>r.body.page),[String(start),String(start+1)]);
    }
    responseOverride=[];const account=await query("API_1789098515245",{page:101,keyword:"safe page"});assert.equal(account.run.status,"completed");
  }finally{responseOverride=undefined;process.env.COLLECT_ENABLED="false";}
});

test("import timing marks only unknown or stale new material and preserves fresh/existing facts",async()=>{
  const {isHistorical}=await import("@aihot/backend/content/materials");
  const author=`999${Date.now()}`,fresh=new Date(Date.now()-3600_000).toISOString(),old=new Date(Date.now()-7*86400_000).toISOString();
  try{
    for(const [index,publishTime] of [undefined,"2001-01-01 12:00:00",old,fresh].entries()){
      const id=`998${Date.now()}${index}`,url=`https://weibo.com/${author}/${id}`;
      responseOverride={opusId:id,uid:author,text:"Synthetic timing",opusUrl:url,publishTime};
      const q=await query("API_1789098514899",{opusId:id}),imported=await importWeiboResult(q.results[0]!.id,{reason:"Synthetic timing"},"test",tag());
      const [a]=await sql`SELECT backfill,backfill_reason,published_at,discovered_at FROM articles WHERE id=${imported!.articleId!}`;
      assert.equal(a!.backfill,index!==3);assert.equal(isHistorical(a as never),index!==3);
      if(index<2)assert.equal(a!.backfill_reason,"redfox-import-unknown-time");
      if(index===3){
        const [before]=await sql`SELECT source_id,published_at,discovered_at,timeline_at,backfill,backfill_reason FROM articles WHERE id=${imported!.articleId!}`;
        responseOverride={opusId:id,uid:author,text:"Synthetic changed body",opusUrl:url};
        const repeat=await query("API_1789098514899",{opusId:id});await importWeiboResult(repeat.results[0]!.id,{reason:"Synthetic repeat unknown time"},"test",tag());
        assert.deepEqual((await sql`SELECT source_id,published_at,discovered_at,timeline_at,backfill,backfill_reason FROM articles WHERE id=${imported!.articleId!}`)[0],before);
      }
    }
  }finally{responseOverride=undefined;}
});

test('each formal page retains its own discovery through detail delay and terminal pending import',async()=>{
 const {createWeiboSubscription,startWeiboSubscription}=await import('@aihot/backend/sources/weibo-subscriptions');
 const author=BigInt('0x'+randomUUID().replaceAll('-','')).toString(),base=BigInt('0x'+randomUUID().replaceAll('-',''));let pageCalls=0;
 responseOverride=(url:string)=>{if(url.endsWith('searchWork')){const id=String(base+BigInt(pageCalls++));return [{opusId:id,uid:author,text:'Synthetic page item',url:`https://weibo.com/${author}/${id}`}];}const id=String(base);return {opusId:id,uid:author,text:'Synthetic detail',opusUrl:`https://weibo.com/${author}/${id}`};};
 process.env.COLLECT_ENABLED='true';
 try{
  const sub=await createWeiboSubscription({name:'Page discovery fixture',operationId:'TXQPVGJG',parameters:{searchType:'61',page:'1',keyword:tag()},enabled:true,enrichDetails:true,limits:{pages:2,items:2,details:1}},'test',tag());
  const run=await startWeiboSubscription(sub.id,'test',tag());await step(run.id);
  const firstTime=new Date(Date.now()-5*86400000),secondTime=new Date(Date.now()-3*86400000);
  await sql`UPDATE operation_results SET created_at=${firstTime} WHERE run_id=${run.id} AND kind='query_summary'`;
  await step(run.id);await sql`UPDATE budgets SET per_minute=0 WHERE service='redfox.collect'`;await step(run.id);const stopped=await row(run.id);assert.equal(stopped.status,'waiting');
  await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.collect'`;await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:stopped.step_version,generation:stopped.generation}));await step(run.id);
  const [first]=await sql`SELECT z.*,a.discovered_at FROM operation_results z JOIN articles a ON a.id=z.article_id WHERE z.run_id=${run.id}`;
  assert.equal(first!.discovered_at.toISOString(),firstTime.toISOString());
  await step(run.id);await sql`UPDATE operation_results SET created_at=${secondTime} WHERE run_id=${run.id} AND item_key='page:2'`;await step(run.id);
  assert.equal((await row(run.id)).status,'completed');assert.equal(pageCalls,2);
  const [pending]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work' AND article_id IS NULL`;
  const [secondPage]=await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND item_key='page:2'`;
  assert.equal(pending!.provenance.sourcePageResultId,Number(secondPage!.id));assert.notEqual(first!.provenance.sourcePageResultId,pending!.provenance.sourcePageResultId);
  process.env.REDFOX_CALLS_ENABLED='false';const before=hits;
  const imported=await importWeiboResult(pending!.id,{reason:'Terminal pending local import'},'test',tag());
  assert.equal((await sql`SELECT discovered_at FROM articles WHERE id=${imported!.articleId!}`)[0]!.discovered_at.toISOString(),secondTime.toISOString());assert.equal(hits,before);
 }finally{process.env.COLLECT_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='true';responseOverride=undefined;await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.collect'`;}
});
