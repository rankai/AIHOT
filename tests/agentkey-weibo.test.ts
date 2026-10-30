import {allowTestBudgetScope} from './setup.ts';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformSubscription,startPlatformSubscription,updatePlatformSubscription,preflightPlatformSubscriptionProvider,switchPlatformSubscriptionProvider} from '@aihot/backend/sources/platform-subscriptions';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {upsertMaterial} from '@aihot/backend/content/materials';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {claimRun,resumeRun} from '@aihot/backend/providers/operations/store';
import {importWeiboResult} from '@aihot/backend/providers/redfox/import-weibo';
import {agentKeyWeiboOperations,weiboCollectionIds,weiboProviderVariants,weiboSearchRoute,weiboPostsRoute,weiboDetailRoute,weiboCommentsRoute,weiboProfileRoute,weiboFollowingRoute,weiboTrendingRoute,weiboRelatedRoute} from '@aihot/backend/providers/agentkey/weibo-contract';
import {parseAgentKeyWeibo} from '@aihot/backend/providers/agentkey/weibo-parser';
import {agentKeyRouteFor} from '@aihot/backend/providers/agentkey/routes';
import {config as backendConfig} from '@aihot/backend/config';
import {requestAgentKey} from '@aihot/backend/providers/agentkey/request';
import {synchronousOperations} from '@aihot/backend/providers/redfox/weibo-contract';
import {stub,tag,gate,assertConfiguredTestDatabase} from './setup.ts';
const uid='7000000001',status='5000000000000001';
const user=()=>({id:Number(uid),idstr:uid,screen_name:'离线作者',description:'合成简介',followers_count:3,friends_count:2,statuses_count:1,verified:false,following:true,phone:'must not project'});
const work=()=>({id:Number(status),idstr:status,mid:status,mblogid:'ABCxyz',text:'<b>离线微博</b>',user:user(),created_at:'Wed Oct 21 12:00:00 +0800 2026',isLongText:true,scheme:`sinaweibo://detail?mblogid=${status}`,reposts_count:1,comments_count:2,attitudes_count:3});
const response=(body:unknown)=>({httpStatus:200,mcp:{},envelope:{provider:'TikHub',data:{code:200,data:body}}});
const fixtures:unknown[]=[
 {items:[{category:'group',items:[{category:'feed',data:work()}]},{category:'card'}],moreInfo:{params:{page:2,max_id:123,count:'20',session:'excluded'}}},
 {items:[{category:'feed',data:work()}],moreInfo:{params:{page:2,max_id:123,count:20}}},
 {detailInfo:{status:work()}},
 {items:[{type:'comment',data:{id:123,idstr:'123',rootid:120,rootidstr:'120',text:'评论',user:user(),created_at:'raw time',like_counts:0,total_number:1}},{type:'trend'}],moreInfo:{params:{max_id:123}}},
 {header:{data:{userInfo:user()}}},
 {ok:1,http_code:200,data:{uid:Number(uid),total_cnt:10,since_id:'1700000000|20',users:[{user:user(),status:work()}]}},
 {items:[{category:'cell'},{category:'group',items:[{data:{card_type:4,desc:'话题',desc_extr:12,scheme:'sinaweibo://search',openurl:'sinaweibo://search'}},{data:{card_type:6}},{data:{card_type:101}}]}]},
 {hotquery:[{suggestion:'相关词',count:3,discuss:2,discuss_num:2,type:1,top_flag:0,topic_flag:0}],users:[{phone:'excluded'}]},
];
const parameters=[{query:'离线',page:1,search_type:1},{uid,page:1,filter_type:'all'},{status_id:status},{status_id:status,sort_type:'0'},{uid},{uid,sort_type:2},{category:'realtimehot',page:1,count:20},{keyword:'离线'}];
const kinds=['weibo_work','weibo_work','weibo_work','social_comment','weibo_account','social_followee','hotspot_research','search_suggestion'];
test('Weibo pure: eight exact homepage contracts and strictly bound query recovery routes',()=>{
 assert.equal(agentKeyWeiboOperations.length,8);
 for(const variant of weiboProviderVariants.filter(v=>(weiboCollectionIds as readonly string[]).includes(v.operationId)))assert.doesNotMatch(variant.purpose,/不.*订阅/);
 for(const id of ['weibo.comments','weibo.following','UAQ90A1F','weibo.related_search'])assert.match(weiboProviderVariants.find(v=>v.operationId===id)!.purpose,/每轮仅首页研究快照/);
 for(const [i,op] of agentKeyWeiboOperations.entries()){
  const route=op.route,input={operationId:op.operationId,mode:'query',platform:'weibo',upstream:'TikHub',tool:route.tool};
  const run={provider:'agentkey',contract_version:1,operation_key:route.operationKey,step_key:route.stepKey,input};
  assert.equal(agentKeyRouteFor(run),route);assert.deepEqual(op.schema.parse(parameters[i]),op.querySchema.parse(parameters[i]));
  assert.equal(agentKeyRouteFor({...run,input:{...input,mode:'collection'}}),(weiboCollectionIds as readonly string[]).includes(op.operationId)?route:undefined);
  for(const delta of [{platform:'douyin'},{upstream:'Redfox'},{tool:'wrong'},{operationId:'weibo.followers'}])assert.equal(agentKeyRouteFor({...run,input:{...input,...delta}}),undefined);
  assert.equal(agentKeyRouteFor({...run,step_key:'wrong'}),undefined);assert.equal(agentKeyRouteFor({...run,contract_version:2}),undefined);
 }
 for(const [index,delta] of [[0,{page:2}],[0,{search_type:3}],[1,{filter_type:'likes'}],[3,{sort_type:0}],[3,{max_id:123}],[5,{sort_type:1}],[5,{since_id:'x'}],[6,{category:'region'}],[6,{count:51}]] as const)assert.throws(()=>agentKeyWeiboOperations[index].schema.parse({...parameters[index],...delta}));
 assert.equal(agentKeyWeiboOperations[0].schema.parse({query:'offline',search_type:61}).search_type,61);
});
test('Weibo pure: all eight witnessed paths, whitelisted roles and honest identity/body/time',()=>{
 for(const [i,op] of agentKeyWeiboOperations.entries()){
  const p=parseAgentKeyWeibo(response(fixtures[i]),op.route,parameters[i]);assert.equal(p.candidates.length,1);assert.equal(p.candidates[0]!.kind,kinds[i]);assert.equal(p.candidates[0]!.data.importable,[0,1,2,4].includes(i));assert.equal(p.summary.count,1);assert.equal(p.summary.stopReason,'single-request');assert.equal(JSON.stringify(p).includes('must not project'),false);
 }
 const w=parseAgentKeyWeibo(response(fixtures[2]),weiboDetailRoute,parameters[2]).candidates[0]!.data;
 assert.equal(w.opusId,status);assert.equal(w.uid,uid);assert.equal(w.opusUrl,`https://weibo.com/${uid}/${status}`);assert.equal(w.urlSource,'derived-canonical-permalink');assert.equal(w.bodyStatus,'pending');assert.equal(w.textScope,'received-excerpt');assert.equal(w.text,'离线微博');
 const c=parseAgentKeyWeibo(response(fixtures[3]),weiboCommentsRoute,parameters[3]).candidates[0]!.data;assert.equal(c.parentCommentId,'120');assert.equal(c.receivedScope,null);assert.deepEqual(c.requestedScope,parameters[3]);
 assert.deepEqual(parseAgentKeyWeibo(response(fixtures[5]),weiboFollowingRoute,parameters[5]).summary.pagination,{since_id:'1700000000|20',total_cnt:10});
 const p=parseAgentKeyWeibo(response({detailInfo:{status:{text:'实收无身份片段'}}}),weiboDetailRoute,parameters[2]);assert.equal(p.candidates.length,1);assert.equal(p.candidates[0]!.data.publishedAt,null);assert.equal(p.candidates[0]!.data.opusUrl,undefined);
 const retweet=parseAgentKeyWeibo(response({detailInfo:{status:{...work(),retweeted_status:{user:{id:'9'},text:'未验证原帖'}}}}),weiboDetailRoute,parameters[2]).candidates[0]!.data;assert.equal(retweet.uid,uid);assert.equal(retweet.role,'outer-status-unparsed-retweet');assert.equal(JSON.stringify(retweet).includes('未验证原帖'),false);
 assert.equal(parseAgentKeyWeibo(response({items:[{type:'comment',data:{text:'无作者评论'}}]}),weiboCommentsRoute,parameters[3]).candidates.length,1);
});
test('Weibo pure: legitimate empty pages differ from unknown/error; alias and scope conflicts reject',()=>{
 for(const [route,body,params] of [[weiboSearchRoute,{items:[]},parameters[0]],[weiboPostsRoute,{items:[]},parameters[1]],[weiboCommentsRoute,{items:[]},parameters[3]],[weiboFollowingRoute,{ok:1,http_code:200,data:{uid:Number(uid),users:[]}},parameters[5]],[weiboTrendingRoute,{items:[]},parameters[6]],[weiboRelatedRoute,{hotquery:[]},parameters[7]]] as const)assert.equal(parseAgentKeyWeibo(response(body),route,params).summary.count,0);
 for(const [i,op] of agentKeyWeiboOperations.entries())for(const body of [{},{error_code:400},null])assert.throws(()=>parseAgentKeyWeibo(response(body),op.route,parameters[i]));
 for(const w of [{...work(),idstr:'1'},{...work(),mid:'1'},{...work(),id:9007199254740992},{...work(),user:{id:1,idstr:'2'}},{...work(),id:1,idstr:'1',mid:'1'}])assert.throws(()=>parseAgentKeyWeibo(response({detailInfo:{status:w}}),weiboDetailRoute,parameters[2]));
 assert.throws(()=>parseAgentKeyWeibo(response({header:{data:{userInfo:{id:1,screen_name:'wrong'}}}}),weiboProfileRoute,parameters[4]));
 assert.throws(()=>parseAgentKeyWeibo(response({items:[{category:'feed',data:{...work(),user:{id:1}}}]}),weiboPostsRoute,parameters[1]));
 assert.throws(()=>parseAgentKeyWeibo(response({ok:1,http_code:200,data:{uid:1,users:[]}}),weiboFollowingRoute,parameters[5]));
 assert.throws(()=>parseAgentKeyWeibo(response({ok:0,http_code:200,data:{uid:Number(uid),users:[]}}),weiboFollowingRoute,parameters[5]));
 assert.throws(()=>parseAgentKeyWeibo(response({items:[{type:'unknown'}]}),weiboCommentsRoute,parameters[3]));
 assert.throws(()=>parseAgentKeyWeibo(response({items:[{category:'unknown'}]}),weiboTrendingRoute,parameters[6]));
 assert.throws(()=>parseAgentKeyWeibo(response({items:[{category:'group',items:[{data:{card_type:999}}]}]}),weiboTrendingRoute,parameters[6]));
});
async function withStub(body:unknown,run:(calls:any[])=>Promise<void>){
 const calls:any[]=[];const server=await stub(async(_hit,req)=>{const q=JSON.parse(req.body);if(q.method?.startsWith('notifications/'))return {};if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}};calls.push(q.params.arguments);return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:{provider:'TikHub',credits_charged:.2,data:{code:200,data:typeof body==='function'?await body(q.params.arguments):body}}}};});
 const previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-weibo-test-key',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'false',REDFOX_CALLS_ENABLED:'false'});
 try{await run(calls);}finally{await server.close();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
}
async function step(id:number){const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,randomUUID());return (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;}
test('Weibo integration: dispatcher, API, receipt identity and local recovery',async t=>{
 const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
 const restoreAdminScope=await allowTestBudgetScope(['agentkey.query'],'admin');
 const budgets=await sql`SELECT * FROM budgets WHERE service IN ('agentkey.query','redfox.query','agentkey.collect','redfox.collect')`;
 try{
 await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('agentkey.query','redfox.query','agentkey.collect','redfox.collect')`;
 await t.test('all eight queries complete one request with linked summary/receipt and no automatic import',async()=>{
  for(const [i,op] of agentKeyWeiboOperations.entries())await withStub(fixtures[i],async calls=>{
   const run=await createAgentKeyQuery({provider:'agentkey',operationId:op.operationId,parameters:parameters[i]},'weibo-test',tag());assert.equal(run.input.platform,'weibo');assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);assert.equal(calls[0].name,op.route.tool);assert.deepEqual(calls[0].params,op.schema.parse(parameters[i]));
   const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`,summary=results.find(r=>r.kind==='query_summary')!,item=results.find(r=>r.kind===kinds[i])!;
   assert.equal(results.length,2);assert.equal(item.data.querySummaryId,summary.id);assert.equal(item.receipt_id,summary.receipt_id);assert.equal(item.step_version,summary.step_version);assert.ok(results.every(r=>r.article_id===null&&r.source_id===null));assert.equal(item.data.importable,[0,1,2,4].includes(i));
   const [receipt]=await sql`SELECT status,usage FROM receipts WHERE id=${summary.receipt_id}`;assert.equal(receipt!.status,'completed');assert.equal(receipt!.usage.chargedCredits,.2);
   if(![0,1,2,4].includes(i))await assert.rejects(importWeiboResult(item.id,{reason:'Research only'},'test',tag()));
  });
 });
 await t.test('six homepage subscriptions release occupancy; native lists import directly and research never imports',async()=>{
  for(const index of [0,1,3,5,6,7])await withStub(fixtures[index],async calls=>{
   process.env.COLLECT_ENABLED='true';const op=agentKeyWeiboOperations[index]!;
   const config={name:'Weibo homepage synthetic',provider:'agentkey',operationId:op.operationId,parameters:parameters[index],enabled:true,limits:{pages:1,items:1,details:9}};
   const sub=await createPlatformSubscription({...config,sourceId:await selectedSource()},'test',tag());
   try{
    const run=await startPlatformSubscription(sub.id,'test',tag());assert.equal(run.limits.details,0);const state=await step(run.id);assert.equal(state.status,'completed',JSON.stringify({status:state.status,reason:state.wait_reason}));assert.equal(calls.length,1);
    const [saved]=await sql`SELECT active_run_id,progress,next_run_at>now() AS scheduled FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(saved!.active_run_id,null);assert.equal(saved!.scheduled,true);assert.equal(saved!.progress.pages,1);assert.equal(saved!.progress.details,0);
    const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`,summary=results.find(r=>r.kind==='query_summary')!,item=results.find(r=>r.kind!=='query_summary')!;assert.equal(summary.data.selectedCount,1);assert.equal(summary.data.nextParameters,null);
    if([0,1].includes(index)){assert.ok(item.article_id);assert.ok(item.source_id);}else assert.ok(results.every(r=>r.article_id===null&&r.source_id===null));
   }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
  });
  await assert.rejects(createPlatformSubscription({sourceId:await selectedSource(),name:'unsupported pages',provider:'agentkey',operationId:'TXQPVGJG',parameters:{query:'offline'},limits:{pages:2,items:1,details:0}},'test',tag()));
 });
 await t.test('collection received resume is local and edited subscriptions cannot write stale material',async()=>{
  await withStub(fixtures[0],async calls=>{
   process.env.COLLECT_ENABLED='true';const config={name:'Weibo local resume',provider:'agentkey',operationId:'TXQPVGJG',parameters:{query:'offline'},enabled:true,limits:{pages:1,items:1,details:0}},sub=await createPlatformSubscription({...config,sourceId:await selectedSource()},'test',tag());
   try{
    const run=await startPlatformSubscription(sub.id,'test',tag()),execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));await requestAgentKey(execution,run,weiboSearchRoute,agentKeyWeiboOperations[0].schema.parse(config.parameters));
    process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);
   }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
  });
  await withStub(fixtures[0],async calls=>{
   process.env.COLLECT_ENABLED='true';const config={name:'Weibo edit guard',provider:'agentkey',operationId:'TXQPVGJG',parameters:{query:'old'},enabled:true,limits:{pages:1,items:1,details:0}},sub=await createPlatformSubscription({...config,sourceId:await selectedSource()},'test',tag());
   try{const run=await startPlatformSubscription(sub.id,'test',tag());await updatePlatformSubscription(sub.id,{editVersion:1,config:{...config,parameters:{query:'new'}}},'test');assert.equal((await step(run.id)).status,'stopped');assert.equal(calls.length,0);assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);}finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
  });
 });
 await t.test('bounded same-run details use actual status IDs and preserve first discovery without overwriting completed body',async()=>{
  const u=`87${Date.now()}`,id=`88${Date.now()}`,other=String(BigInt(id)+1n),short=`Detail${randomUUID().replaceAll('-','')}`;
  const list={items:[{category:'feed',data:{...work(),id,idstr:id,mid:id,mblogid:short,user:{id:u},isLongText:false,text:'原始完整短文'}},{category:'feed',data:{...work(),id:other,idstr:other,mid:other,mblogid:`${short}B`,user:{id:u}}}]};
  await withStub((q:any)=>q.name===weiboDetailRoute.tool?{detailInfo:{status:{...work(),id,idstr:id,mid:id,mblogid:short,user:{id:u},isLongText:false,text:'详情另一短文'}}}:list,async calls=>{
   process.env.COLLECT_ENABLED='true';const config={name:'Weibo bounded details',provider:'agentkey',operationId:'weibo.account_posts',parameters:{uid:u},enabled:true,enrichDetails:true,detailOperationId:'API_1789098514899',limits:{pages:1,items:2,details:1}},sub=await createPlatformSubscription({...config,sourceId:await selectedSource()},'test',tag());
   try{
    const run=await startPlatformSubscription(sub.id,'test',tag()),first=await step(run.id);assert.equal(first.step_key,weiboDetailRoute.stepKey);assert.equal(first.status,'active');assert.equal(calls.length,1);
    const [parent]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work' ORDER BY id LIMIT 1`;assert.ok(parent!.article_id);
    const [articleBefore]=await sql`SELECT discovered_at,body_text FROM articles WHERE id=${parent!.article_id}`;
    const done=await step(run.id);assert.equal(done.status,'completed',done.wait_reason);assert.equal(calls.length,2);assert.deepEqual(calls[1].params,{status_id:id});
    const [detail]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work' AND step_version>${parent!.step_version}`;assert.equal(detail!.article_id,parent!.article_id);
    const [summary]=await sql`SELECT data FROM operation_results WHERE id=${detail!.data.querySummaryId}`;assert.equal(summary!.data.originResultId,parent!.id);
    const [articleAfter]=await sql`SELECT discovered_at,body_text FROM articles WHERE id=${parent!.article_id}`;assert.deepEqual(articleAfter,articleBefore);
    const [saved]=await sql`SELECT active_run_id,progress FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(saved!.active_run_id,null);assert.equal(saved!.progress.details,1);assert.equal(saved!.progress.items,2);
   }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
  });
 });
 await t.test('detail identity contradictions preserve received for review; missing original URL stays pending',async()=>{
  for(const kind of ['uid','mblogid','missing'] as const){
   const u=`89${Date.now()}`,id=`90${Date.now()}`,short=`Conflict${randomUUID().replaceAll('-','')}`,w={...work(),id,idstr:id,mid:id,mblogid:short,user:{id:u}};
   const detail={...w,...(kind==='uid'?{user:{id:'1'}}:kind==='mblogid'?{mblogid:'Different'}:{user:undefined})};
   await withStub((q:any)=>q.name===weiboDetailRoute.tool?{detailInfo:{status:detail}}:{items:[{category:'feed',data:w}]},async calls=>{
    process.env.COLLECT_ENABLED='true';const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:'Weibo detail identity',provider:'agentkey',operationId:'TXQPVGJG',parameters:{query:'offline'},enabled:true,enrichDetails:true,limits:{pages:1,items:1,details:1}},'test',tag());
    try{const run=await startPlatformSubscription(sub.id,'test',tag());await step(run.id);const state=await step(run.id);assert.equal(state.status,kind==='missing'?'completed':'needs_review',state.wait_reason);assert.equal(calls.length,2);
     const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND step_version=2`;if(kind==='missing'){const item=rows.find(r=>r.kind==='weibo_work')!;assert.equal(item.article_id,null);assert.match(item.data.pendingReason,/original URL/);}else{assert.equal(rows.length,0);assert.equal((await sql`SELECT status FROM receipts WHERE id=${state.current_receipt_id}`)[0]!.status,'received');}
    }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
   });
  }
 });
 await t.test('account-posts missing list author keeps frozen UID scope during bounded detail',async()=>{
  for(const identity of ['conflicting','missing','matching'] as const){
   const u=`93${Date.now()}`,id=`94${Date.now()}`,short=`Scope${randomUUID().replaceAll('-','')}`;
   const w={...work(),id,idstr:id,mid:id,mblogid:short,user:undefined};
   const detail={...w,isLongText:false,user:identity==='missing'?undefined:{id:identity==='matching'?u:'1'}};
   await withStub((q:any)=>q.name===weiboDetailRoute.tool?{detailInfo:{status:detail}}:{items:[{category:'feed',data:w}]},async calls=>{
    process.env.COLLECT_ENABLED='true';
    const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:'Weibo frozen account scope',provider:'agentkey',operationId:'weibo.account_posts',parameters:{uid:u},enabled:true,enrichDetails:true,detailOperationId:'API_1789098514899',limits:{pages:1,items:1,details:1}},'test',tag());
    try{
     const run=await startPlatformSubscription(sub.id,'test',tag()),first=await step(run.id);assert.equal(first.status,'active');
     const [parent]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work'`;assert.equal(parent!.article_id,null);assert.equal(parent!.data.uid,undefined);
     const done=await step(run.id);assert.equal(done.status,identity==='conflicting'?'needs_review':'completed',done.wait_reason);assert.equal(calls.length,2);
     const children=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND step_version=2`;
     if(identity==='conflicting'){
      assert.equal(children.length,0);assert.equal((await sql`SELECT status FROM receipts WHERE id=${done.current_receipt_id}`)[0]!.status,'received');
      assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND article_id IS NOT NULL`).length,0);
     }else{
      const child=children.find(r=>r.kind==='weibo_work')!;assert.ok(child);
      if(identity==='missing'){assert.equal(child.article_id,null);assert.match(child.data.pendingReason,/original URL/);}
      else{assert.ok(child.article_id);assert.equal(child.data.uid,u);}
     }
    }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
   });
  }
 });
 await t.test('received detail resumes with both valves closed; in-flight edits retain evidence without stale detail write',async()=>{
  for(const change of [false,true]){
   const u=`91${Date.now()}`,id=`92${Date.now()}`,short=`Resume${randomUUID().replaceAll('-','')}`,w={...work(),id,idstr:id,mid:id,mblogid:short,user:{id:u}},entered=gate(),release=gate();
   await withStub(async(q:any)=>{if(q.name!==weiboDetailRoute.tool)return {items:[{category:'feed',data:w}]};if(change){entered.open();await release.promise;}return {detailInfo:{status:{...w,isLongText:false}}};},async calls=>{
    process.env.COLLECT_ENABLED='true';const config={name:'Weibo detail recovery',provider:'agentkey',operationId:'TXQPVGJG',parameters:{query:'offline'},enabled:true,enrichDetails:true,limits:{pages:1,items:1,details:1}},sub=await createPlatformSubscription({...config,sourceId:await selectedSource()},'test',tag());
    try{const run=await startPlatformSubscription(sub.id,'test',tag()),first=await step(run.id);
     if(change){const executing=step(run.id);await entered.promise;await updatePlatformSubscription(sub.id,{editVersion:1,config:{...config,enabled:false}},'test');release.open();const state=await executing;assert.equal(state.status,'stopped');assert.equal((await sql`SELECT status FROM receipts WHERE id=${state.current_receipt_id}`)[0]!.status,'received');assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND step_version=2`).length,0);}
     else{const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:first.step_version,generation:first.generation},randomUUID()));await requestAgentKey(execution,first as any,weiboDetailRoute,{status_id:id});process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';assert.equal((await step(run.id)).status,'completed');}
     assert.equal(calls.length,2);
    }finally{release.open();await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
   });
  }
 });
 await t.test('X preserves basic search both directions and refuses actual unsupported recipes without changes',async()=>{
  const previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-weibo-switch',REDFOX_API_KEY:'fake-weibo-switch'});
  try{
   const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:'Weibo switch',provider:'redfox',operationId:'TXQPVGJG',parameters:{keyword:'offline',searchType:'61',page:'1'},enabled:false,limits:{pages:1,items:3,details:0}},'test',tag());
   const first=await preflightPlatformSubscriptionProvider(sub.id,{editVersion:1,targetProvider:'agentkey'});assert.equal(first!.supported,true,JSON.stringify(first));
   const switched=await switchPlatformSubscriptionProvider(sub.id,{editVersion:1,targetProvider:'agentkey',reason:'explicit switch'},'test');assert.deepEqual(switched!.config.parameters,{query:'offline',search_type:61,page:1});
   const back=await preflightPlatformSubscriptionProvider(sub.id,{editVersion:2,targetProvider:'redfox'});assert.equal(back!.supported,true,JSON.stringify(back));await switchPlatformSubscriptionProvider(sub.id,{editVersion:2,targetProvider:'redfox',reason:'explicit reverse'},'test');
   const [saved]=await sql`SELECT provider,config,progress,execution_version,edit_version FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(saved!.provider,'redfox');assert.deepEqual(saved!.config.parameters,{keyword:'offline',searchType:'61',page:'1'});assert.deepEqual(saved!.progress,{});assert.equal(saved!.edit_version,3);
   for(const extra of [{parameters:{keyword:'offline',searchType:'1',page:'1',extParam:'2'}},{limits:{pages:2,items:3,details:0}},{enrichDetails:true,limits:{pages:1,items:3,details:1}},{operationId:'UAQ90A1F',parameters:{}}]){
    const unsupported=await createPlatformSubscription({sourceId:await selectedSource(),name:'Unsupported Weibo switch',provider:'redfox',operationId:'TXQPVGJG',parameters:{keyword:'offline',searchType:'1',page:'1'},enabled:false,limits:{pages:1,items:3,details:0},...extra},'test',tag());const [before]=await sql`SELECT * FROM collection_subscriptions WHERE id=${unsupported.id}`;
    assert.equal((await preflightPlatformSubscriptionProvider(unsupported.id,{editVersion:1,targetProvider:'agentkey'}))!.supported,false);await assert.rejects(switchPlatformSubscriptionProvider(unsupported.id,{editVersion:1,targetProvider:'agentkey',reason:'unsupported'},'test'));assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE id=${unsupported.id}`)[0],before);
   }
  }finally{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
 });
 await t.test('late old-provider response after X remains received and cannot write',async()=>{
  const entered=gate(),release=gate(),previousKey=process.env.REDFOX_API_KEY;process.env.REDFOX_API_KEY='fake-weibo-switch';
  try{await withStub(async()=>{entered.open();await release.promise;return fixtures[0];},async calls=>{
   process.env.COLLECT_ENABLED='true';const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:'Weibo late switch',provider:'agentkey',operationId:'TXQPVGJG',parameters:{query:'offline'},enabled:true,limits:{pages:1,items:1,details:0}},'test',tag());
   try{const run=await startPlatformSubscription(sub.id,'test',tag()),executing=step(run.id);await entered.promise;await switchPlatformSubscriptionProvider(sub.id,{editVersion:1,targetProvider:'redfox',reason:'switch during request'},'test');release.open();const done=await executing;assert.equal(done.status,'stopped');assert.equal(calls.length,1);assert.equal((await sql`SELECT status FROM receipts WHERE id=${done.current_receipt_id}`)[0]!.status,'received');assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);const [saved]=await sql`SELECT active_run_id,progress FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(saved!.active_run_id,null);assert.deepEqual(saved!.progress,{});}finally{release.open();await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
  });}finally{if(previousKey===undefined)delete process.env.REDFOX_API_KEY;else process.env.REDFOX_API_KEY=previousKey;}
 });
 await t.test('list and detail imports use original evidence without extra calls; body completeness stays honest',async()=>{
  for(const [index,longText] of [[0,false],[1,true],[2,undefined]] as const){
   const u=`81${Date.now()}${index}`,id=`82${Date.now()}${index}`,mblogid=`I${randomUUID().replaceAll('-','')}`;
   const w={...work(),id,idstr:id,mid:id,mblogid,user:{id:u,idstr:u,screen_name:'I author'},isLongText:longText,created_at:undefined};
   const body=index===2?{detailInfo:{status:w}}:{items:[{category:'feed',data:w}]},params=index===0?{query:'offline'}:index===1?{uid:u}:{status_id:id};
   await withStub(body,async calls=>{
    const run=await createAgentKeyQuery({provider:'agentkey',operationId:agentKeyWeiboOperations[index]!.operationId,parameters:params},'test',tag());assert.equal((await step(run.id)).status,'completed');
    const [item]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work'`;
    // Earlier Q projections advertise false; this hint must not be import authority.
    await sql`UPDATE operation_results SET data=data||'{"importable":false}'::jsonb WHERE id=${item!.id}`;
    process.env.AGENTKEY_CALLS_ENABLED='false';
    await assert.rejects(importWeiboResult(item!.id,{reason:'manual forbidden',supplement:{uid:u,evidence:'manual'}},'test',tag()));
    await assert.rejects(importWeiboResult(item!.id,{reason:'arbitrary forbidden',sourceId:'arbitrary-source'},'test',tag()));
    const key=tag(),result=await importWeiboResult(item!.id,{sourceId:await selectedSource(),reason:'verified local I'},'test',key);assert.ok(result?.articleId);assert.deepEqual(await importWeiboResult(item!.id,{sourceId:await selectedSource(),reason:'repeat'},'test',key),result);assert.equal(calls.length,1);
    const [source]=await sql`SELECT participation_mode,site_fulltext,syndicate_fulltext FROM sources WHERE id=${result!.sourceId}`;assert.deepEqual({...source},{participation_mode:'isolated',site_fulltext:false,syndicate_fulltext:false});
    const [article]=await sql`SELECT body_status,body_text,published_at,backfill,raw FROM articles WHERE id=${result!.articleId}`;
    assert.equal(article!.body_status,longText===false?'ok':'pending');assert.equal(article!.body_text,longText===false?'离线微博':null);assert.equal(article!.published_at,null);assert.equal(article!.backfill,true);assert.equal(article!.raw.provider,'agentkey');assert.equal(article!.raw.receivedText,'离线微博');
    assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE source_id=${result!.sourceId} AND platform='weibo' AND id_value=${u}`).length,0);
   });
  }
 });
 await t.test('profile binding preserves permissions and native short-URL discovery deduplicates',async()=>{
  const u=`83${Date.now()}`,id=`84${Date.now()}`,short=`I${randomUUID().replaceAll('-','')}`,sourceId=`weibo-i-${tag()}`;
  await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext,syndicate_fulltext) VALUES (${sourceId},'Existing author','external','editorial',true,false)`;
  const existing=await upsertMaterial({sourceId,url:`https://weibo.com/${u}/${short}`,title:'Legacy original',via:'fetch'});
  await withStub({header:{data:{userInfo:{id:u,idstr:u,screen_name:'Existing author'}}}},async calls=>{
   const run=await createAgentKeyQuery({provider:'agentkey',operationId:'API_1789098515117',parameters:{uid:u}},'test',tag());await step(run.id);
   const [item]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_account'`;
   await importWeiboResult(item!.id,{sourceId,reason:'Verified existing author'},'test',tag());assert.equal(calls.length,1);
   const [source]=await sql`SELECT participation_mode,site_fulltext,syndicate_fulltext FROM sources WHERE id=${sourceId}`;assert.deepEqual({...source},{participation_mode:'editorial',site_fulltext:true,syndicate_fulltext:false});
  });
  const body={detailInfo:{status:{...work(),id,idstr:id,mid:id,mblogid:short,isLongText:false,user:{id:u,idstr:u}}}};
  await withStub(body,async calls=>{
   for(const disabled of [false,true]){
    await sql`UPDATE sources SET enabled=${!disabled} WHERE id=${sourceId}`;
    const run=await createAgentKeyQuery({provider:'agentkey',operationId:'API_1789098514899',parameters:{status_id:id}},'test',tag());await step(run.id);const [item]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work'`;
    if(disabled)await assert.rejects(importWeiboResult(item!.id,{sourceId,reason:'disabled author'},'test',tag()),/disabled/);
    else {const imported=await importWeiboResult(item!.id,{sourceId,reason:'dedup short permalink'},'test',tag());assert.equal(imported!.articleId,existing.articleId);assert.equal((await sql`SELECT url FROM articles WHERE id=${existing.articleId}`)[0]!.url,`https://weibo.com/${u}/${short}`);}
   }
   assert.equal(calls.length,2);
  });
 });
 await t.test('AgentKey and Redfox share numeric/received-link identity without duplicate material',async()=>{
  const u=`85${Date.now()}`,id=`86${Date.now()}`,short=`Cross${randomUUID().replaceAll('-','')}`;
  let firstArticle:string|undefined;
  await withStub({items:[{category:'feed',data:{...work(),id,idstr:id,mid:id,mblogid:short,isLongText:false,user:{id:u,idstr:u}}}]},async calls=>{
   const run=await createAgentKeyQuery({provider:'agentkey',operationId:'TXQPVGJG',parameters:{query:'offline'}},'test',tag());await step(run.id);const [item]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work'`;
   firstArticle=(await importWeiboResult(item!.id,{sourceId:await selectedSource(),reason:'first provider'},'test',tag()))!.articleId!;assert.equal(calls.length,1);
  });
  let calls=0;const server=await stub(async()=>{calls++;return {code:2000,data:{opusId:id,mblogid:short,uid:u,text:'Redfox full body',opusUrl:`https://weibo.com/${u}/${short}`}};});
  const previous={...process.env},privateNetwork=backendConfig.allowPrivateNetworkFetch;
  Object.assign(process.env,{REDFOX_CALLS_ENABLED:'true',REDFOX_API_KEY:'fake-weibo-cross',REDFOX_TEST_BASE_URL:server.url});backendConfig.allowPrivateNetworkFetch=true;
  try{
   const run=await createSynchronousQuery({operationId:'API_1789098514899',parameters:{opusId:id}},'test',tag());const state=await step(run.id);assert.equal(state.status,'completed',JSON.stringify({status:state.status,wait_reason:state.wait_reason}));const [item]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work'`;
   const imported=await importWeiboResult(item!.id,{sourceId:await selectedSource(),reason:'second provider'},'test',tag());assert.equal(imported!.articleId,firstArticle);assert.equal(calls,1);assert.equal((await sql`SELECT body_status,body_text FROM articles WHERE id=${firstArticle!}`)[0]!.body_text,'Redfox full body');
  }finally{await server.close();backendConfig.allowPrivateNetworkFetch=privateNetwork;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
 });
 await t.test('missing work/original evidence and unsupported retweet remain queryable but cannot import',async()=>{
  for(const w of [{text:'Only text'},{id:status,idstr:status,text:'No author'},{...work(),retweeted_status:{user:{id:'1'}}}])await withStub({detailInfo:{status:w}},async calls=>{
   const run=await createAgentKeyQuery({provider:'agentkey',operationId:'API_1789098514899',parameters:{status_id:status}},'test',tag());assert.equal((await step(run.id)).status,'completed');const [item]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work'`;
   await sql`UPDATE operation_results SET data=data||'{"importable":true}'::jsonb WHERE id=${item!.id}`;
   await assert.rejects(importWeiboResult(item!.id,{reason:'not authoritative'},'test',tag()));assert.equal(calls.length,1);
  });
 });
 await t.test('candidate, summary, exact request identity and run profile tampering reject locally',async()=>{
  await withStub(fixtures[2],async calls=>{
   const run=await createAgentKeyQuery({provider:'agentkey',operationId:'API_1789098514899',parameters:parameters[2]},'test',tag());await step(run.id);
   const [item]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work'`,[summary]=await sql`SELECT * FROM operation_results WHERE id=${item!.data.querySummaryId}`,[receipt]=await sql`SELECT * FROM receipts WHERE id=${item!.receipt_id}`;
   process.env.AGENTKEY_CALLS_ENABLED='false';
   for(const data of [{...item!.data,uid:'1'},{...item!.data,text:'forged'},{...item!.data,opusUrl:'https://weibo.com/1/2'},{...item!.data,querySummaryId:item!.id}]){
    await sql`UPDATE operation_results SET data=${sql.json(data)} WHERE id=${item!.id}`;await assert.rejects(importWeiboResult(item!.id,{reason:'tamper'},'test',tag()));
   }await sql`UPDATE operation_results SET data=${sql.json(item!.data)} WHERE id=${item!.id}`;
   await sql`UPDATE operation_results SET data=data||'{"count":999}'::jsonb WHERE id=${summary!.id}`;await assert.rejects(importWeiboResult(item!.id,{reason:'tamper'},'test',tag()));await sql`UPDATE operation_results SET data=${sql.json(summary!.data)} WHERE id=${summary!.id}`;
   for(const delta of [{mode:'collection'},{upstream:'Redfox'},{platform:'douyin'},{tool:'wrong'}]){await sql`UPDATE operation_runs SET input=${sql.json({...run.input,...delta} as never)} WHERE id=${run.id}`;await assert.rejects(importWeiboResult(item!.id,{reason:'tamper'},'test',tag()));}await sql`UPDATE operation_runs SET input=${sql.json(run.input as never)} WHERE id=${run.id}`;
   for(const request of [{...receipt!.request,endpoint:'https://different.invalid/mcp'},{...receipt!.request,params:{status_id:'1'}},{...receipt!.request,tool:'wrong'}]){await sql`UPDATE receipts SET request=${sql.json(request)} WHERE id=${receipt!.id}`;await assert.rejects(importWeiboResult(item!.id,{reason:'tamper'},'test',tag()));}await sql`UPDATE receipts SET request=${sql.json(receipt!.request)} WHERE id=${receipt!.id}`;
   await sql`UPDATE operation_results SET step_version=step_version+1 WHERE id=${summary!.id}`;await assert.rejects(importWeiboResult(item!.id,{reason:'tamper'},'test',tag()));await sql`UPDATE operation_results SET step_version=${summary!.step_version} WHERE id=${summary!.id}`;
   assert.equal(calls.length,1);assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${item!.id}`)[0]!.article_id,null);
  });
 });
 await t.test('received success resumes locally while received malformed evidence stays review',async()=>{
  for(const body of [fixtures[2],{detailInfo:{status:{...work(),mid:'1'}}}])await withStub(body,async calls=>{
   const run=await createAgentKeyQuery({provider:'agentkey',operationId:'API_1789098514899',parameters:parameters[2]},'test',tag());
   const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));await requestAgentKey(execution,run,weiboDetailRoute,parameters[2]!);
   process.env.AGENTKEY_CALLS_ENABLED='false';const state=await step(run.id);assert.equal(state.status,body===fixtures[2]?'completed':'needs_review');assert.equal(calls.length,1);
   if(state.status==='needs_review'){assert.equal((await sql`SELECT status FROM receipts WHERE id=${state.current_receipt_id}`)[0]!.status,'received');await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:state.step_version,generation:state.generation}));assert.equal((await step(run.id)).status,'needs_review');assert.equal(calls.length,1);}
  });
 });
 await t.test('tampered frozen receipt request fails without repurchase',async()=>{
  await withStub(fixtures[2],async calls=>{
   const run=await createAgentKeyQuery({provider:'agentkey',operationId:'API_1789098514899',parameters:parameters[2]},'test',tag()),execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));const receipt=await requestAgentKey(execution,run,weiboDetailRoute,parameters[2]!);
   await sql`UPDATE receipts SET request=jsonb_set(request,'{params,status_id}','"1"') WHERE id=${receipt.receiptId}`;process.env.AGENTKEY_CALLS_ENABLED='false';assert.equal((await step(run.id)).status,'needs_review');assert.equal(calls.length,1);
  });
 });
 await t.test('authorless received native scheme imports even from the old URL projection',async()=>{
  const id=`987${Date.now()}`,u=`986${Date.now()}`,w={...work(),id,idstr:id,mid:id,user:undefined,scheme:`https://weibo.com/${u}/${id}`};
  await withStub({detailInfo:{status:w}},async calls=>{
   const run=await createAgentKeyQuery({provider:'agentkey',operationId:'API_1789098514899',parameters:{status_id:id}},'test',tag());assert.equal((await step(run.id)).status,'completed');
   const [r]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='weibo_work'`;
   assert.equal(r!.data.uid,undefined);const record={...r!.data.record};delete record.opusUrl;
   const legacy={...r!.data,record,urlSource:null};delete legacy.opusUrl;
   await sql`UPDATE operation_results SET data=${sql.json(legacy)} WHERE id=${r!.id}`;
   const saved=await importWeiboResult(r!.id,{sourceId:await selectedSource(),reason:'Retained exact native original'},'test',tag());assert.ok(saved!.articleId);assert.equal(calls.length,1);
   assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE platform='weibo' AND id_value=${u}`).length,0);
  });
 });
 await t.test('API merges semantic catalog IDs and validates exact query input',async()=>{
  const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),previous=backendConfig.devAdmin;backendConfig.devAdmin={displayName:'Weibo synthetic API'};
  try{
   const reply=await app.inject({method:'GET',url:'/api/admin/redfox/operations'});assert.equal(reply.statusCode,200);const ops=reply.json() as any[];
   for(const old of synchronousOperations()){const current=ops.find(o=>o.id===old.id);assert.equal(ops.filter(o=>o.id===old.id).length,1);assert.deepEqual(current.fields,old.fields);assert.equal(current.schedulableType,old.schedulableType);}
   for(const op of agentKeyWeiboOperations){const v=ops.find(o=>o.id===op.operationId);assert.ok(v.collectionProviders.some((p:any)=>p.id==='agentkey'));if(op.operationId.startsWith('weibo.'))assert.equal(v.schedulableType,'list');}
   assert.equal(ops.some(o=>o.id==='weibo.followers'),false);
   await withStub(fixtures[4],async calls=>{const reply=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{provider:'agentkey',operationId:'API_1789098515117',parameters:{uid}}});assert.equal(reply.statusCode,202,reply.body);assert.equal((await step(reply.json().runId)).status,'completed');assert.equal(calls.length,1);});
   for(const [operationId,params] of [['weibo.followers',{uid}],['TXQPVGJG',{query:'x',page:2}],['weibo.following',{uid,since_id:'1|20'}]]){const reply=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{provider:'agentkey',operationId,parameters:params}});assert.equal(reply.statusCode,400,reply.body);}
  }finally{backendConfig.devAdmin=previous;await app.close();}
 });
 }finally{await restoreAdminScope();for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await stopBoss();await closeDb();}
});

const chosenWorkSource=tag();
async function selectedSource(){await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext,syndicate_fulltext) VALUES (${chosenWorkSource},'Chosen Weibo source','rss','isolated',false,false) ON CONFLICT(id) DO NOTHING`;return chosenWorkSource;}
