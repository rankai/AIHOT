import { isRouteErrorResponse, Link, useLoaderData, useLocation, useRouteError } from "react-router";
import type { Route } from "./+types/column";
import { loadPool } from "../features/feed/pool.server";
import { PoolPage } from "../features/feed/PoolPage";
import { poolPageMeta } from "../features/feed/pool-meta";
import { pageMeta } from "../lib/seo";
import { navigationLabel } from "../lib/presentation";
import { usePresentation } from "../lib/use-presentation";
import { RingMark } from "../components/Logo";
export { headers } from "../features/feed/pool-meta";

export async function loader({ request, params }: Route.LoaderArgs) {
  return loadPool(request, { columnId: params.id });
}
export function meta({ loaderData, params }: Route.MetaArgs) {
  return loaderData ? poolPageMeta(loaderData.data, `/columns/${params.id}`) : pageMeta({ title: "栏目暂不可用", path: `/columns/${params.id}`, noindex: true });
}
export default function ColumnPage() {
  const { data } = useLoaderData<typeof loader>();
  return <PoolPage data={data} base={`/columns/${data.column!.id}`} />;
}
export function ErrorBoundary() {
  const error = useRouteError(), { pathname, search } = useLocation();
  const presentation = usePresentation();
  const status = isRouteErrorResponse(error) ? error.status : 503;
  const title = status === 404 ? "没有这个栏目" : status === 400 ? "栏目地址参数有误" : "栏目暂不可用";
  return <div className="mx-auto max-w-sm py-24 text-center"><RingMark className="mx-auto mb-5 size-10 text-accent" /><h1 className="text-[20px] font-bold text-ink">{title}</h1><p className="mt-2 text-[14px] leading-relaxed text-ink-3">{status === 404 ? "该栏目不存在，请检查链接。" : status === 400 ? "栏目只接受搜索、排序、页码和每页条数，请检查链接。" : "暂时无法读取该栏目的配置，请稍后重试。"}</p><div className="mt-6 flex justify-center gap-3">{status !== 404 && status !== 400 && <Link to={`${pathname}${search}`} reloadDocument className="text-[13px] text-accent hover:underline">重试此栏目</Link>}<Link to="/" className="text-[13px] text-accent hover:underline">回到{navigationLabel(presentation, "selected", "精选")}</Link></div></div>;
}
