import {z} from "zod";
export const videoPaths={JE93E37A:"/story/api/parseWork/videoGen/seedanceSubmit",VBALJNC7:"/story/api/parseWork/videoGen/seedanceResult"} as const;
export const VideoRatio=z.enum(["21:9","16:9","4:3","1:1","3:4","9:16","adaptive"]);
export const VideoResolution=z.enum(["480p","720p"]);
export const VideoRole=z.enum(["first_frame","last_frame","reference_image"]);
export const VIDEO_ROLE_LIMITS={first_frame:1,last_frame:1,reference_image:9} as const;
export const VideoTaskId=z.string().min(1).max(500).refine(v=>v.trim().length>0);
export const VideoInput=z.object({prompt:z.string().min(1).max(10000).refine(v=>v.trim().length>0),aspectRatio:VideoRatio,duration:z.number().int().min(4).max(15),resolution:VideoResolution,generateAudio:z.boolean(),returnLastFrame:z.boolean(),imageWithRoles:z.array(z.object({fileKey:z.string().min(1).max(500),role:VideoRole,uploadResultId:z.number().int().positive().optional()}).strict()).max(11)}).strict().superRefine((v,ctx)=>{
 for(const role of VideoRole.options)if(v.imageWithRoles.filter(r=>r.role===role).length>VIDEO_ROLE_LIMITS[role])ctx.addIssue({code:"custom",message:`Too many ${role} references`});
 const selected=new Map<string,number>();for(const ref of v.imageWithRoles)if(ref.uploadResultId!==undefined){if(selected.has(ref.fileKey)&&selected.get(ref.fileKey)!==ref.uploadResultId)ctx.addIssue({code:"custom",message:"The same asset must select one upload result"});selected.set(ref.fileKey,ref.uploadResultId);}
});
export const VideoQuery=z.object({taskId:VideoTaskId}).strict();
export type VideoParameters=z.infer<typeof VideoInput>;
export const VIDEO_LIMITS={steps:80,polls:60,retries:3,pollDeadlineSeconds:7200,externalAttempts:100,saveAttempts:12,downloadTimeoutMs:60_000,pollIntervalSeconds:10,maxPollIntervalSeconds:30};
export const VideoResourceUrl=z.url().refine(v=>{const u=new URL(v);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password;});
export function parseVideoPoll(raw:unknown,taskId:string){
 const data=z.object({taskId:VideoTaskId,status:z.enum(["processing","completed","failed"]),videoUrl:VideoResourceUrl.nullable().optional(),lastFrameUrl:VideoResourceUrl.nullable().optional(),failReason:z.string().nullable().optional(),progress:z.number().int().min(0).max(100).optional(),seed:z.string().nullable().optional(),model:z.string().min(1).optional(),duration:z.number().int().positive().optional(),aspectRatio:z.string().min(1).optional(),resolution:z.string().min(1).optional(),generateAudio:z.boolean().optional(),usage:z.record(z.string(),z.unknown()).nullable().optional()}).passthrough().parse(raw);
 if(data.taskId!==taskId)throw new Error("Video task identity mismatch");
 if(data.status==="completed"&&(!data.videoUrl||data.failReason?.trim()))throw new Error("Video completion lacks a video or conflicts with failure");
 return data;
}
