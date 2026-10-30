import type { MemberPriceCatalog } from '@aihot/contracts/membership';
import { MemberPriceTable } from '../../features/account/membership';
import { useState } from "react";
import { Form, Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import type { CreditCharge, CreditChargePage, ToolCreditKind, ToolPrice, ToolPriceInput } from "@aihot/contracts/credits";
import type { PlatformOperationDescriptor } from "@aihot/contracts/redfox";
import { SITE } from "@aihot/industry/site";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, DataTable, Input, Select, Textarea, Time } from "../../features/admin/ui";
import { AccountNotice } from "../../features/account/fields";
import { ACCOUNT_HEADERS } from "../../features/account/data";
import { parsePriceMatch, priceMatchRows, TOOL_PRICE_KINDS, type MatchRow } from "../../features/admin/tool-price-data";

export async function loader({ request }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams;
  const filters = new URLSearchParams();
  for (const key of ["kind", "provider"]) if (params.get(key)) filters.set(key, params.get(key)!);
  const chargeFilters = new URLSearchParams({ state: params.get("state") === "reserved" ? "reserved" : "review", limit: "20" });
  if (params.get("before")) chargeFilters.set("before", params.get("before")!);
  const [prices, charges, operations, images, searches, transcriptions, pricing] = await Promise.all([
    adminGet<{ prices: ToolPrice[] }>(request, `/api/admin/tool-prices?${filters}`),
    adminGet<CreditChargePage>(request, `/api/admin/credit-charges?${chargeFilters}`),
    adminGet<PlatformOperationDescriptor[]>(request, "/api/admin/redfox/operations"),
    adminGet<{ models: Array<{ model: string; label: string; resolutions?: string[]; sizes?: string[] }> }>(request, "/api/admin/redfox/images/options"),
    adminGet<{ engines: Array<{ engine: string; label: string }> }>(request, "/api/admin/redfox/ai-searches/options"),
    adminGet<{ platforms: Array<{ platform: string; label: string }> }>(request, "/api/admin/redfox/transcriptions/options"),
    adminGet<MemberPriceCatalog>(request, "/api/admin/member-pricing"),
  ]);
  return { ...prices, pricing, charges, operations: operations.filter(operation => operation.platform !== "redfox-account"), images, searches, transcriptions };
}

export const headers = () => ACCOUNT_HEADERS;
export const meta = () => [{ title: `工具积分 · ${SITE.name} 后台` }, { name: "robots", content: "noindex, nofollow" }];
type Catalog = Pick<Awaited<ReturnType<typeof loader>>, "operations" | "images" | "searches" | "transcriptions">;
const kindLabel = (kind: string) => TOOL_PRICE_KINDS.find(item => item.kind === kind)?.label ?? kind;
const tierHints: Partial<Record<ToolCreditKind, string>> = {
  images: "填提交参数中的分辨率或尺寸，例如 1k、2k、1K、1024x1024；大小写必须一致。",
  videos: "Seedance 仅开放 480p / 8 秒 / 有声 / 3 张参考图；万相使用 wan-std 或 wan-pro 模式档位。",
};
const matchHints: Partial<Record<ToolCreditKind, string>> = {
  query: "例如 parameters.count、parameters.pageSize。", images: "例如 resolution、metadata.resolution、n、size。",
  videos: "例如 duration、generateAudio、returnLastFrame。", "ai-search": "例如 engine。", transcriptions: "例如 platform。", "xhs-comments": "例如 dataNum。",
};

function PriceEditor({ price, catalog, onClose }: { price: ToolPrice | null; catalog: Catalog; onClose: () => void }) {
  const { run, pending } = useAdminAction();
  const [kind, setKind] = useState<ToolCreditKind>(price?.kind ?? "query");
  const [provider, setProvider] = useState(price?.provider ?? "redfox");
  const [model, setModel] = useState(price?.model ?? "");
  const [tier, setTier] = useState(price?.tier ?? "");
  const [matches, setMatches] = useState<MatchRow[]>(priceMatchRows(price?.parameterMatch ?? {}));
  const [base, setBase] = useState(price ? String(price.baseCredits) : "");
  const [image, setImage] = useState(String(price?.imageCredits ?? 0));
  const [second, setSecond] = useState(String(price?.videoSecondCredits ?? 0));
  const [reference, setReference] = useState(String(price?.referenceCredits ?? 0));
  const [enabled, setEnabled] = useState(price?.enabled ?? true);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const models = kind === "query" ? catalog.operations.map(operation => ({ value: operation.id, label: `${operation.platform} · ${operation.label}` }))
    : kind === "images" ? catalog.images.models.map(item => ({ value: item.model, label: item.label }))
    : kind === "ai-search" ? catalog.searches.engines.map(item => ({ value: item.engine, label: item.label }))
    : kind === "transcriptions" ? catalog.transcriptions.platforms.map(item => ({ value: item.platform, label: item.label }))
    : kind === "videos" ? provider === "aliyun" ? [{ value: "wan2.2-animate-mix", label: "万相视频复刻" }] : [{ value: "seedance", label: "Seedance 视频创作" }] : [];
  const updateMatch = (index: number, patch: Partial<MatchRow>) => setMatches(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <Card title={price ? "编辑积分规则" : "新增积分规则"} right={<Button size="sm" disabled={!!pending} onClick={onClose}>收起</Button>}>
    <form className="space-y-5" onSubmit={async event => {
      event.preventDefault(); setError(null);
      try {
        const values = [base, image, second, reference].map(Number);
        if ([base, image, second, reference].some(value => !value.trim()) || values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("各项积分都必须填写零或正整数。");
        const input: ToolPriceInput = { ...(price ? { id: price.id, expectedVersion: price.version } : {}), kind, provider, model: model.trim(), tier: tier.trim(),
          parameterMatch: parsePriceMatch(matches), baseCredits: values[0]!, imageCredits: values[1]!, videoSecondCredits: values[2]!, referenceCredits: values[3]!, enabled, reason: reason.trim() };
        const saved = await run("PUT", "/api/admin/tool-prices", input, { label: "tool-price-save", success: "积分规则已保存，新报价将使用更新后的规则" });
        if (saved) onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "规则未保存，请检查输入。"); }
    }}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1.5 text-[12.5px] text-ink-2"><span>工具类别</span><Select value={kind} onChange={event => { const next = event.target.value as ToolCreditKind; setKind(next); setModel(next === "videos" ? provider === "aliyun" ? "wan2.2-animate-mix" : "seedance" : ""); setTier(next === "videos" && provider === "aliyun" ? "wan-std" : ""); setMatches([]); if (next !== "query" && next !== "videos") setProvider("redfox"); }}>{TOOL_PRICE_KINDS.map(item => <option value={item.kind} key={item.kind}>{item.label}</option>)}</Select></label>
        <label className="space-y-1.5 text-[12.5px] text-ink-2"><span>供应商</span><Select value={provider} onChange={event => { const next=event.target.value; setProvider(next); if (kind === "videos") {setModel(next === "aliyun" ? "wan2.2-animate-mix" : "seedance");setTier(next === "aliyun" ? "wan-std" : "480p");setMatches([]);} }}><option value="redfox">Redfox</option><option value="agentkey">AgentKey（成本待核）</option><option value="aliyun">阿里云万相</option></Select></label>
        <label className="space-y-1.5 text-[12.5px] text-ink-2"><span>{kind === "query" ? "查询工具 ID" : "模型 / 平台"}</span><Input value={model} onChange={event => setModel(event.target.value)} list="credit-price-models" autoComplete="off" placeholder={models.length ? "选择或输入标识" : "此类别通常留空"} /><datalist id="credit-price-models">{models.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</datalist></label>
        <label className="space-y-1.5 text-[12.5px] text-ink-2"><span>{provider === "aliyun" ? "万相模式档位" : "分辨率 / 尺寸档位"}</span><Input list="credit-price-tiers" value={tier} onChange={event => setTier(event.target.value)} placeholder={kind === "videos" ? provider === "aliyun" ? "wan-std 或 wan-pro" : "480p" : kind === "images" ? "与工具提交值一致" : "此类别留空"} /><datalist id="credit-price-tiers">{(provider === "aliyun" ? ["wan-std","wan-pro"] : kind === "videos" ? ["480p"] : kind === "images" ? ["1k"] : []).map(value => <option key={value} value={value}/>)}</datalist></label>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-3">模型与档位按精确值匹配，留空仅匹配未设置值，不代表全部。{tierHints[kind]}已接受任务保留原报价；修改只影响后续报价。</p>
      <div className="rounded-control border border-line p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-[13px] font-medium text-ink">参数条件（可选）</h3><p className="mt-1 text-[12px] text-ink-3">按工具提交参数精确匹配。{matchHints[kind]} 条件越具体，匹配优先级越高。</p></div><Button size="sm" onClick={() => setMatches(rows => [...rows, { key: "", type: "string", value: "" }])}>添加条件</Button></div>
        {matches.length === 0 && <p className="text-[12.5px] text-ink-4">未限定其他参数。具有同一类别、供应商、模型和档位的任务将使用本规则。</p>}
        {matches.map((row, index) => <div key={index} className="mb-2 grid gap-2 sm:grid-cols-[1.3fr_100px_1fr_auto]">
          <Input aria-label={`条件 ${index + 1} 参数路径`} required value={row.key} onChange={event => updateMatch(index, { key: event.target.value })} placeholder="参数路径" />
          <Select aria-label={`条件 ${index + 1} 类型`} value={row.type} onChange={event => updateMatch(index, { type: event.target.value as MatchRow["type"], value: event.target.value === "boolean" ? "true" : "" })}><option value="string">文本</option><option value="number">数字</option><option value="boolean">是 / 否</option></Select>
          {row.type === "boolean" ? <Select aria-label={`条件 ${index + 1} 值`} value={row.value} onChange={event => updateMatch(index, { value: event.target.value })}><option value="true">是</option><option value="false">否</option></Select> : <Input aria-label={`条件 ${index + 1} 值`} type={row.type === "number" ? "number" : "text"} step="any" value={row.value} onChange={event => updateMatch(index, { value: event.target.value })} placeholder="匹配值" required={row.type === "number"} />}
          <Button size="sm" onClick={() => setMatches(rows => rows.filter((_row, i) => i !== index))}>移除</Button>
        </div>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
        { label: "每任务基础积分", value: base, set: setBase }, { label: "每张生成图片积分", value: image, set: setImage },
        { label: provider === "aliyun" ? "每输入视频秒积分（向上取整）" : "每秒生成视频积分", value: second, set: setSecond }, { label: "每个参考素材积分", value: reference, set: setReference },
      ].map(field => <label key={field.label} className="space-y-1.5 text-[12.5px] text-ink-2"><span>{field.label}</span><Input type="number" min={0} step={1} required value={field.value} onChange={event => field.set(event.target.value)} /></label>)}</div>
      <p className="text-[12px] leading-relaxed text-ink-3">任务报价为基础积分加相应数量费用。全部填 0 表示明确免费；没有匹配规则的工具不能提交。续查原任务沿用原占用，不新建价目。</p>
      <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用此规则</label>
      <label className="block space-y-1.5 text-[12.5px] text-ink-2"><span>变更原因</span><Textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} rows={2} placeholder="说明定价依据或调整原因" /></label>
      <AccountNotice error message={error} />
      <Button type="submit" tone="primary" busy={!!pending} disabled={!reason.trim() || !base.trim()}>保存积分规则</Button>
    </form>
  </Card>;
}

function ReconcileCharge({ charge }: { charge: CreditCharge }) {
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [consume, setConsume] = useState("");
  const [reason, setReason] = useState("");
  const allowed = ["stopped", "failed", "completed", "needs_review"].includes(charge.runStatus);
  return <div>
    <Button size="sm" disabled={!allowed || !!pending} onClick={() => setOpen(value => !value)}>{open ? "收起" : allowed ? "核对结算" : "任务执行中"}</Button>
    {open && <form className="mt-3 min-w-[260px] space-y-3" onSubmit={async event => {
      event.preventDefault();
      const result = await run("POST", `/api/admin/credit-charges/${encodeURIComponent(charge.id)}/reconcile`, { consume: Number(consume), reason: reason.trim() }, { label: "credit-reconcile", success: "核对完成，扣除与退回已记入流水" });
      if (result) setOpen(false);
    }}>
      <p className="text-[12px] leading-relaxed text-ink-3">先查看任务结果并核对交付情况。填写实际扣除积分，剩余占用将退回；填 0 为全部退回。</p>
      <label className="block space-y-1 text-[12px] text-ink-2"><span>实际扣除（0–{charge.amount}）</span><Input type="number" required min={0} max={charge.amount} step={1} value={consume} onChange={event => setConsume(event.target.value)} /></label>
      <label className="block space-y-1 text-[12px] text-ink-2"><span>核对依据与原因</span><Textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} rows={3} /></label>
      <Button size="sm" type="submit" tone="primary" busy={!!pending} disabled={!reason.trim() || !consume.trim() || !Number.isSafeInteger(Number(consume)) || Number(consume) < 0 || Number(consume) > charge.amount}>确认结算</Button>
    </form>}
  </div>;
}

export default function ToolPrices() {
  const data = useLoaderData<typeof loader>();
  const {run,pending} = useAdminAction();
  const [params] = useSearchParams();
  const review = params.get("tab") === "review";
  const [editing, setEditing] = useState<ToolPrice | null | undefined>();
  const nextCharges = new URLSearchParams(params); nextCharges.set("tab", "review");
  if (data.charges.nextCursor) nextCharges.set("before", data.charges.nextCursor);
  return <AdminPage title="工具积分" subtitle="管理工具价目与异常任务积分。新用户默认零积分，管理员在用户管理中显式发放。">
    <MemberPriceTable catalog={data.pricing} admin/>
    <Card title="应用已批准工具价目"><p className="mb-3 text-sm text-ink-3">此动作只执行一次：停用旧会员价格，应用上方批准价。不会开启供应商调用或增加预算。未知成本规格始终不可付费，新增规则也不能绕过。</p><Button disabled={!!pending} onClick={() => void run('POST','/api/admin/member-pricing/apply',{confirm:true},{success:'已处理批准价目；再次应用不会重复修改'})}>应用 2026-10-30 批准价目</Button></Card>
    <div className="mb-5 flex gap-2"><Link to="?tab=prices" className={`rounded-full px-4 py-2 text-[13px] ${!review ? "bg-ink text-bg" : "bg-surface text-ink-2 ring-1 ring-line"}`}>积分价目</Link><Link to="?tab=review" className={`rounded-full px-4 py-2 text-[13px] ${review ? "bg-ink text-bg" : "bg-surface text-ink-2 ring-1 ring-line"}`}>待核对任务</Link></div>
    {!review ? <div className="space-y-5">
      <Card title="价目规则" right={<Button tone="primary" onClick={() => setEditing(null)}>新增规则</Button>}>
        <Form method="get" className="mb-4 flex flex-wrap items-center gap-3"><input name="tab" type="hidden" value="prices" /><Select name="kind" aria-label="工具类别筛选" defaultValue={params.get("kind") ?? ""}><option value="">全部工具类别</option>{TOOL_PRICE_KINDS.map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}</Select><Select name="provider" aria-label="供应商筛选" defaultValue={params.get("provider") ?? ""}><option value="">全部供应商</option><option value="redfox">Redfox</option><option value="agentkey">AgentKey（成本待核）</option><option value="aliyun">阿里云万相</option></Select><Button type="submit">筛选</Button></Form>
        <DataTable rows={data.prices} rowKey={price => price.id} empty="尚未配置匹配的积分规则。请按实际工具成本设置价格，或明确设为免费。" columns={[
          { key: "tool", label: "工具", render: price => <><p className="font-medium text-ink">{kindLabel(price.kind)}</p><p className="mt-1 text-[12px] text-ink-4">{price.provider} · {price.model || "未设置模型"} · {price.tier || "未设置档位"}</p></> },
          { key: "match", label: "参数条件", render: price => Object.entries(price.parameterMatch).length ? <div className="space-y-1 text-[12px]">{Object.entries(price.parameterMatch).map(([key, value]) => <p key={key} className="break-all">{key} = {String(value)}</p>)}</div> : "不限其他参数" },
          { key: "price", label: "积分", render: price => <div className="space-y-1 text-[12px]"><p>基础 {price.baseCredits}</p>{price.imageCredits > 0 && <p>每张图片 +{price.imageCredits}</p>}{price.videoSecondCredits > 0 && <p>{price.provider === "aliyun" ? "每输入视频秒（向上取整）" : "每秒视频"} +{price.videoSecondCredits}</p>}{price.referenceCredits > 0 && <p>每个参考素材 +{price.referenceCredits}</p>}</div> },
          { key: "status", label: "状态 / 版本", render: price => <><Badge tone={price.enabled ? "ok" : "muted"}>{price.enabled ? "启用" : "停用"}</Badge><span className="ml-2 text-[12px] text-ink-4">v{price.version}</span></> },
          { key: "action", label: "操作", render: price => <Button size="sm" onClick={() => setEditing(price)}>编辑</Button> },
        ]} />
      </Card>
      {editing !== undefined && <PriceEditor key={editing ? `${editing.id}:${editing.version}` : "new"} price={editing} catalog={data} onClose={() => setEditing(undefined)} />}
    </div> : <div className="space-y-4">
      <Card title="核对任务占用" pad={false}>
        <Form method="get" className="flex items-center gap-3 border-b border-line p-4"><input name="tab" type="hidden" value="review" /><Select name="state" aria-label="积分状态筛选" defaultValue={params.get("state") ?? "review"}><option value="review">需要人工核对</option><option value="reserved">仍在占用</option></Select><Button type="submit">查看</Button></Form>
        <DataTable rows={data.charges.charges} rowKey={charge => charge.id} empty="当前没有符合条件的任务占用。" columns={[
          { key: "user", label: "用户", render: charge => <><p>{charge.displayName}</p><p className="mt-1 text-[12px] text-ink-4">@{charge.username}</p></> },
          { key: "run", label: "任务", render: charge => <><Link className="text-accent hover:underline" to={`/admin/operations/${charge.recoveryRunId ?? charge.runId}`}>查看任务 #{charge.runId}</Link><p className="mt-1 text-[12px] text-ink-3">{kindLabel(charge.kind)} · {charge.model || charge.provider}</p><p className="mt-1 text-[12px] text-ink-4">{charge.runStatus}</p></> },
          { key: "amount", label: "占用积分", render: charge => <span className="num font-medium">{charge.amount}</span> },
          { key: "reason", label: "核对信息", render: charge => <div className="max-w-[280px] break-words text-[12.5px]"><p>{charge.reviewReason ?? "等待任务完成或核对"}</p><p className="mt-1 text-ink-4"><Time at={charge.updatedAt} /></p></div> },
          { key: "action", label: "操作", render: charge => <ReconcileCharge key={`${charge.id}:${charge.updatedAt}`} charge={charge} /> },
        ]} />
      </Card>
      <div className="flex justify-center gap-4 text-[13px] text-accent">{params.has("before") && <Link to={`?tab=review&state=${params.get("state") === "reserved" ? "reserved" : "review"}`}>回到最新</Link>}{data.charges.nextCursor && <Link to={`?${nextCharges}`}>下一页</Link>}</div>
    </div>}
  </AdminPage>;
}
