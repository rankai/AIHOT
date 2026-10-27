import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
export function isShipinhaoShareUrl(value:string):boolean{
 if(!/^https?:\/\/weixin\.qq\.com\//i.test(value)||value.includes('#'))return false;
 try{const u=new URL(value);return !u.username&&!u.password&&!u.port&&!u.hash&&/^\/sph\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);}catch{return false;}
}
const page=z.number().int().min(1).safe().optional(),size=z.number().int().min(1).max(50).optional();
export const shipinhaoOperations={
 E7G00COY:{path:"/story/api/sphAllData/searchWork",shape:"works",label:"视频号作品搜索（广域库 · T+1）",schema:z.object({keyword:z.string().trim().min(1),sort:z.enum(["综合","最新","最多点赞","最多收藏"]).optional(),page,size,exactMatch:z.boolean().optional()}).strict()},
 NL4I3533:{path:"/story/api/sphAllData/searchUser",shape:"accounts",label:"视频号账号搜索（广域库 · T+1）",schema:z.object({accountName:z.string().trim().min(1),page,pageSize:size}).strict()},
 OE4KUEUO:{path:"/story/api/sphAllData/queryWorkDetail",shape:"work",label:"视频号作品详情（广域库 · T+1）",schema:z.object({videoId:z.string().min(1)}).strict()},
 OVUTOTCV:{path:"/story/api/sphAllData/queryWorkList",shape:"works",label:"视频号账号作品列表（广域库 · T+1）",schema:z.object({nickname:z.string().trim().min(1),page,size}).strict()},
 MH5YA9DL:{path:"/story/api/sph/ability/workLinkDetail",shape:"share",label:"视频号分享链接详情（实时）",schema:z.object({url:z.string().trim().refine(isShipinhaoShareUrl,"填写 weixin.qq.com/sph/ 视频号分享链接")}).strict()},
} as const;
export type ShipinhaoOperation=keyof typeof shipinhaoOperations;
export const ShipinhaoOperationId=z.enum(["E7G00COY","NL4I3533","OE4KUEUO","OVUTOTCV","MH5YA9DL"]);
export function shipinhaoDescriptors():PlatformOperationDescriptor[]{
 const paging:PlatformOperationDescriptor['fields']=[{name:"page",label:"页码",type:"integer",required:false,default:1,constraints:{min:1}},{name:"size",label:"每页条数",type:"integer",required:false,default:20,constraints:{min:1,max:50}}];
 const fields:Record<ShipinhaoOperation,PlatformOperationDescriptor['fields']>={
 E7G00COY:[{name:"keyword",label:"搜索关键词",type:"string",required:true},{name:"sort",label:"排序",type:"select",required:false,default:"综合",options:["综合","最新","最多点赞","最多收藏"].map(value=>({value,label:value}))},...paging,{name:"exactMatch",label:"精准匹配",type:"boolean",required:false,default:false}],
 NL4I3533:[{name:"accountName",label:"账号名称关键词",type:"string",required:true},paging[0]!,{...paging[1]!,name:"pageSize"}],
 OE4KUEUO:[{name:"videoId",label:"视频 ID",type:"string",required:true,hint:"可从搜索或列表复制 videoId；详情未必回显该字段，不能据请求值建立稳定作者或原文身份"}],
 OVUTOTCV:[{name:"nickname",label:"账号昵称（精准匹配）",type:"string",required:true,hint:"昵称不是稳定作者身份"},...paging],
 MH5YA9DL:[{name:"url",label:"视频号分享链接",type:"string",required:true,hint:"仅支持 weixin.qq.com/sph/，不在本地解析短链"}],
 };
 return (Object.keys(shipinhaoOperations) as ShipinhaoOperation[]).map(id=>({id,platform:"shipinhao",label:shipinhaoOperations[id].label,fields:fields[id],purpose:"作品按所属信源导入；缺少作品或原文证据时保留待处理",schedulableType:["E7G00COY", "OVUTOTCV"].includes(id)?(["OVUTOTCV"].includes(id)?"list":"search"):null}));
}
