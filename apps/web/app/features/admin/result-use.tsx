import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useAdminAction } from "./action";
import type { OperationResult } from "./operation-types";
import { readResultLocal, resultUseCapabilities } from "./result-attachment-data";
import { resultUseBody, type ResultArticle, type ResultArticleRow } from "./result-use-data";
import { safeExternalUrl } from "./platform-types";
import { Button, Field, Input, ReasonDialog, Select, Textarea } from "./ui";

export function ResultUse({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction(), capabilities = resultUseCapabilities(r);
  const [query, setQuery] = useState(""), [rows, setRows] = useState<ResultArticleRow[]>([]), [selectedId, setSelectedId] = useState("");
  const [article, setArticle] = useState<ResultArticle | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<"attach" | "fill-body" | null>(null), [evidence, setEvidence] = useState("");
  const request = useRef<{ sequence: number; controller?: AbortController }>({ sequence: 0 });
  const invalidate = () => { request.current.controller?.abort(); request.current.sequence += 1; setArticle(null); setLoading(false); };
  useEffect(() => () => request.current.controller?.abort(), []);
  const close = useCallback(() => setCommand(null), []);
  const readArticle = async (id: string) => {
    invalidate(); setSelectedId(id); setError(null); setLoading(true);
    const sequence = request.current.sequence, controller = new AbortController(); request.current.controller = controller;
    try {
      const data = await readResultLocal<{ article: ResultArticle }>(`/api/admin/content/${encodeURIComponent(id)}`, controller.signal);
      if (request.current.sequence !== sequence || controller.signal.aborted) return null;
      if (data.article.id !== id) throw new Error("读取的材料与当前选择不同，请重新选择。");
      setArticle(data.article); return data.article;
    } catch (error) { if (!controller.signal.aborted && request.current.sequence === sequence) setError((error as Error).message); return null; }
    finally { if (request.current.sequence === sequence) setLoading(false); }
  };
  const begin = async (action: "attach" | "fill-body") => {
    const id = r.articleId || selectedId;
    if (!id || pending || loading) return;
    const latest = await readArticle(id);
    if (!latest) return;
    try { resultUseBody(r, { article: latest, selectedId: id, loading: false, action, reason: "状态检查", evidence }); setCommand(action); }
    catch (error) { setError((error as Error).message); }
  };
  if (!capabilities.attach) return null;
  return <section className="min-w-0 space-y-3 rounded-control border border-line p-3" aria-label="结果关联材料">
    <p className="text-[13px] font-medium">关联已有材料 / 填入缺失正文</p>
    <p className="text-[12px] text-ink-3">关联不发布、不改变作者归属或权限；填空只用于缺失正文，不能覆盖已有内容。分享文案、任务 ID 或媒体地址不足以证明同一作品时须提供核实依据；明确的作品矛盾不能用依据覆盖。</p>
    {r.articleId ? <div className="flex flex-wrap gap-3 text-[13px]"><Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>查看已关联材料</Link><Button size="sm" disabled={!!pending || loading} onClick={() => readArticle(r.articleId!)}>读取最新材料状态</Button></div> : <>
      <Field label="搜索已有材料"><Input aria-label="搜索已有材料" value={query} disabled={!!pending || loading} placeholder="材料 ID、原文 URL 或标题" onChange={e => { invalidate(); setQuery(e.target.value); setRows([]); setSelectedId(""); }} /></Field>
      <Button size="sm" disabled={!query.trim() || !!pending || loading} onClick={async () => {
        invalidate(); setRows([]); setSelectedId(""); setError(null); setLoading(true);
        const sequence = request.current.sequence, controller = new AbortController(); request.current.controller = controller;
        try { const data = await readResultLocal<{ rows: ResultArticleRow[] }>(`/api/admin/content?q=${encodeURIComponent(query.trim())}`, controller.signal); if (request.current.sequence === sequence && !controller.signal.aborted) setRows(data.rows); }
        catch (error) { if (!controller.signal.aborted && request.current.sequence === sequence) setError((error as Error).message); }
        finally { if (request.current.sequence === sequence) setLoading(false); }
      }}>搜索材料</Button>
      {rows.length > 0 && <Field label="选择待核实材料"><Select aria-label="选择待核实材料" value={selectedId} disabled={!!pending || loading} onChange={e => { const id = e.target.value; invalidate(); setSelectedId(id); if (rows.some(row => row.id === id)) void readArticle(id); }}><option value="">请选择并核实同一作品</option>{rows.map(row => <option key={row.id} value={row.id}>{row.title} · {row.id} · {row.source}</option>)}</Select></Field>}
      {rows.length === 50 && <p className="text-[12px] text-ink-3">当前最多显示 50 条，请缩小搜索范围。</p>}
    </>}
    {loading && <p role="status" className="text-[12px] text-ink-3">正在读取本地材料状态，旧选择已失效。</p>}
    {article && (!r.articleId || r.articleId === article.id) && <div className="min-w-0 space-y-1 text-[12px] text-ink-3"><p className="break-all">{article.title} · {article.id}</p><p className="break-all">作者来源：{article.source_name} · {article.source_id}</p>{safeExternalUrl(article.url) ? <a className="block break-all text-accent" href={safeExternalUrl(article.url)!} target="_blank" rel="noreferrer">材料原文：{article.url} ↗</a> : <p className="break-all">材料原文：{article.url}</p>}<p>正文：{article.has_body === true ? "已有，不能覆盖" : article.has_body === false ? "缺失，可申请填空" : "未知，请重新读取"} · 信源：{article.source_enabled === true ? "已启用" : article.source_enabled === false ? "已停用，不能写入" : "状态未知，不能写入"}</p></div>}
    <div className="flex flex-wrap gap-2">{!r.articleId && <Button size="sm" disabled={!!pending || loading || !article || article.source_enabled !== true} onClick={() => begin("attach")}>关联已有材料</Button>}{capabilities.fillBody && <Button size="sm" disabled={!!pending || loading || !article || article.source_enabled !== true || article.has_body !== false} onClick={() => begin("fill-body")}>填入缺失正文</Button>}</div>
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-[13px] text-hot">{error}</p>}
    <ReasonDialog open={command !== null} title={command === "fill-body" ? "填入材料缺失正文" : "关联已有材料"} description="只提交刚读取的材料版本，由后台重新核对同一作品、原归属及启用状态。已有正文与发布权限保持不变。" busy={!!pending || loading} onClose={close} onSubmit={async reason => {
      if (!command) return false;
      let body: ReturnType<typeof resultUseBody>;
      try { body = resultUseBody(r, { article, selectedId, loading, action: command, reason, evidence }); } catch (error) { setError((error as Error).message); return false; }
      const result = await run<{ articleId: string; revision: number }>("POST", `/api/admin/operations/results/${r.id}/use`, body, { label: `use-result:${r.id}`, success: command === "fill-body" ? "缺失正文已填入" : "材料已关联" });
      if (!result) { setError("命令未完成，原因与依据已保留。可重新读取材料版本后核对重试。"); return false; }
      await readArticle(result.articleId); return true;
    }}>
      {article && <p className="break-all text-[12px] text-ink-3">{article.title} · 当前读取版本 {article.revision} · {article.has_body ? "已有正文" : "正文缺失"}</p>}
      <Field label="同一作品核实依据" hint="可选；无法由可信原文直接确认同一作品时，后台要求填写。不能据此更改已确认的作品身份。"><Textarea aria-label="同一作品核实依据" maxLength={2000} value={evidence} disabled={!!pending || loading} onChange={e => setEvidence(e.target.value)} /></Field>
      <Button size="sm" disabled={!!pending || loading || !selectedId} onClick={() => readArticle(r.articleId || selectedId)}>重新读取材料版本（保留原因）</Button>
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </section>;
}
