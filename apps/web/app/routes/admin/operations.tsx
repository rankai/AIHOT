import { SITE } from "@aihot/industry/site";
import type { Route } from "./+types/operations";
import { adminGet } from "../../lib/admin.server";
import { AdminPage, Button, ButtonLink, Card } from "../../features/admin/ui";
import { operationEnded, type OperationRow } from "../../features/admin/operation-types";
import { OperationTable, useOperationPolling } from "../../features/admin/operation-ui";
export async function loader({ request }: Route.LoaderArgs) { return adminGet<{ rows: OperationRow[] }>(request, "/api/admin/operations/runs"); }
export const meta: Route.MetaFunction = () => [{ title: `执行记录 · ${SITE.name} 后台` }];
export default function Operations({ loaderData: { rows } }: Route.ComponentProps) {
  const refresh = useOperationPolling(rows.some(r => !operationEnded(r.status) && r.status !== "stopped"));
  return <AdminPage title="执行记录" subtitle="每条记录对应一次采集、查询或工具执行，可查看进度、结果与回执。采集订阅在信源页管理。显示最近 100 项；进行中的执行在页面可见时每 20 秒刷新。" actions={<><Button busy={refresh.state !== "idle"} onClick={() => refresh.revalidate()}>刷新</Button><ButtonLink to="/admin/runs">预算、回执与队列</ButtonLink></>}><Card pad={false}><OperationTable rows={rows} /></Card></AdminPage>;
}
