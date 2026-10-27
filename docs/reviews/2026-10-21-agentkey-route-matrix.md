# AgentKey 固定路由与输入输出矩阵（2026-10-22 第二阶段范围修订）

> **当前决定（2026-10-23）：抖音粉丝、头条视频详情、小红书二级回复、微博粉丝、公众号相关文章五条按用户要求暂缓、保持未开放。** 第二阶段仍为 60 条已验收 + 5 条暂缓，共 65 条。问题、排查方法、结果和恢复条件统一见[输出证据 §24](2026-10-21-agentkey-output-evidence.md#24-五条未开放路线暂缓清单2026-10-23)；后续补证和开发等待用户明确恢复。

> 状态：截至2026-10-23，65条中60条已按用途完成本地验收（抖音11、公众号6、头条3、小红书9、B站11、微博8、X12）；X已接通12类Q、5类作品手动I及10类单页S，后端、Web和真实本地浏览器已验，最终状态/清理已通过，截图1–228每处均有原图和批注图共456PNG，最终批注图由Lead逐张回看；另5条尚未接入（抖音粉丝、头条视频、小红书回复、微博粉丝、公众号相关文章各1），仍保留在65条范围，未移入第三阶段。累计59次真实数据请求，57个响应报告扣费合计29.4 credits；抖音粉丝400和微博粉丝400两次缺credits_charged，保留未知，不按实测0或已完整对账表述。候选分类131 readOnly/81 needs_review不等于运行许可；保留233条静态业务路线（212 AgentKey、21直连Redfox），147条第三阶段候选不变。分批实际状态见主方案§12.8–12.16。

## 口径与执行门槛

本矩阵覆盖已确认范围内的平台与资讯/社交业务能力，**不覆盖也不宣称核验了目录的全部 1,442 项**。同义版本不重复建设；未列入本矩阵的目录项均是非执行路线，不能因发现新工具自动开放。蒲公英、腾讯互选及花火、星图、DOU+、TikTok 广告等营销分组、生成/上传/转写/翻译加工、刷量、播放流下载与凭据/签名工具排除。账号/关系/评论/统计/榜单仅是研究结果，不能自动成为新闻。

依据：[完整方案](../agentkey-integration-plan.md)、[输出证据](2026-10-21-agentkey-output-evidence.md)、[方案复审](2026-10-21-agentkey-plan-review.md)、[目录快照](2026-10-21-agentkey-catalog.json)。表内 T1–T22、A1–A3、J1–J6、W1–W2 均指输出证据中同号条目。目录快照的 `selectedInputSchemas` 与 `outputEvidence` 是证据，不能扩充为 schema 注册中心。

- `doc`：已有官方文字/schema（直连表单独标明仓库合同证据）；`sample`：已有官方公开样例的形态；`gap`：所需输入/字段/语义仍无现有证据。可以同一行并列，避免将“输入已知”推广成“输出已闭合”。目录存在只证明规范工具名，未知字段留 gap，不用标准平台 JSON 或其他上游 fixture 补造。
- 表内 `P = E.data`，E 是解开 MCP content 后的 AgentKey envelope；E 的 `provider/category/took_ms/credits_charged/data` 有 doc 证据。TikHub 的 `P.data` 与 JustOneAPI/Serper/Jina 各自层级分别保留；不统一盲拆两层 data。ID 必须无损字符串/原始整数；只得到不安全 JS Number 时拒绝身份绑定和导入。
- `Q`＝手工查询；`I`＝材料导入资格；`S`＝定时采集/研究快照；`X`＝已有订阅/主信源显式切换。`可设计` 只表示对应合同有据，尚未开发或实测；显式标注“本地已实现”的行除外。`条件` 指本行具体约束及共同权限/身份预检；`待补/阻断` 不可宣传为已支持；`—` 不属于该结果用途。详情只作为有界步骤，不单独伪造列表订阅。
- Q 只要求合法输入、已核实只读行为及可理解的成功/合法空结果；单次查询不要求下一页、作者稳定 ID 或全文。I 需要平台作品/来源身份、权限、原文和回执溯源；作者可来自已验证的响应上下文，不能仅来自请求参数。正文待补、发布时间未知可沿既有 pending/历史回填规则处理；只有任务明确依赖全文或精确时间时才据此阻断。作品说明、摘要不冒充全文，昵称不继承来源权限。
- S 的持续分页必须有可回传的位置与可信终止规则；没有则只阻断持续分页，不连带阻断已有成功结构的单页查询/快照。单对象或明确单页快照可周期重复单次请求，不要求不存在的分页能力。最大页数只限成本，不证明有后页或完整历史覆盖；矛盾游标进入核对，接口明确的停止值按其合同解释。
- X 只比较当前业务必需身份/过滤/正文/时间/分页覆盖。必需能力缺失拒绝；未使用过滤、单页限制、库名或延迟差异只展示影响。失败保留旧订阅；成功使旧轮失去提交资格。独立平台订阅与 X/公众号主订阅均走显式切换，无自动兜底。

`provider/upstream` 一律按 AIHOT 语义：AgentKey 路线为 `agentkey / TikHub`、`agentkey / JustOneAPI`、`agentkey / Serper` 或 `agentkey / Jina`。后文直连行是 `redfox / —`，不经过 AgentKey，也不调用目录中的 `RedFox/…` 工具。固定工具不自动换商；UI 显示上游，回执保存 E.provider。

### 第二阶段范围和研究结果的最低要求

七平台行数：抖音 12、头条 4、小红书 10、B 站 11、微博 9、X 12、公众号 7，共 65。微信公众号不包含本矩阵另列的 `wechat_search` 或 `wechat_channels`。第三阶段行保留作候选，不是第二阶段开发任务；各阶段继续排除工具类与平台写入用途。

| 结果用途 | 必须补的用途证据 | 可选字段与边界 |
| --- | --- | --- |
| 评论/回复 | 查询对象/父评论关系、评论内容、成功与空结果结构；翻页时才补位置/终止 | 作者与发布时间可未知；增量去重或后续回复定位需要稳定评论 ID，不把其缺失扩成所有单页研究的门槛 |
| 账号资料/关系 | 实际对象和资料字段；关系列表需区分粉丝、关注、成员 | 自动绑定信源才要求稳定账号身份；仅显示研究结果不授予权限，单账号不分页 |
| 文章/关系统计 | 对象定位和返回的命名计数 | 缺失不等于 0；不要求词条、排名、热度、作者或正文；只记录实际采集时间 |
| 搜索建议/相关词 | 合法查询输入与建议词列表 | 不强求排名、热度、榜单时间或分页 |
| 热榜/趋势 | 词条或该榜实际内容项，成功/空结果结构 | 排名/热度/发布时间有据才显示；返回顺序不冒充官方排名；无原文的趋势词不导入材料 |
| 推荐/话题/动态/按类型搜索 | 实际类型、可理解内容/定位信息；按用途决定单页或翻页 | 研究不强求全文/作者/精确时间；材料分支另外满足 I，不套同平台搜索或详情结构 |

这些是补证标准，**不是已证实的输出字段**。下表仍为 gap 的路线未被本轮提升为可执行；无需的字段从要求中移除，不会以虚构字段补齐。

2026-10-22 免费补证把七平台精确 schema 写入既有[目录证据的 phase2Evidence](2026-10-21-agentkey-catalog.json)。表内 schema 默认值是供应商声明，不是自动发起查询或直接采用所有参数的许可；本地业务必填、固定 raw=false/normal、过滤和页数范围仍由已实现契约限定。各条官方文档、字段事实与缺口见右栏；真实样本按输出证据§12–§16分批记录；公众号六条凭官方字段合同实现和本地桩验收，尚无真实公众号响应。未把字段说明、失败或空白账号当完整成功样例。

## operation、step 与恢复

每个 AgentKey 行精确分配 `operation=agentkey.<platform>.<capability>`、`step=agentkey.<platform>.<capability>.query`；它们是候选设计键，不能重写旧 Redfox 或第一阶段请求身份。每次 run 冻结工具、真实输入和位置，工具写入 model；沿用现有 runId/stepVersion 等请求身份构造。同一步恢复、parser 修复与价格更新不另造外发身份；显式新查询/调度新轮使用新 run。

行内键对表示独立查询。若实际列表采集开启详情补全，原 run 保留列表 operation，当前 step/tool 切到已选详情路线；主方案 §9 要求对该组合显式登记、核对冻结目标，回到原列表进度。不创建第二套任务或按前缀放行任意组合，也不把独立查询键对误作唯一合法的多步骤结构。本文路线数不因复用详情步骤而增加。

`readOnly` 只决定“已发出但结果未知”时能否按既有规则恢复，不是执行许可，也不证明输入、身份、正文、导入或分页合同已经闭合。每一行的 Q/I/S/X 仍分别由当前任务预检；标为 `readOnly` 但仍有阻断项的工具不能因为恢复分类较明确而开放。

| 静态恢复类 | 使用条件 |
| --- | --- |
| `readOnly` | 已有证据表明选定路线只读，包括 POST 搜索/详情；真正 unknown 只允许既有规则下至多一次自动放行，仍受预算、次数上限和当前任务预检约束。输入/输出仍有 gap 不影响这项恢复分类，但会阻断受影响的执行用途。`readOnly` 不是可执行白名单。 |
| `readOnlyPoll` | 仅已确认的远端任务结果轮询；本矩阵未选择任何此类路线。 |
| `remoteSubmit` | 会创建远端采集/处理任务的提交；不按只读 unknown 重发。本矩阵没有选此类路线，也不把 POST 自动判作提交。 |
| `needs_review` | 仅目录名/摘要、真实行为或完整输入未审核的默认值；表中辅助候选维持此类，补证并人工固定契约前不执行、不自动恢复。 |

所有付费外发仍走 receipts/attempts 与用途预算；缺预算拒绝外发。先落完整响应/错误，再解析；HTTP/JSON-RPC/isError/业务错误分层判断，已收到但解析失败不标 unknown。estimatedCredits 与 chargedCredits 分 attempt 保存，0 有效、缺失未知；次数预算不是积分/金额硬上限。关闭外发开关仍可处理已保存响应，不触发账户检查或目录发现。

## 核心资讯/作品路线

以下输入栏没有把文档未保存的参数键猜成“required”。业务对象明确但 exact schema 缺失时，该行依旧是补证候选，Q 条件也不能绕过输入预检。


### 抖音 Douyin（T1/T2）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 普通作品搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post` | 已核 schema：cursor:integer=0；keyword:string="猫咪"；业务 keyword 必填，cursor=0 起 | `P.data.data.itemList[].AwemeInfo` 的 `AwemeId/Desc/CreateTime`（毫秒字符串）、`Author.Uid?/SecUid/Nickname`、`Video.ItemID/Title/CreateTime/Cover.UrlList`；标准作品 URL 由稳定 AwemeId 生成 | `P.data.data.hasMore/cursor`；已验首页 12 条；按返回 cursor 续页，不由固定页大小推算 | `readOnly`；`agentkey.douyin.search`；`agentkey.douyin.search.query` | Q=已开放；I=已开放但缺稳定作者/作品 ID阻断；S=已开放（有界）；X=已开放（有界） | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/501036596e0.md；Q/I/S/X retained within supported parameters. |
| 账号作品 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_post_videos_api_v1_douyin_app_v3_fetch_user_post_videos_get` | 已核 schema：channel:string="normal"；count:integer=20；max_cursor:integer=0；sec_user_id:string（schema必填）；sort_type:integer=0；本地 normal，count≤20，sort_type 仅0/1 | sample：P.code=200；P.data.status_code=0/aweme_list[].aweme_id/desc/create_time（秒）/author.uid/sec_uid/nickname；根 uid/sec_uid；原生 URL 由 aweme_id 规范化 | doc+sample：P.data.has_more（0/1）/max_cursor；原样回传；未实际查询第二页 | `readOnly`；`agentkey.douyin.account_posts`；`agentkey.douyin.account_posts.query` | Q/I/S=已实现并通过本地桩验收；X=无详情且实际参数兼容时，开启详情的旧配方仍阻断 | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/186826223e0.md；Locally accepted Q/I/bounded S. X only compatible no-detail recipes; unobserved live continuation/terminal/restricted objects remain limits. |
| 单作品详情 V2 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_one_video_v2_api_v1_douyin_app_v3_fetch_one_video_v2_get` | 已核 schema：aweme_id:string（schema必填） | sample：P.code=200；P.data.aweme_detail 的 aweme_id/desc/create_time（秒）/author.uid/sec_uid/nickname；成功形态无内层 status_code；返回作品须匹配请求 | 单作品；不分页 | `readOnly`；`agentkey.douyin.detail`；`agentkey.douyin.detail.query` | Q/I=已实现并通过本地桩验收；S=账号作品显式有界补全，非独立订阅；X=旧详情要求等价未证实则阻断 | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/232379587e0.md；Locally accepted Q/I and same-run bounded account-post enrichment; not independent S; ambiguous filter_list reason8 remains review. |

### 小红书 Xiaohongshu（T3）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 笔记搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/search_notes_api_v1_xiaohongshu_app_v2_search_notes_get` | 已核 schema：ai_mode:integer=0；keyword:string（schema必填）；note_type:string="不限"；page:integer=1；search_id:string=""；search_session_id:string=""；sort_type:string="general"；source:string="explore_feed"；time_filter:string="不限" | E.data.data.data.items[]；；success: E.data.data.code=0/success=true | E.data.data.{search_id,search_session_id} nonempty strings; page/next_page numbers1/2; no documented terminal bool observed | `readOnly`；`agentkey.xiaohongshu.search`；`agentkey.xiaohongshu.search.query` | Q/单页S=已验收；列表缺URL保留pending，仅显式同run有界详情后条件I；X=预检明确不支持 | 2026-10-22授权样本（本工具2credits）：https://docs.tikhub.io/420136398e0.md；Ads are not notes or materials. onebox is not independently requested; no URL received in note projection, no URL synthesis without proof; timestamp units unspecified. Only homepage pagination response observed.；当前本地验收见主方案§12.13（回复除外）。 |
| 账号笔记 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_user_posted_notes_api_v1_xiaohongshu_app_v2_get_user_posted_notes_get` | 已核 schema：cursor:string=""；share_text:string=""；user_id:string="" | E.data.data.data.notes[]；notes[].{id,title,display_title,desc,type,user.userid,user.nickname,cursor,create_time,last_update_time}；success: E.data.data.code=0/success=true | E.data.data.data.has_more boolean=true; notes[last].cursor string nonempty | `readOnly`；`agentkey.xiaohongshu.account_posts`；`agentkey.xiaohongshu.account_posts.query` | Q/单页S=已验收；缺URL保留pending，显式同run有界详情后条件I；X=预检明确不支持 | 2026-10-22授权样本（本工具2credits）：https://docs.tikhub.io/420136396e0.md；22 returned despite generic defaults; use actual length. No native URL in witnessed note fields. Time unit not proven. Video playback fields must be excluded.；当前本地验收见主方案§12.13（回复除外）。 |
| 图文/视频笔记内容详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_image_note_detail_api_v1_xiaohongshu_app_v2_get_image_note_detail_get` | 已核 schema：note_id:string=""；share_text:string="" | E.data.data.data[] model_type=note -> note_list[]；note_list[].{id,title,desc,type,user.id,user.userid,user.nickname,time,last_update_time,share_info.link}；success: E.data.data.code=0/success=true | 单对象/单页；不追加真实调用 | `readOnly`；`agentkey.xiaohongshu.detail`；`agentkey.xiaohongshu.detail.query` | Q/有据I及有界补全=已验收；不独立S；X=不支持跨商详情配方 | 2026-10-22授权样本（本工具2credits）：https://docs.tikhub.io/420136391e0.md；Observed video note with text; same fixed unified text detail supports it. Received /discovery/item native URL plus query is real evidence, not /explore synthesis; preserve signed query in runtime, do not persist real query in repository evidence. No playback/downloads or time unit inference.；当前本地验收见主方案§12.13（回复除外）。 |

### B 站 Bilibili（T4）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 综合搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_search_all_api_v1_bilibili_app_fetch_search_all_get` | 已核 schema：cursor:string=""；keyword:string（schema必填）；order:integer=0；page_size:integer=20 | 2026-10-22实收：E.data.data.data.item[goto=av]；AV video Q/S; other types counted separately；字段类型：goto, param, uri, av | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.search`；`agentkey.bilibili.search.query` | Q=已本地验收；I=不开放直接列表/研究导入；S=九条首页/有据有界补全已本地验收；X=原预检按实际不兼容阻断；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |
| 账号视频 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_videos_api_v1_bilibili_app_fetch_user_videos_get` | 已核 schema：page:integer=1；post_filter:string="archive"；ps:integer=20；user_id:string（schema必填） | 2026-10-22实收：E.data.data.data.item；archive homepage only；字段类型：title, author, bvid, param, uri, goto, ctime, duration | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.account_posts`；`agentkey.bilibili.account_posts.query` | Q=已本地验收；I=不开放直接列表/研究导入；S=九条首页/有据有界补全已本地验收；X=原预检按实际不兼容阻断；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |
| 视频详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_one_video_api_v1_bilibili_app_fetch_one_video_get` | 已核 schema：av_id:string；bv_id:string | 2026-10-22实收：E.data.data.data；video description; not transcript；字段类型：aid, bvid, title, desc, pubdate, ctime, owner, short_link, short_link_v2 | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.detail`；`agentkey.bilibili.detail.query` | Q/I=已本地验收（实际BV+MID，缺正文可pending）；S=仅同run有界补全已本地验收；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |

### 微博 Weibo（T5）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 综合/实时/用户/视频搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_search_all_api_v1_weibo_app_fetch_search_all_get` | 已核 schema：page:integer=1；query:string（schema必填）；search_type:integer=1 | 2026-10-22实收：E.data.data.items[category=feed].data and items[category=group].items[category=feed].data；字段：id, idstr, mid, mblogid, text, created_at, isLongText, user, scheme, reposts_count, comments_count, attitudes_count | page；搜索末页缺失 | `readOnly`；`agentkey.weibo.search`；`agentkey.weibo.search.query` | Q/I/S=已按用途本地验收；原帖直接I及显式同run有界详情；X仅basic搜索1/61、page1无活动详情配方，其他配置预检阻断 | 固定9路10次，9回执报告1.8credits、粉丝400费用未知。8条用途验收：后端Q8/8、I28/28、S/X Lead修复后36/36；Web评论标签红13/15→绿15/15；UI124–163实际8Q/6S。首次失败/二错停工轨迹见主方案§12.15。 |
| 用户时间线 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_timeline_api_v1_weibo_app_fetch_user_timeline_get` | 已核 schema：filter_type:string="all"；month:schema；page:integer=1；uid:string（schema必填） | 2026-10-22实收：E.data.data.items[category=feed].data；字段：id, idstr, mid, mblogid, text, created_at, isLongText, user, scheme, reposts_count, comments_count, attitudes_count | page；末页缺失 | `readOnly`；`agentkey.weibo.account_posts`；`agentkey.weibo.account_posts.query` | Q/I/S=已按用途本地验收；原帖直接I及显式同run有界详情，实际详情UID须匹配冻结账号；X不支持 | 固定9路10次，9回执报告1.8credits、粉丝400费用未知。8条用途验收：后端Q8/8、I28/28、S/X Lead修复后36/36；Web评论标签红13/15→绿15/15；UI124–163实际8Q/6S。首次失败/二错停工轨迹见主方案§12.15。 |
| 状态完整文本 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_status_detail_api_v1_weibo_app_fetch_status_detail_get` | 已核 schema：status_id:string（schema必填） | 2026-10-22实收：E.data.data.detailInfo.status；字段：id, idstr, mid, mblogid, text, created_at, isLongText, user, scheme, reposts_count, comments_count, attitudes_count | 单对象 | `readOnly`；`agentkey.weibo.detail`；`agentkey.weibo.detail.query` | Q/I=已本地验收；正文按实际isLongText/清洗文本完整或pending；仅同run有界步骤，无独立S | 固定9路10次，9回执报告1.8credits、粉丝400费用未知。8条用途验收：后端Q8/8、I28/28、S/X Lead修复后36/36；Web评论标签红13/15→绿15/15；UI124–163实际8Q/6S。首次失败/二错停工轨迹见主方案§12.15。 |

### X / Twitter（T6）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 关键词时间线 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_search_timeline_api_v1_twitter_web_fetch_search_timeline_get` | 已核 schema：cursor:string；keyword:string（schema必填）；search_type:string="Top" | 2026-10-23实收E.data.data：timeline[]19/20；tweet_id/text/created_at、user_info.rest_id/screen_name；Top与Latest各一份，quoted嵌套角色另列 | next_cursor非空；仅首页；高级算子from/OR/回复/日期及后页未证 | `readOnly`；`agentkey.x.search`；`agentkey.x.search.query` | Q/I=已按用途本地验收；I仅实收原证据/作者/文本/原生链接齐备者，正文pending；转发/未知角色/缺引用身份仅研究；S=单页/零详情/无补购已验收，仅普通关键词Top/Latest；X=基础配置RF↔AK显式同ID保留历史，高级配方拒绝 | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |
| 用户帖子时间线 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_post_tweet_api_v1_twitter_web_fetch_user_post_tweet_get` | 已核 schema：cursor:string；rest_id:integer；screen_name:string | 2026-10-23实收E.data.data：timeline[]20，author.rest_id；user实际profile/rest_id上下文匹配；retweeted/retweeted_tweet16、quoted4，另有pinned | next_cursor非空；仅首页；pinned不是新发现时间证据 | `readOnly`；`agentkey.x.account_posts`；`agentkey.x.account_posts.query` | Q/I=已按用途本地验收；I仅实收原证据/作者/文本/原生链接齐备者，正文pending；转发/未知角色/缺引用身份仅研究；S=单页/零详情/无补购已验收；X=无等价操作时拒绝 | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |
| 帖子详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_tweet_detail_api_v1_twitter_web_fetch_tweet_detail_get` | 已核 schema：tweet_id:string（schema必填） | 2026-10-23实收E.data.data：status=active；id/author.rest_id/screen_name/created_at/text/display_text；冻结TweetID和实收作者别名匹配 | 单对象，不需分页；原HTTP链接未收到 | `readOnly`；`agentkey.x.detail`；`agentkey.x.detail.query` | Q/I=已按用途本地验收；I仅实收原证据/作者/文本/原生链接齐备者，正文pending；转发/未知角色/缺引用身份仅研究；S=—，不创建独立订阅；X=无等价操作 | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |

### 微信公众号 WeChat MP（T7）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号文章列表 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_account_articles_api_v1_wechat_mp_v2_fetch_account_articles_post` | 已核 schema：item_show_type:schema；offset:schema=""；page_size:integer=20；raw:boolean=true；username:string（schema必填）；本地固定 raw=false | doc：raw=false: P.data.biz_username/is_end/count/next_offset/articles[].app_msg_id/title/digest/url/create_time/update_time/idx/msg_type/item_show_type/is_paid/is_pay_subscribe. raw=true different item nesting. offset base64, is_end0/1, end next_offset null. page_size ignored upstream. | P.data.next_offset→offset；is_end；末页 next_offset=null；page_size 被忽略 | `readOnly`；`agentkey.wechat_mp.account_articles`；`agentkey.wechat_mp.account_articles.query` | Q/条件I/主信源有界S/显式X=本地验收；列表缺正文沿原H5补全 | doc 2026-10-22：https://docs.tikhub.io/472974858e0.md；raw=false: P.data.biz_username/is_end/count/next_offset/articles[].app_msg_id/title/digest/url/create_time/update_time/idx/msg_type/item_show_type/is_paid/is_pay_subscribe. raw=true different item nesting. offset base64, is_end0/1, end next_offset null. page_size ignored upstream.；用途边界：Locally accepted Q/conditional I/main-source bounded S and explicit X. List->at most8 necessary H5 requests in same run; first-import backfill, same source/subscription/history/rights. No live MP calls. |
| H5 正文与账号映射 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_article_detail_h5_api_v1_wechat_mp_v2_fetch_article_detail_h5_post` | 已核 schema：raw:boolean=true；url:string（schema必填）；本地固定 raw=false | doc：P.data.url/bizUin/itemIdx/content; content user_name/nick_name/title/author/desc/mid/idx/link/content_text/content_noencode/_content_type; create_timestamp/ori_create_time seconds. article/immersive/video/unknown differ. IDs lossless. | 单文章；不分页 | `readOnly`；`agentkey.wechat_mp.detail`；`agentkey.wechat_mp.detail.query` | Q/条件I=本地验收；S=主信源同轮有界补全，非独立订阅；X=主订阅配方一部分 | doc 2026-10-22：https://docs.tikhub.io/511928397e0.md；P.data.url/bizUin/itemIdx/content; content user_name/nick_name/title/author/desc/mid/idx/link/content_text/content_noencode/_content_type; create_timestamp/ori_create_time seconds. article/immersive/video/unknown differ. IDs lossless.；用途边界：Locally accepted Q/conditional I and same-run main-source body completion; explicit same-H5 alias proof only. Unknown types remain pending/review; contradictory URL rejected. |
| 账号资料 / 账号研究 | agentkey / TikHub | `TikHub/fetch_account_profile_api_v1_wechat_mp_v2_fetch_account_profile_post` | 已核 schema：raw:boolean=true；username:string（schema必填）；本地固定 raw=false | doc：raw=false P.data.user_name/nick_name/user_role/service_type/ban_type/ip_wording/original_article_count/finder_username/unavailable. signature/head_url always null unavailable; raw=true different nesting. | 单账号 | `readOnly`；`agentkey.wechat_mp.account_profile`；`agentkey.wechat_mp.account_profile.query` | Q/显式稳定身份绑定=本地验收；I/独立S=—；X=主信源预检辅助 | doc 2026-10-22：https://docs.tikhub.io/472974857e0.md；raw=false P.data.user_name/nick_name/user_role/service_type/ban_type/ip_wording/original_article_count/finder_username/unavailable. signature/head_url always null unavailable; raw=true different nesting.；用途边界：Locally accepted Q and explicit verified typed source binding. No independent S or automatic account/source creation; avatar/bio unavailable, no extra purchase. |

### 微信搜索 WeChat Search（T8）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 综合资讯/文章/账号/视频搜索 / 混合候选/账号研究→按类型分流 | agentkey / TikHub | `TikHub/fetch_search_api_v1_wechat_search_v2_fetch_search_post` | 查询词、垂类；raw=false；cursor 回传，sort/publish_time 保持；精确输入 schema 未保存 | P.data.items[]/cursor/continue_flag/count/no_more/categories[]；账号 jumpInfo.userName；视频 exportId+feedNonceId | 必须 cursor；只传 offset 不翻页；total 非精确总量 | `readOnly`；`agentkey.wechat_search.search`；`agentkey.wechat_search.search.query` | Q=条件；I=文章分支阻断；S=有界研究可设计，输入待补；X=文章采集阻断 | doc T8；gap：文章真 URL/正文/稳定身份路径；docID 不作文章身份；恒空计费垂类不开放 |

### 视频号 WeChat Channels（T10）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号视频列表 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_videos_api_v1_wechat_channels_v2_fetch_user_videos_post` | finder username 等账号输入；raw=false；last_buffer 回传（精确 required 未保存） | P.data.videos[].id/username/title/create_time | up_continue/last_buffer；空结果形态缺失 | `readOnly`；`agentkey.wechat_channels.account_posts`；`agentkey.wechat_channels.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T10；稳定作者可绑定；gap：输入细则、时间单位、作品页 URL/有效性和末页空形态 |
| 视频详情/明文身份 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_video_detail_api_v1_wechat_channels_v2_fetch_video_detail_post` | 搜索 exportId+feedNonceId 或明文 objectId 对应输入（精确 schema 待补）；raw=false | P.data.id/username/title；可得到 objectId 与 v2_…@finder | 单对象 | `readOnly`；`agentkey.wechat_channels.detail`；`agentkey.wechat_channels.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T10；gap：时间单位/作品页 URL；exportId 会过期，media.full_url 是 CDN |
| 读取作品分享链接 / 原文补全 | agentkey / TikHub | `TikHub/fetch_video_share_url_api_v1_wechat_channels_v2_fetch_video_share_url_post` | 作品标识（精确字段/required 待补） | P.data.share_url | 单对象 | `readOnly`；`agentkey.wechat_channels.original_url`；`agentkey.wechat_channels.original_url.query` | Q=条件；I=辅助但仍阻断；S=仅确需时有界补全；X=仍阻断 | doc T10；gap：链接有效性与完整输入；这是作品链接读取辅助，不是媒体加工 |

### 今日头条 Toutiao：AgentKey 辅助查询（T9）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 文章详情候选 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_article_info_api_v1_toutiao_app_get_article_info_get` | 已核 schema：group_id:string（schema必填） | E.data.code200; E.data.data.message=success; E.data.data.data with lossless group_id and itemCell.articleBase.gidStr matching request; share_info.title, actual user_info.user_id/name; native share_url same article. No content or publication timestamp. | 单对象 | `readOnly`；`agentkey.toutiao.article_detail`；`agentkey.toutiao.article_detail.query` | Q=已本地验收；I=有据原文/作者下pending与未知时间回填；S=仅有界详情，不建发现订阅；X=不串Redfox列表 | doc+2026-10-22授权样本：https://docs.tikhub.io/251380586e0.md；Article Q and conditional pending/history I can be implemented; no fulltext claim, discovery S or cross-provider detail chain.；当前实现见主方案§12.12，原样例边界不扩大。 |
| 用户资料候选 / 账号研究 | agentkey / TikHub | `TikHub/get_user_info_api_v1_toutiao_app_get_user_info_get` | 已核 schema：user_id:string（schema必填） | E.data.code200; E.data.data.errno0/message=success; data.user_id safe and request-matched, name/description/avatar blank, all four supplied counts0. | 单对象 | `readOnly`；`agentkey.toutiao.account_profile`；`agentkey.toutiao.account_profile.query` | Q=已验收空白及同字段真实非空资料；不推断注销/私密；I/S/绑定/X=不开放 | 2026-10-22原公开样例只证全空；同字段真实非空Q已由本地parser/Root定向验证，不I/S/绑定，不推断注销或私密。官方页 https://docs.tikhub.io/251380589e0.md |
| 作品评论候选 / 评论研究 | agentkey / TikHub | `TikHub/get_comments_api_v1_toutiao_app_get_comments_get` | 已核 schema：group_id:string（schema必填）；offset:string（schema必填） | E.data.code200; E.data.data.err_no0/message=success; E.data.data.data[].comment text/id_str, numeric id lossless; group.group_id request-matched; 20 comments, has_more boolean/offset20/total_number number. | 本次20条、has_more=true/offset20；只证首页，无末页实证 | `readOnly`；`agentkey.toutiao.comments`；`agentkey.toutiao.comments.query` | Q/单页研究S=已本地验收；I/绑定/X=—；持续分页/时间单位仍受限 | doc+2026-10-22授权样本：https://docs.tikhub.io/251380588e0.md；Homepage offset string0 Q/single-page research S can be implemented; no I/binding, continuous pages/terminal or create_time unit proof.；当前实现见主方案§12.12，原样例边界不扩大。 |

### 快手 Kuaishou（T11）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 视频搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/search_video_v2_api_v1_kuaishou_app_search_video_v2_get` | 关键词/pcursor；latest/hot（精确 required 待补） | 用途与分页入参已确认 | pcursor；末页值缺失 | `readOnly`；`agentkey.kuaishou.search`；`agentkey.kuaishou.search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T11；gap：输出 ID/作者/URL/说明/时间/末页 |
| 账号视频 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_post_v2_api_v1_kuaishou_app_fetch_user_post_v2_get` | 纯数字 user_id；pcursor；eid 不可替代 | 仅用途/输入约束 | pcursor；末页值缺失 | `readOnly`；`agentkey.kuaishou.account_posts`；`agentkey.kuaishou.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T11；gap：完整输出；不预判快手无作者 ID |
| 视频详情 V1 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_one_video_v1_api_v1_kuaishou_app_fetch_one_video_get` | 作品标识（精确字段/required 待补） | 完整输出未证实 | 单对象 | `readOnly`；`agentkey.kuaishou.detail`；`agentkey.kuaishou.detail.query` | Q=待补；I=阻断；S=仅补全步骤，阻断；X=阻断 | gap T11：完整输入/作品/作者/原文/说明/时间 |

### Instagram（T12）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号帖子 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_user_posts_api_v1_instagram_v3_get_user_posts_get` | username；分页输入精确键/required 待补；不是数字 user_id | P.data.edges/page_info | end_cursor/has_next_page；node 形态未完整 | `readOnly`；`agentkey.instagram.account_posts`；`agentkey.instagram.account_posts.query` | Q=条件；I=阻断；S=分页可设计，材料阻断；X=阻断 | doc T12；gap：user 内稳定 ID/列表 node/原文/时间语义 |
| 帖子详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_post_info_api_v1_instagram_v3_get_post_info_get` | media_id 或 URL（exact required 待补） | P.data.items[].id/code/caption.text/user/taken_at | 单对象 | `readOnly`；`agentkey.instagram.detail`；`agentkey.instagram.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T12；gap：user 稳定 ID、原文 URL 与 taken_at 单位；不把 username 当稳定 ID |

### TikTok（T13）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 视频搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_search_video_api_v1_tiktok_web_fetch_search_video_get` | 关键词/游标/search_id（精确 required 待补） | search_id 来自 P.data.extra.logid 或 P.data.log_pb.impr_id | 搜索终止字段缺失 | `readOnly`；`agentkey.tiktok.search`；`agentkey.tiktok.search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T13；gap：稳定作品/作者/URL/正文/时间/搜索末页 |
| 用户帖子 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_post_api_v1_tiktok_web_fetch_user_post_get` | 用户标识/cursor（精确字段/required 待补）；不传已废弃排序语义 | 列表按新到旧 | cursor+hasMore；完整路径待补 | `readOnly`；`agentkey.tiktok.account_posts`；`agentkey.tiktok.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T13；gap：完整字段；CDN Cookie 播放不纳入 |
| 帖子详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_post_detail_api_v1_tiktok_web_fetch_post_detail_get` | 作品标识（精确字段/required 待补） | 完整输出未证实 | 单对象 | `readOnly`；`agentkey.tiktok.detail`；`agentkey.tiktok.detail.query` | Q=待补；I=阻断；S=仅补全步骤，阻断；X=阻断 | gap T13：作品/作者/URL/说明/时间 |

### YouTube（T14）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 综合搜索 V2 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_general_search_v2_api_v1_youtube_web_v2_get_general_search_v2_get` | 查询词/类型/continuation_token；精确 required 待补 | videos/shorts/channels/playlists 分类；continuation_token | 返回 continuation_token；空/末页细则待补 | `readOnly`；`agentkey.youtube.search`；`agentkey.youtube.search.query` | Q=条件；I=需详情仍阻断；S=阻断分页末页；X=阻断 | doc T14；gap：搜索项完整字段/末页；不可混合频道与作品 |
| 频道视频 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_channel_videos_api_v1_youtube_web_v2_get_channel_videos_get` | 频道标识/续页 token（精确 required 待补） | videos[].video_id/url；首页 channel.id；description 恒空；published_time 相对 | 续页无 channel；终止规则未完整记录 | `readOnly`；`agentkey.youtube.channel_videos`；`agentkey.youtube.channel_videos.query` | Q=条件；I=需详情仍阻断；S=阻断末页/时间；X=阻断 | doc T14；复用首页已证频道；不以后页 is_verified=false 覆盖；不把相对时间当精确秒 |
| 视频介绍详情 V2 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_video_info_v2_api_v1_youtube_web_v2_get_video_info_v2_get` | 视频标识；need_format=true（exact required 待补） | video_id/video_url/channel_id/description/publish_date/published_at/upload_date | 单对象 | `readOnly`；`agentkey.youtube.detail`；`agentkey.youtube.detail.query` | Q=条件；I=精确时间缺口阻断；S=仅补全步骤，条件；X=阻断 | doc T14；身份/原文/介绍有据；gap：三种时间格式/精度；description 非转写 |

### 知乎 Zhihu（T15）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 文章/回答搜索 V3 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_article_search_v3_api_v1_zhihu_web_fetch_article_search_v3_get` | 关键词/类型/排序/时间（精确字段/required 待补） | 有类型分支；具体字段未证实 | 终止标记缺失 | `readOnly`；`agentkey.zhihu.search`；`agentkey.zhihu.search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T15；gap：文章/回答/问题 ID、作者/URL/HTML/时间/末页 |
| 专栏文章详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_column_article_detail_api_v1_zhihu_web_fetch_column_article_detail_get` | 文章 ID（精确字段/required 待补） | 专栏详情用途存在；正文路径缺失 | 单对象 | `readOnly`；`agentkey.zhihu.article_detail`；`agentkey.zhihu.article_detail.query` | Q=待补；I=阻断；S=仅补全步骤，阻断；X=阻断 | gap T15：全文/身份/时间/URL；不接受回答 ID |
| 回答详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_answer_detail_api_v1_zhihu_web_fetch_answer_detail_get` | 回答 ID（精确字段/required 待补） | 文档明确正文/作者/所属问题；字段未证实 | 单对象 | `readOnly`；`agentkey.zhihu.answer_detail`；`agentkey.zhihu.answer_detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T15（语义）；gap：具体键/类型/URL/时间 |

### 西瓜 Xigua（T16）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 视频搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/search_video_api_v1_xigua_app_v2_search_video_get` | 关键词和分页（精确字段/required 待补） | 完整输出未证实 | 搜索终止字段缺失 | `readOnly`；`agentkey.xigua.search`；`agentkey.xigua.search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap T16：身份/原文/说明/时间/分页 |
| 账号视频 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_post_list_api_v1_xigua_app_v2_fetch_user_post_list_get` | 账号/续页（精确字段/required 待补） | P.data.data[-1].behot_time 是下一页依据 | 回传 behot_time；末页细则缺失 | `readOnly`；`agentkey.xigua.account_posts`；`agentkey.xigua.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T16；gap：完整字段；behot_time 不自行解释为发布时间 |
| 单视频详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_one_video_api_v1_xigua_app_v2_fetch_one_video_get` | 作品标识（精确字段/required 待补） | 明确不含标题等信息，偏播放与相关视频 | 单对象 | `readOnly`；`agentkey.xigua.detail`；`agentkey.xigua.detail.query` | Q=条件；I=阻断；S=不能作为标题/正文补全；X=阻断 | doc T16；不以空字段覆盖列表标题；gap：作者/原文/正文/时间 |

### Reddit（T17）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 动态搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_dynamic_search_api_v1_reddit_app_fetch_dynamic_search_get` | 查询表达式/类型/分页（精确 required 待补）；need_format=true | P.data.children[].post.id/postTitle；pageInfo；保留 markdown/作者/时间语义；AND/OR/NOT/字段语法 | P.data.pageInfo.endCursor/hasNextPage | `readOnly`；`agentkey.reddit.search`；`agentkey.reddit.search.query` | Q=条件；I=阻断；S=研究分页可设计，材料阻断；X=阻断 | doc T17；gap：正文/作者/时间/URL 精确键；不能套标准 Reddit JSON |
| 帖子详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_post_details_api_v1_reddit_app_fetch_post_details_get` | 帖子标识（精确字段/required 待补）；need_format=true | 同组说明正文/作者/时间，详情完整键缺失 | 单对象 | `readOnly`；`agentkey.reddit.detail`；`agentkey.reddit.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T17；gap：身份/原文/具体字段；帖子、评论、社区、用户分支分开 |

### Telegram（T18）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 频道消息列表 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_channel_posts_api_v1_telegram_web_fetch_channel_posts_get` | 频道/limit/前后游标（精确 required 待补） | channel_info/messages/pagination；post_id 为频道内身份 | before_cursor/after_cursor；末页细则缺失 | `readOnly`；`agentkey.telegram.channel_posts`；`agentkey.telegram.channel_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T18；gap：稳定频道 ID、内容/URL/时间键；去重必须含频道 |
| 频道内搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_channel_search_api_v1_telegram_web_fetch_channel_search_get` | 频道/查询词/游标（精确字段/required 待补） | backend=mtproto 或 web；web 仅近期历史本地过滤 | 游标/结束字段精确路径待补 | `readOnly`；`agentkey.telegram.channel_search`；`agentkey.telegram.channel_search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T18；要求全历史时 web 路线阻断；limit>20 内部累积不是多个 AIHOT attempt |
| 频道消息详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_post_detail_api_v1_telegram_web_fetch_post_detail_get` | 频道+post_id（精确字段/required 待补） | 频道/消息整体结构有据；具体字段缺失 | 单对象 | `readOnly`；`agentkey.telegram.detail`；`agentkey.telegram.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T18；gap：稳定频道/正文/原文/时间 |

### Threads（T19）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| recent 搜索快照 / 作品候选→材料 | agentkey / TikHub | `TikHub/search_recent_api_v1_threads_web_search_recent_get` | 查询词；精确 required 待补；不启用 end_cursor | 搜索单页；next_cursor 恒 null | 不支持分页；end_cursor 无效 | `readOnly`；`agentkey.threads.search_recent`；`agentkey.threads.search_recent.query` | Q=条件；I=阻断；S=仅单页研究快照；X=要求分页则拒绝 | doc T19；gap：稳定作者/URL/时间/内容；has_more 不代表可翻页 |
| 用户帖子快照 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_posts_api_v1_threads_web_fetch_user_posts_get` | 用户标识（精确字段/required 待补）；不启用 end_cursor | 用户帖单页；next_cursor 恒 null | 不支持分页 | `readOnly`；`agentkey.threads.account_posts`；`agentkey.threads.account_posts.query` | Q=条件；I=阻断；S=仅单页研究快照；X=要求分页则拒绝 | doc T19；gap：详情身份/时间/统一 URL |
| 帖子详情 V2 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_post_detail_v2_api_v1_threads_web_fetch_post_detail_v2_get` | 帖子标识（精确字段/required 待补） | post/replies/parent_thread/author_thread/pinned_replies | 单对象/关联结构，不据此翻页 | `readOnly`；`agentkey.threads.detail`；`agentkey.threads.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T19；gap：user 稳定 ID/时间/URL；is_reply 不判主帖角色 |

### Lemon8（T20）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 内容搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_search_api_v1_lemon8_app_fetch_search_get` | 查询词/max_cursor（精确 required 待补） | 完整作品字段缺失 | max_cursor 回传；has_more | `readOnly`；`agentkey.lemon8.search`；`agentkey.lemon8.search.query` | Q=条件；I=阻断；S=研究分页可设计，材料阻断；X=阻断 | doc T20；gap：作品/作者/原文/时间/正文 |
| 话题作品列表 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_topic_post_list_api_v1_lemon8_app_fetch_topic_post_list_get` | 话题标识/max_behot_time（精确 required 待补） | 完整作品字段缺失 | max_behot_time；话题末页缺失 | `readOnly`；`agentkey.lemon8.topic_posts`；`agentkey.lemon8.topic_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T20；gap：完整输出/末页；目录无账号作品列表，不补空实现 |
| 帖子详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_post_detail_api_v1_lemon8_app_fetch_post_detail_get` | 作品标识（精确字段/required 待补） | 完整输出未证实 | 单对象 | `readOnly`；`agentkey.lemon8.detail`；`agentkey.lemon8.detail.query` | Q=待补；I=阻断；S=仅补全步骤，阻断；X=阻断 | gap T20：身份/原文/时间/正文 |

### 皮皮虾 Pipixia（T21）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 内容搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_search_api_v1_pipixia_app_fetch_search_get` | 查询词/offset（精确 required 待补） | 完整输出未证实 | offset；结束语义缺失 | `readOnly`；`agentkey.pipixia.search`；`agentkey.pipixia.search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T21；gap：内容/作者/原文/时间/末页 |
| 账号作品 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_post_list_api_v1_pipixia_app_fetch_user_post_list_get` | 账号标识/loadmore_cursor（精确 required 待补） | 完整输出未证实 | loadmore_cursor；末页缺失 | `readOnly`；`agentkey.pipixia.account_posts`；`agentkey.pipixia.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T21；gap：完整输出/末页 |
| 作品详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_post_detail_api_v1_pipixia_app_fetch_post_detail_get` | 作品标识（精确字段/required 待补） | 完整输出未证实 | 单对象 | `readOnly`；`agentkey.pipixia.detail`；`agentkey.pipixia.detail.query` | Q=待补；I=阻断；S=仅补全步骤，阻断；X=阻断 | gap T21；增加播放量接口排除 |

### LinkedIn（T22）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 个人帖子 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_user_posts_api_v1_linkedin_web_v2_get_user_posts_get` | 个人标识/分页（精确字段/required 待补） | data；paging.count/start/pagination_token | 分页 token 存在；终止约定缺失 | `readOnly`；`agentkey.linkedin.user_posts`；`agentkey.linkedin.user_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T22；gap：账号/帖子 ID、正文/时间/原文/末页 |
| 公司帖子 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_company_posts_api_v1_linkedin_web_v2_get_company_posts_get` | 公司标识/分页（精确字段/required 待补） | data；paging.count/start/pagination_token | 终止约定缺失 | `readOnly`；`agentkey.linkedin.company_posts`；`agentkey.linkedin.company_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T22；gap：公司稳定 ID/作品正文/时间/原文；公司名不是个人作者 ID |
| 帖子/文章详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_post_detail_api_v1_linkedin_web_v2_get_post_detail_get` | /posts/ 或 /pulse/ URL（精确键/required 待补） | 支持两类详情；字段未证实 | 单对象 | `readOnly`；`agentkey.linkedin.detail`；`agentkey.linkedin.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T22；gap：完整字段；资源池忙可能400，不将全部400重试 |

### Facebook（J1/J2）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子搜索 / 作品候选→材料 | agentkey / JustOneAPI | `JustOneAPI/getApiFacebookSearchPostV1` | 搜索词/日期边界/cursor（精确输入 schema 未保存） | P.data.results[].post_id/url/message/message_rich/timestamp/author.id/author.url；cursor 字符串 | P.data.cursor；末页完整约定缺失 | `readOnly`；`agentkey.facebook.search`；`agentkey.facebook.search.query` | Q=条件；I=条件（正文/时间需核）；S=阻断末页；X=正文/时间或分页必需时阻断 | sample J1；gap：输入 required、正文截断、日期时区/末页；attached_post 另归属 |
| 账号帖子 / 作品候选→材料 | agentkey / JustOneAPI | `JustOneAPI/getApiFacebookGetProfilePostsV1` | profile 标识/cursor（精确字段/required 待补） | 同 J1 帖子字段；字符串身份 | 不透明 cursor；末页缺失 | `readOnly`；`agentkey.facebook.account_posts`；`agentkey.facebook.account_posts.query` | Q=条件；I=条件（正文/时间需核）；S=阻断末页；X=条件同搜索 | sample J1；不能给主帖套引用作者权限 |
| 主页转稳定 ID / 账号映射 | agentkey / JustOneAPI | `JustOneAPI/getApiFacebookGetProfileIdV1` | 主页 URL（精确输入键/required 待补） | P.data.profile_id | 单对象 | `readOnly`；`agentkey.facebook.profile_id`；`agentkey.facebook.profile_id.query` | Q=条件；I=—；S=仅映射辅助；X=映射辅助 | sample J1；输入 schema 待补；profile_id 不授予来源权限 |

### 豆瓣 Douban（J3/J4）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 影评列表 / 作品候选→材料 | agentkey / JustOneAPI | `JustOneAPI/getApiDoubanGetMovieReviewsV1` | 影片标识/page；sort=time/hotest（精确 required 待补） | P.data.reviews[].cid/review_url/username/time/title/description | page；末页缺失 | `readOnly`；`agentkey.douban.reviews`；`agentkey.douban.reviews.query` | Q=条件；I=阻断；S=阻断末页；X=阻断 | sample J3；username 是昵称，description 是摘要；gap：稳定作者/全文/时区；按影评而非影片去重 |
| 影评详情 / 作品候选→材料 | agentkey / JustOneAPI | `JustOneAPI/getApiDoubanGetMovieReviewDetailV1` | 影评标识（精确字段/required 待补） | 无样例；文档样例服务 API NOT FOUND | 单对象 | `readOnly`；`agentkey.douban.review_detail`；`agentkey.douban.review_detail.query` | Q=待补；I=阻断；S=仅补全步骤，阻断；X=阻断 | gap J4：公开样例缺失，不是数据接口实测失败 |
| 影片短评 / 评论研究 | agentkey / JustOneAPI | `JustOneAPI/getApiDoubanGetMovieCommentsV1` | 影片标识/分页（精确 required 待补） | 无样例；文档样例服务 API NOT FOUND | 末页缺失 | `readOnly`；`agentkey.douban.comments`；`agentkey.douban.comments.query` | Q=待补；I=—；S=阻断；X=— | gap J4：评论正文/身份/时间/分页 |
| 影片资料 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiDoubanGetSubjectDetailV1` | 对象或榜单条件（精确字段/required 未保存） | P.data.title/year/director/cast/rating 等资料字段 | 仅已知样例快照；分页输入/末页待补 | `readOnly`；`agentkey.douban.subject`；`agentkey.douban.subject.query` | Q=条件；I=—；S=仅单次快照，输入待补；X=— | sample J4；非新闻；缺字段不能绑定作者 |
| 近期热门电影 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiDoubanGetRecentHotMovieV1` | 对象或榜单条件（精确字段/required 未保存） | P.data.items[].id/uri/title/rating | 仅已知样例快照；分页输入/末页待补 | `readOnly`；`agentkey.douban.hot_movies`；`agentkey.douban.hot_movies.query` | Q=条件；I=—；S=仅单次快照，输入待补；X=— | sample J4；非新闻；缺字段不能绑定作者 |
| 近期热门剧集 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiDoubanGetRecentHotTvV1` | 对象或榜单条件（精确字段/required 未保存） | P.data.items[].id/uri/title/rating | 仅已知样例快照；分页输入/末页待补 | `readOnly`；`agentkey.douban.hot_tv`；`agentkey.douban.hot_tv.query` | Q=条件；I=—；S=仅单次快照，输入待补；X=— | sample J4；非新闻；缺字段不能绑定作者 |

### IMDb（J5）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 栏目资讯快照 / 作品候选→材料 | agentkey / JustOneAPI | `JustOneAPI/getApiImdbNewsByCategoryQueryV1` | category/languageCountry；输入没有 cursor | P.data.news.edges[].node.id/externalUrl/articleTitle.plainText/text.plainText/date/source.homepage/byline | 样例 pageInfo.endCursor/hasNextPage；输入无 cursor，不能翻页 | `readOnly`；`agentkey.imdb.news`；`agentkey.imdb.news.query` | Q=条件；I=条件（原站补全文/时间）；S=仅单次栏目快照；X=分页需求拒绝 | sample J5；gap：text 完整性/原站作者与日期语义；IMDb 不是外链新闻发布者 |
| 作品基础资料 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiImdbTitleBaseQueryV1` | titleId 或榜单条件（精确 required 未保存） | P.data.title（部分对象不含 id，保留请求 titleId 关联） | 仅单次资料/快照；不继承 news 输出游标 | `readOnly`；`agentkey.imdb.title`；`agentkey.imdb.title.query` | Q=条件；I=—；S=单次快照输入待补；X=— | sample J5；gap：用途所需子字段/输入；不能自动成为新闻 |
| 作品详细资料 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiImdbTitleDetailsQueryV1` | titleId 或榜单条件（精确 required 未保存） | P.data.title（部分对象不含 id，保留请求 titleId 关联） | 仅单次资料/快照；不继承 news 输出游标 | `readOnly`；`agentkey.imdb.details`；`agentkey.imdb.details.query` | Q=条件；I=—；S=单次快照输入待补；X=— | sample J5；gap：用途所需子字段/输入；不能自动成为新闻 |
| 票房资料 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiImdbTitleBoxOfficeSummaryV1` | titleId 或榜单条件（精确 required 未保存） | P.data.title（部分对象不含 id，保留请求 titleId 关联） | 仅单次资料/快照；不继承 news 输出游标 | `readOnly`；`agentkey.imdb.box_office`；`agentkey.imdb.box_office.query` | Q=条件；I=—；S=单次快照输入待补；X=— | sample J5；gap：用途所需子字段/输入；不能自动成为新闻 |
| 奖项资料 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiImdbTitleAwardsSummaryQueryV1` | titleId 或榜单条件（精确 required 未保存） | P.data.title（部分对象不含 id，保留请求 titleId 关联） | 仅单次资料/快照；不继承 news 输出游标 | `readOnly`；`agentkey.imdb.awards`；`agentkey.imdb.awards.query` | Q=条件；I=—；S=单次快照输入待补；X=— | sample J5；gap：用途所需子字段/输入；不能自动成为新闻 |
| 榜单排名 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiImdbTitleChartRankingsV1` | titleId 或榜单条件（精确 required 未保存） | P.data.titleChartRankings.edges | 仅单次资料/快照；不继承 news 输出游标 | `readOnly`；`agentkey.imdb.chart`；`agentkey.imdb.chart.query` | Q=条件；I=—；S=单次快照输入待补；X=— | sample J5；gap：用途所需子字段/输入；不能自动成为新闻 |
| 相关作品 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiImdbTitleMoreLikeThisQueryV1` | titleId 或榜单条件（精确 required 未保存） | P.data.title（部分对象不含 id，保留请求 titleId 关联） | 仅单次资料/快照；不继承 news 输出游标 | `readOnly`；`agentkey.imdb.recommendations`；`agentkey.imdb.recommendations.query` | Q=条件；I=—；S=单次快照输入待补；X=— | sample J5；gap：用途所需子字段/输入；不能自动成为新闻 |
| 影评汇总 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiImdbTitleUserReviewsSummaryQueryV1` | titleId 或榜单条件（精确 required 未保存） | P.data.title（部分对象不含 id，保留请求 titleId 关联） | 仅单次资料/快照；不继承 news 输出游标 | `readOnly`；`agentkey.imdb.reviews`；`agentkey.imdb.reviews.query` | Q=条件；I=—；S=单次快照输入待补；X=— | sample J5；gap：用途所需子字段/输入；不能自动成为新闻 |
| 专业评价汇总 / 资料/榜单研究快照 | agentkey / JustOneAPI | `JustOneAPI/getApiImdbTitleCriticsReviewSummaryQueryV1` | titleId 或榜单条件（精确 required 未保存） | P.data.title（部分对象不含 id，保留请求 titleId 关联） | 仅单次资料/快照；不继承 news 输出游标 | `readOnly`；`agentkey.imdb.critics`；`agentkey.imdb.critics.query` | Q=条件；I=—；S=单次快照输入待补；X=— | sample J5；gap：用途所需子字段/输入；不能自动成为新闻 |

### 优酷 Youku（J6）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 视频搜索 / 作品候选→材料 | agentkey / JustOneAPI | `JustOneAPI/getApiYoukuSearchVideoV1` | 查询词/页码（精确键/required 未保存） | P.data.data.nodes 多层卡片；内容卡 data.videoId/vid/title；P.data.data.data.pg/isEnd | pg/isEnd；isEnd 枚举未声明 | `readOnly`；`agentkey.youku.search`；`agentkey.youku.search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | sample J6；gap：作品—作者、原文/正文/时间/末页；任意 node 不作作品 |
| 视频详情 / 作品候选→材料 | agentkey / JustOneAPI | `JustOneAPI/getApiYoukuGetVideoDetailV1` | 视频标识（精确字段/required 未保存） | P.data.videoMap.videoId/videoTitle/videoPublishTime；样例 userId=null | 单对象 | `readOnly`；`agentkey.youku.detail`；`agentkey.youku.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | sample J6；gap：稳定作者/原文及时间格式时区；节目/频道名不代作者 |
| 账号资料 / 账号研究 | agentkey / JustOneAPI | `JustOneAPI/getApiYoukuGetUserDetailV1` | 用户标识（精确字段/required 未保存） | 组件内 uid/uidEncode | 单对象 | `readOnly`；`agentkey.youku.account_profile`；`agentkey.youku.account_profile.query` | Q=条件；I=—；S=单账号快照输入待补；X=映射不足 | sample J6；gap：作品与账号完整映射 |

### 通用资讯与公开网页（W1/W2）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 网页搜索 / 搜索候选→原站材料 | agentkey / Serper | `Serper/search` | q；page/num/gl/hl/tbs/location 固定 | P.organic[].title/link/snippet | page/num 可传；无 has_more/总量保证；仅有界查询快照 | `readOnly`；`agentkey.serper.web_search`；`agentkey.serper.web_search.query` | Q=可设计；I=仅候选，需原站补全；S=有界快照；X=要求完整分页/精确日期则拒绝 | sample W1；snippet 非正文、source 非稳定发布者、date 可相对；不宣称搜全 |
| 资讯搜索 / 搜索候选→原站材料 | agentkey / Serper | `Serper/searchNews` | q；page/num/gl/hl/tbs/location 固定 | P.news[].title/link/snippet/source/date/imageUrl/position | page/num 可传；无 has_more/总量保证；仅有界查询快照 | `readOnly`；`agentkey.serper.news_search`；`agentkey.serper.news_search.query` | Q=可设计；I=仅候选，需原站补全；S=有界快照；X=要求完整分页/精确日期则拒绝 | sample W1；snippet 非正文、source 非稳定发布者、date 可相对；不宣称搜全 |
| 公开 URL 正文提取 / 原文补全→同一材料修订 | agentkey / Jina | `Jina/readUrlPost` | 公开 HTTP(S) url；Accept=application/json；只发 describe 允许且选定的读取参数 | P.code/status/data；P.data.url/title/content；可选 publishedTime/warning；schema 仅必需 url | 单 URL；无列表分页 | `readOnly`；`agentkey.jina.read_url`；`agentkey.jina.read_url.query` | Q=可设计；I=条件（复用原文与来源）；S=有界详情步骤；X=仅正文路线，条件 | doc W2；publishedTime 可能来自 Last-Modified；不自动改发布时间；登录墙/正文质量/身份仍核验；排除 ReaderLM/OCR/生成alt/上传 |

### 辅助能力：douyin

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 作品评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_video_comments_api_v1_douyin_app_v3_fetch_video_comments_get` | 已核 schema：aweme_id:string（schema必填）；count:integer=20；cursor:integer=0；本地冻结cursor=0/count=20 | E.data.code=200; E.data.data.status_code=0; E.data.data.comments[],20 observed; cid/text/aweme_id strings; every aweme_id=request.aweme_id; cursor/has_more/total received. | 只请求首页；cursor/has_more原样存证，不自动续页 | `readOnly`；`agentkey.douyin.comments`；`agentkey.douyin.comments.query` | Q=已本地验收；I=—；S=单页研究快照已验收；X=— | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/186826225e0.md；Homepage cursor0/count20 Q and single-page research S locally accepted; no I/binding, continuous pages unproved, create_time unit unspecified. |
| 评论回复 / 评论研究 | agentkey / TikHub | `TikHub/fetch_video_comments_reply_api_v1_douyin_app_v3_fetch_video_comment_replies_get` | 已核 schema：comment_id:string（schema必填）；count:integer=20；cursor:integer=0；item_id:string（schema必填）；本地冻结cursor=0/count=20 | E.data.code=200; E.data.data.status_code=0; E.data.data.comments[],15 observed; each aweme_id=request.item_id AND reply_id=request.comment_id; cid is reply ID. | 只请求首页；cursor/has_more原样存证，不自动续页 | `readOnly`；`agentkey.douyin.comment_replies`；`agentkey.douyin.comment_replies.query` | Q=已本地验收；I=—；S=单页研究快照已验收；X=— | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/186826226e0.md；Homepage cursor0/count20 Q and single-page research S locally accepted; no I/binding or automatic parent selection; continuous pages unproved. |

### 辅助能力：xiaohongshu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 笔记评论 / 评论研究 | agentkey / TikHub | `TikHub/get_note_comments_api_v1_xiaohongshu_app_v2_get_note_comments_get` | 已核 schema：cursor:string=""；index:integer=0；note_id:string=""；pageArea:string="UNFOLDED"；share_text:string=""；sort_strategy:string="latest_v2" | E.data.data.data.comments[]；comments[].{id,content,note_id,time,like_count,sub_comment_count,user.userid,user.nickname}；success: E.data.data.code=0/success=true | E.data.data.data.{cursor:string,has_more:boolean,page_context:string}; no index/pageArea echo observed | `readOnly`；`agentkey.xiaohongshu.comments`；`agentkey.xiaohongshu.comments.query` | Q/单页研究S=已验收；I/绑定/X=—；未证续页不开放 | 2026-10-22授权样本（本工具2credits）：https://docs.tikhub.io/420136394e0.md；Time unit unspecified; single-page research independent of unproved continuation. Inline sub_comments arrays empty, not additional requests.；当前本地验收见主方案§12.13（回复除外）。 |
| 笔记二级评论 / 评论研究 | agentkey / TikHub | `TikHub/get_note_sub_comments_api_v1_xiaohongshu_app_v2_get_note_sub_comments_get` | 已核 schema：comment_id:string（schema必填）；cursor:string=""；index:integer=1；note_id:string=""；share_text:string="" | E.data.data.data.comments；；success: E.data.data.code=0/success=true | has_more boolean/page_context string; cursor object from prose absent on this empty page | `readOnly`；`agentkey.xiaohongshu.comment_replies`；`agentkey.xiaohongshu.comment_replies.query` | 暂缓（2026-10-23）；Q=仅合法空已证，非空父子结构缺证，仍未接入；I/S/X=— | 2026-10-22授权样本（本工具2credits）：https://docs.tikhub.io/420748830e0.md；Only valid empty response witnessed. Nonempty reply fields and parent-note linkage remain unproved; no second ID/retry. Do not pretend full reply parser is closed.；当前本地验收见主方案§12.13（回复除外）。 |

### 辅助能力：bilibili

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 视频评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_video_comments_api_v1_bilibili_app_fetch_video_comments_get` | 已核 schema：av_id:string；bv_id:string；mode:integer=3；next_offset:integer=1 | 2026-10-22实收：E.data.data.data.replies；comment research；字段类型：rpid_str, oid_str, mid_str, root_str, parent_str, content, member, ctime, like, rcount | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.comments`；`agentkey.bilibili.comments.query` | Q=已本地验收；I=不开放直接列表/研究导入；S=九条首页/有据有界补全已本地验收；X=原预检按实际不兼容阻断；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |
| 评论回复 / 评论研究 | agentkey / TikHub | `TikHub/fetch_reply_detail_api_v1_bilibili_app_fetch_reply_detail_get` | 已核 schema：av_id:string；bv_id:string；next_offset:integer=0；ps:integer=20；root:string（schema必填） | 2026-10-22实收：E.data.data.data.root.replies；nested replies, not top-level replies；字段类型：rpid_str, oid_str, mid_str, root_str, parent_str, content, member, ctime, like | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.comment_replies`；`agentkey.bilibili.comment_replies.query` | Q=已本地验收；I=不开放直接列表/研究导入；S=九条首页/有据有界补全已本地验收；X=原预检按实际不兼容阻断；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |

### 辅助能力：x

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_post_comments_api_v1_twitter_web_fetch_post_comments_get` | 已核 schema：cursor:string；tweet_id:string（schema必填） | 2026-10-23实收E.data.data：根对象id/author独立，thread[]34各有id/author/text/display_text/conversation_id；根不混作评论 | cursor非空；仅首页 | `readOnly`；`agentkey.x.comments`；`agentkey.x.comments.query` | Q=已本地验收；I=—，研究不材料化；S=单页/零详情/无补购已验收；X=无等价操作时拒绝；Q保留RF+AK，S仅AK | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |

### 辅助能力：wechat_channels

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 视频评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_video_comments_api_v1_wechat_channels_v2_fetch_video_comments_post` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.wechat_channels.comments`；`agentkey.wechat_channels.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：kuaishou

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 作品评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_video_comment_api_v1_kuaishou_app_fetch_video_comment_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.kuaishou.comments`；`agentkey.kuaishou.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 评论回复 / 评论研究 | agentkey / TikHub | `TikHub/fetch_video_sub_comments_api_v1_kuaishou_app_fetch_video_sub_comments_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.kuaishou.comment_replies`；`agentkey.kuaishou.comment_replies.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：instagram

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论 / 评论研究 | agentkey / TikHub | `TikHub/get_post_comments_api_v1_instagram_v3_get_post_comments_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.instagram.comments`；`agentkey.instagram.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 评论回复 / 评论研究 | agentkey / TikHub | `TikHub/get_comment_replies_api_v1_instagram_v3_get_comment_replies_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.instagram.comment_replies`；`agentkey.instagram.comment_replies.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：tiktok

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_post_comment_api_v1_tiktok_web_fetch_post_comment_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.tiktok.comments`；`agentkey.tiktok.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 评论回复 / 评论研究 | agentkey / TikHub | `TikHub/fetch_post_comment_reply_api_v1_tiktok_web_fetch_post_comment_reply_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.tiktok.comment_replies`；`agentkey.tiktok.comment_replies.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：youtube

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 视频评论回复 / 评论研究 | agentkey / TikHub | `TikHub/get_video_comment_replies_api_v1_youtube_web_v2_get_video_comment_replies_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.youtube.comment_replies`；`agentkey.youtube.comment_replies.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：zhihu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 文章/回答评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_comment_v5_api_v1_zhihu_web_fetch_comment_v5_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.zhihu.comments`；`agentkey.zhihu.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 二级评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_sub_comment_v5_api_v1_zhihu_web_fetch_sub_comment_v5_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.zhihu.comment_replies`；`agentkey.zhihu.comment_replies.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：xigua

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 视频评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_video_comment_list_api_v1_xigua_app_v2_fetch_video_comment_list_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.xigua.comments`；`agentkey.xigua.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：reddit

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_post_comments_api_v1_reddit_app_fetch_post_comments_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.reddit.comments`；`agentkey.reddit.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 评论回复 / 评论研究 | agentkey / TikHub | `TikHub/fetch_comment_replies_api_v1_reddit_app_fetch_comment_replies_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.reddit.comment_replies`；`agentkey.reddit.comment_replies.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：telegram

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 频道消息评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_post_comments_api_v1_telegram_web_fetch_post_comments_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.telegram.comments`；`agentkey.telegram.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：lemon8

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_post_comment_list_api_v1_lemon8_app_fetch_post_comment_list_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.lemon8.comments`；`agentkey.lemon8.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：pipixia

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_post_comment_list_api_v1_pipixia_app_fetch_post_comment_list_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.pipixia.comments`；`agentkey.pipixia.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：linkedin

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论 / 评论研究 | agentkey / TikHub | `TikHub/get_post_comments_api_v1_linkedin_web_v2_get_post_comments_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.linkedin.comments`；`agentkey.linkedin.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：weibo

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 状态评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_status_comments_api_v1_weibo_app_fetch_status_comments_get` | 已核 schema：max_id:schema；sort_type:string="0"；status_id:string（schema必填） | 2026-10-22实收：E.data.data.items[type=comment].data；字段：id, idstr, rootid, rootidstr, text, created_at, user, like_counts, total_number | max_id 为空或相同停止 | `readOnly`；`agentkey.weibo.comments`；`agentkey.weibo.comments.query` | Q/首页S=已本地验收；仅研究无I/绑定，时间保留实收时区原串 | 固定9路10次，9回执报告1.8credits、粉丝400费用未知。8条用途验收：后端Q8/8、I28/28、S/X Lead修复后36/36；Web评论标签红13/15→绿15/15；UI124–163实际8Q/6S。首次失败/二错停工轨迹见主方案§12.15。 |

### 辅助能力：threads

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论快照 / 评论研究 | agentkey / TikHub | `TikHub/fetch_post_comments_api_v1_threads_web_fetch_post_comments_get` | 帖子标识；精确 required 待补；不启用 end_cursor | next_cursor 恒 null；不支持评论分页 | 仅单页 | `readOnly`；`agentkey.threads.comments`；`agentkey.threads.comments.query` | Q=条件；I=—；S=仅单页快照；X=— | doc T19；gap：评论/父评论 ID、内容/时间 |

### 辅助能力：wechat_mp

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 文章评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_article_comments_api_v1_wechat_mp_v2_fetch_article_comments_post` | 已核 schema：buffer:schema=""；comment_id:schema；raw:boolean=true；url:string（schema必填）；本地固定 raw=false | doc：P.data.appmsgid/comment_id/buffer/has_more/comments[].content_id/nick_name/content/create_time/like_num/reply_total/replies. End buffer empty. Optional input comment_id performance hint from detail; no prerequisite detail purchase. | doc：buffer/has_more；buffer空则停止；单页查询不依赖继续翻页 | `readOnly`；`agentkey.wechat_mp.comments`；`agentkey.wechat_mp.comments.query` | Q=已本地验收，仅研究；I/独立S/X=— | doc 2026-10-22：https://docs.tikhub.io/472974853e0.md；P.data.appmsgid/comment_id/buffer/has_more/comments[].content_id/nick_name/content/create_time/like_num/reply_total/replies. End buffer empty. Optional input comment_id performance hint from detail; no prerequisite detail purchase.；用途边界：Locally accepted Q-only comment research; parent scope/token redacted, no article import/binding or independent S. |
| 评论二级回复 / 评论研究 | agentkey / TikHub | `TikHub/fetch_comment_replies_api_v1_wechat_mp_v2_fetch_comment_replies_post` | 已核 schema：comment_id:schema；content_id:schema=""；offset:integer=0；raw:boolean=true；url:string（schema必填）；本地固定 raw=false | doc：P.data.content_id/parent_nick/reply_total/count/replies[].reply_id/content/nick_name/create_time; offset/next_offset/has_more. content_id omitted selects first comment with replies; require explicit parent when task targets one. all_pages removed. | next_offset/has_more | `readOnly`；`agentkey.wechat_mp.comment_replies`；`agentkey.wechat_mp.comment_replies.query` | Q=已本地验收，仅研究；I/独立S/X=— | doc 2026-10-22：https://docs.tikhub.io/472974854e0.md；P.data.content_id/parent_nick/reply_total/count/replies[].reply_id/content/nick_name/create_time; offset/next_offset/has_more. content_id omitted selects first comment with replies; require explicit parent when task targets one. all_pages removed.；用途边界：Locally accepted Q-only reply research with explicit parent content_id; no material/binding or independent S. |

### 辅助能力：youtube

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 视频评论 / 评论研究 | agentkey / TikHub | `TikHub/get_video_comments_api_v1_youtube_web_v2_get_video_comments_get` | 视频标识；need_format=true（精确 required 待补） | comments[].comment_id/content/author.channel_id/reply_continuation_token | 顶层 continuation_token；末页细则待补 | `readOnly`；`agentkey.youtube.comments`；`agentkey.youtube.comments.query` | Q=条件；I=—；S=有界研究但末页待补；X=— | doc A1；published_time 相对；gap：输入/精确时间/末页 |

### 辅助能力：facebook

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论 / 评论研究 | agentkey / JustOneAPI | `JustOneAPI/getApiFacebookGetPostCommentsV1` | 帖子标识/cursor（精确 required 未保存） | results[].comment_id/parent_comment_id/created_time/message/author.id/expansion_token；cursor | 不透明 cursor；末页约定待补 | `readOnly`；`agentkey.facebook.comments`；`agentkey.facebook.comments.query` | Q=条件；I=—；S=阻断分页末页；X=— | sample J2；gap：时间语义/输入/完整末页 |
| 评论回复 / 评论研究 | agentkey / JustOneAPI | `JustOneAPI/getApiFacebookGetCommentRepliesV1` | 评论标识/expansion token（精确 required 待补） | 样例 results=[]、cursor=null；未证非空回复形态 | 空样例不证明所有末页 | `readOnly`；`agentkey.facebook.comment_replies`；`agentkey.facebook.comment_replies.query` | Q=条件；I=—；S=阻断；X=— | sample J2；gap：非空项结构/父评论/时间/输入；不照抄一级评论 |

### 辅助能力：douyin

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号搜索 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_search_api_v1_douyin_search_fetch_user_search_post` | 已核 schema；本批仅 keyword；后端冻结 cursor=0、douyin_user_fans/douyin_user_type/search_id 为空；拒绝非空筛选/后页 | doc+sample：P.code=200/P.data.status_code=0；user_list[].dynamic_patch.raw_data 为 JSON 字符串，解析后 user_info.uid/sec_uid/nickname；follower_count 数字；文档直接 user_info 分支独立校验 | 本次首页 cursor 数字/has_more=1；search_id 来源映射未证，不续页 | `readOnly`；`agentkey.douyin.account_search`；`agentkey.douyin.account_search.query` | Q/显式账号绑定=已实现并本地验收；不自动绑定，不作为新闻或独立采集任务；其他用途不提前开放 | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/370212784e0.md；Locally accepted unfiltered homepage Q and explicit verified binding; filters, continuation and independent S not enabled. |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/handler_user_profile_api_v1_douyin_app_v3_handler_user_profile_get` | 已核 schema：sec_user_id:string（schema必填） | E.data.code=200; E.data.data.status_code=0; E.data.data.user.user_deleted=true; uid/nickname/special_state_info, no sec_uid. | 单账号；仅注销状态 | `readOnly`；`agentkey.douyin.account_profile`；`agentkey.douyin.account_profile.query` | Q=仅注销状态已验收；正常资料/绑定/S仍缺证；I/X=— | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/186826222e0.md；Restricted deleted-state Q locally accepted. Active profile, binding and S remain blocked by missing successful normal-account evidence. |
| 公开粉丝 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_fans_list_api_v1_douyin_app_v3_fetch_user_fans_list_get` | 已核 schema：count:integer=20；max_time:string="0"；sec_user_id:string="MS4wLjABAAAA9y04iBlVdeMQqTJbqsQZKb-tqWqWW29jPVJqideHT70" | One authorized attempt rejected400/validation; no credits_charged and no success output. | 单页关系快照可独立核验；持续翻页的位置/终止待补 | `readOnly`；`agentkey.douyin.followers`；`agentkey.douyin.followers.query` | 暂缓（2026-10-23）；Q/S=失败后继续阻断；I/X=— | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/198386132e0.md；Still unimplemented Q/S; never infer empty result or retry/fallback without new authorization. |
| 公开关注 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_following_list_api_v1_douyin_web_fetch_user_following_list_get` | 业务sec_user_id必填；本地source_type=2/max_time="0"/count=20 | E.data.code=200; E.data.data.status_code=0; E.data.data.followings[],19 observed from source_type2; member uid/sec_uid/nickname strings; safe max_time and boolean has_more. | 本次首页19名；空引导页单独解释，不自动请求source_type=1或判断末页 | `readOnly`；`agentkey.douyin.following`；`agentkey.douyin.following.query` | Q/S=首页关系快照已验收；I/绑定/X=— | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/198386130e0.md；source_type2/max_time0/count20 Q and single-page research S locally accepted. Empty bootstrap explained separately, never automatically calls source_type1; no binding/import or continuation. |

### 辅助能力：xiaohongshu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号搜索 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/search_users_api_v1_xiaohongshu_app_v2_search_users_get` | 已核 schema：keyword:string（schema必填）；page:integer=1；search_id:string=""；source:string="explore_feed" | E.data.data.data.users[]；users[].{id,name,desc,image,red_id,link}；success: E.data.data.code=0/success=true | E.data.data.{search_id:string,page:number,next_page:number}; no session_id/terminal field | `readOnly`；`agentkey.xiaohongshu.account_search`；`agentkey.xiaohongshu.account_search.query` | Q/按实收稳定ID显式绑定=已验收；不I、不独立S；X=— | 2026-10-22授权样本（本工具2credits）：https://docs.tikhub.io/420136399e0.md；No nickname-by-default binding, only actual returned ID. Homepage research need not prove terminal.；当前本地验收见主方案§12.13（回复除外）。 |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/get_user_info_api_v1_xiaohongshu_app_v2_get_user_info_get` | 已核 schema：share_text:string=""；user_id:string="" | E.data.data.data；userid/nickname/desc/red_id/images/imageb/fans/follows/liked/collected; note_num_stat.{liked,collected,posted}; interactions[]；success: E.data.data.code=0/success=true; data.result.success=true/code=0 | 单对象/单页；不追加真实调用 | `readOnly`；`agentkey.xiaohongshu.account_profile`；`agentkey.xiaohongshu.account_profile.query` | Q/按实收稳定userid显式绑定=已验收；不I、不独立S；X=— | 2026-10-22授权样本（本工具2credits）：https://docs.tikhub.io/420136395e0.md；userid stable returned identity, red_id displayhandle. Source binding uses only actual returneduserid, never nickname/request/default. No contact/geo/advertising fields necessary.；当前本地验收见主方案§12.13（回复除外）。 |

### 辅助能力：bilibili

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_info_api_v1_bilibili_app_fetch_user_info_get` | 已核 schema：user_id:string（schema必填） | 2026-10-22实收：E.data.data.data.card；account Q and explicit stable-MID binding；字段类型：mid, name, handle, sign, description, fans, friend, attention, is_deleted | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.account_profile`；`agentkey.bilibili.account_profile.query` | Q/显式MID绑定=已本地验收；无独立S；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |
| 关注/粉丝统计 / 统计研究 | agentkey / TikHub | `TikHub/fetch_user_relation_stat_api_v1_bilibili_web_fetch_user_relation_stat_get` | 已核 schema：uid:string（schema必填） | 2026-10-22实收：E.data.data；DIRECT counts; no nested code0；字段类型：mid, following, follower | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.relation_stats`；`agentkey.bilibili.relation_stats.query` | Q=已本地验收；I=不开放直接列表/研究导入；S=九条首页/有据有界补全已本地验收；X=原预检按实际不兼容阻断；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |

### 辅助能力：weibo

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_info_api_v1_weibo_app_fetch_user_info_get` | 已核 schema：uid:string（schema必填） | 2026-10-22实收：E.data.data.header.data.userInfo；字段：id, idstr, screen_name, description, followers_count, friends_count, statuses_count | 单账号；本用途不分页 | `readOnly`；`agentkey.weibo.account_profile`；`agentkey.weibo.account_profile.query` | Q/实际UID显式绑定=已本地验收；无独立S，不创建材料 | 固定9路10次，9回执报告1.8credits、粉丝400费用未知。8条用途验收：后端Q8/8、I28/28、S/X Lead修复后36/36；Web评论标签红13/15→绿15/15；UI124–163实际8Q/6S。首次失败/二错停工轨迹见主方案§12.15。 |
| 粉丝列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_followers_api_v1_weibo_app_fetch_user_followers_get` | 已核 schema：page:integer=1；uid:string（schema必填） | 2026-10-22：400/validation拒绝，无成功样例或credits_charged | doc：P.data.list.next_page为空/None/0终止；约1000层数限制，不承诺全量；成员字段待补 | `readOnly`；`agentkey.weibo.followers`；`agentkey.weibo.followers.query` | 暂缓（2026-10-23）；未接入；粉丝400，成功结构仍缺，不重试或借关注替代 | 固定9路10次，9回执报告1.8credits、粉丝400费用未知。8条用途验收：后端Q8/8、I28/28、S/X Lead修复后36/36；Web评论标签红13/15→绿15/15；UI124–163实际8Q/6S。首次失败/二错停工轨迹见主方案§12.15。 |
| 关注列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_following_api_v1_weibo_app_fetch_user_following_get` | 已核 schema：since_id:schema；sort_type:integer=2；uid:string（schema必填） | 2026-10-22实收：E.data.data.data.users[].user；字段：id, idstr, screen_name, description, followers_count, friends_count, verified, following | doc：since_id回传，缺失即末页；末页可非空；不是page；成员字段待补 | `readOnly`；`agentkey.weibo.following`；`agentkey.weibo.following.query` | Q/首页S=已本地验收；仅关系研究，无材料I/绑定 | 固定9路10次，9回执报告1.8credits、粉丝400费用未知。8条用途验收：后端Q8/8、I28/28、S/X Lead修复后36/36；Web评论标签红13/15→绿15/15；UI124–163实际8Q/6S。首次失败/二错停工轨迹见主方案§12.15。 |

### 辅助能力：x

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_profile_api_v1_twitter_web_fetch_user_profile_get` | 已核 schema：rest_id:integer；screen_name:string | 2026-10-23实收E.data.data：status=active；profile/rest_id/id/name/desc；实际handle与请求、id/rest_id相符 | 单对象，不需分页 | `readOnly`；`agentkey.x.account_profile`；`agentkey.x.account_profile.query` | Q/显式绑定=已本地验收；仅既有完整匹配单账号x_search，不新建external作者；S=—，不创建独立订阅；X=无等价操作 | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |
| 粉丝列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_followers_api_v1_twitter_web_fetch_user_followers_get` | 已核 schema：cursor:string；screen_name:string（schema必填） | 2026-10-23实收E.data.data：followers[]70：user_id/screen_name/name/description与统计；status=ok | next_cursor非空、more_users=true；后页未执行 | `readOnly`；`agentkey.x.followers`；`agentkey.x.followers.query` | Q=已本地验收；I=—，研究不材料化；S=单页/零详情/无补购已验收；X=无等价操作时拒绝 | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |
| 关注列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_followings_api_v1_twitter_web_fetch_user_followings_get` | 已核 schema：cursor:string；screen_name:string（schema必填） | 2026-10-23实收E.data.data：following[]70：user_id/screen_name/name/description与统计；status=ok | next_cursor非空、more_users=true；后页未执行 | `readOnly`；`agentkey.x.following`；`agentkey.x.following.query` | Q=已本地验收；I=—，研究不材料化；S=单页/零详情/无补购已验收；X=无等价操作时拒绝；Q保留RF+AK，S仅AK | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |

### 辅助能力：wechat_channels

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料/统计 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_profile_api_v1_wechat_channels_v2_fetch_user_profile_post` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.wechat_channels.account_profile`；`agentkey.wechat_channels.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：kuaishou

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号搜索 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/search_user_v2_api_v1_kuaishou_app_search_user_v2_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.kuaishou.account_search`；`agentkey.kuaishou.account_search.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_one_user_v2_api_v1_kuaishou_app_fetch_one_user_v2_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.kuaishou.account_profile`；`agentkey.kuaishou.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：instagram

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/get_user_profile_api_v1_instagram_v3_get_user_profile_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.instagram.account_profile`；`agentkey.instagram.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 粉丝列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/get_user_followers_api_v1_instagram_v3_get_user_followers_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.instagram.followers`；`agentkey.instagram.followers.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 关注列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/get_user_following_api_v1_instagram_v3_get_user_following_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.instagram.following`；`agentkey.instagram.following.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：tiktok

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号搜索 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_search_user_api_v1_tiktok_web_fetch_search_user_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.tiktok.account_search`；`agentkey.tiktok.account_search.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_profile_api_v1_tiktok_web_fetch_user_profile_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.tiktok.account_profile`；`agentkey.tiktok.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 粉丝列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_fans_api_v1_tiktok_web_fetch_user_fans_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.tiktok.followers`；`agentkey.tiktok.followers.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 关注列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_follow_api_v1_tiktok_web_fetch_user_follow_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.tiktok.following`；`agentkey.tiktok.following.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：youtube

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 频道资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/get_channel_info_api_v1_youtube_web_get_channel_info_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.youtube.channel_profile`；`agentkey.youtube.channel_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：zhihu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_info_api_v1_zhihu_web_fetch_user_info_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.zhihu.account_profile`；`agentkey.zhihu.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 粉丝列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_followers_api_v1_zhihu_web_fetch_user_followers_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.zhihu.followers`；`agentkey.zhihu.followers.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 关注列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_followees_api_v1_zhihu_web_fetch_user_followees_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.zhihu.following`；`agentkey.zhihu.following.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：xigua

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_info_api_v1_xigua_app_v2_fetch_user_info_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.xigua.account_profile`；`agentkey.xigua.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：reddit

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_profile_api_v1_reddit_app_fetch_user_profile_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.reddit.account_profile`；`agentkey.reddit.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 社区资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_subreddit_info_api_v1_reddit_app_fetch_subreddit_info_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.reddit.community_profile`；`agentkey.reddit.community_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：telegram

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 频道资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_channel_info_api_v1_telegram_web_fetch_channel_info_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.telegram.channel_profile`；`agentkey.telegram.channel_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 相似频道 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_similar_channels_api_v1_telegram_web_fetch_similar_channels_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.telegram.related_channels`；`agentkey.telegram.related_channels.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：threads

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号搜索 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/search_profiles_api_v1_threads_web_search_profiles_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.threads.account_search`；`agentkey.threads.account_search.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_info_api_v1_threads_web_fetch_user_info_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.threads.account_profile`；`agentkey.threads.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：lemon8

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/handler_user_profile_api_v1_lemon8_app_fetch_user_profile_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.lemon8.account_profile`；`agentkey.lemon8.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 粉丝列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_follower_list_api_v1_lemon8_app_fetch_user_follower_list_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.lemon8.followers`；`agentkey.lemon8.followers.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 关注列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_following_list_api_v1_lemon8_app_fetch_user_following_list_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.lemon8.following`；`agentkey.lemon8.following.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：pipixia

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_info_api_v1_pipixia_app_fetch_user_info_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.pipixia.account_profile`；`agentkey.pipixia.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 粉丝列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_follower_list_api_v1_pipixia_app_fetch_user_follower_list_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.pipixia.followers`；`agentkey.pipixia.followers.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 关注列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_following_list_api_v1_pipixia_app_fetch_user_following_list_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.pipixia.following`；`agentkey.pipixia.following.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：linkedin

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 个人资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/get_user_profile_api_v1_linkedin_web_v2_get_user_profile_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.linkedin.user_profile`；`agentkey.linkedin.user_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 公司资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/get_company_profile_api_v1_linkedin_web_v2_get_company_profile_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.linkedin.company_profile`；`agentkey.linkedin.company_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：douyin

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 话题作品 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_hashtag_video_list_api_v1_douyin_app_v3_fetch_hashtag_video_list_get` | 已核 schema：ch_id:string（schema必填）；count:integer=10；cursor:integer=0；sort_type:integer=0；本地cursor=0/count=10/sort_type=0/1/2 | E.data.code=200; E.data.data.status_code=0; aweme_list=[] but E.data.data.mix_list[] type1.aweme_info contains10 works, string aweme_id and author.uid/sec_uid/nickname. | 单页；cursor/has_more只存事实；不请求续页 | `readOnly`；`agentkey.douyin.topic_posts`；`agentkey.douyin.topic_posts.query` | Q/I/单页S=本地验收；I仍核真实作者/作品/原文，未知时间回填；X=未开放 | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/186826238e0.md；Homepage cursor0/count10 Q and single-page material S locally accepted; explicit I uses original verified identity/URL path, unknown create_time unit is not a trusted date. No continuation/detail. |

### 辅助能力：xiaohongshu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 话题笔记 / 内容候选/研究 | agentkey / TikHub | `TikHub/get_topic_feed_api_v1_xiaohongshu_app_v2_get_topic_feed_get` | 已核 schema：cursor_score:string=""；first_load_time:string=""；last_note_ct:string=""；last_note_id:string=""；page_id:string（schema必填）；session_id:string=""；sort:string="trend"；source:string="normal" | E.data.data.data.items[]；items[].{id,title,desc,type,user.user_id,user.nickname,share_info.link,cursor_score,create_time,note_time.create_time,note_time.update_time}；success: E.data.data.code=0/success=true | E.data.data.data.has_more boolean; items[last].cursor_score/id/create_time strings or numbers per shape; response did not provide first_load_time/session_id | `readOnly`；`agentkey.xiaohongshu.topic_posts`；`agentkey.xiaohongshu.topic_posts.query` | Q/单页S/实际作者与原生URL下I=已验收；连续会话未证；X=不支持 | 2026-10-22授权样本（本工具2credits）：https://docs.tikhub.io/420136408e0.md；Don't invent continuous-session values or time unit. No video_info/play streams. Explicit material use only actual stable author/native URL.；当前本地验收见主方案§12.13（回复除外）。 |

### 辅助能力：bilibili

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号动态 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_collect_folders_api_v1_bilibili_web_fetch_user_dynamic_get` | 已核 schema：offset:string=""；uid:string（schema必填） | 2026-10-22实收：E.data.data.data.items；dynamic research; not video import；字段类型：id_str, type, basic, modules, orig | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.dynamics`；`agentkey.bilibili.dynamics.query` | Q=已本地验收；I=不开放直接列表/研究导入；S=九条首页/有据有界补全已本地验收；X=原预检按实际不兼容阻断；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |

### 辅助能力：x

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 列表时间线 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_list_timeline_api_v1_twitter_web_fetch_list_timeline_get` | 已核 schema：cursor:string；list_id:string（schema必填） | 2026-10-23实收E.data.data：timeline[]99：tweet_id/text/created_at/author.rest_id/screen_name；外层作者别名一致 | cursor非空；只首页；未返回容器ID | `readOnly`；`agentkey.x.list_posts`；`agentkey.x.list_posts.query` | Q/I=已按用途本地验收；I仅实收原证据/作者/文本/原生链接齐备者，正文pending；转发/未知角色/缺引用身份仅研究；S=单页/零详情/无补购已验收；X=无等价操作时拒绝 | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |
| 社区时间线 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_community_timeline_api_v1_twitter_web_fetch_community_timeline_get` | 已核 schema：community_id:string（schema必填）；cursor:string；ranking:string | 2026-10-23实收E.data.data：timeline[]19：tweet_id/text/created_at/author.rest_id/screen_name；外层作者别名一致 | cursor非空；只首页；未返回容器ID | `readOnly`；`agentkey.x.community_posts`；`agentkey.x.community_posts.query` | Q/I=已按用途本地验收；I仅实收原证据/作者/文本/原生链接齐备者，正文pending；转发/未知角色/缺引用身份仅研究；S=单页/零详情/无补购已验收；X=无等价操作时拒绝 | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |

### 辅助能力：wechat_channels

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 频道内搜索 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_search_channel_videos_api_v1_wechat_channels_v2_fetch_search_channel_videos_post` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.wechat_channels.channel_search`；`agentkey.wechat_channels.channel_search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 合集视频 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_collection_videos_api_v1_wechat_channels_v2_fetch_collection_videos_post` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.wechat_channels.collection_posts`；`agentkey.wechat_channels.collection_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：instagram

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 话题帖子 / 内容候选/研究 | agentkey / TikHub | `TikHub/get_hashtag_posts_api_v1_instagram_v3_get_hashtag_posts_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.instagram.hashtag_posts`；`agentkey.instagram.hashtag_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 地点帖子 / 内容候选/研究 | agentkey / TikHub | `TikHub/get_location_posts_api_v1_instagram_v3_get_location_posts_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.instagram.location_posts`；`agentkey.instagram.location_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 账号 Reels / 内容候选/研究 | agentkey / TikHub | `TikHub/get_user_reels_api_v1_instagram_v3_get_user_reels_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.instagram.reels`；`agentkey.instagram.reels.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：tiktok

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 话题帖子 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_tag_post_api_v1_tiktok_web_fetch_tag_post_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.tiktok.tag_posts`；`agentkey.tiktok.tag_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：youtube

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 频道 Shorts / 内容候选/研究 | agentkey / TikHub | `TikHub/get_channel_shorts_api_v1_youtube_web_v2_get_channel_shorts_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.youtube.shorts`；`agentkey.youtube.shorts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 频道社区帖 / 内容候选/研究 | agentkey / TikHub | `TikHub/get_channel_community_posts_api_v1_youtube_web_v2_get_channel_community_posts_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.youtube.community_posts`；`agentkey.youtube.community_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：zhihu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号文章 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_user_articles_api_v1_zhihu_web_fetch_user_articles_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.zhihu.account_articles`；`agentkey.zhihu.account_articles.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 账号回答 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_user_answers_api_v1_zhihu_web_fetch_user_answers_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.zhihu.account_answers`；`agentkey.zhihu.account_answers.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 专栏文章列表 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_column_articles_api_v1_zhihu_web_fetch_column_articles_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.zhihu.column_articles`；`agentkey.zhihu.column_articles.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 问题下回答 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_question_answers_api_v1_zhihu_web_fetch_question_answers_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.zhihu.question_answers`；`agentkey.zhihu.question_answers.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：reddit

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 用户帖子 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_user_posts_api_v1_reddit_app_fetch_user_posts_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.reddit.account_posts`；`agentkey.reddit.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 社区内容 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_subreddit_feed_api_v1_reddit_app_fetch_subreddit_feed_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.reddit.community_posts`；`agentkey.reddit.community_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 话题内容 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_topic_feed_api_v1_reddit_app_fetch_topic_feed_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.reddit.topic_posts`；`agentkey.reddit.topic_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：threads

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 用户回复快照 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_user_replies_api_v1_threads_web_fetch_user_replies_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.threads.user_replies`；`agentkey.threads.user_replies.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 用户转帖快照 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_user_reposts_api_v1_threads_web_fetch_user_reposts_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.threads.user_reposts`；`agentkey.threads.user_reposts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：pipixia

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 话题作品 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_hashtag_post_list_api_v1_pipixia_app_fetch_hashtag_post_list_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.pipixia.topic_posts`；`agentkey.pipixia.topic_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：douyin

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 热搜快照 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_hot_search_list_api_v1_douyin_app_v3_fetch_hot_search_list_get` | 已核 schema：board_sub_type:string=""；board_type:string="0"；本地仅board_type="0"/board_sub_type="" | E.data.code=200; E.data.data.status_code=0; E.data.data.data.word_list[], 51 observed; word/sentence_id string, hot_value number. | 单次榜单，无分页 | `readOnly`；`agentkey.douyin.trending`；`agentkey.douyin.trending.query` | Q/S=默认榜单单次/单页快照已验收；I/X=— | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/186826239e0.md；Default board0/empty subtype Q and single-page S locally accepted. No inferred rank or material import; other boards unproved. |
| 搜索联想 / 搜索建议研究 | agentkey / TikHub | `TikHub/fetch_search_suggest_api_v1_douyin_search_fetch_search_suggest_post` | keyword:string，必填并冻结；固定工具，无自动查询/补全请求 | doc+sample：P.code=200；P.data.status_code=0；P.data.sug_list[].content 字符串，本次5条 | 单次建议词查询，不分页 | `readOnly`；`agentkey.douyin.suggest`；`agentkey.douyin.suggest.query` | Q=已实现并本地验收；仅研究词条，不入材料、不建独立定时生命周期 | doc+分批授权证据 2026-10-22：https://docs.tikhub.io/370212778e0.md；Locally accepted Q only; no material/binding or independent S. |

### 辅助能力：xiaohongshu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 搜索联想 / 搜索建议研究 | agentkey / TikHub | `TikHub/fetch_search_suggest_api_v1_xiaohongshu_web_v3_fetch_search_suggest_get` | 已核 schema：keyword:string="" | E.data.data.data.sug_items[].text；；success: E.data.data.ok=true/status200/code1000/success=true | 单对象/单页；不追加真实调用 | `readOnly`；`agentkey.xiaohongshu.suggest`；`agentkey.xiaohongshu.suggest.query` | Q=已验收；仅建议词，无I/S/X | 2026-10-22授权样本（本工具2credits）：https://docs.tikhub.io/438852174e0.md；Code1000 is witnessed success in THIS route; not blanket global business-successcode.；当前本地验收见主方案§12.13（回复除外）。 |
| 首页推荐 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_homefeed_api_v1_xiaohongshu_web_v3_fetch_homefeed_get` | 已核 schema：category:string="homefeed_recommend"；cursor_score:string=""；need_filter_image:boolean=false；num:integer=20 | E.data.data.data.items[] model_type=note, note_card；items[].{id,model_type,note_card.type,note_card.display_title,note_card.user,note_card.interact_info}；success: E.data.data.ok=true/status200/code0/success=true | E.data.data.data.cursor_score string | `readOnly`；`agentkey.xiaohongshu.recommendations`；`agentkey.xiaohongshu.recommendations.query` | Q/单页研究S=已验收；仅AgentKey推荐禁I，不影响Redfox原规则；X=— | 2026-10-22授权样本（本工具2credits）：https://docs.tikhub.io/438852175e0.md；Role provider_recommendation, research only, not keyword matches/materials; no autoplay/stream parse.；当前本地验收见主方案§12.13（回复除外）。 |

### 辅助能力：bilibili

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 热门视频快照 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_popular_feed_api_v1_bilibili_app_fetch_popular_feed_get` | 已核 schema：idx:integer=1；last_param:string | 2026-10-22实收：E.data.data.data；provider recommendation video research；字段类型：card_type, card_goto, goto, param, bvid, title, uri, idx | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.trending`；`agentkey.bilibili.trending.query` | Q=已本地验收；I=不开放直接列表/研究导入；S=九条首页/有据有界补全已本地验收；X=原预检按实际不兼容阻断；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |
| 热搜词 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_hot_search_api_v1_bilibili_web_fetch_hot_search_get` | 已核 schema：limit:schema（schema必填） | 2026-10-22实收：E.data.data.data.trending.list；keyword research; no inferred rank；字段类型：keyword, show_name, heat_score, uri, goto | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.hot_search`；`agentkey.bilibili.hot_search.query` | Q=已本地验收；I=不开放直接列表/研究导入；S=九条首页/有据有界补全已本地验收；X=原预检按实际不兼容阻断；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |

### 辅助能力：weibo

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 热搜快照 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_hot_search_api_v1_weibo_app_fetch_hot_search_get` | 已核 schema：category:string="realtimehot"；count:integer=20；page:integer=1；region_name:string | 2026-10-22实收：E.data.data.items[category=group].items[].data[card_type=4]；字段：card_type, desc, desc_extr, scheme, openurl | 单次榜单快照；本用途不要求翻页 | `readOnly`；`agentkey.weibo.trending`；`agentkey.weibo.trending.query` | Q/首页S=已本地验收；仅词条研究无I，不虚构排名 | 固定9路10次，9回执报告1.8credits、粉丝400费用未知。8条用途验收：后端Q8/8、I28/28、S/X Lead修复后36/36；Web评论标签红13/15→绿15/15；UI124–163实际8Q/6S。首次失败/二错停工轨迹见主方案§12.15。 |
| 相关搜索 / 搜索建议研究 | agentkey / TikHub | `TikHub/fetch_similar_search_api_v1_weibo_web_v2_fetch_similar_search_get` | 已核 schema：keyword:string（schema必填） | 2026-10-22实收：E.data.data.hotquery[]；字段：suggestion, count, discuss, discuss_num, type, top_flag, topic_flag | 单次建议查询；不要求后页或末页证据 | `readOnly`；`agentkey.weibo.related_search`；`agentkey.weibo.related_search.query` | Q/首页S=已本地验收；仅词条研究无I | 固定9路10次，9回执报告1.8credits、粉丝400费用未知。8条用途验收：后端Q8/8、I28/28、S/X Lead修复后36/36；Web评论标签红13/15→绿15/15；UI124–163实际8Q/6S。首次失败/二错停工轨迹见主方案§12.15。 |

### 辅助能力：wechat_mp

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 相关文章 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_related_articles_api_v1_wechat_mp_v2_fetch_related_articles_post` | 已核 schema：raw:boolean=true；url:string（schema必填）；本地固定 raw=false | doc：raw=false P.data.ret0/count/articles[]; absent feature -> []; raw=true base_resp.ret/article_size/list[]. No per-article title/URL names in exact doc. | 先核单次快照；只有启用翻页才补位置/终止 | `readOnly`；`agentkey.wechat_mp.related_articles`；`agentkey.wechat_mp.related_articles.query` | 暂缓（2026-10-23）；Q/I/S=非空合同缺证，未实现；X=— | doc 2026-10-22：https://docs.tikhub.io/472974855e0.md；raw=false P.data.ret0/count/articles[]; absent feature -> []; raw=true base_resp.ret/article_size/list[]. No per-article title/URL names in exact doc.；用途边界：Not implemented: documented legal empty/count shape does not prove meaningful nonempty projection. |
| 文章互动统计 / 统计研究 | agentkey / TikHub | `TikHub/fetch_article_stats_h5_api_v1_wechat_mp_v2_fetch_article_stats_h5_post` | 已核 schema：comment_id:schema；raw:boolean=true；url:string（schema必填）；本地固定 raw=false | doc：P.data.comment_count/elected_comment_count；read_num/like_count/old_like_count/share_count/collect_count/star_num恒null且在unavailable列出 | 单文章统计；不分页；不为缺失阅读/点赞自动调用其他工具 | `readOnly`；`agentkey.wechat_mp.article_stats`；`agentkey.wechat_mp.article_stats.query` | Q=已本地验收，仅研究；I/独立S/X=— | doc 2026-10-22：https://docs.tikhub.io/511928398e0.md；P.data.comment_count/elected_comment_count; read_num/like_count/old_like_count/share_count/collect_count/star_num always null in unavailable; optional comment_id; no auto fallback.；用途边界：Locally accepted Q-only two comment-count metrics; unsupported read/like/share counts unavailable, not0. No independent S. |

### 辅助能力：kuaishou

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 热点榜 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_hot_board_detail_api_v1_kuaishou_app_fetch_hot_board_detail_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.kuaishou.trending`；`agentkey.kuaishou.trending.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：instagram

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 探索推荐 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/get_explore_api_v1_instagram_v3_get_explore_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.instagram.explore`；`agentkey.instagram.explore.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：tiktok

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 趋势搜索词 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_trending_searchwords_api_v1_tiktok_web_fetch_trending_searchwords_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.tiktok.trending`；`agentkey.tiktok.trending.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |
| 搜索联想 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_search_keyword_suggest_api_v1_tiktok_web_fetch_search_keyword_suggest_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.tiktok.suggest`；`agentkey.tiktok.suggest.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：youtube

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 热门视频 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/get_trending_videos_api_v1_youtube_web_get_trending_videos_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.youtube.trending`；`agentkey.youtube.trending.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |
| 相关视频 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/get_related_videos_api_v1_youtube_web_v2_get_related_videos_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.youtube.related_videos`；`agentkey.youtube.related_videos.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |
| 搜索联想 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/get_search_suggestions_api_v1_youtube_web_v2_get_search_suggestions_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.youtube.suggest`；`agentkey.youtube.suggest.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：zhihu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 热榜 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_hot_list_api_v1_zhihu_web_fetch_hot_list_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.zhihu.trending`；`agentkey.zhihu.trending.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |
| 搜索联想 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_search_suggest_api_v1_zhihu_web_fetch_search_suggest_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.zhihu.suggest`；`agentkey.zhihu.suggest.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：reddit

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 趋势搜索 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_trending_searches_api_v1_reddit_app_fetch_trending_searches_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.reddit.trending`；`agentkey.reddit.trending.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |
| 新闻推荐 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_news_feed_api_v1_reddit_app_fetch_news_feed_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.reddit.news_feed`；`agentkey.reddit.news_feed.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：lemon8

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 热门搜索词 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_hot_search_keywords_api_v1_lemon8_app_fetch_hot_search_keywords_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.lemon8.trending`；`agentkey.lemon8.trending.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：pipixia

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 热搜词 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_hot_search_words_api_v1_pipixia_app_fetch_hot_search_words_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.pipixia.trending`；`agentkey.pipixia.trending.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：x

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 国家趋势快照 / 趋势研究 | agentkey / TikHub | `TikHub/fetch_trending_api_v1_twitter_web_fetch_trending_get` | 已核 schema：country:string="UnitedStates" | 2026-10-23实收E.data.data：trends[]50：name/description/context；无rank、heat或原文 | 榜单快照，无分页需求 | `readOnly`；`agentkey.x.trending`；`agentkey.x.trending.query` | Q=已本地验收；I=—，研究不材料化；S=单页/零详情/无补购已验收；X=无等价操作时拒绝 | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |

## 独有用途与无路线边界

下表补充不能混同于普通帖子关键词搜索或账号作品的用途。其余同义版本、批量包装和纯 ID/URL 转换不另设业务入口；已选详情可提供身份链时，先复用该证据。现有证据仍不足的独有用途维持候选，不能伪装为已接通。

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 用户/话题/地点综合搜索 / 研究候选 | agentkey / TikHub | `TikHub/general_search_api_v1_instagram_v3_general_search_get` | 查询对象（精确字段/required 未保存） | 仅用途/目录证据；完整输出未证实 | 末页未证实；明确不分页时仅单次快照 | `needs_review`；`agentkey.instagram.search`；`agentkey.instagram.search.query` | Q=待补；I=—；S=阻断；X=— | gap：T12 明确综合搜索主要是用户/话题/地点，不能等同帖子关键词搜索 |
| 视频号全站视频搜索 / 研究候选 | agentkey / TikHub | `TikHub/fetch_search_videos_api_v1_wechat_search_v2_fetch_search_videos_post` | 查询对象（精确字段/required 未保存） | 仅用途/目录证据；完整输出未证实 | 末页未证实；明确不分页时仅单次快照 | `needs_review`；`agentkey.wechat_search.video_search`；`agentkey.wechat_search.video_search.query` | Q=待补；I=—；S=阻断；X=— | gap：目录独有搜索路线；不能套综合搜索 T8 输出 |
| video/article/user 分类型搜索 / 研究候选 | agentkey / TikHub | `TikHub/fetch_search_by_type_api_v1_bilibili_app_fetch_search_by_type_get` | 已核 schema：cursor:string=""；keyword:string（schema必填）；order:integer=0；page_size:integer=20；search_type:string="video" | 2026-10-22实收：E.data.data.data.items；video only; other search_type not yet evidenced；字段类型：goto, param, uri, av | 仅已收分页事实；当前首页/单对象；S20/20通过，仍不宣称真实后页已证 | `readOnly`；`agentkey.bilibili.typed_search`；`agentkey.bilibili.typed_search.query` | Q=已本地验收；I=不开放直接列表/研究导入；S=九条首页/有据有界补全已本地验收；X=原预检按实际不兼容阻断；Web/UI已验收（浏览器实际11Q/3S代表） | 11次各0.2共2.2credits；类型/谓词见catalog.phase2Evidence.bilibiliLiveContractEvidence；Q两缺陷红2/2→绿10/10，I首21/23→fixture修正后23/23；S20/20、Web最终7文件58/58/types、UI88–123通过；摘要P3-1 SSR红1/1→绿1/1，独立review漏项轨迹保留，见主方案§12.14。 |
| 视频详情查询 / 研究候选 | agentkey / TikHub | `TikHub/get_video_info_api_v1_toutiao_app_get_video_info_get` | 已核 schema：group_id:string（schema必填） | E.data.code200 but E.data.data.err_no10400/data null; response charged.2credits. | 单视频详情；本用途不分页 | `readOnly`；`agentkey.toutiao.video_detail`；`agentkey.toutiao.video_detail.query` | 暂缓（2026-10-23）；Q/I/S=业务错误10400后仍缺成功合同，未接入；X=— | doc+2026-10-22授权样本：https://docs.tikhub.io/251380587e0.md；Not a successful video/empty contract; Q/S/I remain blocked. No registered error-only adapter or retry.；当前实现见主方案§12.12，原样例边界不扩大。 |
| 公开列表成员 / 研究候选 | agentkey / TikHub | `TikHub/fetch_list_members_api_v1_twitter_web_fetch_list_members_get` | 已核 schema：cursor:string；list_id:string（schema必填） | 2026-10-23实收E.data.data：members[]20：user_id/screen_name/name/description与统计；status=ok | next_cursor非空、more_users=true；后页未执行 | `readOnly`；`agentkey.x.list_members`；`agentkey.x.list_members.query` | Q=已本地验收；I=—，研究不材料化；S=单页/零详情/无补购已验收；X=无等价操作时拒绝 | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |
| 公开社区成员快照 / 研究候选 | agentkey / TikHub | `TikHub/fetch_community_members_api_v1_twitter_web_fetch_community_members_get` | 已核 schema：community_id:string（schema必填）；cursor:string | 2026-10-23实收E.data.data：members[]19：user_id/screen_name/name/profile_image/blue_verified；status=ok | 官方明确不支持分页；next_cursor虽非空也不能续传 | `readOnly`；`agentkey.x.community_members`；`agentkey.x.community_members.query` | Q=已本地验收；I=—，研究不材料化；S=单页/零详情/无补购已验收；X=无等价操作时拒绝 | 固定12路13次共2.6credits；后端/Web/真实本地浏览器已验，UI164–228最终批注图已逐张回看，原图配对留证。最终Web64/64、metadata70/70、独立库AK189/189分别记录不累加；失败/修复轨迹及限制见主方案§12.16与catalog.phase2Evidence.xLiveContractEvidence。 |
| 职位信息搜索研究 / 研究候选 | agentkey / TikHub | `TikHub/search_jobs_api_v1_linkedin_web_v2_search_jobs_get` | 查询对象（精确字段/required 未保存） | 仅用途/目录证据；完整输出未证实 | 末页未证实；明确不分页时仅单次快照 | `needs_review`；`agentkey.linkedin.jobs`；`agentkey.linkedin.jobs.query` | Q=待补；I=—；S=阻断；X=— | gap：只读职位资料研究；不成为新闻材料 |
| 职位资料详情研究 / 研究候选 | agentkey / TikHub | `TikHub/get_job_detail_api_v1_linkedin_web_v2_get_job_detail_get` | 查询对象（精确字段/required 未保存） | 仅用途/目录证据；完整输出未证实 | 末页未证实；明确不分页时仅单次快照 | `needs_review`；`agentkey.linkedin.job_detail`；`agentkey.linkedin.job_detail.query` | Q=待补；I=—；S=阻断；X=— | gap：只读职位资料研究；不成为新闻材料 |

未选择不存在的路线：TikHub 今日头条无关键词搜索/账号作品列表，由下表直连承担；Lemon8 无账号作品列表；Facebook 无独立帖子详情（以搜索/账号结果为样例合同）；优酷无账号作品列表；豆瓣无普通资讯关键词搜索；IMDb 只栏目资讯/资料快照。Instagram 综合搜索不冒充帖子关键词检索；当前 TikHub 无法证明满足某既有用途时保留原供应商，不自动改投 JustOneAPI、Sorsa 或 AgentKey 内 RedFox。微信搜索恒空计费垂类不因 enum 存在而开放。

Threads 的 recent/top 是两个排序用途，本矩阵先固定 recent，不增加版本/排序选择器；若明确需要 top，须另选其精确工具与合同。IMDb 其余演员/地区/发行/剧情/花絮/长资料等字段属于作品资料研究，同义/扩展资料工具未选即不可执行；不影响本矩阵对资讯、榜单、票房、奖项、评价及基础/详细资料的业务覆盖。

## 保留的直连 Redfox 分工

这些行的工具是 **Redfox 直连 operation ID**，不是 `AgentKey execute_tool` 的名字；AgentKey 目录里的 `RedFox/…` 全部未选。来源为仓库已存在的 contract/parser/execution，不是本轮供应商实测。表中输出是 parser 能识别的字段，多数字段允许缺失，绝不表示供应商总能返回；缺本条必需证据时原有导入校验仍拒绝。

源码：[头条合同](../../packages/backend/src/providers/redfox/toutiao-contract.ts)、[头条解析](../../packages/backend/src/providers/redfox/toutiao.ts)、[评论合同](../../packages/backend/src/providers/redfox/social-research-contract.ts)、[评论解析](../../packages/backend/src/providers/redfox/social-research.ts)、[汽车之家](../../packages/backend/src/providers/redfox/qichezhijia-contract.ts)、[懂车帝](../../packages/backend/src/providers/redfox/dongchedi-contract.ts)、[易车](../../packages/backend/src/providers/redfox/yiche-contract.ts)、[热点](../../packages/backend/src/providers/redfox/hot-research-contract.ts)、[现有分页与调度](../../packages/backend/src/sources/platform-execution.ts)。

恢复键约定：下表 `RF-Q` 精确对应 `readOnly; operation=redfox.sync.query; step=redfox.sync.query`；`RF-S` 精确对应 `readOnly; operation=redfox.platform.collection; step=redfox.platform.page`（材料本地处理为 `redfox.platform.item`，被选详情外发为 `redfox.platform.detail`）。这是保留现有键，未为 Redfox 改名。详情本身不是独立定时列表。

| 业务能力 / AIHOT结果 | provider/upstream | 直连精确工具 ID | 必需输入 | 本地合同可识别输出 | 分页 / 末页 | recovery/operation/step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 头条关键词搜索 / toutiao_work | redfox / — | `28CFGF5I` | keyword/offset（数字字符串，首0） | 数组；opusId/uid/opusUrl/title/content/publishTime；搜索时间按秒 | offset 每页+1；空作品页/本地上限停止；无供应商 has_more 保证 | RF-Q；RF-S | Q=现有；I=逐条条件；S=现有有界采集；X=保留/按业务预检 | doc（仓库）；需本条 uid、作品与核实原文；不宣称搜全 |
| 头条账号作品 / toutiao_work | redfox / — | `R1IGR09H` | category/token/offset；token 来自 /c/user/token/，不是 uid | workList[].workId/secUid/workUrl/title/content/publishTime；hasMore/offset 可选 | 当前自动后页 mapping-unverified，按单次请求结束 | RF-Q；RF-S | Q=现有；I=逐条条件；S=现有单页；X=必需连续分页则阻断 | doc（仓库）；gap：后页映射；请求 token 不补作者 |
| 头条详情 / toutiao_work | redfox / — | `PAB6Z75Y` | opusId；可带同作品冻结 origin 证据 | workId/workUrl/title/content；作者仅来自可核的列表/搜索 origin，冲突拒绝 | 单对象 | RF-Q；采集详情 step=redfox.platform.detail | Q=现有；I=逐条条件；S=有界补全；X=同作品身份条件 | doc（仓库）；独立详情无作者时不得自建绑定 |
| 头条评论 / social_comment | redfox / — | `ZMFVK589` | opusId；offset 可选不透明原串 | comments[].cid/uid/content/createTime；opusId/total/offset/hasMore；createTime 秒 | 按响应保留 offset/hasMore；当前无定时评论订阅 | RF-Q | Q=现有；I=—；S=—；X=— | doc（仓库）；仅研究，不导入/绑定；updateTime 单位未指定 |
| 头条账号搜索 / toutiao_account | redfox / — | `4QS1F8DE` | name；offset/searchId 可选并原样续传 | list[].uid/homeUrl/nickname/introduction；hasMore/offset/searchId | 响应 offset/searchId；无定时账号搜索 | RF-Q | Q=现有；I=—；S=—；X=身份辅助 | doc（仓库）；昵称与 home token 不等于 uid |
| 汽车之家搜索 / qichezhijia_work | redfox / — | `CI7VW144` | keyword/offset/page/sourceType=club,article,video | 数组；workId/authorId/workUrl/title/content/description/publishTime | offset+10 且 page+1；空页/本地上限停止 | RF-Q；RF-S | Q=现有；I=逐条条件；S=现有有界；X=按必需条件预检 | doc（仓库）；ID/类型命名空间保留；原文及正文不足仍拒绝 |
| 汽车之家账号作品 / qichezhijia_work | redfox / — | `4BOZ9DLE` | authorId/page（整数） | workList[]/total；每条作者与请求一致性校验 | 当前无自动后页映射，single-request | RF-Q；RF-S | Q=现有；I=逐条条件；S=现有单页；X=连续分页必需则阻断 | doc（仓库）；不从请求 authorId 补作响应身份 |
| 汽车之家文章详情 / qichezhijia_work | redfox / — | `LLCI8QTE` | workId/page（整数） | workId/authorId/workUrl/title/content | 单次详情；不承诺文章分页全量 | RF-Q；采集详情 step=redfox.platform.detail | Q=现有；I=逐条条件；S=有界补全；X=按业务预检 | doc（仓库）；返回 ID 与请求冲突拒绝 |
| 汽车之家视频详情 / qichezhijia_work | redfox / — | `TE6AGWAF` | videoId/videoType=0或4 | workId/authorId；videoType=4 用 cjhUrl，0 用 ycUrl；说明/时间 | 单对象 | RF-Q；采集详情 step=redfox.platform.detail | Q=现有；I=逐条条件；S=有界补全；X=按业务预检 | doc（仓库）；媒体链接不作原文；类型范围不能丢 |
| 懂车帝搜索 / dongchedi_work | redfox / — | `W86F8SSK` | 单 keyword（禁空格/逗号多词）/offset/sourceType=1或2 | workList[].workId/authorId/workUrl/title/description/publishTime；hasMore 字符串 | offset+20；hasMore="0"、空作品页/上限停止 | RF-Q；RF-S | Q=现有；I=逐条条件；S=现有有界；X=按必需过滤预检 | doc（仓库）；该搜索 publishTime 秒；非任意多词搜索 |
| 懂车帝账号作品 / dongchedi_work+account | redfox / — | `API_1791793668086` | userId | account + workList；本条作者和外层账号上下文分开 | 无分页输入；single-request | RF-Q；RF-S | Q=现有；I=逐条条件；S=现有单页；X=连续分页必需则阻断 | doc（仓库）；外层账号不自动替代本条作者；列表时间按秒 |
| 懂车帝详情 / dongchedi_work | redfox / — | `QQ5E3EZ9` | workId/workType=video或article | workId/authorId/workUrl/title/description/content；保留响应类型 | 单对象 | RF-Q；采集详情 step=redfox.platform.detail | Q=现有；I=逐条条件；S=有界补全；X=类型冲突阻断 | doc（仓库）；返回作品 ID/类型冲突需核对 |
| 懂车帝账号搜索 / dongchedi_account | redfox / — | `X16I71WV` | keyword/offset（非负整数） | userList[].userId；offset/hasMore=0或1 可选 | 查询翻页；未设账号搜索定时入口 | RF-Q | Q=现有；I=—；S=—；X=身份辅助 | doc（仓库）；昵称不作稳定身份 |
| 易车搜索 / yiche_work | redfox / — | `YIGCY5US` | keyword/page（正整数）/sourceType=club,shipin,xinwen | 数组；workId/authorId或authorInfo.userId/workUrl/title/content/publishTime | page+1；空作品页/本地上限停止 | RF-Q；RF-S | Q=现有；I=逐条条件；S=现有有界；X=按必需条件预检 | doc（仓库）；不把类别间相同 ID 混作同作品 |
| 易车账号作品 / yiche_work | redfox / — | `YGYYT0G0` | userId；timestamp 可选，首页不填当前时间 | workList[]；publishTime 毫秒；作者证据逐条保留 | 末条 publishTime 原串→timestamp；缺失/重复停止并核对 | RF-Q；RF-S | Q=现有；I=逐条条件；S=现有有界；X=按必需条件预检 | doc（仓库）；时间游标不是重新生成的当前时间 |
| 易车文章详情 / yiche_work | redfox / — | `VYSP68M2` | 公开 HTTP(S) url，无用户信息 | workId/authorId或authorInfo.userId/workUrl/title/content；inputUrl 另存 | 单对象 | RF-Q；采集详情 step=redfox.platform.detail | Q=现有；I=逐条条件；S=有界补全；X=按业务预检 | doc（仓库）；请求 URL 不自动补作返回原文 |
| 易车视频详情 / yiche_work | redfox / — | `3BXWEB6Y` | workId | 作品/作者/workUrl/description/时间；请求 ID 冲突拒绝 | 单对象 | RF-Q；采集详情 step=redfox.platform.detail | Q=现有；I=逐条条件；S=有界补全；X=按业务预检 | doc（仓库）；媒体资源不能作原文 |
| 易车账号搜索 / yiche_account | redfox / — | `9KFOB9M2` | keyword/page（正整数） | accountList[].userId/displayName；page | 查询页码；未设账号搜索定时入口 | RF-Q | Q=现有；I=—；S=—；X=身份辅助 | doc（仓库）；缺 userId 不绑定 |
| 全网聚合 TOP10 / hotspot_research | redfox / — | `9Y4EX7RW` | startDate/endDate（本地日期时间）；定时冻结上海当日窗口 | keyword/plats/hotSpotList；热点 title/url/index/hotCount 等 | 单次窗口快照，无后页 | RF-Q；RF-S | Q=现有；I=—；S=现有单次快照；X=仅研究配置 | doc（仓库）；搜索目标 URL 不是新闻原文 |
| 全网热搜关键词 / hotspot_research | redfox / — | `W94P1QH1` | keywords；platforms 可选；startDate/endDate 正向≤30天 | ksList/dyList/wbList/bdList/bzList/zhList/ttList；词条/榜单字段 | 单次窗口快照；定时日期由 run 冻结 | RF-Q；RF-S | Q=现有；I=—；S=现有单次快照；X=仅研究配置 | doc（仓库）；榜单时间/排名保留原义，不创建作者 |
| 各平台热点 / hotspot_research | redfox / — | `S28Q6HUD` | platform/startDate/endDate；定时只保存静态 platform | 热点数组；title/url/index/hotId/plat/榜单时间等 | 单次窗口快照 | RF-Q；RF-S | Q=现有；I=—；S=现有单次快照；X=仅研究配置 | doc（仓库）；不把发现/响应时间冒充新闻发生时间 |

## 开放前仍需补齐的证据

1. exact 输入 schema：现有快照只保存部分工具的 selectedInputSchemas。其他行有业务对象而无精确字段/required 的，先补同一工具文档/脱敏样例；不按平台常识自动生成参数。辅助目录候选在此之前维持 needs_review，不能执行。
2. 核心材料：第二阶段重点是 T2/T3/T4/T5/T6/T9 的作品/来源身份、原文和可理解内容；正文待补、时间未知沿既有材料规则处理，只在任务要求全文/精确时间时阻断相应用途。其他平台缺口保留至第三阶段。公众号 article 与 unknown 按已知正文类型处理，不为了可选资料增加付费详情。
3. 持续分页：输入游标存在不足以通过 S/X。优先补小红书会话/末页、微博/X 搜索末页、各目录型列表终止等；Threads 和 IMDb 的已知不可翻页限制不等待试调用推翻。Serper 仅有界快照，不承诺完备结果。
4. 研究：按本矩阵最低用途表补所选工具的精确输入和实际结果；评论定位、关系方向、统计计数、建议词分别核对。排名/热度/发布时间不是所有研究结果的要求；没有这些字段时保留明确采集时间，不能冒充源内容发布时间。单对象不补虚构分页，所有辅助操作也不自动变成新闻采集链。
5. 运行事实另行授权验证：账户可用性/权限、AgentKey→MCP→SDK 大整数与错误保真、真实下一页/内容边界、本次 credits 实扣与延迟。文档缺口优先补官方说明或公开/脱敏样例；不把所有 gap 转化为付费调用要求，也不以本矩阵作真实调用授权。

## 方案文档静态验证

当前修订只做文档静态校验，不运行采集、模型、数据库或集成测试；历史实施验证在下一节单列。核对项：

- 矩阵共 **233** 条业务路线：AgentKey **212** 条、直连 Redfox **21** 条。
- 212 个 AgentKey 精确工具均在 [目录快照](2026-10-21-agentkey-catalog.json) 中存在，工具名唯一，无缺失或重复。
- 21 个直连 Redfox operation ID 均在 [现有 API 清单](../redfox-api-inventory.md) 中存在，且能在 `packages/backend/src/providers/redfox` 的既有 contract/parser/执行代码中定位；无缺失或重复。
- 212 条 AgentKey 行均有且仅有一个 `operation=agentkey.<platform>.<capability>` 与对应的 `<operation>.query` step；没有前缀推导、缺对或重复键。
- 212 条 AgentKey 行现为 **131** 条 `readOnly`、**81** 条 `needs_review`：七平台的只读用途已由各精确工具说明补齐，输出缺口仍单列；其余第三阶段分类未变。没有 `readOnlyPoll` 或 `remoteSubmit` 数据行，也未把候选只读类变成代码执行许可。
- 233 条路线均包含 `Q/I/S/X` 四项用途结论；`doc`、`sample`、`gap` 可在同一行并存，既不是互斥分类，也不是可执行完成率。未因精简无关字段要求而提升恢复分类或运行许可。
- 第二阶段七平台 **65** 条，当前按用途本地验收 **60** 条；五条证据缺口仍在第二阶段未开放，详见主方案§12.16与§14。早期“5条验收、公众号6条实施中”是当时检查点，已由当前60/65状态取代。其他 AgentKey **147** 条归第三阶段；全部精确工具和 operation/step 不变。
- 手工复核固定工具名和分组：营销投放、生成、上传、转写、刷量、互动写入或播放流下载不在所选业务用途；评论读取不误当发表评论。
- 所有行都指向本次方案文档或输出证据中的明确条目；没有把 Threads 单页、IMDb 无 cursor 入参等已知限制写成可翻页，也没有把 Redfox 直连行包装成 AgentKey 工具。

这些静态检查只证明文档工件与目录/源码一致，不证明账户权限、所有真实响应或端到端传输。81条`needs_review`仅为候选分类，输出缺口按受影响用途保留，不把已验收路线中仍缺高级条件等同整条未接通。当前65条的用途验收与59次真实数据请求/57回执报告29.4credits另行记录；两400费用未知，不把本地桩或历史少量样本外推为所有真实用途可用。

## 第一阶段实施后的矩阵与运行时一致性验证（历史记录）

方案获批后，第一阶段只实现了矩阵首行：

- `agentkey.douyin.search` / `agentkey.douyin.search.query`
- 固定工具 `TikHub/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post`

该行已经贯通供应商中立表单/预览、订阅保存、按供应商调度、既有 `operation_runs` / `receipts` / `operation_results` 生命周期、分页和材料导入。Redfox 与 AgentKey 的显式切换也只对这一条有双向合同的路线开放。

实施后的校验仍保持 233 行矩阵不缩减，并确认：

- 212 个 AgentKey 工具与 21 个 Redfox operation ID 继续各自唯一，没有因首行实现而复制生命周期或重复登记同义路线。
- 运行时白名单、恢复分类、供应商选择器、预检和切换资格都只开放上述一行；其余 211 条 AgentKey 路线不会因矩阵存在而被执行。
- 异常分页会先保存已收结果和 received 回执，再进入 `needs_review`；关闭一个供应商不会在调度 SQL 的 `LIMIT` 前阻塞另一供应商。
- AgentKey 缺少稳定作者或作品身份时禁用导入；不会根据昵称、请求参数或手工填写补造身份。
- 当前完成的是隔离数据库、本机桩和一次真实只读首页验证；真实第二页、定时多轮和失败恢复仍由桩覆盖，不额外消耗供应商额度。
