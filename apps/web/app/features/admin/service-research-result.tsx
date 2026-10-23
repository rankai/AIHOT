import { collectionPageSummary } from "./collection-subscription-data";
import type { BindingSource } from "./operation-result";
import { Link } from "react-router";
import { XDetailActions } from "./x-detail-actions";
import type { OperationResult } from "./operation-types";
import { researchFactText, researchObject, researchScalarRows } from "./research-platform-data";
import { ResearchFacts } from "./research-platform-result";
import { agentKeyXContextRows, agentKeyXRecordRows, agentKeyXRole, agentKeyXScopeRows, agentKeyXSummaryRows, isAgentKeyXResearch, isAgentKeyWeiboResearch, isAgentKeyBilibiliHotspot, isAgentKeyDouyinHotspot, serviceHotItems, serviceLink, serviceRecordRows, serviceRole, serviceSummaryRows, serviceXMedia } from "./service-research-data";
import { Badge, Json } from "./ui";
import { XAccountBinding, XSearchImport } from "./x-search-import";
import { agentKeyXAccountUsername, isXSearchWork } from "./x-search-import-data";

const hotGroups: Record<string, string> = { ksList: "快手", dyList: "抖音", wbList: "微博", bdList: "百度", bzList: "B站", zhList: "知乎", ttList: "今日头条" };
export function ServiceResearchResult({ result: r, bindingSources }: { result: OperationResult; bindingSources?: BindingSource[] }) {
  if (isAgentKeyXResearch(r.data)) return <AgentKeyXResearchResult result={r} bindingSources={bindingSources} />;
  const summary = r.kind === "query_summary", account = r.data.platform === "redfox", hot = isAgentKeyWeiboResearch(r.data) || isAgentKeyBilibiliHotspot(r.data) || r.data.platform === "hot-research" || isAgentKeyDouyinHotspot(r.data);
  const record = researchObject(r.data.record);
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  const media = serviceXMedia(record);
  const xSearch = r.data.platform === "x-research" && r.data.operationId === "5K5EG87P";
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-words">{summary ? account ? "Redfox 账户记录摘要" : hot ? "热点查询摘要" : "X 研究查询摘要" : researchFactText(r.data.title)}</span><Badge>{summary ? "实际返回事实" : serviceRole(r.kind, r.data)}</Badge></div>
    {summary ? <>
      <ResearchFacts items={serviceSummaryRows(r.data)} />
      {r.data.operationId === "ABJQXHUE" && <p className="text-[12px] text-ink-3">count 包含 1 条线程根推文及本页回复；replyCount 仅是实际收到的回复数。</p>}
      {r.data.operationId === "9Y4EX7RW" && <p className="text-[12px] text-ink-3">count 为返回的聚合组数，不等于各组内热点总数。</p>}
      {r.data.count === 0 && <p className="text-[13px] text-ink-3">此页返回 0 项，不创建文章，不自动翻页。</p>}
      <p className="text-[12px] text-ink-4">分页只按本次实际字段展示，不补造下一页或全量覆盖结论。</p>
    </> : account ? <>
      <p className="text-[13px] text-ink-3">单位：points（积分），不换算货币或填入本地实扣。</p>
      <ResearchFacts items={serviceRecordRows(record, r.kind === "redfox_balance" ? ["totalAvailablePoints", "freeAvailablePoints", "paidAvailablePoints"] : ["points", "reason", "reasonDesc", "gmtCreate"])} />
      {r.kind === "redfox_consumption" && <p className="text-[12px] text-ink-4">本地结果行 #{r.id}，不是供应商唯一请求 ID。同时间、同积分记录逐行保留；目前未匹配本地回执，不代表已完成实扣对账。</p>}
    </> : hot ? <>
      {typeof r.data.group === "string" && <p className="text-[12px] text-ink-3">收到分组：{hotGroups[r.data.group] ?? r.data.group}（{r.data.group}）</p>}
      {Array.isArray(record.plats) && <p className="break-words text-[12px] text-ink-3">聚合组收到的平台：{record.plats.filter((item): item is string => typeof item === "string").join("、")}</p>}
      {r.data.operationId === "9Y4EX7RW" && <p className="text-[12px] text-ink-3">本组实际含 {serviceHotItems(r.data).length} 条热点。</p>}
      {serviceHotItems(r.data).map((item, index) => <div className="min-w-0 space-y-2 rounded-control bg-bg-sunk p-3" key={index}><ResearchFacts items={serviceRecordRows(item, isAgentKeyWeiboResearch(r.data) ? ["desc", "desc_extr", "suggestion", "count", "discuss", "discuss_num", "type", "top_flag", "topic_flag"] : isAgentKeyBilibiliHotspot(r.data) ? ["keyword", "show_name", "heat_score", "goto"] : isAgentKeyDouyinHotspot(r.data) ? ["word", "sentence_id", "hot_value", "view_count", "discuss_video_count", "word_type", "label"] : ["title", "index", "hotCount", "gmtCreate", "hotId", "plat", "platName", "maxHotScore", "maxPosition", "firstRankTime", "latestRankDate", "topOfTheDayTime"])} /><FactLink value={item.url} label="研究搜索落点（不是新闻原文）" /></div>)}
      {(isAgentKeyWeiboResearch(r.data) || isAgentKeyBilibiliHotspot(r.data) || isAgentKeyDouyinHotspot(r.data)) && <p className="text-[12px] text-ink-3">保留上游词条顺序；本接口未确认排名，不把列表位置当作榜单名次。</p>}
      <p className="text-[12px] text-ink-4">热点与搜索落点仅用于研究，不自动成为文章。响应时间字段保留原串。</p>
    </> : <>
      <ResearchFacts items={[["实际收到的身份字段", xSearch ? "用于作品归属，后台重新核实；无独立账号绑定动作" : "只展示，不提供账号绑定"], ...researchScalarRows(r.data.identity), ...serviceRecordRows(record, ["tweetId", "userId", "username", "displayName", "fullName", "rankNo", "typologie", "verified", "followers", "following", "mediaCount", "tweetCount", "createdAt", "likeCount", "retweetCount", "replyCount", "quoteCount", "bookmarkCount", "viewCount"])]} />
      {r.kind === "x_account_rank" && <div className="space-y-2"><p className="text-[12px] text-ink-3">榜单实际指标与说明（未提供的字段不推算）</p><ResearchFacts items={serviceRecordRows(record, ["xFollowerCount", "xScore", "growthAbsolute", "growthPercentage", "statDate", "biography", "countryName", "gender"])} /><FactLink value={record.pictureUrl} label="榜单账号图片媒体（仅链接）" /></div>}
      {Object.hasOwn(record, "replyCount") && <p className="text-[12px] text-ink-4">此条响应的 replyCount 是上游记录指标，与查询摘要中的本页实际回复条数分别保留。</p>}
      {typeof r.data.requestedScreenName === "string" && <ResearchFacts items={[["请求关注范围 handle（不是本条账号 ID）", r.data.requestedScreenName]]} />}
      {["text", "content", "description", "title"].map(key => typeof record[key] === "string" ? <div key={key}><p className="mb-1 text-[12px] text-ink-3">收到的 {key}（纯文本）</p><p className="whitespace-pre-wrap break-words text-[13px] text-ink-2">{String(record[key])}</p></div> : null)}
      {["user", "author"].map(key => record[key] && typeof record[key] === "object" ? <div className="space-y-2 rounded-control bg-bg-sunk p-3" key={key}><p className="text-[12px] text-ink-3">收到的 {key} 作者字段（不使用请求 handle 补身份）</p><ResearchFacts items={serviceRecordRows(record[key], ["userId", "username", "displayName", "verified", "followers", "following", "createdAt"])} /><FactLink value={researchObject(record[key]).avatar} label="作者头像媒体" /><FactLink value={researchObject(record[key]).website} label="作者提供的网站（非作品原文）" /></div> : null)}
      <FactLink value={record.avatar} label="账号头像媒体" /><FactLink value={record.website} label="账号提供的网站" /><FactLink value={record.profileUrl} label="榜单主页定位（不是稳定用户 ID）" />
      {media.map((item, index) => <div className="min-w-0 space-y-2 rounded-control bg-bg-sunk p-3" key={index}><p className="text-[12px] text-ink-3">媒体 {index + 1}（durationMillis 单位毫秒；链接不表示已下载）</p><ResearchFacts items={item.fields} />{item.links.map((link, i) => <FactLink key={i} value={link.value} label={link.label} />)}</div>)}
      {["networksJson", "categoriesJson", "badgesJson"].map(key => typeof record[key] === "string" ? <details className="rounded-control bg-bg-sunk p-3" key={key}><summary className="cursor-pointer text-[12px] text-ink-3">{key} 原始 JSON 字符串（不解析为永久身份或分类）</summary><pre className="mt-2 whitespace-pre-wrap break-all text-[12px] text-ink-2">{String(record[key])}</pre></details> : null)}
      <p className="text-[12px] text-ink-4">ID、handle、根推文与回复角色分别保留。搜索类型 People / Lists 按实际响应展示；高级 from:、OR、回复过滤兼容性未证实。{xSearch ? "发布时间保留原串；能否用于入库由后台核对时区与有效性。" : "原始时间不换算为确定发布日期。"}</p>
    </>}
    {missing.length > 0 && <ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul>}
    {isXSearchWork(r.kind, r.data) && <><XSearchImport result={r} /><XDetailActions result={r} /></>}
    <p className="text-[12px] text-ink-3">{xSearch ? "搜索作品可显式本地导入；采集订阅仅开放 Top / Latest，按已接通能力有界查询。可显式查询同作品详情，不提供人工补 ID 或独立账号绑定；最终归属与入库条件由后台重新校验。" : hot ? "热点定时研究快照在信源页的采集任务中管理，不自动导入文章或绑定来源。" : "本页仅研究与只读快照，不提供导入、绑定、定时采集或同作品补全动作。"}</p>
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="原始字段与研究溯源诊断" />
  </article>;
}
function FactLink({ value, label }: { value: unknown; label: string }) {
  const link = serviceLink(value);
  return link ? <div className="min-w-0 text-[12px]"><p className="text-ink-4">{label}</p>{link.url ? <a className="break-all text-accent" href={link.url} target="_blank" rel="noreferrer">{link.value} ↗</a> : <p className="break-all text-ink-3">{link.value}（未生成链接）</p>}</div> : null;
}


function AgentKeyXResearchResult({ result: r, bindingSources }: { result: OperationResult; bindingSources?: BindingSource[] }) {
  const summary = r.kind === "query_summary", record = researchObject(r.data.record);
  const member = r.kind === "x_followee", account = r.kind === "account", trend = r.kind === "hotspot_research";
  const collection = collectionPageSummary(r.kind, r.data);
  const communityMembers = r.data.operationId === "x.community_members";
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 break-words">{summary ? "AgentKey X 查询摘要" : researchFactText(r.data.title)}</span><Badge>{summary ? "实际返回事实" : agentKeyXRole(r.kind, r.data)}</Badge></div>
    {summary ? <>
      <ResearchFacts items={collection?.rows ?? agentKeyXSummaryRows(r.data)} />
      {collection && <><div className="space-y-2"><p className="text-[12px] text-ink-3">本页已收分页事实（returnedPage）</p><ResearchFacts items={collection.returned} /></div><ResearchFacts items={collection.next} /><p className="text-[12px] text-ink-3">条目包括置顶、转发与研究记录，不等于入库文章数；每轮首页一次、零详情，不自动续页。</p></>}
      {r.data.count === 0 && <p className="text-[13px] text-ink-3">本次返回 0 项；空页不表示已覆盖全部结果。</p>}
      {r.data.operationId === "ABJQXHUE" && <>
        <p className="text-[12px] text-ink-3">count 仅统计本次实收会话项，不包含下方单独保留的会话根帖；conversation_id 不证明直接回复关系。</p>
        {Object.hasOwn(r.data, "root") && <div className="space-y-2 rounded-control bg-bg-sunk p-3"><p className="text-[13px] font-medium">会话根帖（不计入 count）</p><AgentKeyXPost record={r.data.root} /></div>}
      </>}
      {agentKeyXScopeRows(r.data.receivedScope).length > 0 && <div className="space-y-2"><p className="text-[12px] text-ink-3">实收账号上下文（与请求范围分别保留）</p><ResearchFacts items={agentKeyXScopeRows(r.data.receivedScope)} /></div>}
    </> : trend ? <>
      <ResearchFacts items={agentKeyXRecordRows(record, "trend")} />
      <p className="text-[12px] text-ink-3">词条仅用于研究；本接口未返回排名、热度或新闻原文，不以列表位置推算排名。</p>
    </> : member || account ? <>
      <ResearchFacts items={agentKeyXRecordRows(record, account ? "profile" : "member")} />
      <FactLink value={account ? record.avatar : record.profile_image} label="实收头像媒体（仅链接）" />
      <FactLink value={record.website} label="账号提供的网站（非帖子原文）" />
      <p className="text-[12px] text-ink-3">{member ? "此条为实收关系成员，成员身份与请求账号、列表或社区范围分别保留。" : "profile 为实收账号名，rest_id / id 为实收身份；不使用请求值补齐。"}</p>
    </> : <>
      {Object.hasOwn(r.data, "pinned") && <ResearchFacts items={[["本条是否置顶 · pinned", researchFactText(r.data.pinned)]]} />}
      {r.data.pinned === true && <p className="text-[12px] text-ink-3">置顶是独立标记，不代表帖子最新。</p>}
      <AgentKeyXPost record={record} />
      {Object.hasOwn(record, "retweeted") && <div className="space-y-2 rounded-control bg-bg-sunk p-3"><p className="text-[13px] font-medium">转发关系中的原帖引用 ID</p><ResearchFacts items={serviceRecordRows(record.retweeted, ["id"])} /></div>}
      {Object.hasOwn(record, "retweeted_tweet") && <div className="space-y-2 rounded-control bg-bg-sunk p-3"><p className="text-[13px] font-medium">转发内层原帖（独立身份与文本）</p><AgentKeyXPost record={record.retweeted_tweet} /></div>}
      {Object.hasOwn(record, "quoted") && <div className="space-y-2 rounded-control bg-bg-sunk p-3"><p className="text-[13px] font-medium">被引用帖子（独立身份与文本）</p><AgentKeyXPost record={record.quoted} /></div>}
      {Array.isArray(record.roleLimitations) && <p className="text-[12px] text-amber">{record.roleLimitations.filter((v): v is string => typeof v === "string").join("；")}</p>}
    </>}
    {agentKeyXScopeRows(r.data.requestedScope ?? r.data.query).length > 0 && <div className="space-y-2"><p className="text-[12px] text-ink-3">请求范围（不代表响应回显的作者或容器身份）</p><ResearchFacts items={agentKeyXScopeRows(r.data.requestedScope ?? r.data.query)} /></div>}
    {communityMembers && <p className="text-[12px] text-amber">官方仅返回首页约 19 位社区成员；游标不可用于分页，不保证完整名单。</p>}
    <p className="text-[12px] text-ink-3">仅展示本次首页或单对象实收结果与游标，不自动请求下一页。评论、关系成员和趋势词仅供研究；单次查询的普通帖与账号资料可按下方条件显式导入或绑定，不自动执行。首页订阅仅普通作品按实收证据入库，缺范围或身份保留待核实；不代表原生 X 连续主采集。</p>
    <XSearchImport result={r} />
    {account && r.sourceId && <Link className="text-accent text-[13px]" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>查看信源</Link>}
    {agentKeyXAccountUsername(r.kind, r.data) && <XAccountBinding result={r} bindingSources={bindingSources} />}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="原始字段与研究溯源诊断" />
  </article>;
}
/** A single received post; nested roles are composed explicitly by the parent. */
function AgentKeyXPost({ record: value }: { record: unknown }) {
  const record = researchObject(value), context = agentKeyXContextRows(record);
  return <div className="min-w-0 space-y-2">
    <ResearchFacts items={agentKeyXRecordRows(record, "work")} />
    {["text", "display_text"].map(key => Object.hasOwn(record, key) ? <div key={key}><p className="mb-1 text-[12px] text-ink-3">实收 {key}</p><p className="whitespace-pre-wrap break-words text-[13px] text-ink-2">{researchFactText(record[key])}</p></div> : null)}
    {["author", "user_info"].map(key => Object.hasOwn(record, key) ? <div className="space-y-2 rounded-control bg-bg-sunk p-3" key={key}><p className="text-[12px] text-ink-3">本帖实收 {key} 作者字段</p>{record[key] === null ? <p className="text-[12px] text-ink-3">null（上游为空）</p> : <ResearchFacts items={agentKeyXRecordRows(record[key], "author")} />}<FactLink value={researchObject(record[key]).avatar} label="实收作者头像（仅链接）" /><FactLink value={researchObject(record[key]).image} label="实收作者图片（仅链接）" /></div> : null)}
    {context.length > 0 && <div className="space-y-2 rounded-control bg-bg-sunk p-3"><p className="text-[12px] text-ink-3">同一 rest_id 的实收账号上下文（保留 author 原始空值）</p><ResearchFacts items={context} /></div>}
    <FactLink value={record.url} label="由实收帖子和作者身份组成的原文链接" />
    <p className="text-[12px] text-ink-4">text 与 display_text 分别展示，不声明完整长文或 Article 正文。作者、转发外层、内层原帖与引用帖分别保留；不自动加载媒体。</p>
  </div>;
}
