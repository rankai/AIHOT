import { Link } from "react-router";
import type { OperationDetail } from "./operation-types";
import { videoFactRows, videoFileKeys, videoLastFrameMissing, videoProviderStatuses, videoRoleLabels, videoTaskFacts } from "./video-data";
import type { VideoReferenceRow, VideoRole } from "./video-types";
import { researchFactText } from "./research-platform-data";
import { ResearchFacts } from "./research-platform-result";
const steps: Record<string, string> = { "redfox.video.upload": "上传或复用参考图片", "redfox.video.submit": "提交视频生成", "redfox.video.poll": "等待并查询视频进度", "redfox.video.save": "保存视频与已返回末帧" };
export function VideoProgress({ operation: r }: { operation: OperationDetail }) {
  const facts = videoTaskFacts(r), plan = r.inputs.videoPlan, parameters = r.inputs.parameters ?? {}, refs = Array.isArray(parameters.imageWithRoles) ? parameters.imageWithRoles as VideoReferenceRow[] : [];
  const missing = r.results.some(result => result.kind === "video" && result.data.role === "video" && videoLastFrameMissing(result.data));
  const query = new URLSearchParams({ view: "videos", ...(facts.taskId ? { videoTaskId: facts.taskId } : {}) });
  return <div className="mb-4 min-w-0 space-y-3 border-b border-line pb-4 text-[13px]">
    <p className="font-medium">Redfox Seedance · {r.status === "completed" ? "已保存收到的产物" : r.status === "failed" ? "本轮已结束" : r.status === "stopped" ? "本地处理已停止" : r.status === "needs_review" ? "需要人工核对" : steps[r.step] ?? "处理视频任务"}</p>
    {facts.taskId && <p className="whitespace-pre-wrap break-all text-ink-3">供应商任务 ID：{facts.taskId}</p>}
    {facts.progress !== null && <div><label className="mb-1 flex justify-between gap-3 text-[12px] text-ink-3" htmlFor={`video-progress-${r.id}`}><span>最近实收进度</span><span>{facts.progress}%</span></label><progress id={`video-progress-${r.id}`} value={facts.progress} max={100} className="h-2 w-full accent-[var(--accent)]" /></div>}
    {facts.latest && <p className="text-[12px] text-ink-3">本页最近供应商事实：{typeof facts.latest.data.status === "string" ? videoProviderStatuses[facts.latest.data.status] ?? facts.latest.data.status : "提交已记录"}。仅代表当前结果页，当前业务状态以上方本地任务状态为准。</p>}
    {missing && <p className="rounded-control bg-amber/10 p-3 text-[12px] text-amber">收到视频已保存，未返回请求的末帧；可查询已有任务核对。不会自动重新生成或补发请求。</p>}
    {r.receipt?.status === "unknown" && ["redfox.video.upload", "redfox.video.submit"].includes(r.step) && <p className="text-[12px] text-amber">上传或提交结果未知，保持人工核对，不会自动重发；恢复不会绕过未知回执重新购买。</p>}
    {r.step === "redfox.video.save" && <p className="text-[12px] text-ink-3">恢复继续保存原任务地址，不重新生成。远端下载须同时开启模型与 Redfox 外发开关；已收完整本地文件可继续登记。</p>}
    {plan && <p className="text-[12px] text-ink-3">本轮冻结限额：独立参考上传步骤 {plan.referenceUploadLimit} 个、提交步骤 {plan.submissionLimit} 个，最多轮询 {plan.pollLimit} 轮（异常重试另计次数预算），最长等待 {plan.pollDeadlineSeconds} 秒。免费轮询仍占次数预算。</p>}
    <p className="text-[12px] text-ink-3">停止只停止本地后续处理，不取消远端生成或保证退款。视频和实际返回的末帧分别保存为私有素材，不自动用于新闻。</p>
    <Link className="inline-block text-accent" target="_blank" rel="noreferrer" to={`/admin/redfox?${query}`}>查询已有视频任务{facts.taskId ? "（带入任务 ID）" : " ID"} ↗</Link>
    <details className="rounded-control bg-bg-sunk p-3"><summary className="cursor-pointer text-[12px] text-ink-3">视频冻结参数与本页实收字段</summary><div className="mt-3 space-y-3"><ResearchFacts items={[["描述", Object.hasOwn(parameters, "prompt") ? researchFactText(parameters.prompt) : "已有任务查询，未提交新描述"], ...["aspectRatio", "duration", "resolution", "generateAudio", "returnLastFrame"].filter(key => Object.hasOwn(parameters, key)).map(key => [key === "duration" ? "请求时长（秒）" : key, researchFactText(parameters[key])] as [string, string])]} />
      {refs.length > 0 && <div className="space-y-1 text-[12px] text-ink-3"><p>角色行 {refs.length} 个，独立文件 {videoFileKeys(refs).length} 个（按以下顺序提交）</p>{refs.map((ref, index) => <p className="break-all" key={index}>{index + 1}. {videoRoleLabels[ref.role as VideoRole] ?? ref.role} · {ref.fileKey}</p>)}</div>}
      {facts.latest && <><p className="text-[12px] text-ink-3">本页最近响应实收参数；metadata 不作为本地时长验证，usage 不作为百分比进度。</p><ResearchFacts items={videoFactRows(facts.latest.data)} /></>}
    </div></details>
  </div>;
}
