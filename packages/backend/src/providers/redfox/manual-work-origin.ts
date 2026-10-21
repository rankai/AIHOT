import {collectionDiscoveredAt} from "./collection-page-proof.ts";
import {z} from "zod";
import type {Db} from "../../db.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {StaleOperationError} from "../operations/store.ts";
import {shipinhaoOperations} from "./shipinhao-contract.ts";
import {kuaishouOperations} from "./kuaishou-contract.ts";
export const ManualWorkOrigin=z.object({resultId:z.number().int().positive().safe(),workId:z.string().min(1),workIdKind:z.enum(["videoId","photoId"]),discoveredAt:z.iso.datetime()}).strict();
export type ManualWorkOrigin=z.infer<typeof ManualWorkOrigin>;
export function checkedManualOrigin(raw:unknown,target:string,parameters:Record<string,unknown>):ManualWorkOrigin|undefined{
 if(raw===undefined)return undefined;
 const origin=ManualWorkOrigin.parse(raw),kind=target==="OE4KUEUO"?"videoId":target==="UOM99OQI"?"photoId":null;
 if(!kind||origin.workIdKind!==kind||origin.workId!==parameters[kind])throw new StaleOperationError("Origin differs from the requested detail work");
 return origin;
}
/** Only these two documented list-to-detail relationships; no author or source authority. */
export async function manualWorkOrigin(db:Db,resultId:number,target:string,parameters:Record<string,unknown>):Promise<ManualWorkOrigin>{
 const [r]=await db`SELECT z.kind,z.data,z.created_at,z.run_id,z.receipt_id,z.provenance,r.provider,r.operation_key,r.input,p.model,p.status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
 const op:unknown=r?.input.operationId,platform=target==="OE4KUEUO"?"shipinhao":target==="UOM99OQI"?"kuaishou":null;
 if(!r||!platform||r.provider!=="redfox"||r.input.platform!==platform||!["redfox.sync.query","redfox.platform.collection"].includes(r.operation_key)||r.kind!==`${platform}_work`||r.data.platform!==platform||r.data.operationId!==op||r.model!==op||!["received","completed"].includes(r.status))throw new UnsupportedReplacement("Source result is not confirmed work evidence");
 const discoveredAt=await collectionDiscoveredAt(db,r,platform,String(op));
 let id:unknown,kind:"videoId"|"photoId";
 if(platform==="shipinhao"&&(op==="E7G00COY"||op==="OVUTOTCV")){
  shipinhaoOperations[op].schema.parse(r.input.parameters);
  id=z.record(z.string(),z.unknown()).parse(r.data.record).videoId;kind="videoId";
 }else if(platform==="kuaishou"&&(op==="27DQ6SF9"||op==="ZWR31P2A")){
  kuaishouOperations[op].schema.parse(r.input.parameters);
  id=z.record(z.string(),z.unknown()).parse(r.data.record).photoId;kind="photoId";
 }else throw new UnsupportedReplacement("This operation does not provide an approved detail origin");
 if(typeof id!=="string"||!id)throw new UnsupportedReplacement("Source record has no received work ID");
 return checkedManualOrigin({resultId,workId:id,workIdKind:kind,discoveredAt:discoveredAt.toISOString()},target,parameters)!;
}
