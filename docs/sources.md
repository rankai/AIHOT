# 信源

信源在后台“信源”页管理：新建、试抓一次看看抓到什么、改频率、启停、看失败原因和最近的条目。首次启动时，`industry/sources.json` 里的示范信源会被导入。

## 六种信源

| 类型 | 适合 | 需要 |
|---|---|---|
| `rss` | 有 RSS / Atom 的博客、媒体、Substack、公众号转 RSS 服务 | 无 |
| `web_list` | 没有 RSS 的网页列表（新闻页、博客列表、更新日志） | 写选择器；抓不到时可以经 Jina Reader 渲染（按次计费） |
| `json_list` | 返回 JSON 的接口（GitHub Releases 等） | 写字段路径 |
| `x_search` | X（推特）账号 | 默认 SocialData；合格源可显式切换 Redfox，按请求计费 |
| `mp_account` | 微信公众号 | 默认极致了（Dajiala）；合格源可显式切换 Redfox，按请求计费 |
| `external` | 你自己的脚本推送进来的内容 | `INGEST_TOKEN`，见下文 |

每种信源认哪些配置项写在 `packages/backend/src/sources/config-keys.ts`。填了不认识的配置项，保存会被拒绝、抓取会直接失败并在后台显示原因，不会悄悄退回通用解析。

### rss

```json
{ "feedUrl": "https://example.com/feed.xml" }
```

可选：`summaryIsBody`（订阅里的摘要就是全文）、`allowCategories` / `denyCategories`（按订阅里的分类过滤）。

### web_list

```json
{
  "url": "https://example.com/news",
  "itemSelector": "article",
  "linkSelector": "a",
  "titleSelector": "h2",
  "publishedAtSelector": "time"
}
```

- `parseMode`：`html`（默认，用选择器）、`markdown`（经 Jina 渲染后按 Markdown 读）、`docusaurus_changelog`。
- `detail`：列表缺日期、标题或摘要时抓详情页补齐（`publishedAtSelector`、`titleSelector`、`summarySelector` 等）。
- `allowUrlPrefixes` / `denyUrlPrefixes`：只收某些路径下的文章。

### x_search

```json
{ "query": "from:SomeAccount -filter:replies" }
```

使用 SocialData 的普通账号会被自动合并成一次搜索（每次最多二十几个账号），省请求数。

### mp_account

```json
{ "ghid": "gh_xxxxxxxx", "nickname": "公众号名称" }
```

每个公众号按它的抓取间隔检查一次（查列表按次计费），新文章的正文一并取回。

## 采集订阅与任务

SocialData、Dajiala、Redfox、AgentKey 的主采集共用采集订阅和任务生命周期。X/公众号在后台“信源”页管理，同一个主订阅保存当前供应商、周期和进度；切换供应商先做本地预检，再显式确认，失败不会自动切换另一家。其他平台的独立采集订阅统一在“信源 → 采集任务”（`/admin/sources?view=collections`）管理，Redfox 工作区提供跳转；原订阅链接会重定向并保留选中的订阅。新建任务按后端实际接通的操作能力展示供应商：Redfox 继续提供各已接通操作，AgentKey 当前只在抖音 `OWIBYU1V` 显示，尚未通过的固定路线不会出现在表单。平台查询可以带入未保存、未启用的采集草稿，不产生外部请求。手工采集/付费试抓返回任务，可在任务页查看冻结工具、上游、结果、等待原因及恢复动作；查询任务不会自动绑定信源或导入材料。

已有站点升级须按[部署说明](deploy.md#已有-x公众号站点的一次性切换)显式迁移；重跑 seed 不会覆盖旧源或补做切换。CLI `scripts/collect.ts <sourceId> ...` 对 X/公众号只创建异步任务并返回 runId，由当前 Worker 执行；没有主订阅的源拒绝，停用源的普通定时采集拒绝，CLI 显式手工采集保留原有强制意图。RSS/网页/JSON 仍在 CLI 中立即采集。

Redfox 凭证只配置在后端，`REDFOX_CALLS_ENABLED` 默认关闭，9 个用途预算默认均为 0；填 key 不等于启用。启用采集还需 `COLLECT_ENABLED=true`、相应预算及有效订阅；查询/上传等操作也受 Redfox 总阀及各自用途预算约束。`MODEL_CALLS_ENABLED` 控制模型处理，不能代替 Redfox 外发开关。关闭 Redfox 后保留当前 operation Worker，以便处理已收回执和本地恢复；需要换回原厂时仍走同一主订阅预检，不运行旧 Worker。

AgentKey 凭证只配置在后端，`AGENTKEY_CALLS_ENABLED` 默认关闭；`agentkey.collect`、`agentkey.query` 两个用途预算默认均为 0，缺预算行直接拒绝外发。预检只检查本地配置，不请求 Tool Catalog 或供应商。当前只开放抖音 V5 搜索；页面显示预订工具、TikHub 上游和 credits 估计，实扣缺失不会当作 0。关闭 AgentKey 后保留当前 Worker 处理已收回执的本地解析和收尾；旧 Worker 不了解 AgentKey 契约，不能直接接手在途 AgentKey 任务。

Redfox 独立采集订阅明确选择操作、参数、周期和每轮页数/条数上限，默认停用。开启必要详情补全时须选择该操作已接通的详情目标及上限；汽车之家文章详情另须明确页码，没有默认值。补全沿同一轮保存的列表和项位置继续，预算等待不会重买列表；仅改名称或周期保留当前轮，改变执行条件后须按新配置开轮。账号解析、转写和媒体处理仍由各自工具显式提交，不因开启详情补全自动附加。

三个通用热点接口的定时订阅按 `Asia/Shanghai` 查询运行当天，默认周期 60 分钟，每轮一次请求。日期在任务创建时固定，跨天恢复仍处理原窗口；订阅保存平台/关键词等静态条件，手工查询继续支持自选日期。热点只保存研究快照，不生成文章或来源；每轮研究记录上限及截断情况可见。

结果可逐条本地导入；已有信息足够的作品也可在当前页多选，按默认真实作者归属依次提交，首个失败就停止并保留剩余选择。需要人工核实作者/原文的条目仍逐条处理，新作者默认隔离且关闭全文。已结束、未导入且无实际依赖的结果30天后标记过期，不能继续导入或自动重买；已导入关联、私有资产和待恢复任务另按各自保留规则处理。

切换只接受当前任务实际需要且已确认兼容的能力。旧X关键词/多作者任务默认跳过转发，而Redfox搜索/详情文档缺少可证明相同过滤的字段，因此目前禁止此类切换；不静默取消过滤，也不把新建Redfox搜索订阅冒充旧源转换。公众号切换须明确选择T+1的优质/广域库（默认广域），不会跨库兜底；从未采集过的账号首次最多8条，全部标为历史回填。全部接口、具体输入与限制见[能力清单](redfox-api-inventory.md)。

## 分级、参与方式与全文

- **分级** `tier`：`T1` 官方一手（官网、官方博客、机构）、`T1_5` 官方账号与准官方创作者、`T2` 媒体与个人、`EXCLUDE_MP` 不参与精选。入选门槛按分级不同（`industry/selection.ts`）。
- **参与方式** `participation_mode`：`editorial` 进精选和全部动态；`hot_signal` 不单独展示，只作为“大家在讨论什么”的热度证据；`isolated` 不进任何公开页面。
- **一手** `first_party`：来源是当事方自己。事件页会优先展示一手报道。
- **全文**：`site_fulltext` 决定站内能不能显示全文，`syndicate_fulltext` 决定全文 RSS 能不能带正文。两者**默认都关**，只显示摘要和原文链接；来源明确允许时再打开。公众号、付费墙内容不会因为技术上抓得到就获得全文展示。

## 抓取频率

每个信源有自己的抓取间隔。每天 04:20 会按近 7 天的产出自动调整：产出多的抓得勤，最短 15 分钟；免费信源最长 60 分钟，按次计费的信源最长 120–180 分钟。

抓取失败不推进位置，下次从同一处继续；连续失败的信源在后台标红，每周一会在运营群发一份信源周报（配置了飞书内部群时）。

## 规则：旧文不刷屏

首次发现时原文已经发布超过 48 小时的资料、新信源第一次导入的存量条目、标记为回灌的推送，都按原文时间归档：不进入“今天”，也不推送。这条规则所有入口共用，防止一次性导入历史内容刷屏。

## 外部推送接口

自己写脚本抓的内容，可以推进站里，走和普通采集一样的判重、精选和归组。

```
POST /api/ingest/items
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json

{
  "sourceId": "my-crawler",
  "sourceName": "我的抓取脚本",
  "items": [
    { "title": "必填", "url": "必填", "publishedAt": "2026-10-01T08:00:00+08:00", "author": "可选" }
  ]
}
```

- `INGEST_TOKEN` 在 `.env` 里设置，至少 16 位；不设置时接口一律返回 401。
- 每次最多 50 条；每个客户端每分钟最多 10 次。
- 返回 `{"ok": true, "created": <新建条数>}`。缺标题或网址的条目会被跳过，同一请求里重复的网址只取第一条。
- `sourceId` 不存在时会自动建一个 `external` 信源，默认不进公开页面：到后台把它的参与方式改成 `editorial` 才会出现在站上。
- 条目的 `raw._aihot.backfill` 为 `true` 时按历史回灌处理（不进入“今天”、不推送）。
