// Paid requests (models, SocialData, Jina, Dajiala) go through here.
//
// 1. A logical request has a stable key bound to task, input revision, provider, model, prompt and config.
// 2. Before calling, a placeholder row and an attempt row are persisted; budgets count attempts.
// 3. The raw response is saved before any business write; recovery reuses a received response.
// 4. A request whose outcome is unknown (timeout after sending, crash mid-flight) is not re-sent by the
//    caller. ops.recover releases it once after 30 minutes (admin/runs.ts), so a lost answer costs at
//    most one repeat; after that it waits for the admin.
import { sql, type Db, type Tx } from "../db.ts";
import { config } from "../config.ts";
import { sha256, stableJson } from "../lib/ids.ts";

export type BudgetScope = "member" | "admin";
export type CostOwnerKind = "member" | "admin" | "system" | "unassigned";
export type CostEnvironment = "production" | "development" | "test" | "other" | "unknown";
export interface BudgetContext {
  budgetScope: BudgetScope | null;
  operationRunId?: number | null;
  ownerUserId?: number | null;
  ownerKind?: CostOwnerKind | null;
  environment?: CostEnvironment | null;
}

export interface CostIdentity {
  billingProvider: string | null;
  upstreamProvider?: string | null;
  operation: string;
  model?: string | null;
}

export interface PriceRateRule {
  version: 1;
  id: string;
  timezone: string;
  effectiveFrom: string;
  selection: "peak" | "off_peak" | "conservative_peak";
  exact: boolean;
  multiplier: "1" | "0.5";
  peakWindows: string[];
  reason: string;
  ruleSourceUrl: string;
  holidayCalendar: {
    timezone: string;
    sourceUrl: string;
    verifiedOn: string;
    coveredYears: number[];
    completeForSelectedDate: boolean;
  };
}

export type PriceSnapshot =
  | {
      version: 1;
      state: "ready";
      service: string;
      model: string;
      currency: string;
      perRequest: string | null;
      inputPerMtok: string | null;
      cachedInputPerMtok: string | null;
      outputPerMtok: string | null;
      sourceUrl: string | null;
      verifiedOn: string | null;
      selectedAt: string;
      rateRule?: PriceRateRule;
    }
  | {
      version: 1;
      state: "unavailable";
      service: string;
      model: string;
      reason: "missing_price" | "invalid_price";
      selectedAt: string;
    };

export class BudgetExceededError extends Error {
  readonly service: string;
  readonly retryAfterSeconds: number;
  readonly scope: BudgetScope | null;
  constructor(service: string, window: string, retryAfterSeconds: number, scope: BudgetScope | null = null) {
    super(`Budget for ${service} exhausted (${scope ?? "total"}: ${window})`);
    this.service = service;
    this.scope = scope;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ReceiptBusyError extends Error {}

export class ReceiptUnknownError extends Error {
  readonly receiptId: number;
  constructor(receiptId: number, message: string) {
    super(message);
    this.receiptId = receiptId;
  }
}

/** A complete, classified provider rejection. Rejection alone does not establish zero cost. */
export class ProviderRejectedError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly evidence?: CallOutcome;
  constructor(message: string, status: number | null, retryable: boolean, evidence?: CallOutcome) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.evidence = evidence;
  }
}

export interface CallOutcome {
  response: unknown;
  requestId?: string | null;
  usage?: Record<string, unknown> | null;
  cost?: { amount: string | number; currency: string; basis: "actual" | "estimated" } | null;
}

export interface ReceiptRequest {
  service: string;
  model?: string | null;
  purpose: string;
  subject?: string | null;
  /** Everything that determines the output. Hashed into the logical key; only a redacted summary is stored. */
  identity: unknown;
  /** Stored for diagnosis; must not contain secrets. */
  requestSummary?: Record<string, unknown>;
  /** Distinguishes an explicit re-run (e.g. admin "re-evaluate") from recovery of the same request. */
  attemptTag?: string;
  /** Non-monetary usage estimate frozen before dispatch; not part of request identity. */
  estimatedUsage?: Record<string, unknown>;
  /** Optional historical provider price key when it differs from the budget service service. */
  pricingKey?: { service: string; model: string };
  /** Reporting identity. Existing callers without one receive a conservative legacy projection. */
  costIdentity?: CostIdentity;
}

export interface ReceiptResult {
  receiptId: number;
  attempt: number;
  response: unknown;
  reused: boolean;
}

export interface PaidRequestOptions {
  /** Acquire caller business locks before budget/receipt locks. Local writes only. */
  beforeClaim?: (tx: Tx) => Promise<void | BudgetContext>;
  /** Optional provider-local price evidence. Runs in the same transaction as the attempt insert. */
  resolvePriceSnapshot?: (tx: Tx, context: {
    req: ReceiptRequest;
    attemptTime: Date;
    execution: BudgetContext;
  }) => Promise<PriceSnapshot | null | undefined>;
  /** Local writes only. Throwing rolls back the claim and prevents external dispatch. */
  onReceipt?: (tx: Tx, receiptId: number, info: { kind: "call" | "reuse" | "busy" | "unknown" }) => Promise<void>;
}

export class StaleReceiptAttemptError extends Error {}

const PENDING_STALE_MS = 10 * 60 * 1000;

export function logicalKeyFor(req: ReceiptRequest): string {
  const identity = sha256(stableJson(req.identity));
  return [req.service, req.purpose, req.model ?? "-", identity, req.attemptTag ?? "0"].join(":");
}

interface ReceiptRow {
  id: number;
  attempts: number;
  status: string;
  response: unknown;
  created_at: Date;
  updated_at: Date;
}

interface AttemptCostContext {
  attemptTime: Date;
  identity: CostIdentity;
  priceSnapshot: PriceSnapshot | null;
  execution: BudgetContext;
}

export function normalizedEnvironment(value: unknown): CostEnvironment {
  if (value === "production" || value === "development" || value === "test" || value === "other" || value === "unknown") return value;
  const name = String(value ?? config.environmentName).toLowerCase();
  if (name === "production" || name === "prod") return "production";
  if (name === "development" || name === "dev") return "development";
  if (name === "test" || name === "testing" || name === "ci") return "test";
  return name ? "other" : "unknown";
}

function legacyIdentity(req: ReceiptRequest): CostIdentity {
  const explicit = req.costIdentity;
  if (explicit) {
    const billingProvider = explicit.billingProvider?.trim() || null;
    const operation = explicit.operation.trim();
    if (!operation) throw new Error("Invalid explicit cost identity");
    return {
      billingProvider,
      upstreamProvider: explicit.upstreamProvider?.trim() || null,
      operation,
      model: explicit.model?.trim() || null,
    };
  }
  const provider = req.service.startsWith("redfox.") ? "redfox"
    : req.service.startsWith("agentkey.") ? "agentkey"
    : req.service.startsWith("aliyun.") || req.service === "dashscope" ? "aliyun"
    : req.service.startsWith("assistant.") ? null
    : ["zhipu", "deepseek", "mimo", "dashscope", "jina", "socialdata", "dajiala"].find((name) => req.service === name) ?? null;
  const modelLike = !!provider && ["zhipu", "deepseek", "mimo", "dashscope"].includes(provider);
  return {
    billingProvider: provider,
    upstreamProvider: null,
    operation: req.purpose || req.model || "unknown",
    model: modelLike ? req.model ?? null : req.service.startsWith("aliyun.wan.") && req.model ? req.model : null,
  };
}

function validExecution(context: BudgetContext): void {
  if (context.budgetScope !== null && context.budgetScope !== "member" && context.budgetScope !== "admin")
    throw new Error("Invalid trusted budget scope");
  if (context.operationRunId != null && (!Number.isSafeInteger(context.operationRunId) || context.operationRunId <= 0))
    throw new Error("Invalid operation run identity");
  if (context.ownerKind === "member") {
    if (!Number.isSafeInteger(context.ownerUserId) || Number(context.ownerUserId) <= 0) throw new Error("Member cost owner requires a user id");
  } else if (context.ownerUserId != null) {
    throw new Error("Only member cost owners may have a user id");
  }
  if (context.ownerKind != null && !["member", "admin", "system", "unassigned"].includes(context.ownerKind))
    throw new Error("Invalid cost owner kind");
}

export async function catalogPriceSnapshot(tx: Db, req: ReceiptRequest, attemptTime: Date): Promise<PriceSnapshot> {
  const key = req.pricingKey ?? { service: req.service, model: req.model ?? "" };
  const [row] = await tx<{
    currency: string;
    input_per_mtok: string | null;
    cached_per_mtok: string | null;
    output_per_mtok: string | null;
    per_request: string | null;
    source_url: string | null;
    verified_on: string | null;
  }[]>`SELECT currency,input_per_mtok::text,cached_per_mtok::text,output_per_mtok::text,per_request::text,source_url,
      verified_on::text FROM service_prices WHERE service=${key.service} AND model=${key.model} LIMIT 1`;
  if (!row) return { version: 1, state: "unavailable", ...key, reason: "missing_price", selectedAt: attemptTime.toISOString() };
  const values = [row.input_per_mtok, row.cached_per_mtok, row.output_per_mtok, row.per_request];
  if (values.every((value) => value === null) || values.some((value) => value !== null && !/^\d+(?:\.\d+)?$/.test(value)))
    return { version: 1, state: "unavailable", ...key, reason: "invalid_price", selectedAt: attemptTime.toISOString() };
  return {
    version: 1,
    state: "ready",
    ...key,
    currency: row.currency,
    perRequest: row.per_request,
    inputPerMtok: row.input_per_mtok,
    cachedInputPerMtok: row.cached_per_mtok,
    outputPerMtok: row.output_per_mtok,
    sourceUrl: row.source_url,
    verifiedOn: row.verified_on,
    selectedAt: attemptTime.toISOString(),
  };
}

function numericUsage(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function rateMicros(value: string | null): bigint | null {
  if (value === null) return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function microsText(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(7, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -6)}.${digits.slice(-6)}`;
}

/** Deterministic catalog-based estimate. Provider-returned actual cost always takes precedence. */
export function estimatedCatalogCost(snapshot: PriceSnapshot | null, usage: Record<string, unknown> | null | undefined): {
  amount: string;
  currency: string;
  basis: "estimated";
} | null {
  if (!snapshot || snapshot.state !== "ready") return null;
  const fixed = rateMicros(snapshot.perRequest);
  const result = (micros: bigint) => micros <= 99_999_999_999_999n
    ? { amount: microsText(micros), currency: snapshot.currency, basis: "estimated" as const } : null;
  if (fixed !== null) return result(fixed);
  if (!usage) return null;
  const prompt = numericUsage(usage.prompt_tokens);
  const completion = numericUsage(usage.completion_tokens);
  const inputRate = rateMicros(snapshot.inputPerMtok);
  const outputRate = rateMicros(snapshot.outputPerMtok);
  // A partial token breakdown must never be reported as the complete request cost.
  if (prompt === null || inputRate === null || (outputRate !== null && completion === null) ||
      (completion !== null && completion > 0 && outputRate === null)) return null;
  let numerator = BigInt(prompt) * inputRate;
  const hasCache = usage.prompt_cache_hit_tokens !== undefined || usage.prompt_cache_miss_tokens !== undefined;
  if (hasCache) {
    const hit = numericUsage(usage.prompt_cache_hit_tokens);
    const miss = numericUsage(usage.prompt_cache_miss_tokens);
    const cachedRate = rateMicros(snapshot.cachedInputPerMtok);
    if (hit === null || miss === null || hit + miss !== prompt || cachedRate === null) return null;
    numerator = BigInt(hit) * cachedRate + BigInt(miss) * inputRate;
  }
  // Without a cache breakdown this is explicitly the standard catalog input-price estimate.
  if (completion !== null && outputRate !== null) numerator += BigInt(completion) * outputRate;
  return result((numerator + 500_000n) / 1_000_000n);
}

async function checkBudget(tx: Db, service: string, scope: BudgetScope | null = null): Promise<void> {
  const [budget] = scope === null
    ? await tx<{ per_minute: number; per_hour: number; per_day: number }[]>`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = ${service}`
    : await tx<{ per_minute: number; per_hour: number; per_day: number }[]>`SELECT per_minute, per_hour, per_day FROM budget_scopes WHERE service = ${service} AND scope = ${scope}`;
  if (!budget) {
    if (scope !== null || service.startsWith("assistant.") || service.startsWith("redfox.") || service.startsWith("agentkey.") || service.startsWith("aliyun.wan.")) throw new BudgetExceededError(service, "unconfigured", 3600, scope);
    return; // Existing providers retain their missing-row semantics.
  }
  // Every request sent counts, retries of the same logical request included.
  const [counts] = await tx<{ minute: number; hour: number; day: number }[]>`
    SELECT
      count(*) FILTER (WHERE started_at > now() - interval '1 minute') AS minute,
      count(*) FILTER (WHERE started_at > now() - interval '1 hour') AS hour,
      count(*) AS day
    FROM receipt_attempts
    WHERE service = ${service} AND (${scope}::text IS NULL OR budget_scope = ${scope}) AND origin = 'live' AND started_at > now() - interval '1 day'`;
  const c = counts!;
  if (budget.per_minute <= 0 || budget.per_hour <= 0 || budget.per_day <= 0) {
    throw new BudgetExceededError(service, "stopped", 3600, scope);
  }
  if (c.minute >= budget.per_minute) throw new BudgetExceededError(service, "minute", 60, scope);
  if (c.hour >= budget.per_hour) throw new BudgetExceededError(service, "hour", 600, scope);
  if (c.day >= budget.per_day) throw new BudgetExceededError(service, "day", 3600, scope);
}

/** Provider cost is untrusted evidence. Keep the response, but never let its amount break receipt persistence. */
function reliableCost(cost: CallOutcome["cost"]): CallOutcome["cost"] {
  if (!cost) return null;
  let amount: string;
  if (typeof cost.amount === "number") {
    if (!Number.isFinite(cost.amount) || cost.amount < 0) return null;
    amount = cost.amount.toFixed(6);
  } else {
    amount = cost.amount;
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match || match[1]!.length > 8) return null;
  const fraction = (match[2] ?? "").padEnd(7, "0");
  const micros = BigInt(match[1]) * 1_000_000n + BigInt(fraction.slice(0, 6)) + (Number(fraction[6]) >= 5 ? 1n : 0n);
  if (micros > 99_999_999_999_999n) return null;
  return { ...cost, amount: microsText(micros) };
}

/**
 * Runs a paid request at most once per logical key and returns its raw response.
 * The caller parses the response and commits business results, then calls completeReceipt.
 */
export async function paidRequest(req: ReceiptRequest, call: (context: { priceSnapshot: PriceSnapshot | null }) => Promise<CallOutcome>, options: PaidRequestOptions = {}): Promise<ReceiptResult> {
  const logicalKey = logicalKeyFor(req);

  const claimed = await sql.begin(async (tx) => {
    const context = (await options.beforeClaim?.(tx)) ?? { budgetScope: null, ownerKind: "unassigned" };
    validExecution(context);
    const budgetScope = context?.budgetScope ?? null;
    const identity = legacyIdentity(req);
    // Serialise budget checks per service so concurrent workers cannot overshoot.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${"budget:" + req.service}))`;
    const [existing] = await tx<ReceiptRow[]>`
      SELECT id, attempts, status, response, created_at, updated_at FROM receipts WHERE logical_key = ${logicalKey} FOR UPDATE`;
    const freezeCost = async (): Promise<AttemptCostContext> => {
      const attemptTime = new Date();
      const priceSnapshot =
        (await options.resolvePriceSnapshot?.(tx, { req, attemptTime, execution: context }).catch(() => null)) ??
        (await catalogPriceSnapshot(tx, req, attemptTime));
      return {
        attemptTime,
        identity,
        priceSnapshot,
        execution: { ...context, ownerKind: context.ownerKind ?? "unassigned", environment: normalizedEnvironment(context.environment) },
      };
    };
    if (existing) {
      if (existing.status === "received" || existing.status === "completed") {
        await options.onReceipt?.(tx, existing.id, { kind: "reuse" });
        return { kind: "reuse" as const, row: existing };
      }
      if (existing.status === "pending") {
        if (Date.now() - existing.updated_at.getTime() < PENDING_STALE_MS) {
          await options.onReceipt?.(tx, existing.id, { kind: "busy" });
          return { kind: "busy" as const, row: existing };
        }
        await markUnknown(tx, existing.id, "placeholder went stale without a recorded result");
        await options.onReceipt?.(tx, existing.id, { kind: "unknown" });
        return { kind: "unknown" as const, row: existing };
      }
      if (existing.status === "unknown") {
        await options.onReceipt?.(tx, existing.id, { kind: "unknown" });
        return { kind: "unknown" as const, row: existing };
      }
      // failed: the provider did not take the request, or its answer was unusable; a new attempt is allowed.
      await checkBudget(tx, req.service);
      if (budgetScope !== null) await checkBudget(tx, req.service, budgetScope);
      const [r] = await tx<{ attempts: number }[]>`
        UPDATE receipts SET status = 'pending', attempts = attempts + 1, error = NULL,
          usage = ${req.estimatedUsage ? tx.json(req.estimatedUsage as never) : tx`usage`},
          response = CASE WHEN ${!!req.estimatedUsage} THEN NULL ELSE response END,
          request_id = CASE WHEN ${!!req.estimatedUsage} THEN NULL ELSE request_id END,
          cost = CASE WHEN ${!!req.estimatedUsage} THEN NULL ELSE cost END,
          currency = CASE WHEN ${!!req.estimatedUsage} THEN NULL ELSE currency END,
          cost_basis = CASE WHEN ${!!req.estimatedUsage} THEN NULL ELSE cost_basis END,
          received_at = CASE WHEN ${!!req.estimatedUsage} THEN NULL ELSE received_at END,
          completed_at = CASE WHEN ${!!req.estimatedUsage} THEN NULL ELSE completed_at END, updated_at = now() WHERE id = ${existing.id} RETURNING attempts`;
      const costContext = await freezeCost();
      const { priceSnapshot } = costContext;
      const attemptId = await startAttempt(tx, existing.id, r!.attempts, req, budgetScope, costContext);
      await options.onReceipt?.(tx, existing.id, { kind: "call" });
      return { kind: "call" as const, id: existing.id, attemptId, attempt: r!.attempts, priceSnapshot };
    }
    await checkBudget(tx, req.service);
    if (budgetScope !== null) await checkBudget(tx, req.service, budgetScope);
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO receipts (logical_key, service, model, purpose, subject, status, request, attempts, usage)
      VALUES (${logicalKey}, ${req.service}, ${req.model ?? null}, ${req.purpose}, ${req.subject ?? null}, 'pending',
              ${tx.json((req.requestSummary ?? {}) as never)}, 1, ${req.estimatedUsage ? tx.json(req.estimatedUsage as never) : null})
      RETURNING id`;
    const costContext = await freezeCost();
    const { priceSnapshot } = costContext;
    const attemptId = await startAttempt(tx, row!.id, 1, req, budgetScope, costContext);
    await options.onReceipt?.(tx, row!.id, { kind: "call" });
    return { kind: "call" as const, id: row!.id, attemptId, attempt: 1, priceSnapshot };
  });

  if (claimed.kind === "reuse") return { receiptId: claimed.row.id, attempt: claimed.row.attempts, response: claimed.row.response, reused: true };
  if (claimed.kind === "busy") throw new ReceiptBusyError(`Receipt ${claimed.row.id} is in flight`);
  if (claimed.kind === "unknown") {
    throw new ReceiptUnknownError(claimed.row.id, `Receipt ${claimed.row.id} has an unknown outcome; it is released once automatically, then from the admin`);
  }

  const { id: receiptId, attemptId, attempt, priceSnapshot } = claimed;
  const started = Date.now();
  const usageFor = (actual: CallOutcome["usage"]) => req.estimatedUsage ? { ...req.estimatedUsage, ...actual } : actual;
  const costFor = (outcome: CallOutcome) => reliableCost(outcome.cost);
  let outcome: CallOutcome;
  try {
    outcome = await call({ priceSnapshot });
  } catch (error) {
    const status = error instanceof ProviderRejectedError ? "failed" : "unknown";
    // "unknown": the request may have reached the provider (timeout, reset): do not re-send automatically.
    const message = (error instanceof ProviderRejectedError ? error.message : String(error)).slice(0, 2000);
    const evidence = error instanceof ProviderRejectedError ? error.evidence : undefined;
    await sql.begin(async (tx) => {
      await tx`UPDATE receipts SET status = ${status}, error = ${message}, updated_at = now() WHERE id = ${receiptId} AND attempts = ${attempt} AND status IN ('pending', 'unknown')`;
      await tx`UPDATE receipt_attempts SET status = ${status}, error = ${message}, latency_ms = ${Date.now() - started}, finished_at = now() WHERE id = ${attemptId} AND status IN ('pending', 'unknown')`;
      if (evidence) {
        const cost = costFor(evidence);
        // The attempt owns late evidence even if a newer attempt now owns the receipt head.
        await tx`UPDATE receipt_attempts SET response = ${tx.json((evidence.response ?? null) as never)},
          request_id = ${evidence.requestId ?? null}, usage = ${usageFor(evidence.usage) ? tx.json(usageFor(evidence.usage) as never) : null},
          cost = ${cost?.amount ?? null}, currency = ${cost?.currency ?? null}, cost_basis = ${cost?.basis ?? null}
          WHERE id = ${attemptId}`;
        await tx`UPDATE receipts SET response = ${tx.json((evidence.response ?? null) as never)},
          request_id = ${evidence.requestId ?? null}, usage = ${usageFor(evidence.usage) ? tx.json(usageFor(evidence.usage) as never) : null},
          cost = ${cost?.amount ?? null}, currency = ${cost?.currency ?? null}, cost_basis = ${cost?.basis ?? null},
          received_at = now() WHERE id = ${receiptId} AND attempts = ${attempt} AND status = 'failed'`;
      }
    });
    throw error;
  }

  const accepted = await sql.begin(async (tx) => {
    const cost = costFor(outcome);
    const rows = await tx`
      UPDATE receipts SET
        status = 'received',
        response = ${tx.json((outcome.response ?? null) as never)},
        request_id = ${outcome.requestId ?? null},
        usage = ${usageFor(outcome.usage) ? tx.json(usageFor(outcome.usage) as never) : null},
        cost = ${cost?.amount ?? null},
        currency = ${cost?.currency ?? null},
        cost_basis = ${cost?.basis ?? null},
        received_at = now(),
        updated_at = now()
      WHERE id = ${receiptId} AND attempts = ${attempt} AND status IN ('pending', 'unknown') RETURNING id`;
    await tx`
      UPDATE receipt_attempts SET
        status = CASE WHEN status IN ('pending', 'unknown') THEN 'received' ELSE status END, request_id = ${outcome.requestId ?? null}, usage = ${usageFor(outcome.usage) ? tx.json(usageFor(outcome.usage) as never) : null},
        cost = ${cost?.amount ?? null}, currency = ${cost?.currency ?? null}, cost_basis = ${cost?.basis ?? null},
        latency_ms = ${Date.now() - started}, finished_at = now()
      WHERE id = ${attemptId} AND (status IN ('pending', 'unknown') OR ${!!req.estimatedUsage})`;
    if (!rows.length) {
      await tx`UPDATE receipt_attempts SET response = ${tx.json((outcome.response ?? null) as never)} WHERE id = ${attemptId}`;
    }
    return rows.length > 0;
  });
  if (!accepted) throw new StaleReceiptAttemptError(`Receipt ${receiptId} attempt ${attempt} was superseded`);
  return { receiptId, attempt, response: outcome.response, reused: false };
}

async function startAttempt(
  tx: Db,
  receiptId: number,
  attempt: number,
  req: ReceiptRequest,
  budgetScope: BudgetScope | null,
  context: AttemptCostContext,
): Promise<number> {
  const { identity, priceSnapshot, execution } = context;
  const [row] = await tx<{ id: number }[]>`
    INSERT INTO receipt_attempts (
      receipt_id, attempt, service, model, status, usage, budget_scope, started_at,
      billing_provider, upstream_provider, operation_id, model_id, environment,
      operation_run_id, owner_user_id, owner_kind, price_snapshot
    ) VALUES (
      ${receiptId}, ${attempt}, ${req.service}, ${req.model ?? null}, 'pending',
      ${req.estimatedUsage ? tx.json(req.estimatedUsage as never) : null}, ${budgetScope}, ${context.attemptTime},
      ${identity.billingProvider}, ${identity.upstreamProvider ?? null}, ${identity.operation}, ${identity.model ?? null},
      ${execution.environment ?? "unknown"}, ${execution.operationRunId ?? null}, ${execution.ownerUserId ?? null},
      ${execution.ownerKind ?? null}, ${priceSnapshot ? tx.json(priceSnapshot as never) : null}
    )
    RETURNING id`;
  return row!.id;
}

async function markUnknown(tx: Db, receiptId: number, reason: string) {
  const changed = await tx`UPDATE receipts SET status = 'unknown', error = ${reason}, updated_at = now() WHERE id = ${receiptId} AND status = 'pending' AND updated_at < ${new Date(Date.now() - PENDING_STALE_MS)} RETURNING id`;
  if (!changed.length) return;
  await tx`UPDATE receipt_attempts SET status = 'unknown', error = ${reason}, finished_at = now() WHERE receipt_id = ${receiptId} AND status = 'pending'`;
}

/**
 * Placeholders left behind by a process that stopped mid-request (crash, kill) become "unknown", so
 * they are released like any other unknown outcome even when nothing retries them.
 */
export async function markStalePendingReceipts(): Promise<number> {
  const stale = await sql<{ id: number }[]>`SELECT id FROM receipts WHERE status = 'pending' AND updated_at < ${new Date(Date.now() - PENDING_STALE_MS)}`;
  for (const r of stale) await sql.begin((tx) => markUnknown(tx, r.id, "placeholder went stale without a recorded result"));
  return stale.length;
}

export async function completeReceipt(db: Db, receiptId: number): Promise<void> {
  await db`UPDATE receipts SET status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now() WHERE id = ${receiptId}`;
}

/** Marks a received response that could not be used (e.g. unparsable) so a fresh attempt can be made. */
export async function rejectReceivedResponse(receiptId: number, reason: string): Promise<void> {
  await sql`UPDATE receipts SET status = 'failed', error = ${reason.slice(0, 2000)}, updated_at = now() WHERE id = ${receiptId}`;
}

/** Only for an explicitly classified retryable rejection, after the caller locks execution eligibility.
 * Preserve the rejected attempt's HTTP response before allowing a new attempt of the same key.
 * The exact attempt fences a stale consumer, including when newer response bodies are identical.
 */
export async function retryReceivedRejection(tx: Db, receiptId: number, attempt: number, response: unknown, reason: string): Promise<boolean> {
  const [row] = await tx`SELECT attempts FROM receipts WHERE id=${receiptId} AND attempts=${attempt} AND status='received' FOR UPDATE`;
  if (!row) return false;
  await tx`UPDATE receipt_attempts SET response=${tx.json(response as never)}, error=${reason}, status='failed'
    WHERE receipt_id=${receiptId} AND attempt=${attempt} AND status='received'`;
  await tx`UPDATE receipts SET status='failed',error=${reason},updated_at=now(),response=NULL,received_at=NULL,completed_at=NULL,
    request_id=NULL,usage=NULL,cost=NULL,currency=NULL,cost_basis=NULL WHERE id=${receiptId} AND attempts=${attempt}`;
  return true;
}
