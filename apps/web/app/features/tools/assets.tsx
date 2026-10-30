import { useRef, useState } from "react";
import type { ToolAsset, ToolAssetPage } from "@aihot/contracts/user-tools";
import type { AssetUploadOptions } from "../admin/asset-types";
import { Button } from "../admin/ui";
import { toolGet, useToolCommand } from "./client";

export function ToolAssetLibrary({ page, items, options, csrf, onChange, submit }: { page: ToolAssetPage; items: ToolAsset[]; options: AssetUploadOptions; csrf: string; onChange: (update: (assets: ToolAsset[]) => ToolAsset[]) => void; submit: (kind: string, body: unknown) => Promise<void> }) {
  const [cursor, setCursor] = useState(page.nextCursor);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useToolCommand(csrf);
  const update = onChange;
  return <div className="space-y-5">
    <form className="space-y-3 rounded-panel border border-dashed border-line-strong p-4" onSubmit={async event => {
      event.preventDefault(); const file = fileInput.current?.files?.[0]; if (!file) return; setError(null); setNotice(null);
      const limit = file.type.startsWith("image/") ? options.limits.imageBytes : file.type.startsWith("audio/") ? options.limits.audioBytes : options.limits.videoBytes;
      if (file.size > limit) { setError(`文件超过 ${Math.floor(limit / 1_000_000)} MB 限制。`); return; }
      const data = new FormData(); data.set("file", file);
      const result = await upload.run<ToolAsset>("/api/tools/assets", data);
      if (result) { update(previous => [result, ...previous.filter(row => row.key !== result.key)]); if (fileInput.current) fileInput.current.value = ""; setNotice("素材已上传，可以在图片和视频创作中选择使用。"); }
    }}>
      <label className="block text-[13px] font-medium text-ink-2">上传私有素材<input ref={fileInput} type="file" name="file" required accept={options.formats.map(row => row.mime).join(",")} className="mt-2 block w-full text-[13px]" /></label>
      <p className="text-[12px] text-ink-3">本地上传不消耗积分。图片最多 {options.limits.imageBytes / 1_000_000} MB，音频 {options.limits.audioBytes / 1_000_000} MB，视频 {options.limits.videoBytes / 1_000_000} MB。</p>
      <Button type="submit" tone="primary" disabled={upload.pending} busy={upload.pending}>上传素材</Button>
    </form>
    {(error || upload.error) && <p role="alert" className="text-[13px] text-hot">{error || upload.error}</p>}
    {notice && <p role="status" className="text-[13px] text-ok">{notice}</p>}
    {!items.length && <p className="py-6 text-center text-[14px] text-ink-3">还没有素材。上传后可用于创作，也可在这里查看生成的文件。</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map(asset => <article key={asset.key} className="overflow-hidden rounded-panel border border-line">
      {asset.contentType.startsWith("image/") ? <img src={asset.contentUrl} alt={asset.filename} loading="lazy" className="h-40 w-full bg-bg-sunk object-contain" /> : asset.contentType.startsWith("video/") ? <video src={asset.contentUrl} controls preload="none" className="h-40 w-full bg-bg-sunk" /> : asset.contentType.startsWith("audio/") ? <audio src={asset.contentUrl} controls preload="none" className="w-full p-2" /> : <div className="bg-bg-sunk p-5 text-[13px] text-ink-3">文档素材</div>}
      <div className="space-y-2 p-3"><h3 title={asset.filename} className="truncate text-[13px] font-medium text-ink">{asset.filename}</h3><p className="text-[12px] text-ink-3">{(asset.bytes / 1024).toFixed(0)} KiB</p>
        <div className="flex flex-wrap items-center gap-3 text-[12px]"><a href={asset.contentUrl} download={asset.filename} className="text-accent underline">下载</a><Button size="sm" onClick={() => submit("media-upload", { fileKey: asset.key })}>上传到供应商报价</Button></div>
        {deleting === asset.key ? <div className="space-y-2 border-t border-line pt-2"><p className="text-[12px] text-ink-3">删除后将无法再使用此素材，进行中的任务所需素材不能删除。</p><div className="flex gap-2"><Button size="sm" tone="danger" disabled={upload.pending} onClick={async () => { const result = await upload.run(`/api/tools/assets/${encodeURIComponent(asset.key)}`, {}, "DELETE"); if (result) { update(previous => previous.filter(row => row.key !== asset.key)); setDeleting(null); } }}>确认删除</Button><Button size="sm" disabled={upload.pending} onClick={() => setDeleting(null)}>取消</Button></div></div> : <button type="button" className="text-[12px] text-ink-4 hover:text-hot" onClick={() => setDeleting(asset.key)}>删除素材</button>}
      </div>
    </article>)}</div>
    {cursor && <Button disabled={loading} busy={loading} onClick={async () => { setLoading(true); setError(null); try { const next = await toolGet<ToolAssetPage>(`/api/tools/assets?after=${encodeURIComponent(cursor)}`); update(previous => [...previous, ...next.items.filter(row => !previous.some(item => item.key === row.key))]); setCursor(next.nextCursor); } catch (error) { setError(error instanceof Error ? error.message : "加载失败"); } finally { setLoading(false); } }}>加载更多素材</Button>}
  </div>;
}
