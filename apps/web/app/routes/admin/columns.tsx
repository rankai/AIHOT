import type { AdminPresentationSettings } from "@aihot/contracts/presentation";
import { SITE } from "@aihot/industry/site";
import { PresentationSettings } from "../../features/admin/presentation-settings";
import { AdminPage } from "../../features/admin/ui";
import { adminGet } from "../../lib/admin.server";
import type { Route } from "./+types/columns";

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<AdminPresentationSettings>(request, "/api/admin/settings/presentation");
}

export const meta: Route.MetaFunction = () => [{ title: `栏目管理 · ${SITE.name} 后台` }];

export default function ColumnsAdmin({ loaderData }: Route.ComponentProps) {
  return (
    <AdminPage title="栏目管理" subtitle="管理前台栏目、分类入口和列表数量。保存后按现有缓存规则生效。">
      <PresentationSettings settings={loaderData} />
    </AdminPage>
  );
}
