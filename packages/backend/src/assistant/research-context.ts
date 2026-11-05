import type { ModelMessage } from "ai";
import type { Tx } from "../db.ts";

/** Once analysis is saved, its observations replace the already consumed raw note fields.
 * Keep the transcript's call/result pairs and every real source identity; the full search,
 * sample metrics and analysis remain persisted for validation and delivery. */
export async function compactAnalyzedResearchContext(tx: Tx, turnId: string, messages: ModelMessage[]): Promise<ModelMessage[]> {
  const visibleAnalyses = messages.flatMap(message => message.role === "tool" ? message.content.flatMap(part =>
    part.type === "tool-result" && part.toolName === "analyze_xhs_research" && part.output.type === "json"
      && typeof (part.output.value as any)?.analysisCallId === "string" ? [(part.output.value as any).analysisCallId as string] : []) : []);
  if (!visibleAnalyses.length) return messages;
  const searches = await tx`SELECT s.upstream_id,s.result,array_agg(a.id::text ORDER BY a.id) AS analysis_ids
    FROM assistant_tool_calls s JOIN operation_runs r ON r.id=s.child_run_id
    JOIN assistant_tool_calls a ON a.turn_id=s.turn_id AND a.name='analyze_xhs_research' AND a.state='completed'
      AND a.input->>'activationId'=s.input->>'activationId' AND a.result->>'activationId'=s.input->>'activationId'
    WHERE s.turn_id=${turnId} AND s.name='search_xhs_notes' AND s.state='completed' AND r.status='completed' AND a.id::text IN ${tx(visibleAnalyses)}
      AND jsonb_typeof(a.result->'samples')='array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(a.result->'samples') sample WHERE sample->>'searchCallId'=s.id::text)
    GROUP BY s.id,s.upstream_id,s.result`;
  if (!searches.length) return messages;
  return messages.map((message) => {
    if (message.role !== "tool") return message;
    return { ...message, content: message.content.map((part) => {
      if (part.type !== "tool-result" || part.toolName !== "search_xhs_notes" || part.output.type !== "json") return part;
      const value = part.output.value as Record<string, any>;
      // Tool ids can repeat across model responses. Match the stored source identities too,
      // so a completed analysis cannot compact a different query's unconsumed evidence.
      const search = searches.find((row) => row.upstream_id === part.toolCallId && Array.isArray(row.result?.results) && Array.isArray(value?.results)
        && JSON.stringify(row.result.results.map((r: any) => r.id)) === JSON.stringify(value.results.map((r: any) => r.id)));
      if (!search) return part;
      return { ...part, output: { type: "json" as const, value: {
        ...search.result,
        results: search.result.results.map((result: Record<string, any>) => ({
          id: result.id, kind: result.kind, title: result.title, url: result.url,
          details: { role: result.details?.role },
        })),
        contextProjection: {
          analysisCallIds: search.analysis_ids,
          note: "这些真实来源已完成分析；正文、标签和逐条互动数据不再重复放入模型上下文，完整数据仍已保存。沿用已保存的规律、应用计划和限制继续写作，不重新检索或报价；引用只使用真实ID及原链接，不能把研究参考当成已核实事实。",
        },
      } } };
    }) };
  });
}
