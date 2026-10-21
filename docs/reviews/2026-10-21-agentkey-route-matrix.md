# AgentKey 固定路由与输入输出矩阵（2026-10-21）

> 状态：抖音 V5 搜索首行已通过本地 MCP 桩完成实现与验收；当前运行白名单只包含 `agentkey.douyin.search` / `agentkey.douyin.search.query` 与精确工具 `TikHub/fetch_video_search_v5_api_v1_douyin_search_fetch_video_search_v5_post`。其余 211 条 AgentKey 行继续按证据阻断，21 条 Redfox 行表示既有直连分工。矩阵记录候选和阻断边界，不表示 233 条路线均已真实可用；本轮没有使用真实凭据或发起供应商调用。

## 口径与执行门槛

本矩阵覆盖已确认范围内的平台与资讯/社交业务能力，**不覆盖也不宣称核验了目录的全部 1,442 项**。同义版本不重复建设；未列入本矩阵的目录项均是非执行路线，不能因发现新工具自动开放。蒲公英、腾讯互选及花火、星图、DOU+、TikTok 广告等营销分组、生成/上传/转写/翻译加工、刷量、播放流下载与凭据/签名工具排除。账号/关系/评论/统计/榜单仅是研究结果，不能自动成为新闻。

依据：[完整方案](../agentkey-integration-plan.md)、[输出证据](2026-10-21-agentkey-output-evidence.md)、[方案复审](2026-10-21-agentkey-plan-review.md)、[目录快照](2026-10-21-agentkey-catalog.json)。表内 T1–T22、A1–A3、J1–J6、W1–W2 均指输出证据中同号条目。目录快照的 `selectedInputSchemas` 与 `outputEvidence` 是证据，不能扩充为 schema 注册中心。

- `doc`：已有官方文字/schema（直连表单独标明仓库合同证据）；`sample`：已有官方公开样例的形态；`gap`：所需输入/字段/语义仍无现有证据。可以同一行并列，避免将“输入已知”推广成“输出已闭合”。目录存在只证明规范工具名，未知字段留 gap，不用标准平台 JSON 或其他上游 fixture 补造。
- 表内 `P = E.data`，E 是解开 MCP content 后的 AgentKey envelope；E 的 `provider/category/took_ms/credits_charged/data` 有 doc 证据。TikHub 的 `P.data` 与 JustOneAPI/Serper/Jina 各自层级分别保留；不统一盲拆两层 data。ID 必须无损字符串/原始整数；只得到不安全 JS Number 时拒绝身份绑定和导入。
- `Q`＝手工查询；`I`＝材料导入资格；`S`＝定时采集/研究快照；`X`＝已有订阅/主信源显式切换。`可设计` 只表示对应合同有据，尚未开发或实测；显式标注“本地已实现”的行除外。`条件` 指本行具体约束及共同权限/身份预检；`待补/阻断` 不可宣传为已支持；`—` 不属于该结果用途。详情只作为有界步骤，不单独伪造列表订阅。
- I/X 缺稳定作品身份、稳定来源/作者证据、业务所需正文、可信作品时间或核实的原文 URL 时，阻断受影响操作。作品说明、视频介绍、搜索摘要各自标注；不承诺语音转写/文章全文。研究可按自身最低用途保留结果，但昵称/请求 ID 不充作已收到的作者身份。
- S 的持续分页必须有可回传的位置与可信终止规则；没有则阻断分页采集。单页研究快照是单独明确的用途，允许周期重复单次请求，不能承诺覆盖历史/全部结果；最大页数只限成本，不证明有后页，也不替代末页证据。重复游标/空游标矛盾进入核对，不盲翻页。
- X 只比较当前业务必需身份/过滤/正文/时间/分页覆盖。必需能力缺失拒绝；未使用过滤、单页限制、库名或延迟差异只展示影响。失败保留旧订阅；成功使旧轮失去提交资格。独立平台订阅与 X/公众号主订阅均走显式切换，无自动兜底。

`provider/upstream` 一律按 AIHOT 语义：AgentKey 路线为 `agentkey / TikHub`、`agentkey / JustOneAPI`、`agentkey / Serper` 或 `agentkey / Jina`。后文直连行是 `redfox / —`，不经过 AgentKey，也不调用目录中的 `RedFox/…` 工具。固定工具不自动换商；UI 显示上游，回执保存 E.provider。

## operation、step 与恢复

每个 AgentKey 行精确分配 `operation=agentkey.<platform>.<capability>`、`step=agentkey.<platform>.<capability>.query`；它们是本次设计键，不能重写旧 Redfox 请求身份。每次 run 冻结工具、真实输入和位置，工具写入 model；恢复复用稳定 window/位置/非敏感外发参数。同轮恢复、parser 修复与价格更新不另造外发身份；手工重跑才是新轮。

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
| 普通作品搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_video_search_v5_api_v1_douyin_search_fetch_video_search_v5_post` | 业务必填 keyword；page=1/offset=0；续页回传 search_id/backtrace | P.data.items[].aweme_id/desc/create_time/author.uid/author.sec_uid/share_url | P.data.pagination.offset/search_id/backtrace/has_more/next_page；10条/页，page≤200 | `readOnly`；`agentkey.douyin.search`；`agentkey.douyin.search.query` | Q=已开放；I=已开放但缺稳定作者/作品 ID阻断；S=已开放（有界）；X=已开放（有界） | **本地已实现**；真实供应商响应/分页/实扣待授权验证；无日期/排序/精准匹配保证。desc 仅作品说明，需完整语音正文的任务阻断 |
| 账号作品 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_post_videos_api_v1_douyin_app_v3_fetch_user_post_videos_get` | sec_user_id；max_cursor=0；count≤20；channel=normal | 已确认调用用途；列表完整嵌套/作者/原文输出缺失 | max_cursor 入参已确认；终止字段缺失 | `readOnly`；`agentkey.douyin.account_posts`；`agentkey.douyin.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T2（输入）；gap：作品/作者/URL/正文/时间、末页 |
| 单作品详情 V2 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_one_video_v2_api_v1_douyin_app_v3_fetch_one_video_v2_get` | aweme_id（字段级 schema 未收入快照，需核 exact V2） | P.data.filter_list[0].reason；reason=8 可能多原因 | 单对象；不分页 | `readOnly`；`agentkey.douyin.detail`；`agentkey.douyin.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T2；gap：完整内容/身份/URL/时间；不沿用搜索结构，不将 reason=8 唯一解释为删除 |

### 小红书 Xiaohongshu（T3）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 笔记搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/search_notes_api_v1_xiaohongshu_app_v2_search_notes_get` | keyword；page=1；续传 search_id/search_session_id；ai_mode=0；sort_type/note_type/time_filter 固定 | 已知排序/类型与最近1天/1周/半年；具体笔记/作者/正文/时间路径缺失 | page+首次会话；会话输出层级、末页缺失 | `readOnly`；`agentkey.xiaohongshu.search`；`agentkey.xiaohongshu.search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T3（输入/分页机制）；gap：完整输出及会话层级；data=null 不是字段证据 |
| 账号笔记 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_user_posted_notes_api_v1_xiaohongshu_app_v2_get_user_posted_notes_get` | 业务要求 user_id 或 share_text；cursor 原样回传；schema 未标 required，不能空发 | P.data.data.notes[-1].cursor | 使用返回 cursor；空页/末页语义缺失 | `readOnly`；`agentkey.xiaohongshu.account_posts`；`agentkey.xiaohongshu.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T3；gap：身份/URL/正文/时间/末页；note_id 不充当游标 |
| 图文/视频笔记内容详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_image_note_detail_api_v1_xiaohongshu_app_v2_get_image_note_detail_get` | note_id 或 share_text（业务二选一；schema 允许空不代表可空发） | 可读图文与视频笔记内容、作者、封面；无视频播放地址 | 单对象 | `readOnly`；`agentkey.xiaohongshu.detail`；`agentkey.xiaohongshu.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T3（内容能力）；gap：note/作者稳定 ID、正文、时间具体路径；无需默认追加视频详情 |

### B 站 Bilibili（T4）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 综合搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_search_all_api_v1_bilibili_app_fetch_search_all_get` | keyword；cursor 首次空；order/page_size 固定 | P.data.data.pagination.next；不同类型结果需分支 | next 缺失或空串停止；不能随机 page | `readOnly`；`agentkey.bilibili.search`；`agentkey.bilibili.search.query` | Q=可设计；I=阻断；S=分页可设计，材料阻断；X=阻断 | doc T4；gap：aid/bvid/mid/原文/说明/时间；article 命中不能交视频详情 |
| 账号视频 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_videos_api_v1_bilibili_app_fetch_user_videos_get` | user_id；page=1；ps=20；post_filter=archive | 仅输入 schema；未保存对应输出字段 | page 入参；末页/页语义缺失 | `readOnly`；`agentkey.bilibili.account_posts`；`agentkey.bilibili.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc（目录输入）；gap：列表输出、作者、原文、时间、末页 |
| 视频详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_one_video_api_v1_bilibili_app_fetch_one_video_get` | 业务至少 av_id 或 bv_id；不猜 AV/BV 转换 | 接口存在；完整结果字段未证实 | 单对象 | `readOnly`；`agentkey.bilibili.detail`；`agentkey.bilibili.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T4（用途）；gap：作品/作者/原文/说明/时间 |

### 微博 Weibo（T5）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 综合/实时/用户/视频搜索 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_search_all_api_v1_weibo_app_fetch_search_all_get` | query；page≥1；search_type 固定 | 可选择结果类型；具体 ID/URL/时间层级缺失 | page；搜索末页缺失 | `readOnly`；`agentkey.weibo.search`；`agentkey.weibo.search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T5；gap：输出/末页、Redfox extParam 认证过滤；必需认证过滤的切换拒绝 |
| 用户时间线 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_timeline_api_v1_weibo_app_fetch_user_timeline_get` | uid；page≥1；filter_type/month 固定 | 已保存输入 schema，未保存时间线输出契约 | page；末页缺失 | `readOnly`；`agentkey.weibo.account_posts`；`agentkey.weibo.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc（输入）；gap：本条作者与作品/URL/正文/时间/末页 |
| 状态完整文本 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_status_detail_api_v1_weibo_app_fetch_status_detail_get` | status_id（数字状态 ID；不混 base62 URL ID） | 文档明确返回完整文本 | 单对象 | `readOnly`；`agentkey.weibo.detail`；`agentkey.weibo.detail.query` | Q=可设计；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T5；gap：ID/作者 UID/长文/URL/时间路径；全文能力不等于长文 parser 已验证 |

### X / Twitter（T6）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 关键词时间线 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_search_timeline_api_v1_twitter_web_fetch_search_timeline_get` | keyword；cursor；search_type=Top 等固定 | 描述确认搜索范围可含引用/链接元数据/媒体；样例 data=null | cursor 入参；下一游标/终止路径缺失 | `readOnly`；`agentkey.x.search`；`agentkey.x.search.query` | Q=条件；I=阻断；S=阻断；X=阻断 | doc T6（输入/命中语义）；gap：稳定 ID/作者/角色/原文/长帖与 Article/时间/末页和 from/OR/排回复/日期保证；不能正文词匹配冒充 |
| 用户帖子时间线 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_user_post_tweet_api_v1_twitter_web_fetch_user_post_tweet_get` | 用户标识与游标（精确字段/required 未收入快照） | 仅用途，完整输出未证实 | 游标/结束字段待补 | `readOnly`；`agentkey.x.account_posts`；`agentkey.x.account_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap T6：输入细则、作品/作者/URL/正文/时间/分页 |
| 帖子详情 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_tweet_detail_api_v1_twitter_web_fetch_tweet_detail_get` | tweet_id | 仅详情用途；字段缺失 | 单对象 | `readOnly`；`agentkey.x.detail`；`agentkey.x.detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T6（输入）；gap：rest_id/id_str、角色、正文/Article/URL/时间 |

### 微信公众号 WeChat MP（T7）

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号文章列表 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_account_articles_api_v1_wechat_mp_v2_fetch_account_articles_post` | username；raw=false；offset 首次空；page_size 是请求值，不是有效页大小保证 | P.data.biz_username/articles[].app_msg_id/idx/url/title/digest/create_time/update_time | P.data.next_offset→offset；is_end；末页 next_offset=null；page_size 被忽略 | `readOnly`；`agentkey.wechat_mp.account_articles`；`agentkey.wechat_mp.account_articles.query` | Q=可设计；I=条件（详情补正文/精确时间）；S=可设计；X=条件 | doc T7；列表 digest 非正文；时间单位需详情补；账号+消息+idx/原文身份，不把 app_msg_id 全局化；T+1 无保证 |
| H5 正文与账号映射 / 作品候选→材料 | agentkey / TikHub | `TikHub/fetch_article_detail_h5_api_v1_wechat_mp_v2_fetch_article_detail_h5_post` | url；raw=false | P.data.bizUin；content.user_name/mid/idx/link/content_noencode/content_text/_content_type；create_timestamp/ori_create_time 整数秒 | 单文章；不分页 | `readOnly`；`agentkey.wechat_mp.detail`；`agentkey.wechat_mp.detail.query` | Q=可设计；I=条件；S=可设计为有界补全；X=条件 | doc T7；article HTML/文字可用；unknown 只是摘要；保留 immersive/video 类型；不以昵称推 biz，不默认购买头像 |
| 账号资料 / 账号研究 | agentkey / TikHub | `TikHub/fetch_account_profile_api_v1_wechat_mp_v2_fetch_account_profile_post` | 公众号账号（精确字段 schema 未保存）；raw=false | signature/head_url 恒 null；unavailable[]；账号映射用同篇 H5 证据 | 单账号 | `readOnly`；`agentkey.wechat_mp.account_profile`；`agentkey.wechat_mp.account_profile.query` | Q=条件；I=—；S=待补快照输入；X=仅映射辅助 | doc T7；gap：精确输入及 custom username 长期稳定性；可选头像不阻断正文 |

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
| 文章详情候选 / 作品候选→材料 | agentkey / TikHub | `TikHub/get_article_info_api_v1_toutiao_app_get_article_info_get` | group_id | 用途/输入已确认；完整字段未证实 | 单对象 | `readOnly`；`agentkey.toutiao.article_detail`；`agentkey.toutiao.article_detail.query` | Q=条件；I=阻断；S=仅补全步骤，阻断；X=阻断 | doc T9；gap：作者/正文/URL/时间；不能从 group_id 入参推导返回身份 |
| 用户资料候选 / 账号研究 | agentkey / TikHub | `TikHub/get_user_info_api_v1_toutiao_app_get_user_info_get` | 用户标识（精确字段/required 待补） | 完整输出未证实 | 单对象 | `readOnly`；`agentkey.toutiao.account_profile`；`agentkey.toutiao.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap T9：完整输入/作者字段 |
| 作品评论候选 / 评论研究 | agentkey / TikHub | `TikHub/get_comments_api_v1_toutiao_app_get_comments_get` | 作品标识和页参数（精确字段/required 待补） | 完整输出未证实 | 游标/末页缺失 | `readOnly`；`agentkey.toutiao.comments`；`agentkey.toutiao.comments.query` | Q=待补；I=—；S=阻断；X=— | gap T9：评论身份/内容/时间/分页 |

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
| 作品评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_video_comments_api_v1_douyin_app_v3_fetch_video_comments_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.douyin.comments`；`agentkey.douyin.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 评论回复 / 评论研究 | agentkey / TikHub | `TikHub/fetch_video_comments_reply_api_v1_douyin_app_v3_fetch_video_comment_replies_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.douyin.comment_replies`；`agentkey.douyin.comment_replies.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：xiaohongshu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 笔记评论 / 评论研究 | agentkey / TikHub | `TikHub/get_note_comments_api_v1_xiaohongshu_app_v2_get_note_comments_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.xiaohongshu.comments`；`agentkey.xiaohongshu.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 笔记二级评论 / 评论研究 | agentkey / TikHub | `TikHub/get_note_sub_comments_api_v1_xiaohongshu_app_v2_get_note_sub_comments_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.xiaohongshu.comment_replies`；`agentkey.xiaohongshu.comment_replies.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：bilibili

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 视频评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_video_comments_api_v1_bilibili_app_fetch_video_comments_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.bilibili.comments`；`agentkey.bilibili.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 评论回复 / 评论研究 | agentkey / TikHub | `TikHub/fetch_reply_detail_api_v1_bilibili_app_fetch_reply_detail_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.bilibili.comment_replies`；`agentkey.bilibili.comment_replies.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：x

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_post_comments_api_v1_twitter_web_fetch_post_comments_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.x.comments`；`agentkey.x.comments.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

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
| 状态评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_status_comments_api_v1_weibo_app_fetch_status_comments_get` | 状态对象/分页（精确 required 未保存） | P.data.moreInfo.params.max_id | max_id 为空或相同停止 | `readOnly`；`agentkey.weibo.comments`；`agentkey.weibo.comments.query` | Q=条件；I=—；S=字段补齐后有界研究；X=— | doc T5（游标）；gap：评论 ID/父评论/内容/作者/时间及输入细则 |

### 辅助能力：threads

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 帖子评论快照 / 评论研究 | agentkey / TikHub | `TikHub/fetch_post_comments_api_v1_threads_web_fetch_post_comments_get` | 帖子标识；精确 required 待补；不启用 end_cursor | next_cursor 恒 null；不支持评论分页 | 仅单页 | `readOnly`；`agentkey.threads.comments`；`agentkey.threads.comments.query` | Q=条件；I=—；S=仅单页快照；X=— | doc T19；gap：评论/父评论 ID、内容/时间 |

### 辅助能力：wechat_mp

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 文章评论 / 评论研究 | agentkey / TikHub | `TikHub/fetch_article_comments_api_v1_wechat_mp_v2_fetch_article_comments_post` | 文章评论域；raw=false（精确 required 未保存） | P.data.comments[].content_id/content/nick_name/create_time | buffer/has_more | `readOnly`；`agentkey.wechat_mp.comments`；`agentkey.wechat_mp.comments.query` | Q=条件；I=—；S=有界快照，输入/时间待补；X=— | doc A1；gap：时间单位/非公开范围/精确输入；文章 comment_id 不当 content_id |
| 评论二级回复 / 评论研究 | agentkey / TikHub | `TikHub/fetch_comment_replies_api_v1_wechat_mp_v2_fetch_comment_replies_post` | 评论 content_id 等；raw=false（精确 required 未保存） | replies[].reply_id/content/from_ai | next_offset/has_more | `readOnly`；`agentkey.wechat_mp.comment_replies`；`agentkey.wechat_mp.comment_replies.query` | Q=条件；I=—；S=有界快照，输入待补；X=— | doc A1；gap：完整输入/父评论关系及时间 |

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
| 账号搜索 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_search_api_v1_douyin_search_fetch_user_search_post` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.douyin.account_search`；`agentkey.douyin.account_search.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/handler_user_profile_api_v1_douyin_app_v3_handler_user_profile_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.douyin.account_profile`；`agentkey.douyin.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 公开粉丝 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_fans_list_api_v1_douyin_app_v3_fetch_user_fans_list_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.douyin.followers`；`agentkey.douyin.followers.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 公开关注 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_following_list_api_v1_douyin_web_fetch_user_following_list_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.douyin.following`；`agentkey.douyin.following.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：xiaohongshu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号搜索 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/search_users_api_v1_xiaohongshu_app_v2_search_users_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.xiaohongshu.account_search`；`agentkey.xiaohongshu.account_search.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/get_user_info_api_v1_xiaohongshu_app_v2_get_user_info_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.xiaohongshu.account_profile`；`agentkey.xiaohongshu.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：bilibili

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_info_api_v1_bilibili_app_fetch_user_info_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.bilibili.account_profile`；`agentkey.bilibili.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 关注/粉丝统计 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_relation_stat_api_v1_bilibili_web_fetch_user_relation_stat_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.bilibili.relation_stats`；`agentkey.bilibili.relation_stats.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：weibo

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_info_api_v1_weibo_app_fetch_user_info_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.weibo.account_profile`；`agentkey.weibo.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 粉丝列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_followers_api_v1_weibo_app_fetch_user_followers_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.weibo.followers`；`agentkey.weibo.followers.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 关注列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_following_api_v1_weibo_app_fetch_user_following_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.weibo.following`；`agentkey.weibo.following.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

### 辅助能力：x

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号资料 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_profile_api_v1_twitter_web_fetch_user_profile_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.x.account_profile`；`agentkey.x.account_profile.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 粉丝列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_followers_api_v1_twitter_web_fetch_user_followers_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.x.followers`；`agentkey.x.followers.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |
| 关注列表 / 账号/公开关系研究 | agentkey / TikHub | `TikHub/fetch_user_followings_api_v1_twitter_web_fetch_user_followings_get` | 查询对象与分页条件（精确字段/required 未收入证据） | 仅目录用途；无字段级输出证据 | 游标/末页未证实 | `needs_review`；`agentkey.x.following`；`agentkey.x.following.query` | Q=待补；I=—；S=阻断；X=— | gap A1/A2/A3：输入/输出/分页未审 |

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
| 话题作品 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_hashtag_video_list_api_v1_douyin_app_v3_fetch_hashtag_video_list_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.douyin.topic_posts`；`agentkey.douyin.topic_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：xiaohongshu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 话题笔记 / 内容候选/研究 | agentkey / TikHub | `TikHub/get_topic_feed_api_v1_xiaohongshu_app_v2_get_topic_feed_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.xiaohongshu.topic_posts`；`agentkey.xiaohongshu.topic_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：bilibili

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 账号动态 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_collect_folders_api_v1_bilibili_web_fetch_user_dynamic_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.bilibili.dynamics`；`agentkey.bilibili.dynamics.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

### 辅助能力：x

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 列表时间线 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_list_timeline_api_v1_twitter_web_fetch_list_timeline_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.x.list_posts`；`agentkey.x.list_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |
| 社区时间线 / 内容候选/研究 | agentkey / TikHub | `TikHub/fetch_community_timeline_api_v1_twitter_web_fetch_community_timeline_get` | 对象与分页条件（精确字段/required 未保存） | 仅目录用途；作品/作者/正文/URL/时间未证实 | 末页未证实 | `needs_review`；`agentkey.x.community_posts`；`agentkey.x.community_posts.query` | Q=条件；I=阻断；S=阻断；X=阻断 | gap：不借同平台其他工具的输出合同 |

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
| 热搜快照 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_hot_search_list_api_v1_douyin_app_v3_fetch_hot_search_list_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.douyin.trending`；`agentkey.douyin.trending.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |
| 搜索联想 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_search_suggest_api_v1_douyin_search_fetch_search_suggest_post` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.douyin.suggest`；`agentkey.douyin.suggest.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：xiaohongshu

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 搜索联想 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_search_suggest_api_v1_xiaohongshu_web_v3_fetch_search_suggest_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.xiaohongshu.suggest`；`agentkey.xiaohongshu.suggest.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |
| 首页推荐 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_homefeed_api_v1_xiaohongshu_web_v3_fetch_homefeed_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.xiaohongshu.recommendations`；`agentkey.xiaohongshu.recommendations.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：bilibili

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 热门视频快照 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_popular_feed_api_v1_bilibili_app_fetch_popular_feed_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.bilibili.trending`；`agentkey.bilibili.trending.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |
| 热搜词 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_hot_search_api_v1_bilibili_web_fetch_hot_search_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.bilibili.hot_search`；`agentkey.bilibili.hot_search.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：weibo

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 热搜快照 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_hot_search_api_v1_weibo_app_fetch_hot_search_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.weibo.trending`；`agentkey.weibo.trending.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |
| 相关搜索 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_similar_search_api_v1_weibo_web_v2_fetch_similar_search_get` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.weibo.related_search`；`agentkey.weibo.related_search.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

### 辅助能力：wechat_mp

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 相关文章 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_related_articles_api_v1_wechat_mp_v2_fetch_related_articles_post` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.wechat_mp.related_articles`；`agentkey.wechat_mp.related_articles.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |
| 文章互动统计 / 趋势/推荐研究 | agentkey / TikHub | `TikHub/fetch_article_stats_h5_api_v1_wechat_mp_v2_fetch_article_stats_h5_post` | 查询地区/对象/时间条件（精确字段/required 未保存） | 仅目录用途；词条/排名/热度/榜单时间未证实 | 优先单次快照；若列表分页仍缺末页 | `needs_review`；`agentkey.wechat_mp.article_stats`；`agentkey.wechat_mp.article_stats.query` | Q=待补；I=—；S=阻断；X=— | gap A3：完整输入与研究字段；无作品 URL 不导入 |

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
| 国家趋势快照 / 趋势研究 | agentkey / TikHub | `TikHub/fetch_trending_api_v1_twitter_web_fetch_trending_get` | country（精确 required 未保存） | 文档仅写“趋势” | 单次快照；无全量保证 | `readOnly`；`agentkey.x.trending`；`agentkey.x.trending.query` | Q=条件；I=—；S=研究字段补齐前阻断；X=— | doc A3（国家查询）；gap：词条/排名/热度/榜单时间 |

## 独有用途与无路线边界

下表补充不能混同于普通帖子关键词搜索或账号作品的用途。其余同义版本、批量包装和纯 ID/URL 转换不另设业务入口；已选详情可提供身份链时，先复用该证据。现有证据仍不足的独有用途维持候选，不能伪装为已接通。

| 业务能力 / AIHOT结果 | provider/upstream | 精确工具 | 必需输入 / 固定条件 | 已证实输出 | 分页 / 末页 | recovery；operation；step | 查询 / 导入 / 定时 / 切换 | 证据状态与阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 用户/话题/地点综合搜索 / 研究候选 | agentkey / TikHub | `TikHub/general_search_api_v1_instagram_v3_general_search_get` | 查询对象（精确字段/required 未保存） | 仅用途/目录证据；完整输出未证实 | 末页未证实；明确不分页时仅单次快照 | `needs_review`；`agentkey.instagram.search`；`agentkey.instagram.search.query` | Q=待补；I=—；S=阻断；X=— | gap：T12 明确综合搜索主要是用户/话题/地点，不能等同帖子关键词搜索 |
| 视频号全站视频搜索 / 研究候选 | agentkey / TikHub | `TikHub/fetch_search_videos_api_v1_wechat_search_v2_fetch_search_videos_post` | 查询对象（精确字段/required 未保存） | 仅用途/目录证据；完整输出未证实 | 末页未证实；明确不分页时仅单次快照 | `needs_review`；`agentkey.wechat_search.video_search`；`agentkey.wechat_search.video_search.query` | Q=待补；I=—；S=阻断；X=— | gap：目录独有搜索路线；不能套综合搜索 T8 输出 |
| video/article/user 分类型搜索 / 研究候选 | agentkey / TikHub | `TikHub/fetch_search_by_type_api_v1_bilibili_app_fetch_search_by_type_get` | 查询对象（精确字段/required 未保存） | 仅用途/目录证据；完整输出未证实 | 末页未证实；明确不分页时仅单次快照 | `needs_review`；`agentkey.bilibili.typed_search`；`agentkey.bilibili.typed_search.query` | Q=待补；I=—；S=阻断；X=— | gap：T4 明确类型用途；article 不能由视频详情补正文 |
| 视频详情查询 / 研究候选 | agentkey / TikHub | `TikHub/get_video_info_api_v1_toutiao_app_get_video_info_get` | 查询对象（精确字段/required 未保存） | 仅用途/目录证据；完整输出未证实 | 末页未证实；明确不分页时仅单次快照 | `needs_review`；`agentkey.toutiao.video_detail`；`agentkey.toutiao.video_detail.query` | Q=待补；I=—；S=阻断；X=— | gap：目录用途；与文章详情不同，不能默认解析为文章 |
| 公开列表成员 / 研究候选 | agentkey / TikHub | `TikHub/fetch_list_members_api_v1_twitter_web_fetch_list_members_get` | 查询对象（精确字段/required 未保存） | 仅用途/目录证据；完整输出未证实 | 末页未证实；明确不分页时仅单次快照 | `needs_review`；`agentkey.x.list_members`；`agentkey.x.list_members.query` | Q=待补；I=—；S=阻断；X=— | gap：与关注者不同角色；不授予来源权限 |
| 公开社区成员快照 / 研究候选 | agentkey / TikHub | `TikHub/fetch_community_members_api_v1_twitter_web_fetch_community_members_get` | 查询对象（精确字段/required 未保存） | 仅用途/目录证据；完整输出未证实 | 末页未证实；明确不分页时仅单次快照 | `needs_review`；`agentkey.x.community_members`；`agentkey.x.community_members.query` | Q=待补；I=—；S=阻断；X=— | gap：目录明确 no pagination；只单次成员快照 |
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
2. 核心材料：T2/T3/T4/T5/T6/T9/T11/T13/T15/T16/T20/T21/T22 的身份/内容/URL/时间缺口；T8 文章分支、T10 时间单位及原文、T12 稳定作者、T14 精确时间、T17 具体内容键、T18 稳定频道、T19 详情身份仍按行阻断 I/X。公众号 article 与 unknown、Facebook 截断/时区、IMDb 外链原站等按现有证据分别处理。
3. 持续分页：输入游标存在不足以通过 S/X。优先补小红书会话/末页、微博/X 搜索末页、各目录型列表终止等；Threads 和 IMDb 的已知不可翻页限制不等待试调用推翻。Serper 仅有界快照，不承诺完备结果。
4. 研究：评论/父评论、公开关系 ID 与可见范围、榜单词条/排名/热度/榜单时间需要所选工具自己的证据，不从作品详情外推。没有时间字段的研究结果可以保存明确抓取窗口，但不能声称那就是评论/榜单发布时间。
5. 运行事实另行授权验证：账户可用性/权限、AgentKey→MCP→SDK 大整数与错误保真、真实下一页/内容边界、本次 credits 实扣与延迟。文档缺口优先补官方说明或公开/脱敏样例；不把所有 gap 转化为付费调用要求，也不以本矩阵作真实调用授权。

## 方案阶段静态验证

本轮只做文档静态校验，不运行采集、模型、数据库或集成测试。执行的检查与结果：

- 矩阵共 **233** 条业务路线：AgentKey **212** 条、直连 Redfox **21** 条。
- 212 个 AgentKey 精确工具均在 [目录快照](2026-10-21-agentkey-catalog.json) 中存在，工具名唯一，无缺失或重复。
- 21 个直连 Redfox operation ID 均在 [现有 API 清单](../redfox-api-inventory.md) 中存在，且能在 `packages/backend/src/providers/redfox` 的既有 contract/parser/执行代码中定位；无缺失或重复。
- 212 条 AgentKey 行均有且仅有一个 `operation=agentkey.<platform>.<capability>` 与对应的 `<operation>.query` step；没有前缀推导、缺对或重复键。
- 212 条 AgentKey 行为 **91** 条 `readOnly`、**121** 条 `needs_review`；矩阵数据行中没有 `readOnlyPoll` 或 `remoteSubmit` 实例。后两类仅在恢复规则说明中出现，不会被当成可执行路线。
- 233 条路线均包含 `Q/I/S/X` 四项用途结论。201 条证据状态含 `gap`，其中 197 条在 `I/S/X` 中直接写明阻断或待补；其余 4 条把缺口限定在当前可选字段/具体任务条件，并按行写明相应拒绝条件，未提升为已支持。
- `doc`、`sample`、`gap` 是同一行可并存的证据标记，不是互斥分类或完成率。当前分别出现 **78 / 23 / 201** 次，不能相加当作路线总数，也不能用出现 `doc` 推导输出已经完整闭合。
- 手工复核固定工具名和分组：未选择营销投放、生成、上传、转写、刷量、互动写入或播放流下载路线；唯一命中“评论”关键词的 `FacebookGetPostCommentsV1` 是只读评论研究，不是写评论。
- 所有行都指向本次方案文档或输出证据中的明确条目；没有把 Threads 单页、IMDb 无 cursor 入参等已知限制写成可翻页，也没有把 Redfox 直连行包装成 AgentKey 工具。

这些检查只证明文档工件与现有目录/源码一致，不证明 AgentKey 账户权限、真实响应、计费或端到端传输；也不代表 121 条 `needs_review` 候选已经接通。

## 实施后的矩阵与运行时一致性验证

方案获批后，第一阶段只实现了矩阵首行：

- `agentkey.douyin.search` / `agentkey.douyin.search.query`
- 固定工具 `TikHub/fetch_video_search_v5_api_v1_douyin_search_fetch_video_search_v5_post`

该行已经贯通供应商中立表单/预览、订阅保存、按供应商调度、既有 `operation_runs` / `receipts` / `operation_results` 生命周期、分页和材料导入。Redfox 与 AgentKey 的显式切换也只对这一条有双向合同的路线开放。

实施后的校验仍保持 233 行矩阵不缩减，并确认：

- 212 个 AgentKey 工具与 21 个 Redfox operation ID 继续各自唯一，没有因首行实现而复制生命周期或重复登记同义路线。
- 运行时白名单、恢复分类、供应商选择器、预检和切换资格都只开放上述一行；其余 211 条 AgentKey 路线不会因矩阵存在而被执行。
- 异常分页会先保存已收结果和 received 回执，再进入 `needs_review`；关闭一个供应商不会在调度 SQL 的 `LIMIT` 前阻塞另一供应商。
- AgentKey 缺少稳定作者或作品身份时禁用导入；不会根据昵称、请求参数或手工填写补造身份。
- 当前完成的是隔离数据库和本机桩验收，不包含真实 AgentKey/TikHub 权限、响应、分页或实扣验证。
