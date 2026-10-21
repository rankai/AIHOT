import {object} from "./response.ts";
import {douyinSearchInput,douyinSearchRoute,type DouyinSearchInput} from "./douyin-contract.ts";
export class AgentKeyPayloadError extends Error {
  readonly receiptId?: number;
  constructor(message: string, receiptId?: number) { super(message); this.receiptId = receiptId; }
}

const stableId = (value: unknown, opaque = false): string | undefined => {
  if (typeof value === "string" && (opaque ? !!value.trim() && !/[\s\u0000-\u001f]/.test(value) : /^\d+$/.test(value))) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined; // In particular, never String() an already rounded unsafe number.
};

export function parseDouyinSearch(response: unknown, input: DouyinSearchInput) {
  const envelope = object(object(response)?.envelope);
  if (envelope?.provider !== "TikHub") throw new AgentKeyPayloadError("AgentKey returned an unrecognized upstream; review retained response");
  const payload = object(envelope.data), data = object(payload?.data);
  if (!data || !Array.isArray(data.items)) throw new AgentKeyPayloadError("Unrecognized Douyin V5 items payload; review retained response");
  const candidates = data.items.map((value, index) => {
    const item = object(value);
    if (!item) throw new AgentKeyPayloadError("Invalid Douyin V5 item; review retained response");
    const author = object(item.author);
    const workId = stableId(item.aweme_id), uid = stableId(author?.uid), secUid = stableId(author?.sec_uid, true);
    const missingFields: string[] = [];
    if (!workId) missingFields.push("aweme_id");
    if (!uid) missingFields.push("author.uid");
    if (!secUid) missingFields.push("author.sec_uid");
    if (typeof item.desc !== "string") missingFields.push("desc");
    if (typeof item.share_url !== "string" || !item.share_url.trim()) missingFields.push("share_url");
    if (typeof item.create_time !== "string" && typeof item.create_time !== "number") missingFields.push("create_time");
    const importBlockers: string[] = [];
    if (!workId) importBlockers.push("lossless_work_id_required");
    if (!uid && !secUid) importBlockers.push("lossless_author_id_required");
    const seconds = typeof item.create_time === "number" ? item.create_time : typeof item.create_time === "string" && /^\d+$/.test(item.create_time) ? Number(item.create_time) : NaN;
    const time = new Date(seconds * 1000);
    const publishedAt = Number.isSafeInteger(seconds) && seconds >= 0 && Number.isFinite(time.getTime()) ? time.toISOString() : null;
    return { itemKey: `item:${index}`, kind: "douyin_work", data: {
      platform:"douyin", operationId:"OWIBYU1V", provider:"agentkey", upstream:"TikHub",tool:douyinSearchRoute.tool,
      title:typeof item.desc==="string"?item.desc:"抖音作品", identity:{...(uid?{uid}:{}),...(secUid?{secUserId:secUid}:{})},
      workId:workId??null,url:typeof item.share_url==="string"?item.share_url:null,
      missing:missingFields,record:item,publishedAt,
      ...(workId ? { aweme_id: workId } : {}),
      ...(typeof item.desc === "string" ? { desc: item.desc } : {}),
      ...(typeof item.create_time === "string" || typeof item.create_time === "number" ? { create_time: item.create_time } : {}),
      author: { ...(uid ? { uid } : {}), ...(secUid ? { sec_uid: secUid } : {}) },
      ...(typeof item.share_url === "string" ? { share_url: item.share_url } : {}), missingFields, importBlockers,
    } };
  });
  const pagination: Record<string, unknown> = {};
  const p = object(data.pagination);
  if (data.pagination !== undefined && !p) throw new AgentKeyPayloadError("Invalid Douyin V5 pagination; review retained response");
  for (const field of ["offset", "search_id", "backtrace", "has_more", "next_page"]) {
    if (p && Object.hasOwn(p, field)) pagination[field] = p[field];
  }
  const effective = douyinSearchInput.parse(input);
  const stopReason = p?.has_more === false || p?.has_more === 0 ? "upstream_no_more"
    : effective.page === 200 ? "page_limit" : undefined;
  return { candidates, summary: { count: candidates.length, query: effective,
    ...(p ? { pagination } : {}), ...(stopReason ? { stopReason } : {}),
    missingFields: p ? [] : ["pagination"],
  } };
}
