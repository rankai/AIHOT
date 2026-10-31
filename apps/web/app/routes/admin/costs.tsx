import type { CostFilters, CostResponse } from "@aihot/contracts/costs";
import { SITE } from "@aihot/industry/site";
import { data, isRouteErrorResponse, useRouteError } from "react-router";
import type { Route } from "./+types/costs";
import { adminGet } from "../../lib/admin.server";
import { AdminPage, ButtonLink, Card } from "../../features/admin/ui";
import { CostCenter } from "../../features/admin/costs";
import {
  CostFilterError,
  costGroupBy,
  costPageView,
  costSearchParams,
  resolveCostRange,
} from "../../features/admin/costs-data";

const ORIGINS = new Set(["live", "replay", "imported"]);
const ENVIRONMENTS = new Set(["production", "development", "test", "other", "unknown"]);
const STATUSES = new Set(["pending", "received", "failed", "unknown"]);
const COST_BASES = new Set(["actual", "estimated"]);
const OWNERS = new Set(["member", "admin", "system", "unassigned"]);

function optionalEnum<T extends string>(value: string | null, values: Set<string>, label: string): T | null {
  if (!value || value === "all") return null;
  if (!values.has(value)) throw new CostFilterError(`${label}筛选值无效。`);
  return value as T;
}

function optionalPositiveInteger(value: string | null, label: string): number | null {
  if (!value) return null;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new CostFilterError(`${label}必须是正整数。`);
  return Number(value);
}

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const search = new URL(request.url).searchParams;
    const view = costPageView(search.get("view"));
    const range = resolveCostRange(search, Date.now());
    if (view === "billing") return { view, range, costs: null } as const;

    const groupBy = costGroupBy(search.get("groupBy"));
    const selectedSkill = search.get("skill");
    const [skillIdFromSelect, moduleIdFromSelect] = selectedSkill?.includes(":")
      ? selectedSkill.split(":", 2)
      : [null, null];
    const skillId = search.get("skillId") || skillIdFromSelect || null;
    const moduleId = search.get("moduleId") || moduleIdFromSelect || null;
    if (!!skillId !== !!moduleId) throw new CostFilterError("Skill 和模块必须同时选择。");

    const userId = optionalPositiveInteger(search.get("userId"), "用户 ID");
    const username = search.get("username")?.trim().toLowerCase() || null;
    if (userId !== null && username) throw new CostFilterError("用户 ID 和用户名只能填写一个。");

    const filters: CostFilters = {
      billingProvider: search.get("billingProvider")?.trim() || null,
      service: search.get("service")?.trim() || null,
      operation: search.get("operation")?.trim() || null,
      model: search.get("model")?.trim() || null,
      skillId,
      moduleId,
      userId,
      username,
      owner: optionalEnum(search.get("owner"), OWNERS, "执行者"),
      origin: optionalEnum(search.get("origin") ?? "live", ORIGINS, "来源"),
      environment: optionalEnum(search.get("environment"), ENVIRONMENTS, "执行环境"),
      status: optionalEnum(search.get("status"), STATUSES, "调用状态"),
      costBasis: optionalEnum(search.get("costBasis"), COST_BASES, "费用依据"),
    };
    const apiSearch = costSearchParams({ ...range, view, groupBy, filters, cursor: search.get("cursor") });
    apiSearch.set("limit", "50");
    const costs = await adminGet<CostResponse>(request, `/api/admin/costs?${apiSearch}`);
    return { view, range, costs } as const;
  } catch (error) {
    if (error instanceof CostFilterError) throw data({ message: error.message }, { status: 400 });
    throw error;
  }
}

export const meta: Route.MetaFunction = () => [{ title: `成本中心 · ${SITE.name} 后台` }];

export default function CostsAdmin({ loaderData }: Route.ComponentProps) {
  return <CostCenter page={loaderData} />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 503;
  const message =
    isRouteErrorResponse(error) && error.data && typeof error.data === "object" && "message" in error.data && typeof error.data.message === "string"
      ? error.data.message
      : null;
  const detail =
    message ??
    (isRouteErrorResponse(error) && typeof error.data === "string" ? error.data : null) ??
    (status === 503 ? "统计暂时繁忙，可缩小时间范围或稍后重试。" : "查询条件无法读取，请检查时间、用户和筛选条件。");
  return (
    <AdminPage title="成本中心" subtitle="查询本地已存的调用与费用证据。">
      <Card title={status === 400 ? "查询条件有误" : "成本统计暂不可用"}>
        <p className="break-words text-[13.5px] leading-relaxed text-ink-3">{detail}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink to="/admin/costs">恢复默认范围</ButtonLink>
          <ButtonLink to="/admin/runs">查看运行与回执</ButtonLink>
        </div>
      </Card>
    </AdminPage>
  );
}
