import {z} from "zod";
export const xhsCommentPaths={"5AM3X4HZ":"/story/api/xhs/commentSubmit",LO93CE5K:"/story/api/xhs/commentResult"} as const;
const Id=z.string().min(1).max(500).refine(v=>v.trim().length>0);
export const XhsCommentInput=z.object({opusId:Id,dataNum:z.number().int().refine(n=>Number.isSafeInteger(n)&&(n===-1||n>0),"Use a positive safe integer or -1 for all comments")}).strict();
export const XhsCommentQuery=z.object({taskId:Id}).strict();
export const XHS_COMMENT_LIMITS={steps:50,polls:48,retries:3,pollDeadlineSeconds:72*3600,externalAttempts:100,firstPollDelaySeconds:24*3600,pollIntervalSeconds:3600};
const Count=z.union([z.number().int().nonnegative().refine(Number.isSafeInteger),z.string().regex(/^\d+$/)]);
const Picture=z.object({originUrl:z.string().optional(),url:z.string().optional(),width:z.string().optional(),height:z.string().optional(),fileId:z.string().optional()}).passthrough();
const Comment=z.object({commentId:z.string().optional(),noteId:z.string().optional(),commenterId:z.string().optional(),nickname:z.string().optional(),content:z.string().optional(),createTime:z.string().optional(),ipLocation:z.string().optional(),avatar:z.string().optional(),pictures:z.array(Picture).optional(),subCommentCount:Count.optional(),likeNum:Count.optional()}).passthrough().refine(v=>!!v.commentId||typeof v.content==="string","Unrecognized comment record");
export const XhsCommentSubmission=z.object({status:z.literal("pending"),taskId:Id,visibleAfterTime:z.string()}).passthrough();
export function parseXhsCommentPoll(raw:unknown,taskId:string){
 const data=z.object({taskId:Id,status:z.enum(["pending","processing","completed"]),commentList:z.array(Comment).optional(),dataNum:Count.optional(),received:Count.optional()}).passthrough().parse(raw);
 if(data.taskId!==taskId)throw new Error("Comment task identity mismatch");
 if(data.status==="completed"&&!data.commentList)throw new Error("Completed comment task lacks commentList");
 return data;
}
export function commentSafeUrl(value:unknown):string|null{if(typeof value!=="string")return null;try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?value:null;}catch{return null;}}
