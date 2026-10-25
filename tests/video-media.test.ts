import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedVideoMedia, mergeMedia, videoMediaFromHtml } from "../packages/backend/src/content/media.ts";
import { feedVideoMedia } from "../packages/backend/src/sources/rss.ts";
import { readable } from "../packages/backend/src/content/extract.ts";
import { tweetToCandidate } from "../packages/backend/src/sources/x.ts";
import type { SdTweet } from "../packages/backend/src/providers/socialdata.ts";

test("confirmed video merge keeps images, unknown and repeated facts are non-destructive", () => {
  const original = [{ kind: "image" as const, url: "https://example.com/p.jpg" }];
  const merged = mergeMedia(original, confirmedVideoMedia());
  assert.deepEqual(mergeMedia(merged, confirmedVideoMedia()), merged);
  assert.deepEqual(mergeMedia(merged, []), merged);
  assert.deepEqual(confirmedVideoMedia([{ kind: "video", url: "https://example.com/v" }]), [{ kind: "video", url: "https://example.com/v", confirmed: true }]);
  assert.equal(mergeMedia([], [{ kind: "image", url: "javascript:bad" }]).length, 0);
});

test("body video facts require actual elements with valid sources, excluding examples and players", () => {
  for (const html of ['<video src="/clip.mp4"></video>', '<video><source type="video/mp4" src="https://example.com/clip"></video>']) {
    assert.deepEqual(videoMediaFromHtml(html, "https://example.com"), confirmedVideoMedia());
  }
  for (const html of ['<a href="x.mp4">video</a>', '<iframe src="x.mp4"></iframe>', '<pre><video src="/v"></video></pre>', '&lt;video src="/v"&gt;', '<video src="javascript:bad"></video>', '<video><source src="/v"></video>', '<video><source type="audio/mp3" src="/v"></video>', '<video src="https://user:pass@example.com/v"></video>']) {
    assert.deepEqual(videoMediaFromHtml(html, "https://example.com"), []);
  }
});

test("RSS and Atom contracts confirm only entry-local video attachments", () => {
  assert.equal(feedVideoMedia({ enclosure: { "@type": "video/mp4", "@url": "/v" } }, "https://example.com").length, 1);
  assert.equal(feedVideoMedia({ link: [{ "@rel": "enclosure", "@type": "video/webm", "@href": "/v" }] }, "https://example.com", "", true).length, 1);
  assert.equal(feedVideoMedia({ "media:group": { "media:content": [{ "@medium": "image", "@url": "/i" }, { "@medium": "video", "@url": "/v" }] } }, "https://example.com").length, 1);
  assert.equal(feedVideoMedia({ enclosure: { "@type": "image/jpeg", "@url": "/v.mp4" } }, "https://example.com").length, 0);
});

const tweet = (type: "video" | "animated_gif" = "video"): SdTweet => ({ id_str: "123", tweet_created_at: "2026-10-24", user: { name: "A", screen_name: "a" }, text: "post", extended_entities: { media: [{ type, media_url_https: "https://example.com/p.jpg" }] } });
test("SocialData video confirms articles.media only; GIF keeps its existing display", () => {
  const video = tweetToCandidate(tweet());
  assert.equal(video.media?.[0]?.kind === "video" && video.media[0].confirmed, true);
  assert.equal("confirmed" in video.xPost!.media![0]!, false);
  const gif = tweetToCandidate(tweet("animated_gif"));
  assert.equal(gif.media?.[0]?.kind, "video");
  assert.equal("confirmed" in gif.media![0]!, false);
});
test("SocialData verified direct quote contributes a no-cover fact without moving authors", () => {
  const parent = { ...tweet(), extended_entities: { media: [] }, is_quote_status: true, quoted_status_id_str: "456", quoted_status: { ...tweet(), id_str: "456" } };
  assert.deepEqual(tweetToCandidate(parent).media, confirmedVideoMedia());
  assert.equal(tweetToCandidate(parent).author, "a");
  for (const changed of [{ is_quote_status: false }, { quoted_status_id_str: "789" }, { quoted_status: { ...tweet("animated_gif"), id_str: "456" } }]) {
    assert.deepEqual(tweetToCandidate({ ...parent, ...changed }).media, []);
  }
});

test("readability extracts only article video facts before sanitization and image limits", () => {
  const prose = "Research explains a measured result and discusses the implications for practical applications. ".repeat(20);
  const article = `<article><h1>Research results</h1><p>${prose}</p>${'<img src="https://example.com/p.jpg">'.repeat(15)}<video><source type="video/mp4" src="/v"></video></article>`;
  const body = readable(`<html><body>${article}</body></html>`, "https://example.com/a");
  assert.ok(body?.media?.some((m) => m.kind === "video" && m.confirmed));
  assert.equal(body?.images.length, 12);
});

test("Media RSS rejects contradictory declarations on one attachment while allowing mixed attachments", () => {
  const base = "https://example.com";
  for (const content of [
    { "@medium": "image", "@type": "video/mp4", "@url": "/v" },
    { "@medium": "video", "@type": "image/gif", "@url": "/v" },
  ]) assert.deepEqual(feedVideoMedia({ "media:content": content }, base), []);
  assert.deepEqual(feedVideoMedia({ "media:content": [
    { "@medium": "image", "@type": "image/jpeg", "@url": "/i" },
    { "@medium": "video", "@type": "video/mp4", "@url": "/v" },
  ] }, base), confirmedVideoMedia());
});

test("body video facts exclude the sanitizer's promotions and whole-subtree removals", () => {
  const clip = '<video src="https://example.com/v.mp4"></video>';
  for (const html of [
    `<div class="msr-promo">${clip}</div>`,
    `<div class="promo-box"><video><source type="video/mp4" src="/v"></video></div>`,
    `<form>${clip}</form>`, `<object>${clip}</object>`, `<svg>${clip}</svg>`,
    `<button>${clip}</button>`, `<audio>${clip}</audio>`,
  ]) assert.deepEqual(videoMediaFromHtml(html, "https://example.com"), [], html);
  assert.deepEqual(videoMediaFromHtml(`<p>Article</p>${clip}<div class="promo-box">Advertisement</div>`, "https://example.com"), confirmedVideoMedia());
});
