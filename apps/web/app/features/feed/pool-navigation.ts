export type PoolBase = "/all" | "/videos" | `/columns/${string}`;
export function isColumnBase(base: PoolBase): base is `/columns/${string}` { return base.startsWith("/columns/"); }
const READER_PARAMS = ["q", "tab", "page", "pageSize"];

/** Custom pages carry only reader choices; their fixed filters belong to the saved definition. */
export function poolParams(base: PoolBase, params: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(params);
  if (isColumnBase(base)) for (const key of [...sp.keys()]) { if (!READER_PARAMS.includes(key)) sp.delete(key); }
  for (const key of ["deep", "anchorAt", "search", "videosOnly"]) sp.delete(key);
  return sp;
}

/** Keep the size used for this response when moving through the same list. */
export function poolHref(base: PoolBase, params: URLSearchParams, pageSize: number, patch: Record<string, string | number | null> = {}): string {
  const sp = poolParams(base, params);
  sp.set("pageSize", String(pageSize));
  for (const [key, value] of Object.entries(patch)) {
    if (isColumnBase(base) && !READER_PARAMS.includes(key)) continue;
    if (value === null || value === "") sp.delete(key);
    else sp.set(key, String(value));
  }
  return `${base}?${sp}`;
}

export function requestedPageSize(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const size = Number(value);
  return Number.isInteger(size) && size >= 1 && size <= 40 ? size : null;
}
