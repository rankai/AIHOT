import { sql, type Db } from "../../db.ts";
import { AssetError, assetExpired, assetPath, type AssetRow } from "../../operations/assets.ts";
import { probeVideo } from "../../operations/video-probe.ts";
import { ownedToolAsset } from "../../users/tool-assets.ts";
import { WanInput } from "./wan-contract.ts";
export async function wanMedia(raw: unknown, actor: string, db: Db = sql) {
  const input = WanInput.parse(raw);
  const read = async (key: string) => {
    const [row] = /^user:/.test(actor) ? [await ownedToolAsset(actor, key, db)] : await db<AssetRow[]>`SELECT * FROM stored_files WHERE key=${key}`;
    if (!row || row.status !== "available" || assetExpired(row)) throw new AssetError(409, "素材已不可用");
    return row;
  };
  const portrait = await read(input.portraitFileKey), video = await read(input.referenceVideoFileKey);
  const { width = 0, height = 0, pages = 1 } = portrait.metadata;
  if (!["image/png", "image/jpeg", "image/webp"].includes(portrait.content_type) || Number(portrait.bytes) > 5_000_000 || pages !== 1 || width < 200 || height < 200 || width > 4096 || height > 4096 || width / height < 1 / 3 || width / height > 3) throw new AssetError(422, "人物照片需为单帧 PNG/JPEG/WebP，≤5MB、宽高200–4096、比例1:3至3:1");
  if (video.content_type !== "video/mp4" || Number(video.bytes) > 50_000_000) throw new AssetError(422, "参考视频需为≤50MB的MP4");
  const facts = await probeVideo(assetPath(video.key));
  if (facts.durationMs < 2000 || facts.durationMs > 30000 || facts.width < 200 || facts.height < 200 || facts.width > 2048 || facts.height > 2048 || facts.width / facts.height < 1 / 3 || facts.width / facts.height > 3) throw new AssetError(422, "参考视频需为2–30秒、宽高200–2048、比例1:3至3:1");
  return { input, facts, portraitHash: portrait.sha256, videoHash: video.sha256, videoSeconds: Math.ceil(facts.durationMs / 1000) };
}
