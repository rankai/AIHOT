# AgentKey 输出证据逐项核验（2026-10-21）

> 对应[完整接入方案](../agentkey-integration-plan.md)。最初依据来自官方文档、OpenAPI、免费工具描述和公开响应样例；2026-10-21 后续经用户授权，又用 Codex 现有 AgentKey MCP 凭据完成了最小只读联调。联调没有读取、输出或提交真实密钥，也没有执行生成、上传、生产写入、提交或部署。

## 1. 证据口径

本次不再把“目录里存在接口”当作输出已经确认。分别核对作品身份、作者身份、原文、内容、发布时间、分页、错误和计费。

- **文档确认**：官方字段说明或 schema 明确约定；可据此制定契约和离线验证，不等真实调用再设计。
- **样例确认**：官方公开样例出现了具体字段和类型；能证明该形态存在，不证明所有结果都必填、所有日期/游标都有效。
- **文档缺口**：已查到的官方材料没有说明，或互相矛盾。优先取得供应商的说明/脱敏样例；不是“只能真实调用”。
- **运行验证**：凭据权限、当时可用性、实际收费、具体内容的可见性，以及端到端传输行为。必须另行授权真实调用才能证明。

以下 `E` 表示解开 MCP content 后的 AgentKey 执行结果，`P = E.data` 表示上游原始 payload。例如 TikHub 的 `$.data.articles` 写成 `P.data.articles`；**不能漏掉 AgentKey 外层，也不能将所有供应商假定为同样的两层 data**。

调查依据：

1. AgentKey 官方当前 Markdown：[执行结果](https://docs.agentkey.app/api-reference/execute-tool.md)、[错误](https://docs.agentkey.app/api-reference/errors.md)、[两种调用面](https://docs.agentkey.app/concepts/two-ways-to-call.md)、[路由](https://docs.agentkey.app/concepts/auto-failover.md)、[计费](https://docs.agentkey.app/concepts/subscription.md)。搜索索引中的旧 HTML 说明未及时更新，冲突处以本轮直接读取的官方原文为据。
2. TikHub [官方 SDK OpenAPI V5.3.2](https://github.com/TikHub/TikHub-API-Python-SDK/blob/1ede56bcc53f8c037744cbe2b70c93541b5cf840/spec/openapi.json)和各接口官方页面。SDK 文件有 1,050 个 path；AgentKey 的 1,037 个 TikHub 工具中有 1,024 个 operationId 匹配。其余 13 个是版本差异，不能据此判断线上接口已删除。各接口主要使用通用 ResponseModel，内部 data 未定义具体 schema；下表的具体字段来自接口说明，不能由通用 schema 自动生成。
3. JustOneAPI 四个平台的 **32 份 OpenAPI 和公开样例查询结果**：30 份取得样例，标记 synthetic=false；豆瓣影评详情、短评两项的**文档样例服务**返回 API NOT FOUND。此结果不等于数据接口实测失败。只提取字段证据，不把公开样例中的文章、账号、CDN 签名保存为本项目数据。清单写入[目录证据](2026-10-21-agentkey-catalog.json)的 outputEvidence。
4. [Serper 官方展示样例](https://serper.dev/)、[Jina 官方 OpenAPI](https://docs.jina.ai/openapi.json)及[官方响应 DTO](https://github.com/jina-ai/reader/blob/main/src/services/snapshot-formatter.ts)。

## 2. 网关及共同输出缺口

| 编号 / 原缺口 | 本轮确认 | 方案处理及剩余边界 |
| --- | --- | --- |
| G1：AgentKey 返回是否只是任意 JSON，如何获得上游与费用 | 官方 execute_tool 明确返回 `provider/category/took_ms/credits_charged/data`；data 透传供应商 payload | 明确解析这些字段；实扣写入已有 attempt usage，0 有效、缺失未知。不同于上游自身的积分或 token 数 |
| G2：固定工具是否会被网关自动换商 | 官方明确 execute_tool 执行指定 Provider/Operation，不自动替换；自动路由属于 Scenario Methods | 撤回“实际可能被偷偷换商”的未决假设；UI 显示绑定上游及回执 provider，异常不一致才进入核对。保留本地不自动兜底规则 |
| G3：HTTP 200 中的工具错误、额度不足 | 错误 JSON 有 `error/code/error_type`；402 insufficient_credits 表示没有上游调用；200 也可能含 `disabled:true` | 保存完整错误再分类；disabled、认证/参数/额度拒绝不自动重试。上游业务错误仍单独判断，不能仅看网关 HTTP 状态 |
| G4：是否自动超额扣费，报价是否等于实扣 | 当前官方说明月度额度后消耗预购 extra credits；二者耗尽返回 402，不自动产生套餐外费用；计量工具报价可能只是最低值 | 删除旧 overage 断言。次数预算仍不是积分/人民币硬上限；Jina 0.7 credits 等不能据此承诺每次固定费用 |
| G5：TikHub 时间、数字 ID 和成功码 | ResponseModel 的 time/time_stamp/time_zone 是**响应生成时间**；data 是任意值。公众号、视频号、微信搜索明确警告 64 位 ID 不可经过 JS Number | 不把外层 time_zone 套到作品发布时间。保存无损原文；各平台成功/空结果/私密语义单独解析。具体内容缺失不是统一“失败免费” |

以上依据均已取得，不需要真实调用来决定设计。标准 MCP content/structuredContent 的实际传输形式、网关是否保留大整数原始字面量，属于最后的端到端兼容验证；不能因此省略现在就能确定的无损规则。

AgentKey 目前另有公开的 [Scenario REST](https://docs.agentkey.app/api-reference/scenario/overview.md)，支持固定输出及[指定上游/关闭 fallback](https://docs.agentkey.app/api-reference/scenario/routing-and-pricing.md)。因此撤回“REST 只能进 Console 才能了解”的笼统说法。它与本方案采用的工具目录 MCP 是两个合同；本轮沿用已确定的固定工具路线，不并建第二条执行路径，也不把 Scenario 的 Post schema 套到 MCP 原始结果。

## 3. 首批平台及身份链路

### T1. 抖音搜索

- AgentKey 当前 `describe_tool` 确认 V4 固定工具为 `TikHub/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post`，输入只有 `keyword/cursor`，健康状态为 healthy，单次报价 0.2 credits；[TikHub V4 工具页面](https://api.tikhub.io/#/Douyin-Search-API/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post)与其执行结果一致。
- 经授权真实调用先用 V5 文档默认参数请求两次，均返回 HTTP 400 且没有结果；改用 V4 `keyword=猫咪,cursor=0` 后成功，AgentKey 返回 `credits_charged=0.2`、12 条 `itemList`、`hasMore=true`、`cursor=12`。这确定了本地固定路线采用 V4，V5 不自动兜底。
- V4 实测 `P.data.data.itemList[].AwemeInfo` 包含 `AwemeId/Desc/CreateTime`、`Author.Uid?/SecUid/Nickname` 与 `Video.ItemID/Title/CreateTime/Cover.UrlList`；`CreateTime` 是毫秒字符串。分页位于 `P.data.data.hasMore/cursor`。标准作品 URL `https://www.douyin.com/video/<AwemeId>` 由稳定 ID 生成，不冒充供应商原始字段。
- V1：`P.data.data[].aweme_info` 有 `aweme_id/desc/create_time/author.uid/share_url`；`P.data.status_code=0` 表示业务成功，`cursor/has_more` 控制分页，支持排序和最近 1/7/180 天。视频 duration 是毫秒。`desc` 是作品说明，不是语音转写。
- **仍缺**：V1 搜索会话的准确输出路径、所有 ID 的传输类型；V1/V4 都没有“任意起止日、精准匹配”兼容保证。不能用本地截断冒充上游完整时间筛选。
- 方案维持每项一条路线；真实可用性优先于版本号，因此固定 V4 而不增加运行时版本选择器。真实第二页由官方 cursor 契约与本地桩覆盖；未为再证明一次翻页消耗额外额度。

### T2. 抖音账号作品、详情

已查 [douyin/app/v3/fetch_user_post_videos](https://docs.tikhub.io/186826223e0)、[douyin/app/v3/fetch_one_video_v2](https://docs.tikhub.io/232379587e0)。列表使用 sec_user_id、max_cursor，count≤20；详情说明 `P.data.filter_list[0].reason` 的私密、删除/地区限制等情况，其中 reason=8 有多种原因，不能唯一解释成删除。**仍缺列表/详情的完整嵌套输出、原文链接及作者字段类型、列表终止字段**。不能把搜索 aweme_info 结构直接复制到详情。列表默认 normal，不因文档推荐而自动再买 lite/Web 路线。

### T3. 小红书

已查 [xiaohongshu/app_v2/search_notes](https://docs.tikhub.io/420136398e0)、[xiaohongshu/app_v2/get_user_posted_notes](https://docs.tikhub.io/420136396e0)、[xiaohongshu/app_v2/get_image_note_detail](https://docs.tikhub.io/420136391e0)、[xiaohongshu/app_v2/get_video_note_detail](https://docs.tikhub.io/420136392e0)。

- 搜索是 page + 首次返回的 search_id/search_session_id；支持排序、笔记类型及 1 天/1 周/半年范围。ai_mode 固定关闭。
- 账号列表文档给出 `P.data.data.notes[-1].cursor`；不能把 note_id 自行当成分页权威。
- 图文详情**也能读视频笔记的内容、作者与封面**，只有视频播放地址缺失。本期不采集播放流，因此无需默认给视频笔记追加第二次“视频详情”调用。
- 错误/不存在 ID 可能在 data 返回服务异常且仍计费。
- **仍缺**：搜索会话的精确输出层级、搜索/详情中 note ID、稳定作者 ID、正文和发布时间的完整路径/类型、空页结束语义。官网示例的 data=null 不能补这些字段。

### T4. B 站

已查 [bilibili/app/fetch_search_all](https://docs.tikhub.io/382707669e0)、[bilibili/app/fetch_search_by_type](https://docs.tikhub.io/382707670e0)、[bilibili/web/fetch_general_search](https://docs.tikhub.io/265879743e0)、[bilibili/app/fetch_one_video](https://docs.tikhub.io/382707662e0)。

App 搜索下一页已明确为 `P.data.data.pagination.next`，缺失或空串即停止，不能按 page 随机翻页。按类型搜索能指定 video/article/user 等；Web 搜索有排序、页码和 10 位秒级起止时间。**仍缺**各结果类型的 aid/bvid、作者 mid、原文、正文说明和时间的完整输出契约；搜索类型 article 的存在也不证明视频详情能补专栏正文。不猜 AV/BV 转换规则，不拼错误详情调用。

### T5. 微博

已查 [weibo/app/fetch_search_all](https://docs.tikhub.io/410358109e0)、[weibo/app/fetch_status_detail](https://docs.tikhub.io/410358103e0)、[weibo/app/fetch_status_comments](https://docs.tikhub.io/410358104e0)。

搜索按 page 翻页，可选择综合/实时/用户/视频等；详情明确返回完整文本。评论下一页 `P.data.moreInfo.params.max_id`，为空或相同则停止。**仍缺**状态 ID、作者 UID、长文/原文 URL、发布时间的精确层级及搜索末页条件；没有 Redfox extParam 认证过滤证据。不能将“全文能力存在”写成“长文解析已验证”，也不能混用 base62 链接 ID 与纯数字 status_id。

### T6. X

已查 [twitter/web/fetch_search_timeline](https://docs.tikhub.io/215701673e0)、[twitter/web/fetch_tweet_detail](https://docs.tikhub.io/191321709e0)、[twitter/web/fetch_user_post_tweet](https://docs.tikhub.io/191321711e0)。官方页面和规范 describe 都只确认 keyword/cursor/search_type；说明命中范围包含引用、链接元数据及媒体等，不能要求正文必须字面包含关键词来模拟相同搜索。

**未补到的文档证据**：作者 rest_id/id_str、tweet ID、原帖/转发/引用区分、长帖与 X Article 正文路径、发布时间、下一页与终止字段，以及 from/OR/排除回复/时间表达式的保证。当前 X 搜索页面响应示例仍为 data=null。Sorsa 或 Scenario 的输出说明不能替代 TikHub 这条工具证据。需要这些能力的现有多作者/关键词任务暂不能通过目标预检；这是明确的文档缺口，不宣布 TikHub 不存在该能力，也不承诺试一次就能证明全部语法。

### T7. 公众号列表、账号和正文

已查 [wechat_mp/v2/fetch_account_articles](https://docs.tikhub.io/472974858e0)、[wechat_mp/v2/fetch_account_profile](https://docs.tikhub.io/472974857e0)、[wechat_mp/v2/fetch_article_detail_h5](https://docs.tikhub.io/511928397e0)、[wechat_mp/v2/fetch_article_detail](https://docs.tikhub.io/472974851e0)。

| 原缺口 | 已确认的具体输出 / 方案处理 |
| --- | --- |
| 文章列表和多图文身份 | raw=false：`P.data.biz_username`、`articles[].app_msg_id/idx/url/title/digest/create_time/update_time`。app_msg_id 不是跨账号、跨 idx 的全局文章 ID；沿用原文及账号+消息+位置的既有身份规则 |
| 分页、页大小 | `next_offset` 原样回传 offset；`is_end` 为末页、next_offset 末页 null。page_size 被上游忽略；本地导入上限与远端返回条数分开 |
| gh/custom username 与 biz 对应 | H5 同一响应有 `P.data.bizUin`（由 __biz 解码）、`content.user_name`、`content.mid/idx/link`，可提供同一账号/文章的映射证据；不靠昵称或按 custom username 推导 biz |
| 正文是否只是摘要 | H5 raw=false：`content.content_noencode` 是 article 形态的 HTML；`content.content_text` 是纯文字；`content._content_type` 区分 article/immersive/video/unknown。unknown 时正文只是摘要，不能标“全文已完成” |
| 时间 | H5 的 `create_timestamp/ori_create_time`、普通详情的 ori_create_time 明确为整数秒；优先这些值，不猜 `create_time` 的无时区文本。列表仅说明 timestamp，若必须精确时间而单位未明，按所选详情补齐，不能套用外层响应时区 |
| 账号资料缺字段 | profile raw=false 的 signature/head_url 恒 null，并在 unavailable[] 声明；头像可由 H5 raw=true 的 round_head_img/hd_head_img 得到。不要为了可选头像自动增加付费详情 |

上述身份/正文/时间合同现在已有证据，撤回“公众号链路全都留待真实调用确认”的表述。尚未获得文章发现实时性/T+1 的服务保证、custom username 迁移后的长期稳定性承诺和私密/付费/已删除页的完整返回枚举；不能借 Redfox 的 T+1 规则推断 TikHub。

### T8. 微信综合搜索

[wechat_search/v2/fetch_search](https://docs.tikhub.io/472974860e0) 明确 raw=false 的 `P.data.items[]/cursor/continue_flag/count/no_more/categories[]`。**只传 offset 不会翻页**，必须回传 cursor 并保持 sort/publish_time。账号项 `jumpInfo.userName` 可串联公众号查询；视频项 exportId + feedNonceId 可串联视频号详情。

total 是多个结果盒子的最大值，零结果可能 null，不是可用来判全量完成的精确总数。文档明确部分垂类当前恒空且计费，不能把 news/AI search 等所有 enum 都做成可用能力；本期按有说明的文章、账号、视频等资讯用途开放。文章项的真实文章链接/正文与稳定身份具体路径仍需补官方样例，docID 不自动作为文章身份。

### T9. 今日头条

[toutiao/app/get_article_info](https://docs.tikhub.io/251380586e0)、[toutiao/app/get_user_info](https://docs.tikhub.io/251380589e0)、[toutiao/app/get_comments](https://docs.tikhub.io/251380588e0) 只确认相应查询及入参，没有完整输出字段。TikHub 7 项无关键词搜索/账号作品列表的结论不变；这些继续 Redfox 直连。**详情/账号/评论的作者、正文、URL、时间、分页字段仍是文档缺口**，不能由 group_id 输入推断返回身份已经核验。

## 4. 其他 TikHub 平台逐项缺口

| 编号 / 平台及文档 | 已补齐事实 | 尚缺证据 / 当前边界 |
| --- | --- | --- |
| T10 视频号：[wechat_channels/v2/fetch_user_videos](https://docs.tikhub.io/472974841e0)、[wechat_channels/v2/fetch_video_detail](https://docs.tikhub.io/472974842e0)、[wechat_channels/v2/fetch_video_share_url](https://docs.tikhub.io/472974844e0) | raw=false 列表 `P.data.videos[].id/username/title/create_time`，分页 up_continue/last_buffer；详情 `P.data.id/username/title`。分享链接工具输出 `P.data.share_url`。搜索 exportId 会过期，可经详情获得明文 objectId 与 `v2_…@finder` | 这条路线**已有可绑定的作者标识**，不能沿用 Redfox 某接口缺 ID 的结论。仍需确认时间单位、分享链接有效性和空结果形态；导入需作品页 URL，media.full_url 是 CDN，不是原文。补链接仅在所选流程确需时计入调用预算 |
| T11 快手：[kuaishou/app/search_video_v2](https://docs.tikhub.io/467698481e0)、[kuaishou/app/fetch_user_post_v2](https://docs.tikhub.io/467698477e0)、[kuaishou/app/fetch_one_video](https://docs.tikhub.io/467698469e0) | 账号列表只收纯数字 user_id，eid 不可替代；pcursor 回传；支持 latest/hot | 缺作品/作者输出 ID、原文/说明/时间路径及末页值。不能预先认定“快手没有作者 ID”，也不能把 eid 直接绑定为同一种 ID |
| T12 Instagram：[instagram/v3/get_user_posts](https://docs.tikhub.io/419083061e0)、[instagram/v3/get_post_info](https://docs.tikhub.io/419083069e0) | 列表 `P.data.edges/page_info`，end_cursor 与 has_next_page；详情 `P.data.items[].id/code/caption.text/user/taken_at`。username 入参不是数字 user_id | user 内稳定账号 ID 和列表 node 的完整形态未明确。综合搜索主要是用户/话题/地点，不能直接等同帖子关键词搜索；没有的帖子搜索用途不伪装实现 |
| T13 TikTok：[tiktok/web/fetch_search_video](https://docs.tikhub.io/186826070e0)、[tiktok/web/fetch_user_post](https://docs.tikhub.io/186826058e0)、[tiktok/web/fetch_post_detail](https://docs.tikhub.io/186826056e0) | 搜索 search_id 来源说明 `P.data.extra.logid` 或 `P.data.log_pb.impr_id`；账号列表 cursor + hasMore；旧排序入参已废弃，实际按新到旧 | 缺列表/详情作品和稳定作者字段的完整路径、时间/原文语义及搜索停止条件。需要 Cookie 的 CDN 播放不在本期，不引入 Cookie 管理和下载链 |
| T14 YouTube：[youtube/web_v2/get_general_search_v2](https://docs.tikhub.io/431829299e0)、[youtube/web_v2/get_channel_videos](https://docs.tikhub.io/419083089e0)、[youtube/web_v2/get_video_info_v2](https://docs.tikhub.io/461775522e0) | 搜索分 videos/shorts/channels/playlists 与 continuation_token。账号列表 videos[].video_id/url，首页 channel.id；后续页没有 channel，列表 description 恒空，published_time 是相对时间。详情 need_format=true 有 video_id/video_url/channel_id/description/publish_date/published_at/upload_date | 已可定义身份与按需补详情；不能每页从缺失字段重建新作者，也不能将后续页 is_verified=false 覆盖首页证据。详情三个时间字段格式/精度未完整声明；description 是视频介绍，不能当转写 |
| T15 知乎：[zhihu/web/fetch_article_search_v3](https://docs.tikhub.io/262614077e0)、[zhihu/web/fetch_column_article_detail](https://docs.tikhub.io/262614070e0)、[zhihu/web/fetch_answer_detail](https://docs.tikhub.io/484367553e0) | 文章与回答有不同详情接口；回答详情明确含正文/作者/所属问题。搜索有类型/排序/时间过滤 | 缺返回类型分支、稳定作者、文章/回答/问题 ID、HTML/正文、时间与终止标记的具体字段。不能将回答 ID 当专栏文章 ID；正文读取能力存在不等于路径已知 |
| T16 西瓜：[xigua/app/v2/search_video](https://docs.tikhub.io/186826249e0)、[xigua/app/v2/fetch_user_post_list](https://docs.tikhub.io/186826251e0)、[xigua/app/v2/fetch_one_video](https://docs.tikhub.io/186826246e0) | 账号列表下一页来自 `P.data.data[-1].behot_time`；单视频详情明确不含标题等信息，侧重播放与相关视频 | 不能让详情空字段覆盖列表标题。作品/作者/原文/正文和发布时间仍缺契约；behot_time 是分页依据，不擅自当发布时间 |
| T17 Reddit：[reddit/app/fetch_dynamic_search](https://docs.tikhub.io/369454687e0)、[reddit/app/fetch_post_details](https://docs.tikhub.io/369454680e0) | need_format=true：`P.data.children/pageInfo`；示例 children[].post.id/postTitle，pageInfo.endCursor/hasNextPage。文档明确保留正文 markdown、作者与时间，支持 AND/OR/NOT/字段语法 | 核心用途与分页已确认；正文/作者/时间的具体键仍缺，不能借标准 Reddit JSON 代替 TikHub App GraphQL 结构。帖子、评论、社区、用户结果分开解析 |
| T18 Telegram：[telegram/web/fetch_channel_posts](https://docs.tikhub.io/481500551e0)、[telegram/web/fetch_channel_search](https://docs.tikhub.io/481500554e0)、[telegram/web/fetch_post_detail](https://docs.tikhub.io/481500552e0) | channel_info/messages/pagination；before_cursor/after_cursor。post_id 是频道内 ID，不能跨频道全局去重。搜索返回 backend=mtproto 或 web，后者仅近期历史本地过滤 | 缺稳定频道 ID 与 messages 内内容/原文/时间键。要求全历史搜索的任务不能把 web 模式当等价成功；单次 limit>20 可能上游内部累积多页，不等于 AIHOT 多个 execute attempt |
| T19 Threads：[threads/web/search_recent](https://docs.tikhub.io/381269442e0)、[threads/web/fetch_user_posts](https://docs.tikhub.io/381269434e0)、[threads/web/fetch_post_detail_v2](https://docs.tikhub.io/381269439e0) | 用户帖、recent/top 搜索和评论当前不支持分页，end_cursor 无效，next_cursor 恒 null。详情分 post/replies/parent_thread/author_thread/pinned_replies，不能用 is_reply 判当前主帖角色 | 单页快照可设计；要求持续翻页的切换拒绝。详情 user 的稳定 ID、时间字段与统一 URL 未完整约定。不能从 has_more 推出可以翻页 |
| T20 Lemon8：[lemon8/app/fetch_search](https://docs.tikhub.io/246049896e0)、[lemon8/app/fetch_post_detail](https://docs.tikhub.io/246049886e0)、[lemon8/app/fetch_topic_post_list](https://docs.tikhub.io/246049895e0) | 搜索回传 max_cursor，用 has_more 判断；话题作品用 max_behot_time | 作品、作者、原文、时间和正文具体输出缺失，话题末页未明确；不凭接口名假设存在账号作品列表 |
| T21 皮皮虾：[pipixia/app/fetch_search](https://docs.tikhub.io/258871430e0)、[pipixia/app/fetch_user_post_list](https://docs.tikhub.io/258871421e0)、[pipixia/app/fetch_post_detail](https://docs.tikhub.io/258871418e0) | 账号/话题使用 loadmore_cursor，搜索/评论使用 offset | 缺内容/作者/原文/时间路径及结束语义。增加播放量接口虽在同目录仍排除，不用它做只读验证 |
| T22 LinkedIn：[linkedin/web_v2/get_user_posts](https://docs.tikhub.io/452347396e0)、[linkedin/web_v2/get_company_posts](https://docs.tikhub.io/452347420e0)、[linkedin/web_v2/get_post_detail](https://docs.tikhub.io/452347429e0) | 个人/公司帖子列表有 data 与 paging.count/start/pagination_token；详情支持 /posts/ 与 /pulse/ URL | 缺列表项账号/帖子 ID、文本/文章 HTML、时间与分页终止约定。资源池忙可能返回 400，不能将全部 400 自动重试，也不能把公司名当个人作者 ID |

账号资料、关系、评论、榜单的缺字段不会被“材料完整性”一概挡住：后台研究结果按各自最低需求（查询对象、内容、时间窗口、分页）验收；缺作者 ID 的评论仍可保留为研究结果，但不能借评论或昵称创建有发布权限的新闻信源。当前方案尚未逐个选定这些辅助工具的所有同义版本，目录不等于白名单；每个实际选定操作仍以自己的官方输出为准，不能从上述搜索/详情合同外推。具体补充：

| 编号 / 辅助用途 | 已补齐输出 | 剩余缺口 |
| --- | --- | --- |
| A1 评论和二级回复 | [wechat_mp/v2/fetch_article_comments](https://docs.tikhub.io/472974853e0) raw=false：P.data.comments[].content_id/content/nick_name/create_time，buffer/has_more；[wechat_mp/v2/fetch_comment_replies](https://docs.tikhub.io/472974854e0)：replies[].reply_id/content/from_ai，next_offset/has_more；不能把文章 comment_id 当某条评论 content_id。[youtube/web_v2/get_video_comments](https://docs.tikhub.io/419083082e0) need_format=true：comments[].comment_id/content/author.channel_id/reply_continuation_token、顶层 continuation_token | 公众号评论时间单位、非公开评论可见范围仍未完整约定；YouTube published_time 是相对时间。其他平台评论必须分别补其稳定评论/父评论和游标字段，不能套公众号结构 |
| A2 账号资料、公开关系 | T7 已补公众号资料、T10 已补视频号 finder 标识；Facebook profile_id 见 J1，YouTube channel.id 见 T14 | 其他平台的“接受用户 ID”不代表“输出一定有稳定 ID”；粉丝/关注/点赞列表的账号 ID、翻页及可见范围没有因作品搜索被核实，仍须所选关系接口的单独样例。账号或关系结果不会自动授予信源权限 |
| A3 热榜、趋势与推荐 | 已核实 [twitter/web/fetch_trending](https://docs.tikhub.io/219522633e0) 可按 country 查趋势，但返回只写“趋势”；IMDb/豆瓣榜单已有具体样例，归研究快照 | X 趋势的词条、排名、热度、榜单时间字段仍缺；其他榜单按所选工具核验，不能以响应生成时间冒充榜单发布时间。无作品 URL 的趋势词不创建新闻 |

## 5. JustOneAPI 逐项输出证据

所有下表字段来自官方公开样例，外层成功 `P.code=0`；OpenAPI 的 P.data 仍为开放结构。30 个样例只证明已有形态，不把它们变成必填字段 schema。

| 编号 / 文档 | 已确认字段 | 缺口及接入边界 |
| --- | --- | --- |
| J1 [Facebook 搜索](https://docs.justoneapi.com/en/api/facebook/post-search-v1)、[账号帖子](https://docs.justoneapi.com/en/api/facebook/get-profile-posts-v1) | `P.data.results[].post_id/url/message/message_rich/timestamp/author.id/author.url`；ID 样例是字符串，P.data.cursor 是不透明字符串。[主页转 ID](https://docs.justoneapi.com/en/api/facebook/get-profile-id-v1) 输出 profile_id | 普通帖子身份/内容链路可定义。引用 attached_post 与主帖必须分开；正文是否截断、末页 cursor 的完整约定、日期边界时区仍缺说明。不能把引用作者权限给主帖 |
| J2 [Facebook 评论](https://docs.justoneapi.com/en/api/facebook/post-comments-v1)、[回复](https://docs.justoneapi.com/en/api/facebook/comment-replies-v1) | 评论样例 results[].comment_id/parent_comment_id/created_time/message/author.id/expansion_token，cursor；回复样例 results=[]、cursor=null | 回复的非空项结构未被当前样例证明；不能照抄一级评论或当新闻。空数组是样例有效形态，不是接口不可用 |
| J3 [豆瓣影评列表](https://docs.justoneapi.com/en/api/douban-movie/movie-reviews-v1) | `P.data.reviews[].cid/review_url/username/time/title/description`，page 翻页，sort=time/hotest | 列表是 description 摘要；username 是名称而非稳定作者 ID。精确作者绑定、全文、时区与末页条件缺失；影评不能按影片条目 ID 去重 |
| J4 [豆瓣详情](https://docs.justoneapi.com/en/api/douban-movie/review-details-v1)、[短评](https://docs.justoneapi.com/en/api/douban-movie/comments-v1) | 入参及接口文档存在；本轮公开样例资源返回 API NOT FOUND | **文档样例缺口**，需官方补样例/确认版本。不是已经对数据接口调用得出的 404，也不是证明必须真实调用。影片资料/热映样例已取得：subject 是资料对象，热映 `items[].id/uri/title/rating`，先作研究快照 |
| J5 [IMDb 资讯](https://docs.justoneapi.com/en/api/imdb/news-by-category-v1)及其余 17 项资料/榜单 | 资讯 `P.data.news.edges[].node.id/externalUrl/articleTitle.plainText/text.plainText/date/source.homepage/byline`；样例有 pageInfo.endCursor/hasNextPage。其余主要是 title 资料对象，部分结构没有 id，要关联请求 titleId；榜单是 titleChartRankings.edges | **接口入参只有 category/languageCountry，没有 cursor**，不能承诺翻页；现阶段为单次栏目快照。text.plainText 的全文完整性未保证，外链原站才是新闻来源；电影资料、票房、评分与奖项不会自动成为新闻 |
| J6 [优酷搜索](https://docs.justoneapi.com/en/api/youku/video-search-v1)、[详情](https://docs.justoneapi.com/en/api/youku/video-details-v1)、[账号](https://docs.justoneapi.com/en/api/youku/user-profile-v1) | 搜索是 P.data.data.nodes 多层卡片，内容卡 data 有 videoId/vid/title；分页控制在 `P.data.data.data.pg/isEnd`。详情 `P.data.videoMap.videoId/videoTitle/videoPublishTime`；账号资料含组件内 uid/uidEncode | 不能把任意 node 当作品。详情样例 userId=null，尚无作品到稳定作者的完整映射证据；videoPublishTime 格式/时区、isEnd 枚举未声明。页面/URL 可用于隔离材料的证据须另核，不能以节目名/频道名代替作者 |

JustOneAPI 官方错误说明已明确 code=0 成功，100 认证、301 采集失败、302 限流、303 日额度、400 参数、500 内部、600 权限、601 余额、602 Token 预算等；网关收费以 E.credits_charged 为准，不能将上游 token 余额误当 AIHOT 的 AgentKey 余额。上游建议 120 秒超时、至少 60 秒；不将微信系列的约 30 秒统一套在 JustOneAPI。来源：[官方用法](https://docs.justoneapi.com/en/usage)。

## 6. 通用资讯与正文

| 编号 | 已补齐 | 剩余边界 |
| --- | --- | --- |
| W1 Serper/search、searchNews | [官方样例](https://serper.dev/)：P.organic[] 或 P.news[]，title/link/snippet；news 另有 source/date/imageUrl/position。AgentKey 入参支持 page/num/q/gl/hl/tbs | snippet 不是正文，source 是显示名称，原站 URL 才参与来源证据。date 样例是相对时间，不能冒充精确发布时间；没有稳定作者 ID/全量总数/has_more 保证。页数上限只是查询边界，不宣称搜全 |
| W2 Jina/readUrlPost | [JSON 文档](https://jina.ai/reader/)与[OpenAPI](https://docs.jina.ai/openapi.json)：Accept=application/json，P.code/status/data；正文对象为 P.data.url/title/content，可选 publishedTime、warning，schema 仅要求 url。成功默认 code=200、status=20000；费用取 AgentKey 外层 credits，不拿 Jina usage token 当积分 | 官方源码可从 Last-Modified 回填 publishedTime，所以它不总是首次发布时间，需保留来源依据；不据该字段自动刷新新闻时间。正文质量/登录墙取决于目标页。只发送 AgentKey describe 实际允许的字段，不能把 Jina 新增参数全部自动透传；不启用 ReaderLM/OCR/生成 alt/文件上传 |

## 7. 尚缺官方输出说明的清单与处置

不是所有“尚未验证”都要付费。以下项目优先通过补文档、供应商提供的脱敏样例或已有公开证据解决；本轮没有代用户联系供应商。

1. **完整输出层级/类型**：T2、T3、T4、T5、T6、T9、T11、T13、T15、T16、T20、T21、T22 的表中所列字段。部分已有分页或内容语义，不再将整组标为完全未知。
2. **部分字段仍未声明**：T1 V1 会话路径；T8 文章分支；T10 时间单位；T12 user 稳定 ID；T14 时间格式；T17 正文/作者具体键；T18 稳定频道身份；T19 详情身份/时间；J2 非空回复；J3/J4 作者和全文；J6 作品—作者映射。
3. **输入输出的限制已经明确**：Threads 不分页、IMDb 有输出游标却无翻页输入、公众号 page_size 无效、西瓜详情无标题、YouTube 列表无描述。这些按限制设计，不再列为“试调用后可能支持”。
4. **服务保证缺失**：X 高级语法/X Article、未明确日期时区与时间单位、私密/付费/删除枚举、首次/末页和截断规则、公众号更新延迟。不用某一次成功样例替代长期兼容承诺。
5. **文档版本差异**：AgentKey 目录与 TikHub SDK 13 项不一致、Jina 参数更新、豆瓣两项公开样例缺失。先核对选定工具的精确版本；差异仅影响实际用到的能力，不为未使用工具建设同步平台。

在补齐之前，缺必需输出的**具体操作**不标“已可导入/已可切换”；其余已证实的查询或快照不被连带阻断。可以先写有依据的合同和离线桩，但用户尚未授权开发，本轮不实施。范围仍覆盖全部相关平台，证据缺口是未完成项，不是暗中删减范围。

## 8. 确实需要另行授权真实调用的项目

| 项目 | 为什么文档不能证明 | 最小验证方向（不是本轮授权） |
| --- | --- | --- |
| L1 账户与当时服务可用性 | 当前 key 的权限、分类启停、额度和某条路线可用性是运行事实；公开 healthy 不等于本账户可用 | 对已批准路线用一个公开对象/最小页面确认，不采集生产信源、不切换 |
| L2 端到端响应保真 | 文档已明确输出，但仍需证明 AgentKey→MCP→SDK 实际保留嵌套结构、错误、ID 字面量与 credits 字段 | 在正式适配器中保存一份脱敏原始回执，核对 64 位 ID；不能用直接调 TikHub 的结果代替 |
| L3 真实分页与内容边界 | 公开样例通常是首页，不能证明当次下一页、空页、内容截断、具体私密/删除对象的实际响应 | 仅对所需路线增加一页，或选一个有明确预期的长内容；不通过无限翻页验证“不漏采” |
| L4 实扣与耗时 | 报价及字段合同不是本账户本次实扣，计量型费用取决于内容；未知超时也不保证免费 | 核对同一 attempt 的 credits_charged 与 Console 记录；不刻意制造收费失败、耗尽额度或重试风暴 |

这些验证用于确认文档合同与真实接通是否一致；**不把现在可以确定的输出设计拖到实现中，也不把一次成功当成所有平台全量可用**。恢复幂等、旧轮切换失效、权限隔离、缺预算阻断等本地逻辑依然用桩验证，不需要真实调用来证明。

## 9. 一致性复审结论

- 继续复用 subscriptions/runs/results/receipts、现有身份绑定和材料入口；没有新增表、状态、自动路由或文档同步平台。
- 返回 provider、实扣 credits、账户额度及栏目关闭已有合同；删除为这些已明确事实预留的笼统不确定表述。
- 搜索摘要、原始正文、相对时间、响应时间和作者身份分别有明确归属；不能拿字段“存在”绕过内容/权限校验。
- 普通查询可用、材料可导入、定时分页可持续、已有信源可切换是不同结论，按当前实际需求预检；辅助字段缺失不扩大成全局门禁。
- 本轮补充了实现依据及明确缺口，**没有证明所有路线输出已闭合，也没有执行开发或真实兼容验证**。后续开发不得跳过本清单中仍影响必需语义的缺口。

## 10. 同日四项闭合复核

依据[完整方案 §2.4、§6.1、§7.3、§9](../agentkey-integration-plan.md)、[固定路线矩阵](2026-10-21-agentkey-route-matrix.md)及当前回执、run、恢复源码，对四项复审意见逐项复核如下。

### 10.1 固定路线与输入输出矩阵

矩阵已拆成 233 条业务路线：212 条 AgentKey 行和 21 条直连 Redfox 行。每行分别记录 AIHOT 结果类型、provider/上游、精确工具、输入、输出、分页/末页、恢复键、实际用途及证据/阻断。

- 212 个 AgentKey 工具全部存在于 `docs/reviews/2026-10-21-agentkey-catalog.json`，无缺失或重复。
- 21 个 Redfox ID 全部存在于 `docs/redfox-api-inventory.md`，并均可在 `packages/backend/src/providers/redfox` 的现有 contract/parser/执行代码中定位。
- AgentKey 行均有唯一的 `operation=agentkey.<platform>.<capability>` 与对应 `.query` step；91 条为 `readOnly`，121 条维持 `needs_review`。数据行没有误登记 `readOnlyPoll`/`remoteSubmit`。
- `readOnly` 只描述同步只读结果的未知恢复策略，不是执行许可；同一行仍可因输入、输出、身份、导入或分页证据不足而被 Q/I/S/X 阻断。
- `doc`、`sample`、`gap` 当前分别出现 78、23、201 次，三者可在同一行并存，不能相加作为路线数或完成率。201 条含 `gap` 的行都按具体任务写出阻断；其中 197 条直接标记在 I/S/X 用途中，另外 4 条把缺口限定为当前可选字段或已完成字段的部分缺失，没有晋升成完整能力。
- 输入输出不是从平台常识补齐：已有官方文档或公开样例的字段直接进入矩阵；仍缺的 exact schema、身份/正文/URL/时间、末页和研究字段继续标 gap，并阻断受影响操作。

### 10.2 错误响应持久化

当前 [receipts.ts](../../packages/backend/src/providers/receipts.ts) 的 `ProviderRejectedError` 只保存 `status/retryable`，捕获后仅落截断文案，确实会丢失已收到的完整错误 envelope、请求号和费用证据。方案因此要求：

1. 扩展同一个 `ProviderRejectedError`，可选携带已脱敏、有界的 response/requestId/usage/cost。
2. 在同一事务更新原 receipt 和本次 attempt 的既有 response/request_id/usage/cost 字段。
3. HTTP 400/401/402/429、200+isError、JSON-RPC error、disabled、上游业务错误都先保存可用原文，再分类。
4. 完整响应后的 parser/身份失败保留 received；修复 parser 后只做本地恢复。
5. 只有未取得完整 envelope、连接中断或响应落库前进程中断才进入 unknown。
6. 402 的“未调用上游”是官方语义，不代表本地没有 attempt；缺少实扣仍为未知，不能写成 0。

该修订复用现有列和状态，没有新增错误表、重试状态机或第二套回执保护。

### 10.3 空结果步骤结果

当前 [store.ts](../../packages/backend/src/providers/operations/store.ts) 的 `advanceRun()` 在存在当前回执时，要求本 run/step 至少关联一条 `operation_results`；否则不能消费回执和推进。方案明确每个成功的 AgentKey `execute_tool` 都先写既有 `kind="query_summary"`：

- 搜索零命中、评论空页、最终空页和合法的详情不存在均写 `count=0`。
- 只有有证据时才写 cursor、下一页/末页、停止原因、查询窗口和步骤序号，不用 null 冒充未证实字段。
- summary 与 receipt 关联，在同一事务里完成步骤；它是完成/计费证据，不进入材料、来源权限或新闻结果。
- 非法 payload、认证/额度/业务拒绝、parser 失败和不完整 transport 均不能写 count=0 后推进。

没有新增结果 kind、空状态或供应商专属结果表。

### 10.4 AgentKey 恢复分类

当前 [recovery.ts](../../packages/backend/src/providers/operations/recovery.ts) 已使用精确 step 白名单及精确 `recoverOperations()` operation-key 集合，未知回执超过 30 分钟最多自动放行一次。AgentKey 沿用该结构：

- 业务 operation 固定为 `agentkey.<platform>.<capability>`，同步 step 固定为同名加 `.query`。
- 只有矩阵精确登记的同步只读对进入 `readOnly`；不在代码中用 `agentkey.` 前缀动态创建白名单。
- `readOnlyPoll` 只有持久化 task ID 时才允许轮询；`remoteSubmit` 未知永不自动重发；未知键、键不配对或轮询缺 task ID 一律 needs_review。
- 供应商切换后迟到响应仍归原 attempt；旧轮不得写新 cursor/material，即使回执已被既有规则释放。
- SocialData `x.page`、大加辣 `mp.list/mp.body` 和现有 Redfox 精确分类保持不变。

本轮后半段已运行代码测试，并且只对抖音 V4 首页执行了一次成功真实只读调用；它不替代真实第二页、定时多轮、异常恢复或其他平台的上线验收。
