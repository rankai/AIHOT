import { z } from 'zod';
import { sql } from '../db.ts';
import { stableJson } from '../lib/ids.ts';
import { parseRedfoxJson } from '../providers/redfox/client.ts';
import { parseRedfoxAccount } from '../providers/redfox/redfox-account.ts';
import { redfoxAccountOperations } from '../providers/redfox/redfox-account-contract.ts';

const operation = 'API_1792043329817';
export const RedfoxCostsQuery = z.object({
  start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }),
  billRunId: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().safe().positive()).optional(),
}).strict().refine(v => Date.parse(v.start) < Date.parse(v.end), { message: 'start must precede end' });
interface CostGroup {
  service: string; model: string | null; origin: string; base: string | null; currency: string | null;
  costBasis: 'actual' | 'estimated' | null; attempts: number; knownCost: string | null; unknownCostCount: number;
  statusCounts: { pending: number; received: number; failed: number; unknown: number };
}
const environmentOf = (base: string | null): 'production' | 'other' | 'unknown' => base === 'https://redfox.hk' ? 'production' : base ? 'other' : 'unknown';
const invalidPage = () => Object.assign(new Error('Selected run does not contain a complete, matching received bill page'), { statusCode: 400 });

// Decimal arithmetic stays in scaled integers, including finite numeric JSON exponents.
function decimal(value: string | number): { units: bigint; scale: number } {
  if (typeof value === 'number' && !Number.isFinite(value)) throw invalidPage();
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
  if (!match) throw invalidPage();
  const scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 10000) throw invalidPage();
  const units = BigInt(`${match[1]}${match[2]}${match[3] ?? ''}`);
  return scale < 0 ? { units: units * 10n ** BigInt(-scale), scale: 0 } : { units, scale };
}
function render(value: { units: bigint; scale: number }): string {
  const negative = value.units < 0n, digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, '0');
  const raw = value.scale ? `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`.replace(/\.?0+$/, '') : digits;
  return `${negative ? '-' : ''}${raw}`;
}
function sum(values: string[]) {
  const parsed = values.map(decimal), scale = Math.max(0, ...parsed.map(v => v.scale));
  return render({ units: parsed.reduce((n, v) => n + v.units * 10n ** BigInt(scale - v.scale), 0n), scale });
}
export function summarizeBillRecords(records: { points: string | number; reason: string; reasonDesc: string; gmtCreate: string }[]) {
  const rows = records.map((r, index) => ({ ...r, index, points: render(decimal(r.points)) }));
  const known = rows.filter(r => r.reason === 'api_consume' && decimal(r.points).units < 0n);
  const knownApiConsumptionPoints = sum(known.map(r => r.points.slice(1)));
  const amount = decimal(knownApiConsumptionPoints);
  return { records: rows, summary: { signedPoints: sum(rows.map(r => r.points)), knownApiConsumptionPoints,
    otherRecords: rows.length - known.length, nominalCny: { amount: render({ ...amount, scale: amount.scale + 1 }), label: '积分面值折算',
      pointsPerCny: '10', evidence: 'docs/redfox-integration-plan.md#52-回执身份与费用', actualCost: false } } };
}

async function selectedBill(runId: number) {
  const pages = await sql`SELECT r.id AS run_id,r.input,r.created_at AS queried_at,p.id AS receipt_id,p.request,p.response,p.received_at,
      s.step_version,s.created_at AS saved_at
    FROM operation_runs r JOIN operation_results s ON s.run_id=r.id
    JOIN receipts p ON p.id=s.receipt_id
    WHERE r.id=${runId} AND r.provider='redfox' AND r.operation_key='redfox.sync.query'
      AND r.input->>'platform'='redfox-account' AND r.input->>'operationId'=${operation}
      AND s.kind='query_summary' AND s.item_key='page'
      AND s.data->>'platform'='redfox' AND s.data->>'operationId'=${operation}
      AND p.service='redfox.account' AND p.model=${operation} AND p.status IN ('received','completed')`;
  if (pages.length !== 1) throw invalidPage();
  const p = pages[0]!;
  try {
    const parameters = redfoxAccountOperations[operation].schema.parse(p.input.parameters);
    if (p.request?.operation !== operation || stableJson(p.request.input) !== stableJson(parameters) || p.response?.status !== 200) throw invalidPage();
    const envelope = z.object({ code: z.literal(2000), data: z.unknown() }).parse(parseRedfoxJson(p.response.body));
    const expected = parseRedfoxAccount(operation, envelope.data);
    const saved = await sql`SELECT item_key,kind,data,receipt_id FROM operation_results WHERE run_id=${runId} AND step_version=${p.step_version}`;
    if (saved.length !== expected.length || expected.some(e => !saved.some(s => s.item_key === e.itemKey && s.kind === e.kind && String(s.receipt_id) === String(p.receipt_id) && stableJson(s.data) === stableJson(e.data)))) throw invalidPage();
    // Preserve decimal lexemes from the retained response, without rounding through binary Number.
    const precise = JSON.parse(p.response.body, (key, value, context?: { source?: string }) => key === 'points' && typeof value === 'number' ? render(decimal(context!.source!)) : value);
    const parsed = parseRedfoxAccount(operation, precise.data);
    const records = parsed.filter(r => r.kind === 'redfox_consumption').map(r => r.data.record as { points: string | number; reason: string; reasonDesc: string; gmtCreate: string });
    const summary = parsed.at(-1)!.data;
    const times = records.map(r => r.gmtCreate).sort();
    const base = typeof p.request.base === 'string' ? p.request.base : null;
    return { runId, receiptId: Number(p.receipt_id), responseIdentity: `receipt:${p.receipt_id}`, operationId: operation, parameters,
      queriedAt: p.queried_at, receivedAt: p.received_at, savedAt: p.saved_at, base, environment: environmentOf(base),
      count: summary.count, total: summary.total, pages: summary.pages,
      rawTimeRange: { min: times[0] ?? null, max: times.at(-1) ?? null, timezone: null }, ...summarizeBillRecords(records) };
  } catch { throw invalidPage(); }
}

export async function redfoxCosts(input: z.input<typeof RedfoxCostsQuery>) {
  const query = RedfoxCostsQuery.parse(input);
  const groups = await sql<CostGroup[]>`SELECT a.service,a.model,a.origin,r.request->>'base' AS base,a.currency,a.cost_basis AS "costBasis",
      count(*)::int AS attempts, sum(a.cost)::text AS "knownCost",count(*) FILTER (WHERE a.cost IS NULL)::int AS "unknownCostCount",
      jsonb_build_object('pending',count(*) FILTER (WHERE a.status='pending'),'received',count(*) FILTER (WHERE a.status='received'),
        'failed',count(*) FILTER (WHERE a.status='failed'),'unknown',count(*) FILTER (WHERE a.status='unknown')) AS "statusCounts"
    FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id
    WHERE a.service LIKE 'redfox.%' AND a.started_at>=${new Date(query.start)} AND a.started_at<${new Date(query.end)}
    GROUP BY a.service,a.model,a.origin,r.request->>'base',a.currency,a.cost_basis
    ORDER BY a.service,a.model,a.origin,base,a.currency,a.cost_basis`;
  const recent = await sql`SELECT r.id AS "runId",p.id AS "receiptId",r.created_at AS "queriedAt",p.received_at AS "receivedAt",r.input->'parameters' AS parameters
    FROM operation_runs r JOIN operation_results s ON s.run_id=r.id JOIN receipts p ON p.id=s.receipt_id
    WHERE r.provider='redfox' AND r.operation_key='redfox.sync.query' AND r.input->>'platform'='redfox-account'
      AND r.input->>'operationId'=${operation} AND s.kind='query_summary' AND s.item_key='page'
      AND s.data->>'platform'='redfox' AND s.data->>'operationId'=${operation}
      AND p.service='redfox.account' AND p.model=${operation} AND p.status IN ('received','completed')
    ORDER BY r.created_at DESC,r.id DESC LIMIT 50`;
  return { local: { interval: { start: query.start, end: query.end, timeBasis: 'attempt_started_at' },
      groups: groups.map(g => ({ ...g, environment: environmentOf(g.base) })) },
    billPages: recent.map(r => ({ ...r, runId: Number(r.runId), receiptId: Number(r.receiptId), responseIdentity: `receipt:${r.receiptId}` })),
    selectedBill: query.billRunId ? await selectedBill(query.billRunId) : null,
    comparison: { comparable: false, reasonCodes: ['NO_UNIQUE_REQUEST_ID', 'BILL_TIMEZONE_UNSPECIFIED', 'DYNAMIC_PAGINATION_NOT_COMPLETE_INTERVAL', 'ATTEMPTS_NOT_CONFIRMED_DELIVERY'] } };
}
