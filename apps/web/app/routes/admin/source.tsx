import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/source";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { CollectionSwitch, type CollectionPreflight } from "../../features/admin/operation-switch";
import { collectionTargets, mpLibrary } from "../../features/admin/operation-switch-data";
import { OperationBadge, OperationLink } from "../../features/admin/operation-ui";
import { sourceHistoryFacts, type SourceActiveOperation, type SourceHistoryRun } from "../../features/admin/source-history-data";
import type { OperationAccepted, PreviewResponse } from "../../features/admin/operation-types";
import { bj, num } from "../../features/admin/format";
import { HEALTH_LABEL, KIND_LABEL, MODE_LABEL, TIER_LABEL, VISIBILITY_LABEL } from "../../features/admin/labels";
import { AdminPage, Badge, Button, Card, DataTable, Dot, Empty, Field, healthTone, Input, Json, KV, ReasonDialog, Select, Stat, Textarea, Time } from "../../features/admin/ui";

interface Source {
  id: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  tags: string[];
  first_party: boolean;
  owner_entity_id: string | null;
  tier: string;
  participation_mode: string;
  signal_group_id: string | null;
  interval_minutes: number;
  site_fulltext: boolean;
  syndicate_fulltext: boolean;
  enabled: boolean;
  health: string;
  fail_count: number;
  last_fetch_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  cursor: Record<string, unknown> | null;
  next_fetch_at: string | null;
  created_at: string;
  updated_at: string;
  subscription_id: number | null;
  active_run_id: number | null;
  collection_provider: string | null;
  collection_operation: string | null;
  collection_version: number | null;
  collection_issue: string | null;
}

interface Detail {
  source: Source;
  runs: SourceHistoryRun[];
  activeOperation: SourceActiveOperation | null;
  items: Array<{ id: string; title: string; url: string; discovered_at: string; published_at: string | null; processing_state: string; selected: boolean | null; visibility: string | null; title_zh: string | null }>;
  stats: { total: number; last7d: number; selected: number };
  history: Array<{ created_at: string; actor: string; action: string; reason: string | null; before: unknown; after: unknown }>;
}


export async function loader({ request, params }: Route.LoaderArgs) {
  const base = `/api/admin/sources/${encodeURIComponent(params.id)}`;
  const detail = await adminGet<Detail>(request, base);
  const url = new URL(request.url);
  const library = mpLibrary(url.searchParams.get("library")) ?? "wide";
  const preflights = url.searchParams.get("preflight") === "1"
    ? await Promise.all(collectionTargets(detail.source.kind).map(target => adminGet<CollectionPreflight>(request, `${base}/collection/preflight?${new URLSearchParams({ target, ...(detail.source.kind === "mp_account" ? { library } : {}) })}`)))
    : null;
  return { ...detail, preflights };
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.source.name ?? "信源"} · ${SITE.name} 后台` }];

type Draft = Pick<Source, "name" | "interval_minutes" | "tier" | "participation_mode" | "signal_group_id" | "first_party" | "owner_entity_id" | "site_fulltext" | "syndicate_fulltext"> & { tags: string; config: string };

function draftOf(s: Source): Draft {
  return {
    name: s.name,
    interval_minutes: s.interval_minutes,
    tier: s.tier,
    participation_mode: s.participation_mode,
    signal_group_id: s.signal_group_id,
    first_party: s.first_party,
    owner_entity_id: s.owner_entity_id,
    site_fulltext: s.site_fulltext,
    syndicate_fulltext: s.syndicate_fulltext,
    tags: s.tags.join(", "),
    config: JSON.stringify(s.config, null, 2),
  };
}

export default function SourceDetail({ loaderData }: Route.ComponentProps) {
  const { source: s, runs, activeOperation, items, stats, history } = loaderData;
  const { run, pending } = useAdminAction();
  const [draft, setDraft] = useState<Draft>(() => draftOf(s));
  const [draftFor, setDraftFor] = useState(s.updated_at);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [collection, setCollection] = useState<OperationAccepted | null>(null);
  const [dialog, setDialog] = useState<null | "save" | "toggle">(null);
  const [configError, setConfigError] = useState<string | null>(null);
  if (draftFor !== s.updated_at) {
    // The source changed (our own save or someone else's): start from the saved state.
    setDraft(draftOf(s));
    setDraftFor(s.updated_at);
  }
  const base = `/api/admin/sources/${encodeURIComponent(s.id)}`;

  const patch = (): Record<string, unknown> | null => {
    let config: unknown;
    try {
      config = JSON.parse(draft.config);
      setConfigError(null);
    } catch (e) {
      setConfigError(`配置不是合法 JSON：${(e as Error).message}`);
      return null;
    }
    const next: Record<string, unknown> = {
      ...draft,
      tags: draft.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      config,
      interval_minutes: Number(draft.interval_minutes),
      signal_group_id: draft.signal_group_id || null,
      owner_entity_id: draft.owner_entity_id || null,
    };
    const before = draftOf(s) as Record<string, unknown>;
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) {
      const was = k === "tags" ? s.tags : k === "config" ? s.config : before[k];
      if (JSON.stringify(v) !== JSON.stringify(was)) changed[k] = v;
    }
    return changed;
  };
  const changes = (() => {
    try {
      return Object.keys(patchPreview(draft, s)).length;
    } catch {
      return 1;
    }
  })();

  return (
    <AdminPage
      title={
        <span className="flex flex-wrap items-center gap-2">
          {s.name}
          <Badge>{KIND_LABEL[s.kind] ?? s.kind}</Badge>
          <Badge tone={s.participation_mode === "editorial" ? "accent" : "muted"}>{MODE_LABEL[s.participation_mode]}</Badge>
        </span>
      }
      subtitle={<span className="font-mono text-[12px]">{s.id}</span>}
      actions={
        <>
          {!["mp_account", "external"].includes(s.kind) && <Button
            disabled={!!pending || !!s.collection_issue}
            busy={pending === "preview"}
            onClick={async () => {
              const r = await run<PreviewResponse>("POST", `${base}/preview`, {}, { label: "preview", revalidate: false });
              if (r) setPreview(r);
            }}
          >
            预览抓取
          </Button>}
          <Button disabled={!!pending || !!s.collection_issue || s.kind === "external"} busy={pending === "fetch"} onClick={async () => {
            const result = await run<OperationAccepted | { queued: boolean }>("POST", `${base}/fetch`, {}, { label: "fetch", success: "采集命令已提交" });
            if (result && "runId" in result) setCollection(result);
          }}>
            立即采集
          </Button>
          <Button tone={s.enabled ? "danger" : "primary"} onClick={() => setDialog("toggle")}>
            {s.enabled ? "暂停" : "恢复"}
          </Button>
        </>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="健康"
          value={
            <span className="inline-flex items-center gap-2 text-[18px]">
              <Dot tone={s.enabled ? healthTone(s.health) : "muted"} />
              {s.enabled ? HEALTH_LABEL[s.health] ?? s.health : "已暂停"}
            </span>
          }
          hint={s.fail_count ? `连续失败 ${s.fail_count} 次` : `上次成功 ${s.last_ok_at ? bj(s.last_ok_at) : "—"}`}
        />
        <Stat label="累计条目" value={num(stats.total)} />
        <Stat label="近 7 天" value={num(stats.last7d)} />
        <Stat label="入选精选" value={num(stats.selected)} />
      </div>
      {s.last_error && s.health !== "ok" && <div className="mb-5 rounded-card bg-hot-soft px-4 py-3 text-[13px] text-hot ring-1 ring-hot/20">{s.last_error}</div>}

      {s.collection_issue && <div className="mb-5 rounded-card bg-amber/10 p-4 text-[13px] text-amber">主采集订阅尚未迁移，采集命令已阻断。请由维护者执行显式迁移；只读页面不会创建订阅。</div>}
      {collection && <div className="mb-5"><OperationLink operation={collection} /></div>}
      {preview && "runId" in preview && <div className="mb-5"><OperationLink operation={preview} newTab /></div>}
      {preview && !("runId" in preview) && (
        <Card className="mb-5" title={`预览：${preview.count} 条（${preview.ms}ms，未入库）`} right={<button onClick={() => setPreview(null)}>收起</button>}>
          {preview.items.length ? (
            <ul className="space-y-2.5">
              {preview.items.map((i) => (
                <li key={i.url} className="text-[13px]">
                  <a href={i.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-accent">{i.title}</a>
                  <div className="text-[12px] text-ink-4">{i.publishedAt ? bj(i.publishedAt, true) : "无发布时间"} · {i.url}</div>
                  {i.excerpt && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">{i.excerpt}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>没有抓到条目。检查地址、选择器或登录要求。</Empty>
          )}
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          <Card title="设置" right={<span>版本 {bj(s.updated_at, true)}</span>}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="名称">
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="采集间隔（分钟）">
                <Input type="number" min={1} max={1440} value={draft.interval_minutes} onChange={(e) => setDraft({ ...draft, interval_minutes: Number(e.target.value) })} />
              </Field>
              <Field label="参与方式" hint="氛围只作热点讨论证据，不单独成为内容">
                <Select value={draft.participation_mode} onChange={(e) => setDraft({ ...draft, participation_mode: e.target.value })}>
                  {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="等级">
                <Select value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })}>
                  {Object.entries(TIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="讨论分组 ID" hint="同一机构的多个账号共用，热度只算一次">
                <Input value={draft.signal_group_id ?? ""} onChange={(e) => setDraft({ ...draft, signal_group_id: e.target.value })} />
              </Field>
              <Field label="运营主体 ID">
                <Input value={draft.owner_entity_id ?? ""} onChange={(e) => setDraft({ ...draft, owner_entity_id: e.target.value })} />
              </Field>
              <Field label="标签（逗号分隔）">
                <Input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
              </Field>
              <div className="flex flex-col justify-end gap-2 text-[13px] text-ink-2">
                {([
                  ["first_party", "一手信源（官方账号或官网）"],
                  ["site_fulltext", "站内可展示全文"],
                  ["syndicate_fulltext", "对外接口可带全文"],
                ] as const).map(([k, label]) => (
                  <label key={k} className="inline-flex items-center gap-2">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <Field label="采集配置（JSON）">
                <Textarea className="font-mono !text-[12px]" rows={Math.min(18, draft.config.split("\n").length + 1)} value={draft.config} onChange={(e) => setDraft({ ...draft, config: e.target.value })} spellCheck={false} />
              </Field>
              {configError && <div className="mt-1 text-[12.5px] text-hot">{configError}</div>}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              {changes > 0 && <span className="text-[12.5px] text-ink-3">{changes} 项改动未保存</span>}
              <Button tone="ghost" disabled={!changes} onClick={() => setDraft(draftOf(s))}>还原</Button>
              <Button tone="primary" disabled={!changes} onClick={() => patch() && setDialog("save")}>保存</Button>
            </div>
          </Card>

          {["x_search", "mp_account"].includes(s.kind) && <CollectionSwitch key={s.id} kind={s.kind} savedLibrary={mpLibrary(s.config?.redfoxLibrary)} intervalMinutes={s.interval_minutes} subscriptionId={s.subscription_id} sourceId={s.id} provider={s.collection_provider} sourceVersion={s.updated_at} subscriptionVersion={s.collection_version} activeRunId={s.active_run_id} />}

          <Card title="最近条目" pad={false}>
            <DataTable
              rows={items}
              rowKey={(r) => r.id}
              empty="还没有采集到内容"
              columns={[
                {
                  key: "t",
                  label: "标题",
                  render: (r) => (
                    <Link to={`/admin/content/${r.id}`} className="line-clamp-2 min-w-[260px] text-ink hover:text-accent">{r.title_zh || r.title}</Link>
                  ),
                },
                { key: "s", label: "状态", render: (r) => <span className="flex gap-1">{r.selected && <Badge tone="accent">精选</Badge>}{r.visibility && r.visibility !== "public" && <Badge tone="warn">{VISIBILITY_LABEL[r.visibility]}</Badge>}<Badge>{r.processing_state}</Badge></span> },
                { key: "d", label: "发现", render: (r) => <Time at={r.discovered_at} /> },
              ]}
            />
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card title="采集任务">
            <KV items={[["供应商", s.collection_provider ?? (s.kind === "external" ? "外部上报" : ["x_search", "mp_account"].includes(s.kind) ? "尚未迁移" : "原生采集")], ["主订阅", s.subscription_id ?? "—"], ["当前任务", s.active_run_id ? <Link className="text-accent" to={`/admin/operations/${s.active_run_id}`}>#{s.active_run_id}</Link> : "无在途正式任务"]]} />
            {activeOperation && <div className="mt-3 min-w-0 space-y-2 border-t border-line pt-3"><KV items={[
              ["任务状态", <OperationBadge status={activeOperation.status} />],
              ["当前步骤", <span className="break-all">{activeOperation.step}</span>],
              ["等待 / 处理说明", <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{activeOperation.waitReason ?? "—"}</span>],
              ["下次尝试", <Time at={activeOperation.nextAttemptAt} />],
            ]} /><p className="text-[12px] text-ink-4">任务等待原因与信源健康分别展示；预算等待、未知回执或本地核实请到任务页查看。</p></div>}
            <div className="mt-3 text-[13px]"><Link className="text-accent" to="/admin/operations">查看采集与查询任务</Link></div>
            <div className="mt-3"><Json value={{ operation: s.collection_operation, version: s.collection_version, progress: s.cursor }} label="操作与进度诊断" /></div>
          </Card>
          <Card title="状态">
            <KV
              items={[
                ["上次抓取", s.last_fetch_at ? bj(s.last_fetch_at, true) : null],
                ["上次成功", s.last_ok_at ? bj(s.last_ok_at, true) : null],
                ["下次抓取", s.next_fetch_at ? bj(s.next_fetch_at, true) : null],
                ["创建", bj(s.created_at, true)],
              ]}
            />
            {s.cursor && <div className="mt-3"><Json value={s.cursor} label="游标" /></div>}
          </Card>
          <Card title="历史采集记录" pad={false}>
            <DataTable
              dense
              rows={runs}
              rowKey={(r) => r.history_key}
              empty="还没有采集记录"
              columns={[
                { key: "at", label: "时间 / 任务", render: (r) => { const facts = sourceHistoryFacts(r); return <div className="space-y-1"><span className="block text-[11px] text-ink-4">{facts.timeLabel}</span><Time at={facts.time} />{facts.href && <Link className="block text-accent" to={facts.href}>查看任务 #{r.id}</Link>}<span className="block text-[11px] text-ink-4">供应商：{facts.provider}</span></div>; } },
                {
                  key: "st",
                  label: "结果",
                  render: (r) => (
                    <div className="space-y-1"><span className="inline-flex flex-wrap gap-1">
                      {r.kind === "operation" ? <OperationBadge status={r.status} /> : <Badge tone={r.status === "ok" ? "ok" : r.status === "failed" ? "bad" : "muted"} title={r.error ?? undefined}>{r.status}</Badge>}
                      {!!r.detail?.dropped && <Badge tone="bad" title="有一段更早的帖子没能读完，其中的内容可能漏采">可能漏采</Badge>}
                      {!r.detail?.dropped && !!r.detail?.backlog && <Badge tone="warn" title="帖子多于一轮能读的页数，余下的在后面几轮接着读">续读 {r.detail.backlog} 段</Badge>}
                    </span>{r.kind === "operation" && <><p className="max-w-52 whitespace-normal break-all text-[11px] text-ink-3">步骤：{r.step}</p>{r.error && <p className="max-w-52 whitespace-pre-wrap break-words text-[11px] text-ink-3 [overflow-wrap:anywhere]">等待 / 处理说明：{r.error}</p>}{r.next_attempt_at && <p className="text-[11px] text-ink-3">下次尝试：<Time at={r.next_attempt_at} /></p>}</>}</div>
                  ),
                },
                { key: "n", label: "材料数", align: "right", render: (r) => { const facts = sourceHistoryFacts(r); return <div><span className="block text-[11px] text-ink-4">{facts.quantityLabel}</span>{facts.quantity}</div>; } },
                { key: "ms", label: "抓取耗时", align: "right", render: (r) => sourceHistoryFacts(r).elapsed ?? <span className="text-[11px] text-ink-4">任务记录不计抓取耗时</span> },
              ]}
            />
          </Card>
          <Card title="修改记录">
            {history.length ? (
              <ul className="space-y-3 text-[12.5px]">
                {history.map((h, i) => (
                  <li key={i}>
                    <div className="text-ink-2"><span className="font-medium">{h.action}</span> · {h.actor} · {bj(h.created_at)}</div>
                    {h.reason && <div className="text-ink-3">{h.reason}</div>}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>没有人工修改</Empty>
            )}
          </Card>
        </div>
      </div>

      <ReasonDialog
        open={dialog === "save"}
        title="保存信源设置"
        description={`将修改：${Object.keys(patchPreview(draft, s)).join("、") || "无"}`}
        busy={pending === "save"}
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => {
          const p = patch();
          if (!p) return false;
          const r = await run("PATCH", base, { patch: p, version: new Date(s.updated_at).toISOString(), reason }, { label: "save", success: "已保存" });
          return r !== null;
        }}
      />
      <ReasonDialog
        open={dialog === "toggle"}
        title={s.enabled ? "暂停这个信源" : "恢复这个信源"}
        description={s.enabled ? "暂停后不再采集，已有内容和历史保留。" : "恢复后会立即排队采集一次。"}
        danger={s.enabled}
        confirmLabel={s.enabled ? "暂停" : "恢复"}
        busy={pending === "toggle"}
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => {
          const r = await run("PATCH", base, { patch: { enabled: !s.enabled }, version: new Date(s.updated_at).toISOString(), reason }, { label: "toggle", success: s.enabled ? "已暂停" : "已恢复" });
          return r !== null;
        }}
      />
    </AdminPage>
  );
}

/** Field names that differ from the saved source (for the confirmation text). */
function patchPreview(draft: Draft, s: Source): Record<string, true> {
  const out: Record<string, true> = {};
  const saved = draftOf(s);
  for (const k of Object.keys(draft) as Array<keyof Draft>) {
    if (k === "config") {
      try {
        if (JSON.stringify(JSON.parse(draft.config)) !== JSON.stringify(s.config)) out.config = true;
      } catch {
        out.config = true;
      }
    } else if (String(draft[k] ?? "") !== String(saved[k] ?? "")) out[k] = true;
  }
  return out;
}
