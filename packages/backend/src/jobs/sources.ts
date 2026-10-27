// Collection jobs: per-source fetch runs and body extraction before analysis.
import type { PgBoss } from "pg-boss";
import { collectSource } from "../sources/collect.ts";
import { ensureQueue, QUEUES } from "./queue.ts";
import { registerExtractionJobs } from "./content.ts";

export async function registerSourceJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.fetchSource);
  await boss.work<{ sourceId: string; force?: boolean }>(QUEUES.fetchSource, { localConcurrency: Number(process.env.FETCH_CONCURRENCY || 8), pollingIntervalSeconds: 2 }, async ([job]) => {
    if (!job) return;
    return collectSource(job.data.sourceId, { force: job.data.force });
  });
  await registerExtractionJobs(boss);
}
