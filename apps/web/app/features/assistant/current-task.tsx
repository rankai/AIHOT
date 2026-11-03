import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { AssistantSession } from "@aihot/contracts/assistant";
import { IconCheck, IconChevronDown, IconClock, IconInfo, IconMinus } from "../../components/icons";
import { Button } from "../admin/ui";
import { useToolCommand } from "../tools/client";
import { SearchCallCard } from "./turn-cards";
import { PHASE_LABELS, SEARCH_STATE_LABELS, turnActive, activityLabel, activityIcon, sessionApi } from "./data";

function ExecutionIcon({ state }: { state: "done" | "active" | "waiting" | "attention" | "stopped" }) {
  return (
    <span className="assistant-execution-icon" data-state={state} aria-hidden="true">
      {state === "active" ? <span className="assistant-activity-dot" /> :
        state === "done" ? <IconCheck size={14} /> :
        state === "stopped" ? <IconMinus size={14} /> :
        state === "attention" ? <IconInfo size={14} /> : <IconClock size={14} />}
    </span>
  );
}

export function CurrentTask({
  session, csrf, pending, reading, readError, refresh, control, showArtifacts, setView,
}: {
  session: AssistantSession;
  csrf: string;
  pending: boolean;
  reading: boolean;
  readError: string | null;
  refresh: () => Promise<unknown>;
  control: (action: "stop" | "resume") => Promise<void>;
  showArtifacts: (target?: { artifactId: string; version: number }) => void;
  setView: (view: "chat" | "artifacts") => void;
}) {
  const turn = session.turn;
  const command = useToolCommand(csrf, `assistant:session:${session.sessionId}`);
  const active = turnActive(session);
  const question = turn?.phase === "waiting_question" ? turn.question : null;
  const currentActivity = turn?.activities?.find((item) => !["completed", "rejected", "failed", "stopped"].includes(item.state));
  const working = !readError && (turn?.activities ? currentActivity?.state === "running" : true) && !!turn && ["executing", "waiting_child"].includes(turn.phase);
  const [expanded, setExpanded] = useState(working);
  useEffect(() => {
    setExpanded(!!turn && ["executing", "waiting_child"].includes(turn.phase));
  }, [turn?.turnId]);
  useEffect(() => {
    if (turn?.phase === "completed") setExpanded(false);
  }, [turn?.phase]);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [coverSelection, setCoverSelection] = useState<{ scope: string; value: { action: "keep-plans" } | { action: "generate"; schemeId: string } } | null>(null);
  useEffect(() => {
    setWaitingSeconds(0);
    if (!working) return;
    const started = Date.now();
    const timer = setInterval(() => setWaitingSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [turn?.turnId, turn?.phase, working]);
  if (!turn) return null;
  const waitingNext = !!turn.activities && !currentActivity && ["executing", "waiting_child"].includes(turn.phase);
  const completedActivity = (kind: "generate_image" | "save_xhs_cover_plan" | "save_draft") =>
    turn.phase === "completed" && turn.activities?.some((item) => item.kind === kind && item.state === "completed");
  const summaryLabel = waitingNext ? "等待下一步处理" : completedActivity("generate_image") ? "图片已保存" : completedActivity("save_xhs_cover_plan") ? "封面方案已保存" : completedActivity("save_draft") ? "稿件已保存" : PHASE_LABELS[turn.phase];
  const coverChoice = question?.coverPlan;
  const choiceScope = JSON.stringify([session.sessionId, turn.turnId, session.revision, question?.questionId, coverChoice?.artifactId, coverChoice?.version]);
  const selectedCover = coverSelection?.scope === choiceScope ? coverSelection.value : null;
  const selectedScheme = selectedCover?.action === "generate" ? coverChoice?.schemes.find((scheme) => scheme.schemeId === selectedCover.schemeId) : undefined;
  const choiceDisabled = pending || reading || command.pending || session.archived || !!readError || turn.status !== "waiting";
  const canContinueCover = !choiceDisabled && (selectedCover?.action === "keep-plans" || (!!selectedScheme && coverChoice?.imageAvailable));
  async function chooseCover(scheme?: { schemeId: string; name: string }) {
    if (!question || !coverChoice || choiceDisabled || (scheme && !coverChoice.imageAvailable)) return;
    await command.run(`${sessionApi(session.sessionId)}/turns/${turn!.turnId}/answer`, {
      questionId: question.questionId,
      expectedRevision: session.revision,
      answer: scheme ? `选择封面方案：${scheme.name}` : "只保留封面方案",
      choice: {
        artifactId: coverChoice.artifactId,
        version: coverChoice.version,
        ...(scheme ? { action: "generate", schemeId: scheme.schemeId } : { action: "keep-plans" }),
      },
    });
    await refresh();
  }
  const phaseSummary = ["stopped", "needs_review", "completed", "waiting_question", "waiting_approval"].includes(turn.phase);
  const phaseState = readError || turn.phase === "needs_review" ? "attention" :
    turn.phase === "stopped" ? "stopped" : turn.phase === "completed" ? "done" :
    ["waiting_question", "waiting_approval"].includes(turn.phase) ? "waiting" :
    currentActivity ? activityIcon(currentActivity.state) : working ? "active" : "waiting";
  const needsAction = (call: (typeof turn.calls)[number]) =>
    (call.state === "proposed" && turn.phase === "waiting_approval" && turn.status === "waiting") ||
    call.state === "needs_review" ||
    turn.activities?.some((activity) => activity.callId === call.callId && activity.state === "needs_review");

  return (
    <section className="assistant-task-card" aria-label="当前创作状态" data-phase={turn.phase} data-status-known={!readError}>
      {turn.credits && <p role="status" className="px-3 py-2 text-[12px] text-ink-3">{['settled','released'].includes(turn.credits.state)?`本次扣除 ${turn.credits.consumed} 积分，已释放 ${turn.credits.released} 积分`:turn.credits.state==='review'?`已停止后续执行，费用核对中（冻结 ${turn.credits.amount} 积分）`:`本次已冻结上限 ${turn.credits.amount} 积分，结束后按实际交付结算`}</p>}
      <details className="assistant-execution" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="assistant-execution-summary">
          <ExecutionIcon state={phaseState} />
          <span className="assistant-execution-title">执行过程</span>
          <span role="status" aria-live="polite" className="assistant-execution-phase">
            {readError ? `状态待确认 · 上次已知：${PHASE_LABELS[turn.phase]}` : !phaseSummary && currentActivity ? activityLabel(currentActivity, turn.activities) : summaryLabel}
          </span>
          <IconChevronDown size={14} className="assistant-execution-chevron" />
        </summary>
        <div className="assistant-execution-content">
          <ul className="assistant-execution-steps" aria-label="已记录的执行状态">
            {turn.activities ? turn.activities.map((activity) => {
              const call = activity.callId ? turn.calls.find((call) => call.callId === activity.callId) : undefined;
              const label = activity.state === "waiting" && call?.state === "proposed"
                ? activity.kind === "generate_image"
                  ? "等待确认图片生成"
                  : activity.kind === "search_wechat_articles"
                    ? `等待确认公众号查询${activity.keyword ? `“${activity.keyword}”` : ""}`
                    : activity.kind === "search_xhs_covers"
                      ? `等待确认封面查询${activity.keyword ? `“${activity.keyword}”` : ""}`
                    : activity.kind === "analyze_xhs_covers"
                      ? "等待确认封面视觉分析"
                    : activity.kind === "search_xhs_notes"
                      ? `等待确认查询${activity.keyword ? `“${activity.keyword}”` : "参考笔记"}`
                      : activityLabel(activity, turn.activities)
                : activityLabel(activity, turn.activities);
              return (
                <li className="assistant-execution-step" key={activity.id}>
                  <ExecutionIcon state={readError && activity.state !== "completed" ? "attention" : activityIcon(activity.state)} />
                  <div className="min-w-0 flex-1">
                    <p>{readError && activity.state !== "completed" ? "上次已知：" : ""}{label}</p>
                    {call && !needsAction(call) && (
                      <SearchCallCard call={call} session={session} csrf={csrf} refresh={refresh} statusUnknown={!!readError} activityState={activity.state} />
                    )}
                    {call && needsAction(call) && <p className="mt-1 text-[12px] text-ink-4">请查看下方操作。</p>}
                  </div>
                </li>
              );
            }) : <>
              <li className="assistant-execution-step">
                <ExecutionIcon state="done" />
                <p>已收到这次请求</p>
              </li>
              {turn.phase !== "completed" && (
                <li className="assistant-execution-step">
                  <ExecutionIcon state={phaseState} />
                  <p>{readError ? "当前状态待确认，请重新读取。" : PHASE_LABELS[turn.phase]}</p>
                </li>
              )}
              {turn.calls.map((call) => (
                <li className="assistant-execution-step" key={call.callId}>
                  <ExecutionIcon state={readError || ["needs_review", "failed"].includes(call.state) ? "attention" :
                    call.state === "completed" ? "done" : call.state === "running" ? "active" :
                    call.state === "rejected" ? "stopped" : "waiting"} />
                  {needsAction(call) ? (
                    <div className="min-w-0">
                      <p>
                        {call.name === "analyze_xhs_covers" ? "封面视觉分析" : call.name === "generate_image"
                          ? "图片生成"
                          : call.name === "search_xhs_covers"
                            ? "封面查询"
                          : call.name === "search_wechat_articles"
                            ? "公众号查询"
                            : "小红书检索"}
                        {" · "}
                        {String((call.name === "generate_image" ? call.input.prompt : call.input.keyword) ?? "")}
                      </p>
                      <p className="mt-1 text-[12px] text-ink-4">{SEARCH_STATE_LABELS[call.state] ?? "状态待确认"}，请查看下方操作。</p>
                    </div>
                  ) : (
                    <SearchCallCard call={call} session={session} csrf={csrf} refresh={refresh} statusUnknown={!!readError} />
                  )}
                </li>
              ))}
            </>}
          </ul>
        </div>
      </details>
      {working && waitingSeconds >= 15 && (
        <p className="text-[12px] leading-relaxed text-ink-4" aria-live="off">
          本次查看已等待 {waitingSeconds} 秒。处理仍在进行，状态会自动更新；这不代表已超时。
        </p>
      )}
      <div className="assistant-task-controls">
        {readError && <Button size="sm" disabled={reading} onClick={() => void refresh()}>重新连接</Button>}
        {turn.canResume && <Button size="sm" disabled={pending} onClick={() => void control("resume")}>继续处理</Button>}
        {turn.phase === "completed" && !!session.artifacts.length && (
          <button className="assistant-task-artifacts" onClick={() => showArtifacts()}>查看会话作品</button>
        )}
      </div>
      {turn.phase === "needs_review" && (
        <p className="text-[13px] leading-relaxed text-hot">
          本次结果需要核对。可刷新已有任务状态或联系管理员，请勿重新生成绕过核对。
          <Link to="/feedback" className="ml-1 underline">联系管理员</Link>
        </p>
      )}
      {question && (
        <div id="assistant-current-question" className={`assistant-question-card${coverChoice ? " assistant-cover-question" : ""}`}>
          <p className="assistant-question-label"><IconInfo size={14} />{coverChoice ? "问题" : "需要你补充"}</p>
          <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{coverChoice ? "选择一个方案，或保留全部方案。" : question.text}</p>
          {coverChoice ? <div className="mt-3 space-y-3">
            <button className="text-[12px] text-accent underline" onClick={() => showArtifacts({ artifactId: coverChoice.artifactId, version: coverChoice.version })}>查看方案 · 版本 {coverChoice.version}</button>
            <fieldset className="assistant-cover-choices" disabled={choiceDisabled}>
              <legend className="sr-only">选择封面方案</legend>
              {coverChoice.schemes.map((scheme, index) => <label key={scheme.schemeId} className="assistant-cover-choice" data-selected={selectedCover?.action === "generate" && selectedCover.schemeId === scheme.schemeId}>
                <span className="assistant-cover-choice-number" aria-hidden="true">{index + 1}</span>
                <span className="min-w-0 flex-1 break-words">{scheme.name}</span>
                <input type="radio" name={`cover-choice-${question.questionId}`} value={`scheme:${scheme.schemeId}`} checked={selectedCover?.action === "generate" && selectedCover.schemeId === scheme.schemeId} disabled={choiceDisabled || !coverChoice.imageAvailable} onChange={() => setCoverSelection({ scope: choiceScope, value: { action: "generate", schemeId: scheme.schemeId } })} />
              </label>)}
              <label className="assistant-cover-choice" data-selected={selectedCover?.action === "keep-plans"}>
                <span className="assistant-cover-choice-number" aria-hidden="true">{coverChoice.schemes.length + 1}</span>
                <span className="min-w-0 flex-1">只保留方案</span>
                <input type="radio" name={`cover-choice-${question.questionId}`} value="keep-plans" checked={selectedCover?.action === "keep-plans"} disabled={choiceDisabled} onChange={() => setCoverSelection({ scope: choiceScope, value: { action: "keep-plans" } })} />
              </label>
            </fieldset>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] text-ink-3">{selectedCover?.action === "keep-plans" ? "保留全部方案，不生成图片。" : turn.credits ? "选好后继续生成。" : "选好后查看生成费用。"}</p>
              <Button size="sm" disabled={!canContinueCover} busy={command.pending} onClick={() => { if (canContinueCover) void chooseCover(selectedCover?.action === "keep-plans" ? undefined : selectedScheme); }}>继续</Button>
            </div>
            {!coverChoice.imageAvailable && <p className="text-[12px] text-ink-3">{coverChoice.imageUnavailableReason ?? "图片生成暂不可用，仍可保留全部封面方案。"}</p>}
            {command.error && <p role="alert" className="text-[13px] text-hot">{command.error}</p>}
          </div> : <button className="mt-2 text-[12px] text-accent underline" onClick={() => {
            setView("chat");
            document.getElementById("assistant-composer-input")?.focus();
          }}>回答这个问题</button>}
        </div>
      )}
      {turn.calls.filter(needsAction).map((call) => (
        <div className="assistant-search-action" key={call.callId}>
          <SearchCallCard call={call} session={session} csrf={csrf} refresh={refresh} statusUnknown={!!readError} activityState={turn.activities?.find((item) => item.callId === call.callId)?.state} />
        </div>
      ))}
      {turn.phase === "stopped" && (
        <p className="text-[12px] leading-relaxed text-ink-3">已有内容仍可查看。已发出的外部请求不保证取消，费用按实际结果核对。</p>
      )}
    </section>
  );
}
