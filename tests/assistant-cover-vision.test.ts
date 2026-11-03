import { allowTestBudgetScope,assertConfiguredTestDatabase,tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID,createHash } from "node:crypto";
import http from "node:http";
import sharp from "sharp";
import { sql,closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits,saveToolPrice,quoteTool,settleForRun } from "@aihot/backend/users/credits";
import { createRun,resumeRun } from "@aihot/backend/providers/operations/store";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { coverVisionModel,coverVisionCredential } from "@aihot/backend/assistant/cover-vision-model";
import { coverVisionIntent,createCoverVisionTx,coverVisionResults } from "@aihot/backend/assistant/cover-vision";
import { COVER_PREPROCESS_VERSION,CoverObservation,type VisionInput } from "@aihot/backend/assistant/cover-vision-contract";
import { controlTurn } from "@aihot/backend/assistant/controls";
import { createSession,sessionSnapshot } from "@aihot/backend/assistant/sessions";
import { assetPath,getAsset,deleteAsset,cleanupAssets } from "@aihot/backend/operations/assets";
import { readFile } from "node:fs/promises";
import { MODELS } from "@aihot/backend/providers/llm";
after(closeDb);

test("DeepSeek Flash presets expose the shared base model's image input capability",()=>{
 for(const key of ["deepseek-flash","deepseek-flash-think"]){
  assert.equal(MODELS[key]!.model,"deepseek-flash");
  assert.equal(MODELS[key]!.vision,true);
  assert.equal(MODELS[key]!.baseUrlEnv,"DEEPSEEK_BASE_URL");
 }
});
test("admin accepts DeepSeek Flash for text and vision while refusing text-only vision selection",async()=>{
 const [db]=await sql`SELECT current_database() name,inet_server_port() port`;assertConfiguredTestDatabase(db!.name,db!.port);
 const {switchModel}=await import('@aihot/backend/admin/models');
 const {invalidateModelCache}=await import('@aihot/backend/editorial/models');
 const keys=['models.assistant','models.assistantCoverVision'];
 const previous=await sql`SELECT key,value,updated_by FROM settings WHERE key IN ${sql(keys)}`;
 try {
  for(const capability of ['assistant','assistantCoverVision'])assert.equal((await switchModel(capability,'deepseek-flash','Synthetic capability regression','test')).after!.model,'deepseek-flash');
  await assert.rejects(switchModel('assistantCoverVision','glm-5.3-flash','Synthetic capability regression','test'),/needs a vision model/);
 }finally{
  await sql`DELETE FROM settings WHERE key IN ${sql(keys)}`;
  for(const row of previous)await sql`INSERT INTO settings(key,value,updated_by) VALUES(${row.key},${sql.json(row.value)},${row.updated_by})`;
  invalidateModelCache();
 }
});

test("observed missing uncertainty notes stays explicitly uncertain; unreadable still needs an actual reason",()=>{
 const observed={sourceId:'synthetic-source',status:'observed',text:'',subject:'橙色矩形',colors:'橙色',layout:'居中'};
 assert.deepEqual(CoverObservation.parse(observed).uncertainties,['模型未提供不确定项说明']);
 for(const uncertainties of [null,'',123,{}])assert(!CoverObservation.safeParse({...observed,uncertainties}).success);
 assert(!CoverObservation.safeParse({...observed,status:'unreadable'}).success);
 assert(!CoverObservation.safeParse({...observed,status:'unreadable',uncertainties:[]}).success);
 assert(!CoverObservation.safeParse({...observed,subject:'',colors:'',layout:''}).success);
 assert(!CoverObservation.safeParse({...observed,sourceId:''}).success);
 assert(!CoverObservation.safeParse({...observed,status:'guessed'}).success);
 assert.equal(CoverObservation.parse({...observed,status:'unreadable',uncertainties:['图片过于模糊']}).status,'unreadable');
});
test("observation evidence requires real fields and bounds all twenty projected identities",()=>{
 const blank={sourceId:"s",status:"observed",text:" ",subject:"",colors:"",layout:"",uncertainties:[]};assert(!CoverObservation.safeParse(blank).success);assert(!CoverObservation.safeParse({...blank,status:"unreadable"}).success);
 const observations=Array.from({length:20},(_,i)=>({sourceId:`${i}-`+"x".repeat(190),status:"observed",text:"字".repeat(1200),subject:"字".repeat(500),colors:"字".repeat(500),layout:"字".repeat(1000),uncertainties:Array(8).fill("字".repeat(200))}));
 assert.throws(()=>coverVisionResults([{id:1,kind:"assistant_vision_report",data:{complete:true,observedCount:20,selectedCount:20,analyzedCount:20,failed:[],observations}}]),/容量/);
 observations.forEach((o,i)=>o.sourceId=`cover:${String(i).padStart(24,"0")}`);
 const result=coverVisionResults([{id:1,kind:"assistant_vision_report",data:{complete:true,observedCount:20,selectedCount:20,analyzedCount:20,failed:[],observations}}]);assert.equal(result.observations.length,20);assert(JSON.stringify(result).length<=6000);assert(result.observations.every(o=>o.truncated&&o.sourceId.startsWith("cover:")&&o.status==="observed"));
});
test("cover vision executes real frozen bytes and settles only a validated report",async t=>{
 const [db]=await sql`SELECT current_database() name,inet_server_port() port`;assertConfiguredTestDatabase(db!.name,db!.port);
 const oldBudget=(await sql`SELECT * FROM budgets WHERE service='assistant.vision'`)[0];
 await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES ('assistant.vision',1000,10000,100000) ON CONFLICT(service) DO UPDATE SET per_minute=1000,per_hour=10000,per_day=100000`;
 const restore=await allowTestBudgetScope(["assistant.vision"],"member"),previous=config.allowPrivateNetworkFetch,model=`cover-vision-${tag()}`;
 const image=await sharp({create:{width:1800,height:2400,channels:3,background:{r:230,g:120,b:50}}}).png().toBuffer();
 let imageHits=0,modelHits=0,mode="normal";const actual:any[]=[];
 const server=http.createServer((req,res)=>{if(req.url!.startsWith("/image/")){imageHits++;if(mode==="download"||mode==="partial"&&req.url!.endsWith("/1")){res.writeHead(503);res.end();return;}res.writeHead(200,{"content-type":"image/png"});res.end(image);return;}let text="";req.on("data",c=>text+=c);req.on("end",()=>{
  modelHits++;const body=JSON.parse(text);actual.push(body);if(mode==="unknown"){req.socket.destroy();return;}
  const content=body.messages[0].content,ids=content.filter((c:any)=>c.type==="text"&&c.text.startsWith("sourceId: ")).map((c:any)=>c.text.slice(10));
  const observations=ids.map((sourceId:string)=>({sourceId,status:mode==="unreadable"?"unreadable":"observed",text:"",subject:mode==="empty"?"":"橙色矩形",colors:mode==="empty"?"":"橙色",layout:mode==="empty"?"":"纯色画面",...(mode==="missing-uncertainties"?{}:{uncertainties:["无可读文字"]})}));
  res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({choices:[{finish_reason:mode==="length"?"length":"stop",message:{content:mode==="invalid"?"not JSON":JSON.stringify({observations})}}],...(mode==="no-usage"?{}:{usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}})}));
 });});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 Object.assign(process.env,{ASSISTANT_ENABLED:"true",LLM_MODEL:model,LLM_VISION:"true",LLM_BASE_URL:base+"/v1",LLM_API_KEY:"synthetic-key",ASSISTANT_COVER_VISION_MODEL:"default",ASSISTANT_CALLS_ENABLED:"true",MODEL_CALLS_ENABLED:"true"});config.allowPrivateNetworkFetch=true;
 const step=async(id:number)=>{const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,randomUUID());};
 try {
  await sql`INSERT INTO service_prices(service,model,currency,input_per_mtok,output_per_mtok,source_url) VALUES ('llm',${model},'CNY',1,2,'http://localhost/synthetic-vision-cost')`;
  await saveToolPrice({kind:"query",provider:"redfox",model,baseCredits:3,enabled:true,reason:"Synthetic completed research"},"test");
  await saveToolPrice({kind:"assistant-turn",provider:"assistant",model,baseCredits:7,enabled:true,reason:"Synthetic vision parent"},"test");
  await saveToolPrice({kind:"assistant-vision",provider:"assistant",model,baseCredits:11,referenceCredits:7,enabled:true,reason:"Synthetic vision fixture"},"test");
  const user=await createSiteUser({username:`vision_${tag()}`,displayName:"Vision fixture",password:"synthetic-password"},"test");await grantCredits(user.id,{amount:1000,reason:"Synthetic vision fixture"},"test",randomUUID());
  async function fixture(count:number){
   const member=await createSiteUser({username:`visioncase_${tag()}`,displayName:"Vision case",password:"synthetic-password"},"test");await grantCredits(member.id,{amount:1000,reason:"Synthetic case"},"test",randomUUID());
   const user=member;
   const {sessionId}=await createSession(user.id,{assistantId:"creative"},randomUUID()),turnId=randomUUID(),stepId=randomUUID(),activationId=randomUUID();
   const intent={kind:"assistant-turn" as const,provider:"assistant",model,input:{turnId}},quote=await quoteTool(user.id,intent);
   const parent=await sql.begin(tx=>createRun(tx,{actor:`user:${user.id}`,commandKey:tag(),provider:"assistant",operationKey:"assistant.turn",contractVersion:1,stepKey:"assistant.turn.model",input:{turnId},authorization:{quoteId:quote.quoteId,intent}}));
   await sql`INSERT INTO assistant_turns(id,session_id,parent_operation_run_id,command_key,command_hash,snapshot) VALUES (${turnId},${sessionId},${parent.id},${tag()},'fixture','{}')`;
   await sql`UPDATE assistant_sessions SET active_turn_id=${turnId} WHERE id=${sessionId}`;
   await sql`INSERT INTO assistant_model_steps(id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash) VALUES (${stepId},${turnId},1,1,'{}','fixture')`;
   await sql`INSERT INTO assistant_activations(id,turn_id,model_step_id,identity_hash,candidate) VALUES (${activationId},${turnId},${stepId},'fixture','{}')`;
   // This is a legacy accepted turn: its completed research still needs its own authorization.
   const queryIntent={kind:'query' as const,provider:'redfox',model,input:{operationId:'xhs.coverResearch'}};
   const queryQuote=await quoteTool(user.id,queryIntent);
   const query=await sql.begin(async tx=>{
    const run=await createRun(tx,{actor:`user:${user.id}`,commandKey:tag(),provider:'redfox',operationKey:'redfox.sync.query',contractVersion:1,input:{members:[],operationId:'xhs.coverResearch'},stepKey:'redfox.sync.query',authorization:{quoteId:queryQuote.quoteId,intent:queryIntent}});
    await tx`INSERT INTO operation_results(run_id,step_version,item_key,kind,data) VALUES(${run.id},1,'summary','query_summary','{}')`;
    await tx`UPDATE operation_runs SET status='completed' WHERE id=${run.id}`;
    await settleForRun(tx,{runId:run.id,outcome:'completed'});
    return run;
   });
   await sql`INSERT INTO assistant_tool_calls(id,turn_id,model_step_id,ordinal,upstream_id,name,input,state,child_run_id) VALUES (${randomUUID()},${turnId},${stepId},1,'query','search_xhs_covers','{}','completed',${query!.id})`;
   const selections=[];for(let i=0;i<count;i++){const sourceId=`sample-${i}`,coverUrl=`${base}/image/${turnId}/${i}`;const [r]=await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data) VALUES (${query!.id},1,${sourceId},'xhs_cover_candidate',${sql.json({sourceId,coverUrl})}) RETURNING id`;selections.push({resultId:r!.id,sourceId,coverUrl,reason:"相关主题"});}
   const input:VisionInput={assistantParentTurnId:turnId,activationId,queryRunId:query!.id,selections,model:await coverVisionModel(),preprocessVersion:COVER_PREPROCESS_VERSION},visionIntent=coverVisionIntent(input),visionQuote=await quoteTool(user.id,visionIntent);
   const run=await sql.begin(tx=>createCoverVisionTx(tx,input,`user:${user.id}`,tag(),{quoteId:visionQuote.quoteId,intent:visionIntent}));
   await sql`INSERT INTO assistant_tool_calls(id,turn_id,model_step_id,ordinal,upstream_id,name,input,state,child_run_id,activation_id) VALUES (${randomUUID()},${turnId},${stepId},2,'vision','analyze_xhs_covers','{}','running',${run.id},${activationId})`;
   return {run,parent,turnId,sessionId,userId:user.id,input,quote:visionQuote};
  }
  const one=await fixture(1);assert.equal(one.quote.amount,11);await step(one.run.id);assert.equal(imageHits,1);assert.equal(modelHits,0);await step(one.run.id);
  const [done]=await sql`SELECT status FROM operation_runs WHERE id=${one.run.id}`;assert.equal(done!.status,"completed");assert.equal(modelHits,1);
  const rows=await sql`SELECT id,kind,data,file_key FROM operation_results WHERE run_id=${one.run.id}`;const report=coverVisionResults(rows as any);assert.equal(report.observedCount,1);
  const reference=rows.find(r=>r.kind==="assistant_cover_reference")!,asset=await getAsset(reference.file_key),bytes=await readFile(assetPath(asset.key));assert.equal(asset.metadata.origin,"assistant-cover-reference");assert.equal(createHash("sha256").update(bytes).digest("hex"),reference.data.sha256);
  const sent=actual[0].messages[0].content.find((c:any)=>c.type==="image_url").image_url.url;assert.deepEqual(Buffer.from(sent.split(",")[1],"base64"),bytes);
  const meta=await sharp(bytes).metadata();assert(Math.max(meta.width!,meta.height!)<=1200);assert(bytes.length<=1048576);assert.equal(actual[0].max_tokens,4096);
  const [charge]=await sql`SELECT c.state,c.consumed FROM member_credit_charges c JOIN member_credit_run_links l ON l.charge_id=c.id WHERE l.run_id=${one.run.id}`;assert.equal(charge!.state,"settled");assert.equal(charge!.consumed,11);
  const costs=await sql`SELECT a.owner_kind,a.owner_user_id,a.budget_scope,a.service,a.model,a.cost FROM receipt_attempts a JOIN operation_results z ON z.receipt_id=a.receipt_id WHERE z.run_id=${one.run.id}`;assert(costs.length);assert(costs.every(c=>c.owner_kind==="member"&&c.owner_user_id===one.userId&&c.budget_scope==="member"&&c.service==="assistant.vision"&&c.model===model&&Number(c.cost)>0));
  await t.test("private references survive 30 days while stopped, then expire after the parent finishes",async()=>{
   await controlTurn(one.userId,one.sessionId,one.turnId,"stop",{generation:0});
   await sql`UPDATE stored_files SET expires_at=now()-interval '31 days' WHERE key=${asset.key}`;
   assert.equal((await getAsset(asset.key)).status,"available");await assert.rejects(deleteAsset(asset.key),/active or recoverable/);
   await cleanupAssets();assert.equal((await getAsset(asset.key)).status,"available");
   await sql`UPDATE operation_runs SET status='completed' WHERE id=${one.parent.id}`;
   await assert.rejects(getAsset(asset.key),/expired/);await cleanupAssets();assert.equal((await sql`SELECT status FROM stored_files WHERE key=${asset.key}`)[0]!.status,"deleted");
  });
  await t.test("20 images use four bounded preparation steps and four paid batches; both stops reuse frozen files",async()=>{
   const beforeImages=imageHits,beforeCalls=modelHits,f=await fixture(20);assert.equal(f.quote.amount,11);
   for(let n=0;n<2;n++){await step(f.run.id);assert.equal(imageHits-beforeImages,(n+1)*5);assert.equal(modelHits,beforeCalls);}
   await controlTurn(f.userId,f.sessionId,f.turnId,"stop",{generation:0});await step(f.run.id);assert.equal(imageHits-beforeImages,10);
   let [parent]=await sql`SELECT generation FROM operation_runs WHERE id=${f.parent.id}`;await controlTurn(f.userId,f.sessionId,f.turnId,"resume",{generation:parent!.generation});
   for(let n=2;n<4;n++){await step(f.run.id);assert.equal(imageHits-beforeImages,(n+1)*5);}
   let [state]=await sql`SELECT step_key,step_version,progress FROM operation_runs WHERE id=${f.run.id}`;assert.equal(state!.step_key,"assistant.coverVision.batch");assert.equal(state!.step_version,5);assert.equal(state!.progress.batches.length,4);
   await step(f.run.id);await step(f.run.id);assert.equal(modelHits-beforeCalls,2);
   [parent]=await sql`SELECT generation FROM operation_runs WHERE id=${f.parent.id}`;await controlTurn(f.userId,f.sessionId,f.turnId,"stop",{generation:parent!.generation});await step(f.run.id);assert.equal(modelHits-beforeCalls,2);
   [parent]=await sql`SELECT generation FROM operation_runs WHERE id=${f.parent.id}`;await controlTurn(f.userId,f.sessionId,f.turnId,"resume",{generation:parent!.generation});
   await step(f.run.id);await step(f.run.id);assert.equal(modelHits-beforeCalls,4);assert.equal(imageHits-beforeImages,20);
   const [final]=await sql`SELECT status FROM operation_runs WHERE id=${f.run.id}`;assert.equal(final!.status,"completed");
   for(const request of actual.slice(beforeCalls)){const images=request.messages[0].content.filter((c:any)=>c.type==="image_url");assert.equal(images.length,5);assert(images.reduce((n:number,c:any)=>n+Buffer.from(c.image_url.url.split(",")[1],"base64").length,0)<=5242880);}
   const [counter]=await sql`SELECT child_calls FROM assistant_turns WHERE id=${f.turnId}`;assert.equal(counter!.child_calls,4);
   await sql`UPDATE operation_runs SET status='completed' WHERE id=${f.parent.id}`;
  });
  for(const failure of ["invalid","unknown","empty","length","unreadable"])await t.test(`${failure} response cannot settle or reissue`,async()=>{
   mode=failure;const f=await fixture(1);await step(f.run.id);await step(f.run.id);
   const [failed]=await sql`SELECT * FROM operation_runs WHERE id=${f.run.id}`;assert.equal(failed!.status,"needs_review");const before=modelHits;
   await sql.begin(tx=>resumeRun(tx,{runId:f.run.id,stepVersion:failed!.step_version,generation:failed!.generation}));await step(f.run.id);assert.equal(modelHits,before);
   const [charge]=await sql`SELECT c.state,c.consumed FROM member_credit_charges c JOIN member_credit_run_links l ON l.charge_id=c.id WHERE l.run_id=${f.run.id}`;assert.notEqual(charge!.state,"settled");assert.equal(charge!.consumed,0);
   const reports=await sql`SELECT id FROM operation_results WHERE run_id=${f.run.id} AND kind='assistant_vision_report'`;assert.equal(reports.length,0);
   const [receipt]=await sql`SELECT attempts FROM receipts WHERE id=${failed!.current_receipt_id}`;assert.equal(receipt!.attempts,1);
   await sql`UPDATE operation_runs SET status='stopped' WHERE id=${f.parent.id}`;
  });
  mode="normal";
  await t.test("received observed bytes without uncertainty notes survive a failed report commit without another HTTP",async()=>{
   mode="missing-uncertainties";
   const f=await fixture(1);await step(f.run.id);const before=modelHits;
   await sql.unsafe("CREATE FUNCTION assistant_test_fail_vision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='assistant_vision_report' THEN RAISE EXCEPTION 'synthetic report commit interruption'; END IF; RETURN NEW; END $$");
   await sql.unsafe("CREATE TRIGGER assistant_test_fail_vision BEFORE INSERT ON operation_results FOR EACH ROW EXECUTE FUNCTION assistant_test_fail_vision()");
   try{await step(f.run.id);}finally{await sql.unsafe("DROP TRIGGER assistant_test_fail_vision ON operation_results");await sql.unsafe("DROP FUNCTION assistant_test_fail_vision()");}
   const [r]=await sql`SELECT * FROM operation_runs WHERE id=${f.run.id}`;assert.equal(r!.status,"needs_review");assert.equal(modelHits,before+1);
   const [receipt]=await sql`SELECT status,response FROM receipts WHERE id=${r!.current_receipt_id}`;assert.equal(receipt!.status,"received");
   await sql.begin(tx=>resumeRun(tx,{runId:r!.id,stepVersion:r!.step_version,generation:r!.generation}));await step(f.run.id);assert.equal(modelHits,before+1);assert.equal((await sql`SELECT status FROM operation_runs WHERE id=${f.run.id}`)[0]!.status,"completed");
   assert.deepEqual((await sql`SELECT response FROM receipts WHERE id=${r!.current_receipt_id}`)[0]!.response,receipt!.response);
  });
  await t.test("zero downloadable images do not settle; partial observations report the actual denominator",async()=>{
   mode="download";const zero=await fixture(1),before=modelHits;await step(zero.run.id);assert.equal(modelHits,before);
   assert.equal((await sql`SELECT status FROM operation_runs WHERE id=${zero.run.id}`)[0]!.status,"needs_review");
   mode="partial";const partial=await fixture(2);await step(partial.run.id);await step(partial.run.id);
   const [report]=await sql`SELECT data FROM operation_results WHERE run_id=${partial.run.id} AND kind='assistant_vision_report'`;
   assert.equal(report!.data.selectedCount,2);assert.equal(report!.data.observedCount,1);assert.equal(report!.data.failed.length,1);
   const [charge]=await sql`SELECT c.state,c.consumed FROM member_credit_charges c JOIN member_credit_run_links l ON l.charge_id=c.id WHERE l.run_id=${partial.run.id}`;assert.equal(charge!.state,"settled");assert.equal(charge!.consumed,11);
  });
  mode="normal";
  await t.test("missing exact costs, member price or vision budget prevents downloads and model calls",async()=>{
   const beforeImages=imageHits,beforeCalls=modelHits;
   await sql`DELETE FROM service_prices WHERE service='llm' AND model=${model}`;
   await assert.rejects(fixture(1),/精确供应商成本/);
   await sql`INSERT INTO service_prices(service,model,currency,input_per_mtok,output_per_mtok,source_url) VALUES ('llm',${model},'CNY',1,2,'http://localhost/synthetic-vision-cost')`;
   await sql`UPDATE member_tool_prices SET enabled=false WHERE kind='assistant-vision' AND model=${model}`;
   await assert.rejects(fixture(1),/尚未设置积分价格/);
   await sql`UPDATE member_tool_prices SET enabled=true WHERE kind='assistant-vision' AND model=${model}`;
   await sql`UPDATE budgets SET per_day=0 WHERE service='assistant.vision'`;
   await assert.rejects(fixture(1));await sql`UPDATE budgets SET per_day=100000 WHERE service='assistant.vision'`;
   assert.equal(imageHits,beforeImages);assert.equal(modelHits,beforeCalls);
  });
  await t.test("frozen endpoint rejects changes, allows key rotation and ignores a new capability choice",async()=>{
   const snapshot=await coverVisionModel();process.env.ASSISTANT_COVER_VISION_MODEL="qwen3-vl-flash";
   assert.equal(coverVisionCredential(snapshot),"synthetic-key");process.env.LLM_API_KEY="rotated-synthetic";assert.equal(coverVisionCredential(snapshot),"rotated-synthetic");
   process.env.LLM_BASE_URL=base+"/changed";assert.throws(()=>coverVisionCredential(snapshot),/端点/);
   process.env.LLM_BASE_URL=base+"/v1";process.env.LLM_API_KEY="synthetic-key";process.env.ASSISTANT_COVER_VISION_MODEL="default";
  });
  await t.test("missing usage remains unknown cost rather than zero",async()=>{
   mode="no-usage";const f=await fixture(1);await step(f.run.id);await step(f.run.id);
   const [cost]=await sql`SELECT a.cost,a.usage,a.price_snapshot FROM receipt_attempts a JOIN operation_results z ON z.receipt_id=a.receipt_id WHERE z.run_id=${f.run.id} LIMIT 1`;
   assert.equal(cost!.cost,null);assert.equal(cost!.usage,null);assert.equal(cost!.price_snapshot.service,"llm");assert.equal(cost!.price_snapshot.model,model);mode="normal";
  });
  await t.test("public snapshot strips the frozen vision endpoint and exposes only the count summary",async()=>{
   const f=await fixture(1);await sql`UPDATE assistant_tool_calls SET result=${sql.json({normalized:{commandInput:f.input,intent:coverVisionIntent(f.input)},approvalBlockedReason:"请核对报价"} as never)} WHERE child_run_id=${f.run.id}`;
   const snapshot=await sessionSnapshot(f.userId,f.sessionId),call=snapshot.turn!.calls.find(c=>c.name==="analyze_xhs_covers")!;
   assert.equal(call.approvalBlockedReason,"请核对报价");assert.deepEqual(call.result,{selectedCount:1,maxImages:20,batchImages:5,maxBatches:4});assert(!JSON.stringify(snapshot).includes("apiKeyEnv"));assert(!JSON.stringify(snapshot).includes(base));
  });
 }finally{
  await sql`UPDATE member_tool_prices SET enabled=false WHERE model=${model}`;await sql`DELETE FROM service_prices WHERE service='llm' AND model=${model}`;
  await restore();if(oldBudget)await sql`UPDATE budgets SET per_minute=${oldBudget.per_minute},per_hour=${oldBudget.per_hour},per_day=${oldBudget.per_day} WHERE service='assistant.vision'`;else await sql`DELETE FROM budgets WHERE service='assistant.vision'`;
  config.allowPrivateNetworkFetch=previous;process.env.MODEL_CALLS_ENABLED="false";process.env.ASSISTANT_CALLS_ENABLED="false";await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();
 }
});
