import type { OperationResult } from "./operation-types";
import { researchFactText, researchObject } from "./research-platform-data";
import { ResearchFacts } from "./research-platform-result";
import { xhsCommentLinks, xhsCommentRecordRows, xhsCommentStatuses, xhsCommentTaskRows } from "./xhs-comment-data";
import { Json } from "./ui";
export function XhsCommentResult({ result: r }: { result: OperationResult }) {
  const control = r.kind === "xhs_comment_task", record = researchObject(r.data.record), links = xhsCommentLinks(r.data);
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0"><p className="text-[14px] font-medium">{control ? "小红书评论提交 / 查询历史" : "小红书一级评论"}</p>
    {control ? <><p className="text-[12px] text-ink-3">供应商事实：{typeof r.data.status === "string" ? xhsCommentStatuses[r.data.status] ?? r.data.status : "未提供"}。本条是已保存历史，当前业务状态以上方本地进度为准。</p><ResearchFacts items={xhsCommentTaskRows(r.data)} />{r.data.status === "completed" && r.data.actualCount === 0 && <p className="text-[12px] text-ink-3">此次完成响应合法返回 0 条评论；不把其他待查询响应缺少评论列表推断为空完成。</p>}</> : <><ResearchFacts items={[["查询任务 ID", researchFactText(r.data.taskId)], ["本次轮询序号", researchFactText(r.data.pollSequence)], ...xhsCommentRecordRows(r.data)]} />{Object.hasOwn(record, "content") ? <p className="whitespace-pre-wrap break-all text-[13px] leading-relaxed text-ink-2">{researchFactText(record.content)}</p> : <p className="text-[12px] text-ink-4">本条没有评论正文字段。</p>}
      {links.map((link, index) => <div className="min-w-0 text-[12px]" key={index}><p className="text-ink-3">{link.label}（媒体，不是作品原文）</p>{link.url ? <a className="break-all text-accent" href={link.url} target="_blank" rel="noreferrer">{link.url} ↗</a> : <p className="whitespace-pre-wrap break-all text-ink-4">没有可安全打开的地址；原始字段可在诊断中核查。</p>}</div>)}
      <p className="text-[12px] text-ink-3">评论者与被评论作品作者分别保留；只作研究记录，不导入文章或绑定作者。头像和图片仅外链，不自动加载。</p></>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="小红书评论原始字段与回执诊断" />
  </article>;
}
