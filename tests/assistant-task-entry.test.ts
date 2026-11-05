import { allowTestBudgetScope,assertConfiguredTestDatabase,stub,tag } from "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { buildApp } from "../apps/api/src/app.ts";
import { loginSiteUser } from "@aihot/backend/users/auth";
import sharp from "sharp";
import { sql,closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits,saveToolPrice } from "@aihot/backend/users/credits";
import { contextTokens } from "@aihot/backend/assistant/context";
import { coverPlanInputProjection } from "@aihot/backend/assistant/cover-plan";
import { controlAssistantOperation } from "@aihot/backend/assistant/controls";
import { message } from "@aihot/backend/assistant/store";
import { sessionSnapshot } from "@aihot/backend/assistant/sessions";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { XHS_COVER_OPERATION } from "@aihot/backend/providers/redfox/xhs-cover-contract";
const completion=(name:string,input:unknown)=>({id:"stub",created:1,model:"stub",choices:[{index:0,message:{role:"assistant",content:null,tool_calls:[{id:"call_0",type:"function",function:{name,arguments:JSON.stringify(input)}}]},finish_reason:"tool_calls"}]});
const scheme=(i:number,sourceIds:string[])=>({schemeId:`scheme-${i}`,name:`设计方向${i}`,layout:"标题放上方，主体居中，留出适当空白。",palette:"暖橙与米白",prompt:`方案${i}：竖版3:4封面，暖橙米白背景，标题“观察与行动”，主体居中，文字清晰。`,aspectRatio:"3:4",sourceIds});
test("synthetic HTTP manual-skill and automatic entry both quote once and deliver initial plans-only scope",async t=>{
 const [db]=await sql`SELECT current_database() name,inet_server_port() port`;assertConfiguredTestDatabase(db!.name,db!.port);
 const services=["assistant.quote-preparation","assistant.text","assistant.vision","redfox.query","redfox.image","redfox.poll"],restore=await allowTestBudgetScope(services,"member");
 const model=`cover-plan-${tag()}`,oldPrivate=config.allowPrivateNetworkFetch;config.allowPrivateNetworkFetch=true;
 let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 let next="plans-only",queries=0,visions=0,submits=0,unreadable=false,emptyCovers=false;
 let savedSession:any,savedPlan:any,otherPlan:any,lastImageInput:any;
 const png=await sharp({create:{width:900,height:1200,channels:3,background:"orange"}}).png().toBuffer();
 const server=http.createServer((req,res)=>{let body="";req.on("data",c=>body+=c);req.on("end",()=>{
  if(req.url!.startsWith("/cover/")||req.url==="/output.png"){res.writeHead(200,{"content-type":"image/png"});res.end(png);return;}
  let data:any;
  if(req.url!.startsWith("/story/api/cozeSkill/getXhsCozeSkillData")){queries++;data={lowPowderExplosiveArticle:emptyCovers?[]:[{photoId:'note-1',title:'春日通勤穿搭',desc:'春日穿搭记录',authorName:'合成作者',fans:0,coverUrl:`${process.env.REDFOX_TEST_BASE_URL}/cover/${queries}/1`,useLikeCount:1,publicTime:'2026-11-02'}],likeTheTop500:[],singleDayIncrements:[],sevenDaysOfIncrements:[]};}
  else if(req.url!.endsWith("gptImage2Submit")){submits++;const input=JSON.parse(body);lastImageInput=input;data={taskId:`image-${submits}`};}
  else {const input=JSON.parse(body);data={taskId:input.taskId,status:"completed",imageUrls:[`${process.env.REDFOX_TEST_BASE_URL}/output.png`]};}
  res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({code:2000,data}));
 });});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const recognitionCases=new Map<string,{hint:string;result:Record<string,unknown>|null}>();
 let recognitionCalls=0;
 let preparations=0,writeDraft=false;
 const modelStub=await stub(async (_hit,req)=>{
  const request=JSON.parse(req.body),content=request.messages[0]?.content;
  if(request.response_format?.type==='json_object'&&typeof content==='string'&&content.startsWith('只识别')){
   const recognitionInput=JSON.parse(request.messages[1].content),recognition=recognitionCases.get(recognitionInput.message);
   if(recognition){
    recognitionCalls++;assert(recognitionInput.actionHint.length>0,'chosen quick action is passed to the existing recognition request');
    const hintedModule=recognition.hint==='xiaohongshu-rewrite'?'M2':'M4';
    assert(recognitionInput.actionHint.every((hint:any)=>hint.skillId==='xiaohongshu-creator'&&hint.moduleId===hintedModule),'recognition receives only the chosen quick action module');
    return {choices:[{message:{content:JSON.stringify(recognition.result??{clarify:true})}}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}};
   }
   preparations++;const input=recognitionInput;assert.match(input.message,/春日通勤穿搭/);if(input.message.includes('模拟报价暂不可用')){
    await sql`UPDATE budgets SET per_minute=0 WHERE service='redfox.image'`;
    return {choices:[{message:{content:JSON.stringify({skillId:'xiaohongshu-creator',moduleId:'M4',delivery:'image',size:'3:4'})}}],usage:{prompt_tokens:90,completion_tokens:30,total_tokens:120}};
   }
   assert.match(input.message,/暂时不要生成图片/);
   const candidate=input.candidates.find((c:any)=>c.delivery==='plans-only');assert(candidate);
   return {choices:[{message:{content:JSON.stringify({skillId:candidate.skillId,moduleId:candidate.moduleId,delivery:candidate.delivery,...(preparations===1?{size:'3:4'}:{})})}}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}};
  }
  if(Array.isArray(content)&&content.some((c:any)=>c.type==="image_url")){
   visions++;const ids=content.filter((c:any)=>c.type==="text"&&c.text.startsWith("sourceId: ")).map((c:any)=>c.text.slice(10));
   return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({observations:ids.map((sourceId:string)=>({sourceId,status:unreadable?"unreadable":"observed",text:"",subject:unreadable?"":"暖橙色画面",colors:"橙色",layout:"纯色背景",uncertainties:["没有可读文字"]}))})}}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}};
  }
  if(request.tools?.length===1&&request.tools[0].function.name==='generate_image'){
   const image=JSON.parse(request.messages[1].content);assert.equal(image.prompt,scheme(2,[]).prompt);
   assert(!JSON.stringify(request).includes('coverUrl'));return completion('generate_image',{...image,planReference:undefined});
  }
  const messages=request.messages.filter((m:any)=>m.role==="tool").map((m:any)=>JSON.parse(m.content)),loaded=messages.find((m:any)=>m.entry);
  if(!loaded){const c=JSON.parse(request.messages[0].content.slice(request.messages[0].content.indexOf("{"))).candidates[0];return completion("load_skill",{skillId:c.skillId,moduleId:c.moduleId});}
  if(writeDraft)return completion("save_draft",{activationId:loaded.activationId,kind:"text-draft",baseVersion:0,content:{title:"已保存稿件",body:"真实事务保存的合成稿件",intent:"draft",titles:[],tags:[],sources:["current-message"],partial:false,scope:"用户材料"}});
  if(!messages.some((m:any)=>m.text?.includes("封面")))return completion("read_skill_reference",{activationId:loaded.activationId,resourceId:"core-workflow"});
  const selected=JSON.parse(request.messages[1].content.slice(request.messages[1].content.indexOf("{"))).selected;
  const historical=selected?.find((s:any)=>s.kind==='xhs-cover-plan');
  if(historical)return completion("generate_image",{activationId:loaded.activationId,title:"历史方案生成",prompt:"由方案权威内容覆盖",size:"3:4",planReference:{artifactId:historical.artifact_id,version:historical.version,schemeId:"scheme-2"}});
  const query=messages.find((m:any)=>m.metadata?.operationId===XHS_COVER_OPERATION),vision=messages.find((m:any)=>m.reportId),plan=messages.find((m:any)=>m.kind==="xhs-cover-plan");
  if(!query)return completion("search_xhs_covers",{activationId:loaded.activationId,keyword:"生活,观察",startDate:JSON.parse(request.messages[0].content.slice(request.messages[0].content.indexOf("{"))).researchClock?.earliestDate??"2026-10-04"});
  if(!vision)return completion("analyze_xhs_covers",{activationId:loaded.activationId,samples:query.results.slice(0,20).map((r:any)=>({sourceId:r.sourceId,reason:"与主题有关"}))});
  if(!plan)return completion("save_xhs_cover_plan",{activationId:loaded.activationId,baseVersion:0,title:"生活观察封面",summary:"依据实际可见封面整理色调与留白；样本中没有可读文字，标题为本次创意设计。",schemes:[1,2,3].map(i=>({...scheme(i,vision.observations.filter((o:any)=>o.status==="observed").map((o:any)=>o.sourceId)),...(i===1?{sourceIds:undefined,schemeId:undefined,layout:undefined,palette:undefined}:i===3?{sourceIds:["cover:unrelated"]}:{})})),next:next==="plans-only"?"choose":"plans-only"});
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
  const login=await loginSiteUser({username:user.username,password:'synthetic-password'});
  const headers={cookie:`aihot_user=${login.token}`,'x-csrf-token':login.principal.csrf};
  app=await buildApp();
  for(const skillSelection of [{skillId:'xiaohongshu-creator'},null]) {
   const initialRequest={message:'请为小红书的春日通勤穿搭主题，先帮我研究并做三套封面方案，暂时不要生成图片',skillSelection};
   const commandKey=randomUUID();
   const created:any=await app.inject({method:'POST',url:'/api/assistant/sessions',headers:{...headers,'idempotency-key':commandKey},payload:{assistantId:'creative',initialRequest}});
   assert.equal(created.statusCode,201,created.body);const initial=created.json();const quote=initial.initialRequest.quote;
   assert(quote.task);assert.equal(quote.task.label,'研究并交付三套封面方案');assert.equal(quote.amount,21);assert(!quote.task.items.some((i:any)=>i.key==='generate_image@1'));
   assert.equal(JSON.parse(quote.task.scope).delivery,'plans-only');assert.equal(JSON.parse(quote.task.scope).size,undefined,'model-only extraneous size is removed before freezing the plans-only scope');
   const replay:any=await app.inject({method:'POST',url:'/api/assistant/sessions',headers:{...headers,'idempotency-key':commandKey},payload:{assistantId:'creative',initialRequest}});assert.equal(replay.json().initialRequest.quote.quoteId,quote.quoteId);
   const submit:any=await app.inject({method:'POST',url:`/api/assistant/sessions/${initial.sessionId}/turns`,headers:{...headers,'idempotency-key':randomUUID()},payload:{...initial.initialRequest.input,quoteId:quote.quoteId}});
   assert.equal(submit.statusCode,202,submit.body);const run=submit.json();
   let done:any;
   for(let n=0;n<45;n++) {
    done=await sessionSnapshot(user.id,initial.sessionId);
    if(done.turn.status==='completed')break;
    assert.notEqual(done.turn.phase,'waiting_approval');assert.notEqual(done.turn.phase,'waiting_question');
    assert.notEqual(done.turn.status,'needs_review',JSON.stringify(done.turn.calls));
    const child=done.turn.calls.find((c:any)=>c.state==='running');const [childRun]=child?await sql`SELECT status FROM operation_runs WHERE id=${child.childRunId}`:[];await advance(childRun?.status==='active'||childRun?.status==='waiting'?child.childRunId:run.runId);
   }
   assert.equal(done.turn.status,'completed');const plan=done.artifacts.find((a:any)=>a.kind==='xhs-cover-plan');assert.equal(plan.content.coverPlan.schemes.length,3);assert.equal(plan.content.coverPlan.evidence.observedCount,1);assert.deepEqual(plan.content.coverPlan.schemes.map((s:any)=>s.sourceIds.length),[0,1,0]);assert.equal(new Set(plan.content.coverPlan.schemes.map((s:any)=>s.schemeId)).size,3);
   assert.equal(plan.content.coverPlan.schemes[0].layout,"");assert.equal(plan.content.coverPlan.schemes[0].palette,"");
   assert(!done.turn.calls.some((c:any)=>c.name==='generate_image'));
   otherPlan=savedPlan;savedSession=done;savedPlan=plan;
   const charges=await sql`SELECT * FROM member_credit_charges WHERE root_run_id=${run.runId}`;assert.equal(charges.length,1);assert.equal(charges[0]!.consumed,21);assert.equal(charges[0]!.released,0);
   const all=await sql`SELECT DISTINCT charge_id FROM member_credit_authorized_runs WHERE run_id=${run.runId} OR run_id IN (SELECT child_run_id FROM assistant_tool_calls WHERE turn_id=${run.turnId})`;assert.equal(all.length,1);
   const [reserves]=await sql`SELECT count(*)::int n FROM member_credit_entries WHERE charge_id=${charges[0]!.id} AND kind='reserve'`;assert.equal(reserves!.n,1);
  }
  assert.equal(preparations,2);assert.equal(queries,2);assert.equal(visions,2);assert.equal(submits,0);
  next='choose';
  const retryKey=randomUUID(),retryRequest={assistantId:'creative',initialRequest:{message:'春日通勤穿搭，生成小红书封面（模拟报价暂不可用）'}};
  const createAgain=()=>app!.inject({method:'POST',url:'/api/assistant/sessions',headers:{...headers,'idempotency-key':retryKey},payload:retryRequest});
  const interrupted=await createAgain();assert.equal(interrupted.statusCode,503,interrupted.body);
  const [paused]=await sql`SELECT id,initial_request FROM assistant_sessions WHERE owner_user_id=${user.id} AND command_key=${retryKey}`;
  assert.equal(paused!.initial_request.input.taskChoice.delivery,'image');assert.equal(paused!.initial_request.quote,null);
  await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.image'`;
  const [restored,concurrent]=await Promise.all([createAgain(),createAgain()]);assert.equal(restored.statusCode,201,restored.body);assert.equal(concurrent.json().initialRequest.quote.quoteId,restored.json().initialRequest.quote.quoteId);assert.equal(restored.json().sessionId,paused!.id);assert.equal(restored.json().initialRequest.quote.amount,34);assert.equal(preparations,3);
  for(const keep of [true,false]){
   await sql`UPDATE operation_runs SET created_at=now()-interval '2 minutes' WHERE actor=${`user:${user.id}`}`;
   const initialRequest={message:'请研究并设计小红书春日通勤穿搭封面，最终生成一张3:4图片',skillSelection:{skillId:'xiaohongshu-creator'},taskChoice:{skillId:'xiaohongshu-creator',moduleId:'M4',delivery:'image',size:'3:4'}};
   const created:any=await app.inject({method:'POST',url:'/api/assistant/sessions',headers:{...headers,'idempotency-key':randomUUID()},payload:{assistantId:'creative',initialRequest}});assert.equal(created.statusCode,201,created.body);
   const initial=created.json();assert.equal(initial.initialRequest.quote.amount,34);
   const submit:any=await app.inject({method:'POST',url:`/api/assistant/sessions/${initial.sessionId}/turns`,headers:{...headers,'idempotency-key':randomUUID()},payload:{...initial.initialRequest.input,quoteId:initial.initialRequest.quote.quoteId}});assert.equal(submit.statusCode,202,submit.body);const run=submit.json();
   let done:any,choices=0;
   for(let n=0;n<50;n++){
    done=await sessionSnapshot(user.id,initial.sessionId);if(done.turn.status==='completed')break;
    assert.notEqual(done.turn.phase,'waiting_approval');assert.notEqual(done.turn.status,'needs_review',JSON.stringify(done.turn.calls));
    if(done.turn.phase==='waiting_question'){
     choices++;const q=done.turn.question,plan=q.coverPlan;
     const choice={artifactId:plan.artifactId,version:plan.version,action:keep?'keep-plans':'generate',...(keep?{}:{schemeId:'scheme-2'})};
     const answer:any=await app.inject({method:'POST',url:`/api/assistant/sessions/${initial.sessionId}/turns/${run.turnId}/answer`,headers,payload:{questionId:q.questionId,expectedRevision:done.revision,answer:keep?'只保留方案':'选择第二方案',choice}});assert.equal(answer.statusCode,200,answer.body);
     if(!keep){
       // Reproduce the legacy persisted, undispatched oversized step after the user chose a scheme.
       const [r]=await sql`SELECT step_version,generation FROM operation_runs WHERE id=${run.runId}`;
       const [old]=await sql`SELECT * FROM assistant_model_steps WHERE turn_id=${run.turnId} ORDER BY model_ordinal DESC LIMIT 1`;
       const oldRequest={...old!.request_snapshot,system:'超长研究材料 '.repeat(10000)};
       assert(contextTokens(JSON.stringify(oldRequest))>24000);
       const stepId=randomUUID();
       await sql`INSERT INTO assistant_model_steps(id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash,cost_context_version) VALUES(${stepId},${run.turnId},${old!.model_ordinal+1},${r!.step_version},${sql.json(oldRequest)},'preflight',1)`;
       await sql`INSERT INTO assistant_model_step_activations SELECT ${stepId},activation_id FROM assistant_model_step_activations WHERE model_step_id=${old!.id}`;
       await sql`UPDATE operation_runs SET status='needs_review',wait_reason='assistant:review' WHERE id=${run.runId}`;
       await sql`UPDATE member_credit_charges SET state='review' WHERE root_run_id=${run.runId}`;
       await sql.begin(tx=>controlAssistantOperation(tx,{runId:run.runId,generation:r!.generation,stepVersion:r!.step_version},'resume','admin:test','核对已冻结同任务，无回执后恢复'));
     }
     continue;
    }
    const child=done.turn.calls.find((c:any)=>c.state==='running');const [childRun]=child?await sql`SELECT status FROM operation_runs WHERE id=${child.childRunId}`:[];await advance(childRun?.status==='active'||childRun?.status==='waiting'?child.childRunId:run.runId);
   }
   assert.equal(done.turn.status,'completed');assert.equal(choices,1);
   const [charge]=await sql`SELECT amount,consumed,released FROM member_credit_charges WHERE root_run_id=${run.runId}`;assert.equal(charge!.amount,34);assert.equal(charge!.consumed,keep?21:34);assert.equal(charge!.released,keep?13:0);
   assert.equal(done.artifacts.filter((a:any)=>a.kind==='image').length,keep?0:1);
   if(!keep){
     const [ledger]=await sql`SELECT count(*) FILTER(WHERE e.kind='reserve')::int reserves,count(*) FILTER(WHERE e.kind='consume')::int consumes FROM member_credit_entries e JOIN member_credit_charges c ON c.id=e.charge_id WHERE c.root_run_id=${run.runId}`;
     assert.deepEqual(ledger,{reserves:1,consumes:1});assert.equal(lastImageInput.prompt,scheme(2,[]).prompt);
   }
  }
  assert.equal(submits,1);
  for(const shortage of ["unreadable","empty"]) await t.test(`${shortage} cover ends the task and charges only the delivered query`,async()=>{
   const initialRequest={message:"研究春日通勤穿搭封面，再生成一张图片",skillSelection:{skillId:"xiaohongshu-creator"},taskChoice:{skillId:"xiaohongshu-creator",moduleId:"M4",delivery:"image",size:"3:4"}};
   const create=await app!.inject({method:"POST",url:"/api/assistant/sessions",headers:{...headers,"idempotency-key":randomUUID()},payload:{assistantId:"creative",initialRequest}});
   assert.equal(create.statusCode,201,create.body);const initial=create.json(),q=initial.initialRequest.quote;
   const submit=await app!.inject({method:"POST",url:`/api/assistant/sessions/${initial.sessionId}/turns`,headers:{...headers,"idempotency-key":randomUUID()},payload:{...initial.initialRequest.input,quoteId:q.quoteId}});
   assert.equal(submit.statusCode,202,submit.body);const run=submit.json(),before={queries,visions,submits};unreadable=shortage==="unreadable";emptyCovers=shortage==="empty";
   try{
    for(let n=0;n<32;n++){
     const done=await sessionSnapshot(user.id,initial.sessionId);if(["failed","completed"].includes(done.turn!.status))break;
     assert.notEqual(done.turn!.status,"needs_review");assert(!done.turn!.question);
     const call=done.turn!.calls.find(c=>c.state==="running"),[child]=call?await sql`SELECT status FROM operation_runs WHERE id=${call.childRunId!}`:[];
     await advance(child?.status==="active"||child?.status==="waiting"?call!.childRunId!:run.runId);
    }
    const done=await sessionSnapshot(user.id,initial.sessionId);assert.equal(done.turn!.status,"failed");assert.equal(done.artifacts.length,0);
    assert.deepEqual([queries-before.queries,visions-before.visions,submits-before.submits],[1,shortage==="empty"?0:1,0]);
    if(shortage==="empty")assert(!done.turn!.calls.some(c=>c.name==="analyze_xhs_covers"));
    const [charge]=await sql`SELECT amount,consumed,released FROM member_credit_charges WHERE root_run_id=${run.runId}`;assert.deepEqual([charge!.amount,charge!.consumed,charge!.released],[34,3,31]);
   }finally{unreadable=false;emptyCovers=false;}
  });
  // A realistic historical three-scheme plan alone exceeds the old 4k admission remainder.
  // Keep its original evidence and publish a synthetic later version, never overwrite v1.
  const expanded=structuredClone(savedPlan.content);
  for(const item of expanded.coverPlan.schemes){
   item.layout='标题置于上方，主体居中，底部保留留白；文字大小清楚，元素间距均匀。'.repeat(12);
   item.palette='暖橙与米白，使用低饱和度背景，深色标题保持清晰对比。'.repeat(8);
   item.prompt+='画面保持简洁，标题与主体层次分明，周围留出空白，不加入额外文字；采用自然光线和细腻材质。'.repeat(24);
  }
  const [historical]=await sql`INSERT INTO assistant_artifact_versions(session_id,artifact_id,version,base_version,kind,turn_id,activation_id,content,source_snapshot)
    SELECT session_id,artifact_id,version+1,version,kind,turn_id,activation_id,${sql.json(expanded)},source_snapshot FROM assistant_artifact_versions WHERE session_id=${savedSession.sessionId} AND artifact_id=${savedPlan.artifactId} AND version=${savedPlan.version}
    RETURNING artifact_id,version,kind,content,source_snapshot`;
  savedPlan={...savedPlan,version:historical!.version,content:expanded};
  const selectedTokens=contextTokens(JSON.stringify([coverPlanInputProjection(historical!)]));assert(selectedTokens>4000,`selected historical plan must reproduce the old admission failure: ${selectedTokens}`);
  const historicalText='这次沿用已经确定的主题与设计方向，保留原有色调和文字层级，不需要重新研究。'.repeat(24);
  await sql.begin(tx=>message(tx,savedSession.sessionId,null,'assistant',historicalText));
  const researchLimit=await app.inject({method:'POST',url:`/api/assistant/sessions/${savedSession.sessionId}/quote`,headers,payload:{message:historicalText.repeat(4),expectedRevision:savedSession.revision,artifactVersions:[],inputIds:[],skillSelection:{skillId:'xiaohongshu-creator'},taskChoice:{skillId:'xiaohongshu-creator',moduleId:'M4',delivery:'plans-only'}}});
  assert.equal(researchLimit.statusCode,409,researchLimit.body);assert.match(researchLimit.body,/模型上下文超过封面研究材料额度/);
  // Current M4 can render an explicitly owned plan while research dependencies are unavailable.
  await sql`UPDATE budgets SET per_minute=0,per_hour=0,per_day=0 WHERE service IN ('assistant.vision','redfox.query')`;
  await sql`UPDATE operation_runs SET created_at=now()-interval '2 minutes' WHERE actor=${`user:${user.id}`}`;
  const selectedInput={message:'请按选中的第二套历史方案生成一张封面',expectedRevision:savedSession.revision,inputIds:[],artifactVersions:[{artifactId:savedPlan.artifactId,version:savedPlan.version}],skillSelection:{skillId:'xiaohongshu-creator'},taskChoice:{skillId:'xiaohongshu-creator',moduleId:'M4',delivery:'image',size:'3:4'}};
  const quotePath=`/api/assistant/sessions/${savedSession.sessionId}/quote`;
  for(const artifactVersions of [[],[{artifactId:otherPlan.artifactId,version:otherPlan.version}],[{artifactId:randomUUID(),version:1}],[{artifactId:savedPlan.artifactId,version:999}]]){
   const rejected:any=await app.inject({method:'POST',url:quotePath,headers,payload:{...selectedInput,artifactVersions}});assert.equal(rejected.statusCode,409,rejected.body);
  }
  const globalOptions=await app.inject({url:'/api/assistant/options',headers});assert.equal(globalOptions.statusCode,200);
  const optionsPath=(sessionId:string,artifactVersions:any)=>`/api/assistant/options?${new URLSearchParams({sessionId,artifactVersions:JSON.stringify(artifactVersions)})}`;
  // Locate the bound M4 action; the option contract uses actionId rather than moduleId.
  const {bindings,currentSkillVersions}=await import('@aihot/backend/assistant/bindings');
  const coverAction=bindings.find(b=>b.skillId==='xiaohongshu-creator'&&b.version===currentSkillVersions[b.skillId])!.modules.find(m=>m.moduleId==='M4')!.actionId;
  const available=(value:any)=>value.assistants.flatMap((a:any)=>a.actions).some((a:any)=>a.actionId===coverAction&&a.available);
  assert.equal(available(globalOptions.json()),false);
  const contextual=await app.inject({url:optionsPath(savedSession.sessionId,selectedInput.artifactVersions),headers});assert.equal(contextual.statusCode,200,contextual.body);assert.equal(available(contextual.json()),true);
  const removed=await app.inject({url:optionsPath(savedSession.sessionId,[]),headers});assert.equal(available(removed.json()),false);
  const crossed=await app.inject({url:optionsPath(savedSession.sessionId,[{artifactId:otherPlan.artifactId,version:otherPlan.version}]),headers});assert.equal(crossed.statusCode,409,crossed.body);
  const otherUser=await createSiteUser({username:`context_${tag()}`,displayName:'Context owner',password:'synthetic-password'},'test');
  const otherLogin=await loginSiteUser({username:otherUser.username,password:'synthetic-password'});
  const forbidden=await app.inject({url:optionsPath(savedSession.sessionId,selectedInput.artifactVersions),headers:{cookie:`aihot_user=${otherLogin.token}`}});assert.equal(forbidden.statusCode,404,forbidden.body);
  const prepared=await app.inject({method:'POST',url:quotePath,headers,payload:selectedInput});assert.equal(prepared.statusCode,200,prepared.body);
  const historicalQuote=prepared.json();assert.equal(historicalQuote.amount,20);assert.deepEqual(historicalQuote.task.items.map((i:any)=>i.key),['creation','generate_image@1']);
  const counts={queries,visions,submits};
  const submitted=await app.inject({method:'POST',url:`/api/assistant/sessions/${savedSession.sessionId}/turns`,headers:{...headers,'idempotency-key':randomUUID()},payload:{...selectedInput,quoteId:historicalQuote.quoteId}});assert.equal(submitted.statusCode,202,submitted.body);
  const historicalRun=submitted.json();let rendered:any;
  for(let n=0;n<30;n++){
   rendered=await sessionSnapshot(user.id,savedSession.sessionId);if(rendered.turn.status==='completed')break;
   assert.notEqual(rendered.turn.status,'needs_review',JSON.stringify(rendered.turn));assert.notEqual(rendered.turn.phase,'waiting_approval');
   const child=rendered.turn.calls.find((c:any)=>c.state==='running');const [childRun]=child?await sql`SELECT status FROM operation_runs WHERE id=${child.childRunId}`:[];await advance(childRun?.status==='active'||childRun?.status==='waiting'?child.childRunId:historicalRun.runId);
  }
  assert.equal(rendered.turn.status,'completed');assert.equal(rendered.artifacts.filter((a:any)=>a.kind==='image').length,1);
  const frozenRequests=await sql`SELECT request_snapshot FROM assistant_model_steps WHERE turn_id=${historicalRun.turnId} ORDER BY model_ordinal`;
  assert(frozenRequests.length>0);
  const requestTokens=frozenRequests.map(r=>contextTokens(JSON.stringify(r.request_snapshot))+256);
  assert(requestTokens.every(n=>n<=24000),JSON.stringify(requestTokens));
  assert(frozenRequests.some(r=>JSON.stringify(r.request_snapshot).includes(expanded.coverPlan.schemes[1].prompt)), 'the selected prompt is retained without trimming');
  assert(frozenRequests.some(r=>JSON.stringify(r.request_snapshot).includes(historicalText)), 'history is retained without trimming');
  t.diagnostic(`saved-plan selected=${selectedTokens} tokens; executed requests=${requestTokens.join(',')} / 24000`);

  assert.equal(queries,counts.queries);assert.equal(visions,counts.visions);assert.equal(submits,counts.submits+1);
  assert.equal(lastImageInput.prompt,savedPlan.content.coverPlan.schemes[1].prompt);assert.equal(lastImageInput.size,"3:4");
  const [historicalCharge]=await sql`SELECT id,amount,consumed,released FROM member_credit_charges WHERE root_run_id=${historicalRun.runId}`;
  assert.deepEqual([historicalCharge!.amount,historicalCharge!.consumed,historicalCharge!.released],[20,20,0]);
  const [historicalLedger]=await sql`SELECT count(*) FILTER(WHERE kind='reserve')::int reserves,count(*) FILTER(WHERE kind='consume')::int consumes FROM member_credit_entries WHERE charge_id=${historicalCharge!.id}`;
  assert.deepEqual([historicalLedger!.reserves,historicalLedger!.consumes],[1,1]);
  const queued:any=await app.inject({method:'POST',url:`/api/assistant/sessions/${savedSession.sessionId}/queue`,headers:{...headers,'idempotency-key':randomUUID()},payload:{...selectedInput,expectedRevision:rendered.revision}});assert.equal(queued.statusCode,202,queued.body);
  const [queueEntry]=await sql`SELECT state,quote FROM assistant_message_queue WHERE id=${queued.json().entryId}`;
  assert.equal(queueEntry!.state,'quoted');assert.equal(queueEntry!.quote.amount,20);
  const canceled=await app.inject({method:'POST',url:`/api/assistant/sessions/${savedSession.sessionId}/queue/${queued.json().entryId}/cancel`,headers});assert.equal(canceled.statusCode,200,canceled.body);
  // Pause after the artifact/call transaction commits but before final turn advancement.
  // The stop path must see the same atomic delivery marker for both drafts and images.
  await sql`INSERT INTO settings(key,value,updated_by) VALUES ('assistant.skills.general-writing','{"acceptingNew":true,"revision":1}','test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
  const {controlTurn}=await import('@aihot/backend/assistant/controls');
  for(const kind of ['text-draft','image']){
   writeDraft=kind==='text-draft';
   await sql`UPDATE operation_runs SET created_at=now()-interval '2 minutes' WHERE actor=${`user:${user.id}`}`;
   let targetSession:string,raw:any,q:any;
   if(writeDraft){
    const created:any=await app.inject({method:'POST',url:'/api/assistant/sessions',headers:{...headers,'idempotency-key':randomUUID()},payload:{assistantId:'creative',initialRequest:{message:'把本次材料整理为短文',skillSelection:{skillId:'general-writing'},taskChoice:{skillId:'general-writing',moduleId:'write',delivery:'writing'}}}});assert.equal(created.statusCode,201,created.body);
    targetSession=created.json().sessionId;raw=created.json().initialRequest.input;q=created.json().initialRequest.quote;
   }else{
    targetSession=savedSession.sessionId;raw={...selectedInput,expectedRevision:(await sessionSnapshot(user.id,targetSession)).revision};
    const response:any=await app.inject({method:'POST',url:quotePath,headers,payload:raw});assert.equal(response.statusCode,200,response.body);q=response.json();
   }
   const submitted:any=await app.inject({method:'POST',url:`/api/assistant/sessions/${targetSession}/turns`,headers:{...headers,'idempotency-key':randomUUID()},payload:{...raw,quoteId:q.quoteId}});assert.equal(submitted.statusCode,202,submitted.body);
   const target=submitted.json();let stopped=false;
   const begin=sql.begin;
   sql.begin=(async(...args:any[])=>{
    const result=await (begin as any)(...args);
    if(!stopped){
     const [saved]=await sql`SELECT a.artifact_id FROM assistant_artifact_versions a JOIN operation_runs r ON r.id=${target.runId} WHERE a.turn_id=${target.turnId} AND a.kind=${kind} AND r.status='active' LIMIT 1`;
     if(saved){
      stopped=true;
      const [marker]=await sql`SELECT count(*)::int n FROM operation_results WHERE run_id=${target.runId} AND kind='assistant_delivery'`;assert.equal(marker!.n,1,'artifact transaction must persist its delivery evidence before final advance');
      const [run]=await sql`SELECT generation FROM operation_runs WHERE id=${target.runId}`;
      await controlTurn(user.id,targetSession,target.turnId,'stop',{generation:run!.generation});
     }
    }
    return result;
   }) as typeof sql.begin;
   try{
    for(let n=0;n<30&&!stopped;n++){
     const current=await sessionSnapshot(user.id,targetSession);assert.notEqual(current.turn!.status,'needs_review');
     const child=current.turn!.calls.find((c:any)=>c.state==='running');const [childRun]=child?await sql`SELECT status FROM operation_runs WHERE id=${child.childRunId}`:[];await advance(childRun?.status==='active'||childRun?.status==='waiting'?child!.childRunId!:target.runId);
    }
   }finally{sql.begin=begin;}
   assert(stopped,`${kind} reached the pre-finalization stop window`);
   const [charge]=await sql`SELECT amount,consumed,released,state FROM member_credit_charges WHERE root_run_id=${target.runId}`;
   assert.equal(charge!.state,'settled');assert.equal(charge!.consumed,writeDraft?7:20);assert.equal(charge!.released,0);
  }
  await t.test('quick-action intent reaches recognition without freezing stale scope; cover clarification and HTTP replay remain free of task side effects',async()=>{
   await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('assistant.vision','redfox.query')`;
   await setPrice('query','redfox','3X8FGEEM',3);
   const cover={skillId:'xiaohongshu-creator',moduleId:'M4'};
   const cases=[
    {hint:'xiaohongshu-rewrite',message:'今天通勤穿了一件白色衬衫，搭配深蓝色长裤，轻便又舒服。',result:{skillId:cover.skillId,moduleId:'M2',delivery:'writing'}},
    {hint:'xiaohongshu-rewrite',message:'改为研究小红书通勤穿搭热点，写一篇新笔记，不改写原文。',result:{skillId:cover.skillId,moduleId:'M1',delivery:'writing'}},
    {hint:'xiaohongshu-cover',message:'请研究通勤穿搭封面，只给我三套设计方案，不生成图片。',result:{...cover,delivery:'plans-only'}},
    {hint:'xiaohongshu-cover',message:'请研究小红书「通勤穿搭」热门封面，给我三套封面设计方案；我选定其中一套后，请继续生成一张3:4、1K封面图。',result:{...cover,delivery:'image',size:'3:4'}},
    {hint:'xiaohongshu-cover',message:'通勤穿搭封面',result:null},
   ];
   for(const [i,fixture] of cases.entries()){
    recognitionCases.set(fixture.message,fixture);
    const member=await createSiteUser({username:`ux_intent_${i}_${tag()}`,displayName:'Intent fixture',password:'synthetic-password'},'test');
    await grantCredits(member.id,{amount:1000,reason:'Intent fixture'},'test',randomUUID());
    const auth=await loginSiteUser({username:member.username,password:'synthetic-password'}),requestHeaders={cookie:`aihot_user=${auth.token}`,'x-csrf-token':auth.principal.csrf,'idempotency-key':randomUUID()};
    const request={assistantId:'xiaohongshu',initialRequest:{message:fixture.message,skillSelection:{skillId:cover.skillId},taskHint:{actionId:fixture.hint}}};
    const before=recognitionCalls;
    const response=await app!.inject({method:'POST',url:'/api/assistant/sessions',headers:requestHeaders,payload:request});assert.equal(response.statusCode,201,response.body);
    const created=response.json();assert.equal(recognitionCalls,before+1);
    if(fixture.result){
     assert(created.initialRequest.quote,`case ${i}: expected quote for recognized scope`);
     const {research,...scope}=JSON.parse(created.initialRequest.quote.task.scope);
     assert.deepEqual(scope,fixture.result);
     if(fixture.result.moduleId==='M1'){
      assert.equal(research.policy,'xhs-empty-window@1');
      assert.equal(research.maximumQueries,2);
      assert.equal(research.fixedDates,false);
      assert.equal(research.startDate,research.clock.defaultStartDate);
      assert.equal(research.endDate,research.clock.latestDate);
      assert.equal(created.initialRequest.quote.task.items.find((item:any)=>item.key==='search-xhs-notes@1').units,2);
     }else assert.equal(research,undefined);
     assert.equal(created.initialRequest.quote.task.items.some((item:any)=>item.key==='generate_image@1'),fixture.result.delivery==='image');
    }
    else assert.equal(created.initialRequest.quote,null,'a cover hint alone cannot authorize the image scope');
    const replay=await app!.inject({method:'POST',url:'/api/assistant/sessions',headers:requestHeaders,payload:request});assert.equal(replay.statusCode,201,replay.body);assert.equal(replay.json().sessionId,created.sessionId);assert.equal(recognitionCalls,before+1,'replaying accepted create does not identify again');
    const [wallet]=await sql`SELECT reserved FROM member_credit_accounts WHERE user_id=${member.id}`;assert.equal(Number(wallet!.reserved),0);
    const [runs]=await sql`SELECT count(*)::int n FROM operation_runs WHERE actor=${`user:${member.id}`}`;assert.equal(runs!.n,0,'recognition and quote never start paid task execution');
   }
  });
  const [costs]=await sql`SELECT count(*)::int n FROM receipt_attempts WHERE service='assistant.quote-preparation' AND owner_user_id=${user.id}`;assert.equal(costs!.n,3);
  t.diagnostic('Routing and vendors are synthetic local fixtures: proves HTTP scope, execution and accounting, not real-model semantic recognition.');
 } finally {
  await app?.close();config.allowPrivateNetworkFetch=oldPrivate;process.env.MODEL_CALLS_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='false';await modelStub.close();await new Promise<void>(r=>server.close(()=>r()));await restore();await stopBoss();await closeDb();
 }
});
