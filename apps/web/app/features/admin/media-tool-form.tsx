import { useState } from "react";
import { useNavigate } from "react-router";
import { useAdminAction } from "./action";
import type { OperationAccepted } from "./operation-types";
import type { PlatformOperation } from "./platform-types";
import { mediaToolChoices, mediaToolCommand, mediaToolGroupLabels, mediaToolSpec } from "./media-tool-data";
import type { MediaToolGroup } from "./media-tool-types";
import { Button, Card, Empty, Field, Select, Textarea } from "./ui";

const groups: MediaToolGroup[] = ["media", "subtitle", "text-check"];
export function MediaToolForm({ operations }: { operations: PlatformOperation[] }) {
  const choices = mediaToolChoices(operations), { run, pending } = useAdminAction(), navigate = useNavigate();
  const [selected, setSelected] = useState(choices[0]?.id ?? ""), [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const operation = choices.find(operation => operation.id === selected) ?? choices[0];
  if (!operation) return <Card title="媒体、字幕与文本工具"><Empty>当前没有开放的同步工具。</Empty></Card>;
  const spec = mediaToolSpec(operation.id)!, field = operation.fields[0], value = drafts[operation.id] ?? "", text = spec.group === "text-check";
  return <Card title="媒体、字幕与文本工具"><form aria-label="同步工具表单" className="space-y-4" onSubmit={async e => {
    e.preventDefault();
    let command: ReturnType<typeof mediaToolCommand>;
    try { command = mediaToolCommand(operation, value); setError(null); } catch (error) { setError((error as Error).message); return; }
    const result = await run<OperationAccepted>("POST", "/api/admin/redfox/queries", command, { label: "media-tool-query", revalidate: false });
    if (result) navigate(`/admin/operations/${result.runId}`);
  }}>
    <Field label="选择工具"><Select aria-label="同步工具" value={operation.id} disabled={!!pending} onChange={e => { setSelected(e.target.value); setError(null); }}>{groups.map(group => <optgroup key={group} label={mediaToolGroupLabels[group]}>{choices.filter(choice => mediaToolSpec(choice.id)?.group === group).map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</optgroup>)}</Select></Field>
    <Field label={text ? "待检查文本" : "链接或完整分享文案"} hint={text ? `最多 ${field?.constraints?.maxLength ?? 2999} 字符；保留原始文本，不注入示例内容。` : "保留完整原串，由所选固定工具解析；本地不访问输入链接。"}><Textarea aria-label={text ? "工具待检查文本" : "工具链接或分享文案"} required rows={5} maxLength={field?.constraints?.maxLength} disabled={!!pending} value={value} onChange={e => { const value = e.target.value; setDrafts(previous => ({ ...previous, [operation.id]: value })); }} /></Field>
    <p className="text-[12px] text-ink-4" aria-live="polite">已输入 {value.length} / {field?.constraints?.maxLength ?? "—"} 字符</p>
    <div className="space-y-1 rounded-control bg-bg-sunk p-3 text-[12.5px] leading-relaxed text-ink-3"><p>{operation.purpose}</p><p>所选工具文档估价 {spec.estimatedCny} 元/请求，使用 {spec.purpose} 次数预算，实际实扣未核对。</p><p>{text ? "只展示文本检查与安全标注，不改变发布规则或既有筛选，不提供导入或绑定动作。" : "名称中的“下载”指获取地址或元数据，本次查询不会下载或保存本地文件，也不自动加载媒体、读取字幕内容或写入材料。查询完成后，可在结果中显式保存支持的媒体或字幕私有附件；文本附件可关联已有材料，TXT/SRT/VTT 可填入缺失正文，JSON/json3 仅可关联，媒体附件仅供私有保存。不发布、不改变权限。"}</p></div>
    {error && <p role="alert" className="break-words text-[13px] text-hot">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" tone="primary" disabled={!!pending || !value.trim()} busy={pending === "media-tool-query"}>查询工具并查看任务</Button><Button disabled={!!pending || !value} onClick={() => { setDrafts(previous => ({ ...previous, [operation.id]: "" })); setError(null); }}>清空工具草稿</Button></div>
  </form></Card>;
}
