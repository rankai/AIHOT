import { assertConfiguredTestDatabase, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { grantCredits, saveToolPrice, quoteTool, assertRunCredit, settleForRun } from '@aihot/backend/users/credits';
import { createRun } from '@aihot/backend/providers/operations/store';
import { chargeForRun } from '@aihot/backend/users/credits-core';
import { readRunCredits } from '@aihot/backend/users/credits-read';
import type { ToolCreditIntent } from '@aihot/contracts/credits';
before(async()=> {const [db]=await sql`SELECT current_database() name,inet_server_port() port`;assertConfiguredTestDatabase(db!.name,db!.port);});
after(closeDb);
async function fixture() {
 const model=tag(); const [user]=await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`task-${model}`},'task credits','synthetic') RETURNING id`;
 const uid=Number(user!.id),actor=`user:${uid}`;
 await grantCredits(uid,{amount:1000,reason:'Task test grant'},'test',randomUUID());
 await saveToolPrice({kind:'assistant-turn',provider:'assistant',model,baseCredits:10,enabled:true,reason:'Task test price'},'test');
 await saveToolPrice({kind:'query',provider:'redfox',model,baseCredits:20,enabled:true,reason:'Task test price'},'test');
 const rootIntent:ToolCreditIntent={kind:'assistant-turn',provider:'assistant',model,input:{scope:'test'}};
 const childIntent:ToolCreditIntent={kind:'query',provider:'redfox',model,input:{}};
 const quote=await quoteTool(uid,rootIntent,undefined,{label:'Task',scope:'one query',items:[{key:'writing',label:'writing',units:1,intent:rootIntent},{key:'query',label:'query',units:1,intent:childIntent}]});
 const command={actor,commandKey:randomUUID(),provider:'assistant',operationKey:'assistant.turn',contractVersion:1,input:{},stepKey:'assistant.model',authorization:{quoteId:quote.quoteId,intent:rootIntent}};
 const root=await sql.begin(tx=>createRun(tx,command));
 const session=randomUUID(),turn=randomUUID(),step=randomUUID(),call=randomUUID();
 await sql`INSERT INTO assistant_sessions(id,owner_user_id,assistant_id,assistant_name,profile_version,title,command_key,command_hash) VALUES (${session},${uid},'creative','Creative','1','Test',${randomUUID()},'test')`;
 await sql`INSERT INTO assistant_turns(id,session_id,parent_operation_run_id,command_key,command_hash,snapshot) VALUES (${turn},${session},${root.id},${randomUUID()},'test','{}')`;
 await sql`INSERT INTO assistant_model_steps(id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash) VALUES (${step},${turn},1,1,'{}','test')`;
 await sql`INSERT INTO assistant_tool_calls(id,turn_id,model_step_id,ordinal,upstream_id,name,input,result) VALUES (${call},${turn},${step},1,'one','search_xhs_notes','{}',${sql.json({normalized:{intent:childIntent}} as never)})`;
 const childCommand={actor,commandKey:randomUUID(),provider:'redfox',operationKey:'redfox.query',contractVersion:1,input:{},stepKey:'query',authorization:{quoteId:quote.quoteId,intent:childIntent,taskAllocation:{parentRunId:root.id,generation:root.generation,callId:call}}};
 return {uid,actor,root,quote,command,childCommand,call,session,turn};
}
test('task reserves once, atomically allocates child, settles delivered units and releases unused creation',async()=>{
 const f=await fixture();assert.equal(f.quote.amount,30);
 const replay=await sql.begin(tx=>createRun(tx,f.command));assert.equal(replay.id,f.root.id);
 const [price]=await sql`SELECT id,version FROM member_tool_prices WHERE kind='query' AND model=${f.childCommand.authorization.intent.model!}`;
 await saveToolPrice({id:price!.id,expectedVersion:price!.version,kind:'query',provider:'redfox',model:f.childCommand.authorization.intent.model,baseCredits:99,enabled:true,reason:'Change live price after reservation'},'test');
 const child=await sql.begin(tx=>createRun(tx,f.childCommand));
 assert.equal((await chargeForRun(sql,child.id))!.root_run_id,f.root.id);
 await sql.begin(tx=>assertRunCredit(tx,child.id));
 await assert.rejects(sql.begin(tx=>createRun(tx,{...f.childCommand,commandKey:randomUUID()})),/范围/);
 const [count]=await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${f.uid}`;assert.equal(count!.n,1);
 await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data) VALUES (${child.id},1,'result','query_summary','{}')`;
 await sql.begin(async tx=>{await tx`UPDATE operation_runs SET status='completed' WHERE id=${child.id}`;await settleForRun(tx,{runId:child.id,outcome:'completed'});});
 assert.equal((await chargeForRun(sql,child.id))!.state,'reserved');
 await sql.begin(async tx=>{await tx`UPDATE operation_runs SET status='stopped' WHERE id=${f.root.id}`;await settleForRun(tx,{runId:f.root.id,outcome:'stopped'});});
 const charge=(await chargeForRun(sql,f.root.id))!;assert.equal(charge.consumed,20);assert.equal(charge.released,10);
 await assert.rejects(sql.begin(tx=>assertRunCredit(tx,child.id)),/结算/);
 await sql.begin(tx=>settleForRun(tx,{runId:f.root.id,outcome:'stopped'}));
 const [ledger]=await sql`SELECT count(*) FILTER (WHERE kind='reserve')::int reserves,count(*) FILTER (WHERE kind='consume')::int consumes FROM member_credit_entries WHERE charge_id=${charge.id}`;
 assert.deepEqual(ledger,{reserves:1,consumes:1});
});
test('child fee details identify task allocation without repeating wallet totals; roots and legacy links retain totals',async()=>{
 const f=await fixture();
 const child=await sql.begin(tx=>createRun(tx,f.childCommand));
 assert.deepEqual(await readRunCredits(f.uid,f.root.id),{amount:30,state:'reserved',consumed:0,released:0});
 assert.deepEqual(await readRunCredits(f.uid,child.id),{taskRunId:f.root.id,itemAmount:20,state:'reserved'});
 assert.equal(await readRunCredits(f.uid+1,child.id),null);
 await sql.begin(async tx=>{
  await tx`UPDATE operation_runs SET status='stopped' WHERE id IN (${f.root.id},${child.id})`;
  await settleForRun(tx,{runId:f.root.id,outcome:'stopped'});
 });
 assert.deepEqual(await readRunCredits(f.uid,f.root.id),{amount:30,state:'released',consumed:0,released:30});
 assert.deepEqual(await readRunCredits(f.uid,child.id),{taskRunId:f.root.id,itemAmount:20,state:'released'});
 const legacyQuote=await quoteTool(f.uid,f.command.authorization.intent);
 const legacy=await sql.begin(tx=>createRun(tx,{...f.command,commandKey:randomUUID(),authorization:{...f.command.authorization,quoteId:legacyQuote.quoteId}}));
 assert.deepEqual(await readRunCredits(f.uid,legacy.id),{amount:10,state:'reserved',consumed:0,released:0});
});
test('completed root never consumes undelivered items; pre-dispatch stop releases entire reservation',async()=>{
 const f=await fixture();
 await sql.begin(async tx=>{await tx`UPDATE operation_runs SET status='completed' WHERE id=${f.root.id}`;await settleForRun(tx,{runId:f.root.id,outcome:'completed'});});
 const charge=(await chargeForRun(sql,f.root.id))!;assert.equal(charge.consumed,0);assert.equal(charge.released,30);
 await assert.rejects(sql.begin(tx=>createRun(tx,f.childCommand)),/停止|授权/);
});

test('new task scope survives quote to submission and cannot use old automatic authorization',async()=>{
 const {allowTestBudgetScope}=await import('./setup.ts');const restore=await allowTestBudgetScope(['assistant.text'],'member');
 const {createSession,quoteTurn,submitTurn}=await import('@aihot/backend/assistant/sessions');
 const {controlTurn}=await import('@aihot/backend/assistant/controls');
 const {stopBoss}=await import('@aihot/backend/jobs/queue');
 const model=`task-scope-${tag()}`;
 Object.assign(process.env,{ASSISTANT_ENABLED:'true',ASSISTANT_CALLS_ENABLED:'true',ASSISTANT_MODEL_VERIFIED:'true',ASSISTANT_MODEL:'default',LLM_MODEL:model,LLM_BASE_URL:'http://127.0.0.1:1/v1',LLM_API_KEY:'synthetic',ASSISTANT_TOKENIZER:'cl100k_base',MODEL_CALLS_ENABLED:'true'});
 try {
 await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='assistant.text'`;
 await sql`INSERT INTO settings(key,value,updated_by) VALUES ('assistant.skills.general-writing','{"acceptingNew":true,"revision":1}','test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
 await saveToolPrice({kind:'assistant-turn',provider:'assistant',model,baseCredits:7,enabled:true,reason:'Task scope fixture'},'test');
 const [user]=await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`scope-${tag()}`},'scope','synthetic') RETURNING id`;const id=Number(user!.id);
 await grantCredits(id,{amount:100,reason:'Scope fixture'},'test',randomUUID());
 const {sessionId}=await createSession(id,{assistantId:'creative'},randomUUID());
 const raw={message:'写一段春日散步感想',expectedRevision:1,skillSelection:{skillId:'general-writing'},taskChoice:{skillId:'general-writing',moduleId:'write',delivery:'writing'}};
 await sql`UPDATE budgets SET per_minute=0,per_hour=0,per_day=0 WHERE service='assistant.quote-preparation'`;
 await assert.rejects(quoteTurn(id,sessionId,{...raw,taskChoice:undefined}),(e:any)=>e.code==='assistant_task_selection_required');
 const q=await quoteTurn(id,sessionId,raw);assert.equal(q.amount,7);assert.equal(q.task!.items.length,1);
 await assert.rejects(submitTurn(id,sessionId,{...raw,autoAuthorizationId:randomUUID(),quoteId:q.quoteId},randomUUID()),/明确费用确认/);
 const turn=await submitTurn(id,sessionId,{...raw,quoteId:q.quoteId},randomUUID());
 const [saved]=await sql`SELECT snapshot FROM assistant_turns WHERE id=${turn.turnId}`;assert.equal(saved!.snapshot.taskScope.delivery,'writing');assert.equal(saved!.snapshot.candidates.length,1);
 await controlTurn(id,sessionId,turn.turnId,'stop',{generation:0});assert.equal((await chargeForRun(sql,turn.runId))!.released,7);
 await assert.rejects(controlTurn(id,sessionId,turn.turnId,'resume',{generation:1}));
 const {enqueueMessage,refreshQueuedQuote,approveQueuedMessage}=await import('@aihot/backend/assistant/message-queue');
 const {sessionSnapshot}=await import('@aihot/backend/assistant/sessions');
 // Re-open queue after an intentional stop, without authorizing any queued expense.
 await sql`UPDATE assistant_sessions SET queue_paused=false,queue_resume_turn_id=active_turn_id WHERE id=${sessionId}`;
 const queued=await enqueueMessage(id,sessionId,{...raw,taskChoice:undefined,expectedRevision:2},randomUUID());
 let state=await sessionSnapshot(id,sessionId);assert.equal(state.queue!.entries[0]!.taskSelectionRequired,true);
 const [wallet]=await sql`SELECT reserved FROM member_credit_accounts WHERE user_id=${id}`;assert.equal(Number(wallet!.reserved),0);
 const next=await refreshQueuedQuote(id,sessionId,queued.entryId,{taskChoice:raw.taskChoice});assert.equal(next.quote.amount,7);
 const accepted:any=await approveQueuedMessage(id,sessionId,queued.entryId,{quoteId:next.quote.quoteId});assert(accepted.turnId);
 await controlTurn(id,sessionId,accepted.turnId,'stop',{generation:0});

 } finally {await restore();await stopBoss();}
});

test('child-only pending and unknown receipts hold the entire task until explicit reconciliation',async()=>{
 const {assertSessionReceiptsReviewed}=await import('@aihot/backend/assistant/fees');
 const {reconcileCreditCharge}=await import('@aihot/backend/users/credits');
 for(const status of ['pending','unknown']) {
  const f=await fixture(),child=await sql.begin(tx=>createRun(tx,f.childCommand));
  const [receipt]=await sql`INSERT INTO receipts(logical_key,service,purpose,status) VALUES (${randomUUID()},'test.task','fixture',${status}) RETURNING id`;
  await sql`UPDATE operation_runs SET current_receipt_id=${receipt!.id},status='stopped' WHERE id=${child.id}`;
  await sql.begin(async tx=>{await tx`UPDATE operation_runs SET status='stopped' WHERE id=${f.root.id}`;await settleForRun(tx,{runId:f.root.id,outcome:'stopped'});});
  const charge=(await chargeForRun(sql,child.id))!;assert.equal(charge.state,'review');assert.equal(charge.released,0);
  await assert.rejects(assertSessionReceiptsReviewed(sql,f.session),(e:any)=>e.code==='assistant_request_unresolved');
  if(status==='pending')await assert.rejects(reconcileCreditCharge(charge.id,{consume:0,reason:'Synthetic pending review'},'test',randomUUID()),(e:any)=>e.code==='request_pending');
  else {await reconcileCreditCharge(charge.id,{consume:0,reason:'Synthetic unknown reviewed by operator'},'test',randomUUID());await assertSessionReceiptsReviewed(sql,f.session);await assert.rejects(sql.begin(tx=>assertRunCredit(tx,child.id)));}
 }
});

test('received response with missing business delivery remains recoverable; active wallet shortage rolls back run creation',async()=>{
 const {controlAssistantOperation}=await import('@aihot/backend/assistant/controls');const {stopBoss}=await import('@aihot/backend/jobs/queue');
 const f=await fixture();
 const [receipt]=await sql`INSERT INTO receipts(logical_key,service,purpose,status,response) VALUES (${randomUUID()},'test.task','fixture','received','{}') RETURNING id`;
 await sql`UPDATE assistant_sessions SET active_turn_id=${f.turn} WHERE id=${f.session}`;
 await sql.begin(async tx=>{await tx`UPDATE operation_runs SET current_receipt_id=${receipt!.id},status='needs_review' WHERE id=${f.root.id}`;await settleForRun(tx,{runId:f.root.id,outcome:'needs_review'});});
 assert.equal((await chargeForRun(sql,f.root.id))!.state,'review');
 await sql.begin(tx=>controlAssistantOperation(tx,{runId:f.root.id,stepVersion:f.root.step_version,generation:f.root.generation},'resume','admin:test','Save known receipt response'));
 assert.equal((await chargeForRun(sql,f.root.id))!.state,'reserved');
 const [original]=await sql`SELECT current_receipt_id FROM operation_runs WHERE id=${f.root.id}`;assert.equal(original!.current_receipt_id,receipt!.id);
 await grantCredits(f.uid,{kind:'adjustment',amount:-970,reason:'Synthetic insufficient available balance'},'test',randomUUID());
 const q=await quoteTool(f.uid,f.command.authorization.intent,undefined,{label:'one',scope:'one',items:[{key:'creation',label:'one',units:1,intent:f.command.authorization.intent}]});assert.equal(q.affordable,false);
 await assert.rejects(sql.begin(tx=>createRun(tx,{...f.command,commandKey:randomUUID(),authorization:{...f.command.authorization,quoteId:q.quoteId}})),(e:any)=>e.code==='insufficient_credits');
 const [count]=await sql`SELECT count(*)::int n FROM operation_runs WHERE actor=${f.actor}`;assert.equal(count!.n,1);
 await stopBoss();
});

test('task fee bindings reuse the same contract after skill/module renaming and reject scope mismatch',async()=>{
 const {Binding,bindings}=await import('@aihot/backend/assistant/bindings');const {taskChoices,applyTaskChoice}=await import('@aihot/backend/assistant/task-pricing');
 const original=bindings.find(b=>b.skillId==='xiaohongshu-creator'&&b.modules.some(m=>m.tasks))!;
 const {directory,...originalBinding}=original;
 const renamed=Binding.parse({...originalBinding,skillId:'renamed-skill',modules:original.modules.map(m=>({...m,moduleId:`renamed-${m.moduleId}`}))});
 const candidate={skillId:renamed.skillId,moduleId:'renamed-M4',version:renamed.version,description:'cover contract'};
 const choices=taskChoices([candidate],[renamed]);assert.deepEqual(choices.map(c=>c.delivery),['plans-only','image']);assert.equal(choices[0]!.units.some(u=>u.capability==='generate_image@1'),false);
 const source={candidates:[{...candidate,skillId:original.skillId,moduleId:'M4'}]};
 assert.throws(()=>applyTaskChoice(structuredClone(source),{skillId:original.skillId,moduleId:'M4',delivery:'image',size:'1:1'}));
 assert.throws(()=>applyTaskChoice(structuredClone(source),{skillId:original.skillId,moduleId:'M4',delivery:'plans-only',size:'3:4'}));
});

test('two task confirmations cannot reserve the same available wallet balance',async()=>{
 const f=await fixture(),intent=f.command.authorization.intent;
 const [price]=await sql`SELECT id,version FROM member_tool_prices WHERE kind='assistant-turn' AND model=${intent.model!}`;
 await saveToolPrice({id:price!.id,expectedVersion:price!.version,kind:'assistant-turn',provider:'assistant',model:intent.model,baseCredits:600,enabled:true,reason:'Concurrent task reservation fixture'},'test');
 const definition={label:'Task',scope:'Task',items:[{key:'creation',label:'creation',units:1,intent}]};
 const quotes=await Promise.all([quoteTool(f.uid,intent,undefined,definition),quoteTool(f.uid,intent,undefined,definition)]);
 const results=await Promise.allSettled(quotes.map(q=>sql.begin(tx=>createRun(tx,{...f.command,commandKey:randomUUID(),authorization:{quoteId:q.quoteId,intent}}))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='insufficient_credits').length,1);
 const [balance]=await sql`SELECT available,reserved FROM member_credit_accounts WHERE user_id=${f.uid}`;assert.equal(Number(balance!.available),370);assert.equal(Number(balance!.reserved),630);
});

test('stop settles consumed intermediate model decisions but retains received or unconsumed decisions for review',async()=>{
 const {controlTurn}=await import('@aihot/backend/assistant/controls');
 const {saveResult,advanceRun}=await import('@aihot/backend/providers/operations/store');
 for(const mode of ['processed','delivered-query','unconsumed','received'] as const){
  const f=await fixture();
  await sql`UPDATE operation_runs SET input=input||${sql.json({sessionId:f.session,turnId:f.turn})} WHERE id=${f.root.id}`;
  await sql`UPDATE assistant_sessions SET active_turn_id=${f.turn} WHERE id=${f.session}`;
  if(mode==='delivered-query'){
   const child=await sql.begin(tx=>createRun(tx,f.childCommand));
   await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data) VALUES (${child.id},1,'result','query_summary','{}')`;
   await sql.begin(async tx=>{await tx`UPDATE operation_runs SET status='completed' WHERE id=${child.id}`;await settleForRun(tx,{runId:child.id,outcome:'completed'});});
  }
  const [step]=await sql`SELECT id FROM assistant_model_steps WHERE turn_id=${f.turn}`;
  await sql.begin(async tx=>{
   const [receipt]=await tx`INSERT INTO receipts(logical_key,service,model,purpose,status,response,attempts) VALUES (${randomUUID()},'assistant.text','synthetic','assistant.turn','received','{}',1) RETURNING id`;
   await tx`UPDATE operation_runs SET current_receipt_id=${receipt!.id} WHERE id=${f.root.id}`;
   await tx`UPDATE assistant_model_steps SET receipt_id=${receipt!.id} WHERE id=${step!.id}`;
   if(mode!=='received'){
    const name=mode==='delivered-query'?'search_xhs_notes':'load_skill';
    await tx`UPDATE assistant_model_steps SET decision=${tx.json({calls:[{name}]})} WHERE id=${step!.id}`;
    await tx`UPDATE assistant_tool_calls SET name=${name},state=${['processed','delivered-query'].includes(mode)?'completed':'pending'},result='{}' WHERE id=${f.call}`;
    const execution={runId:f.root.id,stepVersion:f.root.step_version,generation:f.root.generation};
    await saveResult(tx,execution,{itemKey:`model:${step!.id}`,kind:'assistant_model',data:{stepId:step!.id},receiptId:receipt!.id});
    await advanceRun(tx,execution,{stepKey:'assistant.tools',progress:{stepId:step!.id}});
   }
  });
  await controlTurn(f.uid,f.session,f.turn,'stop',{generation:f.root.generation});
  const charge=(await chargeForRun(sql,f.root.id))!;
  assert.equal(charge.state,mode==='processed'?'released':mode==='delivered-query'?'settled':'review',mode);
  assert.equal(charge.consumed,mode==='delivered-query'?20:0);assert.equal(charge.released,mode==='processed'?30:mode==='delivered-query'?10:0);
 }
});
