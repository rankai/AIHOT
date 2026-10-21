import type { OperationResult } from "./operation-types.ts";
import { resultUseCapabilities } from "./result-attachment-data.ts";
export interface ResultArticle { id: string; title: string; url: string; source_name: string; source_id: string; revision: number; has_body: boolean; source_enabled: boolean }
export interface ResultArticleRow { id: string; title: string; url: string; source: string }
export function resultUseBody(result: Pick<OperationResult, "kind" | "data" | "file" | "articleId">, input: { article: ResultArticle | null; selectedId: string; loading: boolean; action: "attach" | "fill-body"; reason: string; evidence: string }) {
  const { article } = input, capabilities = resultUseCapabilities(result);
  if (!capabilities.attach || input.action === "fill-body" && !capabilities.fillBody) throw new Error("此结果格式或文件状态不支持此材料操作。");
  if (input.loading || !article || input.selectedId !== article.id) throw new Error("请先读取当前选中材料的最新状态。");
  if (result.articleId && result.articleId !== article.id) throw new Error("结果已有真实关联，不能换到其他材料。");
  if (article.source_enabled !== true) throw new Error("材料信源未启用或状态未知，不能写入。");
  if (!Number.isSafeInteger(article.revision) || article.revision < 1) throw new Error("没有可用的材料版本，请重新读取。");
  if (input.action === "fill-body" && article.has_body !== false) throw new Error("材料已有正文或正文状态未知，不能覆盖。");
  const reason = input.reason.trim(), evidence = input.evidence.trim();
  if (!reason || reason.length > 500) throw new Error("请填写 1–500 字符的操作原因。");
  if (evidence.length > 2000) throw new Error("同一作品核实依据最多 2000 字符。");
  return { articleId: article.id, expectedRevision: article.revision, action: input.action, ...(evidence ? { evidence } : {}), reason };
}
