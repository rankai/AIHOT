import { ReplicateVideoForm } from "./replicate-video-form";
import { useRef, useState } from "react";
import type { ToolAsset } from "@aihot/contracts/user-tools";
import { Button, Input, Select, Textarea } from "../admin/ui";
import { imageGenerationBody, imageGenerationModels, imageModelDraft } from "../admin/image-model-data";
import type { ImageModel, ImageOptions, PrivateAsset } from "../admin/image-types";
import type { VideoOptions } from "../admin/video-types";
import type { AssetUploadOptions } from "../admin/asset-types";
import { ToolField as Field } from "./fields";
import { ReferencePicker, UploadPicker } from "./generation-references";
import { TalkingVideoForm } from "./talking-video-form";
import { useVideoMode, VideoModeTabs } from "./video-modes";
import { useToolCommand } from "./client";
import { videoGenerationBody } from "../admin/video-data";
import { assetUploadFile } from "../admin/asset-data";

type Submit = (kind: string, body: unknown) => Promise<void>;
const privateAsset = (asset: ToolAsset): PrivateAsset => ({ key: asset.key, content_type: asset.contentType, bytes: asset.bytes, purpose: "operation-input", status: asset.status, metadata: { filename: asset.filename, width: asset.width, height: asset.height, kind: "image" } });

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

export function VideoToolForm(props: { options: VideoOptions; assets: ToolAsset[]; uploadOptions: AssetUploadOptions; csrf: string; onAssetChange: (asset: ToolAsset) => void; submit: Submit; pending: boolean }) {
  const { mode, change } = useVideoMode();
  const upload = useToolCommand(props.csrf);
  const uploadAsset = (body: FormData) => upload.run<ToolAsset>("/api/tools/assets", body);
  const pending = props.pending || upload.pending;
  return <div className="space-y-5">
    <VideoModeTabs mode={mode} change={change} idPrefix="user-video" />
    {upload.error && <p role="alert" className="text-[13px] text-hot">{upload.error}</p>}
    <div id="user-video-text" role="tabpanel" aria-labelledby="user-video-text-tab" hidden={mode !== "text"}><h2 className="mb-4 text-lg font-semibold">文生视频</h2><GeneralVideoToolForm {...props} mode="text" pending={pending} uploadAsset={uploadAsset} /></div>
    <div id="user-video-image" role="tabpanel" aria-labelledby="user-video-image-tab" hidden={mode !== "image"}><h2 className="mb-4 text-lg font-semibold">图生视频</h2><GeneralVideoToolForm {...props} mode="image" pending={pending} uploadAsset={uploadAsset} /></div>
    <div id="user-video-replicate" role="tabpanel" aria-labelledby="user-video-replicate-tab" hidden={mode !== "replicate"}><h2 className="mb-4 text-lg font-semibold">视频复刻</h2><ReplicateVideoForm assets={props.assets} pending={pending} uploadAsset={uploadAsset} submit={props.submit} /></div>
    <div id="user-video-talking" role="tabpanel" aria-labelledby="user-video-talking-tab" hidden={mode !== "talking"}><h2 className="mb-4 text-lg font-semibold">AI口播</h2><TalkingVideoForm {...props} pending={pending} uploadAsset={uploadAsset} /></div>
  </div>;
}

function GeneralVideoToolForm({ options, assets, submit, pending, mode, uploadOptions, uploadAsset, onAssetChange }: { options: VideoOptions; assets: ToolAsset[]; submit: Submit; pending: boolean; mode: "text" | "image"; uploadOptions: AssetUploadOptions; uploadAsset: (body: FormData) => Promise<ToolAsset | null>; onAssetChange: (asset: ToolAsset) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Array<{ fileKey: string; resultId: number }>>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  return <form aria-label={mode === "text" ? "文生视频制作表单" : "图生视频制作表单"} className="space-y-4" onSubmit={async event => {
    event.preventDefault(); if (pending) return; setError(null); const form = new FormData(event.currentTarget);
    try {
      if (mode === "image" && !selected.length) throw new Error("图生视频至少需要一张参考图片。");
      const keys = mode === "image" ? selected : [];
      await submit("videos", videoGenerationBody({ prompt: String(form.get("prompt")), aspectRatio: String(form.get("aspectRatio")), resolution: String(form.get("resolution")), duration: Number(form.get("duration")), generateAudio: form.has("generateAudio"), returnLastFrame: form.has("returnLastFrame"), selected: keys.flatMap(key => { const asset = assets.find(row => row.key === key); return asset ? [privateAsset(asset)] : []; }), roles: keys.map((fileKey, id) => ({ id, fileKey, role: (roles[fileKey] ?? "reference_image") as "reference_image" | "first_frame" | "last_frame" })), confirmedUploads: Object.fromEntries(uploads.filter(row => keys.includes(row.fileKey)).map(row => [row.fileKey, row.resultId])) }, options));
    } catch (error) { setError(error instanceof Error ? error.message : "请检查视频参数。"); }
  }}><fieldset disabled={pending} className="min-w-0 space-y-4">
    <p className="text-[13px] text-ink-3">{mode === "text" ? "输入画面、动作与镜头描述，直接生成视频。" : "上传或选择至少一张图片，描述希望发生的动作和镜头变化。可设置首帧、末帧或外观参考。"}</p>
    <Field label="视频描述"><Textarea name="prompt" required maxLength={10000} rows={5} placeholder="描述场景、人物动作、镜头与声音" /></Field>
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="画面比例"><Select name="aspectRatio" defaultValue="16:9">{options.aspectRatios.map(value => <option key={value}>{value}</option>)}</Select></Field>
      <Field label="分辨率"><Select name="resolution">{options.resolutions.map(value => <option key={value}>{value}</option>)}</Select></Field>
      <Field label="时长（秒）"><Input name="duration" type="number" required min={options.durationSeconds.min} max={options.durationSeconds.max} defaultValue={options.durationSeconds.min} /></Field>
    </div>
    <div className="flex flex-wrap gap-5 text-[13px]"><label className="flex items-center gap-2"><input name="generateAudio" type="checkbox" />生成音频</label><label className="flex items-center gap-2"><input name="returnLastFrame" type="checkbox" />同时保存末帧</label></div>
    {mode === "image" && <>
      <div className="space-y-2 rounded-control border border-dashed border-line-strong p-3"><Field label="上传参考图片"><input ref={fileInput} name="imageUpload" type="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-[13px]" /></Field><Button disabled={pending || selected.length >= options.maxReferenceRoles} onClick={async () => {
        const file = fileInput.current?.files?.[0]; if (!file) { setError("请先选择参考图片。"); return; }
        setError(null);
        try {
          const data = new FormData(); data.set("file", assetUploadFile(file, { ...uploadOptions, formats: uploadOptions.formats.filter(format => ["image/png", "image/jpeg", "image/webp"].includes(format.mime)), limits: { ...uploadOptions.limits, imageBytes: Math.min(uploadOptions.limits.imageBytes, options.referenceBytes) } }));
          const asset = await uploadAsset(data);
          if (asset) { onAssetChange(asset); setSelected(previous => [...new Set([...previous, asset.key])]); if (fileInput.current) fileInput.current.value = ""; }
        } catch (error) { setError(error instanceof Error ? error.message : "上传未完成。"); }
      }}>上传并选中图片</Button><p className="text-[12px] text-ink-3">PNG、JPEG 或 WebP，最多 {options.referenceBytes / 1_000_000} MB。本地上传不消耗积分。</p></div>
    <ReferencePicker required assets={assets} selected={selected} max={options.maxReferenceRoles} change={keys => { setSelected(keys); setUploads(previous => previous.filter(row => keys.includes(row.fileKey))); setError(null); }} />
    <UploadPicker assets={assets} selected={selected} values={uploads} change={setUploads} />
    {selected.map(key => <Field key={key} label={`${assets.find(asset => asset.key === key)?.filename ?? "图片"}的用途`}><Select value={roles[key] ?? "reference_image"} onChange={event => setRoles({ ...roles, [key]: event.target.value })}><option value="reference_image">参考图片</option><option value="first_frame">首帧</option><option value="last_frame">末帧</option></Select></Field>)}
    </>}
    {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    <Button tone="primary" type="submit" disabled={pending || mode === "image" && !selected.length} busy={pending}>查看积分报价</Button>
  </fieldset></form>;
}
