import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { sql, type Tx } from "../../db.ts";
import { guardedDownload, DownloadError } from "../../lib/http-fetch.ts";
import { AssetError, assetExpired, assetPath, hasCompleteLocalFile, prepareUpload, publishUpload, VIDEO_BYTES, type AssetRow } from "../../operations/assets.ts";
import { describeVideoMedia, MediaValidationError } from "../../operations/asset-media.ts";
import { SUBSCRIPTION_VIDEO_DOWNLOAD } from "../../sources/subscription-video-ownership.ts";
import { candidateOutboundAllowed, resolvedVideoCandidates, videoResolver, subscriptionVideoFileKey, type VideoManifest, type VideoTarget } from "../../sources/subscription-video-candidates.ts";
import { queryMediaTool } from "../redfox/media-tools.ts";
import { RedfoxDisabledError, RedfoxDeferredError, RedfoxRetryableResponseError } from "../redfox/client.ts";
import { BudgetExceededError, ReceiptBusyError, retryReceivedRejection } from "../receipts.ts";
import { advanceRun, claimRun, requireExecution, receiptOptions, retainCurrentReceipt, saveResult, setRunState, StaleOperationError, type Execution, type RunRow, type OperationProgress } from "./store.ts";
import { settleUnknownReceipt } from "./recovery.ts";
import { queueOperationStep } from "./queue.ts";

interface Failure { candidateIndex:number; reason:string; transferredBytes:number; unmeasuredInterruptedAttempts:number; bitrate?:number }
interface Progress extends OperationProgress {
  targets:VideoTarget[];targetIndex:number;candidateIndex:number;transferAttempts:number;transferBytes:number;
  totalTransferBytes:number;failures:Failure[];resolverUsed:boolean;saved:number;notSaved:number;expectedFileKey?:string;resolverFailureReason?:string;
}
function singleVideo(run:RunRow){return run.input.singleVideo===true||run.input.videoProof==="agentkey-douyin-v4";}
function progress(run:RunRow):Progress {
  const manifest=run.input.manifest as VideoManifest|undefined;
  return {targets:manifest?.targets.length?manifest.targets:[{selection:singleVideo(run)?"single-video-main":"unresolved",stable:singleVideo(run),candidates:[]}],
    targetIndex:0,candidateIndex:0,transferAttempts:0,transferBytes:0,totalTransferBytes:0,failures:[],resolverUsed:false,saved:0,notSaved:0,...run.progress} as Progress;
}
function target(p:Progress){return p.targets[p.targetIndex]!;}
function fileKey(run:RunRow,p=progress(run)){return subscriptionVideoFileKey(String(run.input.platform),String(run.input.workId),target(p).selection);}
function source(run: RunRow) { return { articleId: run.input.videoDownloadOwnership!.articleId, sourceId: run.input.videoDownloadOwnership!.sourceId }; }
function finalReason(p:Progress,fallback=p.resolverFailureReason??"no_video_address"){return p.failures.some(f=>f.reason==="too_large")?"too_large":p.failures.at(-1)?.reason??fallback;}
async function next(tx:Tx,e:Execution,run:RunRow,p:Progress,stepKey="subscription.video.save") {
  p.expectedFileKey=fileKey(run,p);
  await advanceRun(tx,e,{stepKey,progress:p});await queueOperationStep(tx,run.id);
}
async function finishTarget(tx:Tx,e:Execution,run:RunRow,p:Progress,reason:string,asset?:AssetRow,reused=false) {
  const t=target(p),candidate=t.candidates[p.candidateIndex];
  await saveResult(tx,e,{itemKey:`video:${t.selection}`,kind:"subscription_video",...source(run),...(asset?{fileKey:asset.key}:{}),
    ...(p.retainedReceiptIds?.[0]?{receiptId:p.retainedReceiptIds[0]}:{}),data:{
      platform:run.input.platform,mediaRole:run.input.mediaRole??"own",workId:run.input.workId,collector:run.input.collector,resolverUsed:p.resolverUsed,resolver:videoResolver(String(run.input.platform)),
      parentResultId:run.input.parentResultId,parentRunId:run.input.parentRunId,originalUrl:run.input.originalUrl,
      selection:t.selection,stableMediaIdentity:t.stable,saved:asset?1:0,notSaved:asset?0:1,reused,reason,
      bytes:asset?.bytes??null,expiresAt:asset?.expires_at??null,transferredBytes:p.transferBytes,attempts:p.failures,
      transferAttempts:p.transferAttempts,unmeasuredInterruptedAttempts:Math.max(0,p.transferAttempts-1),
      selectedCandidate:asset&&!reused&&candidate?{index:p.candidateIndex,provider:candidate.provider,field:candidate.field,quality:candidate.quality,bitrate:candidate.bitrate??null,watermark:candidate.watermark??"unknown"}:null,
      ...(reason==="too_large"?{versionConclusion:p.failures.every(f=>f.reason==="too_large")?"no_provided_version_within_limit":"other_versions_unverified"}:{}),
    }});
  p.saved+=asset?1:0;p.notSaved+=asset?0:1;
  if(p.targetIndex+1<p.targets.length){
    await next(tx,e,run,{...p,targetIndex:p.targetIndex+1,candidateIndex:0,transferAttempts:0,transferBytes:0,failures:[]});return;
  }
  if(p.targets.length>1)await saveResult(tx,e,{itemKey:"summary",kind:"subscription_video_summary",...source(run),data:{saved:p.saved,notSaved:p.notSaved,transferredBytes:p.totalTransferBytes}});
  await advanceRun(tx,e,null);
}
/** Unknown-media selections must not evade a deleted work's history by changing manifest hash. */
async function workTombstone(tx:Tx,run:RunRow,p:Progress):Promise<boolean> {
  const [prior]=await tx`SELECT 1 FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN stored_files f ON f.key=z.file_key
    WHERE r.operation_key=${SUBSCRIPTION_VIDEO_DOWNLOAD} AND r.input->>'platform'=${String(run.input.platform)} AND r.input->>'workId'=${String(run.input.workId)}
      AND (${!target(p).stable} OR z.data->>'stableMediaIdentity'='false')
      AND f.metadata->>'origin'='subscription-video' AND (f.status<>'available' OR f.expires_at<=now()) LIMIT 1`;
  return !!prior;
}
async function savedAsset(e:Execution,run:RunRow):Promise<boolean> {
  return sql.begin(async tx=>{
    await requireExecution(tx,e);const p=progress(run);
    if(await workTombstone(tx,run,p)){await finishTarget(tx,e,run,p,"deleted");return true;}
    const [asset]=await tx<AssetRow[]>`SELECT * FROM stored_files WHERE key=${fileKey(run,p)} FOR UPDATE`;
    if(!asset)return false;
    if(asset.status!=="available"||assetExpired(asset))await finishTarget(tx,e,run,p,assetExpired(asset)?"expired":"deleted");
    else if(!await hasCompleteLocalFile(asset.key))await finishTarget(tx,e,run,p,"missing_file");
    else await finishTarget(tx,e,run,p,"reused",asset,true);
    return true;
  });
}
async function resolve(e:Execution,run:RunRow) {
  // A received parser response still needs its own committed result before advancing.
  // Replay it locally first, even if another subscription has published the same file.
  const [receipt]=run.current_receipt_id?await sql`SELECT status FROM receipts WHERE id=${run.current_receipt_id}`:[];
  const replayReceived=receipt?.status==="received"||receipt?.status==="completed";
  if(!replayReceived&&await savedAsset(e,run))return;
  const p=progress(run),resolver=videoResolver(String(run.input.platform));
  // Fixed parser has no media-ID mapping. It cannot repair a missing member of a multi-video post.
  if(!resolver||p.resolverUsed||!singleVideo(run)||p.targets.length!==1){
    await sql.begin(async tx=>{await requireExecution(tx,e);await finishTarget(tx,e,run,p,finalReason(p,!singleVideo(run)?"media_identity_insufficient":"no_video_address"));});return;
  }
  const temp=await prepareUpload(VIDEO_BYTES);
  try {
    await sql.begin(async tx=>{await requireExecution(tx,e);p.expectedFileKey=fileKey(run,p);await tx`UPDATE operation_runs SET progress=${tx.json(p as never)} WHERE id=${run.id}`;});
    if(!replayReceived&&await hasCompleteLocalFile(fileKey(run,p))){await sql.begin(async tx=>{await requireExecution(tx,e);await next(tx,e,run,p);});return;}
    const options=receiptOptions(e);
    const response=await queryMediaTool(resolver.operationId,{url:String(run.input.originalUrl)},`subscription-video:${run.id}`,{
      ...options,onReceipt:async(tx,id,info)=>{
        if(info.kind==="call"){
          if(!candidateOutboundAllowed("redfox"))throw new RedfoxDisabledError("Subscription video outbound calls are disabled");
          const [receipt]=await tx`SELECT attempts FROM receipts WHERE id=${id}`;
          if(Number(receipt?.attempts)>2)throw new Error("Automatic video parsing attempt limit exhausted");
        }
        await options.onReceipt!(tx,id,info);
      },
    });
    const parsed=resolvedVideoCandidates(response.results,response.receiptId,response.attempt,singleVideo(run));
    await sql.begin(async tx=>{
      const current=await requireExecution(tx,e),currentProgress=progress(current);
      const [receipt]=await tx`SELECT attempts,status FROM receipts WHERE id=${response.receiptId} FOR UPDATE`;
      if(receipt?.attempts!==response.attempt||!["received","completed"].includes(receipt.status))throw new StaleOperationError("Parser attempt changed");
      await saveResult(tx,e,{itemKey:"parser",kind:"subscription_video_parse",receiptId:response.receiptId,...source(current),data:{
        collector:run.input.collector,...resolver,attempt:response.attempt,manifestHash:parsed.manifest.hash,
        videoResources:response.results.filter(r=>r.kind==="media_resource"&&(r.data.record as {type?:string})?.type==="video").length,
        uniqueVideoCandidates:parsed.manifest.targets[0]?.candidates.length??0,reason:parsed.reason??null,
      }});
      currentProgress.resolverUsed=true;
      const additions=parsed.manifest.targets[0]?.candidates.filter(c=>!target(currentProgress).candidates.some(old=>old.url===c.url))??[];
      // Consume the response before the save step checks shared files, tombstones and
      // complete orphans. With no new address, skip every previously tried candidate.
      currentProgress.resolverFailureReason=parsed.reason??(!additions.length?"no_new_video_address":undefined);
      currentProgress.candidateIndex=target(currentProgress).candidates.length;
      target(currentProgress).candidates.push(...additions);
      currentProgress.resolverManifest={receiptId:response.receiptId,attempt:response.attempt,hash:parsed.manifest.hash};
      currentProgress.transferAttempts=0;
      await retainCurrentReceipt(tx,e,currentProgress);
      const retained=await requireExecution(tx,e);
      await next(tx,e,retained,progress(retained));
    });
  }finally{await temp.release();}
}
async function failedCandidate(e:Execution,run:RunRow,reason:string,transferredBytes:number) {
  await sql.begin(async tx=>{
    const current=await requireExecution(tx,e),p=progress(current),candidate=target(p).candidates[p.candidateIndex];
    p.failures.push({candidateIndex:p.candidateIndex,reason,transferredBytes,unmeasuredInterruptedAttempts:Math.max(0,p.transferAttempts-1),...(candidate?.bitrate!==undefined?{bitrate:candidate.bitrate}:{})});
    p.transferBytes+=transferredBytes;p.totalTransferBytes+=transferredBytes;p.candidateIndex++;p.transferAttempts=0;
    if(p.candidateIndex<target(p).candidates.length){await next(tx,e,current,p);return;}
    if(!p.resolverUsed&&videoResolver(String(run.input.platform))&&singleVideo(run)&&p.targets.length===1){await next(tx,e,current,p,"subscription.video.resolve");return;}
    await finishTarget(tx,e,current,p,finalReason(p));
  });
}
async function save(e:Execution,run:RunRow) {
  if(await savedAsset(e,run))return;
  const p=progress(run),t=target(p),candidate=t.candidates[p.candidateIndex];
  const key=fileKey(run,p),local=await hasCompleteLocalFile(key);
  if(!local&&!candidate){await sql.begin(async tx=>{await requireExecution(tx,e);if(!p.resolverUsed&&videoResolver(String(run.input.platform))&&singleVideo(run)&&p.targets.length===1)await next(tx,e,run,p,"subscription.video.resolve");else await finishTarget(tx,e,run,p,finalReason(p));});return;}
  // Size facts may reject a candidate without reserving space or transferring bytes.
  if(!local&&candidate?.bytes!==undefined&&candidate.bytes>VIDEO_BYTES){await failedCandidate(e,run,"too_large",0);return;}
  const temp=await prepareUpload(VIDEO_BYTES);
  let transferredBytes=0;
  try {
    let file=assetPath(key);
    if(!local){
      if(!candidateOutboundAllowed(candidate!.provider))throw new RedfoxDisabledError("Video candidate provider outbound calls are disabled");
      if(p.transferAttempts>=2){await failedCandidate(e,run,"transfer_retry_exhausted",0);return;}
      await sql.begin(async tx=>{
        const current=await requireExecution(tx,e),latest=progress(current);
        latest.transferAttempts++;latest.expectedFileKey=key;
        await tx`UPDATE operation_runs SET progress=${tx.json(latest as never)} WHERE id=${run.id}`;
      });
      file=temp.file;
      try {transferredBytes=(await guardedDownload(candidate!.url,file,{maxBytes:VIDEO_BYTES,timeoutMs:60_000})).transferredBytes;}
      catch(error){
        if(["ENOSPC","EACCES","EROFS","EEXIST"].includes((error as NodeJS.ErrnoException)?.code??""))throw error;
        await failedCandidate(e,run,error instanceof DownloadError?error.reason:"download_unavailable",error instanceof DownloadError?error.transferredBytes:0);return;
      }
    }
    let media:Awaited<ReturnType<typeof describeVideoMedia>>;
    try{media=await describeVideoMedia(file);}catch(error){if(!(error instanceof MediaValidationError))throw error;await failedCandidate(e,run,error.status===413?"too_large":"unsupported_format",transferredBytes);return;}
    const hash=createHash("sha256");for await(const chunk of createReadStream(file))hash.update(chunk);const digest=hash.digest("hex");
    await sql.begin(async tx=>{
      const current=await requireExecution(tx,e),latest=progress(current);latest.transferBytes+=transferredBytes;latest.totalTransferBytes+=transferredBytes;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
      const [existing]=await tx<AssetRow[]>`SELECT * FROM stored_files WHERE key=${key} FOR UPDATE`;
      if(existing){const available=existing.status==="available"&&!assetExpired(existing);await finishTarget(tx,e,current,latest,available?"reused":assetExpired(existing)?"expired":"deleted",available?existing:undefined,true);return;}
      if(await workTombstone(tx,current,latest)){await finishTarget(tx,e,current,latest,"deleted");return;}
      const asset=await publishUpload({actor:"subscription-video",key,file,filename:`video-${run.id}-${latest.targetIndex}.${media.format}`,mime:media.mime,bytes:media.bytes,sha256:digest,purpose:"operation-output",origin:"subscription-video"},tx);
      await finishTarget(tx,e,current,latest,"saved",asset);
    });
  }finally{await temp.release();}
}

export async function executeSubscriptionVideoStep(runId:number,stepVersion:number,jobId:string) {
  const [run]=await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${runId}`;
  if(!run||run.provider!=="local"||run.operation_key!==SUBSCRIPTION_VIDEO_DOWNLOAD||run.status!=="active"||run.step_version!==stepVersion)return {skipped:true};
  let execution:Execution;
  try{execution=await sql.begin(tx=>claimRun(tx,{runId,stepVersion,generation:run.generation},jobId));}catch(error){if(error instanceof StaleOperationError)return {skipped:true};throw error;}
  try{
    if(run.step_key==="subscription.video.resolve")await resolve(execution,run);
    else if(run.step_key==="subscription.video.save")await save(execution,run);
    else throw new Error("Unsupported subscription video step");
    return {runId};
  }catch(error){
    if(error instanceof StaleOperationError)return {skipped:true};
    await sql.begin(async tx=>{
      let current:RunRow;try{current=await requireExecution(tx,execution);}catch(e){if(e instanceof StaleOperationError)return;throw e;}
      if(await settleUnknownReceipt(tx,execution,current))return;
      if(error instanceof RedfoxRetryableResponseError){
        if(error.attempt>=2){await setRunState(tx,execution,"needs_review","Automatic video parsing attempt limit exhausted");return;}
        await retryReceivedRejection(tx,error.receiptId,error.attempt,error.response,error.message);
        await setRunState(tx,execution,"waiting",error.message,error.retryAt);return;
      }
      if(error instanceof RedfoxDeferredError){await setRunState(tx,execution,"waiting",error.message,error.retryAt);return;}
      const waiting=error instanceof BudgetExceededError||error instanceof ReceiptBusyError||error instanceof RedfoxDisabledError||error instanceof AssetError&&[503,507].includes(error.statusCode);
      await setRunState(tx,execution,waiting?"waiting":"needs_review",error instanceof Error?error.message.slice(0,300):"Video save requires review",waiting?new Date(Date.now()+(error instanceof BudgetExceededError?error.retryAfterSeconds:60)*1000):null);
    });
    return {runId,error:"Video save deferred or requires review"};
  }
}
