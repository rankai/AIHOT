import { DEFAULT_PRESENTATION } from "@aihot/industry/presentation";
import type { NavigationId, SitePresentation } from "@aihot/contracts/presentation";

/** Browser-safe fallback copied from the industry's sole default configuration. */
export const DEFAULT_SITE_PRESENTATION: SitePresentation = {
  navigation: DEFAULT_PRESENTATION.navigation.map((item) => ({ ...item })),
  categories: DEFAULT_PRESENTATION.categories.map((item) => ({ ...item })),
  pageSizes: { ...DEFAULT_PRESENTATION.pageSizes },
};

/** An optional name override never changes the identity or default wording of a surface. */
export function navigationLabel(presentation: SitePresentation | undefined, id: NavigationId, fallback: string): string {
  return presentation?.navigation.find((row) => row.id === id)?.label?.trim() || fallback;
}

export function presentationFromMatches(matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined> = []): SitePresentation | undefined {
  const root = matches.find((match) => match?.id === "root")?.loaderData;
  return root && typeof root === "object" && "presentation" in root ? root.presentation as SitePresentation : undefined;
}
