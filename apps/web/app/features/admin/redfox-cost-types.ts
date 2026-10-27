export interface RedfoxCostInterval { start: string; end: string }
export interface RedfoxCostInput extends RedfoxCostInterval { billRunId: string }
export interface RedfoxCostGroup {
  service: string; model: string | null; origin: string; base: string | null; environment: "production" | "other" | "unknown";
  currency: string | null; costBasis: "actual" | "estimated" | null; attempts: number; knownCost: string | null; unknownCostCount: number;
  statusCounts: { pending: number; received: number; failed: number; unknown: number };
}
export interface RedfoxBillPage {
  runId: number; receiptId: number; responseIdentity: string; queriedAt: string; receivedAt: string | null; parameters: Record<string, unknown>;
}
export interface RedfoxBillRecord { index: number; points: string; reason: string; reasonDesc: string; gmtCreate: string }
export interface RedfoxSelectedBill extends RedfoxBillPage {
  operationId: string; savedAt: string; base: string | null; environment: "production" | "other" | "unknown";
  count: number; total: string | number; pages: string | number; rawTimeRange: { min: string | null; max: string | null; timezone: null };
  records: RedfoxBillRecord[];
  summary: { signedPoints: string; knownApiConsumptionPoints: string; otherRecords: number; nominalCny: { amount: string; label: string; pointsPerCny: string; evidence: string; actualCost: false } };
}
export interface RedfoxCostsData {
  local: { interval: RedfoxCostInterval & { timeBasis: "attempt_started_at" }; groups: RedfoxCostGroup[] };
  billPages: RedfoxBillPage[]; selectedBill: RedfoxSelectedBill | null;
  comparison: { comparable: false; reasonCodes: string[] };
}
