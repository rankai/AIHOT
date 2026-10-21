import { candidateSelectionValid } from "./candidate-selection.ts";
import type { OperationResult } from "./operation-types.ts";
import { safeExternalUrl } from "./platform-types.ts";
import { isResearchPlatform, researchObject } from "./research-platform-data.ts";

interface SupplementField { name: string; label: string; options?: readonly string[] }
export function researchSupplementFields(platform: unknown): SupplementField[] {
  switch (platform) {
    case "qichezhijia": return [{ name: "authorId", label: "作者 authorId" }, { name: "authorNamespace", label: "作者标识范围", options: ["original", "chejiahao", "club"] }];
    case "dongchedi": return [{ name: "userId", label: "作者 userId" }, { name: "authorId", label: "作者 authorId" }, { name: "workType", label: "作品类型", options: ["article", "video"] }];
    case "yiche": return [{ name: "userId", label: "作者 userId" }, { name: "authorId", label: "作者 authorId" }, { name: "workType", label: "作品类型", options: ["club", "article", "video"] }];
    case "baijiahao": return [{ name: "uid", label: "作者 uid" }, { name: "secUid", label: "作者 secUid" }, { name: "uk", label: "作者 uk" }, { name: "workType", label: "作品类型", options: ["article", "video"] }];
    case "zhihu": return [{ name: "uid", label: "作者 uid" }, { name: "vertical", label: "作品范围", options: ["answer", "article", "zvide"] }];
    default: return [];
  }
}
function receivedField(data: Record<string, unknown>, key: string): unknown {
  const identity = researchObject(data.identity), namespace = researchObject(data.workNamespace), request = researchObject(data.requestContext);
  if (key === "vertical") return namespace.vertical ?? request.vertical;
  if (key === "authorNamespace") return researchObject(data.identityNamespace).authorNamespace;
  if (key === "workType") return namespace.workType;
  return identity[key];
}
function present(value: unknown): boolean { return typeof value === "string" && value.length > 0; }
function fieldReceived(data: Record<string, unknown>, field: SupplementField): boolean {
  const value = receivedField(data, field.name);
  return present(value) && (!field.options || field.options.includes(value as string));
}
export function researchImportState(result: Pick<OperationResult, "kind" | "data" | "sourceId" | "articleId">) {
  const platform = result.data.platform;
  const account = ["dongchedi", "yiche", "baijiahao"].includes(String(platform)) && result.kind === `${platform}_account`;
  const work = isResearchPlatform(platform) && result.kind === `${platform}_work`;
  const linked = !!(result.sourceId || result.articleId);
  const receivedIdentity = Object.values(researchObject(result.data.identity)).some(present);
  return { account, work, linked, canImport: !linked && (work || account && receivedIdentity), fields: account ? [] : researchSupplementFields(platform).filter(field => !fieldReceived(result.data, field)) };
}
export function researchImportCandidates<T extends { participation_mode: string }>(rows: readonly T[], account: boolean): T[] {
  return rows.filter(row => account || row.participation_mode === "isolated");
}
function nativeHost(platform: unknown, hostname: string): boolean {
  switch (platform) {
    case "qichezhijia": return hostname === "autohome.com.cn" || hostname.endsWith(".autohome.com.cn");
    case "dongchedi": return ["dongchedi.com", "dcdapp.com"].some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    case "yiche": return hostname === "yiche.com" || hostname.endsWith(".yiche.com");
    case "baijiahao": return hostname === "baijiahao.baidu.com";
    case "zhihu": return ["zhihu.com", "www.zhihu.com", "zhuanlan.zhihu.com"].includes(hostname);
    default: return false;
  }
}
export function researchImportBody(result: Pick<OperationResult, "kind" | "data" | "sourceId" | "articleId">, input: { reason: string; target: string; sourceId: string; requestState: string; rows: readonly { id: string; participation_mode: string }[]; values: Record<string, string>; evidence: string }) {
  const state = researchImportState(result), reason = input.reason.trim();
  if (!state.canImport) throw new Error(state.linked ? "此结果已有真实关联，请查看文章或信源。" : "仅已收稳定身份的账号或作品可本地导入，不能人工补账号身份。");
  if (!reason || reason.length > 500) throw new Error("请填写 1–500 字符的操作原因。");
  const existing = input.target === "existing";
  if (existing && !candidateSelectionValid(input.sourceId, input.requestState, "external", "external", researchImportCandidates(input.rows, state.account))) throw new Error("请等待搜索完成，并从当前候选页重新选择已核实的信源。");
  const supplement: Record<string, string> = {};
  if (!state.account) {
    const fields = researchSupplementFields(result.data.platform);
    for (const [key, raw] of Object.entries(input.values)) {
      if (!raw.trim()) continue;
      if (key === "url") continue;
      const field = fields.find(field => field.name === key);
      if (!field) throw new Error("不能提交此平台未支持的补充字段。");
      if (fieldReceived(result.data, field)) throw new Error("已收到的身份或类型不可替换，无需重复补充。");
      if (field.options && !field.options.includes(raw)) throw new Error("请选择当前平台支持的作品或作者范围。");
      supplement[key] = raw;
    }
    const url = input.values.url?.trim();
    if (url) {
      const safe = safeExternalUrl(url);
      if (!safe) throw new Error("请填写已核实的 HTTP(S) 原文地址，不接受凭据或媒体地址作为原文依据。");
      const parsed = new URL(url);
      if (parsed.port || parsed.hash) throw new Error("原文地址不能带端口或片段标记；具体原生路径由后台复核。");
      const received = result.data.url;
      if (typeof received === "string" && received.startsWith("//") && result.data.platform === "dongchedi") {
        if (url !== `https:${received}` && url !== `http:${received}`) throw new Error("此响应只缺协议，请显式补充同一地址的 http:// 或 https://，不能换成其他原文。");
      } else if (safeExternalUrl(received)) {
        const previous = new URL(received as string);
        const obviousNonOriginal = previous.pathname === "/" || /\.(?:jpe?g|png|webp|mp4|mp3)$/i.test(previous.pathname) || /\/(?:search|user|author|account|people|org|topic|column)(?:\/|$)/i.test(previous.pathname);
        if (nativeHost(result.data.platform, previous.hostname) && !obviousNonOriginal && received !== url) throw new Error("已收到的原生地址不可替换；补证只能确认同一地址。");
      }
      supplement.url = url;
    }
    if (Object.keys(supplement).length || existing) {
      const evidence = input.evidence.trim();
      if (!evidence || evidence.length > 1000) throw new Error("补充字段或显式作品目标需要 1–1000 字符的核实依据。");
      supplement.evidence = evidence;
    }
  }
  return { reason, ...(existing ? { sourceId: input.sourceId } : {}), ...(!state.account && Object.keys(supplement).length ? { supplement } : {}) };
}
