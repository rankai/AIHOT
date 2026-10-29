/** Integer trial credits. No monetary exchange rate is implied. */
export type ToolCreditKind = "query" | "x-account" | "x-tweet" | "images" | "videos" | "ai-search" | "transcriptions" | "xhs-comments" | "media-upload"
  | "images/query" | "videos/query" | "ai-search/query" | "transcriptions/query" | "xhs-comments/query";

/** Constructed from validated tool input by the server, never accepted as a client price. */
export interface ToolCreditIntent {
  kind: ToolCreditKind;
  provider: string;
  model?: string;
  tier?: string;
  input: Record<string, unknown>;
  imageCount?: number;
  videoSeconds?: number;
  referenceCount?: number;
  recoveryRunId?: number;
}

export interface ToolAuthorization { quoteId: string; intent: ToolCreditIntent }
export interface ToolPrice {
  id: string;
  kind: ToolCreditKind;
  provider: string;
  model: string;
  tier: string;
  /** Exact scalar matches against dot-separated paths in the normalized tool input. */
  parameterMatch: Record<string, string | number | boolean>;
  baseCredits: number;
  imageCredits: number;
  videoSecondCredits: number;
  referenceCredits: number;
  enabled: boolean;
  version: number;
  updatedAt: string;
}
export interface ToolPriceInput extends Omit<ToolPrice, "id" | "version" | "updatedAt"> {
  id?: string;
  expectedVersion?: number;
  reason: string;
}
export interface ToolQuote {
  quoteId: string;
  amount: number;
  expiresAt: string;
  priceVersion: number;
  priceId: string | null;
  available: number;
  affordable: boolean;
  recoveryOfRunId: number | null;
}
export interface CreditBalance { userId: number; available: number; reserved: number }
export type CreditEntryKind = "grant" | "adjustment" | "reserve" | "consume" | "release";
export interface CreditEntry {
  id: number;
  kind: CreditEntryKind;
  amount: number;
  availableDelta: number;
  reservedDelta: number;
  availableAfter: number;
  reservedAfter: number;
  runId: number | null;
  reason: string;
  createdAt: string;
}
export interface CreditPage { balance: CreditBalance; entries: CreditEntry[]; nextCursor: number | null }
export type CreditChargeState = "reserved" | "review" | "settled" | "released";
export interface CreditCharge {
  id: string;
  userId: number;
  username: string;
  displayName: string;
  runId: number;
  recoveryRunId: number | null;
  kind: ToolCreditKind;
  provider: string;
  model: string;
  tier: string;
  amount: number;
  consumed: number;
  released: number;
  state: CreditChargeState;
  reviewReason: string | null;
  runStatus: string;
  createdAt: string;
  updatedAt: string;
}
export interface CreditChargePage { charges: CreditCharge[]; nextCursor: string | null }
