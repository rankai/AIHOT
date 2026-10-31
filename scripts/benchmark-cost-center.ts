// Focused performance harness for an isolated database preloaded with representative cost-center data.
// This is intentionally opt-in; normal tests never treat synthetic scale data as a fixture.
import assert from "node:assert/strict";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { costs } from "@aihot/backend/admin/costs";
import { closeDb, sql } from "@aihot/backend/db";

if (process.env.AIHOT_COST_PERF !== "1") {
  console.log("Set AIHOT_COST_PERF=1 and DATABASE_URL to an isolated *_test database");
  process.exit(0);
}

const [database] = await sql<{
  name: string;
  attempts: number;
  postgres_version: string;
  max_connections: string;
  shared_buffers: string;
  work_mem: string;
  effective_cache_size: string;
}>`
  SELECT current_database() name,
    (SELECT count(*)::int FROM receipt_attempts) attempts,
    current_setting('server_version') postgres_version,
    current_setting('max_connections') max_connections,
    current_setting('shared_buffers') shared_buffers,
    current_setting('work_mem') work_mem,
    current_setting('effective_cache_size') effective_cache_size`;
assert.match(database!.name, /_test$/);
assert.equal(database!.attempts, 1_000_000, "performance fixture must contain exactly one million attempts");

const end = "2026-11-01T00:00:00.000+08:00";
const sevenDays = "2026-10-25T00:00:00.000+08:00";
const ninetyTwoDays = "2026-08-01T00:00:00.000+08:00";

// HTTP reads supply a signal; include the same cancellation guard in measured requests.
function read(query: Parameters<typeof costs>[0]) {
  return costs(query, { signal: new AbortController().signal });
}

const detailPage = await read({
  start: ninetyTwoDays,
  end,
  view: "details",
  limit: 50,
});
assert.equal(detailPage.view, "details");
if (detailPage.view !== "details") throw new Error("expected detail response");
assert.ok(detailPage.nextCursor, "performance fixture must produce a second detail page");
const nextCursor = detailPage.nextCursor;

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

async function measure(
  name: string,
  thresholdMs: number,
  query: () => Promise<unknown>,
): Promise<{
  name: string;
  dataQueriesPerCall: number | string;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  thresholdMs: number;
}> {
  for (let i = 0; i < 3; i++) await query();
  const timings: number[] = [];
  for (let i = 0; i < 50; i++) {
    const started = performance.now();
    try {
      await query();
    } catch (error) {
      console.error(`${name}: failed during measured sample ${i + 1}`);
      throw error;
    }
    timings.push(performance.now() - started);
    if ((i + 1) % 10 === 0) console.error(`${name}: ${i + 1}/50`);
  }
  const result = {
    name,
    dataQueriesPerCall:
      name.startsWith("details")
        ? "1-4"
        : name === "overview-user-92d" || name.startsWith("overview-skill")
          ? 3
          : 2,
    p50Ms: Number(percentile(timings, 0.5).toFixed(1)),
    p95Ms: Number(percentile(timings, 0.95).toFixed(1)),
    maxMs: Number(Math.max(...timings).toFixed(1)),
    thresholdMs,
  };
  assert.ok(result.p95Ms <= thresholdMs, `${name} p95 ${result.p95Ms}ms exceeds ${thresholdMs}ms`);
  return result;
}

async function measureConcurrent(
  name: string,
  concurrency: number,
  thresholdMs: number,
  query: () => Promise<unknown>,
) {
  for (let i = 0; i < 3; i++) await Promise.all(Array.from({ length: concurrency }, query));
  const timings: number[] = [];
  const wallTimings: number[] = [];
  for (let i = 0; i < 50; i++) {
    const started = performance.now();
    try {
      await Promise.all(Array.from({ length: concurrency }, async () => {
        const requestStarted = performance.now();
        await query();
        timings.push(performance.now() - requestStarted);
      }));
    } catch (error) {
      console.error(`${name}: failed during measured sample ${i + 1}`);
      throw error;
    }
    wallTimings.push(performance.now() - started);
    if ((i + 1) % 10 === 0) console.error(`${name}: ${i + 1}/50`);
  }
  const result = {
    name,
    concurrency,
    dataQueriesPerWave: 4,
    p50Ms: Number(percentile(timings, 0.5).toFixed(1)),
    p95Ms: Number(percentile(timings, 0.95).toFixed(1)),
    maxMs: Number(Math.max(...timings).toFixed(1)),
    wallP50Ms: Number(percentile(wallTimings, 0.5).toFixed(1)),
    wallP95Ms: Number(percentile(wallTimings, 0.95).toFixed(1)),
    thresholdMs,
  };
  assert.ok(result.p95Ms <= thresholdMs, `${name} p95 ${result.p95Ms}ms exceeds ${thresholdMs}ms`);
  return result;
}

const results = [];
results.push(await measure("overview-7d-provider", 1_000, () =>
  read({ start: sevenDays, end, view: "overview", groupBy: "provider", limit: 50 })));
results.push(await measure("overview-92d-provider", 3_000, () =>
  read({ start: ninetyTwoDays, end, view: "overview", groupBy: "provider", limit: 50 })));
results.push(await measure("details-7d-first", 1_000, () =>
  read({ start: sevenDays, end, view: "details", limit: 50 })));
results.push(await measure("details-92d-next", 3_000, () =>
  read({ start: ninetyTwoDays, end, view: "details", limit: 50, cursor: nextCursor })));
results.push(await measure("overview-user-92d", 3_000, () =>
  read({ start: ninetyTwoDays, end, view: "overview", groupBy: "user", username: "perf-user-1", limit: 50 })));
results.push(await measure("overview-skill-92d", 3_000, () =>
  read({
    start: ninetyTwoDays,
    end,
    view: "overview",
    groupBy: "skill",
    skillId: "xiaohongshu",
    moduleId: "note-rewrite",
    limit: 50,
  })));
results.push(await measureConcurrent("overview-92d-provider-c2", 2, 3_000, () =>
  read({ start: ninetyTwoDays, end, view: "overview", groupBy: "provider", limit: 50 })));

console.log(JSON.stringify({
  database: database!.name,
  attempts: database!.attempts,
  samplesPerScenario: 50,
  cancellationGuard: true,
  environment: {
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    databasePoolMax: process.env.DATABASE_POOL_MAX ?? "10 (application default)",
    postgresVersion: database!.postgres_version,
    maxConnections: database!.max_connections,
    sharedBuffers: database!.shared_buffers,
    workMem: database!.work_mem,
    effectiveCacheSize: database!.effective_cache_size,
  },
  results,
}, null, 2));
await closeDb();
