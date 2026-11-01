export type CostView = "overview" | "details";
export type CostGroupBy = "provider" | "service" | "model" | "skill" | "user";
export type CostOrigin = "live" | "replay" | "imported";
export type CostEnvironment = "production" | "development" | "test" | "other" | "unknown";
export type CostAttemptStatus = "pending" | "received" | "failed" | "unknown";
export type CostBasis = "actual" | "estimated";
export type CostEstimateBasis =
  | "fixed_rate"
  | "cache_split"
  | "standard_input_without_cache_breakdown"
  | "documented_special_rate";
export type CostOwnerKind = "member" | "admin" | "system" | "unassigned";
export type CostIdentitySource = "explicit" | "legacy_mapping" | "unknown";
export type CostSkillAttribution =
  | "activated"
  | "multi_skill"
  | "not_activated"
  | "historical_unknown"
  | "not_applicable";

export interface CostQuery {
  start: string;
  end: string;
  view: CostView;
  groupBy: CostGroupBy | null;
  timeBasis: "attempt_started_at";
}

export interface CostFilters {
  billingProvider: string | null;
  service: string | null;
  operation: string | null;
  model: string | null;
  skillId: string | null;
  moduleId: string | null;
  userId: number | null;
  username: string | null;
  owner: CostOwnerKind | null;
  origin: CostOrigin | null;
  environment: CostEnvironment | null;
  status: CostAttemptStatus | null;
  costBasis: CostBasis | null;
  modelMissing: boolean | null;
}

export interface CostStatusCounts {
  pending: number;
  received: number;
  failed: number;
  unknown: number;
}

export interface CostUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCredits: string | null;
  chargedCredits: string | null;
  outputSeconds: string | null;
  knownTokenRows: number;
  missingUsageRows: number;
}

export interface CostAmountBucket {
  origin: CostOrigin;
  environment: CostEnvironment;
  currency: string;
  costBasis: CostBasis | null;
  amount: string;
  records: number;
}

export interface CostTotals {
  attempts: number;
  logicalRequests: number;
  feeItems: number;
  statusCounts: CostStatusCounts;
  usage: CostUsageTotals;
  amountBuckets: CostAmountBucket[];
  knownCostItems: number;
  unknownCostItems: number;
  actualCostItems: number;
  estimatedCostItems: number;
  sharedFeeItems: number;
}

export interface CostSkillIdentity {
  skillId: string;
  moduleId: string;
  version: string | null;
  label: string;
}

export interface CostGroup {
  key: string;
  groupBy: CostGroupBy;
  billingProvider: string | null;
  upstreamProvider: string | null;
  service: string | null;
  operation: string | null;
  model: string | null;
  skill: CostSkillIdentity | null;
  userId: number | null;
  username: string | null;
  displayName: string | null;
  ownerKind: CostOwnerKind | null;
  additive: boolean;
  totals: CostTotals;
}

export interface CostFacet {
  value: string;
  label: string;
  count: number;
}

export interface CostFacets {
  providers: CostFacet[];
  services: CostFacet[];
  models: CostFacet[];
  skills: CostFacet[];
  truncated: boolean;
}

export interface CostWarning {
  code:
    | "historical_identity_unknown"
    | "historical_owner_unknown"
    | "historical_skill_unknown"
    | "shared_skill_steps"
    | "wan_cost_conflict"
    | "unknown_fee_evidence"
    | "facets_truncated"
    | "skills_catalog_unavailable";
  count: number;
  message: string;
}

export interface CostOverviewResponse {
  view: "overview";
  asOf: string;
  query: CostQuery;
  filters: CostFilters;
  selectedUser: { id: number; username: string; displayName: string } | null;
  totals: CostTotals;
  groups: CostGroup[];
  nextGroupCursor: string | null;
  facets: CostFacets;
  warnings: CostWarning[];
}

export interface CostActivationDetail extends CostSkillIdentity {
  activationId: string;
}

export interface CostDetailRow {
  attemptId: number;
  receiptId: number;
  attempt: number;
  runId: number | null;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  origin: CostOrigin;
  environment: CostEnvironment;
  status: CostAttemptStatus;
  billingProvider: string;
  upstreamProvider: string | null;
  service: string;
  operation: string;
  model: string | null;
  identitySource: CostIdentitySource;
  providerRequestId: string | null;
  owner: {
    kind: CostOwnerKind | null;
    userId: number | null;
    username: string | null;
    displayName: string | null;
  };
  assistant: {
    sessionId: string | null;
    turnId: string | null;
    modelStepId: string | null;
    activations: CostActivationDetail[];
    attribution: CostSkillAttribution;
  };
  cost: {
    amount: string | null;
    currency: string | null;
    basis: CostBasis | null;
    estimateBasis: CostEstimateBasis | null;
    applicable: boolean;
    reason: string | null;
  };
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cachedTokens: number | null;
    estimatedCredits: string | null;
    chargedCredits: string | null;
    outputSeconds: string | null;
  };
  priceSnapshot: {
    state: "ready" | "unavailable" | "none";
    reason: string | null;
    selectedAt: string | null;
    sourceUrl: string | null;
    verifiedOn: string | null;
  };
  warnings: string[];
}

export interface CostDetailsResponse {
  view: "details";
  asOf: string;
  query: CostQuery;
  filters: CostFilters;
  selectedUser: { id: number; username: string; displayName: string } | null;
  rows: CostDetailRow[];
  nextCursor: string | null;
  warnings: CostWarning[];
}

export type CostResponse = CostOverviewResponse | CostDetailsResponse;
