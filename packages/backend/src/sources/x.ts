// X accounts via SocialData search ("from:handle -filter:replies", newest first). Plain account queries
// are read together, about two dozen accounts per search (planXShards); SocialData bills per request.
import { tweetMedia, tweetText, type SdArticle, type SdTweet } from "../providers/socialdata.ts";
import { confirmedVideoMedia, mergeMedia } from "../content/media.ts";
import type { XPostData } from "../content/materials.ts";
import { sha256 } from "../lib/ids.ts";
import { type Candidate, type SourceRow } from "./types.ts";

function avatar(url: string | undefined): string | null {
  // Larger avatar than the default 48px thumbnail.
  return url ? url.replace("_normal.", "_bigger.") : null;
}

export function toXPost(t: SdTweet): XPostData {
  const q = t.quoted_status ?? null;
  return {
    tweetId: t.id_str,
    authorName: t.user.name,
    handle: t.user.screen_name,
    avatarUrl: avatar(t.user.profile_image_url_https),
    text: tweetText(t),
    lang: t.lang ?? null,
    replyTo: t.in_reply_to_status_id_str ?? null,
    media: tweetMedia(t),
    quoted: q
      ? { authorName: q.user.name, handle: q.user.screen_name, text: tweetText(q), url: `https://x.com/${q.user.screen_name}/status/${q.id_str}`, media: tweetMedia(q) }
      : null,
  };
}

const X_ARTICLE_LINK = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\/\d+/gi;

/** The post links an X Article (long-form text posted on X): its body is fetched before judging. */
export function linksXArticle(text: string | null | undefined): boolean {
  return new RegExp(X_ARTICLE_LINK.source, "i").test(text ?? "");
}

/** Nothing but the article's link: without the article there is nothing to judge (under 30 characters left). */
export function onlyXArticleLink(text: string | null | undefined): boolean {
  return linksXArticle(text) && (text ?? "").replace(X_ARTICLE_LINK, "").trim().length < 30;
}

/** An X Article as plain text with Markdown-like headings, quotes and list marks; media blocks are left out. */
export function xArticleText(article: SdArticle): { title: string; text: string } | null {
  const lines: string[] = [];
  for (const b of article.content_state?.blocks ?? []) {
    const text = (b.text ?? "").trim();
    if (!text || b.type === "atomic") continue;
    const mark = { "header-one": "# ", "header-two": "## ", "header-three": "### ", blockquote: "> ", "unordered-list-item": "- ", "ordered-list-item": "1. " }[b.type ?? ""] ?? "";
    lines.push(mark + text);
  }
  const text = lines.join("\n\n").trim();
  return text ? { title: (article.title ?? "").trim(), text } : null;
}

export function tweetToCandidate(t: SdTweet): Candidate {
  const candidate = xPostToCandidate(toXPost(t), new Date(t.tweet_created_at), { favorite: t.favorite_count ?? null, retweet: t.retweet_count ?? null, views: t.views_count ?? null });
  const own = t.extended_entities?.media ?? t.entities?.media ?? [];
  candidate.media = (candidate.media ?? []).map((m, i) => own[i]?.type === "video" && m.kind === "video" ? { ...m, confirmed: true } : m);
  const q = t.quoted_status;
  if (t.is_quote_status === true && q && /^\d+$/.test(q.id_str) && q.id_str !== t.id_str
    && /^[A-Za-z0-9_]{1,15}$/.test(q.user?.screen_name ?? "")
    && (!t.quoted_status_id_str || t.quoted_status_id_str === q.id_str)
    && (q.extended_entities?.media ?? q.entities?.media ?? []).some((m) => m.type === "video")) {
    candidate.media = mergeMedia(candidate.media, confirmedVideoMedia());
  }
  return candidate;
}

/** Canonical X material projection; provider adapters supply already verified post facts. */
export function xPostToCandidate(post: XPostData, publishedAt: Date | null, metrics: Record<string, unknown> = {}): Candidate {
  const firstLine = post.text.split("\n").find((l) => l.trim()) ?? post.text;
  return {
    url: `https://x.com/${post.handle}/status/${post.tweetId}`,
    identityKey: `x:${post.tweetId}`,
    title: firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine,
    author: post.handle,
    language: post.lang ?? null,
    publishedAt,
    bodyText: [post.text, post.quoted ? `\n\n【引用 @${post.quoted.handle}】${post.quoted.text}` : ""].join("").trim(),
    // A linked X Article is the post's real body: extraction fetches it (jobs/content.ts route).
    bodyStatus: linksXArticle(post.text) ? "pending" : "ok",
    xPost: post,
    media: post.media ?? [],
    raw: metrics,
  };
}

/** Frozen continuation of a bounded newest-first search. */
export interface XBacklog { query: string; next: string }

// --- Shards: plain account queries read together ------------------------------------------------

/** A query that can share a search: exactly "from:handle -filter:replies", newest first. */
const SHARDABLE = /^from:([A-Za-z0-9_]{1,15}) -filter:replies$/i;
/** The same test in SQL, for the schedulers. */
export const SHARDABLE_SQL = "^from:[A-Za-z0-9_]{1,15} -filter:replies$";
/** SocialData refuses queries over 512 characters; the since_id watermark takes about 30 of them. */
const SHARD_QUERY_MAX = 470;
const SHARD_MAX_ACCOUNTS = 24;

/** The account a source reads, when it can share a search: a plain query and a watermark already set. */
export function shardHandle(s: Pick<SourceRow, "kind" | "config" | "cursor">): string | null {
  if (s.kind !== "x_search" || (s.config.searchType ?? "Latest") !== "Latest" || !s.cursor?.lastTweetId) return null;
  return SHARDABLE.exec(String(s.config.query ?? ""))?.[1] ?? null;
}

export function shardQuery(handles: string[]): string {
  return `(${handles.map((h) => `from:${h}`).join(" OR ")}) -filter:replies`;
}

export interface XShard {
  key: string;
  mode: string;
  sourceIds: string[];
}

/**
 * Accounts that can share a search, per participation mode, in a stable order (by source id) and
 * packed into queries under the length limit. The same sources give the same shards, so a shard's
 * accounts stay together between runs; a source added or removed shifts only the shards after it.
 */
export function planXShards(sources: Array<Pick<SourceRow, "id" | "kind" | "config" | "cursor" | "participation_mode">>): XShard[] {
  const byMode = new Map<string, Array<{ id: string; handle: string }>>();
  for (const s of sources) {
    const handle = shardHandle(s);
    if (handle) byMode.set(s.participation_mode, [...(byMode.get(s.participation_mode) ?? []), { id: s.id, handle }]);
  }
  const shards: XShard[] = [];
  for (const [mode, list] of [...byMode].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let current: typeof list = [];
    const close = () => {
      if (current.length) shards.push({ mode, sourceIds: current.map((c) => c.id), key: `${mode}:${sha256(current.map((c) => c.id).join(",")).slice(0, 12)}` });
      current = [];
    };
    for (const s of list) {
      if (current.length >= SHARD_MAX_ACCOUNTS || shardQuery([...current, s].map((c) => c.handle)).length > SHARD_QUERY_MAX) close();
      current.push(s);
    }
    close();
  }
  return shards;
}

/** Last successful check also bounds quiet accounts; allow ten minutes for search indexing lag. */
export function coveredTo(source: Pick<SourceRow, "cursor">): bigint {
  const own = BigInt(source.cursor!.lastTweetId);
  const checked = Date.parse(String(source.cursor?.lastOkAt ?? ""));
  if (!Number.isFinite(checked)) return own;
  const byTime = BigInt(Math.max(0, checked - 10 * 60_000 - 1288834974657)) << 22n;
  return byTime > own ? byTime : own;
}

/** Whether a linked X Article is required before processing this source’s post. */
export function needsXArticleExtraction(kind: string, mode: string, historical: boolean) {
  return kind === "x_search" && (mode === "editorial" || (mode === "hot_signal" && !historical));
}
