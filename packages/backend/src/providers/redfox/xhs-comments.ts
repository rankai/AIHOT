import { assertKnownNonVideoCost, isAdminToolActor } from '../tool-cost-policy.ts';
import type { ToolAuthorization } from "../../users/credits.ts";
import {z} from "zod";
import {sql} from "../../db.ts";
import {stableJson} from "../../lib/ids.ts";
import {createRun,StaleOperationError,type RunRow} from "../operations/store.ts";
import {queueOperationStep} from "../operations/queue.ts";
import {XhsCommentInput,XhsCommentQuery,XHS_COMMENT_LIMITS} from "./xhs-comments-contract.ts";
export const createXhsComments=(raw:unknown,actor:string,key:unknown,authorization?:ToolAuthorization)=>command(XhsCommentInput.parse(raw),actor,key,false,authorization);
export const createXhsCommentQuery=(raw:unknown,actor:string,key:unknown,authorization?:ToolAuthorization)=>command(XhsCommentQuery.parse(raw),actor,key,true,authorization);
async function command(parameters:Record<string,unknown>,actor:string,key:unknown,query:boolean,authorization?:ToolAuthorization){
 const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),operation=query?"redfox.xhs_comments.query":"redfox.xhs_comments.submit",intent={operation,parameters};
 return sql.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
  const [existing]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;
  if(existing){if(stableJson(existing.input.commandIntent)!==stableJson(intent))throw new StaleOperationError("Command key reused with different input");return existing;}
  if(!query && isAdminToolActor(actor))assertKnownNonVideoCost("xhs-comments",parameters);
  const run=await createRun(tx,{actor,authorization,commandKey,provider:"redfox",operationKey:operation,contractVersion:1,input:{commandIntent:intent,parameters,mode:query?"xhs-comments-query":"xhs-comments",startedAt:new Date().toISOString()},stepKey:query?"redfox.xhs_comments.poll":"redfox.xhs_comments.submit",limits:{...XHS_COMMENT_LIMITS,...(query?{pollDeadlineSeconds:48*3600}: {})}});
  await tx`UPDATE operation_runs SET progress=${tx.json({pollSequence:0,...(query?{taskId:parameters.taskId}: {})} as never)} WHERE id=${run.id}`;await queueOperationStep(tx,run.id);return run;
 });
}
export function xhsCommentLimits(run:RunRow){const result={...XHS_COMMENT_LIMITS};for(const key of Object.keys(result) as Array<keyof typeof result>){const v=run.limits[key];if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0)throw new Error("Comment task lacks valid frozen limits");result[key]=v;}return result;}
export function xhsCommentOptions(){return {platform:"xiaohongshu",library:"wide",defaultDataNum:20,allDataNum:-1,dataNumMax:Number.MAX_SAFE_INTEGER,dataNumMaxBasis:"local-safe-integer",idMaxLength:500,services:{submission:"redfox.query",poll:"redfox.poll"},billing:{unitComments:20,documentedBaseCny:0.06,submissionCost:null,basis:"Actual comments are billed in batches of 20; rounding, minimum and failure billing are unverified."},limits:XHS_COMMENT_LIMITS,queryPollDeadlineSeconds:48*3600,deadlineBasis:"Local deadline starts at run creation, including time waiting for budget; 72 hours for submission and 48 hours for an existing task query. After expiration, review and explicitly query the retained task ID.",firstPollBasis:"24 hours after locally receiving submission; visibleAfterTime has no verified timezone",resultKinds:["xhs_comment_task","xhs_comment"]};}
