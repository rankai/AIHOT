import { sql } from "../../db.ts";
import { BudgetExceededError, ProviderRejectedError, ReceiptBusyError } from "../receipts.ts";
import { claimRun, requireExecution, setRunState, StaleOperationError, type Execution, type RunRow } from "../operations/store.ts";
import { settleUnknownReceipt } from "../operations/recovery.ts";
import { agentKeyRouteFor } from "./douyin-contract.ts";
import { AgentKeyConfigurationError } from "./config.ts";
import { executeDouyinSearch } from "./douyin-search.ts";

export async function executeAgentKeyStep(runId: number, stepVersion: number, jobId: string) {
  const [run] = await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${runId}`;
  if (!run || run.status !== "active" || run.step_version !== stepVersion) return { skipped: true };
  let execution: Execution;
  try { execution = await sql.begin((tx) => claimRun(tx, { runId, stepVersion, generation: run.generation }, jobId)); }
  catch (error) { if (error instanceof StaleOperationError) return { skipped: true }; throw error; }
  try {
    if (!agentKeyRouteFor(run)) throw new Error("Unsupported AgentKey operation/step/profile");
    await executeDouyinSearch(execution);
    return { runId };
  } catch (error) {
    // Complete retryable rejections have already persisted their retry window and receipt evidence.
    if (error instanceof ProviderRejectedError && error.retryable) return { runId, error: error.message };
    let staleExecution = false;
    await sql.begin(async (tx) => {
      let current: RunRow;
      try { current = await requireExecution(tx, execution); }
      catch (e) {
        if (e instanceof StaleOperationError) { staleExecution = true; return; }
        throw e;
      }
      if (await settleUnknownReceipt(tx, execution, current)) return;
      const waiting = error instanceof BudgetExceededError || error instanceof ReceiptBusyError || error instanceof AgentKeyConfigurationError;
      const seconds = error instanceof BudgetExceededError ? error.retryAfterSeconds : 60;
      await setRunState(tx, execution, waiting ? "waiting" : "needs_review", String(error).slice(0, 500), waiting ? new Date(Date.now() + seconds * 1000) : null);
    });
    if (staleExecution) return { skipped: true };
    return { runId, error: String(error) };
  }
}
