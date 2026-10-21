export type AiSearchMode = "submit" | "query";
export interface AiSearchPlan { submissionLimit: 0 | 1; pollLimit: number; pollDeadlineSeconds: number }
export interface AiSearchOptions {
  engines: Array<{ engine: string; label: string; submit: string; family: string; price: number }>;
  queries: Array<{ family: string; poll: string }>;
  currency: "CNY"; priceBasis: "estimated"; pollEstimatedCny: number;
  inquiryMaxCharacters: number;
  limits: { polls: number; pollDeadlineSeconds: number; steps: number; retries: number; externalAttempts: number; pollIntervalSeconds: number; maxPollIntervalSeconds: number };
  services: { submission: string; poll: string }; inputHint: string; resultPurpose: string;
}
