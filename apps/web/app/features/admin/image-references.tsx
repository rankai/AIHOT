import { assetUploadFile, assetUploadFormat, mergeAssetRows } from "./asset-data";
import type { AssetUploadOptions } from "./asset-types";
import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useAdminAction } from "./action";
import { assetContentUrl, assetSize, referenceImage, referenceIssue, type AssetPage, type ImageOptions, type PrivateAsset } from "./image-types";
import { Button, Field, Input } from "./ui";
export function ImageReferences({ options, initialPage, selected, onSelect, onRemove, disabled, onUploadingChange, uploadOptions, updates, onAssetChange, emptyHint = "可不选参考，直接用文字生成。" }: { emptyHint?: string; uploadOptions: AssetUploadOptions; updates: PrivateAsset[]; onAssetChange: (asset: PrivateAsset) => void; options: ImageOptions; initialPage: AssetPage; selected: PrivateAsset[]; onSelect: (asset: PrivateAsset) => void; onRemove: (key: string) => void; disabled: boolean; onUploadingChange: (uploading: boolean) => void }) {
  const { run, pending } = useAdminAction();
  const uploadHintId = useId();
  const more = useFetcher<{ assets: AssetPage }>();
  const [page, setPage] = useState(initialPage);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { onUploadingChange(pending === "upload"); }, [pending, onUploadingChange]);
  useEffect(() => {
    if (!more.data) return;
    const next = more.data.assets;
    setPage(previous => ({ items: mergeAssetRows(previous.items, next.items), nextCursor: next.nextCursor }));
  }, [more.data]);
  const rows = mergeAssetRows(mergeAssetRows(initialPage.items, page.items), updates);
  const images = rows.filter(asset => asset.status === "available" && referenceImage(asset));
  const selectedImages = selected.filter(asset => asset.status === "available" && referenceImage(asset));
  const upload = async () => {
    if (!file || pending || disabled) return;
    const format = assetUploadFormat(file.name, uploadOptions);
    if (!format || !["image/png", "image/jpeg", "image/webp"].includes(format.mime)) { setMessage("参考图片仅支持 PNG、JPEG 或 WebP；文件已保留。"); return; }
    if (file.size > options.referenceBytes) { setMessage(`文件不能超过 ${options.referenceBytes / 1_000_000} MB`); return; }
    let declared: File;
    try { declared = assetUploadFile(file, uploadOptions); } catch (error) { setMessage((error as Error).message); return; }
    const body = new FormData(); body.append("file", declared);
    const active = new AbortController(); controller.current = active; setMessage(null);
    const result = await run<PrivateAsset>("POST", "/api/admin/assets", body, { label: "upload", revalidate: false, signal: active.signal });
    if (controller.current === active) controller.current = null;
    if (!result) { setMessage(active.signal.aborted ? "上传已取消；同一文件可重试。若服务端已收完文件，重试会找回该素材。" : "上传未完成，文件已保留。请按错误提示修正或重试。"); return; }
    setPage(previous => ({ ...previous, items: mergeAssetRows([result], previous.items) }));
    onAssetChange(result);
    if (selectedImages.length < options.maxReferences) onSelect(result);
    setMessage("已上传到本地私有素材，尚未请求供应商。");
  };
  return <div className="space-y-3">
    <div className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><Field label="上传参考图片"><Input aria-label="上传参考图片" aria-describedby={uploadHintId} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || !!pending} onChange={e => { setFile(e.target.files?.[0] ?? null); setMessage(null); }} /></Field></div><Button disabled={!file || disabled || !!pending} busy={pending === "upload"} onClick={upload}>上传到本地</Button>{pending === "upload" && <Button onClick={() => controller.current?.abort()}>取消上传</Button>}</div>
    <p id={uploadHintId} className="text-[12px] text-ink-4">每张 PNG / JPEG / WebP，最多 {options.referenceBytes / 1_000_000} MB、{options.referencePixels / 1_000_000} MP，单帧图片；最多选 {options.maxReferences} 张。</p>
    {message && <p role="status" className="text-[12.5px] text-ink-3">{message}</p>}
    <div className="rounded-control bg-bg-sunk p-3"><div className="mb-2 text-[13px] font-medium">已选参考 {selectedImages.length}/{options.maxReferences}</div>{selectedImages.length ? <ul className="flex flex-wrap gap-3">{selectedImages.map(asset => <li key={asset.key} className="w-32"><img src={assetContentUrl(asset.key)} alt={asset.metadata.filename} className="h-24 w-full rounded-control object-contain bg-surface" /><p className="mt-1 truncate text-[12px]">{asset.metadata.filename}</p><Button size="sm" disabled={disabled || !!pending} onClick={() => onRemove(asset.key)}>移除参考</Button></li>)}</ul> : <p className="text-[12.5px] text-ink-4">{emptyHint}</p>}</div>
    <details className="rounded-control border border-line p-3"><summary className="cursor-pointer text-[13px] text-ink-2">选择已有私有图片（已载入 {images.length} 张）</summary><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{images.map(asset => {
      const issue = referenceIssue(asset, options); const chosen = selectedImages.some(s => s.key === asset.key);
      return <div key={asset.key} className="min-w-0 rounded-control border border-line p-2"><img loading="lazy" src={assetContentUrl(asset.key)} alt={asset.metadata.filename} className="h-24 w-full rounded-control object-contain bg-bg-sunk" /><p title={asset.metadata.filename} className="mt-1 truncate text-[12px] text-ink-2">{asset.metadata.filename}</p><p className="text-[11px] text-ink-4">{asset.metadata.width}×{asset.metadata.height} · {assetSize(asset.bytes)}</p>{issue && <p className="mt-1 text-[11.5px] text-amber">{issue}</p>}<Button size="sm" className="mt-2" disabled={!!issue || chosen || selectedImages.length >= options.maxReferences || disabled || !!pending} onClick={() => onSelect(asset)}>{chosen ? "已选中" : "用作参考"}</Button></div>;
    })}</div>{!images.length && <p className="mt-3 text-[12.5px] text-ink-4">此批没有符合格式与尺寸要求的参考图片。{page.nextCursor ? "可继续加载更多，其他类型素材不会作为图片预览。" : "可在私有素材页查看其他类型。"}</p>}{page.nextCursor && <Button className="mt-3" size="sm" busy={more.state !== "idle"} onClick={() => more.load(`/admin/data-tools?view=images&after=${encodeURIComponent(page.nextCursor!)}`)}>加载更多图片</Button>}</details>
  </div>;
}
