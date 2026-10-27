import { DEFAULT_PRESENTATION } from "@aihot/industry/presentation";
import { FEATURES } from "@aihot/industry/features";
import { isCustomNavigationEntry, parsePresentation, type AdminPresentationSettings, type SitePresentation } from "@aihot/contracts/presentation";
import { isCategoryKey } from "@aihot/contracts/taxonomy";
import { sql } from "../db.ts";
import { audit } from "./auth.ts";

/** Reconcile persisted IDs after industry upgrades, preserving current order and adding new defaults. */
export function normalizePresentation(value: unknown, features: { leaderboard: boolean; codexResetMonitor: boolean } = FEATURES): SitePresentation {
  const stored = value as Partial<SitePresentation> | null;
  function reconcile<T extends string>(defaults: readonly { id: T; visible: boolean }[], rows: unknown, navigation = false) {
    if (!Array.isArray(rows)) throw new Error("Invalid stored presentation entries");
    const known = new Set(defaults.map(row => row.id));
    const result: Array<{ id: T; visible: boolean }> = [];
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || typeof row.visible !== "boolean") throw new Error("Invalid stored presentation entry");
      if (known.has(row.id) || (navigation && row.id.startsWith("custom-"))) {
        if (result.some(entry => entry.id === row.id)) throw new Error("Duplicate stored presentation ID");
        result.push(navigation ? { ...row } : { id: row.id, visible: row.visible });
      }
    }
    for (const row of defaults) if (!result.some(entry => entry.id === row.id)) result.push({ ...row });
    return result;
  }
  const input = stored ?? DEFAULT_PRESENTATION;
  const normalized = parsePresentation({
    navigation: reconcile(DEFAULT_PRESENTATION.navigation, input.navigation, true).map(row => ({ ...row, visible: row.id === "selected" ? true : row.visible })),
    categories: reconcile(DEFAULT_PRESENTATION.categories, input.categories),
    pageSizes: input.pageSizes,
  });
  normalized.navigation = normalized.navigation.map(row => ({ ...row, visible: row.visible && (row.id !== "leaderboard" || features.leaderboard) && (row.id !== "codexReset" || features.codexResetMonitor) }));
  return normalized;
}

export async function loadPresentationSettings(): Promise<AdminPresentationSettings> {
  const [row] = await sql`SELECT value, updated_at FROM settings WHERE key = 'site_presentation'`;
  if (row && (!row.value || typeof row.value !== "object" || Array.isArray(row.value))) throw new Error("Invalid stored presentation");
  return { presentation: normalizePresentation(row?.value), defaults: normalizePresentation(null), updatedAt: row ? new Date(row.updated_at).toISOString() : null };
}

/** Public shell may degrade to static defaults; admin reads deliberately propagate failures. */
export async function loadPublicPresentation(): Promise<SitePresentation> {
  try { return (await loadPresentationSettings()).presentation; }
  catch { return normalizePresentation(null); }
}

export async function savePresentation(input: unknown, actor: string): Promise<AdminPresentationSettings> {
  const presentation = normalizePresentation(parsePresentation(input));
  for (const row of presentation.navigation) {
    if (isCustomNavigationEntry(row) && row.category && !isCategoryKey(row.category)) {
      throw Object.assign(new Error(`栏目 ${row.label} 引用的分类已失效，请重新选择分类`), { statusCode: 400 });
    }
  }
  return await sql.begin(async tx => {
    // Also serialize the first insert, so the audited before value belongs to this exact save.
    await tx`SELECT pg_advisory_xact_lock(hashtext('settings:site_presentation'))`;
    const [before] = await tx`SELECT value FROM settings WHERE key = 'site_presentation' FOR UPDATE`;
    const previousRows = before?.value?.navigation;
    if (Array.isArray(previousRows) && previousRows.some(row => typeof row?.id === "string" && row.id.startsWith("custom-") && !presentation.navigation.some(entry => entry.id === row.id))) {
      throw Object.assign(new Error("已有自建栏目不能删除，请刷新后重试"), { code: "conflict" });
    }
    const [after] = await tx`INSERT INTO settings (key, value, updated_by) VALUES ('site_presentation', ${tx.json(presentation as never)}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp()
      RETURNING updated_at`;
    await audit(actor, "settings.site_presentation", "settings:site_presentation", null, before?.value ?? null, presentation, undefined, tx);
    return { presentation, defaults: normalizePresentation(null), updatedAt: new Date(after!.updated_at).toISOString() };
  });
}
