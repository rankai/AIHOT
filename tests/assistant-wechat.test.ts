import { quoteLegacyTurn, submitLegacyTurn as submitTurn } from "./assistant-legacy-fixture.ts";
import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { config } from "@aihot/backend/config";
import { WECHAT_HOT_OPERATION as operationId, WECHAT_HOT_SOURCE, WechatHotInput } from "@aihot/backend/providers/redfox/wechat-hot-contract";
import { parseWechatHot } from "@aihot/backend/providers/redfox/wechat-hot";
import { redfoxBalanceObservation } from "@aihot/backend/providers/redfox/balance-observation";
import { createSynchronousQuery } from "@aihot/backend/providers/redfox/synchronous";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { resumeRun } from "@aihot/backend/providers/operations/store";
import { catalog, candidates, taskHint } from "@aihot/backend/assistant/catalog";
import { Binding, currentSkillVersions } from "@aihot/backend/assistant/bindings";
import { normalizeToolInput } from "@aihot/backend/users/tool-input";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { saveToolPrice, grantCredits } from "@aihot/backend/users/credits";
import { assertMemberCostEligible } from "@aihot/backend/users/member-pricing";
import { createSession, quoteTurn as currentQuoteTurn, submitTurn as currentSubmitTurn, sessionSnapshot } from "@aihot/backend/assistant/sessions";
import { decideCall, localCall, activeTools, autoApproveSearch } from "@aihot/backend/assistant/tools";
import { controlTurn } from "@aihot/backend/assistant/controls";
import { expireOperationResults } from "@aihot/backend/operations/result-retention";
import { recoverAssistantChildren } from "@aihot/backend/assistant/execution";
import { updateAssistantSkill, readSkillPolicies } from "@aihot/backend/assistant/skill-policy";
import { analyzeWechatResearch, wechatResearchResults } from "@aihot/backend/assistant/wechat-research";
import { contextTokens } from "@aihot/backend/assistant/context";
const parameters = { keyword: "职场,成长", startDate: "2026-10-26", endDate: "2026-11-02" };
const sample = (i:number) => ({ id:`sample-${i}`, title:`职场成长的${i}个方法`, author:"合成作者", summary:"先观察具体场景，再对照实际需求。".repeat(20), url:`https://mp.weixin.qq.com/s/sample${i}`, clicksCount:0, publicTime:"2026-11-01 12:00:00" });
const completion = (name:string,input:unknown) => ({id:"stub",created:1,model:"stub",choices:[{index:0,message:{role:"assistant",content:null,tool_calls:[{id:"call_0",type:"function",function:{name,arguments:JSON.stringify(input)}}]},finish_reason:"tool_calls"}]});
const draft = (ids:string[]) => ({title:"职场成长，从观察开始",body:"核心观点：从实际场景出发。\n\n"+"观察日常工作的问题，再选一个小改变并记录结果。".repeat(70),intent:"draft" as const,titles:["职场成长，从观察开始","先看场景再行动","给职场新人的建议"],tags:["职场","成长","观察","实践","经验"],sources:ids,partial:true,scope:"实际研究"});

test("fixed bindings preserve old identities, original six files and platform boundaries", async () => {
 const packages = await catalog(), current=await candidates("creative"), xhs=await candidates("xiaohongshu");
 assert.equal(current.filter(c=>c.skillId==="wechat-write").length,1);
 assert(xhs.every(c=>c.skillId==="xiaohongshu-creator"&&c.version===currentSkillVersions["xiaohongshu-creator"]));
 assert.equal((await candidates("xiaohongshu",null,{"xiaohongshu-creator":"2"})).length,2);
 assert.throws(()=>taskHint("xiaohongshu",{actionId:"wechat-write"}));
 const pack=packages.find(p=>p.manifest.skillId==="wechat-write")!;
 assert(!pack.manifest.modules[0]!.resources.some(r=>r.startsWith("archive")));
 const manifest=JSON.parse(await readFile(new URL("../docs/reviews/2026-11-01-wechat-skill-manifest.json",import.meta.url),"utf8"));
 for(const file of manifest.files){const bytes=await readFile(new URL(`../packages/backend/src/assistant/skills/wechat-write/upstream/${file.path}`,import.meta.url));assert.equal(bytes.length,file.bytes);assert.equal(createHash("sha256").update(bytes).digest("hex"),file.sha256);}
 const binding=JSON.parse(await readFile(new URL("../packages/backend/src/assistant/skills/wechat-write/binding.json",import.meta.url),"utf8"));
 assert.throws(()=>Binding.parse({...binding,url:"https://example.com"}));
 assert.throws(()=>Binding.parse({...binding,modules:[{...binding.modules[0],capabilities:["run-python@1"]}]}));
});
test("hot article contract distinguishes empty, malformed, unknown and true zero; bounded projection",()=>{
 assert.equal(WechatHotInput.parse({...parameters,keyword:"职场，成长,职场"}).keyword,"职场,成长");
 assert.equal([...WechatHotInput.parse({...parameters,keyword:"😀".repeat(200)}).keyword].length,200);
 for(const input of [{...parameters,keyword:"a,b,c,d,e,f"},{...parameters,keyword:"😀".repeat(201)},{...parameters,startDate:"2026-02-30"},{...parameters,source:"override"}])assert.throws(()=>WechatHotInput.parse(input));
 assert.equal(parseWechatHot({articles:[]},parameters)[0]!.data.rawCount,0);
 for(const raw of [{},null,{articles:{}},{articles:[null]}])assert.throws(()=>parseWechatHot(raw,parameters));
 const rows=parseWechatHot({articles:[sample(1),sample(1),{...sample(2),id:undefined},{summary:"no identity"},...Array.from({length:11},(_,i)=>sample(i+3))]},parameters);
 assert.equal(rows.length,11);assert.equal(rows[0]!.data.clicksCount,0);assert.equal(rows[0]!.data.likeCount,null);
 assert.equal(rows[0]!.data.publishTime,"2026-11-01 12:00:00");
 assert.equal(rows.at(-1)!.data.projectedCount,10);assert.equal(rows.at(-1)!.data.rawCount,15);assert.equal(rows.at(-1)!.data.deduplicatedCount,13);assert.equal(rows.at(-1)!.data.excludedCount,1);assert.equal(rows.at(-1)!.data.truncated,true);
});
test("analysis preserves the persisted excerpt when query metadata crosses the truncation threshold",async()=>{
 const activationId=randomUUID(),callId=randomUUID();
 const rows=parseWechatHot({articles:Array.from({length:10},(_,i)=>({...sample(i),summary:"观察问题，再记录实际行动和结果。".repeat(100)}))},parameters).map((row,i)=>({...row,id:i+1}));
 const articles=rows.filter(r=>r.kind==="wechat_hot_article");
 const metadata=rows.find(r=>r.kind==="wechat_hot_research")!;
 // A long but valid keyword makes the whole-query projection cross the next halving boundary.
 metadata.data.keyword="职场成长观察行动".repeat(25);
 const persisted=wechatResearchResults(rows),withoutMetadata=wechatResearchResults(articles);
 assert(persisted.results[0]!.text.length<withoutMetadata.results[0]!.text.length);
 const tx=(async()=>articles.map(row=>({...row,call_id:callId,input:{...parameters},call_result:persisted}))) as any;
 const ids=persisted.results.slice(0,2).map(r=>`search:${r.id}`),p={sampleIds:ids,observation:"接口没有给出互动数据，不能据此比较热度"};
 const result=await analyzeWechatResearch(tx,{id:randomUUID()},randomUUID(),{activationId,topic:"职场",samples:ids.map(sourceId=>({sourceId,relevance:"可见摘要与主题相关"})),titlePattern:p,openingPattern:p,structurePattern:p,languagePattern:p,interactionPattern:p,keywordPattern:p,applicationPlan:"使用场景结构",limitations:[]});
 for(const sample of result.samples){const shown=persisted.results.find(r=>`search:${r.id}`===sample.sourceId)!;assert.equal(sample.text,shown.text);assert.equal(sample.textTruncated,shown.textTruncated);}
});
test("wechat v1 accepted authorization recovery plus current single-task research delivery",async t=>{
 const [db]=await sql`SELECT current_database() name,inet_server_port() port`;assertConfiguredTestDatabase(db.name,db.port);
 const restore=await allowTestBudgetScope(["assistant.text","redfox.query"],"member");
 const previous=config.allowPrivateNetworkFetch, model=`wechat-${tag()}`;
 let hits=0, status=200, response:any={code:2000,data:{articles:[sample(1),sample(2)]}};
 const requests:any[]=[];let invalidDraft=true, invalidSearch=0, mode="normal";
 let reuse: any;
 const server=http.createServer((req,res)=>{let body="";req.on("data",c=>body+=c);req.on("end",()=>{hits++;requests.push({url:req.url,headers:req.headers,method:req.method,body:JSON.parse(body)});res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(response));});});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const supplier=await stub((_hit,req)=>{
  const request=JSON.parse(req.body),messages=request.messages.filter((m:any)=>m.role==="tool").map((m:any)=>JSON.parse(m.content));
  const loaded=messages.find((m:any)=>m.entry);
  if(!loaded)return completion("load_skill",{skillId:"wechat-write",moduleId:"write"});
  if(mode==="reuse") return completion("save_draft",{activationId:loaded.activationId,kind:"text-draft",artifactId:reuse.artifactId,baseVersion:reuse.version,
   content:{...draft(reuse.sources.map((s:any)=>s.id)),intent:"rewrite",titles:[],tags:[]},researchApplication:{analysisCallId:reuse.sources[0].research.analysisCallId,explanation:"复用选定研究稿的事实与场景结构"}});
  const searches=messages.filter((m:any)=>m.results),search=searches.at(-1);
  if(mode==="normal" && invalidSearch<2) return completion("search_wechat_articles",{activationId:loaded.activationId,...parameters,...(invalidSearch++===0?{keyword:"a,b,c,d,e,f"}:{startDate:"2026-02-30"})});
  if(mode==="maximum" && searches.length===1) return completion("search_wechat_articles",{activationId:loaded.activationId,...parameters,keyword:"补充成长"});
  if(!search){const clock=JSON.stringify(request.messages).match(/"today":"(\d{4}-\d{2}-\d{2})"/);return completion("search_wechat_articles",{activationId:loaded.activationId,...parameters,...(clock?{endDate:clock[1]}:{})});}
  const ids=search.results.map((r:any)=>`search:${r.id}`),analysis=messages.find((m:any)=>m.analysisCallId);
  if(!analysis){const p={sampleIds:ids,observation:mode==="maximum"?"标题先说明适用场景，摘要用具体问题引出行动，再交代观察和记录方法。接口没有给出互动数据，不能据此比较热度。".repeat(4):"接口没有给出互动数据，不能据此比较热度"};return completion("analyze_wechat_research",{activationId:loaded.activationId,topic:"职场成长",samples:ids.map((sourceId:string)=>({sourceId,relevance:"样本讨论职场成长与行动方法"})),titlePattern:p,openingPattern:p,structurePattern:p,languagePattern:p,interactionPattern:p,keywordPattern:p,applicationPlan:"以实际场景切入并说明行动方法",limitations:[]});}
  const activationId=invalidDraft?"not-a-uuid":loaded.activationId;invalidDraft=false;
  return completion("save_draft",{activationId,kind:"text-draft",baseVersion:0,content:draft(ids),researchApplication:{analysisCallId:analysis.analysisCallId,explanation:"以场景开头，并把行动方法用于本文核心论点"}});
 });
 const beforePolicy=(await sql`SELECT value FROM settings WHERE key='assistant.skills.wechat-write'`)[0];
 const beforeBudget=await sql`SELECT * FROM budgets WHERE service IN ('assistant.text','redfox.query')`;
 const advance=async(id:number)=>{const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,randomUUID());};
 try{
  Object.assign(process.env,{ASSISTANT_ENABLED:"true",ASSISTANT_CALLS_ENABLED:"true",ASSISTANT_MODEL_VERIFIED:"true",ASSISTANT_MODEL:"default",LLM_MODEL:model,LLM_BASE_URL:supplier.url+"/v1",LLM_API_KEY:"synthetic-key",ASSISTANT_TOKENIZER:"cl100k_base",MODEL_CALLS_ENABLED:"true",REDFOX_TEST_BASE_URL:`http://127.0.0.1:${(server.address() as {port:number}).port}`,REDFOX_API_KEY:"synthetic-key",REDFOX_CALLS_ENABLED:"true"});
  config.allowPrivateNetworkFetch=true;
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('assistant.text','redfox.query')`;
  await sql`DELETE FROM settings WHERE key='assistant.skills.wechat-write'`;
  assert.equal((await readSkillPolicies()).find(p=>p.skillId==="wechat-write")!.acceptingNew,false);
  await assert.rejects(normalizeToolInput("user:1","query",{provider:"redfox",operationId,parameters}),/不对前台用户开放/);
  const intent={kind:"query" as const,provider:"redfox",model:operationId,input:{operationId,parameters}};
  await assert.rejects(assertMemberCostEligible(intent),/成本尚未核定/);
  await sql`INSERT INTO service_prices(service,model,currency,per_request,source_url) VALUES ('redfox.query',${operationId},'CNY',0.001,'http://localhost/synthetic-fixture')`;
  await assert.rejects(assertMemberCostEligible(intent),/积分价格/);
  const [oldPrice]=await sql`SELECT id,version FROM member_tool_prices WHERE kind='query' AND provider='redfox' AND model=${operationId} AND parameter_match='{}'::jsonb`;
  await saveToolPrice({...(oldPrice?{id:oldPrice.id,expectedVersion:oldPrice.version}:{}),kind:"query",provider:"redfox",model:operationId,baseCredits:3,enabled:true,reason:"Synthetic local fixture"},"test");
  await saveToolPrice({kind:"assistant-turn",provider:"assistant",model,baseCredits:7,enabled:true,reason:"Synthetic local fixture"},"test");
  await updateAssistantSkill("wechat-write",{acceptingNew:true,expectedRevision:0,reason:"Synthetic local fixture"},"test");
  const user=await createSiteUser({username:`wechat_${tag()}`,displayName:"Wechat fixture",password:"synthetic-password"},"test");
  await grantCredits(user.id,{amount:100,reason:"Synthetic fixture"},"test",randomUUID());
  const session=await createSession(user.id,{assistantId:"creative"},randomUUID());
  const raw={message:"公众号职场成长文章，风格不提供",expectedRevision:1,skillSelection:{actionId:"wechat-write"}};
  const quote=await quoteTurn(user.id,session.sessionId,raw), turn=await submitTurn(user.id,session.sessionId,{...raw,quoteId:quote.quoteId},randomUUID());
  for(let i=0;i<8;i++)await advance(turn.runId);
  let snap=await sessionSnapshot(user.id,session.sessionId);
  assert.equal(snap.turn?.phase,"waiting_approval");assert.equal(hits,0);
  const call=snap.turn!.calls.find(c=>c.state==="proposed")!;
  const failedQueries=await sql`SELECT state,result,quote,child_run_id FROM assistant_tool_calls WHERE turn_id=${turn.turnId} AND name='search_wechat_articles' AND state='failed'`;
  assert.equal(failedQueries.length,2);
  for(const failed of failedQueries){assert.equal(failed.result.error,"invalid_tool_arguments");assert.equal(failed.quote,null);assert.equal(failed.child_run_id,null);}
  assert.equal((await sql`SELECT count(*)::int n FROM member_credit_charges WHERE root_run_id IN (SELECT child_run_id FROM assistant_tool_calls WHERE turn_id=${turn.turnId})`)[0]!.n,0);
  const [frozen]=await sql`SELECT * FROM assistant_turns WHERE id=${turn.turnId}`;
  const [activation]=await sql`SELECT id FROM assistant_activations WHERE turn_id=${turn.turnId}`;
  assert.equal(await sql.begin(tx=>autoApproveSearch(tx,{...frozen,snapshot:{...frozen!.snapshot,autoAuthorizationId:randomUUID()}},{name:"search_wechat_articles"} as any,{} as any)),false);
  assert(!(await sql.begin(tx=>activeTools(tx,frozen!))).tools.save_draft);
  await assert.rejects(sql.begin(tx=>localCall(tx,frozen!,{request_snapshot:{tools:{save_draft:{}}}},{name:"save_draft",input:{activationId:activation!.id,kind:"text-draft",baseVersion:0,content:draft(["current-message"]),researchApplication:{analysisCallId:randomUUID(),explanation:"伪造分析"}}})),/真实检索/);
  await updateAssistantSkill("wechat-write",{acceptingNew:false,expectedRevision:1,reason:"Fixture stop new admission"},"test");
  await assert.rejects(currentQuoteTurn(user.id,session.sessionId,raw));
  await decideCall(user.id,session.sessionId,call.callId,true,{proposalRevision:1},randomUUID());
  await decideCall(user.id,session.sessionId,call.callId,true,{proposalRevision:1},randomUUID());
  const [child]=await sql`SELECT child_run_id FROM assistant_tool_calls WHERE id=${call.callId}`;
  await advance(child!.child_run_id);await recoverAssistantChildren(child!.child_run_id);
  // Stop after the already-paid query completes, before its result is absorbed or analyzed.
  const beforeStop=await sessionSnapshot(user.id,session.sessionId);
  await controlTurn(user.id,session.sessionId,turn.turnId,"stop",{generation:beforeStop.turn!.generation});
  await sql`UPDATE operation_results SET created_at='2000-01-01'::timestamptz,expires_at='2000-01-31'::timestamptz WHERE run_id=${child!.child_run_id}`;
  await expireOperationResults(new Date("2000-02-01T00:00:00Z"));
  assert((await sql`SELECT kind FROM operation_results WHERE run_id=${child!.child_run_id}`).every(r=>r.kind!=="result_expired"));
  const stopped=await sessionSnapshot(user.id,session.sessionId),paidBeforeResume=await sql`SELECT id,amount FROM member_credit_charges WHERE user_id=${user.id} ORDER BY id`;
  await controlTurn(user.id,session.sessionId,turn.turnId,"resume",{generation:stopped.turn!.generation});
  assert.deepEqual(await sql`SELECT id,amount FROM member_credit_charges WHERE user_id=${user.id} ORDER BY id`,paidBeforeResume);
  assert.equal(hits,1);

  for(let i=0;i<5;i++)await advance(turn.runId);
  snap=await sessionSnapshot(user.id,session.sessionId);
  assert.equal(snap.turn?.status,"active");assert.equal(snap.artifacts.length,0);
  assert(snap.turn!.activities!.some(a=>a.kind==="save_draft"&&a.state==="failed"),"malformed model UUID remains readable and can be corrected");
  const [invalidCall]=await sql`SELECT input,result FROM assistant_tool_calls WHERE turn_id=${turn.turnId} AND name='save_draft' AND state='failed'`;
  assert.equal(invalidCall!.input.activationId,"not-a-uuid");assert.equal(invalidCall!.result.error,"invalid_tool_arguments");
  for(let i=0;i<2;i++)await advance(turn.runId);
  snap=await sessionSnapshot(user.id,session.sessionId);
  assert.equal(snap.turn?.status,"completed");assert.equal(snap.artifacts.length,1);assert.equal(snap.artifacts[0]!.kind,"text-draft");
  assert.match(snap.artifacts[0]!.content.body,/公众号爆款规律来源/);assert.equal(hits,1);
  assert.equal(requests[0].url,"/story/api/gzh/search/hotArticleNew");assert.equal(requests[0].method,"POST");assert.equal(requests[0].headers["x-api-key"],"synthetic-key");assert.equal(requests[0].headers.redfox_api_key,undefined);assert.equal(requests[0].body.source,WECHAT_HOT_SOURCE);
  const charges=await sql`SELECT amount,state FROM member_credit_charges WHERE root_run_id IN (${turn.runId},${child!.child_run_id})`;assert.deepEqual(charges.map(r=>r.amount).sort(),[3,7]);assert(charges.every(r=>r.state==="settled"));
  const [receipt]=await sql`SELECT model,attempts FROM receipts WHERE id=(SELECT receipt_id FROM operation_results WHERE run_id=${child!.child_run_id} LIMIT 1)`;assert.equal(receipt!.model,operationId);assert.equal(receipt!.attempts,1);
  assert(snap.turn!.activities!.some(activity=>activity.kind==="save_draft" && activity.artifactLabel==="公众号稿件"));
  await expireOperationResults(new Date("2000-02-01T00:00:00Z"));
  assert((await sql`SELECT kind FROM operation_results WHERE run_id=${child!.child_run_id}`).every(r=>r.kind==="result_expired"));
  assert((await sessionSnapshot(user.id,session.sessionId)).artifacts[0]!.sources.some(source=>source.research?.analysisCallId));

  await t.test("selected research draft accepts rewrite and keeps analysis without another search",async()=>{
   await updateAssistantSkill("wechat-write",{acceptingNew:true,expectedRevision:2,reason:"Continue synthetic regression"},"test");
   mode="reuse";reuse=snap.artifacts[0];
   const raw={message:"沿用已选研究改写",expectedRevision:snap.revision,artifactVersions:[{artifactId:reuse.artifactId,version:reuse.version}],skillSelection:{actionId:"wechat-write"}};
   const q=await quoteTurn(user.id,session.sessionId,raw),next=await submitTurn(user.id,session.sessionId,{...raw,quoteId:q.quoteId},randomUUID());
   for(let i=0;i<4;i++)await advance(next.runId);
   const saved=await sessionSnapshot(user.id,session.sessionId);
   assert.equal(saved.turn?.status,"completed");assert.equal(saved.artifacts[0]!.version,2);assert.equal(saved.artifacts[0]!.content.intent,"rewrite");
   assert.equal(saved.artifacts[0]!.sources[0]!.research!.analysisCallId,reuse.sources[0].research.analysisCallId);assert.equal(hits,1);
  });
  await t.test("two maximum queries plus admitted material fit actual frozen model requests",async()=>{
   mode="maximum";
   const sentence="当你面对复杂的工作任务时，先确认实际需求，再记录观察到的问题和团队反馈。不要急着照搬他人的经验，试着把目标拆成可以执行的小步骤，并根据结果调整下一步行动。";
   response={code:2000,data:{articles:Array.from({length:10},(_,i)=>({...sample(i),summary:sentence.repeat(40).slice(0,1500),title:"职场成长的方法与观察".repeat(40).slice(0,300),author:"合成案例作者".repeat(40).slice(0,200),clicksCount:null}))}};
   const fresh=await createSession(user.id,{assistantId:"creative"},randomUUID());
   const raw={message:"写公众号文章并补充一次研究。"+sentence.repeat(40),expectedRevision:1,skillSelection:{actionId:"wechat-write"}};
   const over={...raw,message:raw.message+sentence};
   await assert.rejects(currentQuoteTurn(user.id,fresh.sessionId,over),/减少材料.*明确选择/);
   for(const actionId of ["general-writing","xiaohongshu-rewrite"]) assert((await currentQuoteTurn(user.id,fresh.sessionId,{...over,skillSelection:{actionId}})).quoteId);
   assert.equal((await sql`SELECT count(*)::int n FROM assistant_turns WHERE session_id=${fresh.sessionId}`)[0]!.n,0,"admission checks and quotes create no paid turn");
   const q=await quoteTurn(user.id,fresh.sessionId,raw),next=await submitTurn(user.id,fresh.sessionId,{...raw,quoteId:q.quoteId},randomUUID());
   for(let query=0;query<2;query++){
    for(let i=0;i<(query===0?4:3);i++)await advance(next.runId);
    const current=await sessionSnapshot(user.id,fresh.sessionId),proposal=current.turn!.calls.find(c=>c.state==="proposed")!;
    assert(proposal);await decideCall(user.id,fresh.sessionId,proposal.callId,true,{proposalRevision:1},randomUUID());
    const [child]=await sql`SELECT child_run_id FROM assistant_tool_calls WHERE id=${proposal.callId}`;
    await advance(child!.child_run_id);await recoverAssistantChildren(child!.child_run_id);
   }
   for(let i=0;i<5;i++)await advance(next.runId);
   const saved=await sessionSnapshot(user.id,fresh.sessionId);
   const queries=await sql`SELECT result,child_run_id FROM assistant_tool_calls WHERE turn_id=${next.turnId} AND name='search_wechat_articles'`;
   assert.equal(queries.length,2);for(const query of queries){assert.equal(query.result.results.length,10);assert(query.result.results.every((r:any)=>r.textTruncated));
    const stored=await sql`SELECT data FROM operation_results WHERE run_id=${query.child_run_id} AND kind='wechat_hot_article'`;assert(stored.every(r=>r.data.text.length===1500));}
   const steps=await sql`SELECT request_snapshot FROM assistant_model_steps WHERE turn_id=${next.turnId}`;
   const tokenCounts=steps.map(step=>contextTokens(JSON.stringify(step.request_snapshot))+256);
   t.diagnostic(`maximum article request tokens: ${Math.max(...tokenCounts)}/24000`);
   const [frozen]=await sql`SELECT snapshot FROM assistant_turns WHERE id=${next.turnId}`;
   assert(contextTokens(JSON.stringify(frozen!.snapshot))>=3800 && contextTokens(JSON.stringify(frozen!.snapshot))<=4000);
   t.diagnostic(`admitted frozen material snapshot tokens: ${contextTokens(JSON.stringify(frozen!.snapshot))}/4000`);
   for(const step of steps){assert(contextTokens(JSON.stringify(step.request_snapshot))+256<=24000);assert(!step.request_snapshot.system.includes("用户明确M1"));}
   assert.equal(saved.turn?.status,"completed");
   const [analysis]=await sql`SELECT result FROM assistant_tool_calls WHERE turn_id=${next.turnId} AND name='analyze_wechat_research'`;
   for(const sample of analysis!.result.samples){const query=queries.find(q=>q.result.results.some((r:any)=>`search:${r.id}`===sample.sourceId));
    const shown=query!.result.results.find((r:any)=>`search:${r.id}`===sample.sourceId);assert.equal(sample.text,shown.text);assert.equal(sample.textTruncated,shown.textTruncated);}
   assert.match(analysis!.result.limitations.join("；"),/互动缺失为未知/);assert(analysis!.result.samples.every((s:any)=>s.clicksCount===null));
  });
  let failedRunId: number | null = null;
  for(const failure of [{status:429,code:4004},{status:500,code:5000},{status:503,code:4004},{status:200,code:4004},{status:200,code:3210}])await t.test(`rejected ${failure.status}/${failure.code} never retries`,async()=>{
   status=failure.status;response={code:failure.code,data:{cashierUrl:"https://must-not-display.invalid",amount:99}};
   const run=await createSynchronousQuery({operationId,parameters},"test",tag());await advance(run.id);
   const [r]=await sql`SELECT * FROM operation_runs WHERE id=${run.id}`;assert.equal(r!.status,"needs_review");const before=hits;
   await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:r!.step_version,generation:r!.generation}));await advance(run.id);assert.equal(hits,before);
   const [attempt]=await sql`SELECT attempts FROM receipts WHERE id=${r!.current_receipt_id}`;assert.equal(attempt!.attempts,1);
   failedRunId=run.id;
  });
  const balance=await redfoxBalanceObservation();assert.equal(balance?.runId,failedRunId);assert.equal(balance?.parentTurnId,null);
  status=200;response={code:2000,data:{articles:[sample(3)]}};
  const healthy=await createSynchronousQuery({operationId,parameters},"test",tag());await advance(healthy.id);
  assert.equal(await redfoxBalanceObservation(),null);
  await t.test("balance observation skips absent or malformed legacy attempt evidence",async()=>{
   const [receipt]=await sql`SELECT p.* FROM receipts p JOIN operation_results z ON z.receipt_id=p.id WHERE z.run_id=${healthy.id} LIMIT 1`;
   const attempts=await sql`SELECT id,response FROM receipt_attempts WHERE receipt_id=${receipt!.id}`;
   try{
    await sql`UPDATE receipt_attempts SET response=NULL WHERE receipt_id=${receipt!.id}`;
    await sql`UPDATE receipts SET attempts=attempts+1 WHERE id=${receipt!.id}`;
    const [evidence]=await sql`SELECT coalesce(a.response, CASE WHEN p.attempts=a.attempt THEN p.response END) AS response FROM receipt_attempts a JOIN receipts p ON p.id=a.receipt_id WHERE p.id=${receipt!.id}`;
    assert.equal(evidence!.response,null,"main receipt belongs to a later attempt and cannot supply evidence");
    assert.equal((await redfoxBalanceObservation())?.runId,failedRunId);
    for(const response of [null,"legacy",{status:200,body:"invalid json"}]){
     await sql`UPDATE receipt_attempts SET response=${sql.json(response)} WHERE receipt_id=${receipt!.id}`;
     assert.equal((await redfoxBalanceObservation())?.runId,failedRunId);
    }
   }finally{
    await sql`UPDATE receipts SET attempts=${receipt!.attempts} WHERE id=${receipt!.id}`;
    for(const attempt of attempts)await sql`UPDATE receipt_attempts SET response=${attempt.response===null?null:sql.json(attempt.response)} WHERE id=${attempt.id}`;
   }
  });
  await t.test("current wechat task researches, analyzes and delivers with one frozen charge",async()=>{
   mode='normal';invalidSearch=2;invalidDraft=false;const beforeCurrentQueries=hits;
   await sql`UPDATE operation_runs SET created_at=now()-interval '2 minutes' WHERE actor=${`user:${user.id}`}`;
   const fresh=await createSession(user.id,{assistantId:'creative'},randomUUID()),raw={message:'研究职场成长并写公众号文章',expectedRevision:1,skillSelection:{actionId:'wechat-write'}};
   const q=await currentQuoteTurn(user.id,fresh.sessionId,raw);assert(q.task);assert.equal(q.amount,13);
   const run=await currentSubmitTurn(user.id,fresh.sessionId,{...raw,quoteId:q.quoteId},randomUUID());
   let result:any;
   for(let i=0;i<30;i++){
    result=await sessionSnapshot(user.id,fresh.sessionId);if(result.turn.status==='completed')break;
    assert.notEqual(result.turn.phase,'waiting_approval');assert.notEqual(result.turn.status,'needs_review');
    const call=result.turn.calls.find((c:any)=>c.state==='running');const [child]=call?await sql`SELECT status FROM operation_runs WHERE id=${call.childRunId}`:[];
    await advance(child&&['active','waiting'].includes(child.status)?call.childRunId:run.runId);
   }
   assert.equal(result.turn.status,'completed');assert.equal(result.artifacts.length,1);assert.equal(hits,beforeCurrentQueries+1);
   const [charge]=await sql`SELECT id,amount,consumed,released FROM member_credit_charges WHERE root_run_id=${run.runId}`;assert.deepEqual([charge!.amount,charge!.consumed,charge!.released],[13,10,3]);
   const [ledger]=await sql`SELECT count(*)::int n FROM member_credit_entries WHERE charge_id=${charge!.id} AND kind='reserve'`;assert.equal(ledger!.n,1);
  });
 }finally{
  if(beforePolicy)await sql`UPDATE settings SET value=${sql.json(beforePolicy.value)} WHERE key='assistant.skills.wechat-write'`;else await sql`DELETE FROM settings WHERE key='assistant.skills.wechat-write'`;
  await sql`DELETE FROM service_prices WHERE service='redfox.query' AND model=${operationId}`;
  await sql`UPDATE member_tool_prices SET enabled=false WHERE model IN (${model},${operationId})`;
  for(const b of beforeBudget)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;
  config.allowPrivateNetworkFetch=previous;process.env.REDFOX_CALLS_ENABLED="false";process.env.MODEL_CALLS_ENABLED="false";
  await supplier.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await restore();await stopBoss();await closeDb();
 }
});

const quoteTurn=(userId:number,sessionId:string,raw:unknown)=>quoteLegacyTurn(userId,sessionId,raw,{"wechat-write":"1"});
