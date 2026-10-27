import {collectionDiscoveredAt} from "./collection-page-proof.ts";
import type {Db} from "../../db.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {StaleOperationError} from "../operations/store.ts";
import {parseYoutube,type YoutubeOrigin} from "./youtube.ts";
import {youtubeOperations} from "./youtube-contract.ts";
/** Explicit single-result detail context. No author-name search or cross-result scan. */
export async function youtubeOrigin(db:Db,resultId:number,operation:string,parameters:Record<string,unknown>):Promise<YoutubeOrigin>{
 if(operation!=="609DF2IR")throw new UnsupportedReplacement("Source result context is supported only for YouTube search-to-detail");
 const [r]=await db`SELECT z.kind,z.data,z.created_at,z.run_id,z.receipt_id,z.provenance,r.provider,r.operation_key,r.input,p.model,p.status
   FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
 if(!r||r.kind!=="youtube_work"||r.provider!=="redfox"||r.input.platform!=="youtube"||!["redfox.sync.query","redfox.platform.collection"].includes(r.operation_key)||r.input.operationId!=="GC5SC5HS"||r.model!=="GC5SC5HS"||!["received","completed"].includes(r.status)||r.data.platform!=="youtube"||r.data.operationId!=="GC5SC5HS")throw new UnsupportedReplacement("Source result is not confirmed YouTube search evidence");
 const discoveredAt=await collectionDiscoveredAt(db,r,"youtube","GC5SC5HS");
 const request=youtubeOperations.GC5SC5HS.schema.parse(r.input.parameters);
 const item=parseYoutube("GC5SC5HS",{videos:[r.data.record]},request)[0]!;
 if(!item.data.workId||item.data.workId!==parameters.videoId)throw new StaleOperationError("Source result differs from requested YouTube video");
 const channelId=(item.data.identity as {channelId?:string}).channelId;
 return {resultId,videoId:String(item.data.workId),...(channelId?{channelId}:{}),discoveredAt:discoveredAt.toISOString()};
}
