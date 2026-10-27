import { useState } from "react";
import { useNavigate } from "react-router";
import { useAdminAction } from "./action";
import type { OperationAccepted } from "./operation-types";
import { transcriptionCommand } from "./transcription-data";
import type { TranscriptionMode, TranscriptionOptions } from "./transcription-types";
import { Button, Card, Empty, Field, Input, Select, Textarea } from "./ui";

export function TranscriptionForm({ options, initialTaskId = "", initialPlatform = "" }: { options: TranscriptionOptions; initialTaskId?: string; initialPlatform?: string }) {
  const navigate = useNavigate(), { run, pending } = useAdminAction();
  const firstPlatform = options.platforms[0]?.platform ?? "";
  const [mode, setMode] = useState<TranscriptionMode>(initialTaskId ? "query" : "submit");
  const [drafts, setDrafts] = useState({ submit: { platform: firstPlatform, value: "" }, query: { platform: options.platforms.some(p => p.platform === initialPlatform) ? initialPlatform : firstPlatform, value: initialTaskId } });
  const [error, setError] = useState<string | null>(null);
  const draft = drafts[mode], platform = options.platforms.find(p => p.platform === draft.platform);
  if (!platform) return <Card title="语音转写（ASR）"><Empty>当前没有开放的转写平台。</Empty></Card>;
  return <Card title="语音转写（ASR）"><form className="space-y-4" aria-label="语音转写表单" onSubmit={async e => {
    e.preventDefault();
    let command: ReturnType<typeof transcriptionCommand>;
    try { command = transcriptionCommand(mode, draft.platform, draft.value); setError(null); } catch (error) { setError((error as Error).message); return; }
    const result = await run<OperationAccepted>("POST", command.path, command.body, { label: `transcription-${mode}`, revalidate: false });
    if (result) navigate(`/admin/operations/${result.runId}`);
  }}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="转写模式"><Select aria-label="转写模式" disabled={!!pending} value={mode} onChange={e => { setMode(e.target.value as TranscriptionMode); setError(null); }}><option value="submit">新建转写</option><option value="query">查询已有任务</option></Select></Field>
      <Field label="转写平台"><Select aria-label="转写平台" disabled={!!pending} value={draft.platform} onChange={e => { const platform = e.target.value; setDrafts(previous => ({ ...previous, [mode]: { ...previous[mode], platform } })); setError(null); }}>{options.platforms.map(p => <option key={p.platform} value={p.platform}>{p.label}</option>)}</Select></Field>
    </div>
    {mode === "submit" ? <Field label="链接或完整分享文案" hint={options.inputHint}><Textarea aria-label="转写链接或分享文案" required rows={5} maxLength={10000} disabled={!!pending} value={draft.value} onChange={e => { const value = e.target.value; setDrafts(previous => ({ ...previous, submit: { ...previous.submit, value } })); }} /></Field> : <Field label="已有转写任务 ID" hint="选择任务所属平台，只查询和保存已有结果，不提交新的 ASR。任务 ID 原串保留。"><Input aria-label="转写任务 ID" required maxLength={500} disabled={!!pending} value={draft.value} onChange={e => { const value = e.target.value; setDrafts(previous => ({ ...previous, query: { ...previous.query, value } })); }} /></Field>}
    <div className="space-y-1 rounded-control bg-bg-sunk p-3 text-[12.5px] leading-relaxed text-ink-3">
      <p>{mode === "submit" ? `所选平台文档提交估价 ${platform.submitEstimatedCny} 元/请求，使用转写提交预算。` : "已有任务仅轮询，本轮不提交新转写。"}进度查询文档估价 {platform.pollEstimatedCny} 元/请求，即使免费仍占 poll 次数预算；实际实扣未核对。</p>
      <p>新一轮执行最多轮询 {options.limits.polls} 轮（异常重试另计次数预算），最长等待 {options.limits.pollDeadlineSeconds} 秒；创建后以执行记录中的冻结限额为准。</p>
      <p>{options.resultPurpose}。转写不自动写入文章；成功结果可显式保存 TXT 附件、关联已有材料或申请填入缺失正文，不发布、不改变权限。</p>
    </div>
    {error && <p role="alert" className="break-words text-[13px] text-hot">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" tone="primary" disabled={!!pending || !draft.value.trim()} busy={pending === `transcription-${mode}`}>{mode === "submit" ? "提交转写并查看执行记录" : "查询转写并查看执行记录"}</Button><Button disabled={!!pending || !draft.value} onClick={() => { setDrafts(previous => ({ ...previous, [mode]: { ...previous[mode], value: "" } })); setError(null); }}>清空当前草稿</Button></div>
  </form></Card>;
}
