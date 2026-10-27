export interface XhsCommentOptions {
  platform: "xiaohongshu"; library: "wide"; defaultDataNum: number; allDataNum: -1; dataNumMax: number; dataNumMaxBasis: string; idMaxLength: number;
  services: { submission: string; poll: string };
  billing: { unitComments: number; documentedBaseCny: number; submissionCost: null; basis: string };
  limits: { steps: number; polls: number; retries: number; pollDeadlineSeconds: number; externalAttempts: number; firstPollDelaySeconds: number; pollIntervalSeconds: number };
  queryPollDeadlineSeconds: number; deadlineBasis: string; firstPollBasis: string; resultKinds: string[];
}
export interface XhsCommentPlan { submissionLimit: 0 | 1; pollLimit: number; pollDeadlineSeconds: number; submissionCost: null }
export interface XhsCommentDrafts { submit: { opusId: string; quantityMode: "count" | "all"; dataNum: string }; query: { taskId: string } }
