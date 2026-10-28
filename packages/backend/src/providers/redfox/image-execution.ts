import {assertImageGenerationAvailable,imageModelOf} from "./image-models.ts";
import { guardedDownload } from "../../lib/http-fetch.ts";
import { assetPath, describeGeneratedFile, hasCompleteLocalFile, imageOutputKey, OUTPUT_IMAGE_BYTES, OUTPUT_IMAGE_PIXELS, prepareUpload, publishUpload } from "../../operations/assets.ts";
import { RedfoxDisabledError, redfoxBaseUrl } from "./client.ts";
import { BudgetExceededError, type PaidRequestOptions } from "../receipts.ts";
import { sql, type Tx } from "../../db.ts";
import { advanceRun, receiptOptions, requireExecution, saveResult, setRunState, type Execution, type RunRow, type OperationProgress } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import { imageLimits, imageSucceeded, ImageInput, pollImage, submitImage, uploadReference } from "./images.ts";

function imageReceiptOptions(execution:Execution):PaidRequestOptions {
  const base=receiptOptions(execution);
  return {...base,onReceipt:async(tx,id,info)=>{
    await base.onReceipt?.(tx,id,info);
    if(info.kind!=="call")return;
    const run=await requireExecution(tx,execution);
    if(run.step_key==="redfox.image.upload"||run.step_key==="redfox.image.submit")assertImageGenerationAvailable(imageModelOf(run.input.parameters as Record<string,unknown>));
    if(process.env.REDFOX_CALLS_ENABLED!=="true"||process.env.MODEL_CALLS_ENABLED!=="true")throw new RedfoxDisabledError("Image generation outbound calls are disabled");
    const limits=imageLimits(run);
    if(Date.now()-Date.parse(String(run.input.startedAt))>limits.pollDeadlineSeconds*1000)throw new Error("Image operation external request deadline exhausted");
    const count=Number(run.progress.externalAttempts??0);
    if(count>=limits.externalAttempts)throw new Error("Image operation external attempt limit exhausted");
    await tx`UPDATE operation_runs SET progress=jsonb_set(progress,'{externalAttempts}',${tx.json(count+1)}) WHERE id=${run.id}`;
  }};
}
async function advance(tx:Tx,execution:Execution,stepKey:string,progress:OperationProgress,delaySeconds=0){
  const current=await requireExecution(tx,execution);
  progress={...progress,externalAttempts:current.progress.externalAttempts??0};
  await advanceRun(tx,execution,{stepKey,progress});
  if(delaySeconds)await tx`UPDATE operation_runs SET status='waiting',wait_reason='Waiting for image generation',next_attempt_at=${new Date(Date.now()+delaySeconds*1000)} WHERE id=${execution.runId}`;
  await queueOperationStep(tx,execution.runId);
}
export async function executeImageStep(execution:Execution,run:RunRow){
  try { await executeImageStepInner(execution,run); } catch(error) {
    // Budget and outbound gates can reject a new call before its receipt callback.
    // Received, busy and unknown receipts retain their existing recovery path.
    if((run.step_key==="redfox.image.upload"||run.step_key==="redfox.image.submit")&&(error instanceof BudgetExceededError||error instanceof RedfoxDisabledError))assertImageGenerationAvailable(imageModelOf(run.input.parameters as Record<string,unknown>));
    throw error;
  }
}
async function executeImageStepInner(execution:Execution,run:RunRow){
  const limits=imageLimits(run),model=imageModelOf(run.input.parameters as Record<string,unknown>);
  const progress=run.progress,identity=`run:${run.id}`;
  if(run.step_version>limits.steps)throw new Error("Image operation step limit exhausted");
  if(run.step_key==="redfox.image.upload"){
    const input=ImageInput.parse(run.input.parameters),index=Number(progress.uploadIndex);
    const fileKey=input.fileKeys[index]!;
    const [previous]=model==="gptImage2"?await sql`SELECT z.id,z.data FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN receipts p ON p.id=z.receipt_id
      JOIN stored_files f ON f.key=z.file_key WHERE z.file_key=${fileKey} AND z.kind='image_reference' AND r.provider='redfox'
      AND r.operation_key='redfox.image.generate' AND p.service='redfox.media' AND p.model='FXDGJO1V' AND p.request->'input'->>'fileKey'=z.file_key AND p.request->'input'->>'sha256'=f.sha256 AND p.status IN ('received','completed') AND p.request->>'base'=${redfoxBaseUrl()}
      AND z.data->>'sha256'=f.sha256 ORDER BY z.id DESC LIMIT 1`:[];
    const selected=(run.input.confirmedReferenceUploads as Array<{fileKey:string;resultId:number;resourceUrl:string;format:string;sha256:string;base:string}>|undefined)?.find(r=>r.fileKey===fileKey);
    const reused=model==="gptImage2"?previous && typeof previous.data.imageUrl==="string" && ["png","jpeg","webp"].includes(previous.data.format):!!selected;
    if(selected&&selected.base!==redfoxBaseUrl())throw new Error("Selected upload belongs to another endpoint");
    const result=reused?{data:{imageUrl:selected?.resourceUrl??previous!.data.imageUrl as string,format:selected?.format??previous!.data.format as string},receiptId:undefined}
      :await uploadReference(fileKey,`${identity}:reference:${index}`,imageReceiptOptions(execution),model);
    await sql.begin(async tx=>{
      await requireExecution(tx,execution);
      await saveResult(tx,execution,{itemKey:`reference:${index}`,kind:"image_reference",data:{...result.data,fileKey,sha256:(await tx`SELECT sha256 FROM stored_files WHERE key=${fileKey}`)[0]!.sha256,...(reused?{reusedResultId:selected?.resultId??previous!.id}:{})},fileKey,receiptId:result.receiptId});
      const next={...progress,uploadIndex:index+1,referenceImages:[...(progress.referenceImages as string[]),result.data.imageUrl]};
      await advance(tx,execution,index+1<input.fileKeys.length?"redfox.image.upload":"redfox.image.submit",next);
    });return;
  }
  if(run.step_key==="redfox.image.submit"){
    const result=await submitImage(ImageInput.parse(run.input.parameters),progress.referenceImages as string[],`${identity}:submit`,imageReceiptOptions(execution));
    await sql.begin(async tx=>{await requireExecution(tx,execution);await saveResult(tx,execution,{itemKey:"submission",kind:"image_task",data:result.data,receiptId:result.receiptId});
      await advance(tx,execution,"redfox.image.poll",{...progress,taskId:result.data.taskId,pollSequence:0},limits.pollIntervalSeconds);});return;
  }
  if(run.step_key==="redfox.image.save") {
    const index=Number(progress.saveIndex),urls=progress.imageUrls as string[],key=String(progress.expectedFileKey);
    if(key!==imageOutputKey(run.id,index)||!urls[index])throw new Error("Missing frozen image save dependency");
    let temp:Awaited<ReturnType<typeof prepareUpload>>|undefined;
    try {
      let file=assetPath(key);
      if(!await hasCompleteLocalFile(key)) {
        if(process.env.REDFOX_CALLS_ENABLED!=="true"||process.env.MODEL_CALLS_ENABLED!=="true")throw new RedfoxDisabledError("Image download outbound calls are disabled");
        await sql.begin(async tx=>{const current=await requireExecution(tx,execution);const attempts=Number(current.progress.saveAttempts??0);if(attempts>=imageLimits(current).saveAttempts)throw new Error("Image save download attempt limit exhausted");await tx`UPDATE operation_runs SET progress=jsonb_set(progress,'{saveAttempts}',${tx.json(attempts+1)}) WHERE id=${run.id}`;});
        temp=await prepareUpload(OUTPUT_IMAGE_BYTES);file=temp.file;
        await guardedDownload(urls[index]!,file,{timeoutMs:limits.downloadTimeoutMs,maxBytes:OUTPUT_IMAGE_BYTES});
      }
      const prepared=await describeGeneratedFile(file);
      await sql.begin(async tx=>{
        const current=await requireExecution(tx,execution);
        const asset=await publishUpload({actor:`operation:${run.id}`,key,...prepared},tx);
        if(!asset.content_type.startsWith("image/")||!asset.metadata.width||!asset.metadata.height)throw new Error("Saved image lacks image dimensions");
        await saveResult(tx,execution,{itemKey:`output:${index}`,kind:"image",data:{sourceUrl:urls[index],taskId:progress.taskId,width:asset.metadata.width,height:asset.metadata.height},fileKey:key});
        if(index+1===urls.length)await advanceRun(tx,execution,null);
        else await advance(tx,execution,"redfox.image.save",{...current.progress,saveIndex:index+1,expectedFileKey:imageOutputKey(run.id,index+1)});
      });
    } finally {await temp?.release();}
    return;
  }
  if(run.step_key!=="redfox.image.poll")throw new Error("Unsupported image operation step");
  const sequence=Number(progress.pollSequence);
  if(sequence>=limits.polls)throw new Error("Image polling limit exhausted");
  const result=await pollImage(String(progress.taskId),`${identity}:poll:${sequence}`,imageReceiptOptions(execution),model);
  if(run.input.mode==="image"){
    const input=ImageInput.parse(run.input.parameters);
    const success=imageSucceeded(result.data.status);
    if(input.model===undefined||input.model==="gptImage2"||input.model==="gptImage25"){
      if(result.data.resolution!==undefined&&result.data.resolution!==input.resolution||result.data.size!==undefined&&result.data.size!==input.size)throw new Error("Image output parameters mismatch");
      if(success&&("n" in input)&&result.data.imageUrls?.length!==input.n)throw new Error("Image output count mismatch");
    }else if(input.model==="geminiBanana21"){
      if(result.data.resolution!==undefined&&result.data.resolution!==input.metadata.resolution||result.data.size!==undefined&&result.data.size!==input.size)throw new Error("Image output parameters mismatch");
    }else{
      if(result.data.size!==undefined){const m=/^([1-9]\d*)x([1-9]\d*)$/.exec(result.data.size);if(m){const w=Number(m[1]),h=Number(m[2]);if(!Number.isSafeInteger(w*h)||w*h>OUTPUT_IMAGE_PIXELS)throw new Error("Image output size exceeds local bound");}
        if(/^([1-9]\d*)x([1-9]\d*)$/.test(input.size)&&result.data.size!==input.size)throw new Error("Image output pixel size mismatch");}
      if(input.model==="seedreamLite"&&success&&result.data.imageUrls!.length>(input.sequentialImageGeneration==="auto"?input.sequentialImageGenerationOptions!.maxImages:1))throw new Error("Image output count exceeds requested maximum");
    }
  }
  await sql.begin(async tx=>{
    await requireExecution(tx,execution);
    await saveResult(tx,execution,{itemKey:`poll:${sequence}`,kind:"image_task",data:result.data,receiptId:result.receiptId});
    const next={...progress,pollSequence:sequence+1,...(result.data.progress===undefined?{}:{providerProgress:result.data.progress})};
    if(result.data.status==="failed"){
      await advanceRun(tx,execution,{stepKey:"redfox.image.poll",progress:next});
      const [current]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id=${run.id}`;
      await setRunState(tx,{...execution,stepVersion:current!.step_version},"failed",result.data.failReason??"Image generation failed");return;
    }
    if(imageSucceeded(result.data.status)){
      await advance(tx,execution,"redfox.image.save",{...next,imageUrls:result.data.imageUrls,saveIndex:0,expectedFileKey:imageOutputKey(run.id,0)});return;
    }
    await advance(tx,execution,"redfox.image.poll",next,Math.min(limits.maxPollIntervalSeconds,limits.pollIntervalSeconds+sequence*2));
  });
}
