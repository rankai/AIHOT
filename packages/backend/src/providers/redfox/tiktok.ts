import { z } from "zod";
import { tiktokVideoId } from "../../lib/url.ts";
import { redfoxRequest,RedfoxResponseError } from "./client.ts";
import type { PaidRequestOptions } from "../receipts.ts";
import { tiktokOperations,type TiktokOperation } from "./tiktok-contract.ts";
const Text=z.string().nullable().optional();
const Id=z.union([z.string().min(1).max(500),z.number().int().nonnegative().safe().transform(String)]).nullable().optional();
const Integer=z.union([z.number().int(),z.string().regex(/^-?\d+$/)]);
const Author=z.object({userId:Id,secUserId:Id,userHandle:Text,userName:Text,userSignature:Text,avatarImage:Text}).passthrough();
const Video=z.object({coverImage:Text,originCoverImage:Text,dynamicCoverImage:Text,playAddress:Text,downloadAddress:Text,downloadNoMarkAddress:Text,playDuration:Integer.nullable().optional()}).passthrough();
const Work=z.object({workId:Id,content:Text,publishTime:Integer.nullable().optional(),shareLink:Text,mediaType:Text,authorData:Author.nullable().optional(),videoData:Video.nullable().optional()}).passthrough().refine(v=>!!(v.workId||v.content||v.shareLink),"No recognizable TikTok work fields");
const Account=Author.refine(v=>!!(v.userId||v.secUserId||v.userName||v.userHandle),"No recognizable TikTok account fields");
const Topic=z.object({topicId:Id,topicName:Text,description:Text,shareLink:Text,profileImageUri:Text,detailSchema:Text,usageCount:Integer.optional(),participantCount:Integer.optional(),viewCount:Integer.optional(),commerceFlag:z.boolean().optional(),challengeFlag:Integer.optional(),liveFlag:z.boolean().optional()}).passthrough().refine(v=>!!(v.topicId||v.topicName),"No recognizable TikTok topic fields");
const More=z.union([z.literal(0),z.literal(1)]);
export interface TiktokResult {kind:"tiktok_account"|"tiktok_work"|"tiktok_topic"|"query_summary";itemKey:string;data:Record<string,unknown>}
function httpUrl(value:unknown):string|null{if(typeof value!=="string")return null;try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?value:null;}catch{return null;}}
function identity(author:z.infer<typeof Author>|null|undefined){return {...(author?.userId?{userId:author.userId}:{}),...(author?.secUserId?{secUserId:author.secUserId}:{})};}
function work(operation:TiktokOperation,raw:unknown,index:number,parameters:Record<string,unknown>):TiktokResult{
  const record=Work.parse(raw),author=identity(record.authorData),url=httpUrl(record.shareLink),urlId=url?tiktokVideoId(url):null;
  if(record.workId&& !/^\d+$/.test(record.workId))throw new RedfoxResponseError("TikTok work ID is not a decimal native ID");
  if(record.workId&&urlId&&record.workId!==urlId)throw new RedfoxResponseError("TikTok work ID differs from native permalink");
  if(operation==="6SE9WIHJ"&&record.workId!==parameters.awemeId)throw new RedfoxResponseError("TikTok work differs from requested awemeId");
  if(operation==="R473NUE9"&&author.secUserId&&author.secUserId!==parameters.secUserId)throw new RedfoxResponseError("TikTok homepage author differs from requested secUserId");
  const missing:string[]=[];
  if(!Object.keys(author).length)missing.push("缺少收到的作者 userId / secUserId；展示昵称和 handle 不证明身份");
  if(!urlId)missing.push("缺少已确认的原生 video 原文链接；不解析短链或 photo 地址");
  return {kind:"tiktok_work",itemKey:`work:${index}`,data:{platform:"tiktok",operationId:operation,title:record.content||"TikTok 作品",workId:record.workId??urlId,url,identity:author,missing,record}};
}
export function parseTiktok(operation:TiktokOperation,raw:unknown,parameters:Record<string,unknown>):TiktokResult[]{
  const shape=tiktokOperations[operation].shape;
  if(shape==="work")return [work(operation,raw,0,parameters)];
  if(shape==="works")return z.array(z.unknown()).max(1000).parse(raw).map((r,i)=>work(operation,r,i,parameters));
  if(shape==="accounts"){
    const page=z.object({cursor:Integer,hasMore:More,userList:z.array(Account).max(1000)}).passthrough().parse(raw);
    const results:TiktokResult[]=page.userList.map((record,index)=>{const ids=identity(record);return {kind:"tiktok_account",itemKey:`account:${index}`,data:{platform:"tiktok",operationId:operation,title:record.userName||record.userHandle||"TikTok 账号",identity:ids,missing:Object.keys(ids).length?[]:["缺少收到的稳定 userId / secUserId"],record}};});
    results.push({kind:"query_summary",itemKey:"page",data:{platform:"tiktok",operationId:operation,count:page.userList.length,cursor:page.cursor,hasMore:page.hasMore,cursorMapping:"返回 cursor；未核实与请求 offset 的自动映射"}});return results;
  }
  if(shape==="topics"){
    const page=z.object({nextCursor:Integer,hasMore:More,topicList:z.array(Topic).max(1000)}).passthrough().parse(raw);
    const results:TiktokResult[]=page.topicList.map((record,index)=>({kind:"tiktok_topic",itemKey:`topic:${index}`,data:{platform:"tiktok",operationId:operation,title:record.topicName||"TikTok 话题",url:httpUrl(record.shareLink),record,missing:["话题仅供研究，不导入文章"]}}));
    results.push({kind:"query_summary",itemKey:"page",data:{platform:"tiktok",operationId:operation,count:page.topicList.length,nextCursor:page.nextCursor,hasMore:page.hasMore}});return results;
  }
  const page=z.object({nextCursor:Integer,hasMore:More,workList:z.array(z.unknown()).max(1000)}).passthrough().parse(raw);
  return [...page.workList.map((r,i)=>work(operation,r,i,parameters)),{kind:"query_summary",itemKey:"page",data:{platform:"tiktok",operationId:operation,count:page.workList.length,nextCursor:page.nextCursor,hasMore:page.hasMore}}];
}
export async function queryTiktok(operation:TiktokOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions,purpose:"query"|"collect"="query"){
  const input=tiktokOperations[operation].schema.parse(parameters),receipt=await redfoxRequest(operation,input,window,purpose,options);
  return {...receipt,results:parseTiktok(operation,receipt.data,input)};
}
