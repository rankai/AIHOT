import { Link } from "react-router";
import { aiSearchFamilies, aiSearchStatus, aiSearchTaskFacts } from "./ai-search-data";
import type { OperationDetail } from "./operation-types";
import { ResearchFacts } from "./research-platform-result";
export function AiSearchProgress({ operation: r }: { operation: OperationDetail }) {
  const facts = aiSearchTaskFacts(r), plan = r.inputs.aiSearchPlan, family = r.inputs.family;
  const query = new URLSearchParams({ view: "ai-search", ...(family ? { aiSearchFamily: family } : {}), ...(facts.executionTaskId ? { aiSearchTaskId: facts.executionTaskId } : {}) });
  const stage = ["completed", "failed"].includes(r.status) ? "本轮已结束" : r.status === "stopped" ? "本地处理已停止" : r.status === "needs_review" ? "需要人工核对" : r.step === "redfox.ai_search.submit" ? "提交搜索问题" : "等待或查询回答";
  return <div className="mb-4 min-w-0 space-y-3 border-b border-line pb-4 text-[13px]">
    <p className="font-medium">{family ? aiSearchFamilies[family] ?? family : "AI 搜索"} · {stage}</p>
    <ResearchFacts items={[...(facts.actualTaskId ? [["本页最近响应任务 ID（实收）", facts.actualTaskId]] as Array<[string, string]> : []), ...(facts.requestedTaskId ? [["查询任务 ID（请求）", facts.requestedTaskId]] as Array<[string, string]> : []), ...(!facts.actualTaskId && !facts.requestedTaskId && facts.executionTaskId ? [["本轮执行任务 ID", facts.executionTaskId]] as Array<[string, string]> : [])]} />
    {facts.latest && <p className="text-[12px] text-ink-3">本页最近已保存的供应商事实：{aiSearchStatus(facts.latest.data)}。仅代表当前结果页，当前业务状态以上方本地任务状态为准。</p>}
    {r.nextAction === "review-unknown" && <p className="text-[12px] text-amber">结果未知，请先核对回执；提交不会自动重发。已取得任务 ID 时可查询已有任务，避免重复购买。</p>}
    {plan ? <p className="text-[12px] text-ink-3">本轮冻结限额：提交步骤 {plan.submissionLimit} 个，最多轮询 {plan.pollLimit} 轮（异常重试另计次数预算），最长等待 {plan.pollDeadlineSeconds} 秒。文档免费轮询仍占次数预算。</p> : <p className="text-[12px] text-ink-4">未提供冻结 AI 搜索限额，请核对诊断。</p>}
    <p className="text-[12px] text-ink-3">停止只停止本地处理，不取消远端搜索或保证退款。答案仅供研究。</p>
    <Link className="inline-block text-accent" target="_blank" rel="noreferrer" to={`/admin/redfox?${query}`}>查询已有 AI 搜索任务{facts.executionTaskId ? "（带入任务 ID）" : " ID"} ↗</Link>
  </div>;
}
