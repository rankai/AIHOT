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

const firstUrl = (value: unknown): string | undefined => {
  const urls = object(value)?.UrlList;
  return Array.isArray(urls) ? urls.find((url): url is string => typeof url === "string" && !!url.trim())?.trim() : undefined;
};

const epochSeconds = (value: unknown): number | undefined => {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" && /^\d+$/.test(value) ? value : undefined;
  if (!raw) return undefined;
  const numeric = Number(raw);
  if (!Number.isSafeInteger(numeric) || numeric < 0) return undefined;
  return raw.length >= 13 ? Math.trunc(numeric / 1000) : numeric;
};

export function parseDouyinSearch(response: unknown, input: DouyinSearchInput) {
  const envelope = object(object(response)?.envelope);
  if (envelope?.provider !== "TikHub") throw new AgentKeyPayloadError("AgentKey returned an unrecognized upstream; review retained response");
  const payload = object(envelope.data), responseBody = object(payload?.data), data = object(responseBody?.data);
  if (payload?.code !== 200 || responseBody?.code !== 0) throw new AgentKeyPayloadError("Unrecognized Douyin V4 non-success business status; review retained response");
  if (!data || !Array.isArray(data.itemList)) throw new AgentKeyPayloadError("Unrecognized Douyin V4 itemList; review retained response");
  const candidates = data.itemList.map((value, index) => {
    const item = object(object(value)?.AwemeInfo);
    if (!item) throw new AgentKeyPayloadError("Invalid Douyin V4 AwemeInfo item; review retained response");
    const video = object(item.Video), author = object(item.Author);
    const workId = stableId(item.AwemeId) ?? stableId(video?.ItemID);
    const uid = stableId(author?.Uid), secUid = stableId(author?.SecUid, true);
    if (item.AwemeId && video?.ItemID && String(item.AwemeId) !== String(video.ItemID)) {
      throw new AgentKeyPayloadError("Douyin V4 work IDs disagree; review retained response");
    }
    const description = typeof item.Desc === "string" ? item.Desc
      : typeof video?.Title === "string" ? video.Title : undefined;
    const createTime = item.CreateTime ?? video?.CreateTime;
    const shareUrl = workId ? `https://www.douyin.com/video/${workId}` : undefined;
    const authorName = typeof author?.Nickname === "string" ? author.Nickname : undefined;
    const coverUrl = firstUrl(video?.Cover) ?? firstUrl(item.Cover);
    const record = {
      ...item,
      ...(description !== undefined ? {desc: description, aweme_desc: description} : {}),
      ...(authorName !== undefined ? {authorName} : {}),
      ...(coverUrl !== undefined ? {coverUrl} : {}),
    };
    const seconds = epochSeconds(createTime);
    const missingFields: string[] = [];
    if (!workId) missingFields.push("aweme_id");
    if (!uid) missingFields.push("author.uid");
    if (!secUid) missingFields.push("author.sec_uid");
    if (description === undefined) missingFields.push("desc");
    if (seconds === undefined) missingFields.push("create_time");
    const importBlockers: string[] = [];
    if (!workId) importBlockers.push("lossless_work_id_required");
    if (!uid && !secUid) importBlockers.push("lossless_author_id_required");
    const time = seconds === undefined ? null : new Date(seconds * 1000);
    const publishedAt = time && Number.isFinite(time.getTime()) ? time.toISOString() : null;
    return { itemKey: `item:${index}`, kind: "douyin_work", data: {
      platform:"douyin", operationId:"OWIBYU1V", provider:"agentkey", upstream:"TikHub",tool:douyinSearchRoute.tool,
      title:description ?? "抖音作品", identity:{...(uid?{uid}:{}),...(secUid?{secUserId:secUid}:{})},
      workId:workId??null,url:shareUrl??null,missing:missingFields,record,publishedAt,
      ...(workId ? { aweme_id: workId } : {}),
      ...(description !== undefined ? { desc: description } : {}),
      ...(seconds !== undefined ? { create_time: seconds } : {}),
      author: { ...(uid ? { uid } : {}), ...(secUid ? { sec_uid: secUid } : {}), ...(authorName ? { name: authorName } : {}) },
      ...(shareUrl ? { share_url: shareUrl } : {}), missingFields, importBlockers,
    } };
  });
  const pagination: Record<string, unknown> = {};
  if (Object.hasOwn(data, "hasMore")) pagination.hasMore = data.hasMore;
  if (Object.hasOwn(data, "cursor")) pagination.cursor = data.cursor;
  const effective = douyinSearchInput.parse(input);
  const stopReason = data.hasMore === false ? "upstream_no_more" : undefined;
  return { candidates, summary: { count: candidates.length, query: effective,
    ...(Object.keys(pagination).length ? { pagination } : {}), ...(stopReason ? { stopReason } : {}),
    missingFields: Object.keys(pagination).length ? [] : ["pagination"],
  } };
}
