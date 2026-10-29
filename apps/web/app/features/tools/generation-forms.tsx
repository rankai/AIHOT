import { useState } from "react";
import type { ToolAsset } from "@aihot/contracts/user-tools";
import { Button, Input, Select, Textarea } from "../admin/ui";
import { imageGenerationBody, imageGenerationModels, imageModelDraft } from "../admin/image-model-data";
import type { ImageModel, ImageOptions, PrivateAsset } from "../admin/image-types";
import type { VideoOptions } from "../admin/video-types";
import { ToolField as Field } from "./fields";

type Submit = (kind: string, body: unknown) => Promise<void>;
const references = (assets: ToolAsset[]) => assets.filter(asset => asset.status === "available" && ["image/png", "image/jpeg", "image/webp"].includes(asset.contentType));
const privateAsset = (asset: ToolAsset): PrivateAsset => ({ key: asset.key, content_type: asset.contentType, bytes: asset.bytes, purpose: "operation-input", status: asset.status, metadata: { filename: asset.filename, width: asset.width, height: asset.height, kind: "image" } });

function ReferencePicker({ assets, selected, max, change }: { assets: ToolAsset[]; selected: string[]; max: number; change: (keys: string[]) => void }) {
  const choices = references(assets);
  return <fieldset className="rounded-control border border-line p-3"><legend className="px-1 text-[13px] font-medium text-ink-2">参考图片（可选，最多 {max} 张）</legend>
    {!choices.length ? <p className="text-[13px] text-ink-3">先在“私有素材”中上传 PNG、JPEG 或 WebP 图片。</p> : <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">{choices.map(asset => <label key={asset.key} className="flex min-w-0 items-center gap-2 rounded-control p-2 hover:bg-bg-sunk"><input type="checkbox" checked={selected.includes(asset.key)} disabled={!selected.includes(asset.key) && selected.length >= max} onChange={event => change(event.target.checked ? [...selected, asset.key] : selected.filter(key => key !== asset.key))} /><img src={asset.contentUrl} alt="" loading="lazy" className="size-10 rounded object-cover" /><span className="truncate text-[12px]">{asset.filename}</span></label>)}</div>}
  </fieldset>;
}

function UploadPicker({ assets, selected, values, change }: { assets: ToolAsset[]; selected: string[]; values: Array<{ fileKey: string; resultId: number }>; change: (values: Array<{ fileKey: string; resultId: number }>) => void }) {
  return <>{selected.map(key => {
    const asset = assets.find(row => row.key === key);
    if (!asset?.uploads?.length) return null;
    return <Field key={key} label={`${asset.filename}的上传方式`} hint="选择已有上传结果可避免再次上传；失效时会提示错误，不会自动重新上传。"><Select value={values.find(row => row.fileKey === key)?.resultId ?? ""} onChange={event => change([...values.filter(row => row.fileKey !== key), ...(event.target.value ? [{ fileKey: key, resultId: Number(event.target.value) }] : [])])}><option value="">本次上传</option>{asset.uploads.map(upload => <option key={upload.resultId} value={upload.resultId}>复用上传 #{upload.resultId} · {new Date(upload.createdAt).toLocaleString("zh-CN")}</option>)}</Select></Field>;
  })}</>;
}

export function ImageToolForm({ options, assets, submit, pending }: { options: ImageOptions; assets: ToolAsset[]; submit: Submit; pending: boolean }) {
  const models = imageGenerationModels(options);
  const [model, setModel] = useState<ImageModel>(models[0]?.model ?? "gptImage2");
  const option = models.find(row => row.model === model);
  if (!option) return <p className="text-[13px] text-ink-3">当前没有可用的图片生成模型。</p>;
  return <div className="space-y-4"><Field label="图片模型"><Select value={model} onChange={event => setModel(event.target.value as ImageModel)}>{models.map(row => <option key={row.model} value={row.model}>{row.label}</option>)}</Select></Field>
    <ImageDraftForm key={model} options={options} model={model} assets={assets} submit={submit} pending={pending} max={option.maxReferences} />
  </div>;
}

function ImageDraftForm({ options, model, assets, submit, pending, max }: { options: ImageOptions; model: ImageModel; assets: ToolAsset[]; submit: Submit; pending: boolean; max: number }) {
  const option = options.models.find(row => row.model === model)!;
  const [draft, setDraft] = useState(() => imageModelDraft(option, options));
  const [error, setError] = useState<string | null>(null);
  const selected = draft.selected.map(asset => asset.key);
  return <form className="space-y-4" onSubmit={async event => { event.preventDefault(); setError(null); try { await submit("images", imageGenerationBody(model, draft, options)); } catch (error) { setError(error instanceof Error ? error.message : "请检查图片参数。"); } }}>
    <Field label="图片描述"><Textarea required maxLength={10000} rows={5} value={draft.prompt} onChange={event => setDraft({ ...draft, prompt: event.target.value })} placeholder="描述画面主体、风格、构图和希望出现的文字" /></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="画面比例 / 尺寸"><Select value={draft.size} onChange={event => setDraft({ ...draft, size: event.target.value })}>{(option.sizes ?? options.sizes).map(value => <option key={value}>{value}</option>)}{option.customSize && <option value="custom">自定义尺寸</option>}</Select></Field>
      {draft.size === "custom" && <Field label="自定义宽高" hint="例如 1920x1920"><Input required value={draft.customSize} onChange={event => setDraft({ ...draft, customSize: event.target.value })} /></Field>}
      {!model.startsWith("seedream") && <Field label="分辨率"><Select value={draft.resolution} onChange={event => setDraft({ ...draft, resolution: event.target.value })}>{(option.resolutions ?? options.resolutions).map(value => <option key={value}>{value}</option>)}</Select></Field>}
      {model === "gptImage2" && <Field label="生成张数"><Input type="number" min={1} max={options.maxImages} value={draft.n} onChange={event => setDraft({ ...draft, n: Number(event.target.value) })} /></Field>}
      {option.outputFormats && <Field label="输出格式"><Select value={draft.outputFormat} onChange={event => setDraft({ ...draft, outputFormat: event.target.value })}>{option.outputFormats.map(value => <option key={value}>{value}</option>)}</Select></Field>}
      {option.optimizePromptModes && <Field label="提示词优化"><Select value={draft.optimizeMode} onChange={event => setDraft({ ...draft, optimizeMode: event.target.value })}>{option.optimizePromptModes.map(value => <option key={value} value={value}>{value === "standard" ? "标准" : "快速"}</option>)}</Select></Field>}
      {option.sequentialModes && <Field label="组图模式"><Select value={draft.sequentialMode} onChange={event => setDraft({ ...draft, sequentialMode: event.target.value })}><option value="disabled">单张</option><option value="auto">自动组图</option></Select></Field>}
      {draft.sequentialMode === "auto" && <Field label="最多生成张数"><Input type="number" min={1} max={option.maxImagesRange?.[1] ?? 10} value={draft.maxImages} onChange={event => setDraft({ ...draft, maxImages: Number(event.target.value) })} /></Field>}
    </div>
    {model === "gptImage25" && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={draft.transparent} onChange={event => setDraft({ ...draft, transparent: event.target.checked })} />透明背景</label>}
    {option.watermark && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={draft.watermark} onChange={event => setDraft({ ...draft, watermark: event.target.checked })} />保留水印</label>}
    <ReferencePicker assets={assets} selected={selected} max={max} change={keys => setDraft({ ...draft, selected: keys.flatMap(key => { const asset = assets.find(row => row.key === key); return asset ? [privateAsset(asset)] : []; }) })} />
    {model !== "gptImage2" && <UploadPicker assets={assets} selected={selected} values={draft.referenceUploads} change={referenceUploads => setDraft({ ...draft, referenceUploads })} />}
    {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    <Button tone="primary" type="submit" disabled={pending} busy={pending}>查看积分报价</Button>
  </form>;
}

export function VideoToolForm({ options, assets, submit, pending }: { options: VideoOptions; assets: ToolAsset[]; submit: Submit; pending: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Array<{ fileKey: string; resultId: number }>>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); setError(null); const form = new FormData(event.currentTarget);
    const imageWithRoles = selected.map(fileKey => ({ fileKey, role: roles[fileKey] ?? "reference_image", ...(uploads.find(row => row.fileKey === fileKey) ? { uploadResultId: uploads.find(row => row.fileKey === fileKey)!.resultId } : {}) }));
    if (["first_frame", "last_frame"].some(role => imageWithRoles.filter(row => row.role === role).length > 1)) { setError("首帧与末帧分别只能选择一张图片。"); return; }
    await submit("videos", { prompt: String(form.get("prompt")), aspectRatio: form.get("aspectRatio"), resolution: form.get("resolution"), duration: Number(form.get("duration")), generateAudio: form.has("generateAudio"), returnLastFrame: form.has("returnLastFrame"), imageWithRoles });
  }}>
    <p className="text-[13px] text-ink-3">{options.modelLabel}</p>
    <Field label="视频描述"><Textarea name="prompt" required maxLength={10000} rows={5} placeholder="描述场景、人物动作、镜头与声音" /></Field>
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="画面比例"><Select name="aspectRatio" defaultValue="16:9">{options.aspectRatios.map(value => <option key={value}>{value}</option>)}</Select></Field>
      <Field label="分辨率"><Select name="resolution">{options.resolutions.map(value => <option key={value}>{value}</option>)}</Select></Field>
      <Field label="时长（秒）"><Input name="duration" type="number" required min={options.durationSeconds.min} max={options.durationSeconds.max} defaultValue={options.durationSeconds.min} /></Field>
    </div>
    <div className="flex flex-wrap gap-5 text-[13px]"><label className="flex items-center gap-2"><input name="generateAudio" type="checkbox" />生成音频</label><label className="flex items-center gap-2"><input name="returnLastFrame" type="checkbox" />同时保存末帧</label></div>
    <ReferencePicker assets={assets} selected={selected} max={options.maxReferenceRoles} change={setSelected} />
    <UploadPicker assets={assets} selected={selected} values={uploads} change={setUploads} />
    {selected.map(key => <Field key={key} label={`${assets.find(asset => asset.key === key)?.filename ?? "图片"}的用途`}><Select value={roles[key] ?? "reference_image"} onChange={event => setRoles({ ...roles, [key]: event.target.value })}><option value="reference_image">参考图片</option><option value="first_frame">首帧</option><option value="last_frame">末帧</option></Select></Field>)}
    {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    <Button tone="primary" type="submit" disabled={pending} busy={pending}>查看积分报价</Button>
  </form>;
}
