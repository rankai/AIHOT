import type { ToolAuthorization } from "../../users/credits.ts";
import {lockOriginResult} from "../../operations/result-retention.ts";
import { accountDetailOrigin, applyAccountDetailOrigin, AccountDetailTargets } from "./account-detail-origin.ts";
import {weiboCarDetailOrigin,applyWeiboCarDetailOrigin,WeiboCarDetailTargets} from "./weibo-car-detail-origin.ts";
import {workDetailOrigin,applyWorkDetailOrigin,WorkDetailTargets} from "./work-detail-origin.ts";
import { mediaToolOperations, MediaToolOperationId } from "./media-tools-contract.ts";
import { queryMediaTool } from "./media-tools.ts";
import { socialResearchOperations,SocialResearchOperationId } from "./social-research-contract.ts";
import { querySocialResearch } from "./social-research.ts";
import { redfoxAccountOperations,RedfoxAccountOperationId } from "./redfox-account-contract.ts";
import { queryRedfoxAccount } from "./redfox-account.ts";
import { hotResearchOperations,HotResearchOperationId } from "./hot-research-contract.ts";
import { queryHotResearch } from "./hot-research.ts";
import { xResearchOperations,XResearchOperationId } from "./x-research-contract.ts";
import { queryXResearch } from "./x-research.ts";
import {manualWorkOrigin} from "./manual-work-origin.ts";
import { QichezhijiaOperationId,qichezhijiaOperations } from "./qichezhijia-contract.ts";
import { queryQichezhijia } from "./qichezhijia.ts";
import { DongchediOperationId,dongchediOperations } from "./dongchedi-contract.ts";
import { queryDongchedi } from "./dongchedi.ts";
import { YicheOperationId,yicheOperations } from "./yiche-contract.ts";
import { queryYiche } from "./yiche.ts";
import { BaijiahaoOperationId,baijiahaoOperations } from "./baijiahao-contract.ts";
import { queryBaijiahao } from "./baijiahao.ts";
import { ZhihuOperationId,zhihuOperations } from "./zhihu-contract.ts";
import { queryZhihu } from "./zhihu.ts";
import { toutiaoOrigin } from "./toutiao-origin.ts";
import { ToutiaoOperationId,toutiaoOperations } from "./toutiao-contract.ts";
import { queryToutiao } from "./toutiao.ts";
import { KuaishouOperationId,kuaishouOperations } from "./kuaishou-contract.ts";
import { queryKuaishou } from "./kuaishou.ts";
import { ShipinhaoOperationId,shipinhaoOperations } from "./shipinhao-contract.ts";
import { queryShipinhao } from "./shipinhao.ts";
import { instagramOrigin } from "./instagram-origin.ts";
import { InstagramOperationId,instagramOperations } from "./instagram-contract.ts";
import { queryInstagram } from "./instagram.ts";
import { youtubeOrigin } from "./youtube-origin.ts";
import { YoutubeOperationId,youtubeOperations } from "./youtube-contract.ts";
import { queryYoutube } from "./youtube.ts";
import { BilibiliOperationId,bilibiliOperations } from "./bilibili-contract.ts";
import { queryBilibili } from "./bilibili.ts";
import { TiktokOperationId,tiktokOperations } from "./tiktok-contract.ts";
import { queryTiktok } from "./tiktok.ts";
import { XiaohongshuOperationId,xiaohongshuOperations } from "./xiaohongshu-contract.ts";
import { queryXiaohongshu } from "./xiaohongshu-parser.ts";
import { DouyinOperationId,douyinOperations } from "./douyin-contract.ts";
import { queryDouyin } from "./douyin.ts";
import { WechatOperationId,wechatOperations } from "./wechat-contract.ts";
import { queryWechat } from "./wechat.ts";
import { z } from "zod";
import { sql } from "../../db.ts";
import { stableJson } from "../../lib/ids.ts";
import { createRun, lockMemberAdmission, StaleOperationError, requireExecution, receiptOptions, saveResult, advanceRun, type RunRow, type Execution } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import { WeiboOperationId,weiboOperations } from "./weibo-contract.ts";
import { queryWeibo } from "./weibo.ts";
import type { PaidRequestOptions } from "../receipts.ts";
function selectQuery(id:unknown,origin?:unknown){
 const media=MediaToolOperationId.safeParse(id);
 if(media.success)return {platform:mediaToolOperations[media.data].platform,schema:mediaToolOperations[media.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryMediaTool(media.data,p,w,o)};
 const social=SocialResearchOperationId.safeParse(id);
 if(social.success)return {platform:socialResearchOperations[social.data].platform,schema:socialResearchOperations[social.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>querySocialResearch(social.data,p,w,o)};
 const redfoxAccount=RedfoxAccountOperationId.safeParse(id);
 if(redfoxAccount.success)return {platform:"redfox-account",schema:redfoxAccountOperations[redfoxAccount.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryRedfoxAccount(redfoxAccount.data,p,w,o)};
 const hotResearch=HotResearchOperationId.safeParse(id);
 if(hotResearch.success)return {platform:"hot-research",schema:hotResearchOperations[hotResearch.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryHotResearch(hotResearch.data,p,w,o)};
 const xResearch=XResearchOperationId.safeParse(id);
 if(xResearch.success)return {platform:"x-research",schema:xResearchOperations[xResearch.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryXResearch(xResearch.data,p,w,o)};
  const qichezhijia=QichezhijiaOperationId.safeParse(id);
  if(qichezhijia.success)return {platform:"qichezhijia",schema:qichezhijiaOperations[qichezhijia.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryQichezhijia(qichezhijia.data,p,w,o)};
  const dongchedi=DongchediOperationId.safeParse(id);
  if(dongchedi.success)return {platform:"dongchedi",schema:dongchediOperations[dongchedi.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryDongchedi(dongchedi.data,p,w,o)};
  const yiche=YicheOperationId.safeParse(id);
  if(yiche.success)return {platform:"yiche",schema:yicheOperations[yiche.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryYiche(yiche.data,p,w,o)};
  const baijiahao=BaijiahaoOperationId.safeParse(id);
  if(baijiahao.success)return {platform:"baijiahao",schema:baijiahaoOperations[baijiahao.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryBaijiahao(baijiahao.data,p,w,o)};
  const zhihu=ZhihuOperationId.safeParse(id);
  if(zhihu.success)return {platform:"zhihu",schema:zhihuOperations[zhihu.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryZhihu(zhihu.data,p,w,o)};

  const ttNews=ToutiaoOperationId.safeParse(id);
  if(ttNews.success)return {platform:"toutiao",schema:toutiaoOperations[ttNews.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryToutiao(ttNews.data,p,w,o,origin)};
  const ks=KuaishouOperationId.safeParse(id);
  if(ks.success)return {platform:"kuaishou",schema:kuaishouOperations[ks.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryKuaishou(ks.data,p,w,o,origin)};
  const sph=ShipinhaoOperationId.safeParse(id);
  if(sph.success)return {platform:"shipinhao",schema:shipinhaoOperations[sph.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryShipinhao(sph.data,p,w,o,origin)};
  const ig=InstagramOperationId.safeParse(id);
  if(ig.success)return {platform:"instagram",schema:instagramOperations[ig.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryInstagram(ig.data,p,w,o,origin)};
  const yt=YoutubeOperationId.safeParse(id);
  if(yt.success)return {platform:"youtube",schema:youtubeOperations[yt.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryYoutube(yt.data,p,w,o,origin)};
  const bili=BilibiliOperationId.safeParse(id);
  if(bili.success)return {platform:"bilibili",schema:bilibiliOperations[bili.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryBilibili(bili.data,p,w,o)};
  const tt=TiktokOperationId.safeParse(id);
  if(tt.success)return {platform:"tiktok",schema:tiktokOperations[tt.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryTiktok(tt.data,p,w,o)};
  const xhs=XiaohongshuOperationId.safeParse(id);
  if(xhs.success)return {platform:"xiaohongshu",schema:xiaohongshuOperations[xhs.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryXiaohongshu(xhs.data,p,w,o)};
  const dy=DouyinOperationId.safeParse(id);
  if(dy.success)return {platform:"douyin",schema:douyinOperations[dy.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryDouyin(dy.data,p,w,o)};
  const wx=WechatOperationId.safeParse(id);
  if(wx.success)return {platform:"wechat",schema:wechatOperations[wx.data].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryWechat(wx.data,p,w,o)};
  const wb=WeiboOperationId.parse(id);
  return {platform:"weibo",schema:weiboOperations[wb].schema,query:(p:Record<string,unknown>,w:string,o:PaidRequestOptions)=>queryWeibo(wb,p,w,"query",o)};
}
export function parseSynchronousQuery(raw: unknown) {
  const request=z.object({operationId:z.union([MediaToolOperationId,SocialResearchOperationId,WeiboOperationId,WechatOperationId,DouyinOperationId,XiaohongshuOperationId,TiktokOperationId,BilibiliOperationId,YoutubeOperationId,InstagramOperationId,ShipinhaoOperationId,KuaishouOperationId,ToutiaoOperationId,QichezhijiaOperationId,DongchediOperationId,YicheOperationId,BaijiahaoOperationId,XResearchOperationId,HotResearchOperationId,RedfoxAccountOperationId,ZhihuOperationId]),parameters:z.record(z.string(),z.unknown()),sourceResultId:z.number().int().positive().safe().optional()}).strict().parse(raw);
  const selected=selectQuery(request.operationId),parameters=selected.schema.parse(request.parameters);
  return { request, parameters, selected };
}
export async function createSynchronousQuery(raw:unknown,actor:string,key:unknown,authorization?:ToolAuthorization){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  const { request, parameters, selected } = parseSynchronousQuery(raw);
  const intent={operationId:request.operationId,parameters,...(request.sourceResultId!==undefined?{sourceResultId:request.sourceResultId}:{})};
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
    const [existing]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;
    if(existing){if(stableJson(existing.input.commandIntent)!==stableJson(intent))throw new StaleOperationError("Command key reused with different input");return existing;}
    await lockMemberAdmission(tx,actor);
    if(request.sourceResultId!==undefined)await lockOriginResult(tx,request.sourceResultId);
    const origin=request.sourceResultId===undefined?undefined:AccountDetailTargets.includes(request.operationId)?await accountDetailOrigin(tx,request.sourceResultId,request.operationId,parameters):(WeiboCarDetailTargets as readonly string[]).includes(request.operationId)?await weiboCarDetailOrigin(tx,request.sourceResultId,request.operationId,parameters):(WorkDetailTargets as readonly string[]).includes(request.operationId)?await workDetailOrigin(tx,request.sourceResultId,request.operationId,parameters):["OE4KUEUO","UOM99OQI"].includes(request.operationId)?await manualWorkOrigin(tx,request.sourceResultId,request.operationId,parameters):request.operationId==="PAB6Z75Y"?await toutiaoOrigin(tx,request.sourceResultId,parameters):request.operationId==="Z9M88QI8"?await instagramOrigin(tx,request.sourceResultId,parameters):await youtubeOrigin(tx,request.sourceResultId,request.operationId,parameters);
    // One command snapshot: retries reuse it; a new explicit query may request fresh provider data.
    const run=await createRun(tx,{actor,authorization,commandKey,provider:"redfox",operationKey:"redfox.sync.query",contractVersion:1,stepKey:"redfox.sync.query",input:{...(origin?{origin}:{}),commandIntent:intent,operationId:request.operationId,parameters,window:`query:${actor}:${commandKey}`,mode:"query",platform:selected.platform},limits:{steps:1,retries:3}});
    await queueOperationStep(tx,run.id);return run;
  });
}
export async function executeSynchronousQuery(execution:Execution,run:RunRow){
  const selected=selectQuery(run.input.operationId,run.input.origin);
  const response=await selected.query(run.input.parameters as Record<string,unknown>,String(run.input.window),receiptOptions(execution));
  if(run.input.origin!==undefined&&AccountDetailTargets.includes(String(run.input.operationId)))for(const result of response.results)applyAccountDetailOrigin(String(run.input.operationId),run.input.parameters as Record<string,unknown>,result,run.input.origin);
  if(run.input.origin!==undefined&&(WeiboCarDetailTargets as readonly string[]).includes(String(run.input.operationId)))for(const result of response.results)applyWeiboCarDetailOrigin(String(run.input.operationId),run.input.parameters as Record<string,unknown>,result,run.input.origin);
  if(run.input.origin!==undefined&&(WorkDetailTargets as readonly string[]).includes(String(run.input.operationId)))for(const result of response.results)applyWorkDetailOrigin(String(run.input.operationId),run.input.parameters as Record<string,unknown>,result,run.input.origin);
  await sql.begin(async tx=>{
    await requireExecution(tx,execution);
    if(!response.results.length)await saveResult(tx,execution,{itemKey:"empty-page",kind:"query_summary",data:{platform:selected.platform,operationId:run.input.operationId,count:0},receiptId:response.receiptId});
    for(const result of response.results)await saveResult(tx,execution,{...result,receiptId:response.receiptId});
    await advanceRun(tx,execution,null);
  });
}
