import type { AssetUploadOptions } from "./asset-types.ts";
import type { PrivateAsset } from "./image-types.ts";
export interface MediaUploadOptions extends AssetUploadOptions { operationId: string; service: string; transportVerified: boolean }
export function mediaUploadIssue(asset: PrivateAsset, options: MediaUploadOptions): string | null {
  if (asset.status !== "available") return "素材当前不可用，不能上传到供应商。";
  const format = options.formats.find(format => format.mime === asset.content_type);
  if (!format) return "此素材类型不在供应商通用上传支持列表中（例如 m4a 输出）；仍可本地使用或下载。";
  const limit = options.limits[`${format.kind}Bytes`];
  if (asset.bytes > limit) return `此${format.kind === "image" ? "图片" : format.kind === "audio" ? "音频" : "视频"}超过通用上传的 ${limit / 1_000_000} MB 限制。`;
  return null;
}
export function mediaUploadCommand(asset: PrivateAsset, options: MediaUploadOptions) {
  const issue = mediaUploadIssue(asset, options); if (issue) throw new Error(issue);
  return { path: "/api/admin/redfox/media/uploads", body: { fileKey: asset.key } };
}
