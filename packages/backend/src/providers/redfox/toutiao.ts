import {toutiaoWorkId} from "../../lib/url.ts";
import {z} from "zod";
import {redfoxRequest,RedfoxResponseError} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {toutiaoOperations,type ToutiaoOperation} from "./toutiao-contract.ts";
const Text=z.string().nullable().optional(),Id=z.string().regex(/^[0-9]+$/).nullable().optional(),Count=z.union([z.number().int().nonnegative(),z.string().regex(/^[0-9]+$/)]).nullable().optional();
const Work=z.object({opusId:Text,workId:Text,uid:Id,secUid:Text,opusUrl:Text,workUrl:Text,title:Text,content:Text,nickname:Text,authorName:Text,publishTime:Text,updateTime:Text,duration:z.union([z.string(),z.number().nonnegative()]).nullable().optional(),workType:z.boolean().optional(),hasVideo:z.boolean().optional(),type:Text,pageCount:Count,hasNext:z.boolean().optional(),imageList:z.array(z.string()).optional(),downloadUrl:z.array(z.string()).optional(),repostCount:Count,commentNum:Count,commentCount:Count,likeCount:Count,viewCount:Count,shareCount:Count,collectCount:Count}).passthrough().refine(v=>!!(v.opusId||v.workId||v.title||v.content),"No recognizable Toutiao work fields");
const Account=z.object({uid:Id,homeUrl:Text,nickname:Text,introduction:Text,avatarUrl:Text,fansNum:Text,verify:Text}).passthrough().refine(v=>!!(v.uid||v.nickname||v.introduction),"No recognizable Toutiao account fields");
function safeUrl(value:string|null|undefined):string|null{if(!value)return null;try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?value:null;}catch{return null;}}
export const ToutiaoOrigin=z.object({resultId:z.number().int().positive().safe(),workId:z.string().regex(/^[0-9]+$/),uid:z.string().regex(/^[0-9]+$/).optional(),secUid:z.string().min(1).optional(),discoveredAt:z.iso.datetime()}).strict();
export type ToutiaoOrigin=z.infer<typeof ToutiaoOrigin>;
export interface ToutiaoResult{kind:"toutiao_work"|"toutiao_account"|"query_summary";itemKey:string;data:Record<string,unknown>}
function work(op:ToutiaoOperation,raw:unknown,index:number,parameters:Record<string,unknown>,origin?:ToutiaoOrigin):ToutiaoResult{
 const record=Work.parse(raw),receivedId=op==="28CFGF5I"?record.opusId:record.workId;
 const receivedUrl=op==="28CFGF5I"?record.opusUrl:record.workUrl,nativeId=toutiaoWorkId(receivedUrl);
 if(receivedId&&nativeId&&receivedId!==nativeId)throw new RedfoxResponseError("Toutiao original differs from received work ID");
 const workId=receivedId||nativeId;
 if(op==="PAB6Z75Y"&&workId&&workId!==parameters.opusId)throw new RedfoxResponseError("Toutiao response differs from requested work ID");
 if(origin&&(op!=="PAB6Z75Y"||origin.workId!==parameters.opusId||(workId&&workId!==origin.workId)))throw new RedfoxResponseError("Toutiao detail differs from frozen origin work ID");
 if(origin&&((origin.uid&&record.uid&&origin.uid!==record.uid)||(origin.secUid&&record.secUid&&origin.secUid!==record.secUid)))throw new RedfoxResponseError("Toutiao author differs from frozen same-work evidence");
 const identity=op==="28CFGF5I"&&record.uid?{uid:record.uid}:op==="R1IGR09H"&&record.secUid?{secUid:record.secUid}:op==="PAB6Z75Y"&&origin?{...(origin.uid?{uid:origin.uid}:{}),...(origin.secUid?{secUid:origin.secUid}:{})}:{};
 const url=nativeId?receivedUrl:null,missing:string[]=[];
 if(!workId)missing.push("缺少已收到或可由原文核实的作品 ID");if(!Object.keys(identity).length)missing.push("缺少已收到的稳定作者身份；昵称及请求 token 不能替代");if(!url)missing.push("缺少已核实的头条原文链接；媒体地址不作原文");
 return {kind:"toutiao_work",itemKey:`work:${index}`,data:{platform:"toutiao",operationId:op,title:record.title||"今日头条作品",workId:workId??null,url,identity,missing,record,...(origin?{originResultId:origin.resultId}:{}),...(op==="PAB6Z75Y"?{requestedWorkId:parameters.opusId}:{}),...(op==="28CFGF5I"?{publishTimeUnit:"seconds"}:{}),...(op==="R1IGR09H"&&record.duration!=null?{duration:record.duration,durationUnit:"seconds"}:{})}};
}
export function parseToutiao(op:ToutiaoOperation,raw:unknown,parameters:Record<string,unknown>,context?:unknown):ToutiaoResult[]{
 const origin=context===undefined?undefined:ToutiaoOrigin.parse(context);
 if(op==="PAB6Z75Y")return [work(op,raw,0,parameters,origin)];
 if(op==="28CFGF5I"){const list=z.array(z.unknown()).max(1000).parse(raw);return [...list.map((v,i)=>work(op,v,i,parameters)),{kind:"query_summary",itemKey:"page",data:{platform:"toutiao",operationId:op,count:list.length}}];}
 if(op==="4QS1F8DE"){
  const page=z.object({list:z.array(z.unknown()).max(1000),hasMore:z.boolean().optional(),offset:z.string().optional(),searchId:z.string().optional(),updateTime:Text}).passthrough().parse(raw);
  const results:ToutiaoResult[]=page.list.map((v,i)=>{const record=Account.parse(v);return {kind:"toutiao_account",itemKey:`account:${i}`,data:{platform:"toutiao",operationId:op,title:record.nickname||"今日头条账号",identity:record.uid?{uid:record.uid}:{},url:safeUrl(record.homeUrl),missing:record.uid?[]:["缺少已收到的稳定 uid"],record}};});
  results.push({kind:"query_summary",itemKey:"page",data:{platform:"toutiao",operationId:op,count:page.list.length,...(page.hasMore!==undefined?{hasMore:page.hasMore}:{}),...(page.offset!==undefined?{offset:page.offset}:{}),...(page.searchId!==undefined?{searchId:page.searchId}:{}),...(page.updateTime!==undefined?{updateTime:page.updateTime}:{})}});return results;
 }
 const page=z.object({workList:z.array(z.unknown()).max(1000),hasMore:z.boolean().optional(),offset:z.union([z.number().int().safe(),z.string().regex(/^-?[0-9]+$/)]).optional()}).passthrough().parse(raw);
 return [...page.workList.map((v,i)=>work(op,v,i,parameters)),{kind:"query_summary",itemKey:"page",data:{platform:"toutiao",operationId:op,count:page.workList.length,...(page.hasMore!==undefined?{hasMore:page.hasMore}:{}),...(page.offset!==undefined?{offset:page.offset}:{})}}];
}
export async function queryToutiao(op:ToutiaoOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions,origin?:unknown,purpose:"query"|"collect"="query"){const input=toutiaoOperations[op].schema.parse(parameters),receipt=await redfoxRequest(op,input,window,purpose,options);return {...receipt,results:parseToutiao(op,receipt.data,input,origin)};}
