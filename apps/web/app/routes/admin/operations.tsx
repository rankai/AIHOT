import { SITE } from "@aihot/industry/site";
import { Form, Link } from "react-router";
import type { Route } from "./+types/operations";
import { adminGet } from "../../lib/admin.server";
import { AdminPage, Button, ButtonLink, Card, Field, Select } from "../../features/admin/ui";
import { operationEnded, operationStatus, type OperationRow } from "../../features/admin/operation-types";
import { OperationTable, useOperationPolling } from "../../features/admin/operation-ui";
export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams, filters = new URLSearchParams();
  for (const key of ["subscriptionId", "status"]) if (params.has(key) && (key === "subscriptionId" || params.get(key))) filters.set(key, params.get(key)!);
  const result = await adminGet<{ rows: OperationRow[] }>(request, `/api/admin/operations/runs${filters.size ? `?${filters}` : ""}`);
  return { ...result, subscriptionId: params.get("subscriptionId"), status: params.get("status") ?? "" };
}
export const meta: Route.MetaFunction = () => [{ title: `执行记录 · ${SITE.name} 后台` }];
export default function Operations({ loaderData: { rows, subscriptionId, status } }: Route.ComponentProps) {
  const refresh = useOperationPolling(rows.some(r => !operationEnded(r.status) && r.status !== "stopped"));
  return <AdminPage title="执行记录" subtitle="每条记录对应一次采集、查询或工具执行，可查看进度、结果与回执。显示当前范围最近 100 项；进行中的执行在页面可见时每 20 秒刷新。" actions={<><Button busy={refresh.state !== "idle"} onClick={() => refresh.revalidate()}>刷新</Button><ButtonLink to="/admin/data-tools">数据工具</ButtonLink><ButtonLink to="/admin/runs">预算、回执与队列</ButtonLink></>}>
    <Card className="mb-5">
      {subscriptionId && <p className="mb-3 text-[13px] text-ink-2">当前范围：采集订阅 #{subscriptionId} 的执行历史与结果</p>}
      <Form method="get" className="flex flex-wrap items-end gap-3">
        {subscriptionId && <input type="hidden" name="subscriptionId" value={subscriptionId} />}
        <Field label="执行状态"><Select name="status" aria-label="执行状态" key={status} defaultValue={status}><option value="">全部状态</option>{Object.entries(operationStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        <Button type="submit">筛选</Button>
        {(subscriptionId || status) && <Link className="py-2 text-[13px] text-accent" to="/admin/operations">清除筛选</Link>}
      </Form>
    </Card>
    <Card pad={false}><OperationTable rows={rows} empty={subscriptionId || status ? "当前筛选条件下没有执行记录。可调整状态或清除筛选查看其他记录。" : "还没有执行记录。可从数据工具提交查询，或在采集订阅中运行一轮。"} /></Card>
  </AdminPage>;
}
