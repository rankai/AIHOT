import type { PrivateAsset } from "./image-types";
export type VideoRole = "first_frame" | "last_frame" | "reference_image";
export interface VideoOptions {
  modelLabel: string; aspectRatios: string[]; resolutions: string[]; durationSeconds: { min: number; max: number };
  roles: Record<VideoRole, number>; maxReferenceRoles: number; referenceFormats: string[];
  referenceBytes: number; referencePixels: number; referenceFrames: number;
  outputVideoBytes: number; outputImageBytes: number; outputImagePixels: number;
  limits: { steps: number; polls: number; retries: number; pollDeadlineSeconds: number; externalAttempts: number; saveAttempts: number; downloadTimeoutMs: number; pollIntervalSeconds: number; maxPollIntervalSeconds: number };
  services: { referenceUpload: string; submission: string; poll: string }; documentedBaseCny: number; pollBaseCny: number;
  priceBasis: string; billingUnitVerified: boolean; uploadTransportVerified: boolean; referenceReuseHint: string;
}
export interface VideoReferenceRow { id: number; fileKey: string; role: VideoRole }
export interface VideoReferences { selected: PrivateAsset[]; roles: VideoReferenceRow[]; confirmedUploads: Record<string, number> }
export interface VideoDraft extends VideoReferences { prompt: string; aspectRatio: string; duration: number; resolution: string; generateAudio: boolean; returnLastFrame: boolean }
export interface VideoPlan { referenceUploadLimit: number; submissionLimit: number; pollLimit: number; pollDeadlineSeconds: number; submissionCost: null }
