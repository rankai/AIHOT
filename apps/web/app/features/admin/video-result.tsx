import type { OperationResult } from "./operation-types";
import type { ImageOptions } from "./image-types";
import { operationFileAsset } from "./asset-data";
import { PrivateAssetView } from "./private-asset";
import { videoFactRows, videoFailureRows, videoLastFrameMissing, videoProviderStatuses } from "./video-data";
import { ResearchFacts } from "./research-platform-result";
import { Json } from "./ui";
export function VideoResult({ result: r, imageOptions }: { result: OperationResult; imageOptions: ImageOptions | null }) {
  const control = r.kind === "video_task", reference = r.kind === "video_reference", video = r.kind === "video", missing = videoLastFrameMissing(r.data);
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0"><div className="text-[14px] font-medium">{control ? "视频生成历史记录" : reference ? "视频参考上传记录" : video ? "生成的视频" : "实际返回的末帧图片"}</div>
    {control && <p className="text-[12px] text-ink-3">供应商事实：{typeof r.data.status === "string" ? videoProviderStatuses[r.data.status] ?? r.data.status : "提交已记录"}。本条为历史响应，当前本地处理状态以上方进度为准。</p>}
    <ResearchFacts items={videoFactRows(r.data)} />
    <ResearchFacts items={videoFailureRows(r.data)} />
    {missing && <p className="rounded-control bg-amber/10 p-3 text-[12px] text-amber">{video ? "收到视频已保存，未返回请求的末帧；可查询已有任务核对。" : "本次响应未返回请求的末帧；视频是否保存以上方本地状态与实际结果为准。"}不会自动重新生成或补发请求。</p>}
    {!control && <PrivateAssetView asset={operationFileAsset(r.file)} options={imageOptions} />}
    {!control && !reference && <p className="text-[12px] text-ink-3">视频和末帧图片保存到私有素材，可在后台预览、播放或下载，不会自动发布。播放器使用本地文件。</p>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="视频任务字段与回执诊断" />
  </article>;
}
