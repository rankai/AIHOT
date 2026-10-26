import {lockVideoParentSubscriptions,registerImportedVideo} from "../../sources/subscription-video.ts";
import {videoMediaFromHtml} from "../../content/media.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
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
import { parseBaijiahao } from "./baijiahao.ts";
import { BaijiahaoOperationId,baijiahaoOperations } from "./baijiahao-contract.ts";
type BaijiahaoIdentity=Record<string,string>;
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({uid:z.string().min(1).optional(),secUid:z.string().min(1).optional(),uk:z.string().min(1).optional(),url:z.string().min(1).optional(),workType:z.enum(["article","video"] as const).optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function address(raw:unknown,manual=false):string|null{if(typeof raw!=="string"||raw.includes('#'))return null;try{const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.port||/\.(?:jpe?g|png|webp|mp4|mp3)(?:$)/i.test(u.pathname))return null;const native=u.hostname==="baijiahao.baidu.com"&&u.pathname==="/s"&&!!u.searchParams.get("id");if(native)return raw;if(manual&&u.hostname==="baijiahao.baidu.com"&&u.pathname!=="/"&&!/\/(?:search|user|author|account)(?:\/|$)/i.test(u.pathname))return raw;return null;}catch{return null;}}
function media(record:Record<string,unknown>):MediaItem[]{const out:MediaItem[]=[];for(const raw of [...(Array.isArray(record.imageList)?record.imageList:[]),record.posterImage]){if(typeof raw!=="string")continue;try{const u=new URL(raw);if(["http:","https:"].includes(u.protocol)&&!u.username&&!u.password)out.push({kind:"image",url:raw});}catch{}}if(typeof record.playUrl==="string"){try{const u=new URL(record.playUrl);if(["http:","https:"].includes(u.protocol)&&!u.username&&!u.password)out.push({kind:"video",url:record.playUrl});}catch{}}return out;}
function publicationTime(record:Record<string,unknown>,epochUnit?:number):Date|null{const raw=record.publishTime;if(epochUnit&&(typeof raw==="number"||typeof raw==="string"&&/^-?[0-9]+$/.test(raw))){const n=Number(raw)*epochUnit,d=new Date(n);return Number.isSafeInteger(n)&&Number.isFinite(d.getTime())?d:null;}if(typeof raw!=="string"||!z.iso.datetime({offset:true}).safeParse(raw).success)return null;const d=new Date(raw);return Number.isFinite(d.getTime())?d:null;}
export async function importBaijiahaoResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    await lockVideoParentSubscriptions(tx,resultId);
    const operation=BaijiahaoOperationId.safeParse(snapshot.input.operationId);
    if(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="baijiahao"||snapshot.data.operationId!==operation.data)throw new UnsupportedReplacement("Not a confirmed Baijiahao result");
    const sourceDiscoveredAt=await collectionDiscoveredAt(tx,snapshot,"baijiahao",operation.data);
    const parameters=baijiahaoOperations[operation.data].schema.parse(snapshot.input.parameters) as Record<string,unknown>;
    if(!["baijiahao_account","baijiahao_work"].includes(snapshot.kind))throw new UnsupportedReplacement("Only received accounts or works can be imported");
    const payload=operation.data==="API_1789097000885"?{dataList:[snapshot.data.record]}:operation.data==="API_1789097000858"?[snapshot.data.record]:snapshot.data.record;
    const parsed=parseBaijiahao(operation.data,payload,parameters)[0]!;
    const account=parsed.kind==="baijiahao_account",record=parsed.data.record as Record<string,unknown>,received:BaijiahaoIdentity={...(parsed.data.identity as BaijiahaoIdentity)};
    // This fixed account-detail request explicitly resolves uk to the received uid/secUid pair.
    if(operation.data==="API_1789097000814"&&Object.keys(received).length)received.uk=String(parameters.uk);
    let namespace:unknown=operation.data==="API_1789097000710"?"article":operation.data==="API_1789097000761"?"video":undefined;
    if(account&&input.supplement)throw new UnsupportedReplacement("Accounts require received identifiers");
    if(namespace&&input.supplement?.workType&&namespace!==input.supplement.workType)throw new StaleOperationError("Received namespace cannot be replaced");
    namespace??=input.supplement?.workType;
    if(!account&&!namespace)throw new UnsupportedReplacement("Verified work namespace is required");
    const identity:BaijiahaoIdentity={...received};
    for(const kind of ["uid","secUid","uk"] as const){const value=input.supplement?.[kind];if(value&&received[kind]&&value!==received[kind])throw new StaleOperationError("Received identity cannot be replaced");if(value)identity[kind]=value;}
    const original=address(parsed.data.url),supplement=input.supplement?.url?address(input.supplement.url,true):null;
    if(input.supplement?.url&&!supplement)throw new UnsupportedReplacement("A verified native original is required");
    const confirmedOriginal=address(parsed.data.url,true);
    if(confirmedOriginal&&supplement&&normalizeUrl(confirmedOriginal)!==normalizeUrl(supplement))throw new StaleOperationError("Received original cannot be replaced");
    const url=original??supplement;
    if(!account&&!url)throw new UnsupportedReplacement("A documented original or manual original evidence is required");
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    if(!ids.length)throw new UnsupportedReplacement("A verified typed author identity is required");
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`baijiahao:${kind}:${value}`},0))`;
    const owners:string[]=[];
    for(const [kind,value] of ids){const [b]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='baijiahao' AND id_kind=${kind} AND id_value=${value}`;if(b)owners.push(b.source_id);}
    if(new Set(owners).size>1)throw new StaleOperationError("Received account IDs belong to different sources");
    const primary=Object.keys(identity).sort().map(k=>`${k}:${identity[k]}`).join("|");
    const sourceId=input.sourceId??owners[0]??`baijiahao-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");

    let [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(!account&&source&&input.sourceId&&!owners.length&&(source.participation_mode!=="isolated"||!input.supplement?.evidence))throw new UnsupportedReplacement("Unbound work target requires isolated source and manual evidence");
    if(source&&source.kind!=="external")throw new UnsupportedReplacement("Baijiahao accounts require an external source");
    if(source&&source.participation_mode!=="isolated"&&ids.some(([kind])=>!received[kind as keyof BaijiahaoIdentity]))throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='baijiahao' AND source_id=${sourceId}`;
    if(prior.some(b=>identity[b.id_kind as keyof BaijiahaoIdentity]&&identity[b.id_kind as keyof BaijiahaoIdentity]!==b.id_value))throw new StaleOperationError("Source already has another identity of this type");
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.baijiahaoImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(!source){const name=String(record.nickname??record.title??`作者 ${primary}`).slice(0,200);[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${name},'external',${tx.json({platform:"baijiahao"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(!account&&!source!.enabled)throw new UnsupportedReplacement("Author source is disabled; material import is paused");
    for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"baijiahao",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    if(!account){
      const full=operation.data==="API_1789097000710",body=full?record.content??record.clearContent:null,publishedAt=publicationTime(record),discoveredAt=sourceDiscoveredAt;
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time";
      const author=record.nickname;
      const bodyMedia=full&&typeof body==="string"?videoMediaFromHtml(body,url!):[];
      const material=await upsertMaterial({sourceId,url:url!,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyUpdate:full?undefined:"fill-missing",bodyHtml:full&&typeof body==="string"?sanitizeBody(body,url!):null,bodyText:typeof body==="string"?(full?stripTags(sanitizeBody(body,url!)):body):null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:[...bodyMedia,...(operation.data==="API_1789097000761"?confirmedVideoMedia(media(record)):media(record))],via:"import",raw:{provider:"redfox",resultId,namespace:namespace??null,workId:parsed.data.workId??null,publishTime:record.publishTime??null,request:snapshot.input.parameters,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({baijiahaoImport:{key:commandKey,intent,namespace:typeof namespace==="string"?namespace:null}})} WHERE id=${resultId}`;
    if(articleId){const videoHtml=operation.data==="API_1789097000710"?record.content??record.clearContent:undefined;await registerImportedVideo(tx,resultId,{platform:"baijiahao",operationId:String(parsed.data.operationId),record,confirmed:(operation.data==="API_1789097000761"),singleVideo:true,videoProof:"verified-current-work-or-owned-body",...(typeof videoHtml==="string"?{html:videoHtml}:{})});}
    await audit(actor,account?"source.bind_account":"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}
