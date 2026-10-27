import {z} from "zod";
import {bilibiliVideoId,bilibiliProfileMid} from "../../lib/url.ts";
import {redfoxRequest,RedfoxResponseError} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {bilibiliOperations,type BilibiliOperation} from "./bilibili-contract.ts";
const Text=z.string().nullable().optional();
const Mid=z.union([z.string().regex(/^[0-9]+$/),z.number().int().nonnegative().safe().transform(String)]).nullable().optional();
const Count=z.union([z.number().int().nonnegative(),z.string().regex(/^[0-9]+$/)]);
const Account=z.object({mid:Mid,name:Text,face:Text,lastCreated:Text}).passthrough().refine(v=>!!(v.mid||v.name),"No recognizable Bilibili account fields");
const Work=z.object({bvId:z.string().regex(/^BV[A-Za-z0-9]{10}$/).nullable().optional(),title:Text,description:Text,created:Text,picUrl:Text,authorId:Mid,author:Text}).passthrough().refine(v=>!!(v.bvId||v.title||v.description),"No recognizable Bilibili work fields");
const Page=z.object({page:Count.optional(),pageSize:Count.optional(),total:Count.optional()}).passthrough();
export interface BilibiliResult{kind:"bilibili_account"|"bilibili_work"|"query_summary";itemKey:string;data:Record<string,unknown>}
function account(op:BilibiliOperation,raw:unknown,index:number):BilibiliResult{const record=Account.parse(raw);return {kind:"bilibili_account",itemKey:`account:${index}`,data:{platform:"bilibili",operationId:op,title:record.name||"B站账号",identity:record.mid?{mid:record.mid}:{},missing:record.mid?[]:["缺少收到的稳定 MID"],record}};}
function work(op:BilibiliOperation,raw:unknown,index:number,outerMid?:string|null):BilibiliResult{
 const record=Work.parse(raw);if(outerMid&&record.authorId&&outerMid!==record.authorId)throw new RedfoxResponseError("Bilibili work author differs from returned account MID");
 const mid=record.authorId??outerMid,missing:string[]=[];if(!record.bvId)missing.push("缺少已确认 BV 号，不能生成原文地址");
 return {kind:"bilibili_work",itemKey:`work:${index}`,data:{platform:"bilibili",operationId:op,title:record.title||"B站作品",workId:record.bvId??null,url:record.bvId?`https://www.bilibili.com/video/${record.bvId}`:null,identity:mid?{mid}:{},missing,record,...(op==="VPA67I98"?{accountMid:outerMid??null}:{})}};
}
export function parseBilibili(op:BilibiliOperation,raw:unknown,parameters:Record<string,unknown>):BilibiliResult[]{
 const shape=bilibiliOperations[op].shape;
 if(shape==="account"){const r=account(op,raw,0);if((r.data.identity as {mid?:string}).mid!==parameters.mid)throw new RedfoxResponseError("Bilibili account differs from requested MID");return [r];}
 if(shape==="work"){const r=work(op,raw,0),requested=parameters.bvId??(typeof parameters.workUrl==="string"?bilibiliVideoId(parameters.workUrl):null);if(requested&&r.data.workId!==requested)throw new RedfoxResponseError("Bilibili work differs from requested BV");return [r];}
 if(shape==="accounts"){const p=Page.extend({accountList:z.array(z.unknown()).max(1000)}).parse(raw);return [...p.accountList.map((r,i)=>account(op,r,i)),{kind:"query_summary",itemKey:"page",data:{platform:"bilibili",operationId:op,count:p.accountList.length,page:p.page??null,pageSize:p.pageSize??null,total:p.total??null}}];}
 const p=Page.extend({workList:z.array(z.unknown()).max(1000),mid:Mid}).parse(raw);
 if(shape==="account_works"){const requested=parameters.mid??(typeof parameters.accountUrl==="string"?bilibiliProfileMid(parameters.accountUrl):null);if(requested&&p.mid!==requested)throw new RedfoxResponseError("Bilibili returned account MID differs from requested account");}
 return [...p.workList.map((r,i)=>work(op,r,i,shape==="account_works"?p.mid:undefined)),{kind:"query_summary",itemKey:"page",data:{platform:"bilibili",operationId:op,count:p.workList.length,page:p.page??null,pageSize:p.pageSize??null,total:p.total??null}}];
}
export async function queryBilibili(op:BilibiliOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions,purpose:"query"|"collect"="query"){const input=bilibiliOperations[op].schema.parse(parameters),receipt=await redfoxRequest(op,input,window,purpose,options);return {...receipt,results:parseBilibili(op,receipt.data,input)};}
