import type {
  CostAmountBucket,
  CostDetailRow,
  CostDetailsResponse,
  CostFilters,
  CostGroup,
  CostGroupBy,
  CostOverviewResponse,
  CostOwnerKind,
  CostSkillAttribution,
  CostWarning,
} from "@aihot/contracts/costs";
import { Form, Link, useNavigation } from "react-router";
import { bj, num } from "./format";
import { RedfoxCosts } from "./redfox-costs";
import {
  COST_GROUP_BY,
  beijingDateTimeInput,
  costPageHref,
  presetRange,
  skillSpecialGroupPresentation,
  type CostPageView,
  type CostRangePreset,
} from "./costs-data";
import { AdminPage, Badge, Button, ButtonLink, Card, DataTable, Empty, Field, Input, Select, Stat, Time, type Column } from "./ui";

interface CostPageProps {
  view: CostPageView;
  range: { start: string; end: string };
  costs: CostOverviewResponse | CostDetailsResponse | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  redfox: "Redfox",
  agentkey: "AgentKey",
  aliyun: "阿里云百炼",
  deepseek: "DeepSeek",
  dashscope: "阿里云百炼",
  zhipu: "智谱",
  mimo: "MiMo",
  jina: "Jina",
  socialdata: "SocialData",
  dajiala: "大加辣",
  unknown: "身份未知",
};

const OWNER_LABELS: Record<CostOwnerKind, string> = {
  member: "会员",
  admin: "管理员",
  system: "系统",
  unassigned: "未归属",
};

const ATTRIBUTION_LABELS: Record<CostSkillAttribution, string> = {
  activated: "已激活",
  multi_skill: "多 Skill 共享",
  not_activated: "已确认无 Skill 激活",
  historical_unknown: "历史 Skill 归属未知",
  not_applicable: "Skill 不适用",
};

export function CostCenter({ page }: { page: CostPageProps }) {
  const pageView = page.view;
  return (
    <AdminPage
      title="成本中心"
      subtitle="统一查看本地登记的外发调用、用量、费用证据与已存供应商账单。调用登记不证明供应商已收到或实际扣费。"
      actions={<><ButtonLink to="/admin/settings">次数预算</ButtonLink><ButtonLink to="/admin/runs">运行与回执</ButtonLink></>}
    >
      <ViewTabs page={page} />
      {pageView === "billing" || !page.costs ? (
        <RedfoxCosts initialInterval={page.range} mode="billing" />
      ) : page.costs.view === "overview" ? (
        <CostOverview data={page.costs} view={pageView} />
      ) : (
        <CostDetails data={page.costs} view={pageView} />
      )}
    </AdminPage>
  );
}

function ViewTabs({ page }: { page: CostPageProps }) {
  const costLink = (view: "overview" | "details") => {
    if (!page.costs) return `/admin/costs?${new URLSearchParams({ view })}`;
    return costPageHref({
      start: page.costs.query.start,
      end: page.costs.query.end,
      view,
      groupBy: page.costs.query.groupBy,
      filters: canonicalFilters(page.costs.filters),
    });
  };
  return (
    <nav className="mb-5 flex flex-wrap gap-2" aria-label="成本中心视图">
      <ButtonLink to={costLink("overview")} tone={page.view === "overview" ? "primary" : "secondary"}>概览</ButtonLink>
      <ButtonLink to={costLink("details")} tone={page.view === "details" ? "primary" : "secondary"}>调用明细</ButtonLink>
      <ButtonLink to="/admin/costs?view=billing" tone={page.view === "billing" ? "primary" : "secondary"}>已存账单</ButtonLink>
    </nav>
  );
}

function CostOverview({ data, view }: { data: CostOverviewResponse; view: CostPageView }) {
  const estimatedBuckets = data.totals.amountBuckets.filter((bucket) => bucket.costBasis === "estimated");
  const actualBuckets = data.totals.amountBuckets.filter((bucket) => bucket.costBasis === "actual");
  return (
    <div className="min-w-0 space-y-5">
      <CostFiltersForm data={data} view={view} />
      <section aria-label="成本概览指标" className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="已登记调用" value={num(data.totals.attempts)} hint={`${num(data.totals.logicalRequests)} 个逻辑请求 · ${num(data.totals.feeItems)} 个计费项`} />
        <Stat label="已知估算费用" value={num(data.totals.estimatedCostItems)} hint={<BucketHint buckets={estimatedBuckets} empty="没有已知估算" />} tone={estimatedBuckets.length ? "warn" : undefined} />
        <Stat label="供应商返回实扣" value={num(data.totals.actualCostItems)} hint={<BucketHint buckets={actualBuckets} empty="没有逐笔实扣" />} tone={actualBuckets.length ? "ok" : undefined} />
        <Stat label="费用待核对" value={num(data.totals.unknownCostItems)} hint={`${num(data.totals.sharedFeeItems)} 个多 Skill 共享计费项`} tone={data.totals.unknownCostItems ? "bad" : undefined} />
      </section>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
        <MoneyBuckets buckets={data.totals.amountBuckets} />
        <StatusAndUsage data={data} />
      </div>
      {data.warnings.length > 0 && <Warnings warnings={data.warnings} />}
      <GroupReport data={data} />
    </div>
  );
}

function CostDetails({ data, view }: { data: CostDetailsResponse; view: CostPageView }) {
  return (
    <div className="min-w-0 space-y-5">
      <CostFiltersForm data={data} view={view} />
      {data.warnings.length > 0 && <Warnings warnings={data.warnings} />}
      <Card title={`调用明细 · ${data.rows.length} 条`} right={<Link className="text-accent" to={overviewHref(data)}>同条件汇总</Link>} pad={false}>
        <DataTable
          rows={data.rows}
          rowKey={(row) => row.attemptId}
          empty="当前条件没有登记的外发调用。"
          columns={detailColumns}
        />
      </Card>
      {data.nextCursor && (
        <div className="flex justify-center">
          <ButtonLink to={detailHref(data, data.nextCursor)}>下一页调用明细</ButtonLink>
        </div>
      )}
    </div>
  );
}

function CostFiltersForm({ data, view }: { data: CostOverviewResponse | CostDetailsResponse; view: CostPageView }) {
  const navigation = useNavigation();
  const filters = data.filters;
  const facets = "facets" in data ? data.facets : null;
  const selectedByUsername = !!filters.username;
  const reset = costPageHref({
    start: data.query.start,
    end: data.query.end,
    view: view === "details" ? "details" : "overview",
    groupBy: view === "details" ? null : data.query.groupBy,
    filters: { ...filters, billingProvider: null, service: null, operation: null, model: null, skillId: null, moduleId: null, userId: null, username: null, owner: null, origin: "live", environment: null, status: null, costBasis: null },
  });
  return (
    <Card title="筛选条件" right={<span>北京时间 · 开始包含、结束不包含</span>}>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="常用时间范围">
        {(["24h", "7d", "30d"] as const).map((preset) => {
          const range = presetRange(data.query.end, preset);
          return <ButtonLink key={preset} size="sm" to={rangeHref(data, view, range)}>{rangeLabel(preset)}</ButtonLink>;
        })}
      </div>
      <Form key={costPageKey(data, view)} method="get" action="/admin/costs" className="space-y-4" preventScrollReset>
        <input type="hidden" name="view" value={view} />
        {view === "overview" && <input type="hidden" name="groupBy" value={data.query.groupBy ?? "provider"} />}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="开始时间"><Input type="datetime-local" name="start" required defaultValue={beijingDateTimeInput(data.query.start)} /></Field>
          <Field label="结束时间"><Input type="datetime-local" name="end" required defaultValue={beijingDateTimeInput(data.query.end)} /></Field>
          <Field label="计费供应商">
            {facets ? <Select name="billingProvider" defaultValue={filters.billingProvider ?? ""}>
              <option value="">全部供应商</option>
              {facetOptions(facets.providers, filters.billingProvider).map((item) => <option key={item.value} value={item.value}>{item.label}（{item.count}）</option>)}
            </Select> : <Input name="billingProvider" defaultValue={filters.billingProvider ?? ""} placeholder="精确供应商 ID" />}
          </Field>
          <Field label="接口服务">
            {facets ? <Select name="service" defaultValue={filters.service ?? ""}>
              <option value="">全部接口服务</option>
              {facetOptions(facets.services, filters.service).map((item) => <option key={item.value} value={item.value}>{item.label}（{item.count}）</option>)}
            </Select> : <Input name="service" defaultValue={filters.service ?? ""} placeholder="精确 service ID" />}
          </Field>
          <Field label="模型">
            {facets ? <Select name="model" defaultValue={filters.model ?? ""}>
              <option value="">全部模型</option>
              {facetOptions(facets.models, filters.model).map((item) => <option key={item.value} value={item.value}>{item.label}（{item.count}）</option>)}
            </Select> : <Input name="model" defaultValue={filters.model ?? ""} placeholder="精确模型 ID" />}
          </Field>
          <Field label="操作 / 接口 ID" hint="精确匹配稳定 operationId，可手工输入目录外的值。">
            <Input name="operation" defaultValue={filters.operation ?? ""} placeholder="例如 chat.completions" />
          </Field>
          <Field label="用户 ID" hint="与用户名二选一。">
            <Input name="userId" type="number" min="1" step="1" defaultValue={selectedByUsername ? "" : filters.userId ?? ""} placeholder="精确整数 ID" />
          </Field>
          <Field label="精确用户名" hint="纯数字用户名也填在这里。">
            <Input name="username" defaultValue={filters.username ?? ""} placeholder="例如 editor" autoComplete="off" />
          </Field>
          <Field label="Skill ID" hint="目录项可展开页面的 Skill 提示选择。">
            <Input name="skillId" list="cost-skill-ids" defaultValue={filters.skillId ?? ""} placeholder="skillId" />
          </Field>
          <Field label="Skill 模块 ID"><Input name="moduleId" list="cost-module-ids" defaultValue={filters.moduleId ?? ""} placeholder="moduleId" /></Field>
        </div>
        {facets && <><datalist id="cost-skill-ids">{facets.skills.map((item) => <option key={item.value} value={item.value.split(":", 1)[0]} label={item.label} />)}</datalist><datalist id="cost-module-ids">{facets.skills.map((item) => { const [, moduleId = ""] = item.value.split(":", 2); return <option key={item.value} value={moduleId} label={item.label} />; })}</datalist></>}
        <details className="rounded-control border border-line bg-bg-sunk/40 p-3">
          <summary className="cursor-pointer text-[13px] text-ink-2">更多筛选</summary>
          <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="来源">
              <Select name="origin" defaultValue={filters.origin ?? "all"}>
                <option value="live">live（实时外发）</option>
                <option value="replay">replay（恢复复用）</option>
                <option value="imported">imported（导入）</option>
                <option value="all">全部来源</option>
              </Select>
            </Field>
            <EnumField name="environment" label="执行环境" value={filters.environment} options={[
              ["production", "生产"], ["development", "开发"], ["test", "测试"], ["other", "其他"], ["unknown", "未知"],
            ]} />
            <EnumField name="status" label="调用状态" value={filters.status} options={[
              ["received", "received"], ["failed", "failed"], ["pending", "pending"], ["unknown", "unknown"],
            ]} />
            <EnumField name="costBasis" label="费用依据" value={filters.costBasis} options={[
              ["actual", "actual（逐笔实扣）"], ["estimated", "estimated（估算）"],
            ]} />
            <EnumField name="owner" label="执行者" value={filters.owner} options={[
              ["member", "会员"], ["admin", "管理员"], ["system", "系统"], ["unassigned", "未归属"],
            ]} />
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" tone="primary" busy={navigation.state === "loading"} disabled={navigation.state === "loading"}>应用筛选</Button>
          <ButtonLink to={reset}>清除筛选</ButtonLink>
          {facets?.truncated && <span className="text-[12.5px] text-amber">候选项只显示前 50 项，可用精确 ID 继续筛选。</span>}
        </div>
      </Form>
    </Card>
  );
}

function EnumField({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | null;
  options: Array<[string, string]>;
}) {
  return (
    <Field label={label}>
      <Select name={name} defaultValue={value ?? ""}>
        <option value="">全部</option>
        {options.map(([option, optionLabel]) => <option key={option} value={option}>{optionLabel}</option>)}
      </Select>
    </Field>
  );
}

function GroupReport({ data }: { data: CostOverviewResponse }) {
  const rows = data.groups.map((group, index) => ({ group, index }));
  return (
    <Card
      title={`按${groupByLabel(data.query.groupBy ?? "provider")}汇总`}
      right={(
        <div className="flex flex-wrap justify-end gap-1.5">
          {COST_GROUP_BY.map((option) => (
            <ButtonLink key={option.value} size="sm" tone={data.query.groupBy === option.value ? "primary" : "secondary"} to={groupByHref(data, option.value)}>
              {option.label}
            </ButtonLink>
          ))}
        </div>
      )}
      pad={false}
    >
      {!data.groups.every((group) => group.additive) && (
        <p className="border-b border-line px-4 py-3 text-[12.5px] text-amber">部分多 Skill 步骤共享一次模型调用，不能把这些分组金额相加。</p>
      )}
      <DataTable
        rows={rows}
        rowKey={(row) => `${row.group.key}:${row.index}`}
        empty="当前筛选没有可汇总的调用。"
        columns={[
          { key: "identity", label: "分组", render: ({ group }) => <GroupIdentity group={group} /> },
          { key: "calls", label: "调用 / 状态", render: ({ group }) => <UsageAndStatus totals={group.totals} /> },
          { key: "cost", label: "费用项", render: ({ group }) => <CostItems totals={group.totals} /> },
          { key: "amounts", label: "金额桶", className: "w-60 min-w-60", render: ({ group }) => <BucketList buckets={group.totals.amountBuckets} /> },
          {
            key: "action",
            label: "",
            align: "right",
            render: ({ group }) =>
              group.groupBy === "skill" && !group.skill ? (
                <span className="whitespace-nowrap text-[11.5px] text-ink-4">{skillSpecialGroupPresentation(group.key).action}</span>
              ) : (
                <Link className="whitespace-nowrap text-accent" to={groupDetailsHref(data, group)}>查看明细</Link>
              ),
          },
        ]}
      />
      {data.nextGroupCursor && (
        <div className="flex justify-center border-t border-line p-4">
          <ButtonLink to={groupCursorHref(data, data.nextGroupCursor)}>下一组</ButtonLink>
        </div>
      )}
    </Card>
  );
}

function GroupIdentity({ group }: { group: CostGroup }) {
  if (group.groupBy === "provider") {
    return <div className="min-w-44 break-all"><p className="font-medium text-ink">{providerLabel(group.billingProvider)}</p><p className="text-[11.5px] text-ink-4">{group.billingProvider ?? "—"}{group.upstreamProvider ? ` · 上游 ${group.upstreamProvider}` : ""}</p></div>;
  }
  if (group.groupBy === "service") {
    return <div className="min-w-52 break-all"><p className="font-medium text-ink">{group.service ?? "服务未知"}</p><p className="text-[11.5px] text-ink-4">{providerLabel(group.billingProvider)} · {group.operation ?? "操作未知"}</p></div>;
  }
  if (group.groupBy === "model") {
    return <div className="min-w-44 break-all"><p className="font-medium text-ink">{group.model ?? "模型未知"}</p><p className="text-[11.5px] text-ink-4">{providerLabel(group.billingProvider)}</p></div>;
  }
  if (group.groupBy === "user") {
    return <div className="min-w-44 break-all"><p className="font-medium text-ink">{group.displayName || group.username || "未归属用户"}</p><p className="text-[11.5px] text-ink-4">{group.username ? `@${group.username} · #${group.userId}` : group.ownerKind ? OWNER_LABELS[group.ownerKind] : "历史归属未知"}</p></div>;
  }
  if (group.skill) {
    return <div className="min-w-52 break-all"><p className="font-medium text-ink">{group.skill.label}</p><p className="text-[11.5px] text-ink-4">{group.skill.skillId} / {group.skill.moduleId}{group.skill.version ? ` · ${group.skill.version}` : ""}</p></div>;
  }
  if (group.groupBy === "skill") {
    const status = skillSpecialGroupPresentation(group.key);
    return <div className="min-w-52 max-w-72"><p className="font-medium text-ink">{status.label}</p><p className="text-[11.5px] leading-relaxed text-ink-4">{status.description}</p></div>;
  }
  return <div className="min-w-44"><p className="font-medium text-ink">未归属</p><p className="text-[11.5px] text-ink-4">无法证明单一 Skill 归属</p></div>;
}

function UsageAndStatus({ totals }: { totals: CostGroup["totals"] }) {
  return (
    <div className="min-w-44">
      <p>{num(totals.attempts)} 次调用 · {num(totals.feeItems)} 个计费项</p>
      <p className="text-[11.5px] text-ink-4">收 {num(totals.statusCounts.received)} · 失败 {num(totals.statusCounts.failed)} · 待定 {num(totals.statusCounts.pending)} · 未知 {num(totals.statusCounts.unknown)}</p>
      <p className="text-[11.5px] text-ink-4">tokens {num(totals.usage.inputTokens)} / {num(totals.usage.outputTokens)} · 缓存 {num(totals.usage.cachedTokens)}</p>
    </div>
  );
}

function CostItems({ totals }: { totals: CostGroup["totals"] }) {
  return (
    <div className="min-w-40">
      <p>已知 {num(totals.knownCostItems)} · 未知 {num(totals.unknownCostItems)}</p>
      <p className="text-[11.5px] text-ink-4">actual {num(totals.actualCostItems)} · estimated {num(totals.estimatedCostItems)}</p>
      {(totals.usage.estimatedCredits || totals.usage.chargedCredits) && <p className="text-[11.5px] text-ink-4">credits 估价 {totals.usage.estimatedCredits ?? "—"} · 实扣 {totals.usage.chargedCredits ?? "—"}</p>}
    </div>
  );
}

function MoneyBuckets({ buckets }: { buckets: CostAmountBucket[] }) {
  return (
    <Card title="金额桶（不跨来源、环境、币种或依据相加）">
      <BucketList buckets={buckets} empty="当前筛选没有已知金额。缺失金额不会当作 0。" />
    </Card>
  );
}

function BucketList({ buckets, empty = "未知" }: { buckets: CostAmountBucket[]; empty?: string }) {
  if (!buckets.length) return <span className="text-ink-4">{empty}</span>;
  return (
    <ul className="min-w-56 space-y-2">
      {buckets.map((bucket) => (
        <li key={`${bucket.origin}:${bucket.environment}:${bucket.currency}:${bucket.costBasis ?? "none"}`}>
          <p className="num whitespace-nowrap">{decimalText(bucket.amount)} {bucket.currency}</p>
          <p className="text-[11.5px] leading-relaxed text-ink-3">
            {bucket.costBasis ? costBasisLabel(bucket.costBasis) : "依据未知"} · {originLabel(bucket.origin)} / {environmentLabel(bucket.environment)} / {bucket.records} 条
          </p>
        </li>
      ))}
    </ul>
  );
}

function BucketHint({ buckets, empty }: { buckets: CostAmountBucket[]; empty: string }) {
  if (!buckets.length) return <>{empty}</>;
  return <div className="space-y-0.5">{buckets.slice(0, 3).map((bucket) => <div key={`${bucket.currency}:${bucket.origin}:${bucket.environment}`}>{decimalText(bucket.amount)} {bucket.currency} · {bucket.records} 条</div>)}{buckets.length > 3 && <div>另有 {buckets.length - 3} 个金额桶</div>}</div>;
}

function StatusAndUsage({ data }: { data: CostOverviewResponse }) {
  const usage = data.totals.usage;
  return (
    <Card title="状态与用量">
      <div className="grid grid-cols-2 gap-3 text-[13px]">
        <Fact label="逻辑请求" value={num(data.totals.logicalRequests)} />
        <Fact label="计费项" value={num(data.totals.feeItems)} />
        <Fact label="输入 tokens" value={num(usage.inputTokens)} />
        <Fact label="输出 tokens" value={num(usage.outputTokens)} />
        <Fact label="缓存 tokens" value={num(usage.cachedTokens)} />
        <Fact label="输出秒数" value={usage.outputSeconds ?? "—"} />
        <Fact label="用量缺失行" value={num(usage.missingUsageRows)} />
        <Fact label="Skill 共享项" value={num(data.totals.sharedFeeItems)} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone="ok">received {num(data.totals.statusCounts.received)}</Badge>
        <Badge tone="bad">failed {num(data.totals.statusCounts.failed)}</Badge>
        <Badge tone="warn">pending {num(data.totals.statusCounts.pending)}</Badge>
        <Badge>unknown {num(data.totals.statusCounts.unknown)}</Badge>
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-ink-4">读取于 {bj(data.asOf, true)}。外发登记、执行环境和调用状态都不证明供应商实扣。</p>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-control bg-bg-sunk/60 p-2.5"><div className="text-[11.5px] text-ink-4">{label}</div><div className="num mt-1 break-all font-medium text-ink">{value}</div></div>;
}

function Warnings({ warnings }: { warnings: CostWarning[] }) {
  return (
    <Card title="核对提示">
      <ul className="space-y-2 text-[13px] leading-relaxed text-ink-3">
        {warnings.map((warning) => <li key={warning.code} className="break-words"><span className="font-medium text-ink-2">{warning.code}</span> · {warning.count} 条：{warning.message}</li>)}
      </ul>
    </Card>
  );
}

const detailColumns: Column<CostDetailRow>[] = [
  {
    key: "time",
    label: "时间 / 状态",
    render: (row) => <div className="min-w-32"><Time at={row.startedAt} title={bj(row.startedAt, true)} /><p className="mt-1"><Badge tone={statusTone(row.status)}>{row.status}</Badge></p><p className="mt-1 text-[11.5px] text-ink-4">{row.latencyMs === null ? "耗时未知" : `${num(row.latencyMs)} ms`}</p></div>,
  },
  {
    key: "identity",
    label: "计费身份",
    render: (row) => <div className="min-w-52 max-w-72 break-all"><p className="font-medium text-ink">{providerLabel(row.billingProvider)} · {row.service}</p><p className="text-[12px] text-ink-3">{row.operation}</p><p className="text-[11.5px] text-ink-4">模型 {row.model ?? "不适用/未知"}{row.upstreamProvider ? ` · 上游 ${row.upstreamProvider}` : ""}</p></div>,
  },
  {
    key: "owner",
    label: "用户 / Skill",
    render: (row) => <div className="min-w-48 max-w-72 break-all"><p>{row.owner.displayName || row.owner.username || (row.owner.kind ? OWNER_LABELS[row.owner.kind] : "归属未知")}</p><p className="text-[11.5px] text-ink-4">{row.owner.username ? `@${row.owner.username} · #${row.owner.userId}` : row.owner.userId ? `#${row.owner.userId}` : "无用户 ID"}</p><p className="mt-1 text-[11.5px] text-ink-3">{ATTRIBUTION_LABELS[row.assistant.attribution]}{row.assistant.activations.length ? ` · ${row.assistant.activations.map((item) => `${item.label}${item.version ? ` (${item.version})` : ""}`).join("、")}` : ""}</p></div>,
  },
  {
    key: "usage",
    label: "用量",
    render: (row) => <div className="min-w-40"><p>tokens {num(row.usage.inputTokens)} / {num(row.usage.outputTokens)}</p><p className="text-[11.5px] text-ink-4">缓存 {num(row.usage.cachedTokens)} · 视频秒数 {row.usage.outputSeconds ?? "—"}</p>{(row.usage.estimatedCredits || row.usage.chargedCredits) && <p className="text-[11.5px] text-ink-4">credits {row.usage.estimatedCredits ?? "—"} / {row.usage.chargedCredits ?? "—"}</p>}</div>,
  },
  {
    key: "cost",
    label: "费用",
    render: (row) => <div className="min-w-44 max-w-64 break-all">{row.cost.applicable ? <><p className="font-medium text-ink">{row.cost.amount === null ? "未知" : `${decimalText(row.cost.amount)} ${row.cost.currency ?? ""}`}</p><p className="text-[11.5px] text-ink-4">{row.cost.basis ? costBasisLabel(row.cost.basis) : "依据未知"}</p>{row.cost.estimateBasis && <p className="text-[11.5px] text-ink-4">{estimateBasisLabel(row.cost.estimateBasis)}</p>}</> : <p className="text-ink-3">费用不适用于此行</p>}{row.cost.reason && <p className="mt-1 text-[11.5px] text-amber">{row.cost.reason}</p>}</div>,
  },
  {
    key: "evidence",
    label: "身份与证据",
    render: (row) => <Evidence row={row} />,
  },
];

function Evidence({ row }: { row: CostDetailRow }) {
  return (
    <div className="min-w-64 max-w-80 space-y-1 text-[11.5px] leading-relaxed text-ink-3">
      {row.runId !== null && <Link className="text-accent" to={`/admin/operations/${row.runId}`}>运行 #{row.runId}</Link>}
      <CopyId label="回执" value={`#${row.receiptId}`} />
      <CopyId label="尝试" value={`#${row.attemptId} / ${row.attempt}`} />
      {row.providerRequestId && <CopyId label="供应商请求" value={row.providerRequestId} />}
      <p>identity={row.identitySource} · env={row.environment} · origin={row.origin}</p>
      <p>{priceSnapshotText(row)}</p>
      {row.priceSnapshot.sourceUrl && <p className="break-all">价格来源：{row.priceSnapshot.sourceUrl}</p>}
      {row.warnings.map((warning) => <p key={warning} className="text-amber">{warning}</p>)}
    </div>
  );
}

function CopyId({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="break-all">{label} {value}</span>
      <Button size="sm" tone="ghost" aria-label={`复制${label}`} onClick={() => void navigator.clipboard?.writeText(value)}>复制</Button>
    </div>
  );
}

function priceSnapshotText(row: CostDetailRow): string {
  const snapshot = row.priceSnapshot;
  if (snapshot.state === "ready") return `价格快照：已锁定${snapshot.selectedAt ? `于 ${bj(snapshot.selectedAt, true)}` : ""}${snapshot.verifiedOn ? `，核验 ${snapshot.verifiedOn}` : ""}`;
  if (snapshot.state === "unavailable") return `价格快照不可用：${snapshot.reason ?? "原因未知"}`;
  return "价格快照：历史未记录";
}

function facetOptions<T extends { value: string; label: string; count: number }>(items: T[], current: string | null): Array<{ value: string; label: string; count: number }> {
  if (!current || items.some((item) => item.value === current)) return items;
  return [{ value: current, label: `${current}（当前条件）`, count: 0 }, ...items];
}

function canonicalFilters(filters: CostFilters): CostFilters {
  return { ...filters, userId: filters.username ? null : filters.userId };
}

function costPageKey(data: CostOverviewResponse | CostDetailsResponse, view: CostPageView): string {
  return `${view}:${data.asOf}:${JSON.stringify(data.filters)}`;
}

function rangeHref(data: CostOverviewResponse | CostDetailsResponse, view: CostPageView, range: { start: string; end: string }): string {
  return costPageHref({ ...range, view: view === "details" ? "details" : "overview", groupBy: view === "details" ? null : data.query.groupBy, filters: canonicalFilters(data.filters) });
}

function rangeLabel(preset: CostRangePreset): string {
  return preset === "24h" ? "最近 24 小时" : preset === "7d" ? "最近 7 天" : "最近 30 天";
}

function groupByHref(data: CostOverviewResponse, groupBy: CostGroupBy): string {
  return costPageHref({ start: data.query.start, end: data.query.end, view: "overview", groupBy, filters: canonicalFilters(data.filters) });
}

function groupCursorHref(data: CostOverviewResponse, cursor: string): string {
  return costPageHref({ start: data.query.start, end: data.query.end, view: "overview", groupBy: data.query.groupBy, filters: canonicalFilters(data.filters), cursor });
}

function groupDetailsHref(data: CostOverviewResponse, group: CostGroup): string {
  const filters: CostFilters = { ...canonicalFilters(data.filters) };
  if (group.groupBy === "provider") filters.billingProvider = group.billingProvider;
  if (group.groupBy === "service") {
    filters.billingProvider = group.billingProvider;
    filters.service = group.service;
    filters.operation = group.operation;
  }
  if (group.groupBy === "model") {
    filters.billingProvider = group.billingProvider;
    filters.model = group.model;
  }
  if (group.groupBy === "user") {
    filters.userId = group.userId;
    filters.username = null;
    filters.owner = group.userId === null ? group.ownerKind ?? "unassigned" : null;
  }
  if (group.groupBy === "skill" && group.skill) {
    filters.skillId = group.skill.skillId;
    filters.moduleId = group.skill.moduleId;
  }
  return costPageHref({ start: data.query.start, end: data.query.end, view: "details", filters });
}

function detailHref(data: CostDetailsResponse, cursor: string): string {
  return costPageHref({ start: data.query.start, end: data.query.end, view: "details", filters: canonicalFilters(data.filters), cursor });
}

function overviewHref(data: CostDetailsResponse): string {
  return costPageHref({ start: data.query.start, end: data.query.end, view: "overview", groupBy: "provider", filters: canonicalFilters(data.filters) });
}

function providerLabel(value: string | null): string {
  return value ? PROVIDER_LABELS[value] ?? value : "供应商未知";
}

function groupByLabel(value: CostGroupBy): string {
  return COST_GROUP_BY.find((item) => item.value === value)?.label ?? value;
}

function originLabel(value: string): string {
  return value === "live" ? "live" : value === "replay" ? "replay" : value === "imported" ? "imported" : value;
}

function environmentLabel(value: string): string {
  return value === "production" ? "生产" : value === "development" ? "开发" : value === "test" ? "测试" : value === "other" ? "其他" : "未知环境";
}

function costBasisLabel(value: "actual" | "estimated"): string {
  return value === "actual" ? "逐笔实扣" : "文档估算";
}

function estimateBasisLabel(value: NonNullable<CostDetailRow["cost"]["estimateBasis"]>): string {
  if (value === "fixed_rate") return "文档固定单价估算";
  if (value === "cache_split") return "已按缓存命中与未命中估算";
  if (value === "documented_special_rate") return "文档专用费率估算";
  return "标准输入价估算，不含缓存优惠";
}

function statusTone(status: CostDetailRow["status"]): "ok" | "warn" | "bad" | "muted" {
  return status === "received" ? "ok" : status === "pending" ? "warn" : status === "failed" ? "bad" : "muted";
}

export function decimalText(value: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  const grouped = match[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${match[1]}${grouped}${match[3] ?? ""}`;
}
