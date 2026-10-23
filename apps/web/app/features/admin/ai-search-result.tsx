import type { OperationResult } from "./operation-types";
import { aiSearchAnswer, aiSearchCitationRows, aiSearchCitationUrl, aiSearchFamilies, aiSearchFailureRows, aiSearchStatus } from "./ai-search-data";
import { researchFactText } from "./research-platform-data";
import { ResearchFacts } from "./research-platform-result";
import { Json } from "./ui";
export function AiSearchResult({ result: r }: { result: OperationResult }) {
  const citation = r.kind === "ai_search_citation", answer = aiSearchAnswer(r.data), url = citation ? aiSearchCitationUrl(r.data) : null;
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0">
    <div className="break-words text-[14px] font-medium">{aiSearchFamilies[String(r.data.family)] ?? "AI 搜索"} · {citation ? "引用记录" : r.kind === "ai_search_task" ? "提交 / 轮询历史" : "研究答案"}</div>
    {!citation && <p className="text-[13px] text-ink-3">供应商事实：{aiSearchStatus(r.data)}{Object.hasOwn(r.data, "completed") ? ` · completed：${researchFactText(r.data.completed)}` : ""}。{r.kind === "ai_search_task" ? "这是历史记录，当前执行状态以上方进度为准。" : ""}</p>}
    <ResearchFacts items={["taskId", "requestedTaskId"].filter(key => Object.hasOwn(r.data, key)).map(key => [key === "taskId" ? "响应任务 ID（实收）" : "查询任务 ID（请求）", researchFactText(r.data[key])])} />
    {!citation && <ResearchFacts items={aiSearchFailureRows(r.data)} />}
    {!citation && (answer.content !== null ? <p className="whitespace-pre-wrap break-all text-[13px] leading-relaxed text-ink-2">{answer.content === "" ? "回答正文为空字符串。" : answer.content}</p> : <p className="text-[12px] text-ink-4">{answer.fact}。{r.kind === "ai_search_answer" ? "请核对已保存结果。" : ""}</p>)}
    {citation && <><ResearchFacts items={aiSearchCitationRows(r.data)} />{url ? <a className="block break-all text-[13px] text-accent" href={url} target="_blank" rel="noreferrer">查看收到的引用地址 ↗</a> : <p className="text-[12px] text-ink-4">没有可安全打开的引用地址；不会用原始记录绕过链接检查。</p>}</>}
    {Object.hasOwn(r.data, "citationCount") && <p className="text-[12px] text-ink-3">该次响应报告引用数：{researchFactText(r.data.citationCount)}。这是此响应的记录数，不代表当前结果页条数或全部研究范围；引用按结果分页查看。</p>}
    {r.kind === "ai_search_answer" && <p className="text-[12px] text-ink-3">回答按纯文本展示；引用可能是搜索页或其他研究来源，不等于新闻作品。未创建文章或作者绑定。</p>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="AI 搜索记录与字段诊断" />
  </article>;
}
