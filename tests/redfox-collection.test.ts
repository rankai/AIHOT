import {tag,gate,stub} from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import {randomUUID} from "node:crypto";
import {before,after,test} from "node:test";
import {sql,closeDb} from "@aihot/backend/db";
import {config} from "@aihot/backend/config";
import {stopBoss} from "@aihot/backend/jobs/queue";
import {createNativeSubscription} from "@aihot/backend/sources/native-migration";
import {preflightXReplacement,switchXCollection} from "@aihot/backend/sources/x-replacement";
import {createCollection} from "@aihot/backend/sources/collection-commands";
import {executeOperationStep} from "@aihot/backend/providers/operations/execute";
import {recoverOperations} from "@aihot/backend/providers/operations/recovery";
const feeds=new Map<string,{handle:string;base:bigint}>();let seq=0,hits=0,failDetail:string|null=null,wrongAuthor=false,nullableUser=false,singlePage=false,missingTimelineText=false;
const noiseIds=new Set<string>();
const base=BigInt(Date.now())*1000000n;
function tweet(id:string,userId:string,handle:string|null=null){return {tweetId:id,createdAt:new Date().toISOString(),text:noiseIds.has(id)?"Synthetic noise marker":"Synthetic collection material",author:{userId,username:handle},replyToTweetId:null,replyToUserId:null,replyToUsername:null};}
const server=http.createServer((req,res)=>{const chunks:Buffer[]=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{
  hits++;const body=JSON.parse(Buffer.concat(chunks).toString());
  if(req.url?.endsWith("userTimeline")){
    const f=feeds.get(body.restId)!;
    const first={...tweet(String(f.base+300n),wrongAuthor?"999":body.restId),...(missingTimelineText?{text:undefined}:{})},second=tweet(String(f.base+200n),body.restId);
    res.end(JSON.stringify({code:2000,data:{user:{userId:body.restId,username:nullableUser?null:f.handle,displayName:null,avatar:null},pinned:body.cursor?null:first,timeline:body.cursor?[tweet(String(f.base+150n),body.restId),tweet(String(f.base+99n),body.restId)]:[first,second],nextCursor:body.cursor || singlePage?null:"page-2"}}));
  } else {
    if(body.tweetId===failDetail){failDetail=null;res.writeHead(503,{"retry-after":"1"});res.end('{"code":503}');return;}
    const [uid,f]=[...feeds].find(([,f])=>BigInt(body.tweetId)>f.base && BigInt(body.tweetId)<f.base+1000n)!;
    res.end(JSON.stringify({code:2000,data:tweet(body.tweetId,uid,f.handle)}));
  }
});});
let budgets:Array<{service:string;per_minute:number;per_hour:number;per_day:number}>=[];
before(async()=>{
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  process.env.REDFOX_API_KEY="synthetic";process.env.SOCIALDATA_API_KEY="synthetic";process.env.REDFOX_CALLS_ENABLED="true";process.env.COLLECT_ENABLED="true";config.allowPrivateNetworkFetch=true;
  budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.collect','redfox.query','socialdata')`;
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.collect','redfox.query','socialdata')`;
});
after(async()=>{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
async function source(){seq++;const id=`redfox-collect-${tag()}`,uid=String(base+BigInt(seq)*10000n),handle=`syn${Date.now().toString(36)}${seq}`;const b=base+BigInt(seq)*10000n;feeds.set(uid,{handle,base:b});
  await sql`INSERT INTO sources(id,name,kind,config,participation_mode) VALUES (${id},'Synthetic','x_search',${sql.json({query:`from:${handle} -filter:replies`})},'isolated')`;
  await sql.begin(tx=>createNativeSubscription(tx,id));
  await sql`UPDATE collection_subscriptions SET progress=${sql.json({lastTweetId:String(b+100n),initializedAt:"2026-01-01"})} WHERE control_source_id=${id}`;
  await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES ('x','user_id',${uid},${id},'{"kind":"audit","reference":"synthetic"}')`;
  return {id,uid,handle,b};
}
async function switchTo(id:string,target:"redfox"|"socialdata"){const p=(await preflightXReplacement(id,target))!;assert.equal(p.supported,true,JSON.stringify(p.checks));return switchXCollection(id,{target,sourceVersion:p.sourceVersion,subscriptionVersion:p.subscriptionVersion,mappingVersion:p.mappingVersion,reason:"synthetic switch"},"test");}
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
async function step(id:number){const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());}
async function recoverFixture(id:number){
  const [population]=await sql`SELECT count(*)::int AS count FROM operation_runs WHERE status IN ('active','waiting')`;
  for(let i=0;i<Math.ceil(population!.count/200)+2;i++){
    await recoverOperations();
    if((await row(id)).status==='active')return;
  }
}
async function drain(id:number){for(let i=0;i<30;i++){if((await row(id)).status!=="active")return;await step(id);}throw new Error("fixture step bound");}

test("same source/subscription switches both ways; detail interruption retains page and formal cursor",async()=>{
  const s=await source(),[original]=await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${s.id}`;
  const old=await preflightXReplacement(s.id,"redfox");await switchTo(s.id,"redfox");
  await assert.rejects(switchXCollection(s.id,{target:"redfox",sourceVersion:old!.sourceVersion,subscriptionVersion:old!.subscriptionVersion,mappingVersion:1,reason:"stale"},"test"),/changed/);
  const run=await createCollection(s.id,{actor:"test",key:tag(),reason:"schedule"});
  await step(run.id);await step(run.id);
  failDetail=String(s.b+200n);await step(run.id);
  const wait=await row(run.id);assert.equal(wait.status,"waiting");assert.equal(wait.progress.retainedReceiptIds.length,1);
  assert.equal((await sql`SELECT progress FROM collection_subscriptions WHERE id=${original!.id}`)[0]!.progress.lastTweetId,String(s.b+100n));
  await sql`UPDATE receipt_attempts SET finished_at=now()-interval '2 hours' WHERE receipt_id=(SELECT current_receipt_id FROM operation_runs WHERE id=${run.id}) AND status='failed'`;
      await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 minute' WHERE id=${run.id}`;await recoverFixture(run.id);await drain(run.id);
  assert.equal((await row(run.id)).status,"completed");
  assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id=${s.id}`)[0]!.n,3);
  const [sub]=await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${s.id}`;assert.equal(sub!.id,original!.id);assert.equal(sub!.progress.lastTweetId,String(s.b+300n));assert.equal(sub!.progress.continuation,null);
  await switchTo(s.id,"socialdata");const [back]=await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${s.id}`;
  assert.equal(back!.id,original!.id);assert.equal(back!.config.query,original!.config.query);assert.equal(back!.config.restId,undefined);assert.equal(back!.progress.lastTweetId,String(s.b+300n));
});

test("noise results consume detail receipts and let remaining items and the next collection finish",async()=>{
  for(const mode of ["reply-filter","missing-text","page-only"] as const){
    const s=await source(),noiseId=String(s.b+300n);
    const query=`from:${s.handle}${mode==="reply-filter"?" -filter:replies":""}`;
    await sql`UPDATE collection_subscriptions SET config=${sql.json({query,ingestNoiseFilter:{dropMarkers:["Synthetic noise marker"]}})} WHERE control_source_id=${s.id}`;
    await switchTo(s.id,"redfox");
    const run=await createCollection(s.id,{actor:"test",key:tag(),reason:"schedule"});
    noiseIds.add(noiseId);missingTimelineText=mode==="missing-text";
    const before=hits;
    try {
      await step(run.id);await step(run.id);
      const current=await row(run.id);
      assert.equal(current.status,"active",`${mode}: ${current.wait_reason}`);
      const [filtered]=await sql`SELECT z.*,r.status AS receipt_status,r.model FROM operation_results z JOIN receipts r ON r.id=z.receipt_id WHERE z.run_id=${run.id} AND z.kind='filtered'`;
      assert.ok(filtered,mode);assert.deepEqual(filtered.data,{reason:"noise"});
      assert.equal(filtered.item_key,`filtered:${noiseId}`);assert.equal(filtered.article_id,null);
      assert.equal(filtered.model,mode==="page-only"?"API_1790148502632":"QCP75W33");
      assert.equal(filtered.receipt_status,mode==="page-only"?"received":"completed");
      assert.equal(hits-before,mode==="page-only"?1:2);
      await drain(run.id);
      assert.equal((await row(run.id)).status,"completed");
      const articles=await sql`SELECT identity_key FROM articles WHERE source_id=${s.id}`;
      assert.deepEqual(articles.map(a=>a.identity_key).sort(),[String(s.b+150n),String(s.b+200n)].map(id=>`x:${id}`).sort());
      const [sub]=await sql`SELECT progress,active_run_id FROM collection_subscriptions WHERE control_source_id=${s.id}`;
      assert.equal(sub!.progress.lastTweetId,noiseId);assert.equal(sub!.active_run_id,null);
      assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results z JOIN receipts r ON r.id=z.receipt_id WHERE z.run_id=${run.id} AND r.status<>'completed'`)[0]!.n,0);
      const next=await createCollection(s.id,{actor:"test",key:tag(),reason:"manual",force:true});await drain(next.id);
      assert.equal((await row(next.id)).status,"completed");
      assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id=${s.id}`)[0]!.n,2);
    } finally {noiseIds.delete(noiseId);missingTimelineText=false;}
  }
});

test("native backlog prevents switching without changing the original subscription",async()=>{
  const s=await source();await sql`UPDATE collection_subscriptions SET progress=progress||'{"xBacklog":[{"query":"frozen","next":"opaque"}]}' WHERE control_source_id=${s.id}`;
  const [before]=await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${s.id}`;const p=(await preflightXReplacement(s.id,"redfox"))!;assert.equal(p.supported,false);
  await assert.rejects(switchXCollection(s.id,{target:"redfox",sourceVersion:p.sourceVersion,subscriptionVersion:p.subscriptionVersion,mappingVersion:1,reason:"must fail"},"test"),/积压/);
  assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${s.id}`)[0],before);
});

test("switching one native batch member fences its late material without blocking the remaining member",async()=>{
  const {createNativeBatch}=await import("@aihot/backend/sources/native-commands");
  const a=await source(),b=await source(),started=gate(),release=gate();
  const native=await stub(async()=>{started.open();await release.promise;return {tweets:[a,b].map(s=>({id_str:String(s.b+400n),tweet_created_at:new Date().toISOString(),full_text:"Synthetic delayed native page",user:{name:s.handle,screen_name:s.handle}})),next_cursor:null};});
  process.env.SOCIALDATA_BASE_URL=native.url;
  try {
    const run=await createNativeBatch([a.id,b.id],{actor:"test",key:tag(),shardKey:tag()});const pending=step(run.id);await started.promise;
    await switchTo(a.id,"redfox");const fresh=await createCollection(a.id,{actor:"test",key:tag(),reason:"schedule"});
    release.open();await pending;
    assert.equal((await row(run.id)).status,"completed");
    assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE control_source_id=${a.id}`)[0]!.active_run_id,fresh.id);
    assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id=${a.id}`)[0]!.n,0);
    assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id=${b.id}`)[0]!.n,1);
  } finally {release.open();await native.close();}
});

test("permission preflight uses current endpoint latest operation conclusion, not old or foreign denials",async()=>{
  const s=await source();const baseUrl=process.env.REDFOX_TEST_BASE_URL!;
  const evidence=async(endpoint:string,status:number)=>sql`INSERT INTO receipts(logical_key,service,model,purpose,status,request,response,received_at) VALUES
    (${tag()},'redfox.collect','API_1790148502632','synthetic','received',${sql.json({base:endpoint})},${sql.json({status,headers:{},body:JSON.stringify({code:status===200?2000:status})})},now())`;
  await evidence("http://127.0.0.1:1",403);assert.equal((await preflightXReplacement(s.id,"redfox"))!.supported,true);
  await evidence(baseUrl,403);assert.equal((await preflightXReplacement(s.id,"redfox"))!.checks.find(c=>c.key==="permission:API_1790148502632")!.conclusion,"unavailable");
  await evidence(baseUrl,200);assert.equal((await preflightXReplacement(s.id,"redfox"))!.supported,true);
});

test("a different stable item author cannot inherit page user or advance the formal cursor",async()=>{
  const s=await source();await sql`UPDATE collection_subscriptions SET config=${sql.json({query:`from:${s.handle}`})} WHERE control_source_id=${s.id}`;
  await switchTo(s.id,"redfox");const run=await createCollection(s.id,{actor:"test",key:tag(),reason:"schedule"});
  wrongAuthor=true;try{await drain(run.id);}finally{wrongAuthor=false;}
  assert.equal((await row(run.id)).status,"needs_review");assert.equal((await row(run.id)).progress.retainedReceiptIds.length,1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id=${s.id}`)[0]!.n,0);
  assert.equal((await sql`SELECT progress FROM collection_subscriptions WHERE control_source_id=${s.id}`)[0]!.progress.lastTweetId,String(s.b+100n));
});

test("query remains available while collection is disabled; new collect dispatch rolls back",async()=>{
  const {createTweetQuery}=await import("@aihot/backend/providers/redfox/queries");
  const s=await source();await switchTo(s.id,"redfox");
  process.env.COLLECT_ENABLED="false";
  try {
    const run=await createCollection(s.id,{actor:"test",key:tag(),reason:"manual",force:true}),before=hits;
    await step(run.id);assert.equal(hits,before);assert.equal((await row(run.id)).current_receipt_id,null);assert.equal((await row(run.id)).status,"waiting");
    const query=await createTweetQuery({tweetId:String(s.b+300n)},"test",tag());await step(query.id);
    assert.equal((await row(query.id)).status,"completed");assert.equal(hits,before+1);
    assert.equal((await sql`SELECT r.service FROM receipts r JOIN operation_results z ON z.receipt_id=r.id WHERE z.run_id=${query.id}`)[0]!.service,"redfox.query");
  } finally {process.env.COLLECT_ENABLED="true";}
});

test("a known material owned by another source is only discovered, never reassigned or rewritten",async()=>{
  const {upsertMaterial}=await import("@aihot/backend/content/materials");
  const s=await source(),owner=await source();
  const prior=await upsertMaterial({sourceId:owner.id,url:`https://x.com/${s.handle}/status/${s.b+300n}`,identityKey:`x:${s.b+300n}`,title:"Original owner title",bodyText:"Original owner body",bodyStatus:"ok",via:"fetch",raw:{ownerEvidence:true}});
  await switchTo(s.id,"redfox");const run=await createCollection(s.id,{actor:"test",key:tag(),reason:"schedule"});await drain(run.id);assert.equal((await row(run.id)).status,"completed");
  const [article]=await sql`SELECT source_id,title,raw FROM articles WHERE id=${prior.articleId}`;
  assert.equal(article!.source_id,owner.id);assert.equal(article!.title,"Original owner title");assert.deepEqual(article!.raw,{ownerEvidence:true});
  assert.equal((await sql`SELECT count(*)::int AS n FROM article_discoveries WHERE article_id=${prior.articleId} AND source_id=${s.id}`)[0]!.n,1);
});

test("nullable timeline handles reuse bound account evidence during outbound-disabled retained-page recovery",async()=>{
  const {createRun,saveResult,advanceRun}=await import("@aihot/backend/providers/operations/store");
  const s=await source();
  await sql`UPDATE collection_subscriptions SET config=${sql.json({query:`from:${s.handle}`})} WHERE control_source_id=${s.id}`;
  const accountResultId=await sql.begin(async(tx)=>{
    const accountRun=await createRun(tx,{actor:"test",commandKey:tag(),provider:"redfox",operationKey:"redfox.x.account",contractVersion:1,stepKey:"redfox.x.account",input:{mode:"query"}});
    const execution={runId:accountRun.id,stepVersion:1,generation:0};
    const resultId=await saveResult(tx,execution,{itemKey:`x:user:${s.uid}`,kind:"account",data:{userId:s.uid,username:s.handle,displayName:"Synthetic verified account"},sourceId:s.id});
    await advanceRun(tx,execution,null);return resultId;
  });
  await sql`UPDATE source_account_bindings SET evidence=${sql.json({kind:"result",reference:String(accountResultId)})} WHERE platform='x' AND id_kind='user_id' AND id_value=${s.uid}`;
  await switchTo(s.id,"redfox");
  const run=await createCollection(s.id,{actor:"test",key:tag(),reason:"schedule"});
  const frozen=(await row(run.id)).input,before=hits;
  nullableUser=true;singlePage=true;
  try {
    await step(run.id);
    const paused=await row(run.id),pageId=paused.progress.pageReceiptId;
    assert.equal(paused.current_receipt_id,null);assert.deepEqual(paused.progress.retainedReceiptIds,[pageId]);
    const [page]=await sql`SELECT response FROM receipts WHERE id=${pageId}`;
    assert.equal(JSON.parse(page!.response.body).data.user.username,null);
    await sql`UPDATE pgboss.job SET state='completed',completed_on=now() WHERE id=${paused.job_id}`;
    await sql`UPDATE operation_runs SET status='waiting',next_attempt_at=NULL WHERE id=${run.id}`;
    process.env.COLLECT_ENABLED="false";process.env.REDFOX_CALLS_ENABLED="false";delete process.env.REDFOX_API_KEY;
    await recoverFixture(run.id);
    const restored=await row(run.id);assert.equal(restored.status,"active");assert.notEqual(restored.job_id,paused.job_id);
    await drain(run.id);
    assert.equal((await row(run.id)).status,"completed");assert.equal(hits,before+1);
    assert.deepEqual((await row(run.id)).input,frozen);
    assert.deepEqual((await sql`SELECT response FROM receipts WHERE id=${pageId}`)[0]!.response,page!.response);
    const articles=await sql`SELECT author,x_post FROM articles WHERE source_id=${s.id}`;
    assert.equal(articles.length,2);assert.ok(articles.every(a=>a.author===s.handle && a.x_post.handle===s.handle));
    const results=await sql`SELECT provenance FROM operation_results WHERE run_id=${run.id} AND kind='article'`;
    assert.ok(results.every(r=>r.provenance.accountResultId===accountResultId && r.provenance.accountUserId===s.uid));
  } finally {nullableUser=false;singlePage=false;process.env.COLLECT_ENABLED="true";process.env.REDFOX_CALLS_ENABLED="true";process.env.REDFOX_API_KEY="synthetic";}
});
