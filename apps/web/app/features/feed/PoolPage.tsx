import { withSubject } from "@aihot/industry/site";
import { Link, useNavigation, useSearchParams } from "react-router";
import type { PoolResponse } from "@aihot/contracts/site";
import { CATEGORY_LABELS, isCategoryKey } from "@aihot/contracts/taxonomy";
import { navigationLabel } from "../../lib/presentation";
import { usePresentation } from "../../lib/use-presentation";
import { CategoryTabs, SearchField } from "./Filters";
import { PillTabs } from "../../components/ui/Tabs";
import { DayList, Pagination } from "./DayList";
import { EmptyState } from "../../components/ui/Page";
import { poolHref, type PoolBase } from "./pool-navigation";

export function PoolPage({ data, base }: { data: PoolResponse; base: PoolBase }) {
  const column = data.column;
  const videosOnly = column?.scope === "videos" || data.filters.videosOnly === true;
  const presentation = usePresentation();
  const columnTitle = column?.label ?? navigationLabel(presentation, videosOnly ? "videos" : "all", videosOnly ? "视频" : `全部${withSubject("动态")}`);
  const scopeText = column ? [column.category ? (isCategoryKey(column.category) ? CATEGORY_LABELS[column.category] : column.category) : "不限分类", column.tag ? `#${column.tag}` : "不限标签", videosOnly ? "仅含视频" : "全部公开内容"].join(" · ") : null;
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const f = data.filters;
  const busy = navigation.state === "loading" && navigation.location?.pathname === base;
  const keep: Record<string, string | null> = column ? { pageSize: String(data.pageSize), tab: f.tab === "relevance" ? "relevance" : null } : { channel: f.channel === "all" ? null : f.channel, category: f.category, tag: f.tag, pageSize: String(data.pageSize), tab: f.tab === "relevance" ? "relevance" : null };
  const searchTabHref = (tab: "time" | "relevance") => poolHref(base, params, data.pageSize, { page: null, tab: tab === "relevance" ? "relevance" : null });
  const title = f.q ? `搜索“${f.q}”` : !column && f.tag ? `#${f.tag}` : null;
  const updated = new Date(data.freshness).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });

  return (
    <div className="pb-6">
      {/* Desktop, as on 精选: the title, then one filter row with the search field aligned on the right. */}
      <div className="hidden lg:block">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">{title ?? columnTitle}</h1>
        <div className="mb-5 mt-4 flex items-center justify-between gap-4">
          {!column && <CategoryTabs base={base as "/all" | "/videos"} category={f.category} channel={f.channel} layoutId={`${base}-cat-desk`} className="min-w-0" pageSize={data.pageSize} />}
          <SearchField action={base} variant="track" defaultValue={f.q ?? ""} keep={keep} />
        </div>
      </div>

      {/* Phones: title with today's count, the search bar, then the same filter row as 精选. */}
      <div className="lg:hidden">
        <div className="flex items-baseline justify-between gap-3 pb-3 pt-5">
          <h1 className="min-w-0 text-[22px] font-bold text-ink [overflow-wrap:anywhere]">{title ?? (column?.label ?? navigationLabel(presentation, videosOnly ? "videos" : "all", videosOnly ? "视频" : "全部动态"))}</h1>
          {!f.q && (
            <span className="shrink-0 whitespace-nowrap text-[12.5px] text-ink-4">
              今日 <span className="num">{data.todayCount}</span> 条
            </span>
          )}
        </div>
        <SearchField action={base} variant="bar" defaultValue={f.q ?? ""} keep={keep} autoFocus={params.get("search") === "1"} />
        <div className="-mx-4 mt-3 border-b border-line-soft px-4 pb-3">
          {!column && <CategoryTabs base={base as "/all" | "/videos"} category={f.category} channel={f.channel} layoutId={`${base}-cat-mobile`} size="sm" className="min-w-0" pageSize={data.pageSize} />}
        </div>
      </div>

      {scopeText && <p className="mb-4 mt-3 break-words text-[12.5px] text-ink-3">栏目范围：{scopeText}。分类与标签同时满足。</p>}
      {f.q && <Link to={poolHref(base, params, data.pageSize, { q: null, tab: null, page: null })} className="mb-3 inline-block text-[13px] text-accent hover:underline">清除搜索{column ? "，浏览此栏目" : ""}</Link>}
      {f.q && (
        <div className="mb-3 mt-3 flex flex-wrap items-center justify-between gap-2 lg:mt-0">
          <PillTabs
            size="xs"
            layoutId={`${base}-search-sort`}
            label="搜索排序"
            active={f.tab}
            items={(["time", "relevance"] as const).map((t) => ({ key: t, label: t === "time" ? "最新（标题与摘要）" : "全文相关", to: searchTabHref(t) }))}
          />
          <span className="text-[12px] text-ink-4">
            找到 <span className="num">{data.total >= 2000 ? "2000+" : data.total}</span> 条 · 更新于 <span className="num">{updated}</span>
          </span>
        </div>
      )}

      <div className={`transition-opacity duration-200 ${busy ? "opacity-50" : ""}`}>
        {data.items.length === 0 ? (
          <div className="mt-2 lg:card">
            <EmptyState
              title={videosOnly && !f.q ? "暂时没有视频内容" : "没有找到相关内容"}
              action={
                f.q && f.tab === "time" ? (
                  <Link to={searchTabHref("relevance")} className="text-[13px] font-medium text-accent hover:underline">
                    试试“全文相关”，连正文一起搜
                  </Link>
                ) : undefined
              }
            >
              {f.q ? column ? "换个说法，或清除搜索浏览此栏目。栏目范围保持不变。" : "换个说法，或者去掉筛选再试。" : videosOnly ? "这里只展示已确认含视频的公开内容，稍后再来看看。" : "这个筛选下暂时没有内容。"}
            </EmptyState>
          </div>
        ) : (
          <DayList linkBase={videosOnly ? "/videos" : "/all"} listPageSize={data.pageSize} items={data.items} todayCount={f.q ? null : data.todayCount} showTags />
        )}
      </div>
      <Pagination page={data.page} pageCount={data.pageCount} href={(page) => poolHref(base, params, data.pageSize, { page: page > 1 ? page : null })} />
      {data.total >= 2000 && data.page >= data.pageCount && <p className="mt-4 text-center text-[12px] text-ink-4">最多提供最近 2,000 条内容（每页 {data.pageSize} 条），更早的内容请使用搜索或主题页。</p>}
    </div>
  );
}
