import {collectedDetailContext} from "./collection-detail.ts";
import {applyWorkDetailOrigin} from "./work-detail-origin.ts";
import {sanitizeBody} from "../../content/sanitize.ts";
import {stripTags} from "../../lib/text.ts";
import {importSource} from "../../sources/subscriptions.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { stableJson } from "../../lib/ids.ts";
import { audit } from "../../admin/auth.ts";
import { decideTimeline,upsertMaterial } from "../../content/materials.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseZhihu } from "./zhihu.ts";
import { ZhihuOperationId,zhihuOperations } from "./zhihu-contract.ts";
type ZhihuIdentity=Record<string,string>;
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({uid:z.string().min(1).optional(),url:z.string().min(1).optional(),vertical:z.enum(["answer","article","zvide"]).optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function address(raw:unknown,manual=false):string|null{if(typeof raw!=="string"||raw.includes('#'))return null;try{const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.port||/\.(?:jpe?g|png|webp|mp4|mp3)$/i.test(u.pathname))return null;if(!manual||!(["zhihu.com","www.zhihu.com","zhuanlan.zhihu.com"].includes(u.hostname))||u.pathname==="/"||/\/(?:search|people|org|topic|column)(?:\/|$)/i.test(u.pathname))return null;return raw;}catch{return null;}}
export async function importZhihuResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    const collected=await collectedDetailContext(tx,snapshot),executionInput=collected?.input??snapshot.input;
    const operation=ZhihuOperationId.safeParse(executionInput.operationId);
    if(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="zhihu"||snapshot.data.operationId!==operation.data)throw new UnsupportedReplacement("Not a confirmed Zhihu result");
    const sourceDiscoveredAt=collected?.discoveredAt??await collectionDiscoveredAt(tx,snapshot,"zhihu",operation.data);
    if(snapshot.kind!=="zhihu_work")throw new UnsupportedReplacement("Only received Zhihu works can be imported");
    const parameters=zhihuOperations[operation.data].schema.parse(executionInput.parameters);
    const parsed=parseZhihu(operation.data,operation.data==="API_1792651427872"?snapshot.data.record:[snapshot.data.record],parameters)[0]!,record=parsed.data.record as Record<string,unknown>,received=parsed.data.identity as ZhihuIdentity;
    const origin=applyWorkDetailOrigin(operation.data,parameters,parsed,executionInput.origin);
    const receivedVertical=operation.data==="API_1792651427872"?"article":("vertical" in parameters?parameters.vertical:undefined);
    const vertical=receivedVertical??input.supplement?.vertical;
    if(!vertical)throw new UnsupportedReplacement("Verified answer/article/zvide namespace is required");
    if(receivedVertical&&input.supplement?.vertical&&receivedVertical!==input.supplement.vertical)throw new StaleOperationError("Received namespace cannot be replaced");
    if(received.uid&&input.supplement?.uid&&received.uid!==input.supplement.uid)throw new StaleOperationError("Received author cannot be replaced");
    const identity:ZhihuIdentity={...(received.uid?{uid:received.uid}:input.supplement?.uid?{uid:input.supplement.uid}:{})};
    const original=typeof parsed.data.url==="string"?parsed.data.url:null;
    if(original&&input.supplement?.url&&original!==input.supplement.url)throw new StaleOperationError("Received original URL cannot be replaced");
    const url=original??address(input.supplement?.url,true);
    if(!url)throw new UnsupportedReplacement("A verified original Zhihu URL and evidence are required");
    const namespace=vertical;
    if(snapshot.article_id&&snapshot.source_id&&snapshot.provenance?.zhihuImport?.key===commandKey){
      const [completed]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
      requireLiveResult(completed,snapshot.kind);
      if(!completed!.article_id||!completed!.source_id||completed!.provenance?.zhihuImport?.key!==commandKey||stableJson(completed!.provenance.zhihuImport.intent)!==stableJson({sourceId:input.sourceId??null,supplement:input.supplement??null}))throw new StaleOperationError("Completed import command has different input");
      return {resultId,sourceId:completed!.source_id as string,articleId:completed!.article_id as string};
    }
    const source=await importSource(tx,snapshot.input.members??[],input.sourceId,snapshot.input.forceSourceId,origin?{resultId:origin.resultId,provider:snapshot.provider,runId:snapshot.run_id}:undefined);
    if(!source)throw new UnsupportedReplacement("Select an associated source; subscription/source is missing, disabled or changed");
    const sourceId=source.id;
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.zhihuImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    let articleId:string|null=null;
    {
      const discoveredAt=new Date(origin?.discoveredAt??sourceDiscoveredAt);
      const publishedAt=operation.data==="API_1792651427872"&&typeof record.publishTime==="number"?new Date(record.publishTime*1000):null;
      const body=operation.data==="API_1792651427872"&&typeof record.content==="string"?sanitizeBody(record.content,url):null;
      const author=record.authorNickname??record.authorName??record.nickname;
      const material=await upsertMaterial({sourceId,url:url!,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyUpdate:origin?"fill-missing":undefined,bodyHtml:body,bodyText:body?stripTags(body):null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill:decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time",via:"import",raw:{provider:"redfox",resultId,publishTime:record.publishTime??null,namespace,workId:typeof parsed.data.workId==="string"?parsed.data.workId:null,request:snapshot.input.parameters,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({zhihuImport:{key:commandKey,intent,namespace,workId:typeof parsed.data.workId==="string"?parsed.data.workId:null}})} WHERE id=${resultId}`;
    await audit(actor,"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}
