import { useWorkSource, WorkSourceNotice } from "./source-ownership";
import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAdminAction } from "./action";
import type { OperationAccepted, OperationResult } from "./operation-types";
import { safeExternalUrl } from "./platform-types";
import { youtubeDetailRequest, youtubeImportFields, youtubeImportSupplement } from "./youtube-result-data";
import { Badge, Button, Field, Input, Json, KV, ReasonDialog, Textarea } from "./ui";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "未提供";
}
export function YoutubeResult({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const ownership = useWorkSource();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [url, setUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fields = youtubeImportFields(r.kind, r.data, url);
  const record = object(r.data.record);
  const detailRequest = youtubeDetailRequest(r.id, r.kind, r.data);
  const searchResult = r.data.operationId === "GC5SC5HS";
  const upstream = fields.receivedNative?.url ?? safeExternalUrl(fields.receivedUrl);
  const channelUrl = safeExternalUrl(record.channelUrl);
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  const media = (["thumbnails", "channelAvatars"] as const).flatMap(key => Array.isArray(record[key]) ? record[key].flatMap((item, index) => {
    const address = safeExternalUrl(object(item).url);
    return address ? [{ url: address, label: `${key === "thumbnails" ? "视频缩略图" : "频道头像"} ${index + 1}` }] : [];
  }) : []);
  const imported = !!r.articleId || !!r.sourceId;
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-words">{text(r.data.title)}</span><Badge>YouTube 视频</Badge></div>
    <KV items={[["已收 videoId", fields.workId ?? "未提供"], ["已收 channelId", fields.channelId ?? "未提供"], ["频道名称", text(record.author)], ["频道 handle", text(record.channelHandle)]]} />
    <p className="text-[12px] text-ink-4">作品归入已确认的所属信源；channelId、频道名称与 handle 保留为溯源，不决定作品归属或权限。</p>
    {typeof record.description === "string" && <div><p className="mb-1 text-[12px] text-ink-3">视频描述（description），不是字幕或转写</p><p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{record.description}</p></div>}
    <KV items={[["publishedTime 原串", text(record.publishedTime)], ["date 原串", text(record.date)], ["relativeDate 原串", text(record.relativeDate)]]} />
    <p className="text-[12px] text-ink-4">不据相对日期或无时区日期推断今天。缺少可信发表时间的新增材料按历史/回填语义处理，不把发现时间当作发表时间。</p>
    {upstream && <a className="inline-block break-all text-[13px] text-accent" href={upstream} target="_blank" rel="noreferrer">{fields.receivedNative ? "已收视频对应的原生 watch 原文" : "收到的上游地址（不作为导入原文）"} ↗</a>}
    {channelUrl && <div><a className="break-all text-[12px] text-accent" href={channelUrl} target="_blank" rel="noreferrer">上游频道链接 ↗</a></div>}
    {media.length > 0 && <div className="flex flex-wrap gap-3 text-[12px]">{media.map((item, index) => <a key={`${item.url}:${index}`} className="break-all text-accent" href={item.url} target="_blank" rel="noreferrer">{item.label}（不是原文）↗</a>)}</div>}
    {missing.length > 0 && <details className="text-[12px] text-ink-4"><summary className="cursor-pointer">历史上游缺项记录（不决定当前导入资格）</summary><ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul></details>}
    {fields.blockedReason && <p className="rounded-control bg-amber/10 p-3 text-[13px] text-amber">{fields.blockedReason}</p>}
    {typeof r.data.originResultId === "number" && Number.isSafeInteger(r.data.originResultId) && r.data.originResultId > 0 && <p className="text-[12px] text-ink-3">来源结果 #{r.data.originResultId}；原发现时间由服务端冻结保留。</p>}
    {searchResult && <div className="space-y-2 rounded-control bg-bg-sunk p-3">
      <Button size="sm" disabled={!detailRequest || !!pending} busy={pending === `youtube-detail:${r.id}`} onClick={async () => {
        if (!detailRequest) return;
        const accepted = await run<OperationAccepted>("POST", "/api/admin/redfox/queries", detailRequest, { label: `youtube-detail:${r.id}`, revalidate: false });
        if (accepted) navigate(`/admin/operations/${accepted.runId}`);
      }}>查询此视频详情</Button>
      <p className="text-[12px] text-ink-3">新建只读查询任务，使用 query 次数预算，文档基价 0.06 元/请求，实际实扣未核对；原结果不改写，不自动导入。</p>
      {!detailRequest && <p className="text-[12px] text-amber">尚无合法的已收视频 ID，不能发起同视频详情补全，请先核实输入。</p>}
    </div>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>查看所属信源</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!imported && <Button size="sm" disabled={!fields.canImport || !!pending || fields.work && !ownership.ready} onClick={() => setOpen(true)}>本地导入视频作品</Button>}</div>
    <Json value={{ resultId: r.id, receiptId: r.receiptId, operationId: r.data.operationId, workId: r.data.workId, identity: r.data.identity, originResultId: r.data.originResultId, record }} label="原始字段与溯源诊断" />
    <ReasonDialog open={open} title="本地导入 YouTube 作品" description="作品归入已确认的所属信源，沿用其当前参与方式；channelId 仅作可选溯源。只补缺失原文并记录依据，描述不是字幕，文章去重保留原归属。此命令不请求供应商。" busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      if (fields.work && !ownership.ready) { setError("请先在结果区确认所属信源。"); return false; }
      const command = youtubeImportSupplement(fields, { url, evidence });
      if (command.error) { setError(command.error); return false; }
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { reason, ...(fields.work ? ownership.body() : {}), ...(command.supplement ? { supplement: command.supplement } : {}) }, { label: `youtube-import:${r.id}`, success: "本地导入已完成" }) !== null;
    }}>
      {fields.work && <WorkSourceNotice />}
      <KV items={[["已收视频 ID", fields.workId ?? "未提供"], ["已收 channelId", fields.channelId ?? "未提供"], ["已有原文", fields.receivedUrl ?? "未提供"]]} />
      {fields.needsUrl && <Field label="补充已核实的原生 watch 原文" hint={<span className="break-all">例如 https://www.youtube.com/watch?v=dQw4w9WgXcQ；{fields.workId ? "须与已收视频 ID 一致" : "从已核实的 watch 原文确认作品，并记录依据"}。只接受恰好一个有效 v，不接受短链、shorts、图片、凭证、端口或片段。</span>}><Input aria-label="补充已核实的原生 watch 原文" type="url" required value={url} disabled={!!pending} onChange={event => setUrl(event.target.value)} /></Field>}
      {fields.needsUrl && <Field label="缺失字段的核实依据"><Textarea aria-label="缺失字段的核实依据" required maxLength={1000} value={evidence} disabled={!!pending} onChange={event => setEvidence(event.target.value)} /></Field>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </article>;
}
