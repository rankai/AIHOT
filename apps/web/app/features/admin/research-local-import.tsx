import { useWorkSource, WorkSourceNotice } from "./source-ownership";
import { useCallback, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";
import { useAdminAction } from "./action";
import { candidateSelectionValid } from "./candidate-selection";
import { MODE_LABEL } from "./labels";
import type { OperationResult } from "./operation-types";
import { researchImportBody, researchImportState } from "./research-import-data";
import type { ExternalCandidates } from "./weibo-result";
import { Button, Field, Input, ReasonDialog, Select, Textarea } from "./ui";

export function ResearchLocalImport({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction(), location = useLocation();
  const ownership = useWorkSource();
  const candidates = useFetcher<{ externalCandidates: ExternalCandidates | null }>();
  const [open, setOpen] = useState(false), close = useCallback(() => setOpen(false), []);
  const [target, setTarget] = useState("auto"), [query, setQuery] = useState(""), [searchedQuery, setSearchedQuery] = useState<string | null>(null), [sourceId, setSourceId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({}), [evidence, setEvidence] = useState(""), [error, setError] = useState<string | null>(null);
  const state = researchImportState(r), list = candidates.data?.externalCandidates;
  const current = searchedQuery !== null && searchedQuery === query.trim(), rows = current ? list?.rows ?? [] : [];
  const search = (page = 1) => {
    setSourceId(""); setSearchedQuery(query.trim());
    const params = new URLSearchParams(location.search); params.set("externalQ", query.trim()); params.set("externalPage", String(page)); params.set("candidateKind", "external");
    candidates.load(`${location.pathname}?${params}`);
  };
  if (!state.account && !state.work) return null;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>{state.account ? "查看已绑定信源" : "查看所属信源"}</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!state.linked && <Button size="sm" disabled={!state.canImport || !!pending || state.work && !ownership.ready} onClick={() => setOpen(true)}>{state.account ? "绑定账号信源" : "本地导入作品"}</Button>}</div>
    {state.account && !state.linked && !state.canImport && <p className="text-[12px] text-amber">账号必须收到本操作的稳定身份才可绑定；不能按昵称匹配或人工补账号 ID。</p>}
    <ReasonDialog open={open} title={state.account ? "绑定已收账号身份" : "本地导入作品"} description={state.account ? "仅使用已收到的账号身份，按现有绑定复用，否则新建隔离 external 信源并关闭全文。可显式选择经核实的同一账号信源，最终由后台复核；此操作不请求供应商。" : "作品沿用已确认的所属信源及其当前参与方式，作者 ID 仅作可选溯源；仅补缺失作品类型或原文等必要证据。已收作品事实不可替换，文章去重保留原归属。此操作不请求供应商。"} busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      let body: ReturnType<typeof researchImportBody>;
      try { body = researchImportBody(r, { reason, target, sourceId, requestState: candidates.state, rows, values, evidence, ...(state.work && ownership.ready ? { ownedSource: { id: ownership.id!, inherited: ownership.inherited } } : {}) }); } catch (error) { setError((error as Error).message); return false; }
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, body, { label: `research-import:${r.id}`, success: "本地处理已完成" }) !== null;
    }}>
      {state.work && <WorkSourceNotice />}
      {state.account && <><Field label="信源目标"><Select aria-label="信源目标" value={target} disabled={!!pending} onChange={e => { setTarget(e.target.value); setSourceId(""); }}><option value="auto">按作者归属或新建隔离信源</option><option value="existing">显式选择已核实的 external 信源</option></Select></Field>
      {target === "existing" && <div className="space-y-3"><Field label="搜索已有 external 信源"><Input aria-label="搜索已有 external 信源" value={query} disabled={!!pending} onChange={e => { setQuery(e.target.value); setSourceId(""); }} placeholder="名称或 ID，需人工核实同一作者" /></Field><Button size="sm" disabled={!query.trim() || !!pending || candidates.state !== "idle"} onClick={() => search()}>搜索候选</Button>{candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，已清除上次选择。</p>}{list && current && <><Field label="已核实为同一作者的信源"><Select aria-label="已核实为同一作者的信源" value={sourceId} disabled={!!pending || candidates.state !== "idle"} onChange={e => setSourceId(candidateSelectionValid(e.target.value, candidates.state, "external", "external", rows) ? e.target.value : "")}><option value="">请选择并核实</option>{rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · {MODE_LABEL[source.participation_mode] ?? source.participation_mode}</option>)}</Select></Field><div className="flex flex-wrap gap-2">{list.page > 1 && <Button size="sm" disabled={!!pending || candidates.state !== "idle"} onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" disabled={!!pending || candidates.state !== "idle"} onClick={() => search(list.page + 1)}>下一批</Button>}</div>{!rows.length && <p className="text-[12px] text-ink-3">当前页没有可选账号信源。可继续翻页、修改搜索或使用默认账号归属。</p>}</>}</div>}
      </>}
      {state.work && <><details className="space-y-3 rounded-control border border-line p-3"><summary className="cursor-pointer text-[13px] text-ink-2">补充缺失信息（可选）</summary><p className="text-[12px] text-ink-3">仅在必要作品类型或原文确实缺失且已核实时填写；已有作品事实不可替换，作者 ID 不要求补齐。</p>{state.fields.map(field => <Field key={field.name} label={`补充${field.label}`} hint="可选；仅补缺失字段，后台会重新核实已收事实。">{field.options ? <Select aria-label={`补充${field.label}`} value={values[field.name] ?? ""} disabled={!!pending} onChange={e => setValues(previous => ({ ...previous, [field.name]: e.target.value }))}><option value="">不补充</option>{field.options.map(value => <option key={value} value={value}>{value}</option>)}</Select> : <Input aria-label={`补充${field.label}`} value={values[field.name] ?? ""} disabled={!!pending} onChange={e => setValues(previous => ({ ...previous, [field.name]: e.target.value }))} />}</Field>)}<Field label="补充核实原文" hint={<span className="break-all">缺失或无效占位地址可人工补原生原文。已收原生地址只可确认同一地址，不拼作品 ID。懂车帝 // 地址只能显式补同址 http:// 或 https://；具体原生路径由后台复核。</span>}><Input aria-label="补充核实原文" type="url" value={values.url ?? ""} disabled={!!pending} onChange={e => setValues(previous => ({ ...previous, url: e.target.value }))} /></Field></details><Field label="必要作品字段核实依据" hint="补充必要作品字段时填写；无补充可留空，不要求证明作者关系。"><Textarea aria-label="必要作品字段核实依据" maxLength={1000} value={evidence} disabled={!!pending} onChange={e => setEvidence(e.target.value)} /></Field></>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </div>;
}
