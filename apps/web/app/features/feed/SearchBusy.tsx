import { Link } from "react-router";
import { RingMark } from "../../components/Logo";
import { navigationLabel } from "../../lib/presentation";
import { usePresentation } from "../../lib/use-presentation";
import { isColumnBase, poolParams, requestedPageSize, type PoolBase } from "./pool-navigation";

export function SearchBusy({ base = "/all", search = "" }: { base?: PoolBase; search?: string }) {
  const presentation = usePresentation();
  const custom = isColumnBase(base);
  const column = custom ? presentation.navigation.find((row) => `/columns/${row.id}` === base) : null;
  const label = custom ? column?.label ?? "此栏目" : navigationLabel(presentation, base === "/videos" ? "videos" : "all", base === "/videos" ? "视频" : "全部动态");
  const retryParams = poolParams(base, new URLSearchParams(search));
  const size = requestedPageSize(retryParams.get("pageSize"));
  if (!size) retryParams.delete("pageSize");
  const browseParams = new URLSearchParams(retryParams);
  for (const key of ["q", "tab", "page"]) browseParams.delete(key);
  const href = (params: URLSearchParams) => `${base}${params.size ? `?${params}` : ""}`;
  return <div className="mx-auto max-w-sm py-24 text-center">
    <RingMark className="mx-auto mb-5 size-10 text-accent" spinning />
    <h1 className="text-[20px] font-bold text-ink">搜索有点忙</h1>
    <p className="mt-2 text-[14px] leading-relaxed text-ink-3">现在搜索的人比较多，请稍等几秒再试。列表浏览不受影响。</p>
    <div className="mt-6 flex flex-wrap justify-center gap-2.5"><Link to={href(retryParams)} className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13.5px] font-medium text-accent-contrast hover:bg-accent-ink">重试搜索</Link><Link to={href(browseParams)} className="inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-4 text-[13.5px] text-ink-2 hover:border-ink-4">浏览{label}</Link><Link to="/" className="inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-4 text-[13.5px] text-ink-2 hover:border-ink-4">回到{navigationLabel(presentation, "selected", "精选")}</Link></div>
  </div>;
}
