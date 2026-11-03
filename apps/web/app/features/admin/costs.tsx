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
import { operationLabel as catalogOperationLabel } from "./operation-types";
import { RedfoxCosts } from "./redfox-costs";
import {
  COST_GROUP_BY,
  COST_MODEL_MISSING,
  beijingDateTimeInput,
  costPageHref,
  presetRange,
  skillSpecialGroupPresentation,
  type CostPageView,
  type CostRangePreset,
  type CostPageFilters,
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

const SERVICE_LABELS: Array<[RegExp, string]> = [
  [/^assistant\.vision$/, "封面图像分析"],
  [/^assistant\.text$/, "助手模型调用"],
  [/^redfox\.query$/, "Redfox 数据查询"],
  [/^redfox\.media$/, "Redfox 素材处理"],
  [/^redfox\.image$/, "Redfox 图片生成"],
  [/^redfox\.poll$/, "Redfox 任务查询"],
  [/^redfox\.transcript$/, "Redfox 音视频转写"],
  [/^redfox\.account$/, "Redfox 账号查询"],
  [/^redfox\.video$/, "Redfox 视频生成"],
  [/^redfox\.xhs_comments$/, "Redfox 小红书评论查询"],
  [/^redfox\.wechat$/, "Redfox 公众号内容采集"],
  [/^redfox\.platform$/, "Redfox 平台内容采集"],
  [/^redfox\./, "Redfox 平台服务"],
  [/^agentkey(?:\.|$)/, "AgentKey 数据查询"],
  [/^aliyun\.wan\.video$/, "百炼万相视频生成"],
  [/^aliyun\.wan\.poll$/, "百炼万相任务查询"],
  [/^aliyun\.wan\.media$/, "百炼媒体处理"],
  [/^aliyun\.wan\./, "百炼万相服务"],
  [/^dashscope$/, "百炼模型调用"],
  [/^deepseek$/, "DeepSeek 模型调用"],
  [/^zhipu$/, "智谱模型调用"],
  [/^mimo$/, "MiMo 模型调用"],
  [/^jina$/, "Jina 内容处理"],
  [/^socialdata$/, "SocialData 数据查询"],
  [/^dajiala$/, "大加辣数据查询"],
  [/^embeddings$/, "文本向量化"],
  [/^llm$/, "模型调用"],
];

const OPERATION_LABELS: Array<[RegExp, string]> = [
  [/^chat\.completions$/, "生成文本"],
  [/^embeddings$/, "生成文本向量"],
  [/^search_notes$/, "查询小红书笔记"],
  [/^execute_tool$/, "执行数据查询"],
  [/^submit$/, "提交生成任务"],
  [/^poll$/, "查询任务进度"],
  [/^upload$/, "上传素材"],
  [/^generate$/, "生成内容"],
  [/^save$/, "保存结果"],
];

const ROW_WARNING_LABELS: Record<string, string> = {
  "历史身份为保守映射，不能证明计费供应商": "这条历史记录仅能按旧数据关联，不能确认实际服务商",
  "历史归属未知": "无法确认这条调用的发起用户",
  "历史 Skill 上下文未知": "旧记录没有保存所用技能",
  "多个 Skill 共享此调用，不可按单个 Skill 分摊": "多个技能共同完成这次调用，费用不能按单个技能拆分",
  "轮询调用保留，但费用已锚定生成任务": "这是一次任务状态查询，实际费用归在对应生成任务中",
  "万相任务费用证据冲突，未知费用没有按零计算": "万相任务的费用记录不一致，当前按费用未知处理",
};

const OWNER_LABELS: Record<CostOwnerKind, string> = {
  member: "会员",
  admin: "管理员",
  system: "系统",
  unassigned: "未归属",
};

const ATTRIBUTION_LABELS: Record<CostSkillAttribution, string> = {
  activated: "已使用技能",
  multi_skill: "多个技能共同使用",
  not_activated: "已确认未使用技能",
  historical_unknown: "旧记录未保存所用技能",
  not_applicable: "无需归属技能",
};

export function CostCenter({ page }: { page: CostPageProps }) {
  const pageView = page.view;
  return (
    <AdminPage
      title="成本中心"
      subtitle="查看各服务商、模型、技能和用户的调用量与费用，并区分实际扣费、估算费用和待确认记录。"
      actions={<><ButtonLink to="/admin/settings">调用预算</ButtonLink><ButtonLink to="/admin/runs">运行记录</ButtonLink></>}
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
        <Stat label="调用次数" value={num(data.totals.attempts)} hint={`${num(data.totals.logicalRequests)} 次请求 · ${num(data.totals.feeItems)} 个费用项目`} />
        <Stat label="有估算费用的记录" value={num(data.totals.estimatedCostItems)} hint={<BucketHint buckets={estimatedBuckets} empty="没有估算费用" />} tone={estimatedBuckets.length ? "warn" : undefined} />
        <Stat label="已有实扣的记录" value={num(data.totals.actualCostItems)} hint={<BucketHint buckets={actualBuckets} empty="没有供应商实扣" />} tone={actualBuckets.length ? "ok" : undefined} />
        <Stat label="费用待确认" value={num(data.totals.unknownCostItems)} hint={`${num(data.totals.sharedFeeItems)} 个费用项目由多个技能共同使用`} tone={data.totals.unknownCostItems ? "bad" : undefined} />
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
        <p className="border-b border-line px-4 py-2 text-[12px] text-ink-4 md:hidden">左右滑动表格，可查看费用和记录依据。</p>
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
    filters: { ...filters, billingProvider: null, service: null, operation: null, model: null, modelMissing: null, skillId: null, moduleId: null, userId: null, username: null, owner: null, origin: "live", environment: null, status: null, costBasis: null },
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
          <Field label="服务商">
            {facets ? <Select name="billingProvider" defaultValue={filters.billingProvider ?? ""}>
              <option value="">全部服务商</option>
              {facetOptions(facets.providers, filters.billingProvider).map((item) => <option key={item.value} value={item.value}>{item.label}（{item.count}）</option>)}
            </Select> : <Input name="billingProvider" defaultValue={filters.billingProvider ?? ""} placeholder="输入服务商名称或编号" />}
          </Field>
          <Field label="服务类型">
            {facets ? <Select name="service" defaultValue={filters.service ?? ""}>
              <option value="">全部服务类型</option>
              {facetOptions(facets.services.map((item) => ({ ...item, label: serviceLabel(item.value) })), filters.service).map((item) => <option key={item.value} value={item.value}>{item.label}（{item.count}）</option>)}
            </Select> : <Input name="service" defaultValue={filters.service ?? ""} placeholder="输入服务类型编号" />}
          </Field>
          <Field label="模型">
            {facets || filters.modelMissing ? <Select name="model" defaultValue={filters.modelMissing ? COST_MODEL_MISSING : filters.model ?? ""}>
              <option value="">全部模型</option>
              <option value={COST_MODEL_MISSING}>模型未知/模型为空</option>
              {facetOptions(facets?.models ?? [], filters.model).map((item) => <option key={item.value} value={item.value}>{item.label}（{item.count}）</option>)}
            </Select> : <Input name="model" defaultValue={filters.model ?? ""} placeholder="精确模型 ID" />}
          </Field>
          <Field label="具体操作" hint="输入调用动作的准确编号，支持目录外的自定义操作。">
            <Input name="operation" defaultValue={filters.operation ?? ""} placeholder="例如 chat.completions" />
          </Field>
          <Field label="用户编号" hint="与用户名二选一。">
            <Input name="userId" type="number" min="1" step="1" defaultValue={selectedByUsername ? "" : filters.userId ?? ""} placeholder="输入用户编号" />
          </Field>
          <Field label="用户名" hint="纯数字用户名也填在这里。">
            <Input name="username" defaultValue={filters.username ?? ""} placeholder="例如 editor" autoComplete="off" />
          </Field>
          <Field label="技能编号" hint="可输入准确编号，也可从已有技能中选择。">
            <Input name="skillId" list="cost-skill-ids" defaultValue={filters.skillId ?? ""} placeholder="输入技能编号" />
          </Field>
          <Field label="技能模块编号"><Input name="moduleId" list="cost-module-ids" defaultValue={filters.moduleId ?? ""} placeholder="输入技能模块编号" /></Field>
        </div>
        {facets && <><datalist id="cost-skill-ids">{facets.skills.map((item) => <option key={item.value} value={item.value.split(":", 1)[0]} label={item.label} />)}</datalist><datalist id="cost-module-ids">{facets.skills.map((item) => { const [, moduleId = ""] = item.value.split(":", 2); return <option key={item.value} value={moduleId} label={item.label} />; })}</datalist></>}
        <details className="rounded-control border border-line bg-bg-sunk/40 p-3">
          <summary className="cursor-pointer text-[13px] text-ink-2">更多筛选</summary>
          <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="来源">
              <Select name="origin" defaultValue={filters.origin ?? "all"}>
                <option value="live">实时调用</option>
                <option value="replay">复用已有结果</option>
                <option value="imported">导入记录</option>
                <option value="all">全部来源</option>
              </Select>
            </Field>
            <EnumField name="environment" label="执行环境" value={filters.environment} options={[
              ["production", "正式环境"], ["development", "开发环境"], ["test", "测试环境"], ["other", "其他环境"], ["unknown", "未知环境"],
            ]} />
            <EnumField name="status" label="调用状态" value={filters.status} options={[
              ["received", "已收到响应"], ["failed", "失败"], ["pending", "处理中"], ["unknown", "结果未知"],
            ]} />
            <EnumField name="costBasis" label="费用依据" value={filters.costBasis} options={[
              ["actual", "供应商实扣"], ["estimated", "按资料估算"],
            ]} />
            <EnumField name="owner" label="调用发起方" value={filters.owner} options={[
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
        <p className="border-b border-line px-4 py-3 text-[12.5px] text-amber">同一次调用由多个技能共同完成时，费用只计算一次，不能把这些分组金额相加。</p>
      )}
      <DataTable
        rows={rows}
        rowKey={(row) => `${row.group.key}:${row.index}`}
        empty="当前筛选没有可汇总的调用。"
        columns={[
          { key: "identity", label: "分类", render: ({ group }) => <GroupIdentity group={group} /> },
          { key: "calls", label: "调用情况", render: ({ group }) => <UsageAndStatus totals={group.totals} /> },
          { key: "cost", label: "费用记录", render: ({ group }) => <CostItems totals={group.totals} /> },
          { key: "amounts", label: "费用金额", className: "w-60 min-w-60", render: ({ group }) => <BucketList buckets={group.totals.amountBuckets} /> },
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
    return (
      <div className="min-w-44 break-all">
        <p className="font-medium text-ink">{providerLabel(group.billingProvider)}</p>
        <p className="text-[11.5px] text-ink-4">{group.upstreamProvider ? `上游服务：${providerLabel(group.upstreamProvider)}` : "费用结算服务商"}</p>
        <TechnicalDetails items={[["服务商编号", group.billingProvider], ["上游服务编号", group.upstreamProvider]]} />
      </div>
    );
  }
  if (group.groupBy === "service") {
    return (
      <div className="min-w-52 break-all">
        <p className="font-medium text-ink">{serviceLabel(group.service)}</p>
        <p className="text-[11.5px] text-ink-4">{providerLabel(group.billingProvider)} · {operationLabel(group.operation)}</p>
        <TechnicalDetails items={[["服务类型编号", group.service], ["具体操作编号", group.operation]]} />
      </div>
    );
  }
  if (group.groupBy === "model") {
    return (
      <div className="min-w-44 break-all">
        <p className="font-medium text-ink">{group.model ?? "模型未知"}</p>
        <p className="text-[11.5px] text-ink-4">{providerLabel(group.billingProvider)} · {serviceLabel(group.service)}</p>
        <TechnicalDetails items={[["服务商编号", group.billingProvider], ["服务类型编号", group.service]]} />
      </div>
    );
  }
  if (group.groupBy === "user") {
    return <div className="min-w-44 break-all"><p className="font-medium text-ink">{group.displayName || group.username || "未归属用户"}</p><p className="text-[11.5px] text-ink-4">{group.username ? `@${group.username} · #${group.userId}` : group.ownerKind ? OWNER_LABELS[group.ownerKind] : "历史归属未知"}</p></div>;
  }
  if (group.skill) {
    return (
      <div className="min-w-52 break-all">
        <p className="font-medium text-ink">{group.skill.label}</p>
        <p className="text-[11.5px] text-ink-4">助手技能{group.skill.version ? ` · 版本 ${group.skill.version}` : ""}</p>
        <TechnicalDetails items={[["技能编号", group.skill.skillId], ["技能模块编号", group.skill.moduleId], ["技能版本", group.skill.version]]} />
      </div>
    );
  }
  if (group.groupBy === "skill") {
    const status = skillSpecialGroupPresentation(group.key);
    return <div className="min-w-52 max-w-72"><p className="font-medium text-ink">{status.label}</p><p className="text-[11.5px] leading-relaxed text-ink-4">{status.description}</p></div>;
  }
  return <div className="min-w-44"><p className="font-medium text-ink">未归属</p><p className="text-[11.5px] text-ink-4">无法确认由哪一个技能使用</p></div>;
}

function UsageAndStatus({ totals }: { totals: CostGroup["totals"] }) {
  return (
    <div className="min-w-44">
      <p>{num(totals.attempts)} 次调用 · {num(totals.feeItems)} 个费用项目</p>
      <p className="text-[11.5px] text-ink-4">已收到响应 {num(totals.statusCounts.received)} · 失败 {num(totals.statusCounts.failed)} · 处理中 {num(totals.statusCounts.pending)} · 结果未知 {num(totals.statusCounts.unknown)}</p>
      <p className="text-[11.5px] text-ink-4">模型输入量/输出量 {num(totals.usage.inputTokens)} / {num(totals.usage.outputTokens)} · 缓存输入量 {num(totals.usage.cachedTokens)}</p>
    </div>
  );
}

function CostItems({ totals }: { totals: CostGroup["totals"] }) {
  return (
    <div className="min-w-40">
      <p>已知费用 {num(totals.knownCostItems)} · 待确认 {num(totals.unknownCostItems)}</p>
      <p className="text-[11.5px] text-ink-4">供应商实扣 {num(totals.actualCostItems)} · 按资料估算 {num(totals.estimatedCostItems)}</p>
      {(totals.usage.estimatedCredits || totals.usage.chargedCredits) && <p className="text-[11.5px] text-ink-4">积分估算 {totals.usage.estimatedCredits ?? "—"} · 实际扣分 {totals.usage.chargedCredits ?? "—"}</p>}
    </div>
  );
}

function MoneyBuckets({ buckets }: { buckets: CostAmountBucket[] }) {
  return (
    <Card title="费用构成">
      <p className="mb-3 text-[12px] leading-relaxed text-ink-4">不同币种、环境、来源和费用依据分别展示，不能直接相加。</p>
      <BucketList buckets={buckets} empty="当前筛选没有已知金额。缺少金额的记录不会按 0 元统计。" />
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
  return <div className="space-y-0.5">{buckets.slice(0, 3).map((bucket) => <div key={`${bucket.currency}:${bucket.origin}:${bucket.environment}`}>{decimalText(bucket.amount)} {bucket.currency} · {bucket.records} 条</div>)}{buckets.length > 3 && <div>另有 {buckets.length - 3} 项费用</div>}</div>;
}

function StatusAndUsage({ data }: { data: CostOverviewResponse }) {
  const usage = data.totals.usage;
  return (
    <Card title="状态与用量">
      <div className="grid grid-cols-2 gap-3 text-[13px]">
        <Fact label="用户请求" value={num(data.totals.logicalRequests)} />
        <Fact label="费用项目" value={num(data.totals.feeItems)} />
        <Fact label="模型输入量" value={num(usage.inputTokens)} />
        <Fact label="模型输出量" value={num(usage.outputTokens)} />
        <Fact label="缓存输入量" value={num(usage.cachedTokens)} />
        <Fact label="视频时长（秒）" value={usage.outputSeconds ?? "—"} />
        <Fact label="用量缺失行" value={num(usage.missingUsageRows)} />
        <Fact label="多技能共用费用" value={num(data.totals.sharedFeeItems)} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone="ok">已收到响应 {num(data.totals.statusCounts.received)}</Badge>
        <Badge tone="bad">失败 {num(data.totals.statusCounts.failed)}</Badge>
        <Badge tone="warn">处理中 {num(data.totals.statusCounts.pending)}</Badge>
        <Badge>结果未知 {num(data.totals.statusCounts.unknown)}</Badge>
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-ink-4">读取于 {bj(data.asOf, true)}。已收到响应仅表示供应商响应已保存，不代表业务处理成功；是否产生真实费用仍需以“供应商实扣”记录为准。</p>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-control bg-bg-sunk/60 p-2.5"><div className="text-[11.5px] text-ink-4">{label}</div><div className="num mt-1 break-all font-medium text-ink">{value}</div></div>;
}

type WarningTone = "info" | "attention" | "danger";

const WARNING_TONES: Record<WarningTone, string> = {
  info: "border-line bg-bg-sunk/45",
  attention: "border-amber/25 bg-amber/10",
  danger: "border-hot/25 bg-hot-soft/40",
};

const WARNING_DOTS: Record<WarningTone, string> = {
  info: "bg-ink-4",
  attention: "bg-amber",
  danger: "bg-hot",
};

const WARNING_PRESENTATIONS: Record<CostWarning["code"], {
  title: (count: number) => string;
  impact: string;
  tone: WarningTone;
}> = {
  historical_identity_unknown: {
    title: (count) => `${num(count)} 笔历史调用无法确认服务商或模型`,
    impact: "总费用仍会计入，但按服务商或模型拆分时可能不完整。",
    tone: "info",
  },
  historical_owner_unknown: {
    title: (count) => `${num(count)} 笔历史调用无法确认调用者`,
    impact: "总费用仍可查看，但这些费用不能可靠分摊到具体用户。",
    tone: "info",
  },
  historical_skill_unknown: {
    title: (count) => `${num(count)} 笔旧记录没有保存所用技能`,
    impact: "不能推断当时没有使用技能，按技能统计时可能缺少这部分记录。",
    tone: "info",
  },
  shared_skill_steps: {
    title: (count) => `${num(count)} 个费用项目由多个技能共同使用`,
    impact: "同一笔费用只计算一次；按不同技能分别相加会重复计算。",
    tone: "attention",
  },
  wan_cost_conflict: {
    title: (count) => `${num(count)} 个万相任务的费用记录存在冲突`,
    impact: "系统不会自行选择其中一个结果，请结合回执和账单进一步核对。",
    tone: "danger",
  },
  unknown_fee_evidence: {
    title: (count) => `${num(count)} 笔调用缺少完整费用信息`,
    impact: "这些记录按“费用未知”处理，不会自动当成 0 元。",
    tone: "attention",
  },
  facets_truncated: {
    title: () => "筛选项较多，列表只展示前 50 项",
    impact: "可以直接输入准确编号继续筛选，下方费用汇总不受影响。",
    tone: "info",
  },
  skills_catalog_unavailable: {
    title: () => "技能目录暂时不可用",
    impact: "技能候选项为空；历史费用、服务商、模型统计和调用明细仍可查看。",
    tone: "attention",
  },
};

function Warnings({ warnings }: { warnings: CostWarning[] }) {
  return (
    <Card title="需要留意" right={<span>{warnings.length} 类数据需要核对</span>}>
      <p className="mb-3 text-[12px] leading-relaxed text-ink-4">这些提示不会修改已有费用，只是说明当前统计中哪些部分可能不完整，或哪些金额不能直接相加。</p>
      <ul className="grid gap-3 md:grid-cols-2">
        {warnings.map((warning) => {
          const presentation = WARNING_PRESENTATIONS[warning.code] ?? {
            title: (count: number) => (count > 1 ? `${num(count)} 项费用记录需要核对` : "有费用记录需要核对"),
            impact: "系统无法用现有信息自动判断这项数据，请展开技术详情查看原始说明。",
            tone: "attention" as const,
          };
          return (
            <li key={warning.code} className={`min-w-0 rounded-control border p-3.5 sm:p-4 ${WARNING_TONES[presentation.tone]}`}>
              <div className="flex min-w-0 items-start gap-2.5">
                <span aria-hidden="true" className={`mt-[7px] size-2 shrink-0 rounded-full ${WARNING_DOTS[presentation.tone]}`} />
                <div className="min-w-0">
                  <p className="break-words text-[13.5px] font-medium leading-relaxed text-ink">{presentation.title(warning.count)}</p>
                  <p className="mt-1 break-words text-[12.5px] leading-relaxed text-ink-3"><span className="font-medium text-ink-2">影响：</span>{presentation.impact}</p>
                  <details className="mt-2.5 border-t border-line/70 pt-1.5 text-[11.5px] text-ink-4">
                    <summary className="cursor-pointer select-none py-2">技术详情</summary>
                    <dl className="mt-2 space-y-1 break-words">
                      <div><dt className="inline font-medium text-ink-3">代码：</dt><dd className="inline"><code>{warning.code}</code></dd></div>
                      <div><dt className="inline font-medium text-ink-3">系统说明：</dt><dd className="inline">{warning.message}</dd></div>
                    </dl>
                  </details>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const detailColumns: Column<CostDetailRow>[] = [
  {
    key: "time",
    label: "时间 / 状态",
    render: (row) => <div className="min-w-28"><Time at={row.startedAt} title={bj(row.startedAt, true)} /><p className="mt-1"><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge></p><p className="mt-1 text-[11.5px] text-ink-4">耗时 {latencyText(row.latencyMs)}</p></div>,
  },
  {
    key: "identity",
    label: "服务与模型",
    render: (row) => (
      <div className="min-w-44 max-w-56 break-all">
        <p className="font-medium text-ink">{providerLabel(row.billingProvider)} · {serviceLabel(row.service)}</p>
        <p className="text-[12px] text-ink-3">{operationLabel(row.operation)}</p>
        <p className="text-[11.5px] text-ink-4">模型 {row.model ?? "不适用/未知"}{row.upstreamProvider ? ` · 上游 ${providerLabel(row.upstreamProvider)}` : ""}</p>
        <TechnicalDetails items={[
          ["服务商编号", row.billingProvider],
          ["上游服务编号", row.upstreamProvider],
          ["服务类型编号", row.service],
          ["具体操作编号", row.operation],
        ]} />
      </div>
    ),
  },
  {
    key: "owner",
    label: "用户 / 技能",
    render: (row) => <div className="min-w-40 max-w-52 break-all"><p>{row.owner.displayName || row.owner.username || (row.owner.kind ? OWNER_LABELS[row.owner.kind] : "归属未知")}</p><p className="text-[11.5px] text-ink-4">{row.owner.username ? `@${row.owner.username} · #${row.owner.userId}` : row.owner.userId ? `#${row.owner.userId}` : "无用户 ID"}</p><p className="mt-1 text-[11.5px] text-ink-3">{ATTRIBUTION_LABELS[row.assistant.attribution]}{row.assistant.activations.length ? ` · ${row.assistant.activations.map((item) => `${item.label}${item.version ? ` (${item.version})` : ""}`).join("、")}` : ""}</p></div>,
  },
  {
    key: "usage",
    label: "用量",
    render: (row) => <div className="min-w-36"><p>模型输入量/输出量 {num(row.usage.inputTokens)} / {num(row.usage.outputTokens)}</p><p className="text-[11.5px] text-ink-4">缓存输入量 {num(row.usage.cachedTokens)} · 视频时长 {row.usage.outputSeconds ?? "—"} 秒</p>{(row.usage.estimatedCredits || row.usage.chargedCredits) && <p className="text-[11.5px] text-ink-4">积分估算 {row.usage.estimatedCredits ?? "—"} · 实际扣分 {row.usage.chargedCredits ?? "—"}</p>}</div>,
  },
  {
    key: "cost",
    label: "费用",
    render: (row) => <div className="min-w-36 max-w-48 break-all">{row.cost.applicable ? <><p className="font-medium text-ink">{row.cost.amount === null ? "未知" : `${decimalText(row.cost.amount)} ${row.cost.currency ?? ""}`}</p><p className="text-[11.5px] text-ink-4">{row.cost.basis ? costBasisLabel(row.cost.basis) : "依据未知"}</p>{row.cost.estimateBasis && <p className="text-[11.5px] text-ink-4">{estimateBasisLabel(row.cost.estimateBasis)}</p>}</> : <p className="text-ink-3">费用不适用于此行</p>}{row.cost.reason && <p className="mt-1 text-[11.5px] text-amber">{costReasonLabel(row.cost.reason)}</p>}</div>,
  },
  {
    key: "evidence",
    label: "记录依据",
    render: (row) => <Evidence row={row} />,
  },
];

function Evidence({ row }: { row: CostDetailRow }) {
  return (
    <div className="min-w-56 max-w-72 space-y-1 text-[11.5px] leading-relaxed text-ink-3">
      {row.runId !== null && <Link className="text-accent" to={`/admin/operations/${row.runId}`}>运行 #{row.runId}</Link>}
      <CopyId label="回执" value={`#${row.receiptId}`} />
      <CopyId label="尝试" value={`#${row.attemptId} / ${row.attempt}`} />
      <p>{identitySourceLabel(row.identitySource)} · {environmentLabel(row.environment)} · {originLabel(row.origin)}</p>
      <p>{priceSnapshotText(row)}</p>
      {row.warnings.map((warning) => <p key={warning} className="text-amber">{rowWarningLabel(warning)}</p>)}
      <details className="border-t border-line/70 pt-0.5">
        <summary className="cursor-pointer select-none py-1">技术详情</summary>
        <div className="mt-1 space-y-0.5 break-all">
          <p>身份来源代码：{row.identitySource}</p>
          <p>环境代码：{row.environment} · 来源代码：{row.origin} · 状态代码：{row.status}</p>
          <p>价格记录代码：{row.priceSnapshot.state}</p>
          {row.providerRequestId && <p>供应商请求编号：{row.providerRequestId}</p>}
          {row.priceSnapshot.reason && <p>价格记录原始说明：{row.priceSnapshot.reason}</p>}
          {row.priceSnapshot.sourceUrl && <p>价格来源：{row.priceSnapshot.sourceUrl}</p>}
          {row.cost.reason && <p>费用原始说明：{row.cost.reason}</p>}
        </div>
      </details>
    </div>
  );
}

function TechnicalDetails({ items }: { items: Array<[string, string | null | undefined]> }) {
  const present = items.filter((item): item is [string, string] => !!item[1]);
  if (!present.length) return null;
  return (
    <details className="mt-1 border-t border-line/60 pt-0.5">
      <summary className="cursor-pointer select-none py-2 text-[11.5px] text-ink-4">技术详情</summary>
      <dl className="mt-1 space-y-0.5 break-all text-[11px] text-ink-4">
        {present.map(([label, value]) => <div key={`${label}:${value}`}><dt className="inline font-medium text-ink-3">{label}：</dt><dd className="inline"><code>{value}</code></dd></div>)}
      </dl>
    </details>
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
  if (snapshot.state === "ready") return `价格已锁定${snapshot.selectedAt ? `于 ${bj(snapshot.selectedAt, true)}` : ""}${snapshot.verifiedOn ? `，核验日期 ${snapshot.verifiedOn}` : ""}`;
  if (snapshot.state === "unavailable") return "价格记录不可用，这笔费用暂时无法确认";
  return "历史调用未记录价格";
}

function facetOptions<T extends { value: string; label: string; count: number }>(items: T[], current: string | null): Array<{ value: string; label: string; count: number }> {
  if (!current || items.some((item) => item.value === current)) return items;
  return [{ value: current, label: `${current}（当前条件）`, count: 0 }, ...items];
}

function canonicalFilters(filters: CostFilters): CostPageFilters {
  return { ...filters, userId: filters.username ? null : filters.userId, origin: filters.origin ?? "all" };
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
  const filters: CostPageFilters = { ...canonicalFilters(data.filters) };
  if (group.groupBy === "provider") filters.billingProvider = group.billingProvider;
  if (group.groupBy === "service") {
    filters.billingProvider = group.billingProvider;
    filters.service = group.service;
    filters.operation = group.operation;
  }
  if (group.groupBy === "model") {
    filters.billingProvider = group.billingProvider;
    filters.model = group.model ?? COST_MODEL_MISSING;
    filters.modelMissing = null;
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
  return value ? PROVIDER_LABELS[value] ?? value : "服务商未知";
}

function serviceLabel(value: string | null): string {
  if (!value) return "服务类型未知";
  return SERVICE_LABELS.find(([pattern]) => pattern.test(value))?.[1] ?? value;
}

function operationLabel(value: string | null): string {
  if(value === "quote-preparation")return "任务报价准备（平台承担）";
  if (!value) return "具体操作未知";
  return catalogOperationLabel[value] ?? OPERATION_LABELS.find(([pattern]) => pattern.test(value))?.[1] ?? value;
}

function groupByLabel(value: CostGroupBy): string {
  return COST_GROUP_BY.find((item) => item.value === value)?.label ?? value;
}

function originLabel(value: string): string {
  return value === "live" ? "实时调用" : value === "replay" ? "复用已有结果" : value === "imported" ? "导入记录" : "来源未知";
}

function environmentLabel(value: string): string {
  return value === "production" ? "正式环境" : value === "development" ? "开发环境" : value === "test" ? "测试环境" : value === "other" ? "其他环境" : "未知环境";
}

function costBasisLabel(value: "actual" | "estimated"): string {
  return value === "actual" ? "供应商实扣" : "按资料估算";
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

function statusLabel(status: CostDetailRow["status"]): string {
  return status === "received" ? "已收到响应" : status === "pending" ? "处理中" : status === "failed" ? "失败" : "结果未知";
}

function identitySourceLabel(value: CostDetailRow["identitySource"]): string {
  return value === "explicit" ? "服务商与模型已明确记录" : value === "legacy_mapping" ? "按历史记录关联" : "服务商或模型无法确认";
}

function latencyText(value: number | null): string {
  if (value === null) return "未知";
  if (value < 1000) return `${num(value)} 毫秒`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1).replace(/\.?0+$/, "")} 秒`;
}

function rowWarningLabel(value: string): string {
  return ROW_WARNING_LABELS[value] ?? value.replaceAll("Skill", "技能").replaceAll("计费供应商", "服务商");
}

function costReasonLabel(value: string): string {
  if (value.startsWith("价格快照不可用")) return "价格记录不完整，这笔费用暂时无法确认";
  if (value === "缺少可复算的价格或用量证据") return "缺少计算费用所需的用量或价格信息";
  return value;
}

export function decimalText(value: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  const grouped = match[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${match[1]}${grouped}${match[3] ?? ""}`;
}
