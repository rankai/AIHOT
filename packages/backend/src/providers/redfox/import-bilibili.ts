import {lockVideoParentSubscriptions,registerImportedVideo} from "../../sources/subscription-video.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
import {agentKeyBilibiliEvidence} from "../agentkey/bilibili-evidence.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import {applyAccountDetailOrigin} from "./account-detail-origin.ts";
import {collectedDetailContext} from "./collection-detail.ts";
import {applyWorkDetailOrigin} from "./work-detail-origin.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { sha256,stableJson } from "../../lib/ids.ts";
import { bilibiliVideoId } from "../../lib/url.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { decideTimeline,upsertMaterial,type MediaItem } from "../../content/materials.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseBilibili } from "./bilibili.ts";
import { BilibiliOperationId,bilibiliOperations } from "./bilibili-contract.ts";
type BilibiliIdentity={mid?:string};
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({mid:z.string().regex(/^[0-9]+$/).optional(),url:z.url().refine(v=>!!bilibiliVideoId(v),"A native Bilibili BV permalink is required").optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function media(record:Record<string,unknown>):MediaItem[]{
  if(typeof record.picUrl!=="string")return [];
  try{const u=new URL(record.picUrl);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?[{kind:"image",url:record.picUrl}]:[];}catch{return [];}
}
function publicationTime(record:Record<string,unknown>):Date|null{
  const raw=record.created;
  if(typeof raw!=="string"||!z.iso.datetime({offset:true}).safeParse(raw).success)return null;
  const date=new Date(raw);return Number.isFinite(date.getTime())?date:null;
}
export async function importBilibiliResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.step_key,r.contract_version,r.input,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    await lockVideoParentSubscriptions(tx,resultId);
    const agentkey=snapshot.provider==="agentkey";
    if(agentkey&&input.supplement)throw new UnsupportedReplacement("AgentKey Bilibili import requires received evidence; manual supplements are not accepted");
    const verified=agentkey?await agentKeyBilibiliEvidence(tx,snapshot):null;
    const collected=agentkey?null:await collectedDetailContext(tx,snapshot),executionInput=collected?.input??snapshot.input;
    const operation=BilibiliOperationId.safeParse(executionInput.operationId);
    if(!verified&&(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="bilibili"||snapshot.data.operationId!==operation.data))throw new UnsupportedReplacement("Not a confirmed Bilibili result");
    const sourceDiscoveredAt=verified?.sourceDiscoveredAt??collected?.discoveredAt??await collectionDiscoveredAt(tx,snapshot,"bilibili",operation.data!);
    const shape=verified?undefined:bilibiliOperations[operation.data!].shape;
    if(!["bilibili_account","bilibili_work"].includes(snapshot.kind))throw new UnsupportedReplacement("Bilibili query summaries are not importable accounts or works");
    const payload=shape==="accounts"?{accountList:[snapshot.data.record]}:shape==="works"||shape==="account_works"?{workList:[snapshot.data.record],...(shape==="account_works"?{mid:snapshot.data.accountMid}:{})}:snapshot.data.record;
    const parsed=verified?.parsed??parseBilibili(operation.data!,payload,executionInput.parameters)[0];
    if(!parsed||parsed.kind!==snapshot.kind)throw new UnsupportedReplacement("Result kind does not match its received operation record");
    const accountOrigin=executionInput.origin?.kind==="account";
    if(accountOrigin)applyAccountDetailOrigin(operation.data!,executionInput.parameters,parsed!,executionInput.origin);
    const origin=agentkey||accountOrigin?undefined:applyWorkDetailOrigin(operation.data!,executionInput.parameters,parsed!,executionInput.origin);
    const account=parsed.kind==="bilibili_account",record=parsed.data.record as Record<string,unknown>,received=parsed.data.identity as BilibiliIdentity,identity:BilibiliIdentity={...received};
    if(account&&input.supplement)throw new UnsupportedReplacement("Account import requires received stable IDs");
    for(const kind of ["mid"] as const){const extra=input.supplement?.[kind];if(extra&&received[kind]&&extra!==received[kind])throw new StaleOperationError("Received stable identity cannot be replaced");if(extra)identity[kind]=extra;}
    const original=typeof parsed.data.url==="string"?parsed.data.url:null;
    if(original&&input.supplement?.url&&input.supplement.url!==original)throw new StaleOperationError("Received original URL cannot be replaced");
    const url=original??input.supplement?.url;
    const nativeId=url?bilibiliVideoId(url):null;
    if(!account&&(!nativeId||!url))throw new UnsupportedReplacement("A documented native Bilibili video permalink is required; short links are not resolved");
    if(!account&&parsed.data.workId&&parsed.data.workId!==nativeId)throw new StaleOperationError("Received work ID differs from its native original URL");
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    if(!ids.length)throw new UnsupportedReplacement("A verified author MID is required");
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`bilibili:${kind}:${value}`},0))`;
    const owners:string[]=[];
    for(const [kind,value] of ids){const [b]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='bilibili' AND id_kind=${kind} AND id_value=${value}`;if(b)owners.push(b.source_id);}
    if(new Set(owners).size>1)throw new StaleOperationError("Received account IDs belong to different sources");
    const primary=`mid:${identity.mid}`;
    const sourceId=input.sourceId??owners[0]??`bilibili-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");
    if(!account&&input.sourceId&&owners[0]!==input.sourceId)throw new UnsupportedReplacement("Work import follows the verified author, not an arbitrary source");
    let [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(source&&source.kind!=="external")throw new UnsupportedReplacement("Bilibili accounts require an external source");
    if(source&&source.participation_mode!=="isolated"&&ids.some(([kind])=>!received[kind as keyof BilibiliIdentity]))throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='bilibili' AND source_id=${sourceId}`;
    if(prior.some(b=>identity[b.id_kind as keyof BilibiliIdentity]&&identity[b.id_kind as keyof BilibiliIdentity]!==b.id_value))throw new StaleOperationError("Source already has another identity of this type");
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.bilibiliImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(!source){const name=String(record.name??record.author??`B站 ${primary}`).slice(0,200);[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${name},'external',${tx.json({platform:"bilibili"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(!account&&!source!.enabled)throw new UnsupportedReplacement("Author source is disabled; material import is paused");
    for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"bilibili",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    if(!account){
      const body=record.description,publishedAt=publicationTime(record),discoveredAt=new Date(origin?.discoveredAt??sourceDiscoveredAt);
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:`${snapshot.provider}-import-unknown-time`;
      const author=record.author;
      const material=await upsertMaterial({sourceId,url:url!,identityKey:`bilibili:bvId:${nativeId}`,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyUpdate:"fill-missing",bodyText:typeof body==="string"?body:null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:(confirmedVideoMedia(media(record))),via:"import",raw:{provider:snapshot.provider,resultId,created:record.created??null,...(agentkey?{rawTimes:record.rawTimes??{},descriptionRole:record.descriptionRole??null}:{}),request:executionInput.parameters,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({bilibiliImport:{key:commandKey,intent}})} WHERE id=${resultId}`;
    if(articleId)await registerImportedVideo(tx,resultId,{platform:"bilibili",operationId:String(parsed.data.operationId),record:record,confirmed:(true),singleVideo:true,videoProof:"verified-current-work-type",workId:nativeId!});
    await audit(actor,account?"source.bind_account":"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}
