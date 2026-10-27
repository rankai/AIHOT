import { platformParameters, safeExternalUrl, type PlatformOperation } from "./platform-types.ts";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string | null { return typeof value === "string" && value ? value : null; }

export function toutiaoNativeWork(value: unknown): { url: string; id: string } | null {
  if (typeof value !== "string" || !/^(?:https?:\/\/(?:www\.)?toutiao\.com\/|https:\/\/m\.toutiao\.com\/article\/)/i.test(value.trim()) || value.includes("#")) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port || url.hash) return null;
    if (url.hostname.toLowerCase() === "m.toutiao.com" && !/^\/article\/[0-9]+\/?$/.test(url.pathname)) return null;
    const match = /^\/(?:a|group\/|article\/|video\/)([0-9]+)\/?$/.exec(url.pathname);
    return match ? { url: value, id: match[1]! } : null;
  } catch { return null; }
}

export function toutiaoQueryParameters(operation: PlatformOperation, values: Record<string, string>) {
  const parameters = platformParameters(operation, values);
  if (["28CFGF5I", "R1IGR09H"].includes(operation.id) && !/^[0-9]+$/.test(String(parameters.offset ?? ""))) throw new Error("翻页偏移量须为完整数字字符串，首次填 0；不要使用小数或指数写法");
  if (operation.id === "4QS1F8DE") {
    for (const key of ["offset", "searchId"] as const) if (values[key] !== undefined) parameters[key] = values[key];
  }
  return parameters;
}

export function toutiaoDetailRequest(resultId: number, kind: string, data: Record<string, unknown>) {
  if (!Number.isSafeInteger(resultId) || resultId <= 0 || kind !== "toutiao_work" || data.platform !== "toutiao" || !["28CFGF5I", "R1IGR09H"].includes(String(data.operationId)) || typeof data.workId !== "string" || !/^[0-9]+$/.test(data.workId)) return null;
  return { operationId: "PAB6Z75Y", parameters: { opusId: data.workId }, sourceResultId: resultId };
}

export function toutiaoImportFields(kind: string, data: Record<string, unknown>) {
  const identity = object(data.identity), record = object(data.record);
  const uid = typeof identity.uid === "string" && /^[0-9]+$/.test(identity.uid) ? identity.uid : null;
  const secUid = string(identity.secUid), workId = string(data.workId), requestedWorkId = string(data.requestedWorkId);
  const account = kind === "toutiao_account", work = kind === "toutiao_work";
  // data.url deliberately omits unsupported originals; their received raw value still prevents replacement.
  const receivedUrl = work ? string(data.operationId === "28CFGF5I" ? record.opusUrl : record.workUrl) ?? string(data.url) : string(data.url);
  const native = toutiaoNativeWork(receivedUrl);
  const blockedReason = work && receivedUrl && !native ? "已收到的地址不是支持的头条原生原文，不能手工替换。请显式查询并核实作品详情；短链、主页和媒体地址不能作为导入原文。"
    : work && workId && !/^[0-9]+$/.test(workId) ? "已收到的作品 ID 不是可核实的数字 ID，请显式查询并核实原文。"
    : work && native && workId && native.id !== workId ? "已确认作品 ID 与收到的原文不一致，不能导入或替换。"
    : work && data.operationId === "PAB6Z75Y" && requestedWorkId && (!/^[0-9]+$/.test(requestedWorkId) || native && native.id !== requestedWorkId) ? "原文不能对应本次请求的作品 ID，请核实输入后重新查询。" : null;
  return { account, work, uid, secUid, workId, requestedWorkId, receivedUrl, native, record, blockedReason,
    canImport: data.provider === "agentkey" ? work && !blockedReason && !!workId && !!native : account ? !!uid : work && !blockedReason, needsUrl: work && !receivedUrl};
}


type Supplement = { url?: string; evidence: string };
export function toutiaoImportSupplement(fields: ReturnType<typeof toutiaoImportFields>, draft: { url: string; evidence: string }): { error: string; supplement?: never } | { error?: undefined; supplement?: Supplement } {
  if (!fields.canImport) return { error: fields.blockedReason ?? "此结果缺少可绑定的已收 uid，不能人工补账号身份" };
  if (fields.account || !fields.needsUrl) return {};
  const url = draft.url.trim(), evidence = draft.evidence.trim();
  if (fields.needsUrl) {
    const native = toutiaoNativeWork(url);
    if (!native) return { error: "请填写头条 /aID、/group/ID、/article/ID 或 /video/ID 原文，不接受短链、凭证、端口或片段" };
    if (fields.workId && fields.workId !== native.id) return { error: "补充原文须与已确认作品 ID 一致" };
    if (fields.requestedWorkId && fields.requestedWorkId !== native.id) return { error: "补充原文须与本次请求的作品 ID 一致" };
  }
  if (!evidence || evidence.length > 1000) return { error: "请填写缺失原文的核实依据（最多 1000 字）" };
  return { supplement: { url, evidence } };
}

export function toutiaoWorkFacts(data: Record<string, unknown>) {
  const record = object(data.record);
  return { record, workType: typeof record.workType === "boolean" ? record.workType : undefined,
    hasVideo: typeof record.hasVideo === "boolean" ? record.hasVideo : undefined,
    hasNext: typeof record.hasNext === "boolean" ? record.hasNext : undefined,
    publishTimeUnit: data.operationId === "28CFGF5I" ? "秒" : "原串，时区未由此确定",
    durationUnit: data.operationId === "R1IGR09H" ? "秒" : "单位未说明" };
}

export function toutiaoPageFacts(data: Record<string, unknown>): Array<[string, string]> {
  if (!["4QS1F8DE", "R1IGR09H"].includes(String(data.operationId))) return [];
  return [["上游是否还有结果 hasMore", typeof data.hasMore === "boolean" ? data.hasMore ? "是（true）" : "否（false）" : "未提供"],
    ...["offset", ...(data.operationId === "4QS1F8DE" ? ["searchId"] : [])].flatMap(key => typeof data[key] === "string" || typeof data[key] === "number" ? [[`上游 ${key}`, data[key] === "" ? "空字符串" : String(data[key])]] as Array<[string, string]> : [])];
}

export function toutiaoMediaLinks(record: Record<string, unknown>) {
  return ["imageList", "downloadUrl"].flatMap(field => Array.isArray(record[field]) ? record[field].flatMap((value: unknown, index: number) => {
    const url = safeExternalUrl(value);
    return url ? [{ key: `${field}:${index}`, label: field === "imageList" ? `图片 ${index + 1}` : `视频 ${index + 1}`, url }] : [];
  }) : []);
}
