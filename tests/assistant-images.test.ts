import { quoteLegacyTurn, submitLegacyTurn as submitTurn } from "./assistant-legacy-fixture.ts";
import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import http from "node:http";
import sharp from "sharp";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { config } from "@aihot/backend/config";
import { catalog, candidates, taskHint } from "@aihot/backend/assistant/catalog";
import { resolveImageSize, DraftArgumentsError, ImageProposal, decideCall, refreshCallQuote } from "@aihot/backend/assistant/tools";
import { controlTurn } from "@aihot/backend/assistant/controls";
import { deliverImage } from "@aihot/backend/assistant/image-delivery";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { saveToolPrice, grantCredits } from "@aihot/backend/users/credits";
import { createSession, quoteTurn as currentQuoteTurn, sessionSnapshot, editArtifact, snapshotInput, assistantOptions } from "@aihot/backend/assistant/sessions";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { recoverAssistantChildren } from "@aihot/backend/assistant/execution";
import { readSkillPolicies, updateAssistantSkill } from "@aihot/backend/assistant/skill-policy";
import { assetPath } from "@aihot/backend/operations/assets";
import { costs } from "@aihot/backend/admin/costs";
import { normalizeToolInput } from "@aihot/backend/users/tool-input";
import { quoteUserTool } from "@aihot/backend/users/tools";
import { userToolDetail } from "@aihot/backend/users/tool-read";
import { createRun } from "@aihot/backend/providers/operations/store";
import { enqueueMessage, refreshQueuedQuote, approveQueuedMessage } from "@aihot/backend/assistant/message-queue";
const externalId="ai-image-generator", internalIds=["image-generator","claude-image-generation"], ids=[externalId,...internalIds];
const directPrompt="  竖版海报：一只在窗边的橘猫，柔和自然光\n";
const functionResult=(value:unknown)=>value && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:{};
const completion=(name:string,input:unknown)=>({id:"stub",created:1,model:"stub",choices:[{index:0,message:{role:"assistant",content:null,tool_calls:[{id:"call_0",type:"function",function:{name,arguments:JSON.stringify(input)}}]},finish_reason:"tool_calls"}]});
test("immutable image packages share one capability and stay outside xhs",async()=>{
 const packs=await catalog(), creative=await candidates("creative"), xhs=await candidates("xiaohongshu");
 for(const id of ids){assert.equal(creative.filter(c=>c.skillId===id).length,1);assert.deepEqual(taskHint("creative",{actionId:id}),{actionId:id});assert(!xhs.some(c=>c.skillId===id));assert.throws(()=>taskHint("xiaohongshu",{actionId:id}));const m=packs.find(p=>p.manifest.skillId===id)!.manifest.modules[0]!;assert.deepEqual(m.tools,["generate_image"]);assert.deepEqual(m.outputKinds,["image"]);assert.equal(m.inputSchema,"image-input@1");assert.equal(m.deliveryContract,"image-delivery@1");}
 assert.equal(ImageProposal.parse({activationId:randomUUID(),title:"猫",prompt:"窗边的猫"}).size,"1:1");
 for(const extra of [{model:"other"},{n:4},{fileKeys:["x"]},{size:"100:1"}])assert.throws(()=>ImageProposal.parse({activationId:randomUUID(),title:"猫",prompt:"窗边的猫",...extra}));
});
test("image ratio priority uses validated specs and rejects unsupported or conflicting explicit sizes",async()=>{
 const pack=(await catalog()).find(p=>p.manifest.skillId==="ai-image-generator")!;
 const specs=pack.texts.get("platform-specs")!;
 assert.equal(resolveImageSize("生成16:9图片","1:1",specs),"16:9");
 assert.equal(resolveImageSize("竖版海报","1:1",specs),"4:5");
 assert.equal(resolveImageSize("公众号封面","1:1",specs),"21:9");
 assert.equal(resolveImageSize("生成2.35:1图片","1:1",specs),"21:9");
 assert.equal(resolveImageSize("竖版海报，1920×1080","1:1",specs),"16:9");
 assert.equal(resolveImageSize("32:18、1920x1080","1:1",specs),"16:9");
 assert.equal(resolveImageSize("1800x766","1:1",specs),"21:9");
 assert.equal(resolveImageSize("900×383","1:1",specs),"21:9");
 assert.equal(resolveImageSize("猫","3:2",specs),"3:2");
 assert.equal(resolveImageSize("猫",undefined,specs),"1:1");
 for(const prompt of ["图片7:5","图片1801x766","图片16:9或4:5","图片0:1","图片16:9、1024x1024","  "])
   assert.throws(()=>resolveImageSize(prompt,"1:1",specs),DraftArgumentsError);
 assert.equal(ImageProposal.parse({activationId:randomUUID(),title:"猫",prompt:directPrompt}).prompt,directPrompt);
});
test("historical image v1 approval, local persistence, idempotent delivery, stop and unknown recovery",async t=>{
 const [db]=await sql`SELECT current_database() name,inet_server_port() port`;assertConfiguredTestDatabase(db!.name,db!.port);
 const services=["assistant.text","redfox.image","redfox.poll"], restore=await allowTestBudgetScope(services,"member");
 const oldDir=config.dataDir,oldPrivate=config.allowPrivateNetworkFetch,dir=await mkdtemp(join(tmpdir(),"assistant-images-"));config.dataDir=dir;config.allowPrivateNetworkFetch=true;
 const policies=await sql`SELECT * FROM settings WHERE key IN ${sql(ids.map(id=>`assistant.skills.${id}`))}`;
 const budgets=await sql`SELECT * FROM budgets WHERE service IN ${sql(services)}`;
 const imagePrices=await sql`SELECT * FROM member_tool_prices WHERE kind='images' AND provider='redfox' AND model='gptImage2'`;
 const model=`image-${tag()}`;let chosen=ids[0]!,submits=0,polls=0,downloads=0,lose=false,fail=false,inProgress=false,invalidRatio=false;
 const png=await sharp({create:{width:1024,height:1024,channels:3,background:"green"}}).png().toBuffer();
 const server=http.createServer((req,res)=>{let body="";req.on("data",c=>body+=c);req.on("end",()=>{
  if(req.url==="/output.png"){downloads++;res.writeHead(200,{"content-type":"image/png"});res.end(png);return;}
  const input=JSON.parse(body);let data;
  if(req.url!.endsWith("gptImage2Submit")){submits++;assert.equal(input.n,1);assert.equal(input.resolution,"1k");assert.equal(input.prompt,directPrompt);assert.equal(input.size,"4:5");assert.deepEqual(input.referenceImages,[]);if(lose){req.socket.destroy();return;}data={taskId:`synthetic-${submits}`};}
  else {polls++;data={taskId:input.taskId,status:inProgress?"in_progress":fail?"failed":"completed",...(inProgress?{}:fail?{failReason:"synthetic failure"}:{imageUrls:[`${process.env.REDFOX_TEST_BASE_URL}/output.png`]})};}
  res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({code:2000,data}));
 });});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const modelStub=await stub((_hit,req)=>{const request=JSON.parse(req.body);const loaded=request.messages.filter((m:any)=>m.role==="tool").map((m:any)=>JSON.parse(m.content)).find((m:any)=>m.entry);return loaded?completion("generate_image",{activationId:loaded.activationId,title:"窗边的猫",prompt:invalidRatio?"生成7:5图片":directPrompt,size:chosen==="ai-image-generator"?"1:1":"4:5"}):completion("load_skill",{skillId:chosen,moduleId:"generate"});});
 const advance=async(id:number)=>{await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${id} AND next_attempt_at IS NOT NULL`;const [r]=await sql`SELECT step_version,job_id FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,r!.job_id ?? randomUUID());};
 try{
 Object.assign(process.env,{ASSISTANT_ENABLED:"true",ASSISTANT_CALLS_ENABLED:"true",ASSISTANT_MODEL_VERIFIED:"true",ASSISTANT_MODEL:"default",LLM_MODEL:model,LLM_BASE_URL:modelStub.url+"/v1",LLM_API_KEY:"synthetic-key",ASSISTANT_TOKENIZER:"cl100k_base",MODEL_CALLS_ENABLED:"true",REDFOX_TEST_BASE_URL:`http://127.0.0.1:${(server.address() as {port:number}).port}`,REDFOX_API_KEY:"synthetic-key",REDFOX_CALLS_ENABLED:"true"});
 await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ${sql(services)}`;
 const oldImage=imagePrices.find(p=>p.tier==="1k" && JSON.stringify(p.parameter_match)===JSON.stringify({n:1}));
 await saveToolPrice({...(oldImage?{id:oldImage.id,expectedVersion:oldImage.version}:{}),kind:"images",provider:"redfox",model:"gptImage2",tier:"1k",parameterMatch:{n:1},baseCredits:300,enabled:true,reason:"Synthetic image fixture"},"test");
 await saveToolPrice({kind:"assistant-turn",provider:"assistant",model,baseCredits:7,enabled:true,reason:"Synthetic image fixture"},"test");
 for(const id of ids){await sql`DELETE FROM settings WHERE key=${`assistant.skills.${id}`}`;assert.equal((await readSkillPolicies()).find(p=>p.skillId===id)!.acceptingNew,false);await updateAssistantSkill(id,{acceptingNew:true,expectedRevision:0,reason:"Synthetic image fixture"},"test");}
 const user=await createSiteUser({username:`image_${tag()}`,displayName:"Image fixture",password:"synthetic-password"},"test");await grantCredits(user.id,{amount:5000,reason:"Synthetic fixture"},"test",randomUUID());
 const setImageEnabled=async(id:string,acceptingNew:boolean)=>{const policy=(await readSkillPolicies()).find(p=>p.skillId===id)!;await updateAssistantSkill(id,{acceptingNew,expectedRevision:policy.revision,reason:"Synthetic image toggle"},"test");};
 await t.test("image visibility and fresh admission follow the existing enabled setting",async()=>{
  const session=await createSession(user.id,{assistantId:"creative"},randomUUID());
  const enabled=(await assistantOptions(user.id)).assistants.find(a=>a.id==="creative")!;
  for(const id of ids)assert(enabled.actions.some(a=>a.actionId===id));
  const enabledScope=await snapshotInput(sql,user.id,session.sessionId,{message:directPrompt,expectedRevision:1});
  for(const id of ids)assert(enabledScope.snapshot.candidates.some(c=>c.skillId===id));
  for(const id of internalIds)await setImageEnabled(id,false);
  const counts=async()=> (await sql`SELECT (SELECT count(*) FROM assistant_sessions WHERE owner_user_id=${user.id})::int sessions,(SELECT count(*) FROM member_tool_quotes WHERE user_id=${user.id})::int quotes,(SELECT count(*) FROM member_credit_charges WHERE user_id=${user.id})::int charges,(SELECT count(*) FROM assistant_message_queue WHERE session_id=${session.sessionId})::int queued`)[0];
  const before=await counts();
  for(const id of internalIds){
   await assert.rejects(createSession(user.id,{assistantId:"creative",initialRequest:{message:directPrompt,skillSelection:{actionId:id}}},randomUUID()),/暂停/);
   const raw={message:directPrompt,expectedRevision:1,skillSelection:{actionId:id}};
   await assert.rejects(currentQuoteTurn(user.id,session.sessionId,raw),/暂停/);
   await assert.rejects(enqueueMessage(user.id,session.sessionId,raw,randomUUID()),/暂停/);
  }
  assert.deepEqual(await counts(),before);
  const prepared=await snapshotInput(sql,user.id,session.sessionId,{message:directPrompt,expectedRevision:1});
  assert(prepared.snapshot.candidates.every(item=>!internalIds.includes(item.skillId)));
  const options=await assistantOptions(user.id),creative=options.assistants.find(a=>a.id==="creative")!;
  assert(!creative.actions.some(a=>internalIds.includes(a.actionId)));
  assert.deepEqual(creative.actions.filter(a=>ids.includes(a.actionId)).map(a=>[a.actionId,a.label]),[[externalId,"图片生成"]]);
 });
 async function propose(id=externalId,userId=user.id,acceptedQueue=false){
  chosen=id;const session=await createSession(userId,{assistantId:"creative"},randomUUID()),raw={message:directPrompt,expectedRevision:1,skillSelection:{actionId:id}};
  let turn:{turnId:string;runId:number};
  if(acceptedQueue){
   await setImageEnabled(id,true);
   const entry=await enqueueMessage(userId,session.sessionId,{...raw,taskHint:{actionId:id},inputIds:[],artifactVersions:[]},randomUUID()),entryId=entry.entryId;
   const {candidates}=await import('@aihot/backend/assistant/catalog');
   const legacy=await candidates('creative',{actionId:id},{'image-generator':'1','claude-image-generation':'1','ai-image-generator':'1'});
   await sql`UPDATE assistant_message_queue SET admission_snapshot=${sql.json({version:1,candidates:legacy,policies:[],unavailableSkills:[]} as never)} WHERE id=${entryId}`;
   await setImageEnabled(id,false);
   const refreshed=await refreshQueuedQuote(userId,session.sessionId,entryId);assert.deepEqual(refreshed.quote.additionalFeeKinds,["image"]);
   const accepted=await approveQueuedMessage(userId,session.sessionId,entryId,{quoteId:refreshed.quote.quoteId});
   assert("turnId" in accepted);assert(accepted.turnId);
   const [row]=await sql`SELECT parent_operation_run_id,snapshot FROM assistant_turns WHERE id=${accepted.turnId}`;
   assert.deepEqual(row!.snapshot.taskHint,{actionId:id});assert.deepEqual(row!.snapshot.skillSelection,{actionId:id});
   turn={turnId:accepted.turnId,runId:row!.parent_operation_run_id};
   assert.deepEqual(await approveQueuedMessage(userId,session.sessionId,entryId,{quoteId:refreshed.quote.quoteId}),{turnId:turn.turnId});
  }else{const quote=await quoteTurn(userId,session.sessionId,raw);turn=await submitTurn(userId,session.sessionId,{...raw,quoteId:quote.quoteId},randomUUID());}
  for(let i=0;i<4;i++)await advance(turn.runId);
  const snap=await sessionSnapshot(userId,session.sessionId);assert.equal(snap.turn!.phase,"waiting_approval");assert.equal(snap.turn!.calls[0]!.quote!.amount,300);const call=snap.turn!.calls[0]!;
  assert.deepEqual(call.imageParameters,{prompt:directPrompt,size:"4:5",resolution:"1k",count:1});assert(!Object.hasOwn(functionResult(call.result),"normalized"),"normalized request stays internal");
  if(id===externalId){const [stored]=await sql`SELECT input FROM assistant_tool_calls WHERE id=${call.callId}`;assert.equal(stored!.input.prompt,directPrompt);assert.equal(stored!.input.size,"1:1");const [prepared]=await sql`SELECT result FROM assistant_tool_calls WHERE id=${call.callId}`;assert.equal(prepared!.result.normalized.commandInput.size,"4:5");}
  return {session,turn,userId,call};
 }
 async function approve(p:Awaited<ReturnType<typeof propose>>,revision=1){await decideCall(p.userId,p.session.sessionId,p.call.callId,true,{proposalRevision:revision},randomUUID());const [c]=await sql`SELECT * FROM assistant_tool_calls WHERE id=${p.call.callId}`;return c!;}
 for(const id of [externalId,internalIds[0]!])await t.test(id===externalId?"external image generation":"accepted image queue completes after pause with original attribution",async()=>{
  const before=submits,p=await propose(id,user.id,id!==externalId);assert.equal(submits,before);
  await sql`UPDATE assistant_tool_calls SET result=jsonb_set(result,'{normalized,commandInput,size}','"1:1"') || '{"approvalBlockedReason":"available credit is stale"}'::jsonb WHERE id=${p.call.callId}`;
  const stale=await sessionSnapshot(user.id,p.session.sessionId);assert.equal(stale.turn!.calls[0]!.imageParameters!.size,"1:1");assert.equal(stale.turn!.calls[0]!.approvalBlockedReason,"available credit is stale");assert(!Object.hasOwn(functionResult(stale.turn!.calls[0]!.result),"approvalBlockedReason"));
  const refreshed=await refreshCallQuote(user.id,p.session.sessionId,p.call.callId);assert.equal(refreshed.quote.amount,300);
  const repaired=await sessionSnapshot(user.id,p.session.sessionId);assert.equal(repaired.turn!.calls[0]!.imageParameters!.size,"4:5");assert.equal(repaired.turn!.calls[0]!.approvalBlockedReason,null);assert(!Object.hasOwn(functionResult(repaired.turn!.calls[0]!.result),"approvalBlockedReason"));
  const c=await approve(p,2);await approve(p,2);const [child]=await sql`SELECT * FROM operation_runs WHERE id=${c.child_run_id}`;assert.equal(child!.step_key,"redfox.image.submit");assert.equal(child!.input.assistantParentTurnId,p.turn.turnId);
  await advance(c.child_run_id);
  if(id === externalId) {
    const beforeStop=await sessionSnapshot(user.id,p.session.sessionId);
    await controlTurn(user.id,p.session.sessionId,p.turn.turnId,"stop",{generation:beforeStop.turn!.generation});
    const stopped=await sessionSnapshot(user.id,p.session.sessionId);assert.equal(stopped.turn!.status,"stopped");
    const [stoppedChild]=await sql`SELECT status FROM operation_runs WHERE id=${c.child_run_id}`;assert.equal(stoppedChild!.status,"stopped");
    await controlTurn(user.id,p.session.sessionId,p.turn.turnId,"resume",{generation:stopped.turn!.generation});
  }
  await advance(c.child_run_id);await advance(c.child_run_id);await advance(p.turn.runId);await recoverAssistantChildren(c.child_run_id);await advance(p.turn.runId);
  const snap=await sessionSnapshot(user.id,p.session.sessionId);assert.equal(snap.turn!.status,"completed");assert.equal(snap.artifacts.length,1);assert.equal(snap.artifacts[0]!.kind,"image");assert.ok(snap.artifacts[0]!.content.fileKey);assert(!JSON.stringify(snap.artifacts).includes("sourceUrl"));assert.equal(submits,before+1);
  assert.equal(snap.turn!.calls[0]!.imageParameters!.size,"4:5","completed history keeps the submitted image spec");assert(!Object.hasOwn(functionResult(snap.turn!.calls[0]!.result),"normalized"));
  const [turn]=await sql`SELECT t.*,s.owner_user_id FROM assistant_turns t JOIN assistant_sessions s ON s.id=t.session_id WHERE t.id=${p.turn.turnId}`;
  const again=await sql.begin(tx=>deliverImage(tx,turn!,c));assert.equal(again.artifactId,snap.artifacts[0]!.artifactId);
  await assert.rejects(editArtifact(user.id,p.session.sessionId,again.artifactId,{baseVersion:1,kind:"text-draft",content:{...snap.artifacts[0]!.content,prompt:undefined,resultId:undefined,fileKey:undefined,width:undefined,height:undefined,body:"非法改写"}}));
  const charges=await sql`SELECT amount,state FROM member_credit_charges WHERE root_run_id IN (${p.turn.runId},${c.child_run_id})`;assert.deepEqual(charges.map(r=>r.amount).sort((a,b)=>a-b),[7,300]);assert(charges.every(r=>r.state==="settled"));
  assert.deepEqual(await readFile(assetPath(snap.artifacts[0]!.content.fileKey!)),png,"deliverable is an actual local image file");
  const details=await costs({start:new Date(Date.now()-3600000).toISOString(),end:new Date(Date.now()+60000).toISOString(),view:"details",userId:String(user.id),skillId:id,moduleId:"generate"});
  assert.equal(details.view,"details");
  if(details.view==="details"){
    const childRows=details.rows.filter(row=>row.runId===c.child_run_id);
    assert.deepEqual(childRows.map(row=>row.service).sort(),["redfox.image","redfox.poll"]);
    for(const row of childRows){assert.equal(row.assistant.turnId,p.turn.turnId);assert.equal(row.assistant.attribution,"activated");assert.deepEqual(row.assistant.activations.map(a=>[a.skillId,a.moduleId,a.version]),[[id,"generate","1"]]);}
  }
  await sql`UPDATE stored_files SET status='deleting' WHERE key=${snap.artifacts[0]!.content.fileKey!}`;
  await assert.rejects(sql.begin(tx=>deliverImage(tx,turn!,c)),/尚未保存/);
 });
 await t.test("reject has no child and no external request",async()=>{const before=submits,p=await propose();await decideCall(user.id,p.session.sessionId,p.call.callId,false,{proposalRevision:1},randomUUID());const [c]=await sql`SELECT child_run_id FROM assistant_tool_calls WHERE id=${p.call.callId}`;assert.equal(c!.child_run_id,null);assert.equal(submits,before);});
 await t.test("lost submission stops without resending",async()=>{lose=true;const p=await propose(),c=await approve(p);await advance(c.child_run_id);const before=submits;await advance(c.child_run_id);assert.equal(submits,before);const [r]=await sql`SELECT status,current_receipt_id FROM operation_runs WHERE id=${c.child_run_id}`;assert.equal(r!.status,"needs_review");const [receipt]=await sql`SELECT status,attempts FROM receipts WHERE id=${r!.current_receipt_id}`;assert.equal(receipt!.status,"unknown");assert.equal(receipt!.attempts,1);lose=false;});
 assert.equal(polls,2);assert.equal(downloads,2);
 await t.test("child HTTP limit preserves task and credits through review, stop and resume",async()=>{
  const limited=await createSiteUser({username:`image_limit_${tag()}`,displayName:"Image limit fixture",password:"synthetic-password"},"test");
  await grantCredits(limited.id,{amount:1000,reason:"Synthetic limit fixture"},"test",randomUUID());
  inProgress=true;const beforeSubmits=submits,beforePolls=polls,p=await propose(externalId,limited.id),c=await approve(p);
  for(let i=0;i<21;i++)await advance(c.child_run_id);
  const [child]=await sql`SELECT * FROM operation_runs WHERE id=${c.child_run_id}`;
  assert.equal(child!.status,"needs_review");assert.match(child!.wait_reason,/child request limit exhausted/);
  assert.equal(child!.step_key,"redfox.image.poll");assert.equal(child!.progress.taskId,`synthetic-${beforeSubmits+1}`);
  assert.equal(child!.progress.externalAttempts,20);assert.equal(child!.progress.pollSequence,19);
  assert.equal(submits,beforeSubmits+1);assert.equal(polls,beforePolls+19);
  const receipts=await sql`SELECT a.receipt_id,a.status FROM receipt_attempts a WHERE a.operation_run_id=${c.child_run_id} ORDER BY a.id`;
  assert.equal(receipts.length,20);assert(receipts.every(r=>r.status==="received"));
  const counts=async()=> (await sql`SELECT (SELECT count(*) FROM operation_runs)::int runs,(SELECT count(*) FROM receipts)::int receipts,(SELECT count(*) FROM member_tool_quotes)::int quotes`)[0];
  const beforeRecovery=await counts();
  await assert.rejects(normalizeToolInput(`user:${limited.id}`,"images/query",{runId:c.child_run_id}),/原助手会话/);
  await assert.rejects(quoteUserTool(limited.id,{kind:"images/query",input:{runId:c.child_run_id}}),/原助手会话/);
  await assert.rejects(sql.begin(tx=>createRun(tx,{actor:`user:${limited.id}`,commandKey:randomUUID(),provider:"redfox",operationKey:"redfox.image.query",contractVersion:1,input:{},stepKey:"redfox.image.poll",authorization:{quoteId:randomUUID(),intent:{kind:"images/query",provider:"redfox",input:{},recoveryRunId:c.child_run_id}}})),/原助手会话/);
  assert.equal((await userToolDetail(limited.id,c.child_run_id)).recoveryKind,null);
  assert.deepEqual(await counts(),beforeRecovery);
  // The same owned standalone image retains the existing recovery normalization, without making a new run.
  await sql.begin(async tx=>{await tx`UPDATE operation_runs SET input=input-'assistantParentTurnId' WHERE id=${c.child_run_id}`;});
  try { const standalone=await normalizeToolInput(`user:${limited.id}`,"images/query",{runId:c.child_run_id});assert.equal(standalone.commandInput.taskId,child!.progress.taskId); }
  finally { await sql`UPDATE operation_runs SET input=${sql.json(child!.input)} WHERE id=${c.child_run_id}`; }
  let snap=await sessionSnapshot(limited.id,p.session.sessionId);
  assert(snap.turn!.activities!.some(a=>a.kind==="generate_image"&&a.state==="needs_review"));
  await recoverAssistantChildren(c.child_run_id);await advance(p.turn.runId);
  snap=await sessionSnapshot(limited.id,p.session.sessionId);assert.equal(snap.turn!.status,"needs_review");
  const charges=await sql`SELECT id,amount,state,consumed,released FROM member_credit_charges WHERE user_id=${limited.id} ORDER BY root_run_id`;
  assert.deepEqual(charges.map(r=>Number(r.amount)),[7,300]);assert(charges.every(r=>r.state==="review"&&Number(r.consumed)===0&&Number(r.released)===0));
  const [wallet]=await sql`SELECT available,reserved FROM member_credit_accounts WHERE user_id=${limited.id}`;
  assert.equal(Number(wallet!.available),693);assert.equal(Number(wallet!.reserved),307);
  await controlTurn(limited.id,p.session.sessionId,p.turn.turnId,"stop",{generation:snap.turn!.generation});
  snap=await sessionSnapshot(limited.id,p.session.sessionId);
  await controlTurn(limited.id,p.session.sessionId,p.turn.turnId,"resume",{generation:snap.turn!.generation});
  await advance(c.child_run_id);await advance(p.turn.runId);
  const [again]=await sql`SELECT status,progress FROM operation_runs WHERE id=${c.child_run_id}`;
  assert.equal(again!.status,"needs_review");assert.equal(again!.progress.taskId,child!.progress.taskId);
  assert.equal(submits,beforeSubmits+1);assert.equal(polls,beforePolls+19);
  assert.deepEqual(await sql`SELECT id,amount,state,consumed,released FROM member_credit_charges WHERE user_id=${limited.id} ORDER BY root_run_id`,charges);
  assert.deepEqual((await sql`SELECT available,reserved FROM member_credit_accounts WHERE user_id=${limited.id}`)[0],wallet);
  const [entries]=await sql`SELECT count(*)::int n FROM member_credit_entries WHERE user_id=${limited.id} AND kind='reserve'`;assert.equal(entries!.n,2);
  const [count]=await sql`SELECT child_calls FROM assistant_turns WHERE id=${p.turn.turnId}`;assert.equal(count!.child_calls,20);
  inProgress=false;
 });
 await t.test("invalid image parameters return a correctable tool result before quote or external call",async()=>{
  invalidRatio=true;chosen="ai-image-generator";
  const isolated=await createSiteUser({username:`image_invalid_${tag()}`,displayName:"Invalid ratio",password:"synthetic-password"},"test");
  await grantCredits(isolated.id,{amount:1000,reason:"Synthetic invalid ratio fixture"},"test",randomUUID());
  const session=await createSession(isolated.id,{assistantId:"creative"},randomUUID()),raw={message:"生成7:5图片",expectedRevision:1,skillSelection:{actionId:chosen}};
  const quote=await quoteTurn(isolated.id,session.sessionId,raw),turn=await submitTurn(isolated.id,session.sessionId,{...raw,quoteId:quote.quoteId},randomUUID());
  const before=submits,quoteCount=(await sql`SELECT count(*)::int n FROM member_tool_quotes WHERE user_id=${isolated.id}`)[0]!.n;
  for(let i=0;i<4;i++)await advance(turn.runId);
  const [call]=await sql`SELECT * FROM assistant_tool_calls WHERE turn_id=${turn.turnId} AND name='generate_image'`;
  assert.equal(call!.state,"failed");assert.equal(call!.result.error,"invalid_tool_arguments");assert.equal(call!.quote,null);assert.equal(call!.child_run_id,null);
  assert.equal(submits,before);assert.equal((await sql`SELECT count(*)::int n FROM member_tool_quotes WHERE user_id=${isolated.id}`)[0]!.n,quoteCount);
  invalidRatio=false;
 });
 }finally{
  for(const id of ids){const old=policies.find(p=>p.key===`assistant.skills.${id}`);if(old)await sql`UPDATE settings SET value=${sql.json(old.value)} WHERE key=${old.key}`;else await sql`DELETE FROM settings WHERE key=${`assistant.skills.${id}`}`;}
  for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;
  await sql`UPDATE member_tool_prices SET enabled=false WHERE model=${model}`;
  await sql`UPDATE member_tool_prices SET enabled=false WHERE kind='images' AND model='gptImage2'`;
  for(const p of imagePrices)await sql`UPDATE member_tool_prices SET enabled=${p.enabled},base_credits=${p.base_credits},version=${p.version} WHERE id=${p.id}`;
  process.env.MODEL_CALLS_ENABLED="false";process.env.REDFOX_CALLS_ENABLED="false";config.dataDir=oldDir;config.allowPrivateNetworkFetch=oldPrivate;
  await modelStub.close();await new Promise<void>(r=>server.close(()=>r()));await restore();await stopBoss();await closeDb();await rm(dir,{recursive:true,force:true});
 }
});

const quoteTurn=(userId:number,sessionId:string,raw:unknown)=>quoteLegacyTurn(userId,sessionId,raw,{"image-generator": "1", "claude-image-generation": "1", "ai-image-generator": "1"});
