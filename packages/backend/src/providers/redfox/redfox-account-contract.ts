import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";

export const redfoxAccountOperations={
 "API_1792036841619":{path:"/story/web/points/api-key/balance",method:"GET",label:"用户余额查询",schema:z.object({}).strict()},
 "API_1792043329817":{path:"/story/web/points/api-key/consume-flows",method:"GET",label:"接口调用记录查询",schema:z.object({pageNum:z.string().optional(),pageSize:z.string().optional()}).strict()},
} as const;
export type RedfoxAccountOperation=keyof typeof redfoxAccountOperations;
export const RedfoxAccountOperationId=z.enum(["API_1792036841619", "API_1792043329817"]);
export function redfoxAccountDescriptors():PlatformOperationDescriptor[]{
 const fields:Record<RedfoxAccountOperation,PlatformOperationDescriptor["fields"]>={"API_1792036841619": [], "API_1792043329817": [{"name": "pageNum", "label": "页码", "type": "string", "required": false, "hint": "页码；未声明默认值，不自动填充"}, {"name": "pageSize", "label": "每页条数", "type": "string", "required": false, "hint": "条数；未声明默认值，不自动填充"}]};
 return (Object.keys(redfoxAccountOperations) as RedfoxAccountOperation[]).map(id=>({id,platform:"redfox-account",label:redfoxAccountOperations[id].label,fields:fields[id],purpose:"账户积分只读快照；不代表逐回执实扣对账；密钥仅服务器注入",schedulableType:null}));
}
