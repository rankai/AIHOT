import {requireLiveResult} from "../../operations/result-retention.ts";
import { z } from "zod";
import { sql } from "../../db.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { singleXAccount, UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { StaleOperationError } from "../operations/store.ts";

export async function importXAccountResult(resultId: number, raw: unknown, actor: string, key: unknown) {
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  const input=z.object({sourceId:z.string().min(1),reason:z.string().min(1).max(500)}).strict().parse(raw);
  return sql.begin(async(tx)=>{
    const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE control_source_id=${input.sourceId} FOR UPDATE`;
    const [source]=await tx`SELECT * FROM sources WHERE id=${input.sourceId} FOR UPDATE`;
    if (!source) return null;
    const [result]=await tx`SELECT z.*,o.provider,o.operation_key FROM operation_results z JOIN operation_runs o ON o.id=z.run_id WHERE z.id=${resultId} FOR UPDATE OF z`;
    if (!result) return null;
    requireLiveResult(result);
    const intent={sourceId:input.sourceId};
    const previous=result.provenance?.accountImport;
    if (previous?.key===commandKey && previous.sourceId!==input.sourceId) throw new StaleOperationError("Import key reused with different input");
    if (result.source_id) {
      if (result.source_id!==input.sourceId) throw new StaleOperationError("Result already imported to another source");
      return {resultId,sourceId:input.sourceId,userId:result.data.userId};
    }
    if (result.kind!=="account" || result.provider!=="redfox" || result.operation_key!=="redfox.x.account" || !result.receipt_id) throw new UnsupportedReplacement("This result is not a confirmed Redfox X account");
    const account=singleXAccount((sub?.config??source.config).query);
    if (source.kind!=="x_search" || !account || account.handle!==String(result.data.username).toLowerCase() || !/^\d+$/.test(result.data.userId)) throw new UnsupportedReplacement("Account result does not match the source’s complete single-account query");
    if (result.source_id && result.source_id!==input.sourceId) throw new StaleOperationError("Result already imported to another source");
    const other=await tx`SELECT source_id,id_value FROM source_account_bindings WHERE platform='x' AND id_kind='user_id' AND (id_value=${result.data.userId} OR source_id=${input.sourceId})`;
    if(other.some(b=>b.source_id!==input.sourceId || b.id_value!==result.data.userId)) throw new StaleOperationError("Stable account binding conflicts with an existing source");
    try {await bindSourceAccount(tx,{platform:"x",idKind:"user_id",idValue:result.data.userId,sourceId:input.sourceId,evidence:{kind:"result",reference:String(resultId)}});}
    catch(error) {if(error instanceof Error && error.message==="Account identity already belongs to another source") throw new StaleOperationError(error.message);throw error;}
    await tx`UPDATE operation_results SET source_id=${input.sourceId},provenance=provenance || ${tx.json({accountImport:{key:commandKey,...intent}})} WHERE id=${resultId}`;
    await tx`INSERT INTO audit_log(actor,action,subject,reason,before,after) VALUES (${actor},'source.bind_account',${`source:${input.sourceId}`},${input.reason},NULL,${tx.json({resultId,userId:result.data.userId})})`;
    return {resultId,sourceId:input.sourceId,userId:result.data.userId};
  });
}
