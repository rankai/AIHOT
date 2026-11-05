import { z } from "zod";
export const COVER_VISION_OPERATION = "assistant.coverVision";
export const COVER_PREPROCESS_VERSION = "cover-static-1200-webp-v1";
export const VisionExtra = z.object({thinking:z.object({type:z.enum(["enabled","disabled"]),clear_thinking:z.boolean().optional()}).strict().optional(),reasoning_effort:z.enum(["none","minimal","low","medium","high","xhigh"]).optional(),top_p:z.number().min(0).max(1).optional(),enable_thinking:z.boolean().optional()}).strict();
export const VisionModel = z.object({version:z.literal(1),key:z.string().min(1),service:z.string().min(1),model:z.string().min(1),baseURL:z.string().url(),apiKeyEnv:z.string().min(1),extra:VisionExtra,vision:z.literal(true),jsonMode:z.boolean(),
 limits:z.object({images:z.literal(20),batchImages:z.literal(5),batches:z.literal(4),longEdge:z.literal(1200),imageBytes:z.literal(1048576),batchBytes:z.literal(5242880),maxOutputTokens:z.literal(4096)}).strict()}).strict();
export const CoverVisionProposal=z.object({activationId:z.string().uuid(),samples:z.array(z.object({sourceId:z.string().min(1).max(200),reason:z.string().trim().min(1).max(300)}).strict()).max(20)}).strict();
export const CoverVisionInput=z.object({assistantParentTurnId:z.string().uuid(),activationId:z.string().uuid(),queryRunId:z.number().int().positive(),
 selections:z.array(z.object({resultId:z.number().int().positive(),sourceId:z.string().min(1).max(200),reason:z.string().max(300),coverUrl:z.string().url()}).strict()).min(1).max(20),model:VisionModel,preprocessVersion:z.literal(COVER_PREPROCESS_VERSION)}).strict();
export const CoverObservation=z.preprocess(raw=>{
 if(raw && typeof raw==='object' && 'status' in raw && raw.status==='observed' && !('uncertainties' in raw))
  return {...raw,uncertainties:['模型未提供不确定项说明']};
 return raw;
},z.object({sourceId:z.string().min(1).max(200),status:z.enum(["observed","unreadable"]),text:z.string().max(1200),subject:z.string().max(500),colors:z.string().max(500),layout:z.string().max(1000),uncertainties:z.array(z.string().max(200)).max(8)}).strict().refine(o=>o.status==="observed"?[o.text,o.subject,o.colors,o.layout].some(value=>value.trim().length>0):o.uncertainties.some(value=>value.trim().length>0),"observed须有至少一项实际观察；unreadable须说明无法判定的原因"));
export type VisionModelSnapshot=z.infer<typeof VisionModel>;
export type VisionInput=z.infer<typeof CoverVisionInput>;
export type Observation=z.infer<typeof CoverObservation>;
