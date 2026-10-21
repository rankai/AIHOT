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
 const pagination={has_more:1,next_page:7,offset:37,search_id:'session',backtrace:'trace'};
 const next=nextDouyinPage(input,pagination);
 assert.deepEqual(next.parameters,{keyword:'测试',page:7,offset:37,search_id:'session',backtrace:'trace'});
 assert.equal(nextDouyinPage(next.parameters!,pagination).stopReason,'repeated-next-token-needs-review');
 for(const key of ['next_page','offset','search_id','backtrace']){const missing={...pagination};delete missing[key as keyof typeof missing];assert.equal(nextDouyinPage(input,missing).stopReason,'missing-next-token-needs-review');}
 assert.equal(nextDouyinPage(input,{has_more:0}).stopReason,'upstream-no-more');
 for(const value of [undefined,{}, {has_more:null},{has_more:'false'},{has_more:2}])assert.equal(nextDouyinPage(input,value).stopReason,'invalid-pagination-needs-review');
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
test('normalized Douyin work preserves epoch seconds and stable identity with missing-author blockers',()=>{
 const result=parseDouyinSearch({envelope:{provider:'TikHub',data:{data:{items:[{aweme_id:'123',desc:'标题',create_time:1729400000,author:{uid:'456'},share_url:'https://www.douyin.com/video/123'}]}}}},input).candidates[0];
 assert.equal(result.kind,'douyin_work');assert.equal(result.data.operationId,'OWIBYU1V');assert.deepEqual(result.data.identity,{uid:'456'});assert.equal(result.data.publishedAt,new Date(1729400000*1000).toISOString());assert.equal(result.data.record.create_time,1729400000);
 const unknown=parseDouyinSearch({envelope:{provider:'TikHub',data:{data:{items:[{aweme_id:'123'}]}}}},input).candidates[0];
 assert.ok(unknown.data.importBlockers.includes('lossless_author_id_required'));assert.equal(unknown.data.publishedAt,null);
});
