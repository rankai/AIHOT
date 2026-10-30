import { assetContentUrl, referenceIssue, type PrivateAsset } from "./image-types";
import { videoRoleLabels } from "./video-data";
import type { VideoOptions, VideoReferenceRow, VideoRole } from "./video-types";
import { Button, Field, Select } from "./ui";
export function VideoReferenceRoles({ rows, assets, options, disabled, onRole, onAdd, onRemoveRow, onRemoveAsset }: { rows: VideoReferenceRow[]; assets: PrivateAsset[]; options: VideoOptions; disabled: boolean; onRole: (id: number, role: VideoRole) => void; onAdd: (key: string) => void; onRemoveRow: (id: number) => void; onRemoveAsset: (key: string) => void }) {
  return <div className="space-y-3 rounded-control border border-line p-3" aria-label="视频参考角色">
    <p className="text-[13px] font-medium">参考角色行（{rows.length}/{options.maxReferenceRoles}）</p><p className="text-[12px] text-ink-3">首帧最多 {options.roles.first_frame} 行、末帧最多 {options.roles.last_frame} 行、参考图片最多 {options.roles.reference_image} 行。同图可分别承担首帧与末帧；按下列顺序提交，只按独立文件上传一次。</p>
    {rows.length === 0 && <p className="text-[12px] text-ink-4">请先上传或选择参考图片。</p>}
    {rows.map(row => {
      const asset = assets.find(asset => asset.key === row.fileKey), issue = asset ? referenceIssue(asset, options) : "本地素材未载入";
      return <div key={row.id} className="min-w-0 space-y-2 border-t border-line pt-3"><div className="flex items-center gap-3">{asset && !issue && <img src={assetContentUrl(asset.key)} alt={asset.metadata.filename} className="h-16 w-20 shrink-0 rounded-control bg-bg-sunk object-contain" loading="lazy" />}<p className="min-w-0 break-all text-[12px] text-ink-2">{asset?.metadata.filename ?? row.fileKey}</p></div>{issue && <p className="text-[12px] text-amber">{issue}；请移除此素材或角色行后重新选择。</p>}<Field label="此行角色"><Select aria-label={`视频参考角色 ${row.id}`} disabled={disabled} value={row.role} onChange={e => onRole(row.id, e.target.value as VideoRole)}>{(Object.keys(options.roles) as VideoRole[]).map(role => <option key={role} value={role}>{videoRoleLabels[role]}</option>)}</Select></Field><div className="flex flex-wrap gap-2"><Button size="sm" disabled={disabled || !!issue} onClick={() => onAdd(row.fileKey)}>增加同图角色</Button><Button size="sm" disabled={disabled} onClick={() => onRemoveRow(row.id)}>删除此角色行</Button><Button size="sm" disabled={disabled} onClick={() => onRemoveAsset(row.fileKey)}>移除此素材的全部角色</Button></div></div>;
    })}
  </div>;
}
