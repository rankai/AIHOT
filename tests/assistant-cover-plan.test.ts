import { quoteLegacyTurn, submitLegacyTurn as submitTurn } from "./assistant-legacy-fixture.ts";
import { allowTestBudgetScope,assertConfiguredTestDatabase,stub,tag } from "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import http from "node:http";
import sharp from "sharp";
import { sql,closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits,saveToolPrice } from "@aihot/backend/users/credits";
import { createSession,sessionSnapshot,snapshotInput,editArtifact } from "@aihot/backend/assistant/sessions";
import { decideCall, prepareCall } from "@aihot/backend/assistant/tools";
import { skillAdmission } from "@aihot/backend/assistant/skill-policy";
import { answerTurn } from "@aihot/backend/assistant/controls";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { XHS_COVER_OPERATION } from "@aihot/backend/providers/redfox/xhs-cover-contract";
import { contextTokens } from "@aihot/backend/assistant/context";
import { expireOperationResults } from "@aihot/backend/operations/result-retention";
import { readFile } from "node:fs/promises";
const completion=(name:string,input:unknown)=>({id:"stub",created:1,model:"stub",choices:[{index:0,message:{role:"assistant",content:null,tool_calls:[{id:"call_0",type:"function",function:{name,arguments:JSON.stringify(input)}}]},finish_reason:"tool_calls"}]});
const scheme=(i:number,sourceIds:string[])=>({schemeId:`scheme-${i}`,name:`设计方向${i}`,layout:"标题放上方，主体居中，留出适当空白。",palette:"暖橙与米白",prompt:`方案${i}：竖版3:4封面，暖橙米白背景，标题“观察与行动”，主体居中，文字清晰。`,aspectRatio:"3:4",sourceIds});
test("formal v4 cover workflow reads the full rules, researches real images, saves plans and separately approves the exact chosen image",async t=>{
 const [db]=await sql`SELECT current_database() name,inet_server_port() port`;assertConfiguredTestDatabase(db!.name,db!.port);
 const services=["assistant.text","assistant.vision","redfox.query","redfox.image","redfox.poll"],budgets=await sql`SELECT * FROM budgets WHERE service IN ${sql(services)}`,restore=await allowTestBudgetScope(services,"member");
 const priorPolicy=(await sql`SELECT * FROM settings WHERE key='assistant.skills.xiaohongshu-creator'`)[0],oldPrices=await sql`SELECT * FROM member_tool_prices WHERE (kind='images' AND model='gptImage2') OR (kind='query' AND model=${XHS_COVER_OPERATION})`,oldCosts=await sql`SELECT * FROM service_prices WHERE service='redfox.query' AND model=${XHS_COVER_OPERATION}`;
 const model=`cover-plan-${tag()}`,oldPrivate=config.allowPrivateNetworkFetch;config.allowPrivateNetworkFetch=true;
 let historical:any=null;let rich=false,count=1,next="choose",queries=0,visions=0,submits=0,polls=0,imageDownloads=0;const textRequests:any[]=[],imageRequests:any[]=[];
 const png=await sharp({create:{width:900,height:1200,channels:3,background:"orange"}}).png().toBuffer();
 const server=http.createServer((req,res)=>{let body="";req.on("data",c=>body+=c);req.on("end",()=>{
  if(req.url!.startsWith("/cover/")||req.url==="/output.png"){imageDownloads++;res.writeHead(200,{"content-type":"image/png"});res.end(png);return;}
  let data:any;
  if(req.url!.startsWith("/story/api/cozeSkill/getXhsCozeSkillData")){queries++;data={lowPowderExplosiveArticle:Array.from({length:count},(_,i)=>({photoId:rich?String(i).padStart(200,"x"):`note-${i}`,title:rich?"生活观察与行动方法".repeat(30):`生活里的观察${i}`,desc:"从具体生活场景出发，记录观察与行动。".repeat(rich?100:1),authorName:rich?"合成作者".repeat(30):"合成作者",fans:i===0?0:undefined,coverUrl:`${process.env.REDFOX_TEST_BASE_URL}/cover/${queries}/${i}`,useLikeCount:i,publicTime:"2026-11-02"})),likeTheTop500:[],singleDayIncrements:[],sevenDaysOfIncrements:[]};}
  else if(req.url!.endsWith("gptImage2Submit")){submits++;const input=JSON.parse(body);imageRequests.push(input);data={taskId:`image-${submits}`};}
  else {polls++;const input=JSON.parse(body);data={taskId:input.taskId,status:"completed",imageUrls:[`${process.env.REDFOX_TEST_BASE_URL}/output.png`]};}
  res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({code:2000,data}));
 });});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const modelStub=await stub((_hit,req)=>{
  const request=JSON.parse(req.body),content=request.messages[0]?.content;
  if(Array.isArray(content)&&content.some((c:any)=>c.type==="image_url")){
   visions++;const ids=content.filter((c:any)=>c.type==="text"&&c.text.startsWith("sourceId: ")).map((c:any)=>c.text.slice(10));
   return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({observations:ids.map((sourceId:string)=>({sourceId,status:"observed",text:"",subject:rich?"画面中央为暖橙色主体，边缘保留大面积空白。".repeat(15):"暖橙色画面",colors:rich?"主色暖橙，背景为米白，整体对比柔和。".repeat(15):"橙色",layout:rich?"主体位于中间，顶部留白可用于标题，底部用于辅助信息。".repeat(15):"纯色背景",uncertainties:["没有可读文字"]}))})}}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}};
  }
  textRequests.push(request);const messages=request.messages.filter((m:any)=>m.role==="tool").map((m:any)=>JSON.parse(m.content)),loaded=messages.find((m:any)=>m.entry);
  if(!loaded)return completion("load_skill",{skillId:"xiaohongshu-creator",moduleId:"M4"});
  if(!messages.some((m:any)=>m.text?.includes("封面")))return completion("read_skill_reference",{activationId:loaded.activationId,resourceId:"core-workflow"});
  if(historical)return completion("save_xhs_cover_plan",{activationId:loaded.activationId,artifactId:historical.artifactId,baseVersion:historical.version,title:"历史方案修订",summary:"沿用所选历史版本冻结的研究范围，调整方案文案。",schemes:historical.content.coverPlan.schemes,next:"plans-only"});
  const query=messages.find((m:any)=>m.metadata?.operationId===XHS_COVER_OPERATION),vision=messages.find((m:any)=>m.reportId),plan=messages.find((m:any)=>m.kind==="xhs-cover-plan");
  if(!query)return completion("search_xhs_covers",{activationId:loaded.activationId,keyword:"生活,观察",startDate:JSON.parse(request.messages[0].content.slice(request.messages[0].content.indexOf("{"))).researchClock?.earliestDate??"2026-10-04"});
  if(!vision)return completion("analyze_xhs_covers",{activationId:loaded.activationId,samples:query.results.slice(0,20).map((r:any)=>({sourceId:r.sourceId,reason:"与主题有关"}))});
  if(!plan)return completion("save_xhs_cover_plan",{activationId:loaded.activationId,baseVersion:0,title:"生活观察封面",summary:"依据实际可见封面整理色调与留白；样本中没有可读文字，标题为本次创意设计。",schemes:[1,2,3].map(i=>scheme(i,vision.observations.filter((o:any)=>o.status==="observed").map((o:any)=>o.sourceId))),next});
  return completion("generate_image",{activationId:loaded.activationId,title:"模型原错误标题",prompt:"模型原错误提示词",size:"1:1",planReference:{artifactId:plan.artifactId,version:plan.version,schemeId:"scheme-2"}});
 });
 const advance=async(id:number)=>{await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${id} AND next_attempt_at IS NOT NULL`;const [r]=await sql`SELECT step_version,job_id FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,r!.job_id??randomUUID());};
 try{
  Object.assign(process.env,{ASSISTANT_ENABLED:"true",ASSISTANT_CALLS_ENABLED:"true",ASSISTANT_MODEL_VERIFIED:"true",ASSISTANT_MODEL:"default",ASSISTANT_COVER_VISION_MODEL:"default",LLM_MODEL:model,LLM_VISION:"true",LLM_BASE_URL:modelStub.url+"/v1",LLM_API_KEY:"synthetic-key",ASSISTANT_TOKENIZER:"cl100k_base",MODEL_CALLS_ENABLED:"true",REDFOX_TEST_BASE_URL:`http://127.0.0.1:${(server.address() as {port:number}).port}`,REDFOX_API_KEY:"synthetic-key",REDFOX_CALLS_ENABLED:"true"});
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ${sql(services)}`;
  await sql`INSERT INTO settings(key,value,updated_by) VALUES ('assistant.skills.xiaohongshu-creator','{"acceptingNew":true,"revision":1}','test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
  await sql`DELETE FROM service_prices WHERE service='redfox.query' AND model=${XHS_COVER_OPERATION}`;
  await sql`INSERT INTO service_prices(service,model,currency,per_request,source_url) VALUES ('redfox.query',${XHS_COVER_OPERATION},'CNY',0.001,'http://localhost/synthetic-cover')`;
  await sql`INSERT INTO service_prices(service,model,currency,input_per_mtok,output_per_mtok,source_url) VALUES ('llm',${model},'CNY',1,2,'http://localhost/synthetic-vision')`;
  const setPrice=async(kind:string,provider:string,name:string,amount:number,tier="",parameterMatch={})=>{const existing=(await sql`SELECT id,version FROM member_tool_prices WHERE kind=${kind} AND provider=${provider} AND model=${name} AND tier=${tier} AND parameter_match=${sql.json(parameterMatch)}`)[0];return saveToolPrice({...(existing?{id:existing.id,expectedVersion:existing.version}:{}),kind,provider,model:name,tier,parameterMatch,baseCredits:amount,enabled:true,reason:"Synthetic cover plan fixture"},"test");};
  await setPrice("assistant-turn","assistant",model,7);await setPrice("assistant-vision","assistant",model,11);await setPrice("query","redfox",XHS_COVER_OPERATION,3);await setPrice("images","redfox","gptImage2",13,"1k",{n:1});
  const user=await createSiteUser({username:`coverplan_${tag()}`,displayName:"Cover plan",password:"synthetic-password"},"test");await grantCredits(user.id,{amount:1000,reason:"Cover plan fixture"},"test",randomUUID());
  async function start(message="请研究并设计生活观察主题封面"){
   await sql`UPDATE operation_runs SET created_at=now()-interval '2 minutes' WHERE actor=${`user:${user.id}`} AND status IN ('completed','failed')`;
   const {sessionId}=await createSession(user.id,{assistantId:"xiaohongshu"},randomUUID()),raw={message,expectedRevision:1,skillSelection:{actionId:"xiaohongshu-cover"}};
   const quote=await quoteTurn(user.id,sessionId,raw);assert.deepEqual(quote.additionalFeeKinds,["search","image","vision"]);
   const turn=await submitTurn(user.id,sessionId,{...raw,quoteId:quote.quoteId},randomUUID());return {sessionId,...turn};
  }
  async function reach(x:Awaited<ReturnType<typeof start>>){
   for(let n=0;n<50;n++){
    const snapshot=await sessionSnapshot(user.id,x.sessionId);if(snapshot.turn?.phase==="waiting_approval"||snapshot.turn?.phase==="waiting_question"||snapshot.turn?.status==="completed")return snapshot;
    if(snapshot.turn?.status==="needs_review")throw new Error(JSON.stringify((await sql`SELECT wait_reason FROM operation_runs WHERE id=${x.runId}`)[0])+JSON.stringify((await sql`SELECT request_snapshot FROM assistant_model_steps WHERE turn_id=${x.turnId} ORDER BY model_ordinal`).map(r=>contextTokens(JSON.stringify(r.request_snapshot))+256)));
    const child=snapshot.turn?.calls.find(c=>c.state==="running"&&c.childRunId);if(child){const [r]=await sql`SELECT status FROM operation_runs WHERE id=${child.childRunId!}`;if(["active","waiting"].includes(r!.status))await advance(child.childRunId!);else await advance(x.runId);}else await advance(x.runId);
   }throw new Error("flow did not reach a boundary: "+JSON.stringify(await sql`SELECT status,step_key,wait_reason,step_version FROM operation_runs WHERE id=${x.runId}`)+JSON.stringify(await sql`SELECT name,state FROM assistant_tool_calls WHERE turn_id=${x.turnId}`));
  }
  async function approve(x:Awaited<ReturnType<typeof start>>,name:string){const snapshot=await reach(x),call=snapshot.turn!.calls.find(c=>c.name===name&&c.state==="proposed")!;assert(call,JSON.stringify(snapshot.turn));await decideCall(user.id,x.sessionId,call.callId,true,{proposalRevision:call.proposalRevision},randomUUID());return call;}
  await sql`UPDATE member_tool_prices SET enabled=false WHERE kind='assistant-vision' AND model=${model}`;
  const writing=await skillAdmission(sql,"xiaohongshu",{skillId:"xiaohongshu-creator"});assert(writing.candidates.some(c=>c.moduleId==="M2"));assert(!writing.candidates.some(c=>c.moduleId==="M4"));
  await sql`UPDATE member_tool_prices SET enabled=true WHERE kind='assistant-vision' AND model=${model}`;
  const x=await start();await approve(x,"search_xhs_covers");await approve(x,"analyze_xhs_covers");const waiting=await reach(x);
  assert.equal(waiting.turn!.phase,"waiting_question");const artifact=waiting.artifacts.find(a=>a.kind==="xhs-cover-plan")!;assert(artifact);assert.equal(artifact.content.coverPlan!.schemes.length,3);assert.equal(artifact.content.coverPlan!.evidence.observedCount,1);assert.equal(artifact.content.coverPlan!.evidence.samples[0]!.fans,0);
  await sql`UPDATE operation_results SET expires_at=now()-interval '1 day' WHERE run_id IN (SELECT child_run_id FROM assistant_tool_calls WHERE turn_id=${x.turnId})`;
  await expireOperationResults();assert((await sql`SELECT kind FROM operation_results WHERE run_id IN (SELECT child_run_id FROM assistant_tool_calls WHERE turn_id=${x.turnId})`).every(r=>r.kind!=="result_expired"));
  const question=waiting.turn!.question!,choice={artifactId:artifact.artifactId,version:artifact.version,action:"generate",schemeId:"scheme-2"};
  await assert.rejects(answerTurn(user.id,x.sessionId,x.turnId,{questionId:question.questionId,expectedRevision:waiting.revision,answer:"旧版本",choice:{...choice,version:2}}),/版本不一致/);
  await sql`UPDATE member_tool_prices SET enabled=false WHERE kind='images' AND model='gptImage2'`;
  assert.equal((await skillAdmission(sql,"xiaohongshu",{actionId:"xiaohongshu-cover"})).candidates.length,1);
  assert.equal((await sessionSnapshot(user.id,x.sessionId)).turn!.question!.coverPlan!.imageAvailable,false);
  await assert.rejects(answerTurn(user.id,x.sessionId,x.turnId,{questionId:question.questionId,expectedRevision:waiting.revision,answer:"选择方案2",choice}),/暂不可用/);
  await sql`UPDATE member_tool_prices SET enabled=true WHERE kind='images' AND model='gptImage2' AND tier='1k' AND parameter_match='{"n":1}'::jsonb`;assert.equal((await sessionSnapshot(user.id,x.sessionId)).turn!.question!.coverPlan!.imageAvailable,true);
  await answerTurn(user.id,x.sessionId,x.turnId,{questionId:question.questionId,expectedRevision:waiting.revision,answer:"选择方案2",choice});
  const after=await sessionSnapshot(user.id,x.sessionId);await answerTurn(user.id,x.sessionId,x.turnId,{questionId:question.questionId,expectedRevision:after.revision,answer:"再次选择方案2",choice});
  await assert.rejects(answerTurn(user.id,x.sessionId,x.turnId,{questionId:question.questionId,expectedRevision:after.revision,answer:"另选方案",choice:{...choice,schemeId:"scheme-1"}}),/不同答案/);
  const [frozen]=await sql`SELECT * FROM assistant_turns WHERE id=${x.turnId}`,[activation]=await sql`SELECT id FROM assistant_activations WHERE turn_id=${x.turnId}`;
  await assert.rejects(prepareCall(frozen!,{name:"generate_image",input:{activationId:activation!.id,title:"封面",prompt:"模型误指方案",planReference:{artifactId:artifact.artifactId,version:artifact.version,schemeId:"scheme-1"}}}),(e:any)=>e.result?.error==="invalid_tool_arguments");
  assert.equal(submits,0);
  const imageCall=await approve(x,"generate_image");assert.equal(imageCall.imageParameters!.prompt,scheme(2,[]).prompt);assert.equal(imageCall.imageParameters!.size,"3:4");
  const done=await reach(x);assert.equal(done.turn!.status,"completed");const imageArtifact=done.artifacts.find(a=>a.kind==="image")!;assert.equal(imageArtifact.content.prompt,scheme(2,[]).prompt);assert.deepEqual(imageArtifact.content.planReference,{artifactId:artifact.artifactId,version:1,schemeId:"scheme-2"});assert(imageArtifact.content.fileKey);
  assert.equal(submits,1);assert.equal(queries,1);assert.equal(visions,1);assert.equal(imageRequests[0].size,"3:4");assert.equal(imageRequests[0].resolution,"1k");assert.equal(imageRequests[0].n,1);assert.deepEqual(imageRequests[0].referenceImages,[]);assert.equal(imageRequests[0].prompt,scheme(2,[]).prompt);
  const core=await readFile(new URL("../packages/backend/src/assistant/skills/xiaohongshu-creator-v4/references/core_workflow.md",import.meta.url),"utf8");assert(textRequests.some(r=>JSON.stringify(r).includes(core.replaceAll("\n","\\n"))||r.messages.some((m:any)=>m.role==="tool"&&JSON.parse(m.content).text===core)));
  const requests=await sql`SELECT request_snapshot FROM assistant_model_steps WHERE turn_id=${x.turnId}`;const tokens=requests.map(r=>contextTokens(JSON.stringify(r.request_snapshot))+256);assert(tokens.every(n=>n<=24000));t.diagnostic(`cover parent calls=${requests.length}, maxTokens=${Math.max(...tokens)}`);
  const charges=await sql`SELECT c.state,c.amount,c.consumed FROM member_credit_charges c JOIN member_credit_run_links l ON l.charge_id=c.id WHERE l.run_id=${x.runId} OR l.run_id IN (SELECT child_run_id FROM assistant_tool_calls WHERE turn_id=${x.turnId})`;assert.equal(charges.length,4);assert(charges.every(c=>c.state==="settled"&&c.consumed===c.amount));
  await t.test("expired research remains usable only through an explicitly selected owned plan version",async()=>{
   await expireOperationResults();assert((await sql`SELECT kind FROM operation_results WHERE run_id=${artifact.content.coverPlan!.evidence.visionRunId} AND id=${artifact.content.coverPlan!.evidence.reportId}`)[0]!.kind==="result_expired");
   const state=await sessionSnapshot(user.id,x.sessionId);assert.deepEqual(state.artifacts.find(a=>a.artifactId===artifact.artifactId)!.content.coverPlan,artifact.content.coverPlan);
   await assert.rejects(editArtifact(user.id,x.sessionId,artifact.artifactId,{baseVersion:1,kind:"text-draft",content:{title:"覆盖",body:"正文",intent:"draft",titles:[],tags:[],sources:[]}}));
   const raw={message:"调整选定历史方案的文案，只要方案",expectedRevision:state.revision,skillSelection:{actionId:"xiaohongshu-cover"},artifactVersions:[{artifactId:artifact.artifactId,version:1}]};
   const snapshot=await snapshotInput(sql,user.id,x.sessionId,raw);assert(!JSON.stringify(snapshot.snapshot.selected).includes("sha256"));
   historical=artifact;const beforeQueries=queries,beforeVisions=visions;await sql`UPDATE operation_runs SET created_at=now()-interval '2 minutes' WHERE actor=${`user:${user.id}`} AND status='completed'`;
   const quote=await quoteTurn(user.id,x.sessionId,raw),turn=await submitTurn(user.id,x.sessionId,{...raw,quoteId:quote.quoteId},randomUUID());const done=await reach({sessionId:x.sessionId,...turn});
   assert.equal(done.turn!.status,"completed");const revised=done.artifacts.find(a=>a.artifactId===artifact.artifactId)!;assert.equal(revised.version,2);assert.deepEqual(revised.content.coverPlan!.evidence,artifact.content.coverPlan!.evidence);assert.equal(queries,beforeQueries);assert.equal(visions,beforeVisions);historical=null;
  });
  await t.test("keep plans settles the original parent without another model call",async()=>{
   const y=await start();await approve(y,"search_xhs_covers");await approve(y,"analyze_xhs_covers");const state=await reach(y),q=state.turn!.question!,plan=q.coverPlan!;
   const before=textRequests.length;await answerTurn(user.id,y.sessionId,y.turnId,{questionId:q.questionId,expectedRevision:state.revision,answer:"只保留方案",choice:{artifactId:plan.artifactId,version:plan.version,action:"keep-plans"}});
   assert.equal((await sessionSnapshot(user.id,y.sessionId)).turn!.status,"completed");assert.equal(textRequests.length,before);assert.equal(submits,1);
  });
  await t.test("declining optional image delivers the saved plans without image spending",async()=>{
   const y=await start();await approve(y,"search_xhs_covers");await approve(y,"analyze_xhs_covers");const state=await reach(y),q=state.turn!.question!,plan=q.coverPlan!;
   await answerTurn(user.id,y.sessionId,y.turnId,{questionId:q.questionId,expectedRevision:state.revision,answer:"选择方案2",choice:{artifactId:plan.artifactId,version:plan.version,schemeId:"scheme-2",action:"generate"}});
   const proposal=await reach(y),call=proposal.turn!.calls.find(c=>c.name==="generate_image")!;await decideCall(user.id,y.sessionId,call.callId,false,{proposalRevision:call.proposalRevision},randomUUID());
   assert.equal((await reach(y)).turn!.status,"completed");assert.equal(submits,1);
   const [delivery]=await sql`SELECT data FROM operation_results WHERE run_id=${y.runId} AND kind='assistant_delivery'`;assert.equal(delivery!.data.artifactId,plan.artifactId);
  });
  await t.test("twenty images and near-admission material retain full rules within the parent limit",async()=>{
   rich=true;count=20;next="choose";const beforeVisions=visions;
   // Keep material at 90–95% of admission capacity, leaving room for random identities and local ports.
   const y=await start("只要封面方案。"+"观察具体生活场景，记录行动与结果，再选择适合自己的表达方式。".repeat(105));
   const [initial]=await sql`SELECT snapshot FROM assistant_turns WHERE id=${y.turnId}`;const admitted=contextTokens(JSON.stringify(initial!.snapshot));assert(admitted>=3600&&admitted<=3800);
   await approve(y,"search_xhs_covers");await approve(y,"analyze_xhs_covers");const waiting=await reach(y),q=waiting.turn!.question!,p=q.coverPlan!;await answerTurn(user.id,y.sessionId,y.turnId,{questionId:q.questionId,expectedRevision:waiting.revision,answer:"选择方案2",choice:{artifactId:p.artifactId,version:p.version,schemeId:"scheme-2",action:"generate"}});const proposal=await reach(y),call=proposal.turn!.calls.find(c=>c.name==="generate_image")!;await decideCall(user.id,y.sessionId,call.callId,false,{proposalRevision:call.proposalRevision},randomUUID());const done=await reach(y);assert.equal(done.turn!.status,"completed");assert.equal(visions-beforeVisions,4);
   const plan=done.artifacts.find(a=>a.kind==="xhs-cover-plan")!.content.coverPlan!;assert.equal(plan.evidence.observedCount,20);assert(plan.evidence.samples.every(s=>/^cover:[0-9a-f]{24}$/.test(s.sourceId)&&s.url!.split("/").at(-1)!.length===200));const [visionCall]=await sql`SELECT result FROM assistant_tool_calls WHERE turn_id=${y.turnId} AND name='analyze_xhs_covers'`;assert.equal(visionCall!.result.observations.length,20);assert(visionCall!.result.observations.every((o:any)=>[o.text,o.subject,o.colors,o.layout].some(v=>typeof v==="string"&&v.trim().length>0)));assert.equal(plan.evidence.samples[1]!.fans,null);
   const requests=await sql`SELECT request_snapshot FROM assistant_model_steps WHERE turn_id=${y.turnId}`;const tokens=requests.map(r=>contextTokens(JSON.stringify(r.request_snapshot))+256);assert(tokens.every(n=>n<=24000));
   const [turn]=await sql`SELECT snapshot FROM assistant_turns WHERE id=${y.turnId}`;t.diagnostic(`20 samples admittedSnapshotTokens=${admitted}/4000; finalSnapshotTokens=${contextTokens(JSON.stringify(turn!.snapshot))}; requestTokens=${tokens.join(",")}`);
  });

 }finally{
  if(priorPolicy)await sql`UPDATE settings SET value=${sql.json(priorPolicy.value)} WHERE key='assistant.skills.xiaohongshu-creator'`;else await sql`DELETE FROM settings WHERE key='assistant.skills.xiaohongshu-creator'`;
  await sql`UPDATE member_tool_prices SET enabled=false WHERE model IN (${model},${XHS_COVER_OPERATION}) OR (kind='images' AND model='gptImage2')`;
  for(const p of oldPrices)await sql`UPDATE member_tool_prices SET enabled=${p.enabled},version=${p.version},base_credits=${p.base_credits} WHERE id=${p.id}`;
  await sql`DELETE FROM service_prices WHERE (service='llm' AND model=${model}) OR (service='redfox.query' AND model=${XHS_COVER_OPERATION})`;for(const p of oldCosts)await sql`INSERT INTO service_prices ${sql(p)}`;
  for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;
  config.allowPrivateNetworkFetch=oldPrivate;process.env.MODEL_CALLS_ENABLED="false";process.env.REDFOX_CALLS_ENABLED="false";await modelStub.close();await new Promise<void>(r=>server.close(()=>r()));await restore();await stopBoss();await closeDb();
 }
});

const quoteTurn=(userId:number,sessionId:string,raw:unknown)=>quoteLegacyTurn(userId,sessionId,raw,{"xiaohongshu-creator": "4"});
