import {z} from "zod";
import {redfoxRequest} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {zhihuOperations,type ZhihuOperation} from "./zhihu-contract.ts";
const Text=z.string().nullable().optional();
const Work=z.object({opusId:Text,uid:Text,nickname:Text,title:Text,publishTime:z.union([z.number().int().safe(),z.string().regex(/^-?[0-9]+$/)]).nullable().optional(),isEnd:z.boolean().nullable().optional()}).passthrough().refine(r=>!!(r.opusId||r.title),"No recognizable Zhihu work fields");
export interface ZhihuResult{kind:"zhihu_work"|"query_summary"|"social_comment"|"zhihu_account"|"zhihu_hot_search";itemKey:string;data:Record<string,unknown>}
export function parseZhihu(op:ZhihuOperation,raw:unknown,p:Record<string,unknown>):ZhihuResult[]{
 const base={platform:"zhihu",operationId:op};
 if(op==="API_1792651427872"){
  const record=z.object({opusId:z.string().regex(/^[0-9]+$/),type:z.literal("article"),opusUrl:z.string(),title:z.string().min(1),content:Text,publishTime:z.number().int().safe().nonnegative().nullable().optional(),authorUid:Text,authorNickname:Text}).passthrough().parse(raw);
  if(record.opusId!==p.articleId||!zhihuArticleUrl(record.opusUrl,record.opusId))throw new Error("Zhihu article detail identity or original URL mismatch");
  return [{kind:"zhihu_work",itemKey:"work",data:{...base,title:record.title,url:record.opusUrl,workId:record.opusId,workNamespace:{operationId:op,vertical:"article"},identity:record.authorUid?{uid:record.authorUid}:{},record,requestContext:p,missing:[],timeUnits:{publishTime:"seconds"}}}];
 }
 if(op==="API_1792651427970"){
  const data=z.object({items:z.array(z.object({id:z.string().min(1),content:z.string(),nickname:Text,avatorUrl:Text,urlToken:Text,likeNum:Text,publishTime:z.string().regex(/^[0-9]+$/).nullable().optional()}).passthrough()).max(1000),nextUrl:Text}).passthrough().parse(raw);
  return [...data.items.map((record,i):ZhihuResult=>({kind:"social_comment",itemKey:`comment:${i}`,data:{...base,role:"comment",title:record.nickname??"知乎评论",identity:record.urlToken?{urlToken:record.urlToken}:{},record,requestedScope:{articleId:p.articleId},requestContext:p,timeUnits:{publishTime:"seconds"}}})),{kind:"query_summary",itemKey:"page",data:{...base,role:"social-research-summary",count:data.items.length,requestContext:p,reportedPaging:{data:{nextUrl:data.nextUrl??null}}}}];
 }
 if(op==="API_1792651512423"){
  const record=z.object({urlToken:z.string().min(1),nickname:Text,homeUrl:Text}).passthrough().parse(raw);
  return [{kind:"zhihu_account",itemKey:"account",data:{...base,title:record.nickname??"知乎账号",record,requestContext:p}}];
 }
 if(op==="API_1792651658984"){
  const rows=z.array(z.object({title:z.string().min(1),hotValue:Text,label:Text,rank:z.number().int().nonnegative()}).passthrough()).max(1000).parse(raw);
  return [...rows.map((record,i):ZhihuResult=>({kind:"zhihu_hot_search",itemKey:`hot:${i}`,data:{...base,title:record.title,record,requestContext:p}})),{kind:"query_summary",itemKey:"page",data:{...base,count:rows.length}}];
 }
 const rows=z.array(Work).max(1000).parse(raw);return [...rows.map((record,i):ZhihuResult=>({kind:"zhihu_work",itemKey:`work:${i}`,data:{platform:"zhihu",operationId:op,title:record.title||"知乎作品",identity:record.uid?{uid:record.uid}:{},identityNamespace:{operationId:op},workId:record.opusId??null,workNamespace:{operationId:op,vertical:p.vertical??null},record,requestContext:p,missing:[...(!record.opusId?["缺少已收作品 ID"]:[]),"缺少响应原文链接；不按作品 ID 猜地址","发布时间单位未明确，保留原值"]}})),{kind:"query_summary",itemKey:"page",data:{platform:"zhihu",operationId:op,count:rows.length}}];}
export async function queryZhihu(op:ZhihuOperation,p:Record<string,unknown>,window:string,options:PaidRequestOptions,purpose:"query"|"collect"="query"){const input=zhihuOperations[op].schema.parse(p),r=await redfoxRequest(op,input,window,purpose,options);return {...r,results:parseZhihu(op,r.data,input)};}

export function zhihuArticleUrl(raw:unknown,id:string):string|null{
 if(typeof raw!=="string")return null;
 try{const u=new URL(raw);return ["http:","https:"].includes(u.protocol)&&u.hostname==="zhuanlan.zhihu.com"&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname===`/p/${id}`?raw:null;}catch{return null;}
}
