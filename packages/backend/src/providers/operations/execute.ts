import { lockRun, resumeRun, StaleOperationError } from "./store.ts";
import { sql } from "../../db.ts";
import { executeNativeStep } from "../../sources/native-execution.ts";
import { executeRedfoxStep } from "../redfox/execution.ts";

export async function executeOperationStep(runId: number, stepVersion: number, jobId: string) {
  try { await sql.begin(async tx=>{
    const {run}=await lockRun(tx,runId);
    if(run.status!=="waiting"||run.step_version!==stepVersion)return;
    const [due]=await tx`SELECT job_id,next_attempt_at FROM operation_runs WHERE id=${runId}`;
    if(due!.job_id!==jobId||!due!.next_attempt_at||due!.next_attempt_at.getTime()>Date.now())return;
    await resumeRun(tx,{runId,stepVersion,generation:run.generation});
  }); } catch(error) {if(error instanceof StaleOperationError)return {skipped:true};throw error;}
  const [run] = await sql`SELECT provider FROM operation_runs WHERE id = ${runId}`;
  if (!run) return {skipped:true};
  if (run.provider === "redfox") return executeRedfoxStep(runId,stepVersion,jobId);
  if (["socialdata","dajiala"].includes(run.provider)) return executeNativeStep(runId,stepVersion,jobId);
  throw new Error("Unsupported operation provider");
}
