import { useState } from "react";
import type { AssistantArtifact, AssistantCoverPlan } from "@aihot/contracts/assistant";
import { Button } from "../admin/ui";
import { safeSourceHref } from "./data";

type CoverSample = AssistantCoverPlan["evidence"]["samples"][number];

function CoverSampleImage({ sample }: { sample: CoverSample }) {
  const [unavailable, setUnavailable] = useState(false);
  return unavailable ? (
    <p className="rounded-control bg-bg-sunk p-3 text-[11px] text-ink-4">预览暂不可用，仍可查看来源与分析记录。</p>
  ) : (
    <img
      src={`/api/tools/assets/${encodeURIComponent(sample.fileKey)}/content`}
      alt={sample.title ? `参考封面：${sample.title}` : "参考封面"}
      loading="lazy"
      className="max-h-40 w-24 rounded-control bg-bg-sunk object-contain"
      onError={() => setUnavailable(true)}
    />
  );
}

export function CoverPlanBody({ artifact }: { artifact: AssistantArtifact }) {
  const plan = artifact.content.coverPlan;
  const [notice, setNotice] = useState<string | null>(null);
  if (!plan) return <p className="text-[13px] text-ink-3">封面方案暂不可读，请重新读取作品。</p>;
  const { evidence } = plan;
  return (
    <div className="min-w-0 space-y-4 break-words [overflow-wrap:anywhere]">
      <h3 className="text-[19px] font-semibold text-ink">{artifact.content.title}</h3>
      <p className="text-[13px] leading-relaxed text-ink-3">参考了 {evidence.observedCount} 张可读封面。{evidence.observedCount < evidence.selectedCount ? "部分选定样本未能读取，方案仅依据已读图片。" : "仅代表本次查询中可读的样本。"}</p>
      {plan.schemes.map((scheme, index) => (
        <section key={scheme.schemeId} className="min-w-0 space-y-3 border-t border-line pt-4" aria-label={`封面方案 ${index + 1}：${scheme.name}`}>
          <h4 className="text-[14px] font-semibold text-ink">方案 {index + 1} · {scheme.name}<span className="ml-2 text-[11px] font-normal text-ink-4">{scheme.aspectRatio}</span></h4>
          {(scheme.layout || scheme.palette) && <dl className="space-y-2 text-[13px] leading-relaxed text-ink-2">
            {scheme.layout && <div><dt className="text-[11px] text-ink-4">布局</dt><dd className="whitespace-pre-wrap">{scheme.layout}</dd></div>}
            {scheme.palette && <div><dt className="text-[11px] text-ink-4">配色</dt><dd className="whitespace-pre-wrap">{scheme.palette}</dd></div>}
          </dl>}
          {!scheme.sourceIds.length && <p className="text-[12px] leading-relaxed text-ink-3">本方案未单独指定参考图；本次研究参考见下方已观察图片。</p>}
          <details>
            <summary className="cursor-pointer text-[12px] text-accent">查看完整提示词</summary>
            <p className="mt-2 select-text whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{scheme.prompt}</p>
          </details>
          <Button size="sm" onClick={async () => {
            try {
              await navigator.clipboard.writeText(scheme.prompt);
              setNotice(`已复制“${scheme.name}”的提示词。`);
            } catch {
              setNotice("无法自动复制，请展开提示词后选择文字复制。");
            }
          }}>复制方案 {index + 1} 提示词</Button>
        </section>
      ))}
      {notice && <p role="status" className="text-[12px] text-accent">{notice}</p>}
      <details className="border-t border-line pt-4">
        <summary className="cursor-pointer text-[12px] font-medium text-ink-3">查看研究依据</summary>
        <div className="mt-3 space-y-1 text-[12px] leading-relaxed text-ink-3">
          <p>纳入候选 {evidence.candidateCount} 张 · 选定 {evidence.selectedCount} 张 · 已下载 {evidence.downloadedCount} 张 · 已分析 {evidence.analyzedCount} 张 · 可读 {evidence.observedCount} 张</p>
          <p>查询“{evidence.keyword}” · {evidence.startDate} 起；查询仅支持起始日期，未提供的信息不作推断。</p>
          {artifact.content.partial && <p>本次范围：{artifact.content.scope}</p>}
        </div>
        <p className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-3">查询范围：{evidence.scope}</p>
        <details className="mt-3 text-[12px] leading-relaxed text-ink-3">
          <summary className="cursor-pointer">查看原稿摘要</summary>
          <p className="mt-2">原稿由模型生成，数量以本版研究记录为准。</p>
          <p className="mt-2 whitespace-pre-wrap">{plan.summary}</p>
        </details>
        <ul className="mt-3 space-y-4">
          {evidence.samples.map((sample) => {
            const href = safeSourceHref(sample.url);
            const observation = sample.observation;
            return <li key={sample.sourceId} className="min-w-0 space-y-2 text-[12px] leading-relaxed text-ink-3">
              <CoverSampleImage key={sample.fileKey} sample={sample} />
              <p>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">{sample.title ?? "查看原笔记"}</a> : sample.title ?? "参考笔记"}</p>
              {sample.authorName && <p>作者：{sample.authorName}</p>}
              <p>{observation.status === "observed" ? "已观察图片" : "图片不可读"}</p>
              <dl className="space-y-1 whitespace-pre-wrap">
                <div><dt className="inline text-ink-4">可见文字：</dt><dd className="inline">{observation.text || "未记录可见文字"}</dd></div>
                <div><dt className="inline text-ink-4">主体：</dt><dd className="inline">{observation.subject || "未记录主体"}</dd></div>
                <div><dt className="inline text-ink-4">配色：</dt><dd className="inline">{observation.colors || "未记录配色"}</dd></div>
                <div><dt className="inline text-ink-4">布局：</dt><dd className="inline">{observation.layout || "未记录布局"}</dd></div>
              </dl>
              {!!observation.uncertainties.length && <p>不确定项：{observation.uncertainties.join("；")}</p>}
            </li>;
          })}
        </ul>
        {!!evidence.failed.length && <p className="mt-3 text-[12px] text-ink-3">{evidence.failed.length} 份样本未完成分析，未作为已观察图片。</p>}
        {!!evidence.unreadable.length && <p className="mt-2 text-[12px] text-ink-3">{evidence.unreadable.length} 份样本不可读。{evidence.unreadable.flatMap((sample) => sample.uncertainties).join("；")}</p>}
      </details>
    </div>
  );
}
