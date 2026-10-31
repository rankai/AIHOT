import { allowTestBudgetScope, assertConfiguredTestDatabase, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, quoteTool, saveToolPrice, reconcileCreditCharge } from "@aihot/backend/users/credits";
import { createRun } from "@aihot/backend/providers/operations/store";
import { createSession, quoteTurn, submitTurn } from "@aihot/backend/assistant/sessions";
import { controlTurn } from "@aihot/backend/assistant/controls";
import { feeSettings, setFeeAuthorization } from "@aihot/backend/assistant/fees";

test("unreconciled stopped requests fence new manual and automatic turns but preserve command replay", async t => {
 const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
 assertConfiguredTestDatabase(database!.name,database!.port);
 const restore = await allowTestBudgetScope(["assistant.text"],"member");
 const model = `unresolved-${tag()}`;
 Object.assign(process.env,{ASSISTANT_ENABLED:"true",ASSISTANT_CALLS_ENABLED:"true",ASSISTANT_MODEL_VERIFIED:"true",ASSISTANT_MODEL:"default",LLM_MODEL:model,LLM_BASE_URL:"http://127.0.0.1:1/v1",LLM_API_KEY:"synthetic-no-dispatch",ASSISTANT_TOKENIZER:"cl100k_base",MODEL_CALLS_ENABLED:"true"});
 try {
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='assistant.text'`;
  for(const kind of ["assistant-turn","query"] as const) await saveToolPrice({kind,provider:kind==="query"?"redfox":"assistant",model,baseCredits:7,enabled:true,reason:"Synthetic unresolved fixture"},"test");
  for (const source of ["parent-current","child-current","parent-retained","parent-result"] as const) {
   for(const status of source.endsWith("current") ? ["pending","unknown"] as const : ["unknown"] as const) {
    await t.test(`${source} ${status}`,async()=>{
     const user=await createSiteUser({username:`unresolved_${tag()}`,displayName:"Unresolved fixture",password:"synthetic-fixture-password"},"test");
     await grantCredits(user.id,{amount:200,reason:"Synthetic unresolved fixture"},"test",randomUUID());
     const {sessionId}=await createSession(user.id,{assistantId:"creative"},randomUUID());
     const prices=(await feeSettings(user.id,sessionId)).prices;
     const auth=(await setFeeAuthorization(user.id,sessionId,{enabled:true,expectedVersion:0,totalLimit:100,allowSearch:false,turnPrice:prices.turn,searchPrice:null})).authorization!;
     const input={message:"原请求",expectedRevision:1,autoAuthorizationId:auth.id};
     const quote=await quoteTurn(user.id,sessionId,input),key=randomUUID();
     const original=await submitTurn(user.id,sessionId,{...input,quoteId:quote.quoteId},key);
     const next={message:"原请求",expectedRevision:2};
     // Valid quotes obtained before the old request becomes uncertain must still be fenced at admission.
     const manualQuote=await quoteTurn(user.id,sessionId,next);
     const autoQuote=await quoteTurn(user.id,sessionId,{...next,autoAuthorizationId:auth.id});
     let receiptRunId=original.runId;
     if(source==="child-current") {
      const childInput={assistantParentTurnId:original.turnId,fixture:randomUUID()};
      const intent={kind:"query" as const,provider:"redfox",model,input:childInput};
      const childQuote=await quoteTool(user.id,intent);
      const child=await sql.begin(tx=>createRun(tx,{actor:`user:${user.id}`,commandKey:randomUUID(),provider:"redfox",operationKey:"redfox.sync.query",contractVersion:1,input:childInput,stepKey:"redfox.sync.query",authorization:{quoteId:childQuote.quoteId,intent}}));
      const step=randomUUID();
      await sql`INSERT INTO assistant_model_steps(id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash) VALUES (${step},${original.turnId},1,1,'{}',${randomUUID()})`;
      await sql`INSERT INTO assistant_tool_calls(id,turn_id,model_step_id,ordinal,upstream_id,name,input,state,child_run_id) VALUES (${randomUUID()},${original.turnId},${step},0,'fixture','search_xhs_notes','{}','running',${child.id})`;
      receiptRunId=child.id;
     }
     const [receipt]=await sql`INSERT INTO receipts(logical_key,service,purpose,status,attempts) VALUES (${randomUUID()},'assistant.text','assistant.turn',${status},1) RETURNING id`;
     if(source==="parent-retained") await sql`UPDATE operation_runs SET progress=${sql.json({retainedReceiptIds:[receipt!.id]})} WHERE id=${receiptRunId}`;
     else if(source==="parent-result") await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id) VALUES (${receiptRunId},1,'fixture','assistant_model','{}',${receipt!.id})`;
     else await sql`UPDATE operation_runs SET current_receipt_id=${receipt!.id} WHERE id=${receiptRunId}`;
     await controlTurn(user.id,sessionId,original.turnId,"stop",{generation:0});
     const before=(await sql`SELECT count(*)::int n FROM operation_runs WHERE actor=${`user:${user.id}`}`)[0]!.n;
     const wallet=(await sql`SELECT available,reserved FROM member_credit_accounts WHERE user_id=${user.id}`)[0];
     const blocked=(e:any)=>e.code==="assistant_request_unresolved";
     for(const automatic of [false,true]) {
      const request={...next,...(automatic?{autoAuthorizationId:auth.id}:{})};
      await assert.rejects(()=>quoteTurn(user.id,sessionId,request),blocked);
      await assert.rejects(()=>submitTurn(user.id,sessionId,{...request,quoteId:(automatic?autoQuote:manualQuote).quoteId},randomUUID()),blocked);
     }
     assert.deepEqual(await submitTurn(user.id,sessionId,{...input,quoteId:quote.quoteId},key),original);
     assert.equal((await sql`SELECT count(*)::int n FROM operation_runs WHERE actor=${`user:${user.id}`}`)[0]!.n,before);
     assert.deepEqual((await sql`SELECT available,reserved FROM member_credit_accounts WHERE user_id=${user.id}`)[0],wallet);
     assert.equal((await sql`SELECT active_turn_id FROM assistant_sessions WHERE id=${sessionId}`)[0]!.active_turn_id,original.turnId);
     // An in-flight receipt cannot be reconciled. Simulate its terminal unknown outcome first.
     if(status==="pending") await sql`UPDATE receipts SET status='unknown' WHERE id=${receipt!.id}`;
     const [charge]=await sql`SELECT charge_id FROM member_credit_run_links WHERE run_id=${receiptRunId}`;
     await reconcileCreditCharge(charge!.charge_id,{consume:0,reason:"Synthetic request accounted for"},"test",randomUUID());
     assert.equal((await sql`SELECT status FROM receipts WHERE id=${receipt!.id}`)[0]!.status,"unknown","reconciliation does not rewrite provider history");
     const releasedQuote=await quoteTurn(user.id,sessionId,{...next,autoAuthorizationId:auth.id});
     const fresh=await submitTurn(user.id,sessionId,{...next,autoAuthorizationId:auth.id,quoteId:releasedQuote.quoteId},randomUUID());
     assert.notEqual(fresh.turnId,original.turnId);
     await controlTurn(user.id,sessionId,fresh.turnId,"stop",{generation:0});
    });
   }
  }
 } finally {await restore();await stopBoss();await closeDb();}
});
