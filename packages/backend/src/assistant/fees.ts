import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Db, type Tx } from "../db.ts";
import { AccountError } from "../users/accounts.ts";
import { requireCreditUser } from "../users/credits-core.ts";
import { selectToolPrice } from "../users/credits-prices.ts";
import { normalizeToolInput } from "../users/tool-input.ts";
import { lockMemberAdmission } from "../providers/operations/store.ts";
import { modelPolicy } from "./config.ts";
import { ownedSession, conflict, event } from "./store.ts";
import type { AssistantFeeAuthorization, AssistantFeePrice, AssistantFeeSettings } from "@aihot/contracts/assistant";
import type { ToolPrice } from "@aihot/contracts/credits";
const Price = z.object({priceId:z.string().uuid(),priceVersion:z.number().int().positive(),amount:z.number().int().nonnegative()}).strict();
const dto = (p:ToolPrice):AssistantFeePrice => ({priceId:p.id,priceVersion:p.version,amount:p.baseCredits});
export const autoRequired = () => new AccountError(409,"auto_confirmation_required","自动授权范围、价格或额度已变化，请逐次确认或重新设置授权");
export async function feePrices(userId:number, db:Db=sql) {
 const model=await modelPolicy();
 const turn=dto(await selectToolPrice(db,{kind:"assistant-turn",provider:"assistant",model:model.model,input:{}}));
 let search:AssistantFeePrice|null=null;
 try {
 const normalized=await normalizeToolInput(`user:${userId}`,"query",{provider:"redfox",operationId:"3X8FGEEM",parameters:{keyword:"授权价格",startDate:"2026-01-01",endDate:"2026-01-01",pageNum:1,pageSize:50}});
 search=dto(await selectToolPrice(db,normalized.intent));
 } catch (error) {
   if (!(error instanceof AccountError) || !["tool_unpriced", "cost_unverified", "capability_unavailable"].includes(error.code)) throw error;
 }
 return {turn,search};
}
async function usage(db:Db, sessionId:string) {
 const [r]=await db`SELECT coalesce(sum(amount-released),0)::bigint used FROM (SELECT DISTINCT c.id,c.amount,c.released FROM assistant_auto_charges a JOIN assistant_fee_authorizations f ON f.id=a.authorization_id JOIN member_credit_authorized_runs l ON l.run_id=a.run_id JOIN member_credit_charges c ON c.id=l.charge_id WHERE f.session_id=${sessionId}) charges`;
 return Number(r!.used);
}
export async function readFeeAuthorization(db:Db,sessionId:string):Promise<AssistantFeeAuthorization|null> {
 const [r]=await db`SELECT * FROM assistant_fee_authorizations WHERE session_id=${sessionId} ORDER BY version DESC LIMIT 1`;
 if(!r)return null;
 const used=await usage(db,sessionId);
 return {id:r.id,version:r.version,enabled:r.enabled&&!r.revoked_at,totalLimit:r.total_limit,allowSearch:r.allow_search,turnPrice:r.turn_price,searchPrice:r.search_price,perTurnLimit:r.per_turn_limit,used,remaining:Math.max(0,r.total_limit-used)};
}
export async function feeSettings(userId:number,id:string):Promise<AssistantFeeSettings> {
 await ownedSession(sql,userId,id);
 return {authorization:await readFeeAuthorization(sql,id),prices:await feePrices(userId)};
}
export async function setFeeAuthorization(userId:number,id:string,raw:unknown) {
 const i=z.discriminatedUnion("enabled",[
 z.object({enabled:z.literal(false),expectedVersion:z.number().int().nonnegative()}).strict(),
 z.object({enabled:z.literal(true),expectedVersion:z.number().int().nonnegative(),totalLimit:z.number().int().positive().max(2147483647),allowSearch:z.boolean(),turnPrice:Price,searchPrice:Price.nullable()}).strict()]).parse(raw);
 return sql.begin(async tx=>{
 await lockMemberAdmission(tx,`user:${userId}`); await ownedSession(tx,userId,id,true); await requireCreditUser(tx,userId,true);
 const old=await readFeeAuthorization(tx,id);
 if((old?.version??0)!==i.expectedVersion)throw conflict("费用授权已变化，请刷新");
 if(!i.enabled){
 if(old)await tx`UPDATE assistant_fee_authorizations SET enabled=false,revoked_at=coalesce(revoked_at,now()) WHERE id=${old.id}`;
 }else{
 const prices=await feePrices(userId,tx);
 const same=(a:AssistantFeePrice|null,b:AssistantFeePrice|null)=>!!a&&!!b&&a.priceId===b.priceId&&a.priceVersion===b.priceVersion&&a.amount===b.amount;
 if(!same(i.turnPrice,prices.turn)||(i.allowSearch&&(!prices.search||!same(i.searchPrice,prices.search))))throw autoRequired();
 if(old)await tx`UPDATE assistant_fee_authorizations SET revoked_at=coalesce(revoked_at,now()) WHERE id=${old.id}`;
 const perTurn=prices.turn.amount+(i.allowSearch?prices.search!.amount:0);
 await tx`INSERT INTO assistant_fee_authorizations(id,session_id,version,enabled,total_limit,allow_search,turn_price,search_price,per_turn_limit) VALUES (${randomUUID()},${id},${(old?.version??0)+1},true,${i.totalLimit},${i.allowSearch},${tx.json(prices.turn as never)},${i.allowSearch?tx.json(prices.search as never):null},${perTurn})`;
 }
 await event(tx,id,"fee_authorization",id);
 return {authorization:await readFeeAuthorization(tx,id)};
 });
}
/** Caller holds member admission then session lock. Charges and this evidence commit together. */
export async function checkAuto(tx:Tx,userId:number,sessionId:string,authorizationId:string,quoteId:string,kind:"turn"|"search",turnId?:string) {
 const [a]=await tx`SELECT * FROM assistant_fee_authorizations WHERE id=${authorizationId} AND session_id=${sessionId}`;
 const [q]=await tx`SELECT * FROM member_tool_quotes WHERE id=${quoteId} AND user_id=${userId} AND expires_at>now()`;
 if(!a||!a.enabled||a.revoked_at||!q||q.created_at<a.created_at)throw autoRequired();
 const p=kind==="turn"?a.turn_price:a.search_price;
 if(!p||q.price_id!==p.priceId||q.price_version!==p.priceVersion||q.amount!==p.amount||(kind==="search"&&!a.allow_search))throw autoRequired();
 if(await usage(tx,sessionId)+q.amount>a.total_limit)throw autoRequired();
 if(turnId){
 const [used]=await tx`SELECT count(*) FILTER (WHERE ac.kind='search')::int searches,coalesce(sum(c.amount-c.released),0)::bigint amount FROM assistant_auto_charges ac JOIN member_credit_authorized_runs l ON l.run_id=ac.run_id JOIN member_credit_charges c ON c.id=l.charge_id WHERE ac.turn_id=${turnId}`;
 if(used!.searches>=1||Number(used!.amount)+q.amount>a.per_turn_limit)throw autoRequired();
 const [unknown]=await tx`SELECT r.id FROM operation_runs r JOIN receipts p ON p.id=r.current_receipt_id WHERE p.status IN ('pending','unknown') AND (r.id=(SELECT parent_operation_run_id FROM assistant_turns WHERE id=${turnId}) OR r.id IN (SELECT child_run_id FROM assistant_tool_calls WHERE turn_id=${turnId}))`;
 if(unknown)throw autoRequired();
 }
 return a;
}
export async function linkAuto(tx:Tx,runId:number,authorizationId:string,turnId:string,kind:"turn"|"search",quoteId:string){
 await tx`INSERT INTO assistant_auto_charges(run_id,authorization_id,turn_id,kind,quote_id) VALUES (${runId},${authorizationId},${turnId},${kind},${quoteId})`;
}

/** A stopped run is not evidence that its in-flight/unknown request was accounted for.
 * Match settlement's charge-linked receipt sources; finalized reconciliation can release
 * this fence without rewriting an immutable unknown receipt. Submission holds session lock. */
export async function assertSessionReceiptsReviewed(db:Db, sessionId:string) {
 const [pending] = await db`WITH session_runs AS (
   SELECT parent_operation_run_id AS id FROM assistant_turns WHERE session_id=${sessionId}
   UNION SELECT c.child_run_id FROM assistant_tool_calls c JOIN assistant_turns t ON t.id=c.turn_id
     WHERE t.session_id=${sessionId} AND c.child_run_id IS NOT NULL
 ), unresolved_charges AS (
   SELECT DISTINCT c.id FROM member_credit_charges c JOIN member_credit_authorized_runs l ON l.charge_id=c.id
     WHERE l.run_id IN (SELECT id FROM session_runs) AND c.state IN ('reserved','review')
 ), linked AS (
   SELECT r.* FROM operation_runs r JOIN member_credit_authorized_runs l ON l.run_id=r.id
     WHERE l.charge_id IN (SELECT id FROM unresolved_charges)
 ), receipt_ids AS (
   SELECT current_receipt_id AS id FROM linked WHERE current_receipt_id IS NOT NULL
   UNION SELECT receipt_id FROM operation_results WHERE run_id IN (SELECT id FROM linked) AND receipt_id IS NOT NULL
   UNION SELECT jsonb_array_elements_text(coalesce(progress->'retainedReceiptIds','[]'))::bigint FROM linked
 ) SELECT id FROM receipts WHERE id IN (SELECT id FROM receipt_ids) AND status IN ('pending','unknown') LIMIT 1`;
 if(pending)throw new AccountError(409,"assistant_request_unresolved","本会话仍有在途或结果未知的请求。请刷新原任务状态；若仍未确认，请联系管理员核对积分后再创作。");
}
