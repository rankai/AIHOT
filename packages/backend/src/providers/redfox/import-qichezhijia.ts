import {requireLiveResult} from "../../operations/result-retention.ts";
import {collectedDetailContext} from "./collection-detail.ts";
import {applyWeiboCarDetailOrigin} from "./weibo-car-detail-origin.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { sha256,stableJson } from "../../lib/ids.ts";
import { normalizeUrl } from "../../lib/url.ts";
import { sanitizeBody } from "../../content/sanitize.ts";
import { stripTags } from "../../lib/text.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { decideTimeline,upsertMaterial,type MediaItem } from "../../content/materials.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseQichezhijia } from "./qichezhijia.ts";
import { QichezhijiaOperationId,qichezhijiaOperations } from "./qichezhijia-contract.ts";
type QichezhijiaIdentity=Record<string,string>;
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({authorId:z.string().min(1).optional(),url:z.string().min(1).optional(),authorNamespace:z.enum(["original","chejiahao","club"]).optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function address(raw:unknown,manual=false):string|null{if(typeof raw!=="string"||raw.includes('#'))return null;try{const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.port||/\.(?:jpe?g|png|webp|mp4|mp3)$/i.test(u.pathname))return null;const known=(["chejiahao.autohome.com.cn","chejiahao.m.autohome.com.cn"].includes(u.hostname)&&/^\/info\/[^/]+\/?$/.test(u.pathname))||(u.hostname==="v.autohome.com.cn"&&/^\/v-[^/]+\.html$/.test(u.pathname));if(known)return raw;if(manual&&(u.hostname==="autohome.com.cn"||u.hostname.endsWith(".autohome.com.cn"))&&u.pathname!=="/"&&!/\/(?:search|user|author|account)(?:\/|$)/i.test(u.pathname))return raw;return null;}catch{return null;}}
function media(record:Record<string,unknown>):MediaItem[]{const out:MediaItem[]=[];for(const [field,kind] of [["coverUrl","image"],["thumbnail","image"],["videoUrl","video"]] as const){const raw=record[field];if(typeof raw!=="string")continue;try{const u=new URL(raw);if(["http:","https:"].includes(u.protocol)&&!u.username&&!u.password)out.push({kind,url:raw});}catch{}}return out;}
function publicationTime(record:Record<string,unknown>):Date|null{const raw=record.publishTime;if(typeof raw!=="string"||!z.iso.datetime({offset:true}).safeParse(raw).success)return null;const d=new Date(raw);return Number.isFinite(d.getTime())?d:null;}
export async function importQichezhijiaResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    const collected=await collectedDetailContext(tx,snapshot),executionInput=collected?.input??snapshot.input;
    const operation=QichezhijiaOperationId.safeParse(executionInput.operationId);
    if(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="qichezhijia"||snapshot.data.operationId!==operation.data)throw new UnsupportedReplacement("Not a confirmed Qichezhijia result");
    const sourceDiscoveredAt=collected?.discoveredAt??await collectionDiscoveredAt(tx,snapshot,"qichezhijia",operation.data);
    if(snapshot.kind!=="qichezhijia_work")throw new UnsupportedReplacement("Only received Autohome works can be imported");
    const parameters=qichezhijiaOperations[operation.data].schema.parse(executionInput.parameters) as Record<string,unknown>,record=snapshot.data.record as Record<string,unknown>;
    const payload=operation.data==="4BOZ9DLE"?{workList:[record]}:operation.data==="CI7VW144"?[record]:record;
    const parsed=parseQichezhijia(operation.data,payload,parameters)[0]!;
    const origin=applyWeiboCarDetailOrigin(operation.data,parameters,parsed,executionInput.origin);
    let namespace:string|undefined=operation.data==="4BOZ9DLE"?"original":operation.data==="LLCI8QTE"?"chejiahao":operation.data==="TE6AGWAF"?(parameters.videoType===4?"chejiahao":"original"):parameters.sourceType==="club"?"club":record.workType==="14"?"chejiahao":record.workType==="3"?"original":undefined;
    namespace??=origin?.workType.startsWith("chejiahao_")?"chejiahao":origin?.workType==="original_video"?"original":undefined;
    const original=address(parsed.data.url);
    if(original){const host=new URL(original).hostname,inferred=host.startsWith("chejiahao.")?"chejiahao":host==="v.autohome.com.cn"?"original":undefined;if(namespace&&inferred&&namespace!==inferred)throw new StaleOperationError("Received author namespace conflicts with original URL");namespace??=inferred;}
    if(namespace&&input.supplement?.authorNamespace&&namespace!==input.supplement.authorNamespace)throw new StaleOperationError("Received namespace cannot be replaced");
    const received:QichezhijiaIdentity=namespace&&typeof record.authorId==="string"&&record.authorId?{[`${namespace}_authorId`]:record.authorId}:{};
    Object.assign(received,origin?.identity);
    namespace??=input.supplement?.authorNamespace;
    if(!namespace)throw new UnsupportedReplacement("Verified original/chejiahao/club author namespace is required");
    if(received[`${namespace}_authorId` as keyof QichezhijiaIdentity]&&input.supplement?.authorId&&received[`${namespace}_authorId` as keyof QichezhijiaIdentity]!==input.supplement.authorId)throw new StaleOperationError("Received author cannot be replaced");
    const authorId=record.authorId??received[`${namespace}_authorId` as keyof QichezhijiaIdentity]??input.supplement?.authorId;
    const identity:QichezhijiaIdentity=typeof authorId==="string"&&authorId?{[`${namespace}_authorId`]:authorId}:{};
    const supplied=input.supplement?.url?address(input.supplement.url,true):null;
    if(input.supplement?.url&&!supplied)throw new UnsupportedReplacement("A verified native Autohome original is required");
    const confirmedOriginal=address(parsed.data.url,true);
    if(confirmedOriginal&&supplied&&normalizeUrl(confirmedOriginal)!==normalizeUrl(supplied))throw new StaleOperationError("Received original cannot be replaced");
    const url=original??supplied;
    if(!url)throw new UnsupportedReplacement("A documented original or manual original evidence is required");
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    if(!ids.length)throw new UnsupportedReplacement("A verified typed author identity is required");
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`qichezhijia:${kind}:${value}`},0))`;
    const owners:string[]=[];
    for(const [kind,value] of ids){const [b]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='qichezhijia' AND id_kind=${kind} AND id_value=${value}`;if(b)owners.push(b.source_id);}
    if(new Set(owners).size>1)throw new StaleOperationError("Received account IDs belong to different sources");
    const primary=ids.map(([kind,value])=>`${kind}:${value}`).join("|");
    const sourceId=input.sourceId??owners[0]??`qichezhijia-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");

    let [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(source&&input.sourceId&&!owners.length&&(source.participation_mode!=="isolated"||!input.supplement?.evidence))throw new UnsupportedReplacement("Unbound target requires isolated source and manual evidence");
    if(source&&source.kind!=="external")throw new UnsupportedReplacement("Qichezhijia accounts require an external source");
    if(source&&source.participation_mode!=="isolated"&&ids.some(([kind])=>!received[kind as keyof QichezhijiaIdentity]))throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='qichezhijia' AND source_id=${sourceId}`;
    if(prior.some(b=>identity[b.id_kind as keyof QichezhijiaIdentity]&&identity[b.id_kind as keyof QichezhijiaIdentity]!==b.id_value))throw new StaleOperationError("Source already has another identity of this type");
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.qichezhijiaImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(!source){const name=String(record.authorName??`作者 ${primary}`).slice(0,200);[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${name},'external',${tx.json({platform:"qichezhijia"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(!source!.enabled)throw new UnsupportedReplacement("Author source is disabled; material import is paused");
    for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"qichezhijia",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    {
      const full=operation.data==="LLCI8QTE",body=full?record.content:record.description,publishedAt=publicationTime(record),discoveredAt=origin?new Date(origin.discoveredAt):sourceDiscoveredAt;
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time";
      const author=record.authorName??record.nickname;
      const material=await upsertMaterial({sourceId,url:url!,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyUpdate:full&&!origin?undefined:"fill-missing",bodyHtml:full&&typeof body==="string"?sanitizeBody(body,url!):null,bodyText:typeof body==="string"?(full?stripTags(sanitizeBody(body,url!)):body):null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:media(record),via:"import",raw:{provider:"redfox",resultId,publishTime:record.publishTime??null,namespace,workId:typeof parsed.data.workId==="string"?parsed.data.workId:null,request:executionInput.parameters,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({qichezhijiaImport:{key:commandKey,intent,namespace,workId:typeof parsed.data.workId==="string"?parsed.data.workId:null}})} WHERE id=${resultId}`;
    await audit(actor,"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}
