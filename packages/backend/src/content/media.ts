import { parseHTML } from "linkedom";
import { sanitizeBody } from "./sanitize.ts";

interface MediaDimensions { width?: number | null; height?: number | null; alt?: string | null; poster?: string | null }
export type MediaItem = MediaDimensions & ({ kind: "image"; url: string } | { kind: "video"; url?: string; confirmed?: true });

export function mediaUrl(value: unknown, base?: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try { const u = new URL(value, base); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
}

export function confirmedVideoMedia(media: MediaItem[] = []): MediaItem[] {
  return media.some((m) => m.kind === "video")
    ? media.map((m) => m.kind === "video" ? { ...m, confirmed: true } : m)
    : [...media, { kind: "video", confirmed: true }];
}

/** Unknown input never deletes facts; URL-less video facts have a single slot. */
export function mergeMedia(existing: MediaItem[] | null | undefined, incoming: MediaItem[] | null | undefined): MediaItem[] {
  const out = (existing ?? []).map((m) => ({ ...m }));
  const hasImages = out.some((m) => m.kind === "image");
  for (const item of incoming ?? []) {
    const url = mediaUrl(item.url);
    if (item.kind === "image" && !url) continue;
    const normalized = { ...item, ...(url ? { url } : {}) } as MediaItem;
    if (normalized.kind === "video" && normalized.confirmed !== true) delete normalized.confirmed;
    if (!url) delete (normalized as { url?: string }).url;
    const found = out.find((m) => m.kind === item.kind && m.url === url);
    if (found) Object.assign(found, normalized);
    else if (item.kind !== "image" || !hasImages) out.push(normalized);
  }
  return out;
}

/** Only actual elements in the supplied article body; never links, code examples or players. */
export function videoMediaFromHtml(html: string, base: string): MediaItem[] {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  // Keep valid <source> evidence on its own video before the existing sanitizer drops sources.
  // This is a local inspection copy: it never changes stored or publicly rendered HTML.
  for (const video of document.querySelectorAll("video")) {
    const source = [...video.querySelectorAll("source")].find((s) =>
      /^video\//i.test(s.getAttribute("type") ?? "") && mediaUrl(s.getAttribute("src"), base));
    const url = mediaUrl(video.getAttribute("src"), base) ?? mediaUrl(source?.getAttribute("src"), base);
    if (url) video.setAttribute("src", url);
  }
  for (const example of document.querySelectorAll("pre,code")) example.remove();
  // Reuse body ownership rules (promo blocks and whole discarded subtrees), not a parallel list.
  const cleaned = parseHTML(`<html><body>${sanitizeBody(document.body.innerHTML, base)}</body></html>`).document;
  return [...cleaned.querySelectorAll("video")].some((video) => mediaUrl(video.getAttribute("src"), base))
    ? confirmedVideoMedia() : [];
}
