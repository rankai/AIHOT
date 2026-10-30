import {allowTestBudgetScope} from './setup.ts';
import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import http from 'node:http';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { getBoss, stopBoss, QUEUES } from '@aihot/backend/jobs/queue';
import { createAiSearch, createAiSearchQuery, parseAiSearchPoll, pollAiSearch, submitAiSearch } from '@aihot/backend/providers/redfox/ai-search';
import { aiSearchEngines, aiSearchPaths, aiSearchPolls } from '@aihot/backend/providers/redfox/ai-search-contract';
import { executeOperationStep } from '@aihot/backend/providers/operations/execute';
import { recoverOperations, releaseOperationReceipt } from '@aihot/backend/providers/operations/recovery';
import { abandonRun, resumeRun, claimRun, receiptOptions } from '@aihot/backend/providers/operations/store';
let mode='success';let productCards:unknown=undefined;const productReferences=[{id:'90071992547409931',index:1,title:'Synthetic reference',url:'https://example.test/reference',searchId:'opaque-guid'}]; const calls:Array<{path:string;body:Record<string,string>}> = [], runs:number[]=[];
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  assert.equal(req.method,'POST');assert.equal(req.headers.redfox_api_key,'synthetic-ai-search-key');
  const input=JSON.parse(body);calls.push({path:req.url!,body:input});
  if(mode==='disconnect'){req.socket.destroy();return;}
  res.setHeader('content-type','application/json');
  if(mode==='invalid'){res.end('{"code":2000,//broken');return;}
  const family=Object.entries(aiSearchPolls).find(([,id])=>aiSearchPaths[id]===req.url)?.[0];
  let data:Record<string,unknown>;
  if(input.inquiryText)data={taskId:'task-'+calls.length};
  else {
   const status=mode==='processing'?(family==='doubao'||family==='deepseek'?'running':'processing'):mode==='failed'?'failed':'completed';
   data={status,taskId:mode==='wrong'?'wrong':input.taskId,failReason:null,result:mode==='processing'||mode==='failed'?null:{content:'Synthetic answer <REF>unchanged</REF>',...(family==='kimi'?{webPages:[{url:'https://example.test/source',publishTime:null}]}:family==='doubao'||family==='deepseek'?{search_result:[{url:'https://example.test/source',published_at:'90071992547409930',cite_index:null},{url:'javascript:alert(1)',published_at:0}]}:{})},...(family==='kimi'?{completed:status!=='processing'}:{})};
  }
  if((family==='qianwenProducts'||family==='doubaoProducts')&&data.result){Object.assign(data.result,{...(productCards===undefined?{}:{cardData:productCards}),...(family==='doubaoProducts'?{searchGuid:productReferences,searchResult:{},queries:['synthetic']}:{})});}
  res.end(JSON.stringify({code:family==='deepseek'?200:2000,data}));
});});
let budgets:any[]=[];
let restoreAdminScope:()=>Promise<void>;
before(async()=>{restoreAdminScope=await allowTestBudgetScope(['redfox.ai_search', 'redfox.poll'],'admin');await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='synthetic-ai-search-key';process.env.REDFOX_CALLS_ENABLED='true';process.env.MODEL_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;
 budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.ai_search','redfox.poll')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.ai_search','redfox.poll')`;
});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
after(async()=>{await restoreAdminScope?.();for(const id of runs){const r=await row(id);if(!['completed','failed'].includes(r.status))await sql.begin(tx=>abandonRun(tx,{runId:id,stepVersion:r.step_version,generation:r.generation},'synthetic cleanup'));}for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
async function query(){const r=await createAiSearchQuery({family:'kimi',taskId:tag()},'ai-search-test',tag());runs.push(r.id);return r;}
async function job(id:number,due=false){const r=await row(id);if(due){await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${id}`;await sql`UPDATE pgboss.job SET start_after=now()-interval '1 second' WHERE id=${r.job_id}`;}await sql`UPDATE pgboss.job SET priority=2000000000 WHERE id=${r.job_id}`;const boss=await getBoss(),jobs=await boss.fetch<{runId:number;stepVersion:number}>(QUEUES.operation,{minPriority:2000000000});assert.equal(jobs.length,1);assert.equal(jobs[0]!.id,r.job_id);await executeOperationStep(id,jobs[0]!.data.stepVersion,jobs[0]!.id);await boss.complete(QUEUES.operation,jobs[0]!.id);}
async function missingJob(id:number){const r=await row(id);await sql`UPDATE pgboss.job SET state='completed' WHERE id=${r.job_id}`;await sql`UPDATE operation_runs SET job_id=NULL WHERE id=${id}`;}
async function recoverFixture(id:number){const [count]=await sql`SELECT count(*)::int AS n FROM operation_runs WHERE status IN ('active','waiting')`;for(let i=0;i<Math.ceil(count!.n/200)+3;i++){await recoverOperations();if((await row(id)).job_id)return;}assert.fail('fixture not recovered after bounded complete scan');}

test('all fixed endpoints preserve inquiry and poll identity through due jobs',async()=>{
 mode='success';for(const [engine,pair] of Object.entries(aiSearchEngines)){const text=' Synthetic inquiry with trailing whitespace ';
 const r=await createAiSearch({engine,inquiryText:text},'ai-search-test',tag());runs.push(r.id);const n=calls.length;await job(r.id);assert.deepEqual(calls[n],{path:aiSearchPaths[pair.submit],body:{inquiryText:text}});assert.equal((await row(r.id)).status,'waiting');await job(r.id,true);assert.equal(calls[n+1]!.path,aiSearchPaths[aiSearchPolls[pair.family]]);assert.deepEqual(Object.keys(calls[n+1]!.body),['taskId']);assert.equal((await row(r.id)).status,'completed');
 const [out]=await sql`SELECT * FROM operation_results WHERE run_id=${r.id} AND kind='ai_search_answer'`;assert.equal(out!.data.result.content,'Synthetic answer <REF>unchanged</REF>');assert.equal(out!.data.result.webPages,undefined);assert.equal(out!.data.result.search_result,undefined);
 const citations=await sql`SELECT data FROM operation_results WHERE run_id=${r.id} AND kind='ai_search_citation' ORDER BY id`;assert.equal(citations.length,out!.data.citationCount);if(pair.family==='deepseek'){assert.equal(citations[0]!.data.record.published_at,'90071992547409930');assert.equal(citations[1]!.data.url,null);}
 const receipts=await sql`SELECT p.service,p.model,p.cost FROM receipts p JOIN operation_results z ON z.receipt_id=p.id WHERE z.run_id=${r.id}`;assert.ok(receipts.some(p=>p.model===pair.submit&&p.service==='redfox.ai_search'&&Number(p.cost)===pair.price));
 }
});
test('processing advances sequence only after consumption; explicit task query never submits; failed preserves null',async()=>{mode='processing';const r=await query(),n=calls.length;await job(r.id);let current=await row(r.id);assert.equal(current.progress.pollSequence,1);assert.equal(current.status,'waiting');assert.ok(current.next_attempt_at>Date.now());assert.equal(calls[n]!.body.inquiryText,undefined);mode='failed';await job(r.id,true);assert.equal((await row(r.id)).status,'failed');const [out]=await sql`SELECT data FROM operation_results WHERE run_id=${r.id} AND item_key='poll:1'`;assert.equal(out!.data.failReason,null);});
test('family state contracts reject contradictions, wrong tasks, empty success and unknown states',()=>{
 assert.throws(()=>parseAiSearchPoll('kimi',{status:'completed',completed:false,result:{content:'x'}},'x'));
 assert.throws(()=>parseAiSearchPoll('kimi',{status:'processing',completed:true,result:{content:'x'}},'x'));
 assert.throws(()=>parseAiSearchPoll('kimi',{status:'completed',completed:true,failReason:'failed',result:{content:'x'}},'x'));
 for(const family of ['yuanbao','qianwen','baidu','doubao','deepseek'] as const){
  assert.throws(()=>parseAiSearchPoll(family,{status:'completed',taskId:'x',result:{content:''}},'x'));
  assert.throws(()=>parseAiSearchPoll(family,{status:'completed',taskId:'other',result:{content:'x'}},'x'));
  assert.throws(()=>parseAiSearchPoll(family,{status:'unknown',taskId:'x'},'x'));
  assert.equal(parseAiSearchPoll(family,{status:'failed',taskId:'x',failReason:null,result:null},'x').state,'failed');
 }
 assert.equal(parseAiSearchPoll('doubao',{status:'succeeded',taskId:'x',result:{content:'ok'}},'x').state,'succeeded');
 assert.equal(parseAiSearchPoll('kimi',{status:'processing',completed:false,result:null},'x').state,'pending');
});
test('stable commands reuse, changed input conflicts and strict input rejects before run/call',async()=>{mode='success';const key=tag(),input={engine:'kimiK3',inquiryText:'Synthetic share'};const r=await createAiSearch(input,'ai-search-test',key);runs.push(r.id);assert.equal((await createAiSearch(input,'ai-search-test',key)).id,r.id);await assert.rejects(createAiSearch({...input,inquiryText:'other'},'ai-search-test',key),/different input/);const n=calls.length;assert.throws(()=>createAiSearch({...input,apiKey:'forbidden'},'ai-search-test',tag()));assert.throws(()=>createAiSearch({engine:'other',inquiryText:'x'},'ai-search-test',tag()));assert.equal(calls.length,n);});
test('unknown submit remains review; poll unknown retries original receipt once after thirty minutes',async()=>{mode='disconnect';const r=await createAiSearch({engine:'deepseek',inquiryText:'Synthetic share'},'ai-search-test',tag());runs.push(r.id);await job(r.id);let state=await row(r.id);assert.equal(state.status,'needs_review');assert.equal((await releaseOperationReceipt(state.current_receipt_id,true)).released,false);
 const q=await query();await job(q.id);state=await row(q.id);assert.equal(state.status,'waiting');assert.equal((await releaseOperationReceipt(state.current_receipt_id)).released,false);const receipt=state.current_receipt_id;await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${receipt}`;assert.equal((await releaseOperationReceipt(receipt)).released,true);await job(q.id);state=await row(q.id);assert.equal(state.current_receipt_id,receipt);assert.equal(state.status,'needs_review');assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${receipt}`)[0]!.attempts,2);});
test('recovery finds AI search missing jobs, honors waiting time and consumes stored raw with all outbound disabled',async()=>{mode='success';const r=await createAiSearch({engine:'kimiK3',inquiryText:'Synthetic recovery'},'ai-search-test',tag());runs.push(r.id);await missingJob(r.id);await recoverFixture(r.id);await job(r.id);await missingJob(r.id);await recoverOperations();assert.equal((await row(r.id)).job_id,null);await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${r.id}`;await recoverFixture(r.id);await job(r.id);assert.equal((await row(r.id)).status,'completed');
 mode='invalid';const q=await query();await job(q.id);const state=await row(q.id);assert.equal(state.status,'needs_review');const [raw]=await sql`SELECT response FROM receipts WHERE id=${state.current_receipt_id}`;assert.match(raw!.response.body,/broken/);
 const n=calls.length;process.env.REDFOX_CALLS_ENABLED='false';
 try{await sql.begin(tx=>resumeRun(tx,{runId:q.id,stepVersion:state.step_version,generation:state.generation}));await missingJob(q.id);await recoverFixture(q.id);await job(q.id);assert.equal((await row(q.id)).status,'needs_review');assert.equal(calls.length,n);}finally{process.env.REDFOX_CALLS_ENABLED='true';}
 // Real localhost answer persisted by paidRequest; simulate interruption before saveResult/advanceRun.
 mode='success';const local=await query(),initial=await row(local.id);
 const execution=await sql.begin(tx=>claimRun(tx,{runId:local.id,stepVersion:initial.step_version,generation:initial.generation},initial.job_id));
 const received=await pollAiSearch('kimi',initial.progress.taskId,`run:${local.id}:poll:0`,receiptOptions(execution));
 await missingJob(local.id);process.env.REDFOX_CALLS_ENABLED='false';process.env.MODEL_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;const before=calls.length;
 try{await recoverFixture(local.id);await job(local.id);assert.equal((await row(local.id)).status,'completed');assert.equal(calls.length,before);assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${received.receiptId}`)[0]!.attempts,1);}finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-ai-search-key';process.env.MODEL_CALLS_ENABLED='true';}
});
test('budget prevents new attempts and wrong-task raw stays reusable without repurchase',async()=>{mode='success';await sql`UPDATE budgets SET per_minute=0 WHERE service='redfox.poll'`;const q=await query(),n=calls.length;try{await job(q.id);assert.equal((await row(q.id)).status,'waiting');assert.equal((await row(q.id)).current_receipt_id,null);assert.equal(calls.length,n);}finally{await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.poll'`;}
 mode='wrong';const bad=await query();await job(bad.id);let r=await row(bad.id);assert.equal(r.status,'needs_review');const before=calls.length;process.env.REDFOX_CALLS_ENABLED='false';try{await sql.begin(tx=>resumeRun(tx,{runId:bad.id,stepVersion:r.step_version,generation:r.generation}));await missingJob(bad.id);await recoverFixture(bad.id);await job(bad.id);assert.equal((await row(bad.id)).status,'needs_review');assert.equal(calls.length,before);}finally{process.env.REDFOX_CALLS_ENABLED='true';}
});
test('HTTP authentication/CSRF and frozen smaller limits use existing errors and read DTO without calls',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),{operationDetail}=await import('@aihot/backend/providers/operations/read');const app=await buildApp(),n=calls.length;
 const payload={engine:'kimiK3',inquiryText:'Synthetic sharing prose'};
 try{config.devAdmin=null;assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/ai-searches',payload})).statusCode,401);
 config.devAdmin={displayName:'AI search synthetic'};assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/ai-searches',payload})).statusCode,403);
 const headers={'x-csrf-token':'dev','idempotency-key':tag()};const one=await app.inject({method:'POST',url:'/api/admin/redfox/ai-searches',payload,headers});assert.equal(one.statusCode,202);runs.push(one.json().runId);
 assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/ai-searches',payload:{...payload,inquiryText:'changed'},headers})).statusCode,409);
 assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/ai-searches',payload:{...payload,engine:'unknown'},headers:{...headers,'idempotency-key':tag()}})).statusCode,400);
 const existing=await app.inject({method:'POST',url:'/api/admin/redfox/ai-searches/query',payload:{family:'baidu',taskId:tag()},headers:{...headers,'idempotency-key':tag()}});assert.equal(existing.statusCode,202);runs.push(existing.json().runId);
 const options=await app.inject({url:'/api/admin/redfox/ai-searches/options'});assert.equal(options.statusCode,200);assert.equal(options.json().engines.length,9);assert.equal(calls.length,n);
 await sql`UPDATE operation_runs SET limits=limits||'{"polls":1,"pollDeadlineSeconds":120}'::jsonb WHERE id=${existing.json().runId}`;
 const detail=await operationDetail(existing.json().runId);assert.equal(detail!.inputs.aiSearchPlan!.pollLimit,1);assert.equal(detail!.inputs.aiSearchPlan!.pollDeadlineSeconds,120);
 mode='processing';await job(existing.json().runId);const after=calls.length;await job(existing.json().runId,true);assert.equal((await row(existing.json().runId)).status,'needs_review');assert.equal(calls.length,after);
 }finally{await app.close();config.devAdmin=null;}
});
test('both outbound gates apply to submissions and polls, while collection gate is irrelevant',async()=>{
 const before=calls.length;
 for(const gate of ['REDFOX_CALLS_ENABLED','MODEL_CALLS_ENABLED'] as const){
  process.env[gate]='false';
  try{for(const submit of [true,false]){const r=submit?await createAiSearch({engine:'kimiK25',inquiryText:'Synthetic gate'},'ai-search-test',tag()):await createAiSearchQuery({family:'kimi',taskId:' opaque | task '},'ai-search-test',tag());runs.push(r.id);await job(r.id);assert.equal((await row(r.id)).status,'waiting');assert.equal((await row(r.id)).current_receipt_id,null);}}
  finally{process.env[gate]='true';}
 }
 assert.equal(calls.length,before);
 mode='success';process.env.COLLECT_ENABLED='false';const q=await createAiSearchQuery({family:'yuanbao',taskId:' opaque | task '},'ai-search-test',tag());runs.push(q.id);await job(q.id);assert.equal(calls.at(-1)!.body.taskId,' opaque | task ');assert.equal((await row(q.id)).status,'completed');
});

const productEngines=['qianwenProducts','doubaoProducts'] as const;
const productCard={title:'Synthetic product',price:'2???',originPrice:'￥3299',url:'https://example.test/item',image:'https://example.test/image',shopName:'Synthetic shop',sales:'已售3万+',sourceSeq:'tao_assistant_original',productId:'3750619017870705088'};
test('product searches keep distinct family endpoints, cards and original searchGuid without inventing legacy citations',async()=>{
 mode='success';productCards=[productCard];
 try{for(const engine of productEngines){const key=tag(),input={engine,inquiryText:'  Synthetic products  '},r=await createAiSearch(input,'ai-search-test',key);runs.push(r.id);assert.equal((await createAiSearch(input,'ai-search-test',key)).id,r.id);await job(r.id);mode='processing';await job(r.id,true);assert.equal((await row(r.id)).status,'waiting');assert.equal((await row(r.id)).progress.pollSequence,1);mode='success';await job(r.id,true);assert.equal((await row(r.id)).status,'completed');
 const [out]=await sql`SELECT data,receipt_id FROM operation_results WHERE run_id=${r.id} AND kind='ai_search_answer'`;assert.equal(out!.data.family,engine);assert.deepEqual(out!.data.result.cardData,[productCard]);assert.equal(out!.data.citationCount,0);assert.deepEqual(out!.data.result.searchGuid,engine==='doubaoProducts'?productReferences:undefined);
 const [receipt]=await sql`SELECT model,service,cost,cost_basis FROM receipts WHERE id=${out!.receipt_id}`;assert.equal(receipt!.model,aiSearchPolls[engine]);assert.equal(receipt!.service,'redfox.poll');assert.equal(Number(receipt!.cost),0);assert.equal(receipt!.cost_basis,'estimated');
 const explicit=await createAiSearchQuery({family:engine,taskId:'historical-product-task'},'ai-search-test',tag());runs.push(explicit.id);const before=calls.length;await job(explicit.id);assert.equal(calls.length,before+1);assert.equal(calls.at(-1)!.path,aiSearchPaths[aiSearchPolls[engine]]);assert.deepEqual(calls.at(-1)!.body,{taskId:'historical-product-task'});
 }}finally{productCards=undefined;}
});
test('product status/card contracts reject malformed cards and old Doubao states but accept no cards',()=>{
 for(const family of productEngines){const raw={taskId:'task',status:'completed',result:{content:'answer'}};
 for(const cardData of [undefined,null,[]])assert.equal(parseAiSearchPoll(family,{...raw,result:{...raw.result,...(cardData===undefined?{}:{cardData})}},'task').state,'succeeded');
 for(const cardData of [{},'[]',[null],[{}],[{title:'x',price:12}],[{title:'x',url:{href:'https://example.test'}}],[{title:'x',productId:123}]])assert.throws(()=>parseAiSearchPoll(family,{...raw,result:{...raw.result,cardData}},'task'));
 for(const status of ['queued','running','succeeded'])assert.throws(()=>parseAiSearchPoll(family,{...raw,status},'task'));
 assert.equal(parseAiSearchPoll(family,{taskId:'task',status:'processing',result:null},'task').state,'pending');assert.equal(parseAiSearchPoll(family,{taskId:'task',status:'failed',failReason:'Synthetic failure'},'task').state,'failed');
 assert.throws(()=>parseAiSearchPoll(family,{...raw,taskId:'wrong'},'task'));assert.throws(()=>parseAiSearchPoll(family,{...raw,failReason:'contradiction'},'task'));
 }
 assert.equal(parseAiSearchPoll('doubao',{taskId:'task',status:'running'},'task').state,'pending');assert.equal(parseAiSearchPoll('doubao',{taskId:'task',status:'succeeded',result:{content:'legacy'}},'task').state,'succeeded');
});
test('each product received submission recovers task ID offline without a second submission',async()=>{
 mode='success';for(const engine of productEngines){const input={engine,inquiryText:'Synthetic submission recovery'},r=await createAiSearch(input,'ai-search-test',tag());runs.push(r.id);const initial=await row(r.id),execution=await sql.begin(tx=>claimRun(tx,{runId:r.id,stepVersion:initial.step_version,generation:initial.generation},initial.job_id));
 const received=await submitAiSearch(input,`run:${r.id}:submit`,receiptOptions(execution));await missingJob(r.id);const before=calls.length;process.env.REDFOX_CALLS_ENABLED='false';process.env.MODEL_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{await recoverFixture(r.id);await job(r.id);const current=await row(r.id);assert.equal(current.status,'waiting');assert.equal(current.step_key,'redfox.ai_search.poll');assert.equal(current.progress.taskId,received.data.taskId);assert.equal(calls.length,before);assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${received.receiptId}`)[0]!.attempts,1);}
 finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.MODEL_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-ai-search-key';}
 await job(r.id,true);assert.equal(calls.at(-1)!.path,aiSearchPaths[aiSearchPolls[engine]]);assert.equal((await row(r.id)).status,'completed');
 }
});
test('product unknown submission stays manual; malformed received cards replay without buying again',async()=>{
 for(const engine of productEngines){mode='disconnect';const r=await createAiSearch({engine,inquiryText:'Synthetic unknown product search'},'ai-search-test',tag());runs.push(r.id);await job(r.id);const current=await row(r.id);assert.equal(current.status,'needs_review');const before=calls.length;assert.equal((await releaseOperationReceipt(current.current_receipt_id,true)).released,false);assert.equal(calls.length,before);}
 mode='success';productCards=[{title:'bad',price:{value:12}}];
 try{const q=await createAiSearchQuery({family:'doubaoProducts',taskId:tag()},'ai-search-test',tag());runs.push(q.id);await job(q.id);const held=await row(q.id);assert.equal(held.status,'needs_review');assert.equal((await sql`SELECT status FROM receipts WHERE id=${held.current_receipt_id}`)[0]!.status,'received');const before=calls.length;await sql.begin(tx=>resumeRun(tx,{runId:q.id,stepVersion:held.step_version,generation:held.generation}));await missingJob(q.id);process.env.REDFOX_CALLS_ENABLED='false';try{await recoverFixture(q.id);await job(q.id);assert.equal((await row(q.id)).status,'needs_review');assert.equal(calls.length,before);}finally{process.env.REDFOX_CALLS_ENABLED='true';}}
 finally{productCards=undefined;}
});

test('product price seed adds only four estimates and never overwrites configured prices',async()=>{
 const {readFile}=await import('node:fs/promises'),migration=await readFile(new URL('../database/migrations/0080_ai_search_product_prices.sql',import.meta.url),'utf8'),rollback=new Error('rollback synthetic price override');
 await assert.rejects(sql.begin(async tx=>{
  await tx`UPDATE service_prices SET per_request=7.89 WHERE service='redfox.ai_search' AND model='API_1793002507495'`;
  await tx.unsafe(migration);const prices=await tx`SELECT service,model,per_request FROM service_prices WHERE model IN ${tx(['API_1793002507495','API_1793002507566','API_1793002507670','API_1793002507727'])}`;assert.equal(prices.length,4);assert.equal(Number(prices.find(p=>p.model==='API_1793002507495')!.per_request),7.89);assert.equal(Number(prices.find(p=>p.model==='API_1793002507670')!.per_request),0.12);assert.ok(prices.filter(p=>p.service==='redfox.poll').every(p=>Number(p.per_request)===0));throw rollback;
 }),error=>error===rollback);
});
