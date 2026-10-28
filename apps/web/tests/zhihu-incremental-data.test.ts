import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectionConfig,collectionDraft,collectionFormOperation,collectionSeedNavigation,collectionPreviewBody,collectionPagingNote,collectionDetailOperations,collectionPageSummary} from '../app/features/admin/collection-subscription-data.ts';
import {platformQueryParameters,zhihuReadOnlyQueryNote} from '../app/features/admin/platform-query-data.ts';
import {isDetailQueryWork} from '../app/features/admin/detail-query-data.ts';
import {isSocialResearchResult,socialRecordRows,socialTimeRows,socialLinks} from '../app/features/admin/social-research-data.ts';
import {isResearchResult,researchRecordRows} from '../app/features/admin/research-platform-data.ts';
import {researchImportState,researchImportBody} from '../app/features/admin/research-import-data.ts';
import type {PlatformOperation} from '../app/features/admin/platform-types.ts';
const comments:PlatformOperation={id:'API_1792651427970',platform:'zhihu',label:'知乎文章评论',purpose:'研究',schedulableType:'list',collectionCapabilities:{sourceRequired:false,detailEnrichment:false},fields:[{name:'articleId',label:'文章 ID',type:'string',required:true},{name:'nextUrl',label:'下一页地址',type:'string',required:false}]};
test('comment query preserves explicit nextUrl but seed/draft/preview/save all use homepage articleId only',()=>{
 const values={articleId:'123',nextUrl:'https://www.zhihu.com/next'};
 assert.deepEqual(platformQueryParameters(comments,values),values);
 const seed=collectionSeedNavigation(comments.id,values).state.collectionSeed;assert.deepEqual(seed.values,{articleId:'123'});
 const draft={...collectionDraft(comments,null,{...seed,values}),name:'评论快照'};assert.deepEqual(draft.values,{articleId:'123'});assert.equal(draft.enabled,false);assert.equal(draft.pages,1);assert.equal(draft.details,0);assert.equal(draft.enrichDetails,false);
 assert.deepEqual(collectionFormOperation(comments).fields.map(f=>f.name),['articleId']);
 assert.deepEqual(collectionPreviewBody(comments,values).parameters,{articleId:'123'});
 const body=collectionConfig(comments,draft);assert.deepEqual(body.parameters,{articleId:'123'});assert.deepEqual(body.limits,{pages:1,items:100,details:0});assert.equal(body.sourceId,undefined);
 assert.match(collectionPagingNote(comments,values),/不沿用查询续页/);
 for(const patch of [{pages:2},{details:1},{enrichDetails:true},{detailOperationId:'API_1792651427872'},{detailPage:'1'},{autoDownloadVideo:true}])assert.throws(()=>collectionConfig(comments,{...draft,...patch}));
});
test('only article-scoped search has detail actions and configured detail choices',()=>{
 const search:PlatformOperation={...comments,id:'API_1789095347662',collectionCapabilities:{detailEnrichment:true,detailOperations:[{operationId:'API_1792651427872',label:'文章详情',fields:[],price:null}]}};
 for(const vertical of ['', 'answer','zvide','article']){assert.equal(collectionDetailOperations(search,{vertical}).length,vertical==='article'?1:0);assert.equal(isDetailQueryWork('zhihu_work',{platform:'zhihu',operationId:search.id,requestContext:{vertical}}),vertical==='article');}
 assert.equal(isDetailQueryWork('zhihu_work',{platform:'zhihu',operationId:'API_1792651427872'}),false);
});
test('comments preserve identity, seconds and avatar typo; account/hotspot never import',()=>{
 const data={platform:'zhihu',operationId:comments.id,record:{id:'123',content:'评论',publishTime:'1700000000',likeNum:'12',avatorUrl:'https://example.test/avatar',urlToken:'someone'},timeUnits:{publishTime:'seconds'}};
 assert.equal(isSocialResearchResult('social_comment',data),true);assert.equal(isSocialResearchResult('query_summary',{...data,role:'social-research-summary'}),true);
 assert.ok(socialRecordRows(data.record,data).some(([label])=>label==='评论 ID · id'));assert.match(socialTimeRows(data)[0]![0],/秒/);assert.equal(socialLinks(data)[0]!.field,'record.avatorUrl');
 for(const kind of ['zhihu_account','zhihu_hot_search']){const result={kind,data:{platform:'zhihu'},sourceId:null,articleId:null};assert.equal(isResearchResult(kind,result.data),true);assert.equal(researchImportState(result).canImport,false);}
 const result={kind:'zhihu_work',data:{platform:'zhihu',operationId:'API_1792651427872',url:'https://zhuanlan.zhihu.com/p/123',workNamespace:{vertical:'article'},record:{publishTime:1700000000}},sourceId:null,articleId:null};
 assert.deepEqual(researchImportState(result).fields,[]);assert.match(researchRecordRows(result.data)[0]![0],/秒/);
 assert.deepEqual(researchImportBody(result,{reason:'核实导入',target:'',sourceId:'',requestState:'idle',rows:[],values:{},evidence:'',ownedSource:{id:'owner',inherited:false}}),{reason:'核实导入',sourceId:'owner'});
 const summary=collectionPageSummary('query_summary',{platform:'zhihu',operationId:comments.id,snapshot:true,count:2,selectedCount:1,processedCount:1,selectedResearchCount:1,returnedPage:{nextUrl:'next'},nextParameters:null,stopReason:'item-limit'});assert.match(summary!.rows.find(([name])=>name==='本页已处理快照')![1],/1/);assert.match(summary!.next[0]![1],/不续页/);
});

test('only Zhihu account and dedicated hot queries show read-only hints without import or scheduling promises',()=>{
 for(const id of ['API_1792651512423','API_1792651658984']){
  assert.equal(zhihuReadOnlyQueryNote({platform:'zhihu',id}),'仅提供单次只读研究查询，不提供导入、绑定或独立定时入口。');
  assert.equal(zhihuReadOnlyQueryNote({platform:'douyin',id}),null);
 }
 for(const id of ['API_1792651427872','API_1789095347662','API_1792651427970','S28Q6HUD'])assert.equal(zhihuReadOnlyQueryNote({platform:'zhihu',id}),null);
});
