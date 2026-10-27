import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextDouyinPage} from '@aihot/backend/providers/agentkey/douyin-search';
import {parseDouyinSearch} from '@aihot/backend/providers/agentkey/douyin-parser';
import {douyinSearchInput, douyinKeywordInput, agentKeyOutboundAllowed, douyinSearchRoute} from '@aihot/backend/providers/agentkey/douyin-contract';
import {collectionProviderOptions} from '@aihot/backend/sources/platform-subscriptions';
import {collectionConfig, collectionDraft, collectionPreviewBody, providerOperation} from '../apps/web/app/features/admin/collection-subscription-data.ts';
import type {PlatformOperation} from '../apps/web/app/features/admin/platform-types.ts';
const input=douyinSearchInput.parse({keyword:'测试'});
test('continuation preserves only exact upstream fields and stops missing/repeated tokens',()=>{
 const pagination={hasMore:true,cursor:12};
 const next=nextDouyinPage(input,pagination);
 assert.deepEqual(next.parameters,{keyword:'测试',cursor:12});
 assert.equal(nextDouyinPage(next.parameters!,pagination).stopReason,'repeated-next-token-needs-review');
 assert.equal(nextDouyinPage(input,{hasMore:true}).stopReason,'missing-next-token-needs-review');
 assert.equal(nextDouyinPage(input,{hasMore:false,cursor:12}).stopReason,'upstream-no-more');
 for(const value of [undefined,{}, {hasMore:null},{hasMore:'false'},{hasMore:2}])assert.equal(nextDouyinPage(input,value).stopReason,'invalid-pagination-needs-review');
});
test('AgentKey only offers keyword for OWIBYU1V, preview and config preserve provider',()=>{
 assert.deepEqual(collectionProviderOptions('HUCIASU').map(p=>p.id),['redfox']);
 const operation:PlatformOperation={id:'OWIBYU1V',platform:'douyin',label:'搜索',purpose:'Redfox',fields:[{name:'keyword',label:'关键词',type:'string',required:true},{name:'sort',label:'排序',type:'string',required:false}],schedulableType:'search',collectionProviders:collectionProviderOptions('OWIBYU1V')};
 const selected=providerOperation(operation,'agentkey');
 assert.deepEqual(selected.fields.map(f=>f.name),['keyword']);
 const draft={...collectionDraft(operation),provider:'agentkey',name:'测试',values:{keyword:'模型',sort:'wrong'}};
 const config=collectionConfig(operation,draft);
 assert.equal(config.enabled,false);assert.equal(config.provider,'agentkey');assert.deepEqual(config.parameters,{keyword:'模型'});
 assert.deepEqual(collectionPreviewBody(operation,draft.values,new Date(),'agentkey'),{provider:'agentkey',operationId:'OWIBYU1V',parameters:{keyword:'模型'}});
 assert.throws(()=>douyinKeywordInput.parse({keyword:'x',sort:'latest'}));
});
test('AgentKey valve independent of Redfox and collection valve only gates collection',()=>{
 const run={provider:'agentkey',operation_key:douyinSearchRoute.operationKey,step_key:douyinSearchRoute.stepKey,contract_version:1,input:{mode:'collection'}};
 assert.equal(agentKeyOutboundAllowed(run,{AGENTKEY_CALLS_ENABLED:'true',REDFOX_CALLS_ENABLED:'false'}),true);
 assert.equal(agentKeyOutboundAllowed(run,{AGENTKEY_CALLS_ENABLED:'false',REDFOX_CALLS_ENABLED:'true'}),false);
 assert.equal(agentKeyOutboundAllowed(run,{AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'false'}),false);
 assert.equal(agentKeyOutboundAllowed({...run,input:{mode:'query'}},{AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'false'}),true);
});
test('normalized Douyin work preserves epoch seconds and stable identity with optional author provenance',()=>{
 const aweme={AwemeId:'123',Desc:'标题',CreateTime:'1729400000000',Author:{Nickname:'作者',SecUid:'sec-456'},Video:{ItemID:'123',Title:'标题',CreateTime:'1729400000',Cover:{UrlList:['https://p3.douyinpic.com/test.jpeg']}}};
 const result=parseDouyinSearch({envelope:{provider:'TikHub',data:{code:200,data:{code:0,msg:'success',data:{hasMore:false,cursor:12,itemList:[{AwemeInfo:aweme}]}}}}},input).candidates[0];
 assert.equal(result.kind,'douyin_work');assert.equal(result.data.operationId,'OWIBYU1V');assert.deepEqual(result.data.identity,{secUserId:'sec-456'});assert.equal(result.data.publishedAt,new Date(1729400000*1000).toISOString());assert.equal(result.data.url,'https://www.douyin.com/video/123');assert.equal(result.data.record.coverUrl,'https://p3.douyinpic.com/test.jpeg');
 const unknown=parseDouyinSearch({envelope:{provider:'TikHub',data:{code:200,data:{code:0,msg:'success',data:{hasMore:false,cursor:12,itemList:[{AwemeInfo:{AwemeId:'123'}}]}}}}},input).candidates[0];
 assert.deepEqual(unknown.data.importBlockers,[]);assert.equal(unknown.data.publishedAt,null);
});
test('Douyin V4 parser rejects conflicting evidence and records unparseable time',()=>{
 const envelope=(AwemeInfo:Record<string,unknown>)=>parseDouyinSearch({envelope:{provider:'TikHub',data:{code:200,data:{code:0,msg:'success',data:{hasMore:false,cursor:12,itemList:[{AwemeInfo}]}}}}},input).candidates[0]!;
 assert.throws(()=>envelope({AwemeId:'123',Author:{SecUid:'sec-456'},Video:{ItemID:'456'}}),/work IDs disagree/);
 const secondsOnly=envelope({AwemeId:'123',Author:{SecUid:'sec-456'},Video:{ItemID:'123',CreateTime:'1729400000'}});
 assert.equal(secondsOnly.data.publishedAt,new Date(1729400000*1000).toISOString());
 const invalidTime=envelope({AwemeId:'123',Author:{SecUid:'sec-456'},Video:{ItemID:'123',CreateTime:'not-a-time'}});
 assert.equal(invalidTime.data.publishedAt,null);assert.ok(invalidTime.data.missingFields.includes('create_time'));
});

test("APP list/detail contracts preserve only verified work fields, IDs and seconds",async()=>{
  const {parseDouyinApp}=await import("@aihot/backend/providers/agentkey/douyin-parser");
  const {douyinAccountPostsRoute:list,douyinDetailRoute:detail,douyinAccountPostsInput}=await import("@aihot/backend/providers/agentkey/douyin-contract");
  const response=(data:unknown)=>({envelope:{provider:"TikHub",data:{code:200,data}}});
  const work={aweme_id:"700000000000000001",desc:"description",create_time:1729400000,author:{uid:"800000000000000001",sec_uid:"synthetic-sec",nickname:"Synthetic",authentication_token:"private"},video:{cover:{url_list:["javascript:bad","https://example.test/cover"]}},unrelated_personal_data:"must not project"};
  const parse=(item:unknown)=>parseDouyinApp(response({status_code:0,aweme_list:[item],has_more:0}),list,{sec_user_id:"synthetic-sec"});
  const result=parse(work).candidates[0]!;
  assert.equal(result.data.publishedAt,new Date(work.create_time*1000).toISOString());
  assert.equal(result.data.url,`https://www.douyin.com/video/${work.aweme_id}`);
  assert.deepEqual(Object.keys(result.data.record).sort(),["authorName","aweme_desc","coverUrl","create_time","desc"]);
  assert.equal(result.data.record.coverUrl,"https://example.test/cover");
  assert.equal(parseDouyinApp(response({aweme_detail:work}),detail,{aweme_id:work.aweme_id}).candidates.length,1);
  assert.equal(parseDouyinApp(response({status_code:0,aweme_list:[],has_more:false}),list,{sec_user_id:"synthetic-sec"}).summary.count,0);
  for(const body of [null,{}, {filter_list:[{reason:8}]},{aweme_detail:{...work,aweme_id:"123"}}])assert.throws(()=>parseDouyinApp(response(body),detail,{aweme_id:work.aweme_id}));
  for(const body of [{status_code:1,aweme_list:[]},{status_code:0},{status_code:0,aweme_list:[work],sec_uid:"wrong"},{status_code:0,aweme_list:[work],uid:"123"}])assert.throws(()=>parseDouyinApp(response(body),list,{sec_user_id:"synthetic-sec"}));
  assert.throws(()=>parse({...work,author:{...work.author,sec_uid:"wrong"}}));
  const missing=parse({aweme_id:Number.MAX_SAFE_INTEGER+1}).candidates[0]!;
  assert.deepEqual(missing.data.identity,{});assert.equal(missing.data.workId,null);assert.equal(missing.data.publishedAt,null);
  assert.deepEqual(missing.data.importBlockers,["lossless_work_id_required"]);
  for(const parameters of [{sec_user_id:"s",count:21},{sec_user_id:"s",channel:"lite"},{sec_user_id:"s",sort_type:2},{sec_user_id:"s",secUserId:"s"},{sec_user_id:"s",max_cursor:Number.MAX_SAFE_INTEGER+1}])assert.equal(douyinAccountPostsInput.safeParse(parameters).success,false);
});

test("APP continuation, redaction and exact frozen detail lookup fail closed",async()=>{
  const {nextAgentKeyPage}=await import("@aihot/backend/providers/agentkey/douyin-search");
  const {redactEvidence}=await import("@aihot/backend/providers/agentkey/response");
  const {agentKeyRouteFor,douyinAccountPostsRoute:list,douyinDetailRoute:detail,douyinAccountPostsInput}=await import("@aihot/backend/providers/agentkey/douyin-contract");
  const p=douyinAccountPostsInput.parse({sec_user_id:"synthetic-sec"});
  assert.equal(nextAgentKeyPage(list,p,{hasMore:true,cursor:123}).parameters?.max_cursor,123);
  assert.equal(nextAgentKeyPage(list,p,{hasMore:false}).stopReason,"upstream-no-more");
  for(const cursor of [undefined,0,-1,Number.MAX_SAFE_INTEGER+1,"123"])assert.match(nextAgentKeyPage(list,p,{hasMore:true,cursor}).stopReason!,/needs-review/);
  const run={provider:"agentkey",operation_key:list.operationKey,step_key:detail.stepKey,contract_version:1,input:{mode:"collection",enrichDetails:true,detailOperationId:"FK67XDVQ"}};
  assert.equal(agentKeyRouteFor(run),detail);
  assert.equal(agentKeyRouteFor({...run,contract_version:2}),undefined);
  assert.equal(agentKeyRouteFor({...run,operation_key:"agentkey.douyin.search"}),undefined);
  assert.deepEqual(redactEvidence({authentication_token:"private",max_cursor:123,next_token:"public-cursor"},"fake-key"),{authentication_token:"[redacted]",max_cursor:123,next_token:"public-cursor"});
  assert.equal(redactEvidence('{"authentication_token":"private","max_cursor":123}',"fake-key"),'{"authentication_token":"[redacted]","max_cursor":123}');
});

test("chosen detail cannot assign a different account when list author was absent",async()=>{
  const {verifyDouyinDetailAuthor}=await import("@aihot/backend/providers/agentkey/douyin-parser");
  const source={workId:"123",identity:{}},response={envelope:{provider:"TikHub",data:{code:200,data:{uid:"456",sec_uid:"synthetic-sec"}}}};
  assert.throws(()=>verifyDouyinDetailAuthor({workId:"123",identity:{uid:"789"}},source,response,{sec_user_id:"synthetic-sec"}));
  assert.throws(()=>verifyDouyinDetailAuthor({workId:"123",identity:{secUserId:"other"}},source,response,{sec_user_id:"synthetic-sec"}));
  assert.doesNotThrow(()=>verifyDouyinDetailAuthor({workId:"123",identity:{uid:"456",secUserId:"synthetic-sec"}},source,response,{sec_user_id:"synthetic-sec"}));
});


test("account creation cannot inject an unreceived continuation cursor",async()=>{
  const {agentKeyOperation}=await import("@aihot/backend/providers/agentkey/douyin-contract");
  const account=agentKeyOperation("QEQLCKD6")!;
  assert.equal(account.querySchema.safeParse({sec_user_id:"synthetic",max_cursor:123}).success,false);
  assert.equal(account.querySchema.safeParse({sec_user_id:"synthetic",max_cursor:0}).success,true);
});

test("research routes parse suggestions and lossless account patches into whitelisted results",async()=>{
  const {parseDouyinResearch}=await import("@aihot/backend/providers/agentkey/douyin-parser");
  const {douyinSuggestRoute:suggest,douyinAccountSearchRoute:account,douyinAccountSearchInput,agentKeyRouteFor,douyinSuggestDescriptor}=await import("@aihot/backend/providers/agentkey/douyin-contract");
  const response=(body:unknown)=>({envelope:{provider:"TikHub",data:{code:200,data:body}}});
  const user={uid:"90071992547409931234",sec_uid:"synthetic-research",nickname:"Synthetic account",follower_count:0,signature:"Synthetic signature",authentication_token:"not-displayed"};
  const dynamic={raw_data:JSON.stringify({user_info:user,room_id:9007199254740992,unrelated:"not-displayed"}),schema:"https://example.invalid/do-not-fetch"};
  for(const row of [{user_info:user},{dynamic_patch:dynamic},{user_info:user,dynamic_patch:dynamic}]){
    const parsed=parseDouyinResearch(response({status_code:0,user_list:[row],cursor:50,has_more:1}),account,{keyword:" synthetic "});
    assert.equal(parsed.candidates[0]!.kind,"douyin_account");
    assert.deepEqual(parsed.candidates[0]!.data.identity,{uid:user.uid,secUserId:user.sec_uid});
    assert.deepEqual(parsed.candidates[0]!.data.record,{uid:user.uid,sec_uid:user.sec_uid,nickname:user.nickname,follower_count:0,signature:user.signature});
    assert.deepEqual(parsed.summary.query,{keyword:"synthetic",cursor:0,douyin_user_fans:"",douyin_user_type:"",search_id:""});
    assert.equal(parsed.summary.pagination,undefined);
  }
  const numeric=parseDouyinResearch(response({status_code:0,user_list:[{dynamic_patch:{raw_data:'{"user_info":{"uid":90071992547409931234,"nickname":"Synthetic numeric token"}}'}}]}),account,{keyword:"test"});
  assert.deepEqual(numeric.candidates[0]!.data.identity,{uid:"90071992547409931234"});
  const missing=parseDouyinResearch(response({status_code:0,user_list:[{user_info:{uid:Number.MAX_SAFE_INTEGER+1,nickname:"Unknown ID"}}]}),account,{keyword:"test"});
  assert.deepEqual(missing.candidates[0]!.data.identity,{});assert.deepEqual(missing.candidates[0]!.data.importBlockers,["lossless_account_id_required"]);
  const words=parseDouyinResearch(response({status_code:0,sug_list:[{content:"synthetic word",other:"ignored"}]}),suggest,{keyword:"test"});
  assert.equal(words.candidates[0]!.kind,"search_suggestion");assert.deepEqual(words.candidates[0]!.data.record,{content:"synthetic word"});assert.equal(words.candidates[0]!.data.identity,undefined);assert.equal(words.candidates[0]!.data.url,undefined);
  for(const route of [suggest,account])assert.equal(parseDouyinResearch(response({status_code:0,sug_list:[],user_list:[]}),route,{keyword:"test"}).summary.count,0);
  for(const params of [{keyword:"x",cursor:1},{keyword:"x",douyin_user_fans:"1"},{keyword:"x",douyin_user_type:"1"},{keyword:"x",search_id:"unverified"},{keyword:"x",sortType:"_2"}])assert.equal(douyinAccountSearchInput.safeParse(params).success,false);
  for(const route of [suggest,account]){
    const run={provider:"agentkey",operation_key:route.operationKey,step_key:route.stepKey,contract_version:1,input:{mode:"query"}};
    assert.equal(agentKeyRouteFor(run),route);assert.equal(agentKeyRouteFor({...run,input:{mode:"collection"}}),undefined);
    assert.equal(agentKeyRouteFor({...run,step_key:route.stepKey+".fallback"}),undefined);
  }
  assert.equal(douyinSuggestDescriptor.schedulableType,null);assert.deepEqual(douyinSuggestDescriptor.collectionProviders?.map(p=>p.id),["agentkey"]);
  assert.equal(douyinSuggestDescriptor.collectionPrice?.amount,0.2);
});

test("research parsing retains malformed, conflicting and non-success evidence for review",async()=>{
  const {parseDouyinResearch}=await import("@aihot/backend/providers/agentkey/douyin-parser");
  const {douyinSuggestRoute:suggest,douyinAccountSearchRoute:account}=await import("@aihot/backend/providers/agentkey/douyin-contract");
  const response=(body:unknown)=>({envelope:{provider:"TikHub",data:{code:200,data:body}}});
  for(const body of [null,{}, {status_code:1,user_list:[]},{status_code:0,user_list:null},{status_code:0,user_list:[{}]}])assert.throws(()=>parseDouyinResearch(response(body),account,{keyword:"x"}));
  for(const row of [{user_info:"bad"},{user_info:{nickname:3}},{dynamic_patch:{raw_data:"not json"}},{dynamic_patch:{raw_data:"{}"}},{dynamic_patch:{raw_data:{user_info:{uid:"123"}}}},{user_info:{uid:"123"},dynamic_patch:{raw_data:'{"user_info":{"uid":"456"}}'}},{user_info:{sec_uid:"left"},dynamic_patch:{raw_data:'{"user_info":{"sec_uid":"right"}}'}}])assert.throws(()=>parseDouyinResearch(response({status_code:0,user_list:[row]}),account,{keyword:"x"}));
  for(const body of [null,{status_code:0},{status_code:1,sug_list:[]},{status_code:0,sug_list:[{}]},{status_code:0,sug_list:[{content:5}]}])assert.throws(()=>parseDouyinResearch(response(body),suggest,{keyword:"x"}));
});
