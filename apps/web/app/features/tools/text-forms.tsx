import { ToolSubmit } from './tool-submit';
import { Button, Input, Select, Textarea } from "../admin/ui";
import { ToolField as Field } from "./fields";
import type { ToolOptions } from "./types";
type Props = { options: ToolOptions; pending: boolean; submit: (kind: string, body: unknown) => Promise<void> };

export function AiSearchTool({ options, pending, submit }: Props) {
  return <form className="space-y-4" onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); await submit("ai-search", { engine: data.get("engine"), inquiryText: data.get("inquiryText") }); }}>
    <Field label="搜索引擎"><Select name="engine">{options.aiSearch.engines.map(engine => <option key={engine.engine} value={engine.engine}>{engine.label}</option>)}</Select></Field>
    <Field label="研究问题" hint="答案与引用保存在你的执行记录中。"><Textarea name="inquiryText" required maxLength={options.aiSearch.inquiryMaxCharacters} rows={7} placeholder="输入希望调查的问题、范围或比较对象" /></Field>
    <ToolSubmit selection={{kind:"ai-search"}} type="submit" tone="primary" disabled={pending} busy={pending}>提交AI搜索</ToolSubmit>
  </form>;
}
export function TranscriptionTool({ options, pending, submit }: Props) {
  return <form className="space-y-4" onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); await submit("transcriptions", { platform: data.get("platform"), url: data.get("url") }); }}>
    <Field label="视频来源"><Select name="platform">{options.transcriptions.platforms.map(platform => <option key={platform.platform} value={platform.platform}>{platform.label}</option>)}</Select></Field>
    <Field label="视频链接或分享文案"><Textarea name="url" required maxLength={10000} rows={4} /></Field>
    <ToolSubmit selection={{kind:"transcriptions"}} type="submit" tone="primary" disabled={pending} busy={pending}>提交转写</ToolSubmit>
  </form>;
}
export function CommentTool({ options, pending, submit }: Props) {
  return <form className="space-y-4" onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); await submit("xhs-comments", { opusId: data.get("opusId"), dataNum: Number(data.get("dataNum")) }); }}>
    <Field label="小红书作品 ID"><Input name="opusId" required maxLength={options.xhsComments.idMaxLength} /></Field>
    <Field label="评论数量"><Input name="dataNum" type="number" required min={1} max={options.xhsComments.dataNumMax} defaultValue={options.xhsComments.defaultDataNum} /></Field>
    <p className="text-[13px] leading-relaxed text-ink-3">评论任务通常在提交后 24 小时开始查询结果，可在执行记录中持续查看状态。</p>
    <ToolSubmit selection={{kind:"xhs-comments"}} type="submit" tone="primary" disabled={pending} busy={pending}>提交评论查询</ToolSubmit>
  </form>;
}
export function XLookupTool({ pending, submit }: Pick<Props, "pending" | "submit">) {
  return <div className="grid gap-6 sm:grid-cols-2">
    <form className="space-y-4" onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); const kind = String(data.get("kind")); await submit("x-account", { [kind]: String(data.get("account")).trim() }); }}>
      <Field label="X 账号标识"><Select name="kind"><option value="screenName">账号名（不含 @）</option><option value="restId">稳定账号 ID</option></Select></Field>
      <Field label="账号名或 ID"><Input name="account" required maxLength={30} /></Field>
      <ToolSubmit selection={{kind:"x-account"}} inputFromForm={values=>({[String(values.kind ?? "screenName")]:String(values.account ?? "").trim()})} tone="primary" type="submit" disabled={pending}>提交查询</ToolSubmit>
    </form>
    <form className="space-y-4" onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); await submit("x-tweet", { tweetId: String(data.get("tweetId")).trim() }); }}>
      <Field label="X 推文 ID"><Input name="tweetId" pattern="[0-9]{1,30}" inputMode="numeric" required maxLength={30} /></Field>
      <ToolSubmit selection={{kind:"x-tweet"}} tone="primary" type="submit" disabled={pending}>提交查询</ToolSubmit>
    </form>
  </div>;
}
