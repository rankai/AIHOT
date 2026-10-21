import { platformParameters, safeExternalUrl, type PlatformOperation } from "./platform-types.ts";

export function kuaishouQueryParameters(operation: PlatformOperation, values: Record<string, string>) {
  const parameters = platformParameters(operation, values);
  if (operation.id === "27DQ6SF9" && !!parameters.kwaiId === !!parameters.threeXId) throw new Error("账号展示号（kwaiId）与主页定位 ID（threeXId）必须且只能填写一个");
  return parameters;
}
export function kuaishouResultData(kind: string, data: Record<string, unknown>) {
  const record = data.record && typeof data.record === "object" && !Array.isArray(data.record) ? data.record as Record<string, unknown> : {};
  const string = (value: unknown) => typeof value === "string" && value ? value : null;
  return {
    account: kind === "kuaishou_account", work: kind === "kuaishou_work", record,
    photoId: string(record.photoId), requestedWorkId: string(data.requestedWorkId),
    duration: typeof record.duration === "string" || typeof record.duration === "number" ? record.duration : null,
    missing: Array.isArray(data.missing) ? data.missing.filter((value): value is string => typeof value === "string") : [],
    media: ([["videoUrl", "视频媒体"], ["coverUrl", "封面"], ["headUrl", "头像"], ["coverImgUrl", "账号封面"]] as const).flatMap(([field, label]) => {
      const url = safeExternalUrl(record[field]);
      return url ? [{ field, label, url }] : [];
    }),
  };
}
