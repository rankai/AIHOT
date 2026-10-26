import { Link } from "react-router";
import { nativeVideoConfig, nativeVideoConfigChange, videoDownloadReason, type VideoDownloadLatest } from "./subscription-video-data";
import { OperationBadge } from "./operation-ui";
export function VideoDownloadSetting({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (enabled: boolean) => void }) {
  return <div className="space-y-2 rounded-control border border-line p-3 text-[13px] text-ink-3"><label className="inline-flex items-center gap-2 text-ink-2"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />自动保存已入库视频</label><p>仅对成功入库且已确认包含视频的材料私有保存。单文件不超过 50 MB（50,000,000 字节），超限尝试同一视频已证实的可用备选；首次保存起 30 天后自动删除，重复引用不续期。</p><p>先使用采集所得地址，缺少可用地址时，已接通解析的平台固定使用 Redfox 媒体解析，可能额外计费，受 <Link className="text-accent" to="/admin/settings">redfox.media 次数预算</Link>控制；没有对应解析接口则记录未保存原因，不保证所有平台或路线均可保存。采集供应商保持原样，预览不触发视频保存；需人工核验的作品仍须先确认入库。</p></div>;
}
export function NativeVideoDownloadSetting({ json, disabled, onChange }: { json: string; disabled?: boolean; onChange: (json: string) => void }) {
  const config = nativeVideoConfig(json);
  return <div className="mt-4"><VideoDownloadSetting checked={config?.autoDownloadVideo === true} disabled={disabled || !config} onChange={value => { const next = nativeVideoConfigChange(json, value); if (next) onChange(next); }} />{!config && <p role="status" className="mt-2 text-[12px] text-amber">请先将采集配置修正为合法 JSON 对象，再调整视频保存；当前草稿已保留。</p>}</div>;
}
export function VideoDownloadLatestView({ value }: { value?: VideoDownloadLatest | null }) {
  if (!value) return null;
  return <div className="space-y-1 text-[12px] text-ink-3"><Link className="text-accent" to={`/admin/operations/${value.lastRunId}`}>最近视频保存 #{value.lastRunId}</Link><div><OperationBadge status={value.status} /></div><p>本次已保存 {value.saved} · 未保存 {value.notSaved}（非累计）</p>{value.reason && <p>{videoDownloadReason(value.reason)}</p>}</div>;
}
