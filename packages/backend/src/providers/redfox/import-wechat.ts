import {requireLiveResult} from "../../operations/result-retention.ts";
import {applyAccountDetailOrigin} from "./account-detail-origin.ts";
import {collectedDetailContext} from "./collection-detail.ts";
import {applyWorkDetailOrigin} from "./work-detail-origin.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { sha256,stableJson } from "../../lib/ids.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { decideTimeline,upsertMaterial,type MediaItem } from "../../content/materials.ts";
import { sanitizeBody } from "../../content/sanitize.ts";
import { stripTags } from "../../lib/text.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseWechat,wechatArticleUrl,type WechatIdentity } from "./wechat.ts";
import { WechatOperationId,wechatOperations } from "./wechat-contract.ts";

const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({wxId:z.string().regex(/^gh_[A-Za-z0-9]+$/).max(100).optional(),bizInfo:z.string().min(1).max(500).optional(),url:z.url().optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function media(record:Record<string,unknown>):MediaItem[]{
  const valid=(v:unknown):v is string=>{if(typeof v!=="string")return false;try{const u=new URL(v);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
  const images=[...(Array.isArray(record.imageUrls)?record.imageUrls:[]),...(Array.isArray(record.picList)?record.picList.map(p=>p.picUrl):[]),record.coverImageUrl,record.coverUrl].filter(valid);
  const result:MediaItem[]=[...new Set(images)].map(url=>({kind:"image",url}));
  if(valid(record.videoLink))result.push({kind:"video",url:record.videoLink,poster:valid(record.coverImageUrl)?record.coverImageUrl:null});
  return result;
}
function published(raw:unknown):Date|null{
  if(typeof raw!=="string"||!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw))return null;
  const date=new Date(raw);return Number.isFinite(date.getTime())?date:null;
}
/** Local result import. Identity comes from the received record, never display names or supplier work IDs. */
export async function importWechatResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    const collected=await collectedDetailContext(tx,snapshot),executionInput=collected?.input??snapshot.input;
    const op=WechatOperationId.safeParse(executionInput.operationId);
    if(snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||!op.success||snapshot.receipt_model!==op.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.operationId!==op.data||snapshot.data.platform!=="wechat")throw new UnsupportedReplacement("Not a confirmed WeChat query result");
    const sourceDiscoveredAt=collected?.discoveredAt??await collectionDiscoveredAt(tx,snapshot,"wechat",op.data);
    const shape=wechatOperations[op.data].shape;
    let payload:unknown=snapshot.data.record;
    if(shape==="accounts"||shape==="works")payload={list:[payload]};
    else if(["work_rank","account_rank","headline_rank","growth_rank"].includes(shape)){
      if(shape==="growth_rank"&&snapshot.kind==="wechat_work"){
        const parentKey=String(snapshot.item_key).replace(/:(maxWork|minWork)$/,"");
        const [parent]=await tx`SELECT data FROM operation_results WHERE run_id=${snapshot.run_id} AND receipt_id=${snapshot.receipt_id} AND ((${snapshot.operation_key}='redfox.sync.query' AND step_version=${snapshot.step_version}) OR (${snapshot.operation_key}='redfox.platform.collection' AND provenance->>'sourcePageResultId'=${String(snapshot.provenance?.sourcePageResultId??'')})) AND item_key=${parentKey} AND kind='wechat_account_rank'`;
        if(!parent)throw new UnsupportedReplacement("Growth work lacks its received account evidence");
        const role=String(snapshot.item_key).endsWith(":maxWork")?"maxWork":"minWork";
        payload=[{...parent.data.record,[role]:payload}];
      }else payload=[payload];
    }
    const parsed=parseWechat(op.data,payload,executionInput.parameters).find(r=>r.kind===snapshot.kind&&(shape!=="growth_rank"||snapshot.kind!=="wechat_work"||r.itemKey.endsWith(String(snapshot.item_key).endsWith(":maxWork")?":maxWork":":minWork")));
    if(!parsed)throw new UnsupportedReplacement("This result cannot be imported as an account or work");
    const accountOrigin=executionInput.origin?.kind==="account";
    if(accountOrigin)applyAccountDetailOrigin(op.data,executionInput.parameters,parsed!,executionInput.origin);
    const origin=accountOrigin?undefined:applyWorkDetailOrigin(op.data,executionInput.parameters,parsed!,executionInput.origin);
    const account=parsed.kind!=="wechat_work",record=parsed.data.record as Record<string,unknown>,received=parsed.data.identity as WechatIdentity;
    if(account&&input.supplement)throw new UnsupportedReplacement("Accounts require received stable identities");
    const identity:WechatIdentity={...received};
    for(const kind of ["wxId","bizInfo"] as const){const extra=input.supplement?.[kind];if(extra&&received[kind]&&extra!==received[kind])throw new StaleOperationError("Received account identity cannot be replaced");if(extra)identity[kind]=extra;}
    const original=wechatArticleUrl(parsed.data.url),extra=wechatArticleUrl(input.supplement?.url);
    if(input.supplement?.url&&!extra)throw new UnsupportedReplacement("A valid original WeChat article URL is required");
    if(original&&extra&&original.url!==extra.url)throw new StaleOperationError("Received original URL cannot be replaced");
    const address=original??extra;
    if(address?.bizInfo){if(identity.bizInfo&&identity.bizInfo!==address.bizInfo)throw new StaleOperationError("Article URL disagrees with account identity");identity.bizInfo=address.bizInfo;}
    if(!account&&!address)throw new UnsupportedReplacement("A valid original WeChat article URL is required");
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    if(!ids.length)throw new UnsupportedReplacement("A verified wxId or bizInfo is required");
    // Serialize each confirmed typed identity before resolving its single owner. Then subscription → source → result.
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`wechat:${kind}:${value}`},0))`;
    const bindings=[];
    for(const [kind,value] of ids){const [binding]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='wechat' AND id_kind=${kind} AND id_value=${value}`;if(binding)bindings.push(binding.source_id as string);}
    const owners=[...new Set(bindings)];
    if(owners.length>1)throw new StaleOperationError("Received account identities belong to different sources");
    const primary=identity.wxId?`wxId:${identity.wxId}`:`bizInfo:${identity.bizInfo}`;
    const sourceId=input.sourceId??owners[0]??`wechat-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");
    if(!account&&input.sourceId&&owners[0]!==input.sourceId)throw new UnsupportedReplacement("Work imports use the confirmed author binding");
    const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE control_source_id=${sourceId} FOR UPDATE`;
    let [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(source&&!['external','mp_account'].includes(source.kind))throw new UnsupportedReplacement("WeChat accounts require a matching公众号 or external source");
    const manuallyIdentified=ids.some(([kind])=>!received[kind as keyof WechatIdentity]);
    if(source&&manuallyIdentified&&source.participation_mode!=="isolated")throw new UnsupportedReplacement("Manual identity evidence cannot inherit publication permissions");
    if(source?.kind==="mp_account"&&account){
      const config=sub?.config??source.config;
      if(config.ghid ? config.ghid!==received.wxId : !config.wxid||config.wxid!==record.account)throw new UnsupportedReplacement("Received account does not match the source's configured account");
    }
    const priorBindings=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='wechat' AND source_id=${sourceId}`;
    if(priorBindings.some(b=>identity[b.id_kind as keyof WechatIdentity]&&identity[b.id_kind as keyof WechatIdentity]!==b.id_value))throw new StaleOperationError("Source is already bound to a different identity of this type");
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.wechatImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(!source){[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${String(parsed.data.title).slice(0,200)},'external',${tx.json({platform:"wechat"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(!account&&!source!.enabled)throw new UnsupportedReplacement("Author source is disabled; material import is paused");
    for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"wechat",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    if(!account){
      const body=record.articleContent??record.content,publishTime=record.publishDate??record.publishTime??record.publicTime;
      const discoveredAt=new Date(origin?.discoveredAt??sourceDiscoveredAt),publishedAt=published(publishTime);
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time";
      const material=await upsertMaterial({bodyUpdate:origin?"fill-missing":undefined,sourceId,url:address!.url,title:String(parsed.data.title).slice(0,200),author:typeof record.authorName==="string"?record.authorName:typeof record.author==="string"?record.author:null,bodyHtml:typeof body==="string"?sanitizeBody(body,address!.url):null,bodyText:typeof body==="string"?stripTags(sanitizeBody(body,address!.url)):null,bodyStatus:body?"ok":"pending",excerpt:typeof record.articleSummary==="string"?record.articleSummary:typeof record.summary==="string"?record.summary:null,publishedAt,discoveredAt,backfill,media:media(record),via:"import",raw:{provider:"redfox",resultId,publishTime:publishTime??null,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({wechatImport:{key:commandKey,intent}})} WHERE id=${resultId}`;
    await audit(actor,account?"source.bind_account":"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}
