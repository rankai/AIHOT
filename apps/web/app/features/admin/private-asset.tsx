import { MediaUploadAction } from "./media-upload-action";
import type { MediaUploadOptions } from "./media-upload-data";
import { useCallback, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { useAdminAction } from "./action";
import { assetContentUrl, assetSize, referenceIssue, validImageDimension, type ImageOptions, type PrivateAsset } from "./image-types";
import { assetKind, assetKindLabels, mergeAssetRows } from "./asset-data";
import { Button, ReasonDialog } from "./ui";
export function PrivateAssetView({ asset, options, compact = false, onChange, uploadOptions }: { uploadOptions?: MediaUploadOptions; asset: PrivateAsset | null; options: ImageOptions | null; compact?: boolean; onChange?: (asset: PrivateAsset) => void }) {
  const { run, pending } = useAdminAction();
  const refresh = useRevalidator();
  const [open, setOpen] = useState(false);
  const [deleted, setDeleted] = useState<PrivateAsset | null>(null);
  const [failure, setFailure] = useState(false);
  const [previewFailure, setPreviewFailure] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  if (!asset) return <p className="my-3 text-[13px] text-amber">没有可用的本地素材记录；供应商链接不会作为预览。</p>;
  const current = deleted?.key === asset.key ? mergeAssetRows([asset], [deleted])[0]! : asset;
  const { status } = current, kind = assetKind(current), label = kind ? assetKindLabels[kind] : "素材";
  const issue = options ? referenceIssue(current, options) : null;
  const available = status === "available";
  const url = assetContentUrl(current.key), filename = current.metadata.filename;
  const dimensions = kind === "image" && validImageDimension(current.metadata.width) && validImageDimension(current.metadata.height) ? `${current.metadata.width}×${current.metadata.height}` : null;
  const frames = kind === "image" && current.content_type === "image/gif" && validImageDimension(current.metadata.pages) ? `${current.metadata.pages} 帧` : null;
  return <div className="my-3 space-y-3">
    {available ? kind === "image" ? <a href={url} target="_blank" rel="noreferrer" className="block"><img loading="lazy" src={url} alt={filename || "私有图片"} width={validImageDimension(current.metadata.width) ? current.metadata.width : undefined} height={validImageDimension(current.metadata.height) ? current.metadata.height : undefined} onError={() => setPreviewFailure(current.key)} className={`${compact ? "max-h-60" : "max-h-[560px]"} w-full rounded-control bg-bg-sunk object-contain`} /></a> : kind === "audio" ? <audio controls preload="none" src={url} className="w-full" aria-label={`私有音频：${filename}`} onError={() => setPreviewFailure(current.key)} /> : kind === "video" ? <video controls preload="none" playsInline src={url} className={`${compact ? "max-h-60" : "max-h-[560px]"} w-full rounded-control bg-bg-sunk`} aria-label={`私有视频：${filename}`} onError={() => setPreviewFailure(current.key)} /> : null : <p className="rounded-control bg-bg-sunk p-3 text-[13px] text-ink-3">{status === "deleted" ? `此${label}已删除，历史记录保留。` : status === "deleting" ? `${label}正在删除或上次删除未完成，可重试删除。` : `此${label}暂不可用。`}</p>}
    {available && (kind === "audio" || kind === "video") && <p className="text-[12px] text-ink-3">无法播放时可下载后使用支持的软件打开。</p>}
    {available && previewFailure === current.key && <p className="text-[12px] text-ink-3">当前浏览器未能预览此{label}，仍可尝试下载。</p>}
    <p className="break-all text-[12px] text-ink-3">{filename} · {label} · {current.content_type} · {assetSize(current.bytes)}（{current.bytes} 字节）{dimensions ? ` · ${dimensions}` : ""}{frames ? ` · ${frames}` : ""} · 状态 {status === "available" ? "可用" : status === "deleted" ? "已删除" : status === "deleting" ? "删除中" : status}</p>
    <div className="flex flex-wrap items-center gap-3 text-[13px]">
      {available && <>{kind === "image" && <a className="text-accent" href={url} target="_blank" rel="noreferrer">查看私有原图 ↗</a>}<a className="text-accent" href={url} download={filename}>下载{label}</a>{options && !issue && <Link className="text-accent" target="_blank" rel="noreferrer" to={`/admin/data-tools?view=images&reference=${encodeURIComponent(current.key)}`}>用作参考 ↗</Link>}</>}
      {(available || status === "deleting") && <Button size="sm" tone="danger" disabled={!!pending} onClick={() => { setFailure(false); setOpen(true); }}>{status === "deleting" ? "重试删除" : `删除${label}`}</Button>}
    </div>
    {available && uploadOptions && kind !== "text" && <MediaUploadAction asset={current} options={uploadOptions} />}
    {available && issue && kind === "image" && <p className="text-[12px] text-amber">{issue}，不能直接用作参考。</p>}
    <ReasonDialog open={open} title={status === "deleting" ? `重试删除${label}` : `删除私有${label}`} description={<><p>删除本地文件后不能再预览、播放、下载或用作参考；任务及结果记录会保留。活动或可恢复任务仍在使用此素材时，服务端会拒绝删除。</p>{failure && <p className="mt-2 text-hot">删除未完成。请按错误提示处理仍使用此素材的任务；已进入删除中的文件可重试。</p>}</>} requireReason={false} showOptionalReason={false} confirmLabel={`删除${label}`} danger busy={!!pending} onClose={close} onSubmit={async () => {
      const result = await run<PrivateAsset>("DELETE", `/api/admin/assets/${encodeURIComponent(current.key)}`, undefined, { label: "delete-asset", success: "删除状态已更新" });
      if (result) { setDeleted(result); onChange?.(result); return result.status === "deleted"; }
      setFailure(true); refresh.revalidate(); return false;
    }} />
  </div>;
}
