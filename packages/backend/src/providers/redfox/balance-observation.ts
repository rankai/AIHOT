import { sql } from "../../db.ts";
import type { RedfoxBalanceObservation } from "@aihot/contracts/redfox";
/** Read local receipt evidence only. Never invokes the account/balance endpoint. */
export async function redfoxBalanceObservation(): Promise<RedfoxBalanceObservation | null> {
  const rows = await sql`SELECT a.finished_at,
      coalesce(a.response, CASE WHEN p.attempts=a.attempt THEN p.response END) AS response,
      a.operation_run_id,r.input->>'assistantParentTurnId' AS parent_turn_id
    FROM receipt_attempts a JOIN receipts p ON p.id=a.receipt_id
    LEFT JOIN operation_runs r ON r.id=a.operation_run_id
    WHERE a.service LIKE 'redfox.%' AND coalesce(a.response, CASE WHEN p.attempts=a.attempt THEN p.response END) IS NOT NULL AND a.finished_at IS NOT NULL
    ORDER BY a.finished_at DESC,a.id DESC LIMIT 100`;
  for (const row of rows) {
    if (row.response?.status !== 200 || typeof row.response.body !== "string") continue;
    let parsed: any;
    try { parsed = JSON.parse(row.response.body); } catch { continue; }
    if (parsed?.code === 2000 || parsed?.code === 200) return null;
    if (parsed?.code === 3210 || parsed?.code === 3201) return {
      observedAt: row.finished_at.toISOString(), runId: row.operation_run_id ?? null, parentTurnId: row.parent_turn_id ?? null,
    };
  }
  return null;
}
