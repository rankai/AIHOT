import { useState } from "react";
import type { ToolResult } from "@aihot/contracts/user-tools";
import { Lightbox } from "../../components/ui/Lightbox";
import { availableResultFile, resultTitle } from "./result-data";

function FileMetadata({ result }: { result: ToolResult }) {
  const { file, details } = result;
  const width = file?.width ?? details.width, height = file?.height ?? details.height;
  const duration = details.durationSeconds ?? details.duration;
  const parts = [width && height ? `${width} × ${height}` : details.resolution ?? details.size,
    duration !== undefined && duration !== null ? `${duration}${details.durationSeconds !== undefined || details.durationUnit === "seconds" ? " 秒" : ""}` : null,
    file?.bytes ? file.bytes >= 1_048_576 ? `${(file.bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.bytes / 1024))} KB` : null];
  return <p className="text-[12px] text-ink-3">{parts.filter(Boolean).join(" · ")}</p>;
}

function MissingFile({ image = false }: { image?: boolean }) {
  return <div role="status" className={`${image ? "aspect-[4/3]" : "min-h-40"} flex items-center justify-center rounded-control bg-bg-sunk p-6 text-center text-[13px] leading-6 text-ink-3`}>文件已过期、删除或未保存。<br />任务结果记录仍然保留。</div>;
}

export function ToolImageResults({ results, lastFrames = false }: { results: ToolResult[]; lastFrames?: boolean }) {
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const available = results.flatMap(result => {
    const file = availableResultFile(result);
    return file?.contentType.startsWith("image/") && !failedSources.has(file.contentUrl) ? [{ id: result.id, src: file.contentUrl, alt: resultTitle(result, "生成图片") }] : [];
  });
  const previewIndex = available.findIndex(image => image.id === previewId);
  return <>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{results.map((result, index) => {
      const file = availableResultFile(result), isImage = file?.contentType.startsWith("image/"), failed = !!file && failedSources.has(file.contentUrl);
      const title = lastFrames ? results.length > 1 ? `视频末帧 ${index + 1}` : "视频末帧" : result.title === result.kind && results.length > 1 ? `生成图片 ${index + 1}` : resultTitle(result, "生成图片");
      return <article key={result.id} className="card flex min-w-0 flex-col overflow-hidden p-3 sm:p-4">
        {file && isImage && !failed ? <button type="button" onClick={() => setPreviewId(result.id)} aria-label={`放大查看${title}`} className="group relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-control bg-bg-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <img src={file.contentUrl} alt={title} loading="lazy" decoding="async" onError={() => setFailedSources(previous => new Set(previous).add(file.contentUrl))} className="h-full w-full object-contain" />
          <span className="absolute bottom-2 right-2 rounded-mark bg-surface/90 px-2 py-1 text-[11px] text-ink-2">点击放大</span>
        </button> : failed ? <div role="status" className="flex aspect-[4/3] items-center justify-center rounded-control bg-bg-sunk p-5 text-center text-[13px] leading-6 text-ink-3">图片预览加载失败，可尝试下载文件。</div> : <MissingFile image />}
        <div className="mt-3 flex flex-1 flex-col gap-2">
          <h3 className="break-words text-[14px] font-medium text-ink">{title}</h3>
          <FileMetadata result={result} />
          {result.text && <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-ink-3">{result.text}</p>}
          {file && isImage && <a href={file.contentUrl} download={file.filename} className="mt-auto pt-1 text-[13px] text-accent underline underline-offset-2">{lastFrames ? "下载末帧" : "下载原图"}</a>}
        </div>
      </article>;
    })}</div>
    <Lightbox images={available} index={previewIndex < 0 ? null : previewIndex} onIndex={index => setPreviewId(available[index]?.id ?? null)} onClose={() => setPreviewId(null)} />
  </>;
}

export function ToolVideoResults({ results }: { results: ToolResult[] }) {
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  return <div className="space-y-4">{results.map(result => {
    const file = availableResultFile(result), playable = file?.contentType.startsWith("video/");
    return <article key={result.id} className="card space-y-3 p-4 sm:p-5">
      <h3 className="break-words text-[15px] font-semibold text-ink">{resultTitle(result, "生成视频")}</h3>
      {file && playable ? <>
        <video key={file.contentUrl} src={file.contentUrl} controls playsInline preload="metadata" aria-label={resultTitle(result, "生成视频")} onError={() => setFailedSources(previous => new Set(previous).add(file.contentUrl))} className="max-h-[560px] w-full rounded-control bg-bg-sunk">当前浏览器不支持视频播放，请下载视频查看。</video>
        {failedSources.has(file.contentUrl) && <p role="status" className="text-[13px] text-ink-3">视频加载失败或浏览器不支持此格式，可尝试下载文件。</p>}
      </> : <MissingFile />}
      <FileMetadata result={result} />
      {result.text && <p className="whitespace-pre-wrap break-words text-[14px] leading-7 text-ink-2">{result.text}</p>}
      {result.details.lastFrameMissing === true && <p className="text-[13px] text-ink-3">本次未取得视频末帧，视频结果仍可单独查看。</p>}
      {file && playable && <a href={file.contentUrl} download={file.filename} className="inline-block text-[13px] text-accent underline underline-offset-2">下载视频</a>}
    </article>;
  })}</div>;
}
