import { useRef, useState } from "react";
import type { ToolAsset } from "@aihot/contracts/user-tools";
import { assetUploadAccept, assetUploadFile } from "../admin/asset-data";
import type { AssetUploadOptions } from "../admin/asset-types";
import { Button, Input, Select, Textarea } from "../admin/ui";
import type { VideoOptions } from "../admin/video-types";
import { ToolField as Field } from "./fields";
import { UploadPicker } from "./generation-references";
import { TALKING_PORTRAIT_TYPES, talkingVideoBody } from "./talking-video-data";

export function TalkingVideoForm({ options, assets, uploadOptions, uploadAsset, onAssetChange, submit, pending, submitLabel = "查看积分报价" }: { options: VideoOptions; assets: ToolAsset[]; uploadOptions: AssetUploadOptions; uploadAsset: (body: FormData) => Promise<ToolAsset | null>; onAssetChange?: (asset: ToolAsset) => void; submit: (kind: string, body: unknown) => Promise<void>; pending: boolean; submitLabel?: string }) {
  const [pictures, setPictures] = useState({ portrait: "", product: "", scene: "" });
  const [uploadTarget, setUploadTarget] = useState<keyof typeof pictures>("portrait");
  const slots = [["portrait", "人物照片"], ["product", "产品参考图（选填）"], ["scene", "场景参考图（选填）"]] as const;
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<Array<{ fileKey: string; resultId: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const choices = assets.filter(asset => asset.status === "available" && TALKING_PORTRAIT_TYPES.includes(asset.contentType));
  const portrait = choices.find(asset => asset.key === pictures.portrait);
  const portraitUploads: AssetUploadOptions = { ...uploadOptions, formats: uploadOptions.formats.filter(format => format.kind === "image" && TALKING_PORTRAIT_TYPES.includes(format.mime)), limits: { ...uploadOptions.limits, imageBytes: Math.min(uploadOptions.limits.imageBytes, options.referenceBytes) } };
  function selectPicture(slot: keyof typeof pictures, key: string) {
    setPictures(previous => ({ ...previous, [slot]: key }));
    setUploads(previous => previous.filter(row => row.fileKey !== pictures[slot] && row.fileKey !== key));
    setError(null); setNotice(null);
  }
  return <div className="space-y-5">
    <p className="text-[13px] leading-relaxed text-ink-3">使用人物照片和台词生成有声讲述视频，也可添加产品与场景参考图。适合产品介绍、知识分享和人物短片。声音由 AI 自动生成，暂不支持定制音色或上传录音驱动；台词、人物与产品细节请在生成后核对。</p>
    <form aria-label="上传口播参考图片" className="space-y-3 rounded-panel border border-dashed border-line-strong p-4" onSubmit={async event => {
      event.preventDefault(); const file = fileInput.current?.files?.[0]; if (!file) return; setError(null); setNotice(null); setUploading(true);
      try {
        const data = new FormData(); data.set("file", assetUploadFile(file, portraitUploads));
        const result = await uploadAsset(data);
        if (!result) { setError("上传未完成，请检查错误提示后重试。"); return; }
        if (result) { onAssetChange?.(result); selectPicture(uploadTarget, result.key); if (fileInput.current) fileInput.current.value = ""; setNotice("图片已保存到私有素材并选中。"); }
      } catch (error) { setError(error instanceof Error ? error.message : "请检查参考图片。"); } finally { setUploading(false); }
    }}>
      <Field label="图片用途"><Select value={uploadTarget} onChange={event => setUploadTarget(event.target.value as keyof typeof pictures)} disabled={pending || uploading}>{slots.map(([slot, label]) => <option key={slot} value={slot}>{label}</option>)}</Select></Field>
      <Field label="上传参考图片"><input ref={fileInput} type="file" name="referenceImage" required accept={assetUploadAccept(portraitUploads)} disabled={pending || uploading} className="block w-full text-[13px]" /></Field>
      <p className="text-[12px] text-ink-3">PNG、JPEG 或 WebP，最多 {portraitUploads.limits.imageBytes / 1_000_000} MB。本地上传不消耗积分。</p>
      <Button type="submit" disabled={pending || uploading} busy={uploading}>上传并选中图片</Button>
    </form>
    {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    {notice && <p role="status" className="text-[13px] text-ok">{notice}</p>}
    <form aria-label="AI口播制作表单" className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (pending || uploading) return; setError(null); const form = new FormData(event.currentTarget);
      try {
        await submit("videos", talkingVideoBody({ dialogue: String(form.get("dialogue") ?? ""), actionScript: String(form.get("actionScript") ?? ""), portraitKey: pictures.portrait, productKey: pictures.product, sceneKey: pictures.scene, referenceUploads: uploads, aspectRatio: String(form.get("aspectRatio")), resolution: String(form.get("resolution")), duration: Number(form.get("duration")) }, assets, options));
      } catch (error) { setError(error instanceof Error ? error.message : "请检查 AI口播参数。"); }
    }}><fieldset disabled={pending || uploading} className="min-w-0 space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">{slots.map(([slot, label]) => {
        const selected = choices.find(asset => asset.key === pictures[slot]);
        return <div key={slot} className="min-w-0 space-y-2"><Field label={label}><Select name={`${slot}Key`} required={slot === "portrait"} value={selected?.key ?? ""} onChange={event => selectPicture(slot, event.target.value)} disabled={pending || uploading}><option value="">{slot === "portrait" ? "请选择人物照片" : "不添加"}</option>{choices.filter(asset => asset.key === pictures[slot] || !Object.values(pictures).includes(asset.key)).map(asset => <option key={asset.key} value={asset.key}>{asset.filename}</option>)}</Select></Field>{selected && <img src={selected.contentUrl} alt={`${label}：${selected.filename}`} className="h-36 w-full rounded-control border border-line bg-bg-sunk object-contain" />}</div>;
      })}</div>
      <UploadPicker assets={assets} selected={Object.values(pictures).filter(Boolean)} values={uploads} change={setUploads} />
      <Field label="口播台词" hint="填写人物需要说出的内容，建议使用适合所选时长的短句。"><Textarea name="dialogue" required maxLength={10000} rows={4} placeholder="例如：大家好，今天分享一个实用的小技巧。" /></Field>
      <Field label="动作与表情（选填）" hint="描述表情、手势、停顿和镜头。"><Textarea name="actionScript" maxLength={10000} rows={4} placeholder="例如：面对镜头微笑，开场轻轻挥手，随后自然讲述，镜头保持稳定。" /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="画面比例"><Select name="aspectRatio" defaultValue={options.aspectRatios.includes("9:16") ? "9:16" : options.aspectRatios[0]}>{options.aspectRatios.map(value => <option key={value}>{value}</option>)}</Select></Field>
        <Field label="分辨率"><Select name="resolution" defaultValue={options.resolutions[0]}>{options.resolutions.map(value => <option key={value}>{value}</option>)}</Select></Field>
        <Field label="时长（秒）"><Input name="duration" type="number" required min={options.durationSeconds.min} max={options.durationSeconds.max} defaultValue={options.durationSeconds.min} /></Field>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">{options.modelLabel} · 已开启生成音频。图片按人物、产品、场景的顺序作为外观参考；提交生成时，所选图片和脚本会发送至视频服务。请将台词控制在 {options.durationSeconds.min}–{options.durationSeconds.max} 秒内。</p>
      <Button type="submit" tone="primary" disabled={pending || uploading || !portrait} busy={pending}>{submitLabel}</Button>
    </fieldset></form>
  </div>;
}
