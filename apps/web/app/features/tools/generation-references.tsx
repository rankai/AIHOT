import type { ToolAsset } from "@aihot/contracts/user-tools";
import { Select } from "../admin/ui";
import { ToolField as Field } from "./fields";

export function ReferencePicker({ assets, selected, max, change, required = false }: { required?: boolean; assets: ToolAsset[]; selected: string[]; max: number; change: (keys: string[]) => void }) {
  const choices = assets.filter(asset => asset.status === "available" && ["image/png", "image/jpeg", "image/webp"].includes(asset.contentType));
  return <fieldset className="rounded-control border border-line p-3"><legend className="px-1 text-[13px] font-medium text-ink-2">参考图片（{required ? "至少 1 张" : "可选"}，最多 {max} 张）</legend>
    {!choices.length ? <p className="text-[13px] text-ink-3">{required ? "可在上方上传 PNG、JPEG 或 WebP 图片。" : "先在‘私有素材’中上传 PNG、JPEG 或 WebP 图片。"}</p> : <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">{choices.map(asset => <label key={asset.key} className="flex min-w-0 items-center gap-2 rounded-control p-2 hover:bg-bg-sunk"><input type="checkbox" checked={selected.includes(asset.key)} disabled={!selected.includes(asset.key) && selected.length >= max} onChange={event => change(event.target.checked ? [...selected, asset.key] : selected.filter(key => key !== asset.key))} /><img src={asset.contentUrl} alt="" loading="lazy" className="size-10 rounded object-cover" /><span className="truncate text-[12px]">{asset.filename}</span></label>)}</div>}
  </fieldset>;
}

export function UploadPicker({ assets, selected, values, change }: { assets: ToolAsset[]; selected: string[]; values: Array<{ fileKey: string; resultId: number }>; change: (values: Array<{ fileKey: string; resultId: number }>) => void }) {
  return <>{selected.map(key => {
    const asset = assets.find(row => row.key === key);
    if (!asset?.uploads?.length) return null;
    return <Field key={key} label={`${asset.filename}的上传方式`} hint="选择已有上传结果可避免再次上传；失效时会提示错误，不会自动重新上传。"><Select value={values.find(row => row.fileKey === key)?.resultId ?? ""} onChange={event => change([...values.filter(row => row.fileKey !== key), ...(event.target.value ? [{ fileKey: key, resultId: Number(event.target.value) }] : [])])}><option value="">本次上传</option>{asset.uploads.map(upload => <option key={upload.resultId} value={upload.resultId}>复用上传 #{upload.resultId} · {new Date(upload.createdAt).toLocaleString("zh-CN")}</option>)}</Select></Field>;
  })}</>;
}
