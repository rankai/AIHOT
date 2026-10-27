import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {claimRun,resumeRun} from '@aihot/backend/providers/operations/store';
import {importBilibiliResult} from '@aihot/backend/providers/redfox/import-bilibili';
import {agentKeyBilibiliOperations,bilibiliSearchRoute,bilibiliTypedSearchRoute,bilibiliPostsRoute,bilibiliDetailRoute,bilibiliCommentsRoute,bilibiliRepliesRoute,bilibiliProfileRoute,bilibiliRelationRoute,bilibiliDynamicsRoute,bilibiliTrendingRoute,bilibiliHotSearchRoute} from '@aihot/backend/providers/agentkey/bilibili-contract';
import {parseAgentKeyBilibili} from '@aihot/backend/providers/agentkey/bilibili-parser';
import {parseLosslessJson} from '@aihot/backend/providers/agentkey/response';
import {agentKeyRouteFor} from '@aihot/backend/providers/agentkey/routes';
import {createPlatformSubscription,startPlatformSubscription,updatePlatformSubscription,preflightPlatformSubscriptionProvider,switchPlatformSubscriptionProvider} from '@aihot/backend/sources/platform-subscriptions';
import {bilibiliCollectionIds} from '@aihot/backend/providers/agentkey/bilibili-contract';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {upsertMaterial} from '@aihot/backend/content/materials';
import {identityKeyForUrl} from '@aihot/backend/lib/url';
import {requestAgentKey} from '@aihot/backend/providers/agentkey/request';
import {config as backendConfig} from '@aihot/backend/config';
import {stub,tag,gate,assertConfiguredTestDatabase} from './setup.ts';
const av='876543210',bv='BV1AbCdEfGhJ',mid='7000123',rootId='9876543210987654321';
const uri=`bilibili://video/${av}?source=synthetic`;
const response=(data:unknown,direct=false)=>({httpStatus:200,mcp:{},envelope:{provider:'TikHub',data:{code:200,data:direct?data:{code:0,data}}}});
const video=()=>({goto:'av',param:av,uri,av:{title:'合成视频',mid,author:'合成作者',play:2,danmaku:1,duration:'01:20',ptime:'1700000000'}});
const post=()=>({goto:'av',param:av,uri,bvid:bv,title:'合成投稿',author:'合成作者',ctime:1700000000,duration:80});
const detail=()=>({aid:Number(av),bvid:bv,title:'合成详情',desc:'视频说明',owner:{mid:Number(mid),name:'合成作者'},ctime:1700000000,pubdate:1700000000,short_link:`https://b23.tv/${bv}`,short_link_v2:`https://b23.tv/${bv}`});
const comment=(child=false)=>({rpid_str:child?'9876543210987654322':rootId,oid_str:av,mid_str:mid,root_str:child?rootId:'0',parent_str:child?'9876543210987654329':'0',content:{message:'合成评论'},member:{mid,uname:'合成评论者'},ctime:1700000000,like:2,rcount:1});
const cursor={is_begin:true,is_end:false,next:2,prev:1,pagination_reply:{next_offset:'opaque-next'}};
const dynamic=(forward=false)=>({id_str:'9876543210987654323',type:forward?'DYNAMIC_TYPE_FORWARD':'DYNAMIC_TYPE_AV',modules:{module_author:{mid:Number(mid),name:'当前动态作者',pub_ts:'1700000000'},module_dynamic:forward?{major:null,desc:{text:'当前转发文字'}}:{major:{archive:{bvid:bv,aid:av,title:'当前投稿',desc:'动态描述'}},desc:null}},orig:forward?{type:'DYNAMIC_TYPE_AV',modules:{module_author:{mid:999,name:'不能投影原作者'}},private:'never project'}:null});
const fixtures=[
 {route:bilibiliSearchRoute,params:{keyword:'测试'},data:{item:[video(),{goto:'author_new',param:'999'}],pagination:{next:'opaque',page:'1'}},kind:'bilibili_work'},
 {route:bilibiliTypedSearchRoute,params:{keyword:'测试'},data:{items:[video()],pagination:{next:'',page:'1',pages:1}},kind:'bilibili_work'},
 {route:bilibiliPostsRoute,params:{user_id:mid},data:{item:[post()],count:900},kind:'bilibili_work'},
 {route:bilibiliDetailRoute,params:{av_id:av},data:detail(),kind:'bilibili_work'},
 {route:bilibiliCommentsRoute,params:{av_id:av},data:{replies:[comment()],cursor},kind:'social_comment'},
 {route:bilibiliRepliesRoute,params:{av_id:av,root:rootId},data:{root:{rpid_str:rootId,oid_str:av,replies:[comment(true)]},cursor:{...cursor,pagination_reply:{},is_end:true}},kind:'social_comment'},
 {route:bilibiliProfileRoute,params:{user_id:mid},data:{card:{mid,name:'合成账号',handle:'synthetic',sign:'签名',description:'简介',fans:12,friend:4,attention:3,is_deleted:0},archive:{private:'never project'},payments:{private:'never project'}},kind:'bilibili_account'},
 {route:bilibiliRelationRoute,params:{uid:mid},data:{mid:Number(mid),following:3,follower:12},kind:null},
 {route:bilibiliDynamicsRoute,params:{uid:mid},data:{items:[dynamic(),dynamic(true)],offset:'next',has_more:true,total:'2'},kind:'bilibili_dynamic'},
 {route:bilibiliTrendingRoute,params:{},data:[{...post(),idx:1,card_type:'small_cover_v5',card_goto:'av',args:{}}],kind:'bilibili_work'},
 {route:bilibiliHotSearchRoute,params:{limit:10},data:{trending:{list:[{keyword:'合成关键词',show_name:'合成显示词',heat_score:3,goto:'search',uri:'bilibili://search'}]}},kind:'hotspot_research'},
];
let budgets:any[]=[];
before(async()=>{const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);budgets=await sql`SELECT * FROM budgets WHERE service IN ('agentkey.query','agentkey.collect','redfox.query')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('agentkey.query','agentkey.collect','redfox.query')`;});
after(async()=>{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await stopBoss();await closeDb();});
async function withStub(f:{route:typeof fixtures[number]['route'];data:unknown},fn:(calls:any[])=>Promise<void>){
 const calls:any[]=[];const server=await stub(async(_hit,req)=>{const q=JSON.parse(req.body);if(q.method?.startsWith('notifications/'))return {};if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}};calls.push(q.params.arguments);const data=typeof f.data==='function'?await f.data(q.params.arguments):f.data;return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:{...response(data,f.route===bilibiliRelationRoute).envelope,credits_charged:.2}}};});
 const previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-bilibili-test-key',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'false',REDFOX_CALLS_ENABLED:'false'});
 try{await fn(calls);}finally{await server.close();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
}
async function step(id:number){const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,randomUUID());return (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;}
const parse=(i:number)=>parseAgentKeyBilibili(response(fixtures[i]!.data,fixtures[i]!.route===bilibiliRelationRoute),fixtures[i]!.route,fixtures[i]!.params);
test('documented dynamic null branches retain current AV and forwarded text without borrowing origin',()=>{
 const p=parse(8);assert.equal(p.candidates.length,2);assert.equal(p.candidates[0]!.data.title,'当前投稿');assert.equal(p.candidates[1]!.data.title,'当前转发文字');assert.equal((p.candidates[1]!.data.record as any).archive,undefined);
 for(const dynamicType of [false,true]){const row=dynamic(dynamicType);const broken={...row,modules:{...row.modules,module_dynamic:{major:null,desc:null}}};assert.throws(()=>parseAgentKeyBilibili(response({items:[broken]}),bilibiliDynamicsRoute,{uid:mid}),/Missing current dynamic content/);}
});
test('Q retains meaningful search and detail when optional author or description is absent',()=>{
 for(const route of [bilibiliSearchRoute,bilibiliTypedSearchRoute]){const item={...video(),av:{title:'仅标题的视频'}};const data=route===bilibiliSearchRoute?{item:[item]}:{items:[item]};const p=parseAgentKeyBilibili(response(data),route,{keyword:'测试'});assert.equal(p.candidates.length,1);assert.deepEqual(p.candidates[0]!.data.identity,{});assert.equal(p.candidates[0]!.data.avId,av);assert.equal(p.candidates[0]!.data.importable,false);}
 for(const change of [{owner:undefined,desc:undefined},{owner:{name:'仅作者称呼'},desc:undefined},{owner:{mid:Number(mid)},desc:undefined}]){const p=parseAgentKeyBilibili(response({...detail(),...change}),bilibiliDetailRoute,{av_id:av});assert.equal(p.candidates.length,1);assert.equal(p.candidates[0]!.data.workId,bv);assert.equal((p.candidates[0]!.data.record as any).description,undefined);assert.equal(p.candidates[0]!.data.importable,!!change.owner?.mid);}
 assert.throws(()=>parseAgentKeyBilibili(response({...detail(),owner:{mid:Number.MAX_SAFE_INTEGER+1}}),bilibiliDetailRoute,{av_id:av}));
});
test('eleven exact schemas and distinct projections retain only witnessed identities and roles',()=>{
 assert.equal(agentKeyBilibiliOperations.length,11);
 for(let i=0;i<fixtures.length;i++){const p=parse(i);assert.equal(p.summary.count,i===7?0:i===8?2:1);assert.ok(p.candidates.every(c=>c.data.importable===[3,6].includes(i)));}
 const search=parse(0);assert.deepEqual(search.summary.excludedTypeCounts,{author_new:1});assert.equal(search.summary.mixedCount,2);assert.equal(search.candidates[0]!.data.avId,av);assert.equal(search.candidates[0]!.data.workId,null);assert.equal(search.candidates[0]!.data.url,null);
 assert.deepEqual(parse(2).candidates[0]!.data.identity,{});assert.equal(parse(2).summary.accountTotal,900);assert.equal(parse(2).summary.pagination,undefined);
 const work=parse(3).candidates[0]!.data;assert.equal(work.url,`https://www.bilibili.com/video/${bv}`);assert.equal(work.publishedAt,null);assert.equal((work.record as any).descriptionRole,'video_description');
 assert.equal((parse(5).candidates[0]!.data.record as any).parent,'9876543210987654329');
 assert.equal(JSON.stringify(parse(6)).includes('never project'),false);
 assert.deepEqual(parse(7).summary.record,{mid,following:3,follower:12});
 const forwarded=parse(8).candidates[1]!.data;assert.equal(forwarded.title,'当前转发文字');assert.deepEqual(forwarded.identity,{mid});assert.equal((forwarded.record as any).archive,undefined);assert.equal(JSON.stringify(forwarded).includes('不能投影原作者'),false);
 assert.equal(parse(9).candidates[0]!.data.role,'provider_recommendation');assert.equal((parse(10).candidates[0]!.data.record as any).rank,undefined);
 const local=response(detail());const text=JSON.stringify(local).replace(`"aid":${av}`,`"aid":9876543210987654321`).replaceAll(`https://b23.tv/${bv}`,`https://b23.tv/${bv}`);
 assert.equal(parseAgentKeyBilibili(parseLosslessJson(text),bilibiliDetailRoute,{av_id:'9876543210987654321'}).candidates[0]!.data.avId,'9876543210987654321');
});
test('input scope, non-video types, business errors, unknown bodies and contradictory IDs fail closed',()=>{
 for(const [operationId,parameters] of [['TIN1NMTZ',{}],['TIN1NMTZ',{av_id:av,bv_id:bv}],['bilibili.typed_search',{keyword:'a',search_type:'article'}],['VPA67I98',{user_id:mid,page:2}],['bilibili.comments',{av_id:av,next_offset:'opaque'}],['bilibili.comment_replies',{av_id:av,root:rootId,next_offset:1}],['bilibili.trending',{idx:2}],['bilibili.dynamics',{uid:mid,offset:'next'}]] as const)assert.throws(()=>agentKeyBilibiliOperations.find(o=>o.operationId===operationId)!.schema.parse(parameters));
 for(const [route,data,params] of [[bilibiliDetailRoute,{...detail(),aid:Number.MAX_SAFE_INTEGER+1},{bv_id:bv}],[bilibiliDetailRoute,detail(),{av_id:'1'}],[bilibiliDetailRoute,{...detail(),short_link:'https://evil.test/path'},{av_id:av}],[bilibiliProfileRoute,{card:{mid:'1',name:'test'}},{user_id:mid}],[bilibiliRelationRoute,{mid:1,following:2},{uid:mid}],[bilibiliRepliesRoute,{root:{rpid_str:rootId,oid_str:av,replies:[{...comment(true),root_str:'1'}]}},{av_id:av,root:rootId}],[bilibiliCommentsRoute,{replies:[{...comment(),oid_str:'1'}]},{av_id:av}],[bilibiliSearchRoute,{item:[{...video(),uri:'bilibili://video/1'}]},{keyword:'a'}]] as const)assert.throws(()=>parseAgentKeyBilibili(response(data,route===bilibiliRelationRoute),route,params));
 for(const data of [{code:1,data:{item:[]}},{code:0,data:{unexpected:[]}}])assert.throws(()=>parseAgentKeyBilibili({httpStatus:200,mcp:{},envelope:{provider:'TikHub',data:{code:200,data}}},bilibiliSearchRoute,{keyword:'a'}));
 const pending=parseAgentKeyBilibili(response({replies:[comment()]}),bilibiliCommentsRoute,{bv_id:bv});assert.equal(pending.summary.scopeVerified,false);
 for(const [route,data,params] of [[bilibiliSearchRoute,{item:[]},{keyword:'a'}],[bilibiliPostsRoute,{item:[]},{user_id:mid}],[bilibiliCommentsRoute,{replies:[]},{av_id:av}],[bilibiliTrendingRoute,[],{}],[bilibiliHotSearchRoute,{trending:{list:[]}},{limit:10}]] as const)assert.equal(parseAgentKeyBilibili(response(data),route,params).summary.count,0);
 const relation=parseAgentKeyBilibili(response({mid},true),bilibiliRelationRoute,{uid:mid});assert.deepEqual(relation.summary.record,{mid});
});
test('exact recovery recognition is restricted to implemented query operation/tool/platform/version',()=>{
 for(const op of agentKeyBilibiliOperations){const run={provider:'agentkey',contract_version:1,operation_key:op.route.operationKey,step_key:op.route.stepKey,input:{mode:'query',operationId:op.operationId,platform:'bilibili',tool:op.route.tool,upstream:'TikHub'}};assert.equal(agentKeyRouteFor(run),op.route);assert.equal(agentKeyRouteFor({...run,input:{...run.input,mode:'collection'}}),(bilibiliCollectionIds as readonly string[]).includes(op.operationId)?op.route:undefined);
 for(const changed of [{...run,contract_version:2},{...run,step_key:'agentkey.bilibili.future.query'},{...run,input:{...run.input,operationId:'other'}},{...run,input:{...run.input,tool:'other'}}])assert.equal(agentKeyRouteFor(changed),undefined);}
});
test('all eleven Q routes persist same-step summary, completed receipts and explicit import capabilities',async()=>{
 for(const f of fixtures)await withStub(f,async calls=>{const op=agentKeyBilibiliOperations.find(o=>o.route===f.route)!;const run=await createAgentKeyQuery({provider:'agentkey',operationId:op.operationId,parameters:f.params},'bili-test',tag());assert.equal(run.input.platform,'bilibili');const state=await step(run.id);assert.equal(state.status,'completed',state.wait_reason);assert.equal(calls.length,1);assert.deepEqual(calls[0],{name:f.route.tool,params:op.schema.parse(f.params)});
 const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`,summary=rows.find(r=>r.kind==='query_summary')!,items=rows.filter(r=>r.kind!=='query_summary');assert.equal(summary.data.count,items.length);assert.ok(items.every(r=>r.data.querySummaryId===summary.id&&r.step_version===summary.step_version&&r.receipt_id===summary.receipt_id));assert.ok(rows.every(r=>r.source_id===null&&r.article_id===null));
 const [receipt]=await sql`SELECT status,usage FROM receipts WHERE id=${summary.receipt_id}`;assert.equal(receipt!.status,'completed');assert.equal(receipt!.usage.chargedCredits,.2);
 if(items[0]&&![bilibiliDetailRoute,bilibiliProfileRoute].some(r=>r===f.route))await assert.rejects(importBilibiliResult(items[0].id,{reason:'Q only'},'test',tag()));
 });
});
test('received success after interruption resumes locally with valves closed without repurchase',async()=>{
 await withStub(fixtures[3]!,async calls=>{const run=await createAgentKeyQuery({provider:'agentkey',operationId:'TIN1NMTZ',parameters:{av_id:av}},'test',tag());const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));await requestAgentKey(execution,run,bilibiliDetailRoute,{av_id:av});assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);
 process.env.AGENTKEY_CALLS_ENABLED='false';assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);
 });
});
test('scope mismatch retains received evidence on closed-valve resume',async()=>{
 await withStub({...fixtures[3]!,data:{...detail(),aid:1}},async calls=>{const run=await createAgentKeyQuery({provider:'agentkey',operationId:'TIN1NMTZ',parameters:{av_id:av}},'test',tag());const failed=await step(run.id);assert.equal(failed.status,'needs_review');assert.equal((await sql`SELECT status FROM receipts WHERE id=${failed.current_receipt_id}`)[0]!.status,'received');process.env.AGENTKEY_CALLS_ENABLED='false';await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:failed.step_version,generation:failed.generation}));assert.equal((await step(run.id)).status,'needs_review');assert.equal(calls.length,1);assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);});
});
test('received receipt from another run cannot be consumed or repurchased',async()=>{
 await withStub(fixtures[3]!,async calls=>{const make=()=>createAgentKeyQuery({provider:'agentkey',operationId:'TIN1NMTZ',parameters:{av_id:av}},'test',tag());const run=await make(),other=await make();const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));const receipt=await requestAgentKey(execution,run,bilibiliDetailRoute,{av_id:av});await sql`UPDATE operation_runs SET current_receipt_id=${receipt.receiptId} WHERE id=${other.id}`;process.env.AGENTKEY_CALLS_ENABLED='false';assert.equal((await step(other.id)).status,'needs_review');assert.equal(calls.length,1);assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${other.id}`).length,0);});
});
test('admin HTTP catalog merges equivalent variants and rejects unsupported input before outbound',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),previous=backendConfig.devAdmin;backendConfig.devAdmin={displayName:'Synthetic Bilibili API'};
 try{const catalog=await app.inject({method:'GET',url:'/api/admin/redfox/operations'});assert.equal(catalog.statusCode,200);const ops=catalog.json() as any[];for(const id of ['LEN9QXR3','VPA67I98','TIN1NMTZ','EH53TOT7'])assert.deepEqual(ops.find(o=>o.id===id).collectionProviders.map((v:any)=>v.id),['redfox','agentkey']);assert.equal(ops.find(o=>o.id==='bilibili.dynamics').schedulableType,'list');
 await withStub(fixtures[8]!,async calls=>{const headers={'x-csrf-token':'dev','idempotency-key':tag()};const reply=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload:{provider:'agentkey',operationId:'bilibili.dynamics',parameters:{uid:mid}}});assert.equal(reply.statusCode,202,reply.body);assert.equal((await step(reply.json().runId)).status,'completed');assert.equal(calls.length,1);
 const invalid=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers:{...headers,'idempotency-key':tag()},payload:{provider:'agentkey',operationId:'bilibili.typed_search',parameters:{keyword:'a',search_type:'user'}}});assert.equal(invalid.statusCode,400,invalid.body);assert.equal(calls.length,1);});
 }finally{backendConfig.devAdmin=previous;await app.close();}
});

const uniqueMid=()=>BigInt('0x'+randomUUID().replaceAll('-','')).toString();
const uniqueBV=()=>`BV${randomUUID().replaceAll('-','').slice(0,10)}`;
async function receivedDetail(uid=uniqueMid(),videoId=uniqueBV(),body:Record<string,unknown>={desc:'合成视频说明'}){
 let result:any;
 const data={aid:av,bvid:videoId,title:'可导入的合成视频',owner:{mid:uid,name:'合成详情作者'},...body};
 await withStub({route:bilibiliDetailRoute,data},async calls=>{const run=await createAgentKeyQuery({provider:'agentkey',operationId:'TIN1NMTZ',parameters:{bv_id:videoId}},'bili-import-test',tag());assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);[result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='bilibili_work'`;});return result;
}
async function receivedProfile(uid=uniqueMid()){
 let result:any;await withStub({route:bilibiliProfileRoute,data:{card:{mid:uid,name:'合成账号绑定'}}},async()=>{const run=await createAgentKeyQuery({provider:'agentkey',operationId:'EH53TOT7',parameters:{user_id:uid}},'bili-import-test',tag());assert.equal((await step(run.id)).status,'completed');[result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='bilibili_account'`;});return result;
}
test('I detail uses received MID/BV, isolates source and preserves unknown time, description and idempotency',async()=>{
 const r=await receivedDetail(),key=tag(),beforeCalls=process.env.AGENTKEY_CALLS_ENABLED;
 process.env.AGENTKEY_CALLS_ENABLED='false';
 try{
  await assert.rejects(importBilibiliResult(r.id,{reason:'manual not allowed',supplement:{mid:r.data.identity.mid,evidence:'same received value'}},'test',tag()),/supplements/);
  await assert.rejects(importBilibiliResult(r.id,{reason:'manual not allowed',supplement:{url:r.data.url,evidence:'same received URL'}},'test',tag()),/supplements/);
  const imported=await importBilibiliResult(r.id,{reason:'synthetic detail import'},'test',key);assert.ok(imported?.articleId);
  const [a]=await sql`SELECT * FROM articles WHERE id=${imported!.articleId}`;assert.equal(a!.identity_key,`bilibili:bvId:${r.data.workId}`);assert.equal(a!.url,r.data.url);assert.equal(a!.published_at,null);assert.equal(a!.backfill,true);assert.equal(a!.body_text,'合成视频说明');assert.equal(a!.body_status,'ok');assert.equal(a!.raw.provider,'agentkey');assert.equal(a!.raw.descriptionRole,'video_description');
  const [source]=await sql`SELECT participation_mode,site_fulltext,syndicate_fulltext,enabled FROM sources WHERE id=${imported!.sourceId}`;assert.deepEqual({...source},{participation_mode:'isolated',site_fulltext:false,syndicate_fulltext:false,enabled:true});
  assert.equal((await sql`SELECT id_value FROM source_account_bindings WHERE source_id=${imported!.sourceId} AND platform='bilibili' AND id_kind='mid'`)[0]!.id_value,r.data.identity.mid);
  const [result]=await sql`SELECT provenance FROM operation_results WHERE id=${r.id}`;assert.equal(result!.provenance.bilibiliImport.key,key);
  assert.equal((await importBilibiliResult(r.id,{reason:'repeat'},'test',key))!.articleId,imported!.articleId);
  const pending=await receivedDetail(uniqueMid(),uniqueBV(),{desc:undefined});const pendingImport=await importBilibiliResult(pending.id,{reason:'missing description is pending'},'test',tag());const [p]=await sql`SELECT body_text,body_status,published_at,backfill FROM articles WHERE id=${pendingImport!.articleId}`;assert.deepEqual({...p},{body_text:null,body_status:'pending',published_at:null,backfill:true});
 }finally{if(beforeCalls===undefined)delete process.env.AGENTKEY_CALLS_ENABLED;else process.env.AGENTKEY_CALLS_ENABLED=beforeCalls;}
});
test('I validates projection, same-step summary and original receipt identity before any write',async()=>{
 const r=await receivedDetail(),[receipt]=await sql`SELECT * FROM receipts WHERE id=${r.receipt_id}`,[summary]=await sql`SELECT * FROM operation_results WHERE id=${r.data.querySummaryId}`;
 for(const data of [{...r.data,title:'forged'},{...r.data,identity:{mid:'1'}},{...r.data,url:`https://www.bilibili.com/video/${uniqueBV()}`},{...r.data,querySummaryId:r.id}]){
  await sql`UPDATE operation_results SET data=${sql.json(data)} WHERE id=${r.id}`;await assert.rejects(importBilibiliResult(r.id,{reason:'tamper'},'test',tag()));
 }
 await sql`UPDATE operation_results SET data=${sql.json(r.data)} WHERE id=${r.id}`;
 await sql`UPDATE operation_results SET step_version=step_version+1 WHERE id=${summary!.id}`;await assert.rejects(importBilibiliResult(r.id,{reason:'wrong summary step'},'test',tag()));await sql`UPDATE operation_results SET step_version=${summary!.step_version} WHERE id=${summary!.id}`;
 await sql`UPDATE operation_results SET data=${sql.json({...summary!.data,count:2})} WHERE id=${summary!.id}`;await assert.rejects(importBilibiliResult(r.id,{reason:'wrong summary count'},'test',tag()));await sql`UPDATE operation_results SET data=${sql.json(summary!.data)} WHERE id=${summary!.id}`;
 for(const request of [{...receipt!.request,endpoint:'https://other.example/mcp'},{...receipt!.request,params:{bv_id:uniqueBV()}},{...receipt!.request,tool:'wrong/tool'}]){
  await sql`UPDATE receipts SET request=${sql.json(request)} WHERE id=${r.receipt_id}`;await assert.rejects(importBilibiliResult(r.id,{reason:'wrong receipt request'},'test',tag()),/Receipt/);
 }
 await sql`UPDATE receipts SET request=${sql.json(receipt!.request)},subject='operation:0' WHERE id=${r.receipt_id}`;await assert.rejects(importBilibiliResult(r.id,{reason:'wrong subject'},'test',tag()),/Receipt/);
 await sql`UPDATE receipts SET subject=${receipt!.subject},service='agentkey.collect' WHERE id=${r.receipt_id}`;await assert.rejects(importBilibiliResult(r.id,{reason:'wrong service'},'test',tag()),/Receipt/);
 await sql`UPDATE receipts SET service=${receipt!.service},purpose='agentkey.bilibili.search' WHERE id=${r.receipt_id}`;await assert.rejects(importBilibiliResult(r.id,{reason:'wrong purpose'},'test',tag()),/Receipt/);
 await sql`UPDATE receipts SET purpose=${receipt!.purpose},model='wrong/tool' WHERE id=${r.receipt_id}`;await assert.rejects(importBilibiliResult(r.id,{reason:'wrong model'},'test',tag()));
 await sql`UPDATE receipts SET model=${receipt!.model} WHERE id=${r.receipt_id}`;
 const other=await receivedDetail();await sql`UPDATE operation_results SET receipt_id=${other.receipt_id} WHERE id=${r.id}`;await assert.rejects(importBilibiliResult(r.id,{reason:'wrong run receipt'},'test',tag()));await sql`UPDATE operation_results SET receipt_id=${r.receipt_id} WHERE id=${r.id}`;
 const [untouched]=await sql`SELECT source_id,article_id FROM operation_results WHERE id=${r.id}`;assert.deepEqual({...untouched},{source_id:null,article_id:null});
 assert.ok((await importBilibiliResult(r.id,{reason:'restored exact evidence'},'test',tag()))?.articleId);
});
test('I profile binds actual MID explicitly, preserves permissions and rejects identity conflicts or missing authors',async()=>{
 const uid=uniqueMid(),p=await receivedProfile(uid),bound=await importBilibiliResult(p.id,{reason:'explicit profile binding'},'test',tag());assert.ok(bound?.sourceId);assert.equal(bound!.articleId,null);
 const second=await receivedProfile(uid);assert.equal((await importBilibiliResult(second.id,{sourceId:bound!.sourceId,reason:'same MID'},'test',tag()))!.sourceId,bound!.sourceId);
 const conflicting=await receivedProfile(uniqueMid());await assert.rejects(importBilibiliResult(conflicting.id,{sourceId:bound!.sourceId,reason:'different MID'},'test',tag()),/another identity/);
 await sql`UPDATE sources SET participation_mode='editorial',site_fulltext=true,syndicate_fulltext=false WHERE id=${bound!.sourceId}`;
 const work=await receivedDetail(uid);assert.equal((await importBilibiliResult(work.id,{reason:'same received author'},'test',tag()))!.sourceId,bound!.sourceId);const [permission]=await sql`SELECT participation_mode,site_fulltext,syndicate_fulltext FROM sources WHERE id=${bound!.sourceId}`;assert.deepEqual({...permission},{participation_mode:'editorial',site_fulltext:true,syndicate_fulltext:false});
 await sql`UPDATE sources SET enabled=false WHERE id=${bound!.sourceId}`;const paused=await receivedDetail(uid);await assert.rejects(importBilibiliResult(paused.id,{reason:'disabled source'},'test',tag()),/disabled/);
 const missing=await receivedDetail(uniqueMid(),uniqueBV(),{owner:undefined});assert.equal(missing.data.importable,false);await assert.rejects(importBilibiliResult(missing.id,{reason:'no actual MID'},'test',tag()),/received author MID/);
 await assert.rejects(importBilibiliResult(missing.id,{reason:'cannot supplement missing author',supplement:{mid:uid,evidence:'manual'}},'test',tag()),/supplements/);
});
test('I reuses historical Q evidence and deduplicates Redfox and generic native URL materials',async()=>{
 const uid=uniqueMid(),videoId=uniqueBV(),r=await receivedDetail(uid,videoId);
 // Retained Q-only capability hints are not content/identity authority.
 await sql`UPDATE operation_results SET data=${sql.json({...r.data,importable:false,missing:['本阶段仅查询，不导入材料']})} WHERE id=${r.id}`;
 const imported=await importBilibiliResult(r.id,{reason:'historical received detail'},'test',tag());assert.ok(imported?.articleId);
 const server=await stub(()=>({code:2000,data:{bvId:videoId,title:'可导入的合成视频',description:'合成视频说明',authorId:uid,author:'合成详情作者'}}));const saved={...process.env},privateFetch=backendConfig.allowPrivateNetworkFetch;
 Object.assign(process.env,{REDFOX_API_KEY:'fake-bili-import-key',REDFOX_TEST_BASE_URL:server.url,REDFOX_CALLS_ENABLED:'true'});backendConfig.allowPrivateNetworkFetch=true;
 try{const run=await createSynchronousQuery({operationId:'TIN1NMTZ',parameters:{bvId:videoId}},'bili-cross-provider-test',tag());const state=await step(run.id);assert.equal(state.status,'completed',state.wait_reason);const [redfox]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='bilibili_work'`;const redfoxImport=await importBilibiliResult(redfox!.id,{reason:'same cross-provider video'},'test',tag());assert.equal(redfoxImport!.articleId,imported!.articleId);assert.equal(redfoxImport!.sourceId,imported!.sourceId);}
 finally{await server.close();backendConfig.allowPrivateNetworkFetch=privateFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
 const nativeBV=uniqueBV(),nativeURL=`https://www.bilibili.com/video/${nativeBV}/?p=1`;
 const material=await upsertMaterial({sourceId:imported!.sourceId,url:nativeURL,identityKey:identityKeyForUrl(nativeURL)!,title:'既有原生链接材料',bodyStatus:'pending',publishedAt:null,via:'import'});
 const native=await receivedDetail(uid,nativeBV);assert.equal((await importBilibiliResult(native.id,{reason:'same canonical BV'},'test',tag()))!.articleId,material.articleId);
 const [count]=await sql`SELECT count(*)::int AS count FROM articles WHERE id IN ${sql([imported!.articleId,material.articleId])}`;assert.equal(count!.count,2);
});

test('S nine single-request subscriptions persist bounded research facts and release occupancy for next run',async()=>{
 for(const f of fixtures.filter(f=>![bilibiliDetailRoute,bilibiliProfileRoute].some(r=>r===f.route)))await withStub(f,async calls=>{
  process.env.COLLECT_ENABLED='true';const operationId=agentKeyBilibiliOperations.find(o=>o.route===f.route)!.operationId;
  const sub=await createPlatformSubscription({name:'Bili synthetic snapshot',provider:'agentkey',operationId,parameters:f.params,enabled:true,limits:{pages:1,items:1,details:0}},'test',tag());
  try{const run=await startPlatformSubscription(sub.id,'test',tag());assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);
   const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`,summary=rows.find(r=>r.kind==='query_summary')!,selected=rows.filter(r=>r.kind!=='query_summary');
   assert.equal(summary.data.selectedCount,selected.length);assert.equal(summary.data.unprocessedDueToLimit,f.route===bilibiliDynamicsRoute?1:0);assert.equal(summary.data.nextParameters,null);assert.equal(summary.data.stopReason,'single-request');assert.ok(rows.every(r=>r.article_id===null&&r.source_id===null));
   if(f.route===bilibiliRelationRoute){assert.equal(summary.data.count,0);assert.deepEqual(summary.data.record,{mid,following:3,follower:12});}
   const [state]=await sql`SELECT active_run_id,progress,next_run_at>now() AS scheduled FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(state!.active_run_id,null);assert.equal(state!.scheduled,true);assert.deepEqual(state!.progress,{pages:1,items:selected.length,details:0,stopReason:'single-request',nextParameters:null});
  }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
 });
 for(const operationId of ['TIN1NMTZ','EH53TOT7'])await assert.rejects(createPlatformSubscription({name:'invalid independent S',provider:'agentkey',operationId,parameters:{}},'test',tag()));
 await assert.rejects(createPlatformSubscription({name:'not multi-page',provider:'agentkey',operationId:'LEN9QXR3',parameters:{keyword:'a'},limits:{pages:2,items:3,details:0}},'test',tag()),/one homepage/);
});

function collectionFixture(operationId:string,uid=uniqueMid()){
 const bv1=uniqueBV(),bv2=uniqueBV(),av1='123451',av2='123452';
 const item=(aid:string,bvid:string)=>operationId==='VPA67I98'?{goto:'av',param:aid,uri:`bilibili://video/${aid}`,bvid,title:'合成账号视频'}:{goto:'av',param:aid,uri:`bilibili://video/${aid}`,av:{title:'合成搜索视频',mid:uid,author:'列表作者'}};
 const list=operationId==='bilibili.typed_search'?{items:[item(av1,bv1),item(av2,bv2)]}:{item:[item(av1,bv1),item(av2,bv2)]};
 const parameters=operationId==='VPA67I98'?{user_id:uid}:{keyword:'合成列表'};
 const full={aid:av1,bvid:bv1,title:'合成详情',desc:'实际详情说明',owner:{mid:uid,name:'实际详情作者'}};
 const route=agentKeyBilibiliOperations.find(o=>o.operationId===operationId)!.route;
 const config={name:'Bili bounded detail',provider:'agentkey',operationId,parameters,enabled:true,enrichDetails:true,detailOperationId:'TIN1NMTZ',limits:{pages:1,items:1,details:1}};
 return {uid,bv1,av1,list,parameters,full,route,config};
}
test('S search, typed video and account posts buy only bounded explicit details and retain list discovery time',async()=>{
 for(const operationId of ['LEN9QXR3','bilibili.typed_search','VPA67I98']){
  const f=collectionFixture(operationId);
  await withStub({route:f.route,data:(q:any)=>q.name===bilibiliDetailRoute.tool?f.full:f.list},async calls=>{
   process.env.COLLECT_ENABLED='true';const sub=await createPlatformSubscription(f.config,'test',tag());
   try{const run=await startPlatformSubscription(sub.id,'test',tag());const listed=await step(run.id);assert.equal(listed.status,'active',listed.wait_reason);assert.equal(listed.step_key,bilibiliDetailRoute.stepKey);assert.equal(calls.length,1);assert.equal(listed.progress.detailItems.length,1);
    const [source]=await sql`SELECT * FROM operation_results WHERE id=${listed.progress.detailItems[0]}`;const discovery=new Date(Date.now()-3600_000);await sql`UPDATE receipts SET received_at=${discovery} WHERE id=${source!.receipt_id}`;
    const done=await step(run.id);assert.equal(done.status,'completed',done.wait_reason);assert.equal(calls.length,2);assert.deepEqual(calls[1].params,operationId==='VPA67I98'?{bv_id:f.bv1}:{av_id:f.av1});
    const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='bilibili_work' AND data->>'operationId'='TIN1NMTZ'`;assert.ok(result!.article_id);
    const [summary]=await sql`SELECT * FROM operation_results WHERE id=${result!.data.querySummaryId}`;assert.equal(summary!.data.originResultId,source!.id);assert.equal(summary!.data.operationId,'TIN1NMTZ');assert.equal(summary!.step_version,result!.step_version);assert.equal(summary!.receipt_id,result!.receipt_id);
    const [article]=await sql`SELECT source_id,discovered_at,raw FROM articles WHERE id=${result!.article_id}`;assert.equal(article!.discovered_at.toISOString(),discovery.toISOString());assert.equal(article!.raw.provider,'agentkey');
    const [state]=await sql`SELECT progress,active_run_id FROM collection_subscriptions WHERE id=${sub.id}`;assert.deepEqual(state!.progress,{pages:1,items:1,details:1,stopReason:'single-request',nextParameters:null});assert.equal(state!.active_run_id,null);
    const receipts=await sql`SELECT status FROM receipts WHERE id IN ${sql([source!.receipt_id,result!.receipt_id])}`;assert.ok(receipts.every(r=>r.status==='completed'));
   }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
  });
 }
});
test('S detail checks both received aliases and actual author, while missing MID remains a pending research item',async()=>{
 for(const problem of ['wrongAV','wrongMID','missingMID'] as const){const f=collectionFixture('VPA67I98');const full=problem==='wrongAV'?{...f.full,aid:'999'}:problem==='wrongMID'?{...f.full,owner:{mid:uniqueMid(),name:'different actual author'}}:{...f.full,owner:undefined};
  await withStub({route:f.route,data:(q:any)=>q.name===bilibiliDetailRoute.tool?full:f.list},async calls=>{
   process.env.COLLECT_ENABLED='true';const sub=await createPlatformSubscription(f.config,'test',tag());
   try{const run=await startPlatformSubscription(sub.id,'test',tag());await step(run.id);const done=await step(run.id);assert.equal(calls.length,2);assert.equal(done.status,problem==='missingMID'?'completed':'needs_review',done.wait_reason);
    const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.ok(rows.every(r=>r.article_id===null&&r.source_id===null));
    if(problem==='missingMID'){const pending=rows.find(r=>r.data.operationId==='TIN1NMTZ'&&r.kind==='bilibili_work')!;assert.deepEqual(pending.data.identity,{});assert.match(pending.data.pendingReason,/received author MID/);}
    else{assert.equal((await sql`SELECT status FROM receipts WHERE id=${done.current_receipt_id}`)[0]!.status,'received');assert.equal(rows.some(r=>r.data.operationId==='TIN1NMTZ'),false);}
   }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
  });
 }
});
test('S received detail resumes with outbound valves closed and configuration change stops stale work without new material',async()=>{
 for(const stop of [false,true]){const f=collectionFixture('LEN9QXR3');await withStub({route:f.route,data:(q:any)=>q.name===bilibiliDetailRoute.tool?f.full:f.list},async calls=>{
  process.env.COLLECT_ENABLED='true';const sub=await createPlatformSubscription(f.config,'test',tag());
  try{const run=await startPlatformSubscription(sub.id,'test',tag());const listed=await step(run.id);
   const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:listed.step_version,generation:listed.generation},randomUUID()));await requestAgentKey(execution,listed as any,bilibiliDetailRoute,listed.progress.parameters);
   process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';
   if(stop)await updatePlatformSubscription(sub.id,{editVersion:1,config:{...f.config,parameters:{keyword:'changed before commit'}}},'test');
   const done=await step(run.id);assert.equal(done.status,stop?'stopped':'completed',done.wait_reason);assert.equal(calls.length,2);
   const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(rows.some(r=>r.article_id!==null),!stop);
   if(stop){const [receipt]=await sql`SELECT status FROM receipts WHERE id=${done.current_receipt_id}`;assert.equal(receipt!.status,'received');}
  }finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
 });}
});
test('S in-flight detail configuration change retains received evidence but cannot import or advance stale execution',async()=>{
 const f=collectionFixture('LEN9QXR3'),entered=gate(),release=gate();
 await withStub({route:f.route,data:async(q:any)=>{if(q.name!==bilibiliDetailRoute.tool)return f.list;entered.open();await release.promise;return f.full;}},async calls=>{
  process.env.COLLECT_ENABLED='true';const sub=await createPlatformSubscription(f.config,'test',tag());
  try{const run=await startPlatformSubscription(sub.id,'test',tag());await step(run.id);const executing=step(run.id);await entered.promise;
   await updatePlatformSubscription(sub.id,{editVersion:1,config:{...f.config,enabled:false}},'test');release.open();const done=await executing;assert.equal(done.status,'stopped');assert.equal(calls.length,2);
   const [receipt]=await sql`SELECT status FROM receipts WHERE id=${done.current_receipt_id}`;assert.equal(receipt!.status,'received');assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND article_id IS NOT NULL`).length,0);
  }finally{release.open();await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
 });
});
test('S defaults buy no details, and X blocks incompatible saved Bilibili semantics without modifying the subscription',async()=>{
 const f=collectionFixture('LEN9QXR3');await withStub({route:f.route,data:f.list},async calls=>{
  process.env.COLLECT_ENABLED='true';const sub=await createPlatformSubscription({name:'default snapshot',provider:'agentkey',operationId:'LEN9QXR3',parameters:f.parameters,enabled:true},'test',tag());
  try{const run=await startPlatformSubscription(sub.id,'test',tag());assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);const [s]=await sql`SELECT limits FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(s!.limits.pages,1);assert.equal(s!.limits.details,0);}finally{await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;}
 });
 const legacy=await createPlatformSubscription({name:'original multi-page',provider:'redfox',operationId:'LEN9QXR3',parameters:{keyword:'original',page:'1',exactMatch:true,order:'play'},enabled:false,limits:{pages:3,items:25,details:5}},'test',tag());
 const [before]=await sql`SELECT * FROM collection_subscriptions WHERE id=${legacy.id}`;
 const preflight=await preflightPlatformSubscriptionProvider(legacy.id,{editVersion:1,targetProvider:'agentkey'});assert.equal(preflight!.supported,false);assert.match(preflight!.checks.map(c=>c.evidence).join(' '),/多页/);assert.match(preflight!.checks.map(c=>c.evidence).join(' '),/材料/);
 await assert.rejects(switchPlatformSubscriptionProvider(legacy.id,{editVersion:1,targetProvider:'agentkey',reason:'unsupported switch'},'test'));
 const [after]=await sql`SELECT * FROM collection_subscriptions WHERE id=${legacy.id}`;assert.deepEqual(after,before);
});
