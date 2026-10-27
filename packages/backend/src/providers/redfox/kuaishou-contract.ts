import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
const page=z.number().int().min(1).safe().default(1),size=z.number().int().min(1).max(50).default(20);
export const kuaishouOperations={
 GU17EVLV:{path:"/story/api/ksAllData/searchUser",shape:"accounts",label:"快手账号搜索（广域库 · T+1）",schema:z.object({accountName:z.string().trim().min(1),page,pageSize:size}).strict()},
 "27DQ6SF9":{path:"/story/api/ksAllData/queryWorkList",shape:"works",label:"快手账号作品列表（广域库 · T+1）",schema:z.object({kwaiId:z.string().min(1).optional(),threeXId:z.string().min(1).optional(),page,size}).strict().refine(v=>!!v.kwaiId!==!!v.threeXId,"kwaiId 与 threeXId 必须且只能填写一个")},
 UOM99OQI:{path:"/story/api/ksAllData/queryWorkDetail",shape:"work",label:"快手作品详情（广域库 · T+1）",schema:z.object({photoId:z.string().min(1)}).strict()},
 ZWR31P2A:{path:"/story/api/ksAllData/searchWork",shape:"works",label:"快手作品搜索（广域库 · T+1）",schema:z.object({keyword:z.string().trim().min(1),page,size,sort:z.enum(["综合","最新","最多点赞","最多收藏"]).default("综合")}).strict()},
} as const;
export type KuaishouOperation=keyof typeof kuaishouOperations;
export const KuaishouOperationId=z.enum(["GU17EVLV","27DQ6SF9","UOM99OQI","ZWR31P2A"]);
export function kuaishouDescriptors():PlatformOperationDescriptor[]{
 const paging:PlatformOperationDescriptor['fields']=[{name:"page",label:"页码",type:"integer",required:false,default:1,constraints:{min:1}},{name:"size",label:"每页条数",type:"integer",required:false,default:20,constraints:{min:1,max:50}}];
 const fields:Record<KuaishouOperation,PlatformOperationDescriptor['fields']>={
 GU17EVLV:[{name:"accountName",label:"账号名称关键词",type:"string",required:true},paging[0]!,{...paging[1]!,name:"pageSize"}],
 "27DQ6SF9":[{name:"kwaiId",label:"账号展示号",type:"string",required:false,hint:"与主页定位 ID 恰填一个；展示号不是永久身份"},{name:"threeXId",label:"主页定位 ID",type:"string",required:false,hint:"来自快手 /profile/ 路径；不推断其与展示号的永久等价关系"},...paging],
 UOM99OQI:[{name:"photoId",label:"作品 ID",type:"string",required:true,hint:"从列表复制原始 photoId；详情未必回显"}],
 ZWR31P2A:[{name:"keyword",label:"搜索关键词",type:"string",required:true},...paging,{name:"sort",label:"排序",type:"select",required:false,default:"综合",options:["综合","最新","最多点赞","最多收藏"].map(value=>({value,label:value}))}],
 };
 return (Object.keys(kuaishouOperations) as KuaishouOperation[]).map(id=>({id,platform:"kuaishou",label:kuaishouOperations[id].label,fields:fields[id],purpose:"作品按所属信源导入；缺少作品或原文证据时保留待处理；省略分页时发送文档默认值",schedulableType:["27DQ6SF9", "ZWR31P2A"].includes(id)?(["27DQ6SF9"].includes(id)?"list":"search"):null}));
}
