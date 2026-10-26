// Operation queries and local receipt recovery remain available when collection dispatch is disabled.
import type { PgBoss } from "pg-boss";
import { ensureQueue, QUEUES } from "../../jobs/queue.ts";
import { executeOperationStep } from "./execute.ts";

export async function registerOperationJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.operation);
  await boss.work<{runId:number;stepVersion:number}>(QUEUES.operation,{minPriority:0,localConcurrency:2,pollingIntervalSeconds:2},async([job])=>{
    if(!job)return;
    return executeOperationStep(job.data.runId,job.data.stepVersion,job.id);
  });
  await boss.work<{runId:number;stepVersion:number}>(QUEUES.operation,{maxPriority:-1,localConcurrency:1,pollingIntervalSeconds:2},async([job])=>{
    if(!job)return;
    return executeOperationStep(job.data.runId,job.data.stepVersion,job.id);
  });
}
