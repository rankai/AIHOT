import { useCallback, useState } from "react";
import { useFetcher } from "react-router";
import { useAdminAction } from "./action";
import { Badge, Button, Card, Field, Json, ReasonDialog, Select } from "./ui";
import { collectionPreflightMatches, collectionTargets, mpAgentKeyCost, mpCollectionCost, mpLibraryLabel, sameCollectionTarget, type CollectionPreflight, type MpLibrary } from "./operation-switch-data";
export type { CollectionPreflight } from "./operation-switch-data";
const providerLabel = { redfox: "Redfox", socialdata: "SocialData", dajiala: "大加辣", agentkey: "AgentKey · TikHub" };
const conclusions = { supported: "支持", unsupported: "不支持", unverified: "账户权限待核实", unavailable: "当前不可用" };
const checks: Record<string, string> = { subscription: "主订阅", configuration: "配置兼容", credentials: "服务凭证", execution: "执行能力", query: "完整查询范围", ordering: "排序", account: "稳定账号绑定", replyFilter: "回复过滤", article: "X Article 正文", incremental: "增量与积压", "permission:API_1790148502632": "账号作品列表权限", "permission:QCP75W33": "推文详情权限", initialized: "首次采集状态", identity: "同源稳定身份", "permission:8IQD0BJC": "广域库列表权限", "permission:1LDQ7E1C": "广域库正文权限", "permission:XNV30XZ3": "优质库列表权限", "permission:XEO0QQNF": "优质库正文权限" };
export function CollectionSwitch({ sourceId, kind, provider, savedLibrary, intervalMinutes, subscriptionId, sourceVersion, subscriptionVersion, activeRunId }: { sourceId: string; kind: string; provider: string | null; savedLibrary: MpLibrary | null; intervalMinutes: number; subscriptionId: number | null; sourceVersion: string; subscriptionVersion: number | null; activeRunId: number | null }) {
  const fetcher = useFetcher<{ preflights: CollectionPreflight[] | null }>();
  const { run, pending } = useAdminAction();
  const mp = kind === "mp_account";
  const [library, setLibrary] = useState<MpLibrary>("wide");
  const [selected, setSelected] = useState<CollectionPreflight | null>(null);
  const [invalid, setInvalid] = useState(false);
  const close = useCallback(() => setSelected(null), []);
  const preflights = fetcher.data?.preflights;
  const current = (p: CollectionPreflight) => !invalid && collectionPreflightMatches(p, { id: sourceId, kind, version: sourceVersion, subscriptionVersion }, library);
  return <Card title="切换采集器" right={<Button size="sm" busy={fetcher.state !== "idle"} disabled={!!pending} onClick={() => { setInvalid(false); fetcher.load(`/admin/sources/${encodeURIComponent(sourceId)}?${new URLSearchParams({ preflight: "1", ...(mp ? { library } : {}) })}`); }}>重新预检</Button>}>
    <p className="mb-3 text-[13px] text-ink-3">{mp ? "按此公众号主订阅的稳定账号身份、首次采集状态和所选库检查目标采集器。预检只读配置与已有证据，不付费探测；账户权限待核实仍可切换，由首次有界执行确认，预算与总开关仍控制实际请求。" : "按此信源当前的 X 查询、排序、必要正文与增量状态检查目标采集器。预检只读配置与已有证据，不付费探测；待核实的账户权限由首次有界执行确认，预算与总开关仍控制实际请求。"}</p>
    {mp && <div className="mb-4 space-y-3 text-[12.5px] text-ink-3">
      <p>当前：{provider ? providerLabel[provider as keyof typeof providerLabel] ?? provider : "尚未迁移"}{provider === "redfox" ? ` · ${savedLibrary ? mpLibraryLabel[savedLibrary] : "未保存库配置"}` : ""}；原周期 {intervalMinutes} 分钟，主订阅 #{subscriptionId ?? "未迁移"}。</p>
      <Field label="Redfox 目标库" hint="默认广域库，可显式选优质库；改库后须重新预检，不自动跨库或失败回退。"><Select aria-label="Redfox 目标库" value={library} disabled={!!pending} onChange={event => { setLibrary(event.target.value as MpLibrary); setInvalid(true); }}><option value="wide">广域库</option><option value="premium">优质库</option></Select></Field>
      <p>Redfox 两库文章列表均为 T+1；已知链接的实时详情不提供实时发现能力。AgentKey · TikHub 不使用 Redfox 库，其刷新时效尚未确认。保留原周期、信源与订阅 ID 及权限，只处理最新第一页中最多 8 条需要处理的材料。</p>
      <p>Redfox：{mpCollectionCost}</p><p>{mpAgentKeyCost}</p><p>预检时间影响：未知时区或缺少可信发表时间的新增材料按历史/回填语义处理，不把发现时间当作发表时间。</p>
    </div>}
    <div className="space-y-4">{collectionTargets(kind).map(target => {
      const p = preflights?.find(p => p.target === target && p.sourceId === sourceId);
      const same = sameCollectionTarget(kind, provider, target, savedLibrary, library);
      const passed = p?.checks.filter(c => c.conclusion === "supported").length ?? 0;
      const attention = p?.checks.filter(c => c.conclusion !== "supported") ?? [];
      const unverified = attention.some(c => c.conclusion === "unverified");
      return <section key={target} className="rounded-control border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[14px] font-medium">{providerLabel[target]}{mp && target === "redfox" ? ` · ${mpLibraryLabel[library]}` : ""} {same && <Badge>{mp ? "当前配置" : "当前采集器"}</Badge>}</span><Button size="sm" disabled={!p?.supported || !current(p) || same || !!pending || fetcher.state !== "idle"} onClick={() => p && setSelected(p)}>查看影响并切换</Button></div>
        {!p ? <p className="mt-2 text-[12.5px] text-ink-3">尚未预检。运行预检后显示此目标的支持情况与阻断原因。</p> : <>
          {!current(p) && <p className="mt-2 text-[12.5px] text-amber">配置或预检已变化，请重新预检后提交。</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
            <Badge tone={!current(p) ? "warn" : !p.supported ? "bad" : unverified ? "warn" : "ok"}>{!current(p) ? "预检已失效" : !p.supported ? "暂不能切换" : unverified ? "可以切换，账户权限待核实" : "预检通过"}</Badge>
            <span className="text-ink-3">{passed}/{p.checks.length} 项检查已通过</span>
          </div>
          {mp && target !== "dajiala" && p.impact?.firstImport === true && <p className="mt-3 rounded-control bg-amber/10 p-3 text-[13px] font-medium text-amber">首次采集影响：{p.impact.firstImportNote}</p>}
          {attention.length > 0 && <ul className="mt-3 space-y-2">{attention.map(c => <li key={c.key} className="text-[12.5px]">
            <span className="mr-2 font-medium">{checks[c.key] ?? "目标能力"}</span><Badge tone={c.conclusion === "unverified" ? "warn" : "bad"}>{conclusions[c.conclusion]}</Badge>
            <p className="mt-1 break-words text-ink-3">{c.evidence}</p>
          </li>)}</ul>}
          <details className="mt-3 rounded-control bg-bg-sunk/70 ring-1 ring-line">
            <summary className="cursor-pointer px-3 py-1.5 text-[12px] text-ink-3">完整检查与映射诊断（{p.checks.length} 项）</summary>
            <div className="space-y-3 p-3">
              <ul className="space-y-3">{p.checks.map(c => <li key={c.key} className="text-[12px]">
                <span className="mr-2 font-medium">{checks[c.key] ?? "目标能力"}</span><Badge tone={c.conclusion === "supported" ? "ok" : c.conclusion === "unverified" ? "warn" : "bad"}>{conclusions[c.conclusion]}</Badge>
                <p className="mt-1 break-words text-ink-3">{c.evidence}</p><p className="break-words text-[11px] text-ink-4">检查项：{c.key} · 依据：{c.source}</p>
              </li>)}</ul>
              <Json value={{ library: p.library, impact: p.impact, mapping: p.mapping, sourceVersion: p.sourceVersion, subscriptionVersion: p.subscriptionVersion, mappingVersion: p.mappingVersion }} label="参数映射与版本" />
            </div>
          </details>
        </>}
      </section>;
    })}</div>
    <ReasonDialog open={selected !== null} title={`切换到 ${selected ? providerLabel[selected.target] : ""}${mp && selected?.target === "redfox" && selected.library ? ` · ${mpLibraryLabel[selected.library]}` : ""}`} description={<div className="space-y-2">{invalid && <p className="text-hot">切换未成功，原采集器保持。请关闭此对话框并重新预检后提交。</p>}{mp && selected?.target !== "dajiala" && selected?.impact?.firstImport === true && <p className="rounded-control bg-amber/10 p-3 text-[13px] font-medium text-amber">首次采集影响：{selected.impact.firstImportNote}</p>}<p>保留同一个信源 ID、主订阅 ID、历史材料和当前权限。新采集由所选供应商接管；不启动另一条采集配置。</p>{mp && selected?.impact && <><p>信源 {selected.impact.sourceId}，主订阅 #{selected.impact.subscriptionId ?? "未迁移"}，原周期 {selected.impact.intervalMinutes} 分钟。{selected.target === "redfox" ? `明确选择 ${selected.library ? mpLibraryLabel[selected.library] : "未指定库"}，文章列表 T+1，不自动换库或失败回退；实时详情不等于实时发现。` : selected.target === "agentkey" ? "固定使用 AgentKey · TikHub；不使用 Redfox 库，不自动换供应商；刷新时效尚未确认。" : "切回大加辣原生采集。"}</p><p>{selected.impact.note}</p>{selected.target === "redfox" && <><p>{mpCollectionCost}</p><p>新增材料缺少可信时区或发表时间时按历史回填，不当作今天新发表。</p></>}{selected.target === "agentkey" && <p>{mpAgentKeyCost}</p>}</>}<p>{mp ? "在途旧请求仍可能完成和计费，但切换后的旧轮不能继续提交新材料。" : "已在途的旧轮执行按冻结版本收尾，仍可能完成和计费；过期结果不能覆盖新采集配置或游标。"}{activeRunId ? `当前执行记录 #${activeRunId}。` : ""}</p>{mp ? <p>供应商或库的分页位置与作品 UUID 不跨库复用；切换后旧轮失去提交资格，已发请求仍可能完成并计费。</p> : <p>仅映射已确认的稳定水位；不同供应商的分页游标不会直接照搬，已有未完成积压或必要能力缺失会阻断切换。</p>}{selected?.checks.some(c => c.conclusion === "unverified") && <p className="text-amber">目标接口的账户权限尚未核实，首次执行可能暂停并要求核对。</p>}</div>} busy={!!pending} onClose={close} onSubmit={async reason => {
      if (!selected || !current(selected) || !selected.supported) return false;
      const result = await run("POST", `/api/admin/sources/${encodeURIComponent(sourceId)}/collection/switch`, { target: selected.target, ...(mp && selected.target === "redfox" ? { library: selected.library } : {}), sourceVersion: selected.sourceVersion, subscriptionVersion: selected.subscriptionVersion, mappingVersion: selected.mappingVersion, reason }, { label: "switch", success: "采集器已切换" });
      if (result === null) setInvalid(true);
      return result !== null;
    }} />
  </Card>;
}
