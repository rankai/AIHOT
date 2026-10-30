import { ReplicateVideoForm, type ReplicateAsset } from "../tools/replicate-video-form";
import type { ToolAsset } from "@aihot/contracts/user-tools";
import { TalkingVideoForm } from "../tools/talking-video-form";
import { useVideoMode, VideoModeTabs } from "../tools/video-modes";
import { mergeAssetRows } from "./asset-data";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAdminAction } from "./action";
import type { AssetUploadOptions } from "./asset-types";
import { ImageReferences } from "./image-references";
import { imageReferenceReuseId } from "./image-model-data";
import { assetContentUrl, referenceIssue, type AssetPage, type ImageOptions, type PrivateAsset } from "./image-types";
import type { OperationAccepted } from "./operation-types";
import { removeVideoAsset, removeVideoRole, videoDraft, videoFileKeys, videoGenerationBody, videoQueryBody, videoReferenceAssets, videoReferenceIssue } from "./video-data";
import { VideoReferenceRoles } from "./video-references";
import type { VideoDraft, VideoOptions, VideoRole } from "./video-types";
import { Button, Card, Field, Input, Select, Textarea } from "./ui";
type VideoFormProps = { options: VideoOptions; imageOptions: ImageOptions; assets: AssetPage; uploadOptions: AssetUploadOptions; updates: PrivateAsset[]; onAssetChange: (asset: PrivateAsset) => void; reference: PrivateAsset | null; referenceError: string | null; initialUploadResult?: string; initialTaskId?: string };
const talkingAsset = (asset: PrivateAsset, options: VideoOptions): ToolAsset => ({ key: asset.key, filename: asset.metadata.filename, contentType: asset.content_type, bytes: asset.bytes, width: asset.metadata.width ?? undefined, height: asset.metadata.height ?? undefined, createdAt: asset.created_at ?? "", contentUrl: assetContentUrl(asset.key), status: referenceIssue(asset, options) ? "unavailable" : "available" });

export function VideoForm(props: VideoFormProps) {
  const { mode, change } = useVideoMode();
  const navigate = useNavigate(), { run, pending } = useAdminAction();
  const assets = mergeAssetRows(props.assets.items, props.updates).map(asset => talkingAsset(asset, props.options));
  return <div className="space-y-5">
    <VideoModeTabs mode={mode} change={change} idPrefix="admin-video" />
    <div id="admin-video-text" role="tabpanel" aria-labelledby="admin-video-text-tab" hidden={mode !== "text"}><VideoDraftForm {...props} mode="text" reference={null} referenceError={null} initialUploadResult="" /></div>
    <div id="admin-video-image" role="tabpanel" aria-labelledby="admin-video-image-tab" hidden={mode !== "image"}><VideoDraftForm {...props} mode="image" /></div>
    <div id="admin-video-talking" role="tabpanel" aria-labelledby="admin-video-talking-tab" hidden={mode !== "talking"}><Card title="AI口播"><TalkingVideoForm options={props.options} assets={assets} uploadOptions={props.uploadOptions} pending={!!pending} submitLabel="提交 AI口播" uploadAsset={async body => {
      const result = await run<PrivateAsset>("POST", "/api/admin/assets", body, { label: "talking-upload", revalidate: false });
      if (!result) return null;
      props.onAssetChange(result); return talkingAsset(result, props.options);
    }} submit={async (_kind, body) => {
      const result = await run<OperationAccepted>("POST", "/api/admin/redfox/videos", body, { label: "talking-video", revalidate: false });
      if (result) navigate(`/admin/operations/${result.runId}`);
    }} /><p className="mt-4 text-[12px] text-ink-3">管理员提交后直接执行，使用现有视频、素材上传与轮询预算。生成文件保存在私有素材中。</p></Card></div>
    <div id="admin-video-replicate" role="tabpanel" aria-labelledby="admin-video-replicate-tab" hidden={mode !== "replicate"}><Card title="视频复刻"><ReplicateVideoForm assets={mergeAssetRows(props.assets.items, props.updates).map(replicateAsset)} pending={!!pending} submitLabel="提交视频复刻" uploadAsset={async body => {
      const result = await run<PrivateAsset>("POST", "/api/admin/assets", body, { label: "replicate-upload", revalidate: false });
      if (!result) return null; props.onAssetChange(result); return replicateAsset(result);
    }} submit={async (_kind, body) => {
      const result = await run<OperationAccepted>("POST", "/api/admin/aliyun/videos", body, { label: "replicate-video", revalidate: false });
      if (result) navigate(`/admin/operations/${result.runId}`);
    }} /><p className="mt-4 text-[12px] text-ink-3">阿里云万相 wan2.2-animate-mix。标准/专业公开估价为输出每秒 0.6/0.9 元，另有 OSS 存储与流量费用；管理员提交直接执行。暂停或保存失败后请从原任务恢复。</p></Card></div>
    {mode !== "replicate" && <VideoTaskQuery initialTaskId={props.initialTaskId ?? ""} />}
  </div>;
}

function VideoDraftForm({ options, imageOptions, assets, uploadOptions, updates, onAssetChange, reference, referenceError, initialUploadResult = "", mode }: VideoFormProps & { mode: "text" | "image" }) {
  const navigate = useNavigate(), { run, pending } = useAdminAction();
  const reuseId = imageReferenceReuseId(initialUploadResult), initialIssue = reference ? referenceIssue(reference, options) : null;
  const reuseIssue = initialUploadResult && !reuseId ? "上传复用记录无效，未自动选择参考；请从上传结果重新打开。" : null;
  const [draft, setDraft] = useState<VideoDraft>(() => {
    const initial = videoDraft(options);
    if (reference && !initialIssue && !reuseIssue) { initial.selected = [reference]; initial.roles = [{ id: 1, fileKey: reference.key, role: "reference_image" }]; if (reuseId) initial.confirmedUploads = { [reference.key]: reuseId }; }
    return initial;
  });
  const sequence = useRef(draft.roles.length), [uploading, setUploading] = useState(false), [notice, setNotice] = useState<string | null>(referenceError ?? initialIssue ?? reuseIssue);
  const selected = videoReferenceAssets(draft.selected, updates), current = { ...draft, selected }, issue = mode === "image" && !draft.roles.length ? "图生视频至少需要一张参考图片。" : videoReferenceIssue(current, options), disabled = !!pending || uploading;
  const keys = videoFileKeys(draft.roles), confirmed = keys.filter(key => draft.confirmedUploads[key] !== undefined);
  const referenceOptions = { ...imageOptions, referenceBytes: options.referenceBytes, referencePixels: options.referencePixels, maxReferences: options.maxReferenceRoles };
  const change = (patch: Partial<VideoDraft>) => setDraft(previous => ({ ...previous, ...patch }));
  const removeAsset = (key: string) => setDraft(previous => removeVideoAsset(previous, key));
  const addRole = (fileKey: string) => { const id = ++sequence.current; setDraft(previous => ({ ...previous, roles: [...previous.roles, { id, fileKey, role: "reference_image" }] })); };
  const select = (asset: PrivateAsset) => {
    if (selected.some(row => row.key === asset.key)) return;
    const id = ++sequence.current;
    setDraft(previous => ({ ...previous, selected: [...videoReferenceAssets(previous.selected, updates).filter(row => !referenceIssue(row, options)), asset], roles: [...previous.roles, { id, fileKey: asset.key, role: "reference_image" }] }));
  };
  return <Card title={mode === "text" ? "文生视频" : "图生视频"} right={<span>{options.modelLabel}</span>}><form aria-label={mode === "text" ? "文生视频制作表单" : "图生视频制作表单"} className="space-y-4" onSubmit={async e => {
    e.preventDefault(); if (disabled || issue) return;
    let body: ReturnType<typeof videoGenerationBody>;
    try { body = videoGenerationBody(current, options); setNotice(null); } catch (error) { setNotice((error as Error).message); return; }
    const result = await run<OperationAccepted>("POST", "/api/admin/redfox/videos", body, { label: "video", revalidate: false });
    if (result) navigate(`/admin/operations/${result.runId}`);
  }}>
    <Field label="视频描述" hint="最多 10000 字符；换行与首尾空白原样提交。生成的视频独立保存到私有素材，不会自动发布。"><Textarea aria-label="视频描述" required maxLength={10000} rows={5} value={draft.prompt} disabled={disabled} onChange={e => change({ prompt: e.target.value })} /></Field>
    <div className="grid gap-3 sm:grid-cols-3"><Field label="视频比例"><Select aria-label="视频比例" value={draft.aspectRatio} disabled={disabled} onChange={e => change({ aspectRatio: e.target.value })}>{options.aspectRatios.map(value => <option key={value} value={value}>{value === "adaptive" ? "自适应（adaptive）" : value}</option>)}</Select></Field><Field label="输出时长（秒）"><Select aria-label="视频输出时长" value={draft.duration} disabled={disabled} onChange={e => change({ duration: Number(e.target.value) })}>{Array.from({ length: options.durationSeconds.max - options.durationSeconds.min + 1 }, (_, i) => options.durationSeconds.min + i).map(value => <option key={value} value={value}>{value} 秒</option>)}</Select></Field><Field label="视频分辨率"><Select aria-label="视频分辨率" value={draft.resolution} disabled={disabled} onChange={e => change({ resolution: e.target.value })}>{options.resolutions.map(value => <option key={value} value={value}>{value}</option>)}</Select></Field></div>
    <div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" aria-label="生成音频" checked={draft.generateAudio} disabled={disabled} onChange={e => change({ generateAudio: e.target.checked })} className="accent-[var(--accent)]" />生成音频（输出声音，不是上传音频参考）</label><label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" aria-label="返回末帧" checked={draft.returnLastFrame} disabled={disabled} onChange={e => change({ returnLastFrame: e.target.checked })} className="accent-[var(--accent)]" />返回末帧图片</label></div>
    {notice && <p role="status" className="break-words rounded-control bg-amber/10 p-3 text-[13px] text-amber">{notice}</p>}
    {mode === "image" && <>
    <ImageReferences emptyHint="请至少选择一张图片，再描述动作与镜头变化。" options={referenceOptions} initialPage={assets} selected={selected.filter(asset => !referenceIssue(asset, options))} onSelect={select} onRemove={removeAsset} disabled={!!pending} onUploadingChange={setUploading} uploadOptions={uploadOptions} updates={updates} onAssetChange={onAssetChange} />
    <VideoReferenceRoles rows={draft.roles} assets={selected} options={options} disabled={disabled} onRole={(id, role: VideoRole) => change({ roles: draft.roles.map(row => row.id === id ? { ...row, role } : row) })} onAdd={addRole} onRemoveAsset={removeAsset} onRemoveRow={id => setDraft(previous => removeVideoRole(previous, id))} />
    </>}
    {issue && <p role="alert" className="text-[13px] text-hot">{issue}</p>}
    {confirmed.length > 0 && <p className="text-[12.5px] text-ink-3">已明确复用 {confirmed.length} 个文件的成功上传记录；同图各角色沿用同一记录。远端地址可能过期，失败不会自动补传；移除此素材会清除复用关系。</p>}
    <div className="space-y-1 rounded-control bg-bg-sunk p-3 text-[12.5px] text-ink-3"><p>本次独立参考文件 {keys.length} 个，最多上传其中 {keys.length - confirmed.length} 个未确认文件、提交生成 1 次；最多轮询 {options.limits.polls} 轮（异常重试另计次数预算），最长 {options.limits.pollDeadlineSeconds / 3600} 小时。</p><p>公开文档基价 {options.documentedBaseCny} 元；计量和整轮费用未核实，不按秒推算。轮询文档基价 {options.pollBaseCny} 元，免费调用仍占 poll 次数预算；参考上传使用 media，生成使用 video 预算。</p><p>本地保存视频最多 {options.outputVideoBytes / 1_000_000} MB，末帧图片最多 {options.outputImageBytes / 1024 / 1024} MiB、{options.outputImagePixels / 1_000_000} MP。</p><p>执行及生成文件下载须同时开启模型与 Redfox 外发开关；停止本地处理不取消远端生成，也不保证退款。生成提交即执行，无额外确认。</p></div>
    <Button type="submit" tone="primary" disabled={disabled || !!issue || !draft.prompt.trim()} busy={pending === "video"}>{mode === "text" ? "提交文生视频" : "提交图生视频"}</Button>
  </form></Card>;
}

function VideoTaskQuery({ initialTaskId }: { initialTaskId: string }) {
  const navigate = useNavigate(), { run, pending } = useAdminAction();
  const [taskId, setTaskId] = useState(initialTaskId), [notice, setNotice] = useState<string | null>(null);
  const disabled = !!pending;
  return <Card title="查询已有视频任务"><form aria-label="已有视频任务查询" className="space-y-3" onSubmit={async e => {
    e.preventDefault(); if (disabled) return;
    let body: ReturnType<typeof videoQueryBody>;
    try { body = videoQueryBody(taskId); setNotice(null); } catch (error) { setNotice((error as Error).message); return; }
    const result = await run<OperationAccepted>("POST", "/api/admin/redfox/videos/query", body, { label: "video-query", revalidate: false }); if (result) navigate(`/admin/operations/${result.runId}`);
  }}><Field label="已有视频任务 ID" hint="最多 500 字符，原串保留；只查询和保存已有任务，不提交新生成。"><Input aria-label="视频任务 ID" required maxLength={500} value={taskId} disabled={disabled} onChange={e => setTaskId(e.target.value)} /></Field><p className="text-[12px] text-ink-3">查询同样受 poll 次数预算和冻结轮次、时限控制；保存生成文件仍需外发开关。</p><Button type="submit" disabled={disabled || !taskId.trim()} busy={pending === "video-query"}>查询已有视频任务</Button></form>{notice && <p role="alert">{notice}</p>}</Card>;
}

function replicateAsset(asset: PrivateAsset): ReplicateAsset { return { key: asset.key, filename: asset.metadata.filename, contentType: asset.content_type, bytes: asset.bytes, status: asset.status, contentUrl: `/api/admin/assets/${encodeURIComponent(asset.key)}/content` }; }
