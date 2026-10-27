import { z } from "zod";
import { douyinVideoId } from "../../lib/url.ts";
import { redfoxRequest,RedfoxResponseError } from "./client.ts";
import type { PaidRequestOptions } from "../receipts.ts";
import { douyinOperations,type DouyinOperation } from "./douyin-contract.ts";
const Text=z.string().nullable().optional(),Id=z.string().min(1).max(500).nullable().optional();
const PremiumAccount=z.object({uid:Id,accountId:Text,displayId:Text,nickname:Text,avatarUrl:Text}).passthrough().refine(v=>!!(v.uid||v.accountId||v.displayId||v.nickname),"No recognizable account fields");
const WideAccount=z.object({userId:Id,secureId:Id,uniqueName:Text,shortId:Text,displayName:Text,avatarUrl:Text}).passthrough().refine(v=>!!(v.userId||v.secureId||v.uniqueName||v.displayName),"No recognizable account fields");
const PremiumWork=z.object({workId:Id,title:Text,content:Text,workUrl:Text,coverUrl:Text,audioUrl:Text,workType:Text,publishTime:Text,authorId:Text,accountId:Text,secUid:Id,accountName:Text,authorLink:Text,authorUrl:Text}).passthrough().refine(v=>!!(v.workId||v.title||v.content||v.workUrl),"No recognizable work fields");
const WideWork=z.object({videoId:Id,content:Text,opusUrl:Text,coverUrl:Text,publishTime:Text,authorUid:Id,authorSecUid:Id,authorName:Text,authorUniqueId:Text,authorShortId:Text,imageUrlList:z.array(z.string()).max(1000).nullable().optional()}).passthrough().refine(v=>!!(v.videoId||v.content||v.opusUrl),"No recognizable work fields");
const AiWork=z.object({photoId:Text,authorId:Text,title:Text,url:Text,userName:Text,coverUrl:Text,gmtCreate:Text,gmtModified:Text}).passthrough().refine(v=>!!(v.photoId||v.title||v.url),"No recognizable AI work fields");
const GrowthWork=z.object({aweme_id:Id,author_user_id:Id,aweme_desc:Text,share_url:Text,cover_url:Text,user_nickname:Text,create_time:z.number().int().safe().nullable().optional(),create_time_str:Text}).passthrough().refine(v=>!!(v.aweme_id||v.aweme_desc||v.share_url),"No recognizable ranked work fields");
const AccountRank=z.object({accountLink:Text,accountName:Text,accountRanking:z.number().int().optional(),rankDate:Text,rankPeriod:Text}).passthrough().refine(v=>!!(v.accountLink||v.accountName),"No recognizable account ranking fields");
const List=z.object({list:z.array(z.unknown()).max(1000),total:z.union([z.number().nonnegative(),z.string().regex(/^\d+$/)]).optional(),hasMore:z.union([z.boolean(),z.number().int()]).optional(),pageNum:z.number().int().optional(),pageSize:z.number().int().optional(),pages:z.number().int().optional()}).passthrough();
export interface DouyinIdentity{uid?:string;secUserId?:string}
export interface DouyinResult{kind:"douyin_account"|"douyin_work"|"douyin_account_rank";itemKey:string;data:Record<string,unknown>}
function address(raw:unknown):string|null{if(typeof raw!=="string")return null;try{const u=new URL(raw);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?raw:null;}catch{return null;}}
function account(operation:DouyinOperation,raw:unknown,index:number):DouyinResult{
  if(operation==="L6OUNUN1"){
    const record=WideAccount.parse(raw),identity:DouyinIdentity={...(record.userId?{uid:record.userId}:{}),...(record.secureId?{secUserId:record.secureId}:{})};
    return {kind:"douyin_account",itemKey:`account:${index}`,data:{platform:"douyin",operationId:operation,title:record.displayName??record.uniqueName??"抖音账号",identity,record,missing:Object.keys(identity).length?[]:["缺少 UID 或已确认安全 ID；展示号不能作为稳定身份"]}};
  }
  const record=PremiumAccount.parse(raw),identity:DouyinIdentity=record.uid?{uid:record.uid}:{};
  return {kind:"douyin_account",itemKey:`account:${index}`,data:{platform:"douyin",operationId:operation,title:record.nickname??record.displayId??record.accountId??"抖音账号",identity,record,missing:record.uid?[]:["缺少稳定 UID，可显式查询账号详情"]}};
}
function work(operation:DouyinOperation,raw:unknown,index:number):DouyinResult{
  let record:Record<string,unknown>,identity:DouyinIdentity={},workId:string|null=null,url:string|null=null,title:string|null=null;
  if(["QSL2ZSXM","OWIBYU1V","FK67XDVQ"].includes(operation)){
    const r=WideWork.parse(raw);record=r;workId=r.videoId??null;url=address(r.opusUrl);title=r.content??null;
    identity={...(r.authorUid?{uid:r.authorUid}:{}),...(r.authorSecUid?{secUserId:r.authorSecUid}:{})};
  }else if(operation==="I8P3HTVH"){
    const r=AiWork.parse(raw);record=r;url=address(r.url);title=r.title??null;
  }else if(operation==="WD6UT8DQ"||operation==="0ZB9S2FW"){
    const r=GrowthWork.parse(raw);record=r;workId=r.aweme_id??null;url=address(r.share_url);title=r.aweme_desc??null;if(r.author_user_id)identity.uid=r.author_user_id;
  }else{
    const r=PremiumWork.parse(raw);record=r;workId=r.workId??null;url=address(r.workUrl);title=r.title??r.content??null;
    // accountId/authorId are not documented consistently as UID. QE secUid remains evidence,
    // not an automatic conversion to secUserId or permission-bearing account ownership.
  }
  const missing:string[]=[];
  if(!workId)missing.push("缺少已确认原生作品 ID；不能把 AI photoId 当作 aweme_id");
  if(!url)missing.push("缺少有效原文地址");
  return {kind:"douyin_work",itemKey:`work:${index}`,data:{platform:"douyin",operationId:operation,title:title?.slice(0,200)??"抖音作品",identity,workId,url,missing,record}};
}
export function parseDouyin(operation:DouyinOperation,raw:unknown,parameters:Record<string,unknown>):DouyinResult[]{
  const shape=douyinOperations[operation].shape;
  if(shape==="account"){
    const result=account(operation,raw,0);
    // The endpoint accepts uid, unique_id and short_id; displayId may only expose the preferred one.
    // Do not invent an equality between the requested display token and a returned UID.
    return [result];
  }
  if(shape==="work"){
    const result=work(operation,raw,0),expected=parameters.videoId??parameters.workId;
    if(expected!==undefined&&result.data.workId!==expected)throw new RedfoxResponseError("Douyin work response does not match requested ID");
    const requestedUrlId=typeof parameters.workUrl==="string"?douyinVideoId(parameters.workUrl):null;
    const returnedUrlId=typeof result.data.url==="string"?douyinVideoId(result.data.url):null;
    if(requestedUrlId&&[result.data.workId,returnedUrlId].some(id=>id!=null&&id!==requestedUrlId))throw new RedfoxResponseError("Douyin work response does not match requested native URL");
    return [result];
  }
  if(shape==="account_rank")return z.array(AccountRank).max(1000).parse(raw).map((record,i)=>({kind:"douyin_account_rank",itemKey:`rank:${i}`,data:{platform:"douyin",operationId:operation,title:record.accountName??"抖音账号榜单",identity:{},missing:["榜单只提供主页；稳定账号身份需显式核实"],record}}));
  const rows=shape==="work_rank"||shape==="growth_rank"?z.array(z.unknown()).max(1000).parse(raw):List.parse(raw).list;
  return rows.map((r,i)=>shape==="accounts"?account(operation,r,i):work(operation,r,i));
}
export async function queryDouyin(operation:DouyinOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions,purpose:"query"|"collect"="query"){
  const input=douyinOperations[operation].schema.parse(parameters),receipt=await redfoxRequest(operation,input,window,purpose,options);
  return {...receipt,results:parseDouyin(operation,receipt.data,input)};
}
