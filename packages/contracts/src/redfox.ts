// HTTP descriptors for the Redfox query forms. Execution schemas remain owned by the backend.
export interface PlatformCollectionProviderPreflight {
  subscriptionId: number;
  editVersion: number;
  currentProvider: string;
  targetProvider: "redfox" | "agentkey";
  supported: boolean;
  checks: Array<{key: "operation" | "parameters" | "details" | "credentials" | "execution" | "videoDownload"; conclusion: "supported" | "unsupported" | "unavailable"; evidence: string}>;
  impact: {activeRunId: number | null; enabled: boolean; intervalMinutes: number; limits: {pages: number; items: number; details: number}; note: string};
}
export interface PlatformField {
  name: string;
  label: string;
  type: "string" | "integer" | "boolean" | "select" | "string-array" | "integer-array";
  required: boolean;
  default?: string | number | boolean;
  hint?: string;
  constraints?: { pattern?: string; maxLength?: number; min?: number; max?: number; step?: number };
  options?: readonly { value: string; label: string }[];
}
export interface PlatformCollectionProvider {
  operationLabel?: string;
  id: string;
  label: string;
  fields?: readonly PlatformField[];
  purpose?: string;
  collectionPrice?: PlatformOperationDescriptor["collectionPrice"];
  collectionCapabilities?: PlatformOperationDescriptor["collectionCapabilities"];
}
export interface PlatformOperationDescriptor {
  id: string;
  platform: string;
  label: string;
  fields: readonly PlatformField[];
  purpose: string;
  collectionPrice?: { amount:number|null;currency:string;basis:"estimated" } | null;
  collectionProviders?: readonly PlatformCollectionProvider[];
  /** One-off query variants when they differ from the schedulable providers. */
  queryProviders?: readonly PlatformCollectionProvider[];
  collectionCapabilities?: { sourceRequired?:boolean; detailEnrichment:boolean; detailOperations?: readonly {operationId:string;label:string;fields:readonly PlatformField[];price:{amount:number|null;currency:string;basis:"estimated"}|null}[] };
  schedulableType: null | "search" | "trend" | "list";
}
