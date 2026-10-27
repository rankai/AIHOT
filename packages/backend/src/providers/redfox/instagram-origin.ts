import {collectionDiscoveredAt} from "./collection-page-proof.ts";
import type {Db} from "../../db.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {StaleOperationError} from "../operations/store.ts";
import {parseInstagram,type InstagramOrigin} from "./instagram.ts";
import {instagramOperations,instagramRequestCode} from "./instagram-contract.ts";
/** Explicit single-result same-post context; no account lookup by username. */
export async function instagramOrigin(db:Db,resultId:number,parameters:Record<string,unknown>):Promise<InstagramOrigin>{
 const [r]=await db`SELECT z.kind,z.data,z.created_at,z.run_id,z.receipt_id,z.provenance,r.provider,r.operation_key,r.input,p.model,p.status
   FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
 if(!r||r.kind!=="instagram_work"||r.provider!=="redfox"||r.input.platform!=="instagram"||!["redfox.sync.query","redfox.platform.collection"].includes(r.operation_key)||r.input.operationId!=="GM0TISWI"||r.model!=="GM0TISWI"||!["received","completed"].includes(r.status)||r.data.platform!=="instagram"||r.data.operationId!=="GM0TISWI")throw new UnsupportedReplacement("Source result is not confirmed Instagram search evidence");
 const discoveredAt=await collectionDiscoveredAt(db,r,"instagram","GM0TISWI");
 const request=instagramOperations.GM0TISWI.schema.parse(r.input.parameters),item=parseInstagram("GM0TISWI",{items:[r.data.record]},request)[0]!;
 if(!item.data.workId||item.data.workId!==instagramRequestCode(String(parameters.codeOrUrl)))throw new StaleOperationError("Source result differs from requested Instagram shortcode");
 const userId=(item.data.identity as {userId?:string}).userId;
 return {resultId,code:String(item.data.workId),...(userId?{userId}:{}),discoveredAt:discoveredAt.toISOString()};
}
