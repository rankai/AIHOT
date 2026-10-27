import { z } from "zod";
import { redfoxRequest,RedfoxResponseError } from "./client.ts";
import type { PaidRequestOptions } from "../receipts.ts";
import { wechatOperations,type WechatOperation } from "./wechat-contract.ts";
import { normalizeUrl } from "../../lib/url.ts";
const Text=z.string().nullable().optional();
const WxId=z.string().regex(/^gh_[A-Za-z0-9]+$/).max(100);
const Biz=z.string().min(1).max(500);
const Account=z.object({account:Text,accountName:Text,wxId:WxId.nullable().optional(),bizInfo:Biz.nullable().optional(),avatarUrl:Text}).passthrough().refine(v=>!!(v.account||v.accountName||v.wxId||v.bizInfo),"Account response has no recognizable account fields");
const Work=z.object({workUuid:Text,title:Text,summary:Text,content:Text,workUrl:Text,publishTime:Text,author:Text,bizInfo:Biz.nullable().optional(),coverUrl:Text,articleUrl:Text,articleTitle:Text,articleContent:Text,articleSummary:Text,publishDate:Text,wechatId:WxId.nullable().optional(),bizKey:Biz.nullable().optional(),accountId:Text,accountName:Text,authorName:Text,videoLink:Text,coverImageUrl:Text,imageUrls:z.array(z.string()).optional(),picList:z.array(z.object({picUrl:z.string(),imageWidth:z.number().int().nonnegative().optional(),imageHeight:z.number().int().nonnegative().optional()}).passthrough()).optional(),url:Text,oriUrl:Text,userName:Text,publicTime:Text,photoId:Text,authorId:Text}).passthrough().refine(v=>!!(v.title||v.articleTitle||v.workUuid||v.workUrl||v.articleUrl||v.url||v.oriUrl||v.photoId),"Work response has no recognizable work fields");
const List=z.object({list:z.array(z.unknown()).max(1000),total:z.union([z.number().nonnegative(),z.string().regex(/^\d+$/)]).optional(),hasMore:z.union([z.boolean(),z.number().int()]).optional(),pageNum:z.number().int().optional(),pageSize:z.number().int().optional(),pages:z.number().int().optional()}).passthrough();
const Rank=z.object({accountId:Text,accountName:Text,userName:Text,nickname:Text,account_id:z.union([z.string().regex(/^\d+$/),z.number().int().safe()]).optional(),maxWork:z.unknown().optional(),minWork:z.unknown().optional()}).passthrough().refine(v=>!!(v.accountId||v.accountName||v.userName||v.nickname||v.account_id!==undefined),"Ranking row has no recognizable account fields");
export interface WechatIdentity {wxId?:string;bizInfo?:string}
export interface WechatResult {kind:"wechat_account"|"wechat_work"|"wechat_account_rank";itemKey:string;data:Record<string,unknown>}
/** Accepted article URLs retain existing canonical URL identity; no short/long link conversion. */
export function wechatArticleUrl(raw:unknown):{url:string;bizInfo?:string}|null {
  if(typeof raw!=="string")return null;
  try{
    const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||u.hostname!=="mp.weixin.qq.com"||u.username||u.password||u.port)return null;
    const url=normalizeUrl(raw)!;
    if(/^\/s\/[A-Za-z0-9_-]+$/.test(u.pathname))return {url};
    const biz=u.searchParams.get("__biz"),mid=u.searchParams.get("mid"),idx=u.searchParams.get("idx");
    if(u.pathname!=="/s"||!biz||/\s/.test(biz)||!/^\d+$/.test(mid??"")||!/^\d+$/.test(idx??""))return null;
    return {url,bizInfo:biz};
  }catch{return null;}
}
function accountResult(operation:WechatOperation,raw:unknown,index:number):WechatResult {
  const record=Account.parse(raw);
  // Only the documented wide-account records identify stable account types.
  const identity:WechatIdentity=["KUQYSQNX","5Y84NI1D"].includes(operation)?{...(record.wxId?{wxId:record.wxId}:{}),...(record.bizInfo?{bizInfo:record.bizInfo}:{})}:{};
  return {kind:"wechat_account",itemKey:`account:${index}`,data:{platform:"wechat",operationId:operation,title:record.accountName??record.account??"公众号账号",identity,missing:Object.keys(identity).length?[]:["缺少已确认 wxId/bizInfo，可显式查询广域账号详情"],record}};
}
function workResult(operation:WechatOperation,raw:unknown,itemKey:string,parentIdentity?:WechatIdentity):WechatResult {
  const record=Work.parse(raw),address=wechatArticleUrl(operation==="I3CIBRI2"?record.articleUrl:record.workUrl??record.oriUrl??record.url);
  const identity:WechatIdentity={...parentIdentity};
  if(["1LDQ7E1C","FVQ8D4W5","8IQD0BJC"].includes(operation)&&record.bizInfo)identity.bizInfo=record.bizInfo;
  if(operation==="I3CIBRI2"){
    if(record.wechatId)identity.wxId=record.wechatId;
    if(record.bizKey)identity.bizInfo=record.bizKey;
  }
  if(address?.bizInfo){if(identity.bizInfo&&identity.bizInfo!==address.bizInfo)throw new RedfoxResponseError("WeChat article URL and received author identity disagree");identity.bizInfo=address.bizInfo;}
  const missing:string[]=[];
  if(!address)missing.push("缺少有效公众号原文地址，不能用供应商作品 ID 代替");

  return {kind:"wechat_work",itemKey,data:{platform:"wechat",operationId:operation,title:record.articleTitle??record.title??"公众号作品",url:address?.url??null,identity,missing,record}};
}
export function parseWechat(operation:WechatOperation,raw:unknown,parameters:Record<string,unknown>):WechatResult[]{
  const shape=wechatOperations[operation].shape;
  if(shape==="account"){
    const result=accountResult(operation,raw,0),record=result.data.record as z.infer<typeof Account>;
    for(const field of operation==="KUQYSQNX"?["account","wxId","bizInfo"] as const:["account"] as const){if(parameters[field]!==undefined&&record[field]!==parameters[field])throw new RedfoxResponseError("WeChat account response does not match the requested identifier");}
    return [result];
  }
  if(shape==="work"){
    const result=workResult(operation,raw,"work:0"),record=result.data.record as z.infer<typeof Work>;
    if(parameters.workUuid!==undefined&&record.workUuid!==parameters.workUuid)throw new RedfoxResponseError("WeChat work UUID does not match this request");
    if(operation==="I3CIBRI2"){
      const input=wechatArticleUrl(parameters.articleUrl),output=wechatArticleUrl(record.articleUrl);
      if(input?.bizInfo&&output?.bizInfo&&input.bizInfo!==output.bizInfo)throw new RedfoxResponseError("WeChat response author differs from requested article URL");
      // Same long URL identity is checkable; a short/long transition is retained as provider evidence,
      // never converted into an article alias by this query parser.
      if(input&&output&&!!input.bizInfo===!!output.bizInfo&&input.url!==output.url)throw new RedfoxResponseError("WeChat response article differs from requested original URL");
    }
    return [result];
  }
  if(shape==="accounts"||shape==="works"){
    const {list}=List.parse(raw);
    return list.map((value,i)=>shape==="accounts"?accountResult(operation,value,i):workResult(operation,value,`work:${i}`));
  }
  const rows=z.array(z.unknown()).max(1000).parse(raw);
  if(shape==="work_rank")return rows.map((r,i)=>workResult(operation,r,`work:${i}`));
  return rows.flatMap((raw,i)=>{
    const parsed=Rank.parse(raw),{maxWork,minWork,...record}=parsed;
    const identity:WechatIdentity=shape==="growth_rank"&&WxId.safeParse(record.accountId).success?{wxId:record.accountId!}:{};
    const results:WechatResult[]=[{kind:"wechat_account_rank",itemKey:`rank:${i}`,data:{platform:"wechat",operationId:operation,title:record.accountName??record.userName??record.nickname??"公众号榜单账号",identity,missing:Object.keys(identity).length?[]:["榜单没有可确认的稳定账号 ID"],record}}];
    if(shape==="growth_rank")for(const [role,work] of [["maxWork",maxWork],["minWork",minWork]] as const){if(work!==undefined&&work!==null)results.push(workResult(operation,work,`rank:${i}:${role}`,identity));}
    return results;
  });
}
export async function queryWechat(operation:WechatOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions,purpose:"query"|"collect"="query"){
  const input=wechatOperations[operation].schema.parse(parameters),receipt=await redfoxRequest(operation,input,window,purpose,options);
  return {...receipt,results:parseWechat(operation,receipt.data,input)};
}
