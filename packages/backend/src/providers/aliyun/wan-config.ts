import { isProduction } from "../../config.ts";
export class WanDisabledError extends Error {}
export function assertWanOutbound() { if (process.env.ALIYUN_WAN_CALLS_ENABLED !== "true" || process.env.MODEL_CALLS_ENABLED !== "true") throw new WanDisabledError("万相外发未开启"); }
function localEndpoint(name: string) {
  const value = process.env[name]; if (!value) return null;
  const url = new URL(value);
  if (isProduction || process.env.NODE_ENV !== "test" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid Wan test endpoint");
  return url.origin;
}
export function wanConfig() {
  const workspace = process.env.ALIYUN_WAN_WORKSPACE_ID ?? "";
  const test = localEndpoint("ALIYUN_WAN_TEST_BASE_URL");
  if (!test && !/^[a-zA-Z0-9-]{1,100}$/.test(workspace)) throw new Error("请配置万相北京业务空间 ALIYUN_WAN_WORKSPACE_ID");
  const bucket = process.env.ALIYUN_WAN_OSS_BUCKET ?? "", prefix = process.env.ALIYUN_WAN_OSS_PREFIX ?? "wan-inputs/";
  const ossTest = localEndpoint("ALIYUN_WAN_OSS_TEST_BASE_URL");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^[a-zA-Z0-9_-]+\/$/.test(prefix)) throw new Error("请配置万相专用 OSS bucket/prefix");
  return { base: test ?? `https://${workspace}.cn-beijing.maas.aliyuncs.com`, workspace, region: "cn-beijing", bucket, prefix, ossBase: ossTest ?? `https://${bucket}.oss-cn-beijing.aliyuncs.com` };
}
export type WanConfig = ReturnType<typeof wanConfig>;
