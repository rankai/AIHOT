import {sql} from "../../db.ts";
import {paidRequest,ProviderRejectedError,retryReceivedRejection,type ReceiptResult} from "../receipts.ts";
import {receiptOptions,requireExecution,setRunState,type Execution,type RunRow} from "../operations/store.ts";
import {agentKeyTransport,type AgentKeyTransportOptions} from "./transport.ts";
import {AgentKeyConfigurationError} from "./config.ts";
import type {AgentKeyResponse} from "./response.ts";
import {agentKeyOutboundAllowed,type AgentKeyRoute} from "./routes.ts";
function retryDeadline(value: string | null | undefined, now = Date.now()) {
  const milliseconds = value && /^\d+$/.test(value)
    ? now + Number(value) * 1000
    : value ? Date.parse(value) : now + 60_000;
  return new Date(Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8640000000000000 ? milliseconds : now + 60_000);
}

/** Reuse the one bounded rate-limit transition for fresh and already persisted 429 responses. */
export async function retryAgentKeyRateLimit(execution:Execution,receipt:Pick<ReceiptResult,"receiptId"|"attempt"|"response">){
  const response=receipt.response as AgentKeyResponse;
  if(response.httpStatus!==429)return false;
  const retryAt=retryDeadline(response.retryAfter);
  await sql.begin(async tx=>{
    const current=await requireExecution(tx,execution);
    const [detail]=await tx`SELECT retry_count,limits FROM operation_runs WHERE id=${current.id}`;
    if(Number(detail!.retry_count)>=Number(detail!.limits.retries??3)){
      await setRunState(tx,execution,"needs_review","AgentKey rate-limit retry limit exhausted");
      return;
    }
    if(!await retryReceivedRejection(tx,receipt.receiptId,receipt.attempt,response,"AgentKey read-only request was rate limited")){
      await setRunState(tx,execution,"needs_review","AgentKey rate-limit response was superseded");
      return;
    }
    await tx`UPDATE operation_runs SET retry_count=retry_count+1 WHERE id=${current.id}`;
    await setRunState(tx,execution,"waiting","AgentKey read-only request was rate limited",retryAt);
  });
  // The complete rejection and persisted retry state are already classified. The operation
  // dispatcher must not turn this retryable outcome into a generic unknown/needs-review result.
  throw new ProviderRejectedError("AgentKey read-only request was rate limited",429,true);
}

export async function requestAgentKey(execution:Execution,run:RunRow,route:AgentKeyRoute,params:Record<string,unknown>,options:AgentKeyTransportOptions={}){
  if (!agentKeyOutboundAllowed(run, options.env)) throw new AgentKeyConfigurationError("AgentKey calls disabled for this execution");
  const transport = agentKeyTransport(options); // Configuration guard before claiming a paid attempt.
  let receipt: ReceiptResult;
  try { receipt = await paidRequest({ service: ["collection","preview"].includes(String(run.input.mode)) ? "agentkey.collect" : "agentkey.query", purpose: route.operationKey, model:route.tool,
    subject: `operation:${execution.runId}`,
    identity: { runId: execution.runId, stepVersion: execution.stepVersion, endpoint: transport.endpoint,
      contractVersion: route.contractVersion, tool: route.tool, params },
    estimatedUsage: { estimatedCredits: route.estimatedCredits },
    requestSummary: { tool: route.tool, endpoint: transport.endpoint, params },
  }, () => transport.execute(params,route), receiptOptions(execution)); }
  catch (error) {
    if (error instanceof ProviderRejectedError) {
      await sql.begin((tx) => setRunState(tx, execution, "needs_review", "Complete AgentKey rejection retained; manual classification required"));
    }
    throw error;
  }
  await retryAgentKeyRateLimit(execution,receipt);
  return receipt;
}
