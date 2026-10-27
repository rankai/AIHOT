import { Link } from "react-router";
import type { OperationDetail } from "./operation-types";
import { researchFactText } from "./research-platform-data";
import { ResearchFacts } from "./research-platform-result";
import { xhsCommentEmptyMessage, xhsCommentStatuses, xhsCommentTaskFacts, xhsCommentTaskRows } from "./xhs-comment-data";
export function XhsCommentProgress({ operation: r }: { operation: OperationDetail }) {
  const facts = xhsCommentTaskFacts(r), plan = r.inputs.xhsCommentPlan;
  const query = new URLSearchParams({ view: "tools", ...(facts.taskId ? { xhsCommentTaskId: facts.taskId } : {}) });
  const stage = r.status === "completed" ? "本轮评论查询已结束" : r.status === "failed" ? "本轮已结束" : r.status === "stopped" ? "本地查询已停止" : r.status === "needs_review" ? "需要人工核对" : r.step === "redfox.xhs_comments.submit" ? "提交评论任务" : "等待或查询已有评论任务";
  return <div className="mb-4 min-w-0 space-y-3 border-b border-line pb-4 text-[13px]">
    <p className="font-medium">小红书异步评论 · {stage}</p>
    {facts.taskId && <p className="whitespace-pre-wrap break-all text-ink-3">供应商任务 ID：{facts.taskId}</p>}
    {facts.latest && <p className="text-[12px] text-ink-3">本页最近供应商状态：{typeof facts.latest.data.status === "string" ? xhsCommentStatuses[facts.latest.data.status] ?? facts.latest.data.status : "未提供"}。仅代表当前结果页，当前业务状态以上方本地任务状态为准；received 是条数事实，不是完成百分比。</p>}
    {facts.visible && <ResearchFacts items={[["本页已收 visibleAfterTime（原串，时区未核实）", researchFactText(facts.visible.data.visibleAfterTime)]]} />}
    <p className="text-[12px] text-ink-3">本页评论记录 {facts.pageCommentCount} 条，与某次响应的 dataNum / received / actualCount 分别保留，不强制相等。</p>
    {facts.pageCommentCount === 0 && <p className="text-[12px] text-ink-4">{xhsCommentEmptyMessage(r.results)}</p>}
    {plan && <p className="text-[12px] text-ink-3">本轮冻结限额：提交步骤 {plan.submissionLimit} 个，最多轮询 {plan.pollLimit} 轮，期限 {plan.pollDeadlineSeconds / 3600} 小时，从本地任务创建起算（预算等待也计入）。这是本地限额，不保证上游完成；到期需要核对并可用保留的任务 ID 显式新建只查任务。</p>}
    {plan?.submissionLimit === 1 && <p className="text-[12px] text-ink-3">首次自动查询按本地收到提交回执后 24 小时安排，随后约每 1 小时查询；具体下次尝试见下方系统时间。visibleAfterTime 不用于换算本地时区。</p>}
    {plan?.submissionLimit === 0 && <p className="text-[12px] text-ink-3">此轮仅查询已有任务，不重新提交；后续约每 1 小时查询。</p>}
    {r.receipt?.status === "unknown" && r.step === "redfox.xhs_comments.submit" && <p className="text-[12px] text-amber">提交结果未知，先人工核对回执，不自动重发购买。已取得任务 ID 时可显式查询已有任务。</p>}
    <p className="text-[12px] text-ink-3">停止只停止本地查询，不取消远端任务或保证退款。轮询是只读请求，每个查询请求异常最多重试一次，仍计次数预算；评论不作为文章或作品作者绑定。</p>
    <Link className="inline-block text-accent" target="_blank" rel="noreferrer" to={`/admin/redfox?${query}#xhs-comments`}>查询已有小红书评论任务{facts.taskId ? "（带入任务 ID）" : " ID"} ↗</Link>
    <details className="rounded-control bg-bg-sunk p-3"><summary className="cursor-pointer text-[12px] text-ink-3">评论冻结输入与本页实收条数</summary><div className="mt-3 space-y-3"><ResearchFacts items={Object.entries(r.inputs.parameters ?? {}).map(([key, value]) => [`请求 ${key}`, researchFactText(value)])} />{facts.latest && <ResearchFacts items={xhsCommentTaskRows(facts.latest.data)} />}</div></details>
  </div>;
}
