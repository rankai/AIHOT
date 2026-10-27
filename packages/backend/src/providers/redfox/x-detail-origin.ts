import {z} from "zod";
import type {Db} from "../../db.ts";
import {stableJson} from "../../lib/ids.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {RedfoxResponseError} from "./client.ts";
import {collectionDiscoveredAt} from "./collection-page-proof.ts";
import {parseXResearch} from "./x-research.ts";
import {xResearchOperations} from "./x-research-contract.ts";
import type {RedfoxTweet} from "./x.ts";
const Id=z.string().regex(/^\d+$/).max(30),Handle=z.string().regex(/^[A-Za-z0-9_]{1,15}$/);
const Origin=z.object({sourceResultId:z.number().int().positive().safe(),tweetId:Id,userId:Id.optional(),username:Handle.optional(),discoveredAt:z.iso.datetime()}).strict();
export async function xDetailOrigin(db:Db,id:number,tweetId:string){
 const [r]=await db`SELECT z.*,r.provider,r.operation_key,r.input,p.model,p.status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${id}`;
 if(!r||r.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(r.operation_key)||r.input.operationId!=="5K5EG87P"||r.input.platform!=="x-research"||r.model!=="5K5EG87P"||!["received","completed"].includes(r.status)||r.kind!=="x_research_work"||r.data.platform!=="x-research"||r.data.operationId!=="5K5EG87P")throw new UnsupportedReplacement("Origin must be a received X search work");
 const p=xResearchOperations["5K5EG87P"].schema.parse(r.input.parameters),parsed=parseXResearch("5K5EG87P",{tweets:[r.data.record]},p)[0]!;
 for(const k of ["workId","identity"])if(stableJson(parsed.data[k]??null)!==stableJson(r.data[k]??null))throw new UnsupportedReplacement("Stored X identity differs from received record");
 const record=z.object({tweetId:Id,user:z.object({userId:Id.optional(),username:z.string().nullable().optional()})}).parse(parsed.data.record);
 if(record.tweetId!==tweetId)throw new UnsupportedReplacement("Detail request differs from received tweet ID");
 const discoveredAt=await collectionDiscoveredAt(db,r,"x-research","5K5EG87P"),handle=Handle.safeParse(record.user.username);
 return Origin.parse({sourceResultId:id,tweetId,userId:record.user.userId,...(handle.success?{username:handle.data}:{}),discoveredAt:discoveredAt.toISOString()});
}
/** Context never changes the supplier Tweet record. */
export function checkedXDetailOrigin(raw:unknown,tweetId:string,tweet:RedfoxTweet){
 if(raw===undefined)return undefined;const o=Origin.parse(raw);
 if(o.tweetId!==tweetId||tweet.tweetId!==o.tweetId||(tweet.author.userId!==undefined&&o.userId!==undefined&&tweet.author.userId!==o.userId))throw new RedfoxResponseError("Tweet detail conflicts with frozen work/author identity");
 return o;
}
export function xDetailContext(tweet:RedfoxTweet,origin:ReturnType<typeof checkedXDetailOrigin>){
 const handle=Handle.safeParse(tweet.author.username);
 return {username:handle.success?handle.data:tweet.author.username==null?origin?.username:undefined};
}
