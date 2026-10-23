import { z } from "zod";
import type { PlatformField as Field, PlatformOperationDescriptor } from "@aihot/contracts/redfox";
const Text=z.string().trim().min(1).max(500);
const Decimal=z.string().regex(/^(0|[1-9][0-9]*)$/);
// These few upstream integer parameters have no documented safe-integer ceiling.
// Persist canonical decimal text; only the fixed wire fields below become JSON integers.
const IntegerText=z.union([Decimal,z.number().int().nonnegative().safe().transform(String)]);
const text=(name:string,label:string,required=true,hint?:string):Field=>({name,label,type:"string",required,...(hint?{hint}:{})});
const select=(name:string,label:string,values:readonly string[]):Field=>({name,label,type:"select",required:false,options:values.map(value=>({value,label:value}))});
export const tiktokOperations={
  "6SE9WIHJ":{path:"/story/api/tiktok/ability/awemeDetail",schema:z.object({awemeId:Decimal}).strict(),shape:"work",label:"TikTok 单个作品",fields:[text("awemeId","原生作品 ID")]},
  R473NUE9:{path:"/story/api/tiktok/ability/userAwemeList",schema:z.object({secUserId:Text}).strict(),shape:"works",label:"TikTok 用户主页作品",fields:[text("secUserId","用户安全 ID",true,"接口未提供分页入参")]},
  PXZXY8KQ:{path:"/story/api/tiktok/ability/searchVideo",schema:z.object({keyword:Text,offset:Decimal.optional(),count:Decimal.optional(),sortType:z.enum(["0","1"]).optional(),publishTime:z.enum(["0","1","7","30","90","180"]).optional(),region:z.string().regex(/^[A-Z]{2}$/).optional()}).strict(),shape:"works",label:"TikTok 视频搜索",fields:[text("keyword","关键词"),text("offset","偏移量",false,"十进制字符串"),text("count","数量",false,"十进制字符串"),{...select("sortType","排序",["0","1"]),hint:"0 相关度；1 最多点赞"},{...select("publishTime","发布时间",["0","1","7","30","90","180"]),hint:"0 不限；其余为最近天数"},text("region","地区",false,"ISO 两位大写地区代码；上游默认 US")]},
  VBBTYLMV:{path:"/story/api/tiktok/ability/searchUser",schema:z.object({keyword:Text,offset:Decimal,count:Decimal,followerCountFilter:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]).optional(),profileTypeFilter:z.literal(1).optional(),otherPrefFilter:z.literal(1).optional()}).strict(),shape:"accounts",label:"TikTok 用户搜索",fields:[text("keyword","关键词"),text("offset","偏移量",true,"十进制字符串；返回 cursor 与输入 offset 的映射尚未核实"),text("count","数量",true,"十进制字符串"),{name:"followerCountFilter",label:"粉丝筛选",type:"integer",required:false,constraints:{min:1,max:4},hint:"1 0–1K；2 1K–10K；3 10K–100K；4 100K 以上"},{name:"profileTypeFilter",label:"仅认证用户",type:"integer",required:false,constraints:{min:1,max:1}},{name:"otherPrefFilter",label:"按用户名相关性",type:"integer",required:false,constraints:{min:1,max:1}}]},
  API_1790149158205:{path:"/story/api/tiktok/ability/topicAwemeList",schema:z.object({ch_id:IntegerText,cursor:IntegerText,region:z.enum(["US","GB","FR","JP","VN","SG"]).optional()}).strict(),shape:"paged_works",label:"TikTok 话题作品",fields:[text("ch_id","话题 ID",true,"十进制整数，按原值传输"),text("cursor","游标",true,"十进制整数；首页为 0"),{...select("region","地区",["US","GB","FR","JP","VN","SG"]),hint:"上游默认 US"}]},
  API_1790581450500:{path:"/story/api/tiktok/ability/userFavoriteAwemeList",schema:z.object({sec_user_id:Text,max_cursor:IntegerText}).strict(),shape:"paged_works",label:"TikTok 用户喜欢作品",fields:[text("sec_user_id","收藏者安全 ID",true,"作品归属以每条实际作者为准"),text("max_cursor","游标",true,"十进制整数；首页为 0")]},
  API_1790149281139:{path:"/story/api/tiktok/ability/searchTopic",schema:z.object({keyword:Text,offset:IntegerText}).strict(),shape:"topics",label:"TikTok 话题搜索",fields:[text("keyword","关键词"),text("offset","偏移量",true,"十进制整数；首次为 0；保留上游返回 nextCursor") ]},
} as const;
export type TiktokOperation=keyof typeof tiktokOperations;
export const TiktokOperationId=z.enum(Object.keys(tiktokOperations) as [TiktokOperation,...TiktokOperation[]]);
export function tiktokDescriptors():PlatformOperationDescriptor[]{return Object.entries(tiktokOperations).map(([id,d])=>({id,platform:"tiktok",label:d.label,fields:d.fields,purpose:d.shape==="topics"?"话题研究；不导入文章":"只读查询；稳定身份与原文缺项保留待处理",schedulableType:["R473NUE9", "PXZXY8KQ", "API_1790149158205", "API_1790581450500"].includes(id)?(["R473NUE9", "API_1790149158205", "API_1790581450500"].includes(id)?"list":"search"):null}));}
export function tiktokWireInput(operation:TiktokOperation,input:Record<string,unknown>){
  const keys=operation==="API_1790149158205"?["ch_id","cursor"]:operation==="API_1790581450500"?["max_cursor"]:operation==="API_1790149281139"?["offset"]:[];
  return Object.fromEntries(Object.entries(input).map(([key,value])=>[key,keys.includes(key)?(JSON as JSON & {rawJSON(value:string):unknown}).rawJSON(IntegerText.parse(value)):value]));
}
