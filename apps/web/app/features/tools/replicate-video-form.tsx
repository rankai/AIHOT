import { ToolSubmit } from './tool-submit';
import { useEffect, useState } from "react";
import { Button, Select } from "../admin/ui";
import { ToolField as Field } from "./fields";

export interface ReplicateAsset { key: string; filename: string; contentType: string; bytes: number; status: string; contentUrl: string }
export function replicateVideoBody(mode: string, portraitFileKey: string, referenceVideoFileKey: string) {
  if (!["wan-std", "wan-pro"].includes(mode) || !portraitFileKey || !referenceVideoFileKey) throw new Error("请选择人物照片和参考视频。");
  return { provider: "aliyun", model: "wan2.2-animate-mix", mode, portraitFileKey, referenceVideoFileKey };
}
export function ReplicateVideoForm({ assets, pending, uploadAsset, onAssetChange, submit, submitLabel = "提交视频复刻" }: {
  assets: ReplicateAsset[]; pending: boolean; uploadAsset: (body: FormData) => Promise<ReplicateAsset | null>;
  onAssetChange?: (asset: ReplicateAsset) => void; submit: (kind: string, body: unknown) => Promise<void>; submitLabel?: string;
}) {
  const [mode, setMode] = useState("wan-std"), [portrait, setPortrait] = useState(""), [video, setVideo] = useState("");
  const [duration, setDuration] = useState<{key:string;seconds:number} | null>(null);
  useEffect(() => setDuration(null), [video]);
  const [uploaded, setUploaded] = useState<ReplicateAsset[]>([]), [uploading, setUploading] = useState(false), [error, setError] = useState<string | null>(null);
  const all = [...new Map([...assets, ...uploaded].map(a => [a.key, a])).values()], disabled = pending || uploading;
  const pickers = [{ id: "portrait", label: "人物照片", value: portrait, change: setPortrait, accept: "image/png,image/jpeg,image/webp", max: 5_000_000, hint: "PNG、JPEG、WebP，≤5MB；宽高200–4096，比例1:3至3:1。" }, { id: "reference", label: "参考视频", value: video, change: setVideo, accept: "video/mp4", max: 50_000_000, hint: "MP4，2–30秒、≤50MB；宽高200–2048，比例1:3至3:1。" }];
  return <form aria-label="视频复刻制作表单" className="space-y-4" onSubmit={async event => {
    event.preventDefault(); if (disabled) return; setError(null);
    try { await submit("videos", replicateVideoBody(mode, portrait, video)); } catch (e) { setError(e instanceof Error ? e.message : "提交未完成"); }
  }}><fieldset disabled={disabled} className="min-w-0 space-y-4">
    <p className="text-[13px] text-ink-3">上传参考视频和人物照片，替换视频中的主角，参考原动作与场景。适合单主角视频；不提供音色克隆或逐字台词改写。</p>
    <div className="grid gap-4 sm:grid-cols-2">{pickers.map(picker => {
      const selected = all.find(a => a.key === picker.value), candidates = all.filter(a => a.status === "available" && picker.accept.split(",").includes(a.contentType) && a.bytes <= picker.max);
      return <div key={picker.id} className="min-w-0 space-y-3 rounded-control border border-line p-3"><Field label={picker.label} hint={picker.hint}>
        <Select aria-label={`选择${picker.label}`} required value={picker.value} onChange={e => picker.change(e.target.value)}><option value="">请选择私有素材</option>{candidates.map(a => <option key={a.key} value={a.key}>{a.filename}</option>)}</Select>
      </Field><Field label={`上传${picker.label}`}><input type="file" aria-label={`上传${picker.label}`} accept={picker.accept} className="block w-full text-[13px]" onChange={async e => {
        const input = e.currentTarget, file = input.files?.[0]; if (!file) return; setError(null);
        if (!picker.accept.split(",").includes(file.type) || file.size > picker.max) { setError(`请检查${picker.label}的格式和大小。`); input.value = ""; return; }
        setUploading(true);
        try { const body = new FormData(); body.set("file", file); const asset = await uploadAsset(body); if (!asset) throw new Error("上传未完成，请重试"); setUploaded(previous => [...previous, asset]); onAssetChange?.(asset); picker.change(asset.key); }
        catch (e) { setError(e instanceof Error ? e.message : "上传未完成"); }
        finally { setUploading(false); input.value = ""; }
      }} /></Field>{selected && (picker.id === "portrait" ? <img src={selected.contentUrl} alt="已选择的人物照片" className="max-h-48 w-full rounded-control object-contain" /> : <video key={selected.key} src={selected.contentUrl} onLoadedMetadata={event => setDuration({key:selected.key,seconds:event.currentTarget.duration})} onError={() => setDuration(null)} controls preload="metadata" className="max-h-48 w-full rounded-control" />)}</div>;
    })}</div>
    <Field label="生成模式"><Select aria-label="视频复刻模式" value={mode} onChange={e => setMode(e.target.value)}><option value="wan-std">标准 · 720P / 15fps</option><option value="wan-pro">专业 · 720P / 25fps</option></Select></Field>
    <p className="text-[12px] text-ink-3">服务端检查素材后按参考视频时长向上取整到秒报价。结果保留 AI 生成水印，并保存到本任务的私有产物；本地上传不调用生成模型。声音表现以实际产物为准。</p>
    {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    <ToolSubmit selection={{kind:"videos",videoSeconds:duration?.key === video ? duration.seconds : undefined,input:{provider:"aliyun",model:"wan2.2-animate-mix",mode,portraitFileKey:portrait,referenceVideoFileKey:video}}} type="submit" tone="primary" disabled={disabled || !portrait || !video} busy={disabled}>{submitLabel}</ToolSubmit>
  </fieldset></form>;
}
