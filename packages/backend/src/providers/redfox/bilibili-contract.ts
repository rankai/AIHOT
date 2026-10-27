import { bilibiliVideoId,bilibiliProfileMid,isBilibiliShortUrl } from "../../lib/url.ts";
import {z} from "zod";
import type {PlatformField as Field,PlatformOperationDescriptor} from "@aihot/contracts/redfox";
const Text=z.string().trim().min(1).max(500),Mid=z.string().regex(/^[0-9]+$/),Bv=z.string().regex(/^BV[A-Za-z0-9]{10}$/),Page=z.string().regex(/^[1-9][0-9]*$/);
const WorkUrl=z.url().refine(v=>!!bilibiliVideoId(v)||isBilibiliShortUrl(v),"Provide a native BV video or b23 single-slug URL");
const AccountUrl=z.url().refine(v=>!!bilibiliProfileMid(v),"Provide a space.bilibili.com/<mid> URL");
const pageSize=z.number().int().positive().max(50).optional();
const text=(name:string,label:string,required=true,hint?:string):Field=>({name,label,type:"string",required,...(hint?{hint}:{})});
const order=(values:string[]):Field=>({name:"order",label:"排序",type:"select",required:false,options:values.map(value=>({value,label:value}))});
const size:Field={name:"pageSize",label:"每页条数",type:"integer",required:false,default:10,constraints:{min:1,max:50}};
const pageField=text("page","页码",true,"从1开始，字符串编码");
export const bilibiliOperations={
 TIN1NMTZ:{path:"/story/api/bili/data/workDetail",label:"B站作品详情（优质库·T+1）",shape:"work",schema:z.object({bvId:Bv.optional(),workUrl:WorkUrl.optional()}).strict().refine(v=>[v.bvId,v.workUrl].filter(Boolean).length===1,"请在 BV号和作品链接中只填写一项"),fields:[text("bvId","BV号",false,"bvId / workUrl 二选一"),text("workUrl","作品链接",false,"原生 video 或 b23.tv；不在本地解析短链")]},
 EH53TOT7:{path:"/story/api/bili/data/accountDetail",label:"B站账号详情（优质库·T+1）",shape:"account",schema:z.object({mid:Mid}).strict(),fields:[text("mid","账号 MID")]},
 ZXJLJQ21:{path:"/story/api/bili/data/accountSearch",label:"B站账号搜索（优质库·T+1）",shape:"accounts",schema:z.object({keyword:Text,page:Page,pageSize,order:z.enum(["follower","like"]).optional()}).strict(),fields:[text("keyword","关键词"),pageField,size,{...order(["follower","like"]),hint:"follower 粉丝数；like 获赞数；留空按相关性"}]},
 LEN9QXR3:{path:"/story/api/bili/data/workSearch",label:"B站作品搜索（优质库·T+1）",shape:"works",schema:z.object({keyword:Text,page:Page,exactMatch:z.boolean().optional(),pageSize,order:z.enum(["time","play","like","comment","favorite"]).optional()}).strict(),fields:[text("keyword","关键词"),pageField,size,{name:"exactMatch",label:"精准匹配",type:"boolean",required:false,default:false},{...order(["time","play","like","comment","favorite"]),hint:"上游默认 time 发布时间"}]},
 VPA67I98:{path:"/story/api/bili/data/accountWorkList",label:"B站账号作品（优质库·T+1）",shape:"account_works",schema:z.object({mid:Mid.optional(),accountUrl:AccountUrl.optional(),page:z.number().int().positive().safe().optional(),pageSize,order:z.enum(["time","play","like"]).optional()}).strict().refine(v=>[v.mid,v.accountUrl].filter(Boolean).length===1,"请在账号 MID和账号主页中只填写一项"),fields:[text("mid","账号 MID",false,"mid / accountUrl 二选一"),text("accountUrl","账号主页",false,"space.bilibili.com/<mid>"),{name:"page",label:"页码",type:"integer",required:false,default:1,constraints:{min:1,max:Number.MAX_SAFE_INTEGER}},size,{...order(["time","play","like"]),hint:"上游默认 time 发布时间"}]},
} as const;
export type BilibiliOperation=keyof typeof bilibiliOperations;
export const BilibiliOperationId=z.enum(Object.keys(bilibiliOperations) as [BilibiliOperation,...BilibiliOperation[]]);
export function bilibiliDescriptors():PlatformOperationDescriptor[]{return Object.entries(bilibiliOperations).map(([id,d])=>({id,platform:"bilibili",label:d.label,fields:d.fields,purpose:"作品按所属信源导入；缺少 BV 作品证据的结果保留待处理",schedulableType:["LEN9QXR3", "VPA67I98"].includes(id)?(["VPA67I98"].includes(id)?"list":"search"):null}));}
