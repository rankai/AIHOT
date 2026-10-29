import type { ToolAuthorization } from "../../users/credits.ts";
import { z } from "zod";
import { sql, type Tx } from "../../db.ts";
import { stableJson } from "../../lib/ids.ts";
import { getAsset, assetPath, assetUploadOptions, lockAssetInputs, AssetError, IMAGE_BYTES, IMAGE_PIXELS } from "../../operations/assets.ts";
import { inputMediaFormat, MediaValidationError } from "../../operations/asset-media.ts";
import { advanceRun, createRun, lockMemberAdmission, receiptOptions, requireExecution, saveResult, StaleOperationError, type Execution, type RunRow } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import { redfoxRequest, RedfoxResponseError, redfoxBaseUrl } from "./client.ts";
const Input=z.object({fileKey:z.string().min(1).max(500)}).strict();
export function mediaUploadOptions(){return {...assetUploadOptions(),operationId:"6L178PZD",service:"redfox.media",transportVerified:false};}
export async function createMediaUpload(raw:unknown,actor:string,key:unknown,authorization?:ToolAuthorization){
 const input=Input.parse(raw),commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),operation="redfox.media.upload",intent={operation,parameters:input};
 return sql.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
  const [existing]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;
  if(existing){if(stableJson(existing.input.commandIntent)!==stableJson(intent))throw new StaleOperationError("Command key reused with different input");return existing;}
  await lockMemberAdmission(tx,actor);
  await lockAssetInputs(tx,[input.fileKey]);
  const [asset]=await tx`SELECT sha256,bytes,content_type FROM stored_files WHERE key=${input.fileKey}`;
  let format;try{format=inputMediaFormat(asset!.content_type,Number(asset!.bytes));}catch(error){if(error instanceof MediaValidationError)throw new AssetError(error.status,error.message);throw error;}
  if(!asset!.sha256)throw new AssetError(400,"Asset lacks a verified content hash.");
  const parameters={fileKey:input.fileKey,format,sha256:asset!.sha256,bytes:Number(asset!.bytes),contentType:asset!.content_type};
  const run=await createRun(tx,{actor,authorization,commandKey,provider:"redfox",operationKey:operation,contractVersion:1,input:{commandIntent:intent,mode:"media-upload",fileKeys:[input.fileKey],parameters},stepKey:operation,limits:{retries:0}});
  await queueOperationStep(tx,run.id);return run;
 });
}
export async function executeMediaUpload(execution:Execution,run:RunRow){
 const p=run.input.parameters as {fileKey:string;format:ReturnType<typeof inputMediaFormat>;sha256:string;bytes:number;contentType:string};
 const result=await redfoxRequest("6L178PZD",p,`run:${run.id}:upload`,"media",receiptOptions(execution),{file:assetPath(p.fileKey),format:p.format,mime:p.contentType});
 const data=z.object({imageUrl:z.string().min(1),format:z.string().min(1)}).parse(result.data);
 let url:URL;try{url=new URL(data.imageUrl);}catch{throw new RedfoxResponseError("Uploaded resource URL is invalid");}
 if(!["http:","https:"].includes(url.protocol)||url.username||url.password||data.format!==p.format)throw new RedfoxResponseError("Uploaded resource URL or format mismatch");
 await sql.begin(async tx=>{
  await requireExecution(tx,execution);
  await saveResult(tx,execution,{itemKey:"upload",kind:"media_upload",fileKey:p.fileKey,receiptId:result.receiptId,data:{operationId:"6L178PZD",format:data.format,resourceUrl:data.imageUrl,assetKey:p.fileKey,sha256:p.sha256,reportedScope:"supplier-upload"}});
  await advanceRun(tx,execution,null);
 });
}

/** Caller holds the asset row lock. References use the same verified image boundary in both generators. */
export function assertGenerationReference(asset:{bytes:number;content_type:string;metadata:Record<string,unknown>}){
 const m=asset.metadata,w=m.width as number,h=m.height as number;
 if(asset.bytes>IMAGE_BYTES||!["image/png","image/jpeg","image/webp"].includes(asset.content_type)||(m.kind&&m.kind!=="image")||!Number.isSafeInteger(w)||w<=0||!Number.isSafeInteger(h)||h<=0||w*h>IMAGE_PIXELS||(m.pages!==undefined&&m.pages!==1))throw new AssetError(400,"References require PNG/JPEG/WebP, positive dimensions, at most 10 MB / 16 MP and one frame.");
}
export interface ConfirmedMediaUpload {fileKey:string;resultId:number;resourceUrl:string;format:string;sha256:string;base:string;}
/** This is an explicit selection, never an automatic lookup of an assumed-live URL. */
export async function confirmMediaUpload(tx:Tx,key:string,resultId:number,asset:{sha256:string;content_type:string;bytes:number}):Promise<ConfirmedMediaUpload>{
 const format=inputMediaFormat(asset.content_type,Number(asset.bytes));
 const [result]=await tx`SELECT z.data FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN receipts p ON p.id=z.receipt_id
 WHERE z.id=${resultId} AND z.kind='media_upload' AND z.file_key=${key} AND z.data->>'assetKey'=${key} AND z.data->>'operationId'='6L178PZD'
 AND r.provider='redfox' AND r.operation_key='redfox.media.upload' AND p.service='redfox.media' AND p.model='6L178PZD'
 AND p.status IN ('received','completed') AND p.request->>'base'=${redfoxBaseUrl()}
 AND p.request->'input'->>'fileKey'=${key} AND p.request->'input'->>'sha256'=${asset.sha256}
 AND z.data->>'sha256'=${asset.sha256} AND p.request->'input'->>'format'=${format} AND z.data->>'format'=${format}`;
 let valid=false;try{const u=new URL(result?.data.resourceUrl);valid=["http:","https:"].includes(u.protocol)&&!u.username&&!u.password;}catch{}
 if(!result||!valid)throw new AssetError(400,"Selected upload does not confirm this asset, endpoint and format.");
 return {fileKey:key,resultId,resourceUrl:result.data.resourceUrl,format,sha256:asset.sha256,base:redfoxBaseUrl()};
}

export async function uploadMediaReference(key:string,identity:string,paid:import("../receipts.ts").PaidRequestOptions){
 const asset=await getAsset(key),format=inputMediaFormat(asset.content_type,Number(asset.bytes));
 const result=await redfoxRequest("6L178PZD",{fileKey:key,sha256:asset.sha256,format},identity,"media",paid,{file:assetPath(key),format,mime:asset.content_type});
 const data=z.object({imageUrl:z.url().refine(v=>{const u=new URL(v);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password;}),format:z.string()}).parse(result.data);
 if(data.format!==format)throw new RedfoxResponseError("Uploaded image format mismatch");
 return {...result,data};
}
