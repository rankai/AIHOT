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
test('normalized Douyin work preserves epoch seconds and stable identity with missing-author blockers',()=>{
 const aweme={AwemeId:'123',Desc:'标题',CreateTime:'1729400000000',Author:{Nickname:'作者',SecUid:'sec-456'},Video:{ItemID:'123',Title:'标题',CreateTime:'1729400000',Cover:{UrlList:['https://p3.douyinpic.com/test.jpeg']}}};
 const result=parseDouyinSearch({envelope:{provider:'TikHub',data:{code:200,data:{code:0,msg:'success',data:{hasMore:false,cursor:12,itemList:[{AwemeInfo:aweme}]}}}}},input).candidates[0];
 assert.equal(result.kind,'douyin_work');assert.equal(result.data.operationId,'OWIBYU1V');assert.deepEqual(result.data.identity,{secUserId:'sec-456'});assert.equal(result.data.publishedAt,new Date(1729400000*1000).toISOString());assert.equal(result.data.url,'https://www.douyin.com/video/123');assert.equal(result.data.record.coverUrl,'https://p3.douyinpic.com/test.jpeg');
 const unknown=parseDouyinSearch({envelope:{provider:'TikHub',data:{code:200,data:{code:0,msg:'success',data:{hasMore:false,cursor:12,itemList:[{AwemeInfo:{AwemeId:'123'}}]}}}}},input).candidates[0];
 assert.ok(unknown.data.importBlockers.includes('lossless_author_id_required'));assert.equal(unknown.data.publishedAt,null);
});
test('Douyin V4 parser rejects conflicting evidence and records unparseable time',()=>{
 const envelope=(AwemeInfo:Record<string,unknown>)=>parseDouyinSearch({envelope:{provider:'TikHub',data:{code:200,data:{code:0,msg:'success',data:{hasMore:false,cursor:12,itemList:[{AwemeInfo}]}}}}},input).candidates[0]!;
 assert.throws(()=>envelope({AwemeId:'123',Author:{SecUid:'sec-456'},Video:{ItemID:'456'}}),/work IDs disagree/);
 const secondsOnly=envelope({AwemeId:'123',Author:{SecUid:'sec-456'},Video:{ItemID:'123',CreateTime:'1729400000'}});
 assert.equal(secondsOnly.data.publishedAt,new Date(1729400000*1000).toISOString());
 const invalidTime=envelope({AwemeId:'123',Author:{SecUid:'sec-456'},Video:{ItemID:'123',CreateTime:'not-a-time'}});
 assert.equal(invalidTime.data.publishedAt,null);assert.ok(invalidTime.data.missingFields.includes('create_time'));
});
