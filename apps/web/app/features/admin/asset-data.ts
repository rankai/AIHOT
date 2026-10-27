import type { AssetKind, AssetUploadOptions } from "./asset-types.ts";
import type { PrivateAsset } from "./image-types.ts";
import type { OperationFile } from "./operation-types.ts";

export const assetKindLabels: Record<AssetKind | "text", string> = { image: "图片", audio: "音频", video: "视频", text: "文本附件" };
export function assetKind(asset: Pick<PrivateAsset, "content_type" | "metadata">): AssetKind | "text" | null {
  if (["image", "audio", "video", "text"].includes(asset.metadata.kind ?? "")) return asset.metadata.kind!;
  if (["text/plain", "text/vtt", "application/x-subrip", "application/json"].includes(asset.content_type.split(";")[0]!.trim())) return "text";
  return asset.content_type.startsWith("image/") ? "image" : asset.content_type.startsWith("audio/") ? "audio" : asset.content_type.startsWith("video/") ? "video" : null;
}
export function assetUploadAccept(options: AssetUploadOptions): string {
  return [...new Set(options.formats.flatMap(format => [...format.extensions.map(ext => `.${ext}`), format.mime]))].join(",");
}
export function assetUploadFormat(filename: string, options: AssetUploadOptions) {
  const ext = filename.includes(".") ? filename.split(".").at(-1)!.toLowerCase() : "";
  return options.formats.find(format => format.extensions.some(extension => extension.toLowerCase() === ext)) ?? null;
}
export function assetUploadIssue(file: Pick<File, "name" | "size">, options: AssetUploadOptions): string | null {
  const format = assetUploadFormat(file.name, options);
  if (!format) return "此扩展名不在本地上传支持列表中；文件已保留，请重新选择受支持的格式。";
  const limit = options.limits[`${format.kind}Bytes`];
  if (file.size > limit) return `${assetKindLabels[format.kind]}不能超过 ${limit / 1_000_000} MB（${limit} 字节）；文件已保留。`;
  if (file.size === 0) return "不能上传空文件；请重新选择。";
  return null;
}
// Stable wrapping preserves multipart retry identity; separate original File objects stay distinct.
const declaredFiles = new WeakMap<File, Map<string, File>>();
export function assetUploadFile(file: File, options: AssetUploadOptions): File {
  const issue = assetUploadIssue(file, options);
  if (issue) throw new Error(issue);
  const mime = assetUploadFormat(file.name, options)!.mime;
  if (file.type === mime) return file;
  let declarations = declaredFiles.get(file);
  if (!declarations) { declarations = new Map(); declaredFiles.set(file, declarations); }
  let declared = declarations.get(mime);
  if (!declared) { declared = new File([file], file.name, { type: mime, lastModified: file.lastModified }); declarations.set(mime, declared); }
  return declared;
}
/** A delayed available-page response cannot revive a known immutable deletion. */
export function mergeAssetRows(previous: readonly PrivateAsset[], incoming: readonly PrivateAsset[]): PrivateAsset[] {
  const rows = new Map(previous.map(asset => [asset.key, asset]));
  for (const asset of incoming) {
    const current = rows.get(asset.key);
    if (current?.status === "deleted" && asset.status !== "deleted" || current?.status === "deleting" && asset.status === "available") continue;
    rows.set(asset.key, asset);
  }
  return [...rows.values()];
}
export function operationFileAsset(file: OperationFile | null): PrivateAsset | null {
  return file ? { key: file.key, content_type: file.contentType, bytes: file.bytes, purpose: "operation-output", status: file.status, metadata: { filename: file.filename, width: file.width, height: file.height } } : null;
}
