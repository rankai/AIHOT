// One report in a feed. Desktop (≥ 961px): a white card beside the time rail. Mobile: a compact row
// with a divider, the reason in a grey box. One markup, two presentations, as on the original site.
import { memo } from "react";
import { Link } from "react-router";
import { IntentLink } from "../../components/ui/IntentLink";
import type { GroupInfo, FeedItemSummary, TimelineFilters } from "@aihot/contracts/site";
import { CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { SelectedBadge } from "../../components/ui/Badge";
import { ScoreLabel } from "../../components/ui/Score";
import { MediaThumbs, SourceLine, StarButton } from "./parts";
import { GroupDevelopments, GroupSources, LatestDevelopment } from "./ReadingGroup";
import { VideoPoster } from "./VideoPoster";
import { IconMonitor } from "../../components/icons";
import { QuotedLine } from "../item/QuotedPost";

export interface FeedItemProps {
  linkBase?: "/all" | "/videos";
  listPageSize?: number;
  item: FeedItemSummary;
  group?: GroupInfo | null;
  filters?: TimelineFilters;
  read?: boolean;
  onOpen?: (id: string) => void;
  /** Show category and tags under the text (全部动态, topics, search). */
  showTags?: boolean;
}

export const FeedItem = memo(function FeedItem({ item, group, filters, read = false, onOpen, showTags = false, linkBase = "/all", listPageSize }: FeedItemProps) {
  const isX = item.channel === "x" && !!item.x;
  const open = () => onOpen?.(item.id);
  const showSources = !!group && (group.additionalSourceCount > 0 || (group.developmentCount <= 1 && group.reportCount > 1));
  const showDevelopments = !!group?.story && group.developmentCount > 1;
  const tags = showTags ? item.tags.slice(0, 3) : [];
  const filterHref = (key: "category" | "tag", value: string) => {
    if (listPageSize === undefined) return `${linkBase}?${key}=${encodeURIComponent(value)}`;
    const params = new URLSearchParams({ [key]: value, pageSize: String(listPageSize) });
    return `${linkBase}?${params}`;
  };

  return (
    <article className="relative min-w-0 lg:card lg:card-hover lg:px-[18px] lg:pb-[14px] lg:pt-[15px]" data-item-id={item.id}>
      <header className="flex min-h-[18px] items-center gap-2 text-[12.5px] leading-[18px] text-ink-4">
        <SourceLine item={item} className="text-ink-4" />
        {item.video && <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-3"><IconMonitor size={12} />视频</span>}
        {item.selected && (
          <span className="hidden lg:inline-flex">
            <SelectedBadge />
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          <span className="hidden lg:inline-flex">
            <ScoreLabel score={item.score} />
          </span>
          <span className="lg:hidden">
            <ScoreLabel score={item.score} compact />
          </span>
          <span className="-my-1 hidden lg:inline-flex">
            <StarButton item={item} />
          </span>
        </span>
      </header>

      {isX ? (
        <p className={`mt-2 whitespace-pre-line text-[15px] leading-[1.75] line-clamp-5 lg:line-clamp-4 ${read ? "text-ink-4" : "text-ink"}`}>
          <IntentLink to={`/items/${item.id}`} onClick={open} className="after:absolute after:inset-0 after:content-['']">
            {item.summary ?? item.title}
          </IntentLink>
        </p>
      ) : (
        <>
          <h3 className={`mt-2 line-clamp-2 text-[17px] font-bold leading-[1.55] lg:line-clamp-none lg:font-[650] ${read ? "text-ink-4" : "text-ink"}`}>
            <IntentLink to={`/items/${item.id}`} onClick={open} className="after:absolute after:inset-0 after:content-['']">
              {item.title}
            </IntentLink>
          </h3>
          {item.summary && <p className="mt-1.5 line-clamp-2 text-[14.5px] leading-[1.75] text-ink-3 lg:mt-2 lg:line-clamp-3 lg:text-[15px]">{item.summary}</p>}
        </>
      )}

      {item.video && !(isX && item.x!.media.length > 0) && <IntentLink to={`/items/${item.id}`} onClick={open} aria-label={`查看视频详情：${item.title}`} className="relative z-10 mt-2.5 block w-[200px] max-w-full"><VideoPoster key={item.video.poster ?? "placeholder"} video={item.video} /></IntentLink>}
      {isX && item.x!.media.length > 0 && <MediaThumbs media={item.x!.media} className="mt-2.5" />}
      {isX && item.x!.quoted?.text && <QuotedLine quoted={item.x!.quoted} />}

      {(tags.length > 0 || (showTags && item.category)) && (
        <div className="relative z-10 mt-2 hidden flex-wrap gap-x-2.5 gap-y-1 text-[12px] text-ink-4 lg:flex">
          {showTags && item.category && (
            <Link to={filterHref("category", item.category)} className="hover:text-accent">
              {CATEGORY_LABELS[item.category]}
            </Link>
          )}
          {tags.map((t) => (
            <Link key={t} to={filterHref("tag", t)} className="hover:text-accent">
              #{t}
            </Link>
          ))}
        </div>
      )}

      {group && <LatestDevelopment group={group} />}
      {(showSources || showDevelopments) && (
        <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-1">
          {showSources && <GroupSources group={group!} filters={filters} parentId={item.id} />}
          {showDevelopments && <GroupDevelopments group={{ ...group!, story: group!.story! }} filters={filters} parentId={item.id} />}
        </div>
      )}

      {item.reason && (
        <div className="mt-2.5 rounded-control bg-bg-sunk px-3 py-2 dark:bg-bg-muted/60 lg:mt-3 lg:rounded-none lg:border-t lg:border-line-soft lg:bg-transparent lg:px-0 lg:pb-0 lg:pt-3 lg:dark:bg-transparent">
          <p className="line-clamp-2 text-[13px] leading-[1.65] text-ink-3 lg:line-clamp-none lg:leading-[1.75] lg:text-note">推荐理由：{item.reason}</p>
        </div>
      )}
    </article>
  );
});
