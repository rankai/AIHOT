import type {Tx} from "../../db.ts";
import {stableJson} from "../../lib/ids.ts";
import {logicalKeyFor} from "../receipts.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import {identityKeyForUrl,bilibiliVideoId,douyinVideoId,xiaohongshuNoteId,tiktokVideoId,instagramCode,youtubeVideoId,toutiaoWorkId} from "../../lib/url.ts";
import {mediaUrl,videoMediaFromHtml} from "../../content/media.ts";
import {parseRedfoxJson} from "./client.ts";
import {parseDouyin} from "./douyin.ts";
import {DouyinOperationId,douyinOperations} from "./douyin-contract.ts";
import {parseWechat,wechatArticleUrl} from "./wechat.ts";
import {WechatOperationId,wechatOperations} from "./wechat-contract.ts";
import {parseXiaohongshu} from "./xiaohongshu-parser.ts";
import {XiaohongshuOperationId,xiaohongshuOperations} from "./xiaohongshu-contract.ts";
import {parseBilibili} from "./bilibili.ts";
import {BilibiliOperationId,bilibiliOperations} from "./bilibili-contract.ts";
import {parseTiktok} from "./tiktok.ts";
import {TiktokOperationId,tiktokOperations} from "./tiktok-contract.ts";
import {parseInstagram} from "./instagram.ts";
import {InstagramOperationId,instagramOperations} from "./instagram-contract.ts";
import {parseYoutube} from "./youtube.ts";
import {YoutubeOperationId,youtubeOperations} from "./youtube-contract.ts";
import {parseToutiao} from "./toutiao.ts";
import {ToutiaoOperationId,toutiaoOperations} from "./toutiao-contract.ts";
import {parseWeibo} from "./weibo.ts";
import {WeiboOperationId,weiboOperations} from "./weibo-contract.ts";
import {parseXResearch} from "./x-research.ts";
import {xResearchOperations} from "./x-research-contract.ts";
import {parseTweet,parseTimeline} from "./x.ts";
import {checkedXDetailOrigin,xDetailContext} from "./x-detail-origin.ts";
import {parseQichezhijia} from "./qichezhijia.ts";
import {QichezhijiaOperationId,qichezhijiaOperations} from "./qichezhijia-contract.ts";
import {parseDongchedi} from "./dongchedi.ts";
import {DongchediOperationId,dongchediOperations} from "./dongchedi-contract.ts";
import {parseYiche} from "./yiche.ts";
import {YicheOperationId,yicheOperations} from "./yiche-contract.ts";
import {parseBaijiahao} from "./baijiahao.ts";
import {BaijiahaoOperationId,baijiahaoOperations} from "./baijiahao-contract.ts";
import {parseKuaishou} from "./kuaishou.ts";
import {KuaishouOperationId,kuaishouOperations} from "./kuaishou-contract.ts";
import {parseShipinhao} from "./shipinhao.ts";
import {ShipinhaoOperationId,shipinhaoOperations} from "./shipinhao-contract.ts";
import {collectedDetailContext,applyCollectedDetail} from "./collection-detail.ts";
import {collectionDiscoveredAt} from "./collection-page-proof.ts";
import {redfoxDouyinHasVideo,redfoxXHasVideo,redfoxToutiaoHasVideo,redfoxXiaohongshuHasVideo,redfoxTiktokHasVideo,redfoxInstagramHasVideo,redfoxShipinhaoHasVideo} from "./video-media.ts";

interface Work {kind:string;data:Record<string,unknown>}
export interface HistoricalVideoProof {platform:string;identityKey:string|null;identity:Record<string,string>;hasVideo:boolean;manualAttribution?:boolean}
function fail(reason:string):never{throw new Error(reason);}
function projection(data:Record<string,unknown>){return {...data,pendingReason:undefined};}

/** Reparse only retained responses through the very same fixed platform parsers. No network or imports. */
export async function redfoxHistoryProof(tx:Tx,s:any,articleUrl:string):Promise<HistoricalVideoProof>{
 requireLiveResult(s);
 const collected=await collectedDetailContext(tx,s),input=collected?.input??s.input;
 const request=s.receipt_request,op=String(s.receipt_model),response=s.receipt_response,service=s.receipt_service;
 if(!["received","completed"].includes(s.receipt_status)||!["redfox.query","redfox.collect"].includes(service)||request?.operation!==op||s.receipt_purpose!==`redfox.${op}`||typeof request.base!=="string"||response?.status!==200||typeof response.body!=="string")fail("receipt-mismatch");
 const logicalKey=logicalKeyFor({service,model:op,purpose:`redfox.${op}`,identity:{base:request.base,operation:op,input:request.input,window:request.window}});
 if(s.receipt_logical_key!==logicalKey)fail("receipt-identity-mismatch");
 const envelope=parseRedfoxJson(response.body) as {code?:unknown;data?:unknown};
 if(envelope?.code!==(["I3CIBRI2","W86F8SSK","QQ5E3EZ9"].includes(op)?200:2000))fail("receipt-business-status");
 const body=envelope.data;
 if(s.operation_key==="redfox.wechat.collection"){
  const expectedOp=input.library==="wide"?"1LDQ7E1C":input.library==="premium"?"XEO0QQNF":null;
  if(s.kind!=="article"||input.mode!=="collection"||input.source?.id!==s.source_id||op!==expectedOp||request.window!==input.window||request.input?.workUuid!==s.item_key)fail("request-context-mismatch");
  const id=WechatOperationId.parse(op),parameters=wechatOperations[id].schema.parse(request.input),parsed=parseWechat(id,body,parameters)[0]!;
  const record=parsed.data.record as Record<string,unknown>,address=wechatArticleUrl(parsed.data.url),identity=parsed.data.identity as Record<string,string>;
  if(!address||identityKeyForUrl(address.url)!==identityKeyForUrl(articleUrl)||s.data.url!==address.url||s.data.library!==input.library)fail("original-url-mismatch");
  for(const [kind,value] of Object.entries(identity))if(input.mapping?.identity?.[kind]&&input.mapping.identity[kind]!==value)fail("author-identity-mismatch");
  // Authorless premium details need retained page attribution; do not promote account context here.
  return {platform:"wechat",identityKey:identityKeyForUrl(address.url),identity,hasVideo:typeof record.content==="string"&&videoMediaFromHtml(record.content,address.url).length>0};
 }
 if(s.operation_key==="redfox.x.timeline"){
  if(s.kind!=="article"||!/^\d+$/.test(s.data.tweetId)||request.window!==input.window)fail("result-association-mismatch");
  let tweet;
  if(op==="API_1790148502632"){
   if(request.input.restId!==input.restId)fail("request-context-mismatch");
   const page=parseTimeline(body,input.restId);tweet=[...(page.pinned?[page.pinned]:[]),...page.timeline].find(t=>t.tweetId===s.data.tweetId);
  }else if(op==="QCP75W33"&&request.input.tweetId===s.data.tweetId)tweet=parseTweet(body,s.data.tweetId);
  if(!tweet||(tweet.author.userId!==undefined&&tweet.author.userId!==input.restId)||tweet.retweetedTweet)fail("work-identity-mismatch");
  return {platform:"x",identityKey:`x:${tweet.tweetId}`,identity:tweet.author.userId?{user_id:tweet.author.userId}:{},hasVideo:redfoxXHasVideo(tweet.medias)};
 }
 if(s.operation_key==="redfox.x.detail"){
  if(op!=="QCP75W33"||stableJson(request.input)!==stableJson(input.parameters)||request.window!==input.window)fail("request-context-mismatch");
  const tweet=parseTweet(body,input.parameters.tweetId),origin=checkedXDetailOrigin(input.origin,tweet.tweetId,tweet);
  const expected={platform:"x",operationId:op,record:tweet,workId:tweet.tweetId,identity:{userId:tweet.author.userId},...(origin?{originResultId:origin.sourceResultId}:{}),context:xDetailContext(tweet,origin)};
  if(s.kind!=="x_detail_work"||stableJson(projection(s.data))!==stableJson(expected))fail("result-projection-mismatch");
  return {platform:"x",identityKey:`x:${tweet.tweetId}`,identity:tweet.author.userId?{user_id:tweet.author.userId}:{},hasVideo:redfoxXHasVideo(tweet.medias)};
 }
 if(!["redfox.sync.query","redfox.platform.collection","redfox.weibo.collection"].includes(s.operation_key)||input.operationId!==op)fail("route-not-covered");
 if(s.operation_key==="redfox.sync.query"&&(stableJson(request.input)!==stableJson(input.parameters)||request.window!==input.window))fail("request-context-mismatch");
 if(s.operation_key==="redfox.platform.collection"&&!collected)await collectionDiscoveredAt(tx,s,input.platform,op);
 const p=request.input as Record<string,unknown>,platform=String(input.platform);let candidates:Work[];
 // Each branch retains its established operation schema and actual full response container.
 switch(platform){
 case "douyin":{const id=DouyinOperationId.parse(op);candidates=parseDouyin(id,body,douyinOperations[id].schema.parse(p));break;}
 case "wechat":{const id=WechatOperationId.parse(op);candidates=parseWechat(id,body,wechatOperations[id].schema.parse(p));break;}
 case "xiaohongshu":{const id=XiaohongshuOperationId.parse(op);candidates=parseXiaohongshu(id,body,xiaohongshuOperations[id].schema.parse(p));break;}
 case "bilibili":{const id=BilibiliOperationId.parse(op);candidates=parseBilibili(id,body,bilibiliOperations[id].schema.parse(p));break;}
 case "tiktok":{const id=TiktokOperationId.parse(op);candidates=parseTiktok(id,body,tiktokOperations[id].schema.parse(p));break;}
 case "instagram":{const id=InstagramOperationId.parse(op);candidates=parseInstagram(id,body,instagramOperations[id].schema.parse(p),input.origin);break;}
 case "youtube":{const id=YoutubeOperationId.parse(op);candidates=parseYoutube(id,body,youtubeOperations[id].schema.parse(p),input.origin);break;}
 case "toutiao":{const id=ToutiaoOperationId.parse(op);candidates=parseToutiao(id,body,toutiaoOperations[id].schema.parse(p),input.origin);break;}
 case "weibo":{const id=WeiboOperationId.parse(op);candidates=parseWeibo(id,body,weiboOperations[id].schema.parse(p));break;}
 case "x-research":{if(op!=="5K5EG87P")fail("route-not-covered");candidates=parseXResearch(op,body,xResearchOperations[op].schema.parse(p));break;}
 case "qichezhijia":{const id=QichezhijiaOperationId.parse(op);candidates=parseQichezhijia(id,body,qichezhijiaOperations[id].schema.parse(p));break;}
 case "dongchedi":{const id=DongchediOperationId.parse(op);candidates=parseDongchedi(id,body,dongchediOperations[id].schema.parse(p));break;}
 case "yiche":{const id=YicheOperationId.parse(op);candidates=parseYiche(id,body,yicheOperations[id].schema.parse(p));break;}
 case "baijiahao":{const id=BaijiahaoOperationId.parse(op);candidates=parseBaijiahao(id,body,baijiahaoOperations[id].schema.parse(p));break;}
 case "kuaishou":{const id=KuaishouOperationId.parse(op);candidates=parseKuaishou(id,body,kuaishouOperations[id].schema.parse(p),input.origin);break;}
 case "shipinhao":{const id=ShipinhaoOperationId.parse(op);candidates=parseShipinhao(id,body,shipinhaoOperations[id].schema.parse(p),input.origin);break;}
 default:return fail("route-not-covered");
 }
 if(input.origin&&["douyin","wechat","xiaohongshu","bilibili","tiktok","weibo","qichezhijia","dongchedi","yiche"].includes(platform))for(const item of candidates)if(item.kind===s.kind)applyCollectedDetail(op,p,item,input.origin);
 const matches=candidates.filter(c=>c.kind===s.kind&&stableJson(projection(c.data))===stableJson(projection(s.data)));
 if(matches.length!==1)fail("result-projection-mismatch");
 const data=matches[0]!.data,record=(platform==="weibo"?data:data.record) as Record<string,unknown>,workId=data.workId??record.opusId;
 let url=typeof data.url==="string"?data.url:platform==="weibo"?record.opusUrl??record.url:null;
 let identity={...(data.identity as Record<string,string>|undefined)},identityKey:string|null=null,hasVideo=false,manualAttribution=false;
 switch(platform){
 case "douyin":identityKey=url&&douyinVideoId(String(url))===workId?`douyin:aweme_id:${workId}`:null;hasVideo=redfoxDouyinHasVideo(op,record);break;
 case "xiaohongshu":identityKey=url&&xiaohongshuNoteId(String(url))===workId?`xiaohongshu:noteId:${workId}`:null;hasVideo=redfoxXiaohongshuHasVideo(op,record);break;
 case "bilibili":identityKey=url&&bilibiliVideoId(String(url))===workId?`bilibili:bvId:${workId}`:null;hasVideo=!!identityKey;break;
 case "tiktok":identityKey=url&&tiktokVideoId(String(url))===workId?`tiktok:workId:${workId}`:null;hasVideo=redfoxTiktokHasVideo(op,record);break;
 case "instagram":identityKey=url&&instagramCode(String(url))===workId?`instagram:code:${workId}`:null;hasVideo=redfoxInstagramHasVideo(record);break;
 case "youtube":identityKey=url&&youtubeVideoId(String(url))===workId?`youtube:videoId:${workId}`:null;hasVideo=!!identityKey;break;
 case "toutiao":identityKey=url&&toutiaoWorkId(String(url))===workId?`toutiao:workId:${workId}`:null;hasVideo=redfoxToutiaoHasVideo(op,record);break;
 case "wechat":hasVideo=op==="I3CIBRI2"&&!!mediaUrl(record.videoLink);break;
 case "weibo":identity={uid:String(record.uid??"")};identityKey=record.opusId?`weibo:opusId:${record.opusId}`:null;hasVideo=op==="TXQPVGJG"&&record.type==="video"||op==="API_1789098514899"&&!!mediaUrl(record.videoUrl);break;
 case "x-research":identity={user_id:String((record.user as {userId?:string}|undefined)?.userId??"")};identityKey=workId?`x:${workId}`:null;hasVideo=redfoxXHasVideo(record.medias);break;
 case "qichezhijia":{const namespace=op==="LLCI8QTE"?"chejiahao":op==="TE6AGWAF"?(p.videoType===4?"chejiahao":"original"):record.workType==="14"?"chejiahao":record.workType==="3"?"original":null;identity=namespace&&record.authorId?{[`${namespace}_authorId`]:String(record.authorId)}:identity;hasVideo=op==="TE6AGWAF"||op==="CI7VW144"&&p.sourceType==="video"&&!!namespace;break;}
 case "dongchedi":
  if(op==="API_1791793668086"){
   const parent=data.accountContext as {userId?:string}|undefined;
   if(parent?.userId){if(record.authorId&&record.authorId!==parent.userId)fail("author-identity-mismatch");identity={...identity,userId:parent.userId};}
  }
  hasVideo=op==="QQ5E3EZ9"?p.workType==="video"&&record.workType===2:record.workType===2||record.articleType===2&&record.articleTypeStr==="pgc_video"||op==="W86F8SSK"&&p.sourceType==="2";break;
 case "yiche":if(!url&&op==="VYSP68M2")url=p.url;hasVideo=op==="3BXWEB6Y"||record.workType===4||op==="YIGCY5US"&&p.sourceType==="shipin";break;
 case "baijiahao":hasVideo=op==="API_1789097000761";if(!url){const intent=s.provenance?.baijiahaoImport?.intent;if(typeof intent?.supplement?.evidence==="string")url=intent.supplement.url;}break;
 case "kuaishou":case "shipinhao":{
  const imported=s.provenance?.manualWorkImport,intent=imported?.intent;
  if(!intent||intent.sourceId!==s.source_id||typeof intent.supplement?.evidence!=="string"||!intent.supplement.evidence.trim()||(imported.receivedWorkId??null)!==(workId??null))fail("manual-original-evidence-missing");
  url=intent.supplement.url;manualAttribution=true;
  hasVideo=platform==="kuaishou"?!!mediaUrl(record.videoUrl)&&record.workType==="1":redfoxShipinhaoHasVideo(op,record);break;
 }
 }
 // These are the same verified full-body fields consumed by the importers, before HTML sanitization.
 const rawBody=platform==="wechat"?record.articleContent??record.content
  :platform==="toutiao"&&op==="PAB6Z75Y"?record.content
  :platform==="qichezhijia"&&op==="LLCI8QTE"?record.content
  :platform==="yiche"&&op==="VYSP68M2"?record.content
  :platform==="baijiahao"&&op==="API_1789097000710"?record.content??record.clearContent
  :platform==="dongchedi"&&(op==="API_1791793668086"&&(record.workType===1||record.articleType===7&&record.articleTypeStr==="ugc_article")||op==="QQ5E3EZ9"&&p.workType==="article"&&(record.workType===undefined||record.workType===1))?record.description:null;
 if(typeof rawBody==="string"&&typeof url==="string"&&videoMediaFromHtml(rawBody,url).length)hasVideo=true;
 if(url&&typeof url==="string"&&identityKeyForUrl(url)!==identityKeyForUrl(articleUrl))fail("original-url-mismatch");
 identityKey??=typeof url==="string"?identityKeyForUrl(url):null;
 return {platform:platform==="x-research"?"x":platform,identityKey,identity,hasVideo,manualAttribution};
}
