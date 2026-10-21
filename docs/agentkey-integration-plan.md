# AgentKey 接入完整方案（2026-10-21 修订）

> 状态：最小可用纵向链路已实现，并通过隔离 PostgreSQL、本机 MCP/HTTP 桩和 Web 定向测试验收。当前运行时代码白名单只开放抖音 V5 搜索（`agentkey.douyin.search` / `agentkey.douyin.search.query`，工具 `TikHub/fetch_video_search_v5_api_v1_douyin_search_fetch_video_search_v5_post`）；其余 211 条 AgentKey 路线仍按矩阵证据缺口阻断，21 条 Redfox 路线继续由既有直连接口承担。没有发起真实 AgentKey/TikHub 调用、读取真实密钥、提交、推送或部署。原评审的 6 项问题与 3 项精简见[评审记录](reviews/2026-10-21-agentkey-plan-review.md)。逐项固定路线、输入输出及阻断见[固定路线矩阵](reviews/2026-10-21-agentkey-route-matrix.md)，字段证据及尚缺证据见[输出证据清单](reviews/2026-10-21-agentkey-output-evidence.md)。

## 1. 已确认的范围与供应商分工

本次覆盖 AgentKey 中与**资讯、社交媒体查询和采集**有关的全部平台及用途，按平台分批落地。抖音、头条、小红书、B 站、微博、X、公众号是首批验证顺序，不是最终范围上限。生成图片/视频、上传、转写、营销投放和其他工具类能力不在本次范围。

用户已确认：

1. 社交数据优先使用 **AIHOT → AgentKey → TikHub**。
2. TikHub 缺少、已有 Redfox 直连能承担的能力，继续使用直连。头条搜索/账号作品列表、汽车资讯和通用热点属于当前已知例子。
3. 两者都不能覆盖的相关能力，通过 AgentKey 中其他上游补齐：豆瓣、Facebook、IMDb、优酷以 JustOneAPI 为候选；资讯搜索、网页正文提取以 Serper、Jina 等为候选。
4. 每项业务能力先接一条满足要求的固定 AgentKey 路线；页面显示具体上游。有独有业务能力时单独定义操作，不把所有同义版本接成新的选择框。
5. 本期不重复接入 AgentKey 内的 RedFox 路线。直连 Redfox 保留现有能力，不改用 AgentKey 凭据计费。
6. 已有独立平台采集订阅也支持显式切换，经过预检更新同一订阅、保留历史、停止旧轮；X/公众号主订阅沿用现有显式切换方式。没有自动跨供应商路由或失败兜底。
7. 本轮先打通一条抖音搜索的完整本地链路；真实供应商兼容性、生产操作、提交和部署仍须相应授权，其余路线不会因目录中存在或方案已登记而自动开放。

“固定路线”指经审核的静态绑定，例如 B 站作品搜索绑定一个 TikHub 工具；详情、账号列表、评论各自是不同能力，可以绑定各自的工具。它不是运行时发现最便宜的工具，也不是把名称相似的接口视为等价。

## 2. 范围盘点与 TikHub 覆盖证据

### 2.1 调查方法和数字

2026-10-21 逐项读取 AgentKey 的 social、search、scrape 目录，并将 **1,442 个目录项全部解析到精确工具名及上游**，无元数据读取失败。其中 social 1,406 项，search 32 项，scrape 4 项；共 1,442 个不同规范工具名。这里只读取 find_tools / describe_tool，没有 execute_tool 数据执行。

TikHub 占 social 目录 **1,037 / 1,406 项，约 73.8%**，覆盖 31 个目录分组中的 22 个。该比例包含 App/Web 版本、同义接口、广告及营销接口，**不是本次业务完成率或已验证可用率**。元数据快照见[目录核验证据](reviews/2026-10-21-agentkey-catalog.json)，仅用于审查，不作为运行时工具目录或执行白名单。

| social 目录分组 | 总接口数 | TikHub | 其他上游 |
| --- | ---: | ---: | --- |
| 汽车之家 | 4 | 0 | RedFox 4 |
| B 站 | 104 | 87 | RedFox 8、JustOneAPI 9 |
| 懂车帝 | 4 | 0 | RedFox 4 |
| 豆瓣 | 6 | 0 | JustOneAPI 6 |
| 抖音 | 345 | 329 | RedFox 16 |
| Facebook | 5 | 0 | JustOneAPI 5 |
| 跨平台热点 | 3 | 0 | RedFox 3 |
| IMDb | 18 | 0 | JustOneAPI 18 |
| Instagram | 105 | 93 | JustOneAPI 8、RedFox 4 |
| 快手 | 52 | 38 | JustOneAPI 8、RedFox 6 |
| Lemon8 | 16 | 16 | — |
| LinkedIn | 11 | 8 | JustOneAPI 3 |
| 皮皮虾 | 17 | 17 | — |
| 蒲公英（营销分组） | 56 | 20 | JustOneAPI 16、Rnote 20 |
| 腾讯互选（营销分组） | 6 | 0 | JustOneAPI 6 |
| Reddit | 31 | 28 | JustOneAPI 3 |
| Telegram | 7 | 7 | — |
| Threads | 11 | 11 | — |
| TikTok | 174 | 163 | JustOneAPI 7、RedFox 4 |
| 今日头条 | 17 | 7 | JustOneAPI 5、RedFox 5 |
| X | 73 | 25 | JustOneAPI 4、Sorsa 40、RedFox 4 |
| 微信搜索等 | 23 | 2 | JustOneAPI 21 |
| 视频号 | 33 | 12 | RedFox 7、JustOneAPI 14 |
| 公众号 | 27 | 11 | RedFox 16 |
| 微博 | 67 | 56 | JustOneAPI 11 |
| 小红书 | 76 | 25 | JustOneAPI 15、Rnote 21、RedFox 15 |
| 西瓜视频 | 7 | 7 | — |
| 易车 | 5 | 0 | RedFox 5 |
| 优酷 | 3 | 0 | JustOneAPI 3 |
| YouTube | 45 | 34 | JustOneAPI 7、RedFox 4 |
| 知乎 | 55 | 41 | JustOneAPI 14 |

search / scrape 的 36 个接口均不属于 TikHub，分别来自 Brave、Exa、Parallel、Perplexity、Serper、Tavily、BrightData、Firecrawl、Jina。这些是候选目录，不要求全部接入：本期按资讯搜索、原文提取等实际能力选择固定路线。

### 2.2 业务范围与结果去向

| 用途 | 本期处理 | 结果归属 |
| --- | --- | --- |
| 资讯/作品搜索、账号/频道作品、社区/话题内容列表 | 一次查询；具备稳定参数及停止条件时支持订阅 | 原始响应进回执，解析结果进 operation_results；符合身份和权限条件的内容走材料入口 |
| 作品/文章详情、必要原文补全 | 一次查询或由列表触发有界补全，不默认给每条结果购买全部详情 | 同一平台作品身份、原文 URL、发现时间与材料修订 |
| 账号/频道资料及公开关系、评论与回复、互动统计 | 后台查询；有明确快照用途和有界分页时可定时保存 | 研究/快照结果，不自动成为新闻，不据昵称授予信源权限 |
| 热榜、趋势、推荐与相关搜索 | 后台查询和可调度快照；保留榜单时间和查询窗口 | 研究结果；只有可核验的独立作品才可另行导入 |
| 通用新闻/网页搜索 | 一次查询与关键词订阅；保存语言、地区、时间条件 | 搜索候选不当作完整文章，原站与真实发布者是来源 |
| 网页正文提取 | 显式查询或选定采集流程中的详情步骤 | 复用材料正文、修订和原文 URL，不成为新的发布权限来源 |
| 生成、上传、音视频转写、翻译加工、广告投放/达人选品、播放流下载、刷量或互动写入 | 本期排除 | 不增加入口、用途预算或空状态 |

“只读”按真实行为判断，不能只看 GET/POST 或接口名称。例如目录中的皮皮虾增加播放量接口，即使名称以 fetch 开头，也排除。获取已有原文/字幕与触发转写要区分；只有确认是已有内容读取且有实际采集用途时，才归入查询。生成式答案不能冒充原文。

蒲公英、腾讯互选、B 站花火、抖音星图/DOU+、TikTok 广告等分组中的营销分析/投放能力排除；若其中的内容列表只是普通作品查询的另一条路线，归回已有平台能力，不再建设一套营销后台。独有内容用途需要单独说明，不能因归在 social 目录就自动纳入。

本期不迁移 RSS、网页/JSON 旧采集器、独立监控或现有模型调用。已有 Jina 正文路径也不会被静默改走 AgentKey；管理员选用 AgentKey 原文提取时，才产生 AgentKey 回执与预算。

### 2.3 关键平台的已知覆盖与缺口

| 平台/用途 | 本期路线 | 已核实的接口边界 |
| --- | --- | --- |
| 抖音 | AgentKey → TikHub；直连 Redfox 仍可选 | 有搜索、账号作品、详情、账号和评论等；搜索版本的日期、排序和游标不同，不能把 Redfox 的日期范围/精准匹配无条件带入 |
| 小红书 | AgentKey → TikHub | 有笔记搜索、账号笔记、图文/视频详情、账号、评论和话题；搜索采用 page + search_id + search_session_id，非 Redfox offset |
| B 站 | AgentKey → TikHub | 有搜索、账号视频、视频详情、账号、评论和热榜；App/Web 的排序和分页字段不同，选择满足业务条件的一条路线 |
| 微博 | AgentKey → TikHub | 有搜索、时间线、详情、账号、评论和榜单；已查 App 搜索未声明 Redfox extParam 认证过滤，使用该条件的切换不能直接放行 |
| X | AgentKey → TikHub 为优先候选 | 有搜索、时间线、详情、账号、评论和趋势；keyword/cursor/search_type 的存在不能证明兼容全部高级搜索语法或 X Article 正文 |
| 公众号/微信搜索 | AgentKey → TikHub | 有账号文章、详情、账号、评论、统计和微信搜索；列表可翻页，但 page_size 文档说明可能被微信忽略，不能承诺远端每页精确条数 |
| 今日头条 | 搜索/账号作品继续直连 Redfox；TikHub 承担经核实的详情、账号、评论查询 | TikHub 当前 7 项中没有关键词搜索和账号作品列表；不添加虚假的 AgentKey 搜索/列表选项 |
| 汽车之家、懂车帝、易车、通用热点 | 继续直连 Redfox | 当前 AgentKey 目录中相应分组只有 RedFox，没有 TikHub，不重复中转 |
| 快手、视频号、Instagram、TikTok、YouTube、知乎、西瓜 | AgentKey → TikHub 优先 | 目录包含多种内容查询；稳定作者 ID、正文、时间及分页必须按所选工具核实，不能跨平台共用 ID 假设 |
| Reddit、Telegram、Threads、Lemon8、皮皮虾、LinkedIn | AgentKey → TikHub 优先 | 以目录实际提供的搜索、频道/账号列表、详情、评论等为范围；没有的用途不补空实现 |
| 豆瓣、Facebook、IMDb、优酷 | AgentKey → JustOneAPI 候选 | 当前目录没有 TikHub。豆瓣有影评/评论/热映；Facebook 有帖子搜索/列表/评论；IMDb 有资讯和作品资料；优酷有视频搜索/详情/账号 |
| 通用资讯搜索、原文提取 | AgentKey → Serper / Jina 候选 | 搜索使用确定的语言/地区/时间条件；正文限公开 URL，排除任意 Cookie、代理、截图及生成式加工选项 |

对于 TikHub 无法承接的既有任务，预检拒绝切换、原供应商继续有效。上述“继续直连”是配置上的明确分工，不是在某次 AgentKey 失败后自动再调用 Redfox。

### 2.4 精确工具与输出证据

逐项固定路线、必需输入、已证实输出、分页/末页、恢复分类以及查询/导入/定时/切换边界，统一见[固定路线与输入输出矩阵](reviews/2026-10-21-agentkey-route-matrix.md)。该矩阵按业务能力覆盖全部相关平台，但不等于 1,442 个目录项都可执行；不在矩阵中逐项固定用途的目录项不是运行白名单。矩阵中的 `doc`、`sample`、`gap` 分别表示官方文档、公开样例和仍未闭合的证据状态，`gap` 不会因本方案新增了阻断规则而被提升为支持。下列工具只是代表性摘录，完整绑定以矩阵为准。

已核对的代表性工具包括：

| 能力 | 精确 AgentKey 工具 | 元数据 credits/次 |
| --- | --- | ---: |
| 抖音搜索候选 V5 | TikHub/fetch_video_search_v5_api_v1_douyin_search_fetch_video_search_v5_post | 0.2 |
| 抖音带筛选搜索对照 V1 | TikHub/fetch_video_search_v1_api_v1_douyin_search_fetch_video_search_v1_post | 0.2 |
| 小红书笔记搜索 | TikHub/search_notes_api_v1_xiaohongshu_app_v2_search_notes_get | 2 |
| B 站 App 搜索候选 | TikHub/fetch_search_all_api_v1_bilibili_app_fetch_search_all_get | 0.2 |
| 微博搜索 | TikHub/fetch_search_all_api_v1_weibo_app_fetch_search_all_get | 0.2 |
| X 搜索 | TikHub/fetch_search_timeline_api_v1_twitter_web_fetch_search_timeline_get | 0.2 |
| 公众号文章列表 | TikHub/fetch_account_articles_api_v1_wechat_mp_v2_fetch_account_articles_post | 2 |
| 公众号 H5 详情 | TikHub/fetch_article_detail_h5_api_v1_wechat_mp_v2_fetch_article_detail_h5_post | 2 |
| 头条文章详情 | TikHub/get_article_info_api_v1_toutiao_app_get_article_info_get | 0.2 |
| 网页搜索 / 资讯搜索 | Serper/search / Serper/searchNews | 0.2 |
| 网页正文 | Jina/readUrlPost | 0.7 |

已进一步读取 TikHub 官方 OpenAPI/接口说明，以及 JustOneAPI 四个平台的 32 份 OpenAPI 与公开样例查询结果，其中 30 份取得样例。逐项字段、来源、缺口与运行验证见[输出证据清单](reviews/2026-10-21-agentkey-output-evidence.md)。目录/样例都不等于所有字段必填或账户可用证明；不得将 Redfox fixture 改个 provider 后当作 TikHub 响应证据。

本轮已经明确、实施时直接遵循的边界：

- 抖音 V5 的作品/作者/原文及分页字段已明确，但不支持 V1 的日期/排序筛选；小红书图文详情可读取视频笔记内容和封面，不默认追加购买播放地址。
- B 站 App 搜索用返回游标，不是页码；公众号列表忽略 page_size，详情可通过 bizUin、user_name、mid/idx/link 提供身份映射，通过秒级时间戳与正文类型区分完整文章和摘要。
- 视频号 TikHub 路线可返回明文作品 ID 与 finder username，不能把 Redfox 某路线缺作者 ID 的结论推广到 TikHub；CDN 地址不能当原文链接。
- YouTube 账号列表仅首页有频道元信息、视频描述为空；按需补详情。Threads 多个接口分页无效，只能单页快照；IMDb 资讯样例有游标但入参不接收游标，不能假定可以翻页。
- Facebook 的帖子、作者、原文和正文样例已取得；豆瓣影评列表只有摘要/昵称，优酷详情样例作者 ID 可空，不能据此自动绑定作者。
- Serper 搜索摘要不是正文、相对日期不是精确发布时间；Jina publishedTime 可能来自 Last-Modified，不能不辨来源就改写新闻发布时间。

每个将开放的业务操作记录选定工具、参数组合、输出/原文、分页停止条件、结果去向、估价来源及具体缺口。尚缺官方字段说明的先补供应商说明或公开/脱敏样例；不能把“文档缺口”一概等同于“必须付费试调用”。凭据/当时可用性、端到端大整数保真、真实分页与本次实扣才属于另行授权的运行验证。缺少当前任务必需语义时不开放相应切换；可选头像等缺失不阻断已满足用途的查询。

当前候选 V5/App 等不因版本较新就优先：先比较当前任务必需过滤、正文和分页，再固定路线；同义版本不一并实现。有独有条件的操作单独定义用途，不能运行时偷偷换版本。

## 3. 接入协议与外部边界

依据 [AgentKey 当前 API Reference](https://docs.agentkey.app/api-reference/introduction.md)、[执行工具说明](https://docs.agentkey.app/api-reference/execute-tool.md)、[鉴权](https://docs.agentkey.app/authentication)，后端 Worker 使用工具目录的 MCP Streamable HTTP： https://api.agentkey.app/v1/mcp ，以 Bearer API Key 鉴权。官方现已公开另一套 Scenario REST（POST /v2/ops/{method}，固定输出、支持路由设置）；本方案维持已确认的固定 Provider/Operation 工具路线，不并建第二条执行生命周期，也不混用两个调用面的输出合同。

拟用配置项为 AGENTKEY_API_KEY、AGENTKEY_MCP_URL、AGENTKEY_CALLS_ENABLED；默认关闭。遵循现有后端凭证设施，只补配置描述及示例，不把 key 写入表单、信源 JSON、回执、日志、前端或 fixture。正式端点限定官方 HTTPS 主机，测试仅使用明确配置的本机桩；凭据不得随重定向发送到其他主机。

find_tools / describe_tool 用于接入核验，不进入每轮采集。免费的账户工具实际经 execute_tool(name="agentkey_account") 调用；它也是外部请求，只有明确的管理员检查动作才使用，不随页面加载或预检自动执行。

AgentKey 当前[路由说明](https://docs.agentkey.app/concepts/auto-failover.md)已明确：execute_tool 执行指定工具，**不自动换上游**；自动故障切换属于 Scenario Methods。本地冻结工具绑定；后台显示绑定上游与回执 provider，正常时应一致，异常不一致或缺字段才提示核对。不增加自动兜底或额外路由校验平台。

## 4. 复用架构与状态归属

不新增业务表，不新增状态枚举、Provider Registry、插件运行时、工作流引擎或工具目录数据库。新增的是 AgentKey 的协议适配、实际使用的工具契约/解析器，以及现有入口里的明确 provider 分支。

```mermaid
flowchart LR
  U[后台查询 / 采集订阅 / 显式切换] --> S[既有订阅与创建命令]
  S --> R[operation_runs 冻结本轮执行]
  R --> E[既有执行分发]
  E --> A[Redfox / SocialData / 大加辣 / AgentKey 适配器]
  A --> P[paidRequest：占位、attempt、预算]
  P --> W[供应商调用]
  W --> RAW[回执保存原始响应]
  RAW --> PARSE[供应商解析与证据校验]
  PARSE --> Z[operation_results]
  Z --> M[既有身份、权限与材料提交]
```

| 事实 | 唯一权威 |
| --- | --- |
| 当前供应商、订阅配置、周期、启停、配置版本、下次调度与 active_run_id | collection_subscriptions；绑定主信源的权限仍读 sources |
| 某轮冻结的 provider、操作、工具、参数基线、执行版本、步骤和分页进度 | operation_runs；pg-boss 只负责唤醒，不另存业务状态 |
| 每次外发尝试、未知结果、原始响应、计费证据 | receipts / receipt_attempts |
| 已解析结果、材料关联与导入溯源 | operation_results |
| 作者/站点身份、隔离和发布权限 | sources / source_account_bindings 及现有来源规则 |
| 作品身份、原文 URL、修订与发现时间 | articles / article_revisions / article_discoveries / article_identity_aliases |
| 次数限制 / 可信货币报价 | budgets / service_prices；credits 另放现有 usage JSON |

provider=agentkey 表示向 AgentKey 发起调用并消耗其预算；TikHub 只是所绑定工具的上游，不额外建一个 AIHOT 直连 provider。只有将来实际直连 TikHub，才按另一适配器和凭证边界讨论。

## 5. 业务能力、参数与版本的最小模型

### 5.1 供应商中立描述

对实际发生供应商复用的操作使用按平台组织的静态业务映射，例如“抖音作品搜索”“B 站账号作品”“网页资讯搜索”；具体名称在功能模块定义，不建设可配置执行引擎。

每个业务操作的各 provider 变体提供自己的字段、默认值、校验、价格说明、分页、详情能力及参数翻译。后端生成 DTO，前端显示；现有 PlatformOperationDescriptor 只有一份 Redfox fields/price/detailCapabilities，需要将这部分落实到所选 provider 变体，不能只加 id/label 下拉项。

现有 Redfox 不透明 operationId 仅作为供应商操作标识/旧入口别名。对本次有共享语义的操作，在边界解释成业务能力；其余已接入 Redfox 操作保持原状，不全量重命名或迁移。新订阅按业务操作加 provider 保存；存量配置按原 contract_version 解释，旧 run 的输入、逻辑键、创建幂等摘要不得重写。旧创建命令重放仍与旧摘要比较，不能因别名规范化破坏幂等。

同一业务操作可以有 provider 特有参数，但切换必须显式翻译并列明差异。丢字段、改默认值或把 account token 当作者 ID 都不是“兼容”。

### 5.2 冻结与恢复

复用 subscription/run 的 contract_version 作为执行契约权威。run.input 冻结本轮 window、业务参数、非敏感 endpoint 及实际需要的工具绑定（列表、详情等）；后续页的 cursor、search_id 等放在既有 progress，并在每次外发前保存本次实际请求摘要。

不再并列增加 toolContractVersion、schemaSha256、parserVersion、重复 gateway 或没有多账号需求的 accountScope。schema hash 可作开发证据，价格核验日期可作估价来源，都不成为第二套执行版本。

兼容的 parser 修正复用已有回执和契约；修复发生在尚未完成的处理步骤。不能因此修改付费身份、重新购入响应，或自动覆写已经完成的材料。确有不兼容旧输入的变更，保留旧版本解释或进入现有 needs_review，由明确迁移处理。

### 5.3 回执逻辑身份

每个付费请求必须包括：

- service：agentkey.collect / agentkey.query，按实际用途；
- model：精确 Provider/Operation 工具；
- identity：稳定的本轮 window、业务请求位置（页面、作品详情或查询步骤）、规范 endpoint 和真正外发的非敏感参数；精确工具已由 model 进入逻辑键，不再维护另一份工具名；
- requestSummary：可恢复/诊断的请求与契约溯源，不含密钥；
- subject：仅是关联信息，不能代替 identity 中的轮次。

沿用现有 window 生成方式：同一命令/本轮的恢复不变，新调度轮次和显式新查询使用新 window。generation 随恢复改变，不能放进付费身份。页码/游标和详情作品 ID 必须区分不同请求；不能仅按关键词缓存所有未来轮次。

恢复优先消费 run 关联的 received/completed 响应。重新发布 parser 或更新价格不改变已发请求身份；真正改变工具、外发参数或请求语义时创建新的明确执行，旧 run 仍按原契约处理。不能重新用当前订阅和最新默认值拼出另一个请求。

## 6. AgentKey transport、响应与错误证据

AgentKey 功能内模块承担配置、MCP client、工具契约/参数、结果解析、步骤执行。按实际规模拆文件，不为每个目录工具生成类，也不复制 Redfox 的整个目录管理体系。

沿用官方 @modelcontextprotocol/client；运行时依赖声明在 backend，不能依赖仓库根的测试依赖。SDK 管协议、会话和 SSE，本地只补必要的有界响应记录、鉴权、超时与清理，不自建 MCP 栈。

一次外发的顺序必须是：

1. 在既有业务锁和资格检查下，由 paidRequest 持久化请求占位、attempt、预算与回执关联。
2. 仅在 onReceipt 的 kind=call 分支检查外发开关/凭证并允许发送；reuse 不因关阀失效。连接失败也保留本次尝试，不绕回执另行发送。
3. SDK 调用固定 execute_tool，传入经校验的精确工具和参数；会话初始化不等于购买工具数据。
4. 捕获有界、去除凭据的工具响应或已确认错误 envelope，先返回给 paidRequest 保存，再做业务解析/错误分类。
5. transport 关闭失败单独记录，不覆盖已经取得的结果。SDK 不能隐藏重发付费 POST；SSE 续接已有结果与重新 execute_tool 区分。

解开 MCP content 后，AgentKey 成功 envelope 明确含 provider、category、took_ms、credits_charged、data；data 是上游原 payload。TikHub/JustOneAPI/Jina 的内层结构分别解析，不用统一 data.data 猜测。Jina JSON 明确还有自己的 code/status/data，Serper 结果则是 organic/news 等字段。所有原始内容先落回执，字段证据见输出清单。

需要覆盖 HTTP 失败、JSON-RPC error、MCP isError=true、上游业务拒绝和正常数据五种层次。AgentKey 工具错误有 error/code/error_type；200 也可能返回 disabled=true，表示 Console 关闭该分类，不自动重试或绕路。402 insufficient_credits 文档明确没有发起上游调用。TikHub 外层 code 与平台内层 status_code、JustOneAPI 的 code=0 等不能混为一谈。已收到完整错误 envelope 的，先保存响应再分类，不能让 SDK 普通异常把它误变成 unknown；也不能仅凭 HTTP 200 当作业务成功。[MCP 错误规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling)区分协议错误与工具错误。

若 SDK 在抛错前已取得完整 envelope，使用 transport 的有界响应记录保留可核验原文，不做业务 parser；真正没有完整结果才是结果未知。收到完整但无法识别的 payload 仍是 received + 人工核对，不自动重买。响应大小超限导致中断时保留具体限制原因，已知确定性超限不得进入反复自动重发。

**大整数身份**：优先使用文档明确的字符串 ID；使用 JSON text 时无损解析原始数字字面量。SDK structuredContent 已经过普通 JSON.parse，若只剩超安全范围数值，不能再 String() 冒充原 ID。无法恢复精确身份则阻止绑定/材料导入，保留结果待核实。不通过编写整套 JSON-RPC/SSE 实现解决此问题。

### 6.1 错误响应的现有字段落库契约

当前 `ProviderRejectedError` 只携带 `status` 与 `retryable`，`paidRequest` 捕获后只保存截断的错误文案，会把已收到的错误 envelope、请求号、usage 和 cost 丢掉。实施时必须复用 `receipts` / `receipt_attempts` 已有列，不新增表或状态：

| 步骤 | 必需行为 |
| --- | --- |
| 构造明确拒绝 | `ProviderRejectedError` 除原字段外携带可选、已脱敏且有界的 `response`、`requestId`、`usage`、`cost`，语义与成功 `CallOutcome` 的对应字段一致；仅调用函数抛出该错误时才使用既有 failed |
| 捕获拒绝 | 在同一事务更新原回执和本次 attempt：保留错误文案，同时写入 `response`、`request_id`、`usage`、`cost/currency/cost_basis`；不能只保存 message。call 正常返回完整响应时仍按既有流程先落 received |
| 先存证据再分类 | HTTP 400/401/402/429、HTTP 200 + `isError`、JSON-RPC error、`disabled:true`、TikHub/JustOneAPI 业务错误都先保存完整可用 envelope，再判定拒绝或待核实 |
| 现有状态语义 | 抛错型明确拒绝使用既有 failed；完整响应由 adapter 分类，可重试 429 保持 received 并走 `retryReceivedRejection` 的有界重试。无法可靠分类的完整响应进入既有 received + needs_review，不得改写成 unknown |
| 完整响应后解析失败 | `paidRequest` 已把完整响应标为 `received`；parser、身份、权限或字段校验失败保留该回执，修 parser 后本地恢复。禁止调用 `rejectReceivedResponse` 让同一响应变成可重新购买 |
| 真正结果未知 | 只有未取得完整 envelope、连接中断或进程在响应落库前停止才使用既有 `unknown`，再按只读步骤规则最多自动放行一次 |
| 402 insufficient_credits | 保留本地 attempt、完整错误 envelope 和“官方说明未发起上游调用”的证据字段；缺失实扣继续为未知，不把 `chargedCredits` 写成 0 |
| 迟到/超限响应 | 响应与可提取 usage/cost 归原 attempt；已知响应大小限制或 transport 收尾失败不能覆盖已落库结果，也不能触发另一笔无依据的请求 |

错误 envelope 的保存只解决证据丢失；是否可查询、可导入、可切换仍由矩阵中的能力状态决定。失败 envelope 不生成空结果，也不推进步骤。

执行开关与超时遵从具体工具。公众号系列文档要求约 30 秒；JustOneAPI 官方建议 120 秒、至少 60 秒；同时受本地总时限和取消规则约束，不给所有工具套同一超时。官方“一次 execute_tool 等待结束再下一次”的指导，不等于已证明同一 key 全局并发只能为 1；复用现有 Worker 并发及 429 退避，不预建全局锁或专用队列。

## 7. 两类订阅、查询与材料提交闭环

### 7.1 真实入口

| 路径 | 必须补齐的点 |
| --- | --- |
| 独立平台订阅 | platform-subscriptions 的 provider 校验、业务契约、创建/编辑/显式切换、手工运行、到期扫描；调度不能再由 Redfox 总阀统管所有 provider |
| X/公众号主订阅 | collection-commands 显式分发 AgentKey，不让非 Redfox 自动落入 native；native-scheduling 按实际 provider 检查可用性，保留 SocialData 批量行为 |
| 主信源手工/强制执行及维护入口 | 与定时调度调用相同领域命令，不能 CLI/force 绕过 provider、预算、资格或当前权限 |
| 一次查询/表单预览 | 选中的 provider、业务操作和参数进入统一查询命令；创建 run 后由 Worker 执行，预览属于可能收费的显式查询 |
| 执行与恢复 | executeOperationStep、只读步骤判定、recoverOperations 扫描范围及外发许可都显式认识 AgentKey |

查询与采集共用 run/receipt/result，但用途不同：一次查询不创建定时订阅；订阅决定周期和下一轮。信源决定内容归属与权限，不是 API 商；同一作者可由不同订阅发现，材料仍按平台作品身份去重。

### 7.2 适配器证据与共享材料入口

现有 Redfox 导入器会验证 run.provider、operation_key、receipt.model、原始记录和来源。AgentKey 不能直接调用这些函数并删掉校验，也不能复制整套导入实现。

最小调整为：在对应平台功能内，将“供应商响应/回执证据校验”与“平台身份、权限、材料提交”分开。Redfox 和 AgentKey 各自提供经过校验的材料候选与溯源，复用确实相同的账号绑定、URL/作品身份、隔离、upsertMaterial、queueProcessing、结果关联和审计。抖音、头条、小红书、B 站、微博及 X/公众号分别保留各自身份规则，不用一个模糊通用 ID 类型统包。

材料、result 关联、任务步骤推进、该阶段回执完成及必要入队在已有事务边界内共同提交。只有响应落库或 run completed 不算完成验收：必须看到目标材料/研究结果、正确历史与权限、active_run_id 释放及下一次调度安排。

跨供应商同一作品沿用已有平台作品键和 URL 规范化去重；直连与网关保留各自发现/回执溯源。未知作者留待核实或使用现有隔离来源，不能通过同名昵称继承非隔离信源权限。切换不扩大全文授权。

对新增平台，在现有 source_account_bindings / article_identity_aliases 中使用有证据的稳定 ID 类型，不新增身份表。网页搜索结果按真实发布站点/作者及现有来源规则归属；无法核实的候选留在结果中，人工选择符合原文范围的已有来源或新建隔离来源。Serper、Jina、TikHub、AgentKey 都不是新闻作者。

评论、关系、榜单等有自己的结果 kind 和固定 parser；不能统一塞成“任意 JSON 可自动导入文章”。详情补全保留首次发现时间，按既有回填/修订规则处理；已隔离/停用来源和人工修改仍优先。

### 7.3 成功空结果的步骤结果

现有 `advanceRun()` 要求当前回执至少关联一条 `operation_results`。因此每个成功的 AgentKey `execute_tool` 请求，无论是否有业务对象，都必须先写入既有 `kind="query_summary"`：

- 搜索零命中、评论空页、合法的最终空页、以及详情请求成功但没有返回目标对象，均写 `count=0`；详情“没有目标对象”仍需有明确合法的不存在语义，不能把未知结构当空结果。
- summary 按实际能力保存查询窗口、页码或 cursor、`nextCursor`/末页状态、停止原因和步骤序号；这些字段有证据时才写，不以 `null` 冒充尚未核实的字段。
- summary 必须关联当前回执，和步骤推进在同一事务提交；它是步骤完成与实扣证据，不进入新闻材料，也不生成发布权限。
- 非法 payload、认证/额度/业务拒绝、parser 失败或 transport 不完整都不是合法空结果；不得写 `count=0` 后推进。修复 parser 时复用原回执，超时未知仍按 §9 处理。
- 不新增 result kind、空结果状态表或供应商专属结果表。

## 8. 次数预算、积分与金额

### 8.1 许可与预算

AGENTKEY_CALLS_ENABLED 默认 false；定时/手工采集外发同时受 COLLECT_ENABLED 控制。纯只读查询依照已认证的后台显式动作，不要求为了查询启用整个采集调度。普通读者访问、能力目录、切换预检、页面打开都不能触发数据工具。

先增加实际用到的 agentkey.collect / agentkey.query 预算，默认 0；AgentKey 缺预算行拒绝外发。复用 paidRequest 的每次 attempt 次数计数和并发预算锁，保持其他存量供应商缺行语义不被顺带改变。

分页、详情、显式重查及重试分别建立受预算约束的 attempt；本地解析/复用响应不扣次数。沿用现有保守口径：已获准尝试即计本地次数，即使随后连接失败，也不凭异常猜测退款。会话初始化不再额外计一次 execute_tool。后续若本期某只读用途确实只有异步查询接口，才为实际轮询增加用途预算；不预建生成/上传预算。请求发出但结果未知也计入本地次数。

### 8.2 估价、实扣与现有表

| 数据 | 落点及含义 |
| --- | --- |
| credits 报价 | 经核实的工具契约及来源/日期；不放进只允许 CNY/USD 的 service_prices |
| 每次估计积分 | receipts / receipt_attempts 既有 usage JSON 中的 estimatedCredits，外发占位时保存快照 |
| 供应商报告实扣 | 从已保存 envelope 的 credits_charged 等已核实字段取得 chargedCredits；缺失为未知，数值 0 是有效实扣 |
| 可信 AgentKey CNY/USD 报价 | service_prices，按 agentkey 用途 + 精确工具存储；不把嵌在上游文档里的直连美元价当作网关价 |
| 金额 cost | 有可靠依据才写既有 cost/currency/cost_basis，estimated 与 actual 分开 |
| 账单核对 | 使用 AgentKey 返回及 Console 证据；积分实扣不等于人民币账单已对账 |

最小必要的回执补强：在 paidRequest 现有占位/attempt 写入处支持可选估价 usage 快照，响应到达时合并实扣而非丢失估价。无需新表、新账本或第二个付费包装器。pending/unknown 也保留当时估价；价格变化不重算历史。

迟到响应必须归入原 attempt，保留原始响应及能提取的实扣证据；即使原 attempt 已被释放，也不能只保存 response 却丢 usage，或让迟到结果覆盖当前 attempt/业务状态。汇总按 attempt 计数和金额口径，不能把 receipts 头记录与同一次 attempt 再加一次。仅有当前回执值不足以展示重试总成本。

次数预算不是金额/积分硬上限。[当前官方计费说明](https://docs.agentkey.app/concepts/subscription.md)明确先扣月度额度、再扣预购 extra credits，二者耗尽返回 402，不自动产生套餐外收费；撤回旧 overage 断言。账户总余额由其他任务共享，也不能代替本次任务上限；计量型工具报价可能只是最低值。只有 credits 时显示 credits，不能伪造人民币汇率或用 0 代表未知金额。若以后授权“最多 X 元”的真实联调，须先取得可核实的供应商硬限额或可证明的固定价格调用界限；证据不够就不开始，不能把估价称为硬上限。本期不建设金额预占/汇率/账单引擎。

## 9. 错误、恢复与终态归属

复用既有状态，不为 MCP 再建立状态机：

| 情况 | 回执事实与任务动作 |
| --- | --- |
| 参数、工具绑定、本地必需能力或凭证/开关不满足 | 外发前阻止；不消耗一次真实调用；按现有错误/等待界面提示 |
| 预算未配置、为 0 或已满 | 不外发，使用现有预算等待/阻断语义 |
| 已收到认证/参数/工具不存在等明确拒绝 | 原 envelope、请求号及可得 usage/cost 与错误文案保存到原 receipt/attempt，使用既有 failed；run 进入 needs_review 或明确终态，不自动重发，不推断一定未收费 |
| AgentKey 明确 402 insufficient_credits 或 disabled=true | 不重试、不绕开分类关闭；402 的无上游调用事实按官方语义记录，本地 attempt 仍保留；不将缺失实扣字段写成 0 |
| 已确认的可重试只读限流 | 先保存完整拒绝 envelope 与可得 usage/cost，再按既有 retryReceivedRejection、retry_count、limits.retries 和 next_attempt_at 有界延后；有 Retry-After 时采用它 |
| HTTP 200 + isError、JSON-RPC error、上游业务失败 | 依据已核实语义落 failed 或 received；无法分类则 received + needs_review，不丢原文、不当作未知超时 |
| 已有完整响应但 parser/身份失败 | received 保留；修复后本地恢复，不能用 rejectReceivedResponse 触发重新购买 |
| 真正未收到完整结果、进程中断 | pending 过期转 unknown；已明确的同步只读步骤等待 30 分钟后最多自动放行一次，下一次仍受预算；再次未知交人工 |
| 本期查询如果需要远端任务提交 | 提交未知不自动重发；保存稳定 task ID 后才轮询，已核实的只读轮询按读取策略处理 |
| 配置/供应商切换后旧轮返回 | 回执/attempt 保留费用与原文；旧轮失去提交资格，不写新游标/材料、不改投新供应商 |

AgentKey 恢复使用**精确静态分类**，不按前缀或供应商自称的 GET/POST 推导，也不从能力目录或预算用途动态生成。业务 operation key 为 `agentkey.<platform>.<capability>`，同步步骤 key 为 `agentkey.<platform>.<capability>.query`；矩阵逐行登记当前允许打开的精确值。代码中的扫描集合、只读集合和分类 lookup 必须是显式字面量，并与矩阵完全一致：

| 分类 | 判定与恢复行为 |
| --- | --- |
| `readOnly` | 仅当前矩阵标为同步只读的精确 AgentKey step/operation 对。它只决定结果未知时的恢复策略，不代表该工具已通过输入、输出、身份、导入和分页预检；`unknown` 超过 30 分钟后沿用现有规则最多自动放行一次，下一次 unknown 交人工 |
| `readOnlyPoll` | 只可用于未来确需查询远端异步任务、且 operation 与 step 静态登记一致的路线；`run.progress` 已有稳定 task ID 才是只读轮询，缺 task ID 一律 needs_review |
| `remoteSubmit` | 创建远端任务的提交；未知结果绝不自动重发，不因目的是采集而视为幂等 |
| 未登记或 step/operation 不配对 | 默认 needs_review，不自动释放、扫描重排或重新购买 |

现有 Redfox 精确白名单、SocialData `x.page`、大加辣 `mp.list`/`mp.body` 的分类保持不变；本次只增加矩阵中明确登记的 AgentKey 项。`recoverOperations()` 的 operation-key 扫描也只加入静态登记值，不允许 `operation_key LIKE 'agentkey.%'`。当前首批选择均为同步只读路线，所以没有 `readOnlyPoll`/`remoteSubmit` 实例；这两类规则只在未来实际选择异步工具时登记，不预建队列或状态。

外发关阀后，已收响应的本地解析、材料提交和无资格旧轮收尾继续工作；不能在进入 paidRequest 前就因开关退出。新页面/新详情仍禁止外发，保留可恢复进度。发生停止、失败或完成时按既有所有者释放订阅占位；needs_review/waiting 保留等待语义，不靠周期扫描重新建一轮绕过它。

恢复沿用原 run、工具和参数，并受现有 step_version/generation/订阅执行版本隔离。重复队列唤醒不能重复导入；恢复器不重复释放已无有效所有者的回执。没有 exactly-once 计费保证。

## 10. 显式切换与能力预检

### 10.1 判断规则

沿用 supported / unsupported / unverified / unavailable，检查当前任务实际需要的能力：

- 身份与来源归属；
- 当前使用的查询语法、作者范围、过滤、排序和时间要求；
- 必需的正文/详情链；
- 必需分页覆盖及在途 backlog；
- 当前运行的工具契约和参数翻译；
- 本地凭证、开关和预算是否可用。

已知不支持的必需条件阻断；尚无可靠合同/解析器的必需能力也不能开放。没有本机历史成功回执只说明账户运行证据 unverified，不据此强制先付费试跑。预检只读本地契约与已有证据，不能自动执行外部工具。

| 差异 | 预检处理 |
| --- | --- |
| 当前没使用 exactMatch，目标也没有 | 不因未使用能力阻断 |
| 当前确实依赖精准匹配/认证过滤/作者约束，目标不能承接 | 阻断，不静默删除参数 |
| limits.pages=3，仅是最多页数 | 不是必须抓满 3 页；目标只有单页时展示限制，可在满足业务要求时切换 |
| 业务明确需要遍历后续页或承接未完成积压 | 目标无相应能力则阻断，旧 cursor 不搬过去 |
| 优质库/广域库、数据延迟、排序默认不同 | 展示影响并确认；不是要求目标拥有同名库。用户明确的必需时效仍必须满足 |
| 能获取正文但无公开全文权限 | 可用于获准的内部处理，不能扩大公开全文 |

### 10.2 两种切换入口和事务

X/公众号仍从信源的供应商切换进入；独立平台订阅使用单独“切换供应商”动作，普通编辑表单不能隐式改 provider。当前实现只允许抖音 `OWIBYU1V` 在 Redfox 与 AgentKey 之间双向预检和显式切换，其他操作或 unsupported 参数、详情、凭证检查会阻断。

流程为：选择目标 → 显示目标字段与参数翻译 → 本地预检及影响预览 → 管理员确认 → 同一事务重新校验 edit_version/资格 → 停止旧轮并递增执行版本 → 更新同一订阅绑定及进度 → 审计与下一次调度。预览结果不是永久通行证，确认时必须再次检查。

保留订阅 ID、关联 source ID、权限、周期与历史；原供应商进度按现有切换记录留存，目标游标从其合法起点开始。切换失败回滚事务，旧订阅和旧采集资格保持有效；切换成功后旧请求即使无法撤回，也只保留回执，不再提交。显式切回同样需要预检，没有失败自动回切。

### 10.3 X 和公众号的专有要求

X 的多作者/关键词采集按真实作者归属，既有来源权限保留，新作者隔离。TikHub 搜索存在不等于高级表达式、排除回复、Top/Latest 和 X Article 全部兼容；只有已核实组合才允许从 SocialData/Redfox 切换，不能把 Sorsa 的文档证据用到 TikHub。

公众号不照搬 Redfox 选库控件；展示 TikHub 的账号标识、raw=false 列表结构、分页、详情和已取得的延迟说明，未取得延迟保证时不宣称实时或 T+1。身份映射使用同一详情响应的 bizUin/user_name/mid/idx/link 证据；发布时间优先文档明确的秒级时间戳。H5 _content_type=unknown 时正文只是摘要，不能标完整。首次回填限制仍由 AIHOT 控制；上游忽略 page_size 时在本地按允许条数处理，并明确一页响应可能多于导入数。当前任务确需正文/精确时间而目标返回不满足时阻断相应切换，不要求额外头像或简介作为门槛。

## 11. 后台与 API 的一致性

供应商中立的采集目录/管理入口复用现有领域函数，建议使用：

- GET /api/admin/collection-operations：按业务能力和 provider 变体返回采集目录；
- GET / POST /api/admin/collections、PATCH /api/admin/collections/:id：独立订阅管理，复用现有领域函数；
- POST /api/admin/collections/:id/run：显式新一轮；
- 对应预检/切换命令：按既有切换模式新增独立订阅动作；
- 供应商中立的后台查询命令：请求明确携带 provider、业务操作和参数，创建 run 后执行。

现有 /api/admin/redfox/queries 继续明确表示 Redfox 直连查询。新建页当前预览固定调用这个路径，是必须调整的真实入口：选择 AgentKey 后，预览、保存、价格、字段、详情目标和最终执行都必须使用同一 provider。切换草稿 provider 时清理不兼容字段/旧预览，并明确提示需要重新核对条件；不能保留旧成功预览冒充新供应商结果。

现有 /api/admin/redfox/collections 只在存在已知调用方时保留为委托别名，共用处理函数。/redfox/operations 还包含非采集工具，不能直接等同 /collection-operations：共享描述生成函数，按用途投影。前端、测试、文档及已知外部调用方迁完、相关回归通过后，再在获准发布中移除不再使用的别名；不新增兼容开关或永久双轨业务逻辑。

任务列表、详情、结果、导入和人工恢复继续走已有 /api/admin/operations/...。结果导入路由必须识别实际 provider 的证据验证，不能只按 kind 调 Redfox 导入器。

页面需要显示：

| 页面/动作 | 必需反馈 |
| --- | --- |
| 新建/查询 | 可用 provider；AgentKey 的绑定上游和能力限制；估算 credits；执行按钮明确可能收费 |
| 列表 | 当前订阅 provider，AgentKey 上游可作辅助说明；历史 run 显示其实际冻结的 provider |
| 详情/结果 | 请求工具、回执、实际支持的分页/详情、原文及材料关联、等待原因 |
| 费用 | 每次估价、报告实扣、缺失/未对账，credits 与金额分开 |
| 切换 | 当前必需能力是否满足、条件/费用/延迟/回填变化、旧轮停止影响 |

UI 已按上述入口接通，验收截图使用隔离库、假凭证和关闭的外部调用阀；每个调整处逐张批注操作位置、当前状态和限制，不把本地桩界面当作真实供应商调用证明。

## 12. 已执行阶段与后续开放条件

1. **第一条完整链路已完成本地验收**：抖音 V5 搜索连通 provider 中立表单/预览、订阅保存、按供应商调度、`paidRequest`、原始 MCP 响应、分页、结果解析、去重导入、权限与订阅释放。测试只使用独立 `*_test` 库和本机 MCP 桩。
2. **独立订阅显式切换已完成本地验收**：仅 `OWIBYU1V` 可从 Redfox 切到 AgentKey 及反向切回；保留同一订阅 ID、启停、周期、限额、权限与历史，停止旧在途轮、递增执行版本、清空旧游标，不自动回切或失败兜底。
3. **恢复与费用已接入现有生命周期**：未知只读请求沿用最多一次自动放行；当前恢复重试复用同一付费回执逻辑键。费用页沿用 attempts 展示估价 credits、报告实扣和缺失计数。迟到旧 generation 仍不能提交结果。
4. **其余 211 条 AgentKey 路线保持阻断**：exact 输入、完整输出、身份、原文、分页或恢复证据不闭合时，不开放查询、导入、定时采集或切换。补齐证据后按矩阵逐行开放，不因目录新增自动进入白名单。
5. **真实兼容性另需授权**：用户另行授权精确工具、用途、次数及费用边界后执行只读代表性验证。没有这步证据时明确“本地桩通过，真实兼容性待验”，不宣称全部可用。

若其中一种只读查询本身是异步任务，复用现有 submit/query、task ID、轮询预算和恢复；只有实际选择这种工具才实现。生成/上传/转写已排除，不再作为未来首期阶段或前置验收。

| 风险 | 必需定向验证 |
| --- | --- |
| 字段只是展示 | 表单/预览所选 provider → API → subscription → scheduler → run → 本地 MCP 桩 → 正确结果/材料；主订阅与独立订阅分别验证 |
| 预览调用错商 | 切换 provider 后字段/价/详情目标更新，桩只收到目标商请求，旧草稿预览失效 |
| 轮次与恢复混淆 | 同轮恢复不增加调用；新轮同参数增加一次；parser 修正和关阀恢复只消费旧响应 |
| 付费身份漂移 | 旧 run 不读新工具/默认值，generation 改变不改变请求逻辑键 |
| 错误分类 | 200+isError、JSON-RPC 拒绝、上游错误、429、完整但不可解析响应、无完整结果分别落正确既有状态 |
| 大整数 ID | 字符串/原始文本保真；仅有舍入值时拒绝绑定和导入 |
| 费用与预算 | 缺预算/0 阻断；重试计次；估价与实扣不同、实扣0/缺失、迟到响应、历史价格均归属正确 attempt |
| 中断 | 占位后、响应落库后、结果/材料提交事务前后分别中断，恢复不重复购买/导入，订阅能收尾 |
| 切换与并发 | 预检失败保留原任务；确认版本冲突；旧响应迟到；双重确认/重复队列；同轮不重复提交 |
| 权限与去重 | 跨供应商同作品去重，未知作者隔离，停用来源/人工修改/回填规则正确 |
| 非文章结果 | 评论、账号、关系和榜单定时快照不会自动进入新闻链 |
| 退役 | 老 Redfox 请求、旧 operationId/命令幂等、SocialData 批量、大加辣路径及中立新入口回归 |

四项补缺的定向验收：

| 目标 | 最小桩验证 |
| --- | --- |
| 固定路线/输入输出矩阵 | 扫描矩阵中的每个 AgentKey/Redfox 精确工具是否存在于目录快照或既有 Redfox 契约；检查同一业务能力只有一条固定 AgentKey 路线；确认营销、生成、上传、转写、刷量和播放流用途不在可执行行；`gap` 行分别断言导入、分页或切换被阻断 |
| 错误响应持久化 | 分别桩 HTTP 200 + `isError`、JSON-RPC error、402 insufficient_credits、`disabled:true`、429、完整响应后 parser/身份失败、无完整 envelope 的断连；断言原 receipt/attempt 保存响应、请求号、usage/cost 和错误文案，且只有最后一类进入 unknown，parser 失败不重新购买 |
| 成功空结果 | 搜索零命中、评论空页、合法最终空页各写一条 receipt-linked `query_summary(count=0)` 后推进/完成；非法 payload 和未知业务失败不写成空结果、不推进；summary 不进入材料 |
| AgentKey 恢复分类 | 已登记只读 step/operation 对在 30 分钟后最多自动释放一次；未知 step、step/operation 不配对、或 `readOnlyPoll` 缺持久化 task ID 均进入 needs_review；`remoteSubmit` 永不自动重发；切换供应商后迟到未知回执即使被释放也不写新 cursor/material。现有 SocialData、大加辣和 Redfox 分类回归不变 |

测试使用独立 *_test / *_ci 库、假凭据和明确的本机 MCP/HTTP 桩；默认关闭所有外部副作用，仅在隔离测试进程为桩开启所需开关。关闭测试服务并清理可调度任务。按风险运行相关测试，不把重复全量测试或额外质量平台当固定门禁。

## 13. 迁移、兼容与回退收尾

本方案**新增 0 张业务表、0 个状态枚举**。复用现有 provider 字符串、contract_version、input/progress/data/provenance/usage 字段；身份绑定和作品别名也用已有表。API DTO、解析器和必要领域函数会调整，这不等于数据生命周期重建。

数据层只增加实际用途的 0 预算种子，以及确有 AgentKey 货币报价证据时的 service_prices 记录；credit-only 不写货币价。沿用项目增量迁移，不改已应用 SQL，不预建目录、账单或路由表。

存量订阅、run、回执、结果不做批量重写/换商。新操作从新契约创建；旧契约读取兼容按 §5 保留。管理员切换时才迁移该订阅的执行配置，原供应商历史及游标证据保留，新供应商从明确起点开始。新旧 API 只共用一套领域实现，按 §11 的真实调用方退出条件收尾。

首选回退方式是关闭 AgentKey 外发、暂停其订阅，保留能处理已收响应的新 Worker 完成本地收尾；人工选择兼容旧供应商时重新预检。

若需回退程序，支持的基线是当前 Redfox 分支中含供应商中立 governedReceipt 关联保护的版本。该保护按 run/result 关联回执，已经不依赖 provider；无需 AgentKey 专用保护或新增发布门禁。旧 Worker 不具备 AgentKey 解析/恢复能力，因此不能让它继续消费 AgentKey 任务；暂停/处理在途工作，保留回执，必要时向前修复。不得回退到缺少该既有保护的更老基线并依赖通用恢复器释放未知回执。

回退不删除历史、改写计费记录或复用别家游标。生产回退、迁移、外部发布均另行授权。

## 14. 当前已完成的证据与未完成项

在新建的一次性隔离 PostgreSQL `*_test` 库上应用全部 75 个迁移后，AgentKey 传输、路由、恢复、采集、费用及显式切换测试 **58/58** 通过；既有回执、恢复、任务治理和 Redfox 采集定向回归 **79/79** 通过。覆盖断连 unknown 后同一回执第二次执行、迟到旧 generation fencing、异常分页保留结果/回执并进入 `needs_review`、供应商关闭不阻塞另一供应商、双向显式切换、未知 provider 拒绝、跨供应商作品去重和费用归属。Web 与类型/构建结果在下方实施复审中记录。

本轮已完成完整目录供应商核验、代表性输入契约、现有代码边界对照，以及输出证据专项核验：67 条 TikHub 官方接口文档依据、JustOneAPI 四个平台的 32 份 OpenAPI 与公开样例查询（取得 30 份样例），并核对 AgentKey 网关及 Serper/Jina 的输出、错误和计费合同。已查明的字段与限制直接进入 §2.4、§3、§6、§8—§10，不留到开发时再猜。

[固定路线矩阵](reviews/2026-10-21-agentkey-route-matrix.md)现有 **233** 条业务路线：212 条 AgentKey、21 条直连 Redfox。212 个 AgentKey 工具全部命中目录快照，21 个 Redfox operation ID 全部命中现有 inventory 与源码；AgentKey 行中 91 条登记为 `readOnly`，121 条因证据未闭合保持 `needs_review`，没有数据行使用 `readOnlyPoll` 或 `remoteSubmit`。这只是逐项路线与阻断校验，不是 233 条均已真实可用。

剩余事项分开记录：一是[输出证据清单 §7](reviews/2026-10-21-agentkey-output-evidence.md#7-尚缺官方输出说明的清单与处置)中的具体文档缺口；二是该清单 §8 中账户可用性、端到端字段保真、真实分页/内容、本次实扣等需要另行授权的运行验证；三是其余 211 条 AgentKey 路线的分批本地实现。不能以目录存在、单份样例或 mock 通过替代供应商真实结果。

## 15. 复审后保留与精简的边界

| 原评审项 | 本版处理 |
| --- | --- |
| R1 回执轮次与 parser 身份 | §5 使用稳定 window/请求位置；parser/价格修正不改付费身份 |
| R2 入口与材料两端缺漏 | §7 覆盖两类订阅、手工入口、供应商证据与共享材料提交；§12 验证实际结果和收尾 |
| R3 MCP 错误和大整数 | §6/§9 先保留完整响应再分类、无损身份、清理不抹结果、SDK 不隐藏重发 |
| R4 中立能力与预览错商 | §5/§11 按 provider 提供描述，预览和保存同路，旧 Redfox 入口不冒充中立入口 |
| R5 credits/金额/预算 | §8 每 attempt 保存估价与报告实扣，未知与0分开，货币表约束不变，次数不冒充金额上限 |
| R6 预检误拒与独立订阅切换 | §10 检查实际业务必需条件，上限与目标覆盖区分，增加独立订阅显式切换 |
| S1 多套版本权威 | 只用现有 contract_version，移除并列版本/hash/accountScope 运行要求 |
| S2 永久兼容别名/新开关 | 共用处理函数、按用途投影、已知调用方退出后删除，不建兼容开关 |
| S3 回退/并发过度要求 | 复用已有 governedReceipt 与 Worker 并发，不建专属保护、全局串行锁或新状态 |

扩展范围后补充的检查包括：TikHub 与直连 Redfox 的分工、资讯原文的真实来源归属、研究快照与文章分离、目录中伪只读/营销接口排除、同义上游不重复建设、异步采集提交与只读轮询区分。这些只约束实际接入路径，不建设额外平台。

本轮四项复审意见已在方案层面闭合：

| 项目 | 闭合结论与边界 |
| --- | --- |
| 完整固定路线与输入输出矩阵 | 233 行矩阵包含业务能力、结果类型、provider/上游、精确工具、必需输入、已证实输出、分页/末页、恢复键及 Q/I/S/X 用途；212 个 AgentKey 工具和 21 个 Redfox ID 均通过目录/源码静态检查。`gap` 路线保留具体阻断，不把“有规则”当成“有能力”。 |
| 错误响应持久化 | §6.1 扩展现有 `ProviderRejectedError` 和已有 receipt/attempt 列，先保存完整、脱敏、有界的响应、请求号、usage/cost，再分类。完整响应后的 parser/身份失败保持 received 并本地恢复；只有没有完整 envelope、断连或落库前中断进入 unknown。 |
| 空结果步骤结果 | §7.3 要求每个成功的 AgentKey `execute_tool` 都写 receipt-linked 既有 `query_summary`，搜索、评论和最终空页写 `count=0`。非法结构、失败和未知不能伪装为空；不新增 result kind 或空状态。 |
| AgentKey 恢复分类 | §9 使用精确 operation/step 对及静态 `readOnly`、`readOnlyPoll`、`remoteSubmit`，禁止前缀推导。当前数据行只有同步只读的 `readOnly` 实例，没有 `readOnlyPoll`/`remoteSubmit` 实例；未知键、键不配对、轮询缺 task ID 一律 needs_review，提交未知绝不自动重发。 |

四项修复只调整方案契约和定向验收，没有新增表、状态、Router Registry、插件、工作流引擎或第二条供应商生命周期；也没有修改运行代码或调用真实接口。

未来新增供应商沿同一办法：明确业务用途 → 固定工具/传输与参数 → 治理外发 → 保存原始响应 → 适配器校验证据 → 共享结果/材料 → 预检与恢复验收。只补该供应商真实差异，继续复用既有生命周期。

## 16. 本轮实施与决策状态

本轮范围、TikHub 优先、已有 Redfox 承担缺口、其他上游补足独有用途、每项固定路线、独立订阅显式切换，均已由用户逐项确认。当前没有待用户选择的产品范围问题。

本方案已对应一条本地可运行的纵向链路，但不是 233 条路线的真实可用证明。后续发现具体业务语义冲突、需要扩大能力/费用范围或不能满足已确认用途时，带明确影响逐项询问；普通函数划分、DTO 和本地验证选择按现有架构推进。
