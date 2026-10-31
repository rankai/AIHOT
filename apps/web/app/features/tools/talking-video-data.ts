import type { ToolAsset } from "@aihot/contracts/user-tools";
import { videoGenerationBody } from "../admin/video-data.ts";
import type { VideoOptions } from "../admin/video-types.ts";

export const TALKING_PORTRAIT_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface TalkingVideoDraft {
  dialogue: string;
  actionScript: string;
  portraitKey: string;
  uploadResultId?: number;
  productKey?: string;
  sceneKey?: string;
  referenceUploads?: Array<{ fileKey: string; resultId: number }>;
  aspectRatio: string;
  resolution: string;
  duration: number;
}

export function talkingVideoPrompt(dialogue: string, actionScript: string, references: { product?: boolean; scene?: boolean } = {}): string {
  if (!dialogue.trim()) throw new Error("请填写口播台词。");
  const images = ["参考图1为人物照片，保持人物外观和服饰，人物自然面对镜头。"];
  if (references.product) images.push("参考图2为产品照片，保持产品的外观、颜色和细节，让人物自然展示或介绍该产品。");
  if (references.scene) images.push(`参考图${references.product ? 3 : 2}为场景照片，参考其环境、布景与光线安排人物和画面。`);
  const prompt = `制作一段人物口播视频。${images.join("\n")}\n\n【口播台词】\n${dialogue.trim()}\n\n【动作脚本】\n${actionScript.trim() || "面对镜头自然讲述，表情和手势放松，镜头稳定。"}\n\n生成与台词匹配的人声，按照动作脚本安排表情、动作与镜头。`;
  if (prompt.length > 10000) throw new Error("台词与动作脚本合并后超过 10000 字符，请缩短后重试。");
  return prompt;
}

export function talkingVideoBody(draft: TalkingVideoDraft, assets: ToolAsset[], options: VideoOptions) {
  const portrait = assets.find(asset => asset.key === draft.portraitKey);
  if (!portrait || portrait.status !== "available" || !TALKING_PORTRAIT_TYPES.includes(portrait.contentType)) throw new Error("请选择一张可用的 PNG、JPEG 或 WebP 人物照片。");
  if (draft.uploadResultId !== undefined && (!Number.isSafeInteger(draft.uploadResultId) || draft.uploadResultId <= 0 || !portrait.uploads?.some(upload => upload.resultId === draft.uploadResultId))) throw new Error("请选择这张人物照片已有的上传记录，或使用本次上传。");
  const keys = [draft.portraitKey, draft.productKey, draft.sceneKey].filter((key): key is string => !!key);
  if (new Set(keys).size !== keys.length) throw new Error("人物、产品和场景请选择不同的参考图片。");
  const selected = keys.map(key => {
    const asset = assets.find(row => row.key === key);
    if (!asset || asset.status !== "available" || !TALKING_PORTRAIT_TYPES.includes(asset.contentType)) throw new Error("请选择可用的 PNG、JPEG 或 WebP 参考图片。");
    return asset;
  });
  const confirmedUploads: Record<string, number> = {};
  for (const upload of draft.referenceUploads ?? []) {
    const asset = selected.find(row => row.key === upload.fileKey);
    if (!asset || !Number.isSafeInteger(upload.resultId) || upload.resultId <= 0 || !asset.uploads?.some(row => row.resultId === upload.resultId)) throw new Error("请选择对应参考图片已有的上传记录，或使用本次上传。");
    confirmedUploads[upload.fileKey] = upload.resultId;
  }
  if (draft.uploadResultId !== undefined) confirmedUploads[portrait.key] = draft.uploadResultId;
  return videoGenerationBody({
    prompt: talkingVideoPrompt(draft.dialogue, draft.actionScript, { product: !!draft.productKey, scene: !!draft.sceneKey }),
    aspectRatio: draft.aspectRatio, resolution: draft.resolution, duration: draft.duration,
    generateAudio: true, returnLastFrame: false,
    selected: selected.map(asset => ({ key: asset.key, content_type: asset.contentType, bytes: asset.bytes, status: asset.status, purpose: "operation-input", metadata: { filename: asset.filename, width: asset.width, height: asset.height, kind: "image" } })),
    roles: selected.map((asset, id) => ({ id, fileKey: asset.key, role: "reference_image" })),
    confirmedUploads,
  }, options);
}
