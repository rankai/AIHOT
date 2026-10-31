import { ToolSubmit } from '../tools/tool-submit';
import { useEffect, useRef, useState } from "react";
import { useAdminAction } from "./action";
import { assetKindLabels, assetUploadAccept, assetUploadFile } from "./asset-data";
import type { AssetUploadOptions } from "./asset-types";
import type { PrivateAsset } from "./image-types";
import { Button, Field, Input } from "./ui";

export function AssetUpload({ options, onUploaded }: { options: AssetUploadOptions; onUploaded: (asset: PrivateAsset) => void }) {
  const { run, pending } = useAdminAction();
  const [file, setFile] = useState<File | null>(null), [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null), input = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  return <div className="space-y-3">
    <Field label="上传本地素材" hint="单文件，仅上传到本地私有素材；尚未提交给供应商，也不创建采集或生成任务。"><Input ref={input} aria-label="上传私有素材" type="file" accept={assetUploadAccept(options)} disabled={!!pending} onChange={e => { setFile(e.target.files?.[0] ?? null); setMessage(null); }} /></Field>
    {file && <p className="break-all text-[12px] text-ink-3">已选：{file.name} · {file.size} 字节</p>}
    <div className="space-y-1 text-[12px] text-ink-3">{(["image", "audio", "video"] as const).map(kind => <p key={kind}>{assetKindLabels[kind]}：{options.formats.filter(format => format.kind === kind).map(format => format.extensions.map(extension => extension.toUpperCase()).join(" / ")).join("、")}；最多 {options.limits[`${kind}Bytes`] / 1_000_000} MB。</p>)}<p>1 MB = 1000000 字节。图片最多 {options.limits.imagePixels / 1_000_000} MP；GIF 按全部帧总像素计算，最多 {options.imageValidation.gif.totalFramePixels / 1_000_000} MP。BMP 仅支持未压缩。</p><details><summary className="cursor-pointer">BMP 格式限制</summary><p className="mt-1">支持的 DIB 头：{options.imageValidation.bmp.dibHeaders.join(" / ")}。</p></details><p>扩展名仅用于声明上传类型，实际文件字节由服务端核验；本地检查不保证所有音视频可在浏览器播放。m4a 可展示既有输出，但不属于本地输入支持格式。</p></div>
    <div className="flex flex-wrap gap-2"><ToolSubmit selection={{kind:"media-upload",free:true}} disabled={!file || !!pending} busy={pending === "private-upload"} onClick={async () => {
      if (!file || pending) return;
      let declared: File;
      try { declared = assetUploadFile(file, options); } catch (error) { setMessage((error as Error).message); return; }
      const form = new FormData(); form.append("file", declared);
      const active = new AbortController(); controller.current = active; setMessage(null);
      const asset = await run<PrivateAsset>("POST", "/api/admin/assets", form, { label: "private-upload", revalidate: false, signal: active.signal });
      if (controller.current === active) controller.current = null;
      if (!asset) { setMessage(active.signal.aborted ? "上传已取消，文件已保留；重试会沿用同一上传命令，不静默重复。" : "上传未完成，文件已保留；请按错误提示修正或重试。"); return; }
      onUploaded(asset); setFile(null); if (input.current) input.current.value = "";
      setMessage(`已保存本地私有素材：${asset.metadata.filename}；尚未提交供应商。`);
    }}>上传私有素材到本地</ToolSubmit>{pending === "private-upload" && <Button onClick={() => controller.current?.abort()}>取消素材上传</Button>}</div>
    {message && <p role="status" className="break-all text-[12.5px] text-ink-3">{message}</p>}
  </div>;
}
