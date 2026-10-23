import {sql,type Tx} from "../../db.ts";
import {guardedDownload} from "../../lib/http-fetch.ts";
import {assetPath,describeGeneratedFile,describeGeneratedVideoFile,hasCompleteLocalFile,videoOutputKey,VIDEO_BYTES,OUTPUT_IMAGE_BYTES,prepareUpload,publishUpload} from "../../operations/assets.ts";
import {advanceRun,receiptOptions,requireExecution,saveResult,setRunState,type Execution,type RunRow,type OperationProgress} from "../operations/store.ts";
import {queueOperationStep} from "../operations/queue.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {redfoxRequest,redfoxBaseUrl,RedfoxDisabledError} from "./client.ts";
import {uploadMediaReference,type ConfirmedMediaUpload} from "./media-upload.ts";
import {VideoInput,VideoTaskId,parseVideoPoll} from "./video-contract.ts";
import {videoLimits} from "./videos.ts";
function assertOutbound(){if(process.env.REDFOX_CALLS_ENABLED!=="true"||process.env.MODEL_CALLS_ENABLED!=="true")throw new RedfoxDisabledError("Video generation outbound calls are disabled");}
function paidOptions(execution:Execution):PaidRequestOptions{
 const base=receiptOptions(execution);return {...base,onReceipt:async(tx,id,info)=>{await base.onReceipt?.(tx,id,info);if(info.kind!=="call")return;assertOutbound();const run=await requireExecution(tx,execution),limits=videoLimits(run),attempts=Number(run.progress.externalAttempts??0);if(Date.now()-Date.parse(String(run.input.startedAt))>limits.pollDeadlineSeconds*1000||attempts>=limits.externalAttempts)throw new Error("Video external request limit exhausted");await tx`UPDATE operation_runs SET progress=jsonb_set(progress,'{externalAttempts}',${tx.json(attempts+1)}) WHERE id=${run.id}`;}};
}
async function advance(tx:Tx,execution:Execution,stepKey:string,progress:OperationProgress,delay=0){
 const run=await requireExecution(tx,execution);await advanceRun(tx,execution,{stepKey,progress:{...progress,externalAttempts:run.progress.externalAttempts??0}});
 if(delay)await tx`UPDATE operation_runs SET status='waiting',wait_reason='Waiting for video generation',next_attempt_at=${new Date(Date.now()+delay*1000)} WHERE id=${execution.runId}`;
 await queueOperationStep(tx,execution.runId);
}
export async function executeVideoStep(execution:Execution,run:RunRow){
 const limits=videoLimits(run),p=run.progress,identity=`run:${run.id}`;
 if(run.step_version>limits.steps)throw new Error("Video step limit exhausted");
 if(run.step_key==="redfox.video.upload"){
  const keys=run.input.fileKeys as string[],index=Number(p.uploadIndex),key=keys[index]!;
  const selected=(run.input.confirmedReferenceUploads as ConfirmedMediaUpload[]).find(r=>r.fileKey===key);
  if(selected&&selected.base!==redfoxBaseUrl())throw new Error("Selected upload belongs to another endpoint");
  const result=selected?{data:{imageUrl:selected.resourceUrl,format:selected.format},receiptId:undefined}:await uploadMediaReference(key,`${identity}:reference:${index}`,paidOptions(execution));
  await sql.begin(async tx=>{await requireExecution(tx,execution);await saveResult(tx,execution,{itemKey:`reference:${index}`,kind:"video_reference",fileKey:key,receiptId:result.receiptId,data:{...result.data,fileKey:key,...(selected?{reusedResultId:selected.resultId}: {})}});await advance(tx,execution,index+1<keys.length?"redfox.video.upload":"redfox.video.submit",{...p,uploadIndex:index+1,referenceUrls:[...(p.referenceUrls as string[]),result.data.imageUrl]});});return;
 }
 if(run.step_key==="redfox.video.submit"){
  const input=VideoInput.parse(run.input.parameters),keys=run.input.fileKeys as string[],{imageWithRoles,...parameters}=input;
  const result=await redfoxRequest("JE93E37A",{...parameters,imageWithRoles:imageWithRoles.map(ref=>({url:(p.referenceUrls as string[])[keys.indexOf(ref.fileKey)]!,role:ref.role}))},`${identity}:submit`,"video",paidOptions(execution));
  const taskId=VideoTaskId.parse((result.data as Record<string,unknown>)?.taskId);
  await sql.begin(async tx=>{await requireExecution(tx,execution);await saveResult(tx,execution,{itemKey:"submission",kind:"video_task",receiptId:result.receiptId,data:{...(result.data as Record<string,unknown>),taskId}});await advance(tx,execution,"redfox.video.poll",{...p,taskId,pollSequence:0},limits.pollIntervalSeconds);});return;
 }
 if(run.step_key==="redfox.video.save"){
  const index=Number(p.saveIndex),outputs=p.outputs as Array<{url:string;role:"video"|"last_frame"}>,output=outputs[index],key=String(p.expectedFileKey);
  if(!output||key!==videoOutputKey(run.id,index))throw new Error("Missing frozen video save dependency");
  let temp:Awaited<ReturnType<typeof prepareUpload>>|undefined;
  try{let file=assetPath(key);if(!await hasCompleteLocalFile(key)){assertOutbound();await sql.begin(async tx=>{const current=await requireExecution(tx,execution),attempts=Number(current.progress.saveAttempts??0);if(attempts>=videoLimits(current).saveAttempts)throw new Error("Video save attempt limit exhausted");await tx`UPDATE operation_runs SET progress=jsonb_set(progress,'{saveAttempts}',${tx.json(attempts+1)}) WHERE id=${run.id}`;});const maxBytes=output.role==="video"?VIDEO_BYTES:OUTPUT_IMAGE_BYTES;temp=await prepareUpload(maxBytes);file=temp.file;await guardedDownload(output.url,file,{timeoutMs:limits.downloadTimeoutMs,maxBytes});}
   const prepared=output.role==="video"?await describeGeneratedVideoFile(file):await describeGeneratedFile(file);
   await sql.begin(async tx=>{const current=await requireExecution(tx,execution);const asset=await publishUpload({actor:`operation:${run.id}`,key,...prepared},tx);if(output.role==="video"?asset.metadata.kind!=="video":asset.metadata.kind!=="image")throw new Error("Saved video output type mismatch");await saveResult(tx,execution,{itemKey:`output:${index}`,kind:output.role==="video"?"video":"image",fileKey:key,data:{sourceUrl:output.url,taskId:p.taskId,role:output.role,...(output.role==="video"?(run.input.mode==="video"?{lastFrameMissing:p.lastFrameMissing}:{}):{width:asset.metadata.width,height:asset.metadata.height})}});if(index+1===outputs.length)await advanceRun(tx,execution,null);else await advance(tx,execution,"redfox.video.save",{...current.progress,saveIndex:index+1,expectedFileKey:videoOutputKey(run.id,index+1)});});
  }finally{await temp?.release();}return;
 }
 if(run.step_key!=="redfox.video.poll")throw new Error("Unsupported video step");
 const sequence=Number(p.pollSequence);if(sequence>=limits.polls)throw new Error("Video poll limit exhausted");
 const result=await redfoxRequest("VBALJNC7",{taskId:p.taskId},`${identity}:poll:${sequence}`,"poll",paidOptions(execution)),data=parseVideoPoll(result.data,String(p.taskId));
 let lastFrameMissing=false;
 if(run.input.mode==="video"){const input=VideoInput.parse(run.input.parameters);if(data.duration!==undefined&&data.duration!==input.duration||data.resolution!==undefined&&data.resolution!==input.resolution||data.generateAudio!==undefined&&data.generateAudio!==input.generateAudio||input.aspectRatio!=="adaptive"&&data.aspectRatio!==undefined&&data.aspectRatio!==input.aspectRatio)throw new Error("Video output parameters mismatch");lastFrameMissing=data.status==="completed"&&input.returnLastFrame&&!data.lastFrameUrl;}
 await sql.begin(async tx=>{await requireExecution(tx,execution);await saveResult(tx,execution,{itemKey:`poll:${sequence}`,kind:"video_task",receiptId:result.receiptId,data:{...data,...(run.input.mode==="video"?{lastFrameMissing}: {})}});const next={...p,pollSequence:sequence+1,...(data.progress===undefined?{}:{providerProgress:data.progress})};
  if(data.status==="failed"){await advanceRun(tx,execution,{stepKey:"redfox.video.poll",progress:next});const [current]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id=${run.id}`;await setRunState(tx,{...execution,stepVersion:current!.step_version},"failed",data.failReason??"Video generation failed");}
  else if(data.status==="completed"){const outputs=[{url:data.videoUrl!,role:"video"},...(data.lastFrameUrl?[{url:data.lastFrameUrl,role:"last_frame"}]:[])];await advance(tx,execution,"redfox.video.save",{...next,outputs,...(run.input.mode==="video"?{lastFrameMissing}:{}),saveIndex:0,expectedFileKey:videoOutputKey(run.id,0)});}
  else await advance(tx,execution,"redfox.video.poll",next,Math.min(limits.maxPollIntervalSeconds,limits.pollIntervalSeconds+sequence*2));
 });
}
