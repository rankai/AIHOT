// Route and icon metadata stay here; editable visibility and order come from site presentation.
import { SITE, withSubject } from "@aihot/industry/site";
import { FEATURES } from "@aihot/industry/features";
import { DEFAULT_SITE_PRESENTATION as DEFAULT_PRESENTATION } from "../../lib/presentation";
import { isCustomNavigationEntry, type NavigationEntry, type NavigationId, type SitePresentation } from "@aihot/contracts/presentation";
import type { ReactNode } from "react";
import {
  IconApps, IconBolt, IconBookmark, IconChart, IconDoc, IconFlame, IconGrid, IconHeart, IconHistory, IconList, IconMessage, IconMonitor, IconPlug,
} from "../icons";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  end?: boolean;
  changelog?: boolean;
}

type NavigationMeta = NavItem & { group: "内容" | "模型" | "更多"; moreGroup: "内容" | "偏好" | "关于"; moreLabel?: string; mobileLabel?: string };
export const NAV_ITEMS: Record<NavigationId, NavigationMeta> = {
  selected: { to: "/", label: "精选", icon: IconBolt, end: true, group: "内容", moreGroup: "内容" },
  all: { to: "/all", label: `全部${withSubject("动态")}`, mobileLabel: "全部", icon: IconList, group: "内容", moreGroup: "内容" },
  videos: { to: "/videos", label: "视频", icon: IconMonitor, group: "内容", moreGroup: "内容" },
  hot: { to: "/hot", label: "热点榜", icon: IconFlame, group: "内容", moreGroup: "偏好" },
  daily: { to: "/daily", label: withSubject("日报"), mobileLabel: "日报", icon: IconDoc, group: "内容", moreGroup: "内容" },
  topics: { to: "/topics", label: "主题", moreLabel: "主题索引", icon: IconGrid, group: "内容", moreGroup: "内容" },
  starred: { to: "/starred", label: "收藏", icon: IconBookmark, group: "内容", moreGroup: "偏好" },
  leaderboard: { to: "/leaderboard", label: "模型榜", icon: IconChart, group: "模型", moreGroup: "内容" },
  codexReset: { to: "/codex-reset", label: "Tibo重置监控", icon: IconHistory, group: "模型", moreGroup: "内容" },
  agent: { to: "/agent", label: "Agent 接入", icon: IconPlug, group: "更多", moreGroup: "内容" },
  about: { to: "/about", label: "关于", moreLabel: `关于 ${SITE.name}`, icon: IconHeart, group: "更多", moreGroup: "关于" },
  changelog: { to: "/changelog", label: "更新日志", icon: IconHistory, changelog: true, group: "更多", moreGroup: "关于" },
  feedback: { to: "/feedback", label: "反馈", moreLabel: "意见反馈", icon: IconMessage, group: "更多", moreGroup: "关于" },
};

export const NAV_GROUPS = ["内容", "模型", "更多"] as const;

export function navigationUnavailable(id: NavigationEntry["id"], features: { leaderboard: boolean; codexResetMonitor: boolean } = FEATURES): string | null {
  if (id === "leaderboard" && !features.leaderboard) return "行业配置已关闭模型榜";
  if (id === "codexReset" && !features.codexResetMonitor) return "行业配置已关闭重置监控";
  return null;
}

export function navigationItem(entry: NavigationEntry, surface: "desktop" | "mobile" | "more" = "desktop"): NavigationMeta {
  if (isCustomNavigationEntry(entry)) return { to: `/columns/${entry.id}`, label: entry.label, icon: IconList, group: "内容", moreGroup: "内容" };
  const item = NAV_ITEMS[entry.id];
  const fallback = surface === "mobile" ? item.mobileLabel : surface === "more" ? item.moreLabel : undefined;
  return { ...item, label: entry.label?.trim() || fallback || item.label };
}

function visibleNavigation(presentation: SitePresentation) {
  return presentation.navigation.filter((item) => (item.id === "selected" || item.visible) && !navigationUnavailable(item.id));
}

export function sidebarGroups(presentation: SitePresentation = DEFAULT_PRESENTATION) {
  const visible = visibleNavigation(presentation).map((entry) => navigationItem(entry));
  return NAV_GROUPS.map((title) => ({ title, items: visible.filter((item) => item.group === title) })).filter((group) => group.items.length > 0);
}

export function mobileTabs(presentation: SitePresentation = DEFAULT_PRESENTATION): NavItem[] {
  return [
    ...visibleNavigation(presentation).filter(({ id }) => id === "selected" || id === "all" || id === "daily").map((entry) => navigationItem(entry, "mobile")),
    { to: "/more", label: "更多", icon: IconApps, changelog: true },
  ];
}

export function moreGroups(presentation: SitePresentation = DEFAULT_PRESENTATION) {
  const tabs = new Set(mobileTabs(presentation).map((item) => item.to));
  const visible = visibleNavigation(presentation).map((entry) => navigationItem(entry, "more")).filter((item) => !tabs.has(item.to));
  return (["内容", "偏好", "关于"] as const).map((title) => ({ title, items: visible.filter((item) => item.moreGroup === title) })).filter((group) => group.items.length > 0 || group.title === "偏好");
}

/** Match the actual visible tabs, so a hidden /all or report link belongs to 更多. */
export function tabIsActive(item: NavItem, pathname: string, tabs: NavItem[] = []): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/more") return !tabs.some((tab) => tab.to !== "/more" && tabIsActive(tab, pathname));
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
