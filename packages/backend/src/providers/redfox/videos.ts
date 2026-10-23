import {sql} from "../../db.ts";
import {stableJson} from "../../lib/ids.ts";
import {lockAssetInputs,IMAGE_BYTES,IMAGE_PIXELS,VIDEO_BYTES,OUTPUT_IMAGE_BYTES,OUTPUT_IMAGE_PIXELS} from "../../operations/assets.ts";
import {createRun,StaleOperationError,type RunRow} from "../operations/store.ts";
import {queueOperationStep} from "../operations/queue.ts";
import {assertGenerationReference,confirmMediaUpload,type ConfirmedMediaUpload} from "./media-upload.ts";
import {VideoInput,VideoQuery,VideoRatio,VideoResolution,VIDEO_ROLE_LIMITS,VIDEO_LIMITS} from "./video-contract.ts";
import {z} from "zod";
export const createVideoGeneration=(raw:unknown,actor:string,key:unknown)=>command(VideoInput.parse(raw),actor,key,false);
export const createVideoQuery=(raw:unknown,actor:string,key:unknown)=>command(VideoQuery.parse(raw),actor,key,true);
async function command(parameters:Record<string,unknown>,actor:string,key:unknown,query:boolean){
 const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),operation=query?"redfox.video.query":"redfox.video.generate",intent={operation,parameters};
 return sql.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
  const [existing]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;
  if(existing){if(stableJson(existing.input.commandIntent)!==stableJson(intent))throw new StaleOperationError("Command key reused with different input");return existing;}
  const refs=(parameters.imageWithRoles??[]) as Array<{fileKey:string;uploadResultId?:number}>,fileKeys=[...new Set(refs.map(r=>r.fileKey))];
  await lockAssetInputs(tx,fileKeys);const confirmedReferenceUploads:ConfirmedMediaUpload[]=[];
  for(const key of fileKeys){const [asset]=await tx`SELECT bytes,content_type,metadata,sha256 FROM stored_files WHERE key=${key}`;assertGenerationReference(asset! as {bytes:number;content_type:string;metadata:Record<string,unknown>});const selected=refs.find(r=>r.fileKey===key&&r.uploadResultId!==undefined);if(selected)confirmedReferenceUploads.push(await confirmMediaUpload(tx,key,selected.uploadResultId!,asset! as {bytes:number;content_type:string;sha256:string}));}
  const run=await createRun(tx,{actor,commandKey,provider:"redfox",operationKey:operation,contractVersion:1,input:{commandIntent:intent,parameters,fileKeys,confirmedReferenceUploads,mode:query?"video-query":"video",startedAt:new Date().toISOString()},stepKey:query?"redfox.video.poll":fileKeys.length?"redfox.video.upload":"redfox.video.submit",limits:VIDEO_LIMITS});
  await tx`UPDATE operation_runs SET progress=${tx.json({uploadIndex:0,referenceUrls:[],pollSequence:0,...(query?{taskId:parameters.taskId}: {})} as never)} WHERE id=${run.id}`;
  await queueOperationStep(tx,run.id);return run;
 });
}
export function videoLimits(run:RunRow){const result={...VIDEO_LIMITS};for(const key of Object.keys(result) as Array<keyof typeof result>){const v=run.limits[key];if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0)throw new Error("Video run lacks valid frozen limits");result[key]=v;}return result;}
export function videoOptions(){return {modelLabel:"Redfox Seedance",aspectRatios:VideoRatio.options,resolutions:VideoResolution.options,durationSeconds:{min:4,max:15},roles:VIDEO_ROLE_LIMITS,maxReferenceRoles:11,referenceFormats:["png","jpeg","webp"],referenceBytes:IMAGE_BYTES,referencePixels:IMAGE_PIXELS,referenceFrames:1,outputVideoBytes:VIDEO_BYTES,outputImageBytes:OUTPUT_IMAGE_BYTES,outputImagePixels:OUTPUT_IMAGE_PIXELS,limits:VIDEO_LIMITS,services:{referenceUpload:"redfox.media",submission:"redfox.video",poll:"redfox.poll"},documentedBaseCny:15,pollBaseCny:0,priceBasis:"documented-estimate",billingUnitVerified:false,uploadTransportVerified:false,referenceReuseHint:"Selected uploads prove prior success, not continued URL availability. Failed references are not silently uploaded again."};}
