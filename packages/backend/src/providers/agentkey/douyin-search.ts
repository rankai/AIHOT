import {requestAgentKey,retryAgentKeyRateLimit} from "./request.ts";
import { sql } from "../../db.ts";
import { logicalKeyFor, type ReceiptResult } from "../receipts.ts";
import { advanceRun, requireExecution, saveResult, setRunState, type Execution, type RunRow, type OperationProgress, retainCurrentReceipt } from "../operations/store.ts";
import { type AgentKeyTransportOptions } from "./transport.ts";
import { object } from "./response.ts";
import { douyinSnapshotOperations, douyinOperationId, agentKeyRouteFor, agentKeyRouteInput, douyinAccountPostsRoute, douyinDetailRoute, douyinSuggestRoute, douyinAccountSearchRoute, type AgentKeyDouyinRoute, douyinSearchInput, douyinSearchRoute, type DouyinSearchInput } from "./douyin-contract.ts";
export { douyinSearchInput, douyinSearchRoute } from "./douyin-contract.ts";

export {parseDouyinSearch,AgentKeyPayloadError} from "./douyin-parser.ts";
import {parseDouyinSearch,parseAgentKeyDouyin,verifyDouyinDetailAuthor,AgentKeyPayloadError} from "./douyin-parser.ts";
import {importDouyinResult} from "../redfox/import-douyin.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {queueOperationStep} from "../operations/queue.ts";
import {stableJson} from "../../lib/ids.ts";
async function requireRoute(execution: Execution) {
  return sql.begin(async (tx) => {
    const run = await requireExecution(tx, execution);
    if (!agentKeyRouteFor(run)) {
      throw new AgentKeyPayloadError("Execution is not bound to the registered Douyin route");
    }
    return run;
  });
}

const frozenInput = (input: Record<string, unknown>) => {
  const { members: _members, forceSourceId: _source, mode: _mode, ...raw } = input;
  return raw;
};

/** Consume already persisted evidence locally, including while the external-call valve is off. */
export async function consumeDouyinSearch(execution: Execution, expected?: Pick<ReceiptResult, "receiptId" | "attempt" | "reused">) {
  const run = await requireRoute(execution);
  const route=agentKeyRouteFor(run)!;
  const input = agentKeyRouteInput(route,run.progress.parameters ?? (run.input.parameters ?? frozenInput(run.input)));
  const [row] = await sql`SELECT id,attempts,status,response FROM receipts WHERE id=${run.current_receipt_id ?? 0}
    AND model=${route.tool} AND service=${run.input.mode === 'collection' ? 'agentkey.collect' : 'agentkey.query'} AND purpose=${route.operationKey}`;
  if (!row || row.status !== "received" || (expected && (row.id !== expected.receiptId || row.attempts !== expected.attempt))) {
    throw new AgentKeyPayloadError("No current received Douyin receipt available");
  }
  const receipt: ReceiptResult = { receiptId: row.id, attempt: row.attempts, response: row.response, reused: expected?.reused ?? true };
  let parsed: ReturnType<typeof parseAgentKeyDouyin>;
  try {
    parsed = parseAgentKeyDouyin(receipt.response, route, input);
    if(route===douyinDetailRoute&&run.input.mode==="collection"){
      const ids=Array.isArray(run.progress.detailItems)?run.progress.detailItems:[];
      const [source]=await sql`SELECT z.data,p.response FROM operation_results z JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${Number(ids[Number(run.progress.detailIndex??0)])||0} AND z.run_id=${run.id} AND z.step_version<${execution.stepVersion} AND z.kind='douyin_work'`;
      const work=parsed.candidates[0];
      if(!source||source.data.operationId!=="QEQLCKD6"||source.data.workId!==work?.data.workId)throw new AgentKeyPayloadError("Missing matching account page context");
      verifyDouyinDetailAuthor(work.data,source.data,source.response,run.input.parameters);
    }
  }
  catch {
    await sql.begin((tx) => setRunState(tx, execution, "needs_review", "Douyin parser/identity evidence requires review; reuse retained receipt"));
    throw new AgentKeyPayloadError("Douyin payload requires review; retained receipt remains received", receipt.receiptId);
  }
  await sql.begin(async (tx) => {
    await requireExecution(tx, execution);
    const [current] = await tx`SELECT id FROM receipts WHERE id=${receipt.receiptId} AND attempts=${receipt.attempt} AND status='received' FOR UPDATE`;
    if (!current) throw new AgentKeyPayloadError("Douyin receipt attempt was superseded");
    const collection=run.input.mode==="collection",detail=route===douyinDetailRoute;
    const originId=detail&&collection?Number(run.progress.detailItems && (run.progress.detailItems as number[])[Number(run.progress.detailIndex??0)]):undefined;
    const pages=Number(run.progress.pages??0)+(detail?0:1),previousItems=Number(run.progress.items??0);
    const selected=collection&&!detail?parsed.candidates.slice(0,Math.max(0,(run.limits.items??100)-previousItems)):parsed.candidates;
    const items=previousItems+(detail?0:selected.length);
    const continuation=nextAgentKeyPage(route,input,parsed.summary.pagination,Array.isArray(run.progress.tokens)?run.progress.tokens as string[]:[]);
    const snapshot=douyinSnapshotOperations.some(o=>o.route===route);
    const stopReason=snapshot?"single-request":!collection?"single-request":detail?undefined:items>=(run.limits.items??100)?"item-limit":pages>=(run.limits.pages??1)?"page-limit":continuation.stopReason;
    const next=collection&&!detail&&!stopReason?continuation.parameters:undefined;
    const operationId=douyinOperationId(route);
    const summary={...parsed.summary,platform:"douyin",operationId,provider:"agentkey",tool:route.tool,contractVersion:route.contractVersion,
      ...(originId?{originResultId:originId}:{}),
      ...(collection?{returnedPage:parsed.summary.pagination??{},selectedCount:selected.length,
        unprocessedDueToLimit:parsed.candidates.length-selected.length,nextParameters:next??null}:{}),stopReason:stopReason??null};
    const summaryId=await saveResult(tx,execution,{itemKey:"query_summary",kind:"query_summary",data:summary,receiptId:receipt.receiptId});
    const resultIds:number[]=[];
    for(const item of selected){
      const resultId=await saveResult(tx,execution,{...item,data:{...item.data,querySummaryId:summaryId},receiptId:receipt.receiptId});
      if(item.data.workId)resultIds.push(resultId);
      if(collection&&item.kind==="douyin_work"){
        try {await tx.savepoint(async nested=>{await importDouyinResult(resultId,{reason:"AgentKey 抖音订阅采集"},"collector",`agentkey-import:${resultId}`,nested);});}
        catch(error){if(!(error instanceof UnsupportedReplacement))throw error;
          await tx`UPDATE operation_results SET data=data||${tx.json({pendingReason:error.message})} WHERE id=${resultId}`;
        }
      }
    }
    if(collection&&stopReason?.endsWith("-needs-review")){
      await setRunState(tx,execution,"needs_review",`AgentKey pagination requires review: ${stopReason}`);return;
    }
    if(detail&&collection){
      const index=Number(run.progress.detailIndex??0)+1,detailItems=run.progress.detailItems as number[];
      const progress={...run.progress,details:Number(run.progress.details??0)+1,detailIndex:index};
      if(index<detailItems.length){
        const [source]=await tx`SELECT data FROM operation_results WHERE id=${detailItems[index]!} AND run_id=${run.id}`;
        await advanceRun(tx,execution,{stepKey:douyinDetailRoute.stepKey,progress:{...progress,parameters:{aweme_id:source!.data.workId}}});
        await queueOperationStep(tx,run.id);
      }else{
        const page=object(run.progress.pageProgress)!;
        await finishPage(tx,execution,run,{...page,details:progress.details},page.nextParameters as Record<string,unknown>|undefined);
      }
      return;
    }
    const progress={pages,items,...(route===douyinAccountPostsRoute?{details:Number(run.progress.details??0),nextParameters:next??null}:{}),parameters:next??input,
      tokens:[...(Array.isArray(run.progress.tokens)?run.progress.tokens:[]),stableJson(input)],stopReason:stopReason??null};
    const detailItems=route===douyinAccountPostsRoute&&collection&&run.input.enrichDetails===true
      ?resultIds.slice(0,Math.max(0,(run.limits.details??0)-Number(progress.details??0))):[];
    if(detailItems.length){
      const [source]=await tx`SELECT data FROM operation_results WHERE id=${detailItems[0]!}`;
      await retainCurrentReceipt(tx,execution,{});
      const current=await requireExecution(tx,execution);
      await advanceRun(tx,execution,{stepKey:douyinDetailRoute.stepKey,progress:{...progress,pageProgress:progress,
        retainedReceiptIds:current.progress.retainedReceiptIds,detailItems,detailIndex:0,parameters:{aweme_id:source!.data.workId}}});
      await queueOperationStep(tx,run.id);
    }else await finishPage(tx,execution,run,progress,next);

  });
  return { ...receipt, ...parsed };
}

/** Fixed route entry for an existing run; local evidence is consumed before checking outbound configuration. */
export async function executeDouyinSearch(execution: Execution, options: AgentKeyTransportOptions = {}) {
  const run = await requireRoute(execution);
  // Frozen run input is authoritative; callers cannot substitute a query after run creation.
  const route=agentKeyRouteFor(run)!;
  const params = agentKeyRouteInput(route,run.progress.parameters ?? (run.input.parameters ?? frozenInput(run.input)));
  const service=run.input.mode==='collection'?'agentkey.collect':'agentkey.query';
  const [local] = run.current_receipt_id ? await sql`SELECT * FROM receipts WHERE id=${run.current_receipt_id} AND status='received'` : [];
  if (local) {
    const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:run.id,
      stepVersion:run.step_version,endpoint:local.request?.endpoint,contractVersion:route.contractVersion,tool:route.tool,params}});
    if(local.logical_key!==logicalKey||local.model!==route.tool||local.service!==service||local.purpose!==route.operationKey
      ||local.subject!==`operation:${run.id}`||local.request?.tool!==route.tool||stableJson(local.request?.params)!==stableJson(params))
      throw new AgentKeyPayloadError("Douyin receipt differs from the frozen query");
    await retryAgentKeyRateLimit(execution,{receiptId:local.id,attempt:local.attempts,response:local.response});
    return consumeDouyinSearch(execution);
  }
  const receipt = await requestAgentKey(execution,run,route,params,options);
  return consumeDouyinSearch(execution, receipt);
}

/** Continuation is entirely upstream supplied: never infer page arithmetic. */
export function nextDouyinPage(input: DouyinSearchInput,pagination:Record<string,unknown>|undefined,seen:string[]=[]):{parameters?:ReturnType<typeof douyinSearchInput.parse>;stopReason?:string}{
  if(!pagination||typeof pagination.hasMore!=="boolean")return {stopReason:"invalid-pagination-needs-review"};
  if(!pagination.hasMore)return {stopReason:"upstream-no-more"};
  if(!Number.isSafeInteger(pagination.cursor)||Number(pagination.cursor)<0)return {stopReason:"missing-next-token-needs-review"};
  const next=douyinSearchInput.safeParse({keyword:input.keyword,cursor:pagination.cursor});
  if(!next.success)return {stopReason:"missing-next-token-needs-review"};
  const token=stableJson(next.data);
  if(token===stableJson(input)||seen.includes(token))return {stopReason:"repeated-next-token-needs-review"};
  return {parameters:next.data};
}

async function finishPage(tx:import("../../db.ts").Tx,execution:Execution,run:RunRow,progress:OperationProgress,next:Record<string,unknown>|null|undefined){
  if(run.input.mode==="collection"&&!next)await tx`UPDATE collection_subscriptions SET progress=${tx.json(progress as never)},next_run_at=now()+interval_minutes*interval '1 minute',updated_at=now() WHERE active_run_id=${run.id}`;
  const route=run.operation_key===douyinAccountPostsRoute.operationKey?douyinAccountPostsRoute:douyinSearchRoute;
  await advanceRun(tx,execution,next?{stepKey:route.stepKey,progress}:null);
  if(next)await queueOperationStep(tx,run.id);
}
export function nextAgentKeyPage(route:AgentKeyDouyinRoute,input:Record<string,unknown>,pagination:Record<string,unknown>|undefined,seen:string[]=[]):{parameters?:Record<string,unknown>;stopReason?:string}{
  if(route===douyinSearchRoute)return nextDouyinPage(douyinSearchInput.parse(input),pagination,seen);
  if(route===douyinDetailRoute||route===douyinSuggestRoute||route===douyinAccountSearchRoute||douyinSnapshotOperations.some(o=>o.route===route))return {stopReason:"single-request"};
  if(!pagination||typeof pagination.hasMore!=="boolean")return {stopReason:"invalid-pagination-needs-review"};
  if(!pagination.hasMore)return {stopReason:"upstream-no-more"};
  if(!Number.isSafeInteger(pagination.cursor)||Number(pagination.cursor)<0)return {stopReason:"missing-next-token-needs-review"};
  const parameters=agentKeyRouteInput(route,{...input,max_cursor:pagination.cursor}),token=stableJson(parameters);
  if(token===stableJson(input)||seen.includes(token))return {stopReason:"repeated-next-token-needs-review"};
  return {parameters};
}
