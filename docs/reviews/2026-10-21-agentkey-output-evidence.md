# AgentKey 输出证据逐项核验（2026-10-22 第二阶段要求修订）

> 对应[完整接入方案](../agentkey-integration-plan.md)。截至2026-10-23，65条中60条已按用途完成本地验收（抖音11、公众号6、头条3、小红书9、B站11、微博8、X12）；X已接通12类Q、5类作品手动I及10类单页S，后端、Web和真实本地浏览器已验，最终状态/清理已通过，截图1–228每处均有原图和批注图共456PNG，最终批注图由Lead逐张回看；另5条尚未接入（抖音粉丝、头条视频、小红书回复、微博粉丝、公众号相关文章各1），仍保留在65条范围，未移入第三阶段。累计59次真实数据请求，57个响应报告扣费合计29.4 credits；抖音粉丝400和微博粉丝400两次缺credits_charged，保留未知，不按实测0或已完整对账表述。65条免费合同调查与真实补证、本地桩验收分别记录；公众号无真实调用，当前汇总与新增证据见§18–§21。

## 1. 证据口径

本次不再把“目录里存在接口”当作输出已经确认。分别核对作品身份、作者身份、原文、内容、发布时间、分页、错误和计费。

字段核验清单不等于所有用途的必填项。单次查询只需合法输入、只读行为和可理解的成功/空结果；材料身份/权限/原文必须有据，正文待补、未知时间可沿既有 pending/历史回填规则处理。持续翻页才核后页/末页，精确时间过滤或必需全文才要求对应字段。辅助研究按评论、账号、关系、计数、建议词和榜单各自最低用途验收，完整规则见主方案 §12.2 与矩阵开头。

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
- **仍有限制**：V4 没有“任意起止日、精准匹配”兼容保证，只限制确实使用这些条件的任务。V1 会话路径和部分传输类型属未选路线的证据缺口，不作为第二阶段补证任务。不能用本地截断冒充上游完整时间筛选。
- 方案维持每项一条路线；真实可用性优先于版本号，因此固定 V4 而不增加运行时版本选择器。真实第二页由官方 cursor 契约与本地桩覆盖；未为再证明一次翻页消耗额外额度。

### T2. 抖音账号作品、详情

已查 [douyin/app/v3/fetch_user_post_videos](https://docs.tikhub.io/186826223e0)、[douyin/app/v3/fetch_one_video_v2](https://docs.tikhub.io/232379587e0)。列表使用 sec_user_id、max_cursor，count≤20；详情说明 `P.data.filter_list[0].reason` 的私密、删除/地区限制等情况，其中 reason=8 有多种原因，不能唯一解释成删除。开发授权前缺少完整成功结构；**2026-10-22 免费样例与两次获准调用已补到列表/详情的实际层级、作者和内容字段，见 §12**。列表默认 normal，不因文档推荐而自动再买 lite/Web 路线。成功样例没有证明删除/私密、空页或所有末页返回形态。

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

上述身份/正文/时间合同已有证据，撤回“公众号链路全都留待真实调用确认”的表述。尚未获得文章发现实时性/T+1 的服务保证，不借 Redfox 推断 TikHub。custom username 迁移后的长期稳定性和全部受限/删除错误枚举不作为整条链路的前置门槛：按同篇 H5/已有可靠绑定核身份，未知错误保留原响应待核对；只有任务依赖特定时效或受限页面语义时才单独检查。profile 精确输入已由本日免费 describe 补齐：username 支持三种形态，raw=false 固定，见矩阵；未实测本账户权限。

### T8. 微信综合搜索

[wechat_search/v2/fetch_search](https://docs.tikhub.io/472974860e0) 明确 raw=false 的 `P.data.items[]/cursor/continue_flag/count/no_more/categories[]`。**只传 offset 不会翻页**，必须回传 cursor 并保持 sort/publish_time。账号项 `jumpInfo.userName` 可串联公众号查询；视频项 exportId + feedNonceId 可串联视频号详情。

total 是多个结果盒子的最大值，零结果可能 null，不是可用来判全量完成的精确总数。文档明确部分垂类当前恒空且计费，不能把 news/AI search 等所有 enum 都做成可用能力；该分组属第三阶段，届时只按有说明的实际用途开放。文章项的真实文章链接/正文与稳定身份具体路径仍需补官方样例，docID 不自动作为文章身份。

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

账号资料、关系、评论、榜单不按“材料完整性”统一验收：单页研究需实际输入和可理解输出，时间窗口/分页仅在用途需要时核对；缺作者 ID 的评论可保留为研究结果，不据昵称授予新闻信源权限。辅助能力已在矩阵逐项固定一条路线，不再补接全部同义版本；缺的是这些工具各自的输入/输出证据，不能从同平台搜索/详情合同外推。具体补充：

| 编号 / 辅助用途 | 已补齐输出 | 剩余缺口 |
| --- | --- | --- |
| A1 评论和二级回复 | [wechat_mp/v2/fetch_article_comments](https://docs.tikhub.io/472974853e0) raw=false：P.data.comments[].content_id/content/nick_name/create_time，buffer/has_more；[wechat_mp/v2/fetch_comment_replies](https://docs.tikhub.io/472974854e0)：replies[].reply_id/content/from_ai，next_offset/has_more；不能把文章 comment_id 当某条评论 content_id。[youtube/web_v2/get_video_comments](https://docs.tikhub.io/419083082e0) need_format=true：comments[].comment_id/content/author.channel_id/reply_continuation_token、顶层 continuation_token | 公众号精确输入/可见范围仍待补，时间单位未知按未知展示；YouTube 属第三阶段且 published_time 是相对时间。各平台先核对象/父评论关系与文本，增量去重或回复定位才需稳定评论 ID，翻页才需游标/结束；不能套公众号结构 |
| A2 账号资料、公开关系 | T7 已补公众号资料、T10 已补视频号 finder 标识；Facebook profile_id 见 J1，YouTube channel.id 见 T14 | 其他平台的“接受用户 ID”不代表“输出一定有稳定 ID”；粉丝/关注/点赞列表的账号 ID、翻页及可见范围没有因作品搜索被核实，仍须所选关系接口的单独样例。账号或关系结果不会自动授予信源权限 |
| A3 热榜、趋势、建议与统计 | 已核实 [twitter/web/fetch_trending](https://docs.tikhub.io/219522633e0) 可按 country 查趋势，但返回只写“趋势”；IMDb/豆瓣榜单已有具体样例，属第三阶段研究快照 | X 需补词条/成功结构，排名/热度/榜单时间有据才展示。搜索建议只核建议词，公众号文章统计只核文章定位与实际命名计数，推荐按内容项核；单对象不要求分页。不把采集时间冒充源内容发布时间，趋势词不创建新闻 |

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

1. **完整输出层级/类型**：T3、T4、T5、T6、T9、T11、T13、T15、T16、T20、T21、T22 的表中所列字段；T2 的成功结构已按 §12 补齐，尚未覆盖的边界单独保留。部分已有分页或内容语义，不再将整组标为完全未知。
2. **部分字段仍未声明**：T8 文章分支；T10 时间单位；T12 user 稳定 ID；T14 时间格式；T17 正文/作者具体键；T18 稳定频道身份；T19 详情身份/时间；J2 非空回复；J3/J4 作者和全文；J6 作品—作者映射。这些属于第三阶段；T1 的 V1 未选中，不要求为其补证。
3. **输入输出的限制已经明确**：Threads 不分页、IMDb 有输出游标却无翻页输入、公众号 page_size 无效、西瓜详情无标题、YouTube 列表无描述。这些按限制设计，不再列为“试调用后可能支持”。
4. **实际任务的语义保证**：X 高级语法/X Article、时间精度、正文截断、分页/末页和公众号更新延迟，只有当前用途依赖时才作为前提。不要求取得所有删除/私密情况的完整枚举才能查询；未知结构保留原回执待核对。单次样例不能证明所有高级过滤或全历史覆盖。
5. **文档版本差异**：AgentKey 目录与 TikHub SDK 13 项不一致、Jina 参数更新、豆瓣两项公开样例缺失。先核对选定工具的精确版本；差异仅影响实际用到的能力，不为未使用工具建设同步平台。

在补齐之前，缺必需输出的**具体用途**不标“已可导入/已可切换”，其余已证实查询/快照不被连带阻断。当前已授权第二阶段实施，七平台尚未完成的路线仍在第二阶段，其他 147 条候选属于第三阶段；证据缺口不等于删减范围。实施顺序及当前批次见主方案 §12.4—§12.7。

## 8. 确实需要另行授权真实调用的项目

| 项目 | 为什么文档不能证明 | 最小验证方向（不是本轮授权） |
| --- | --- | --- |
| L1 账户与当时服务可用性 | 当前 key 的权限、分类启停、额度和某条路线可用性是运行事实；公开 healthy 不等于本账户可用 | 对已批准路线用一个公开对象/最小页面确认，不采集生产信源、不切换 |
| L2 端到端响应保真 | 文档已明确输出，但仍需证明 AgentKey→MCP→SDK 实际保留嵌套结构、错误、ID 字面量与 credits 字段 | 在正式适配器中保存一份脱敏原始回执，核对 64 位 ID；不能用直接调 TikHub 的结果代替 |
| L3 真实分页与内容边界 | 公开样例通常是首页，不能证明当次下一页、空页、内容截断、具体私密/删除对象的实际响应 | 仅对所需路线增加一页，或选一个有明确预期的长内容；不通过无限翻页验证“不漏采” |
| L4 实扣与耗时 | 报价及字段合同不是本账户本次实扣，计量型费用取决于内容；未知超时也不保证免费 | 核对同一 attempt 的 credits_charged 与 Console 记录；不刻意制造收费失败、耗尽额度或重试风暴 |

这些验证用于确认文档合同与真实接通是否一致；**不把现在可以确定的输出设计拖到实现中，也不把一次成功当成所有平台全量可用**。恢复幂等、旧轮切换失效、权限隔离、缺预算阻断等本地逻辑依然用桩验证，不需要真实调用来证明。

## 9. 初次输出补证的一致性复审（历史记录）

- 继续复用 subscriptions/runs/results/receipts、现有身份绑定和材料入口；没有新增表、状态、自动路由或文档同步平台。
- 返回 provider、实扣 credits、账户额度及栏目关闭已有合同；删除为这些已明确事实预留的笼统不确定表述。
- 搜索摘要、原始正文、相对时间、响应时间和作者身份分别有明确归属；不能拿字段“存在”绕过内容/权限校验。
- 普通查询可用、材料可导入、定时分页可持续、已有信源可切换是不同结论，按当前实际需求预检；辅助字段缺失不扩大成全局门禁。
- 本轮补充了实现依据及明确缺口，**没有证明所有路线输出已闭合，也没有执行开发或真实兼容验证**。后续开发不得跳过本清单中仍影响必需语义的缺口。

## 10. 第一阶段前四项闭合复核（历史记录）

本节记录当时的方案评审与补缺，相关错误存证、空结果和恢复基础已在第一阶段实现。下列历史数字和“当时缺口”不作为第二阶段的新开发任务。

依据[完整方案 §2.4、§6.1、§7.3、§9](../agentkey-integration-plan.md)、[固定路线矩阵](2026-10-21-agentkey-route-matrix.md)及当前回执、run、恢复源码，对四项复审意见逐项复核如下。

### 10.1 固定路线与输入输出矩阵

矩阵已拆成 233 条业务路线：212 条 AgentKey 行和 21 条直连 Redfox 行。每行分别记录 AIHOT 结果类型、provider/上游、精确工具、输入、输出、分页/末页、恢复键、实际用途及证据/阻断。

- 212 个 AgentKey 工具全部存在于 `docs/reviews/2026-10-21-agentkey-catalog.json`，无缺失或重复。
- 21 个 Redfox ID 全部存在于 `docs/redfox-api-inventory.md`，并均可在 `packages/backend/src/providers/redfox` 的现有 contract/parser/执行代码中定位。
- AgentKey 行均有唯一的 `operation=agentkey.<platform>.<capability>` 与对应 `.query` step；91 条为 `readOnly`，121 条维持 `needs_review`。数据行没有误登记 `readOnlyPoll`/`remoteSubmit`。
- `readOnly` 只描述同步只读结果的未知恢复策略，不是执行许可；同一行仍可因输入、输出、身份、导入或分页证据不足而被 Q/I/S/X 阻断。
- 当时 `doc`、`sample`、`gap` 分别出现 78、23、201 次，属于修订前文本统计，不能相加作为路线数或完成率。第二阶段已删除无关的通用字段门槛，按用途重新标明缺口；这些历史文本计数不再用作当前开放标准。
- 输入输出不是从平台常识补齐：已有官方文档或公开样例的字段直接进入矩阵；仍缺的 exact schema、身份/正文/URL/时间、末页和研究字段继续标 gap，并阻断受影响操作。

### 10.2 错误响应持久化

第一阶段实施前，[receipts.ts](../../packages/backend/src/providers/receipts.ts) 的 `ProviderRejectedError` 只保存 `status/retryable`，捕获后仅落截断文案，会丢失已收到的错误 envelope、请求号和费用证据。当时提出且后续已实现的修订为：

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

第一阶段后续已运行代码测试，并且对抖音 V4 首页取得一次成功真实只读结果；它不替代真实第二页、定时多轮、异常恢复或其他平台的上线验收。

## 11. 第二阶段方案证据要求复核（开发授权前，2026-10-22）

- 七平台共 65 条精确工具绑定不变；本次未新增字段事实、供应商样例、运行验证或白名单许可。已有矩阵行的用途说明被修正，主要是移除不属于该操作的分页/榜单要求，以及明确最低输入输出缺口。
- 抖音账号/详情、小红书、B 站、微博、X、头条的缺口按 Q/I/S/X 分开；现有公众号列表/H5 的可用字段直接进入实现依据，不再等全部账号资料或长期服务保证齐全。
- 未知正文/时间复用既有 pending/历史回填；身份、权限和回执溯源要求不降低。是否需要详情由实际用途决定，不默认增加付费步骤。
- 第一阶段传输/预算/错误/恢复用现有测试验证；新增路线只补真实输入输出差异，主订阅与列表→详情增加必要集成验收。没有 65 套生命周期或测试框架。
- 免费文档补证与真实运行验证分列。已保存证据之外的缺口保持明确未完成；本轮未调用 AgentKey/TikHub/Redfox 数据工具，未开发或提交。

## 12. 第二阶段免费补证与获准最小验证（2026-10-22）

### 12.1 免费补证结果

七平台 65 条固定路线逐项取得 AgentKey 精确 `describe_tool` 与匹配 operationId 的 TikHub 官方页面，原目录快照未被覆盖；新增事实写入 `catalog.json.phase2Evidence`，逐行输入、字段、用途缺口写入固定路线矩阵。免费查询没有执行数据工具。分类从 91 条 readOnly / 121 条 needs_review 更新为 131 / 81；这只是候选文档的行为分类，**没有把 65 条路线全部注册进运行时或恢复白名单**。

本轮可直接确认的差异包括：抖音 following 的 source_type/max_time 首次握手不是末页；微博关注用 since_id、粉丝用 list.next_page；公众号 raw=false 的文章统计只有 comment_count/elected_comment_count，其他命名计数不可冒充已支持；X 的高级过滤和普通成功结构仍缺证据。完整逐项结论以矩阵与带 URL、SHA、字段路径的目录附录为准。

### 12.2 两次真实验证及精确成功结构

用户授权：官方文档公开账号的作品首页一次、其中一条作品详情一次，最多两次，只核响应；不创建任务、不导入、不切换。本次恰好执行两次，均返回 TikHub，AgentKey 分别报告 `credits_charged=0.2`，合计 **0.4 credits**。这里记录 Codex MCP 直接调用结果，不能当作 AIHOT 后端端到端联调证据。

| 固定工具 | 已确认的本次形态 |
| --- | --- |
| `TikHub/fetch_user_post_videos_api_v1_douyin_app_v3_fetch_user_post_videos_get` | `P.code=200`；`P.data.status_code=0`；`P.data.aweme_list[]`；本次 `has_more=1`、安全整数 `max_cursor`；账号 `uid/sec_uid` 与作品 `author.uid/sec_uid/nickname` 均是字符串；返回账号/作者 sec_uid 与请求相符 |
| `TikHub/fetch_one_video_v2_api_v1_douyin_app_v3_fetch_one_video_v2_get` | `P.code=200`；`P.data.aweme_detail`，**本次没有 P.data.status_code**；作品 ID 与请求相符；不得强行套入列表的 inner success code |

上述作品对象均出现 `aweme_id/desc/create_time/author/share_url/video.cover.url_list`；`aweme_id` 是字符串，`create_time` 是整数秒。V4 搜索的 PascalCase / 毫秒字符串保持自己的旧合同，不能合并猜测。描述是作品说明，不是音视频转写；导入不因此获得全文许可或公开权限。

仓库仅保存结构、字段类型、匹配布尔结论和占位参数，没有保存本次作品/作者身份、文本、媒体 URL 或认证字段值。响应出现的 `authentication_token` 需沿现有回执脱敏处理；展示和导入只取白名单字段。

依据：[账号作品文档](https://docs.tikhub.io/186826223e0)、[所选详情 V2 文档](https://docs.tikhub.io/232379587e0)、[固定提交的公开账号列表 Demo](https://github.com/TikHub/TikHub-API-Demo/blob/a0585848777e3222c91914c410773fe88c0cf01e/Douyin/APP%20API%20Demo/profile_videos_downloader.py)。Demo 只作免费结构证据，没有执行其下载或 dotenv 逻辑。

### 12.3 仍未证明的边界与本批承接

- 一次首页和一条详情没有证明真实后页、末页、空页、所有账号/作品可见性、完整删除/私密原因，或所有高级过滤。它们分别按已确认文档与本地桩验证，未知结构保留回执待核对，不自动更换工具。
- 新账号作品及其可选逐条详情沿既有 subscription/run/result/receipt/material 链实现；分页与详情共享同一个 run，详情逐项受原有限额与次数预算控制。新作者仍隔离，缺可靠身份不导入；缺列表作者但有原生作品 ID 时，可由显式启用的详情补证。
- 本批只扩展账号作品和详情，不将抖音账号搜索、建议词等外层结构仍有缺口的工具提前开放；其他七平台路线继续按第二阶段顺序处理，未因缺口退到第三阶段。
- Redfox 账号作品不启用详情时，只转换有据的 secUserId/排序；未使用排序不形成硬门槛，切换预览披露默认最新。Redfox 优质库作品 ID/所需正文与 TikHub 原生 ID/描述的等价关系未闭合时，**开启详情补全的旧订阅暂不能切换**，不以两个详情接口都存在当作兼容证明。
- 本批本地验证和 UI 验收另记实际结果，不用这两次真实调用替代调度、中断恢复、切换隔离或预算验证。更多真实调用须重新确认。

本批本地验收已完成，结果与范围见主方案 §12.8 及[七处 UI 批注截图](agentkey-phase2-ui-2026-10-22/README.md)。它不扩大真实调用授权或缺证工具的可用结论。


## 13. 追加获准的搜索建议与账号搜索（2026-10-22）

用户再次单独批准：关键词“人工智能”，搜索建议、无筛选账号搜索首页各 1 次，最多 2 次、报价合计不超过 0.4 credits，涨价停止；仅核响应，不创建 AIHOT 任务、导入或切换。执行前重新 describe 两工具，均仍为 0.2；两次均成功，实扣分别 0.2，合计 0.4。本阶段已有的前两次为另一份独立授权，四次累计 0.8 credits；没有自动重试或调用兄弟版本。

- 搜索建议固定 `TikHub/fetch_search_suggest_api_v1_douyin_search_fetch_search_suggest_post`：`P.code=200`，`P.data.status_code=0`，`P.data.sug_list[]` 本次 5 条，`content` 是字符串。由完整成功节点中的空数组定义合法空结果，不能把缺数组/data:null 当空；本次未实测零结果。
- 账号搜索固定 `TikHub/fetch_user_search_api_v1_douyin_search_fetch_user_search_post`：`P.code=200`，`P.data.status_code=0`；`P.data.user_list[]` 本次 10 条，**全部没有直接 user_info，而是 dynamic_patch.raw_data JSON 字符串，其解析后的 user_info 才含账号字段**。十条 uid/sec_uid/nickname 均字符串，follower_count 是数字；signature 并非每项存在。部分无关直播 room_id 是不安全整数，不应复制或用于账号身份。
- 文档描述的直接 `user_info` 与观测到的 JSON 字符串层分别处理；只按明确结构用已有无损 JSON 解析，绝不执行 dynamic_patch 的 schema、脚本或链接。结果仅保留字段白名单，原回执沿已有脱敏/保留规则处理。仓库仅存字段、类型、计数与匹配结论，不保存真实账号、昵称、头像、raw_data 或认证值。
- 返回 cursor 是数字、has_more=1，但 search_id 与 extra.search_request_id 等价仍未证明；可选筛选枚举仍与 property 描述冲突。因此本批只开放无筛选首页 Q、可靠实收身份的显式本地绑定；不开放筛选/后页、不自动绑定、不把账号当材料。建议词仅 Q 研究工具，不进入新闻材料或新增定时生命周期。

这两条已实现并完成本地验收，范围见主方案 §12.9 和 UI 索引；并未开放未经证实的筛选或续页。先前 T2/§12 的两次授权和成功证据仍单独保留；更新后的矩阵与 catalog.phase2Evidence 分别记录本次证据，不能将总费用或完成数重复累加。


## 14. 抖音剩余七项授权补证（2026-10-22）

本批先免费核余额 447.6 credits；授权上限 8 次、1.6 credits，实际 7 次：账号资料、热榜、评论、回复、话题和关注 6 次成功，各报告 0.2 credits；粉丝接口一次返回 400/validation、无 credits_charged，不重试。关注 source_type=2 已返回 19 个成员，按已确认条件跳过 source_type=1 第二步。共用回执实扣概念与目录报价分开：本批成功响应报告合计 1.2 credits，失败没有可独立核对的扣费数字；加前四次，累计 11 次执行／10 个成功响应报告 2.0 credits。不建任务、不导入、不切换，没有额外请求。

| 能力 | 实际补齐的输出证据 | 保留边界 |
| --- | --- | --- |
| account_profile | E.data.data.status_code=0；user 有 uid/nickname/user_deleted=true/special_state_info | 官方公开示例已注销、缺 sec_uid；仅可实现注销状态研究，不能外推正常资料或绑定 |
| trending | E.data.data.data.word_list 共 51 项；word/sentence_id/hot_value 为 string/string/number；trending_list 另有 5 项 | 单次榜单快照，不要求账号/发表时间或新闻导入 |
| comments | E.data.data.comments 共 20 项；cid/text/aweme_id 都是 string，create_time/digg_count/reply_comment_total 为 number，user.uid/sec_uid 为 string | 所有 aweme_id 与请求一致；游标是已收分页事实，不表示后页已验证；不导入文章 |
| comment_replies | 同一路径 15 项；cid/reply_id/aweme_id 为 string，所有 reply_id/aweme_id 与冻结父评论/作品一致 | reply_to_userid/sec_id 可缺；不是新文章或账号绑定入口 |
| topic_posts | aweme_list 合法为空，但 mix_list 共 10 项、type=1，作品在 mix_list[].aweme_info；作品 ID/作者 uid/sec_uid 为 string | 不能按 aweme_list 判空；作品材料仍逐项验收身份、时间与权限，不等于完整分页已证 |
| followers | 上游拒绝 400/validation，未获得成功输出 | 继续阻断该路线，不猜成功结构、不换参数重试 |
| following | E.data.data.followings 共 19 项；uid/sec_uid/nickname/signature 为 string、粉丝/关注数为 number；max_time 是安全整数、has_more 是 boolean | source_type=2 这次直接有实质列表；空初始化和 source_type=1 后续页仍未观测，不自动补第二次 |

仓库仅保留字段路径、类型、数量、状态与依赖匹配的布尔结论，见 catalog.phase2Evidence.remainingDouyinLiveContractEvidence；没有实收 ID、昵称、评论、媒体或认证值。原响应仅用于本轮内存核验。comment_token 与 yt_raw_token 的共用脱敏缺口已纳入原 response.ts 修正，不另建隐私表或处理框架。上述仅是直接MCP样本证据。其后其中五条首页快照及注销态资料按§15完成本地接入，粉丝仍未开放。


## 15. 有据部分的本地接入与验收边界

公众号6条基于官方raw=false合同完成查询、主信源及同轮H5补全/显式切换，不声明真实公众号响应验证；相关文章非空结构仍缺，未开放。抖音热榜、评论/回复、话题作品、关注共5条Q/单页S及仅注销态资料Q已本地验收；正常资料/粉丝、其他榜、连续分页和关注第二步仍缺证，不用fixture升级为真实证据。

字段白名单、原回执和Q/I/S分界分别落地，研究不进文章；话题作品仍经原材料证据校验。独立后端及UI必要接线复核无剩余P1/P2/P3。截至该抖音批次Web322/322及构建、类型检查通过；新后端parser6/6、集成5/5，组合101/102后错误文本顺序修正相关32/32通过。完整测试范围与真实本地页面证据见主方案§12.10–12.11及[47处UI截图索引](agentkey-phase2-ui-2026-10-22/README.md)。这些数字不相加、不把直接调用或本地桩当生产验收。


## 16. 头条四条单独授权响应（2026-10-22）

用户另获准最多4次／0.8credits：文章详情、视频详情、账号资料、评论首页各1次。先免费核余额446.4，再逐条describe核价仍0.2并各执行一次；4个响应均报告0.2，合计0.8，包括返回业务错误的视频。没有重试、换ID、换版、后页、任务创建、导入或切换。累计15次数据执行／14个响应报告2.8credits，另一次抖音粉丝失败缺扣费字段；不将未用授权转到其他工具。

E为AgentKey envelope，P=E.data为TikHub payload；字段如下（仅存类型、路径和匹配布尔，不存实收内容/身份值）：

| 工具/用途 | 本次有据结构 | 仍受限用途 |
| --- | --- | --- |
| get_article_info / 文章详情 | E.data.code=200；E.data.data.message=success；对象E.data.data.data。group_id是超安全范围整数原文，经现有无损JSON转十进制串，itemCell.articleBase.gidStr为字符串，均匹配请求。share_info.title非空分享标题；user_info.user_id/name及media_info.user_id、itemCell.userInfo.userID相符。share_url为同作品m.toutiao.com/article/，display_url为toutiao.com/group/；data.url是外部出版方URL | 没有正文或发表时间字段；context是元数据JSON，script为空，不能当正文。Q可展示分享标题/作者与原文；I另验证身份和原生链接，正文pending、未知时间回填。不新增发现订阅或Redfox列表跨商补详情 |
| get_user_info / 账号资料 | E.data.code=200；E.data.data.errno=0/message=success；对象E.data.data.data。user_id为安全整数并匹配请求；name/description/avatar_url/big_avatar_url为空，publish_count/digg_count/followers_count/followings_count均为0 | 原样例只证明全空资料，不推断注销/私密；现parser接受同字段真实非空Q，绑定/I/S仍不开放 |
| get_comments / 评论首页 | E.data.code=200；E.data.data.err_no=0/message=success；E.data.data.data[]共20项cell_type=1，其comment.text为字符串、id为超安全整数原文、id_str字符串逐条相符；group.group_id无损后匹配冻结作品。has_more=true为boolean、offset=20/total_number为number | offset输入必须字符串0；create_time仅number、单位未知。可先Q/单页研究S，不导入/绑定，不由offset+20推测末页。空结果沿明确成功+数组合同本地验证，不声称已实测空/末页 |
| get_video_info / 视频详情 | 外层E.data.code=200，但E.data.data.err_no=10400、data=null，报告扣费0.2 | 是业务错误，不是合法空视频或成功结构；仍未实现，不注册仅错误路径的空适配器，不自动重试或换ID |

精确工具/schema/官方路径与类型证据写入catalog.phase2Evidence.toutiaoLiveContractEvidence；四个官方页分别[文章](https://docs.tikhub.io/251380586e0.md)、[视频](https://docs.tikhub.io/251380587e0.md)、[账号](https://docs.tikhub.io/251380589e0.md)、[评论](https://docs.tikhub.io/251380588e0.md)。这是直接MCP补证；其后头条三条本地验收见§18，视频仍缺成功合同。


## 17. 小红书十条按持续授权的补证（2026-10-22）

用户明确后续批次按推荐直接推进，不必逐批请示；仍限当前七平台最小只读补证。先说明核心3次/6credits、免费核余额445.6并核价，随后说明辅助7次/14credits、免费核余额439.6，均按当前每次2credits执行。实际10次/20credits，无重试、换ID、后页、兜底、任务创建、导入或切换。回复只用本次评论中同笔记实收父ID；该父评论回复数0，实收合法空，没有为凑非空另买一次。当前累计25次数据执行、24个响应报告22.8credits，抖音粉丝失败仍缺扣费字段。

精确路径/类型/数量/匹配布尔存于catalog.phase2Evidence.xiaohongshuLiveContractEvidence；不保存实收笔记/作者/评论/签名query值。九条有意义成功输出可进入实现，回复只证合法空、非空父子关系仍缺，十条范围保留不宣称全完成。

- 搜索：E.data.data.code0/successtrue；data.items20，其中model_type=note15、ads5。note.id/user.userid及标题/desc有据，混合广告不作笔记；search_id/search_session_id位于E.data.data根，page1/next_page2，无本次末页证据。
- 账号笔记：data.notes22、全部user.userid匹配请求；has_more布尔、末项cursor字符串。两种type为normal/video；不能用默认数量假定返回条数或按number猜时间单位。
- 统一详情：data数组→model_type=note→note_list[]，本次视频笔记有标题/desc；id匹配请求，user.id/userid和外层user.userid一致。share_info.link是同笔记HTTPS原生/discovery/item/，带签名query，运行时保留原串，不猜/explore或剥除query；不下载播放流/转写。时间单位仍未知。
- 评论：data.comments10、note_id均匹配冻结笔记；id/content/user.userid为字符串；cursor/has_more/page_context准确保存。回复：data.comments=[]/has_more=false/page_context字符串，本次没有文档提到的cursor对象，非空回复结构未证。
- 账号搜索：data.users20的id/name/desc/image/red_id/link；search_id/page/next_page在操作根。资料：data.userid匹配请求，nickname/desc/fans/follows等有据，内部result.code0/successtrue；red_id是展示号，不当稳定用户ID。
- 话题：data.items10中user.user_id、share_info.link为对应原生/discovery/item/；has_more布尔，末项cursor_score/id/create_time有据，但未返回first_load_time/session_id，不发明连续会话。
- 建议词：操作层oktrue/status200/code1000/successtrue，data.sug_items[].text10条；1000只在这条已证成功，不能加入全局成功码白名单。推荐：oktrue/status200/code0/successtrue、data.items20含note_card；仅provider_recommendation研究，不冒充搜索命中或自动导入。

九条其后已完成Q及有据I/S本地验收，见§18；直接调用不证明AIHOT端到端。原官方页与固定工具保留在矩阵及目录逐行source，未改用其他版本。

## 18. 头条三条与小红书九条的本地验收（截至2026-10-23）

头条article_detail/comments/account_profile三条已完成本地验收；视频err_no10400仍未接入。profile原样例全空，parser允许同字段合同的真实非空Q，不是blank-only，不绑定、不I、不独立S。文章按已收原文/作者有据I，正文pending、未知时间回填；评论只研究/单页S，不串Redfox发现链。

头条后端33/33、元数据1/1、Root最后profile8/8；Web先前323/323，最后profile局部33/33，类型检查和构建通过，未宣称最后一次完整323。小红书九条Q、有据详情/话题I、显式账号绑定和五条首页S完成；回复仅合法空，非空父子合同仍缺。后端相关29/29及末次可选作者1/1；Web最终4文件29/29、类型检查和构建通过。仅AgentKey推荐禁I不误伤Redfox、嵌套stats显示两项Web缺陷及Root评论ID显示P3均已修复。

XHS九Q/实际两条UI S（搜索有界详情、评论快照；后端共支持五类S）、同run详情默认0与显式1、研究无I、绑定、跨商预检不支持、跨源去重/隔离权限、最终全部停用均已在独立UI测试库与本地桩核验。该批截图索引01–87每处原图与批注配对共174PNG，最终批注图已逐张回看。执行脚本调用原执行器，无常驻Worker，无真实UI供应商请求，不冒称resident E2E；详见主方案§12.12–12.13与UI README。

## 19. B站/微博/X真实字段与阶段汇总（截至2026-10-23）

截至2026-10-23，65条中60条已按用途完成本地验收（抖音11、公众号6、头条3、小红书9、B站11、微博8、X12）；X已接通12类Q、5类作品手动I及10类单页S，后端、Web和真实本地浏览器已验，最终状态/清理已通过，截图1–228每处均有原图和批注图共456PNG，最终批注图由Lead逐张回看；另5条尚未接入（抖音粉丝、头条视频、小红书回复、微博粉丝、公众号相关文章各1），仍保留在65条范围，未移入第三阶段。累计59次真实数据请求，57个响应报告扣费合计29.4 credits；抖音粉丝400和微博粉丝400两次缺credits_charged，保留未知，不按实测0或已完整对账表述。

| 批次 | 实际请求 | 有扣费字段响应 | 已上报credits | 运行/验收结论 |
| --- | ---: | ---: | ---: | --- |
| 抖音第二阶段各批 | 11 | 10 | 2.0 | 11条用途受限本地验收；粉丝400缺扣费字段 |
| 今日头条 | 4 | 4 | 0.8 | 3条本地验收；视频业务错误也报告扣费 |
| 小红书 | 10 | 10 | 20.0 | 9条本地验收；回复只合法空仍未接 |
| B站 | 11 | 11 | 2.2 | 11条按用途本地验收；实际UI11Q/3S代表 |
| 微博 | 10 | 9 | 1.8 | 8条按用途完成本地验收，粉丝400未接 |
| X | 13 | 13 | 2.6 | 12类Q、5类手动I、10类单页S已本地验收；Top/Latest同工具两次 |
| 合计 | 59 | 57 | 29.4 | 不含第一阶段历史V5/V4调用，不与本次统计混加 |

B站：综合搜索是data.item[goto=av]，按类型video是data.items，均只收到AV；账号视频有BV但无MID，不能用请求账号补作者。详情data有aid/bvid/owner.mid，实际BV+MID才I，desc是视频说明、时间单位未知；评论data.replies、回复data.root.replies验证OID/root，不能把字符串next_offset套入integer请求。资料data.card稳定MID可绑定；统计直接P.data的mid/following/follower，没有内层code0。动态区分当前作者/转发作者和orig，推荐无MID只研究，热搜trending.list无真实排名。精确路径/类型/安全性与匹配谓词存catalog.phase2Evidence.bilibiliLiveContractEvidence。

B站Q首8/8后仍发现两处实质缺陷：动态inactive字段真实null、Q被可选作者/正文门槛拒绝。Root先红2/2再修复绿10/10。I首21/23，两项测试fixture与本地桩预算更正后23/23；不抹去首次失败。S九条首页及三类列表显式同run有界补全已由Lead运行20/20，独立评审无剩余P1/P2/P3；S期间verified AgentKey typed_search错误依赖Redfox shape已修。Web最终7文件58/58、types通过，11条按用途完成本地验收；UI实际11Q/3S代表，九条是后端S种类而非九类浏览器运行。Root浏览器发现嵌套pagination.page/accountTotal摘要P3-1，SSR红1/1→修复绿1/1；两次独立review未发现该项，保留此遗漏轨迹。99–109最终重拍。

微博：搜索items[category=feed].data及group内feed分别有综合/实时样例（仅1/61）；时间线只all/page1，无转发样例。详情detailInfo.status的数字ID/mblogid/UID别名已核，样例非长微博、无HTTP原文；sinaweibo scheme不是新闻原文。评论items[type=comment].data，冻结status与评论root角色分开，不把rootid当响应作品范围。资料header.data.userInfo；关注P.data.data.users[].user及opaque since_id；粉丝400无成功结构。热搜group内card_type4的desc仅词条，无原生排名；相关词hotquery[].suggestion，不把夹带user当账号搜索。精确类型/谓词存catalog.phase2Evidence.weiboLiveContractEvidence。

微博粉丝拒绝后批次先停；免费诊断排除全局鉴权/额度、余额变动与此前六个已上报费用一致后，只继续三条剩余不同请求，没有重试或换ID。九路10次为只读补证；其后八条后端Q最终8/8、I最终28/28（13 AgentKey+15原Redfox）通过，S/X最终Lead修复后36/36、独立定向review关闭P2，Web及UI8Q/6S完成，八条按用途本地验收。I首次26/28因cross-provider测试未提高RF预算，一项子test前置失败传播为两fail；修正前置并恢复两家budget后28/28，不是产品绕过预算。Ireview无具体问题；粉丝未接。S/X35/35漏账号列表无UID时详情异UID，第二项实质错误后执行者停止，Lead修正回归fixture后复现并最小修复，最终36/36，不抹去purpose陈旧第一错、漏测和红测。

用户持续授权后续七平台按推荐最小只读批次推进，无需逐批再问；每批仍先免费核余额与逐条核价，不重试、换ID、翻页、创建AIHOT任务、导入或切换；涨价、全局鉴权/额度或异常收费即停。历史逐批授权保留，不将未用次数转用；开发本地桩中的任务/导入/切换与真实补证授权分别记录。提交、推送和部署仍未授权。

## 20. X十二条最小只读补证（2026-10-23）

固定12工具共13次，search Top/Latest各一次；13回执各报告0.2，合计2.6 credits，全部成功。批前免费余额421.6，未额外事后查询；无重试、换ID、后页、媒体/Article额外请求。仅保存路径/类型/数量及匹配谓词，原始响应不落仓库。X十二条已按用途本地验收：12类Q、5类手动I、10类单页S，后端/Web/真实本地浏览器已验；最终状态/清理已通过，末批226–228已截图并由Lead回看。

E为AgentKey envelope，P=E.data，P.code=200；以下操作对象B均为E.data.data。search/posts/followers/following/list_members/community_members的status=ok；profile/detail/comments为active；列表帖/社区帖/趋势无status字段。没有把缺字段或active套成全局成功码。

| 固定能力 | 已收最小有意义输出 | 仅约束实际依赖用途的缺口 |
| --- | --- | --- |
| search | B.timeline[]19/20；tweet_id/text/created_at、user_info.rest_id/screen_name；Top与Latest各一份，quoted嵌套角色另列 | next_cursor非空；仅首页；高级算子from/OR/回复/日期及后页未证；普通Q已有字段；直接reply-parent缺失只限制依赖回复排除/归属的用途，quoted不可替代当前作者 |
| account_posts | B.timeline[]20，author.rest_id；user实际profile/rest_id上下文匹配；retweeted/retweeted_tweet16、quoted4，另有pinned | next_cursor非空；仅首页；pinned不是新发现时间证据；普通Q已有字段；当前作者handle实收null，使用实际user上下文核对而非注入请求；转发原作者与外层作者分开，直接reply-parent未返 |
| account_profile | B.status=active；profile/rest_id/id/name/desc；实际handle与请求、id/rest_id相符 | 单对象，不需分页；普通Q已有字段；稳定ID保持字符串，未测不安全大整数输入；仅既有匹配单账号来源绑定，后端I已验收 |
| detail | B.status=active；id/author.rest_id/screen_name/created_at/text/display_text；冻结TweetID和实收作者别名匹配 | 单对象，不需分页；原HTTP链接未收到；普通Q已有字段；text与display_text实收不同，不能宣称全文或Article正文已证；in_reply_to_*本次null不能证明任意回复结构 |
| comments | B.根对象id/author独立，thread[]34各有id/author/text/display_text/conversation_id；根不混作评论 | cursor非空；仅首页；普通会话研究Q已有字段；conversation_id匹配根不证明全部直接回复，thread缺直接reply-parent，不导入文章 |
| followers | B.followers[]70：user_id/screen_name/name/description与统计；status=ok | next_cursor非空、more_users=true；后页未执行；普通账号/关系Q已有字段，不要求材料正文/文章URL/发表时间；研究无I；单页S已本地验收，不自动续页；无等价供应商则拒绝切换 |
| following | B.following[]70：user_id/screen_name/name/description与统计；status=ok | next_cursor非空、more_users=true；后页未执行；普通账号/关系Q已有字段，不要求材料正文/文章URL/发表时间；研究无I；单页S已本地验收，不自动续页；无等价供应商则拒绝切换 |
| list_posts | B.timeline[]99：tweet_id/text/created_at/author.rest_id/screen_name；外层作者别名一致 | cursor非空；只首页；未返回容器ID；普通内容研究Q已有字段；容器ID不是作者，范围身份只按实际证据；不能假补status或未见引用/转发变体 |
| community_posts | B.timeline[]19：tweet_id/text/created_at/author.rest_id/screen_name；外层作者别名一致 | cursor非空；只首页；未返回容器ID；普通内容研究Q已有字段；容器ID不是作者，范围身份只按实际证据；不能假补status或未见引用/转发变体 |
| list_members | B.members[]20：user_id/screen_name/name/description与统计；status=ok | next_cursor非空、more_users=true；后页未执行；普通成员Q已有字段，不要求材料正文/文章URL/发表时间；研究无I；单页S已本地验收，不自动续页；无等价供应商则拒绝切换 |
| community_members | B.members[]19：user_id/screen_name/name/profile_image/blue_verified；status=ok | 官方明确不支持分页；next_cursor虽非空也不能续传；首页成员Q已有字段；仅首页快照，不承诺完整成员或用无效cursor续页 |
| trending | B.trends[]50：name/description/context；无rank、heat或原文 | 榜单快照，无分页需求；普通趋势Q已有字段；不虚构真实排名/热度，不导入文章，不要求作者/发表时间 |

搜索Top19/Latest20条，quoted嵌套角色已观测；账号帖20条中16转发、4引用，retweeted.id与retweeted_tweet.tweet_id相符。实际user上下文的profile/rest_id与账号请求匹配，外层作者ID与该上下文相符；外层handle实收null不能拿请求值填充。pinned独立且非新发现证据。详情id匹配冻结TweetID，作者ID/handle匹配实际discovery；text与display_text不同，完整正文语义仍未闭合，不能声称Article全文。comments根对象与thread分离，conversation_id不代替直接parent。列表/社区容器不能充作者。

普通单页Q不要求高级算子、后页、完整材料正文或其他变体全部齐备；from/OR/回复排除、时间筛选、Article、持续分页仅限制实际依赖它们的I/S/X。社区成员官方明确无分页，即使返回非空next_cursor也不续传。已实现I沿SocialData/Redfox原材料writer与单账号绑定边界；十类单页S不补购、不续页，基础搜索RF↔AK仅显式切换同ID历史，高级配方/native连续采集/全文仍阻断。精确工具、schema和类型/谓词见catalog.phase2Evidence.xLiveContractEvidence与矩阵，当前主方案§12.16。

微博UI124–163由Lead逐图回看，135评论ID/原始带时区时间标签P3红13/15→绿15/15；早期Web覆盖测试与SSR属性断言错误保留。实际Q48–55、S56–61，六S均items1、账号sub12 details1其余0，无额外API。手动Q50 I与profile Q52绑定同source；文章6/来源6，WB新源隔离且全文许可false。sub18实际RF→AK同ID；反向仅预览取消，sub19 extParam2阻断原配置不变。sub1–19全disabled无active/next，本批WB源停用；旧DY external作者仍enabled但无调度。154/155同内容fullPage最终替换已完成，Lead逐张确认无裁切，124–163共40对均完成最终视觉验收；不宣称所有source停用。

X后端Q的恢复job身份错误和缺root ID误丢评论P2均保留：Lead红0!=2→修复10/10，RF6/6另记。I+Q+RF45/45；后续advisory I+Q22/22、文案定向2/2分开记录，独立Ireview无具体剩余问题。五类work producer实际身份/文本/原生链接满足才I，资料只绑定既有单账号source；正文pending，未知时间null/历史回填，provider guard拒绝隐式SocialData/Jina。Article、自动详情、native连续采集/真实续页仍未开放。Web31/31只属早期Q阶段；最终Web64/64与真实161 DTO/10S接线probe通过，实际UI13Q/6个结果I复用3个唯一材料/10S以及基础切换完成；UI164–228共65处各有原图与批注图，最终批注图由Lead逐张回看；最终state/cleanup通过：23个原回执对应13Q/10S且query/collect服务正确，研究无article/source关联，原native主订阅仍SocialData；本批10个X订阅及账号信源经原domain command停用，UI全部32订阅disabled、active/next均为空，最终articles9/sources7。


## 21. X本地接线、metadata修复与五条缺口收尾（2026-10-23）

X现有12条按实际用途验收，不增加范围行：详情/资料不建独立订阅，其余10类仅首页、零详情、无补购/自动翻页。手动I仅五类有实收身份的作品结果；资料只显式绑定既有完整匹配单账号`x_search`，不新建external。search S仅普通关键词Top/Latest；Q可保留较广输入。基础搜索RF↔AK显式切换同ID历史，native连续采集/高级配方/全文/Article仍阻断。共享评论/关注Q保留RF+AK、S仅AK，queryProviders仅有差异才随DTO发送，Q兼容回退而S仍读取实际collectionProviders。

metadata P2只在现有材料revision SQL原子顶层合并x_post：缺省unknown保留，显式null/[]清空，incoming quote整对象替换；AK未收到media/avatar/lang省略而不输出默认清空值，RF/SocialData明确值不变。不保证旧数据回填或同内容metadata-only更新；UI旧fixture的quote曾先被清空，217中性批注不证明修复后回填。Sol S两项fixture错误升级Astra Medium后0错误；metadata Astra Medium两项fixture错误即停、Lead修fixture/旧catalog断言后最终70/70。Web64/64、实际161 DTO/10S probe与整项目types通过；各集合不累加。独立连接/跨平台静态review无新P1/P2/P3，不能替代真实运行。

更广AgentKey回归曾在旧长期test库因日预算耗尽失败并挂起，Lead终止且单例确认`Budget for agentkey.query exhausted (day)`。独立`aihot_agentkey_phase2_final_20261023_test`（65433）应用75份现有迁移后串行回归189/189、exit0；不是产品预算缺陷，无新增迁移。

剩余5条本轮只免费重describe，healthy/价格未变均未补成功证据，无新增付费调用：抖音粉丝400与微博粉丝400失败原因仍未知，头条视频10400为业务错误，不能当空；小红书回复仅合法empty已证，非空关系/投影未知；公众号相关文章仅空articles/count已证，非空元素未知。五条仍在phase2且未开放，不以额外count-only用途充作完整路线，不挪到147条phase3。累计仍59请求/57回执报告29.4credits，两400缺charge保持未知，未完整对账；421.6仅X前余额。
