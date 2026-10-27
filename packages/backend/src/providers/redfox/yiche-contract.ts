import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
const Text=z.string().min(1);
export const yicheOperations={
 "3BXWEB6Y":{path:"/story/api/yiche/videoDetail",label:"易车视频详情",schema:z.object({workId: Text}).strict()},
 "9KFOB9M2":{path:"/story/api/yiche/searchAccount",label:"易车账号搜索",schema:z.object({keyword: Text, page: z.number().int().safe().positive()}).strict()},
 "YGYYT0G0":{path:"/story/api/yiche/workList",label:"易车全部作品列表",schema:z.object({userId: Text, timestamp: z.string().optional()}).strict()},
 "YIGCY5US":{path:"/story/api/yiche/searchWork",label:"易车关键词搜索作品",schema:z.object({keyword: Text, page: z.number().int().safe().positive(), sourceType: z.enum(["club","shipin","xinwen"])}).strict()},
 "VYSP68M2":{path:"/story/api/yiche/articleDetailV2",label:"易车文章详情V2",schema:z.object({url: z.url().refine(v => { const u=new URL(v); return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password; }, "需要 HTTP(S) 文章链接")}).strict()},
} as const;
export type YicheOperation=keyof typeof yicheOperations;
export const YicheOperationId=z.enum(["3BXWEB6Y", "9KFOB9M2", "YGYYT0G0", "YIGCY5US", "VYSP68M2"]);
export function yicheDescriptors():PlatformOperationDescriptor[]{
 const fields:Record<YicheOperation,PlatformOperationDescriptor["fields"]>={
"3BXWEB6Y":[{"name": "workId", "label": "作品 ID", "type": "string", "required": true, "hint": "易车视频作品ID"}],
"9KFOB9M2":[{"name": "keyword", "label": "关键词", "type": "string", "required": true, "hint": "搜索关键词"}, {"name": "page", "label": "页码", "type": "integer", "required": true, "hint": "页码，从1开始"}],
"YGYYT0G0":[{"name": "userId", "label": "用户 ID", "type": "string", "required": true, "hint": "用户ID"}, {"name": "timestamp", "label": "翻页时间戳", "type": "string", "required": false, "hint": "首页可省略或传空字符串；翻页传前页最后一条 publishTime 原串，不自动填当前时间"}],
"YIGCY5US":[{"name": "keyword", "label": "关键词", "type": "string", "required": true, "hint": "搜索关键词"}, {"name": "page", "label": "页码", "type": "integer", "required": true, "hint": "页码，从1开始，翻页+1"}, {"name": "sourceType", "label": "内容类型", "type": "select", "required": true, "options": [{"value": "club", "label": "club"}, {"value": "shipin", "label": "shipin"}, {"value": "xinwen", "label": "xinwen"}], "hint": "内容类型 club：社区；shipin：视频；xinwen：文章"}],
"VYSP68M2":[{"name": "url", "label": "文章链接", "type": "string", "required": true, "hint": "文章URL"}],
 };
 return (Object.keys(yicheOperations) as YicheOperation[]).map(id=>({id,platform:"yiche",label:yicheOperations[id].label,fields:fields[id],purpose:"只读查询与结果查看；身份保留操作及内容类型范围，不自动导入或关联来源",schedulableType:["YIGCY5US", "YGYYT0G0"].includes(id)?id==="YGYYT0G0"?"list":"search":null}));
}
