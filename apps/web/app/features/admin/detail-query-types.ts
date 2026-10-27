import type { PlatformField } from "./platform-types.ts";
export interface DetailQueryChoice {
  operationId: string; label: string; parameters: Record<string, unknown>; fields: readonly PlatformField[];
  price: { amount: string | null; currency: string | null; basis: "estimated" }; purpose: "query";
}
export interface DetailQueryOptions { resultId: number; choices: DetailQueryChoice[]; reason?: string }
