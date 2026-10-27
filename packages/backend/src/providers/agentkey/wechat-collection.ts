import {sql,type Tx} from '../../db.ts';
import {identityKeyForUrl} from '../../lib/url.ts';
import {advanceRun,requireExecution,retainCurrentReceipt,type Execution,type RunRow} from '../operations/store.ts';
import {queueOperationStep} from '../operations/queue.ts';
import {agentKeyWechatEvidence} from './wechat-evidence.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
import {wechatDetailRoute} from './wechat-contract.ts';
import {importWechatResult} from '../redfox/import-wechat.ts';
import type {WechatCandidate} from './wechat-parser.ts';
export async function checkWechatSource(tx:Tx,run:RunRow,item?:WechatCandidate){
  const source=run.input.source as {id:string},mapping=run.input.mapping as {identity:Record<string,string|null>};
  if(!source?.id||!mapping?.identity)throw new AgentKeyPayloadError('Missing frozen MP source identity');
  let proved=false;
  for(const kind of ['wxId','bizInfo']){
    const value=mapping.identity[kind];if(!value)continue;
    const [binding]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='wechat' AND id_kind=${kind} AND id_value=${value}`;
    if(binding?.source_id!==source.id)throw new AgentKeyPayloadError('MP author binding changed');
    if(item){const actual=(item.data.identity as Record<string,string>)[kind];if(actual&&actual!==value)throw new AgentKeyPayloadError('MP returned author differs');if(actual===value)proved=true;}
  }
  if(item&&!proved)throw new AgentKeyPayloadError('MP returned author lacks same-source identity proof');
  if(item)for(const [kind,value] of Object.entries(item.data.identity as Record<string,string>)){
    const [owner]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='wechat' AND id_kind=${kind} AND id_value=${value}`;
    if(owner&&owner.source_id!==source.id)throw new AgentKeyPayloadError('MP returned identity has another owner');
  }
}
export async function finishWechatCollection(tx:Tx,e:Execution,run:RunRow){
  if(run.input.mode==='collection'){
    const source=run.input.source as {id:string;cursor:Record<string,unknown>};
    await tx`UPDATE collection_subscriptions SET progress=${tx.json({...source.cursor,lastCheckedAt:new Date().toISOString()})},next_run_at=now()+make_interval(mins=>interval_minutes),updated_at=now() WHERE active_run_id=${run.id}`;
    await tx`UPDATE sources SET last_ok_at=now(),last_fetch_at=now(),fail_count=0,last_error=NULL,health='ok' WHERE id=${source.id}`;
  }
  await advanceRun(tx,e,null);
}
export async function startWechatDetails(tx:Tx,e:Execution,run:RunRow,items:{id:number;item:WechatCandidate}[]){
  await checkWechatSource(tx,run);
  const selected:number[]=[];
  for(const {id,item} of items){
    if(selected.length>=Math.min(8,run.limits.items??8,run.limits.details??8))break;
    await checkWechatSource(tx,run,item);
    const key=identityKeyForUrl(String(item.data.url));
    const [known]=await tx`SELECT body_status,discovered_at,raw FROM articles WHERE identity_key=${key} OR id IN (SELECT article_id FROM article_identity_aliases WHERE alias_key=${key})`;
    const retry=known?.raw?.agentkeyMp?.bodyRetry??known?.raw?.redfoxMp?.bodyRetry??known?.raw?.dajiala?.bodyRetry;
    const missing=known&&(known.body_status==='none'&&retry||known.body_status==='pending');
    if(known&&!(missing&&Number(retry?.attempts??0)<3&&Date.parse(String(run.input.startedAt))-known.discovered_at.getTime()<3*86400000))continue;
    selected.push(id);
  }
  if(!selected.length)return finishWechatCollection(tx,e,run);
  await retainCurrentReceipt(tx,e,{});
  const current=await requireExecution(tx,e),[first]=await tx`SELECT data FROM operation_results WHERE id=${selected[0]!}`;
  await advanceRun(tx,e,{stepKey:wechatDetailRoute.stepKey,progress:{...current.progress,detailItems:selected,detailIndex:0,parameters:{url:first!.data.url,raw:false}}});
  await queueOperationStep(tx,run.id);
}
export async function consumeWechatDetail(tx:Tx,e:Execution,run:RunRow,resultId:number,item:WechatCandidate){
  await checkWechatSource(tx,run,item);
  const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.contract_version,r.input,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
  await agentKeyWechatEvidence(tx,snapshot);
  if(item.data.requestedUrl!==item.data.url&&item.data.aliasConfirmed!==true)throw new AgentKeyPayloadError('Source article lacks same-response URL correspondence');
  if(run.input.mode==='collection'){
    const source=run.input.source as {id:string};
    const key=identityKeyForUrl(String(item.data.url));
    const [known]=await tx`SELECT raw FROM articles WHERE identity_key=${key} OR id IN (SELECT article_id FROM article_identity_aliases WHERE alias_key=${key})`;
    const retry=known?.raw?.agentkeyMp?.bodyRetry??known?.raw?.redfoxMp?.bodyRetry??known?.raw?.dajiala?.bodyRetry;
    const imported=await importWechatResult(resultId,{sourceId:source.id,reason:'AgentKey 公众号主订阅'},'collector',`agentkey-mp:${resultId}`,tx);
    if(imported?.articleId){const record=item.data.record as Record<string,unknown>;await tx`UPDATE articles SET raw=jsonb_set(raw,'{agentkeyMp}',${tx.json({pageResultId:(run.progress.detailItems as number[])[Number(run.progress.detailIndex)],...(record.articleContent?{}:{bodyRetry:{attempts:Number(retry?.attempts??0)+1}})})}) WHERE id=${imported.articleId} AND source_id=${source.id}`;}
  }
  const detailIndex=Number(run.progress.detailIndex??0)+1,detailItems=run.progress.detailItems as number[];
  if(detailIndex>=detailItems.length)return finishWechatCollection(tx,e,run);
  const [next]=await tx`SELECT data FROM operation_results WHERE id=${detailItems[detailIndex]!} AND run_id=${run.id}`;
  if(!next)throw new AgentKeyPayloadError('Missing retained page item');
  await advanceRun(tx,e,{stepKey:wechatDetailRoute.stepKey,progress:{...run.progress,detailIndex,parameters:{url:next.data.url,raw:false}}});
  await queueOperationStep(tx,run.id);
}
