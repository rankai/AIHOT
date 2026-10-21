import {z} from "zod";
import {redfoxRequest} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {redfoxAccountOperations,type RedfoxAccountOperation} from "./redfox-account-contract.ts";
const NumberValue=z.union([z.number().finite(),z.string().regex(/^-?\d+(?:\.\d+)?$/)]),Integer=z.union([z.number().int().safe(),z.string().regex(/^-?\d+$/)]);
export interface RedfoxAccountResult{kind:"redfox_balance"|"redfox_consumption"|"query_summary";itemKey:string;data:Record<string,unknown>}
export function parseRedfoxAccount(op:RedfoxAccountOperation,raw:unknown):RedfoxAccountResult[]{
 if(op==="API_1792036841619"){const record=z.object({totalAvailablePoints:NumberValue,freeAvailablePoints:NumberValue,paidAvailablePoints:Integer}).passthrough().parse(raw);return [{kind:"redfox_balance",itemKey:"balance",data:{platform:"redfox",operationId:op,title:"账户积分余额",record,unit:"points",identity:{}}}];}
 const page=z.object({total:Integer,pages:Integer,records:z.array(z.object({points:NumberValue,reason:z.string(),reasonDesc:z.string(),gmtCreate:z.string()}).passthrough()).max(10000)}).parse(raw);
 return [...page.records.map((record,i):RedfoxAccountResult=>({kind:"redfox_consumption",itemKey:`entry:${i}`,data:{platform:"redfox",operationId:op,title:record.reasonDesc||record.reason,record,unit:"points",identity:{},missing:["无唯一请求标识，不能自动关联本地回执实扣；时间未声明时区"]}})),{kind:"query_summary",itemKey:"page",data:{platform:"redfox",operationId:op,count:page.records.length,total:page.total,pages:page.pages}}];
}
export async function queryRedfoxAccount(op:RedfoxAccountOperation,p:Record<string,unknown>,window:string,options:PaidRequestOptions){const input=redfoxAccountOperations[op].schema.parse(p),r=await redfoxRequest(op,input,window,"account",options);return {...r,results:parseRedfoxAccount(op,r.data)};}
