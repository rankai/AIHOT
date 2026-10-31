import { executeWanStep } from "../aliyun/wan-execution.ts";
import { executeSubscriptionVideoStep } from "./subscription-video.ts";
import { executeAgentKeyStep } from "../agentkey/execution.ts";
import { lockRun, lockRunAdmission, resumeRun, StaleOperationError } from "./store.ts";
import { sql } from "../../db.ts";
import { executeNativeStep } from "../../sources/native-execution.ts";
import { executeRedfoxStep } from "../redfox/execution.ts";

export async function executeOperationStep(runId: number, stepVersion: number, jobId: string) {
  try { await sql.begin(async tx=>{
    await lockRunAdmission(tx,[runId]);
    const {run}=await lockRun(tx,runId);
    if(run.status!=="waiting"||run.step_version!==stepVersion)return;
    const [due]=await tx`SELECT job_id,next_attempt_at FROM operation_runs WHERE id=${runId}`;
    if(due!.job_id!==jobId||!due!.next_attempt_at||due!.next_attempt_at.getTime()>Date.now())return;
    await resumeRun(tx,{runId,stepVersion,generation:run.generation});
  }); } catch(error) {if(error instanceof StaleOperationError)return {skipped:true};throw error;}
  const [run] = await sql`SELECT provider FROM operation_runs WHERE id = ${runId}`;
  if (!run) return {skipped:true};
  if (run.provider === "aliyun") return executeWanStep(runId,stepVersion,jobId);
  if (run.provider === "local") return executeSubscriptionVideoStep(runId,stepVersion,jobId);
  if (run.provider === "agentkey") return executeAgentKeyStep(runId,stepVersion,jobId);
  if (run.provider === "redfox") return executeRedfoxStep(runId,stepVersion,jobId);
  if (["socialdata","dajiala"].includes(run.provider)) return executeNativeStep(runId,stepVersion,jobId);
  throw new Error("Unsupported operation provider");
}
