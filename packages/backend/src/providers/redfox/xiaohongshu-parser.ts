import { z } from "zod";
import { xiaohongshuNoteId } from "../../lib/url.ts";
export { xiaohongshuNoteId } from "../../lib/url.ts";
import { redfoxRequest,RedfoxResponseError } from "./client.ts";
import type { PaidRequestOptions } from "../receipts.ts";
import { xiaohongshuOperations,type XiaohongshuOperation } from "./xiaohongshu-contract.ts";
const Text=z.string().nullable().optional(),Id=z.string().min(1).max(500).nullable().optional();
const Account=z.object({accountName:Text,accountId:Text,userId:Id,accountAvatar:Text}).passthrough().refine(v=>!!(v.accountName||v.accountId||v.userId),"No recognizable account fields");
const Work=z.object({workId:Id,workTitle:Text,workDesc:Text,workUrl:Text,workPublishTime:Text,accountUserid:Id,accountNickname:Text,coverUrl:Text,workType:Text}).passthrough().refine(v=>!!(v.workId||v.workTitle||v.workDesc||v.workUrl),"No recognizable work fields");
const AiWork=z.object({photoId:Text,authorId:Text,title:Text,url:Text,userName:Text,coverUrl:Text,gmtCreate:Text}).passthrough().refine(v=>!!(v.photoId||v.title||v.url),"No recognizable AI work fields");
const RankedWork=z.object({title:Text,desc:Text,photoId:Id,userId:Id,photoJumpUrl:Text,userJumpUrl:Text,userName:Text,publicTime:Text,coverUrl:Text,anaAdd:z.record(z.string(),z.unknown()).optional()}).passthrough().refine(v=>!!(v.title||v.desc||v.photoId||v.photoJumpUrl),"No recognizable ranked work fields");
const AccountRank=z.object({accountName:Text,accountLink:Text,accountRanking:z.number().int().optional()}).passthrough().refine(v=>!!(v.accountName||v.accountLink),"No recognizable ranked account fields");
const InsightWork=z.object({id:Id,title:Text,desc:Text,authorId:Id,authorNickname:Text,shareInfoLink:Text,cover:Text,createTime:Text}).passthrough().refine(v=>!!(v.id||v.title||v.desc||v.shareInfoLink),"No recognizable insight work fields");
const Count=z.union([z.number().nonnegative(),z.string().regex(/^\d+$/)]);
const List=z.object({list:z.array(z.unknown()).max(1000),total:Count.optional(),hasMore:z.union([z.boolean(),z.number().int()]).optional(),pageNum:z.number().int().optional(),pageSize:z.number().int().optional(),pages:z.number().int().optional()}).passthrough();
const Research=z.object({articles:z.array(InsightWork).max(1000),latestHotArticles:z.array(InsightWork).max(1000).optional(),hotTopics:z.array(z.object({topic:z.string().min(1),articleCount:Count.optional(),totalInteractiveCount:Count.optional()}).passthrough()).max(1000).optional(),relatedSearches:z.array(z.object({keyword:z.string().min(1),articleCount:Count.optional()}).passthrough()).max(1000).optional(),keyword:Text,tips:Text,total:Count.optional(),pageNum:z.number().int().optional(),pageSize:z.number().int().optional()}).passthrough();
export interface XiaohongshuResult{kind:"xiaohongshu_account"|"xiaohongshu_work"|"xiaohongshu_account_rank"|"xiaohongshu_research";itemKey:string;data:Record<string,unknown>}
function url(raw:unknown):string|null{if(typeof raw!=="string")return null;try{const u=new URL(raw);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?raw:null;}catch{return null;}}
function profileUserId(raw:unknown):string|null{
  if(typeof raw!=="string")return null;
  try{const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.port||u.hash||u.hostname.replace(/^www\./,"")!=="xiaohongshu.com")return null;
    return /^\/user\/profile\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname)?.[1]??null;
  }catch{return null;}
}
function account(operation:XiaohongshuOperation,raw:unknown,index:number):XiaohongshuResult{
  const record=Account.parse(raw),identity=operation==="4IVIDHEN"&&record.userId?{userId:record.userId}:{};
  return {kind:"xiaohongshu_account",itemKey:`account:${index}`,data:{platform:"xiaohongshu",operationId:operation,title:record.accountName??record.accountId??"小红书账号",identity,missing:Object.keys(identity).length?[]:["缺少稳定 userId；可用展示小红书号显式查询账号详情"],record}};
}
function work(operation:XiaohongshuOperation,raw:unknown,index:number):XiaohongshuResult{
  let record:Record<string,unknown>,title:string|null=null,workId:string|null=null,address:string|null=null,identity:{userId?:string}={};
  if(operation==="047JJ3UA"){
    const r=AiWork.parse(raw);record=r;title=r.title??null;address=url(r.url);
  }else if(["LBYLC5AK","AEA6YE0J","P3W2W18P"].includes(operation)){
    const r=RankedWork.parse(raw);record=r;title=r.title??null;address=url(r.photoJumpUrl);
    if(operation==="P3W2W18P"){workId=r.photoId??null;if(r.userId)identity.userId=r.userId;}
    else{workId=address?xiaohongshuNoteId(address):null;const author=profileUserId(r.userJumpUrl);if(author)identity.userId=author;}
  }else{
    const r=Work.parse(raw);record=r;title=r.workTitle??null;workId=r.workId??null;address=url(r.workUrl);if(r.accountUserid)identity.userId=r.accountUserid;
  }
  const missing:string[]=[];
  if(!workId)missing.push("缺少已确认作品 ID；AI photoId 不直接当原生笔记 ID");
  if(!address)missing.push("缺少已收原文地址，不能只凭作品 ID 导入");
  return {kind:"xiaohongshu_work",itemKey:`work:${index}`,data:{platform:"xiaohongshu",operationId:operation,title:title??"小红书作品",workId,url:address,identity,missing,record}};
}
export function parseXiaohongshu(operation:XiaohongshuOperation,raw:unknown,parameters:Record<string,unknown>):XiaohongshuResult[]{
  const shape=xiaohongshuOperations[operation].shape;
  if(shape==="account"){
    const result=account(operation,raw,0),record=result.data.record as z.infer<typeof Account>;
    if(record.accountId&&record.accountId!==parameters.accountId)throw new RedfoxResponseError("Xiaohongshu account response differs from requested display account");
    if(parameters.userId!==undefined&&record.userId!==parameters.userId)throw new RedfoxResponseError("Xiaohongshu account response differs from requested userId");
    return [result];
  }
  if(shape==="work"){
    const result=work(operation,raw,0);
    if(parameters.workId!==undefined&&parameters.workId!==result.data.workId)throw new RedfoxResponseError("Xiaohongshu work response differs from requested ID");
    const requestedUrlId=typeof parameters.workLink==="string"?xiaohongshuNoteId(parameters.workLink):null;
    const returnedUrlId=typeof result.data.url==="string"?xiaohongshuNoteId(result.data.url):null;
    if(requestedUrlId&&[result.data.workId,returnedUrlId].some(id=>id!=null&&id!==requestedUrlId))throw new RedfoxResponseError("Xiaohongshu work response differs from requested native URL");
    return [result];
  }
  if(shape==="account_rank")return z.array(AccountRank).max(1000).parse(raw).map((record,i)=>({kind:"xiaohongshu_account_rank",itemKey:`rank:${i}`,data:{platform:"xiaohongshu",operationId:operation,title:record.accountName??"小红书账号榜单",identity:{},missing:["账号榜单仅作研究；主页不自动升级稳定身份"],record}}));
  if(shape==="research"){
    const parsed=Research.parse(raw),{articles,latestHotArticles=[],hotTopics=[],relatedSearches=[],...metadata}=parsed;
    const results:XiaohongshuResult[]=[];
    for(const [role,rows] of [["keyword_match",articles],["provider_recommendation",latestHotArticles]] as const)for(const [i,record] of rows.entries()){
      const address=url(record.shareInfoLink),missing:string[]=[];if(!record.id)missing.push("缺少原生笔记 ID");if(!address)missing.push("缺少已收原文地址");
      results.push({kind:"xiaohongshu_work",itemKey:`${role}:${i}`,data:{platform:"xiaohongshu",operationId:operation,title:record.title??"小红书洞察笔记",workId:record.id??null,url:address,identity:record.authorId?{userId:record.authorId}:{},role,missing,record}});
    }
    results.push({kind:"xiaohongshu_research",itemKey:"research",data:{platform:"xiaohongshu",operationId:operation,title:"相关搜索与热门话题",record:{...metadata,hotTopics,relatedSearches},matchedCount:articles.length,recommendedCount:latestHotArticles.length}});
    return results;
  }
  const rows=shape==="linked_rank"||shape==="dark_rank"?z.array(z.unknown()).max(1000).parse(raw):List.parse(raw).list;
  return rows.map((r,i)=>shape==="accounts"?account(operation,r,i):work(operation,r,i));
}
export async function queryXiaohongshu(operation:XiaohongshuOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions,purpose:"query"|"collect"="query"){
  const input=xiaohongshuOperations[operation].schema.parse(parameters),receipt=await redfoxRequest(operation,input,window,purpose,options);
  return {...receipt,results:parseXiaohongshu(operation,receipt.data,input)};
}
