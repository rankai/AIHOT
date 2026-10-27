import { platformParameters, safeExternalUrl, type PlatformOperation } from "./platform-types.ts";

export function shipinhaoShareUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^https?:\/\/weixin\.qq\.com\//i.test(value) || value.includes("#")) return null;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.port && !url.hash && /^\/sph\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? value : null;
  } catch { return null; }
}
export function shipinhaoQueryParameters(operation: PlatformOperation, values: Record<string, string>) {
  const parameters = platformParameters(operation, values);
  if (operation.id === "MH5YA9DL" && !shipinhaoShareUrl(parameters.url)) throw new Error("请填写 weixin.qq.com/sph/ 视频号分享链接；不在本地解析短链");
  return parameters;
}
export function shipinhaoResultData(kind: string, data: Record<string, unknown>) {
  const record = data.record && typeof data.record === "object" && !Array.isArray(data.record) ? data.record as Record<string, unknown> : {};
  const string = (value: unknown) => typeof value === "string" && value ? value : null;
  return {
    account: kind === "shipinhao_account", work: kind === "shipinhao_work", record,
    videoId: string(record.videoId), exportId: string(record.exportId), requestedWorkId: string(data.requestedWorkId),
    inputUrl: safeExternalUrl(data.inputUrl), duration: string(record.videoDuration),
    missing: Array.isArray(data.missing) ? data.missing.filter((value): value is string => typeof value === "string") : [],
    media: ([["videoUrl", "视频媒体"], ["thumbUrl", "缩略图"], ["coverUrl", "封面"], ["cover", "封面"], ["headUrl", "头像"], ["avatar", "头像"], ["coverImgUrl", "账号封面"]] as const).flatMap(([field, label]) => {
      const url = safeExternalUrl(record[field]);
      return url ? [{ field, label, url }] : [];
    }),
  };
}
