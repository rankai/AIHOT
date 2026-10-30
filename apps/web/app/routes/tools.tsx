import { ToolPricingProvider } from '../features/tools/tool-submit';
import type { MemberPriceCatalog } from '@aihot/contracts/membership';
import { MemberPriceTable } from '../features/account/membership';
import { useState } from "react";
import { Link, useLoaderData, useNavigate, useSearchParams, type LoaderFunctionArgs } from "react-router";
import type { AccountMe } from "@aihot/contracts/account";
import type { ToolQuote } from "@aihot/contracts/credits";
import type { ToolAssetPage, ToolRunPage } from "@aihot/contracts/user-tools";
import { SITE } from "@aihot/industry/site";
import { accountGet } from "../lib/account.server";
import { ACCOUNT_HEADERS } from "../features/account/data";
import { Button, Card } from "../features/admin/ui";
import { QueryForm } from "../features/tools/query-form";
import { ImageToolForm, VideoToolForm } from "../features/tools/generation-forms";
import { AiSearchTool, CommentTool, TranscriptionTool, XLookupTool } from "../features/tools/text-forms";
import { ToolAssetLibrary } from "../features/tools/assets";
import { RunHistory } from "../features/tools/run-history";
import { parseRunFilters, runFiltersQuery } from "../features/tools/run-history-data";
import { QuoteDialog } from "../features/tools/quote-dialog";
import { useToolCommand } from "../features/tools/client";
import type { ToolOptions } from "../features/tools/types";
import { usePrivateAccount } from "../features/account/use-private-account";

export async function loader({ request }: LoaderFunctionArgs) {
  const filters = parseRunFilters(new URL(request.url).searchParams);
  const [me, options, assets, runs, pricing] = await Promise.all([
    accountGet<AccountMe>(request, "/api/account/me"), accountGet<ToolOptions>(request, "/api/tools/options"),
    accountGet<ToolAssetPage>(request, "/api/tools/assets"), accountGet<ToolRunPage>(request, `/api/tools/runs?${runFiltersQuery(filters)}`), accountGet<MemberPriceCatalog>(request, "/api/account/tool-pricing"),
  ]);
  return { me, options, assets, runs, filters, pricing };
}
export const headers = () => ACCOUNT_HEADERS;
export const meta = () => [{ title: `数据工具 · ${SITE.name}` }, { name: "robots", content: "noindex, nofollow" }];
const VIEWS = [["queries", "平台查询"], ["ai-search", "AI 搜索"], ["images", "图片创作"], ["videos", "视频创作"], ["helpers", "辅助工具"], ["assets", "私有素材"], ["runs", "我的执行记录"]] as const;

export default function Tools() {
  const data = useLoaderData<typeof loader>();
  usePrivateAccount(data.me);
  return <ToolPricingProvider catalog={data.pricing}><ToolsContent key={`${data.me.user.id}:${data.me.csrf}`} data={data} /></ToolPricingProvider>;
}

function ToolsContent({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  const [search, setSearch] = useSearchParams();
  const view = VIEWS.some(([value]) => value === search.get("view")) ? search.get("view")! : "queries";
  const [assets, setAssets] = useState(data.assets.items);
  const [quoted, setQuoted] = useState<{ kind: string; input: unknown; quote: ToolQuote } | null>(null);
  const command = useToolCommand(data.me.csrf);
  const navigate = useNavigate();
  async function submit(kind: string, input: unknown) {
    const quote = await command.run<ToolQuote>("/api/tools/quote", { kind, input });
    if (quote) setQuoted({ kind, input, quote });
  }
  const form = { options: data.options, submit, pending: command.pending };
  return <div className="pb-8 pt-5 lg:pt-1">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-[24px] font-semibold text-ink">数据工具</h1><p className="mt-1 text-[13px] leading-relaxed text-ink-3">查询、研究与创作。任务、结果和素材保存在你的账号中。</p></div><Link to="/account" className="rounded-control border border-line px-3 py-2 text-[13px] text-ink-2">{data.me.user.displayName} · 我的积分</Link></header>
    <MemberPriceTable catalog={data.pricing}/><nav className="mb-5 flex flex-wrap gap-2" aria-label="数据工具分类">{VIEWS.map(([key, label]) => <Button key={key} tone={view === key ? "primary" : "secondary"} aria-pressed={view === key} onClick={() => setSearch(previous => { const next = new URLSearchParams(previous); next.set("view", key); return next; }, { preventScrollReset: true })}>{label}</Button>)}</nav>
    {!quoted && command.error && <p role="alert" className="mb-4 rounded-control bg-hot-soft p-3 text-[13px] text-hot">{command.error}</p>}
    <div hidden={view !== "queries"} className="space-y-5"><Card title="平台数据查询"><QueryForm operations={data.options.operations.filter(row => row.platform !== "tools")} submit={submit} pending={command.pending} /></Card><Card title="X 账号与推文"><XLookupTool {...form} /></Card></div>
    <div hidden={view !== "ai-search"}><Card title="AI 搜索"><AiSearchTool {...form} /></Card></div>
    <div hidden={view !== "images"}><Card title="图片创作"><ImageToolForm options={data.options.images} assets={assets} submit={submit} pending={command.pending} /></Card></div>
    <div hidden={view !== "videos"}><Card title="视频创作"><VideoToolForm options={data.options.videos} assets={assets} uploadOptions={data.options.assets} csrf={data.me.csrf} onAssetChange={asset => setAssets(previous => [asset, ...previous.filter(row => row.key !== asset.key)])} submit={submit} pending={command.pending} /></Card></div>
    <div hidden={view !== "helpers"} className="space-y-5"><Card title="视频转写与字幕"><TranscriptionTool {...form} /></Card><Card title="媒体与辅助查询"><QueryForm operations={data.options.operations.filter(row => row.platform === "tools")} submit={submit} pending={command.pending} /></Card><Card title="小红书评论"><p className="text-sm text-ink-3">成本尚未核定，暂不开放付费；已有任务仍可查看与恢复。</p></Card></div>
    <div hidden={view !== "assets"}><Card title="私有素材"><p className="mb-4 text-[12px] text-ink-3">每个账号最多保存 {data.options.limits.storageFiles} 个文件，总容量 {Math.floor(data.options.limits.storageBytes / 1024 / 1024)} MiB。</p><ToolAssetLibrary page={data.assets} items={assets} options={data.options.assets} csrf={data.me.csrf} onChange={setAssets} submit={submit} /></Card></div>
    <div hidden={view !== "runs"}><RunHistory key={runFiltersQuery(data.filters).toString()} initialPage={data.runs} filters={data.filters} visible={view === "runs"} onFiltersChange={filters => { const next = runFiltersQuery(filters); next.set("view", "runs"); setSearch(next, { preventScrollReset: true }); }} /></div>
    {quoted && <QuoteDialog quote={quoted.quote} pending={command.pending} error={command.error} close={() => setQuoted(null)} confirm={async () => {
      const result = await command.run<{ runId: number }>(`/api/tools/${quoted.kind}`, { input: quoted.input, quoteId: quoted.quote.quoteId });
      if (result) navigate(`/tools/runs/${result.runId}`);
    }} />}
  </div>;
}
