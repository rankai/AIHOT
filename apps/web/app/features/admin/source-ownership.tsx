import { createContext, useContext, useState, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import type { OperationDetail, OperationResult } from "./operation-types";
import { frozenSourceOwnership, hasUnlinkedWork, ownershipCandidateValid, ownershipCandidatesHref, workSourceBody, type OwnershipCandidates, type OwnershipSource } from "./source-ownership-data";
import { KIND_LABEL, MODE_LABEL } from "./labels";
import { Button, Field, Input, Select } from "./ui";
export function SourceOwnershipSelector({ value, onChange, disabled = false }: { value: OwnershipSource | null; onChange: (source: OwnershipSource | null) => void; disabled?: boolean }) {
  const candidates = useFetcher<OwnershipCandidates>();
  const [query, setQuery] = useState(""), [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const list = candidates.state === "idle" && query.trim() === searchedQuery ? candidates.data : undefined;
  const rows = list?.rows.filter(source => source.enabled === true) ?? [];
  const search = (page = 1) => { onChange(null); setSearchedQuery(query.trim()); candidates.load(ownershipCandidatesHref(query, page)); };
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><Field label="搜索所属信源"><Input aria-label="搜索所属信源" value={query} disabled={disabled} placeholder="名称、ID 或地址" onChange={event => { setQuery(event.target.value); onChange(null); }} /></Field></div><Button size="sm" disabled={disabled || !query.trim()} busy={candidates.state !== "idle"} onClick={() => search()}>搜索信源</Button><Link className="py-2 text-[13px] text-accent" to="/admin/sources/new" target="_blank" rel="noreferrer">新建信源 ↗</Link></div>
    {candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，旧选择已清除。</p>}
    {list && <><Field label="所属信源"><Select aria-label="所属信源" value={value?.id ?? ""} disabled={disabled || candidates.state !== "idle"} onChange={event => onChange(ownershipCandidateValid(event.target.value, candidates.state, query, searchedQuery, rows) ? rows.find(row => row.id === event.target.value)! : null)}><option value="">请选择所属信源</option>{rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · {KIND_LABEL[source.kind ?? ""] ?? source.kind ?? "信源"} · {MODE_LABEL[source.participation_mode ?? ""] ?? source.participation_mode ?? ""}</option>)}</Select></Field><div className="flex flex-wrap gap-2">{list.page > 1 && <Button size="sm" disabled={disabled} onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" disabled={disabled} onClick={() => search(list.page + 1)}>下一批</Button>}</div>{!rows.length && <p className="text-[12px] text-ink-3">本批没有已启用信源，请修改搜索或翻页。</p>}</>}
    <p className="text-[12px] text-ink-3">沿用所选信源当前参与方式与公开权限；新建信源后回到此处搜索并选择。</p>
  </div>;
}
interface WorkOwnership { id: string | null; name: string | null; inherited: boolean; ambiguous: boolean; ready: boolean; body: () => { sourceId?: string } }
const unavailable: WorkOwnership = { id: null, name: null, inherited: false, ambiguous: false, ready: false, body: () => workSourceBody({ id: null, inherited: false, ambiguous: false }) };
const WorkSourceContext = createContext<WorkOwnership>(unavailable);
export function WorkSourceProvider({ inputs, results, children }: { inputs: OperationDetail["inputs"]; results: OperationResult[]; children: ReactNode }) {
  const frozen = frozenSourceOwnership(inputs), [selected, setSelected] = useState<OwnershipSource | null>(null);
  const id = frozen.id ?? selected?.id ?? null, inherited = !!frozen.id;
  const value: WorkOwnership = { id, name: frozen.name ?? selected?.name ?? null, inherited, ambiguous: frozen.ambiguous, ready: !!id && !frozen.ambiguous, body: () => workSourceBody({ id, inherited, ambiguous: frozen.ambiguous }) };
  return <WorkSourceContext value={value}>{hasUnlinkedWork(results) && !inherited && <section aria-label="作品所属信源" className="mb-4 space-y-3 rounded-control border border-line p-3"><p className="text-[13px] text-ink-2">{frozen.ambiguous ? "本轮包含多个所属信源，无法确定新作品归属；请核对原执行记录。" : "为本轮作品选择一次所属信源，单项与本页多选导入共用此选择。"}</p>{!frozen.ambiguous && <SourceOwnershipSelector value={selected} onChange={setSelected} />}</section>}{children}</WorkSourceContext>;
}
export function useWorkSource() { return useContext(WorkSourceContext); }
export function WorkSourceNotice() {
  const source = useWorkSource();
  return <p className={`text-[12px] ${source.ready ? "text-ink-3" : "text-amber"}`}>{source.ambiguous ? "本轮所属信源不明确，不能导入作品。" : source.id ? <>所属信源：<Link className="text-accent" to={`/admin/sources/${encodeURIComponent(source.id)}`}>{source.name ?? source.id}</Link>。{source.inherited ? "沿用原执行冻结归属，不能在此换源。" : "沿用结果区的共同选择。"}作者 ID 仅保留为溯源；权限和旧文章归属保持现有规则。</> : "请先在结果区选择所属信源。"}</p>;
}
