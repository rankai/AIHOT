import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
const digits=z.string().regex(/^[0-9]+$/),categories=["profile_all","pc_profile_article","pc_profile_video","pc_profile_ugc","profile_wenda","pc_profile_short_video"] as const;
export const toutiaoOperations={
 "28CFGF5I":{path:"/story/api/toutiao/searchWork",shape:"works",label:"今日头条作品搜索（实时）",schema:z.object({keyword:z.string().trim().min(1),offset:digits}).strict()},
 PAB6Z75Y:{path:"/story/api/toutiao/workDetail",shape:"work",label:"今日头条作品详情（实时）",schema:z.object({opusId:z.string().min(1)}).strict()},
 "4QS1F8DE":{path:"/story/api/toutiao/searchAccount",shape:"accounts",label:"今日头条账号搜索（实时）",schema:z.object({name:z.string().trim().min(1),offset:z.string().optional(),searchId:z.string().optional()}).strict()},
 R1IGR09H:{path:"/story/api/toutiao/userWorkList",shape:"accountWorks",label:"今日头条账号作品列表（实时）",schema:z.object({category:z.enum(categories),token:z.string().min(1),offset:digits}).strict()},
} as const;
export type ToutiaoOperation=keyof typeof toutiaoOperations;
export const ToutiaoOperationId=z.enum(["28CFGF5I","PAB6Z75Y","4QS1F8DE","R1IGR09H"]);
export function toutiaoDescriptors():PlatformOperationDescriptor[]{
 const offset={name:"offset",label:"翻页偏移量",type:"string" as const,required:true,default:"0",hint:"首次填 0；按字符串保留数字"};
 const fields:Record<ToutiaoOperation,PlatformOperationDescriptor['fields']>={
 "28CFGF5I":[{name:"keyword",label:"搜索关键词",type:"string",required:true},{...offset,hint:"首次填 0，后续每页加 1；按字符串传递"}],
 PAB6Z75Y:[{name:"opusId",label:"作品 ID",type:"string",required:true}],
 "4QS1F8DE":[{name:"name",label:"账号搜索关键词",type:"string",required:true},{name:"offset",label:"下一页游标",type:"string",required:false,hint:"使用上次返回的原始 offset"},{name:"searchId",label:"搜索上下文 ID",type:"string",required:false,hint:"翻页时保留原始 searchId"}],
 R1IGR09H:[{name:"category",label:"内容分类",type:"select",required:true,options:categories.map((value,index)=>({value,label:["全部","文章","视频","微头条","问答","小视频"][index]!}))},{name:"token",label:"主页 token",type:"string",required:true,hint:"来自 /c/user/token/ 路径；不是账号搜索返回的数字 uid"},offset],
 };
 return (Object.keys(toutiaoOperations) as ToutiaoOperation[]).map(id=>({id,platform:"toutiao",label:toutiaoOperations[id].label,fields:fields[id],purpose:"只读查询与结果查看；昵称及请求 token 不证明已收到作者身份",schedulableType:["28CFGF5I", "R1IGR09H"].includes(id)?(["R1IGR09H"].includes(id)?"list":"search"):null}));
}
