import {settleExpiredCommentTask} from "../operations/recovery.ts";
import {sql,type Tx} from "../../db.ts";
import {advanceRun,setRunState,receiptOptions,requireExecution,saveResult,type Execution,type RunRow,type OperationProgress} from "../operations/store.ts";
import {queueOperationStep} from "../operations/queue.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {redfoxRequest,RedfoxDisabledError} from "./client.ts";
import {XhsCommentInput,XhsCommentSubmission,parseXhsCommentPoll,commentSafeUrl} from "./xhs-comments-contract.ts";
import {xhsCommentLimits} from "./xhs-comments.ts";
class FirstCommentPollDeferred extends Error {
 constructor(notBefore:Date){super(`Waiting for comment first query window until ${notBefore.toISOString()}`);}
}
async function firstPollNotBefore(tx:Tx,run:RunRow):Promise<Date|null>{
 if(run.input.mode!=="xhs-comments"||run.step_key!=="redfox.xhs_comments.poll"||run.progress.pollSequence!==0)return null;
 const [submission]=await tx`SELECT z.data,p.received_at FROM operation_results z JOIN receipts p ON p.id=z.receipt_id
   WHERE z.run_id=${run.id} AND z.item_key='submission' AND z.kind='xhs_comment_task'
     AND p.model='5AM3X4HZ' AND p.service='redfox.query' AND p.status IN ('received','completed')`;
 if(!submission?.received_at||submission.data.taskId!==run.progress.taskId)throw new Error("Comment submission time or task evidence is missing");
 return new Date(submission.received_at.getTime()+xhsCommentLimits(run).firstPollDelaySeconds*1000);
}
function paidOptions(execution:Execution):PaidRequestOptions{
 const base=receiptOptions(execution);return {...base,onReceipt:async(tx,id,info)=>{await base.onReceipt?.(tx,id,info);if(info.kind!=="call")return;const run=await requireExecution(tx,execution),limits=xhsCommentLimits(run),notBefore=await firstPollNotBefore(tx,run);if(notBefore&&notBefore.getTime()>Date.now())throw new FirstCommentPollDeferred(notBefore);const attempts=Number(run.progress.externalAttempts??0);if(Date.now()-Date.parse(String(run.input.startedAt))>limits.pollDeadlineSeconds*1000||attempts>=limits.externalAttempts)throw new Error("Comment task external request limit exhausted; query the existing task explicitly");await tx`UPDATE operation_runs SET progress=jsonb_set(progress,'{externalAttempts}',${tx.json(attempts+1)}) WHERE id=${run.id}`;}};
}
async function nextPoll(tx:Tx,execution:Execution,progress:OperationProgress,at:Date){
 const run=await requireExecution(tx,execution);await advanceRun(tx,execution,{stepKey:"redfox.xhs_comments.poll",progress:{...progress,externalAttempts:run.progress.externalAttempts??0}});await tx`UPDATE operation_runs SET status='waiting',wait_reason='Waiting for comment query window',next_attempt_at=${at} WHERE id=${run.id}`;await queueOperationStep(tx,run.id);
}
export async function executeXhsComments(execution:Execution,run:RunRow){
 try{await executeCommentStep(execution,run);}
 catch(error){
  if(!(error instanceof FirstCommentPollDeferred)&&!(error instanceof RedfoxDisabledError))throw error;
  const deferred=await sql.begin(async tx=>{
   const current=await requireExecution(tx,execution),notBefore=await firstPollNotBefore(tx,current);
   if(!notBefore||notBefore.getTime()<=Date.now())return false;
   await setRunState(tx,execution,"waiting","Waiting for comment first query window",notBefore);
   await queueOperationStep(tx,run.id);return true;
  });
  if(!deferred)throw error;
 }
}
async function executeCommentStep(execution:Execution,run:RunRow){
 if(await sql.begin(async tx=>settleExpiredCommentTask(tx,await requireExecution(tx,execution))))return;
 const limits=xhsCommentLimits(run),identity=`run:${run.id}`;
 if(run.step_version>limits.steps)throw new Error("Comment task step limit exhausted");
 if(run.step_key==="redfox.xhs_comments.submit"){
  const parameters=XhsCommentInput.parse(run.input.parameters),result=await redfoxRequest("5AM3X4HZ",parameters,`${identity}:submit`,"query",paidOptions(execution)),data=XhsCommentSubmission.parse(result.data);
  await sql.begin(async tx=>{await requireExecution(tx,execution);const [receipt]=await tx`SELECT received_at FROM receipts WHERE id=${result.receiptId}`;if(!receipt?.received_at)throw new Error("Comment submission lacks local receipt time");await saveResult(tx,execution,{itemKey:"submission",kind:"xhs_comment_task",receiptId:result.receiptId,data:{...data,requestedOpusId:parameters.opusId,requestedDataNum:parameters.dataNum}});await nextPoll(tx,execution,{...run.progress,taskId:data.taskId,pollSequence:0},new Date(receipt.received_at.getTime()+limits.firstPollDelaySeconds*1000));});return;
 }
 if(run.step_key!=="redfox.xhs_comments.poll")throw new Error("Unsupported comment task step");
 const sequence=Number(run.progress.pollSequence),taskId=String(run.progress.taskId);if(!Number.isSafeInteger(sequence)||sequence<0||sequence>=limits.polls)throw new Error("Comment polling limit exhausted; query the existing task explicitly");
 const result=await redfoxRequest("LO93CE5K",{taskId},`${identity}:poll:${sequence}`,"poll",paidOptions(execution)),data=parseXhsCommentPoll(result.data,taskId),{commentList,...summary}=data;
 await sql.begin(async tx=>{const current=await requireExecution(tx,execution);await saveResult(tx,execution,{itemKey:`poll:${sequence}`,kind:"xhs_comment_task",receiptId:result.receiptId,data:{...summary,actualCount:commentList?.length??0}});
  for(const [index,record] of (commentList??[]).entries())await saveResult(tx,execution,{itemKey:`poll:${sequence}:comment:${index}`,kind:"xhs_comment",receiptId:result.receiptId,data:{platform:"xiaohongshu",taskId,pollSequence:sequence,record,avatarUrl:commentSafeUrl(record.avatar),pictures:(record.pictures??[]).map(p=>({url:commentSafeUrl(p.url),originUrl:commentSafeUrl(p.originUrl)}))}});
  if(data.status==="completed")await advanceRun(tx,execution,null);else await nextPoll(tx,execution,{...current.progress,pollSequence:sequence+1},new Date(Date.now()+limits.pollIntervalSeconds*1000));
 });
}
