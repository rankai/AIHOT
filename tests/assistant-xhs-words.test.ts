import { allowTestBudgetScope,assertConfiguredTestDatabase,stub,tag } from './setup.ts';
import assert from 'node:assert/strict';
import { test,after } from 'node:test';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { sql,closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { saveToolPrice,grantCredits } from '@aihot/backend/users/credits';
import { createSession,quoteTurn,submitTurn,sessionSnapshot,snapshotInput } from '@aihot/backend/assistant/sessions';
import { enqueueMessage,approveQueuedMessage } from '@aihot/backend/assistant/message-queue';
import { controlTurn } from '@aihot/backend/assistant/controls';
import { executeOperationStep } from '@aihot/backend/providers/operations/execute';
import { parseXhsWords,XHS_WORD_OPERATION as operationId,XHS_WORD_SOURCE } from '@aihot/backend/providers/redfox/xhs-words';
import { parseMediaTool,queryMediaTool } from '@aihot/backend/providers/redfox/media-tools';
import { splitWordCheck,freezeWordCheck,defaultWordSource,wordSourceText,locateWordText,wordCheckModelInput } from '@aihot/backend/assistant/word-check-input';
import { applyWordSuggestions,wordCheckInputProjection } from '@aihot/backend/assistant/word-check';
import { sha256 } from '@aihot/backend/lib/ids';
import { normalizeToolInput } from '@aihot/backend/users/tool-input';
import { candidates } from '@aihot/backend/assistant/catalog';
import { taskPriceDefinition } from '@aihot/backend/assistant/task-pricing';
import { wordCheckResults } from '@aihot/backend/assistant/word-check-results';
const completion=(name:string,input:unknown)=>({id:'stub',created:1,model:'stub',choices:[{index:0,message:{role:'assistant',content:null,tool_calls:[{id:'call_0',type:'function',function:{name,arguments:JSON.stringify(input)}}]},finish_reason:'tool_calls'}]});
const html=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const response=(text:string)=>({originalContent:text,content:html(text).replaceAll('最好','<span class="banned-word">最好</span>'),prohibitedWordsType:[]});
test('frozen word scope covers UTF16 lengths, surrogate boundaries and explicit one-source ownership',()=>{
 for(const length of [1,2000,2001,3214,3801,5600,10000]){
  const text='甲'.repeat(length),b=splitWordCheck(text);assert.equal(b.length,length<=2000?1:Math.ceil(length/1800));assert(b.length<=6);assert.equal(b[0]!.start,0);assert.equal(b.at(-1)!.end,length);
  assert(b.every((x,i)=>x.end-x.start<=2000&&x.coreStart===(i?b[i-1]!.end:0)&&x.coreStart-x.start<=200));assert.equal(b.map(x=>text.slice(x.coreStart,x.end)).join(''),text);
 }
 for(const text of ['😀'.repeat(5000),('甲'.repeat(1699)+'。').repeat(6).slice(0,10000)]){
  const b=splitWordCheck(text);assert(b.length<=6);assert.equal(b.map(x=>text.slice(x.coreStart,x.end)).join(''),text);
  for(const part of b){assert(part.end-part.start<=2000);assert(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(text.slice(part.start,part.end)));}
  assert(b.slice(0,-1).every(part=>part.end-part.coreStart>=1700&&part.end-part.coreStart<=1800));
  if(text.includes('。'))assert(b.slice(0,-1).every(part=>text[part.end-1]==='。'));
 }
 const oldText='甲'.repeat(2773),oldScope={version:1,source:{kind:'message',start:3,end:2776},textHash:sha256(oldText),characters:2773,label:'旧冻结',batches:[{index:0,start:0,coreStart:0,end:2773,hash:sha256(oldText)}]};
 const unchanged=structuredClone(oldScope);assert.throws(()=>freezeWordCheck({message:'检查：'+oldText,taskScope:{}},oldScope),/冻结检测分段/);assert.deepEqual(oldScope,unchanged);
 assert.throws(()=>splitWordCheck('甲'.repeat(10001)));const message='检查：保留\n原格式😀';
 const snapshot={message,selected:[],taskScope:{}};const scope=freezeWordCheck(snapshot);assert.equal(wordSourceText(snapshot,scope.source).text,'保留\n原格式😀');assert.deepEqual(freezeWordCheck(snapshot,scope),scope);
 assert.throws(()=>freezeWordCheck({...snapshot,message:message.replace('原格式','新格式')},scope));
 assert.throws(()=>freezeWordCheck({...snapshot,message:'检查：https://example.com'}));
 assert.deepEqual(defaultWordSource({message:'```\n短文\n```'}),{kind:'message',start:4,end:6});
 const id=randomUUID();assert.throws(()=>defaultWordSource({...snapshot,inputIds:[id,randomUUID()]}),{code:'invalid_request',statusCode:409,message:'一次检查一份文案，请在材料选择中只选本次要检查的文件或稿件。'});
 assert.throws(()=>defaultWordSource({...snapshot,message:'检查违禁词'}),{code:'invalid_request',statusCode:409,message:'请用“检查：”后粘贴正文，或明确选择一份文件、稿件；混合说明需要明确原文范围。'});
 assert.throws(()=>wordSourceText({...snapshot,inputIds:[id],materialSelection:{inputs:false},selected:[{id,text:'隐式历史'}]},{kind:'input',inputId:id}));
 assert.throws(()=>locateWordText('重复重复',{wordText:'重复'}));
 assert.equal(wordCheckModelInput({...snapshot,selected:[{text:'秘密正文'}],taskScope:{wordCheck:scope}}).selected[0].characters,scope.characters);
});
test('word parser keeps three classes, safe positions, per-occurrence English ambiguity and rejects invalid zero',()=>{
 const text='最好 敏感 行业 cat concatenate <字>',raw={originalContent:text,content:'<script>evil()</script><span class="banned-word" onclick="evil()">最好</span> <span class="sensitive-word">敏感</span> <span class="industry-banned-word">行业</span> <span class="banned-word">cat</span> con<span class="banned-word">cat</span>enate &lt;字&gt;',prohibitedWordsType:[]};
 const parsed=parseXhsWords(raw,text);assert.equal(parsed.hits.length,5);assert.equal(parsed.hits[3]!.suspected,false);assert.equal(parsed.hits[4]!.suspected,true);assert.equal(parsed.hits[1]!.types[0],'sensitive-word');
 assert.throws(()=>parseXhsWords({...raw,originalContent:'different'},text));assert.throws(()=>parseXhsWords({...raw,content:'different'},text));assert.throws(()=>parseXhsWords({content:text},text));
 const zero=parseXhsWords(response('普通文案'),'普通文案');assert.equal(zero.hits.length,0);
 const changed=applyWordSuggestions(text,parsed.hits,parsed.hits.filter(h=>!h.suspected).map(h=>({hitId:h.id,replacement:'建议',reason:'局部替换'})));assert(changed.modifiedText.endsWith('concatenate <字>'));assert.equal(changed.modificationsComplete,true);
 const nested=parseXhsWords({originalContent:'最好文案',content:'<span class="banned-word">最好<span class="sensitive-word">文案</span></span>',prohibitedWordsType:[]},'最好文案');assert.equal(nested.hits.length,2);assert.equal(applyWordSuggestions('最好文案',nested.hits,nested.hits.map(h=>({hitId:h.id,replacement:'文案',reason:'合成'}))).modificationsComplete,false);
 assert.equal(parseMediaTool(operationId,response('普通文案'),{content:'普通文案'})[0]!.data.platform,'tools','old no-platform branch unchanged');
});
test('word workflows freeze exact batches, reuse duplicate calls without sleeping parent, and settle report or partial queries',async()=>{
 const [db]=await sql`SELECT current_database() name,inet_server_port() port`;assertConfiguredTestDatabase(db!.name,db!.port);
 const restore=await allowTestBudgetScope(['assistant.text','assistant.quote-preparation','redfox.query'],'member'),oldPrivate=config.allowPrivateNetworkFetch;
 const model=`word-${tag()}`;let modelCount=0,queryCount=0,repeated=false,scenario='zero',status=200,drop=false;const requests:any[]=[];
 const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{queryCount++;const input=JSON.parse(body);requests.push(input);assert.equal(req.url,'/story/api/cozeSkill/sensitiveWordSearch');if(input.platform){assert.equal(input.platform,'小红书');assert.equal(input.source,XHS_WORD_SOURCE);assert.equal(req.headers['x-api-key'],'synthetic-key');}else {assert.equal(input.source,undefined);assert.equal(req.headers.redfox_api_key,'synthetic-key');}if(drop){req.socket.destroy();return;}res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(input.platform&&input.content.length>2000?{code:1003,msg:'body.content参数长度超过限制，最大允许2000字符'}:{code:status===200?2000:429,data:response(input.content)}));});});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const modelStub=await stub((_hit,req)=>{
  modelCount++;const request=JSON.parse(req.body);
  if(request.response_format?.type==='json_object')return {choices:[{message:{content:JSON.stringify({skillId:'xiaohongshu-creator',moduleId:'M5',delivery:'word-check'})}}],usage:{prompt_tokens:50,completion_tokens:50}};
  const system=JSON.parse(request.messages[0].content.slice(request.messages[0].content.indexOf('{'))),messages=request.messages.filter((m:any)=>m.role==='tool').map((m:any)=>JSON.parse(m.content)),loaded=messages.find((m:any)=>m.entry);
  assert(!request.messages.some((m:any)=>typeof m.content==='string'&&m.content.includes('甲'.repeat(1000))),'execution model does not receive full source');
  if(!loaded)return completion('load_skill',{skillId:'xiaohongshu-creator',moduleId:'M5'});
  const queries=messages.filter((m:any)=>m.complete===true&&Array.isArray(m.hits));
  if(scenario==='duplicate'&&queries.length===1&&!repeated){repeated=true;return completion('check_xhs_words',{activationId:loaded.activationId,batch:0});}
  const completed=new Set(queries.map((q:any)=>q.batch)),scope=system.taskScope.wordCheck;
  if(completed.size<scope.batches.length)return completion('check_xhs_words',{activationId:loaded.activationId,batch:completed.size});
  const hits=[...new Map(queries.flatMap((q:any)=>q.hits.map((h:any)=>[h.id,h]))).values()] as any[];
  return completion('save_xhs_word_check',{activationId:loaded.activationId,title:'文案检测报告',suggestions:hits.filter(h=>!h.suspected).map(h=>({hitId:h.id,replacement:'较好',reason:'避免绝对化表述'}))});
 });
 try{
  config.allowPrivateNetworkFetch=true;Object.assign(process.env,{ASSISTANT_ENABLED:'true',ASSISTANT_CALLS_ENABLED:'true',ASSISTANT_MODEL_VERIFIED:'true',ASSISTANT_MODEL:'default',LLM_MODEL:model,LLM_BASE_URL:modelStub.url+'/v1',LLM_API_KEY:'synthetic-key',ASSISTANT_TOKENIZER:'cl100k_base',MODEL_CALLS_ENABLED:'true',REDFOX_TEST_BASE_URL:`http://127.0.0.1:${(server.address() as any).port}`,REDFOX_API_KEY:'synthetic-key',REDFOX_CALLS_ENABLED:'true'});
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('assistant.text','assistant.quote-preparation','redfox.query')`;
  await sql`INSERT INTO settings(key,value,updated_by) VALUES ('assistant.skills.xiaohongshu-creator','{"acceptingNew":true,"revision":1}','test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
  await sql`INSERT INTO service_prices(service,model,currency,per_request,source_url) VALUES ('redfox.query',${operationId},'CNY',0.001,'http://localhost/synthetic-word') ON CONFLICT(service,model) DO UPDATE SET per_request=EXCLUDED.per_request,source_url=EXCLUDED.source_url`;
  await sql`INSERT INTO service_prices(service,model,currency,input_per_mtok,output_per_mtok,source_url) VALUES ('llm',${model},'CNY',1,2,'http://localhost/synthetic-word')`;
  for(const [kind,provider,name,amount] of [['assistant-turn','assistant',model,7],['query','redfox',operationId,3]] as const){const [price]=await sql`SELECT id,version FROM member_tool_prices WHERE kind=${kind} AND provider=${provider} AND model=${name} AND tier='' AND parameter_match='{}'`;await saveToolPrice({...(price?{id:price.id,expectedVersion:price.version}:{}),kind,provider,model:name,baseCredits:amount,enabled:true,reason:'Synthetic word fixture'},'test');}
  const [user]=await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`words-${tag()}`},'words','synthetic') RETURNING id`;const uid=Number(user!.id);await grantCredits(uid,{amount:1000,reason:'Synthetic word fixture'},'test',randomUUID());
  {
   const {sessionId}=await createSession(uid,{assistantId:'creative'},randomUUID());
   const inputIds=[randomUUID(),randomUUID()];
   for(const id of inputIds)await sql`INSERT INTO assistant_session_inputs(id,session_id,text,hash,source) VALUES (${id},${sessionId},'待检查原文','synthetic',${sql.json({filename:'合成文案.txt'})})`;
   const raw={message:'检查违禁词',expectedRevision:1,skillSelection:{skillId:'xiaohongshu-creator'},taskChoice:{skillId:'xiaohongshu-creator',moduleId:'M5',delivery:'word-check'}};
   const beforeQuery=queryCount,beforeModel=modelCount;
   const {snapshot:oldSnapshot}=await snapshotInput(sql,uid,sessionId,{...raw,message:'检查：'+'甲'.repeat(10000),inputIds:[]});
   oldSnapshot.candidates=await candidates('creative',{skillId:'xiaohongshu-creator'},{'xiaohongshu-creator':'10'});
   await assert.rejects(taskPriceDefinition(oldSnapshot,{skillId:'xiaohongshu-creator',moduleId:'M5',delivery:'word-check'}),/批次数超过当前技能授权/);

   const [beforeQuotes]=await sql`SELECT count(*)::int n FROM member_tool_quotes WHERE user_id=${uid}`;
   await assert.rejects(quoteTurn(uid,sessionId,{...raw,inputIds}),{code:'invalid_request',statusCode:409,message:'一次检查一份文案，请在材料选择中只选本次要检查的文件或稿件。'});
   await assert.rejects(quoteTurn(uid,sessionId,{...raw,inputIds:[]}),{code:'invalid_request',statusCode:409,message:'请用“检查：”后粘贴正文，或明确选择一份文件、稿件；混合说明需要明确原文范围。'});
   const [afterQuotes]=await sql`SELECT count(*)::int n FROM member_tool_quotes WHERE user_id=${uid}`;
   assert.equal(afterQuotes!.n,beforeQuotes!.n);assert.equal(queryCount,beforeQuery);assert.equal(modelCount,beforeModel);
   const retained=await sessionSnapshot(uid,sessionId);assert.equal(retained.inputs.length,2);assert.equal(retained.turn,null);assert.equal(retained.revision,1);
  }
  for(const current of ['zero','duplicate','six','stop','capacity','cumulative','automatic','queued']){
   scenario=current;repeated=false;const before=queryCount,beforeModel=modelCount;const text=current==='cumulative'?('甲'.repeat(60)+'最好').repeat(162).slice(0,10000):current==='six'?'甲'.repeat(10000):['duplicate','stop','automatic'].includes(current)?'甲'.repeat(2700)+'最好'+'乙'.repeat(512):current==='capacity'?'最好，'.repeat(210):'普通\n文案😀';
   await sql`UPDATE operation_runs SET created_at=now()-interval '2 minutes' WHERE actor=${`user:${uid}`}`;
   const {sessionId}=await createSession(uid,{assistantId:'creative'},randomUUID());
   const raw={message:'检查：'+text,expectedRevision:1,skillSelection:{skillId:'xiaohongshu-creator'},...(current==='automatic'?{}:{taskChoice:{skillId:'xiaohongshu-creator',moduleId:'M5',delivery:'word-check'}})};
   let quote:any,entryId:string|undefined;
   if(current==='queued'){const entry=await enqueueMessage(uid,sessionId,{...raw,confirmationMode:'manual'},randomUUID());entryId=entry.entryId;const [stored]=await sql`SELECT quote,error FROM assistant_message_queue WHERE id=${entry.entryId}`;assert.equal(stored!.error,null);quote=stored!.quote;}
   else quote=await quoteTurn(uid,sessionId,raw);
   const scope=JSON.parse(quote.task!.scope).wordCheck;assert(scope.batches.every((b:any)=>b.end-b.start<=2000));if(current==='six')assert.equal(scope.batches.length,6);if(['duplicate','stop','automatic'].includes(current))assert.equal(scope.batches.length,2);assert.equal(scope.characters,text.length);assert.equal(quote.amount,7+scope.batches.length*3);
   if(current!=='queued')await assert.rejects(submitTurn(uid,sessionId,{...raw,message:raw.message+'更改',quoteId:quote.quoteId},randomUUID()),/变化|quote|确认/);
   const key=randomUUID();let run:{turnId:string;runId:number};if(entryId){const approved=await approveQueuedMessage(uid,sessionId,entryId,{quoteId:quote.quoteId});assert(approved.turnId);const [turn]=await sql`SELECT parent_operation_run_id FROM assistant_turns WHERE id=${approved.turnId}`;run={turnId:approved.turnId,runId:turn!.parent_operation_run_id};}else run=await submitTurn(uid,sessionId,{...raw,quoteId:quote.quoteId},key);if(!entryId)assert.equal((await submitTurn(uid,sessionId,{...raw,quoteId:quote.quoteId},key)).runId,run.runId);
   let done:any,stopped=false;
   for(let n=0;n<40;n++){
    done=await sessionSnapshot(uid,sessionId);if(done.turn.status==='completed')break;
    assert(!['needs_review','failed','waiting_question','waiting_approval'].includes(done.turn.phase),JSON.stringify(done.turn));
    const running=done.turn.calls.find((c:any)=>c.state==='running');const [child]=running?await sql`SELECT * FROM operation_runs WHERE id=${running.childRunId}`:[];
    const [parent]=await sql`SELECT * FROM operation_runs WHERE id=${run.runId}`;
    if(child?.status==='completed')assert.equal(parent!.status,'active','completed duplicate child must have an already queued active parent');
    const id=child&&['active','waiting'].includes(child.status)?child.id:run.runId,[step]=await sql`SELECT step_version,job_id FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,step!.step_version,step!.job_id??randomUUID());
    if(current==='stop'&&child&&id===child.id){await controlTurn(uid,sessionId,run.turnId,'stop',{generation:0});stopped=true;break;}
   }
   const partial=stopped||current==='capacity'||current==='cumulative',completedQueries=queryCount-before;
   const [charge]=await sql`SELECT * FROM member_credit_charges WHERE root_run_id=${run.runId}`;
   if(partial){assert.equal(charge!.consumed,completedQueries*3);assert.equal(charge!.released,quote.amount-completedQueries*3);}else{
    assert.equal(done.turn.status,'completed',JSON.stringify(done.turn));const artifact=done.artifacts.find((a:any)=>a.kind==='xhs-word-check');assert(artifact);const report=artifact.content.wordCheck;
    assert.equal(report.originalText,text);assert.equal(report.modifiedText,text.replaceAll('最好','较好'));assert.equal(report.batches.length,scope.batches.length);assert.equal(wordCheckInputProjection({content:artifact.content}).content.body,report.modifiedText);assert.equal(charge!.consumed,quote.amount);
   }
   if(!partial)assert.equal(queryCount-before,scope.batches.length);
   const [reserve]=await sql`SELECT count(*)::int n FROM member_credit_entries WHERE charge_id=${charge!.id} AND kind='reserve'`;assert.equal(reserve!.n,1);
   const calls=await sql`SELECT c.*,r.input run_input FROM assistant_tool_calls c JOIN operation_runs r ON r.id=c.child_run_id WHERE c.turn_id=${run.turnId} AND c.name='check_xhs_words' ORDER BY c.ordinal`;
   if(current==='duplicate'){const [reused]=await sql`SELECT result,child_run_id FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='check_xhs_words' AND result ? 'reusedRunId'`;assert.equal(reused!.child_run_id,null);assert.equal(reused!.result.reusedRunId,calls.find(c=>c.input.batch===0)!.child_run_id);const [children]=await sql`SELECT count(*)::int n FROM operation_runs WHERE input->>'assistantParentTurnId'=${run.turnId}`;assert.equal(children!.n,scope.batches.length);const [allocated]=await sql`SELECT count(*)::int n FROM member_credit_task_items WHERE charge_id=${charge!.id} AND item_key LIKE 'check-xhs-words%' AND run_id IS NOT NULL`;assert.equal(allocated!.n,scope.batches.length);}
   if(current==='six'){const items=await sql`SELECT item_key,run_id FROM member_credit_task_items WHERE charge_id=${charge!.id} AND item_key LIKE 'check-xhs-words%' ORDER BY item_key`;assert.equal(new Set(items.map(i=>i.run_id)).size,6);assert.equal(requests.at(-2).content,requests.at(-3).content,'identical text at distinct offsets has separate frozen allocation');}
   if(current==='cumulative'){
    assert(completedQueries>=2&&completedQueries<=6);
    assert.equal(modelCount-beforeModel,completedQueries+1,'only load and dispatched batch decisions; no over-capacity model call');
    assert.equal(done.artifacts.length,0);
    const [partialResult]=await sql`SELECT data FROM operation_results WHERE run_id=${run.runId} AND kind='assistant_research_result'`;
    assert.equal(partialResult!.data.reason,'context_capacity');
    const completed=await sql`SELECT result FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='check_xhs_words' AND state='completed'`;
    assert(completed.every(c=>JSON.stringify(c.result).length<12000));
    assert(completed.reduce((n,c)=>n+c.result.hits.length,0)<200);
   }
   const retained=await sessionSnapshot(uid,sessionId);assert.equal(retained.wordQueries?.length,partial?completedQueries:scope.batches.length);assert(!JSON.stringify(retained.wordQueries).includes('normalized'));
   if(partial){
    const nextRaw={message:'检查：下一份普通文案',expectedRevision:retained.revision,skillSelection:{skillId:'xiaohongshu-creator'},taskChoice:{skillId:'xiaohongshu-creator',moduleId:'M5',delivery:'word-check'}};
    const nextQuote=await quoteTurn(uid,sessionId,nextRaw);await submitTurn(uid,sessionId,{...nextRaw,quoteId:nextQuote.quoteId},randomUUID());
    const switched=await sessionSnapshot(uid,sessionId);assert.notEqual(switched.turn?.turnId,run.turnId);assert.deepEqual(switched.wordQueries,retained.wordQueries,'paid facts survive the next active turn without a partial artifact');
    await controlTurn(uid,sessionId,switched.turn!.turnId,'stop',{generation:0});
   }
   const hits=queryCount;
   if(current==='zero'){
    const [receipt]=await sql`SELECT receipt_id AS current_receipt_id FROM operation_results WHERE run_id=${calls[0]!.child_run_id} AND receipt_id IS NOT NULL LIMIT 1`;
    assert(receipt!.current_receipt_id);await sql`UPDATE receipts SET status='received' WHERE id=${receipt!.current_receipt_id}`;
    const recovered=await queryMediaTool(operationId,calls[0]!.run_input.parameters,calls[0]!.run_input.window,{});
    assert.equal(recovered.results[0]!.data.originalContent,text);const [stored]=await sql`SELECT attempts,status FROM receipts WHERE id=${receipt!.current_receipt_id}`;assert.equal(stored!.attempts,1);assert.equal(stored!.status,'received');
   }else await queryMediaTool(operationId,calls[0]!.run_input.parameters,calls[0]!.run_input.window,{});
   assert.equal(queryCount,hits,'received raw receipt parses locally without another outbound attempt');
  }
  const noOutbound=queryCount;
  for(const content of ['甲'.repeat(2001),'甲'.repeat(2773)]){
   await assert.rejects(normalizeToolInput(`user:${uid}`,'query',{operationId,parameters:{content,platform:'小红书'}}));
   await assert.rejects(queryMediaTool(operationId,{content,platform:'小红书'},tag(),{}));
  }
  assert.equal(queryCount,noOutbound,'oversized frozen requests cannot reach the supplier');
  await normalizeToolInput(`user:${uid}`,'query',{operationId,parameters:{content:'甲'.repeat(2000),platform:'小红书'}});
  await queryMediaTool(operationId,{content:'甲'.repeat(2999)},tag(),{});
  const parameters={content:'普通文案',platform:'小红书'},prior=queryCount;status=429;const window=tag();await assert.rejects(queryMediaTool(operationId,parameters,window,{}));await assert.rejects(queryMediaTool(operationId,parameters,window,{}));assert.equal(queryCount,prior+1);
  status=200;drop=true;const unknown=tag(),before=queryCount;await assert.rejects(queryMediaTool(operationId,parameters,unknown,{}));await assert.rejects(queryMediaTool(operationId,parameters,unknown,{}));assert.equal(queryCount,before+1);drop=false;
  await queryMediaTool(operationId,{content:'普通文案'},tag(),{});
 }finally{config.allowPrivateNetworkFetch=oldPrivate;await restore();await modelStub.close();await new Promise<void>(r=>server.close(()=>r()));}
});
after(async()=>{await stopBoss();await closeDb();});
