import { type Tx } from "../../db.ts";
import { enqueue, QUEUES } from "../../jobs/queue.ts";

export async function queueOperationStep(tx: Tx, runId: number): Promise<string | null> {
  const [run] = await tx`SELECT operation_key, step_version, status, next_attempt_at FROM operation_runs WHERE id = ${runId}`;
  if (!run || !["active", "waiting"].includes(run.status)) return null;
  const jobId = await enqueue(QUEUES.operation, { runId, stepVersion: run.step_version }, {
    priority: run.operation_key === "subscription.video.download" ? -1 : 0, singletonKey: `${runId}:${run.step_version}`, ...(run.next_attempt_at ? { startAfter: run.next_attempt_at as Date } : {}),
  }, tx);
  if (jobId) await tx`UPDATE operation_runs SET job_id = ${jobId} WHERE id = ${runId}`;
  return jobId;
}
