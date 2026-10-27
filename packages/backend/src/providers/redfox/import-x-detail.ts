import {sql,type Tx} from "../../db.ts";
import {z} from "zod";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {parseTweet} from "./x.ts";
import {checkedXDetailOrigin,xDetailContext} from "./x-detail-origin.ts";
import {importReceivedXWork} from "./import-x-search.ts";
import {xResultSnapshot,agentKeyXEvidence,agentKeyXWork} from "../agentkey/x-evidence.ts";
export async function importXDetailResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
 const execute=async(tx:Tx)=>{
  const [s]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model,p.status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
  if(!s)return null;
  if(s.provider==="agentkey"){
   const evidence=await agentKeyXEvidence(tx,await xResultSnapshot(tx,resultId));
   if(evidence.parsed.kind!=="x_detail_work")throw new UnsupportedReplacement("Not an X detail work");
   return importReceivedXWork(tx,resultId,raw,actor,key,agentKeyXWork(evidence.parsed),evidence.sourceDiscoveredAt,"agentkey");
  }
  if(s.provider!=="redfox"||s.operation_key!=="redfox.x.detail"||s.model!=="QCP75W33"||!["received","completed"].includes(s.status)||!["x_detail_work","article"].includes(s.kind))throw new UnsupportedReplacement("Not a received X detail result");
  const p=z.object({tweetId:z.string().regex(/^\d+$/).max(30)}).strict().parse(s.input.parameters);
  if(s.kind==="x_detail_work"&&(s.data.platform!=="x"||s.data.operationId!=="QCP75W33"))throw new UnsupportedReplacement("Invalid X detail result platform");
  const tweet=parseTweet(s.kind==="article"?s.data:s.data.record,p.tweetId),origin=checkedXDetailOrigin(s.input.origin,p.tweetId,tweet),context=xDetailContext(tweet,origin);
  if(s.kind==="x_detail_work"&&(s.data.workId!==tweet.tweetId||s.data.identity?.userId!==tweet.author.userId))throw new UnsupportedReplacement("Stored detail identity differs from received Tweet");
  return importReceivedXWork(tx,resultId,raw,actor,key,{...tweet,user:{...tweet.author,username:context.username}},new Date(origin?.discoveredAt??s.created_at),"redfox",origin?.sourceResultId);
 };
 return db?execute(db):sql.begin(execute);
}
