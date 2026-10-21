import { Link } from "react-router";
import type { OperationDetail } from "./operation-types";
import { ResearchFacts } from "./research-platform-result";
import { isTranscriptionPlatform, transcriptionPlatforms, transcriptionProviderStatus, transcriptionRunStage, transcriptionTaskFacts, transcriptionTextField } from "./transcription-data";

export function TranscriptionProgress({ operation: r }: { operation: OperationDetail }) {
  const task = transcriptionTaskFacts(r), plan = r.inputs.transcriptionPlan;
  const platform = isTranscriptionPlatform(r.inputs.platform) ? r.inputs.platform : null;
  const failure = task.latest ? transcriptionTextField(task.latest.data, "failReason") : null;
  const unknownSubmit = r.currentReceiptId !== null && r.receipt?.status === "unknown" && r.step === "redfox.transcript.submit";
  const query = new URLSearchParams({ view: "tools", ...(platform ? { transcriptionPlatform: platform } : {}), ...(task.executionTaskId ? { transcriptionTaskId: task.executionTaskId } : {}) });
  return <div className="mb-4 min-w-0 space-y-3 border-b border-line pb-4 text-[13px]">
    <div className="font-medium text-ink">{platform ? transcriptionPlatforms[platform] : "语音"} · {transcriptionRunStage(r.status, r.step)}</div>
    <ResearchFacts items={[...(task.actualTaskId ? [["本页最近响应任务 ID（实收）", task.actualTaskId]] as Array<[string, string]> : []), ...(task.requestedTaskId ? [["查询任务 ID（请求）", task.requestedTaskId]] as Array<[string, string]> : []), ...(!task.actualTaskId && !task.requestedTaskId && task.executionTaskId ? [["本轮执行任务 ID", task.executionTaskId]] as Array<[string, string]> : [])]} />
    {task.latest && <p className="break-words text-[12px] text-ink-3">本页最近已保存的供应商事实：{transcriptionProviderStatus(task.latest.kind, task.latest.data)}。仅代表当前结果页，不是全局最新记录；翻页可查看其他已保存结果，当前状态仍以上方本地任务状态为准。</p>}
    {task.latest?.data.status === "failed" && failure && <ResearchFacts items={[["本页最近失败原因", failure.text === "" ? "空字符串" : failure.text]]} />}
    {unknownSubmit && <p className="rounded-control bg-amber/10 p-3 text-[12px] text-amber">提交结果未知，请先核对回执，避免重复提交。若已取得供应商任务 ID，可单独查询已有任务；查询入口不会重新提交 ASR。</p>}
    {plan ? <p className="text-[12px] text-ink-3">本轮冻结上限：提交步骤 {plan.submissionLimit} 个，最多轮询 {plan.pollLimit} 轮（异常重试另计次数预算），最长等待 {plan.pollDeadlineSeconds} 秒。已有任务模式不提交新转写；免费查询也占 poll 次数预算。</p> : <p className="text-[12px] text-ink-4">此任务未提供冻结转写限额，请核对执行诊断；不使用当前全局配置代替。</p>}
    <p className="text-[12px] text-ink-3">停止只停止本地后续处理或轮询；不会取消供应商已受理转写，也不保证退款。转写不自动写入文章；成功结果可显式保存 TXT、关联已有材料或申请填入缺失正文，不发布、不改变权限。</p>
    <Link className="inline-block text-accent" to={`/admin/redfox?${query}`}>查询已有转写任务{task.executionTaskId ? "（带入可用任务 ID）" : " ID"}</Link>
  </div>;
}
