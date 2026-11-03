import { additionalFeeKinds } from "@aihot/backend/assistant/catalog";
import { quoteTool } from "@aihot/backend/users/credits";
import { allowTestBudgetScope, assertConfiguredTestDatabase, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, saveToolPrice, reconcileCreditCharge } from "@aihot/backend/users/credits";
import { createSession,snapshotInput,submitTurn } from "@aihot/backend/assistant/sessions";
import { prepareSearch,autoApproveSearch,decideCall,refreshCallQuote } from "@aihot/backend/assistant/tools";
import { command } from "@aihot/backend/assistant/store";
import { ownedTurn } from "@aihot/backend/assistant/controls";
import { controlTurn } from "@aihot/backend/assistant/controls";
import { candidates,resolveCandidate } from "@aihot/backend/assistant/catalog";
import { updateAssistantSkill, readSkillPolicies } from "@aihot/backend/assistant/skill-policy";
import { TurnInput } from "@aihot/backend/assistant/config";
import { feeSettings,setFeeAuthorization } from "@aihot/backend/assistant/fees";

test("strict skill selection and explicit empty selections",async()=>{
 const manual=await candidates("creative",{actionId:"xiaohongshu-rewrite"});
 assert.deepEqual(manual.map(c=>c.moduleId),["M2"]);
 await assert.rejects(()=>resolveCandidate(manual,"xiaohongshu-creator","M1"));
 await assert.rejects(()=>candidates("xiaohongshu",{actionId:"general-writing"}));
 assert.equal((await candidates("creative")).length,8);
 const base={message:"材料",expectedRevision:1};
 assert.equal(TurnInput.parse(base).inputIds,undefined);
 assert.deepEqual(TurnInput.parse({...base,inputIds:[],artifactVersions:[]}).inputIds,[]);
 assert.throws(()=>TurnInput.parse({...base,inputIds:Array.from({length:11},()=>randomUUID())}));
});

test("automatic fee admission freezes input, serializes replay, counts all versions and releases",async()=>{
 const [db]=await sql`SELECT current_database() name,inet_server_port() port`;
 assertConfiguredTestDatabase(db!.name,db!.port);
 const restore=await allowTestBudgetScope(["assistant.text","redfox.query"],"member");
 const unique=tag(),model=`input-fees-${unique}`;
 Object.assign(process.env,{REDFOX_CALLS_ENABLED:"true",REDFOX_API_KEY:"synthetic-no-network",ASSISTANT_ENABLED:"true",ASSISTANT_CALLS_ENABLED:"true",ASSISTANT_MODEL_VERIFIED:"true",ASSISTANT_MODEL:"default",LLM_MODEL:model,LLM_BASE_URL:"http://127.0.0.1:1/v1",LLM_API_KEY:"synthetic-no-network",ASSISTANT_TOKENIZER:"cl100k_base",MODEL_CALLS_ENABLED:"true"});
 try{
 await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('assistant.text','redfox.query')`;
 await saveToolPrice({kind:"assistant-turn",provider:"assistant",model,baseCredits:200,enabled:true,reason:"Input fee fixture"},"test");
 const user=await createSiteUser({username:`inputfee_${unique}`,displayName:"Input fee",password:"synthetic-input-fee-password"},"test");
 await grantCredits(user.id,{amount:2000,reason:"Input fee fixture"},"test",randomUUID());
 const {sessionId}=await createSession(user.id,{assistantId:"creative"},randomUUID());
 await sql`INSERT INTO assistant_session_inputs(id,session_id,text,hash,source) VALUES (${randomUUID()},${sessionId},'old input','fixture','{}')`;
 const prices=(await feeSettings(user.id,sessionId)).prices;
 let auth=(await setFeeAuthorization(user.id,sessionId,{enabled:true,expectedVersion:0,totalLimit:200,allowSearch:false,turnPrice:prices.turn,searchPrice:null})).authorization!;
 const input={message:"生成文章",expectedRevision:1,inputIds:[],artifactVersions:[],skillSelection:{actionId:"general-writing"},autoAuthorizationId:auth.id};
 const quote=await quoteTurn(user.id,sessionId,input), key=randomUUID();
 const runs=await Promise.all([submitTurn(user.id,sessionId,{...input,quoteId:quote.quoteId},key),submitTurn(user.id,sessionId,{...input,quoteId:quote.quoteId},key)]);
 assert.equal(runs[0]!.runId,runs[1]!.runId);
 const [turn]=await sql`SELECT snapshot FROM assistant_turns WHERE id=${runs[0]!.turnId}`;
 assert.deepEqual(turn!.snapshot.selected,[]);
 assert.equal(turn!.snapshot.candidates.length,1);
 assert.equal((await feeSettings(user.id,sessionId)).authorization!.used,200);
 await setFeeAuthorization(user.id,sessionId,{enabled:false,expectedVersion:1});
 auth=(await setFeeAuthorization(user.id,sessionId,{enabled:true,expectedVersion:1,totalLimit:1000,allowSearch:false,turnPrice:prices.turn,searchPrice:null})).authorization!;
 assert.equal(auth.remaining,800);
 await controlTurn(user.id,sessionId,runs[0]!.turnId,"stop",{generation:0});
 assert.equal((await feeSettings(user.id,sessionId)).authorization!.remaining,800,"stop retains unresolved reservation");
 const [charge]=await sql`SELECT charge_id FROM member_credit_run_links WHERE run_id=${runs[0]!.runId}`;
 await reconcileCreditCharge(charge!.charge_id,{consume:0,reason:"Synthetic no-call release"},"test",randomUUID());
 assert.equal((await feeSettings(user.id,sessionId)).authorization!.remaining,1000);
 const stale={...input,expectedRevision:2};
 const staleQuote=await quoteTurn(user.id,sessionId,stale);
 await assert.rejects(()=>submitTurn(user.id,sessionId,{...stale,quoteId:staleQuote.quoteId},randomUUID()),(e:any)=>e.code==="auto_confirmation_required");
 const next={...stale,autoAuthorizationId:auth.id};
 const nextQuote=await quoteTurn(user.id,sessionId,next);
 const run=await submitTurn(user.id,sessionId,{...next,quoteId:nextQuote.quoteId},randomUUID());
 // Model receipt is never dispatched: admission alone produces one reservation and queue job.
 const [receipts]=await sql`SELECT count(*)::int n FROM receipts WHERE service='assistant.text' AND model=${model}`;
 assert.equal(receipts!.n,0);
 await controlTurn(user.id,sessionId,run.turnId,"stop",{generation:0});
 const [nextCharge]=await sql`SELECT charge_id FROM member_credit_run_links WHERE run_id=${run.runId}`;
 await reconcileCreditCharge(nextCharge!.charge_id,{consume:200,reason:"Synthetic delivered charge fixture"},"test",randomUUID());
 for(let n=0;n<3;n++){
 const body={...next,expectedRevision:3+n};
 const q=await quoteTurn(user.id,sessionId,body);
 const r=await submitTurn(user.id,sessionId,{...body,quoteId:q.quoteId},randomUUID());
 await controlTurn(user.id,sessionId,r.turnId,"stop",{generation:0});
 const [c]=await sql`SELECT charge_id FROM member_credit_run_links WHERE run_id=${r.runId}`;
 await reconcileCreditCharge(c!.charge_id,{consume:200,reason:"Synthetic historical spend fixture"},"test",randomUUID());
 }
 await setFeeAuthorization(user.id,sessionId,{enabled:false,expectedVersion:2});
 auth=(await setFeeAuthorization(user.id,sessionId,{enabled:true,expectedVersion:2,totalLimit:1000,allowSearch:false,turnPrice:prices.turn,searchPrice:null})).authorization!;
 assert.equal(auth.used,800);assert.equal(auth.remaining,200);

 // Narrow legacy command replay restores old omitted-array defaults without weakening new commands.
 const legacySession=await createSession(user.id,{assistantId:"creative"},randomUUID());
 const legacyInput={message:"旧请求",expectedRevision:1};const legacyKey=randomUUID();
 const legacyQuote=await quoteTurn(user.id,legacySession.sessionId,legacyInput);
 const legacyRun=await submitTurn(user.id,legacySession.sessionId,{...legacyInput,quoteId:legacyQuote.quoteId},legacyKey);
 await sql`UPDATE assistant_turns SET snapshot=snapshot-'skillSelection',command_hash=${command(legacyKey,{...legacyInput,inputIds:[],artifactVersions:[]}).hash} WHERE id=${legacyRun.turnId}`;
 assert.deepEqual(await submitTurn(user.id,legacySession.sessionId,{...legacyInput,quoteId:legacyQuote.quoteId},legacyKey),legacyRun);
 await assert.rejects(()=>submitTurn(user.id,legacySession.sessionId,{...legacyInput,skillSelection:null,quoteId:legacyQuote.quoteId},legacyKey));
 await controlTurn(user.id,legacySession.sessionId,legacyRun.turnId,"stop",{generation:0});

 // Real child reservation and queue admission, without dispatching any provider request.
 const [searchPriceRow]=await sql`SELECT id,version FROM member_tool_prices WHERE kind='query' AND provider='redfox' AND model='3X8FGEEM' AND parameter_match='{}'`;
 await saveToolPrice({...(searchPriceRow?{id:searchPriceRow.id,expectedVersion:searchPriceRow.version}:{}),kind:"query",provider:"redfox",model:"3X8FGEEM",baseCredits:20,enabled:true,reason:"Synthetic automatic search fixture"},"test");
 const searchSession=await createSession(user.id,{assistantId:"xiaohongshu"},randomUUID());
 const searchPrices=(await feeSettings(user.id,searchSession.sessionId)).prices;
 assert(searchPrices.search);
 const searchAuth=(await setFeeAuthorization(user.id,searchSession.sessionId,{enabled:true,expectedVersion:0,totalLimit:1000,allowSearch:true,turnPrice:searchPrices.turn,searchPrice:searchPrices.search})).authorization!;
 const searchInput={message:"写笔记",expectedRevision:1,inputIds:[],artifactVersions:[],autoAuthorizationId:searchAuth.id};
 const searchQuote=await quoteTurn(user.id,searchSession.sessionId,searchInput);
 const searchRun=await submitTurn(user.id,searchSession.sessionId,{...searchInput,quoteId:searchQuote.quoteId},randomUUID());
 const [searchTurn]=await sql`SELECT t.*,${user.id}::int owner_user_id FROM assistant_turns t WHERE id=${searchRun.turnId}`;
 const stepId=randomUUID(),activationId=randomUUID();
 await sql`INSERT INTO assistant_model_steps(id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash) VALUES (${stepId},${searchRun.turnId},1,1,'{}','synthetic')`;
 const candidate=(await candidates("xiaohongshu")).find(c=>c.moduleId==="M1")!;
 await sql`INSERT INTO assistant_activations(id,turn_id,model_step_id,identity_hash,candidate) VALUES (${activationId},${searchRun.turnId},${stepId},'synthetic',${sql.json(candidate as never)})`;
 const newCall=async(ordinal:number)=>{
 const call={name:"search_xhs_notes",id:randomUUID(),turn_id:searchRun.turnId,proposal_revision:1,input:{activationId,keyword:"预算回归",startDate:searchTurn!.snapshot.researchClock.defaultStartDate,endDate:searchTurn!.snapshot.researchClock.latestDate}};
 const proposal=await prepareSearch(searchTurn!,call);
 await sql`INSERT INTO assistant_tool_calls(id,turn_id,model_step_id,ordinal,upstream_id,name,input,state,quote,result) VALUES (${call.id},${searchRun.turnId},${stepId},${ordinal},${`synthetic-${ordinal}`},'search_xhs_notes',${sql.json(call.input)},'proposed',${sql.json(proposal.quote as never)},${sql.json({normalized:proposal.normalized} as never)})`;
 return {call,proposal};
 };
 const first=await newCall(0);
 // Invalid/cross-turn activation cannot start a child through automated approval.
 const invalid = {...first.call,input:{...first.call.input,activationId:randomUUID()}};
 assert.equal(await sql.begin(async tx=>{await ownedTurn(tx,user.id,searchSession.sessionId,searchRun.turnId);return autoApproveSearch(tx,searchTurn!,invalid,first.proposal);}),false);
 assert.equal((await sql`SELECT child_run_id FROM assistant_tool_calls WHERE id=${first.call.id}`)[0]!.child_run_id,null);

 await assert.rejects(()=>sql.begin(async tx=>{await ownedTurn(tx,user.id,searchSession.sessionId,searchRun.turnId);assert(await autoApproveSearch(tx,searchTurn!,first.call,first.proposal));throw Error("injected transaction failure");}),/injected/);
 assert.equal((await feeSettings(user.id,searchSession.sessionId)).authorization!.used,200,"rolled-back child leaves no reservation");
 assert(await sql.begin(async tx=>{await ownedTurn(tx,user.id,searchSession.sessionId,searchRun.turnId);return autoApproveSearch(tx,searchTurn!,first.call,first.proposal);}));
 assert.equal((await feeSettings(user.id,searchSession.sessionId)).authorization!.used,200+searchPrices.search.amount);
 assert.equal((await sql`SELECT activation_id FROM assistant_tool_calls WHERE id=${first.call.id}`)[0]!.activation_id,activationId);
 const second=await newCall(1);
 assert.equal(await sql.begin(async tx=>{await ownedTurn(tx,user.id,searchSession.sessionId,searchRun.turnId);return autoApproveSearch(tx,searchTurn!,second.call,second.proposal);}),false,"second search needs manual approval");
 await sql`UPDATE assistant_turns SET phase='waiting_approval' WHERE id=${searchRun.turnId}`;
 await sql`UPDATE operation_runs SET status='waiting' WHERE id=${searchRun.runId}`;
 await sql`UPDATE assistant_turns SET child_calls=20 WHERE id=${searchRun.turnId}`;
 const blockedQuote=await refreshCallQuote(user.id,searchSession.sessionId,second.call.id);
 assert.match((await sql`SELECT result FROM assistant_tool_calls WHERE id=${second.call.id}`)[0]!.result.approvalBlockedReason,/次数已达上限/);
 const beforeLimit=(await sql`SELECT count(*)::int n FROM operation_runs WHERE actor=${`user:${user.id}`}`)[0]!.n;
 await assert.rejects(()=>decideCall(user.id,searchSession.sessionId,second.call.id,true,{proposalRevision:blockedQuote.proposalRevision},randomUUID()),/次数已达上限/);
 assert.equal((await sql`SELECT count(*)::int n FROM operation_runs WHERE actor=${`user:${user.id}`}`)[0]!.n,beforeLimit,"receipt attempts exhausted cannot reserve another child even with fewer runs");
 await sql`UPDATE assistant_turns SET child_calls=1 WHERE id=${searchRun.turnId}`;
 const [priorSkillPolicy] = await sql`SELECT value,updated_by,updated_at FROM settings WHERE key='assistant.skills.xiaohongshu-creator'`;
 const [parentChargeBeforeClose] = await sql`SELECT c.* FROM member_credit_charges c JOIN member_credit_run_links l ON l.charge_id=c.id WHERE l.run_id=${searchRun.runId}`;
 const ledgerBeforeClose = await sql`SELECT * FROM member_credit_entries WHERE user_id=${user.id} ORDER BY id`;
 try {
 const policy = (await readSkillPolicies()).find(p=>p.skillId==='xiaohongshu-creator')!;
 await updateAssistantSkill('xiaohongshu-creator',{acceptingNew:false,expectedRevision:policy.revision,reason:'已受理检索关闭后继续测试'},'test');
 assert.deepEqual(await sql`SELECT * FROM member_credit_entries WHERE user_id=${user.id} ORDER BY id`,ledgerBeforeClose,'closing does not alter the credit ledger');
 const freshQuote=await refreshCallQuote(user.id,searchSession.sessionId,second.call.id);
 assert.equal((await sql`SELECT result FROM assistant_tool_calls WHERE id=${second.call.id}`)[0]!.result.approvalBlockedReason,undefined);
 await decideCall(user.id,searchSession.sessionId,second.call.id,true,{proposalRevision:freshQuote.proposalRevision},randomUUID());
 assert.equal((await feeSettings(user.id,searchSession.sessionId)).authorization!.used,200+searchPrices.search.amount,"extra manual query excluded from automatic allowance");
 const [manualAttribution]=await sql`SELECT activation_id,child_run_id FROM assistant_tool_calls WHERE id=${second.call.id}`;
 assert.equal(manualAttribution!.activation_id,activationId);
 const replayed=await decideCall(user.id,searchSession.sessionId,second.call.id,true,{proposalRevision:freshQuote.proposalRevision},randomUUID());
 assert.equal(replayed.childRunId,manualAttribution!.child_run_id);
 assert.equal((await sql`SELECT activation_id FROM assistant_tool_calls WHERE id=${second.call.id}`)[0]!.activation_id,activationId);

 const [parentChargeAfterApproval] = await sql`SELECT c.* FROM member_credit_charges c JOIN member_credit_run_links l ON l.charge_id=c.id WHERE l.run_id=${searchRun.runId}`;
 assert.deepEqual(parentChargeAfterApproval,parentChargeBeforeClose,'closed-skill search approval preserves its original parent reservation');
 const ledgerAfterApproval = await sql`SELECT * FROM member_credit_entries WHERE user_id=${user.id} ORDER BY id`;
 assert.deepEqual(ledgerAfterApproval.slice(0,ledgerBeforeClose.length),[...ledgerBeforeClose],'prior ledger rows remain immutable');
 assert.equal((await sql`SELECT count(*)::int n FROM member_credit_run_links WHERE run_id=${manualAttribution!.child_run_id}`)[0]!.n,1,'approval replay reserves only one child charge');
 } finally {
 await sql`UPDATE settings SET value=${sql.json(priorSkillPolicy!.value)},updated_by=${priorSkillPolicy!.updated_by},updated_at=${priorSkillPolicy!.updated_at} WHERE key='assistant.skills.xiaohongshu-creator'`;
 }

 const [autoCount]=await sql`SELECT count(*)::int n FROM assistant_auto_charges WHERE turn_id=${searchRun.turnId}`;
 assert.equal(autoCount!.n,2);
 await controlTurn(user.id,searchSession.sessionId,searchRun.turnId,"stop",{generation:1});

 const raceSession=await createSession(user.id,{assistantId:"creative"},randomUUID());
 const raceAuth=(await setFeeAuthorization(user.id,raceSession.sessionId,{enabled:true,expectedVersion:0,totalLimit:200,allowSearch:false,turnPrice:prices.turn,searchPrice:null})).authorization!;
 const raceInput={message:"双标签页",expectedRevision:1,autoAuthorizationId:raceAuth.id};
 const raceQuote=await quoteTurn(user.id,raceSession.sessionId,raceInput);
 const race=await Promise.allSettled([submitTurn(user.id,raceSession.sessionId,{...raceInput,quoteId:raceQuote.quoteId},randomUUID()),submitTurn(user.id,raceSession.sessionId,{...raceInput,quoteId:raceQuote.quoteId},randomUUID())]);
 assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
 assert.equal((await feeSettings(user.id,raceSession.sessionId)).authorization!.used,200);
 const winner=race.find(r=>r.status==="fulfilled")! as PromiseFulfilledResult<{turnId:string;runId:number}>;
 await controlTurn(user.id,raceSession.sessionId,winner.value.turnId,"stop",{generation:0});
 // Oversized text is rejected before issuing a quote or reserving credits.
 const boundarySession=await createSession(user.id,{assistantId:"creative"},randomUUID());
 await assert.rejects(()=>quoteTurn(user.id,boundarySession.sessionId,{message:"龘".repeat(30000),expectedRevision:1,inputIds:[],artifactVersions:[]}),/连续文本过长/);
 await assert.rejects(()=>quoteTurn(user.id,boundarySession.sessionId,{message:"龘 ".repeat(14000),expectedRevision:1,inputIds:[],artifactVersions:[]}),/上下文超过上限/);
 const [noTurns]=await sql`SELECT count(*)::int n FROM assistant_turns WHERE session_id=${boundarySession.sessionId}`;
 assert.equal(noTurns!.n,0);
 // A new automatic authorization cannot turn an earlier manual quote into consent.
 const manualBody={message:"旧的人工报价",expectedRevision:1,inputIds:[],artifactVersions:[]};
 const manualQuote=await quoteTurn(user.id,boundarySession.sessionId,manualBody);
 const boundaryAuth=(await setFeeAuthorization(user.id,boundarySession.sessionId,{enabled:true,expectedVersion:0,totalLimit:1000,allowSearch:false,turnPrice:prices.turn,searchPrice:null})).authorization!;
 await assert.rejects(()=>submitTurn(user.id,boundarySession.sessionId,{...manualBody,autoAuthorizationId:boundaryAuth.id,quoteId:manualQuote.quoteId},randomUUID()));
 assert.equal((await feeSettings(user.id,boundarySession.sessionId)).authorization!.used,0);
 // Changing an effective price requires fresh explicit consent, with no partial reservation.
 const pricedBody={...manualBody,autoAuthorizationId:boundaryAuth.id};
 const beforeChange=await quoteTurn(user.id,boundarySession.sessionId,pricedBody);
 await saveToolPrice({id:prices.turn.priceId,expectedVersion:prices.turn.priceVersion,kind:"assistant-turn",provider:"assistant",model,baseCredits:201,enabled:true,reason:"Synthetic price change"},"test");
 await assert.rejects(()=>submitTurn(user.id,boundarySession.sessionId,{...pricedBody,quoteId:beforeChange.quoteId},randomUUID()));
 const changedQuote=await quoteTurn(user.id,boundarySession.sessionId,pricedBody);
 await assert.rejects(()=>submitTurn(user.id,boundarySession.sessionId,{...pricedBody,quoteId:changedQuote.quoteId},randomUUID()),(e:any)=>e.code==="auto_confirmation_required");
 assert.equal((await feeSettings(user.id,boundarySession.sessionId)).authorization!.used,0);
 // Existing zero-credit prices remain usable with a positive consent cap.
 const changedPrice=(await feeSettings(user.id,boundarySession.sessionId)).prices.turn;
 await saveToolPrice({id:changedPrice.priceId,expectedVersion:changedPrice.priceVersion,kind:"assistant-turn",provider:"assistant",model,baseCredits:0,enabled:true,reason:"Synthetic free price"},"test");
 const freeUser=await createSiteUser({username:`free_${unique}`,displayName:"Free price",password:"synthetic-free-price-password"},"test");
 await grantCredits(freeUser.id,{amount:1,reason:"Free-price fixture"},"test",randomUUID());
 const freeSession=await createSession(freeUser.id,{assistantId:"creative"},randomUUID());
 const freePrice=(await feeSettings(freeUser.id,freeSession.sessionId)).prices.turn;
 const freeAuth=(await setFeeAuthorization(freeUser.id,freeSession.sessionId,{enabled:true,expectedVersion:0,totalLimit:1000,allowSearch:false,turnPrice:freePrice,searchPrice:null})).authorization!;
 assert.equal(freeAuth.perTurnLimit,0);
 const freeBody={...manualBody,autoAuthorizationId:freeAuth.id};
 const freeQuote=await quoteTurn(freeUser.id,freeSession.sessionId,freeBody);
 const freeRun=await submitTurn(freeUser.id,freeSession.sessionId,{...freeBody,quoteId:freeQuote.quoteId},randomUUID());
 assert.equal((await feeSettings(freeUser.id,freeSession.sessionId)).authorization!.used,0);
 await controlTurn(freeUser.id,freeSession.sessionId,freeRun.turnId,"stop",{generation:0});
 // Disabling remains possible even after the model endpoint is removed.
 delete process.env.LLM_BASE_URL;
 assert.equal((await setFeeAuthorization(user.id,sessionId,{enabled:false,expectedVersion:3})).authorization!.enabled,false);
 }finally{await restore();await stopBoss();await closeDb();}
});

/** Historical single-tool quote fixture. Current task entry is covered in assistant-task-entry.test.ts. */
async function quoteTurn(userId:number,id:string,raw:unknown) {
 await (await import("@aihot/backend/assistant/config")).requireAvailable();
 const prepared=await snapshotInput(sql,userId,id,raw);
 return {...await quoteTool(userId,prepared.intent),additionalFeeKinds:await additionalFeeKinds(prepared.snapshot.candidates)};
}
