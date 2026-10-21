import { useState } from "react";
import { useNavigate } from "react-router";
import { useAdminAction } from "./action";
import type { OperationResult } from "./operation-types";
import { xSearchDetailBody } from "./x-detail-data";
import { isXSearchWork } from "./x-search-import-data";
import { Button } from "./ui";
export function XDetailActions({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction(), navigate = useNavigate(), [error, setError] = useState<string | null>(null);
  if (!isXSearchWork(r.kind, r.data)) return null;
  let issue: string | null = null;
  try { xSearchDetailBody(r); } catch (error) { issue = (error as Error).message; }
  return <section aria-label="X 同作品详情查询" className="space-y-2">
    <p className="text-[12px] text-ink-3">新建独立只读详情查询，使用 query 次数预算；当前费用估算未知，以预算与回执为准。不重开原任务、不推进采集游标，不自动导入。</p>
    <Button size="sm" disabled={!!issue || !!pending} busy={!!pending} onClick={async () => {
      if (pending) return;
      try {
        const body = xSearchDetailBody(r); setError(null);
        const accepted = await run<{ runId: number; status: string }>("POST", "/api/admin/redfox/x/tweets/query", body, { label: `x-work-detail:${r.id}`, revalidate: false });
        if (accepted) navigate(`/admin/operations/${accepted.runId}`);
      } catch (error) { setError((error as Error).message); }
    }}>查询该作品详情</Button>
    {issue && <p className="whitespace-pre-wrap break-words text-[12px] text-amber">{issue}</p>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-[13px] text-hot">{error}</p>}
  </section>;
}
