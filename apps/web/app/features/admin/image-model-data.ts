import { operationFileAsset } from "./asset-data.ts";
import type { OperationResult } from "./operation-types.ts";
import { researchFactText, researchObject } from "./research-platform-data.ts";
import { imageTaskId, referenceIssue, type ImageDraft, type ImageModel, type ImageModelOption, type ImageOptions, type PrivateAsset } from "./image-types.ts";
export function imageModelOption(options: ImageOptions, model: string) { return options.models.find(option => option.model === model); }
export function imageGenerationModels(options: ImageOptions) { return options.models.filter(option => option.generationAvailable !== false); }
export function imageModelDraft(option: ImageModelOption, options: ImageOptions): ImageDraft {
  return { prompt: "", resolution: (option.resolutions ?? options.resolutions)[0] ?? "", size: (option.sizes ?? options.sizes)[0] ?? "", customSize: "", n: 1, transparent: false, outputFormat: option.outputFormats?.includes("jpeg") ? "jpeg" : option.outputFormats?.[0] ?? "png", watermark: option.watermark === true, optimizeMode: option.optimizePromptModes?.[0] ?? "standard", sequentialMode: option.sequentialModes?.includes("disabled") ? "disabled" : option.sequentialModes?.[0] ?? "disabled", maxImages: option.maxImagesRange ? Math.min(option.maxImagesRange[1]!, Math.max(option.maxImagesRange[0]!, 4)) : 1, selected: [], referenceUploads: [] };
}
export function imageSizeIssue(size: string, option: ImageModelOption): string | null {
  if (option.sizes?.includes(size)) return null;
  if (!option.customSize) return "请选择所选模型支持的画面比例。";
  const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(size);
  if (!match) return "自定义尺寸请填写正整数宽x高，例如 1920x1920。";
  const width = Number(match[1]), height = Number(match[2]), pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !Number.isSafeInteger(pixels)) return "尺寸数值超出可精确处理的范围。";
  const [minimumRatio, maximumRatio] = option.ratioRange ?? [1 / 16, 16];
  if (width / height < minimumRatio! || width / height > maximumRatio!) return "画面宽高比须在 1:16–16:1 内。";
  if (option.customPixelMaximum !== undefined && pixels > option.customPixelMaximum) return `总像素不能超过 ${option.customPixelMaximum}。`;
  if (option.customPixelMinimum !== undefined && pixels < option.customPixelMinimum) return `总像素不能少于 ${option.customPixelMinimum}。`;
  return null;
}
export function selectedImageUploads(model: ImageModel, selected: readonly PrivateAsset[], uploads: ImageDraft["referenceUploads"]) {
  if (model === "gptImage2") {
    if (uploads.length) throw new Error("GPT-Image-2 不支持此通用上传复用；请使用该模型独立的参考草稿。");
    return [];
  }
  return uploads.filter(upload => selected.some(asset => asset.key === upload.fileKey));
}
export function imageGenerationBody(model: ImageModel, draft: ImageDraft, options: ImageOptions): Record<string, unknown> {
  const option = imageModelOption(options, model);
  if (!option) throw new Error("请选择可用图片模型。");
  if (option.generationAvailable === false) throw new Error("当前图片模型/规格暂不开放新生成；请重新选择，已有任务仍可查询。");
  if (!draft.prompt.trim() || draft.prompt.length > 10000) throw new Error("图片描述须非空，最多 10000 字符。");
  if (draft.selected.length > option.maxReferences) throw new Error(`此模型最多 ${option.maxReferences} 张参考图片。`);
  if (new Set(draft.selected.map(asset => asset.key)).size !== draft.selected.length) throw new Error("参考图片不能重复。");
  for (const asset of draft.selected) { const issue = referenceIssue(asset, options); if (issue) throw new Error(issue); }
  const fileKeys = draft.selected.map(asset => asset.key), uploads = selectedImageUploads(model, draft.selected, draft.referenceUploads);
  const size = draft.size === "custom" ? draft.customSize : draft.size;
  const sizes = option.sizes ?? options.sizes;
  const issue = option.customSize ? imageSizeIssue(size, option) : sizes.includes(size) ? null : "请选择所选模型支持的画面比例。";
  if (issue) throw new Error(issue);
  if (model === "gptImage2") {
    if (!options.resolutions.includes(draft.resolution) || !Number.isInteger(draft.n) || draft.n < 1 || draft.n > options.maxImages) throw new Error("请核对分辨率和生成张数。");
    return { prompt: draft.prompt.trim(), resolution: draft.resolution, size, n: draft.n, fileKeys };
  }
  const common = { model, prompt: draft.prompt, size, fileKeys, ...(uploads.length ? { referenceUploads: uploads } : {}) };
  if (model === "gptImage25" || model === "geminiBanana21") {
    if (!option.resolutions?.includes(draft.resolution)) throw new Error("请选择所选模型支持的分辨率。");
    return model === "gptImage25" ? { ...common, resolution: draft.resolution, ...(draft.transparent ? { background: "transparent" } : {}) } : { ...common, metadata: { resolution: draft.resolution } };
  }
  if (!option.outputFormats?.includes(draft.outputFormat) || !option.optimizePromptModes?.includes(draft.optimizeMode)) throw new Error("请核对输出格式和提示词优化模式。");
  const seed = { ...common, outputFormat: draft.outputFormat, watermark: draft.watermark, optimizePromptOptions: { mode: draft.optimizeMode }, responseFormat: "url" };
  if (model === "seedreamPro") return seed;
  if (!option.sequentialModes?.includes(draft.sequentialMode)) throw new Error("请选择支持的组图模式。");
  if (draft.sequentialMode === "auto" && (!Number.isInteger(draft.maxImages) || draft.maxImages < (option.maxImagesRange?.[0] ?? 1) || draft.maxImages > (option.maxImagesRange?.[1] ?? 10))) throw new Error("请核对组图最多张数。");
  return { ...seed, sequentialImageGeneration: draft.sequentialMode, ...(draft.sequentialMode === "auto" ? { sequentialImageGenerationOptions: { maxImages: draft.maxImages } } : {}) };
}
export function imageQueryBody(model: ImageModel, taskId: string, options: ImageOptions) {
  if (!imageModelOption(options, model)) throw new Error("请选择任务所属图片模型。");
  if (!taskId.trim() || taskId.length > 500) throw new Error("请填写供应商任务 ID，最多 500 字符。");
  return model === "gptImage2" ? { taskId } : { model, taskId };
}
export function imageReferenceReuseId(value: string): number | null { const id = /^\d+$/.test(value) ? Number(value) : NaN; return Number.isSafeInteger(id) && id > 0 ? id : null; }
export function imageTaskModel(parameters: Record<string, unknown> | undefined, options: ImageOptions | null): ImageModelOption | null {
  return options ? imageModelOption(options, typeof parameters?.model === "string" ? parameters.model : "gptImage2") ?? null : null;
}
export const imageProviderStatuses: Record<string, string> = { queued: "排队中", running: "生成中", in_progress: "生成中", succeeded: "生成完成", completed: "生成完成", failed: "生成失败" };
export function imageParameterRows(parameters: Record<string, unknown> | undefined): Array<[string, string]> {
  const p = parameters ?? {}, metadata = researchObject(p.metadata), optimize = researchObject(p.optimizePromptOptions), group = researchObject(p.sequentialImageGenerationOptions);
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: unknown) => { if (value !== undefined) rows.push([label, researchFactText(value)]); };
  add("模型参数", p.model); add("描述（冻结 / 实收）", p.prompt); add("分辨率", p.resolution ?? metadata.resolution); add("画面比例 / 像素尺寸", p.size); add("生成张数", p.n); add("背景", p.background); add("水印", p.watermark); add("输出格式", p.outputFormat); add("提示词优化", optimize.mode); add("组图模式", p.sequentialImageGeneration); add("组图最多张数（不保证返回量）", group.maxImages);
  return rows;
}
export function imageSavedTaskFacts(operation: Parameters<typeof imageTaskId>[0]) {
  const latest = operation.results.findLast(row => row.kind === "image_task");
  return { taskId: imageTaskId(operation), latest, rows: latest ? imageParameterRows(latest.data) : [] };
}

export function imageUploadReferenceLink(result: Pick<OperationResult, "id" | "kind" | "data" | "file" | "fileKey">, options: ImageOptions | null): string | null {
  if (!options || result.kind !== "media_upload" || result.data.operationId !== "6L178PZD" || !Number.isSafeInteger(result.id) || result.id <= 0 || result.file?.key !== result.fileKey) return null;
  const asset = operationFileAsset(result.file);
  if (!asset || referenceIssue(asset, options)) return null;
  return `/admin/data-tools?${new URLSearchParams({ view: "images", imageModel: "gptImage25", reference: asset.key, referenceUploadResult: String(result.id) })}`;
}
