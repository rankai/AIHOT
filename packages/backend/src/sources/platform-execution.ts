import {selectedCollectionDetail,applyCollectedDetail} from "../providers/redfox/collection-detail.ts";
import {stableJson} from "../lib/ids.ts";
import {queryHotResearch,parseHotResearch} from "../providers/redfox/hot-research.ts";
import {HotResearchOperationId} from "../providers/redfox/hot-research-contract.ts";
import {queryXResearch,parseXResearch} from "../providers/redfox/x-research.ts";
import {importXSearchResult} from "../providers/redfox/import-x-search.ts";
import {queryQichezhijia,parseQichezhijia} from "../providers/redfox/qichezhijia.ts";
import {QichezhijiaOperationId} from "../providers/redfox/qichezhijia-contract.ts";
import {importQichezhijiaResult} from "../providers/redfox/import-qichezhijia.ts";
import {queryDongchedi,parseDongchedi} from "../providers/redfox/dongchedi.ts";
import {DongchediOperationId} from "../providers/redfox/dongchedi-contract.ts";
import {importDongchediResult} from "../providers/redfox/import-dongchedi.ts";
import {queryYiche,parseYiche} from "../providers/redfox/yiche.ts";
import {YicheOperationId} from "../providers/redfox/yiche-contract.ts";
import {importYicheResult} from "../providers/redfox/import-yiche.ts";
import {queryBaijiahao,parseBaijiahao} from "../providers/redfox/baijiahao.ts";
import {BaijiahaoOperationId} from "../providers/redfox/baijiahao-contract.ts";
import {importBaijiahaoResult} from "../providers/redfox/import-baijiahao.ts";
import {queryZhihu,parseZhihu} from "../providers/redfox/zhihu.ts";
import {ZhihuOperationId} from "../providers/redfox/zhihu-contract.ts";
import {importZhihuResult} from "../providers/redfox/import-zhihu.ts";
import { queryKuaishou,parseKuaishou } from "../providers/redfox/kuaishou.ts";
import { KuaishouOperationId } from "../providers/redfox/kuaishou-contract.ts";
import { queryShipinhao,parseShipinhao } from "../providers/redfox/shipinhao.ts";
import { ShipinhaoOperationId } from "../providers/redfox/shipinhao-contract.ts";
import { importToutiaoResult } from "../providers/redfox/import-toutiao.ts";
import { queryToutiao,parseToutiao } from "../providers/redfox/toutiao.ts";
import { ToutiaoOperationId } from "../providers/redfox/toutiao-contract.ts";
import { importInstagramResult } from "../providers/redfox/import-instagram.ts";
import { queryInstagram,parseInstagram } from "../providers/redfox/instagram.ts";
import { InstagramOperationId } from "../providers/redfox/instagram-contract.ts";
import { importYoutubeResult } from "../providers/redfox/import-youtube.ts";
import { queryYoutube,parseYoutube } from "../providers/redfox/youtube.ts";
import { YoutubeOperationId } from "../providers/redfox/youtube-contract.ts";
import { importBilibiliResult } from "../providers/redfox/import-bilibili.ts";
import { queryBilibili,parseBilibili } from "../providers/redfox/bilibili.ts";
import { BilibiliOperationId } from "../providers/redfox/bilibili-contract.ts";
import { importTiktokResult } from "../providers/redfox/import-tiktok.ts";
import { queryTiktok,parseTiktok } from "../providers/redfox/tiktok.ts";
import { TiktokOperationId } from "../providers/redfox/tiktok-contract.ts";
import { importWechatResult } from "../providers/redfox/import-wechat.ts";
import { queryWechat,parseWechat } from "../providers/redfox/wechat.ts";
import { WechatOperationId } from "../providers/redfox/wechat-contract.ts";
import { parseRedfoxJson } from "../providers/redfox/client.ts";
import { sql,type Tx } from "../db.ts";
import { queryWeibo,parseWeibo } from "../providers/redfox/weibo.ts";
import { WeiboOperationId } from "../providers/redfox/weibo-contract.ts";
import { importWeiboResult } from "../providers/redfox/import-weibo.ts";
import { queryDouyin,parseDouyin } from "../providers/redfox/douyin.ts";
import { DouyinOperationId } from "../providers/redfox/douyin-contract.ts";
import { queryXiaohongshu,parseXiaohongshu } from "../providers/redfox/xiaohongshu-parser.ts";
import { XiaohongshuOperationId } from "../providers/redfox/xiaohongshu-contract.ts";
import { importDouyinResult } from "../providers/redfox/import-douyin.ts";
import { importXiaohongshuResult } from "../providers/redfox/import-xiaohongshu.ts";
import { collectionOperationIds,collectionContract } from "./platform-subscriptions.ts";
import { UnsupportedReplacement } from "./x-replacement.ts";
import { advanceRun,requireExecution,receiptOptions,retainCurrentReceipt,saveResult,StaleOperationError,type Execution,type RunRow,type OperationProgress } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
interface CollectionResult {kind:string;itemKey:string;data:Record<string,unknown>}
interface Progress extends OperationProgress {detailSourceResultId?:number;detailParameters?:Record<string,unknown>;page?:number;pagesRead?:number;itemsRead?:number;detailsRead?:number;selectedCount?:number;index?:number;pageReceipt?:number;pageSize?:number;workCount?:number;currentParameters?:Record<string,unknown>;nextParameters?:Record<string,unknown>|null;}

function isWork(result:CollectionResult){return ["weibo_work","douyin_work","xiaohongshu_work","wechat_work","tiktok_work","bilibili_work","youtube_work","instagram_work","toutiao_work","shipinhao_work","kuaishou_work","qichezhijia_work","dongchedi_work","yiche_work","baijiahao_work","zhihu_work","x_research_work"].includes(result.kind)&&result.data.role!=="provider_recommendation";}
function nextPageParameters(operation:string,parameters:Record<string,unknown>,facts:Record<string,unknown>,raw?:unknown):{parameters:Record<string,string|number>|null;reason:string|null;token:boolean}{
  if(operation==="5K5EG87P"){
    const next=facts.nextCursor;
    if(next===undefined||next===null||next==="")return {parameters:null,reason:next===undefined?"missing-next-cursor":next===null?"no-next-cursor":"empty-next-cursor",token:true};
    if(typeof next!=="string")throw new Error("Invalid received X cursor");
    return next===parameters.cursor?{parameters:null,reason:"repeated-next-token-needs-review",token:true}:{parameters:{cursor:next},reason:null,token:true};
  }
  const tokenField=operation==="GC5SC5HS"?"continuationToken":operation==="GM0TISWI"?"paginationToken":operation==="API_1790149158205"?"cursor":operation==="API_1790581450500"?"max_cursor":null;
  if(tokenField){
    const tiktok=tokenField==="cursor"||tokenField==="max_cursor",received=facts[tiktok?"nextCursor":tokenField];
    if(tiktok&&facts.hasMore===0)return {parameters:null,reason:"upstream-no-more",token:true};
    if(received===undefined||received===null||received==="")return {parameters:null,reason:tiktok&&facts.hasMore===1?"missing-next-token-needs-review":"no-next-token",token:true};
    const value=String(received);
    if(value===String(parameters[tokenField]??""))return {parameters:null,reason:"repeated-next-token-needs-review",token:true};
    return {parameters:{[tokenField]:value},reason:null,token:true};
  }
  if(operation==="CI7VW144")return {parameters:{offset:String(BigInt(String(parameters.offset))+10n),page:String(BigInt(String(parameters.page))+1n)},reason:null,token:false};
  if(operation==="W86F8SSK"&&facts.hasMore==="0")return {parameters:null,reason:"upstream-no-more",token:false};
  if(["W86F8SSK","API_1789095347662","API_1789097000858"].includes(operation)){const field=operation==="API_1789097000858"?"pn":"offset";return {parameters:{[field]:String(BigInt(String(parameters[field]))+(field==="pn"?10n:20n))},reason:null,token:false};}
  if(operation==="YGYYT0G0"){
    const list=(raw as {workList?:Record<string,unknown>[]} | null)?.workList,last=list?.at(-1)?.publishTime;
    if(last===undefined||last===null||last==="")return {parameters:null,reason:"missing-next-timestamp-needs-review",token:true};
    const timestamp=String(last);return timestamp===String(parameters.timestamp??"")?{parameters:null,reason:"repeated-next-token-needs-review",token:true}:{parameters:{timestamp},reason:null,token:true};
  }
  const offset20=["QEQLCKD6","774OBKK0","384C6W6B","XN3ULENA","PW97QFBS","FVQ8D4W5"].includes(operation);
  if(offset20&&(facts.hasMore===0||facts.hasMore===false))return {parameters:null,reason:"upstream-no-more",token:false};
  if(operation==="28CFGF5I")return {parameters:{offset:String(BigInt(String(parameters.offset))+1n)},reason:null,token:false};
  const pageString=operation==="TXQPVGJG"||operation==="LEN9QXR3";
  const pageNumber=["VPA67I98","E7G00COY","OVUTOTCV","27DQ6SF9","ZWR31P2A","YIGCY5US"].includes(operation);
  const pageNum=["QSL2ZSXM","OWIBYU1V","I8P3HTVH","047JJ3UA","IE0887SO"].includes(operation)||(operation==="3X8FGEEM"&&!parameters.keyword);
  if(!offset20&&!pageString&&!pageNumber&&!pageNum)return {parameters:null,reason:["PXZXY8KQ","R1IGR09H"].includes(operation)?"pagination-mapping-unverified":"single-request",token:false};
  const field=offset20?"offset":pageString||pageNumber?"page":"pageNum",value=Number(parameters[field]??(offset20?0:1))+(offset20?20:1);
  return Number.isSafeInteger(value)?{parameters:{[field]:pageString?String(value):value},reason:null,token:false}:{parameters:null,reason:"page-number-limit",token:false};
}
function pageFacts(data:unknown):Record<string,unknown>{
  if(!data||typeof data!=="object"||Array.isArray(data))return {};
  const raw=data as Record<string,unknown>,out:Record<string,unknown>={};
  for(const field of ["total","page","pageNum","pageSize","pages","offset","cursor","hasMore","hasNext","nextCursor","nextPage","continuationToken","paginationToken"])if(field in raw)out[field]=raw[field];
  return out;
}
async function advance(tx:Tx,e:Execution,run:RunRow,p:Progress,step:string|null){
  if(!step){const sub=run.input.members[0]!;await tx`UPDATE collection_subscriptions SET progress=${tx.json({lastPage:p.page,items:p.itemsRead??0,pages:p.pagesRead??0,details:p.detailsRead??0,completedAt:new Date().toISOString()})},next_run_at=now()+interval_minutes*interval '1 minute',updated_at=now() WHERE id=${sub.subscriptionId} AND active_run_id=${run.id}`;}
  await advanceRun(tx,e,step?{stepKey:step,progress:p}:null);if(step)await queueOperationStep(tx,run.id);
}
async function pageResult(tx:Tx,e:Execution,run:RunRow,result:CollectionResult,receiptId:number){
  const p=run.progress as Progress;
  const [page]=await tx`SELECT id FROM operation_results WHERE run_id=${run.id} AND receipt_id=${p.pageReceipt!}
    AND kind='query_summary' AND item_key=${`page:${p.page}`} AND data->>'operationId'=${String(run.input.operationId)}`;
  if(!page)throw new Error("Current source-page discovery result is missing");
  const id=await saveResult(tx,e,{...result,receiptId});
  await tx`UPDATE operation_results SET provenance=provenance||${tx.json({sourcePageResultId:Number(page.id)})} WHERE id=${id}`;
  return id;
}
async function imported(tx:Tx,e:Execution,run:RunRow,result:CollectionResult,receiptId:number,detailSourceResultId?:number){
  const id=await pageResult(tx,e,run,result,receiptId);
  if(detailSourceResultId!==undefined)await tx`UPDATE operation_results SET provenance=provenance||${tx.json({detailSourceResultId})} WHERE id=${id}`;
  if(!["weibo_work","douyin_work","xiaohongshu_work","wechat_work","tiktok_work","bilibili_work","youtube_work","instagram_work","toutiao_work","shipinhao_work","kuaishou_work","qichezhijia_work","dongchedi_work","yiche_work","baijiahao_work","zhihu_work","x_research_work"].includes(result.kind)||result.data.role==="provider_recommendation")return id;
  try{await tx.savepoint(async inner=>{
    const args=[id,{reason:"Scheduled platform collection"},"schedule",`collection:${e.runId}:${e.stepVersion}:${id}`,inner] as const;
    if(result.kind==="weibo_work")await importWeiboResult(...args);
    else if(result.kind==="douyin_work")await importDouyinResult(...args);
    else if(result.kind==="xiaohongshu_work")await importXiaohongshuResult(...args);
    else if(result.kind==="wechat_work")await importWechatResult(...args);
    else if(result.kind==="tiktok_work")await importTiktokResult(...args);
    else if(result.kind==="bilibili_work")await importBilibiliResult(...args);
    else if(result.kind==="youtube_work")await importYoutubeResult(...args);
    else if(result.kind==="instagram_work")await importInstagramResult(...args);
    else if(result.kind==="toutiao_work")await importToutiaoResult(...args);
    else if(result.kind==="qichezhijia_work")await importQichezhijiaResult(...args);
    else if(result.kind==="dongchedi_work")await importDongchediResult(...args);
    else if(result.kind==="yiche_work")await importYicheResult(...args);
    else if(result.kind==="baijiahao_work")await importBaijiahaoResult(...args);
    else if(result.kind==="x_research_work")await importXSearchResult(...args);
    else if(result.kind==="zhihu_work")await importZhihuResult(...args);
    else throw new UnsupportedReplacement("缺少稳定作者和已确认原文；请在结果中逐条人工确认隔离来源与原文");
  });}
  catch(error){if(!(error instanceof UnsupportedReplacement)&&!(error instanceof StaleOperationError))throw error;await tx`UPDATE operation_results SET data=data||${tx.json({pendingReason:error.message})} WHERE id=${id}`;}
  return id;
}
const step=(run:RunRow,name:string)=>`redfox.${run.input.platform==="weibo"?"weibo":"platform"}.${name}`;
async function nextItem(tx:Tx,e:Execution,run:RunRow,p:Progress){
  await tx`UPDATE operation_results SET data=data||${tx.json({processedCount:(p.index??0)+1})}
    WHERE run_id=${run.id} AND receipt_id=${p.pageReceipt!} AND kind='query_summary'`;
  const next={...p,detailSourceResultId:undefined,detailParameters:undefined,index:(p.index??0)+1,itemsRead:(p.itemsRead??0)+1};
  if(next.index<(p.selectedCount??0)){await advance(tx,e,run,next,step(run,"item"));return;}
  const more=Number.isSafeInteger((p.page??1)+1) && (p.workCount??p.pageSize??0)>0 && (p.pagesRead??0)<run.limits.pages! && next.itemsRead<run.limits.items! && (run.input.platform==="weibo" || p.nextParameters!=null);
  await advance(tx,e,run,{...next,selectedCount:0,index:0,pageReceipt:undefined,retainedReceiptIds:[],page:(p.page??1)+1},more?step(run,"page"):null);
}
export async function executePlatformCollection(e:Execution,run:RunRow){
  const p=run.progress as Progress;
  const operation=run.input.operationId as typeof collectionOperationIds[number];
  if(!collectionOperationIds.includes(operation)||collectionContract(operation).platform!==run.input.platform)throw new Error("Unsupported collection operation");
  const parameters={...(run.input.parameters as Record<string,unknown>),...(p.nextParameters??{})};
  const page=p.page??(run.input.platform==="weibo"?Number(parameters.page??1):1);
  if(run.input.platform==="weibo"&&operation==="TXQPVGJG")parameters.page=String(page);
  if(run.step_key===step(run,"page")){
    const options=receiptOptions(e),window=String(run.input.window);
    const response=await queryPage(run,parameters,window,options);
    const pageResults=response.results.filter(r=>r.kind!=="query_summary");
    await sql.begin(async tx=>{
      await requireExecution(tx,e);
      const works=pageResults.filter(isWork);
      const selected=pageResults.slice(0,Math.max(0,run.limits.items!-(p.itemsRead??0)));
      const items=selected.filter(isWork),selectedCount=items.length;
      const research=pageResults.filter(r=>!isWork(r)),selectedResearch=selected.filter(r=>!isWork(r));
      const returnedPage=pageFacts(response.data);
      const paging=nextPageParameters(operation,parameters,returnedPage,response.data);
      if(paging.token&&paging.parameters){
        const [seen]=await tx`SELECT id FROM operation_results WHERE run_id=${run.id} AND kind='query_summary' AND data->'nextParameters'=${tx.json(paging.parameters)} LIMIT 1`;
        if(seen){paging.parameters=null;paging.reason="repeated-next-token-needs-review";}
      }
      const nextParameters=paging.parameters;
      const hotSnapshot=run.input.platform==="hot-research";
      const stopReason=hotSnapshot?(research.length>selectedResearch.length?"item-limit":"single-request"):!works.length?"empty-work-page":works.length>selectedCount?"item-limit":(p.pagesRead??0)+1>=run.limits.pages!?"page-limit":(p.itemsRead??0)+selectedCount+selectedResearch.length>=run.limits.items!?"item-limit":!nextParameters?paging.reason:null;
      const summaryId=await saveResult(tx,e,{itemKey:`page:${page}`,kind:"query_summary",data:{platform:run.input.platform,operationId:operation,page,count:pageResults.length,workCount:works.length,selectedCount:items.length,processedCount:0,returnedPage,nextParameters,stopReason,unprocessedDueToLimit:works.length-items.length,truncated:works.length>items.length,...(hotSnapshot?{queryWindow:{startDate:parameters.startDate,endDate:parameters.endDate,timeZone:"Asia/Shanghai"}}:{})},receiptId:response.receiptId});
      const next={...p,page,pagesRead:(p.pagesRead??0)+1,pageSize:pageResults.length,workCount:works.length,selectedCount:items.length,index:0,pageReceipt:response.receiptId,currentParameters:parameters,nextParameters,itemsRead:(p.itemsRead??0)+selectedResearch.length};
      await tx`UPDATE operation_results SET data=data||${tx.json({truncated:works.length>items.length||research.length>selectedResearch.length,researchCount:research.length,selectedResearchCount:selectedResearch.length,unprocessedResearchDueToLimit:research.length-selectedResearch.length,...(operation==="UAQ90A1F"||hotSnapshot?{selectedCount:selectedResearch.length,processedCount:selectedResearch.length,unprocessedDueToLimit:research.length-selectedResearch.length,truncated:research.length>selectedResearch.length}: {})})} WHERE id=${summaryId}`;
      for(const result of selectedResearch){
        const id=await saveResult(tx,e,{...result,receiptId:response.receiptId});
        await tx`UPDATE operation_results SET provenance=provenance||${tx.json({sourcePageResultId:summaryId})} WHERE id=${id}`;
      }
      if(operation==="UAQ90A1F"){await advance(tx,e,run,next,null);return;}
      if(!items.length){await advance(tx,e,run,next,null);return;}
      await retainCurrentReceipt(tx,e,next);
      await advance(tx,e,run,{...next,retainedReceiptIds:[response.receiptId]},step(run,"item"));
    });return;
  }
  if(!p.pageReceipt || !p.retainedReceiptIds?.includes(p.pageReceipt) || p.selectedCount===undefined || (p.index??0)>=p.selectedCount)throw new Error("Retained source page context is missing");
  const [receipt]=await sql`SELECT response FROM receipts WHERE id=${p.pageReceipt} AND status IN ('received','completed')`;
  if(receipt?.response?.status!==200 || typeof receipt.response.body!=="string")throw new Error("Retained source page response is missing or expired");
  const envelope=parseRedfoxJson(receipt.response.body) as {code?:unknown;data?:unknown}|null;
  if(!envelope||(envelope.code!==(operation==="W86F8SSK"?200:2000)&&!(operation==="3X8FGEEM"&&envelope.code===undefined)))throw new Error("Retained source page response is invalid");
  const data=operation==="3X8FGEEM"&&envelope.code===undefined?envelope:envelope.data;
  const rows=parsePage(run,data,p.currentParameters??run.input.parameters as Record<string,unknown>).filter(r=>r.kind!=="query_summary");
  if(rows.length!==p.pageSize)throw new Error("Retained source page size changed");
  const item=rows.filter(isWork)[p.index??0];if(!item)throw new Error("Retained source page item is missing");
  if(run.step_key===step(run,"item")){
    await sql.begin(async tx=>{await requireExecution(tx,e);
      if(run.input.enrichDetails&&run.input.detailOperationId){
        const id=await pageResult(tx,e,run,item,p.pageReceipt!);
        try{
          if((p.detailsRead??0)>=run.limits.details!)throw new UnsupportedReplacement("Detail enrichment limit reached");
          const selected=await selectedCollectionDetail(tx,id,String(run.input.detailOperationId),run.input.detailPage);
          await advance(tx,e,run,{...p,detailSourceResultId:id,detailParameters:selected.parameters},"redfox.platform.detail");return;
        }catch(error){if(!(error instanceof UnsupportedReplacement))throw error;await tx`UPDATE operation_results SET data=data||${tx.json({pendingReason:error.message})} WHERE id=${id}`;}
        await nextItem(tx,e,run,p);return;
      }
      if(run.input.enrichDetails && item.kind==="weibo_work" && item.data.opusId && (p.detailsRead??0)<run.limits.details!){await advance(tx,e,run,p,"redfox.weibo.detail");return;}
      if(run.input.enrichDetails && (p.detailsRead??0)>=run.limits.details!){await pageResult(tx,e,run,{...item,data:{...item.data,pendingReason:"Detail enrichment limit reached",truncated:true}},p.pageReceipt!);}
      else await imported(tx,e,run,item,p.pageReceipt!);
      await nextItem(tx,e,run,p);
    });return;
  }
  if(run.step_key==="redfox.platform.detail"){
    if(!p.detailSourceResultId||!p.detailParameters||!run.input.detailOperationId)throw new Error("Missing frozen detail source");
    const target=String(run.input.detailOperationId);
    const selected=await sql.begin(async tx=>{await requireExecution(tx,e);const selected=await selectedCollectionDetail(tx,p.detailSourceResultId!,target,run.input.detailPage);if(stableJson(selected.parameters)!==stableJson(p.detailParameters))throw new Error("Frozen detail parameters changed");return selected;});
    const response=await queryPage({...run,input:{...run.input,operationId:target}},selected.parameters,String(run.input.window),receiptOptions(e));
    const detail=response.results.find(r=>r.kind===`${run.input.platform}_work`);if(!detail)throw new Error("Detail has no received work result");
    applyCollectedDetail(target,selected.parameters,detail,selected.origin);
    await sql.begin(async tx=>{
      await requireExecution(tx,e);
      const id=await imported(tx,e,run,detail,response.receiptId,p.detailSourceResultId);
      const [saved]=await tx`SELECT article_id,source_id FROM operation_results WHERE id=${id}`;
      if(saved?.article_id)await tx`UPDATE operation_results SET article_id=${saved.article_id},source_id=${saved.source_id},data=data-'pendingReason',provenance=provenance||${tx.json({detailResultId:id})} WHERE id=${p.detailSourceResultId!} AND run_id=${run.id} AND (article_id IS NULL OR article_id=${saved.article_id})`;
      await nextItem(tx,e,run,{...p,detailsRead:(p.detailsRead??0)+1});
    });return;
  }
  if(run.step_key!=="redfox.weibo.detail")throw new Error("Unsupported Weibo collection step");
  const response=await queryWeibo("API_1789098514899",{opusId:item.data.opusId},String(run.input.window),"collect",receiptOptions(e));
  const detail=response.results[0]!;
  if(item.data.uid && detail.data.uid!==item.data.uid)throw new Error("Detail author differs from the retained source item");
  await sql.begin(async tx=>{await requireExecution(tx,e);await imported(tx,e,run,detail,response.receiptId);await nextItem(tx,e,run,{...p,detailsRead:(p.detailsRead??0)+1});});
}

async function queryPage(run:RunRow,parameters:Record<string,unknown>,window:string,options:ReturnType<typeof receiptOptions>){
  const op=run.input.operationId;
  switch(run.input.platform){
    case "weibo":return queryWeibo(WeiboOperationId.parse(op),parameters,window,"collect",options);
    case "douyin":return queryDouyin(DouyinOperationId.parse(op),parameters,window,options,"collect");
    case "xiaohongshu":return queryXiaohongshu(XiaohongshuOperationId.parse(op),parameters,window,options,"collect");
    case "wechat":return queryWechat(WechatOperationId.parse(op),parameters,window,options,"collect");
    case "tiktok":return queryTiktok(TiktokOperationId.parse(op),parameters,window,options,"collect");
    case "bilibili":return queryBilibili(BilibiliOperationId.parse(op),parameters,window,options,"collect");
    case "youtube":return queryYoutube(YoutubeOperationId.parse(op),parameters,window,options,undefined,"collect");
    case "instagram":return queryInstagram(InstagramOperationId.parse(op),parameters,window,options,undefined,"collect");
    case "toutiao":return queryToutiao(ToutiaoOperationId.parse(op),parameters,window,options,undefined,"collect");
    case "shipinhao":return queryShipinhao(ShipinhaoOperationId.parse(op),parameters,window,options,undefined,"collect");
    case "kuaishou":return queryKuaishou(KuaishouOperationId.parse(op),parameters,window,options,undefined,"collect");
    case "qichezhijia":return queryQichezhijia(QichezhijiaOperationId.parse(op),parameters,window,options,"collect");
    case "dongchedi":return queryDongchedi(DongchediOperationId.parse(op),parameters,window,options,"collect");
    case "yiche":return queryYiche(YicheOperationId.parse(op),parameters,window,options,"collect");
    case "baijiahao":return queryBaijiahao(BaijiahaoOperationId.parse(op),parameters,window,options,"collect");
    case "zhihu":return queryZhihu(ZhihuOperationId.parse(op),parameters,window,options,"collect");
    case "x-research":return queryXResearch("5K5EG87P",parameters,window,options,"collect");
    case "hot-research":return queryHotResearch(HotResearchOperationId.parse(op),parameters,window,options,"collect");
    default:throw new Error("Unsupported collection platform");
  }
}
function parsePage(run:RunRow,data:unknown,parameters:Record<string,unknown>):CollectionResult[]{
  const op=run.input.operationId;
  switch(run.input.platform){
    case "weibo":return parseWeibo(WeiboOperationId.parse(op),data,parameters);
    case "douyin":return parseDouyin(DouyinOperationId.parse(op),data,parameters);
    case "xiaohongshu":return parseXiaohongshu(XiaohongshuOperationId.parse(op),data,parameters);
    case "wechat":return parseWechat(WechatOperationId.parse(op),data,parameters);
    case "tiktok":return parseTiktok(TiktokOperationId.parse(op),data,parameters);
    case "bilibili":return parseBilibili(BilibiliOperationId.parse(op),data,parameters);
    case "youtube":return parseYoutube(YoutubeOperationId.parse(op),data,parameters);
    case "instagram":return parseInstagram(InstagramOperationId.parse(op),data,parameters);
    case "toutiao":return parseToutiao(ToutiaoOperationId.parse(op),data,parameters);
    case "shipinhao":return parseShipinhao(ShipinhaoOperationId.parse(op),data,parameters);
    case "kuaishou":return parseKuaishou(KuaishouOperationId.parse(op),data,parameters);
    case "qichezhijia":return parseQichezhijia(QichezhijiaOperationId.parse(op),data,parameters);
    case "dongchedi":return parseDongchedi(DongchediOperationId.parse(op),data,parameters);
    case "yiche":return parseYiche(YicheOperationId.parse(op),data,parameters);
    case "baijiahao":return parseBaijiahao(BaijiahaoOperationId.parse(op),data,parameters);
    case "zhihu":return parseZhihu(ZhihuOperationId.parse(op),data,parameters);
    case "x-research":return parseXResearch("5K5EG87P",data,parameters);
    case "hot-research":return parseHotResearch(HotResearchOperationId.parse(op),data);
    default:throw new Error("Unsupported collection platform");
  }
}
