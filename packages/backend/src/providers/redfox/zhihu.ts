import {z} from "zod";
import {redfoxRequest} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {zhihuOperations,type ZhihuOperation} from "./zhihu-contract.ts";
const Text=z.string().nullable().optional();
const Work=z.object({opusId:Text,uid:Text,nickname:Text,title:Text,publishTime:z.union([z.number().int().safe(),z.string().regex(/^-?[0-9]+$/)]).nullable().optional(),isEnd:z.boolean().nullable().optional()}).passthrough().refine(r=>!!(r.opusId||r.title),"No recognizable Zhihu work fields");
export interface ZhihuResult{kind:"zhihu_work"|"query_summary";itemKey:string;data:Record<string,unknown>}
export function parseZhihu(op:ZhihuOperation,raw:unknown,p:Record<string,unknown>):ZhihuResult[]{const rows=z.array(Work).max(1000).parse(raw);return [...rows.map((record,i):ZhihuResult=>({kind:"zhihu_work",itemKey:`work:${i}`,data:{platform:"zhihu",operationId:op,title:record.title||"知乎作品",identity:record.uid?{uid:record.uid}:{},identityNamespace:{operationId:op},workId:record.opusId??null,workNamespace:{operationId:op,vertical:p.vertical??null},record,requestContext:p,missing:[...(!record.opusId?["缺少已收作品 ID"]:[]),...(!record.uid?["缺少已收作者 uid"]:[]),"缺少响应原文链接；不按作品 ID 猜地址","发布时间单位未明确，保留原值"]}})),{kind:"query_summary",itemKey:"page",data:{platform:"zhihu",operationId:op,count:rows.length}}];}
export async function queryZhihu(op:ZhihuOperation,p:Record<string,unknown>,window:string,options:PaidRequestOptions,purpose:"query"|"collect"="query"){const input=zhihuOperations[op].schema.parse(p),r=await redfoxRequest(op,input,window,purpose,options);return {...r,results:parseZhihu(op,r.data,input)};}
