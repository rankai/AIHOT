import {z} from "zod";
import type {Db} from "../../db.ts";
import {stableJson} from "../../lib/ids.ts";
import {normalizeUrl} from "../../lib/url.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {RedfoxResponseError} from "./client.ts";
import {collectionDiscoveredAt} from "./collection-page-proof.ts";
import {weiboOperations,WeiboOperationId} from "./weibo-contract.ts";
import {parseWeibo} from "./weibo.ts";
import {qichezhijiaOperations,QichezhijiaOperationId} from "./qichezhijia-contract.ts";
import {parseQichezhijia} from "./qichezhijia.ts";
import {dongchediOperations,DongchediOperationId} from "./dongchedi-contract.ts";
import {parseDongchedi} from "./dongchedi.ts";
import {yicheOperations,YicheOperationId} from "./yiche-contract.ts";
import {parseYiche} from "./yiche.ts";
export const WeiboCarDetailTargets=["API_1789098514899","TE6AGWAF","LLCI8QTE","QQ5E3EZ9","3BXWEB6Y","VYSP68M2"] as const;
const Origin=z.object({resultId:z.number().int().positive().safe(),platform:z.enum(["weibo","qichezhijia","dongchedi","yiche"]),sourceOperation:z.string(),workId:z.string().min(1).nullable(),url:z.string().nullable(),workType:z.string(),identity:z.record(z.string(),z.string().min(1)),discoveredAt:z.iso.datetime()}).strict();
type OriginValue=z.infer<typeof Origin>;
type Work={kind:string;data:Record<string,unknown>};
function reject(message:string):never{throw new UnsupportedReplacement(message);}
function native(value:unknown,host:string,path:RegExp){if(typeof value!=="string")return null;try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&!u.port&&!u.hash&&u.hostname===host&&path.test(u.pathname)?value:null;}catch{return null;}}
function check(o:OriginValue,target:string,p:Record<string,unknown>){
 let valid=false,id:unknown;
 if(o.platform==="weibo"){valid=o.sourceOperation==="TXQPVGJG"&&target==="API_1789098514899"&&o.workType==="work";id=p.opusId;}
 if(o.platform==="qichezhijia"){
  valid=o.sourceOperation==="CI7VW144"&&((o.workType==="chejiahao_video"&&target==="TE6AGWAF"&&p.videoType===4)||(o.workType==="original_video"&&target==="TE6AGWAF"&&p.videoType===0)||(o.workType==="chejiahao_article"&&target==="LLCI8QTE"));id=target==="TE6AGWAF"?p.videoId:p.workId;
 }
 if(o.platform==="dongchedi"){valid=["W86F8SSK","API_1791793668086"].includes(o.sourceOperation)&&target==="QQ5E3EZ9"&&["article","video"].includes(o.workType)&&p.workType===o.workType;id=p.workId;}
 if(o.platform==="yiche"){
  valid=["YIGCY5US","YGYYT0G0"].includes(o.sourceOperation)&&((o.workType==="video"&&target==="3BXWEB6Y")||(o.workType==="article"&&target==="VYSP68M2"&&!!o.url&&p.url===o.url));id=target==="VYSP68M2"?o.workId:p.workId;
 }
 if(!valid||id!==o.workId||(!o.workId&&target!=="VYSP68M2"))reject("Detail request differs from the received work/library/type");
 const kinds=o.platform==="weibo"?["uid"]:o.platform==="qichezhijia"?[o.workType.startsWith("chejiahao_")?"chejiahao_authorId":"original_authorId"]:["userId","authorId"];
 if(Object.keys(o.identity).some(k=>!kinds.includes(k)))reject("Unexpected frozen author namespace");
}
/** Exact source result, including its actual collection page; no search of other runs. */
export async function weiboCarDetailOrigin(db:Db,resultId:number,target:string,p:Record<string,unknown>){
 const [r]=await db`SELECT z.*,r.provider,r.operation_key,r.input,p.model,p.status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
 if(!r||r.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection","redfox.weibo.collection"].includes(r.operation_key)||!["received","completed"].includes(r.status)||r.model!==r.input.operationId||r.data.platform!==r.input.platform||r.kind!==`${r.input.platform}_work`)reject("Source is not a received single work");
 const op=r.input.operationId,platform=r.input.platform,identity:Record<string,string>={};let parsed:Work|undefined,workType="",url:string|null=null,workId:unknown,discoveredAt=new Date(r.created_at);
 if(platform==="weibo"){
  if(op!=="TXQPVGJG")reject("Only actual Weibo search works support this relation");
  const request=weiboOperations[WeiboOperationId.parse(op)].schema.parse(r.input.parameters);
  parsed=parseWeibo(op,[r.data],request)[0];workId=parsed?.data.opusId;workType="work";if(typeof parsed?.data.uid==="string")identity.uid=parsed.data.uid;
  url=typeof parsed?.data.opusUrl==="string"?parsed.data.opusUrl:typeof parsed?.data.url==="string"?parsed.data.url:null;
  if(r.operation_key==="redfox.weibo.collection"){
   const pageId=r.provenance?.sourcePageResultId;if(!Number.isSafeInteger(pageId)||pageId<=0)reject("Missing Weibo source page proof");
   const [page]=await db`SELECT z.created_at FROM operation_results z JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${pageId} AND z.run_id=${r.run_id} AND z.receipt_id=${r.receipt_id} AND z.kind='query_summary' AND z.data->>'platform'='weibo' AND z.data->>'operationId'='TXQPVGJG' AND z.item_key='page:'||(z.data->>'page') AND p.model='TXQPVGJG' AND p.status IN ('received','completed')`;
   if(!page)reject("Invalid Weibo source page proof");discoveredAt=new Date(page.created_at);
  }
 }else{
  if(r.operation_key==="redfox.weibo.collection"||r.data.operationId!==op)reject("Wrong collection producer");
  const record=z.record(z.string(),z.unknown()).parse(r.data.record);
  if(platform==="qichezhijia"){
   if(op!=="CI7VW144")reject("Unsupported Autohome source");const request=qichezhijiaOperations[QichezhijiaOperationId.parse(op)].schema.parse(r.input.parameters) as Record<string,unknown>;
   parsed=parseQichezhijia(op,[record],request)[0];
   workType=request.sourceType==="video"&&record.workType==="14"?"chejiahao_video":request.sourceType==="video"&&record.workType==="3"?"original_video":request.sourceType==="article"&&native(record.workUrl,"chejiahao.autohome.com.cn",/^\/info\/[^/]+\/?$/)?"chejiahao_article":"";
   if(workType&&typeof record.authorId==="string"&&record.authorId)identity[workType.startsWith("chejiahao_")?"chejiahao_authorId":"original_authorId"]=record.authorId;
  }else if(platform==="dongchedi"){
   if(!["W86F8SSK","API_1791793668086"].includes(op))reject("Unsupported Dongchedi source");const request=dongchediOperations[DongchediOperationId.parse(op)].schema.parse(r.input.parameters) as Record<string,unknown>;let payload:unknown={workList:[record]};
   if(op==="API_1791793668086"){
    const [parent]=await db`SELECT data FROM operation_results WHERE run_id=${r.run_id} AND receipt_id=${r.receipt_id} AND kind='dongchedi_account' AND ((${r.operation_key}='redfox.sync.query' AND step_version=${r.step_version}) OR (${r.operation_key}='redfox.platform.collection' AND provenance->>'sourcePageResultId'=${String(r.provenance?.sourcePageResultId??'')})) LIMIT 1`;
    if(!parent)reject("Missing same-page account record");payload={account:parent.data.record,workList:[record]};
    if(typeof parent.data.record.userId==="string"&&parent.data.record.userId){if(record.authorId&&record.authorId!==parent.data.record.userId)reject("Work conflicts with received account author");identity.userId=parent.data.record.userId;}
   }
   parsed=parseDongchedi(op,payload,request).find(x=>x.kind===r.kind);
   workType=record.workType===1?"article":record.workType===2?"video":record.articleType===7&&record.articleTypeStr==="ugc_article"?"article":record.articleType===2&&record.articleTypeStr==="pgc_video"?"video":op==="W86F8SSK"&&request.sourceType==="2"?"video":"";
   if(typeof record.authorId==="string"&&record.authorId)identity.authorId=record.authorId;
  }else if(platform==="yiche"){
   if(!["YIGCY5US","YGYYT0G0"].includes(op))reject("Unsupported Yiche source");const request=yicheOperations[YicheOperationId.parse(op)].schema.parse(r.input.parameters) as Record<string,unknown>;
   parsed=parseYiche(op,op==="YIGCY5US"?[record]:{workList:[record]},request)[0];
   workType=op==="YIGCY5US"?request.sourceType==="shipin"?"video":request.sourceType==="xinwen"?"article":"":record.workType===4?"video":"";
   const a=record.authorInfo as {userId?:string}|undefined;if(a?.userId)identity.userId=a.userId;if(typeof record.authorId==="string"&&record.authorId)identity.authorId=record.authorId;
   if(op==="YGYYT0G0"&&identity.authorId){if(identity.authorId!==request.userId)reject("Directed list author mismatch");identity.userId=String(request.userId);}
   if(workType==="article"&&!native(record.workUrl,"news.yiche.com",/^\/(?:hao\/wenzhang\/[^/]+|zonghexinwen\/\d+\/[^/]+)\/?$/))reject("Source lacks a confirmed native news original");
  }else reject("Unsupported source platform");
  if(!parsed||parsed.kind!==r.kind)reject("Source kind is not a work");
  for(const field of ["workId","url","identity","workNamespace","accountContext"])if(stableJson(parsed.data[field]??null)!==stableJson(r.data[field]??null))reject(`Stored source ${field} differs from received record`);
  workId=parsed.data.workId;url=typeof parsed.data.url==="string"?parsed.data.url:null;discoveredAt=await collectionDiscoveredAt(db,r,platform,op);
 }
 if(!parsed||parsed.kind!==r.kind)reject("Source is not an actual work");
 const origin=Origin.parse({resultId,platform,sourceOperation:op,workId:workId??null,url,workType,identity,discoveredAt:discoveredAt.toISOString()});check(origin,target,p);return origin;
}
/** Leaves the received record (and Weibo's flattened received fields) unchanged. */
export function applyWeiboCarDetailOrigin(target:string,p:Record<string,unknown>,result:Work,raw:unknown){
 if(raw===undefined)return undefined;const o=Origin.parse(raw);check(o,target,p);
 if(result.kind!==`${o.platform}_work`||result.data.platform!==o.platform||(o.platform!=="weibo"&&result.data.operationId!==target))reject("Detail platform differs from frozen origin");
 const record=o.platform==="weibo"?result.data:z.record(z.string(),z.unknown()).parse(result.data.record),id=o.platform==="weibo"?record.opusId:record.workId;
 if(o.workId&&id&&id!==o.workId)throw new RedfoxResponseError("Detail work conflicts with frozen source");
 const identity:Record<string,string>={};
 if(o.platform==="weibo"){if(typeof record.uid==="string")identity.uid=record.uid;}
 else if(o.platform==="qichezhijia"){
  const returned=typeof result.data.url==="string"?result.data.url:null;
  if(returned){let host:string|null=null;try{host=new URL(returned).hostname;}catch{}if(host==="chejiahao.autohome.com.cn"&&!o.workType.startsWith("chejiahao_")||host==="v.autohome.com.cn"&&!o.workType.startsWith("original_"))throw new RedfoxResponseError("Detail original conflicts with author namespace");}
  if(typeof record.authorId==="string"&&record.authorId)identity[o.workType.startsWith("chejiahao_")?"chejiahao_authorId":"original_authorId"]=record.authorId;}
 else{
  if(typeof record.authorId==="string"&&record.authorId)identity.authorId=record.authorId;
  const a=record.authorInfo as {userId?:string}|undefined;if(a?.userId)identity.userId=a.userId;
  if(o.platform==="dongchedi"){
   if(record.workType!=null&&record.workType!==(o.workType==="article"?1:2))throw new RedfoxResponseError("Detail work type conflicts with source");
   if(o.identity.userId&&identity.authorId&&identity.authorId!==o.identity.userId)throw new RedfoxResponseError("Detail author conflicts with received account context");
  }
 }
 for(const [kind,value] of Object.entries(o.identity)){if(identity[kind]&&identity[kind]!==value)throw new RedfoxResponseError("Detail author conflicts with frozen typed identity");identity[kind]??=value;}
 if(target==="VYSP68M2"&&typeof record.workUrl==="string"&&native(record.workUrl,"news.yiche.com",/^\//)&&normalizeUrl(record.workUrl)!==normalizeUrl(o.url!))throw new RedfoxResponseError("Detail original differs from requested news work");
 result.data={...result.data,originResultId:o.resultId,originIdentity:identity};
 return {...o,identity};
}
