import {assertGenerationReference,confirmMediaUpload,uploadMediaReference} from "./media-upload.ts";
import {OutputFormat,OptimizePromptMode,SequentialMode,MAX_GROUP_IMAGES,GeminiResolution} from "./image-models.ts";
import { ImageInput, ImageModel, imageModelOf, imagePairs, Resolution, Size, NewTaskId, SafeImageUrl, Gpt25Size, GeminiSize, type ImageParameters } from "./image-models.ts";
export {ImageInput};
export type {ImageParameters};
import { z } from "zod";
import { sql } from "../../db.ts";
import { stableJson } from "../../lib/ids.ts";
import { assetPath, getAsset, IMAGE_BYTES, IMAGE_PIXELS, OUTPUT_IMAGE_BYTES, OUTPUT_IMAGE_PIXELS, lockAssetInputs } from "../../operations/assets.ts";
import { createRun, StaleOperationError, type RunRow } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import { redfoxRequest, RedfoxResponseError } from "./client.ts";
import type { PaidRequestOptions } from "../receipts.ts";

export const IMAGE_LIMITS = {steps:70,polls:60,retries:3,pollDeadlineSeconds:7200,externalAttempts:100,saveAttempts:12,downloadTimeoutMs:60_000,pollIntervalSeconds:10,maxPollIntervalSeconds:30};
export function imageLimits(run:RunRow):typeof IMAGE_LIMITS {
  const limits={} as typeof IMAGE_LIMITS;
  for(const key of Object.keys(IMAGE_LIMITS) as Array<keyof typeof IMAGE_LIMITS>){
    const value=run.limits[key];
    if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0)throw new Error("Image run lacks valid frozen limits; review before continuing");
    limits[key]=value;
  }
  return limits;
}
export function createImageGeneration(raw:unknown,actor:string,key:unknown){return imageCommand(ImageInput.parse(raw),actor,key,false);}
export function createImageQuery(raw:unknown,actor:string,key:unknown){return imageCommand(z.object({model:ImageModel.optional(),taskId:NewTaskId}).strict().parse(raw),actor,key,true);}
async function imageCommand(parameters:Record<string,unknown>,actor:string,key:unknown,query:boolean){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  const operation=query?"redfox.image.query":"redfox.image.generate",intent={operation,parameters};
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
    const [existing]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;
    if(existing){if(stableJson(existing.input.commandIntent)!==stableJson(intent))throw new StaleOperationError("Command key reused with different input");return existing;}
    const fileKeys=(parameters.fileKeys??[]) as string[];
    await lockAssetInputs(tx,fileKeys);
    const references: Array<{fileKey:string;resultId:number;resourceUrl:string;format:string;sha256:string;base:string}>=[];
    for(const key of fileKeys){const [asset]=await tx`SELECT bytes,content_type,metadata,sha256 FROM stored_files WHERE key=${key}`;
      assertGenerationReference(asset! as {bytes:number;content_type:string;metadata:Record<string,unknown>});
      const selected=(parameters.referenceUploads as Array<{fileKey:string;resultId:number}>|undefined)?.find(r=>r.fileKey===key);
      if(selected)references.push(await confirmMediaUpload(tx,key,selected.resultId,asset! as {bytes:number;content_type:string;sha256:string}));
    }
    const newer=imageModelOf(parameters)!=="gptImage2";
    const run=await createRun(tx,{actor,commandKey,provider:"redfox",operationKey:operation,contractVersion:1,
      input:{commandIntent:intent,parameters,fileKeys,...(newer?{confirmedReferenceUploads:references}:{}),mode:query?"image-query":"image",startedAt:new Date().toISOString()},
      stepKey:query?"redfox.image.poll":fileKeys.length?"redfox.image.upload":"redfox.image.submit",limits:{...IMAGE_LIMITS,...(newer?{steps:80,saveAttempts:30}:{})}});
    await tx`UPDATE operation_runs SET progress=${tx.json({referenceImages:[],uploadIndex:0,pollSequence:0,...(query?{taskId:parameters.taskId}: {})} as never)} WHERE id=${run.id}`;
    await queueOperationStep(tx,run.id);return run;
  });
}
export async function uploadReference(key:string,identity:string,paid:PaidRequestOptions,model:ImageModel="gptImage2"){
  if(model!=="gptImage2")return uploadMediaReference(key,identity,paid);
  const asset=await getAsset(key);
  const format=z.enum(["png","jpeg","webp"]).parse(asset.content_type.split("/")[1]);
  const result=await redfoxRequest("FXDGJO1V",{fileKey:key,sha256:asset.sha256,format},identity,"media",paid,{file:assetPath(key),format,mime:asset.content_type});
  const data=z.object({imageUrl:SafeImageUrl,format:z.string()}).parse(result.data);
  if(data.format!==format)throw new RedfoxResponseError("Uploaded image format mismatch");
  return {...result,data};
}
export async function submitImage(parameters:ImageParameters,referenceImages:string[],identity:string,paid:PaidRequestOptions){
  const {fileKeys:_,model:_model,...rest}=parameters;
  let input:Record<string,unknown>;
  switch(parameters.model){
    case "gptImage25": {const {referenceUploads:__,...p}=rest as Record<string,unknown>;input={...p,referenceImages};break;}
    case "geminiBanana21": {const {referenceUploads:__,...p}=rest as Record<string,unknown>;input={...p,imageUrls:referenceImages};break;}
    case "seedreamPro":case "seedreamLite": {const {referenceUploads:__,...p}=rest as Record<string,unknown>;input={...p,...(referenceImages.length?{image:referenceImages}:{}),responseFormat:"url"};break;}
    default:input={...rest,referenceImages};
  }
  const result=await redfoxRequest(imagePairs[imageModelOf(parameters)].submit,input,identity,"image",paid);
  return {...result,data:z.object({taskId:NewTaskId}).passthrough().parse(result.data)};
}
export function parseImagePoll(raw:unknown,taskId:string,model:ImageModel="gptImage2"){
  const seed=model==="seedreamPro"||model==="seedreamLite";
  const data=z.object({taskId:NewTaskId,status:seed?z.enum(["queued","running","succeeded","failed"]):z.enum(["queued","in_progress","completed","failed"]),progress:z.number().int().min(0).max(100).optional(),imageUrls:z.array(SafeImageUrl).max(model==="gptImage2"?4:10).optional(),failReason:z.string().nullable().optional(),model:z.string().min(1).optional(),resolution:z.string().optional(),size:z.string().optional(),metadata:z.record(z.string(),z.unknown()).optional(),usage:z.record(z.string(),z.unknown()).optional()}).passthrough().parse(raw);
  if(data.taskId!==taskId || (imageSucceeded(data.status)&&(!data.imageUrls?.length||!!data.failReason?.trim())))throw new RedfoxResponseError("Image result task or successful output/failure mismatch");
  return data;
}
export const imageSucceeded=(status:string)=>status==="completed"||status==="succeeded";
export async function pollImage(taskId:string,identity:string,paid:PaidRequestOptions,model:ImageModel="gptImage2"){
  const result=await redfoxRequest(imagePairs[model].poll,{taskId},identity,"poll",paid);
  return {...result,data:parseImagePoll(result.data,taskId,model)};
}
export function imageOptions(){return {modelLabel:"Redfox GPT-Image-2",resolutions:Resolution.options,sizes:Size.options,maxImages:4,maxReferences:2,referenceBytes:IMAGE_BYTES,referencePixels:IMAGE_PIXELS,outputBytes:OUTPUT_IMAGE_BYTES,outputPixels:OUTPUT_IMAGE_PIXELS,pollLimit:IMAGE_LIMITS.polls,pollDeadlineSeconds:IMAGE_LIMITS.pollDeadlineSeconds,uploadTransportVerified:false,services:{referenceUpload:"redfox.media",submission:"redfox.image",poll:"redfox.poll"},submissionCost:null,
 models:[{model:"gptImage2",label:"Redfox GPT-Image-2",maxReferences:2,maxImages:4},
 {model:"gptImage25",label:"Redfox GPT-Image-2.5",resolutions:Resolution.options,sizes:Gpt25Size.options,background:["transparent"],maxReferences:4,referenceLimitBasis:"local",maxOutputImages:10,documentedBaseCny:1.5},
 {model:"geminiBanana21",label:"Redfox Gemini Banana 2.1",resolutions:GeminiResolution.options,sizes:GeminiSize.options,maxReferences:4,referenceLimitBasis:"local",maxOutputImages:10,documentedBaseCny:1},
 {model:"seedreamPro",label:"Redfox Seedream Pro",sizes:["1K","2K"],customSize:true,customPixelMaximum:OUTPUT_IMAGE_PIXELS,customPixelLimitBasis:"local",ratioRange:[1/16,16],maxReferences:4,maxOutputImages:10,documentedBaseCny:1,responseFormat:"url",outputFormats:OutputFormat.options,optimizePromptModes:OptimizePromptMode.options,watermark:true},
 {model:"seedreamLite",label:"Redfox Seedream Lite",sizes:["2K","3K","4K"],customSize:true,customPixelMinimum:3686400,customPixelMaximum:16777216,ratioRange:[1/16,16],maxReferences:4,maxImages:10,documentedBaseCny:0.71,responseFormat:"url",outputFormats:OutputFormat.options,optimizePromptModes:OptimizePromptMode.options,watermark:true,sequentialModes:SequentialMode.options,maxImagesRange:[1,MAX_GROUP_IMAGES]}],
 newModelLimits:{...IMAGE_LIMITS,steps:80,saveAttempts:30},priceBasis:"documented-estimate",billingUnitVerified:false,referenceReuseHint:"Explicitly selected uploads prove prior success, not continued URL availability; failure does not trigger re-upload."};}
