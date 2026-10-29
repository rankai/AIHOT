import {sql,type Tx} from '../db.ts';
import {UnsupportedReplacement} from '../sources/x-replacement.ts';

/** Recheck after the existing source → result lock, before committing any import. */
export function requireLiveResult(result:Record<string,unknown>|undefined,expectedKind?:string):void{
 if(!result||typeof result.kind!=='string'||result.kind==='result_expired'||expectedKind!==undefined&&result.kind!==expectedKind)
  throw new UnsupportedReplacement('Result has expired or changed; this action cannot reuse its former contents');
}
/** The command transaction keeps the proven source alive until its minimal origin is frozen. */
export async function lockOriginResult(tx:Tx,id:number){
 const [result]=await tx`SELECT kind FROM operation_results WHERE id=${id} FOR SHARE`;
 requireLiveResult(result as {kind:string}|undefined);
}

/** Only these persisted relationships reread normalized results; frozen standalone origins do not. */
export async function expireOperationResults(now=new Date()){
 let total=0;
 for(;;){
  const expired=await expireResultBatch(now);
  total+=expired;
  if(!expired)return total;
 }
}
async function expireResultBatch(now:Date){
 return sql.begin(async tx=>{
  const unreferenced=tx`NOT EXISTS(SELECT 1 FROM source_account_bindings b WHERE b.evidence->>'kind'='result' AND b.evidence->>'reference'=z.id::text)
     AND NOT EXISTS(SELECT 1 FROM operation_results d WHERE d.kind<>'result_expired' AND (
       (d.kind='result_attachment' AND d.provenance->>'parentResultId'=z.id::text)
       OR (z.kind='query_summary' AND d.data->>'querySummaryId'=z.id::text
         AND d.run_id=z.run_id AND d.step_version=z.step_version AND d.receipt_id=z.receipt_id)
       OR (d.kind='query_summary' AND d.data->>'originResultId'=z.id::text
         AND d.run_id=z.run_id AND z.step_version<d.step_version)
       OR d.provenance->>'detailSourceResultId'=z.id::text OR d.provenance->>'sourcePageResultId'=z.id::text
       OR (d.run_id=z.run_id AND d.receipt_id=z.receipt_id AND (
         (z.kind='wechat_account_rank' AND d.kind='wechat_work' AND d.item_key IN(z.item_key||':maxWork',z.item_key||':minWork'))
         OR (z.kind='dongchedi_account' AND d.kind='dongchedi_work')))))
     AND NOT EXISTS(SELECT 1 FROM operation_runs a WHERE a.status IN ('active','waiting','needs_review','stopped')
       AND a.progress->>'detailSourceResultId'=z.id::text)`;
  const candidates=await tx`SELECT z.id FROM operation_results z JOIN operation_runs r ON r.id=z.run_id
   WHERE r.status IN ('completed','failed') AND z.kind<>'result_expired'
    AND z.article_id IS NULL AND z.source_id IS NULL AND z.file_key IS NULL
    AND coalesce(z.expires_at,z.created_at+interval '30 days')<=${now}
    AND ${unreferenced}
   ORDER BY z.id LIMIT 200 FOR UPDATE OF z SKIP LOCKED`;
  let expired=0;
  for(const candidate of candidates){
   const rows=await tx`UPDATE operation_results z SET kind='result_expired',
    data=jsonb_build_object('originalKind',z.kind,'originalStatus',z.data->>'status','expiredAt',${now.toISOString()}::text)
    WHERE z.id=${candidate.id} AND z.kind<>'result_expired'
     AND z.article_id IS NULL AND z.source_id IS NULL AND z.file_key IS NULL
     AND coalesce(z.expires_at,z.created_at+interval '30 days')<=${now}
     AND EXISTS(SELECT 1 FROM operation_runs r WHERE r.id=z.run_id AND r.status IN ('completed','failed'))
     AND ${unreferenced}
    RETURNING z.id`;
   expired+=rows.count;
  }
  return expired;
 });
}
