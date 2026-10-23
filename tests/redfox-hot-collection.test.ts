import {assertConfiguredTestDatabase,stub,tag} from "./setup.ts";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {before,after,test} from "node:test";
import {sql,closeDb} from "@aihot/backend/db";
import {config} from "@aihot/backend/config";
import {stopBoss} from "@aihot/backend/jobs/queue";
import {createPlatformSubscription,schedulePlatformSubscriptions,startPlatformSubscription,updatePlatformSubscription} from "@aihot/backend/sources/platform-subscriptions";
import {executeOperationStep} from "@aihot/backend/providers/operations/execute";
import {receiptOptions,resumeRun} from "@aihot/backend/providers/operations/store";
import {createSynchronousQuery} from "@aihot/backend/providers/redfox/synchronous";
import {queryHotResearch} from "@aihot/backend/providers/redfox/hot-research";
import {hotResearchCollectionParameters,hotResearchDayParameters,hotResearchOperations} from "@aihot/backend/providers/redfox/hot-research-contract";

const requests:Array<{url:string;parameters:Record<string,unknown>}>=[];
let empty=false;
const provider=await stub((_hit,request)=>{
  const url=new URL(request.url,"http://127.0.0.1"),parameters=request.body?JSON.parse(request.body):Object.fromEntries(url.searchParams);
  requests.push({url:url.pathname,parameters});
  const rows=empty?[]:[{title:"Synthetic first hotspot",url:"https://example.test/search"},{title:"Synthetic second hotspot",hotCount:"0"}];
  const data=url.pathname===hotResearchOperations["9Y4EX7RW"].path?rows.map(record=>({keyword:record.title,plats:["微博"],hotSpotList:[record]})):url.pathname===hotResearchOperations.W94P1QH1.path?{ksList:rows,wbList:[]}:rows;
  return {code:2000,data};
});
let budgets:Array<{service:string;per_minute:number;per_hour:number;per_day:number}>=[];
const subscriptionIds:number[]=[];
before(async()=>{
  const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
  process.env.REDFOX_TEST_BASE_URL=provider.url;process.env.REDFOX_API_KEY="synthetic-hot-collection";process.env.REDFOX_CALLS_ENABLED="true";process.env.COLLECT_ENABLED="true";config.allowPrivateNetworkFetch=true;
  budgets=await sql`SELECT service,per_minute,per_hour,per_day FROM budgets WHERE service IN ('redfox.collect','redfox.query')`;
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.collect','redfox.query')`;
});
after(async()=>{
  if(subscriptionIds.length)await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id IN ${sql(subscriptionIds)}`;
  for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;
  await provider.close();await stopBoss();await closeDb();
});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
async function step(id:number){const run=await row(id);await executeOperationStep(id,run.step_version,randomUUID());}

const cases=[{op:"9Y4EX7RW",parameters:{}},{op:"W94P1QH1",parameters:{keywords:[" 原词 ","one,two"],platforms:[1,5]}},{op:"S28Q6HUD",parameters:{platform:6}}] as const;
for(const {op,parameters} of cases)test(`${op} due subscription freezes today's Shanghai window and saves one bounded collect research snapshot`,async()=>{
  const [before]=await sql`SELECT (SELECT count(*)::int FROM articles) AS articles,(SELECT count(*)::int FROM sources) AS sources,(SELECT count(*)::int FROM source_account_bindings) AS bindings`;
  const sub=await createPlatformSubscription({name:"Synthetic hotspot snapshot",operationId:op,parameters,enabled:true,limits:{pages:1,items:1,details:0}},"test",tag());subscriptionIds.push(sub.id);
  await sql`UPDATE collection_subscriptions SET next_run_at='2020-01-01' WHERE id=${sub.id}`;
  assert.ok(await schedulePlatformSubscriptions());
  const [started]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`;
  assert.equal(started!.interval_minutes,60);assert.deepEqual(started!.config.parameters,parameters);assert.ok(started!.active_run_id);
  const run=await row(started!.active_run_id);
  assert.equal(run.actor,"schedule");assert.deepEqual(run.input.parameters,hotResearchDayParameters(op,parameters,run.created_at));
  const hits=provider.hits();await step(run.id);
  assert.equal((await row(run.id)).status,"completed");assert.equal(provider.hits(),hits+1);
  assert.equal(requests.at(-1)!.url,hotResearchOperations[op].path);assert.deepEqual(requests.at(-1)!.parameters,op==="S28Q6HUD"?Object.fromEntries(Object.entries(run.input.parameters).map(([key,value])=>[key,String(value)])):run.input.parameters);
  const results=await sql`SELECT z.*,r.service,r.cost,r.currency,r.cost_basis,r.status AS receipt_status FROM operation_results z JOIN receipts r ON r.id=z.receipt_id WHERE z.run_id=${run.id} ORDER BY z.id`;
  assert.equal(results.length,2);assert.ok(results.every(r=>r.article_id===null&&r.source_id===null&&r.receipt_status==="completed"&&r.service==="redfox.collect"&&Number(r.cost)===0.06&&r.currency==="CNY"&&r.cost_basis==="estimated"));
  const summary=results.find(r=>r.kind==="query_summary")!.data;
  assert.equal(summary.count,2);assert.equal(summary.researchCount,2);assert.equal(summary.selectedResearchCount,1);assert.equal(summary.unprocessedResearchDueToLimit,1);assert.equal(summary.truncated,true);assert.equal(summary.stopReason,"item-limit");assert.equal(summary.nextParameters,null);
  assert.equal(summary.selectedCount,1);assert.equal(summary.processedCount,1);
  assert.deepEqual(summary.queryWindow,{startDate:run.input.parameters.startDate,endDate:run.input.parameters.endDate,timeZone:"Asia/Shanghai"});
  assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub.id}`)[0]!.active_run_id,null);
  assert.deepEqual((await sql`SELECT (SELECT count(*)::int FROM articles) AS articles,(SELECT count(*)::int FROM sources) AS sources,(SELECT count(*)::int FROM source_account_bindings) AS bindings`)[0],before);
});

test("static filters reject fixed dates and use Shanghai midnight through month/leap/year boundaries",()=>{
  for(const {op,parameters} of cases){
    assert.deepEqual(hotResearchCollectionParameters(op,parameters),parameters);
    assert.throws(()=>hotResearchCollectionParameters(op,{...parameters,startDate:"2026-01-01",endDate:"2026-01-02"}));
    for(const [instant,start,end] of [["2026-12-31T15:59:59Z","2026-12-31","2027-01-01"],["2026-12-31T16:00:00Z","2027-01-01","2027-01-02"],["2028-02-28T16:00:00Z","2028-02-29","2028-03-01"],["2026-04-30T16:00:00Z","2026-05-01","2026-05-02"]]){
      const suffix=op==="9Y4EX7RW"?" 00:00:00":"";
      assert.deepEqual(hotResearchDayParameters(op,parameters,instant),{...parameters,startDate:start+suffix,endDate:end+suffix});
    }
  }
});

test("received snapshot recovers across Shanghai New Year with the same frozen run and no second purchase",async t=>{
  t.mock.timers.enable({apis:["Date"],now:new Date("2026-12-31T15:59:59Z")});
  const sub=await createPlatformSubscription({name:"Synthetic retained snapshot",operationId:"W94P1QH1",parameters:{keywords:["frozen"]},enabled:true,limits:{pages:1,items:5,details:0}},"test",tag());subscriptionIds.push(sub.id);
  const key=tag(),run=await startPlatformSubscription(sub.id,"test",key);
  assert.equal((run.input.parameters as Record<string,unknown>).startDate,"2026-12-31");
  const response=await queryHotResearch("W94P1QH1",run.input.parameters as Record<string,unknown>,String(run.input.window),receiptOptions({runId:run.id,stepVersion:run.step_version,generation:run.generation}),"collect");
  assert.equal((await sql`SELECT status FROM receipts WHERE id=${response.receiptId}`)[0]!.status,"received");
  assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results WHERE run_id=${run.id}`)[0]!.n,0);
  await sql`UPDATE operation_runs SET status='waiting',next_attempt_at=NULL WHERE id=${run.id}`;
  t.mock.timers.setTime(new Date("2026-12-31T16:00:01Z").getTime());
  const hits=provider.hits(),same=await startPlatformSubscription(sub.id,"test",key);
  assert.equal(same.id,run.id);assert.deepEqual(same.input,run.input);
  process.env.REDFOX_CALLS_ENABLED="false";process.env.COLLECT_ENABLED="false";delete process.env.REDFOX_API_KEY;
  try {
    const paused=await row(run.id);await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:paused.step_version,generation:paused.generation}));
    await step(run.id);assert.equal((await row(run.id)).status,"completed");assert.equal(provider.hits(),hits);
    const [summary]=await sql`SELECT data FROM operation_results WHERE run_id=${run.id} AND kind='query_summary'`;
    assert.deepEqual(summary!.data.queryWindow,{startDate:"2026-12-31",endDate:"2027-01-01",timeZone:"Asia/Shanghai"});
    const [receipt]=await sql`SELECT status,attempts FROM receipts WHERE id=${response.receiptId}`;assert.equal(receipt!.status,"completed");assert.equal(receipt!.attempts,1);
    assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub.id}`)[0]!.active_run_id,null);
  } finally {process.env.REDFOX_CALLS_ENABLED="true";process.env.COLLECT_ENABLED="true";process.env.REDFOX_API_KEY="synthetic-hot-collection";}
  const next=await startPlatformSubscription(sub.id,"test",tag());assert.equal((next.input.parameters as Record<string,unknown>).startDate,"2027-01-01");await step(next.id);assert.equal((await row(next.id)).status,"completed");
});

test("empty snapshot is completed without material; historical manual query keeps query budget and dates",async()=>{
  empty=true;
  try {
    const sub=await createPlatformSubscription({name:"Synthetic empty snapshot",operationId:"S28Q6HUD",parameters:{platform:6},enabled:true,limits:{pages:1,items:5,details:0}},"test",tag());subscriptionIds.push(sub.id);
    const run=await startPlatformSubscription(sub.id,"test",tag());await step(run.id);assert.equal((await row(run.id)).status,"completed");
    const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(results.length,1);assert.equal(results[0]!.data.count,0);assert.equal(results[0]!.data.processedCount,0);assert.equal(results[0]!.data.truncated,false);assert.equal(results[0]!.data.nextParameters,null);
    for(const {op,parameters} of cases){
      const suffix=op==="9Y4EX7RW"?" 00:00:00":"",historical={...parameters,startDate:"2026-01-01"+suffix,endDate:"2026-01-02"+suffix};
      const query=await createSynchronousQuery({operationId:op,parameters:historical},"test",tag());await step(query.id);assert.equal((await row(query.id)).status,"completed");
      const [receipt]=await sql`SELECT r.service,r.request FROM receipts r JOIN operation_results z ON z.receipt_id=r.id WHERE z.run_id=${query.id} LIMIT 1`;
      assert.equal(receipt!.service,"redfox.query");assert.deepEqual(receipt!.request.input,historical);
    }
  } finally {empty=false;}
});

test("new snapshots stay disabled until saved, keep budget waits and fence changed execution versions",async()=>{
  const payload={name:"Synthetic budget snapshot",operationId:"9Y4EX7RW",parameters:{},limits:{pages:1,items:5,details:0}};
  const sub=await createPlatformSubscription(payload,"test",tag());subscriptionIds.push(sub.id);
  assert.equal((await sql`SELECT enabled FROM collection_subscriptions WHERE id=${sub.id}`)[0]!.enabled,false);
  await assert.rejects(startPlatformSubscription(sub.id,"test",tag()),/disabled/);
  await updatePlatformSubscription(sub.id,{editVersion:1,config:{...payload,enabled:true}},"test");
  await assert.rejects(updatePlatformSubscription(sub.id,{editVersion:1,config:{...payload,enabled:true}},"test"),/changed/);
  const run=await startPlatformSubscription(sub.id,"test",tag()),hits=provider.hits();
  await sql`UPDATE budgets SET per_minute=0 WHERE service='redfox.collect'`;
  try {await step(run.id);assert.equal((await row(run.id)).status,"waiting");assert.equal(provider.hits(),hits);assert.equal((await row(run.id)).current_receipt_id,null);}
  finally {await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.collect'`;}
  await updatePlatformSubscription(sub.id,{editVersion:2,config:{...payload,enabled:true,limits:{...payload.limits,items:2}}},"test");
  assert.equal((await row(run.id)).status,"stopped");await step(run.id);assert.equal(provider.hits(),hits);
  assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results WHERE run_id=${run.id}`)[0]!.n,0);
});

test("shared HTTP catalog advertises three schedulable research snapshots and collect estimates without paid calls",async()=>{
  const {buildApp}=await import("../apps/api/src/app.ts"),app=await buildApp();config.devAdmin={displayName:"Synthetic hotspot admin"};
  try {
    const hits=provider.hits(),response=await app.inject({url:"/api/admin/redfox/operations"});assert.equal(response.statusCode,200);
    const rows=response.json().filter((operation:{platform:string})=>operation.platform==="hot-research");assert.equal(rows.length,3);
    for(const row of rows){assert.equal(row.schedulableType,"trend");assert.equal(row.collectionCapabilities.detailEnrichment,false);assert.deepEqual(row.collectionPrice,{amount:0.06,currency:"CNY",basis:"estimated"});assert.ok(row.fields.some((field:{name:string})=>field.name==="startDate"));}
    for(const {op,parameters} of cases)await assert.rejects(createPlatformSubscription({name:"Forbidden fixed window",operationId:op,parameters:{...parameters,startDate:"2026-01-01",endDate:"2026-01-02"}},"test",tag()));
    assert.equal(provider.hits(),hits);
  } finally {config.devAdmin=null;await app.close();}
});
