import { Link } from "react-router";
import { imageParameterRows, imageProviderStatuses, imageSavedTaskFacts, imageTaskModel } from "./image-model-data";
import type { ImageOptions } from "./image-types";
import type { OperationDetail } from "./operation-types";
import { ResearchFacts } from "./research-platform-result";
const steps: Record<string, string> = { "redfox.image.upload": "上传或复用参考图", "redfox.image.submit": "提交图片生成", "redfox.image.poll": "等待并查询生成进度", "redfox.image.save": "保存图片到本地私有素材" };
export function ImageProgress({ operation: r, options }: { operation: OperationDetail; options: ImageOptions | null }) {
  const facts = imageSavedTaskFacts(r), taskId = facts.taskId, model = imageTaskModel(r.inputs.parameters, options);
  const progress = typeof r.progress.providerProgress === "number" ? r.progress.providerProgress : facts.latest?.data.progress;
  const plan = r.inputs.imagePlan;
  const unknownSubmission = r.receipt?.status === "unknown" && ["redfox.image.upload", "redfox.image.submit"].includes(r.step);
  const query = new URLSearchParams({ view: "images", imageModel: model?.model ?? "gptImage2", ...(taskId ? { taskId } : {}) });
  return <div className="mb-4 min-w-0 space-y-3 border-b border-line pb-4 text-[13px]">
    <div className="font-medium text-ink">{model?.label ?? "图片模型见冻结参数"} · {r.status === "completed" ? "图片已保存" : r.status === "failed" ? "本轮已结束" : r.status === "stopped" ? "本地处理已停止" : r.status === "needs_review" ? "需要人工核对" : steps[r.step] ?? "处理图片任务"}</div>
    {typeof progress === "number" && Number.isFinite(progress) && progress >= 0 && progress <= 100 && <div><label className="mb-1 flex items-center justify-between gap-2 text-[12px] text-ink-3" htmlFor={`image-progress-${r.id}`}><span>最近实收生成进度（不是 usage 用量）</span><span>{progress}%</span></label><progress id={`image-progress-${r.id}`} value={progress} max={100} className="h-2 w-full accent-[var(--accent)]" /></div>}
    {taskId && <p className="whitespace-pre-wrap break-all text-ink-3">供应商任务 ID：{taskId}</p>}
    {facts.latest && typeof facts.latest.data.status === "string" && <p className="text-[12px] text-ink-3">本页最近已保存状态：{imageProviderStatuses[facts.latest.data.status] ?? facts.latest.data.status}。仅代表当前结果页的响应事实，当前业务状态以上方任务状态为准。</p>}
    {unknownSubmission && <p className="rounded-control bg-amber/10 p-3 text-amber">此次{r.step === "redfox.image.upload" ? "参考上传" : "生成提交"}结果未知，保持人工核对，不会自动重发。恢复按钮也不会绕过未知回执重新购买；若已取得生成任务 ID，可单独查询该任务。</p>}
    {r.step === "redfox.image.save" && r.status !== "completed" && <p className="text-ink-3">恢复将继续保存原任务图片，不重新生成；仍需下载远端文件时必须同时开启模型与 Redfox 外发开关。已收完整本地文件可继续完成保存。</p>}
    <Link className="inline-block text-accent" target="_blank" rel="noreferrer" to={`/admin/redfox?${query}`}>查询已有图片任务{taskId ? "（带入模型与任务 ID）" : " ID"} ↗</Link>
    <details className="rounded-control bg-bg-sunk p-3"><summary className="cursor-pointer text-[12px] text-ink-3">本次生成参数与次数上限</summary><div className="mt-3 space-y-3">
      <ResearchFacts items={imageParameterRows(r.inputs.parameters)} />
      {facts.rows.length > 0 && <><p className="text-[12px] text-ink-3">本页最近响应实收参数（不替代冻结输入）</p><ResearchFacts items={facts.rows} /></>}
      {plan && <p className="text-[12px] text-ink-3">本轮冻结上限：参考上传步骤 {plan.referenceUploadLimit} 个、生成提交步骤 {plan.submissionLimit} 个，最多轮询 {plan.pollLimit} 轮（异常重试另计次数预算），最长 {plan.pollDeadlineSeconds / 3600} 小时。明确选择的引用可复用，不保证远端地址持续有效。免费调用也占次数预算；估价与实扣请核对预算和回执。</p>}
      <p className="text-[12px] text-ink-4">模型名称按 Redfox 文档展示。图片作为独立产物保存，不会自动用于新闻；usage 保留为诊断用量字段，不作为百分比进度。</p>
    </div></details>
  </div>;
}
