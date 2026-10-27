import { Link, useLocation } from "react-router";
import { mobileTabs, tabIsActive } from "./nav";
import type { SitePresentation } from "@aihot/contracts/presentation";
import { useChangelogDot } from "./Sidebar";

/** Bottom tab bar of the mobile shell (up to 960px), as on the original site. */
export function MobileTabBar({ changelogVersion, presentation }: { changelogVersion: string | null; presentation: SitePresentation }) {
  const { pathname } = useLocation();
  const dot = useChangelogDot(changelogVersion);
  const tabs = mobileTabs(presentation);
  return (
    <nav aria-label="底部导航" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="mx-auto grid h-[54px] max-w-[640px]" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const active = tabIsActive(t, pathname, tabs);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              prefetch="intent"
              aria-current={active ? "page" : undefined}
              className={`relative flex min-w-0 flex-col items-center justify-center gap-[3px] px-1 text-[11px] transition-colors ${active ? "font-semibold text-accent" : "text-ink-3 active:text-ink"}`}
            >
              <Icon size={21} />
              <span className="max-w-full truncate" title={t.label}>{t.label}</span>
              {dot && t.changelog && <span className="absolute right-[calc(50%-17px)] top-2 size-1.5 rounded-full bg-hot" aria-label="有新的更新" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
