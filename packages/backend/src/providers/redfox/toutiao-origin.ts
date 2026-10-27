import {collectionDiscoveredAt} from "./collection-page-proof.ts";
import type {Db} from "../../db.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {StaleOperationError} from "../operations/store.ts";
import {parseToutiao,type ToutiaoOrigin,ToutiaoOrigin as OriginSchema} from "./toutiao.ts";
import {toutiaoOperations} from "./toutiao-contract.ts";
/** Single received work only. A requested account token is never author evidence. */
export async function toutiaoOrigin(db:Db,resultId:number,parameters:Record<string,unknown>):Promise<ToutiaoOrigin>{
 const [r]=await db`SELECT z.kind,z.data,z.created_at,z.run_id,z.receipt_id,z.provenance,r.provider,r.operation_key,r.input,p.model,p.status
   FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
 const op:unknown=r?.input.operationId;
 if(!r||r.kind!=="toutiao_work"||r.provider!=="redfox"||r.input.platform!=="toutiao"||!["redfox.sync.query","redfox.platform.collection"].includes(r.operation_key)||(op!=="28CFGF5I"&&op!=="R1IGR09H")||r.model!==op||!["received","completed"].includes(r.status)||r.data.platform!=="toutiao"||r.data.operationId!==op)throw new UnsupportedReplacement("Source result is not confirmed Toutiao search or account-work evidence");
 const discoveredAt=await collectionDiscoveredAt(db,r,"toutiao",op);
 const request=toutiaoOperations[op].schema.parse(r.input.parameters);
 const item=parseToutiao(op,op==="28CFGF5I"?[r.data.record]:{workList:[r.data.record]},request)[0]!;
 if(!item.data.workId||item.data.workId!==parameters.opusId)throw new StaleOperationError("Source result differs from requested Toutiao work");
 const identity=item.data.identity as {uid?:string;secUid?:string};
 return OriginSchema.parse({resultId,workId:item.data.workId,...identity,discoveredAt:discoveredAt.toISOString()});
}
