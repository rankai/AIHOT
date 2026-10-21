import { useState } from "react";
import type { OperationResult } from "./operation-types";
import { researchFactText } from "./research-platform-data";
import { ResearchFacts } from "./research-platform-result";
import { isTranscriptionPlatform, transcriptionPlatforms, transcriptionProviderStatus, transcriptionSegmentPage, transcriptionSourceLink, transcriptionTextField, transcriptionTextPresentation } from "./transcription-data";
import { Badge, Button, Json } from "./ui";
import { ResultAttachmentActions } from "./result-attachment";
import { ResultUse } from "./result-use";

export function TranscriptionResult({ result: r }: { result: OperationResult }) {
  const control = r.kind === "transcription_task", presentation = transcriptionTextPresentation(r.kind, r.data), text = presentation.field, failure = transcriptionTextField(r.data, "failReason");
  const source = transcriptionSourceLink(r.data.sourceUrl);
  return <article id={`result-${r.id}`} className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span>{isTranscriptionPlatform(r.data.platform) ? transcriptionPlatforms[r.data.platform] : "语音"}转写{control ? "历史记录" : "结果"}</span><Badge>{transcriptionProviderStatus(r.kind, r.data)}</Badge></div>
    {control && <p className="text-[12px] text-ink-3">本条是一次提交或轮询留下的历史事实；当前本地业务状态以上方任务进度为准。</p>}
    <ResearchFacts items={[...(Object.hasOwn(r.data, "taskId") ? [["响应任务 ID（实收）", researchFactText(r.data.taskId)]] as Array<[string, string]> : []), ...(Object.hasOwn(r.data, "requestedTaskId") ? [["本次查询任务 ID（请求）", researchFactText(r.data.requestedTaskId)]] as Array<[string, string]> : [])]} />
    {(r.data.status === "failed" || failure.state !== "absent") && <ResearchFacts items={[["上游失败原因", failure.text === "" ? "空字符串" : failure.text]]} />}
    {presentation.hasText ? <div className="space-y-2"><p className="text-[12px] text-ink-3">上游完整转写文本（纯文本）</p><p className="whitespace-pre-wrap break-all text-[13px] leading-relaxed text-ink-2">{text.text}</p></div> : <p className={`text-[12px] ${presentation.needsReview ? "text-amber" : "text-ink-4"}`}>转写文本：{text.text === "" ? "空字符串" : text.text}。{presentation.needsReview ? "未收到可用的完整转写文本，请核对记录。" : ""}</p>}
    <TranscriptionSegments data={r.data} />
    {Object.hasOwn(r.data, "sourceUrl") && <div className="min-w-0 space-y-1 text-[12px]"><p className="text-ink-3">原始输入链接 / 分享文案（不等于已核实作品原文）</p>{source ? <a className="break-all text-accent" href={source} target="_blank" rel="noreferrer">{researchFactText(r.data.sourceUrl)} ↗</a> : <p className="whitespace-pre-wrap break-all text-ink-2">{researchFactText(r.data.sourceUrl)}</p>}</div>}
    {!control && <><ResultAttachmentActions result={r} /><ResultUse result={r} /><p className="text-[12px] text-ink-3">转写不会自动写入文章；可显式保存 TXT、关联已有材料或申请填入缺失正文，不发布、不改变作者权限。</p></>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="转写原始字段与回执诊断" />
  </article>;
}
function TranscriptionSegments({ data }: { data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0);
  const segmentPage = transcriptionSegmentPage(data, page);
  if (!Array.isArray(data.stampSents) || !segmentPage.total) return <p className="text-[12px] text-ink-4">{Array.isArray(data.stampSents) ? "上游返回 0 条分段。" : Object.hasOwn(data, "stampSents") ? data.stampSents === null ? "分段字段为 null（上游为空）。" : "分段字段格式未识别，详见诊断。" : "上游未提供分段。"}</p>;
  const unit = data.timestampUnit === "milliseconds" ? "毫秒" : "单位未说明";
  return <details className="min-w-0 rounded-control bg-bg-sunk p-3" onToggle={e => setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-[12px] text-ink-3">转写分段（共 {segmentPage.total} 条，起止{unit}，按需查看）</summary>{open && <div className="mt-3 space-y-3" aria-label="转写分段">
    <p className="text-[12px] text-ink-3">当前第 {segmentPage.start + 1}–{segmentPage.end} 条。起止值保持上游原值，不换算或舍入。</p>
    {segmentPage.rows.map((segment, index) => <div className="min-w-0 space-y-1 border-b border-line pb-2 last:border-0" key={segmentPage.start + index}><p className="break-all text-[12px] text-ink-4">#{segmentPage.start + index + 1} · start {researchFactText(segment.start)} / end {researchFactText(segment.end)}（{unit}）</p><p className="whitespace-pre-wrap break-all text-[13px] text-ink-2">{segment.textSeg}</p></div>)}
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={segmentPage.page === 0} onClick={() => setPage(segmentPage.page - 1)}>上一组分段</Button><span className="text-[12px] text-ink-3">{segmentPage.page + 1} / {segmentPage.pages}</span><Button size="sm" disabled={segmentPage.page + 1 >= segmentPage.pages} onClick={() => setPage(segmentPage.page + 1)}>下一组分段</Button></div>
  </div>}</details>;
}
