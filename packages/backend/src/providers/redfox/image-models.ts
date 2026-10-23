import {z} from "zod";
export const ImageModel=z.enum(["gptImage2","gptImage25","geminiBanana21","seedreamPro","seedreamLite"]);
export type ImageModel=z.infer<typeof ImageModel>;
export const imageModelOf=(parameters:Record<string,unknown>):ImageModel=>parameters.model===undefined?"gptImage2":ImageModel.parse(parameters.model);
export const imagePairs={
 gptImage2:{submit:"ATY07YGY",poll:"849ONCDF"},
 gptImage25:{submit:"API_1791533630312",poll:"API_1791533630405"},
 geminiBanana21:{submit:"API_1791793667945",poll:"API_1791793668017"},
 seedreamPro:{submit:"K8CWLR4I",poll:"HMOMP642"},
 seedreamLite:{submit:"7OM96HCF",poll:"WH5U8KZE"},
} as const;
export const newImagePaths={
 API_1791533630312:"/story/api/parseWork/imageGen/gptImage25Submit",API_1791533630405:"/story/api/parseWork/imageGen/gptImage25Result",
 API_1791793667945:"/story/api/parseWork/imageGen/geminiBanana21Submit",API_1791793668017:"/story/api/parseWork/imageGen/geminiBanana21Result",
 K8CWLR4I:"/story/api/parseWork/imageGen/arkProSubmit",HMOMP642:"/story/api/parseWork/imageGen/arkProResult",
 "7OM96HCF":"/story/api/parseWork/imageGen/arkSubmit",WH5U8KZE:"/story/api/parseWork/imageGen/arkResult",
} as const;
export const Resolution=z.enum(["1k","2k","4k"]);
export const Size=z.enum(["1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","2:1","1:2","21:9","9:21"]);
export const NewTaskId=z.string().min(1).max(500).refine(v=>v.trim().length>0);
const Prompt=z.string().min(1).max(10000).refine(v=>v.trim().length>0);
export const Gpt25Size=z.enum(["1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","21:9"]);
export const GeminiSize=z.enum(["1:1","3:2","2:3","4:3","3:4","16:9","9:16","5:4","4:5","21:9","1:4","4:1","1:8","8:1"]);
export function validSeedreamSize(value:string,lite:boolean){
 if((lite?["2K","3K","4K"]:["1K","2K"]).includes(value))return true;
 const match=/^([1-9]\d*)x([1-9]\d*)$/.exec(value);if(!match)return false;
 const w=Number(match[1]),h=Number(match[2]),pixels=w*h;
 return Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&Number.isSafeInteger(pixels)&&w/h>=1/16&&w/h<=16&&pixels<=(lite?16_777_216:64_000_000)&&(!lite||pixels>=3_686_400);
}
const refs={fileKeys:z.array(z.string().min(1)).max(4).default([]),referenceUploads:z.array(z.object({fileKey:z.string().min(1),resultId:z.number().int().positive()}).strict()).max(4).optional()};
export const OutputFormat=z.enum(["png","jpeg"]);
export const OptimizePromptMode=z.enum(["standard","fast"]);
export const SequentialMode=z.enum(["auto","disabled"]);
export const MAX_GROUP_IMAGES=10;
export const GeminiResolution=z.enum(["1K","2K","4K"]);
const seed={prompt:Prompt,...refs,watermark:z.boolean().optional(),outputFormat:OutputFormat.optional(),responseFormat:z.literal("url").default("url"),optimizePromptOptions:z.object({mode:OptimizePromptMode}).strict().optional()};
const Old=z.object({model:z.literal("gptImage2").optional(),prompt:z.string().trim().min(1).max(10000),resolution:Resolution,size:Size,n:z.number().int().min(1).max(4),fileKeys:z.array(z.string()).max(2).default([])}).strict();
export const ImageInput=z.union([
 Old,
 z.object({model:z.literal("gptImage25"),prompt:Prompt,resolution:Resolution,size:Gpt25Size,background:z.literal("transparent").optional(),...refs}).strict(),
 z.object({model:z.literal("geminiBanana21"),prompt:Prompt,size:GeminiSize,metadata:z.object({resolution:GeminiResolution}).strict(),...refs}).strict(),
 z.object({model:z.literal("seedreamPro"),...seed,size:z.string().refine(v=>validSeedreamSize(v,false),"Use 1K/2K or positive WxH, ratio 1:16–16:1, local maximum 64 MP")}).strict(),
 z.object({model:z.literal("seedreamLite"),...seed,size:z.string().refine(v=>validSeedreamSize(v,true),"Use 2K/3K/4K or 3686400–16777216 pixels, ratio 1:16–16:1"),sequentialImageGeneration:SequentialMode.default("disabled"),sequentialImageGenerationOptions:z.object({maxImages:z.number().int().min(1).max(MAX_GROUP_IMAGES)}).strict().optional()}).strict().refine(v=>v.sequentialImageGeneration==="auto"?!!v.sequentialImageGenerationOptions:v.sequentialImageGenerationOptions===undefined,"Group options are required only for auto generation"),
]).superRefine((v,ctx)=>{
 if(new Set(v.fileKeys).size!==v.fileKeys.length)ctx.addIssue({code:"custom",message:"Duplicate reference file"});
 if("referenceUploads" in v&&v.referenceUploads){const keys=v.referenceUploads.map(r=>r.fileKey);if(new Set(keys).size!==keys.length||keys.some(k=>!v.fileKeys.includes(k)))ctx.addIssue({code:"custom",message:"Selected uploads must uniquely match reference files"});}
});
export type ImageParameters=z.infer<typeof ImageInput>;
export const SafeImageUrl=z.url().refine(v=>{const u=new URL(v);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password;},"Expected an HTTP(S) resource without credentials");
