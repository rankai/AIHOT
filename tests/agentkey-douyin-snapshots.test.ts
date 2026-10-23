import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentKeyOperation,agentKeyRouteFor,agentKeyRouteInput,douyinSnapshotOperations,douyinTrendingRoute,douyinCommentsRoute,douyinRepliesRoute,douyinTopicRoute,douyinFollowingRoute,douyinProfileRoute} from '../packages/backend/src/providers/agentkey/douyin-contract.ts';
import {parseAgentKeyDouyin} from '../packages/backend/src/providers/agentkey/douyin-parser.ts';
const response=(body:Record<string,unknown>)=>({envelope:{provider:'TikHub',data:{code:200,data:{status_code:0,...body}}}});
const user={uid:'123',sec_uid:'safe-id',nickname:'测试',signature:'简介',follower_count:12,following_count:2,authentication_token:'secret',email:'private'};
const work={aweme_id:'987',desc:'作品说明',create_time:1700000000,share_url:'https://v.douyin.com/example/',author:user,content:'must not import',authentication_token:'secret'};
const comment={cid:'999',text:'评论',aweme_id:'987',reply_id:'111',reply_to_reply_id:'222',user,create_time:1700000000,digg_count:2,comment_token:'secret',content:'unsafe alias'};
test('six exact contracts freeze supported requests; unsupported profile modes and followers rejected',()=>{
 const inputs=[{}, {aweme_id:'987'},{item_id:'987',comment_id:'111'},{ch_id:'444'},{sec_user_id:'safe-id'},{sec_user_id:'safe-id'}];
 for(const [i,op] of douyinSnapshotOperations.entries()){
  assert.equal(op.route.estimatedCredits,.2);assert.equal(op.route.contractVersion,1);assert.equal(agentKeyOperation(op.operationId)?.route,op.route);
  assert.ok(agentKeyRouteInput(op.route,inputs[i]));assert.throws(()=>agentKeyRouteInput(op.route,{...inputs[i],unknown:'x'}));
 }
 assert.throws(()=>agentKeyRouteInput(douyinTrendingRoute,{board_type:'2'}));
 assert.throws(()=>agentKeyRouteInput(douyinCommentsRoute,{aweme_id:'987',cursor:1}));
 assert.throws(()=>agentKeyRouteInput(douyinFollowingRoute,{sec_user_id:'safe-id',source_type:1}));
 assert.equal(agentKeyOperation('douyin.followers'),undefined);
 assert.equal(agentKeyRouteFor({provider:'agentkey',operation_key:douyinProfileRoute.operationKey,step_key:douyinProfileRoute.stepKey,contract_version:1,input:{mode:'collection'}}),undefined);
});
test('trending exact word list preserves order without invented ranks or secondary items',()=>{
 const parsed=parseAgentKeyDouyin(response({data:{word_list:[{word:'热点',sentence_id:'333',hot_value:25,rank:1,content:'unsafe'}],trending_list:[{}]}}),douyinTrendingRoute,{});
 assert.equal(parsed.candidates[0]?.kind,'hotspot_research');assert.deepEqual(parsed.candidates[0]?.data.record,{word:'热点',sentence_id:'333',hot_value:25});
 assert.equal(parseAgentKeyDouyin(response({data:{word_list:[]}}),douyinTrendingRoute,{}).summary.count,0);
 assert.throws(()=>parseAgentKeyDouyin(response({word_list:[]}),douyinTrendingRoute,{}));
});
test('comments and replies enforce actual work and parent, allow missing optional fields, whitelist author and raw time',()=>{
 for(const [route,input] of [[douyinCommentsRoute,{aweme_id:'987'}],[douyinRepliesRoute,{item_id:'987',comment_id:'111'}]] as const){
  const p=parseAgentKeyDouyin(response({comments:[comment]}),route,input);assert.equal(p.candidates[0]?.kind,'social_comment');
  assert.equal(JSON.stringify(p).includes('secret'),false);assert.equal(JSON.stringify(p).includes('private'),false);assert.equal(JSON.stringify(p).includes('unsafe alias'),false);
  assert.deepEqual(p.candidates[0]?.data.timeUnits,{create_time:'unspecified'});
  assert.throws(()=>parseAgentKeyDouyin(response({comments:[{...comment,aweme_id:'1'}]}),route,input));
  assert.equal(parseAgentKeyDouyin(response({comments:[{cid:'99',text:'text',aweme_id:'987',reply_id:'111'}]}),route,input).summary.count,1);
 }
 assert.throws(()=>parseAgentKeyDouyin(response({comments:[{...comment,reply_id:'222',reply_to_reply_id:'111'}]}),douyinRepliesRoute,{item_id:'987',comment_id:'111'}));
});
test('topic uses mixed aweme items even with empty aweme list and preserves unknown time',()=>{
 const p=parseAgentKeyDouyin(response({aweme_list:[],mix_list:Array.from({length:10},()=>({type:1,aweme_info:work}))}),douyinTopicRoute,{ch_id:'444'});
 assert.equal(p.candidates.length,10);assert.equal(p.candidates[0]?.data.publishedAt,null);assert.equal(p.candidates[0]?.data.url,'https://www.douyin.com/video/987');
 assert.equal(JSON.stringify(p).includes('must not import'),false);assert.equal(JSON.stringify(p).includes('secret'),false);
 assert.throws(()=>parseAgentKeyDouyin(response({aweme_list:[],mix_list:[{type:2,aweme_info:work}]}),douyinTopicRoute,{ch_id:'444'}));
});
test('following 19 is complete snapshot; empty with safe max_time is bootstrap, not terminal proof',()=>{
 const p=parseAgentKeyDouyin(response({followings:Array.from({length:19},()=>user),max_time:123,has_more:true}),douyinFollowingRoute,{sec_user_id:'safe-id'});
 assert.equal(p.candidates.length,19);assert.equal(p.summary.stopReason,'single-request');assert.equal(p.summary.bootstrap,false);assert.equal(p.candidates[0]?.kind,'social_followee');assert.equal(JSON.stringify(p).includes('private'),false);
 const empty=parseAgentKeyDouyin(response({followings:[],max_time:123,has_more:true}),douyinFollowingRoute,{sec_user_id:'safe-id'});assert.equal(empty.summary.bootstrap,true);
 assert.throws(()=>parseAgentKeyDouyin(response({followings:[]}),douyinFollowingRoute,{sec_user_id:'safe-id'}));
});
test('profile deleted state is summary only; active or business errors remain unrecognized',()=>{
 const p=parseAgentKeyDouyin(response({user:{uid:'123',nickname:'已注销',user_deleted:true,special_state_info:{special_state:1,title:'已注销',content:'不可用',token:'secret'}}}),douyinProfileRoute,{sec_user_id:'safe-id'});
 assert.equal(p.candidates.length,0);assert.equal(p.summary.accountState,'deleted');assert.equal(p.summary.displayName,'已注销');assert.equal(JSON.stringify(p).includes('secret'),false);
 assert.throws(()=>parseAgentKeyDouyin(response({user:{...user,user_deleted:false}}),douyinProfileRoute,{sec_user_id:'safe-id'}));
 assert.throws(()=>parseAgentKeyDouyin(response({status_code:400,comments:[]}),douyinCommentsRoute,{aweme_id:'987'}));
});
