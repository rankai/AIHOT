import { platformQueryParameters } from "./platform-query-data";
import { collectionInputIssue, collectionSeedNavigation, isCollectionOperation, isHotSnapshot } from "./collection-subscription-data";
import { isSocialResearchOperation } from "./social-research-data";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useAdminAction } from "./action";
import type { OperationAccepted } from "./operation-types";
import { PlatformFields } from "./platform-fields";
import { platformLabels } from "./platform-labels";
import { defaultPlatformValues, type PlatformOperation } from "./platform-types";
import { isServiceResearchPlatform, type ServiceResearchParameters } from "./service-research-data";
import { isResearchPlatform } from "./research-platform-data";
import { Button, Card, Empty, Field, Select } from "./ui";
export function PlatformQuery({ operations }: { operations: PlatformOperation[] }) {
  const { run, pending } = useAdminAction();
  const navigate = useNavigate();
  const platforms = [...new Set(operations.map(operation => operation.platform))];
  const [platform, setPlatform] = useState(platforms[0] ?? "");
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries(platforms.map(platform => [platform, operations.find(operation => operation.platform === platform)!.id])));
  const currentOperations = operations.filter(operation => operation.platform === platform);
  const operationId = choices[platform] ?? currentOperations[0]?.id;
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(operations.map(operation => [operation.id, defaultPlatformValues(operation)])));
  const [error, setError] = useState<string | null>(null);
  const operation = operations.find(operation => operation.id === operationId);
  if (!operation) return <Card title="平台查询"><Empty>当前没有开放的平台查询。</Empty></Card>;
  const collectionIssue = collectionInputIssue(operation, drafts[operation.id] ?? {});
  const xSearch = operation.platform === "x-research" && operation.id === "5K5EG87P";
  return <Card title="平台查询" right={<span>{platformLabels[platform] ?? platform}{platform === "youtube" ? "（油管）" : ""} · 当前开放 {currentOperations.length} 项</span>}><form className="space-y-4" onSubmit={async e => {
    e.preventDefault();
    let parameters: ServiceResearchParameters;
    try { parameters = platformQueryParameters(operation, drafts[operation.id] ?? {}); setError(null); } catch (error) { setError((error as Error).message); return; }
    const result = await run<OperationAccepted>("POST", "/api/admin/redfox/queries", { operationId: operation.id, parameters }, { label: "platform-query", revalidate: false });
    if (result) navigate(`/admin/operations/${result.runId}`);
  }}>
    <Field label="平台"><Select aria-label="平台" value={platform} disabled={!!pending} onChange={e => { setPlatform(e.target.value); setError(null); }}>{platforms.map(platform => <option key={platform} value={platform}>{platformLabels[platform] ?? platform}{platform === "youtube" ? "（油管）" : ""}</option>)}</Select></Field>
    <Field label="查询内容"><Select aria-label="查询内容" value={operationId} disabled={!!pending} onChange={e => { setChoices(previous => ({ ...previous, [platform]: e.target.value })); setError(null); }}>{currentOperations.map(operation => <option key={operation.id} value={operation.id}>{operation.label}</option>)}</Select></Field>
    <p className="text-[13px] text-ink-3">{operation.purpose}。查询结果保存到共同任务页，{xSearch ? "符合已收身份、正文与时间要求的作品可显式本地导入；订阅仅 Top / Latest，不自动提高作者权限。" : isSocialResearchOperation(operation) || isServiceResearchPlatform(platform) ? "这些操作仅提供研究与只读快照，不提供导入或绑定动作。" : "只有明确导入才进入信源或材料链。"}{isHotSnapshot(operation) && "手工查询按自选日期提交；带入订阅只保留平台 / 关键词，每轮自动查询 Asia/Shanghai 当天，不沿用这里的日期。"}</p>
    <PlatformFields operation={operation} values={drafts[operation.id] ?? {}} disabled={!!pending} onChange={(name, value) => setDrafts(previous => ({ ...previous, [operation.id]: { ...previous[operation.id], [name]: value } }))} />
    {!operation.fields.length && <p className="rounded-control bg-bg-sunk p-3 text-[13px] text-ink-3">{platform === "redfox-account" ? "此查询无需手工参数，保存账户积分余额快照；不自动填入本地实扣。" : "此查询无需参数，只保存趋势研究快照，不作为文章导入。"}</p>}
    {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    <p className="text-[12.5px] text-ink-3">{isSocialResearchOperation(operation) ? "所选评论 / 关注接口文档基价为 0.06 元/请求，实际实扣未核对。仅显式单次只读查询，不自动翻页、导入或绑定。" : platform === "redfox-account" ? "这 2 项账户查询文档价格为 0，仍受 redfox.account 次数预算控制；账户单位为 points，未完成逐回执实扣匹配。" : platform === "x-research" || platform === "hot-research" ? "所选研究接口文档基价为 0.06 元/请求，实际实扣未核对。仅单次查询，不自动翻页或导入。" : isResearchPlatform(platform) ? "所选接口文档基价为 0.06 元/请求，实际实扣未核对。本入口仅单次查询，按原始分页类型提交，不自动翻页或导入；可在结果中显式本地导入或绑定，采集订阅以已接通操作为准。" : platform === "toutiao" ? "所选今日头条账号 / 作品实时查询的文档基价为 0.06 元/请求，实际实扣未核对。仅显式单次查询；分页参数按所选接口原始类型保留，不自动翻页，主页 token 不是作者 uid。" : platform === "shipinhao" ? operation.id === "MH5YA9DL" ? "视频号分享链接详情为实时查询，文档基价 0.06 元/请求；其余 4 项广域库查询为 T+1、0.04 元/请求。实际实扣未核对；仅单次查询，作品结果可逐条补证后显式本地导入。" : "视频号这 4 项广域库查询为 T+1，文档基价 0.04 元/请求；分享链接详情为实时查询、0.06 元/请求。实际实扣未核对；仅单次查询，作品结果可逐条补证后显式本地导入。" : platform === "kuaishou" ? "快手这 4 项广域库查询均为 T+1，文档基价 0.04 元/请求，实际实扣未核对。仅单次只读查询，不自动翻页。" : platform === "instagram" ? "所选 Instagram 账号 / 帖子接口文档基价为 0.06 元/请求，实际实扣未核对。仅提供单次帖子搜索、账号或详情查询；分页须明确提交原始 paginationToken，不自动下一页或导入。" : platform === "youtube" ? "所选 YouTube 视频接口文档基价为 0.06 元/请求，实际实扣未核对。仅查询视频搜索或详情，描述不等于字幕或转写；下一页须明确提交上游 continuationToken，不自动翻页。" : platform === "bilibili" ? "B站这 5 项优质库接口均为 T+1，文档基价为 0.04 元/请求，实际实扣未核对。仅提供单次查询；b23 短链交由显式作品详情查询核实，不在本地抓取解析。" : platform === "tiktok" ? "所选 TikTok 账号 / 作品接口文档基价为 0.06 元/请求，实际实扣未核对。仅提供单次查询；主页接口未提供分页参数，用户搜索返回 cursor 与请求 offset 的映射尚未核实，不承诺自动采集。" : platform === "xiaohongshu" ? "小红书文档基价为 0.04–0.06 元/请求，具体按所选接口文档估算，实际实扣未核对。" : platform === "douyin" ? "抖音文档多数接口基价 0.04 元/请求，推荐与热门作品接口为 0.06 元/请求，具体按所选接口文档估算；实际实扣未核对。优质/广域库及时效、排序编码按所选描述保留，不会自动换库。" : platform === "wechat" ? "公众号文档基价为 0.04–0.06 元/请求，具体按所选接口文档估算；实际实扣未核对。优质库、广域库与实时接口的数据时效和排序编码各自保留，不会自动换库。" : "微博文档基价为 0.06 元/请求，实际实扣未核对。"}{platform === "redfox-account" ? "免费接口也记录外发尝试与次数，不推断货币换算。" : "本入口使用 query 次数预算；不承诺精确费用。"}</p>
    <div className="flex flex-wrap gap-2"><Button type="submit" tone="primary" disabled={!!pending} busy={pending === "platform-query"}>查询并查看任务</Button>{isCollectionOperation(operation) && <Button disabled={!!pending || !!collectionIssue} onClick={() => { const target = collectionSeedNavigation(operation.id, drafts[operation.id] ?? {}); navigate(target.to, { state: target.state }); }}>带入新采集订阅</Button>}</div>{isCollectionOperation(operation) && <p className="text-[12px] text-ink-4">{collectionIssue ?? "带入信源页的采集任务草稿，不创建、不启用，也不产生外部请求。"}</p>}
  </form></Card>;
}
