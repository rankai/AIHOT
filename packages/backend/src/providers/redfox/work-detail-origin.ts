import {z} from "zod";
import type {Db} from "../../db.ts";
import {stableJson} from "../../lib/ids.ts";
import {douyinVideoId,xiaohongshuNoteId,bilibiliVideoId} from "../../lib/url.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {RedfoxResponseError} from "./client.ts";
import {collectionDiscoveredAt} from "./collection-page-proof.ts";
import {douyinOperations,DouyinOperationId} from "./douyin-contract.ts";
import {parseDouyin} from "./douyin.ts";
import {xiaohongshuOperations,XiaohongshuOperationId} from "./xiaohongshu-contract.ts";
import {parseXiaohongshu} from "./xiaohongshu-parser.ts";
import {wechatOperations,WechatOperationId} from "./wechat-contract.ts";
import {parseWechat,wechatArticleUrl} from "./wechat.ts";
import {tiktokOperations,TiktokOperationId} from "./tiktok-contract.ts";
import {parseTiktok} from "./tiktok.ts";
import {bilibiliOperations,BilibiliOperationId} from "./bilibili-contract.ts";
import {parseBilibili} from "./bilibili.ts";

export const WorkDetailTargets=["0OT1E306","FK67XDVQ","KR1LPTBF","XEO0QQNF","1LDQ7E1C","I3CIBRI2","6SE9WIHJ","TIN1NMTZ"] as const;
const Origin=z.object({resultId:z.number().int().positive().safe(),platform:z.enum(["douyin","xiaohongshu","wechat","tiktok","bilibili"]),sourceOperation:z.string(),workId:z.string().min(1).nullable(),url:z.string().min(1).nullable(),identity:z.record(z.string(),z.string().min(1)),role:z.enum(["keyword_match","provider_recommendation"]).optional(),discoveredAt:z.iso.datetime()}).strict();
type DetailOrigin=z.infer<typeof Origin>;
type Work={kind:string;data:Record<string,unknown>};
function reject(message:string):never{throw new UnsupportedReplacement(message);}
function equal(value:unknown,expected:unknown){if(typeof expected!=="string"||!expected||value!==expected)reject("Detail request does not identify the received source work");}
/** Fixed, operation-scoped request relations; never selects a fallback library. */
function checkRequest(o:DetailOrigin,target:string,p:Record<string,unknown>){
 const source=o.sourceOperation;
 if(o.platform==="douyin"){
  const premium=["QEQLCKD6","774OBKK0","HUCIASU"].includes(source),wide=["QSL2ZSXM","OWIBYU1V"].includes(source),native=["WD6UT8DQ","0ZB9S2FW","I8P3HTVH"].includes(source);
  if((target!=="0OT1E306"||!premium&&!native)&&(target!=="FK67XDVQ"||!wide&&!native))reject("Unsupported Douyin source/detail library pair");
  const id=native?douyinVideoId(o.url??""):o.workId;if(native&&o.workId&&id!==o.workId)reject("Received Douyin URL conflicts with work ID");
  equal(target==="FK67XDVQ"?p.videoId:p.workId,id);
 }else if(o.platform==="xiaohongshu"){
  if(target!=="KR1LPTBF")reject("Unsupported Xiaohongshu detail operation");
  if(["384C6W6B","XN3ULENA","3X8FGEEM","P3W2W18P"].includes(source))equal(p.workId,o.workId);
  else if(["LBYLC5AK","AEA6YE0J","047JJ3UA"].includes(source)){if(!xiaohongshuNoteId(o.url??""))reject("Source has no confirmed native note URL");equal(p.workLink,o.url);}
  else reject("Unsupported Xiaohongshu source operation");
 }else if(o.platform==="wechat"){
  if(target==="I3CIBRI2"){
   if(!["XEO0QQNF","1LDQ7E1C","PW97QFBS","FVQ8D4W5","XNV30XZ3","8IQD0BJC","IE0887SO","I3CIBRI2","ZIGAGYYT","OFFSPQ0U","DL4YNCTQ"].includes(source)||!wechatArticleUrl(o.url))reject("Source has no confirmed WeChat original URL");
   equal(wechatArticleUrl(p.articleUrl)?.url,wechatArticleUrl(o.url)?.url);
  }else if(target==="XEO0QQNF"&&["PW97QFBS","XNV30XZ3"].includes(source)||target==="1LDQ7E1C"&&["FVQ8D4W5","8IQD0BJC"].includes(source))equal(p.workUuid,o.workId);
  else reject("WeChat UUIDs cannot cross libraries");
 }else if(o.platform==="tiktok"){
  if(target!=="6SE9WIHJ"||!["R473NUE9","PXZXY8KQ","API_1790149158205","API_1790581450500"].includes(source))reject("Unsupported TikTok detail relation");equal(p.awemeId,o.workId);
 }else{
  if(target!=="TIN1NMTZ"||!["LEN9QXR3","VPA67I98"].includes(source))reject("Unsupported Bilibili detail relation");
  if(p.bvId!==undefined)equal(p.bvId,o.workId);
  else {equal(p.workUrl,o.url);bilibiliOperations.TIN1NMTZ.schema.parse(p);}
 }
 const kinds=o.platform==="douyin"?["uid","secUserId"]:o.platform==="xiaohongshu"?["userId"]:o.platform==="wechat"?["wxId","bizInfo"]:o.platform==="tiktok"?["userId","secUserId"]:["mid"];
 if(Object.keys(o.identity).some(k=>!kinds.includes(k)))reject("Unexpected frozen author identity type");
}

export async function workDetailOrigin(db:Db,resultId:number,target:string,p:Record<string,unknown>):Promise<DetailOrigin>{
 const [r]=await db`SELECT z.*,r.provider,r.operation_key,r.input,p.model,p.status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
 if(!r||r.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(r.operation_key)||!["received","completed"].includes(r.status)||r.model!==r.input.operationId||r.data.operationId!==r.input.operationId||r.data.platform!==r.input.platform||r.kind!==`${r.input.platform}_work`)reject("Source is not a confirmed single work result");
 const op=r.input.operationId,platform=r.input.platform,record=z.record(z.string(),z.unknown()).parse(r.data.record);
 let parsed:Work|undefined;
 if(platform==="douyin"){
  const id=DouyinOperationId.parse(op),def=douyinOperations[id],request=def.schema.parse(r.input.parameters);
  parsed=parseDouyin(id,["works","accounts"].includes(def.shape)?{list:[record]}:["work_rank","growth_rank"].includes(def.shape)?[record]:record,request)[0];
 }else if(platform==="xiaohongshu"){
  const id=XiaohongshuOperationId.parse(op),def=xiaohongshuOperations[id],request=def.schema.parse(r.input.parameters);
  let payload:unknown=record;
  if(["works","accounts","ai_works"].includes(def.shape))payload={list:[record]};
  else if(["linked_rank","dark_rank"].includes(def.shape))payload=[record];
  else if(def.shape==="research"){
   const role=String(r.item_key).split(":")[0];if(role!==r.data.role||!["keyword_match","provider_recommendation"].includes(role))reject("Source research role is inconsistent");
   payload={articles:role==="keyword_match"?[record]:[],latestHotArticles:role==="provider_recommendation"?[record]:[]};
  }
  parsed=parseXiaohongshu(id,payload,request).find(x=>x.kind===r.kind);
 }else if(platform==="wechat"){
  const id=WechatOperationId.parse(op),def=wechatOperations[id],request=def.schema.parse(r.input.parameters);
  let payload:unknown=record;
  if(def.shape==="works")payload={list:[record]};
  else if(def.shape==="work_rank")payload=[record];
  else if(def.shape==="growth_rank"){
   const role=String(r.item_key).endsWith(":maxWork")?"maxWork":String(r.item_key).endsWith(":minWork")?"minWork":null;if(!role)reject("Invalid growth work role");
   const parentKey=String(r.item_key).replace(/:(maxWork|minWork)$/,"");
   const [parent]=await db`SELECT data FROM operation_results WHERE run_id=${r.run_id} AND receipt_id=${r.receipt_id} AND item_key=${parentKey} AND kind='wechat_account_rank' AND ((${r.operation_key}='redfox.sync.query' AND step_version=${r.step_version}) OR (${r.operation_key}='redfox.platform.collection' AND provenance->>'sourcePageResultId'=${String(r.provenance?.sourcePageResultId??'')}))`;
   if(!parent)reject("Missing same-page growth account evidence");payload=[{...parent.data.record,[role]:record}];
  }
  parsed=parseWechat(id,payload,request).find(x=>x.kind===r.kind);
 }else if(platform==="tiktok"){
  const id=TiktokOperationId.parse(op),def=tiktokOperations[id],request=def.schema.parse(r.input.parameters);
  parsed=parseTiktok(id,def.shape==="works"?[record]:def.shape==="paged_works"?{workList:[record],nextCursor:0,hasMore:0}:record,request)[0];
 }else if(platform==="bilibili"){
  const id=BilibiliOperationId.parse(op),request=bilibiliOperations[id].schema.parse(r.input.parameters);
  parsed=parseBilibili(id,{workList:[record],...(op==="VPA67I98"?{mid:r.data.accountMid}:{})},request)[0];
 }else reject("Unsupported source platform");
 if(!parsed||parsed.kind!==r.kind)reject("Source record does not reproduce the stored work kind");
 for(const field of ["workId","url","identity","role"])if(stableJson(parsed.data[field]??null)!==stableJson(r.data[field]??null))reject(`Stored source ${field} differs from its received record`);
 const discoveredAt=await collectionDiscoveredAt(db,r,platform,op);
 const workId=platform==="wechat"?record.workUuid:platform==="tiktok"?record.workId:parsed.data.workId;
 let originalUrl=parsed.data.url??null;
 if(platform==="bilibili"){
  originalUrl=typeof record.workUrl==="string"?record.workUrl:null;
  if(originalUrl!==null){bilibiliOperations.TIN1NMTZ.schema.parse({workUrl:originalUrl});const native=bilibiliVideoId(String(originalUrl));if(native&&workId&&native!==workId)reject("Received Bilibili URL and BV disagree");}
 }
 const origin=Origin.parse({resultId,platform,sourceOperation:op,workId:workId??null,url:originalUrl,identity:parsed.data.identity,...(parsed.data.role?{role:parsed.data.role}:{}),discoveredAt:discoveredAt.toISOString()});
 checkRequest(origin,target,p);return origin;
}

/** Rechecked both after supplier parsing and after raw-record reparse on local import. */
export function applyWorkDetailOrigin(target:string,p:Record<string,unknown>,result:Work,raw:unknown):DetailOrigin|undefined{
 if(raw===undefined)return undefined;
 const origin=Origin.parse(raw);checkRequest(origin,target,p);
 if(result.kind!==`${origin.platform}_work`||result.data.platform!==origin.platform||result.data.operationId!==target)reject("Detail result differs from frozen platform/operation");
 const record=z.record(z.string(),z.unknown()).parse(result.data.record);
 const returnedId=origin.platform==="wechat"?record.workUuid:result.data.workId;
 if(target!=="I3CIBRI2"&&origin.workId&&returnedId&&returnedId!==origin.workId)throw new RedfoxResponseError("Detail work differs from frozen source identity");
 if(target==="I3CIBRI2"){
  const before=wechatArticleUrl(origin.url),after=wechatArticleUrl(result.data.url);
  if(before&&after&&!!before.bizInfo===!!after.bizInfo&&before.url!==after.url)throw new RedfoxResponseError("Detail original differs from frozen source URL");
 }
 if(origin.platform==="bilibili"&&!returnedId)throw new RedfoxResponseError("Bilibili detail has no confirmed returned BV");
 const identity=z.record(z.string(),z.string()).parse(result.data.identity);
 for(const [kind,value] of Object.entries(origin.identity)){
  if(identity[kind]&&identity[kind]!==value)throw new RedfoxResponseError("Detail author conflicts with frozen same-work evidence");identity[kind]??=value;
 }
 const missing=Array.isArray(result.data.missing)&&Object.keys(identity).length?result.data.missing.filter(x=>typeof x!=="string"||!x.startsWith("缺少已确认作者")&&!x.startsWith("缺少收到的作者")):result.data.missing;
 result.data={...result.data,identity,missing,originResultId:origin.resultId,...(origin.role?{originRole:origin.role}:{})};
 return origin;
}
