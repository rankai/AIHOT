import {agentKeyWeiboEvidence} from "../agentkey/weibo-evidence.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import {applyAccountDetailOrigin} from "./account-detail-origin.ts";
import {collectedDetailContext} from "./collection-detail.ts";
import {applyWeiboCarDetailOrigin} from "./weibo-car-detail-origin.ts";
import { z } from "zod";
import { sql, type Tx } from "../../db.ts";
import { sha256,stableJson } from "../../lib/ids.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { decideTimeline,upsertMaterial } from "../../content/materials.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseWeibo,WeiboAccount,WeiboWork,weiboPublishedAt,weiboMedia } from "./weibo.ts";
import { weiboOperations,WeiboOperationId } from "./weibo-contract.ts";
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({uid:z.string().regex(/^\d+$/).max(100).optional(),url:z.url().optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
export async function importWeiboResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async (tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.step_key,r.contract_version,r.input,r.limits,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    const agentkey=snapshot.provider==="agentkey";
    if(agentkey&&input.supplement)throw new UnsupportedReplacement("AgentKey requires original received identity; manual supplements are not supported");
    const verified=agentkey?await agentKeyWeiboEvidence(tx,snapshot):null;
    const collected=agentkey?null:await collectedDetailContext(tx,snapshot),executionInput=collected?.input??snapshot.input;
    if(!verified&&(snapshot.provider!=="redfox" || !["redfox.sync.query","redfox.weibo.collection"].includes(snapshot.operation_key) || !WeiboOperationId.safeParse(executionInput.operationId).success || !snapshot.receipt_id))throw new UnsupportedReplacement("Not a confirmed Weibo result");
    const account=snapshot.kind==="weibo_account";
    if(!account && snapshot.kind!=="weibo_work")throw new UnsupportedReplacement("Trend snapshots cannot be imported as articles");
    const received=verified?.parsed.data??snapshot.data;
    const data=account?WeiboAccount.parse(received):WeiboWork.parse(received);
    const operation=agentkey?undefined:WeiboOperationId.parse(executionInput.operationId),parameters=operation?weiboOperations[operation].schema.parse(executionInput.parameters):{};
    if(executionInput.origin!==undefined&&(snapshot.receipt_model!==operation||!["received","completed"].includes(snapshot.receipt_status)))throw new UnsupportedReplacement("Invalid detail receipt evidence");
    const detail=executionInput.origin===undefined?{kind:snapshot.kind,data:{...data,platform:"weibo"}}:parseWeibo(operation!,data,parameters)[0]!;
    const accountOrigin=!agentkey&&executionInput.origin?.kind==="account";
    if(accountOrigin)applyAccountDetailOrigin(operation!,parameters,detail,executionInput.origin);
    const origin=agentkey||accountOrigin?undefined:applyWeiboCarDetailOrigin(operation!,parameters,detail,executionInput.origin);
    if(origin?.identity.uid&&!data.uid)data.uid=origin.identity.uid;
    if(data.uid && input.supplement?.uid && data.uid!==input.supplement.uid)throw new StaleOperationError("Confirmed author UID cannot be replaced");
    const uid=data.uid??input.supplement?.uid;
    if(!uid)throw new UnsupportedReplacement("A verified author UID is required");
    if(account && input.supplement)throw new UnsupportedReplacement("Account binding requires the received UID");
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`weibo:account:${uid}`},0))`;
    const [binding]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='weibo' AND id_kind='uid' AND id_value=${uid}`;
    const sourceId=input.sourceId??binding?.source_id??`weibo-${sha256(uid).slice(0,24)}`;
    if(binding && binding.source_id!==sourceId)throw new StaleOperationError("Weibo UID already belongs to another source");
    if(!account && input.sourceId && binding?.source_id!==input.sourceId)throw new UnsupportedReplacement("Work imports use the confirmed author binding, not an arbitrary source");
    let [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(source && source.kind!=="external")throw new UnsupportedReplacement("Weibo accounts require an external source");
    if(source && !data.uid && source.participation_mode!=="isolated")throw new UnsupportedReplacement("A manually supplied UID cannot inherit an existing source's publication permissions");
    if(!source && input.sourceId)return null;
    const others=await tx`SELECT id_value FROM source_account_bindings WHERE platform='weibo' AND source_id=${sourceId}`;
    if(others.some(x=>x.id_value!==uid))throw new StaleOperationError("Source is already bound to another Weibo UID");
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null};
    const previous=result!.provenance?.weiboImport;
    if(previous?.key===commandKey && stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id || result!.article_id){
      if(result!.source_id!==sourceId || (previous && stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with a different target or evidence");
      return {resultId,sourceId,articleId:result!.article_id};
    }
    if(!source){
      [source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at)
        VALUES (${sourceId},${String(data.nickname??data.name??`微博 ${uid}`).slice(0,200)},'external',${tx.json({platform:"weibo",uid})},'isolated',false,false,true,NULL) RETURNING *`;
    }
    if(!account && !source!.enabled)throw new UnsupportedReplacement("Author source is disabled; material import is paused");
    try{await bindSourceAccount(tx,{platform:"weibo",idKind:"uid",idValue:uid,sourceId,evidence:{kind:"result",reference:String(resultId)}});}catch(e){if(e instanceof Error && e.message==="Account identity already belongs to another source")throw new StaleOperationError(e.message);throw e;}
    let articleId:string|null=null;
    if(!account){
      const work=WeiboWork.parse(data),originalUrl=work.opusUrl||work.url;
      const confirmedShortId=verified||snapshot.receipt_model==="API_1789098514899"?work.mblogid:null;
      if(originalUrl && input.supplement?.url && originalUrl!==input.supplement.url)throw new StaleOperationError("Received work URL cannot be replaced");
      const url=originalUrl??input.supplement?.url;
      if(!work.opusId || !url)throw new UnsupportedReplacement("Work ID and verified original URL are required");
      const parsed=new URL(url);const parts=parsed.pathname.split("/").filter(Boolean);
      if(!["http:","https:"].includes(parsed.protocol) || !["weibo.com","www.weibo.com"].includes(parsed.hostname) || parsed.username || parsed.password || parts.length!==2 || parts[0]!==uid || ![work.opusId,confirmedShortId].includes(parts[1]))throw new UnsupportedReplacement("Original URL does not verify the work and author identities");
      let discoveredAt=new Date(verified?.sourceDiscoveredAt??origin?.discoveredAt??snapshot.created_at);
      const pageResultId=result!.provenance?.sourcePageResultId;
      if(!collected&&snapshot.operation_key==="redfox.weibo.collection" && pageResultId!==undefined){
        if(!Number.isSafeInteger(pageResultId)||pageResultId<=0)throw new UnsupportedReplacement("Invalid source-page discovery reference");
        const [page]=await tx`SELECT z.created_at FROM operation_results z JOIN receipts p ON p.id=z.receipt_id
          WHERE z.id=${pageResultId} AND z.run_id=${snapshot.run_id} AND z.kind='query_summary'
          AND z.data->>'platform'='weibo' AND z.data->>'operationId'='TXQPVGJG'
          AND z.item_key='page:'||(z.data->>'page') AND p.model='TXQPVGJG' AND p.status IN ('received','completed')`;
        if(executionInput.operationId!=="TXQPVGJG"||!page)throw new UnsupportedReplacement("Source-page discovery reference does not match this collection");
        discoveredAt=new Date(page.created_at);
      }
      const publishedAt=weiboPublishedAt(work.publishTime);
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:agentkey?"agentkey-import-unknown-time":"redfox-import-unknown-time";
      const bodyText=agentkey&&received.isLongText!==false?null:work.text;
      const material=await upsertMaterial({sourceId,url,identityKey:`weibo:opusId:${work.opusId}`,title:(work.text??"微博作品").slice(0,200),author:work.nickname,bodyUpdate:origin||verified?.detail?"fill-missing":undefined,bodyText,bodyStatus:bodyText?"ok":"pending",publishedAt,discoveredAt,backfill,media:weiboMedia(work),via:"import",raw:{provider:agentkey?"agentkey":"redfox",resultId,publishTime:work.publishTime??null,...(agentkey?{upstream:"TikHub",operationId:executionInput.operationId,tool:executionInput.tool,urlSource:received.urlSource,isLongText:received.isLongText??null,textScope:received.textScope,receivedText:work.text??null}: {})},
        confirmedIdentity:confirmedShortId?{platform:"weibo",opusId:work.opusId,mblogid:confirmedShortId,uid,evidence:{kind:"result",reference:String(resultId)}}:undefined},tx);
      articleId=material.articleId;
      if(material.created || material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({weiboImport:{key:commandKey,intent}})} WHERE id=${resultId}`;
    await audit(actor,account?"source.bind_account":"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,uid,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}
