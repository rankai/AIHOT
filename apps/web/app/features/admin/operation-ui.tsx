import { useEffect } from "react";
import { Link, useRevalidator } from "react-router";
import { Badge, DataTable } from "./ui";
import { operationLabel, operationStatus, type OperationAccepted, type OperationRow } from "./operation-types";
import { Time } from "./ui";

export function OperationLink({ operation, newTab = false }: { operation: OperationAccepted; newTab?: boolean }) {
  return <div className="rounded-control bg-accent-soft px-4 py-3 text-[13px] text-ink-2">已创建执行记录 #{operation.runId}（{operationStatus[operation.status] ?? operation.status}）。<Link to={`/admin/operations/${operation.runId}`} target={newTab ? "_blank" : undefined} rel={newTab ? "noreferrer" : undefined} className="ml-2 font-medium text-accent">查看执行记录{newTab ? " ↗" : ""}</Link></div>;
}
export function OperationBadge({ status }: { status: string }) {
  return <Badge tone={status === "completed" ? "ok" : status === "needs_review" || status === "failed" ? "bad" : status === "waiting" || status === "stopped" ? "warn" : "muted"}>{operationStatus[status] ?? status}</Badge>;
}
export function OperationTable({ rows }: { rows: OperationRow[] }) {
  return <DataTable rows={rows} rowKey={r => r.id} empty="还没有执行记录" columns={[
    { key: "id", label: "记录编号", render: r => <Link className="text-accent" to={`/admin/operations/${r.id}`}>#{r.id}</Link> },
    { key: "provider", label: "供应商 / 操作", render: r => <span>{r.provider}<span className="mt-1 block text-[12px] text-ink-3">{operationLabel[r.operationKey] ?? r.operationKey}</span></span> },
    { key: "status", label: "状态", render: r => <OperationBadge status={r.status} /> },
    { key: "reason", label: "等待原因", render: r => r.waitReason || "—" },
    { key: "next", label: "下次尝试", render: r => <Time at={r.nextAttemptAt} /> },
    { key: "at", label: "创建", render: r => <Time at={r.createdAt} /> },
  ]} />;
}
export function useOperationPolling(enabled: boolean) {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "visible") timer = setInterval(() => {
        if (revalidator.state === "idle") revalidator.revalidate();
      }, 20_000);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { if (timer) clearInterval(timer); document.removeEventListener("visibilitychange", sync); };
  }, [enabled, revalidator]);
  return revalidator;
}
