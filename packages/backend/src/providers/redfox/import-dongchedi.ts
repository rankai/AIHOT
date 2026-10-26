import {lockVideoParentSubscriptions,registerImportedVideo} from "../../sources/subscription-video.ts";
import {videoMediaFromHtml} from "../../content/media.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
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
import { parseDongchedi } from "./dongchedi.ts";
import { DongchediOperationId,dongchediOperations } from "./dongchedi-contract.ts";
type DongchediIdentity=Record<string,string>;
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({userId:z.string().min(1).optional(),authorId:z.string().min(1).optional(),url:z.string().min(1).optional(),workType:z.enum(["article","video"] as const).optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function address(raw:unknown,manual=false):string|null{if(typeof raw!=="string"||raw.includes('#'))return null;try{const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.port||/\.(?:jpe?g|png|webp|mp4|mp3)(?:$)/i.test(u.pathname))return null;const native=["m.dcdapp.com","www.dcdapp.com"].includes(u.hostname)&&u.pathname==="/motor/m/feed/detail"&&!!u.searchParams.get("group_id");if(native)return raw;if(manual&&(u.hostname==="dongchedi.com"||u.hostname.endsWith(".dongchedi.com")||u.hostname==="dcdapp.com"||u.hostname.endsWith(".dcdapp.com"))&&u.pathname!=="/"&&!/\/(?:search|user|author|account)(?:\/|$)/i.test(u.pathname))return raw;return null;}catch{return null;}}
function media(record:Record<string,unknown>):MediaItem[]{const out:MediaItem[]=[];for(const raw of [...(Array.isArray(record.imageUrlList)?record.imageUrlList:[]),record.coverUrl,record.cover]){if(typeof raw!=="string")continue;try{const u=new URL(raw);if(["http:","https:"].includes(u.protocol)&&!u.username&&!u.password)out.push({kind:"image",url:raw});}catch{}}return out;}
function publicationTime(record:Record<string,unknown>,epochUnit?:number):Date|null{const raw=record.publishTime;if(epochUnit&&(typeof raw==="number"||typeof raw==="string"&&/^-?[0-9]+$/.test(raw))){const n=Number(raw)*epochUnit,d=new Date(n);return Number.isSafeInteger(n)&&Number.isFinite(d.getTime())?d:null;}if(typeof raw!=="string"||!z.iso.datetime({offset:true}).safeParse(raw).success)return null;const d=new Date(raw);return Number.isFinite(d.getTime())?d:null;}
export async function importDongchediResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    await lockVideoParentSubscriptions(tx,resultId);
    const collected=await collectedDetailContext(tx,snapshot),executionInput=collected?.input??snapshot.input;
    const operation=DongchediOperationId.safeParse(executionInput.operationId);
    if(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="dongchedi"||snapshot.data.operationId!==operation.data)throw new UnsupportedReplacement("Not a confirmed Dongchedi result");
    const sourceDiscoveredAt=collected?.discoveredAt??await collectionDiscoveredAt(tx,snapshot,"dongchedi",operation.data);
    const parameters=dongchediOperations[operation.data].schema.parse(executionInput.parameters) as Record<string,unknown>;
    if(!["dongchedi_account","dongchedi_work"].includes(snapshot.kind))throw new UnsupportedReplacement("Only received accounts or works can be imported");
    let payload:unknown=snapshot.data.record;
    if(operation.data==="W86F8SSK")payload={workList:[payload]};
    else if(operation.data==="X16I71WV")payload={userList:[payload]};
    else if(operation.data==="API_1791793668086"){
      if(snapshot.kind==="dongchedi_account")payload={account:payload,workList:[]};
      else{
        const [parent]=await tx`SELECT data FROM operation_results WHERE run_id=${snapshot.run_id} AND receipt_id=${snapshot.receipt_id} AND kind='dongchedi_account'
          AND ((${snapshot.operation_key}='redfox.sync.query' AND step_version=${snapshot.step_version}) OR (${snapshot.operation_key}='redfox.platform.collection' AND provenance->>'sourcePageResultId'=${String(snapshot.provenance?.sourcePageResultId??'')})) LIMIT 1`;
        if(!parent)throw new UnsupportedReplacement("Account list work lacks same-page received account evidence");
        payload={account:parent.data.record,workList:[payload]};
      }
    }
    const parsed=parseDongchedi(operation.data,payload,parameters).find(r=>r.kind===snapshot.kind)!;
    if(!parsed)throw new UnsupportedReplacement("Result kind does not match its operation");
    const origin=applyWeiboCarDetailOrigin(operation.data,parameters,parsed,executionInput.origin);
    const account=parsed.kind==="dongchedi_account",record=parsed.data.record as Record<string,unknown>,received:DongchediIdentity={};
    if(account){if(typeof record.userId==="string"&&record.userId)received.userId=record.userId;}
    else if(operation.data==="API_1791793668086"){
      const parent=(payload as {account:{userId?:string}}).account;
      if(parent.userId){if(record.authorId&&record.authorId!==parent.userId)throw new StaleOperationError("Work author conflicts with received account context");received.userId=parent.userId;if(typeof record.authorId==="string")received.authorId=record.authorId;}
    }else if(typeof record.authorId==="string"&&record.authorId)received.authorId=record.authorId;
    Object.assign(received,origin?.identity);
    let namespace:unknown=operation.data==="QQ5E3EZ9"?parameters.workType:record.workType===1?"article":record.workType===2?"video":record.articleType===7&&record.articleTypeStr==="ugc_article"?"article":record.articleType===2&&record.articleTypeStr==="pgc_video"?"video":operation.data==="W86F8SSK"&&parameters.sourceType==="2"?"video":undefined;
    if(operation.data==="QQ5E3EZ9"&&record.workType!=null&&record.workType!==(parameters.workType==="article"?1:2))throw new StaleOperationError("Received work type conflicts with request");
    if(account&&input.supplement)throw new UnsupportedReplacement("Accounts require received identifiers");
    if(namespace&&input.supplement?.workType&&namespace!==input.supplement.workType)throw new StaleOperationError("Received namespace cannot be replaced");
    namespace??=input.supplement?.workType;
    if(!account&&!namespace)throw new UnsupportedReplacement("Verified work namespace is required");
    const identity:DongchediIdentity={...received};
    for(const kind of ["userId","authorId"] as const){const value=input.supplement?.[kind];if(value&&received[kind]&&value!==received[kind])throw new StaleOperationError("Received identity cannot be replaced");if(value)identity[kind]=value;}
    const original=address(parsed.data.url),supplement=input.supplement?.url?address(input.supplement.url,true):null;
    if(input.supplement?.url&&!supplement)throw new UnsupportedReplacement("A verified native original is required");
    const confirmedOriginal=address(parsed.data.url,true);
    if(confirmedOriginal&&supplement&&normalizeUrl(confirmedOriginal)!==normalizeUrl(supplement))throw new StaleOperationError("Received original cannot be replaced");
    // A scheme-relative received locator is evidence only; the operator must supply the scheme.
    if(typeof parsed.data.url==="string"&&parsed.data.url.startsWith("//")&&supplement){const received=address("https:"+parsed.data.url,true);if(!received||normalizeUrl(received)!==normalizeUrl(supplement))throw new StaleOperationError("Received original locator cannot be replaced");}
    const url=original??supplement;
    if(!account&&!url)throw new UnsupportedReplacement("A documented original or manual original evidence is required");
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    if(!ids.length)throw new UnsupportedReplacement("A verified typed author identity is required");
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`dongchedi:${kind}:${value}`},0))`;
    const owners:string[]=[];
    for(const [kind,value] of ids){const [b]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='dongchedi' AND id_kind=${kind} AND id_value=${value}`;if(b)owners.push(b.source_id);}
    if(new Set(owners).size>1)throw new StaleOperationError("Received account IDs belong to different sources");
    const primary=Object.keys(identity).sort().map(k=>`${k}:${identity[k]}`).join("|");
    const sourceId=input.sourceId??owners[0]??`dongchedi-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");

    let [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(!account&&source&&input.sourceId&&!owners.length&&(source.participation_mode!=="isolated"||!input.supplement?.evidence))throw new UnsupportedReplacement("Unbound work target requires isolated source and manual evidence");
    if(source&&source.kind!=="external")throw new UnsupportedReplacement("Dongchedi accounts require an external source");
    if(source&&source.participation_mode!=="isolated"&&ids.some(([kind])=>!received[kind as keyof DongchediIdentity]))throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='dongchedi' AND source_id=${sourceId}`;
    if(prior.some(b=>identity[b.id_kind as keyof DongchediIdentity]&&identity[b.id_kind as keyof DongchediIdentity]!==b.id_value))throw new StaleOperationError("Source already has another identity of this type");
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.dongchediImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(!source){const name=String(record.authorName??record.displayName??`作者 ${primary}`).slice(0,200);[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${name},'external',${tx.json({platform:"dongchedi"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(!account&&!source!.enabled)throw new UnsupportedReplacement("Author source is disabled; material import is paused");
    for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"dongchedi",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    if(!account){
      const full=namespace==="article"&&(operation.data==="API_1791793668086"||operation.data==="QQ5E3EZ9"),body=record.description,publishedAt=publicationTime(record,["W86F8SSK","API_1791793668086"].includes(operation.data)?1000:undefined),discoveredAt=origin?new Date(origin.discoveredAt):sourceDiscoveredAt;
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time";
      const author=record.authorName;
      const bodyMedia=full&&typeof body==="string"?videoMediaFromHtml(body,url!):[];
      const material=await upsertMaterial({sourceId,url:url!,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyUpdate:full&&!origin?undefined:"fill-missing",bodyHtml:full&&typeof body==="string"?sanitizeBody(body,url!):null,bodyText:typeof body==="string"?(full?stripTags(sanitizeBody(body,url!)):body):null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:[...bodyMedia,...((operation.data==="QQ5E3EZ9"&&record.workType===2||operation.data!=="QQ5E3EZ9"&&namespace==="video"&&!input.supplement?.workType)?confirmedVideoMedia(media(record)):media(record))],via:"import",raw:{provider:"redfox",resultId,namespace:namespace??null,workId:parsed.data.workId??null,publishTime:record.publishTime??null,request:executionInput.parameters,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({dongchediImport:{key:commandKey,intent,namespace:typeof namespace==="string"?namespace:null}})} WHERE id=${resultId}`;
    if(articleId){const videoHtml=namespace==="article"&&["API_1791793668086","QQ5E3EZ9"].includes(operation.data)?record.description:undefined;await registerImportedVideo(tx,resultId,{platform:"dongchedi",operationId:String(parsed.data.operationId),record,confirmed:(operation.data==="QQ5E3EZ9"&&record.workType===2||operation.data!=="QQ5E3EZ9"&&namespace==="video"&&!input.supplement?.workType),singleVideo:true,videoProof:"verified-current-work-or-owned-body",...(typeof videoHtml==="string"?{html:videoHtml}:{})});}
    await audit(actor,account?"source.bind_account":"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}
