import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolPrice } from '@aihot/contracts/credits';
import type { MemberPriceCatalog } from '@aihot/contracts/membership';
import { estimateToolPrice, pricingParameters, toolPriceText } from '../app/features/tools/price-estimate.ts';
const rule=(overrides:Partial<ToolPrice>={}):ToolPrice=>({id:'test-price',kind:'ai-search',provider:'redfox',model:'kimiK3',tier:'',parameterMatch:{},baseCredits:60,imageCredits:0,videoSecondCredits:0,referenceCredits:0,enabled:true,version:1,updatedAt:'2026-10-30T00:00:00Z',...overrides});
function catalog(...prices:ToolPrice[]):MemberPriceCatalog{return {version:'test',unavailable:[],offers:prices.map(price=>({kind:price.kind,provider:price.provider,model:price.model,tier:price.tier,label:'Synthetic',credits:9999,unit:'次',restriction:'',prices:prices.filter(row=>row.kind===price.kind && row.provider===price.provider && row.model===price.model && row.tier===price.tier)}))};}
test('engine and transcription prices come from current rules, never approved proposal values',()=>{
 const prices=catalog(rule(),rule({model:'kimiK25',baseCredits:30}),rule({kind:'transcriptions',model:'douyin',baseCredits:200}),rule({kind:'transcriptions',model:'videoUrl',baseCredits:30}));
 assert.deepEqual(estimateToolPrice(prices,{kind:'ai-search',input:{engine:'kimiK3'}}),{state:'priced',amount:60});
 assert.deepEqual(estimateToolPrice(prices,{kind:'ai-search',input:{engine:'kimiK25'}}),{state:'priced',amount:30});
 assert.deepEqual(estimateToolPrice(prices,{kind:'transcriptions',input:{platform:'douyin'}}),{state:'priced',amount:200});
 assert.deepEqual(estimateToolPrice(prices,{kind:'transcriptions',input:{platform:'videoUrl'}}),{state:'priced',amount:30});
 assert.deepEqual(estimateToolPrice(catalog(rule({baseCredits:73})),{kind:'ai-search',input:{engine:'kimiK3'}}),{state:'priced',amount:73});
});
test('most-specific typed rule wins; missing potentially more-specific parameters never guess a lower price',()=>{
 const prices=catalog(rule(),rule({id:'specific',parameterMatch:{'parameters.count':2},baseCredits:87}));
 assert.deepEqual(estimateToolPrice(prices,{kind:'ai-search',input:{engine:'kimiK3',parameters:{count:2}}}),{state:'priced',amount:87});
 assert.equal(estimateToolPrice(prices,{kind:'ai-search',input:{engine:'kimiK3'}}).state,'pending');
 assert.deepEqual(estimateToolPrice(prices,{kind:'ai-search',input:{engine:'kimiK3',parameters:{count:3}}}),{state:'priced',amount:60});
});
test('ambiguity, absent and disabled prices never show a fabricated zero',()=>{
 assert.equal(estimateToolPrice(catalog(rule(),rule({id:'duplicate'})),{kind:'ai-search',input:{engine:'kimiK3'}}).state,'ambiguous');
 assert.equal(estimateToolPrice(catalog(rule({enabled:false})),{kind:'ai-search',input:{engine:'kimiK3'}}).state,'unavailable');
 assert.equal(estimateToolPrice(catalog(rule()),{kind:'query',input:{operationId:'unknown'}}).state,'unavailable');
});
test('exact empty-string, zero and false conditions match the server scalar semantics',()=>{
 const prices=catalog(rule({parameterMatch:{'parameters.text':'','parameters.page':0,'parameters.audio':false}}));
 assert.deepEqual(estimateToolPrice(prices,{kind:'ai-search',input:{engine:'kimiK3',parameters:{text:'',page:0,audio:false}}}),{state:'priced',amount:60});
});
test('Wan totals use ceil input seconds and all configured components; missing duration shows a rate',()=>{
 const prices=catalog(rule({kind:'videos',provider:'aliyun',model:'wan2.2-animate-mix',tier:'wan-std',baseCredits:0,videoSecondCredits:100}),rule({kind:'videos',provider:'aliyun',model:'wan2.2-animate-mix',tier:'wan-pro',baseCredits:0,videoSecondCredits:150}));
 const selection={kind:'videos',input:{provider:'aliyun',mode:'wan-std'},videoSeconds:5.005};
 assert.deepEqual(estimateToolPrice(prices,selection),{state:'priced',amount:600});
 assert.deepEqual(estimateToolPrice(prices,{...selection,input:{provider:'aliyun',mode:'wan-pro'}}),{state:'priced',amount:900});
 assert.deepEqual(estimateToolPrice(prices,{...selection,videoSeconds:undefined}),{state:'rate',base:0,perSecond:100});
 const custom=catalog(rule({kind:'videos',provider:'aliyun',model:'wan2.2-animate-mix',tier:'wan-std',baseCredits:5,referenceCredits:3,videoSecondCredits:100}));
 assert.deepEqual(estimateToolPrice(custom,selection),{state:'priced',amount:611});
});
test('image counts and reference components match actual rules while unknown specs remain closed',()=>{
 const price=rule({kind:'images',model:'gptImage2',tier:'1k',baseCredits:280,imageCredits:20,referenceCredits:3});
 assert.deepEqual(estimateToolPrice(catalog(price),{kind:'images',input:{resolution:'1k',n:1,fileKeys:['a','b']}}),{state:'priced',amount:306});
 assert.equal(estimateToolPrice(catalog(price),{kind:'images',input:{resolution:'1k',n:2}}).state,'unavailable');
 assert.equal(estimateToolPrice(catalog({...price,model:'gptImage25'}),{kind:'images',input:{model:'gptImage25',resolution:'1k'}}).state,'unavailable');
});
test('Seedance known sample alone shows a fee; duration/audio/reference changes stay closed',()=>{
 const prices=catalog(rule({kind:'videos',model:'seedance',tier:'480p',baseCredits:3000}));
 const input={resolution:'480p',duration:8,generateAudio:true,imageWithRoles:['a','b','c'].map(fileKey=>({fileKey,role:'reference_image'}))};
 assert.deepEqual(estimateToolPrice(prices,{kind:'videos',input}),{state:'priced',amount:3000});
 for(const change of [{duration:7},{generateAudio:false},{imageWithRoles:input.imageWithRoles.slice(1)}]) assert.equal(estimateToolPrice(prices,{kind:'videos',input:{...input,...change}}).state,'unavailable');
});
test('recovery and local upload remain free; admin fee label never implies member charge',()=>{
 assert.deepEqual(estimateToolPrice(null,{kind:'images/query'}),{state:'priced',amount:0});
 assert.deepEqual(estimateToolPrice(null,{kind:'media-upload',free:true}),{state:'priced',amount:0});
 assert.equal(toolPriceText({state:'priced',amount:60},true),'会员价 60 积分；管理员不扣会员积分');
 assert.match(toolPriceText({state:'unavailable'},true),/暂未开放会员付费；管理员不扣会员积分/);
});
test('partial query values preserve declared numeric, array, boolean and text types',()=>{
 assert.deepEqual(pricingParameters([{name:'count',type:'integer'},{name:'ids',type:'integer-array'},{name:'audio',type:'boolean'},{name:'query',type:'string'}],{count:'2',ids:'1,2',audio:'false',query:'hello'}),{count:2,ids:[1,2],audio:false,query:'hello'});
});
