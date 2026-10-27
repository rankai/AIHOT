import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {claimRun,receiptOptions,resumeRun} from '@aihot/backend/providers/operations/store';
import {requestAgentKey} from '@aihot/backend/providers/agentkey/request';
import {agentKeyConfig} from '@aihot/backend/providers/agentkey/config';
import {paidRequest,ProviderRejectedError} from '@aihot/backend/providers/receipts';
import {agentKeyXiaohongshuOperations as ops} from '@aihot/backend/providers/agentkey/xiaohongshu-contract';
import {parseAgentKeyXiaohongshu as parse} from '@aihot/backend/providers/agentkey/xiaohongshu-parser';
import {agentKeyRouteFor} from '@aihot/backend/providers/agentkey/routes';
import {xiaohongshuNoteId} from '@aihot/backend/lib/url';
import {importXiaohongshuResult} from '@aihot/backend/providers/redfox/import-xiaohongshu';
import {createPlatformSubscription,startPlatformSubscription,updatePlatformSubscription,preflightPlatformSubscriptionProvider,switchPlatformSubscriptionProvider} from '@aihot/backend/sources/platform-subscriptions';
import {stub,tag,assertConfiguredTestDatabase} from './setup.ts';
// Synthetic values follow the 2026-10-22 live field/shape evidence, not copied user data.
const noteId='note-test-1',uid='user-test-1',url=`https://www.xiaohongshu.com/discovery/item/${noteId}?xsec_token=synthetic&xsec_source=test`;
const n=()=>({id:noteId,type:'video',title:'笔记文字',desc:'原生描述',user:{userid:uid,nickname:'作者'},share_info:{link:url},create_time:1700000000,cursor:'cursor1',cursor_score:'score1',video_info:{url:'https://never.example/play'},geo_info:{location:'never'}});
const bodies=()=>[
 {code:0,success:true,data:{items:[{model_type:'ads',note:{id:'ad'}},{model_type:'note',note:n()}]},search_id:'search1',search_session_id:'session1',page:1,next_page:2},
 {code:0,success:true,data:{notes:[n()],has_more:true}},
 {code:0,success:true,data:[{model_type:'note',note_list:[{...n(),user:{userid:uid,id:uid,nickname:'作者'}}],user:{userid:uid}}]},
 {code:0,success:true,data:{comments:[{id:'comment1',content:'评论',note_id:noteId,time:1700000000,like_count:0,sub_comment_count:0,user:{userid:uid,nickname:'评论者'},ip_location:'never'}],cursor:'c1',has_more:true,page_context:'p1'}},
 {code:0,success:true,data:{users:[{id:uid,name:'账号',desc:'描述',red_id:'display-not-identity',link:'https://never.example',phone:'never'}]},search_id:'search1',page:1,next_page:2},
 {code:0,success:true,data:{result:{success:true,code:0},userid:uid,nickname:'账号',desc:'描述',fans:2,location:'never',phone:'never'}},
 {code:0,success:true,data:{items:[{...n(),user:{user_id:uid,nickname:'作者'}}],has_more:true}},
 {code:1000,success:true,ok:true,status:200,data:{sug_items:[{text:'建议',script:'never'}]}},
 {code:0,success:true,ok:true,status:200,data:{items:[{id:noteId,model_type:'note',note_card:{type:'video',display_title:'推荐',user:{userid:'unproved'},video:{url:'https://never.example'}}}],cursor_score:'score1'}},
];
const params=[{keyword:'测试'},{user_id:uid},{note_id:noteId},{note_id:noteId},{keyword:'账号'},{user_id:uid},{page_id:'topic1'},{keyword:'建议'},{}];
const response=(body:unknown)=>({httpStatus:200,mcp:{},envelope:{provider:'TikHub',data:{code:200,data:body}}});
let budgets:any[]=[];const testSubscriptions:number[]=[];
before(async()=>{const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);budgets=await sql`SELECT * FROM budgets WHERE service IN ('agentkey.query','agentkey.collect')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('agentkey.query','agentkey.collect')`;});
after(async()=>{if(testSubscriptions.length)await sql`UPDATE collection_subscriptions SET enabled=false WHERE id IN ${sql(testSubscriptions)}`;for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await stopBoss();await closeDb();});
async function withStub(body:unknown,run:(calls:any[])=>Promise<void>){const calls:any[]=[];const server=await stub(async(_hit,req)=>{const q=JSON.parse(req.body);if(q.method?.startsWith('notifications/'))return {};if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}};calls.push(q.params.arguments);return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:{provider:'TikHub',credits_charged:2,data:{code:200,data:typeof body==='function'?await body(q.params.arguments):body}}}};});const previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-xhs-test-key',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'false',REDFOX_CALLS_ENABLED:'false'});try{await run(calls);}finally{await server.close();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}}
async function step(id:number){const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,randomUUID());return (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;}
test('nine exact Q contracts, safe projections and no reply adapter',()=>{
 assert.equal(ops.length,9);assert.ok(ops.every(o=>o.route.estimatedCredits===2));
 for(const [i,b] of bodies().entries()){const p=parse(response(b),ops[i]!.route,params[i]);assert.equal(p.summary.count,1);assert.equal(p.summary.stopReason,'single-request');assert.doesNotMatch(JSON.stringify(p),/never|video_info|geo_info|phone|ip_location/);assert.equal(agentKeyRouteFor({provider:'agentkey',contract_version:1,operation_key:ops[i]!.route.operationKey,step_key:ops[i]!.route.stepKey,input:{operationId:ops[i]!.operationId,mode:'query'}}),ops[i]!.route);}
 const absentIdentity={...bodies()[2],data:[{model_type:'note',note_list:[{...n(),user:{id:uid,nickname:'author'}}],user:{userid:uid}}]};assert.deepEqual(parse(response(absentIdentity),ops[2].route,params[2]).candidates[0]!.data.identity,{});
 const search=parse(response(bodies()[0]),ops[0].route,params[0]);assert.equal(search.summary.excludedAds,1);assert.equal(search.candidates[0]!.data.url,null);assert.equal(search.candidates[0]!.data.publishedAt,null);assert.deepEqual(search.candidates[0]!.data.timeUnits,{create_time:'unspecified'});
 const detail=parse(response(bodies()[2]),ops[2].route,params[2]);assert.equal(detail.candidates[0]!.data.url,url);
 const rec=parse(response(bodies()[8]),ops[8].route,params[8]);assert.equal(rec.candidates[0]!.data.role,'provider_recommendation');assert.deepEqual(rec.candidates[0]!.data.identity,{});
 assert.throws(()=>ops[0].schema.parse({keyword:'x',ai_mode:1}));assert.throws(()=>ops[0].schema.parse({keyword:'x',page:2}));assert.throws(()=>ops[1].schema.parse({}));assert.throws(()=>ops[2].schema.parse({share_text:'https://xhslink.com/test'}));assert.throws(()=>ops[8].schema.parse({num:41}));
 assert.equal(agentKeyRouteFor({provider:'agentkey',contract_version:1,operation_key:'agentkey.xiaohongshu.comment_replies',step_key:'agentkey.xiaohongshu.comment_replies.query',input:{mode:'query'}}),undefined);
});
test('legal empty arrays differ from missing data, errors, unknown models and scope conflicts',()=>{
 const empty=[{...bodies()[0],data:{items:[]}},{...bodies()[1],data:{notes:[],has_more:false}},{...bodies()[2],data:[]},{...bodies()[3],data:{comments:[],cursor:'',has_more:false,page_context:''}},{...bodies()[4],data:{users:[]}},{...bodies()[6],data:{items:[],has_more:false}},{...bodies()[7],data:{sug_items:[]}},{...bodies()[8],data:{items:[],cursor_score:''}}];
 for(const [j,i] of [0,1,2,3,4,6,7,8].entries())assert.equal(parse(response(empty[j]),ops[i]!.route,params[i]).summary.count,0);
 for(let i=0;i<9;i++){assert.throws(()=>parse(response({...bodies()[i],data:null}),ops[i]!.route,params[i]));assert.throws(()=>parse(response({...bodies()[i],success:false}),ops[i]!.route,params[i]));}
 assert.throws(()=>parse(response({...bodies()[0],data:{items:[{model_type:'onebox'}]}}),ops[0].route,params[0]));
 assert.throws(()=>parse(response({...bodies()[0],code:1000}),ops[0].route,params[0]));
 assert.throws(()=>parse(response({...bodies()[1],data:{notes:[{...n(),user:{userid:'other'}}],has_more:false}}),ops[1].route,params[1]));
 assert.throws(()=>parse(response({...bodies()[2],data:[{model_type:'note',note_list:[{...n(),share_info:{link:url.replace(noteId,'other')}}]}]}),ops[2].route,params[2]));
 assert.throws(()=>parse(response(bodies()[3]),ops[3].route,{note_id:'other'}));assert.throws(()=>parse(response(bodies()[5]),ops[5].route,{user_id:'other'}));
 for(const u of [url.replace('https:','http:'),url.replace('www.xiaohongshu.com','xiaohongshu.com.evil'),url.replace('www.','u@www.'),url.replace('.com/','.com:81/'),url+'#x'])assert.equal(xiaohongshuNoteId(u),null);
 assert.equal(xiaohongshuNoteId(url),noteId);assert.equal(xiaohongshuNoteId(`http://xiaohongshu.com/explore/${noteId}`),noteId);
});
test('nine Q dispatcher routes persist receipts/results and never import or bind',async()=>{
 for(let i=0;i<9;i++)await withStub(bodies()[i],async calls=>{const op=ops[i]!,run=await createAgentKeyQuery({provider:'agentkey',operationId:op.operationId,parameters:params[i]},'test',tag());assert.equal(run.input.platform,'xiaohongshu');const done=await step(run.id);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(calls.length,1);assert.equal(calls[0].name,op.route.tool);assert.deepEqual(calls[0].params,op.schema.parse(params[i]));const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.source_id===null&&r.article_id===null));const summary=rows.find(r=>r.kind==='query_summary')!;assert.equal(summary.data.count,1);const [receipt]=await sql`SELECT status,usage FROM receipts WHERE id=${summary.receipt_id}`;assert.equal(receipt!.status,'completed');assert.equal(receipt!.usage.chargedCredits,2);});
});
test('received interruption resumes with valves closed; bad scope remains received and never repurchases',async()=>{
 await withStub(bodies()[2],async calls=>{const run=await createAgentKeyQuery({provider:'agentkey',operationId:ops[2].operationId,parameters:params[2]},'test',tag());const exec=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));await requestAgentKey(exec,run,ops[2].route,ops[2].schema.parse(params[2]));process.env.AGENTKEY_CALLS_ENABLED='false';assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);});
 await withStub(bodies()[3],async calls=>{const run=await createAgentKeyQuery({provider:'agentkey',operationId:ops[3].operationId,parameters:{note_id:'other'}},'test',tag());const failed=await step(run.id);assert.equal(failed.status,'needs_review');assert.equal((await sql`SELECT status FROM receipts WHERE id=${failed.current_receipt_id}`)[0]!.status,'received');process.env.AGENTKEY_CALLS_ENABLED='false';await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:failed.step_version,generation:failed.generation}));assert.equal((await step(run.id)).status,'needs_review');assert.equal(calls.length,1);});
});
test('a matching failed head receipt starts a new bounded attempt instead of needing review',async()=>{
 await withStub(bodies()[2],async calls=>{
  const route=ops[2]!.route,routeParams=ops[2]!.querySchema.parse(params[2]);
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:ops[2]!.operationId,parameters:routeParams},'test',tag());
  const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));
  const endpoint=agentKeyConfig().url.href;
  const identity={runId:run.id,stepVersion:run.step_version,endpoint,contractVersion:route.contractVersion,tool:route.tool,params:routeParams};
  await assert.rejects(paidRequest({service:'agentkey.query',purpose:route.operationKey,model:route.tool,subject:`operation:${run.id}`,
    identity,estimatedUsage:{estimatedCredits:route.estimatedCredits},requestSummary:{tool:route.tool,endpoint,params:routeParams}},
  async()=>{throw new ProviderRejectedError('synthetic rejected first attempt',429,true,{
    response:{httpStatus:429,mcp:{},envelope:{error:'rate_limited'},retryAfter:'0'},
  });},receiptOptions(execution)),ProviderRejectedError);
  const receiptId=(await sql`SELECT current_receipt_id FROM operation_runs WHERE id=${run.id}`)[0]!.current_receipt_id;
  assert.equal((await sql`SELECT status FROM receipts WHERE id=${receiptId}`)[0]!.status,'failed');

  const completed=await step(run.id);
  assert.equal(completed.status,'completed',JSON.stringify(completed));
  assert.equal(calls.length,1);
  const [receipt]=await sql`SELECT status,attempts FROM receipts WHERE id=${receiptId}`;
  assert.deepEqual(receipt,{status:'completed',attempts:2});
  assert.deepEqual((await sql`SELECT attempt,status FROM receipt_attempts WHERE receipt_id=${receiptId} ORDER BY attempt`).map(row=>({...row})),
    [{attempt:1,status:'failed'},{attempt:2,status:'received'}]);
 });
});
test('admin query catalogue and HTTP route expose nine variants with estimated prices and no reply',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),{config}=await import('@aihot/backend/config'),app=await buildApp(),previous=config.devAdmin;config.devAdmin={displayName:'XHS synthetic test'};
 try{const res=await app.inject({method:'GET',url:'/api/admin/redfox/operations'});assert.equal(res.statusCode,200,res.body);const catalogue=res.json() as any[];
  for(const op of ops){const entry=catalogue.find(x=>x.id===op.operationId),variant=entry.collectionProviders.find((v:any)=>v.id==='agentkey');assert.equal(variant.collectionPrice.amount,2);assert.equal(variant.collectionPrice.basis,'estimated');assert.equal(variant.collectionCapabilities.detailEnrichment,['384C6W6B','XN3ULENA'].includes(op.operationId));if(op.operationId.startsWith('xiaohongshu.'))assert.equal(entry.schedulableType,['xiaohongshu.comments','xiaohongshu.topic_posts','xiaohongshu.recommendations'].includes(op.operationId)?'list':null);}
  assert.equal(catalogue.some(x=>x.id==='xiaohongshu.comment_replies'),false);
  await withStub(bodies()[7],async calls=>{const r=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{provider:'agentkey',operationId:ops[7].operationId,parameters:{keyword:'建议'}}});assert.equal(r.statusCode,202,r.body);assert.equal((await step(r.json().runId)).status,'completed');assert.equal(calls.length,1);});
 }finally{config.devAdmin=previous;await app.close();}
});
const uniqueBody=(body:unknown,nid:string,user:string)=>JSON.parse(JSON.stringify(body).replaceAll(noteId,nid).replaceAll(uid,user));
async function queryResult(i:number,parameters:unknown){const run=await createAgentKeyQuery({provider:'agentkey',operationId:ops[i]!.operationId,parameters},'test',tag());assert.equal((await step(run.id)).status,'completed');return (await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind<>'query_summary'`)[0]!;}
test('single-page search results do not require continuation metadata',()=>{
 for(const i of [0,4]){const b={...bodies()[i]} as Record<string,unknown>;for(const k of ['search_id','search_session_id','page','next_page'])delete b[k];const p=parse(response(b),ops[i]!.route,params[i]);assert.equal(p.summary.count,1);assert.deepEqual(p.summary.pagination,{});}
});
test('I revalidates original receipt, preserves signed URL/body/unknown time, historical hints and stable identity',async()=>{
 const nid='import-'+randomUUID(),user='user-'+randomUUID();let result:any,imported:any;
 await withStub(uniqueBody(bodies()[2],nid,user),async()=>{
  result=await queryResult(2,{note_id:nid});
  await assert.rejects(importXiaohongshuResult(result.id,{reason:'manual',supplement:{url:`https://xiaohongshu.com/explore/${nid}`,evidence:'manual'}},'test',tag()),/supplements/);
  await sql`UPDATE operation_results SET data=jsonb_set(data,'{importable}','false') WHERE id=${result.id}`;
  imported=await importXiaohongshuResult(result.id,{sourceId:await selectedSource(),reason:'test import'},'test',tag());assert.ok(imported?.articleId);
  const [s]=await sql`SELECT participation_mode,site_fulltext,syndicate_fulltext FROM sources WHERE id=${imported.sourceId}`;assert.deepEqual({...s},{participation_mode:'isolated',site_fulltext:false,syndicate_fulltext:false});
  const [a]=await sql`SELECT url,body_text,body_status,published_at,backfill,raw FROM articles WHERE id=${imported.articleId}`;assert.equal(a!.url,url.replace(noteId,nid));assert.equal(a!.body_text,'原生描述');assert.equal(a!.body_status,'ok');assert.equal(a!.published_at,null);assert.equal(a!.backfill,true);assert.equal(a!.raw.provider,'agentkey');
  assert.equal((await importXiaohongshuResult(result.id,{sourceId:await selectedSource(),reason:'repeat'},'test',tag()))!.articleId,imported.articleId);
  const other=await queryResult(2,{note_id:nid});await sql`UPDATE operation_results SET data=jsonb_set(data,'{title}','"tampered"') WHERE id=${other.id}`;await assert.rejects(importXiaohongshuResult(other.id,{reason:'tampered'},'test',tag()),/differs/);
  await sql`UPDATE operation_results SET data=${sql.json(other.data)} WHERE id=${other.id}`;assert.equal((await importXiaohongshuResult(other.id,{sourceId:await selectedSource(),reason:'same note'},'test',tag()))!.articleId,imported.articleId);
 });
 await withStub(uniqueBody(bodies()[6],nid,user),async()=>{const r=await queryResult(6,{page_id:'topic1'});assert.equal((await importXiaohongshuResult(r.id,{sourceId:await selectedSource(),reason:'topic dedup'},'test',tag()))!.articleId,imported.articleId);});
 for(const i of [0,1,8])await withStub(uniqueBody(bodies()[i],nid,user),async()=>{const r=await queryResult(i,i===1?{user_id:user}:params[i]);await assert.rejects(importXiaohongshuResult(r.id,{reason:'not importable',supplement:{url:url.replace(noteId,nid),userId:user,evidence:'manual'}},'test',tag()));});
 await withStub(uniqueBody(bodies()[4],nid,user),async()=>{const r=await queryResult(4,params[4]);const bound=await importXiaohongshuResult(r.id,{sourceId:await selectedSource(),reason:'bind actual account'},'test',tag());assert.equal(bound!.sourceId,imported.sourceId);assert.equal(bound!.articleId,null);const [b]=await sql`SELECT id_value FROM source_account_bindings WHERE source_id=${imported.sourceId} AND platform='xiaohongshu'`;assert.equal(b!.id_value,user);});
});
async function subscription(i:number,enrich=false,items=3,details=1){const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:'XHS test',provider:'agentkey',operationId:ops[i]!.operationId,parameters:params[i],enabled:true,enrichDetails:enrich,...(enrich?{detailOperationId:'KR1LPTBF'}:{}),limits:{pages:5,items,details}},'test',tag());testSubscriptions.push(sub.id);return sub;}
test('five S homepage routes retain every selected item, release and schedule without extra calls',async()=>{
 for(const i of [0,1,3,6,8])await withStub(bodies()[i],async calls=>{
  process.env.COLLECT_ENABLED='true';const sub=await subscription(i),run=await startPlatformSubscription(sub.id,'test',tag());assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);
  const [s]=await sql`SELECT limits,progress,active_run_id,next_run_at>now() AS scheduled FROM collection_subscriptions WHERE id=${sub.id}`;assert.deepEqual(s!.limits,{pages:1,items:3,details:0});assert.equal(s!.active_run_id,null);assert.equal(s!.scheduled,true);assert.deepEqual(s!.progress,{pages:1,items:1,details:0,stopReason:'single-request',nextParameters:null});
  const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`,summary=rows.find(r=>r.kind==='query_summary')!,item=rows.find(r=>r.kind!=='query_summary')!;assert.equal(summary.data.count,1);assert.equal(summary.data.selectedCount,1);assert.equal(summary.data.nextParameters,null);
  if(i===6)assert.ok(item.article_id);else assert.equal(item.article_id,null);
  if([0,1].includes(i))assert.match(item.data.pendingReason,/received native URL/);
 });
 for(const i of [2,4,5,7])await assert.rejects(subscription(i));
});
test('bounded same-run list/detail chain imports only selected details and keeps first discovery time',async()=>{
 const nid='bounded-'+randomUUID(),user='user-'+randomUUID();
 const extra={...n(),id:'note-test-2'},list={...bodies()[0],data:{items:[{model_type:'note',note:n()},{model_type:'note',note:extra},{model_type:'note',note:{...n(),id:'note-test-3'}}]}};
 await withStub((call:any)=>call.name===ops[2].route.tool?uniqueBody(bodies()[2],nid,user):uniqueBody(list,nid,user),async calls=>{
  process.env.COLLECT_ENABLED='true';const sub=await subscription(0,true,2,1),run=await startPlatformSubscription(sub.id,'test',tag());let state=await step(run.id);assert.equal(state.status,'active');assert.equal(state.step_key,ops[2].route.stepKey);assert.equal(state.progress.detailItems.length,1);assert.equal(calls.length,1);
  const [listSummary]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='query_summary'`;assert.equal(listSummary!.data.count,3);assert.equal(listSummary!.data.selectedCount,2);assert.equal(listSummary!.data.unprocessedDueToLimit,1);
  const [original]=await sql`SELECT z.*,p.received_at FROM operation_results z JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${state.progress.detailItems[0]}`;assert.equal(original!.article_id,null);
  state=await step(run.id);assert.equal(state.status,'completed',JSON.stringify(state));assert.equal(calls.length,2);assert.equal(calls[1].params.note_id,nid);
  const [detail]=await sql`SELECT z.* FROM operation_results z WHERE run_id=${run.id} AND kind='xiaohongshu_work' AND step_version>${original!.step_version}`;assert.ok(detail!.article_id);const [article]=await sql`SELECT discovered_at FROM articles WHERE id=${detail!.article_id}`;assert.equal(article!.discovered_at.toISOString(),original!.received_at.toISOString());
  const [s]=await sql`SELECT progress,active_run_id FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(s!.progress.details,1);assert.equal(s!.progress.items,2);assert.equal(s!.active_run_id,null);
  const [summary]=await sql`SELECT data FROM operation_results WHERE id=${detail!.data.querySummaryId}`;assert.equal(summary!.data.originResultId,original!.id);
  const receipts=await sql`SELECT status FROM receipts WHERE subject=${`operation:${run.id}`}`;assert.ok(receipts.every(r=>r.status==='completed'));
 });
});
for(const i of [0,1])test(`${i===0?'search':'account_posts'} detail without received author imports to its frozen source and advances without repurchasing`,async()=>{
 const first='missing-author-'+randomUUID(),second='next-detail-'+randomUUID(),user='user-'+randomUUID();
 const notes=[first,second].map(id=>({...n(),id,user:{userid:user,nickname:'列表作者'}}));
 const list={code:0,success:true,data:i===0?{items:notes.map(note=>({model_type:'note',note}))}:{notes,has_more:false}};
 await withStub((call:any)=>{
  if(call.name!==ops[2].route.tool)return list;
  const id=call.params.note_id;
  return {code:0,success:true,data:[{model_type:'note',note_list:[{...n(),id,user:id===first?{id:user,nickname:'详情未证实作者'}:{userid:user,id:user},share_info:{link:url.replace(noteId,id)}}],user:{userid:user}}]};
 },async calls=>{
  process.env.COLLECT_ENABLED='true';
  const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:'XHS missing detail author',provider:'agentkey',operationId:ops[i]!.operationId,parameters:i===0?{keyword:'缺作者详情'}:{user_id:user},enabled:true,enrichDetails:true,detailOperationId:'KR1LPTBF',limits:{pages:1,items:2,details:2}},'test',tag());testSubscriptions.push(sub.id);
  const run=await startPlatformSubscription(sub.id,'test',tag());let state=await step(run.id);assert.equal(state.status,'active');assert.equal(state.progress.detailItems.length,2);
  const listVersion=state.step_version-1,detailVersion=state.step_version;
  const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:state.step_version,generation:state.generation},randomUUID()));
  const received=await requestAgentKey(execution,state as any,ops[2].route,{note_id:first});assert.equal(calls.length,2);
  process.env.COLLECT_ENABLED='false';process.env.AGENTKEY_CALLS_ENABLED='false';
  state=await step(run.id);assert.equal(state.status,'active',JSON.stringify(state));assert.equal(state.progress.detailIndex,1);assert.equal(state.progress.parameters.note_id,second);assert.equal(calls.length,2);
  const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND step_version=${detailVersion}`;
  assert.equal(rows.length,2);const summary=rows.find(r=>r.kind==='query_summary')!,item=rows.find(r=>r.kind==='xiaohongshu_work')!;
  assert.equal(summary.data.count,1);assert.equal(summary.data.selectedCount,1);assert.equal(summary.receipt_id,received.receiptId);assert.equal(item.receipt_id,received.receiptId);
  assert.equal(item.data.workId,first);assert.deepEqual(item.data.identity,{});assert.equal((item.data.record as any).userId,undefined);assert.equal(item.data.importable,true);assert.equal(item.data.pendingReason,undefined);assert.equal(item.source_id,await selectedSource());assert.ok(item.article_id);
  const [origin]=await sql`SELECT * FROM operation_results WHERE id=${summary.data.originResultId}`;assert.equal(origin!.step_version,listVersion);assert.equal(origin!.data.identity.userId,user);
  assert.equal((await importXiaohongshuResult(item.id,{reason:'missing received author'},'test',tag()))!.articleId,item.article_id);
  await assert.rejects(importXiaohongshuResult(item.id,{reason:'cannot copy list author',supplement:{userId:user,evidence:'list author'}},'test',tag()),/received native URL and work identity/);
  assert.equal((await sql`SELECT id_value FROM source_account_bindings WHERE platform='xiaohongshu' AND id_value=${user}`).length,0);
  assert.equal((await sql`SELECT status FROM receipts WHERE id=${received.receiptId}`)[0]!.status,'completed');
  const [occupied]=await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(occupied!.active_run_id,run.id);
  process.env.COLLECT_ENABLED='true';process.env.AGENTKEY_CALLS_ENABLED='true';
  state=await step(run.id);assert.equal(state.status,'completed',JSON.stringify(state));assert.equal(calls.length,3);assert.deepEqual(calls.slice(1).map(call=>call.params.note_id),[first,second]);
  const [next]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='xiaohongshu_work' AND data->>'workId'=${second} AND step_version>${detailVersion}`;assert.ok(next!.article_id);assert.ok(next!.source_id);
  const [finished]=await sql`SELECT active_run_id,progress,next_run_at>now() AS scheduled FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(finished!.active_run_id,null);assert.equal(finished!.progress.details,2);assert.equal(finished!.scheduled,true);
  const receipts=await sql`SELECT status FROM receipts WHERE subject=${`operation:${run.id}`}`;assert.equal(receipts.length,3);assert.ok(receipts.every(r=>r.status==='completed'));
  const [pending]=await sql`SELECT source_id,article_id,data FROM operation_results WHERE id=${item.id}`;assert.equal(pending!.source_id,await selectedSource());assert.equal(pending!.article_id,item.article_id);assert.deepEqual(pending!.data.identity,{});
 });
});
test('detail interruption reuses receipt with valves closed; invalidated list run cannot buy or import',async()=>{
 await withStub((call:any)=>call.name===ops[2].route.tool?bodies()[2]:bodies()[1],async calls=>{
  process.env.COLLECT_ENABLED='true';const sub=await subscription(1,true),run=await startPlatformSubscription(sub.id,'test',tag());const state=await step(run.id);assert.equal(state.status,'active');
  const e=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:state.step_version,generation:state.generation},randomUUID()));await requestAgentKey(e,state as any,ops[2].route,{note_id:noteId});process.env.COLLECT_ENABLED='false';process.env.AGENTKEY_CALLS_ENABLED='false';assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,2);
 });
 await withStub(bodies()[1],async calls=>{
  process.env.COLLECT_ENABLED='true';const sub=await subscription(1,true),run=await startPlatformSubscription(sub.id,'test',tag());const state=await step(run.id);assert.equal(state.status,'active');
  await updatePlatformSubscription(sub.id,{editVersion:1,config:{name:'changed',provider:'agentkey',operationId:ops[1].operationId,parameters:params[1],enabled:false,enrichDetails:false,limits:{pages:1,items:1,details:0}}},'test');assert.equal((await step(run.id)).status,'stopped');assert.equal(calls.length,1);assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND article_id IS NOT NULL`).length,0);
 });
});
test('XHS provider preflight preserves original requirements and blocks unproved material equivalence',async()=>{
 const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:'RF XHS',provider:'redfox',operationId:'384C6W6B',parameters:{keyword:'x',exactMatch:true},enabled:false,limits:{pages:3,items:5,details:0}},'test',tag());
 const p=await preflightPlatformSubscriptionProvider(sub.id,{editVersion:1,targetProvider:'agentkey'});assert.equal(p!.supported,false);assert.ok(p!.checks.some(c=>c.key==='parameters'&&c.conclusion==='unsupported'&&c.evidence.includes('首页')));assert.ok(p!.checks.some(c=>c.key==='execution'&&c.evidence.includes('原文 URL')));
 await assert.rejects(switchPlatformSubscriptionProvider(sub.id,{editVersion:1,targetProvider:'agentkey',reason:'not compatible'},'test'));const [same]=await sql`SELECT provider,config,limits FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(same!.provider,'redfox');assert.equal(same!.config.parameters.exactMatch,true);assert.equal(same!.limits.pages,3);
});
test('in-flight detail after subscription invalidation retains receipt without current material writes',async()=>{
 let subId=0;
 await withStub(async(call:any)=>{
  if(call.name!==ops[2].route.tool)return bodies()[1];
  await updatePlatformSubscription(subId,{editVersion:1,config:{name:'changed in flight',provider:'agentkey',operationId:ops[1].operationId,parameters:params[1],enabled:false,enrichDetails:false,limits:{pages:1,items:1,details:0}}},'test');return bodies()[2];
 },async calls=>{
  process.env.COLLECT_ENABLED='true';const sub=await subscription(1,true);subId=sub.id;const run=await startPlatformSubscription(sub.id,'test',tag());assert.equal((await step(run.id)).status,'active');assert.equal((await step(run.id)).status,'stopped');assert.equal(calls.length,2);
  assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND article_id IS NOT NULL`).length,0);const receipts=await sql`SELECT status FROM receipts WHERE subject=${`operation:${run.id}`}`;assert.equal(receipts.length,2);assert.ok(receipts.every(r=>r.status==='received'));
 });
});
test('detail cannot import when received author contradicts retained discovery',async()=>{
 await withStub((call:any)=>call.name===ops[2].route.tool?uniqueBody(bodies()[2],noteId,'wrong-author'):bodies()[1],async calls=>{
  process.env.COLLECT_ENABLED='true';const sub=await subscription(1,true),run=await startPlatformSubscription(sub.id,'test',tag());assert.equal((await step(run.id)).status,'active');const state=await step(run.id);assert.equal(state.status,'needs_review');assert.equal((await sql`SELECT status FROM receipts WHERE id=${state.current_receipt_id}`)[0]!.status,'received');assert.equal(calls.length,2);assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND article_id IS NOT NULL`).length,0);
 });
});

const chosenWorkSource=tag();
async function selectedSource(){await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext,syndicate_fulltext) VALUES (${chosenWorkSource},'Synthetic chosen source','external','isolated',false,false) ON CONFLICT(id) DO NOTHING`;return chosenWorkSource;}
