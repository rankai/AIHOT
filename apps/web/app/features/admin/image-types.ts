export type ImageModel = "gptImage2" | "gptImage25" | "geminiBanana21" | "seedreamPro" | "seedreamLite";
export interface ImageModelOption {
  model: ImageModel; label: string; maxReferences: number; maxImages?: number; maxOutputImages?: number;
  resolutions?: string[]; sizes?: string[]; background?: string[]; referenceLimitBasis?: string;
  customSize?: boolean; customPixelMinimum?: number; customPixelMaximum?: number; customPixelLimitBasis?: string; ratioRange?: number[];
  documentedBaseCny?: number; responseFormat?: "url"; outputFormats?: string[]; optimizePromptModes?: string[];
  watermark?: boolean; sequentialModes?: string[]; maxImagesRange?: number[];
}
export interface ImageReferenceUpload { fileKey: string; resultId: number }
export interface ImageDraft {
  prompt: string; resolution: string; size: string; customSize: string; n: number; transparent: boolean;
  outputFormat: string; watermark: boolean; optimizeMode: string; sequentialMode: string; maxImages: number;
  selected: PrivateAsset[]; referenceUploads: ImageReferenceUpload[];
}
export interface ImageOptions {
  models: ImageModelOption[]; newModelLimits: { polls: number; pollDeadlineSeconds: number; steps: number; saveAttempts: number }; priceBasis: string; billingUnitVerified: boolean; referenceReuseHint: string;
  modelLabel: string; resolutions: string[]; sizes: string[]; maxImages: number; maxReferences: number;
  referenceBytes: number; referencePixels: number; outputBytes: number; outputPixels: number;
  pollLimit: number; pollDeadlineSeconds: number; uploadTransportVerified: boolean;
  services: { referenceUpload: string; submission: string; poll: string }; submissionCost: null;
}
export interface PrivateAsset {
  key: string; content_type: string; bytes: number; purpose: string; status: string;
  metadata: { filename: string; kind?: "image" | "audio" | "video" | "text"; width?: number | null; height?: number | null; pages?: number; validation?: string };
}
export interface AssetPage { items: PrivateAsset[]; nextCursor: string | null }
export function assetContentUrl(key: string) { return `/api/admin/assets/${encodeURIComponent(key)}/content`; }
export function referenceImage(asset: PrivateAsset): asset is PrivateAsset & { metadata: { filename: string; width: number; height: number } } {
  return (!asset.metadata.kind || asset.metadata.kind === "image") && ["image/png", "image/jpeg", "image/webp"].includes(asset.content_type) && validImageDimension(asset.metadata.width) && validImageDimension(asset.metadata.height) && (asset.metadata.pages === undefined || asset.metadata.pages === 1);
}
export function validImageDimension(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
export function referenceIssue(asset: PrivateAsset, options: Pick<ImageOptions, "referenceBytes" | "referencePixels">) {
  if (asset.status !== "available") return asset.status === "deleted" ? "此素材已删除" : "此素材暂不可用";
  if (asset.metadata.kind && asset.metadata.kind !== "image" || !["image/png", "image/jpeg", "image/webp"].includes(asset.content_type)) return "参考素材须为 PNG、JPEG 或 WebP 图片";
  if (!validImageDimension(asset.metadata.width) || !validImageDimension(asset.metadata.height)) return "参考图片缺少有效的正整数宽高";
  if (asset.metadata.pages !== undefined && asset.metadata.pages !== 1) return "参考图片仅支持单帧";
  if (asset.bytes > options.referenceBytes) return `此图片超过参考素材的 ${options.referenceBytes / 1_000_000} MB 限制，不会自动压缩`;
  if (asset.metadata.width * asset.metadata.height > options.referencePixels) return `此图片超过参考素材的 ${options.referencePixels / 1_000_000} MP 限制，不会自动缩小`;
  return null;
}
export function assetSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`; }

/** Terminal runs clear current progress; retained image task results keep the provider identity. */
export function imageTaskId(operation: { progress: Record<string, unknown>; inputs: { parameters?: Record<string, unknown> }; results: Array<{ kind: string; data: Record<string, unknown> }> }): string | null {
  if (typeof operation.progress.taskId === "string") return operation.progress.taskId;
  if (typeof operation.inputs.parameters?.taskId === "string") return operation.inputs.parameters.taskId;
  const result = operation.results.findLast(result => result.kind === "image_task" && typeof result.data.taskId === "string");
  return result ? result.data.taskId as string : null;
}
