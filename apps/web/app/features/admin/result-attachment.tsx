import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useAdminAction } from "./action";
import { operationFileAsset } from "./asset-data";
import type { OperationResult } from "./operation-types";
import { PrivateAssetView } from "./private-asset";
import { researchFactText } from "./research-platform-data";
import { attachmentChoices, readResultLocal, resultPageLink, resultUseCapabilities, saveAttachmentBody, type ResultAttachmentRow } from "./result-attachment-data";
import { ResultUse } from "./result-use";
import { Badge, Button, Field, Json, ReasonDialog, Select } from "./ui";

export function ResultAttachmentActions({ result: r }: { result: OperationResult }) {
  const choices = attachmentChoices(r), { run, pending } = useAdminAction(), location = useLocation();
  const [open, setOpen] = useState(false), [selection, setSelection] = useState(0), [items, setItems] = useState<ResultAttachmentRow[] | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null), close = useCallback(() => setOpen(false), []);
  useEffect(() => () => controller.current?.abort(), []);
  const refresh = async () => {
    controller.current?.abort(); const current = new AbortController(); controller.current = current; setLoading(true); setError(null);
    try { const data = await readResultLocal<{ items: ResultAttachmentRow[] }>(`/api/admin/operations/results/${r.id}/attachments`, current.signal); if (!current.signal.aborted) setItems(data.items); }
    catch (error) { if (!current.signal.aborted) setError((error as Error).message); }
    finally { if (!current.signal.aborted) setLoading(false); }
  };
  if (!choices.length) return null;
  const selected = choices[selection], saved = selected && items?.find(item => item.data.selection === (r.kind === "transcription" ? "transcription:txt" : r.kind === "subtitle_track" ? `subtitle:${selected.formatIndex}` : "media"));
  const label = r.kind === "transcription" ? "保存TXT附件" : r.kind === "subtitle_track" ? "保存所选字幕附件" : "保存媒体附件";
  return <section className="space-y-3 rounded-control border border-line p-3" aria-label="保存结果附件">
    <p className="text-[12px] text-ink-3">{r.kind === "transcription" ? "将已成功转写文本保存为本地私有 TXT，不调用供应商。" : "仅在确认保存后，后台才读取本条已收地址并校验文件，保存为私有附件；不重新调用供应商解析接口，不重开任务。"}</p>
    {choices.length > 1 && <Field label="附件格式（本轨道实收顺序）"><Select aria-label="附件格式（本轨道实收顺序）" value={selection} disabled={!!pending} onChange={e => setSelection(Number(e.target.value))}>{choices.map((choice, index) => <option key={choice.formatIndex ?? index} value={index}>{choice.label} · 原格式序号 {choice.formatIndex}</option>)}</Select></Field>}
    <div className="flex flex-wrap gap-3"><Button size="sm" disabled={!!pending || !selected || !!saved} onClick={() => { setError(null); setOpen(true); }}>{label}</Button><Button size="sm" disabled={!!pending || loading} busy={loading} onClick={refresh}>查看 / 刷新已存附件</Button></div>
    {saved && <p className="text-[12px] text-ink-3">此格式已有附件 #{saved.id}（{saved.file_status ?? "状态未知"}）；历史文件不可重复覆盖，已删除附件不会自动重新保存。</p>}
    {items && (items.length ? <ul className="space-y-2 text-[12px]">{items.map(item => <li key={item.id} className="break-all"><Link className="text-accent" to={resultPageLink(location.pathname, item.id)}>查看附件结果 #{item.id}</Link> · {researchFactText(item.data.format)} · {item.file_status ?? "状态未知"}{item.article_id && <Link className="ml-2 text-accent" to={`/admin/content/${encodeURIComponent(item.article_id)}`}>查看关联材料</Link>}</li>)}</ul> : <p className="text-[12px] text-ink-4">尚无已保存附件。查看列表不会读取外部资源。</p>)}
    {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    <ReasonDialog open={open} title={label} description={r.kind === "transcription" ? "仅将本条已成功转写的完整文本保存为私有 TXT，不创建文章、不调用供应商。" : "按本结果和所选格式读取已收到的资源，执行本地大小与文件校验；不传入任意地址。保存不自动关联材料或填正文。"} busy={!!pending} onClose={close} onSubmit={async reason => {
      let body: ReturnType<typeof saveAttachmentBody>;
      try { body = saveAttachmentBody(r, selected?.formatIndex, reason); } catch (error) { setError((error as Error).message); return false; }
      const result = await run("POST", `/api/admin/operations/results/${r.id}/save-attachment`, body, { label: `save-attachment:${r.id}`, success: "附件已保存" });
      if (!result) return false;
      await refresh(); return true;
    }}>{selected && <p className="text-[12px] text-ink-3">父结果 #{r.id} · 格式 {selected.label}{selected.formatIndex !== undefined ? ` · 原格式序号 ${selected.formatIndex}` : ""}</p>}{error && <p role="alert" className="text-[13px] text-hot">{error}</p>}</ReasonDialog>
  </section>;
}

export function ResultAttachment({ result: r }: { result: OperationResult }) {
  const location = useLocation(), parent = r.data.parentResultId;
  return <article id={`result-${r.id}`} className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span>已保存私有附件 #{r.id}</span><Badge>{researchFactText(r.data.format)}</Badge></div>
    <p className="break-all text-[12px] text-ink-3">父结果：{typeof parent === "number" && Number.isSafeInteger(parent) && parent > 0 ? <Link className="text-accent" to={resultPageLink(location.pathname, parent)}>#{parent}</Link> : researchFactText(parent)} · 获取方式：{({ transcription: "本地转写文本", "subtitle-download": "字幕文件下载", "media-download": "媒体文件下载" } as Record<string, string>)[String(r.data.acquisition)] ?? researchFactText(r.data.acquisition)}</p>
    <PrivateAssetView asset={operationFileAsset(r.file)} options={null} />
    {r.articleId && !resultUseCapabilities(r).attach && <Link className="text-[13px] text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>查看已关联材料（文件当前状态不支持写入）</Link>}
    <ResultUse result={r} />
    {!r.articleId && r.data.bodyUsable !== true && ["json", "json3"].includes(String(r.data.format)) && <p className="text-[12px] text-ink-3">JSON / json3 可关联为文本附件，不用于填入文章正文。</p>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, data: r.data, fileKey: r.fileKey, articleId: r.articleId, sourceId: r.sourceId }} label="附件格式、父结果与关联诊断" />
  </article>;
}
