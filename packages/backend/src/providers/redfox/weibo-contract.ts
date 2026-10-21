import { z } from "zod";
import type { PlatformOperationDescriptor } from "@aihot/contracts/redfox";
const RequestId=z.string().regex(/^\d+$/).max(100);
const Keyword=z.string().trim().min(1).max(200);
export const weiboOperations={
  API_1789098514899:{path:"/story/api/weibo/ability/opusDetail",label:"微博作品详情",schema:z.object({opusId:RequestId}).strict(),schedule:null,
    fields:[{name:"opusId",label:"作品数字 ID",type:"string",required:true,constraints:{pattern:"^[0-9]+$",maxLength:100}}]},
  API_1789098515117:{path:"/story/api/weibo/ability/userDetail",label:"微博用户详情",schema:z.object({userId:RequestId}).strict(),schedule:null,
    fields:[{name:"userId",label:"用户 UID",type:"string",required:true,constraints:{pattern:"^[0-9]+$",maxLength:100}}]},
  API_1789098515245:{path:"/story/api/weibo/ability/accountSearch",label:"微博账号搜索",schema:z.object({page:z.number().int().positive().safe(),keyword:Keyword}).strict(),schedule:null,
    fields:[{name:"keyword",label:"关键词",type:"string",required:true,constraints:{maxLength:200}},{name:"page",label:"页码",type:"integer",required:true,default:1,constraints:{min:1,max:Number.MAX_SAFE_INTEGER}}]},
  TXQPVGJG:{path:"/story/api/weibo/ability/searchWork",label:"微博作品搜索",schema:z.object({searchType:z.enum(["1","3","60","61"]),page:z.string().regex(/^[1-9][0-9]*$/).refine(value=>Number.isSafeInteger(Number(value)),"Page must be a positive safe integer"),keyword:Keyword,extParam:z.enum(["0","2","3"]).optional()}).strict(),schedule:"search",
    fields:[{name:"keyword",label:"关键词",type:"string",required:true,constraints:{maxLength:200}},{name:"searchType",label:"搜索类别",type:"select",required:true,default:"61",options:[{value:"1",label:"综合"},{value:"3",label:"账号（结果类型待核实）"},{value:"60",label:"热门"},{value:"61",label:"实时博文"}]},{name:"page",label:"页码",type:"string",required:true,default:"1",constraints:{pattern:"^[1-9][0-9]*$",max:Number.MAX_SAFE_INTEGER}},{name:"extParam",label:"认证类别",type:"select",required:false,options:[{value:"0",label:"普通用户"},{value:"2",label:"个人认证"},{value:"3",label:"机构认证"}]}]},
  UAQ90A1F:{path:"/story/api/weibo/ability/hotSearch",label:"微博热搜快照",schema:z.object({}).strict(),schedule:"trend",fields:[]},
} as const;
export type WeiboOperation=keyof typeof weiboOperations;
export const WeiboOperationId=z.enum(["API_1789098514899","API_1789098515117","API_1789098515245","TXQPVGJG","UAQ90A1F"]);
export function synchronousOperations():PlatformOperationDescriptor[]{return Object.entries(weiboOperations).map(([id,d])=>({id,platform:"weibo",label:d.label,fields:d.fields,purpose:id==="UAQ90A1F"?"趋势快照，不直接成为新闻材料":"查询与本地导入",schedulableType:d.schedule}));}
