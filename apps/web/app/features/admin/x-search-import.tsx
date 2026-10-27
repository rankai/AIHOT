import { useWorkSource, WorkSourceNotice } from "./source-ownership";
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { useAdminAction } from "./action";
import type { OperationResult } from "./operation-types";
import { xSearchImportBody, xSearchImportState } from "./x-search-import-data";
import { Button, Empty, Field, ReasonDialog, Select } from "./ui";
import { MODE_LABEL } from "./labels";
import type { BindingSource } from "./operation-result";

export function XSearchImport({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const ownership = useWorkSource();
  const [open, setOpen] = useState(false), [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []), state = xSearchImportState(r);
  if (!state.supported) return null;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>查看所属信源</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!state.linked && <Button size="sm" disabled={!state.canImport || !!pending || !ownership.ready} onClick={() => setOpen(true)}>本地导入作品</Button>}</div>
    {!state.linked && state.issues.length > 0 && <p className="whitespace-pre-wrap break-words text-[12px] text-amber">{state.issues.join("；")}。请先核实上游结果，本入口不补造身份、正文或时间；后台仍会重新校验。</p>}
    {!state.linked && Object.hasOwn(r.data, "pendingReason") && <details className="text-[12px] text-ink-4"><summary className="cursor-pointer">历史处理提示（当前资格以作品与原文为准）</summary><p className="whitespace-pre-wrap break-all">{typeof r.data.pendingReason === "string" ? r.data.pendingReason : JSON.stringify(r.data.pendingReason)}</p></details>}
    {state.agentkey && <p className="text-[12px] text-ink-3">实收文本保留为摘要与溯源，正文保持待确认，不表示完整长文或 Article。{state.unknownTime ? "发表时间未核实，按历史回填处理，不使用发现时间冒充发表时间。" : "发表时间由后台按实收值复核。"}后台核验原始响应与回执后才允许本地导入。</p>}
    <ReasonDialog open={open} title="本地导入 X 作品" description="作品沿用已确认的所属信源及其当前参与方式，作者 userId 仅作可选溯源。后台复核帖子 ID、原文、账号范围与作品角色，实际矛盾或需全文的 X Article 仍会阻断。文章去重保留原归属，此命令不请求供应商。" busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      let body: ReturnType<typeof xSearchImportBody>;
      try { body = { ...xSearchImportBody(r, reason), ...ownership.body() }; } catch (error) { setError((error as Error).message); return false; }
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, body, { label: `x-search-import:${r.id}`, success: "作品已本地导入" }) !== null;
    }}><WorkSourceNotice />{error && <p role="alert" className="text-[13px] text-hot">{error}</p>}</ReasonDialog>
  </div>;
}

/** Shared existing-source binding; target candidates are loaded from exact single-account queries. */
export function XAccountBinding({ result: r, bindingSources }: { result: OperationResult; bindingSources?: BindingSource[] }) {
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false), [sourceId, setSourceId] = useState("");
  const close = useCallback(() => setOpen(false), []);
  return <>
    {bindingSources !== undefined && !r.sourceId && <div className="my-3 rounded-control bg-bg-sunk p-3 text-[13px]">
      <p className="mb-2 text-ink-3">仅绑定已存在且完整查询为此账号的 X 信源；保留该信源当前权限。绑定不会改变当前采集供应商和权限。</p>
      {bindingSources.length ? <div className="flex flex-wrap items-end gap-2"><div className="min-w-56 flex-1"><Field label="对应信源（显示当前参与方式）"><Select value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">请选择信源</option>{bindingSources.map(s => <option key={s.id} value={s.id}>{s.name} · {MODE_LABEL[s.participation_mode] ?? s.participation_mode} · {s.id}</option>)}</Select></Field></div><Button disabled={!sourceId || !!pending} onClick={() => setOpen(true)}>绑定账号</Button></div> : <Empty>当前没有匹配的单账号信源。请先在信源页建立完整的 from:账号 查询，再刷新此页。</Empty>}
    </div>}
    <ReasonDialog open={open} title="绑定账号到现有信源" description="服务端将核对完整单账号查询与稳定账号身份；绑定不会修改参与方式、公开权限，也不会自动切换采集器。" busy={!!pending} onClose={close} onSubmit={async reason => {
      if (!sourceId || !bindingSources?.some(source => source.id === sourceId)) return false;
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { sourceId, reason }, { label: `bind:${r.id}`, success: "账号已绑定，可在信源页继续预检" }) !== null;
    }} />
  </>;
}
