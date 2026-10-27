import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAdminAction } from "./action";
import { detailQueryBody, detailQueryOperation, detailQueryPrice, isDetailQueryResult } from "./detail-query-data";
import type { DetailQueryOptions } from "./detail-query-types";
import type { OperationResult } from "./operation-types";
import { PlatformFields } from "./platform-fields";
import { platformLabels } from "./platform-labels";
import { Button, Field, Json, Select } from "./ui";

export function DetailQueryActions({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction(), navigate = useNavigate();
  const [options, setOptions] = useState<DetailQueryOptions | null>(null), [operationId, setOperationId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({}), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null), currentId = useRef(r.id); currentId.current = r.id;
  useEffect(() => () => controller.current?.abort(), [r.id]);
  if (!isDetailQueryResult(r.kind, r.data)) return null;
  const current = options?.resultId === r.id ? options : null, choice = current?.choices.find(choice => choice.operationId === operationId);
  let operation: ReturnType<typeof detailQueryOperation> | null = null, unsupported: string | null = null;
  try { if (choice) operation = detailQueryOperation(choice); } catch (error) { unsupported = (error as Error).message; }
  return <section className="min-w-0 space-y-3 rounded-control border border-line p-3" aria-label="作品与账号详情">
    <Button size="sm" disabled={!!pending || loading} busy={loading} onClick={async () => {
      controller.current?.abort(); const request = new AbortController(); controller.current = request;
      setLoading(true); setError(null); setOptions(null); setOperationId("");
      try {
        const response = await fetch(`/api/admin/operations/results/${r.id}/detail-options`, { credentials: "same-origin", signal: request.signal });
        if (response.status === 401) { window.location.href = `/admin/login?${new URLSearchParams({ return: window.location.pathname + window.location.search })}`; return; }
        const data = await response.json();
        if (!response.ok) throw new Error(data?.detail ?? `读取失败（${response.status}）`);
        if (request.signal.aborted) return;
        if (data.resultId !== currentId.current) throw new Error("返回选项与当前结果不匹配，已拒绝使用，请重新读取。");
        setOptions(data);
      } catch (error) { if (!request.signal.aborted) setError((error as Error).message); }
      finally { if (!request.signal.aborted) setLoading(false); }
    }}>查看可用详情接口</Button>
    {current && (current.choices.length ? <form className="min-w-0 space-y-3" aria-label="作品与账号详情查询" onSubmit={async event => {
      event.preventDefault(); if (pending || loading) return;
      let body: ReturnType<typeof detailQueryBody>;
      try { body = detailQueryBody(r.id, current, operationId, drafts[operationId] ?? {}); setError(null); } catch (error) { setError((error as Error).message); return; }
      const accepted = await run<{ runId: number; status: string }>("POST", "/api/admin/redfox/queries", body, { label: `work-detail:${r.id}`, revalidate: false });
      if (accepted) navigate(`/admin/operations/${accepted.runId}`);
      else setError("查询未完成，目标与草稿已保留。若提示来源或选项已变化，请重新读取；不会自动尝试其他接口。");
    }}>
      <p className="text-[12px] text-ink-3">当前范围：{platformLabels[String(r.data.platform)] ?? r.data.platform as string} · 结果 #{r.id} 的已收作品 / 作者账号定位；具体范围以所选接口为准，不推进原分页。</p>
      <Field label="补全接口 / 目标库"><Select aria-label="补全接口 / 目标库" required value={operationId} disabled={!!pending || loading} onChange={event => { setOperationId(event.target.value); setError(null); }}><option value="">请选择已确认目标</option>{current.choices.map(choice => <option key={choice.operationId} value={choice.operationId}>{choice.label}</option>)}</Select></Field>
      {choice && <p className="text-[12px] text-ink-3">{detailQueryPrice(choice)}；使用 query 次数预算，即使估价为 0 也计次数。估算不代表实际实扣。</p>}
      {operation && operation.fields.length > 0 && <><p className="text-[12px] text-ink-3">仅下列字段可填写；未声明默认值，不用示例代填。稳定身份和原文参数保持冻结。</p><PlatformFields operation={operation} values={drafts[operationId] ?? {}} disabled={!!pending || loading} onChange={(name, value) => setDrafts(previous => ({ ...previous, [operationId]: { ...previous[operationId], [name]: value } }))} /></>}
      <p className="text-[12px] text-ink-3">点击将创建一次新独立查询，不重开原任务、不推进原采集游标；所选接口可补作品或作者账号详情；结果回来后仍需显式导入或绑定。身份冲突不能用人工依据覆盖，不会自动换库或回退。</p>
      {choice && <Json value={{ sourceResultId: r.id, operationId: choice.operationId, parameters: choice.parameters }} label="冻结查询参数（只读）" />}
      {unsupported && <p className="text-[12px] text-amber">{unsupported}</p>}
      <Button type="submit" size="sm" tone="primary" disabled={!choice || !!unsupported || !!pending || loading} busy={!!pending}>查询补充详情并查看任务</Button>
    </form> : <p className="whitespace-pre-wrap break-words text-[12px] text-ink-3">{current.reason ?? "本结果没有返回可用补全选项；不会自动尝试其他接口。"}</p>)}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-[13px] text-hot">{error}</p>}
  </section>;
}
