import { useState } from "react";
import { useNavigate } from "react-router";
import { useAdminAction } from "./action";
import { aiSearchCommand, aiSearchFamilies } from "./ai-search-data";
import type { AiSearchMode, AiSearchOptions } from "./ai-search-types";
import type { OperationAccepted } from "./operation-types";
import { Button, Card, Empty, Field, Input, Select, Textarea } from "./ui";
export function AiSearchForm({ options, initialFamily = "", initialTaskId = "" }: { options: AiSearchOptions; initialFamily?: string; initialTaskId?: string }) {
  const navigate = useNavigate(), { run, pending } = useAdminAction();
  const [mode, setMode] = useState<AiSearchMode>(initialTaskId ? "query" : "submit");
  const [engine, setEngine] = useState(options.engines[0]?.engine ?? "");
  const [family, setFamily] = useState(options.queries.some(row => row.family === initialFamily) ? initialFamily : options.queries[0]?.family ?? "");
  const [drafts, setDrafts] = useState<{ submit: Record<string, string>; query: Record<string, string> }>({ submit: {}, query: initialFamily ? { [initialFamily]: initialTaskId } : {} });
  const [error, setError] = useState<string | null>(null);
  const selection = mode === "submit" ? engine : family, value = drafts[mode][selection] ?? "", selectedEngine = options.engines.find(row => row.engine === engine);
  const change = (value: string) => setDrafts(previous => ({ ...previous, [mode]: { ...previous[mode], [selection]: value } }));
  if (!options.engines.length || !options.queries.length) return <Card title="AI 搜索"><Empty>当前没有开放的 AI 搜索引擎。</Empty></Card>;
  return <Card title="AI 搜索"><form aria-label="AI 搜索表单" className="space-y-4" onSubmit={async e => {
    e.preventDefault(); if (pending) return;
    let command: ReturnType<typeof aiSearchCommand>;
    try { command = aiSearchCommand(mode, selection, value, options); setError(null); } catch (error) { setError((error as Error).message); return; }
    const result = await run<OperationAccepted>("POST", command.path, command.body, { label: `ai-search-${mode}`, revalidate: false });
    if (result) navigate(`/admin/operations/${result.runId}`);
  }}>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="AI 搜索模式"><Select aria-label="AI 搜索模式" value={mode} disabled={!!pending} onChange={e => { setMode(e.target.value as AiSearchMode); setError(null); }}><option value="submit">新建 AI 搜索</option><option value="query">查询已有任务</option></Select></Field>{mode === "submit" ? <Field label="搜索引擎"><Select aria-label="AI 搜索引擎" value={engine} disabled={!!pending} onChange={e => { setEngine(e.target.value); setError(null); }}>{options.engines.map(row => <option key={row.engine} value={row.engine}>{row.label}</option>)}</Select></Field> : <Field label="任务所属系列"><Select aria-label="AI 任务系列" value={family} disabled={!!pending} onChange={e => { setFamily(e.target.value); setError(null); }}>{options.queries.map(row => <option key={row.family} value={row.family}>{aiSearchFamilies[row.family] ?? row.family}</option>)}</Select></Field>}</div>
    {mode === "submit" ? <Field label="搜索问题" hint={`最多 ${options.inquiryMaxCharacters} 字符；换行与首尾空白原样提交。`}><Textarea aria-label="AI 搜索问题" required rows={6} maxLength={options.inquiryMaxCharacters} disabled={!!pending} value={value} onChange={e => change(e.target.value)} /></Field> : <Field label="已有 AI 搜索任务 ID" hint="仅查询和保存已有任务，不提交新的搜索；任务 ID 原串保留。"><Input aria-label="AI 搜索任务 ID" required maxLength={500} disabled={!!pending} value={value} onChange={e => change(e.target.value)} /></Field>}
    <p className="text-[12px] text-ink-4">{value.length} / {mode === "submit" ? options.inquiryMaxCharacters : 500} 字符</p>
    <div className="space-y-1 rounded-control bg-bg-sunk p-3 text-[12.5px] text-ink-3"><p>{mode === "submit" ? `所选引擎文档提交估价 ${selectedEngine?.price} 元/请求，使用 AI 搜索预算。` : "本轮提交步骤 0 个，仅查询已有任务。"}轮询文档估价 {options.pollEstimatedCny} 元/请求，即使为 0 仍占 poll 次数预算；实际实扣未核对。</p><p>执行须同时开启模型与 Redfox 外部调用开关，并满足相应预算。新一轮执行最多轮询 {options.limits.polls} 轮（异常重试另计次数预算），最长等待 {options.limits.pollDeadlineSeconds} 秒；创建后以执行记录中的冻结限额为准。</p><p>答案、引用与可选商品卡仅供研究，不自动写入文章。停止本地处理不取消远端搜索，也不保证退款；提交结果未知时先核对，不自动重复购买。</p></div>
    {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" tone="primary" disabled={!!pending || !value.trim()} busy={pending === `ai-search-${mode}`}>{mode === "submit" ? "提交 AI 搜索并查看执行记录" : "查询 AI 搜索并查看执行记录"}</Button><Button disabled={!!pending || !value} onClick={() => { change(""); setError(null); }}>清空当前 AI 草稿</Button></div>
  </form></Card>;
}
