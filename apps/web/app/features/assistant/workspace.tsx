import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Link,
  useLocation,
  useNavigation,
  useRouteLoaderData,
} from "react-router";
import type { SitePresentation } from "@aihot/contracts/presentation";
import type { AssistantId } from "@aihot/contracts/assistant";
import { SITE } from "@aihot/industry/site";
import { Wordmark } from "../../components/Logo";
import {
  IconApps,
  IconChevronDown,
  IconClose,
  IconMenu,
  IconMessage,
  IconPlus,
} from "../../components/icons";
import { ThemeSwitch } from "../../components/shell/ThemeSwitch";
import { AccountLink } from "../../components/shell/AccountLink";
import { NavigationProgress } from "../../components/shell/Chrome";
import { sidebarGroups } from "../../components/shell/nav";
import { DEFAULT_SITE_PRESENTATION } from "../../lib/presentation";
import { assistantHref, type SessionPage } from "./data";
import { AssistantHistory } from "./history";

export function AssistantRouteFrame({ children }: { children: ReactNode }) {
  const navigation = useNavigation();
  return (
    <div className="assistant-route-frame">
      <NavigationProgress active={navigation.state === "loading"} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:bg-surface focus:p-3"
      >
        跳到对话
      </a>
      {children}
    </div>
  );
}

export function AssistantWorkspace({
  assistantId = "creative",
  history,
  title,
  subtitle,
  controls,
  chat,
  artifacts,
  artifactCount = 0,
  view = "chat",
  setView,
  artifactOpen = true,
  setArtifactOpen,
}: {
  assistantId?: AssistantId;
  history?: SessionPage;
  title: string;
  subtitle?: string;
  controls?: ReactNode;
  chat: ReactNode;
  artifacts?: ReactNode;
  artifactCount?: number;
  view?: "chat" | "artifacts";
  setView?: (view: "chat" | "artifacts") => void;
  artifactOpen?: boolean;
  setArtifactOpen?: (open: boolean) => void;
}) {
  const root = useRouteLoaderData("root") as
    | { presentation?: SitePresentation }
    | undefined;
  const presentation = root?.presentation ?? DEFAULT_SITE_PRESENTATION;
  const [drawer, setDrawer] = useState(false);
  const [wide, setWide] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const side = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const query = matchMedia("(min-width: 1280px) and (min-height: 560px)");
    const sync = () => {
      setWide(query.matches);
      setDrawer(false);
    };
    sync();
    query.addEventListener("change", sync);
    try {
      setSiteOpen(localStorage.getItem("assistant-site-navigation") === "open");
    } catch {
      /* Layout preference is optional. */
    }
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);
  useEffect(() => {
    if (!drawer || wide) return;
    const previous = document.activeElement as HTMLElement | null;
    side.current?.querySelector<HTMLElement>("button, a, select")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawer(false);
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(
        side.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), select:not([disabled])",
        ) ?? [],
      ).filter((el) => el.getClientRects().length);
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
      else trigger.current?.focus();
    };
  }, [drawer, wide]);
  const visible = wide ? !collapsed : drawer;
  return (
    <div
      className="assistant-workspace"
      data-sidebar={visible ? "open" : "closed"}
      data-artifacts={artifactCount && artifactOpen ? "open" : "closed"}
      data-view={view}
    >
      {drawer && !wide && (
        <button
          className="assistant-drawer-backdrop"
          aria-label="关闭导航"
          tabIndex={-1}
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        ref={side}
        className="assistant-sidebar"
        aria-label="助手与网站导航"
        role={drawer && !wide ? "dialog" : undefined}
        aria-modal={drawer && !wide ? true : undefined}
        inert={!visible}
      >
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/"
            aria-label={`${SITE.name} 首页`}
            className="py-2 text-ink"
          >
            <Wordmark size={23} />
          </Link>
          <button
            className="assistant-icon-button"
            aria-label="收起导航"
            onClick={() => (wide ? setCollapsed(true) : setDrawer(false))}
          >
            <IconClose size={18} />
          </button>
        </div>
        <button
          className="assistant-site-toggle"
          aria-expanded={siteOpen}
          onClick={() => {
            const open = !siteOpen;
            setSiteOpen(open);
            try {
              localStorage.setItem(
                "assistant-site-navigation",
                open ? "open" : "closed",
              );
            } catch {
              /* Optional layout preference. */
            }
          }}
        >
          <span>网站导航</span>
          <IconChevronDown size={15} />
        </button>
        <nav
          className="assistant-site-navigation"
          aria-label="网站导航"
          hidden={!siteOpen}
        >
          {sidebarGroups(presentation).map((group) => (
            <div key={group.title}>
              <p className="px-2 py-1 text-[11px] text-ink-4">{group.title}</p>
              {group.items.map((item) => (
                <Link key={item.to} to={item.to} className="assistant-nav-link">
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
          <Link to="/tools" className="assistant-nav-link">
            <IconApps size={16} />
            数据工具
          </Link>
        </nav>
        <div className="mt-2 border-t border-line pt-3">
          <p className="mb-2 flex items-center gap-2 px-2 text-[12px] font-semibold text-accent">
            <IconMessage size={17} />
            助手
          </p>
          <Link
            to={assistantHref(assistantId)}
            className="assistant-new-conversation flex items-center gap-2"
          >
            <IconPlus size={16} />
            新对话
          </Link>
          <nav aria-label="选择助手">
            {(
              [
                ["creative", "创作助手"],
                ["xiaohongshu", "小红书助手"],
              ] as const
            ).map(([id, name]) => (
              <Link
                key={id}
                to={assistantHref(id)}
                className={`assistant-nav-link ${assistantId === id ? "bg-accent-soft font-medium text-accent" : ""}`}
                aria-current={
                  pathname === assistantHref(id) ? "page" : undefined
                }
              >
                {name}
              </Link>
            ))}
          </nav>
        </div>
        {history ? (
          <AssistantHistory initialPage={history} />
        ) : (
          <div className="flex-1" />
        )}
        <div className="assistant-account">
          <AccountLink className="rounded-control px-2 py-2 hover:bg-bg-sunk" />
          <Link
            to="/account"
            className="block px-2 py-1 text-[12px] text-accent"
          >
            账户与积分
          </Link>
          <ThemeSwitch className="mt-2" />
        </div>
      </aside>
      <main id="main" className="assistant-main" inert={drawer && !wide}>
        <header className="assistant-workspace-header">
          <button
            ref={trigger}
            className="assistant-icon-button"
            aria-label="打开助手导航"
            aria-expanded={visible}
            onClick={() =>
              wide ? setCollapsed((old) => !old) : setDrawer(true)
            }
          >
            <IconMenu size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-[15px] font-semibold text-ink"
              title={title}
            >
              {title}
            </h1>
            {subtitle && (
              <p className="truncate text-[11px] text-ink-4">{subtitle}</p>
            )}
          </div>
          {controls}
          {!!artifactCount && (
            <button
              className="assistant-panel-toggle"
              aria-pressed={artifactOpen}
              onClick={() => {
                setArtifactOpen?.(!artifactOpen);
                setView?.(view === "artifacts" ? "chat" : "artifacts");
              }}
            >
              作品 {artifactCount}
            </button>
          )}
        </header>
        {!!artifactCount && (
          <div
            className="assistant-view-tabs"
            role="tablist"
            aria-label="工作区视图"
          >
            <button
              role="tab"
              aria-selected={view === "chat"}
              onClick={() => setView?.("chat")}
            >
              对话
            </button>
            <button
              role="tab"
              aria-selected={view === "artifacts"}
              onClick={() => setView?.("artifacts")}
            >
              作品 {artifactCount}
            </button>
          </div>
        )}
        <div className="assistant-panels">
          <section className="assistant-chat-panel" aria-label="创作对话">
            {chat}
          </section>
          {artifacts && (
            <aside className="assistant-artifact-panel" aria-label="会话作品">
              {artifacts}
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
