import type { AssistantArtifact } from "@aihot/contracts/assistant";

/** A history read must never substitute another image or the latest version. */
export function exactImageFile(versions: AssistantArtifact[], target: { artifactId: string; version: number }): string {
  const image = versions.find((item) => item.artifactId === target.artifactId && item.version === target.version && item.kind === "image");
  if (typeof image?.content.fileKey !== "string" || !image.content.fileKey.trim()) throw new Error("image_version_unavailable");
  return image.content.fileKey;
}

export class ImageDownloadError extends Error {
  readonly status: number;
  constructor(status: number) { super("image_download_failed"); this.status = status; }
}

export async function imageDownloadBlob(fileKey: string, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const response = await fetch(`/api/tools/assets/${encodeURIComponent(fileKey)}/content`, {
    credentials: "same-origin", cache: "no-store", signal,
  });
  signal.throwIfAborted();
  if (!response.ok) throw new ImageDownloadError(response.status);
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("image/")) throw new ImageDownloadError(0);
  const blob = await response.blob();
  signal.throwIfAborted();
  if (!blob.size || !blob.type.toLowerCase().startsWith("image/")) throw new ImageDownloadError(0);
  return blob;
}
