import type {
  CostActivationDetail,
  CostAmountBucket,
  CostDetailRow,
  CostDetailsResponse,
  CostEnvironment,
  CostEstimateBasis,
  CostFacet,
  CostGroup,
  CostGroupBy,
  CostOverviewResponse,
  CostOwnerKind,
  CostResponse,
  CostSkillAttribution,
  CostStatusCounts,
  CostTotals,
  CostUsageTotals,
  CostWarning,
} from "@aihot/contracts/costs";
import { z } from "zod";
import { sql, type Tx } from "../db.ts";
import { catalog } from "../assistant/catalog.ts";
import { decodeCursor, encodeCursor, InvalidCursorError, queryBinding } from "../lib/cursor.ts";

const Id = z.string().trim().min(1).max(200);
const Username = z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9][a-z0-9._-]+$/);
const DateTime = z.iso.datetime({ offset: true });

export class CostCenterBusyError extends Error {
  readonly code = "cost_center_busy";
  readonly statusCode = 503;
  readonly retryAfter: number;
  constructor(retryAfter = 2) {
    super("成本统计暂时繁忙，请稍后重试或缩小时间范围");
    this.retryAfter = retryAfter;
  }
}

export const CostsQuery = z
  .object({
    start: DateTime,
    end: DateTime,
    view: z.enum(["overview", "details"]).default("overview"),
    groupBy: z.enum(["provider", "service", "model", "skill", "user"]).optional(),
    billingProvider: Id.optional(),
    service: Id.optional(),
    operation: Id.optional(),
    model: Id.optional(),
    modelMissing: z.preprocess((value) => value === "true" ? true : value, z.literal(true)).optional(),
    skillId: Id.optional(),
    moduleId: Id.optional(),
    userId: z.string().regex(/^[1-9]\d*$/).max(18).optional(),
    username: Username.optional(),
    owner: z.enum(["member", "admin", "system", "unassigned"]).optional(),
    origin: z.enum(["live", "replay", "imported"]).optional(),
    environment: z.enum(["production", "development", "test", "other", "unknown"]).optional(),
    status: z.enum(["pending", "received", "failed", "unknown"]).optional(),
    costBasis: z.enum(["actual", "estimated"]).optional(),
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(value.start);
    const end = Date.parse(value.end);
    if (!(start < end)) ctx.addIssue({ code: "custom", path: ["end"], message: "结束时间必须晚于开始时间" });
    if (end - start > 92 * 86400_000) ctx.addIssue({ code: "custom", path: ["end"], message: "单次查询最多 92 天" });
    if (value.userId && value.username)
      ctx.addIssue({ code: "custom", path: ["username"], message: "用户 ID 和用户名只能选择一个" });
    if (!!value.skillId !== !!value.moduleId)
      ctx.addIssue({ code: "custom", path: [value.skillId ? "moduleId" : "skillId"], message: "技能和模块必须同时指定" });
    if (value.model && value.modelMissing)
      ctx.addIssue({ code: "custom", path: ["modelMissing"], message: "模型 ID 和模型为空不能同时指定" });
    if (value.view === "details" && value.groupBy)
      ctx.addIssue({ code: "custom", path: ["groupBy"], message: "调用明细不执行分组" });
  });

type Query = z.output<typeof CostsQuery>;
type QueryInput = z.input<typeof CostsQuery>;

interface SelectedUser {
  id: number;
  username: string;
  display_name: string;
}

interface FilterState {
  userId: number | null;
  selectedUser: SelectedUser | null;
}

interface RawGroupRow {
  row_kind?: "group" | "total";
  skill_key?: string | null;
  billing_provider: string | null;
  service: string | null;
  operation: string | null;
  model: string | null;
  skill_id: string | null;
  module_id: string | null;
  skill_version: string | null;
  skill_label: string | null;
  user_id: number | null;
  username: string | null;
  display_name: string | null;
  owner_kind: CostOwnerKind | null;
  upstream_provider?: string | null;
  attempts: number;
  logical_requests: number;
  fee_items: number;
  pending: number;
  received: number;
  failed: number;
  unknown: number;
  input_tokens: string | number | null;
  output_tokens: string | number | null;
  cached_tokens: string | number | null;
  estimated_credits: string | null;
  charged_credits: string | null;
  output_seconds: string | null;
  known_token_rows: number;
  missing_usage_rows: number;
  known_cost_items: number;
  unknown_cost_items: number;
  actual_cost_items: number;
  estimated_cost_items: number;
  amount_buckets: unknown;
}

interface DetailDbRow {
  id: number;
  receipt_id: number;
  attempt: number;
  operation_run_id: number | null;
  started_at: Date;
  finished_at: Date | null;
  latency_ms: number | null;
  origin: string;
  environment: CostEnvironment;
  status: string;
  billing_provider: string | null;
  upstream_provider: string | null;
  service: string;
  operation: string;
  model: string | null;
  identity_source: string;
  request_id: string | null;
  owner_user_id: number | null;
  owner_kind: CostOwnerKind | null;
  cost: string | null;
  currency: string | null;
  cost_basis: "actual" | "estimated" | null;
  usage: Record<string, unknown> | null;
  price_snapshot: Record<string, unknown> | null;
  wan_cost_state: "ready" | "awaiting" | "conflict" | null;
  wan_fee_applicable: boolean;
}

const poolSize = Math.max(1, Number(process.env.DATABASE_POOL_MAX || 10));
const MAX_CONCURRENT_COST_READS = poolSize < 4 ? 1 : 2;
let runningCostReads = 0;

export interface CostReadOptions {
  signal?: AbortSignal;
  loadCatalog?: typeof catalog;
}

export interface LegacyAttemptCostGroup {
  service: string;
  model: string | null;
  origin: string;
  base: string | null;
  environment: "production" | "other" | "unknown";
  currency: string | null;
  costBasis: "actual" | "estimated" | null;
  attempts: number;
  knownCost: string | null;
  unknownCostCount: number;
  estimatedCredits: string | null;
  chargedCredits: string | null;
  unknownEstimatedCreditsCount: number;
  unknownChargedCreditsCount: number;
  statusCounts: { pending: number; received: number; failed: number; unknown: number };
}

type CostPendingQuery = ReturnType<Tx["unsafe"]>;

/** Track execution, rather than construction: postgres.js also uses lazy queries as SQL fragments. */
function cancellableCostTx(
  connection: Tx,
  ensureOpen: () => void,
  active: Set<CostPendingQuery>,
  pending: Set<Promise<unknown>>,
): Tx {
  const executeMethods = new Set(["then", "catch", "finally", "execute", "forEach", "readable", "writable", "describe", "cursor"]);
  const watch = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || !("cancel" in value) || !("then" in value)) return value;
    const query = value as CostPendingQuery;
    let started = false;
    const start = () => {
      ensureOpen();
      if (started) return;
      started = true;
      active.add(query);
      const settled = query.then(() => { active.delete(query); }, () => { active.delete(query); });
      pending.add(settled);
      void settled.finally(() => { pending.delete(settled); });
    };
    const wrapped = new Proxy(query, {
      get(target, property) {
        const member = Reflect.get(target, property);
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          if (executeMethods.has(String(property))) start();
          const result: unknown = Reflect.apply(member, target, args);
          return result === target ? wrapped : result;
        };
      },
    });
    return wrapped;
  };
  return new Proxy(connection, {
    apply(target, thisArg, args) {
      ensureOpen();
      return watch(Reflect.apply(target, thisArg, args));
    },
    get(target, property) {
      const member = Reflect.get(target, property);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        ensureOpen();
        return watch(Reflect.apply(member, target, args));
      };
    },
  });
}

/**
 * The cost page is read-only, but a large report must not monopolise the shared connection pool.
 * Busy requests fail immediately instead of building a queue. A reserved connection lets an 8s
 * acquisition/transaction deadline cancel and release cleanly.
 */
export async function withCostRead<T>(fn: (tx: Tx) => Promise<T>, { signal }: CostReadOptions = {}): Promise<T> {
  const abortError = new DOMException("Cost read aborted", "AbortError");
  if (signal?.aborted) throw abortError;
  if (runningCostReads >= MAX_CONCURRENT_COST_READS) throw new CostCenterBusyError();
  runningCostReads += 1;
  let acceptQueries = true;
  const active = new Set<CostPendingQuery>();
  const pending = new Set<Promise<unknown>>();
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    acceptQueries = false;
    for (const query of active) query.cancel();
    rejectAbort(abortError);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const acquired = sql.reserve();
  let connection: Awaited<typeof acquired> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    connection = await Promise.race([
      acquired,
      aborted,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CostCenterBusyError()), 8_000);
      }),
    ]);
    const tx = signal
      ? cancellableCostTx(connection as unknown as Tx, () => {
          if (!acceptQueries || signal.aborted) throw abortError;
        }, active, pending)
      : connection as unknown as Tx;
    await tx.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await tx`SET LOCAL statement_timeout = '5000ms'`;
    await tx`SET LOCAL lock_timeout = '500ms'`;
    await tx`SET LOCAL work_mem = '64MB'`;
    // PostgreSQL 17 supports a transaction-wide timeout, covering multiple statements.
    await tx`SET LOCAL transaction_timeout = '8000ms'`;
    const result = await Promise.race([fn(tx), aborted]);
    if (signal?.aborted) throw abortError;
    acceptQueries = false;
    await connection.unsafe("COMMIT");
    return result;
  } catch (error) {
    acceptQueries = false;
    // Drain the cancelled statement before issuing rollback on its reserved connection.
    await Promise.allSettled(pending);
    if (connection) await connection.unsafe("ROLLBACK").catch(() => undefined);
    else acquired.then((late) => late.release()).catch(() => undefined);
    throw signal?.aborted ? abortError : error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (timer) clearTimeout(timer);
    connection?.release();
    runningCostReads -= 1;
  }
}

function dayBounds(value: string) {
  return new Date(value);
}

async function resolveUser(tx: Tx, q: Query): Promise<FilterState> {
  if (!q.userId && !q.username) return { userId: null, selectedUser: null };
  const rows = q.userId
    ? await tx<SelectedUser[]>`SELECT id,username,display_name FROM site_users WHERE id=${Number(q.userId)} LIMIT 1`
    : await tx<SelectedUser[]>`SELECT id,username,display_name FROM site_users WHERE username=${q.username!} LIMIT 1`;
  if (!rows[0]) throw Object.assign(new Error("该用户不存在"), { statusCode: 404 });
  return { userId: rows[0].id, selectedUser: rows[0] };
}

function timeScopedSql(q: Query) {
  return sql`
    SELECT
      a.id,a.receipt_id,a.attempt,a.service,a.model,a.origin,a.status,a.request_id,
      a.usage,a.cost,a.currency,a.cost_basis,a.latency_ms,a.started_at,a.finished_at,
      a.billing_provider,a.upstream_provider,a.operation_id,a.model_id,a.environment,
      a.operation_run_id,a.owner_user_id,a.owner_kind,a.price_snapshot
    FROM receipt_attempts a
    WHERE a.started_at >= ${dayBounds(q.start)}
      AND a.started_at < ${dayBounds(q.end)}
  `;
}

/** New reporting fields first; conservative legacy mapping only where existing semantics prove them. */
function baseSql(q: Query) {
  return sql`
    -- Let owner/Wan lookups push their selective predicates into each reference.
    WITH timed AS NOT MATERIALIZED (${timeScopedSql(q)}),
    assistant_owners AS (
      SELECT DISTINCT linked.attempt_id,'member'::text AS owner_kind,linked.owner_user_id::bigint AS owner_user_id
      FROM (
        SELECT a.id AS attempt_id,su.owner_user_id
        FROM assistant_model_steps sm
        JOIN assistant_turns st ON st.id=sm.turn_id
        JOIN assistant_sessions su ON su.id=st.session_id
        JOIN timed a ON a.receipt_id=sm.receipt_id
        WHERE a.owner_user_id IS NULL AND a.owner_kind IS NULL
        UNION ALL
        SELECT a.id,su.owner_user_id
        FROM assistant_tool_calls tc
        JOIN assistant_turns st ON st.id=tc.turn_id
        JOIN assistant_sessions su ON su.id=st.session_id
        JOIN timed a ON a.operation_run_id=tc.child_run_id
        WHERE a.owner_user_id IS NULL AND a.owner_kind IS NULL
      ) linked
    ),
    operation_owner_candidates AS (
      SELECT linked.attempt_id,
        CASE
          WHEN linked.actor ~ '^user:[1-9][0-9]{0,15}$'
            AND EXISTS (
              SELECT 1 FROM site_users u
              WHERE u.id=substring(linked.actor FROM 6)::bigint
            ) THEN 'member'
          WHEN linked.actor ~ '^admin:.+$' OR linked.actor ~ '^dev:.+$' THEN 'admin'
          WHEN linked.actor IN ('scheduler','subscription-video') THEN 'system'
          ELSE 'unassigned'
        END AS owner_kind,
        CASE
          WHEN linked.actor ~ '^user:[1-9][0-9]{0,15}$'
            AND EXISTS (
              SELECT 1 FROM site_users u
              WHERE u.id=substring(linked.actor FROM 6)::bigint
            ) THEN substring(linked.actor FROM 6)::bigint
        END AS owner_user_id
      FROM (
        SELECT a.id AS attempt_id,r.actor
        FROM timed a
        JOIN operation_runs r ON r.id=a.operation_run_id
        WHERE a.owner_user_id IS NULL AND a.owner_kind IS NULL
        UNION
        SELECT a.id,r.actor
        FROM timed a
        JOIN operation_results result ON result.receipt_id=a.receipt_id
        JOIN operation_runs r ON r.id=result.run_id
        WHERE a.owner_user_id IS NULL AND a.owner_kind IS NULL
      ) linked
    ),
    owner_candidates AS (
      SELECT attempt_id,owner_kind,owner_user_id FROM assistant_owners
      UNION ALL
      SELECT attempt_id,owner_kind,owner_user_id FROM operation_owner_candidates
    ),
    resolved_owners AS (
      SELECT attempt_id,
        CASE WHEN count(DISTINCT ROW(owner_kind,owner_user_id))=1
          THEN min(owner_kind) END AS owner_kind,
        CASE WHEN count(DISTINCT ROW(owner_kind,owner_user_id))=1
          AND min(owner_kind)='member'
          THEN min(owner_user_id) END AS owner_user_id
      FROM owner_candidates
      GROUP BY attempt_id
    ),
    wan_submission_evidence AS NOT MATERIALIZED (
      SELECT
        submitted.id AS submission_attempt_id,
        submitted.receipt_id,
        submitted.attempt,
        submitted.started_at AS submitted_at,
        poll.id AS poll_id,
        poll.usage->'wanTask' AS evidence,
        (poll.id IS NOT NULL AND
          poll.usage->'wanTask'->>'provider'='aliyun'
          AND poll.usage->'wanTask'->>'usageValid'='true'
          AND (poll.usage->'wanTask'->>'outputSeconds') ~ '^[0-9]+(?:\.[0-9]+)?$'
          AND (poll.usage->'wanTask'->>'outputSeconds')::numeric>0
          AND poll.usage->'wanTask'->'priceSnapshot'->>'perSecondCny' IN ('0.6','0.9')
          AND poll.usage->'wanTask'->'priceSnapshot'->>'currency'='CNY'
          AND poll.usage->'wanTask'->'priceSnapshot'->>'basis'='documented-estimate'
        ) AS valid_evidence,
        (poll.id IS NOT NULL
          AND poll.usage->'wanTask'->>'provider'='aliyun'
          AND jsonb_typeof(poll.usage->'wanTask'->'configIdentity')='object'
          AND COALESCE(poll.usage->'wanTask'->>'taskId','')<>''
        ) AS identified_evidence
      FROM timed submitted
      LEFT JOIN receipt_attempts poll
        ON poll.service='aliyun.wan.poll'
        AND poll.usage->'wanTask'->>'submissionReceiptId'=submitted.receipt_id::text
        AND poll.usage->'wanTask'->>'submissionAttempt'=submitted.attempt::text
      WHERE submitted.service='aliyun.wan.video'
    ),
    wan_submissions AS (
      SELECT
        submission_attempt_id AS attempt_id,
        receipt_id,
        attempt,
        submitted_at,
        count(poll_id)::int AS observations,
        count(*) FILTER (WHERE valid_evidence)::int AS valid_observations,
        count(DISTINCT evidence) FILTER (WHERE evidence IS NOT NULL)::int AS distinct_evidence,
        (array_agg(evidence ORDER BY poll_id)
          FILTER (WHERE identified_evidence))[1] AS primary_evidence
      FROM wan_submission_evidence
      GROUP BY submission_attempt_id,receipt_id,attempt,submitted_at
    ),
    wan_window_identity_submissions AS (
      SELECT s.*,
        s.primary_evidence->>'provider' AS task_provider,
        s.primary_evidence->'configIdentity' AS task_config,
        s.primary_evidence->>'taskId' AS task_id,
        CASE
          WHEN (s.primary_evidence->>'outputSeconds') ~ '^[0-9]+(?:\.[0-9]+)?$'
            THEN (s.primary_evidence->>'outputSeconds')::numeric
        END AS output_seconds,
        CASE
          WHEN s.primary_evidence->'priceSnapshot'->>'perSecondCny' IN ('0.6','0.9')
            THEN (s.primary_evidence->'priceSnapshot'->>'perSecondCny')::numeric
        END AS per_second,
        s.primary_evidence->'priceSnapshot'->>'date' AS price_date,
        (s.observations>0
          AND s.observations=s.valid_observations
          AND s.distinct_evidence=1
          AND (s.primary_evidence->>'provider')='aliyun'
          AND jsonb_typeof(s.primary_evidence->'configIdentity')='object'
          AND COALESCE(s.primary_evidence->>'taskId','')<>''
          AND (s.primary_evidence->>'usageValid')='true'
          AND (s.primary_evidence->>'outputSeconds') ~ '^[0-9]+(?:\.[0-9]+)?$'
          AND (s.primary_evidence->>'outputSeconds')::numeric>0
          AND s.primary_evidence->'priceSnapshot'->>'perSecondCny' IN ('0.6','0.9')
          AND s.primary_evidence->'priceSnapshot'->>'currency'='CNY'
          AND s.primary_evidence->'priceSnapshot'->>'basis'='documented-estimate'
        ) AS primary_valid
      FROM wan_submissions s
    ),
    wan_task_identities AS (
      SELECT DISTINCT task_provider,task_config,task_id
      FROM wan_window_identity_submissions
      WHERE task_provider IS NOT NULL AND task_config IS NOT NULL AND task_id IS NOT NULL
    ),
    wan_related_submission_evidence AS NOT MATERIALIZED (
      SELECT
        submitted.id AS submission_attempt_id,
        submitted.receipt_id,
        submitted.attempt,
        submitted.started_at AS submitted_at,
        poll.id AS poll_id,
        poll.usage->'wanTask' AS evidence,
        (poll.id IS NOT NULL AND
          poll.usage->'wanTask'->>'provider'='aliyun'
          AND poll.usage->'wanTask'->>'usageValid'='true'
          AND (poll.usage->'wanTask'->>'outputSeconds') ~ '^[0-9]+(?:\.[0-9]+)?$'
          AND (poll.usage->'wanTask'->>'outputSeconds')::numeric>0
          AND poll.usage->'wanTask'->'priceSnapshot'->>'perSecondCny' IN ('0.6','0.9')
          AND poll.usage->'wanTask'->'priceSnapshot'->>'currency'='CNY'
          AND poll.usage->'wanTask'->'priceSnapshot'->>'basis'='documented-estimate'
        ) AS valid_evidence,
        TRUE AS identified_evidence
      FROM wan_task_identities identity
      JOIN receipt_attempts poll
        ON poll.service='aliyun.wan.poll'
        AND poll.usage->'wanTask'->>'provider'=identity.task_provider
        AND poll.usage->'wanTask'->'configIdentity'=identity.task_config
        AND poll.usage->'wanTask'->>'taskId'=identity.task_id
      JOIN receipt_attempts submitted
        ON submitted.service='aliyun.wan.video'
        AND submitted.receipt_id=CASE
          WHEN (poll.usage->'wanTask'->>'submissionReceiptId') ~ '^[1-9][0-9]{0,15}$'
            THEN (poll.usage->'wanTask'->>'submissionReceiptId')::bigint
        END
        AND submitted.attempt=CASE
          WHEN (poll.usage->'wanTask'->>'submissionAttempt') ~ '^[1-9][0-9]{0,5}$'
            THEN (poll.usage->'wanTask'->>'submissionAttempt')::int
        END
    ),
    wan_combined_submission_evidence AS (
      SELECT * FROM wan_submission_evidence
      UNION
      SELECT * FROM wan_related_submission_evidence
    ),
    wan_all_submissions AS (
      SELECT
        submission_attempt_id AS attempt_id,
        receipt_id,
        attempt,
        submitted_at,
        count(poll_id)::int AS observations,
        count(*) FILTER (WHERE valid_evidence)::int AS valid_observations,
        count(DISTINCT evidence) FILTER (WHERE evidence IS NOT NULL)::int AS distinct_evidence,
        (array_agg(evidence ORDER BY poll_id)
          FILTER (WHERE identified_evidence))[1] AS primary_evidence
      FROM wan_combined_submission_evidence
      GROUP BY submission_attempt_id,receipt_id,attempt,submitted_at
    ),
    wan_identity_submissions AS (
      SELECT s.*,
        s.primary_evidence->>'provider' AS task_provider,
        s.primary_evidence->'configIdentity' AS task_config,
        s.primary_evidence->>'taskId' AS task_id,
        CASE
          WHEN (s.primary_evidence->>'outputSeconds') ~ '^[0-9]+(?:\.[0-9]+)?$'
            THEN (s.primary_evidence->>'outputSeconds')::numeric
        END AS output_seconds,
        CASE
          WHEN s.primary_evidence->'priceSnapshot'->>'perSecondCny' IN ('0.6','0.9')
            THEN (s.primary_evidence->'priceSnapshot'->>'perSecondCny')::numeric
        END AS per_second,
        s.primary_evidence->'priceSnapshot'->>'date' AS price_date,
        (s.observations>0
          AND s.observations=s.valid_observations
          AND s.distinct_evidence=1
          AND (s.primary_evidence->>'provider')='aliyun'
          AND jsonb_typeof(s.primary_evidence->'configIdentity')='object'
          AND COALESCE(s.primary_evidence->>'taskId','')<>''
          AND (s.primary_evidence->>'usageValid')='true'
          AND (s.primary_evidence->>'outputSeconds') ~ '^[0-9]+(?:\.[0-9]+)?$'
          AND (s.primary_evidence->>'outputSeconds')::numeric>0
          AND s.primary_evidence->'priceSnapshot'->>'perSecondCny' IN ('0.6','0.9')
          AND s.primary_evidence->'priceSnapshot'->>'currency'='CNY'
          AND s.primary_evidence->'priceSnapshot'->>'basis'='documented-estimate'
        ) AS primary_valid
      FROM wan_all_submissions s
    ),
    wan_task_groups AS (
      SELECT
        task_provider,
        task_config,
        task_id,
        count(*)::int AS submissions,
        sum(observations)::int AS observations,
        sum(valid_observations)::int AS valid_observations,
        max(distinct_evidence)::int AS distinct_evidence,
        bool_and(primary_valid) AS primary_valid,
        max(output_seconds) AS output_seconds,
        max(per_second) AS per_second,
        max(price_date) AS price_date
      FROM wan_identity_submissions
      WHERE task_provider IS NOT NULL AND task_config IS NOT NULL AND task_id IS NOT NULL
      GROUP BY task_provider,task_config,task_id
    ),
    wan_ranked_submissions AS (
      SELECT s.*,
        row_number() OVER (
          PARTITION BY s.task_provider,s.task_config,s.task_id
          ORDER BY s.submitted_at,s.attempt_id
        )::int AS task_rank
      FROM wan_identity_submissions s
      WHERE s.task_provider IS NOT NULL AND s.task_config IS NOT NULL AND s.task_id IS NOT NULL
    ),
    wan_assignments AS (
      SELECT
        s.receipt_id,
        s.attempt,
        CASE
          WHEN g.submissions=1
            AND g.observations=g.valid_observations
            AND g.distinct_evidence=1
            AND g.primary_valid THEN 'ready'
          WHEN g.observations=0 THEN 'awaiting'
          ELSE 'conflict'
        END::text AS wan_cost_state,
        (s.task_rank=1) AS fee_applicable,
        g.task_id,
        g.output_seconds,
        g.per_second,
        g.price_date
      FROM wan_ranked_submissions s
      JOIN wan_task_groups g
        ON g.task_provider=s.task_provider
        AND g.task_config=s.task_config
        AND g.task_id=s.task_id
      UNION ALL
      SELECT
        s.receipt_id,
        s.attempt,
        CASE WHEN s.observations=0 THEN 'awaiting' ELSE 'conflict' END::text,
        TRUE,
        NULL::text,
        NULL::numeric,
        NULL::numeric,
        NULL::text
      FROM wan_identity_submissions s
      WHERE s.task_id IS NULL
    ),
    enriched AS (
      SELECT
        a.*,
        COALESCE(a.owner_user_id,ro.owner_user_id) AS effective_owner_user_id,
        COALESCE(
          a.owner_kind,
          CASE WHEN COALESCE(a.owner_user_id,ro.owner_user_id) IS NOT NULL THEN 'member' ELSE ro.owner_kind END
        ) AS effective_owner_kind,
        CASE
          WHEN a.service<>'aliyun.wan.video' THEN NULL
          ELSE wa.wan_cost_state
        END AS wan_cost_state,
        wa.task_id AS wan_task_id,
        wa.output_seconds AS wan_output_seconds,
        wa.per_second AS wan_per_second,
        wa.price_date AS wan_price_date,
        COALESCE(wa.fee_applicable,TRUE) AS wan_fee_applicable
      FROM timed a
      LEFT JOIN resolved_owners ro ON ro.attempt_id=a.id
      LEFT JOIN wan_assignments wa ON wa.receipt_id=a.receipt_id AND wa.attempt=a.attempt
    )
    SELECT
      a.id,a.receipt_id,a.attempt,a.service,a.origin,a.status,a.request_id,a.started_at,a.finished_at,a.latency_ms,
      a.operation_run_id,
      a.effective_owner_user_id AS owner_user_id,
      a.effective_owner_kind AS owner_kind,
      COALESCE(a.environment,'unknown') AS environment,
      CASE
        WHEN a.service='aliyun.wan.video' AND NOT a.wan_fee_applicable THEN NULL
        WHEN a.service='aliyun.wan.video' AND a.cost IS NULL AND a.wan_cost_state='ready'
          THEN round(a.wan_output_seconds*a.wan_per_second,6)
        ELSE a.cost
      END AS cost,
      CASE
        WHEN a.service='aliyun.wan.video' AND NOT a.wan_fee_applicable THEN NULL
        WHEN a.service='aliyun.wan.video' AND a.cost IS NULL AND a.wan_cost_state='ready' THEN 'CNY'
        ELSE a.currency
      END AS currency,
      CASE
        WHEN a.service='aliyun.wan.video' AND NOT a.wan_fee_applicable THEN NULL
        WHEN a.service='aliyun.wan.video' AND a.cost IS NULL AND a.wan_cost_state='ready' THEN 'estimated'
        ELSE a.cost_basis
      END AS cost_basis,
      CASE
        WHEN a.service='aliyun.wan.video' AND a.cost IS NULL AND a.wan_cost_state='ready'
          THEN COALESCE(a.usage,'{}'::jsonb)||jsonb_build_object('wanTask',jsonb_build_object(
            'taskId',a.wan_task_id,'outputSeconds',a.wan_output_seconds))
        ELSE a.usage
      END AS usage,
      CASE
        WHEN a.service='aliyun.wan.video' AND a.price_snapshot IS NULL AND a.wan_cost_state='ready'
          THEN jsonb_build_object(
            'version',1,'state','ready','service','aliyun.wan.video','model',a.model,
            'currency','CNY','unit','second','perSecondCny',a.wan_per_second::text,'perRequest',NULL,
            'inputPerMtok',NULL,'cachedInputPerMtok',NULL,'outputPerMtok',NULL,
            'sourceUrl',NULL,'verifiedOn',a.wan_price_date,'selectedAt',a.started_at)
        ELSE a.price_snapshot
      END AS price_snapshot,
      a.wan_cost_state,
      a.wan_fee_applicable,
      CASE
        WHEN a.billing_provider IS NOT NULL THEN a.billing_provider
        WHEN a.operation_id IS NOT NULL OR a.model_id IS NOT NULL THEN 'unknown'
        WHEN a.service LIKE 'redfox.%' THEN 'redfox'
        WHEN a.service LIKE 'agentkey.%' THEN 'agentkey'
        WHEN a.service LIKE 'aliyun.%' OR a.service='dashscope' THEN 'aliyun'
        ELSE 'unknown'
      END AS billing_provider,
      a.upstream_provider,
      COALESCE(
        a.operation_id,
        CASE
          WHEN a.service LIKE 'redfox.%' OR a.service LIKE 'agentkey.%' THEN NULLIF(a.model,'')
          ELSE NULLIF((SELECT r.purpose FROM receipts r WHERE r.id=a.receipt_id),'')
        END,
        NULLIF(a.model,''),
        a.service
      ) AS operation,
      COALESCE(
        a.model_id,
        CASE
          WHEN a.service IN (
            'zhipu','deepseek','mimo','dashscope','embedding','llm',
            'assistant.text','aliyun.wan.video','aliyun.wan.poll'
          ) THEN a.model
        END
      ) AS model,
      CASE WHEN a.operation_id IS NOT NULL THEN 'explicit'
           WHEN a.billing_provider IS NOT NULL OR a.model_id IS NOT NULL THEN 'explicit'
           WHEN a.service LIKE 'redfox.%' OR a.service LIKE 'agentkey.%'
             OR a.service LIKE 'aliyun.%' OR a.service='dashscope' THEN 'legacy_mapping'
           ELSE 'unknown' END AS identity_source
    FROM enriched a
  `;
}

function scopeConditions(q: Query, user: FilterState) {
  const conditions = [sql`TRUE`];
  if (q.billingProvider) conditions.push(sql`b.billing_provider = ${q.billingProvider}`);
  if (q.service) conditions.push(sql`b.service = ${q.service}`);
  if (q.operation) conditions.push(sql`b.operation = ${q.operation}`);
  if (q.model) conditions.push(sql`b.model = ${q.model}`);
  if (q.modelMissing) conditions.push(sql`b.model IS NULL`);
  if (q.origin) conditions.push(sql`b.origin = ${q.origin}`);
  if (q.environment) conditions.push(sql`b.environment = ${q.environment}`);
  if (q.status) conditions.push(sql`b.status = ${q.status}`);
  if (q.costBasis) conditions.push(sql`b.cost_basis = ${q.costBasis}`);
  if (q.owner === "member") conditions.push(sql`b.owner_kind = 'member'`);
  else if (q.owner === "admin") conditions.push(sql`b.owner_kind = 'admin'`);
  else if (q.owner === "system") conditions.push(sql`b.owner_kind = 'system'`);
  else if (q.owner === "unassigned") conditions.push(sql`b.owner_kind IS NULL OR b.owner_kind = 'unassigned'`);
  if (user.userId !== null) conditions.push(sql`b.owner_user_id = ${user.userId}`);
  if (q.skillId && q.moduleId) {
    conditions.push(sql`(
      EXISTS (
        SELECT 1
        FROM assistant_turns st
        JOIN assistant_model_steps sm ON sm.turn_id=st.id AND sm.receipt_id=b.receipt_id
        JOIN assistant_model_step_activations sma ON sma.model_step_id=sm.id
        JOIN assistant_activations sa ON sa.id=sma.activation_id AND sa.turn_id=st.id
        WHERE (b.operation_run_id IS NULL OR st.parent_operation_run_id=b.operation_run_id)
          AND sa.candidate->>'skillId'=${q.skillId}
          AND sa.candidate->>'moduleId'=${q.moduleId}
      )
      OR EXISTS (
        SELECT 1
        FROM assistant_tool_calls sc
        JOIN assistant_turns st ON st.id=sc.turn_id
        JOIN assistant_activations sa
          ON sa.id::text=COALESCE(sc.activation_id::text,sc.input->>'activationId')
          AND sa.turn_id=st.id
        WHERE sc.child_run_id=b.operation_run_id
          AND sa.candidate->>'skillId'=${q.skillId}
          AND sa.candidate->>'moduleId'=${q.moduleId}
      )
    )`);
  }
  return conditions.reduce((all, condition) => sql`${all} AND (${condition})`);
}

/**
 * Compatibility projection for the retired local cost summary. It intentionally executes inside
 * the caller's existing read transaction and derives every row from the same unified CTE.
 */
export async function legacyAttemptCostGroups(
  tx: Tx,
  start: string,
  end: string,
): Promise<LegacyAttemptCostGroup[]> {
  const q = CostsQuery.parse({ start, end, view: "overview", groupBy: "service" });
  return tx<LegacyAttemptCostGroup[]>`
    WITH base AS (${baseSql(q)})
    SELECT
      b.service,
      raw.model,
      b.origin,
      r.request->>'base' AS base,
      CASE
        WHEN r.request->>'base'='https://redfox.hk' THEN 'production'
        WHEN r.request->>'base' IS NOT NULL THEN 'other'
        ELSE 'unknown'
      END AS environment,
      b.currency,
      b.cost_basis AS "costBasis",
      count(*)::int AS attempts,
      sum(b.cost)::text AS "knownCost",
      count(*) FILTER (WHERE b.cost IS NULL)::int AS "unknownCostCount",
      sum(
        CASE WHEN jsonb_typeof(b.usage->'estimatedCredits')='number'
          THEN (b.usage->>'estimatedCredits')::numeric END
      )::text AS "estimatedCredits",
      sum(
        CASE WHEN jsonb_typeof(b.usage->'chargedCredits')='number'
          THEN (b.usage->>'chargedCredits')::numeric END
      )::text AS "chargedCredits",
      count(*) FILTER (
        WHERE jsonb_typeof(b.usage->'estimatedCredits') IS DISTINCT FROM 'number'
      )::int AS "unknownEstimatedCreditsCount",
      count(*) FILTER (
        WHERE jsonb_typeof(b.usage->'chargedCredits') IS DISTINCT FROM 'number'
      )::int AS "unknownChargedCreditsCount",
      jsonb_build_object(
        'pending',count(*) FILTER (WHERE b.status='pending'),
        'received',count(*) FILTER (WHERE b.status='received'),
        'failed',count(*) FILTER (WHERE b.status='failed'),
        'unknown',count(*) FILTER (WHERE b.status='unknown')
      ) AS "statusCounts"
    FROM base b
    JOIN receipts r ON r.id=b.receipt_id
    JOIN receipt_attempts raw ON raw.id=b.id
    WHERE b.service LIKE 'redfox.%'
      OR b.service LIKE 'agentkey.%'
      OR b.service LIKE 'aliyun.wan.%'
    GROUP BY
      b.service,raw.model,b.origin,r.request->>'base',b.currency,b.cost_basis
    ORDER BY b.service,raw.model,b.origin,base,b.currency,b.cost_basis
  `;
}

function integer(value: string | number | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function decimalOrNull(value: unknown): string | null {
  return typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value) ? value : null;
}

function amountBuckets(value: unknown): CostAmountBucket[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (
      !["live", "replay", "imported"].includes(String(row.origin)) ||
      !["production", "development", "test", "other", "unknown"].includes(String(row.environment)) ||
      typeof row.currency !== "string" ||
      typeof row.amount !== "string"
    )
      return [];
    return [{
      origin: row.origin as CostAmountBucket["origin"],
      environment: row.environment as CostEnvironment,
      currency: row.currency,
      costBasis: row.costBasis === "actual" || row.costBasis === "estimated" ? row.costBasis : null,
      amount: row.amount,
      records: integer(row.records as string | number),
    }];
  });
}

function totalsFrom(row: RawGroupRow): CostTotals {
  return {
    attempts: integer(row.attempts),
    logicalRequests: integer(row.logical_requests),
    feeItems: integer(row.fee_items),
    statusCounts: {
      pending: integer(row.pending),
      received: integer(row.received),
      failed: integer(row.failed),
      unknown: integer(row.unknown),
    },
    usage: {
      inputTokens: integer(row.input_tokens),
      outputTokens: integer(row.output_tokens),
      cachedTokens: integer(row.cached_tokens),
      estimatedCredits: decimalOrNull(row.estimated_credits),
      chargedCredits: decimalOrNull(row.charged_credits),
      outputSeconds: decimalOrNull(row.output_seconds),
      knownTokenRows: integer(row.known_token_rows),
      missingUsageRows: integer(row.missing_usage_rows),
    },
    amountBuckets: amountBuckets(row.amount_buckets),
    knownCostItems: integer(row.known_cost_items),
    unknownCostItems: integer(row.unknown_cost_items),
    actualCostItems: integer(row.actual_cost_items),
    estimatedCostItems: integer(row.estimated_cost_items),
    sharedFeeItems: 0,
  };
}

function commonAggregates() {
  return sql`
    count(*)::int AS attempts,
    count(*) FILTER (WHERE b.service <> 'aliyun.wan.poll'
      AND (b.service <> 'aliyun.wan.video' OR b.wan_fee_applicable))::int AS fee_items,
    count(*) FILTER (WHERE b.status='pending')::int AS pending,
    count(*) FILTER (WHERE b.status='received')::int AS received,
    count(*) FILTER (WHERE b.status='failed')::int AS failed,
    count(*) FILTER (WHERE b.status='unknown')::int AS unknown,
    sum(CASE WHEN jsonb_typeof(b.usage->'prompt_tokens')='number' THEN (b.usage->>'prompt_tokens')::numeric ELSE 0 END)::text AS input_tokens,
    sum(CASE WHEN jsonb_typeof(b.usage->'completion_tokens')='number' THEN (b.usage->>'completion_tokens')::numeric ELSE 0 END)::text AS output_tokens,
    sum(CASE WHEN jsonb_typeof(b.usage->'prompt_cache_hit_tokens')='number' THEN (b.usage->>'prompt_cache_hit_tokens')::numeric ELSE 0 END)::text AS cached_tokens,
    sum(CASE WHEN jsonb_typeof(b.usage->'estimatedCredits')='number' THEN (b.usage->>'estimatedCredits')::numeric END)::text AS estimated_credits,
    sum(CASE WHEN jsonb_typeof(b.usage->'chargedCredits')='number' THEN (b.usage->>'chargedCredits')::numeric END)::text AS charged_credits,
    sum(CASE WHEN b.service <> 'aliyun.wan.poll' AND jsonb_typeof(b.usage->'video_duration')='number' THEN (b.usage->>'video_duration')::numeric
             WHEN b.service <> 'aliyun.wan.poll' AND jsonb_typeof(b.usage->'wanTask'->'outputSeconds')='number' THEN (b.usage->'wanTask'->>'outputSeconds')::numeric END)::text AS output_seconds,
    count(*) FILTER (WHERE jsonb_typeof(b.usage->'prompt_tokens')='number' OR jsonb_typeof(b.usage->'completion_tokens')='number')::int AS known_token_rows,
    count(*) FILTER (WHERE b.service <> 'aliyun.wan.poll' AND b.usage IS NULL)::int AS missing_usage_rows,
    count(*) FILTER (WHERE b.service <> 'aliyun.wan.poll'
      AND (b.service <> 'aliyun.wan.video' OR b.wan_fee_applicable)
      AND b.cost IS NOT NULL)::int AS known_cost_items,
    count(*) FILTER (WHERE b.service <> 'aliyun.wan.poll'
      AND (b.service <> 'aliyun.wan.video' OR b.wan_fee_applicable)
      AND b.cost IS NULL)::int AS unknown_cost_items,
    count(*) FILTER (WHERE b.service <> 'aliyun.wan.poll'
      AND (b.service <> 'aliyun.wan.video' OR b.wan_fee_applicable)
      AND b.cost IS NOT NULL AND b.cost_basis='actual')::int AS actual_cost_items,
    count(*) FILTER (WHERE b.service <> 'aliyun.wan.poll'
      AND (b.service <> 'aliyun.wan.video' OR b.wan_fee_applicable)
      AND b.cost IS NOT NULL AND b.cost_basis='estimated')::int AS estimated_cost_items
  `;
}

/** All attempt metrics are additive; logical requests are deduplicated separately. */
function rolledUpAggregates() {
  return sql`
    sum(b.attempts)::int AS attempts,
    sum(b.fee_items)::int AS fee_items,
    sum(b.pending)::int AS pending,
    sum(b.received)::int AS received,
    sum(b.failed)::int AS failed,
    sum(b.unknown)::int AS unknown,
    sum(b.input_tokens::numeric)::text AS input_tokens,
    sum(b.output_tokens::numeric)::text AS output_tokens,
    sum(b.cached_tokens::numeric)::text AS cached_tokens,
    sum(b.estimated_credits::numeric)::text AS estimated_credits,
    sum(b.charged_credits::numeric)::text AS charged_credits,
    sum(b.output_seconds::numeric)::text AS output_seconds,
    sum(b.known_token_rows)::int AS known_token_rows,
    sum(b.missing_usage_rows)::int AS missing_usage_rows,
    sum(b.known_cost_items)::int AS known_cost_items,
    sum(b.unknown_cost_items)::int AS unknown_cost_items,
    sum(b.actual_cost_items)::int AS actual_cost_items,
    sum(b.estimated_cost_items)::int AS estimated_cost_items
  `;
}

function costBucketSql() {
  return sql`
    jsonb_agg(
      jsonb_build_object(
        'origin',c.origin,
        'environment',c.environment,
        'currency',c.currency,
        'costBasis',c.cost_basis,
        'amount',c.amount,
        'records',c.records
      ) ORDER BY c.origin,c.environment,c.currency,c.cost_basis
    ) AS amount_buckets
  `;
}

function groupDimension(q: Query) {
  switch (q.groupBy ?? "provider") {
    case "service":
      return {
        key: sql`b.billing_provider`,
        select: sql`b.billing_provider,b.service,b.operation`,
        group: sql`b.billing_provider,b.service,b.operation`,
        joins: sql`g.billing_provider IS NOT DISTINCT FROM c.billing_provider
          AND g.service IS NOT DISTINCT FROM c.service
          AND g.operation IS NOT DISTINCT FROM c.operation`,
        order: sql`billing_provider NULLS LAST,service,operation`,
      };
    case "model":
      return {
        key: sql`b.billing_provider`,
        select: sql`b.billing_provider,b.model`,
        group: sql`b.billing_provider,b.model`,
        joins: sql`g.billing_provider IS NOT DISTINCT FROM c.billing_provider
          AND g.model IS NOT DISTINCT FROM c.model`,
        order: sql`billing_provider NULLS LAST,model NULLS LAST`,
      };
    case "user":
      return {
        key: sql`b.owner_user_id`,
        select: sql`b.owner_user_id AS user_id,b.owner_kind`,
        group: sql`b.owner_user_id,b.owner_kind`,
        joins: sql`g.user_id IS NOT DISTINCT FROM c.user_id
          AND g.owner_kind IS NOT DISTINCT FROM c.owner_kind`,
        order: sql`user_id NULLS LAST,owner_kind NULLS LAST`,
      };
    default:
      return {
        key: sql`b.billing_provider`,
        select: sql`b.billing_provider`,
        group: sql`b.billing_provider`,
        joins: sql`g.billing_provider IS NOT DISTINCT FROM c.billing_provider`,
        order: sql`billing_provider NULLS LAST`,
      };
  }
}

async function overviewGroups(
  tx: Tx,
  q: Query,
  user: FilterState,
): Promise<{ rows: RawGroupRow[]; total: RawGroupRow | null; hasMore: boolean }> {
  const offset = q.cursor ? decodeGroupCursor(q, q.cursor) : 0;
  if (q.groupBy === "skill") {
    const result = await skillGroups(tx, q, user, offset);
    return { ...result, total: null };
  }
  const d = groupDimension(q), condition = scopeConditions(q, user);
  const entitySelect =
    q.groupBy === "service"
      ? sql`${d.select},NULL::text AS model,NULL::bigint AS user_id,NULL::text AS owner_kind`
      : q.groupBy === "model"
        ? sql`b.billing_provider,NULL::text AS service,NULL::text AS operation,b.model,NULL::bigint AS user_id,NULL::text AS owner_kind`
        : q.groupBy === "user"
          ? sql`NULL::text AS billing_provider,NULL::text AS service,NULL::text AS operation,NULL::text AS model,${d.select}`
          : sql`${d.select},NULL::text AS service,NULL::text AS operation,NULL::text AS model,NULL::bigint AS user_id,NULL::text AS owner_kind`;
  const upstreamSelect = sql`
    CASE
      WHEN count(DISTINCT b.upstream_provider) FILTER (WHERE b.upstream_provider IS NOT NULL)=1
        THEN min(b.upstream_provider) FILTER (WHERE b.upstream_provider IS NOT NULL)
    END AS upstream_provider
  `;
  const userSelect =
    q.groupBy === "user"
      ? sql`,u.username,u.display_name`
      : sql`,NULL::text AS username,NULL::text AS display_name`;
  const userGroup = q.groupBy === "user" ? sql`,u.username,u.display_name` : sql``;
  const userJoin = q.groupBy === "user" ? sql`LEFT JOIN site_users u ON u.id=b.owner_user_id` : sql``;
  const rows = await tx<RawGroupRow[]>`
    WITH base AS (${baseSql(q)}),
    scoped AS MATERIALIZED (
      SELECT b.id,b.receipt_id,b.operation_run_id,b.service,b.origin,b.environment,
        b.currency,b.cost_basis,b.status,b.usage,b.cost,b.billing_provider,b.operation,
        b.model,b.owner_user_id,b.owner_kind,b.upstream_provider,b.wan_fee_applicable
      FROM base b
      WHERE ${condition}
    ),
    dimension_groups AS MATERIALIZED (
      SELECT
        ${entitySelect}${userSelect},${upstreamSelect},
        ${commonAggregates()}
      FROM scoped b
      ${userJoin}
      GROUP BY ${d.group}${userGroup}
    ),
    grouped AS (
      SELECT 'group'::text AS row_kind,b.* FROM dimension_groups b
      UNION ALL
      SELECT 'total'::text AS row_kind,
        NULL::text AS billing_provider,NULL::text AS service,NULL::text AS operation,NULL::text AS model,
        NULL::bigint AS user_id,NULL::text AS owner_kind,NULL::text AS username,NULL::text AS display_name,
        NULL::text AS upstream_provider,
        ${rolledUpAggregates()}
      FROM dimension_groups b
    ),
    logical_receipts AS MATERIALIZED (
      SELECT ${d.group},b.receipt_id
      FROM scoped b
      GROUP BY ${d.group},b.receipt_id
    ),
    logical_groups AS MATERIALIZED (
      SELECT ${d.select},count(*)::int AS logical_requests
      FROM logical_receipts b
      GROUP BY ${d.group}
    ),
    logical_total AS (
      SELECT count(*)::int AS logical_requests
      FROM (SELECT receipt_id FROM logical_receipts GROUP BY receipt_id) receipts
    ),
    ranked AS (
      SELECT *, row_number() OVER (ORDER BY attempts DESC, ${d.order}) AS group_order
      FROM grouped
      WHERE row_kind='group'
      ORDER BY attempts DESC, ${d.order}
      LIMIT ${q.limit + 1} OFFSET ${offset}
    ),
    buckets AS (
      SELECT CASE WHEN GROUPING(${d.key})=1 THEN 'total' ELSE 'group' END AS row_kind,
        ${d.select},b.origin,b.environment,b.currency,b.cost_basis,sum(b.cost)::text AS amount,count(*)::int AS records
      FROM scoped b
      WHERE b.cost IS NOT NULL AND b.currency IS NOT NULL
      GROUP BY GROUPING SETS (
        (${d.group},b.origin,b.environment,b.currency,b.cost_basis),
        (b.origin,b.environment,b.currency,b.cost_basis)
      )
    ),
    page_groups AS (
      SELECT g.*,c.logical_requests,amounts.amount_buckets
      FROM ranked g
      LEFT JOIN logical_groups c ON ${d.joins}
      LEFT JOIN LATERAL (
        SELECT ${costBucketSql()}
        FROM buckets c
        WHERE c.row_kind='group' AND ${d.joins}
      ) amounts ON TRUE
    ),
    total_group AS (
      SELECT g.*,2147483647::bigint AS group_order,l.logical_requests,c.amount_buckets
      FROM grouped g
      CROSS JOIN logical_total l
      LEFT JOIN LATERAL (
        SELECT ${costBucketSql()}
        FROM buckets c
        WHERE c.row_kind='total'
      ) c ON TRUE
      WHERE g.row_kind='total'
    )
    SELECT * FROM page_groups
    UNION ALL
    SELECT * FROM total_group
    ORDER BY row_kind,group_order
  `;
  const visible = rows.filter((row) => row.row_kind === "group");
  return {
    rows: visible.slice(0, q.limit),
    total: rows.find((row) => row.row_kind === "total") ?? null,
    hasMore: visible.length > q.limit,
  };
}

function decodeGroupCursor(q: Query, cursor: string): number {
  const binding = queryBinding({ ...q, cursor: null, limit: q.limit });
  const c = decodeCursor<{ o?: unknown; b?: unknown }>("cg1", cursor);
  if (c.b !== binding || !Number.isSafeInteger(c.o) || Number(c.o) < 0)
    throw new InvalidCursorError("cursor does not match these filters");
  return Number(c.o);
}

async function skillGroups(tx: Tx, q: Query, user: FilterState, offset: number): Promise<{ rows: RawGroupRow[]; hasMore: boolean }> {
  const condition = scopeConditions(q, user);
  const rows = await tx<RawGroupRow[]>`
    WITH base AS (${baseSql(q)}),
    scoped AS (SELECT b.* FROM base b WHERE ${condition}),
    links AS (
      SELECT b.id AS attempt_id,'model'::text AS link_kind,sm.cost_context_version,
        sa.id AS activation_id,sa.candidate
      FROM scoped b
      JOIN assistant_model_steps sm ON sm.receipt_id=b.receipt_id
      JOIN assistant_turns st ON st.id=sm.turn_id
      LEFT JOIN assistant_model_step_activations sma ON sma.model_step_id=sm.id
      LEFT JOIN assistant_activations sa ON sa.id=sma.activation_id AND sa.turn_id=st.id
      WHERE (b.operation_run_id IS NULL OR st.parent_operation_run_id=b.operation_run_id)
      UNION ALL
      SELECT b.id,'search'::text,NULL::smallint,sa.id,sa.candidate
      FROM scoped b
      JOIN assistant_tool_calls tc ON tc.child_run_id=b.operation_run_id
      JOIN assistant_turns st ON st.id=tc.turn_id
      JOIN assistant_activations sa
        ON sa.id::text=COALESCE(tc.activation_id::text,tc.input->>'activationId')
        AND sa.turn_id=st.id
    ),
    attempt_skills AS (
      SELECT b.*,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
          'activationId',l.activation_id,
          'skillId',l.candidate->>'skillId',
          'moduleId',l.candidate->>'moduleId',
          'version',l.candidate->>'moduleVersion',
          'label',COALESCE(l.candidate->>'description',l.candidate->>'skillId')
        )) FILTER (WHERE l.activation_id IS NOT NULL),'[]'::jsonb) AS skills,
        bool_or(l.link_kind='model') AS has_model_step,
        max(l.cost_context_version) FILTER (WHERE l.link_kind='model') AS cost_context_version
      FROM scoped b
      LEFT JOIN links l ON l.attempt_id=b.id
      GROUP BY b.id,b.receipt_id,b.attempt,b.service,b.origin,b.status,b.request_id,b.cost,b.currency,b.cost_basis,
        b.usage,b.price_snapshot,b.started_at,b.finished_at,b.latency_ms,b.operation_run_id,b.owner_user_id,b.owner_kind,
        b.environment,b.billing_provider,b.upstream_provider,b.operation,b.model,b.identity_source,b.wan_cost_state,
        b.wan_fee_applicable
    ),
    keyed AS (
      SELECT *,
        CASE
          WHEN jsonb_array_length(skills)>1 THEN '__shared__'
          WHEN jsonb_array_length(skills)=1 THEN CONCAT(skills->0->>'skillId','::',skills->0->>'moduleId','::',skills->0->>'version')
          WHEN has_model_step AND cost_context_version=1 THEN '__not_activated__'
          WHEN has_model_step THEN '__historical_unknown__'
          ELSE '__not_applicable__'
        END AS skill_key
      FROM attempt_skills
    ),
    grouped AS (
      SELECT skill_key,
        min(skills->0->>'skillId') FILTER (WHERE jsonb_array_length(skills)=1) AS skill_id,
        min(skills->0->>'moduleId') FILTER (WHERE jsonb_array_length(skills)=1) AS module_id,
        min(skills->0->>'version') FILTER (WHERE jsonb_array_length(skills)=1) AS skill_version,
        min(skills->0->>'label') FILTER (WHERE jsonb_array_length(skills)=1) AS skill_label,
        count(DISTINCT b.receipt_id)::int AS logical_requests,
        ${commonAggregates()}
      FROM keyed b
      GROUP BY skill_key
    ),
    ranked AS (
      SELECT *,row_number() OVER (ORDER BY attempts DESC,skill_key) AS group_order
      FROM grouped
      ORDER BY attempts DESC,skill_key
      LIMIT ${q.limit + 1} OFFSET ${offset}
    ),
    buckets AS (
      SELECT skill_key,b.origin,b.environment,b.currency,b.cost_basis,sum(b.cost)::text AS amount,count(*)::int AS records
      FROM keyed b
      WHERE b.cost IS NOT NULL AND b.currency IS NOT NULL
      GROUP BY skill_key,b.origin,b.environment,b.currency,b.cost_basis
    )
    SELECT g.*,${costBucketSql()},g.skill_key='__shared__' AS shared
    FROM ranked g
    LEFT JOIN buckets c ON g.skill_key=c.skill_key
    GROUP BY g.skill_key,g.skill_id,g.module_id,g.skill_version,g.skill_label,g.attempts,g.logical_requests,
      g.fee_items,g.pending,g.received,g.failed,g.unknown,g.input_tokens,g.output_tokens,g.cached_tokens,
      g.estimated_credits,g.charged_credits,g.output_seconds,g.known_token_rows,g.missing_usage_rows,
      g.known_cost_items,g.unknown_cost_items,g.actual_cost_items,g.estimated_cost_items,g.group_order
    ORDER BY g.group_order
  `;
  return { rows: rows.slice(0, q.limit), hasMore: rows.length > q.limit };
}

function groupFromRow(row: RawGroupRow, groupBy: CostGroupBy): CostGroup {
  const skill =
    row.skill_id && row.module_id
      ? {
          skillId: row.skill_id,
          moduleId: row.module_id,
          version: row.skill_version,
          label: row.skill_label ?? row.skill_id,
        }
      : null;
  const key =
    groupBy === "provider"
      ? row.billing_provider ?? "unknown"
      : groupBy === "service"
        ? JSON.stringify([row.billing_provider, row.service, row.operation])
        : groupBy === "model"
          ? JSON.stringify([row.billing_provider, row.model])
          : groupBy === "user"
            ? JSON.stringify([row.user_id, row.owner_kind])
            : row.skill_key ??
              (row.skill_id && row.module_id
                ? `${row.skill_id}:${row.module_id}:${row.skill_version ?? ""}`
                : "unassigned");
  const totals = totalsFrom(row);
  totals.sharedFeeItems = (row as RawGroupRow & { shared?: boolean }).shared ? totals.feeItems : 0;
  return {
    key,
    groupBy,
    billingProvider: row.billing_provider,
    upstreamProvider: row.upstream_provider ?? null,
    service: row.service,
    operation: row.operation,
    model: row.model,
    skill,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    ownerKind: row.owner_kind,
    additive: !(row as RawGroupRow & { shared?: boolean }).shared,
    totals,
  };
}

async function totalRow(tx: Tx, q: Query, user: FilterState): Promise<RawGroupRow> {
  const condition = scopeConditions(q, user);
  const [row] = await tx<RawGroupRow[]>`
    WITH base AS (${baseSql(q)}),
    scoped AS (SELECT b.* FROM base b WHERE ${condition})
    SELECT
      NULL::text AS billing_provider,NULL::text AS service,NULL::text AS operation,NULL::text AS model,
      NULL::text AS skill_id,NULL::text AS module_id,NULL::text AS skill_version,NULL::text AS skill_label,
      NULL::bigint AS user_id,NULL::text AS username,NULL::text AS display_name,NULL::text AS owner_kind,
      count(DISTINCT b.receipt_id)::int AS logical_requests,
      ${commonAggregates()},
      (SELECT jsonb_agg(jsonb_build_object(
        'origin',x.origin,'environment',x.environment,'currency',x.currency,'costBasis',x.cost_basis,
        'amount',x.amount,'records',x.records
      ) ORDER BY x.origin,x.environment,x.currency,x.cost_basis)
       FROM (
         SELECT b.origin,b.environment,b.currency,b.cost_basis,sum(b.cost)::text AS amount,count(*)::int AS records
         FROM scoped b
         WHERE b.cost IS NOT NULL AND b.currency IS NOT NULL
         GROUP BY b.origin,b.environment,b.currency,b.cost_basis
       ) x) AS amount_buckets
    FROM scoped b
  `;
  return row!;
}

interface OverviewMetaRow {
  facets: unknown;
  facets_truncated: boolean;
  shared: number;
  unknown_identity: number;
  unknown_owner: number;
  unknown_skill: number;
  wan_conflict: number;
  unknown_fee: number;
}

async function overviewMeta(
  tx: Tx,
  q: Query,
  user: FilterState,
  loadCatalog: CostReadOptions["loadCatalog"] = catalog,
): Promise<{ facets: CostFacetsLike; truncated: boolean; shared: number; warnings: CostWarning[] }> {
  const condition = scopeConditions(q, user);
  const [row] = await tx<OverviewMetaRow[]>`
    WITH base AS (${baseSql(q)}),
    scoped AS MATERIALIZED (
      SELECT b.id,b.receipt_id,b.operation_run_id,b.billing_provider,b.service,b.model,
        b.owner_kind,b.cost,b.wan_cost_state,b.wan_fee_applicable
      FROM base b
      WHERE ${condition}
    ),
    values AS (
      SELECT
        CASE
          WHEN GROUPING(b.billing_provider)=0 THEN 'provider'
          WHEN GROUPING(b.service)=0 THEN 'service'
          ELSE 'model'
        END AS kind,
        CASE
          WHEN GROUPING(b.billing_provider)=0 THEN b.billing_provider
          WHEN GROUPING(b.service)=0 THEN b.service
          ELSE b.model
        END AS value,
        count(*)::int AS n
      FROM scoped b
      GROUP BY GROUPING SETS ((b.billing_provider),(b.service),(b.model))
      HAVING (GROUPING(b.model)=0 AND b.model IS NOT NULL) OR GROUPING(b.model)=1
    ),
    facet_ranked AS (
      SELECT *,row_number() OVER (PARTITION BY kind ORDER BY n DESC,value) rn FROM values
    ),
    model_links AS MATERIALIZED (
      SELECT b.id AS attempt_id,sm.id AS model_step_id,st.id AS turn_id,sm.cost_context_version
      FROM assistant_model_steps sm
      JOIN assistant_turns st ON st.id=sm.turn_id
      JOIN scoped b ON b.receipt_id=sm.receipt_id
      WHERE (b.operation_run_id IS NULL OR st.parent_operation_run_id=b.operation_run_id)
    ),
    links AS (
      SELECT ml.attempt_id,sa.id AS activation_id
      FROM model_links ml
      JOIN assistant_model_step_activations sma ON sma.model_step_id=ml.model_step_id
      JOIN assistant_activations sa ON sa.id=sma.activation_id AND sa.turn_id=ml.turn_id
      UNION
      SELECT b.id,sa.id
      FROM assistant_tool_calls tc
      JOIN assistant_activations sa
        ON sa.id::text=COALESCE(tc.activation_id::text,tc.input->>'activationId')
        AND sa.turn_id=tc.turn_id
      JOIN scoped b ON b.operation_run_id=tc.child_run_id
    ),
    shared AS (
      SELECT count(*)::int n FROM (
        SELECT attempt_id FROM links GROUP BY attempt_id HAVING count(*)>1
      ) x
    ),
    unknown_skills AS (
      SELECT DISTINCT attempt_id FROM model_links WHERE cost_context_version IS NULL
    ),
    warning_counts AS (
      SELECT
        count(*) FILTER (WHERE b.billing_provider IS NULL OR b.billing_provider='unknown')::int AS unknown_identity,
        count(*) FILTER (WHERE b.owner_kind IS NULL OR b.owner_kind='unassigned')::int AS unknown_owner,
        count(*) FILTER (WHERE us.attempt_id IS NOT NULL)::int AS unknown_skill,
        count(*) FILTER (WHERE b.service='aliyun.wan.video' AND b.wan_fee_applicable AND b.wan_cost_state='conflict')::int AS wan_conflict,
        count(*) FILTER (WHERE b.service<>'aliyun.wan.poll'
          AND (b.service<>'aliyun.wan.video' OR b.wan_fee_applicable) AND b.cost IS NULL)::int AS unknown_fee
      FROM scoped b
      LEFT JOIN unknown_skills us ON us.attempt_id=b.id
    )
    SELECT
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('kind',kind,'value',value,'n',n) ORDER BY kind,n DESC,value)
        FROM facet_ranked WHERE rn<=50
      ),'[]'::jsonb) AS facets,
      EXISTS(SELECT 1 FROM facet_ranked WHERE rn=51) AS facets_truncated,
      shared.n AS shared,
      warning_counts.unknown_identity,
      warning_counts.unknown_owner,
      warning_counts.unknown_skill,
      warning_counts.wan_conflict,
      warning_counts.unknown_fee
    FROM shared CROSS JOIN warning_counts
  `;
  const facetRows = Array.isArray(row?.facets)
    ? row.facets.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const value = raw as Record<string, unknown>;
        return typeof value.kind === "string" && typeof value.value === "string"
          ? [{ kind: value.kind, value: value.value, n: integer(value.n as string | number) }]
          : [];
      })
    : [];
  const pick = (kind: string): CostFacet[] =>
    facetRows
      .filter((facet) => facet.kind === kind)
      .slice(0, 50)
      .map((facet) => ({ value: facet.value, label: facet.value, count: facet.n }));
  const packages = await loadCatalog().catch(() => null);
  const localSkills = (packages ?? []).flatMap(({ manifest }) =>
    manifest.modules.map((module) => ({
      value: `${manifest.skillId}:${module.moduleId}`,
      label: `${manifest.name} · ${module.description}`,
      count: 0,
    })),
  );
  const shared = integer(row?.shared);
  const truncated = Boolean(row?.facets_truncated);
  const warnings = costWarnings({
    unknownIdentity: integer(row?.unknown_identity),
    unknownOwner: integer(row?.unknown_owner),
    unknownSkill: integer(row?.unknown_skill),
    wanConflict: integer(row?.wan_conflict),
    unknownFee: integer(row?.unknown_fee),
    shared,
    facetsTruncated: truncated,
    catalogUnavailable: packages === null,
  });
  return {
    facets: { providers: pick("provider"), services: pick("service"), models: pick("model"), skills: localSkills },
    truncated,
    shared,
    warnings,
  };
}

type CostFacetsLike = {
  providers: CostFacet[];
  services: CostFacet[];
  models: CostFacet[];
  skills: CostFacet[];
};

export async function costs(raw: QueryInput, options: CostReadOptions = {}): Promise<CostResponse> {
  const parsed = CostsQuery.parse(raw);
  if (parsed.view === "details") return costDetails(parsed, options);
  return costOverview(parsed, options);
}

async function costOverview(q: Query, options: CostReadOptions): Promise<CostOverviewResponse> {
  return withCostRead(async (tx) => {
    const user = await resolveUser(tx, q);
    // postgres.js transactions own one connection. Keep these sequential so a report cannot race
    // queries on that connection or multiply memory spikes when a large range is scanned.
    const grouped = await overviewGroups(tx, q, user);
    const total = grouped.total ?? (await totalRow(tx, q, user));
    const meta = await overviewMeta(tx, q, user, options.loadCatalog);
    const totals = totalsFrom(total);
    totals.sharedFeeItems = meta.shared;
    const groupBy = (q.groupBy ?? "provider") as CostGroupBy;
    const groups = grouped.rows.map((row) => groupFromRow(row, groupBy));
    const groupOffset = q.cursor ? decodeGroupCursor(q, q.cursor) : 0;
    const nextGroupCursor = grouped.hasMore
      ? encodeCursor("cg1", { o: groupOffset + groups.length, b: queryBinding({ ...q, cursor: null, limit: q.limit }) })
      : null;
    return {
      view: "overview",
      asOf: new Date().toISOString(),
      query: {
        start: q.start,
        end: q.end,
        view: "overview",
        groupBy,
        timeBasis: "attempt_started_at",
      },
      filters: filtersDto(q, user),
      selectedUser: user.selectedUser
        ? { id: user.selectedUser.id, username: user.selectedUser.username, displayName: user.selectedUser.display_name }
        : null,
      totals,
      groups,
      nextGroupCursor,
      facets: { ...meta.facets, truncated: meta.truncated },
      warnings: meta.warnings,
    };
  }, options);
}

function costWarnings(input: {
  unknownIdentity: number;
  unknownOwner: number;
  unknownSkill: number;
  wanConflict: number;
  unknownFee: number;
  shared: number;
  facetsTruncated: boolean;
  catalogUnavailable: boolean;
}): CostWarning[] {
  const warnings: CostWarning[] = [];
  if (input.unknownIdentity)
    warnings.push({ code: "historical_identity_unknown", count: input.unknownIdentity, message: "部分调用没有可证明的计费供应商或模型身份。" });
  if (input.unknownOwner)
    warnings.push({ code: "historical_owner_unknown", count: input.unknownOwner, message: "部分历史调用没有可靠的用户或执行者归属。" });
  if (input.unknownSkill)
    warnings.push({ code: "historical_skill_unknown", count: input.unknownSkill, message: "部分历史模型步骤早于 Skill 成本上下文记录，不能反推当时激活范围。" });
  if (input.wanConflict)
    warnings.push({ code: "wan_cost_conflict", count: input.wanConflict, message: "部分万相任务的终态用量或价格证据不一致，费用保持未知。" });
  if (input.unknownFee)
    warnings.push({ code: "unknown_fee_evidence", count: input.unknownFee, message: "部分外发调用缺少可复算的用量或价格证据，未知费用没有按零计算。" });
  if (input.shared)
    warnings.push({ code: "shared_skill_steps", count: input.shared, message: "多 Skill 共同步骤只计一次；按单个 Skill 相加会重复，因此标记为不可加总。" });
  if (input.facetsTruncated)
    warnings.push({ code: "facets_truncated", count: 1, message: "候选项过多，列表只显示前 50 项；可使用精确 ID 继续筛选。" });
  if (input.catalogUnavailable)
    warnings.push({ code: "skills_catalog_unavailable", count: 1, message: "技能目录读取或校验失败，技能候选项已降级为空；费用、服务商、模型统计和调用明细仍可使用。" });
  return warnings;
}

function filtersDto(q: Query, user: FilterState) {
  return {
    billingProvider: q.billingProvider ?? null,
    service: q.service ?? null,
    operation: q.operation ?? null,
    model: q.model ?? null,
    modelMissing: q.modelMissing ?? null,
    skillId: q.skillId ?? null,
    moduleId: q.moduleId ?? null,
    userId: user.userId,
    username: q.username ?? null,
    owner: q.owner ?? null,
    origin: q.origin ?? null,
    environment: q.environment ?? null,
    status: q.status ?? null,
    costBasis: q.costBasis ?? null,
  };
}

async function costDetails(q: Query, options: CostReadOptions): Promise<CostDetailsResponse> {
  return withCostRead(async (tx) => {
    const user = await resolveUser(tx, q);
    const condition = scopeConditions(q, user);
    let cursorCondition = sql`TRUE`;
    const binding = queryBinding({ ...q, cursor: null, view: "details" });
    if (q.cursor) {
      const c = decodeCursor<{ s?: unknown; i?: unknown; b?: unknown }>("cd1", q.cursor);
      if (
        c.b !== binding ||
        !Number.isSafeInteger(c.s) ||
        !Number.isSafeInteger(c.i) ||
        Number(c.s) < 0 ||
        Number(c.i) <= 0
      )
        throw new InvalidCursorError("cursor does not match these filters");
      const started = new Date(Number(c.s));
      cursorCondition = sql`(b.started_at,b.id)<(${started},${Number(c.i)})`;
    }
    const rows = await tx<DetailDbRow[]>`
      WITH base AS (${baseSql(q)}),
      scoped AS (SELECT b.* FROM base b WHERE ${condition} AND ${cursorCondition})
      SELECT id,receipt_id,attempt,operation_run_id,started_at,finished_at,latency_ms,origin,environment,status,
        billing_provider,upstream_provider,service,operation,model,identity_source,request_id,owner_user_id,owner_kind,
        cost::text AS cost,currency,cost_basis,usage,price_snapshot,wan_cost_state,wan_fee_applicable
      FROM scoped b
      ORDER BY b.started_at DESC,b.id DESC
      LIMIT ${q.limit + 1}
    `;
    const page = rows.slice(0, q.limit);
    const userIds = [...new Set(page.flatMap((row) => row.owner_user_id === null ? [] : [row.owner_user_id]))];
    const runIds = [...new Set(page.flatMap((row) => row.operation_run_id === null ? [] : [row.operation_run_id]))];
    const receiptIds = [...new Set(page.map((row) => row.receipt_id))];
    const users = userIds.length
      ? await tx<{ id: number; username: string; display_name: string }[]>`
          SELECT id,username,display_name FROM site_users WHERE id IN ${tx(userIds)}
        `
      : [];
    const modelLinks = receiptIds.length
      ? await tx<DetailLinkRow[]>`
          SELECT st.parent_operation_run_id AS run_id,sm.receipt_id,'model'::text AS link_kind,
            st.id AS turn_id,st.session_id,sm.id AS model_step_id,sm.cost_context_version,
            sa.id AS activation_id,sa.candidate,su.owner_user_id AS session_owner_user_id
          FROM assistant_model_steps sm
          JOIN assistant_turns st ON st.id=sm.turn_id
          JOIN assistant_sessions su ON su.id=st.session_id
          LEFT JOIN assistant_model_step_activations sma ON sma.model_step_id=sm.id
          LEFT JOIN assistant_activations sa ON sa.id=sma.activation_id AND sa.turn_id=st.id
          WHERE sm.receipt_id IN ${tx(receiptIds)}
        `
      : [];
    const searchLinks = runIds.length
      ? await tx<DetailLinkRow[]>`
          SELECT tc.child_run_id AS run_id,NULL::bigint AS receipt_id,'search'::text AS link_kind,
            t.id AS turn_id,t.session_id,tc.model_step_id,sm.cost_context_version,
            sa.id AS activation_id,sa.candidate,su.owner_user_id AS session_owner_user_id
          FROM assistant_tool_calls tc
          JOIN assistant_turns t ON t.id=tc.turn_id
          JOIN assistant_sessions su ON su.id=t.session_id
          JOIN assistant_model_steps sm ON sm.id=tc.model_step_id
          LEFT JOIN assistant_activations sa
            ON sa.id::text=COALESCE(tc.activation_id::text,tc.input->>'activationId')
            AND sa.turn_id=t.id
          WHERE tc.child_run_id IN ${tx(runIds)}
        `
      : [];
    const userMap = new Map(users.map((row) => [row.id, row]));
    const modelLinksByReceipt = new Map<number, DetailLinkRow[]>();
    for (const link of modelLinks) {
      if (link.receipt_id === null) continue;
      modelLinksByReceipt.set(link.receipt_id, [...(modelLinksByReceipt.get(link.receipt_id) ?? []), link]);
    }
    const searchLinksByRun = new Map<number, DetailLinkRow[]>();
    for (const link of searchLinks) {
      searchLinksByRun.set(link.run_id, [...(searchLinksByRun.get(link.run_id) ?? []), link]);
    }
    const details = page.map((row) => {
      const receiptModels = modelLinksByReceipt.get(row.receipt_id) ?? [];
      const modelAssociation =
        row.operation_run_id === null
          ? new Set(receiptModels.map((link) => link.run_id)).size === 1
            ? receiptModels
            : []
          : receiptModels.filter((link) => link.run_id === row.operation_run_id);
      const association = [
        ...modelAssociation,
        ...(row.operation_run_id === null ? [] : searchLinksByRun.get(row.operation_run_id) ?? []),
      ];
      return detailRow(row, association, userMap);
    });
    const last = page.at(-1);
    const nextCursor =
      rows.length > q.limit && last
        ? encodeCursor("cd1", { s: last.started_at.getTime(), i: last.id, b: binding })
        : null;
    return {
      view: "details",
      asOf: new Date().toISOString(),
      query: { start: q.start, end: q.end, view: "details", groupBy: null, timeBasis: "attempt_started_at" },
      filters: filtersDto(q, user),
      selectedUser: user.selectedUser
        ? { id: user.selectedUser.id, username: user.selectedUser.username, displayName: user.selectedUser.display_name }
        : null,
      rows: details,
      nextCursor,
      warnings: pageWarnings(details),
    };
  }, options);
}

interface DetailLinkRow {
  run_id: number;
  receipt_id: number | null;
  link_kind: "model" | "search";
  turn_id: string;
  session_id: string;
  model_step_id: string;
  cost_context_version: number | null;
  activation_id: string | null;
  candidate: Record<string, unknown> | null;
  session_owner_user_id: number;
}

function detailRow(
  row: DetailDbRow,
  links: DetailLinkRow[],
  users: Map<number, { id: number; username: string; display_name: string }>,
) {
  const activations = new Map<string, CostActivationDetail>();
  for (const link of links) {
    if (!link.activation_id || !link.candidate) continue;
    const skillId = String(link.candidate.skillId ?? "");
    const moduleId = String(link.candidate.moduleId ?? "");
    if (!skillId || !moduleId) continue;
    activations.set(link.activation_id, {
      activationId: link.activation_id,
      skillId,
      moduleId,
      version: typeof link.candidate.moduleVersion === "string" ? link.candidate.moduleVersion : null,
      label:
        typeof link.candidate.description === "string"
          ? link.candidate.description
          : skillId,
    });
  }
  const activationList = [...activations.values()];
  // The base CTE is the sole owner authority, including conflicting and explicit non-member outcomes.
  const ownerUserId = row.owner_user_id;
  const ownerKind: CostOwnerKind | null = row.owner_kind;
  const user = ownerUserId === null ? null : users.get(ownerUserId);
  const attribution: CostSkillAttribution =
    activationList.length > 1
      ? "multi_skill"
      : activationList.length === 1
        ? "activated"
        : links.length === 0
          ? "not_applicable"
          : links.some((link) => link.link_kind === "model" && link.cost_context_version === 1)
            ? "not_activated"
            : "historical_unknown";
  const usage = row.usage ?? {};
  const snapshot = row.price_snapshot ?? {};
  const feeApplicable =
    row.service !== "aliyun.wan.poll" &&
    (row.service !== "aliyun.wan.video" || row.wan_fee_applicable);
  const costReason =
    !feeApplicable
      ? row.service === "aliyun.wan.poll"
        ? "万相轮询费用归生成任务"
        : "同一万相任务已由更早提交的费用项承接"
      : row.cost === null
        ? row.wan_cost_state === "conflict"
          ? "万相任务终态用量或价格证据冲突"
          : row.wan_cost_state === "awaiting"
            ? "万相任务尚未形成可用的终态费用证据"
            : snapshot.state === "unavailable"
          ? `价格快照不可用：${String(snapshot.reason ?? "unknown")}`
          : "缺少可复算的价格或用量证据"
        : null;
  const estimateBasis: CostEstimateBasis | null =
    !feeApplicable || row.cost_basis !== "estimated" || row.cost === null
      ? null
      : row.service.startsWith("aliyun.wan.") ||
          (snapshot.state === "ready" &&
            ((usage.wanTask as Record<string, unknown> | undefined)?.priceSnapshot as Record<string, unknown> | undefined)
              ?.basis === "documented-estimate")
        ? "documented_special_rate"
        : snapshot.state === "ready" && snapshot.perRequest != null
          ? "fixed_rate"
          : snapshot.state === "ready" &&
              numericUsage(usage.prompt_cache_hit_tokens) !== null &&
              numericUsage(usage.prompt_cache_miss_tokens) !== null
            ? "cache_split"
            : snapshot.state === "ready" && snapshot.inputPerMtok != null
              ? "standard_input_without_cache_breakdown"
              : null;
  const warnings: string[] = [];
  if (row.identity_source === "legacy_mapping") warnings.push("历史身份为保守映射，不能证明计费供应商");
  if (!ownerKind) warnings.push("历史归属未知");
  if (attribution === "historical_unknown") warnings.push("历史 Skill 上下文未知");
  if (attribution === "multi_skill") warnings.push("多个 Skill 共享此调用，不可按单个 Skill 分摊");
  if (!feeApplicable && usage.wanTask) warnings.push("轮询调用保留，但费用已锚定生成任务");
  if (row.wan_cost_state === "conflict") warnings.push("万相任务费用证据冲突，未知费用没有按零计算");
  return {
    attemptId: row.id,
    receiptId: row.receipt_id,
    attempt: row.attempt,
    runId: row.operation_run_id,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    latencyMs: row.latency_ms,
    origin: row.origin as CostDetailRow["origin"],
    environment: row.environment,
    status: row.status as CostDetailRow["status"],
    billingProvider: row.billing_provider ?? "unknown",
    upstreamProvider: row.upstream_provider,
    service: row.service,
    operation: row.operation,
    model: row.model,
    identitySource: row.identity_source as CostDetailRow["identitySource"],
    providerRequestId: row.request_id,
    owner: {
      kind: ownerKind,
      userId: ownerUserId,
      username: user?.username ?? null,
      displayName: user?.display_name ?? null,
    },
    assistant: {
      sessionId: links[0]?.session_id ?? null,
      turnId: links[0]?.turn_id ?? null,
      modelStepId: links[0]?.model_step_id ?? null,
      activations: activationList,
      attribution,
    },
    cost: {
      amount: feeApplicable ? row.cost : null,
      currency: feeApplicable ? row.currency : null,
      basis: feeApplicable ? row.cost_basis : null,
      estimateBasis,
      applicable: feeApplicable,
      reason: costReason,
    },
    usage: {
      inputTokens: numericUsage(usage.prompt_tokens),
      outputTokens: numericUsage(usage.completion_tokens),
      cachedTokens: numericUsage(usage.prompt_cache_hit_tokens),
      estimatedCredits: numericString(usage.estimatedCredits),
      chargedCredits: numericString(usage.chargedCredits),
      outputSeconds: numericString(usage.video_duration) ?? numericString((usage.wanTask as Record<string, unknown> | undefined)?.outputSeconds),
    },
    priceSnapshot: {
      state:
        snapshot.state === "ready"
          ? "ready"
          : snapshot.state === "unavailable"
            ? "unavailable"
            : "none",
      reason: typeof snapshot.reason === "string" ? snapshot.reason : null,
      selectedAt: typeof snapshot.selectedAt === "string" ? snapshot.selectedAt : null,
      sourceUrl: typeof snapshot.sourceUrl === "string" ? snapshot.sourceUrl : null,
      verifiedOn: typeof snapshot.verifiedOn === "string" ? snapshot.verifiedOn : null,
    },
    warnings,
  } satisfies CostDetailRow;
}

function numericUsage(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function numericString(value: unknown): string | null {
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function pageWarnings(rows: CostDetailRow[]): CostWarning[] {
  const count = (code: CostWarning["code"]) =>
    rows.filter((row) =>
      code === "historical_identity_unknown"
        ? row.identitySource === "legacy_mapping"
        : code === "historical_owner_unknown"
          ? row.owner.kind === null
          : code === "historical_skill_unknown"
            ? row.assistant.attribution === "historical_unknown"
            : code === "shared_skill_steps"
              ? row.assistant.attribution === "multi_skill"
              : false,
    ).length;
  return [
    ["historical_identity_unknown", "当前页含保守映射的历史身份。"],
    ["historical_owner_unknown", "当前页含无法证明归属的历史调用。"],
    ["historical_skill_unknown", "当前页含无法反推当时 Skill 范围的历史步骤。"],
    ["shared_skill_steps", "当前页含多个 Skill 共享的调用，不可按单个 Skill 相加。"],
  ].flatMap(([code, message]) => {
    const n = count(code as CostWarning["code"]);
    return n ? [{ code: code as CostWarning["code"], count: n, message }] : [];
  });
}
