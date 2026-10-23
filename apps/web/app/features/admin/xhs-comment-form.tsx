import { useState } from "react";
import { useNavigate } from "react-router";
import { useAdminAction } from "./action";
import type { OperationAccepted } from "./operation-types";
import { clearXhsCommentDraft, xhsCommentDrafts, xhsCommentQueryBody, xhsCommentSubmitBody } from "./xhs-comment-data";
import type { XhsCommentOptions } from "./xhs-comment-types";
import { Button, Card, Field, Input, Select, Textarea } from "./ui";
export function XhsCommentForm({ options, initialTaskId = "" }: { options: XhsCommentOptions; initialTaskId?: string }) {
  const navigate = useNavigate(), { run, pending } = useAdminAction();
  const [drafts, setDrafts] = useState(() => xhsCommentDrafts(options, initialTaskId)), [submitError, setSubmitError] = useState<string | null>(null), [queryError, setQueryError] = useState<string | null>(null);
  return <section id="xhs-comments" className="grid scroll-mt-6 gap-5 xl:grid-cols-2" aria-label="小红书异步评论工具">
    <Card title="小红书异步评论"><form aria-label="小红书评论提交表单" className="space-y-4" onSubmit={async e => {
      e.preventDefault(); if (pending) return;
      let body: ReturnType<typeof xhsCommentSubmitBody>;
      try { body = xhsCommentSubmitBody(drafts.submit, options); setSubmitError(null); } catch (error) { setSubmitError((error as Error).message); return; }
      const result = await run<OperationAccepted>("POST", "/api/admin/redfox/xiaohongshu/comments", body, { label: "xhs-comments-submit", revalidate: false }); if (result) navigate(`/admin/operations/${result.runId}`);
    }}>
      <p className="text-[12px] text-ink-3">异步获取作品一级评论，供本地研究；不导入文章或绑定作品作者。</p>
      <Field label="作品 ID" hint={`仅填写作品 ID，最多 ${options.idMaxLength} 字符；首尾空白原样保留。`}><Textarea rows={2} aria-label="小红书评论作品 ID" required maxLength={options.idMaxLength} disabled={!!pending} value={drafts.submit.opusId} onChange={e => { const opusId = e.target.value; setDrafts(previous => ({ ...previous, submit: { ...previous.submit, opusId } })); }} /></Field>
      <Field label="评论获取范围"><Select aria-label="小红书评论获取范围" value={drafts.submit.quantityMode} disabled={!!pending} onChange={e => { const quantityMode = e.target.value as "count" | "all"; setDrafts(previous => ({ ...previous, submit: { ...previous.submit, quantityMode } })); setSubmitError(null); }}><option value="count">指定评论数量</option><option value="all">全部评论（显式选择）</option></Select></Field>
      {drafts.submit.quantityMode === "count" ? <Field label="评论数量" hint="正整数；供应商未说明最大条数，填写值须在本地可精确表示的整数范围内。"><Input aria-label="小红书评论数量" inputMode="numeric" pattern="[0-9]+" required disabled={!!pending} value={drafts.submit.dataNum} onChange={e => { const dataNum = e.target.value; setDrafts(previous => ({ ...previous, submit: { ...previous.submit, dataNum } })); }} /></Field> : <p className="rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">已选择全部评论，可能产生更多扣点；不会把此范围默认为有限条数。</p>}
      <div className="space-y-1 rounded-control bg-bg-sunk p-3 text-[12.5px] text-ink-3"><p>按实际评论每 {options.billing.unitComments} 条扣点；取整、最低扣点及失败计费规则未知。{options.billing.documentedBaseCny} 元仅为文档基价，不据请求数量计算总价，也不表示免费。</p><p>仅使用 query 提交与 poll 查询次数预算，不调用模型生成。本地收到提交回执 {options.limits.firstPollDelaySeconds / 3600} 小时后首次自动查询，随后约每 {options.limits.pollIntervalSeconds / 3600} 小时查询。</p><p>最多 {options.limits.polls} 轮，提交任务最长 {options.limits.pollDeadlineSeconds / 3600} 小时，从本轮执行记录创建起算，预算等待计入；是本地限额，不保证供应商按时完成。</p></div>
      {submitError && <p role="alert" className="text-[13px] text-hot">{submitError}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" tone="primary" disabled={!!pending || !drafts.submit.opusId.trim()} busy={pending === "xhs-comments-submit"}>提交小红书评论任务</Button><Button disabled={!!pending} onClick={() => { setDrafts(previous => clearXhsCommentDraft(previous, "submit", options)); setSubmitError(null); }}>清空评论提交草稿</Button></div>
    </form></Card>
    <Card title="查询已有小红书评论任务"><form aria-label="小红书评论已有任务查询" className="space-y-4" onSubmit={async e => {
      e.preventDefault(); if (pending) return;
      let body: ReturnType<typeof xhsCommentQueryBody>;
      try { body = xhsCommentQueryBody(drafts.query.taskId, options.idMaxLength); setQueryError(null); } catch (error) { setQueryError((error as Error).message); return; }
      const result = await run<OperationAccepted>("POST", "/api/admin/redfox/xiaohongshu/comments/query", body, { label: "xhs-comments-query", revalidate: false }); if (result) navigate(`/admin/operations/${result.runId}`);
    }}>
      <Field label="已有评论任务 ID" hint="只查询，不重新提交评论任务；保留原始 ID 与空白。"><Textarea rows={2} aria-label="小红书评论任务 ID" required maxLength={options.idMaxLength} disabled={!!pending} value={drafts.query.taskId} onChange={e => { const taskId = e.target.value; setDrafts(previous => ({ ...previous, query: { taskId } })); }} /></Field>
      <p className="text-[12.5px] leading-relaxed text-ink-3">最多 {options.limits.polls} 轮，最长 {options.queryPollDeadlineSeconds / 3600} 小时，从本轮执行记录创建起算，预算等待计入。轮询为只读查询，每个查询请求异常最多重试一次，实际请求仍计次数预算；不是免费保证。</p>
      <p className="text-[12.5px] leading-relaxed text-ink-3">停止只停止本地后续处理，不取消远端评论任务或保证退款。评论仅供研究，不导入文章，也不绑定作品作者。</p>
      {queryError && <p role="alert" className="text-[13px] text-hot">{queryError}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!!pending || !drafts.query.taskId.trim()} busy={pending === "xhs-comments-query"}>查询已有评论任务</Button><Button disabled={!!pending} onClick={() => { setDrafts(previous => clearXhsCommentDraft(previous, "query", options)); setQueryError(null); }}>清空评论查询草稿</Button></div>
    </form></Card>
  </section>;
}
