import { useState } from "react";
import type { PlatformCollectionProviderPreflight } from "@aihot/contracts/redfox";
import { Link, useFetcher, useNavigate } from "react-router";
import { useAdminAction } from "./action";
import { OperationBadge } from "./operation-ui";
import type { OperationAccepted } from "./operation-types";
import { PlatformFields } from "./platform-fields";
import type { PlatformOperation } from "./platform-types";
import { platformLabels } from "./platform-labels";
import { subscriptionExecutionChanges, type CollectionSubscription, type CollectionSubscriptionConfig } from "./collection-subscription-types";
import { isAgentKeySinglePageSnapshot, providerOperation, collectionConfig, collectionProviderLabel, collectionProviders, collectionFormOperation, isHotSnapshot, collectionDetailOperations, collectionDetailPriceNote, collectionLegacyDetail, collectionDetailsAvailable, collectionDraft, collectionOperations, collectionPagingNote, collectionPreviewBody, collectionPriceNote, collectionSaveCommand, collectionProviderCommand, collectionProviderPreflightMatches, collectionSubscriptionsHref, isWeiboSnapshot, type CollectionDraft, type CollectionSeed } from "./collection-subscription-data";
import { Badge, Button, Card, DataTable, Field, Input, Json, ReasonDialog, Select, Time } from "./ui";
export function CollectionSubscriptions({ subscriptions, operations, requestedId, seed }: { subscriptions: CollectionSubscription[]; operations: PlatformOperation[]; requestedId: number | null; seed?: CollectionSeed | null }) {
  const refresh = useFetcher<{ subscriptions: CollectionSubscription[] }>(), actions = useAdminAction();
  const rows = refresh.data?.subscriptions ?? subscriptions, available = collectionOperations(operations), platforms = [...new Set(available.map(operation => operation.platform))];
  const [selected, setSelected] = useState<number | null>(seed ? null : requestedId), [filter, setFilter] = useState("");
  const [newSequence, setNewSequence] = useState(0), [newSeed, setNewSeed] = useState(seed);
  return <div className="min-w-0 space-y-5">
    <Card title="采集订阅" right={<><Button size="sm" disabled={!!actions.pending} busy={refresh.state !== "idle"} onClick={() => refresh.load(collectionSubscriptionsHref(selected))}>刷新状态（保留草稿）</Button><Button size="sm" disabled={!!actions.pending} onClick={() => { setSelected(null); setNewSeed(null); setNewSequence(value => value + 1); }}>新建订阅</Button></>} pad={false}>
      <div className="space-y-3 border-b border-line p-4 text-[13px] text-ink-3"><p>稳定作者与原文齐全的作品沿原材料流程处理，新作者先隔离；缺身份或原文只留结果，可显式查询补全。相关话题、推荐和账号研究不自动成为新闻。已有信源的主订阅、参与方式与公开权限仍在对应信源详情中管理，本视图管理平台采集订阅。</p><Field label="订阅平台筛选"><Select aria-label="订阅平台筛选" value={filter} disabled={!!actions.pending} onChange={e => setFilter(e.target.value)}><option value="">全部平台</option>{[...new Set([...platforms, ...rows.map(row => row.platform)])].map(platform => <option key={platform} value={platform}>{platformLabels[platform] ?? platform}</option>)}</Select></Field></div>
      <DataTable rows={rows.filter(row => !filter || row.platform === filter)} rowKey={row => row.id} empty="还没有匹配的采集订阅；可在本页新建订阅，默认停用，不会调用供应商。" columns={[
        { key: "name", label: "订阅", render: row => <button disabled={!!actions.pending} className="text-left font-medium text-accent disabled:opacity-50" onClick={() => setSelected(row.id)}>{row.name}</button> },
        { key: "platform", label: "平台", render: row => platformLabels[row.platform] ?? row.platform },
        { key: "provider", label: "供应商", render: row => {
          const operation = available.find(candidate => candidate.id === row.operationId);
          return operation ? collectionProviderLabel(operation, row.provider) : row.provider;
        } },
        { key: "kind", label: "采集内容", render: row => { const operation = available.find(operation => operation.id === row.operationId); return operation ? providerOperation(operation, row.provider).label : row.operationId; } },
        { key: "details", label: "详情补全", render: row => {
          const base = available.find(operation => operation.id === row.operationId), operation = base ? providerOperation(base, row.provider) : undefined, legacy = operation ? collectionLegacyDetail(operation, row) : null;
          const target = operation ? collectionDetailOperations(operation).find(choice => choice.operationId === row.detailOperationId) ?? legacy : undefined;
          return row.enrichDetails ? <div className="max-w-64 space-y-1 break-words text-[12px]"><p>{target?.label ?? row.detailOperationId ?? "目标未配置"}{legacy ? "（旧配置兼容）" : ""}</p>{row.detailPage != null && <p>详情页码：{row.detailPage}</p>}<p>每轮最多 {row.limits.details} 个详情步骤，使用 collect 预算</p><p>{collectionDetailPriceNote(target)}</p></div> : "未开启";
        } },
        { key: "enabled", label: "启停", render: row => <Badge tone={row.enabled ? "ok" : "muted"}>{row.enabled ? "已启用" : "已停用"}</Badge> },
        { key: "interval", label: "周期", render: row => `${row.intervalMinutes} 分钟` },
        { key: "next", label: "下次运行", render: row => <Time at={row.nextRunAt} /> },
        { key: "run", label: "当前执行记录", render: row => row.activeRun ? <div className="space-y-1"><Link className="text-accent" to={`/admin/operations/${row.activeRun.id}`}>#{row.activeRun.id}</Link><div><OperationBadge status={row.activeRun.status} /></div>{row.activeRun.waitReason && <p className="max-w-64 text-[12px] text-ink-3">{row.activeRun.waitReason}</p>}</div> : "无在途执行" },
        { key: "edit", label: "", render: row => <Button size="sm" disabled={!!actions.pending} onClick={() => setSelected(row.id)}>编辑</Button> },
      ]} />
    </Card>
    {selected !== null && !rows.some(row => row.id === selected) ? <p className="text-[13px] text-amber">当前列表中没有此订阅，请刷新或选择其他订阅。</p> : <SubscriptionEditor key={selected ?? `new-${newSequence}`} initial={rows.find(row => row.id === selected) ?? null} rows={rows} operations={available} seed={newSeed} actions={actions} onRefresh={() => refresh.load(collectionSubscriptionsHref(selected))} refreshing={refresh.state !== "idle"} />}
  </div>;
}
function SubscriptionEditor({ initial, rows, operations, seed, actions, onRefresh, refreshing }: { initial: CollectionSubscription | null; rows: CollectionSubscription[]; operations: PlatformOperation[]; seed?: CollectionSeed | null; actions: ReturnType<typeof useAdminAction>; onRefresh: () => void; refreshing: boolean }) {
  const { run, pending } = actions, navigate = useNavigate();
  const first = initial ? operations.find(operation => operation.id === initial.operationId) : operations.find(operation => operation.id === seed?.operationId) ?? operations[0];
  const [id, setId] = useState<number | null>(initial?.id ?? null), [version, setVersion] = useState(initial?.editVersion ?? null), [operationId, setOperationId] = useState(initial?.operationId ?? first?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, CollectionDraft>>(() => Object.fromEntries(operations.map(operation => [operation.id, collectionDraft(operation, initial, seed)])));
  const [error, setError] = useState<string | null>(null), [saved, setSaved] = useState<string | null>(null), [previewId, setPreviewId] = useState<number | null>(null);
  const [targetProvider, setTargetProvider] = useState(initial?.provider === "agentkey" ? "redfox" : "agentkey"), [preflight, setPreflight] = useState<PlatformCollectionProviderPreflight | null>(null), [switchOpen, setSwitchOpen] = useState(false), [switched, setSwitched] = useState<CollectionSubscription | null>(null);
  const remote = rows.find(row => row.id === id), latest = switched && (!remote || remote.editVersion < switched.editVersion) ? switched : remote;
  const baseOperation = operations.find(operation => operation.id === operationId), draft = drafts[operationId], operation=baseOperation&&draft?providerOperation(baseOperation,draft.provider):baseOperation, stale = !!latest && version !== latest.editVersion;
  if (!operation || !draft) return <Card title="订阅配置"><p className="text-[13px] text-amber">当前没有可用的定时采集操作。已有未开放操作的订阅请核对服务端状态。</p></Card>;
  const platformOperations = operations.filter(row => row.platform === operation.platform), platforms = [...new Set(operations.map(row => row.platform))], providers = collectionProviders(operation);
  const single = isAgentKeySinglePageSnapshot(operation, draft.provider), snapshot = !single && isWeiboSnapshot(operation), hot = isHotSnapshot(operation), detailsAvailable = collectionDetailsAvailable(operation);
  const detailOperations = collectionDetailOperations(operation, draft.values), detailTarget = detailOperations.find(choice => choice.operationId === draft.detailOperationId), legacyDetail = collectionLegacyDetail(operation, initial);
  const canSwitch = collectionProviderPreflightMatches(preflight, latest, version, targetProvider);
  const change = (patch: Partial<CollectionDraft>) => { setDrafts(previous => ({ ...previous, [operationId]: { ...previous[operationId]!, ...patch } })); setSaved(null); };
  let changesExecution: boolean | null = null;
  try { if (latest) changesExecution = subscriptionExecutionChanges(latest, collectionConfig(operation, draft, initial?.platform ?? latest.platform)); } catch { /* Incomplete input is shown on submit; drafts stay intact. */ }
  return <Card title={id ? `编辑订阅 #${id}` : "新建采集订阅"} right={latest?.activeRun ? <Link className="text-accent" to={`/admin/operations/${latest.activeRun.id}`}>查看执行记录 #{latest.activeRun.id}</Link> : undefined}>
    <form aria-label="采集订阅配置" className="space-y-4" onSubmit={async e => {
      e.preventDefault(); if (pending) return; setError(null); setSaved(null);
      let input: CollectionSubscriptionConfig, command: ReturnType<typeof collectionSaveCommand>;
      try { input = collectionConfig(operation, draft, id ? initial?.platform ?? latest?.platform ?? operation.platform : undefined); command = collectionSaveCommand(id, version, input); } catch (error) { setError((error as Error).message); return; }
      const result = await run<{ id: number; editVersion: number }>(command.method, command.path, command.body, { label: id ? "save-subscription" : "create-subscription", success: id ? "订阅已保存" : "订阅已创建", revalidate: false });
      if (!result) { setError("保存未完成，草稿已保留。若版本已变化，请刷新服务端状态并核对后同步版本。"); return; }
      setId(result.id); setVersion(result.editVersion); setPreflight(null); onRefresh(); setSaved(`订阅 #${result.id} 已保存。${input.enabled ? "已显式启用，后续会按周期产生 collect 调用。" : "保持停用，不会按周期采集。"}`);
    }}>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="订阅名称"><Input aria-label="订阅名称" required maxLength={100} value={draft.name} disabled={!!pending} onChange={e => change({ name: e.target.value })} /></Field><Field label="订阅平台" hint={id ? "已有订阅不能跨平台变更；同平台改操作也会停止旧轮。" : "仅列出已接通定时采集的平台；各操作草稿分别保留。"}><Select aria-label="订阅平台" value={operation.platform} disabled={!!pending || id !== null} onChange={e => { const next = operations.find(row => row.platform === e.target.value); if (next) { setOperationId(next.id); setError(null); setSaved(null); setPreviewId(null); } }}>{platforms.map(platform => <option key={platform} value={platform}>{platformLabels[platform] ?? platform}</option>)}</Select></Field></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="采集内容"><Select aria-label="采集内容" value={operationId} disabled={!!pending} onChange={e => { setOperationId(e.target.value); setError(null); setSaved(null); setPreviewId(null); }}>{platformOperations.map(operation => <option key={operation.id} value={operation.id}>{providerOperation(operation,drafts[operation.id]?.provider??collectionProviders(operation)[0]?.id??"").label}</option>)}</Select></Field>
        <Field label="供应商" hint={id ? "普通保存不能换商；已开放的操作可在下方预检并显式切换，历史执行记录保留实际供应商。" : "只显示当前采集内容已接通创建、调度和执行的供应商；原生 X 连续主采集尚未接通换商。"}><Select aria-label="供应商" value={draft.provider} disabled={!!pending || id !== null || providers.length === 0} onChange={e => { change({ provider: e.target.value,...(operation.platform === "x-research" ? { pages: collectionDraft(baseOperation!, null, { operationId: operation.id, provider: e.target.value, values: {}, sequence: 0 }).pages } : {}),values:Object.fromEntries(providerOperation(baseOperation!,e.target.value).fields.map(field=>[field.name,field.name==="keyword"?draft.values.keyword??"":String(field.default??"")])),enrichDetails:false,detailOperationId:"",detailPage:"",details:0 }); setPreviewId(null); }}>{providers.length ? providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>) : <option value="">当前没有可用供应商</option>}</Select></Field>
      </div>
      {id !== null && latest?.operationId === operationId && providers.length > 1 && <div className="space-y-3 rounded-control border border-line p-3 text-[13px]">
        <p className="text-ink-3">按已保存配置预检，不请求供应商。未保存草稿不参与预检；切换成功后草稿同步为目标配置。</p>
        <Field label="目标供应商"><Select aria-label="目标供应商" value={targetProvider} disabled={!!pending || stale} onChange={e => {setTargetProvider(e.target.value); setPreflight(null);}}>{providers.filter(provider => provider.id !== latest.provider).map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</Select></Field>
        <Button size="sm" disabled={!!pending || stale || !version} busy={pending === "preflight-provider"} onClick={async () => {
          setError(null); setPreflight(null);
          const command = collectionProviderCommand(id, version!, targetProvider);
          const result = await run<PlatformCollectionProviderPreflight>("POST", command.path, command.body, {label: "preflight-provider", revalidate: false});
          if (result) setPreflight(result); else setError("预检未完成，原订阅未变，草稿已保留。请刷新状态后重试。");
        }}>预检切换</Button>
        {preflight && <div className="space-y-2"><ul className="space-y-1">{preflight.checks.map(check => <li key={check.key}><Badge tone={check.conclusion === "supported" ? "ok" : "warn"}>{check.conclusion}</Badge> {check.key}：{check.evidence}</li>)}</ul><p className="text-ink-3">{preflight.impact.note}</p><Button size="sm" disabled={!!pending || !canSwitch} onClick={() => setSwitchOpen(true)}>查看影响并切换</Button>{!canSwitch && preflight.supported && <p className="text-amber">预检版本已变化，请重新预检。</p>}</div>}
      </div>}
      {operation.platform === "x-research" && providers.length === 1 && <p className="text-[12.5px] text-ink-3">此首页订阅没有已确认等价的其他采集供应商，不能切换；单次查询供应商按平台查询入口提供。</p>}
      {!providers.length && <p className="text-[12.5px] text-amber">当前采集内容没有已接通执行的供应商，暂不能创建订阅。</p>}
      {hot && <p className="rounded-control bg-bg-sunk p-3 text-[13px] text-ink-3">每轮自动查询当天：Asia/Shanghai 当天 00:00 至次日 00:00，在本轮创建时固定查询窗口。每小时更新，最新可查询前 1 小时的数据；不会自动成为文章。</p>}
      <PlatformFields operation={collectionFormOperation(operation)} values={draft.values} subscription={operation.platform === "weibo" && operation.id === "TXQPVGJG"} disabled={!!pending} onChange={(name, value) => { change({ values: { ...draft.values, [name]: value } }); setPreviewId(null); }} />
      <p className="text-[12.5px] text-ink-3">{operation.purpose}。{collectionPagingNote(operation, draft.values, draft.provider)}</p>
      <div className="space-y-2 rounded-control border border-line p-3 text-[12.5px] text-ink-3"><p>{hot ? "可选预览合成点击时的 Asia/Shanghai 当天查询窗口，只查询一次，使用 query 次数预算并可能计费；" : "可选预览只查询当前条件一次 / 一页，使用 query 次数预算并可能计费；"}不保存订阅、不占正式游标、不自动启用，也不按整轮页数执行，不调用已配置的详情补全。预览不是启用门禁，已有信源主采集不变。</p><Button size="sm" disabled={!!pending} busy={pending === "preview-subscription"} onClick={async () => {
        let body: ReturnType<typeof collectionPreviewBody>;
        try { body = collectionPreviewBody(operation, draft.values,new Date(),draft.provider); setError(null); } catch (error) { setError((error as Error).message); return; }
        const result = await run<OperationAccepted>("POST", "/api/admin/redfox/queries", body, { label: "preview-subscription", revalidate: false });
        if (result) setPreviewId(result.runId);
      }}>预览当前条件（只查询一次）</Button>{previewId && <Link className="ml-3 inline-block text-accent" target="_blank" rel="noreferrer" to={`/admin/operations/${previewId}`}>查看预览执行记录 ↗</Link>}</div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="周期（分钟）" hint={hot ? "默认 60 分钟；每轮查询一次研究快照。" : "1–10080；修改名称或周期保留当前轮次"}><Input aria-label="周期（分钟）" type="number" required min={1} max={10080} step={1} value={draft.intervalMinutes} disabled={!!pending} onChange={e => change({ intervalMinutes: Number(e.target.value) })} /></Field><label className="inline-flex items-center gap-2 text-[13px] text-ink-2"><input aria-label="启用定时采集" type="checkbox" className="size-4 accent-[var(--accent)]" checked={draft.enabled} disabled={!!pending} onChange={e => change({ enabled: e.target.checked })} />启用定时采集（会产生 collect 调用）</label></div>
      {hot && <Field label="每轮最多研究记录" hint="1–500；超出时保留截断事实，TOP10 以聚合组计条目。"><Input aria-label="每轮最多研究记录" type="number" required min={1} max={500} step={1} value={draft.items} disabled={!!pending} onChange={e => change({ items: Number(e.target.value) })} /></Field>}
      {single && <div className="space-y-3"><p className="text-[12.5px] text-ink-3">每轮仅查询一次首页，不连续翻页。{detailsAvailable ? "默认不补详情；下方可显式选择同轮详情目标和调用上限。" : "不自动发起第二步或补详情。"}作品须按已核实身份与原文导入；评论、关系、推荐和热榜仅保存研究记录。</p><Field label="每轮最多条目" hint="超出上限的记录保留截断事实；不等于入库文章数。"><Input aria-label="每轮最多条目" type="number" required min={1} max={500} step={1} value={draft.items} disabled={!!pending} onChange={e => change({ items: Number(e.target.value) })} /></Field></div>}
      {!snapshot && !hot && !single && <div className="grid gap-4 sm:grid-cols-3">{([['pages', '每轮最多页数', 1, 10], ['items', '每轮最多条目', 1, 500], ...(detailsAvailable ? [['details', '每轮最多详情调用', 0, 100] as const] : [])] as const).map(([key, label, min, max]) => <Field key={key} label={label} hint={key === "items" ? "包括实际选入的作品候选和研究记录，不等于入库文章数。" : `${min}–${max}；仅在对应步骤已接通时使用。`}><Input aria-label={label} type="number" required min={min} max={max} step={1} value={draft[key]} disabled={!!pending} onChange={e => change({ [key]: Number(e.target.value) })} /></Field>)}</div>}
      {!snapshot && !hot && (!single || detailsAvailable) && (detailsAvailable ? <div className="space-y-3 rounded-control border border-line p-3">
        <label className="inline-flex items-center gap-2 text-[13px] text-ink-2"><input aria-label="开启必要详情补全" type="checkbox" className="size-4 accent-[var(--accent)]" checked={draft.enrichDetails} disabled={!!pending} onChange={e => change({ enrichDetails: e.target.checked })} />显式开启必要详情补全（每轮最多 {draft.details} 个额外详情步骤）</label>
        {draft.enrichDetails && <>
          {single && <Field label="每轮最多详情调用" hint="0–100；必须显式设置，详情调用另计 collect 次数和费用。"><Input aria-label="每轮最多详情调用" type="number" required min={0} max={100} step={1} value={draft.details} disabled={!!pending} onChange={e => change({ details: Number(e.target.value) })} /></Field>}
          <Field label="详情目标 / 库" hint="必须显式选择已接通的目标；不会自动选第一个、跨库或回退。"><Select aria-label="详情目标 / 库" required value={draft.detailOperationId} disabled={!!pending} onChange={e => change({ detailOperationId: e.target.value })}><option value="">请选择详情目标</option>{draft.detailOperationId && !detailTarget && <option value={draft.detailOperationId}>原目标不适用当前条件，请重新选择</option>}{detailOperations.map(choice => <option key={choice.operationId} value={choice.operationId}>{choice.label}</option>)}</Select></Field>
          {!detailOperations.length && <p className="text-[12.5px] text-amber">当前采集参数没有已接通的详情目标，请调整条件或关闭补全。</p>}
          {legacyDetail && draft.detailOperationId === legacyDetail.operationId && <p className="text-[12.5px] text-ink-3">旧微博订阅未存目标，现有兼容映射为 {legacyDetail.label}；保存时将显式记录此目标。</p>}
          {detailTarget?.operationId === "LLCI8QTE" && <Field label="车家号详情页码" hint="必填整数，没有默认页码；采集查询参数保持原配置。"><Input aria-label="车家号详情页码" type="number" step={1} required value={draft.detailPage} disabled={!!pending} onChange={e => change({ detailPage: e.target.value })} /></Field>}
          <p className="text-[12.5px] text-ink-3">{collectionDetailPriceNote(detailTarget)}仅对本轮实收且可证明的作品请求所选详情；不支持的类型保留待核实，不猜身份或自动换库。详情与异常重试使用 collect 次数预算，预算等待保留同一执行记录。</p>
        </>}
      </div> : <p className="text-[12.5px] text-ink-3">系统自动补全未接通，可从结果显式查询；本订阅不启用额外详情调用。</p>)}
      <div className="rounded-control bg-bg-sunk p-3 text-[13px] text-ink-3">{latest?.activeRun && changesExecution === true ? <>执行配置变化将停止旧轮执行 #{latest.activeRun.id} 并解除本订阅占用；旧响应保留，不能恢复成新配置。</> : latest?.activeRun && changesExecution === false ? <>本次只调整名称或周期，当前执行 #{latest.activeRun.id} 会按原轮次继续。</> : "只改名称或周期保留当前执行；启停、操作、查询、补全或限额变化会停止旧轮执行并解除本订阅占用，旧响应保留，不能恢复成新配置。"}<p className="mt-2">{collectionPriceNote(operation)}启用后受 collect 次数预算控制，免费请求也计次数；分页、额外详情及异常重试可能增加请求和费用，实际实扣未核对。新建默认停用；权限不因新订阅提高，不自动换库或切换供应商。</p></div>
      {stale && <div className="space-y-2 rounded-control bg-amber/10 p-3 text-[13px] text-amber"><p>服务端配置版本已变化，草稿保持。请核对最新配置，再同步版本并决定是否保存。</p><Json value={latest} label="当前服务端配置与运行状态" /><Button size="sm" disabled={!!pending} onClick={() => { setVersion(latest!.editVersion); setPreflight(null); setError(null); }}>同步最新版本（保留草稿）</Button></div>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}{saved && <p role="status" className="text-[13px] text-ok">{saved}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button disabled={!!pending} busy={refreshing} onClick={onRefresh}>刷新服务端状态</Button><Button type="submit" tone="primary" disabled={!!pending || stale || providers.length === 0} busy={pending === "save-subscription" || pending === "create-subscription"}>{id ? "保存订阅" : "创建订阅"}</Button></div>
    </form>
    <ReasonDialog open={switchOpen} title={`切换到 ${collectionProviderLabel(baseOperation!, targetProvider)}`} confirmLabel="确认切换供应商" busy={!!pending} onClose={() => {if (!pending) setSwitchOpen(false);}} description={<div className="space-y-2"><p>保留同一订阅 ID、启停、周期、限额与全部历史。旧轮在途执行将停止，但已发出的请求仍可能完成并计费；旧轮不能写入新材料。</p><p>旧游标不迁移，目标从合法起点开始；数据覆盖与时效可能变化，不自动回切。切换成功后当前草稿会同步为目标配置。</p>{preflight?.impact.activeRunId && <p>当前执行 #{preflight.impact.activeRunId} 将停止。</p>}{error && <p role="alert" className="text-hot">{error}</p>}</div>} onSubmit={async reason => {
      if (!canSwitch || id === null || !version) {setError("预检版本已变化，请关闭并重新预检；原订阅未变。"); return;}
      const command = collectionProviderCommand(id, version, targetProvider, reason);
      const result = await run<{id: number; editVersion: number; executionVersion: number; config: CollectionSubscriptionConfig}>("POST", command.path, command.body, {label: "switch-provider", success: "供应商已切换", revalidate: false});
      if (!result) {setPreflight(null); setError("切换未完成，原订阅未变，草稿已保留。请关闭对话框并重新预检。"); return;}
      const updated: CollectionSubscription = {...latest!, ...result.config, id: result.id, editVersion: result.editVersion, executionVersion: result.executionVersion, activeRun: null};
      setSwitched(updated); setVersion(result.editVersion); setOperationId(result.config.operationId);
      setDrafts(previous => ({...previous, [result.config.operationId]: collectionDraft(baseOperation!, updated)}));
      setTargetProvider(latest!.provider); setPreflight(null); setSwitchOpen(false); setPreviewId(null); setError(null); setSaved(`订阅 #${result.id} 已切换，配置版本已同步。`); onRefresh();
    }} />
    {id && <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-[13px]">{latest?.activeRun ? <Link className="text-accent" to={`/admin/operations/${latest.activeRun.id}`}>本轮执行 #{latest.activeRun.id}：查看进度与结果</Link> : <Button disabled={!!pending || !latest?.enabled} busy={pending === "run-subscription"} onClick={async () => { const result = await run<OperationAccepted>("POST", `/api/admin/redfox/collections/${id}/run`, undefined, { label: "run-subscription", revalidate: false }); if (result) navigate(`/admin/operations/${result.runId}`); }}>运行一轮</Button>}{!latest?.enabled && <span className="text-ink-4">先保存并启用订阅，才可运行一轮。</span>}</div>}
  </Card>;
}
