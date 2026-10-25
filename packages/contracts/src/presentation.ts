import { CATEGORIES } from "@aihot/industry/taxonomy";

export const NAVIGATION_IDS = ["selected", "all", "videos", "hot", "daily", "topics", "starred", "leaderboard", "codexReset", "agent", "about", "changelog", "feedback"] as const;
export type NavigationId = typeof NAVIGATION_IDS[number];
export type CategoryId = typeof CATEGORIES[number]["key"];
export interface BuiltinNavigationEntry { id: NavigationId; visible: boolean; label?: string }
export interface CustomNavigationEntry {
  id: `custom-${string}`;
  visible: boolean;
  label: string;
  scope: "all" | "videos";
  /** Retained when an industry category is removed, so administrators can repair it. */
  category?: string;
  tag?: string;
  pageSize: number;
}
export type NavigationEntry = BuiltinNavigationEntry | CustomNavigationEntry;
export function isCustomNavigationEntry(row: NavigationEntry): row is CustomNavigationEntry {
  return row.id.startsWith("custom-");
}
export interface SitePresentation {
  navigation: NavigationEntry[];
  categories: Array<{ id: CategoryId; visible: boolean }>;
  pageSizes: { selected: number; all: number; videos: number };
}
export interface AdminPresentationSettings {
  presentation: SitePresentation;
  defaults: SitePresentation;
  updatedAt: string | null;
}

function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
function object(value: unknown, keys: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} must be an object`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) invalid(`${field} contains unknown fields`);
  return record;
}
function entries<T extends string>(value: unknown, ids: readonly T[], field: string): Array<{ id: T; visible: boolean }> {
  if (!Array.isArray(value)) invalid(`${field} must be an array`);
  const seen = new Set<string>();
  return value.map(item => {
    const row = object(item, ["id", "visible"], field);
    if (typeof row.id !== "string" || !ids.includes(row.id as T)) invalid(`${field}: unknown id`);
    if (seen.has(row.id)) invalid(`${field}: duplicate id`);
    seen.add(row.id);
    if (typeof row.visible !== "boolean") invalid(`${field}: visible must be boolean`);
    return { id: row.id as T, visible: row.visible };
  });
}
function text(value: unknown, max: number, field: string): string {
  if (typeof value !== "string") invalid(`${field} must be text`);
  const result = value.trim();
  if ([...result].length > max || /[<>\u0000-\u001f\u007f]/u.test(result)) invalid(`${field}: invalid text or length`);
  return result;
}
function navigationEntries(value: unknown): NavigationEntry[] {
  if (!Array.isArray(value)) invalid("navigation must be an array");
  const seen = new Set<string>();
  return value.map(item => {
    const custom = typeof item?.id === "string" && item.id.startsWith("custom-");
    const row = object(item, custom ? ["id", "visible", "label", "scope", "category", "tag", "pageSize"] : ["id", "visible", "label"], "navigation");
    if (typeof row.id !== "string" || (custom ? !/^custom-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id) : !NAVIGATION_IDS.includes(row.id as NavigationId))) invalid("navigation: unknown id");
    if (seen.has(row.id)) invalid("navigation: duplicate id");
    seen.add(row.id);
    if (typeof row.visible !== "boolean") invalid("navigation: visible must be boolean");
    const label = row.label === undefined ? "" : text(row.label, 20, "label");
    if (!custom) return { id: row.id as NavigationId, visible: row.visible, ...(label ? { label } : {}) };
    if (!label) invalid("自建栏目名称不能为空");
    if (row.scope !== "all" && row.scope !== "videos") invalid("invalid column scope");
    if (!Number.isInteger(row.pageSize) || Number(row.pageSize) < 1 || Number(row.pageSize) > 40) invalid("column pageSize must be an integer from 1 to 40");
    const category = row.category === undefined ? "" : text(row.category, 60, "category");
    if (category && !/^[a-z][a-z0-9_-]*$/.test(category)) invalid("invalid category key");
    const tag = row.tag === undefined ? "" : text(row.tag, 60, "tag");
    if (tag.startsWith("entity:")) invalid("内部 entity: 标签不可用于栏目");
    return { id: row.id as CustomNavigationEntry["id"], visible: row.visible, label, scope: row.scope, ...(category ? { category } : {}), ...(tag ? { tag } : {}), pageSize: Number(row.pageSize) };
  });
}
/** Validate untrusted admin input; no URLs or arbitrary component names are accepted. */
export function parsePresentation(value: unknown): SitePresentation {
  const input = object(value, ["navigation", "categories", "pageSizes"], "presentation");
  const navigation = navigationEntries(input.navigation);
  if (!navigation.some(row => row.id === "selected" && row.visible)) invalid("精选必须显示");
  const categories = entries(input.categories, CATEGORIES.map(row => row.key), "categories");
  const sizes = object(input.pageSizes, ["selected", "all", "videos"], "pageSizes");
  for (const key of ["selected", "all", "videos"] as const) {
    if (!Number.isInteger(sizes[key]) || Number(sizes[key]) < 1 || Number(sizes[key]) > 40) invalid(`${key}: page size must be an integer from 1 to 40`);
  }
  return { navigation, categories, pageSizes: { selected: Number(sizes.selected), all: Number(sizes.all), videos: Number(sizes.videos) } };
}
