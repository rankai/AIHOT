import {requireLiveResult} from "../../operations/result-retention.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { sha256,stableJson } from "../../lib/ids.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { upsertMaterial } from "../../content/materials.ts";
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
    const operation=ZhihuOperationId.safeParse(snapshot.input.operationId);
    if(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="zhihu"||snapshot.data.operationId!==operation.data)throw new UnsupportedReplacement("Not a confirmed Zhihu result");
    const sourceDiscoveredAt=await collectionDiscoveredAt(tx,snapshot,"zhihu",operation.data);
    if(snapshot.kind!=="zhihu_work")throw new UnsupportedReplacement("Only received Zhihu works can be imported");
    const parameters=zhihuOperations[operation.data].schema.parse(snapshot.input.parameters);
    const parsed=parseZhihu(operation.data,[snapshot.data.record],parameters)[0]!,record=parsed.data.record as Record<string,unknown>,received=parsed.data.identity as ZhihuIdentity;
    const vertical=parameters.vertical??input.supplement?.vertical;
    if(!vertical)throw new UnsupportedReplacement("Verified answer/article/zvide namespace is required");
    if(parameters.vertical&&input.supplement?.vertical&&parameters.vertical!==input.supplement.vertical)throw new StaleOperationError("Received namespace cannot be replaced");
    if(received.uid&&input.supplement?.uid&&received.uid!==input.supplement.uid)throw new StaleOperationError("Received author cannot be replaced");
    const identity:ZhihuIdentity={...(received.uid?{uid:received.uid}:input.supplement?.uid?{uid:input.supplement.uid}:{})};
    const url=address(input.supplement?.url,true);
    if(!url)throw new UnsupportedReplacement("A verified original Zhihu URL and evidence are required");
    const namespace=vertical;
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    if(!ids.length)throw new UnsupportedReplacement("A verified typed author identity is required");
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`zhihu:${kind}:${value}`},0))`;
    const owners:string[]=[];
    for(const [kind,value] of ids){const [b]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='zhihu' AND id_kind=${kind} AND id_value=${value}`;if(b)owners.push(b.source_id);}
    if(new Set(owners).size>1)throw new StaleOperationError("Received account IDs belong to different sources");
    const primary=ids.map(([kind,value])=>`${kind}:${value}`).join("|");
    const sourceId=input.sourceId??owners[0]??`zhihu-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");

    let [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(source&&input.sourceId&&!owners.length&&(source.participation_mode!=="isolated"||!input.supplement?.evidence))throw new UnsupportedReplacement("Unbound target requires isolated source and manual evidence");
    if(source&&source.kind!=="external")throw new UnsupportedReplacement("Zhihu accounts require an external source");
    if(source&&source.participation_mode!=="isolated"&&ids.some(([kind])=>!received[kind as keyof ZhihuIdentity]))throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='zhihu' AND source_id=${sourceId}`;
    if(prior.some(b=>identity[b.id_kind as keyof ZhihuIdentity]&&identity[b.id_kind as keyof ZhihuIdentity]!==b.id_value))throw new StaleOperationError("Source already has another identity of this type");
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.zhihuImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(!source){const name=String(record.nickname??`作者 ${primary}`).slice(0,200);[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${name},'external',${tx.json({platform:"zhihu"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(!source!.enabled)throw new UnsupportedReplacement("Author source is disabled; material import is paused");
    for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"zhihu",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    {
      const discoveredAt=sourceDiscoveredAt;
      const author=record.authorName??record.nickname;
      const material=await upsertMaterial({sourceId,url:url!,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyStatus:"pending",publishedAt:null,discoveredAt,backfill:"redfox-import-unknown-time",via:"import",raw:{provider:"redfox",resultId,publishTime:record.publishTime??null,namespace,workId:typeof parsed.data.workId==="string"?parsed.data.workId:null,request:snapshot.input.parameters,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({zhihuImport:{key:commandKey,intent,namespace,workId:typeof parsed.data.workId==="string"?parsed.data.workId:null}})} WHERE id=${resultId}`;
    await audit(actor,"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}
