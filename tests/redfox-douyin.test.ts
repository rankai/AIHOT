import {allowTestBudgetScope} from './setup.ts';
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
import {createPlatformSubscription,startPlatformSubscription} from "@aihot/backend/sources/platform-subscriptions";
import { resumeRun } from "@aihot/backend/providers/operations/store";
import { douyinOperations,type DouyinOperation } from "@aihot/backend/providers/redfox/douyin-contract";
const uid="900719925474099312345",secure="MS4wSyntheticSecureId",workId="900719925474099398765";
const premium={workId,title:"Synthetic premium work",content:"Synthetic body",workUrl:`https://www.douyin.com/video/${workId}`,authorId:"display-fixture"};
const wide={videoId:workId,content:"Synthetic wide work",opusUrl:`https://www.douyin.com/video/${workId}`,authorUid:uid,authorSecUid:secure};
const growth={aweme_id:workId,author_user_id:uid,aweme_desc:"Synthetic growth work",share_url:`https://www.iesdouyin.com/share/video/${workId}`,create_time:1780000000000};
const cases:{id:DouyinOperation;path:string;parameters:Record<string,unknown>;data:unknown;kind:string}[]=[
  {id:"P5CHB3BZ",path:"/story/api/dyData/searchUser",parameters:{keyword:"synthetic",offset:20,sortType:"_0"},data:{list:[{uid,nickname:"Synthetic account",accountId:"fixture_display"}],hasMore:true},kind:"douyin_account"},
  {id:"L6OUNUN1",path:"/story/api/dy/data/searchAccount",parameters:{keyword:"synthetic",pageNum:100,pageSize:50},data:{list:[{userId:uid,secureId:secure,displayName:"Synthetic wide account",uniqueName:"fixture_display",shortId:"1234"}]},kind:"douyin_account"},
  {id:"QEQLCKD6",path:"/story/api/dyData/queryWorkList",parameters:{accountId:"fixture_display",authorUrl:`https://www.douyin.com/user/${secure}`,secUserId:secure,offset:40,sortType:"default"},data:{list:[{...premium,secUid:"not-proof-of-secUserId"}]},kind:"douyin_work"},
  {id:"QSL2ZSXM",path:"/story/api/dy/data/listWorkByAccount",parameters:{userId:uid,pageNum:101,pageSize:10,startDate:"2026-01-01",endDate:"2026-10-01"},data:{list:[wide]},kind:"douyin_work"},
  {id:"774OBKK0",path:"/story/api/dyData/searchArticle",parameters:{keyword:"synthetic",offset:20,sortType:"default",startDate:"2026-01-01",endDate:"2026-10-01"},data:{list:[premium]},kind:"douyin_work"},
  {id:"OWIBYU1V",path:"/story/api/dy/data/searchWork",parameters:{keyword:"synthetic",exactMatch:false,pageNum:100,pageSize:50},data:{list:[wide]},kind:"douyin_work"},
  {id:"0OT1E306",path:"/story/api/dyData/queryWork",parameters:{workId},data:premium,kind:"douyin_work"},
  {id:"FK67XDVQ",path:"/story/api/dy/data/workDetail",parameters:{videoId:workId},data:wide,kind:"douyin_work"},
  {id:"20060017",path:"/story/api/dyData/query",parameters:{dateType:"weeks",rankDate:"2026-10-19",type:"全部"},data:[{accountLink:`https://www.douyin.com/user/${secure}`,accountName:"Synthetic rank",accountRanking:1}],kind:"douyin_account_rank"},
  {id:"HUCIASU",path:"/story/api/dy/search/likesRank",parameters:{},data:[{...premium,accountId:uid}],kind:"douyin_work"},
  {id:"XUT4CECZ",path:"/story/api/dyData/queryUser",parameters:{accountId:"fixture_display"},data:{uid,displayId:"fixture_display",nickname:"Synthetic account"},kind:"douyin_account"},
  {id:"I8P3HTVH",path:"/story/api/parseWork/queryDyAiMsgs",parameters:{keyword:"synthetic",pageNum:100,pageSize:51,startTime:"2026-01-01 00:00:00",endTime:"2026-10-01 23:59:59"},data:{list:[{photoId:workId,authorId:uid,title:"Synthetic AI entry",url:"https://example.com/synthetic"}]},kind:"douyin_work"},
  {id:"WD6UT8DQ",path:"/story/api/dy/search/getDailyRank",parameters:{type:"全部",startTime:"2026-10-19"},data:[growth],kind:"douyin_work"},
  {id:"0ZB9S2FW",path:"/story/api/dy/search/getWeeklyRank",parameters:{},data:[growth],kind:"douyin_work"},
];
let fixture=cases[0]!,hits=0,rawOverride:string|undefined,saved:Record<string,unknown>;
const server=http.createServer((req,res)=>{hits++;let body="";req.on("data",c=>body+=c);req.on("end",()=>{try{assert.equal(req.method,"POST");assert.equal(req.url,fixture.path);assert.equal(req.headers.redfox_api_key,"fake-douyin");assert.match(req.headers["content-type"]!,/application\/json/);assert.deepEqual(JSON.parse(body),fixture.parameters);res.end(rawOverride??JSON.stringify({code:2000,data:fixture.data}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}});});
let savedCollect:Record<string,unknown>;
let restoreAdminScope:()=>Promise<void>;
before(async()=>{restoreAdminScope=await allowTestBudgetScope(['redfox.query'],'admin');savedCollect=(await sql`SELECT * FROM budgets WHERE service='redfox.collect'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.collect'`;await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY="fake-douyin";process.env.REDFOX_CALLS_ENABLED="true";config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await restoreAdminScope?.();await sql`UPDATE budgets SET per_minute=${savedCollect.per_minute as number},per_hour=${savedCollect.per_hour as number},per_day=${savedCollect.per_day as number} WHERE service='redfox.collect'`;await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED="false";delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function query(){const run=await createSynchronousQuery({operationId:fixture.id,parameters:fixture.parameters},"douyin-test",tag());await step(run.id);return {run:await row(run.id),results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};}
test("all fourteen fixed POST endpoints preserve their parameters and typed results",async()=>{
  const beforeHits=hits;
  for(const c of cases){fixture=c;const q=await query();assert.equal(q.run.status,"completed",`${c.id}: ${q.run.wait_reason}`);assert.equal(q.results[0]!.kind,c.kind);assert.equal(q.results[0]!.data.platform,"douyin");
    if(c.id==="L6OUNUN1"||c.id==="FK67XDVQ")assert.deepEqual(q.results[0]!.data.identity,{uid,secUserId:secure});
    if(["QEQLCKD6","HUCIASU","I8P3HTVH","20060017"].includes(c.id))assert.deepEqual(q.results[0]!.data.identity,{});
    if(c.id==="I8P3HTVH")assert.equal(q.results[0]!.data.workId,null);
  }assert.equal(hits,beforeHits+14);
});
test("schema distinctions retain documented examples, optional ranks and unbounded safe page numbers",()=>{
  for(const [id,parameters] of [["QEQLCKD6",{}],["QEQLCKD6",{accountId:"x",accountName:"not-documented"}],["P5CHB3BZ",{keyword:"x",offset:1}],["L6OUNUN1",{keyword:"x",pageSize:51}],["OWIBYU1V",{}],["OWIBYU1V",{keyword:"x",exactMatch:"false"}],["OWIBYU1V",{keyword:"x",startDate:"2026-02-30"}],["QSL2ZSXM",{userId:uid,shortId:"display"}],["0OT1E306",{workId,workUrl:premium.workUrl}],["20060017",{dateType:"weeks",rankDate:"2026-10-20",type:"全部"}],["20060017",{dateType:"months",rankDate:"2026-10-19",type:"全部"}],["I8P3HTVH",{keyword:"x",startTime:"2026-02-30 12:00:00"}]] as [DouyinOperation,unknown][]){assert.equal(douyinOperations[id].schema.safeParse(parameters).success,false,id);}
  for(const c of cases)assert.equal(douyinOperations[c.id].schema.safeParse(c.parameters).success,true,c.id);
});
test("catalog is read-only; POST creates an idempotent query and wrong command input conflicts",async()=>{
  const {buildApp}=await import("../apps/api/src/app.ts"),app=await buildApp();config.devAdmin={displayName:"Douyin fixture"};fixture=cases[0]!;
  try{const beforeHits=hits,catalog=await app.inject({url:"/api/admin/redfox/operations"});assert.deepEqual(catalog.json().filter((x:{platform:string;id:string})=>x.platform==="douyin"&&x.id in douyinOperations).map((x:{id:string})=>x.id).sort(),cases.map(c=>c.id).sort());assert.equal(hits,beforeHits);
    const headers={"x-csrf-token":"dev","idempotency-key":tag()},payload={operationId:fixture.id,parameters:fixture.parameters};
    const a=await app.inject({method:"POST",url:"/api/admin/redfox/queries",headers,payload}),b=await app.inject({method:"POST",url:"/api/admin/redfox/queries",headers,payload});assert.equal(a.statusCode,202,a.body);assert.deepEqual(a.json(),b.json());await step(a.json().runId);assert.equal((await row(a.json().runId)).status,"completed");
    assert.equal((await app.inject({method:"POST",url:"/api/admin/redfox/queries",headers,payload:{...payload,parameters:{keyword:"other"}}})).statusCode,409);
  }finally{config.devAdmin=null;await app.close();}
});
test("large raw integer IDs stay exact; empty pages and ranks commit a consumption summary",async()=>{
  fixture=cases[1]!;rawOverride=`{"code":2000,"data":{"list":[{"userId":${uid},"secureId":"${secure}","displayName":"Synthetic"}]}}`;
  try{const q=await query();assert.equal(q.run.status,"completed");assert.equal(q.results[0]!.data.identity.uid,uid);
    for(const id of ["L6OUNUN1","WD6UT8DQ"]){fixture=cases.find(c=>c.id===id)!;rawOverride=JSON.stringify({code:2000,data:id==="L6OUNUN1"?{list:[]}:[]});const empty=await query();assert.equal(empty.run.status,"completed");assert.equal(empty.results[0]!.kind,"query_summary");assert.equal(empty.results[0]!.data.platform,"douyin");}
  }finally{rawOverride=undefined;}
});
test("malformed, wrong IDs and wrong success codes retain raw for local review without repurchase",async()=>{
  fixture=cases.find(c=>c.id==="FK67XDVQ")!;
  try{for(const raw of ["{broken",JSON.stringify({code:2000,data:{...wide,videoId:"wrong-work"}}),JSON.stringify({code:2000,data:{}}),JSON.stringify({code:200,data:wide})]){rawOverride=raw;const q=await query();assert.equal(q.run.status,"needs_review");const [receipt]=await sql`SELECT * FROM receipts WHERE id=${q.run.current_receipt_id}`;assert.equal(receipt!.status,"received");assert.equal(receipt!.response.body,raw);
      const beforeHits=hits;await sql.begin(tx=>resumeRun(tx,{runId:q.run.id,stepVersion:q.run.step_version,generation:q.run.generation}));process.env.REDFOX_CALLS_ENABLED="false";await step(q.run.id);assert.equal(hits,beforeHits);assert.equal((await row(q.run.id)).status,"needs_review");process.env.REDFOX_CALLS_ENABLED="true";
    }
  }finally{rawOverride=undefined;process.env.REDFOX_CALLS_ENABLED="true";}
});

const identifiers=()=>{const token=randomUUID().replaceAll("-","");return {userId:`uid${token}`,secureId:`secure${token}`,displayName:"Synthetic imported author"};};
async function accountQuery(record:ReturnType<typeof identifiers>){fixture={...cases[1]!,data:{list:[record]}};return (await query()).results[0]!;}
async function workQuery(record:Record<string,unknown>){fixture={...cases.find(c=>c.id==="FK67XDVQ")!,parameters:{videoId:record.videoId},data:record};return (await query()).results[0]!;}
async function source(kind="external"){const id=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext,enabled) VALUES (${id},'Synthetic authorized source',${kind},'editorial',true,true)`;return id;}
test("concurrent same-record UID/secure IDs bind one isolated source, retain explicit permissions and reject conflicting owners",async()=>{
  const {importDouyinResult}=await import("@aihot/backend/providers/redfox/import-douyin");const i=identifiers(),a=await accountQuery(i),b=await accountQuery(i),key=tag(),beforeHits=hits;process.env.REDFOX_CALLS_ENABLED="false";
  try{const [first,second]=await Promise.all([importDouyinResult(a.id,{reason:"Synthetic verification"},"test",key),importDouyinResult(b.id,{reason:"Synthetic verification"},"test",tag())]);assert.equal(first!.sourceId,second!.sourceId);assert.deepEqual(await importDouyinResult(a.id,{reason:"Retry"},"test",key),first);assert.equal(hits,beforeHits);
    const [s]=await sql`SELECT * FROM sources WHERE id=${first!.sourceId}`;assert.equal(s!.participation_mode,"isolated");assert.equal(s!.site_fulltext,false);assert.equal((await sql`SELECT * FROM source_account_bindings WHERE source_id=${first!.sourceId}`).length,2);
    await assert.rejects(importDouyinResult(a.id,{sourceId:first!.sourceId,reason:"Changed intent"},"test",key),{code:"conflict"});
  }finally{process.env.REDFOX_CALLS_ENABLED="true";}
  const j=identifiers(),owner=await source(),r=await accountQuery(j);await importDouyinResult(r.id,{sourceId:owner,reason:"Explicit confirmed account"},"test",tag());assert.equal((await sql`SELECT site_fulltext FROM sources WHERE id=${owner}`)[0]!.site_fulltext,true);
  const collision=await accountQuery({...i,secureId:j.secureId});await assert.rejects(importDouyinResult(collision.id,{reason:"Conflicting pair"},"test",tag()),{code:"conflict"});assert.equal((await sql`SELECT source_id FROM operation_results WHERE id=${collision.id}`)[0]!.source_id,null);
  const changed=await accountQuery({...j,secureId:identifiers().secureId});await assert.rejects(importDouyinResult(changed.id,{sourceId:owner,reason:"Replacing typed ID"},"test",tag()),{code:"conflict"});
  const unrelated=await source("rss"),unbound=await accountQuery(identifiers());await assert.rejects(importDouyinResult(unbound.id,{sourceId:unrelated,reason:"Wrong kind"},"test",tag()),/external source/);
});
test("work imports verify native IDs, preserve unknown-time history and media, and never resolve short links",async()=>{
  const {importDouyinResult}=await import("@aihot/backend/providers/redfox/import-douyin");const i=identifiers(),id=`997${Date.now()}`,original=`https://www.iesdouyin.com/share/video/${id}`,owner=await source("rss");
  const r=await workQuery({videoId:id,opusUrl:original,authorUid:i.userId,authorSecUid:i.secureId,content:"Synthetic imported content",publishTime:"2001-01-01 12:00:00",imageUrlList:["https://example.com/synthetic.png","javascript:bad"],coverUrl:"https://example.com/synthetic-cover.png"});
  const beforeHits=hits;process.env.REDFOX_CALLS_ENABLED="false";let result;
  try{result=await importDouyinResult(r.id,{sourceId:owner,reason:"Synthetic work"},"test",tag());assert.equal(hits,beforeHits);}finally{process.env.REDFOX_CALLS_ENABLED="true";}
  const [a]=await sql`SELECT * FROM articles WHERE id=${result!.articleId!}`;assert.equal(a!.identity_key,`douyin:aweme_id:${id}`);assert.equal(a!.backfill,true);assert.equal(a!.published_at,null);assert.equal(a!.media.length,2);
  const mismatch=await workQuery({videoId:id+"1",opusUrl:original,authorUid:i.userId,content:"Mismatch"});await assert.rejects(importDouyinResult(mismatch.id,{sourceId:owner,reason:"Mismatch"},"test",tag()),{code:"conflict"});
  const short=await workQuery({videoId:id+"2",opusUrl:"https://v.douyin.com/synthetic",authorUid:i.userId,content:"Short"});await assert.rejects(importDouyinResult(short.id,{sourceId:owner,reason:"No resolving"},"test",tag()),/permalink/);
  await sql`UPDATE sources SET enabled=false WHERE id=${result!.sourceId}`;await assert.rejects(importDouyinResult((await workQuery({videoId:id+"3",opusUrl:`https://www.douyin.com/video/${id}3`,authorUid:i.userId,content:"Paused"})).id,{sourceId:owner,reason:"Paused"},"test",tag()),/disabled/);
});
test("AI original proves work without authors; mappings cannot override configured owner and growth time stays trusted",async()=>{
  const {importDouyinResult}=await import("@aihot/backend/providers/redfox/import-douyin"),i=identifiers(),owner=await source(),target=await source("rss");await importDouyinResult((await accountQuery(i)).id,{sourceId:owner,reason:"Bind verified author"},"test",tag());
  const id=`996${Date.now()}`;fixture={...cases.find(c=>c.id==="I8P3HTVH")!,data:{list:[{photoId:"unrelated-provider-id",authorId:i.userId,title:"Synthetic AI",url:`https://www.douyin.com/video/${id}`}]}};const ai=(await query()).results[0]!;
  await assert.rejects(importDouyinResult(ai.id,{reason:"No owner selection"},"test",tag()),/associated source/);
  const imported=await importDouyinResult(ai.id,{sourceId:target,reason:"Explicit configured owner"},"test",tag());assert.equal((await sql`SELECT source_id FROM articles WHERE id=${imported!.articleId!}`)[0]!.source_id,target);
  assert.equal((await sql`SELECT source_id FROM source_account_bindings WHERE platform='douyin' AND id_value=${i.userId}`)[0]!.source_id,owner);
  const stamp=Date.now()-3600_000,rankId=id+"1";fixture={...cases.find(c=>c.id==="WD6UT8DQ")!,data:[{...growth,aweme_id:rankId,author_user_id:i.userId,share_url:`https://www.iesdouyin.com/share/video/${rankId}`,create_time:stamp}]};const q=(await query()).results[0]!,saved=await importDouyinResult(q.id,{sourceId:target,reason:"Trusted epoch"},"test",tag());const [article]=await sql`SELECT published_at,backfill FROM articles WHERE id=${saved!.articleId!}`;assert.equal(article!.published_at.getTime(),stamp);assert.equal(article!.backfill,false);
  fixture=cases.find(c=>c.id==="20060017")!;await assert.rejects(importDouyinResult((await query()).results[0]!.id,{reason:"No rank identity"},"test",tag()),/ranking links/);
});

test("historical article collision rolls back a new author binding, result, audit and material as one import",async()=>{
  const {importDouyinResult}=await import("@aihot/backend/providers/redfox/import-douyin"),{newArticleId,sha256}=await import("@aihot/backend/lib/ids"),{identityKeyForUrl}=await import("@aihot/backend/lib/url");
  const i=identifiers(),id=`995${Date.now()}`,owner=await source();
  for(const address of [`https://www.douyin.com/video/${id}`,`https://www.iesdouyin.com/share/video/${id}`])await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES (${newArticleId()},${owner},${identityKeyForUrl(address)!},${address},'Synthetic historical owner',now(),now())`;
  const r=await workQuery({videoId:id,opusUrl:`https://www.douyin.com/video/${id}`,authorUid:i.userId,authorSecUid:i.secureId,content:"Synthetic collision"});
  await assert.rejects(importDouyinResult(r.id,{sourceId:owner,reason:"Synthetic collision"},"test",tag()),{code:"conflict"});
  assert.equal((await sql`SELECT 1 FROM sources WHERE id=${`douyin-${sha256(`uid:${i.userId}`).slice(0,24)}`}`).length,0);
  assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE platform='douyin' AND id_value=${i.userId}`).length,0);
  assert.equal((await sql`SELECT source_id FROM operation_results WHERE id=${r.id}`)[0]!.source_id,null);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject=${`result:${r.id}`}`).length,0);
});

test('native URL requests reject known mismatches, preserve raw and never infer short-link identity',async()=>{
  const { parseDouyin }=await import('@aihot/backend/providers/redfox/douyin');
  const a='980400000000000001',b='980400000000000002',base=cases.find(c=>c.id==='0OT1E306')!;
  for(const data of [{workId:b,workUrl:`https://www.douyin.com/video/${b}`},{workId:a,workUrl:`https://www.douyin.com/video/${b}`}]){
    fixture={...base,parameters:{workUrl:`https://www.douyin.com/video/${a}`},data};
    const q=await query();assert.equal(q.run.status,'needs_review');
    const [receipt]=await sql`SELECT * FROM receipts WHERE id=${q.run.current_receipt_id}`;
    assert.equal(receipt!.status,'received');assert.deepEqual(JSON.parse(receipt!.response.body).data,data);
    const initial=hits;await sql.begin(tx=>resumeRun(tx,{runId:q.run.id,stepVersion:q.run.step_version,generation:q.run.generation}));
    process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
    try{await step(q.run.id);assert.equal(hits,initial);assert.equal((await row(q.run.id)).status,'needs_review');}
    finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-douyin';}
  }
  fixture={...base,parameters:{workUrl:`http://douyin.com/video/${a}?tracking=synthetic`},data:{workId:a,workUrl:`https://www.douyin.com/video/${a}?other=synthetic`}};
  assert.equal((await query()).run.status,'completed');
  const unresolved=parseDouyin('0OT1E306',{workUrl:'https://v.douyin.com/synthetic'},{workUrl:'https://v.douyin.com/synthetic'})[0]!;
  assert.equal(unresolved.data.workId,null);assert.ok((unresolved.data.missing as string[]).length);
  // Unknown URL shapes provide no identity assertion; no resolution request is made.
  assert.doesNotThrow(()=>parseDouyin('0OT1E306',{workId:b,workUrl:`https://www.douyin.com/video/${b}`},{workUrl:'https://v.douyin.com/synthetic'}));
});

test("real wide-detail imports confirm only documented string video types",async()=>{
 const {importDouyinResult}=await import("@aihot/backend/providers/redfox/import-douyin"),i=identifiers(),owner=await source();
 for(const [videoType,confirmed] of [["0",true],["63",true],["68",false],[0,false]] as const){
  const id=`995${Date.now()}${String(videoType).replace(/[^0-9]/g,"")}`;
  const r=await workQuery({videoId:id,opusUrl:`https://www.douyin.com/video/${id}`,authorUid:i.userId,content:"Video contract",videoType});
  const imported=await importDouyinResult(r.id,{sourceId:owner,reason:"Synthetic video contract"},"test",tag());
  const [a]=await sql`SELECT media FROM articles WHERE id=${imported!.articleId}`;
  assert.equal(a!.media.some((m:{confirmed?:boolean})=>m.confirmed===true),confirmed);
  if(confirmed){
   const {scanVideoHistory,applyVideoHistoryEntry}=await import("@aihot/backend/content/video-history");
   await sql`UPDATE articles SET media='[]'::jsonb WHERE id=${imported!.articleId}`;
   const manifest=await sql.begin('read only',tx=>scanVideoHistory(tx,5000)),entry=manifest.entries.find(e=>e.articleId===imported!.articleId);
   assert.ok(entry,'the retained exact wide-detail receipt supports historical repair');
   await sql.begin(tx=>applyVideoHistoryEntry(tx,entry));
  }
 }
});

test('Douyin collection imports authorless works into frozen RSS owner and ignores foreign author bindings',async()=>{
 for(const hasAuthor of [false,true]){
  const owner=await source('rss'),foreign=await source(),id=`994${Date.now()}${hasAuthor?1:0}`,identity=identifiers();
  await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES ('douyin','uid',${identity.userId},${foreign},'{}')`;
  fixture={...cases.find(c=>c.id==='OWIBYU1V')!,data:{list:[{videoId:id,opusUrl:`https://www.douyin.com/video/${id}`,content:'Synthetic collection',...(hasAuthor?{authorUid:identity.userId}:{})}]}};
  const sub=await createPlatformSubscription({name:tag(),sourceId:owner,operationId:fixture.id,parameters:fixture.parameters,enabled:true,limits:{pages:1,items:1,details:0}},'test',tag());
  process.env.COLLECT_ENABLED='true';const run=await startPlatformSubscription(sub.id,'test',tag());
  try{for(let n=0;n<5&&(await sql`SELECT status FROM operation_runs WHERE id=${run.id}`)[0]!.status==='active';n++){const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${run.id}`;await executeOperationStep(run.id,r!.step_version,randomUUID());}}finally{process.env.COLLECT_ENABLED='false';}
  const [r]=await sql`SELECT id,article_id,source_id,provenance FROM operation_results WHERE run_id=${run.id} AND kind='douyin_work'`;assert.ok(r!.article_id);assert.equal(r!.source_id,owner);
  assert.equal((await sql`SELECT source_id FROM articles WHERE id=${r!.article_id}`)[0]!.source_id,owner);
  assert.equal((await sql`SELECT source_id FROM source_account_bindings WHERE platform='douyin' AND id_value=${identity.userId}`)[0]!.source_id,foreign);
  const {importDouyinResult}=await import('@aihot/backend/providers/redfox/import-douyin');
  await sql`UPDATE sources SET enabled=false,execution_version=execution_version+1 WHERE id=${owner}`;
  await sql`UPDATE collection_subscriptions SET execution_version=execution_version+1 WHERE id=${sub.id}`;
  assert.equal((await importDouyinResult(r!.id,{reason:'Completed replay'},'collector',r!.provenance.douyinImport.key))!.articleId,r!.article_id);
  await assert.rejects(importDouyinResult(r!.id,{sourceId:foreign,reason:'Changed replay'},'collector',r!.provenance.douyinImport.key),{code:'conflict'});
  await assert.rejects(importDouyinResult(r!.id,{reason:'New command'},'collector',tag()),/disabled|changed/);

 }
});

test('completed legacy query import replays after source disable without guessing an owner',async()=>{
 const {importDouyinResult}=await import('@aihot/backend/providers/redfox/import-douyin'),owner=await source(),key=tag(),id=`996${Date.now()}`;
 const r=await workQuery({videoId:id,opusUrl:`https://www.douyin.com/video/${id}`,content:'No author'});
 const saved=await importDouyinResult(r.id,{sourceId:owner,reason:'Selected'},'test',key);
 await sql`UPDATE operation_results SET provenance=jsonb_set(provenance,'{douyinImport,intent,sourceId}','null') WHERE id=${r.id}`;
 await sql`UPDATE sources SET enabled=false,execution_version=execution_version+1 WHERE id=${owner}`;
 assert.deepEqual(await importDouyinResult(r.id,{reason:'Legacy exact replay'},'test',key),saved);
 await assert.rejects(importDouyinResult(r.id,{sourceId:owner,reason:'Different intent'},'test',key),{code:'conflict'});
});
