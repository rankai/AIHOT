import type { Tx } from "../db.ts";
import {
  catalogPriceSnapshot,
  type PaidRequestOptions,
  type PriceRateRule,
  type PriceSnapshot,
} from "./receipts.ts";

const TIMEZONE = "Asia/Shanghai";
const RULE_ID = "deepseek-peak-off-peak-v1";
const EFFECTIVE_FROM = "2026-08-17T00:00:00+08:00";
const EFFECTIVE_FROM_MS = Date.parse(EFFECTIVE_FROM);
const RULE_SOURCE_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
const HOLIDAY_SOURCE_URL = "https://www.gov.cn/zhengce/content/202511/content_7047090.htm";
const HOLIDAY_VERIFIED_ON = "2026-10-31";
const PEAK_WINDOWS = [
  "Monday-Friday 09:00-12:00 Asia/Shanghai",
  "Monday-Friday 14:00-18:00 Asia/Shanghai",
];

/**
 * The published 2026 State Council holiday calendar. Weekends are off-peak regardless of
 * make-up workdays, so only weekday dates need to be present here.
 */
const HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-01-02",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20",
  "2026-02-23",
  "2026-04-06",
  "2026-05-01",
  "2026-05-04",
  "2026-05-05",
  "2026-06-19",
  "2026-09-25",
  "2026-10-01",
  "2026-10-02",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
]);
const COVERED_YEARS = [2026];

const shanghaiFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface DeepSeekRateSelection {
  selection: PriceRateRule["selection"];
  exact: boolean;
  multiplier: PriceRateRule["multiplier"];
  reason: string;
  date: string;
  minuteOfDay: number;
  coveredYear: boolean;
}

/** Pure, auditable selection for a specific instant. */
export function deepseekRateSelection(attemptTime: Date): DeepSeekRateSelection | null {
  if (!Number.isFinite(attemptTime.getTime()) || attemptTime.getTime() < EFFECTIVE_FROM_MS) return null;
  const parts = Object.fromEntries(
    shanghaiFormat.formatToParts(attemptTime).map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const year = Number(parts.year);
  const weekday = parts.weekday;
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const coveredYear = COVERED_YEARS.includes(year);
  const weekend = weekday === "Sat" || weekday === "Sun";
  const holiday = coveredYear && HOLIDAYS_2026.has(date);
  const inPeakWindow =
    (minuteOfDay >= 9 * 60 && minuteOfDay < 12 * 60) ||
    (minuteOfDay >= 14 * 60 && minuteOfDay < 18 * 60);

  if (weekend) {
    return { selection: "off_peak", exact: true, multiplier: "0.5", reason: "weekend", date, minuteOfDay, coveredYear };
  }
  if (holiday) {
    return { selection: "off_peak", exact: true, multiplier: "0.5", reason: "legal_holiday", date, minuteOfDay, coveredYear };
  }
  if (!inPeakWindow) {
    return { selection: "off_peak", exact: true, multiplier: "0.5", reason: "outside_peak_window", date, minuteOfDay, coveredYear };
  }
  if (!coveredYear) {
    // A missing future holiday calendar can turn a weekday peak into off-peak. Keep the standard
    // peak estimate and mark it conservative instead of understating cost.
    return { selection: "conservative_peak", exact: false, multiplier: "1", reason: "holiday_calendar_unavailable", date, minuteOfDay, coveredYear };
  }
  return { selection: "peak", exact: true, multiplier: "1", reason: "weekday_peak", date, minuteOfDay, coveredYear };
}

function halfFixed6(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  // PostgreSQL catalog rates have at most six fractional digits. Half-micro increments round up.
  const units = BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  const half = (units + 1n) / 2n;
  return `${half / 1_000_000n}.${String(half % 1_000_000n).padStart(6, "0")}`;
}

function rateRule(selection: DeepSeekRateSelection): PriceRateRule {
  return {
    version: 1,
    id: RULE_ID,
    timezone: TIMEZONE,
    effectiveFrom: EFFECTIVE_FROM,
    selection: selection.selection,
    exact: selection.exact,
    multiplier: selection.multiplier,
    peakWindows: PEAK_WINDOWS,
    reason: selection.reason,
    ruleSourceUrl: RULE_SOURCE_URL,
    holidayCalendar: {
      timezone: TIMEZONE,
      sourceUrl: HOLIDAY_SOURCE_URL,
      verifiedOn: HOLIDAY_VERIFIED_ON,
      coveredYears: COVERED_YEARS,
      completeForSelectedDate: selection.coveredYear,
    },
  };
}

/**
 * Select DeepSeek rates only when the caller supplied an exact official DeepSeek reporting identity.
 * Custom proxies fall back to the ordinary catalog snapshot and are never inferred from model names.
 */
export const resolveDeepSeekPriceSnapshot: NonNullable<PaidRequestOptions["resolvePriceSnapshot"]> = async (
  tx: Tx,
  { req, attemptTime },
): Promise<PriceSnapshot | null> => {
  const key = req.pricingKey ?? { service: req.service, model: req.model ?? "" };
  if (key.service !== "deepseek" || req.costIdentity?.billingProvider !== "deepseek") return null;
  const selection = deepseekRateSelection(attemptTime);
  const base = await catalogPriceSnapshot(tx, req, attemptTime);
  if (!selection || base.state !== "ready") return base;
  const adjusted =
    selection.multiplier === "0.5"
      ? {
          inputPerMtok: halfFixed6(base.inputPerMtok),
          cachedInputPerMtok: halfFixed6(base.cachedInputPerMtok),
          outputPerMtok: halfFixed6(base.outputPerMtok),
        }
      : {
          inputPerMtok: base.inputPerMtok,
          cachedInputPerMtok: base.cachedInputPerMtok,
          outputPerMtok: base.outputPerMtok,
        };
  return { ...base, ...adjusted, rateRule: rateRule(selection) };
};
