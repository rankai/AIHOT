import { sql } from "../../db.ts";
import { paidRequest, ProviderRejectedError, retryReceivedRejection, type ReceiptResult } from "../receipts.ts";
import { advanceRun, receiptOptions, requireExecution, saveResult, setRunState, type Execution } from "../operations/store.ts";
import { agentKeyTransport, type AgentKeyTransportOptions } from "./transport.ts";
import { AgentKeyConfigurationError } from "./config.ts";
import { object, type AgentKeyResponse } from "./response.ts";
import { agentKeyRouteFor, agentKeyOutboundAllowed, douyinSearchInput, douyinSearchRoute, type DouyinSearchInput } from "./douyin-contract.ts";
export { douyinSearchInput, douyinSearchRoute } from "./douyin-contract.ts";

export {parseDouyinSearch,AgentKeyPayloadError} from "./douyin-parser.ts";
import {parseDouyinSearch,AgentKeyPayloadError} from "./douyin-parser.ts";
import {importDouyinResult} from "../redfox/import-douyin.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {queueOperationStep} from "../operations/queue.ts";
import {stableJson} from "../../lib/ids.ts";
async function requireRoute(execution: Execution) {
  return sql.begin(async (tx) => {
    const run = await requireExecution(tx, execution);
    if (!agentKeyRouteFor(run)) {
      throw new AgentKeyPayloadError("Execution is not bound to the fixed Douyin V5 route");
    }
    return run;
  });
}

const frozenInput = (input: Record<string, unknown>) => {
  const { members: _members, forceSourceId: _source, mode: _mode, ...raw } = input;
  return douyinSearchInput.parse(raw);
};

function retryDeadline(value: string | null | undefined, now = Date.now()) {
  const milliseconds = value && /^\d+$/.test(value)
    ? now + Number(value) * 1000
    : value ? Date.parse(value) : now + 60_000;
  return new Date(Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8640000000000000 ? milliseconds : now + 60_000);
}

/** Consume already persisted evidence locally, including while the external-call valve is off. */
export async function consumeDouyinSearch(execution: Execution, expected?: Pick<ReceiptResult, "receiptId" | "attempt" | "reused">) {
  const run = await requireRoute(execution);
  const input = douyinSearchInput.parse(run.progress.parameters ?? (run.input.parameters ?? frozenInput(run.input)));
  const [row] = await sql`SELECT id,attempts,status,response FROM receipts WHERE id=${run.current_receipt_id ?? 0}
    AND model=${douyinSearchRoute.tool} AND service=${run.input.mode === 'collection' ? 'agentkey.collect' : 'agentkey.query'} AND purpose=${douyinSearchRoute.operationKey}`;
  if (!row || row.status !== "received" || (expected && (row.id !== expected.receiptId || row.attempts !== expected.attempt))) {
    throw new AgentKeyPayloadError("No current received Douyin V5 receipt available");
  }
  const receipt: ReceiptResult = { receiptId: row.id, attempt: row.attempts, response: row.response, reused: expected?.reused ?? true };
  let parsed: ReturnType<typeof parseDouyinSearch>;
  try { parsed = parseDouyinSearch(receipt.response, input); }
  catch {
    await sql.begin((tx) => setRunState(tx, execution, "needs_review", "Douyin V5 parser/identity evidence requires review; reuse retained receipt"));
    throw new AgentKeyPayloadError("Douyin V5 payload requires review; retained receipt remains received", receipt.receiptId);
  }
  await sql.begin(async (tx) => {
    await requireExecution(tx, execution);
    const [current] = await tx`SELECT id FROM receipts WHERE id=${receipt.receiptId} AND attempts=${receipt.attempt} AND status='received' FOR UPDATE`;
    if (!current) throw new AgentKeyPayloadError("Douyin V5 receipt attempt was superseded");
    const collection=run.input.mode==="collection", pages=Number(run.progress.pages??0)+1, previousItems=Number(run.progress.items??0);
    const selected=collection?parsed.candidates.slice(0,Math.max(0,(run.limits.items??100)-previousItems)):parsed.candidates;
    const items=previousItems+selected.length;
    const continuation=nextDouyinPage(input,parsed.summary.pagination,Array.isArray(run.progress.tokens)?run.progress.tokens as string[]:[]);
    const stopReason=!collection?"single-request":items>=(run.limits.items??100)?"item-limit":pages>=(run.limits.pages??1)?"page-limit":continuation.stopReason;
    const next=collection&&!stopReason?continuation.parameters:undefined;
    const summary={...parsed.summary,platform:"douyin",operationId:"OWIBYU1V",provider:"agentkey",tool:douyinSearchRoute.tool,
      returnedPage:parsed.summary.pagination??{},selectedCount:selected.length,unprocessedDueToLimit:parsed.candidates.length-selected.length,nextParameters:next??null,stopReason:stopReason??null};
    const summaryId=await saveResult(tx, execution, { itemKey: "query_summary", kind: "query_summary", data: summary, receiptId: receipt.receiptId });
    for (const item of selected) {
      const resultId=await saveResult(tx, execution, { ...item,data:{...item.data,querySummaryId:summaryId}, receiptId: receipt.receiptId });
      if(collection){
        try { await tx.savepoint(async nested=>{await importDouyinResult(resultId,{reason:"AgentKey 抖音订阅采集"},"collector",`agentkey-import:${resultId}`,nested);}); }
        catch(error){if(!(error instanceof UnsupportedReplacement))throw error;
          await tx`UPDATE operation_results SET data=data||${tx.json({pendingReason:error.message})} WHERE id=${resultId}`;
        }
      }
    }
    if(collection&&stopReason?.endsWith("-needs-review")){
      await setRunState(tx,execution,"needs_review",`AgentKey pagination requires review: ${stopReason}`);
      return;
    }
    const progress={pages,items,parameters:next??input,tokens:[...(Array.isArray(run.progress.tokens)?run.progress.tokens:[]),stableJson(input)],stopReason:stopReason??null};
    if(collection&&!next)await tx`UPDATE collection_subscriptions SET progress=${tx.json(progress)},next_run_at=now()+interval_minutes*interval '1 minute',updated_at=now() WHERE active_run_id=${run.id}`;
    await advanceRun(tx, execution, next?{stepKey:douyinSearchRoute.stepKey,progress}:null);
    if(next)await queueOperationStep(tx,run.id);

  });
  return { ...receipt, ...parsed };
}

/** Fixed route entry for an existing run; local evidence is consumed before checking outbound configuration. */
export async function executeDouyinSearch(execution: Execution, options: AgentKeyTransportOptions = {}) {
  const run = await requireRoute(execution);
  // Frozen run input is authoritative; callers cannot substitute a query after run creation.
  const params = douyinSearchInput.parse(run.progress.parameters ?? (run.input.parameters ?? frozenInput(run.input)));
  const [local] = run.current_receipt_id ? await sql`SELECT id FROM receipts WHERE id=${run.current_receipt_id} AND status='received'` : [];
  if (local) return consumeDouyinSearch(execution);
  if (!agentKeyOutboundAllowed(run, options.env)) throw new AgentKeyConfigurationError("AgentKey calls disabled for this execution");
  const transport = agentKeyTransport(options); // Configuration guard before claiming a paid attempt.
  let receipt: ReceiptResult;
  try { receipt = await paidRequest({ service: run.input.mode === "collection" ? "agentkey.collect" : "agentkey.query", purpose: douyinSearchRoute.operationKey, model:douyinSearchRoute.tool,
    subject: `operation:${execution.runId}`,
    identity: { runId: execution.runId, stepVersion: execution.stepVersion, endpoint: transport.endpoint,
      contractVersion: douyinSearchRoute.contractVersion, tool: douyinSearchRoute.tool, params },
    estimatedUsage: { estimatedCredits: douyinSearchRoute.estimatedCredits },
    requestSummary: { tool: douyinSearchRoute.tool, endpoint: transport.endpoint, params },
  }, () => transport.execute(params), receiptOptions(execution)); }
  catch (error) {
    if (error instanceof ProviderRejectedError) {
      await sql.begin((tx) => setRunState(tx, execution, "needs_review", "Complete AgentKey rejection retained; manual classification required"));
    }
    throw error;
  }
  const response = receipt.response as AgentKeyResponse;
  if (response.httpStatus === 429) {
    const retryAt = retryDeadline(response.retryAfter);
    await sql.begin(async (tx) => {
      const current = await requireExecution(tx, execution);
      const [detail] = await tx`SELECT retry_count,limits FROM operation_runs WHERE id=${current.id}`;
      if (Number(detail!.retry_count) >= Number(detail!.limits.retries ?? 3)) {
        await setRunState(tx, execution, "needs_review", "AgentKey rate-limit retry limit exhausted");
        return;
      }
      if (!await retryReceivedRejection(tx, receipt.receiptId, receipt.attempt, response, "AgentKey read-only request was rate limited")) {
        await setRunState(tx, execution, "needs_review", "AgentKey rate-limit response was superseded");
        return;
      }
      await tx`UPDATE operation_runs SET retry_count=retry_count+1 WHERE id=${current.id}`;
      await setRunState(tx, execution, "waiting", "AgentKey read-only request was rate limited", retryAt);
    });
    // The complete rejection and persisted retry state are already classified. The operation
    // dispatcher must not turn this retryable outcome into a generic unknown/needs-review result.
    throw new ProviderRejectedError("AgentKey read-only request was rate limited", 429, true);
  }
  return consumeDouyinSearch(execution, receipt);
}

/** Continuation is entirely upstream supplied: never infer page arithmetic. */
export function nextDouyinPage(input: DouyinSearchInput,pagination:Record<string,unknown>|undefined,seen:string[]=[]):{parameters?:ReturnType<typeof douyinSearchInput.parse>;stopReason?:string}{
  if(!pagination||![true,false,1,0].includes(pagination.has_more as boolean|number))return {stopReason:"invalid-pagination-needs-review"};
  if(pagination.has_more===false||pagination.has_more===0)return {stopReason:"upstream-no-more"};
  if(!Number.isSafeInteger(pagination.offset)||Number(pagination.offset)<0||!Number.isSafeInteger(pagination.next_page)||Number(pagination.next_page)<1||typeof pagination.search_id!=="string"||!pagination.search_id.trim()||typeof pagination.backtrace!=="string")return {stopReason:"missing-next-token-needs-review"};
  const next=douyinSearchInput.safeParse({keyword:input.keyword,page:pagination.next_page,offset:pagination.offset,search_id:pagination.search_id,backtrace:pagination.backtrace});
  if(!next.success)return {stopReason:"missing-next-token-needs-review"};
  const token=stableJson(next.data);
  if(token===stableJson(input)||seen.includes(token))return {stopReason:"repeated-next-token-needs-review"};
  return {parameters:next.data};
}
