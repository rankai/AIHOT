import { isCustomNavigationEntry, type CustomNavigationEntry, type SitePresentation } from "@aihot/contracts/presentation";
import { isCategoryKey } from "@aihot/contracts/taxonomy";

/** Swap only the two entries selected by the current group, leaving other groups untouched. */
export function movePresentationItem<T extends { id: string }>(items: T[], id: string, direction: -1 | 1, groupIds: readonly string[]): T[] {
  const group = items.filter((item) => groupIds.includes(item.id));
  const position = group.findIndex((item) => item.id === id);
  const other = group[position + direction];
  if (position < 0 || !other) return items;
  const currentIndex = items.findIndex((item) => item.id === id);
  const otherIndex = items.findIndex((item) => item.id === other.id);
  const moved = [...items];
  [moved[currentIndex], moved[otherIndex]] = [moved[otherIndex]!, moved[currentIndex]!];
  return moved;
}

export function validPresentationPageSizes(pageSizes: SitePresentation["pageSizes"]): boolean {
  return Object.values(pageSizes).every(validPageSize);
}
function validPageSize(value: number): boolean { return Number.isInteger(value) && value >= 1 && value <= 40; }
const CONTENT_IDS = new Set(["selected", "all", "videos", "hot", "daily", "topics", "starred"]);

export function insertCustomColumn(presentation: SitePresentation, row: CustomNavigationEntry): SitePresentation {
  const navigation = [...presentation.navigation];
  let lastContent = -1;
  navigation.forEach((entry, index) => { if (isCustomNavigationEntry(entry) || CONTENT_IDS.has(entry.id)) lastContent = index; });
  navigation.splice(lastContent + 1, 0, row);
  return { ...presentation, navigation };
}

/** Generate the identity once when creating a draft; saves and retries reuse this row. */
export function newCustomColumn(presentation: SitePresentation, uuid = crypto.randomUUID()): CustomNavigationEntry {
  return { id: `custom-${uuid}`, visible: false, label: "", scope: "all", pageSize: presentation.pageSizes.all };
}

export function restorePresentationDefaults(settings: { presentation: SitePresentation; defaults: SitePresentation }): SitePresentation {
  let restored = structuredClone(settings.defaults);
  for (const row of settings.presentation.navigation) if (isCustomNavigationEntry(row)) restored = insertCustomColumn(restored, { ...row, visible: false });
  return restored;
}

export interface PresentationDraftError { id: string; field: "label" | "category" | "tag" | "pageSize"; message: string }
export function presentationDraftErrors(draft: SitePresentation): PresentationDraftError[] {
  const errors: PresentationDraftError[] = [];
  const invalidText = (value: string, max: number) => [...value.trim()].length > max || /[<>\u0000-\u001f\u007f]/u.test(value);
  for (const row of draft.navigation) {
    const custom = isCustomNavigationEntry(row);
    if ((custom && !row.label.trim()) || invalidText(row.label ?? "", 20)) errors.push({ id: row.id, field: "label", message: custom ? "名称必填，最多 20 字，不含特殊控制字符。" : "名称最多 20 字，不含特殊控制字符；留空使用默认名。" });
    if (!custom) continue;
    if (row.category && !isCategoryKey(row.category)) errors.push({ id: row.id, field: "category", message: `原分类 ${row.category} 已失效，请重新选择分类。` });
    if (row.tag && (invalidText(row.tag, 60) || row.tag.trim().startsWith("entity:"))) errors.push({ id: row.id, field: "tag", message: "标签最多 60 字，不能使用内部 entity: 标签。" });
    if (!validPageSize(row.pageSize)) errors.push({ id: row.id, field: "pageSize", message: "每页条数必须是 1–40 的整数。" });
  }
  for (const [id, value] of Object.entries(draft.pageSizes)) if (!validPageSize(value)) errors.push({ id, field: "pageSize", message: "默认列表数量必须是 1–40 的整数。" });
  return errors;
}
