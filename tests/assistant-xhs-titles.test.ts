import { allowTestBudgetScope,assertConfiguredTestDatabase,stub,tag } from './setup.ts';
import assert from 'node:assert/strict';
import { test,after } from 'node:test';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { sql,closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { saveToolPrice,grantCredits } from '@aihot/backend/users/credits';
import { createSession,quoteTurn,submitTurn,sessionSnapshot } from '@aihot/backend/assistant/sessions';
import { executeOperationStep } from '@aihot/backend/providers/operations/execute';
import { parseXhsTitles,xhsTitleResults } from '@aihot/backend/providers/redfox/xhs-titles';
import { XHS_TITLE_OPERATION as operationId,XHS_TITLE_SOURCE,XhsTitleInput } from '@aihot/backend/providers/redfox/xhs-title-contract';
import { coverCategories } from '@aihot/backend/providers/redfox/xhs-cover-contract';
import { titleGrade } from '@aihot/backend/assistant/title-report-contract';
import { titleReportInputProjection,normalizedTitle } from '@aihot/backend/assistant/title-report';
import { controlTurn } from '@aihot/backend/assistant/controls';
import { queryXhsTitles } from '@aihot/backend/providers/redfox/xhs-titles';
import { freezeResearchScope,validateResearchSearch,explicitAllSiteTitles } from '@aihot/backend/assistant/research-window';
import { candidates,catalog } from '@aihot/backend/assistant/catalog';
import { researchClock } from '@aihot/backend/assistant/xhs-research';
import { normalizeToolInput } from '@aihot/backend/users/tool-input';
const empty=()=>Object.fromEntries(coverCategories.map(category=>[category,[]]));
const dimensions=(score:number)=>Object.fromEntries(['keyword','structure','benefit','emotion','creativity','safety'].map(key=>[key,{score,reason:'合成编辑依据'}]));
const completion=(name:string,input:unknown)=>({id:'stub',created:1,model:'stub',choices:[{index:0,message:{role:'assistant',content:null,tool_calls:[{id:'call_0',type:'function',function:{name,arguments:JSON.stringify(input)}}]},finish_reason:'tool_calls'}]});
test('title projection preserves coverless full titles, four bucket counts and bounded distinct references',()=>{
 const title='这是超过封面四十字符投影上限的完整参考标题'.repeat(3),parameters={keyword:'防晒霜',startDate:'2026-11-01'};
 const rows=parseXhsTitles({...empty(),lowPowderExplosiveArticle:[{photoId:'same',title,useLikeCount:'97w+'},{photoId:'missing',title:''}],likeTheTop500:[{photoId:'same',title}]},parameters);
 const p=xhsTitleResults(rows);assert.equal(p.results[0]!.title,title);assert.equal(p.results[0]!.useLikeCount,'97w+');assert.equal(p.results[0]!.fans,null);
 assert.equal(p.metadata.rawCount,3);assert.equal(p.metadata.deduplicatedCount,1);assert.equal(p.metadata.projectedCount,1);assert.equal(p.results[0]!.categories.length,2);
 assert.throws(()=>parseXhsTitles({},parameters));
 const many=parseXhsTitles(Object.fromEntries(coverCategories.map(c=>[c,Array.from({length:25},(_,i)=>({photoId:`${c}-${i}`,title:'参考标题'}))])),parameters);
 assert.equal(many.length,81);assert.equal(many.at(-1)!.data.deduplicatedCount,100);assert(JSON.stringify(xhsTitleResults(many)).length<=12000);
 assert.throws(()=>XhsTitleInput.parse({...parameters,keyword:'字'.repeat(31)}));assert.equal(XhsTitleInput.parse({...parameters,keyword:' 防晒霜，防晒霜 '}).keyword,'防晒霜');
});
test('title arithmetic and frozen scope use display grade without subjective sample threshold',async()=>{
 for(const [n,grade] of [[9,'S'],[8.95,'S'],[7,'A'],[5,'B'],[4.9,'C']] as const)assert.equal(titleGrade(dimensions(n) as any).grade,grade);
 const mixed=dimensions(0);mixed.benefit={score:10,reason:'利益'};assert.equal(titleGrade(mixed as any).total,2.5);
 assert.equal(normalizedTitle('你 好！'),normalizedTitle('你好'));
 assert.equal(explicitAllSiteTitles('请查询全站热点标题'),true);
 for(const message of ['不要全站热点，只查防晒霜','请评标题：“查询全站热点”','不是查询全站热点，请查询防晒霜'])assert.equal(explicitAllSiteTitles(message),false);
 const all=await candidates('creative',{skillId:'xiaohongshu-creator'});await catalog();
 for(const [module,maximum,start] of [['M3-A',2,'defaultStartDate'],['M3-B',1,'earliestDate']] as const){
  const snapshot={candidates:all,taskScope:{skillId:'xiaohongshu-creator',moduleId:module,delivery:'title-report'},researchClock:researchClock(),message:'通勤防晒霜标题'};
  const scope=freezeResearchScope(snapshot)!;assert.equal(scope.maximumQueries,maximum);assert.equal(scope.startDate,scope.clock[start]);
  assert.deepEqual(freezeResearchScope({...snapshot,researchClock:researchClock(new Date('2027-01-01'))},scope),scope);
  assert.equal(freezeResearchScope({...snapshot,message:'通勤防晒霜标题，不要扩期'})!.maximumQueries,1);
 }
});
test('synthetic title workflows quote/freeze once, preserve originals and settle only real deliveries',async()=>{
 const [db]=await sql`SELECT current_database() name,inet_server_port() port`;assertConfiguredTestDatabase(db!.name,db!.port);
 const restore=await allowTestBudgetScope(['assistant.text','assistant.quote-preparation','redfox.query'],'member'),oldPrivate=config.allowPrivateNetworkFetch;
 const model=`title-${tag()}`;let mode='generate',emptyResult=false,expand=false,queryCount=0,emptyFirst=false,emptyExpanded=false,status=200,drop=false;
 const requests:URL[]=[];
 const server=http.createServer((req,res)=>{queryCount++;const url=new URL(req.url!,'http://localhost');requests.push(url);if(drop){req.socket.destroy();return;}assert.equal(req.method,'GET');assert.equal(req.headers['x-api-key'],'synthetic-key');assert.equal(url.searchParams.get('source'),XHS_TITLE_SOURCE);assert.equal(url.pathname,'/story/api/cozeSkill/getXhsCozeSkillData');res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({code:status===200?2000:429,data:{...empty(),likeTheTop500:emptyResult||emptyFirst||emptyExpanded&&url.searchParams.get('startDate')===researchClock().earliestDate?[]:[{photoId:'title-one',title:'通勤防晒不油腻',useLikeCount:'1w+'}]}}));emptyFirst=false;});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const modelStub=await stub((_hit,req)=>{
  const request=JSON.parse(req.body),system=JSON.parse(request.messages[0].content.slice(request.messages[0].content.indexOf('{'))),messages=request.messages.filter((m:any)=>m.role==='tool').map((m:any)=>JSON.parse(m.content)),loaded=messages.find((m:any)=>m.entry);
  if(!loaded)return completion('load_skill',{skillId:'xiaohongshu-creator',moduleId:mode==='generate'?'M3-A':'M3-B'});
  const queries=messages.filter((m:any)=>m.metadata?.operationId===operationId);
  if(!queries.length||expand&&queries.length===1)return completion('search_xhs_titles',{activationId:loaded.activationId,keyword:'防晒霜',startDate:queries.length?system.taskScope.research.clock.earliestDate:system.taskScope.research.startDate});
  const sourceIds=[...new Set(queries.flatMap((q:any)=>q.results.map((r:any)=>r.sourceId)))];
  return completion('save_xhs_title_report',{activationId:loaded.activationId,mode,title:'通勤防晒标题建议',summary:'根据实际参考，突出通勤场景与肤感利益；本次样本有限。',sampleIds:sourceIds,...(mode==='generate'?{candidates:Array.from({length:10},(_,i)=>({title:`通勤防晒建议${i+1}`,reason:'具体场景与利益表达',match:7,sourceIds}))}:{evaluations:[{title:'通勤防晒不油腻',dimensions:dimensions(8),summary:'利益明确，可优化结构',sourceIds,revisions:[{title:'通勤防晒这样选',scenario:'选购场景'},{title:'清爽通勤防晒霜',scenario:'使用场景'}]}]})});
 });
 try{
  config.allowPrivateNetworkFetch=true;Object.assign(process.env,{ASSISTANT_ENABLED:'true',ASSISTANT_CALLS_ENABLED:'true',ASSISTANT_MODEL_VERIFIED:'true',ASSISTANT_MODEL:'default',LLM_MODEL:model,LLM_BASE_URL:modelStub.url+'/v1',LLM_API_KEY:'synthetic-key',ASSISTANT_TOKENIZER:'cl100k_base',MODEL_CALLS_ENABLED:'true',REDFOX_TEST_BASE_URL:`http://127.0.0.1:${(server.address() as any).port}`,REDFOX_API_KEY:'synthetic-key',REDFOX_CALLS_ENABLED:'true'});
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('assistant.text','assistant.quote-preparation','redfox.query')`;
  await sql`INSERT INTO settings(key,value,updated_by) VALUES ('assistant.skills.xiaohongshu-creator','{"acceptingNew":true,"revision":1}','test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
  await sql`INSERT INTO service_prices(service,model,currency,per_request,source_url) VALUES ('redfox.query',${operationId},'CNY',0.001,'http://localhost/synthetic-title') ON CONFLICT(service,model) DO UPDATE SET per_request=EXCLUDED.per_request,source_url=EXCLUDED.source_url`;
  await sql`INSERT INTO service_prices(service,model,currency,input_per_mtok,output_per_mtok,source_url) VALUES ('llm',${model},'CNY',1,2,'http://localhost/synthetic-title')`;
  for(const [kind,provider,name,amount] of [['assistant-turn','assistant',model,7],['query','redfox',operationId,3]] as const){const [price]=await sql`SELECT id,version FROM member_tool_prices WHERE kind=${kind} AND provider=${provider} AND model=${name} AND tier='' AND parameter_match='{}'`;await saveToolPrice({...(price?{id:price.id,expectedVersion:price.version}:{}),kind,provider,model:name,baseCredits:amount,enabled:true,reason:'Synthetic title fixture'},'test');}
  await assert.rejects(normalizeToolInput('test','query',{provider:'redfox',operationId,parameters:{keyword:'防晒霜',startDate:'2026-11-01'}}),/不对前台/);
  const [user]=await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`titles-${tag()}`},'titles','synthetic') RETURNING id`;const uid=Number(user!.id);await grantCredits(uid,{amount:1000,reason:'Synthetic title fixture'},'test',randomUUID());
  for(const scenario of ['one','expand','expand-empty','both-empty','score','empty','stop-before','stop-query'] as const){
   mode=scenario==='score'?'score':'generate';expand=['expand','expand-empty','both-empty'].includes(scenario);emptyFirst=scenario==='expand';emptyExpanded=scenario==='expand-empty';emptyResult=scenario==='empty'||scenario==='both-empty';const before=queryCount;
   await sql`UPDATE operation_runs SET created_at=now()-interval '2 minutes' WHERE actor=${`user:${uid}`}`;
   const {sessionId}=await createSession(uid,{assistantId:scenario==='score'?'xiaohongshu':'creative'},randomUUID());
   const raw={message:mode==='score'?'请评价通勤防晒霜标题：通勤防晒不油腻':`给通勤防晒霜起10个标题${scenario==='empty'?'，不要扩期':''}`,expectedRevision:1,skillSelection:{skillId:'xiaohongshu-creator'},taskChoice:{skillId:'xiaohongshu-creator',moduleId:mode==='score'?'M3-B':'M3-A',delivery:'title-report'}};
   const quote=await quoteTurn(uid,sessionId,raw);assert.equal(quote.amount,scenario==='score'||scenario==='empty'?10:13);
   const key=randomUUID(),run=await submitTurn(uid,sessionId,{...raw,quoteId:quote.quoteId},key);assert.equal((await submitTurn(uid,sessionId,{...raw,quoteId:quote.quoteId},key)).runId,run.runId);
   let done:any;
   if(scenario==='stop-before'){
    await controlTurn(uid,sessionId,run.turnId,'stop',{generation:0});
    const [charge]=await sql`SELECT * FROM member_credit_charges WHERE root_run_id=${run.runId}`;assert.equal(charge!.released,13);assert.equal(queryCount,before);continue;
   }
   for(let n=0;n<30;n++){
    done=await sessionSnapshot(uid,sessionId);if(done.turn.status==='completed')break;
    assert(!['needs_review','failed','waiting_question','waiting_approval'].includes(done.turn.phase),JSON.stringify(done.turn));
    const running=done.turn.calls.find((c:any)=>c.state==='running');const [child]=running?await sql`SELECT * FROM operation_runs WHERE id=${running.childRunId}`:[];const id=child&&['active','waiting'].includes(child.status)?child.id:run.runId;
    const [step]=await sql`SELECT step_version,job_id FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,step!.step_version,step!.job_id??randomUUID());
    if(scenario==='stop-query'&&child&&id===child.id){
      const [completed]=await sql`SELECT status FROM operation_runs WHERE id=${child.id}`;
      if(completed!.status==='completed'){
       await controlTurn(uid,sessionId,run.turnId,'stop',{generation:0});
       const [charge]=await sql`SELECT * FROM member_credit_charges WHERE root_run_id=${run.runId}`;assert.equal(charge!.consumed,3);assert.equal(charge!.released,10);
       const [call]=await sql`SELECT state FROM assistant_tool_calls WHERE child_run_id=${child.id}`;assert.equal(call!.state,'completed');break;
      }
    }
   }
   if(scenario==='stop-query')continue;
   assert.equal(done.turn.status,'completed',JSON.stringify(done.turn));assert.equal(queryCount-before,expand?2:1);
   const reports=done.artifacts.filter((a:any)=>a.kind==='xhs-title-report');assert.equal(reports.length,emptyResult?0:1);
   if(reports.length){const report=reports[0].content.titleReport;assert.equal(report.evidence.analyzedCount,1);assert.equal(report.evidence.queries.length,expand?2:1);if(mode==='score'){assert.equal(report.evaluations[0].title,'通勤防晒不油腻');assert.equal(report.evaluations[0].total,8);assert.equal(report.evaluations[0].grade,'A');}else assert.equal(report.candidates.length,10);assert.equal(titleReportInputProjection({content:reports[0].content}).content.title,'');}
   if(scenario==='expand-empty'){
    const report=reports[0].content.titleReport;
    assert.equal(report.evidence.queries[0].projectedCount,1);
    assert.equal(report.evidence.queries[1].projectedCount,0);
    assert.equal(report.evidence.samples[0].title,'通勤防晒不油腻');
    assert(report.candidates.every((candidate:any)=>candidate.sourceIds.includes(report.evidence.samples[0].sourceId)));
   }
   const [charge]=await sql`SELECT * FROM member_credit_charges WHERE root_run_id=${run.runId}`;assert.equal(charge!.consumed,emptyResult?(expand?6:3):expand?13:10);assert.equal(charge!.released,emptyResult?7:scenario==='one'?3:0);
   const [turn]=await sql`SELECT * FROM assistant_turns WHERE id=${run.turnId}`;
   const [call]=await sql`SELECT * FROM assistant_tool_calls WHERE turn_id=${run.turnId} AND name='search_xhs_titles' ORDER BY ordinal LIMIT 1`;
   await assert.rejects(sql.begin(tx=>validateResearchSearch(tx,turn!,{name:'search_xhs_titles',id:randomUUID()},{...call!.input,keyword:'换品类',startDate:turn!.snapshot.researchClock.earliestDate})),/Invalid tool arguments/);
   const [childRun]=await sql`SELECT input FROM operation_runs WHERE id=${call!.child_run_id}`;
   const previousHits=queryCount;await queryXhsTitles(childRun!.input.parameters,childRun!.input.window,{});assert.equal(queryCount,previousHits,'saved raw response replay must not purchase another query');
   const [reserves]=await sql`SELECT count(*)::int n FROM member_credit_entries WHERE charge_id=${charge!.id} AND kind='reserve'`;assert.equal(reserves!.n,1);
  }
  status=429;const failedWindow=tag(),parameters={keyword:'防晒霜',startDate:'2026-11-01'},prior=queryCount;
  await assert.rejects(queryXhsTitles(parameters,failedWindow,{}));await assert.rejects(queryXhsTitles(parameters,failedWindow,{}));assert.equal(queryCount,prior+1,'429 does not resend');
  status=200;drop=true;const unknownWindow=tag(),priorUnknown=queryCount;
  await assert.rejects(queryXhsTitles(parameters,unknownWindow,{}));await assert.rejects(queryXhsTitles(parameters,unknownWindow,{}));assert.equal(queryCount,priorUnknown+1,'unknown response does not resend');
 }finally{config.allowPrivateNetworkFetch=oldPrivate;await restore();await modelStub.close();await new Promise<void>(r=>server.close(()=>r()));}
});
after(async()=>{await stopBoss();await closeDb();});
