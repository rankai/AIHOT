import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
const Text=z.string().min(1),Digits=z.string().regex(/^[0-9]+$/),PositiveDigits=Digits.refine(v=>/[1-9]/.test(v),"页码从 1 开始");
export const qichezhijiaOperations={
 "CI7VW144":{path:"/story/api/autohome/searchWork",label:"汽车之家关键词搜索作品",schema:z.object({keyword: Text, offset: Digits, page: PositiveDigits, sourceType: z.enum(["club","article","video"])}).strict()},
 "LLCI8QTE":{path:"/story/api/autohome/articleDetail",label:"汽车之家文章详情（车家号）",schema:z.object({workId: Text, page: z.number().int().safe()}).strict()},
 "TE6AGWAF":{path:"/story/api/autohome/videoDetail",label:"汽车之家视频详情（原创账号+车家号）",schema:z.object({videoId: Text, videoType: z.union([z.literal(0),z.literal(4)])}).strict()},
 "4BOZ9DLE":{path:"/story/api/autohome/workList",label:"汽车之家作品列表（原创账号）",schema:z.object({authorId: Text, page: z.number().int().safe()}).strict()},
} as const;
export type QichezhijiaOperation=keyof typeof qichezhijiaOperations;
export const QichezhijiaOperationId=z.enum(["CI7VW144", "LLCI8QTE", "TE6AGWAF", "4BOZ9DLE"]);
export function qichezhijiaDescriptors():PlatformOperationDescriptor[]{
 const fields:Record<QichezhijiaOperation,PlatformOperationDescriptor["fields"]>={
"CI7VW144":[{"name": "keyword", "label": "关键词", "type": "string", "required": true, "hint": "搜索关键词"}, {"name": "offset", "label": "翻页偏移量", "type": "string", "required": true, "hint": "翻页偏移量，从0开始，翻页+10"}, {"name": "page", "label": "页码", "type": "string", "required": true, "hint": "页码，从1开始，翻页+1"}, {"name": "sourceType", "label": "内容类型", "type": "select", "required": true, "options": [{"value": "club", "label": "club"}, {"value": "article", "label": "article"}, {"value": "video", "label": "video"}], "hint": "内容类型：club / article / video"}],
"LLCI8QTE":[{"name": "workId", "label": "作品 ID", "type": "string", "required": true, "hint": "作品ID"}, {"name": "page", "label": "页码", "type": "integer", "required": true}],
"TE6AGWAF":[{"name": "videoId", "label": "视频 ID", "type": "string", "required": true, "hint": "视频ID"}, {"name": "videoType", "label": "视频类型", "type": "integer", "required": true, "hint": "视频类型：0=原创账号，4=车家号"}],
"4BOZ9DLE":[{"name": "authorId", "label": "作者 ID", "type": "string", "required": true, "hint": "作者ID"}, {"name": "page", "label": "页码", "type": "integer", "required": true}],
 };
 return (Object.keys(qichezhijiaOperations) as QichezhijiaOperation[]).map(id=>({id,platform:"qichezhijia",label:qichezhijiaOperations[id].label,fields:fields[id],purpose:"只读查询与结果查看；身份保留操作及内容类型范围，不自动导入或关联来源",schedulableType:["CI7VW144", "4BOZ9DLE"].includes(id)?id==="4BOZ9DLE"?"list":"search":null}));
}
