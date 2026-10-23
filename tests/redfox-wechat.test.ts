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
import { resumeRun } from "@aihot/backend/providers/operations/store";
import { wechatOperations,type WechatOperation } from "@aihot/backend/providers/redfox/wechat-contract";
const wxId="gh_synthetic123",bizInfo="U3ludGhldGljQml6",url=`https://mp.weixin.qq.com/s?__biz=${bizInfo}&mid=123456789&idx=1&sn=synthetic`;
const account={account:"synthetic_display",accountName:"Synthetic account",wxId,bizInfo};
const work={workUuid:"synthetic-work",title:"Synthetic title",content:"Synthetic body",workUrl:url,bizInfo,publishTime:"2026-10-19 12:00:00"};
const cases:{id:WechatOperation;path:string;method:"GET"|"POST";parameters:Record<string,unknown>;data:unknown;kind:string}[]=[
  {id:"6C4A77XR",path:"/story/api/gzhData/queryUser",method:"POST",parameters:{account:account.account},data:{account:account.account,accountName:account.accountName},kind:"wechat_account"},
  {id:"KUQYSQNX",path:"/story/api/gzh/data/accountInfo",method:"POST",parameters:{wxId},data:account,kind:"wechat_account"},
  {id:"XEO0QQNF",path:"/story/api/gzhData/queryWork",method:"POST",parameters:{workUuid:work.workUuid},data:work,kind:"wechat_work"},
  {id:"1LDQ7E1C",path:"/story/api/gzh/data/workDetail",method:"POST",parameters:{workUuid:work.workUuid},data:work,kind:"wechat_work"},
  {id:"DNVPQZEZ",path:"/story/api/gzhData/searchUser",method:"POST",parameters:{keyword:"fixture",offset:20,sortType:"_2"},data:{total:1,hasMore:false,list:[{account:account.account,accountName:account.accountName}]},kind:"wechat_account"},
  {id:"5Y84NI1D",path:"/story/api/gzh/data/searchUser",method:"POST",parameters:{keyword:"fixture",offset:40},data:{total:1,list:[account]},kind:"wechat_account"},
  {id:"PW97QFBS",path:"/story/api/gzhData/searchArticle",method:"POST",parameters:{keyword:"fixture",offset:20,sortType:"_4",exactMatch:true},data:{list:[work],total:1,hasMore:0},kind:"wechat_work"},
  {id:"FVQ8D4W5",path:"/story/api/gzh/data/searchArticle",method:"POST",parameters:{keyword:"fixture",offset:20,sortType:"4",exactMatch:false},data:{list:[work],total:1},kind:"wechat_work"},
  {id:"XNV30XZ3",path:"/story/api/gzhData/queryWorkList",method:"POST",parameters:{account:account.account,offset:0,sortType:"_0",publishTimeStart:"2026-04-01",publishTimeEnd:"2026-10-19"},data:{list:[work],total:1,hasMore:1},kind:"wechat_work"},
  {id:"8IQD0BJC",path:"/story/api/gzh/data/queryWorkList",method:"POST",parameters:{bizInfo,offset:20,sortType:"2"},data:{list:[work],total:1},kind:"wechat_work"},
  {id:"IE0887SO",path:"/story/api/parseWork/queryAiMsgs",method:"POST",parameters:{keyword:"fixture",pageNum:1,pageSize:20,startTime:"2026-10-19 00:00:00",endTime:"2026-10-19 23:59:59"},data:{list:[{photoId:"not-a-native-id",authorId:"not-an-author-id",title:"Synthetic AI entry",url:"https://example.com/synthetic"}],total:1,pageNum:1,pageSize:20},kind:"wechat_work"},
  {id:"I3CIBRI2",path:"/story/api/gzh/ability/temp/article/content",method:"POST",parameters:{articleUrl:url},data:{articleUrl:url,articleTitle:"Synthetic realtime",articleContent:"Synthetic body",wechatId:wxId,bizKey:bizInfo,messageId:"123456789",uniqueId:"not-a-native-id"},kind:"wechat_work"},
  {id:"ZIGAGYYT",path:"/story/api/cozeSkill/getTenWReadingRank",method:"POST",parameters:{type:"科技数码",startDate:"2026-10-18",endDate:"2026-10-19"},data:[{title:"Synthetic recommended work",oriUrl:url,content:"Synthetic body",accountId:"display-only",photoId:"provider-only"}],kind:"wechat_work"},
  {id:"OFFSPQ0U",path:"/story/api/cozeSkill/getOriginalRank",method:"POST",parameters:{type:"总排名",startDate:"2026-10-18",endDate:"2026-10-19"},data:[{title:"Synthetic original work",oriUrl:url,content:"Synthetic body"}],kind:"wechat_work"},
  {id:"DL4YNCTQ",path:"/story/api/cozeSkill/getGzhCozeSkillDataRaise",method:"GET",parameters:{rankDate:"2026-10-19"},data:[{accountId:wxId,userName:"Synthetic growth account",growthRate:10,maxWork:{title:"Synthetic maximum work",oriUrl:url},minWork:null}],kind:"wechat_account_rank"},
  {id:"JBGBKQ4B",path:"/story/api/cozeSkill/getGzhCozeSkillDataIndex",method:"GET",parameters:{rankType:"week",rankDate:"2026-10-19",category:"科技数码"},data:[{accountId:"display-only",accountName:"Synthetic rank",comprehensiveScore:1}],kind:"wechat_account_rank"},
  {id:"API_1789637464311",path:"/story/api/gzh/heima/rankList",method:"POST",parameters:{page:1,rank_date:"2026-10-19 00:00:00",author_type:"科技数码",sort:"growth_val"},data:[{account_id:"900719925474099312345",nickname:"Synthetic headline rank",growth_val:1}],kind:"wechat_account_rank"},
];
let hits=0;let fixture=cases[0]!;let rawOverride:string|undefined;let saved:Record<string,unknown>;
const server=http.createServer((req,res)=>{hits++;let body="";req.on("data",c=>body+=c);req.on("end",()=>{
  try{const requested=new URL(req.url!,"http://localhost");assert.equal(requested.pathname,fixture.path);assert.equal(req.method,fixture.method);assert.equal(req.headers.redfox_api_key,"fake-wechat");
    if(fixture.method==="GET"){assert.equal(body,"");assert.equal(req.headers["content-type"],undefined);assert.deepEqual(Object.fromEntries(requested.searchParams),fixture.parameters);}
    else {assert.equal(requested.search,"");assert.deepEqual(JSON.parse(body),fixture.parameters);assert.match(req.headers["content-type"]!,/application\/json/);}
    res.setHeader("content-type","application/json");res.end(rawOverride??JSON.stringify({code:fixture.id==="I3CIBRI2"?200:2000,data:fixture.data}));
  }catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}
});});
before(async()=>{await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY="fake-wechat";process.env.REDFOX_CALLS_ENABLED="true";config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED="false";delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function query(){const r=await createSynchronousQuery({operationId:fixture.id,parameters:fixture.parameters},"wechat-test",tag());await step(r.id);return {run:await row(r.id),results:await sql`SELECT * FROM operation_results WHERE run_id=${r.id} ORDER BY id`};}
test("all 17 fixed operations use their documented method and parameter location and persist typed results",async()=>{
  const beforeHits=hits;
  for(const c of cases){fixture=c;const result=await query();assert.equal(result.run.status,"completed",`${c.id}: ${result.run.wait_reason}`);assert.equal(result.results[0]!.kind,c.kind);assert.equal(result.results[0]!.data.platform,"wechat");
    if(c.id==="DL4YNCTQ"){assert.deepEqual(result.results.map(r=>r.kind),["wechat_account_rank","wechat_work"]);assert.equal(result.results[0]!.data.record.maxWork,undefined);}
    if(c.id==="IE0887SO"){assert.deepEqual(result.results[0]!.data.identity,{});assert.equal(result.results[0]!.data.url,null);assert.equal(result.results[0]!.data.missing.length,2);}
    if(c.id==="6C4A77XR")assert.equal(result.results[0]!.data.missing.length,1);
  }assert.equal(hits,beforeHits+17);
});
test("GET catalog stays free; schemas reject account ambiguity, wrong types, offset steps, sort namespaces and calendar errors",async()=>{
  const {buildApp}=await import("../apps/api/src/app.ts");const app=await buildApp();config.devAdmin={displayName:"Wechat fixture"};const beforeHits=hits;
  try{const catalog=await app.inject({url:"/api/admin/redfox/operations"});assert.equal(catalog.statusCode,200);assert.equal(catalog.json().filter((x:{id:string})=>x.id in wechatOperations).length,17);assert.equal(hits,beforeHits);
    for(const [id,input] of [["KUQYSQNX",{}],["KUQYSQNX",{account:"a",wxId}],["5Y84NI1D",{keyword:"test",offset:1}],["DNVPQZEZ",{keyword:"test",sortType:"2"}],["FVQ8D4W5",{keyword:"test",sortType:"_2"}],["IE0887SO",{keyword:"test",pageNum:"1",pageSize:20}],["API_1789637464311",{page:6,rank_date:"2026-10-19 00:00:00"}],["API_1789637464311",{page:1,rank_date:"2026-10-20 00:00:00"}],["API_1789637464311",{}],["XNV30XZ3",{account:"test",publishTimeStart:"2026-03-31"}],["JBGBKQ4B",{rankType:"weeks",rankDate:"2026-10-19",category:"科技数码"}]] as [WechatOperation,unknown][]){assert.equal(wechatOperations[id].schema.safeParse(input).success,false,id);}
  }finally{config.devAdmin=null;await app.close();}
});
test("huge integer lexemes are preserved without promoting provider internal IDs",async()=>{
  fixture=cases.find(c=>c.id==="API_1789637464311")!;rawOverride='{"code":2000,"data":[{"account_id":900719925474099312345,"nickname":"Synthetic large ID"}]}';
  try{const result=await query();assert.equal(result.run.status,"completed");assert.equal(result.results[0]!.data.record.account_id,"900719925474099312345");assert.deepEqual(result.results[0]!.data.identity,{});}finally{rawOverride=undefined;}
});
test("empty pages commit consumption summaries; malformed and wrong per-operation success codes retain raw without repurchase",async()=>{
  fixture=cases.find(c=>c.id==="5Y84NI1D")!;rawOverride='{"code":2000,"data":{"list":[],"total":0}}';
  try{const empty=await query();assert.equal(empty.run.status,"completed");assert.equal(empty.results[0]!.kind,"query_summary");assert.equal(empty.results[0]!.data.count,0);
    rawOverride='{broken';const broken=await query();assert.equal(broken.run.status,"needs_review");const beforeHits=hits;
    await sql.begin(tx=>resumeRun(tx,{runId:broken.run.id,stepVersion:broken.run.step_version,generation:broken.run.generation}));process.env.REDFOX_CALLS_ENABLED="false";await step(broken.run.id);assert.equal(hits,beforeHits);assert.equal((await row(broken.run.id)).status,"needs_review");process.env.REDFOX_CALLS_ENABLED="true";
    fixture=cases.find(c=>c.id==="I3CIBRI2")!;rawOverride=JSON.stringify({code:2000,data:fixture.data});assert.equal((await query()).run.status,"needs_review");
    fixture=cases[0]!;rawOverride=JSON.stringify({code:200,data:fixture.data});assert.equal((await query()).run.status,"needs_review");
    rawOverride=JSON.stringify({code:2000,data:{}});assert.equal((await query()).run.status,"needs_review");
  }finally{rawOverride=undefined;process.env.REDFOX_CALLS_ENABLED="true";}
});

test("realtime detail rejects different normalized short URLs without inventing a short/long alias",async()=>{
  const {parseWechat}=await import("@aihot/backend/providers/redfox/wechat");
  const record={articleUrl:"https://mp.weixin.qq.com/s/SyntheticDifferent",articleTitle:"Synthetic response",wechatId:wxId,bizKey:bizInfo};
  assert.throws(()=>parseWechat("I3CIBRI2",record,{articleUrl:"https://mp.weixin.qq.com/s/SyntheticRequested"}),/differs from requested/);
  assert.equal(parseWechat("I3CIBRI2",record,{articleUrl:record.articleUrl+"?utm_source=fixture"}).length,1);
  assert.equal(parseWechat("I3CIBRI2",{...record,articleUrl:url},{articleUrl:"https://mp.weixin.qq.com/s/SyntheticRequested"}).length,1);
});

async function accountQuery(values:Record<string,unknown>){fixture={...cases[1]!,parameters:{wxId:values.wxId},data:values};return (await query()).results[0]!;}
async function workQuery(values:Record<string,unknown>){fixture={...cases.find(c=>c.id==="I3CIBRI2")!,parameters:{articleUrl:values.articleUrl},data:values};return (await query()).results[0]!;}
const uniqueIdentity=()=>{const token=randomUUID().replaceAll("-","");return {wxId:`gh_${token}`,bizInfo:`biz${token}`,account:`display${token}`,accountName:"Synthetic import"};};
async function source(kind="external",cfg:Record<string,string>={}){const id=tag();await sql`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled) VALUES (${id},'Synthetic import source',${kind},${sql.json(cfg)},'editorial',true,false,true)`;return id;}

test("dual received IDs concurrently resolve one isolated source and imports remain local and idempotent",async()=>{
  const {importWechatResult}=await import("@aihot/backend/providers/redfox/import-wechat");const identity=uniqueIdentity();
  const first=await accountQuery(identity),second=await accountQuery(identity),beforeHits=hits;process.env.REDFOX_CALLS_ENABLED="false";
  try{
    const key=tag();const [a,b]=await Promise.all([importWechatResult(first.id,{reason:"Synthetic identity verification"},"wechat-test",key),importWechatResult(second.id,{reason:"Synthetic identity verification"},"wechat-test",tag())]);
    assert.equal(a!.sourceId,b!.sourceId);assert.deepEqual(await importWechatResult(first.id,{reason:"retry"},"wechat-test",key),a);
    const bindings=await sql`SELECT * FROM source_account_bindings WHERE source_id=${a!.sourceId}`;assert.equal(bindings.length,2);
    const [s]=await sql`SELECT * FROM sources WHERE id=${a!.sourceId}`;assert.equal(s!.participation_mode,"isolated");assert.equal(s!.site_fulltext,false);
    assert.equal(Number((await sql`SELECT count(*) FROM audit_log WHERE subject=${`result:${first.id}`}`)[0]!.count),1);assert.equal(hits,beforeHits);
  }finally{process.env.REDFOX_CALLS_ENABLED="true";}
});

test("mp matching prioritizes effective ghid; no ghid permits exact received display account and conflicts roll back",async()=>{
  const {importWechatResult}=await import("@aihot/backend/providers/redfox/import-wechat");const i=uniqueIdentity(),r=await accountQuery(i),id=await source("mp_account",{ghid:"gh_wrong",wxid:i.account});
  await assert.rejects(importWechatResult(r.id,{sourceId:id,reason:"Synthetic check"},"wechat-test",tag()),/configured account/);
  await sql`INSERT INTO collection_subscriptions(control_source_id,provider,platform,operation_key,contract_version,config,interval_minutes) VALUES (${id},'dajiala','wechat','native.mp',1,${sql.json({ghid:i.wxId,wxid:"different-display"})},15)`;
  assert.equal((await importWechatResult(r.id,{sourceId:id,reason:"Synthetic verified ghid"},"wechat-test",tag()))!.sourceId,id);
  const j=uniqueIdentity(),r2=await accountQuery(j),id2=await source("mp_account",{wxid:j.account});
  assert.equal((await importWechatResult(r2.id,{sourceId:id2,reason:"Synthetic exact display"},"wechat-test",tag()))!.sourceId,id2);
  const wrong=await accountQuery({...j,wxId:uniqueIdentity().wxId,bizInfo:undefined});
  await assert.rejects(importWechatResult(wrong.id,{sourceId:id2,reason:"Synthetic conflicting ID"},"wechat-test",tag()),/different identity/);
  assert.equal((await sql`SELECT source_id FROM operation_results WHERE id=${wrong.id}`)[0]!.source_id,null);
});

test("two stable IDs with different owners reject atomically and account display alone never binds",async()=>{
  const {importWechatResult}=await import("@aihot/backend/providers/redfox/import-wechat");const a=uniqueIdentity(),b=uniqueIdentity();
  for(const i of [a,b]){const r=await accountQuery(i);await importWechatResult(r.id,{reason:"Synthetic owner"},"wechat-test",tag());}
  const conflict=await accountQuery({...a,bizInfo:b.bizInfo});
  await assert.rejects(importWechatResult(conflict.id,{reason:"Synthetic collision"},"wechat-test",tag()),/different sources/);
  assert.equal((await sql`SELECT source_id FROM operation_results WHERE id=${conflict.id}`)[0]!.source_id,null);
  fixture={...cases[0]!,parameters:{account:"only-display"},data:{account:"only-display",accountName:"Synthetic"}};const r=(await query()).results[0]!;
  await assert.rejects(importWechatResult(r.id,{reason:"Synthetic missing identity"},"wechat-test",tag()),/verified wxId/);
});

test("work import preserves canonical article ownership, sanitizes media/body, and paused authors cannot import",async()=>{
  const {importWechatResult}=await import("@aihot/backend/providers/redfox/import-wechat");const {upsertMaterial}=await import("@aihot/backend/content/materials");const i=uniqueIdentity(),accountResult=await accountQuery(i),owner=await source("mp_account",{ghid:i.wxId});
  await importWechatResult(accountResult.id,{sourceId:owner,reason:"Synthetic verified owner"},"wechat-test",tag());
  const original=`https://mp.weixin.qq.com/s?__biz=${i.bizInfo}&mid=987654321&idx=1`,old=await upsertMaterial({sourceId:owner,url:original,title:"Original title",bodyText:"Original body",via:"import"});
  const r=await workQuery({articleUrl:original+"&scene=1",wechatId:i.wxId,bizKey:i.bizInfo,articleTitle:"Synthetic fresh title",articleContent:"<p>Verified body</p><script>bad()</script>",publishDate:"2026-10-19 12:00:00",imageUrls:["https://example.com/synthetic.png","javascript:bad"],videoLink:"https://example.com/synthetic.mp4"});
  const result=await importWechatResult(r.id,{reason:"Synthetic work import"},"wechat-test",tag());assert.equal(result!.articleId,old.articleId);
  const [article]=await sql`SELECT * FROM articles WHERE id=${old.articleId}`;assert.equal(article!.source_id,owner);assert.equal(article!.published_at_claim,null);assert.equal(article!.media.length,2);assert.doesNotMatch(article!.body_html,/script|bad/);assert.equal(article!.body_text,"Verified body");
  const foreign=await source(),foreignUrl=`https://mp.weixin.qq.com/s?__biz=${i.bizInfo}&mid=987654322&idx=1`,foreignArticle=await upsertMaterial({sourceId:foreign,url:foreignUrl,title:"Foreign original",bodyText:"Do not replace",via:"import"});
  const f=await workQuery({articleUrl:foreignUrl,wechatId:i.wxId,bizKey:i.bizInfo,articleTitle:"Fresh",articleContent:"Never overwrite"});assert.equal((await importWechatResult(f.id,{reason:"Synthetic discovery"},"wechat-test",tag()))!.articleId,foreignArticle.articleId);
  assert.equal((await sql`SELECT body_text FROM articles WHERE id=${foreignArticle.articleId}`)[0]!.body_text,"Do not replace");
  await sql`UPDATE sources SET enabled=false WHERE id=${owner}`;const paused=await workQuery({articleUrl:original,wechatId:i.wxId,bizKey:i.bizInfo,articleTitle:"Paused"});await assert.rejects(importWechatResult(paused.id,{reason:"Synthetic paused"},"wechat-test",tag()),/disabled/);
});

test("manual missing evidence cannot claim publication permissions; API local import uses the common command boundary",async()=>{
  const {importWechatResult}=await import("@aihot/backend/providers/redfox/import-wechat");const i=uniqueIdentity(),a=await accountQuery(i),owner=await source();await importWechatResult(a.id,{sourceId:owner,reason:"Synthetic binding"},"wechat-test",tag());
  const r=await workQuery({articleUrl:"https://mp.weixin.qq.com/s/SyntheticUnidentified",articleTitle:"Synthetic missing author"});
  await assert.rejects(importWechatResult(r.id,{reason:"Synthetic manual evidence",supplement:{wxId:i.wxId,evidence:"Synthetic source evidence"}},"wechat-test",tag()),/cannot inherit/);
  const {buildApp}=await import("../apps/api/src/app.ts"),app=await buildApp();config.devAdmin={displayName:"Wechat fixture"};const j=uniqueIdentity(),q=await accountQuery(j),beforeHits=hits;process.env.REDFOX_CALLS_ENABLED="false";
  try{const response=await app.inject({method:"POST",url:`/api/admin/operations/results/${q.id}/import`,headers:{"x-csrf-token":"dev","idempotency-key":tag(),origin:"http://localhost:5173"},payload:{reason:"Synthetic local import"}});assert.equal(response.statusCode,200,response.body);assert.equal(hits,beforeHits);}finally{config.devAdmin=null;process.env.REDFOX_CALLS_ENABLED="true";await app.close();}
});

test("growth work reuses only its actual account evidence; manual unknown work remains isolated",async()=>{
  const {importWechatResult}=await import("@aihot/backend/providers/redfox/import-wechat");const i=uniqueIdentity(),articleUrl=`https://mp.weixin.qq.com/s?__biz=${i.bizInfo}&mid=777&idx=1`;
  fixture={...cases.find(c=>c.id==="DL4YNCTQ")!,data:[{accountId:i.wxId,userName:"Synthetic growth",maxWork:{title:"Synthetic growth work",oriUrl:articleUrl,content:"Synthetic body"}}]};
  const q=await query(),rank=q.results[0]!,workResult=q.results[1]!;
  const a=await importWechatResult(rank.id,{reason:"Synthetic rank account"},"wechat-test",tag()),w=await importWechatResult(workResult.id,{reason:"Synthetic ranked work"},"wechat-test",tag());assert.equal(a!.sourceId,w!.sourceId);assert.ok(w!.articleId);
  const missing=await workQuery({articleUrl:"https://mp.weixin.qq.com/s/SyntheticManual"+randomUUID().replaceAll("-",""),articleTitle:"Synthetic manual author"}),j=uniqueIdentity();
  const imported=await importWechatResult(missing.id,{reason:"Synthetic verified supplement",supplement:{wxId:j.wxId,evidence:"Synthetic original record verification"}},"wechat-test",tag());
  const [s]=await sql`SELECT participation_mode,site_fulltext FROM sources WHERE id=${imported!.sourceId}`;assert.equal(s!.participation_mode,"isolated");assert.equal(s!.site_fulltext,false);
});

test("import timing archives unknown and old candidates, keeps fresh news, and preserves existing/RSS timing",async()=>{
  const {importWechatResult}=await import("@aihot/backend/providers/redfox/import-wechat"),{upsertMaterial,isHistorical}=await import("@aihot/backend/content/materials");
  const i=uniqueIdentity(),fresh=new Date(Date.now()-3600_000).toISOString(),old=new Date(Date.now()-7*86400_000).toISOString();
  for(const [index,date] of [undefined,"2001-01-01 12:00:00",old,fresh].entries()){
    const r=await workQuery({articleUrl:`https://mp.weixin.qq.com/s?__biz=${i.bizInfo}&mid=${Date.now()}${index}&idx=1`,wechatId:i.wxId,bizKey:i.bizInfo,articleTitle:"Synthetic timing",articleContent:"Synthetic body",publishDate:date});
    const imported=await importWechatResult(r.id,{reason:"Synthetic timing"},"test",tag());
    const [a]=await sql`SELECT backfill,backfill_reason,published_at,discovered_at,timeline_at FROM articles WHERE id=${imported!.articleId!}`;
    assert.equal(a!.backfill,index!==3);assert.equal(isHistorical(a as never),index!==3);
    if(index<2)assert.equal(a!.backfill_reason,"redfox-import-unknown-time");
    if(index===2)assert.equal(a!.backfill_reason,"stale-on-discovery");
    if(index===3)assert.equal(a!.timeline_at.getTime(),a!.discovered_at.getTime());
  }
  const owner=(await sql`SELECT source_id FROM source_account_bindings WHERE platform='wechat' AND id_kind='wxId' AND id_value=${i.wxId}`)[0]!.source_id as string,address=`https://mp.weixin.qq.com/s?__biz=${i.bizInfo}&mid=${Date.now()}9&idx=1`;
  const existing=await upsertMaterial({sourceId:owner,url:address,title:"Synthetic RSS",bodyText:"Original",publishedAt:null,via:"fetch"});
  const [before]=await sql`SELECT source_id,published_at,discovered_at,timeline_at,backfill,backfill_reason FROM articles WHERE id=${existing.articleId}`;assert.equal(before!.backfill,false);
  const r=await workQuery({articleUrl:address,wechatId:i.wxId,bizKey:i.bizInfo,articleTitle:"Synthetic changed",publishDate:old});await importWechatResult(r.id,{reason:"Synthetic existing"},"test",tag());
  assert.deepEqual((await sql`SELECT source_id,published_at,discovered_at,timeline_at,backfill,backfill_reason FROM articles WHERE id=${existing.articleId}`)[0],before);
});
