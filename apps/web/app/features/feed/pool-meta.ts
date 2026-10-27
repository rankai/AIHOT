import { SITE, withSubject } from "@aihot/industry/site";
import type { PoolResponse } from "@aihot/contracts/site";
import type { SitePresentation } from "@aihot/contracts/presentation";
import { listPath, pageMeta } from "../../lib/seo";
import { navigationLabel } from "../../lib/presentation";
import type { PoolBase } from "./pool-navigation";

export function poolPageMeta(data: PoolResponse | undefined, base: PoolBase, presentation?: SitePresentation) {
  const column = data?.column;
  const videosOnly = column?.scope === "videos" || data?.filters.videosOnly === true || base === "/videos";
  const f = data?.filters, q = f?.q, page = data?.page ?? 1;
  const label = column?.label ?? navigationLabel(presentation, videosOnly ? "videos" : "all", videosOnly ? "视频" : `全部${withSubject("动态")}`);
  return pageMeta({
    title: q ? column ? `${label}搜索：${q}` : `${navigationLabel(presentation, videosOnly ? "videos" : "all", videosOnly ? "视频" : "")}搜索：${q}` : label,
    description: column ? `${SITE.name} 的${column.label}栏目，支持栏目内搜索。` : videosOnly ? `${SITE.name} 已确认含视频的公开内容，打开详情后前往原站观看。` : `${SITE.name} 收录的全部${withSubject("动态")}，可按类别与标签筛选，支持中英文搜索。`,
    path: listPath(base, { ...(!column && !base.startsWith("/columns/") ? { channel: f && f.channel !== "all" ? f.channel : null, category: f?.category, tag: f?.tag } : {}), q, tab: f?.tab === "relevance" ? "relevance" : null, page: page > 1 ? page : null, pageSize: data?.pageSize }),
    noindex: !!q,
  });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=30" };
}
