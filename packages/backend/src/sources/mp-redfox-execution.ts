import {videoMediaFromHtml} from "../content/media.ts";
import { sql,type Tx } from "../db.ts";
import { parseWechat,queryWechat,wechatArticleUrl,type WechatResult } from "../providers/redfox/wechat.ts";
import { parseRedfoxJson,RedfoxResponseError } from "../providers/redfox/client.ts";
import { mpOperations } from "./mp-replacement.ts";
import { advanceRun,receiptOptions,requireExecution,retainCurrentReceipt,saveResult,type Execution,type RunRow,type OperationProgress } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import { decideTimeline,upsertMaterial } from "../content/materials.ts";
import { sanitizeBody } from "../content/sanitize.ts";
import { stripTags } from "../lib/text.ts";
import { identityKeyForUrl } from "../lib/url.ts";
import { queueProcessing } from "../jobs/content.ts";
import {wechatMedia} from "../providers/redfox/video-media.ts";
interface Input {mode:string;source:{id:string;cursor:Record<string,unknown>};library:"wide"|"premium";mapping:{parameters:Record<string,string>;identity:{wxId:string|null;bizInfo:string|null}};window:string;startedAt:string}
interface Progress extends OperationProgress{pageReceiptId:number;indices:number[];index:number;pageCount:number}
function record(item:WechatResult){return item.data.record as Record<string,unknown>;}
function original(item:WechatResult){return wechatArticleUrl(item.data.url);}
function uuid(item:WechatResult){const value=record(item).workUuid;if(typeof value!=="string"||!value.trim())throw new RedfoxResponseError("MP item lacks its same-library work UUID");return value;}
function checkAuthor(item:WechatResult,input:Input){
  const identity=item.data.identity as {wxId?:string;bizInfo?:string};
  for(const kind of ["wxId","bizInfo"] as const)if(identity[kind]&&input.mapping.identity[kind]&&identity[kind]!==input.mapping.identity[kind])throw new RedfoxResponseError("MP item author differs from the verified account binding");
  if(!original(item))throw new RedfoxResponseError("MP item lacks a valid original article URL");
}
async function checkReturnedOwner(tx:Tx,item:WechatResult,input:Input){
  checkAuthor(item,input);
  const identity=item.data.identity as {wxId?:string;bizInfo?:string};
  for(const kind of ["wxId","bizInfo"] as const){const value=identity[kind];if(!value)continue;
    const [binding]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='wechat' AND id_kind=${kind} AND id_value=${value}`;
    if(binding&&binding.source_id!==input.source.id)throw new RedfoxResponseError("MP received author identity belongs to another source");
  }
}
async function checkBindings(tx:Tx,input:Input){
  for(const kind of ["wxId","bizInfo"] as const){const value=input.mapping.identity[kind];if(!value)continue;
    const [binding]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='wechat' AND id_kind=${kind} AND id_value=${value}`;
    if(binding?.source_id!==input.source.id)throw new RedfoxResponseError("MP account binding changed");
  }
}
async function finish(tx:Tx,e:Execution,run:RunRow,input:Input,receiptId:number,count:number){
  await saveResult(tx,e,{itemKey:"page",kind:"page",data:{count,scope:"latest-first-page",limit:8},receiptId});
  if(input.mode==="collection"){
    await tx`UPDATE collection_subscriptions SET progress=${tx.json({...input.source.cursor,lastCheckedAt:new Date().toISOString()} as never)},next_run_at=now()+make_interval(mins=>interval_minutes),updated_at=now() WHERE id=${run.input.members[0]!.subscriptionId} AND active_run_id=${run.id}`;
    await tx`UPDATE sources SET last_ok_at=now(),last_fetch_at=now(),fail_count=0,last_error=NULL,health='ok' WHERE id=${input.source.id}`;
  }
  await advanceRun(tx,e,null);
}
async function move(tx:Tx,e:Execution,p:Progress){await advanceRun(tx,e,{stepKey:"redfox.wechat.detail",progress:p});await queueOperationStep(tx,e.runId);}
export async function executeRedfoxMpStep(e:Execution,snapshot:RunRow){
  const input=snapshot.input as unknown as Input,ops=mpOperations[input.library];
  if(!ops||snapshot.step_version>Number(snapshot.limits.steps??12))throw new RedfoxResponseError("MP execution bound exhausted or unknown library");
  const options=receiptOptions(e),paid={...options,beforeClaim:async(tx:Tx)=>{await options.beforeClaim!(tx);await checkBindings(tx,input);}};
  const params={...input.mapping.parameters,offset:0,sortType:ops.sortType};
  if(snapshot.step_key==="redfox.wechat.page"){
    const page=await queryWechat(ops.list,params,input.window,paid,"collect");
    await sql.begin(async tx=>{
      const run=await requireExecution(tx,e);await checkBindings(tx,input);
      const indices:number[]=[];
      for(const [index,item] of page.results.entries()){
        if(indices.length>=Number(run.limits.items??8))break;
        uuid(item);await checkReturnedOwner(tx,item,input);
        const [known]=await tx`SELECT body_status,discovered_at,raw FROM articles WHERE identity_key=${identityKeyForUrl(original(item)!.url)}`;
        const retry=known?.raw?.redfoxMp?.bodyRetry??known?.raw?.dajiala?.bodyRetry;
        if(known&&!(known.body_status==="none"&&retry&&retry.attempts<3&&Date.parse(input.startedAt)-known.discovered_at.getTime()<3*86400000))continue;
        indices.push(index);
      }
      if(!indices.length){await finish(tx,e,run,input,page.receiptId,page.results.length);return;}
      await retainCurrentReceipt(tx,e,{pageReceiptId:page.receiptId,indices,index:0,pageCount:page.results.length});
      const [retained]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id=${run.id}`;
      await move(tx,e,retained!.progress as Progress);
    });return;
  }
  if(snapshot.step_key!=="redfox.wechat.detail")throw new RedfoxResponseError("Unknown MP step");
  const p=snapshot.progress as Progress;
  if(!p.retainedReceiptIds?.includes(p.pageReceiptId)||p.index>=Number(snapshot.limits.details??8))throw new RedfoxResponseError("MP retained page or detail bound invalid");
  const [stored]=await sql`SELECT response,status FROM receipts WHERE id=${p.pageReceiptId}`;
  if(!["received","completed"].includes(stored?.status)||typeof stored?.response?.body!=="string")throw new RedfoxResponseError("Retained MP page response unavailable");
  const envelope=parseRedfoxJson(stored.response.body) as {data:unknown};
  const item=parseWechat(ops.list,envelope.data,params)[p.indices[p.index]!];
  if(!item)throw new RedfoxResponseError("Retained MP item position unavailable");
  checkAuthor(item,input);const workUuid=uuid(item);
  const detailPaid={...paid,beforeClaim:async(tx:Tx)=>{await paid.beforeClaim(tx);await checkReturnedOwner(tx,item,input);}};
  const detail=await queryWechat(ops.detail,{workUuid},input.window,detailPaid,"collect"),value=detail.results[0]!;
  checkAuthor(value,input);
  const listedIdentity=item.data.identity as Record<string,string>,detailIdentity=value.data.identity as Record<string,string>;
  if(["wxId","bizInfo"].some(kind=>listedIdentity[kind]&&detailIdentity[kind]&&listedIdentity[kind]!==detailIdentity[kind]))throw new RedfoxResponseError("MP detail author differs from its retained list item");
  const pageUrl=original(item)!,detailUrl=original(value)!;
  // Same-form originals are directly comparable; no short/long alias is created.
  if(!!pageUrl.bizInfo===!!detailUrl.bizInfo&&pageUrl.url!==detailUrl.url)throw new RedfoxResponseError("MP detail original differs from the listed work");
  await sql.begin(async tx=>{
    const run=await requireExecution(tx,e);await checkBindings(tx,input);await checkReturnedOwner(tx,item,input);await checkReturnedOwner(tx,value,input);
    const raw=record(value),listed=record(item),html=typeof raw.content==="string"&&raw.content.trim()?sanitizeBody(raw.content,detailUrl.url):null;
    const body=html?stripTags(html):null;
    const time=raw.publishTime??listed.publishTime;
    const parsed=typeof time==="string"&&/(?:Z|[+-]\d{2}:?\d{2})$/.test(time)?new Date(time):null;
    const publishedAt=parsed&&Number.isFinite(parsed.getTime())?parsed:null,discoveredAt=new Date(input.startedAt);
    const [known]=await tx`SELECT id,source_id,raw FROM articles WHERE identity_key=${identityKeyForUrl(detailUrl.url)} FOR UPDATE`;
    const attempts=Number(known?.raw?.redfoxMp?.bodyRetry?.attempts??known?.raw?.dajiala?.bodyRetry?.attempts??0)+1;
    const provenance={library:input.library,workUuid,pageReceiptId:p.pageReceiptId,authorEvidence:"account-list-context",...(body?{}:{bodyRetry:{attempts}})};
    let articleId:string|undefined;
    if(input.mode==="collection"){
      const material=await upsertMaterial({sourceId:input.source.id,url:detailUrl.url,title:String(raw.title??listed.title??"公众号作品"),author:typeof raw.author==="string"?raw.author:null,
        excerpt:typeof raw.summary==="string"?raw.summary:typeof listed.summary==="string"?listed.summary:null,bodyText:body||null,bodyHtml:body?html:null,bodyStatus:body?"ok":"none",
        media:[...wechatMedia(raw),...(typeof raw.content==="string"?videoMediaFromHtml(raw.content,detailUrl.url):[])],publishedAt,discoveredAt,backfill:!input.source.cursor.lastCheckedAt?"first-import":decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time",via:"fetch",raw:{redfoxMp:provenance,publishTime:time??null}},tx);
      articleId=material.articleId;
      if(known?.source_id===input.source.id)await tx`UPDATE articles SET raw=jsonb_set(raw,'{redfoxMp}',${tx.json(provenance)}) WHERE id=${material.articleId}`;
      if(material.created||material.revised)await queueProcessing(material.articleId,{db:tx});
    }
    await saveResult(tx,e,{itemKey:workUuid,kind:"article",data:{title:raw.title??listed.title,url:detailUrl.url,bodyMissing:!body,authorEvidence:"account-list-context",library:input.library},receiptId:detail.receiptId,...(articleId?{articleId,sourceId:input.source.id}:{})});
    const next={...p,index:p.index+1};if(next.index<next.indices.length)await move(tx,e,next);else await finish(tx,e,run,input,p.pageReceiptId,p.pageCount);
  });
}
