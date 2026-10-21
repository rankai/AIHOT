import {checkedXDetailOrigin,xDetailContext} from "./x-detail-origin.ts";
import {recordCollectionFailure} from "../../sources/collection-health.ts";
import {executeXhsComments} from "./xhs-comments-execution.ts";
import {executeVideoStep} from "./video-execution.ts";
import { executeAiSearchStep } from "./ai-search-execution.ts";
import { executeMediaUpload } from "./media-upload.ts";
import { executeTranscriptionStep } from "./transcription-execution.ts";
import { executeRedfoxMpStep } from "../../sources/mp-redfox-execution.ts";
import { executePlatformCollection } from "../../sources/platform-execution.ts";
import { executeSynchronousQuery } from "./synchronous.ts";
import { executeImageStep } from "./image-execution.ts";
import { executeRedfoxCollectionStep } from "../../sources/redfox-execution.ts";
import { settleUnknownReceipt } from "../operations/recovery.ts";
import { sql } from "../../db.ts";
import { BudgetExceededError, ReceiptBusyError, retryReceivedRejection } from "../receipts.ts";
import { advanceRun, claimRun, receiptOptions, requireExecution, saveResult, setRunState, StaleOperationError, type Execution, type RunRow } from "../operations/store.ts";
import { RedfoxRejectedResponseError, RedfoxDisabledError, RedfoxDeferredError, RedfoxRetryableResponseError } from "./client.ts";
import { AccountInput, xAccount, xDetail } from "./x.ts";

export async function executeRedfoxStep(runId: number, stepVersion: number, jobId: string) {
  const [run] = await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id = ${runId}`;
  if (!run || run.status !== "active" || run.step_version !== stepVersion) return { skipped: true };
  let execution: Execution;
  try { execution = await sql.begin((tx) => claimRun(tx, {runId, stepVersion, generation:run.generation}, jobId)); }
  catch (error) { if (error instanceof StaleOperationError) return { skipped: true }; throw error; }
  try {
    if (run.step_key.startsWith("redfox.xhs_comments.")) {await executeXhsComments(execution,run);return {runId};}
    if (run.step_key.startsWith("redfox.video.")) {await executeVideoStep(execution,run);return {runId};}
    if (run.step_key.startsWith("redfox.ai_search.")) {await executeAiSearchStep(execution,run);return {runId};}
    if (run.step_key === "redfox.media.upload") {await executeMediaUpload(execution,run);return {runId};}
    if (run.step_key.startsWith("redfox.wechat.")) {await executeRedfoxMpStep(execution,run);return {runId};}
    if ((run.step_key.startsWith("redfox.weibo.")||run.step_key.startsWith("redfox.platform."))) {await executePlatformCollection(execution,run);return {runId};}
    if (run.step_key === "redfox.sync.query") {await executeSynchronousQuery(execution,run);return {runId};}
    if (run.step_key.startsWith("redfox.transcript.")) {await executeTranscriptionStep(execution,run);return {runId};}
    if (run.step_key.startsWith("redfox.image.")) {await executeImageStep(execution,run);return {runId};}
    if (["redfox.x.page","redfox.x.item"].includes(run.step_key)) {await executeRedfoxCollectionStep(execution,run);return {runId};}
    if (run.step_key === "redfox.x.detail") {
      const detail=await xDetail(String((run.input.parameters as {tweetId:string}).tweetId),String(run.input.window),"query",receiptOptions(execution));
      const origin=checkedXDetailOrigin(run.input.origin,String((run.input.parameters as {tweetId:string}).tweetId),detail.tweet);
      await sql.begin(async tx=>{await requireExecution(tx,execution);await saveResult(tx,execution,{itemKey:`x:${detail.tweet.tweetId}`,kind:"x_detail_work",data:{platform:"x",operationId:"QCP75W33",record:detail.tweet,workId:detail.tweet.tweetId,identity:{userId:detail.tweet.author.userId},...((origin)?{originResultId:origin.sourceResultId}:{}),context:xDetailContext(detail.tweet,origin)},receiptId:detail.receiptId});await advanceRun(tx,execution,null);});return {runId};
    }
    if (run.step_key !== "redfox.x.account") throw new Error("Unsupported Redfox step");
    const result = await xAccount(AccountInput.parse(run.input.parameters), String(run.input.window), receiptOptions(execution));
    await sql.begin(async(tx) => {
      await requireExecution(tx,execution);
      await saveResult(tx,execution,{itemKey:`x:user:${result.account.userId}`,kind:"account",data:result.account,receiptId:result.receiptId});
      await advanceRun(tx,execution,null);
    });
    return {runId};
  } catch (error) {
    if (error instanceof StaleOperationError) return {skipped:true};
    await sql.begin(async(tx) => {
      let current: RunRow;
      try { current = await requireExecution(tx,execution); } catch (e) { if (e instanceof StaleOperationError) return; throw e; }
      if (await settleUnknownReceipt(tx,execution,current)) return;
      if(error instanceof RedfoxRejectedResponseError||error instanceof RedfoxRetryableResponseError)await recordCollectionFailure(tx,current,error.message,error);
      if (error instanceof RedfoxRetryableResponseError) {
        const [current]=await tx`SELECT retry_count,limits FROM operation_runs WHERE id=${runId}`;
        if (current!.retry_count >= Number(current!.limits.retries??3)) {
          await setRunState(tx,execution,"needs_review","Temporary rejection retry limit exhausted");
          return;
        }
        const changed=await retryReceivedRejection(tx,error.receiptId,error.attempt,error.response,error.message);
        if(changed)await tx`UPDATE operation_runs SET retry_count=retry_count+1 WHERE id=${runId}`;
        const [latest]=await tx`SELECT status FROM receipts WHERE id=${error.receiptId}`;
        const retryAt=!changed && ["received","completed"].includes(latest?.status)?new Date():error.retryAt;
        await setRunState(tx,execution,"waiting",error.message,retryAt);
        return;
      }
      if(error instanceof RedfoxDeferredError){await setRunState(tx,execution,"waiting",error.message,error.retryAt);return;}
      const waiting = error instanceof BudgetExceededError || error instanceof ReceiptBusyError || error instanceof RedfoxDisabledError;
      const seconds = error instanceof BudgetExceededError ? error.retryAfterSeconds : 60;
      await setRunState(tx,execution,waiting?"waiting":"needs_review",String(error).slice(0,500),waiting?new Date(Date.now()+seconds*1000):null);
    });
    return {runId,error:String(error)};
  }
}
