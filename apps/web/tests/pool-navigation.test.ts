import assert from "node:assert/strict";
import { test } from "node:test";
import { poolHref, requestedPageSize } from "../app/features/feed/pool-navigation.ts";

test("list navigation keeps actual page size and video route while clearing legacy paging", () => {
  const original = new URLSearchParams("q=model&category=paper&tab=relevance&page=45&pageSize=40&deep=1&anchorAt=old&search=1&videosOnly=true");
  const href = poolHref("/videos", original, 3, { page: 667 });
  const url = new URL(href, "http://example.test");
  assert.equal(url.pathname, "/videos");
  assert.equal(url.searchParams.get("pageSize"), "3");
  assert.equal(url.searchParams.get("page"), "667");
  assert.equal(url.searchParams.get("q"), "model");
  assert.equal(url.searchParams.get("category"), "paper");
  assert.equal(url.searchParams.get("tab"), "relevance");
  for (const key of ["deep", "anchorAt", "search", "videosOnly"]) assert(!url.searchParams.has(key));
  const sorted = new URL(poolHref("/videos", original, 3, { page: null, tab: null }), "http://example.test");
  assert(!sorted.searchParams.has("page")); assert(!sorted.searchParams.has("tab"));
  assert.equal(original.get("pageSize"), "40");
});

test("a missing or invalid size uses server configuration", () => {
  for (const size of [null, "", " ", "0", "41", "1.5", "not-a-number"]) assert.equal(requestedPageSize(size), null);
  assert.equal(requestedPageSize("1"), 1); assert.equal(requestedPageSize("40"), 40);
});
