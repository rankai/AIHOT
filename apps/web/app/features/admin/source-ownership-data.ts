import { selectableWorkResult } from "./work-result-selection-data.ts";
import { manualWorkPlatform } from "./manual-work-data.ts";
import { researchImportState } from "./research-import-data.ts";
import { candidateSelectionValid } from "./candidate-selection.ts";
import type { OperationDetail, OperationResult } from "./operation-types.ts";
export interface OwnershipSource { id: string; name: string; kind?: string; participation_mode?: string; enabled?: boolean }
export interface OwnershipCandidates { rows: OwnershipSource[]; page: number }
export function ownershipCandidatesHref(query: string, page = 1) {
  return `/admin/sources?${new URLSearchParams({ q: query.trim(), enabled: "true", page: String(page) })}`;
}
export function ownershipCandidateValid(id: string, requestState: string, query: string, searchedQuery: string | null, rows?: readonly OwnershipSource[]) {
  return query.trim() === searchedQuery && candidateSelectionValid(id, requestState, "source", "source", rows?.filter(row => row.enabled === true));
}
export function frozenSourceOwnership(inputs: Pick<OperationDetail["inputs"], "members" | "sources">) {
  const ids = [...new Set((inputs.members ?? []).flatMap(member => member.sourceId ? [member.sourceId] : []))];
  const id = ids.length === 1 ? ids[0]! : null;
  return { id, name: inputs.sources?.find(source => source.id === id)?.name ?? id, ambiguous: ids.length > 1 };
}
export function workSourceBody(ownership: { id: string | null; inherited: boolean; ambiguous: boolean }) {
  if (ownership.ambiguous) throw new Error("本轮包含多个所属信源，无法确定作品归属；请核对原执行记录。");
  if (!ownership.id) throw new Error("请先在结果区选择一次所属信源，再导入作品。");
  return ownership.inherited ? {} : { sourceId: ownership.id };
}
export function hasUnlinkedWork(results: readonly OperationResult[]) {
  return results.some(result => !result.articleId && !result.sourceId && (selectableWorkResult(result, true) || !!manualWorkPlatform(result.kind, result.data) || researchImportState(result).work));
}
