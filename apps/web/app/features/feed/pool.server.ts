import { data as routeData } from "react-router";
import type { PoolResponse } from "@aihot/contracts/site";
import { isCategoryKey, isChannelKey } from "@aihot/contracts/taxonomy";
import { loadOr404, queryString } from "../../lib/api.server";
import { requestedPageSize, type PoolBase } from "./pool-navigation";

export async function loadPool(request: Request, scope: boolean | { columnId: string } = false) {
  const url = new URL(request.url);
  const columnId = typeof scope === "object" ? scope.columnId : null;
  const videosOnly = scope === true;
  if (columnId && [...url.searchParams.keys()].some((key) => !["q", "tab", "page", "pageSize"].includes(key))) throw routeData({ message: "bad_request" }, { status: 400 });
  const channelParam = url.searchParams.get("channel") ?? "all";
  const categoryParam = url.searchParams.get("category");
  const channel = !columnId && isChannelKey(channelParam) ? channelParam : "all";
  const category = !columnId && categoryParam && isCategoryKey(categoryParam) ? categoryParam : null;
  const tag = !columnId ? url.searchParams.get("tag")?.trim() || null : null;
  const q = url.searchParams.get("q")?.trim().slice(0, 200) || null;
  const tab = url.searchParams.get("tab") === "relevance" ? "relevance" : null;
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1), 2000);
  const pageSize = requestedPageSize(url.searchParams.get("pageSize"));
  const reader = { q, tab, page: page > 1 ? page : null, pageSize };
  const filters = { channel: channel === "all" ? null : channel, category, tag };
  const base: PoolBase = columnId ? `/columns/${columnId}` : videosOnly ? "/videos" : "/all";
  const query = columnId ? { columnId, ...reader } : { ...filters, ...reader, videosOnly: videosOnly ? "true" : null };
  const busyQuery = queryString(columnId ? reader : { ...filters, ...reader });
  const data = await loadOr404<PoolResponse>(`/api/site/pool${queryString(query)}`, { signal: request.signal, busyRedirect: `${base}/search-busy${busyQuery}` });
  return { data };
}
