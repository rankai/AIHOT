import type {Tx} from "../db.ts";
import type {RunRow} from "../providers/operations/store.ts";
import {eligibleMembers} from "./subscriptions.ts";

/** Caller owns requireExecution's subscription/source/run locks. Only formal primary members affect health. */
export async function recordCollectionFailure(tx:Tx,run:RunRow,message:string,proof?:{receiptId:number;attempt:number}) {
  if(run.input.mode!=="collection"||!run.current_receipt_id)return;
  if(proof&&proof.receiptId!==run.current_receipt_id)return;
  const [receipt]=await tx`SELECT id,attempts,status,received_at FROM receipts WHERE id=${run.current_receipt_id}`;
  if(!receipt||!["failed","received","completed"].includes(receipt.status)||proof&&receipt.attempts!==proof.attempt)return;
  const [attempt]=await tx`SELECT finished_at FROM receipt_attempts WHERE receipt_id=${receipt.id} AND attempt=${receipt.attempts}`;
  const at=attempt?.finished_at??receipt.received_at;if(!at)return;
  const previous=run.progress.lastSourceFailure as {receiptId?:number;attempt?:number}|undefined;
  if(previous?.receiptId===receipt.id&&previous?.attempt===receipt.attempts)return;
  const members=await eligibleMembers(tx,run.id,run.input.members,run.input.forceSourceId);
  for(const member of members)if(member.sourceId)await tx`UPDATE sources SET last_fetch_at=${at},last_error=${message.slice(0,500)},
    fail_count=fail_count+1,health=CASE WHEN fail_count+1>=3 THEN 'failing' ELSE 'degraded' END WHERE id=${member.sourceId}`;
  await tx`UPDATE operation_runs SET progress=progress||${tx.json({lastSourceFailure:{receiptId:receipt.id,attempt:receipt.attempts}})} WHERE id=${run.id}`;
}
