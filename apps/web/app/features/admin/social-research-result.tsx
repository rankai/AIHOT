import type { OperationResult } from "./operation-types";
import { platformLabels } from "./platform-labels";
import { researchFactText, researchObject, researchScalarRows } from "./research-platform-data";
import { ResearchFacts } from "./research-platform-result";
import { socialAuthor, socialLinks, socialPagingRows, socialRecordRows, socialRole, socialTimeRows, socialUnsafeCursor } from "./social-research-data";
import { Badge, Json } from "./ui";

export function SocialResearchResult({ result: r }: { result: OperationResult }) {
  const summary = r.kind === "query_summary", following = r.kind === "social_followee";
  const record = researchObject(r.data.record), author = socialAuthor(r.data);
  const identity = researchScalarRows(r.data.identity), links = socialLinks(r.data);
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  const platform = platformLabels[String(r.data.platform)] ?? "平台";
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-all">{summary ? `${platform}评论 / 关注研究摘要` : researchFactText(r.data.title)}</span><Badge>{summary ? "本次分页事实" : socialRole(r.data)}</Badge></div>
    {summary ? <>
      <ResearchFacts items={socialPagingRows(r.data)} />
      {r.data.count === 0 && <p className="text-[13px] text-ink-3">本次实际返回 0 项，不创建文章。</p>}
      {socialUnsafeCursor(r.data) && <p className="text-[12px] text-amber">收到的 nextCursor 超出安全整数范围，已保留完整原值，不能无损填入数值游标；请核实后再查询，不舍入使用。</p>}
      <p className="text-[12px] text-ink-3">实际返回 count 与上游 count / total 分别保留。根与 data 内的令牌按收到的位置分别展示，不猜选取；null 不转为空字符串，也不据此推断 hasMore 或查询结束。</p>
    </> : <>
      {!following && ["content", "text"].map(key => Object.hasOwn(record, key) ? <div className="min-w-0 space-y-1" key={key}><p className="text-[12px] text-ink-3">评论正文 · {key}（纯文本）</p><p className="whitespace-pre-wrap break-all text-[13px] leading-relaxed text-ink-2">{researchFactText(record[key])}</p></div> : null)}
      <div className="space-y-2"><p className="text-[12px] text-ink-3">实际收到的{following ? "关注列表账号" : "评论者"}身份（独立于作品作者与请求范围）</p>{identity.length ? <ResearchFacts items={identity} /> : <p className="text-[12px] text-ink-4">未收到稳定身份；不使用请求 ID、昵称或 handle 补齐。</p>}</div>
      <ResearchFacts items={socialRecordRows(record)} />
      {author && <div className="min-w-0 space-y-2 rounded-control bg-bg-sunk p-3"><p className="text-[12px] text-ink-3">本条评论者字段 · {author.field}</p>{Object.keys(author.record).length ? <ResearchFacts items={socialRecordRows(author.record)} /> : <p className="text-[12px] text-ink-4">未收到评论者明细。</p>}</div>}
      <ResearchFacts items={socialTimeRows(r.data)} />
      <p className="text-[12px] text-ink-4">时间按上游原值及字段单位展示；相对时间、未知单位或时区不换算为今天，不作为已确定的作品发表时间。</p>
      {record.shareData && typeof record.shareData === "object" && <details className="rounded-control bg-bg-sunk p-3"><summary className="cursor-pointer text-[12px] text-ink-3">本条分享说明（不作为已核实作品原文）</summary><div className="mt-2"><ResearchFacts items={socialRecordRows(record.shareData)} /></div></details>}
      {links.length > 0 && <div className="min-w-0 space-y-2"><p className="text-[12px] text-ink-3">实际媒体 / 头像 / 分享 / 主页地址（只提供链接，不主动加载，也不补作原文）</p>{links.map(link => <div className="min-w-0 text-[12px]" key={link.field}><p className="break-all text-ink-4">{link.field}</p>{link.url ? <a className="break-all text-accent" href={link.url} target="_blank" rel="noreferrer">{researchFactText(link.value)} ↗</a> : <p className="break-all text-ink-3">{researchFactText(link.value)}（未生成链接）</p>}</div>)}</div>}
      {missing.length > 0 && <ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li className="break-all" key={item}>{item}</li>)}</ul>}
    </>}
    <details className="rounded-control bg-bg-sunk p-3"><summary className="cursor-pointer text-[12px] text-ink-3">请求范围与响应范围（不补作实际作者）</summary><div className="mt-3 space-y-3"><div><p className="mb-1 text-[12px] text-ink-4">冻结请求范围</p><ResearchFacts items={researchScalarRows(r.data.requestedScope)} /></div>{Object.keys(researchObject(r.data.receivedScope)).length > 0 && <div><p className="mb-1 text-[12px] text-ink-4">实际响应范围</p><ResearchFacts items={researchScalarRows(r.data.receivedScope)} /></div>}</div></details>
    <p className="text-[12px] text-ink-3">本次只查询评论或关注关系供研究；不自动翻页，不提供材料导入、账号绑定、同作品补全或定时采集动作。</p>
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="原始字段与研究溯源诊断" />
  </article>;
}
