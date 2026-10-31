// Captures the production cost-center SQL during a real read, then runs EXPLAIN ANALYZE BUFFERS
// against the same million-row isolated fixture. Normal tests never opt into this harness.
import assert from "node:assert/strict";
import { costs } from "@aihot/backend/admin/costs";
import { closeDb, sql } from "@aihot/backend/db";

if (process.env.AIHOT_COST_PLAN !== "1") {
  console.log("Set AIHOT_COST_PLAN=1 and DATABASE_URL to an isolated *_test database");
  process.exit(0);
}

const [database] = await sql<{ name: string; attempts: number }[]>`
  SELECT current_database() name,(SELECT count(*)::int FROM receipt_attempts) attempts`;
assert.match(database!.name, /_test$/);
assert.equal(database!.attempts, 1_000_000, "plan fixture must contain exactly one million attempts");

type Captured = { query: string; parameters: unknown[] };
const captured = new Map<string, Captured>();
sql.options.debug = (_connection, query, parameters) => {
  if (query.includes("page_groups AS")) captured.set("overview-groups", { query, parameters });
  else if (query.includes("facet_ranked AS")) captured.set("overview-meta", { query, parameters });
  else if (query.includes("ORDER BY b.started_at DESC,b.id DESC")) captured.set("details-page", { query, parameters });
};

const start = "2026-08-01T00:00:00.000+08:00";
const end = "2026-11-01T00:00:00.000+08:00";
await costs({ start, end, view: "overview", groupBy: "provider", limit: 50 });
await costs({ start, end, view: "details", limit: 50 });
for (const name of ["overview-groups", "overview-meta", "details-page"]) assert.ok(captured.has(name), `missing SQL capture: ${name}`);

const plans: Record<string, unknown> = {};
for (const [name, capturedQuery] of captured) {
  const connection = await sql.reserve();
  try {
    await connection.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await connection`SET LOCAL statement_timeout = '10000ms'`;
    await connection`SET LOCAL lock_timeout = '500ms'`;
    await connection`SET LOCAL work_mem = '64MB'`;
    const [row] = await connection.unsafe<{ "QUERY PLAN": unknown }[]>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${capturedQuery.query}`,
      capturedQuery.parameters as never[],
    );
    plans[name] = summarizePlan(row!["QUERY PLAN"]);
    await connection.unsafe("COMMIT");
  } catch (error) {
    await connection.unsafe("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

console.log(JSON.stringify({
  database: database!.name,
  attempts: database!.attempts,
  workMem: "64MB",
  plans,
}, null, 2));
await closeDb();

function summarizePlan(value: unknown) {
  const report = Array.isArray(value) ? value[0] as Record<string, unknown> : {};
  const root = report.Plan as Record<string, unknown> | undefined;
  const nodes: Record<string, unknown>[] = [];
  const visit = (node: Record<string, unknown> | undefined) => {
    if (!node) return;
    nodes.push(node);
    for (const child of (node.Plans as Record<string, unknown>[] | undefined) ?? []) visit(child);
  };
  visit(root);
  const number = (value: unknown) => typeof value === "number" ? value : 0;
  return {
    planningTimeMs: number(report["Planning Time"]),
    executionTimeMs: number(report["Execution Time"]),
    sharedHitBlocks: number(root?.["Shared Hit Blocks"]),
    sharedReadBlocks: number(root?.["Shared Read Blocks"]),
    tempReadBlocks: number(root?.["Temp Read Blocks"]),
    tempWrittenBlocks: number(root?.["Temp Written Blocks"]),
    slowestNodes: nodes
      .sort((left, right) => number(right["Actual Total Time"]) - number(left["Actual Total Time"]))
      .slice(0, 12)
      .map((node) => ({
        node: node["Node Type"],
        relation: node.Relation ?? null,
        index: node["Index Name"] ?? null,
        actualTotalMs: number(node["Actual Total Time"]),
        actualRows: number(node["Actual Rows"]),
        loops: number(node["Actual Loops"]),
      })),
  };
}
