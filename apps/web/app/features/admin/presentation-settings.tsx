import { useEffect, useRef, useState } from "react";
import { isCustomNavigationEntry, type AdminPresentationSettings, type NavigationEntry, type SitePresentation } from "@aihot/contracts/presentation";
import { CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { CATEGORIES, CATEGORY_TAGS, ENTITY_TAGS, TOPIC_TAGS } from "@aihot/industry/taxonomy";
import { NAV_GROUPS, NAV_ITEMS, navigationItem, navigationUnavailable } from "../../components/shell/nav";
import { useAdminAction } from "./action";
import { bj } from "./format";
import { Badge, Button, Card, Field, Input, Select } from "./ui";
import { insertCustomColumn, movePresentationItem, newCustomColumn, presentationDraftErrors, restorePresentationDefaults } from "./presentation-draft";

function EntryRow({ label, visible, fixed, unavailable, first, last, onToggle, onMove }: { label: string; visible: boolean; fixed?: boolean; unavailable?: string | null; first: boolean; last: boolean; onToggle: () => void; onMove: (direction: -1 | 1) => void }) {
  return <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2 last:border-0">
    <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={fixed || (!unavailable && visible)} disabled={fixed || !!unavailable} onChange={onToggle} className="size-4 accent-accent" /><span>{label}{fixed && <span className="ml-2 text-[11px] text-ink-4">固定显示</span>}{unavailable && <span className="ml-2 text-[11px] text-ink-4">{unavailable}</span>}</span></label>
    <div className="flex shrink-0 gap-1"><Button size="sm" disabled={first} aria-label={`上移${label}`} onClick={() => onMove(-1)}>上移</Button><Button size="sm" disabled={last} aria-label={`下移${label}`} onClick={() => onMove(1)}>下移</Button></div>
  </li>;
}
const SIZE_LABELS = { selected: "精选每批卡片数", all: "全部动态每页条数", videos: "视频每页条数" } as const;
const TAG_SUGGESTIONS = [...new Set([...CATEGORY_TAGS, ...TOPIC_TAGS, ...ENTITY_TAGS])];
function rangeSummary(row: NavigationEntry): string {
  if (!isCustomNavigationEntry(row)) return "系统栏目";
  return [row.category ? CATEGORIES.find((entry) => entry.key === row.category)?.label ?? `失效分类：${row.category}` : "不限分类", row.tag ? `#${row.tag}` : "不限标签", row.scope === "videos" ? "仅含视频" : "全部公开内容"].join(" · ");
}

export function PresentationSettings({ settings }: { settings: AdminPresentationSettings }) {
  // Revalidation may refresh the route while a user is editing; only a successful save replaces this draft.
  const [saved, setSaved] = useState(settings);
  const [draft, setDraft] = useState<SitePresentation>(() => structuredClone(settings.presentation));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; field: string; sequence: number } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [feedback, setFeedback] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const { run, pending } = useAdminAction();
  const changed = JSON.stringify(draft) !== JSON.stringify(saved.presentation);
  const errors = presentationDraftErrors(draft);
  const newRow = draft.navigation.find((row) => !saved.presentation.navigation.some((entry) => entry.id === row.id));
  const visibleCount = draft.navigation.filter((item) => (item.id === "selected" || item.visible) && !navigationUnavailable(item.id)).length;
  useEffect(() => {
    if (!focus) return;
    const input = form.current?.querySelector<HTMLElement>(`[data-column="${focus.id}"][data-field="${focus.field}"]`);
    input?.scrollIntoView({ block: "center", behavior: "smooth" });
    input?.focus();
  }, [focus]);
  const locate = (id: string, field = "label") => { setExpanded(id); setFocus((previous) => ({ id, field, sequence: (previous?.sequence ?? 0) + 1 })); };
  const updateRow = (id: string, patch: Partial<NavigationEntry>) => setDraft((value) => ({ ...value, navigation: value.navigation.map((row) => row.id === id ? { ...row, ...patch } as NavigationEntry : row) }));

  return <Card className="mb-5" title="前台栏目与展示" right={<span>已显示 {visibleCount} 个栏目</span>}>
    <form ref={form} noValidate onSubmit={async (event) => {
      event.preventDefault();
      if (pending) return;
      setAttempted(true);
      if (errors[0]) { locate(errors[0].id, errors[0].field); setFeedback("请先修正下方字段，再保存更改。"); return; }
      setFeedback("");
      const result = await run<AdminPresentationSettings>("PUT", "/api/admin/settings/presentation", draft, { label: "presentation", success: "前台栏目与展示已保存" });
      if (result) { setSaved(result); setDraft(structuredClone(result.presentation)); setAttempted(false); setFeedback("保存成功，已回显服务器配置。"); }
      else setFeedback("未能保存，当前草稿已保留，请根据错误提示重试。");
    }}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><p className="max-w-3xl text-[12.5px] leading-relaxed text-ink-3">隐藏只移除入口，旧链接与内容权限不变。精选和手机端“更多”固定显示；同一组内可调整顺序。</p><Button disabled={pending !== null} onClick={() => { if (newRow) { locate(newRow.id); return; } const row = newCustomColumn(draft); setDraft(insertCustomColumn(draft, row)); locate(row.id); }}>新建栏目</Button></div>
      <fieldset disabled={pending !== null}>
        <legend className="mb-2 text-[13px] font-semibold text-ink">站点栏目</legend>
        <div className="space-y-4">{NAV_GROUPS.map((title) => {
          const items = draft.navigation.filter((row) => navigationItem(row).group === title);
          return <section key={title} className="rounded-control border border-line px-3 py-2"><h3 className="text-[12px] text-ink-4">{title}</h3><ul>{items.map((row, index) => {
            const custom = isCustomNavigationEntry(row), name = navigationItem(row).label || "未命名栏目", isNew = row.id === newRow?.id;
            const rowErrors = errors.filter((error) => error.id === row.id && (attempted || error.field === "category"));
            const size = custom ? `每页 ${Number.isNaN(row.pageSize) ? "待填写" : row.pageSize} 条` : row.id in SIZE_LABELS ? `${row.id === "selected" ? "每批" : "每页"} ${draft.pageSizes[row.id as keyof typeof SIZE_LABELS]} 条` : "按原页面规则";
            const open = expanded === row.id;
            return <li key={row.id} className="border-b border-line-soft py-3 last:border-0">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 basis-60"><div className="flex flex-wrap items-center gap-2"><span className="break-all text-[13px] font-medium text-ink">{name}</span><Badge>{custom ? "自建" : "预置"}</Badge><Badge tone={row.visible ? "ok" : "muted"}>{row.id === "selected" ? "固定显示" : row.visible ? "显示" : "隐藏"}</Badge>{isNew && <Badge tone="warn">未保存新栏目</Badge>}</div><p className="mt-1 break-all text-[12px] leading-relaxed text-ink-3">{rangeSummary(row)} · {size}</p>{navigationUnavailable(row.id) && <p className="mt-1 text-[12px] text-ink-4">{navigationUnavailable(row.id)}</p>}</div>
                <div className="flex flex-wrap items-center gap-1.5"><label className="mr-1 flex items-center gap-1.5 text-[12px] text-ink-2"><input aria-label={`显示${name}`} type="checkbox" className="size-4 accent-accent" checked={row.id === "selected" || (!navigationUnavailable(row.id) && row.visible)} disabled={row.id === "selected" || !!navigationUnavailable(row.id)} onChange={() => updateRow(row.id, { visible: !row.visible })} />显示</label><Button size="sm" aria-expanded={open} onClick={() => setExpanded(open ? null : row.id)}>{open ? "收起" : "编辑"}</Button><Button size="sm" disabled={index === 0} aria-label={`上移${name}`} onClick={() => setDraft((value) => ({ ...value, navigation: movePresentationItem(value.navigation, row.id, -1, items.map((entry) => entry.id)) }))}>上移</Button><Button size="sm" disabled={index === items.length - 1} aria-label={`下移${name}`} onClick={() => setDraft((value) => ({ ...value, navigation: movePresentationItem(value.navigation, row.id, 1, items.map((entry) => entry.id)) }))}>下移</Button></div>
              </div>
              {open && <div className="mt-3 grid gap-3 rounded-control bg-bg-sunk/50 p-3 sm:grid-cols-2"><Field label="显示名称" hint={custom ? "必填，最多 20 字。" : "留空使用预置名称，最多 20 字。"}><Input data-column={row.id} data-field="label" aria-label={`显示名称 ${name}`} aria-invalid={rowErrors.some((error) => error.field === "label")} value={row.label ?? ""} placeholder={custom ? "例如：产品资讯" : NAV_ITEMS[row.id].label} onChange={(event) => updateRow(row.id, { label: event.target.value })} /></Field>
                {custom && <><Field label="分类" hint="分类和标签同时填写时，内容需同时满足。"><Select data-column={row.id} data-field="category" aria-label={`分类 ${name}`} aria-invalid={rowErrors.some((error) => error.field === "category")} value={row.category ?? ""} onChange={(event) => updateRow(row.id, { category: event.target.value || undefined })}><option value="">不限分类</option>{row.category && !CATEGORIES.some((entry) => entry.key === row.category) && <option value={row.category} disabled>已失效：{row.category}（请选择新分类）</option>}{CATEGORIES.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</Select></Field><Field label="标签" hint="可选建议或手输一个实际标签；不使用内部 entity: 标签。"><Input data-column={row.id} data-field="tag" aria-label={`标签 ${name}`} aria-invalid={rowErrors.some((error) => error.field === "tag")} list="column-tag-suggestions" value={row.tag ?? ""} onChange={(event) => updateRow(row.id, { tag: event.target.value || undefined })} /></Field><Field label="每页条数" hint="1–40 的整数；保存后与默认列表数量独立。"><Input data-column={row.id} data-field="pageSize" aria-label={`每页条数 ${name}`} aria-invalid={rowErrors.some((error) => error.field === "pageSize")} type="number" min={1} max={40} step={1} value={Number.isNaN(row.pageSize) ? "" : row.pageSize} onChange={(event) => updateRow(row.id, { pageSize: event.target.valueAsNumber })} /></Field><label className="flex items-center gap-2 text-[13px] text-ink-2 sm:col-span-2"><input type="checkbox" className="size-4 accent-accent" checked={row.scope === "videos"} onChange={(event) => { const scope = event.target.checked ? "videos" : "all"; updateRow(row.id, { scope, ...(isNew ? { pageSize: draft.pageSizes[scope] } : {}) }); }} />只显示含视频的内容</label></>}
              </div>}
              {rowErrors.map((error) => <p key={error.field} role="alert" className="mt-2 text-[12px] text-hot">{error.message}</p>)}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">{isNew ? <><span className="text-ink-4">保存后可查看</span><Button size="sm" tone="ghost" onClick={() => { setDraft((value) => ({ ...value, navigation: value.navigation.filter((entry) => entry.id !== row.id) })); if (open) setExpanded(null); }}>取消新栏目</Button></> : <a href={navigationItem(row).to} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{JSON.stringify(row) !== JSON.stringify(saved.presentation.navigation.find((entry) => entry.id === row.id)) ? "查看已保存版本" : "查看栏目"} ↗</a>}</div>
            </li>;
          })}</ul></section>;
        })}</div>
        <datalist id="column-tag-suggestions">{TAG_SUGGESTIONS.map((tag) => <option key={tag} value={tag} />)}</datalist>
        <div className="mt-5 grid gap-5 lg:grid-cols-2"><section><h3 className="text-[13px] font-semibold text-ink">分类入口 <span className="ml-2 font-normal text-ink-4">已显示 {draft.categories.filter((item) => item.visible).length} 个</span></h3><p className="mt-1 text-[12px] text-ink-4">控制前台分类筛选栏，不新增分类。“全部”和“一手”保留；隐藏分类不移除其文章。</p><ul>{draft.categories.map((item, index) => <EntryRow key={item.id} label={CATEGORY_LABELS[item.id]} visible={item.visible} first={index === 0} last={index === draft.categories.length - 1} onToggle={() => setDraft((value) => ({ ...value, categories: value.categories.map((entry) => entry.id === item.id ? { ...entry, visible: !entry.visible } : entry) }))} onMove={(direction) => setDraft((value) => ({ ...value, categories: movePresentationItem(value.categories, item.id, direction, value.categories.map((entry) => entry.id)) }))} />)}</ul></section>
          <section><h3 className="mb-3 text-[13px] font-semibold text-ink">默认列表数量</h3><div className="space-y-3">{(Object.keys(SIZE_LABELS) as Array<keyof typeof SIZE_LABELS>).map((key) => <label key={key} className="flex items-center justify-between gap-3 text-[13px] text-ink-2"><span>{SIZE_LABELS[key]}</span><Input data-column={key} data-field="pageSize" aria-label={SIZE_LABELS[key]} aria-invalid={attempted && errors.some((error) => error.id === key && error.field === "pageSize")} type="number" min={1} max={40} step={1} className="!w-24 text-right" value={Number.isNaN(draft.pageSizes[key]) ? "" : draft.pageSizes[key]} onChange={(event) => { const value = event.target.valueAsNumber; setDraft((current) => ({ ...current, pageSizes: { ...current.pageSizes, [key]: value } })); }} /></label>)}</div>{attempted && errors.some((error) => error.field === "pageSize" && error.id in SIZE_LABELS) && <p role="alert" className="mt-2 text-[12px] text-hot">默认列表数量必须是 1–40 的整数。</p>}</section></div>
        <div className="mt-5 border-t border-line pt-4">{changed && <p role="status" className="mb-3 text-[13px] text-amber">有未保存修改，离开或刷新会丢失。</p>}<div className="flex flex-wrap items-center gap-2"><Button type="submit" tone="primary" busy={pending === "presentation"} disabled={!changed}>保存更改</Button><Button disabled={!changed} onClick={() => { setDraft(structuredClone(saved.presentation)); setExpanded(null); setAttempted(false); setFeedback("已放弃修改，恢复最近保存的配置。"); }}>放弃修改</Button><Button onClick={() => { setDraft(restorePresentationDefaults(saved)); setExpanded(null); setAttempted(false); setFeedback("已恢复默认草稿；已保存自建定义保留并隐藏，保存后生效。"); }}>恢复默认</Button><a href="/" target="_blank" rel="noopener noreferrer" className="ml-1 text-[13px] text-accent hover:underline">查看前台 ↗</a></div><p className="mt-2 text-[12px] text-ink-4">恢复默认会还原预置栏目、分类入口和默认数量；已保存的自建栏目保留名称、范围与数量，隐藏并放在内容组末尾。</p></div>
      </fieldset>
      {feedback && <p role="status" className="mt-3 text-[13px] text-ink-2">{feedback}</p>}
      <p className="mt-3 text-[12px] leading-relaxed text-ink-4">{saved.updatedAt ? <>最近保存：<time dateTime={saved.updatedAt}>{bj(saved.updatedAt, true)}</time>。 </> : "当前使用行业默认配置，尚未保存。 "}保存后可打开前台查看；元数据缓存为 60 秒，部分完整页面缓存更长，请刷新或等待缓存重新验证。</p>
    </form>
  </Card>;
}
