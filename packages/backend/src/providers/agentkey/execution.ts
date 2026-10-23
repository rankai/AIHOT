import {executeAgentKeyX} from './x-execution.ts';
import {executeAgentKeyWeibo} from "./weibo-execution.ts";
import {executeAgentKeyBilibili} from "./bilibili-execution.ts";
import {executeAgentKeyXiaohongshu} from "./xiaohongshu-execution.ts";
import {executeAgentKeyToutiao} from "./toutiao-execution.ts";
import {executeAgentKeyWechat} from "./wechat-execution.ts";
import { sql } from "../../db.ts";
import { BudgetExceededError, ProviderRejectedError, ReceiptBusyError } from "../receipts.ts";
import { claimRun, requireExecution, setRunState, StaleOperationError, type Execution, type RunRow } from "../operations/store.ts";
import { settleUnknownReceipt } from "../operations/recovery.ts";
import { agentKeyRouteFor } from "./routes.ts";
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
    if(run.operation_key?.startsWith("agentkey.x."))await executeAgentKeyX(execution);
    else if(run.operation_key?.startsWith("agentkey.weibo."))await executeAgentKeyWeibo(execution);
    else if(run.operation_key?.startsWith("agentkey.bilibili."))await executeAgentKeyBilibili(execution);
    else if(run.operation_key?.startsWith("agentkey.wechat_mp."))await executeAgentKeyWechat(execution);
    else if(run.operation_key?.startsWith("agentkey.toutiao."))await executeAgentKeyToutiao(execution);
    else if(run.operation_key?.startsWith("agentkey.xiaohongshu."))await executeAgentKeyXiaohongshu(execution);
    else if(run.operation_key?.startsWith("agentkey.douyin."))await executeDouyinSearch(execution);
    else throw new Error("Unsupported AgentKey platform");
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
