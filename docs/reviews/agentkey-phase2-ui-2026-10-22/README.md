# AgentKey 第二阶段分批 UI 验收（2026-10-22）

本索引覆盖截至2026-10-23的255处UI证据（510PNG；每处均有原图与批注图，最终批注图经Lead逐张回看，154/155最终全幅替换及Lead视觉验收已完成），其中01–07为首批 **V4保持兼容+账号作品+作品详情V2**；各批按当时范围记录，不代表七平台65路线全部完成。所有截图来自实际运行的本地应用；蓝色边框/编号及左侧或下方说明是验收时临时叠加的批注，不是产品 UI。每张同名 `-raw.png` 为未批注原图。最终批注图经Lead逐张回看，原图用于配对留证，原有样式与页面结构沿用。

环境：Web `127.0.0.1:3310`、API `127.0.0.1:3311`、假 MCP `127.0.0.1:3312`，专用库 `aihot_agentkey_phase2_ui_test`（PostgreSQL 65433）。从空库应用现有 75 份迁移；没有新增迁移、表或状态。凭据为临时假值，没有读取本机真实密钥或生产数据；模型、Redfox 和消息推送关闭。AgentKey 指定本地桩，不会转到公网。

| 截图 | 核对点 |
| --- | --- |
| [01 账号作品查询](01-account-query.png) / [原图](01-account-query-raw.png) | 供应商是 AgentKey · TikHub；字段为 sec_user_id、每页条数、排序；名称、用途和 credits 估价对应当前路线 |
| [02 新建采集订阅](02-new-subscription.png) / [原图](02-new-subscription-raw.png) | 查询条件与供应商带入草稿，默认停用；显式开启详情、选择 V2、设置每轮 1 次详情上限 |
| [03 完成任务详情](03-task-detail.png) / [原图](03-task-detail-raw.png) | 账号列表和详情共用任务，固定工具显示当前最后步骤；有回执、结果、材料和原订阅返回链接 |
| [04 采集订阅列表](04-subscription-list.png) / [原图](04-subscription-list-raw.png) | 供应商、操作名称、详情目标和估价按该行实际 provider 显示；本轮完成后无在途占用 |
| [05 供应商切换预检](05-switch-blocked.png) / [原图](05-switch-blocked-raw.png) | 免费本地预检展示实际参数/详情不兼容原因，切换按钮禁用；未修改供应商或请求上游。本例 count=1 及详情要求均未证明可迁移，不能把它当无详情兼容任务 |
| [06 独立详情查询](06-detail-query.png) / [原图](06-detail-query-raw.png) | 显式选择 AgentKey 后填写原生 aweme_id；无独立定时订阅，不获取播放流或转写 |
| [07 统一任务列表](07-operation-list.png) / [原图](07-operation-list-raw.png) | 账号采集与独立详情查询沿用共同任务列表，显示实际供应商和不同操作名称 |

实际操作：浏览器从账号查询带入草稿，保存为停用订阅 #1，随后仅在假 MCP 环境显式启用并运行。用现有执行器逐步消费任务 #1，列表及详情同轮完成；另从详情表单创建并消费查询 #2。没有用静态 Mock 页面替代真实 API/数据库流程，执行器由验收脚本触发，不宣称已有完整常驻 Worker 调度验收。

SQL 复核：两个 run 均 completed；订阅 active_run_id=NULL；累计页数 1、条目 1、详情 1；共 3 份 completed 桩回执；新作者 isolated，site_fulltext=false、syndicate_fulltext=false。缺省预算为 0 时任务确实等待且未创建外发回执；仅提高专用桩预算后按原任务恢复。完成后停用该测试订阅、关闭专用浏览器空间和临时 API/Web/MCP。

复审修复一个 P3：候选操作标签曾误用当前操作的供应商，点击后可能回到另一操作自己的默认供应商。现按每项自身状态显示，既有渲染测试增加异供应商断言；浏览器确认账号选择 AgentKey 时，未访问的详情仍显示 Redfox 标签，选中后也是 Redfox，只有显式选择 AgentKey 才显示 V2/aweme_id。

这些是本地桩验收事实。用户另行获准的两次真实响应只证明对应账号首页和一条详情的本次结构及合计 0.4 credits，不能用这些截图声称真实定时采集、后页或全部七平台已通过。

## 追加账号搜索与搜索建议验收

新增两条共用原查询任务和本地绑定入口；两者不提供独立采集订阅。与前面的作品采集分批验收，该批验收时代码接通数量为 5/65，不能写成抖音全部 12 条完成。

| 截图 | 核对点 |
| --- | --- |
| [08 账号搜索表单](08-account-search-query.png) / [原图](08-account-search-query-raw.png) | P5CHB3BZ 业务入口显式选择 AgentKey；仅关键词/无筛选首页，未知筛选和续页没有控件 |
| [09 建议词表单](09-suggest-query.png) / [原图](09-suggest-query-raw.png) | 中立业务 ID douyin.suggest；仅已接通的 AgentKey，不输入即调用或带入定时订阅 |
| [10 账号搜索结果](10-account-search-result.png) / [原图](10-account-search-result-raw.png) | 单次查询摘要与采集页区分，实收稳定 ID、昵称与粉丝数；0 正常展示，绑定须显式操作 |
| [11 显式绑定确认](11-account-binding-dialog.png) / [原图](11-account-binding-dialog-raw.png) | 沿用原确认/原因/审计；按实收稳定身份复用或新建隔离信源，不生成文章或提升权限 |
| [12 建议词结果](12-suggest-result.png) / [原图](12-suggest-result-raw.png) | 保存研究词条和摘要，无导入/绑定动作，不自动触发作品搜索 |
| [13 新增操作在共同任务列表](13-research-operation-list.png) / [原图](13-research-operation-list-raw.png) | 账号搜索、建议词各自显示实际供应商和操作名称 |

沿用同一专用 _test 库和假 MCP。浏览器创建并由原执行器逐步完成任务 #3/#4：均 completed、subscription_id=NULL；账号结果仅在显式确认后关联已有隔离作者。数据库文章数仍为此前的 1，未增加材料；source 仍 isolated、两项全文许可 false。建议词无 source/article 关联。全部真实付费授权仍单独核算：此追加批次另获准各一次，合计 0.4 credits；与此前两次相加本阶段共四次、0.8 credits，没有其他真实调用。

本批修复一处展示错误：共同消费器曾给单次账号/建议词查询填入采集专用 returnedPage/selectedCount 等字段。现仅 collection 模式保存这些事实；UI 对历史 single-request 摘要也走查询展示，不再标“采集页/作品候选”。定向后端验证 76/76、Web 320/320 均单轮通过，类型检查通过；独立复核无剩余发现。截图中的 #3/#4 为修复前已保存的旧摘要，展示已验证历史兼容路径；后端测试另验证新摘要不含四个采集字段。


## 公众号六条与主信源流程验收

复用同一 UI 测试库；下列18处为新增公众号表单、结果及供应商接线，全部来自真实本地应用/假MCP。没有真实公众号请求。

| 截图 | 核对点 |
| --- | --- |
| [14 文章列表](14-mp-article-list-query.png) / [原图](14-mp-article-list-query-raw.png) | AgentKey · TikHub、username与原样 offset，列表仅摘要，不显示虚假的 page_size 控件 |
| [15 H5详情](15-mp-h5-query.png) / [原图](15-mp-h5-query-raw.png) | 仅原文 URL、2 credits 单次估算 |
| [16 账号资料](16-mp-profile-query.png) / [原图](16-mp-profile-query-raw.png) | username，头像/简介不可用，不自动补购 |
| [17 评论](17-mp-comments-query.png) / [原图](17-mp-comments-query-raw.png) | URL、可选评论捷径、buffer，明确仅研究 |
| [18 回复](18-mp-replies-query.png) / [原图](18-mp-replies-query-raw.png) | 显式父评论 content_id；不隐式选择第一条 |
| [19 评论统计](19-mp-stats-query.png) / [原图](19-mp-stats-query-raw.png) | 只支持两项评论计数，不提供其他互动指标 |
| [20 列表结果](20-mp-list-result.png) / [原图](20-mp-list-result-raw.png) | 摘要、未核时间和缺正文有明确说明，导入沿原入口 |
| [21 H5结果](21-mp-detail-result.png) / [原图](21-mp-detail-result-raw.png) | 正文纯文本，已换算时间明确标 UTC，保留权限 |
| [22 账号结果](22-mp-profile-result.png) / [原图](22-mp-profile-result-raw.png) | ghid稳定身份与已绑定信源；缺头像/简介不编造 |
| [23 评论结果](23-mp-comment-result.png) / [原图](23-mp-comment-result-raw.png) | 评论角色与定位，无导入/绑定 |
| [24 回复结果](24-mp-reply-result.png) / [原图](24-mp-reply-result-raw.png) | 指定父评论，研究文本不成为文章 |
| [25 统计结果](25-mp-stats-result.png) / [原图](25-mp-stats-result-raw.png) | 实收0正确显示，不提供的阅读/点赞等不填0 |
| [26 绑定确认](26-mp-account-binding.png) / [原图](26-mp-account-binding-raw.png) | 已有公众号信源、ghid核实与审计；不自动切换 |
| [27 切换预检](27-mp-source-preflight.png) / [原图](27-mp-source-preflight-raw.png) | 三供应商各自检查；Redfox库只适用于Redfox，AgentKey按钮正常启用 |
| [28 切换影响](28-mp-switch-impact.png) / [原图](28-mp-switch-impact-raw.png) | 固定TikHub，2 credits/次、正常整轮最多18；首次8条回填及原周期 |
| [29 切换完成](29-mp-source-agentkey.png) / [原图](29-mp-source-agentkey-raw.png) | 同一主订阅2与信源，当前provider=agentkey，权限不变 |
| [30 主采集完成](30-mp-main-collection-result.png) / [原图](30-mp-main-collection-result-raw.png) | 一任务完成列表和H5、原回执及材料关联保留 |
| [31 共同任务列表](31-mp-operation-list.png) / [原图](31-mp-operation-list-raw.png) | 六Q和主采集均completed，实际供应商和操作名可见 |

浏览器创建 Q #5–#10，原执行器消费并保存每条摘要与结果；账号 #7 显式绑定到新建隔离信源 phase2-mp-ui。预检与切换不调用供应商；UI实走发现 library:null 的无库目标请求会被拒绝，已修为仅Redfox目标提交library，再次预检确认后切换成功，未重复直接提交失效预检。主采集 #11 关联原订阅2，同轮列表+H5完成；新增1篇 body_status=ok、first-import回填文章，研究三任务材料/信源关联0；周期30分钟、isolated、两项全文权限false。完成后停用本测试信源和订阅。

上述8次 MP请求全部是本地假MCP（不是实扣或真实联调证据），没有将直接执行器验收说成常驻Worker端到端；后端集成另覆盖真实调度入口。公众号后端105/105为先前组合，最终保留链/P3修复14/14，Web截至此批321/321及构建通过；不同范围不相加。抖音剩余7条真实补证另用已授权额度：实际7次／六成功上报1.2credits，与本地截图无关。


## 抖音五条单页快照与受限资料验收

| 截图 | 核对点 |
| --- | --- |
| [32 热榜查询](32-dy-hotspot-query.png) / [原图](32-dy-hotspot-query-raw.png) | 默认榜单、AgentKey · TikHub，其他榜未开放 |
| [33 评论查询](33-dy-comment-query.png) / [原图](33-dy-comment-query-raw.png) | 冻结首页20条；输入作品ID，单页研究 |
| [34 回复查询](34-dy-reply-query.png) / [原图](34-dy-reply-query-raw.png) | 显式作品和父评论ID，不隐式选第一条 |
| [35 话题作品查询](35-dy-topic-query.png) / [原图](35-dy-topic-query-raw.png) | cursor0/count10/已知排序；无下载或续页 |
| [36 关注查询](36-dy-following-query.png) / [原图](36-dy-following-query-raw.png) | source_type2/max_time0/count20，空引导页非无关注 |
| [37 注销态资料查询](37-dy-deleted-profile-query.png) / [原图](37-dy-deleted-profile-query-raw.png) | 标明正常资料仍缺证，不宣称完整账号资料能力 |
| [38 热点结果](38-dy-hotspot-result.png) / [原图](38-dy-hotspot-result-raw.png) | 实收热度0显示，不编造排名或导入新闻 |
| [39 评论结果](39-dy-comment-result.png) / [原图](39-dy-comment-result-raw.png) | 评论者独立、文本白名单、原始时间未知单位，仅研究 |
| [40 回复结果](40-dy-reply-result.png) / [原图](40-dy-reply-result-raw.png) | 父作品/评论匹配；无绑定或文章导入 |
| [41 话题作品结果](41-dy-topic-result.png) / [原图](41-dy-topic-result-raw.png) | 混合列表作品可走原显式导入；未知时间/权限边界可见 |
| [42 关注结果](42-dy-following-result.png) / [原图](42-dy-following-result-raw.png) | 返回19条，仅截首项；不绑定成员、不发第二页 |
| [43 注销状态](43-dy-deleted-profile-result.png) / [原图](43-dy-deleted-profile-result-raw.png) | 状态专属说明；无导入/绑定/订阅 |
| [44 新建单页订阅](44-dy-snapshot-subscription.png) / [原图](44-dy-snapshot-subscription-raw.png) | 从查询带入provider/参数；默认停用，仅可设items，pages1/details0固定 |
| [45 快照整轮完成](45-dy-snapshot-completed.png) / [原图](45-dy-snapshot-completed-raw.png) | 实收19、选3、余16，nextParameters=null、single-request；可返回原订阅 |
| [46 原订阅列表](46-dy-snapshot-list.png) / [原图](46-dy-snapshot-list-raw.png) | AgentKey · TikHub、占用已释放；保存上限3、15分钟周期，截图后已停用 |
| [47 共同任务列表](47-dy-snapshot-operation-list.png) / [原图](47-dy-snapshot-operation-list-raw.png) | 新增查询和采集共享列表，操作名及实际供应商可见 |

浏览器实际创建Q #12–#17，全部completed；关注Q带入新草稿#3，截图44保留默认停用，再只在假MCP环境显式启用并通过原“运行一轮”创建#18。原执行器仅发1次假following，completed并释放占用、安排原15分钟下一轮；实收19/选3/未处理16/nextParameters=null。研究任务无source/article关联，文章总数仍2、信源仍2。最终全部3个测试订阅enabled=false、active_run_id=NULL、next_run_at=NULL。此流程不冒充常驻Worker端到端或真实定时采集验证。

32–47每处均有原图与批注图，最终批注图已回看；此前01–31证据仍保留。最新Web322/322、类型检查及构建通过；后端新parser6/6、集成5/5，组合101/102后修正原kind错误文本顺序，相关32/32通过。独立backend/UI接线复核无剩余P1/P2/P3。抖音粉丝、正常账号资料、其他榜与连续分页仍受限，该批当时17/65接通，不能表述全阶段完成；当前状态见下方新增批次。截图只含合成内容，所有估价/桩扣费均不是实测账单。

## 今日头条三条本地验收（48–59）

对应主方案§12.12。后端33/33+元数据1/1，Root最后profile8/8；Web当时323/323、最后profile局部33/33分开记录，types/build通过。没有最终完整323重跑声明。资料表单支持同字段非空Q，本次截图样例为空，不I/S/绑定；评论ID显示P3已修。

| 批注截图 / 原图 | 核对点 |
| --- | --- |
| [48 头条文章表单](48-tt-article-query.png) / [原图](48-tt-article-query-raw.png) | AgentKey · TikHub、group_id；单对象详情不伪造发现订阅 |
| [49 头条评论表单](49-tt-comments-query.png) / [原图](49-tt-comments-query-raw.png) | offset字符串首页0；单页研究 |
| [50 头条资料表单](50-tt-profile-query.png) / [原图](50-tt-profile-query-raw.png) | 稳定user_id定位，不按昵称绑定 |
| [51 头条文章结果](51-tt-article-result.png) / [原图](51-tt-article-result-raw.png) | 分享标题/实际作者与原生原文；缺正文/时间沿pending与回填 |
| [52 头条评论结果](52-tt-comments-result.png) / [原图](52-tt-comments-result-raw.png) | 文本与完整评论ID显示；研究无I/绑定 |
| [53 头条空白资料样例](53-tt-blank-profile-result.png) / [原图](53-tt-blank-profile-result-raw.png) | 本桩样例全空有明确说明；同字段真实非空Q受支持，不推断注销 |
| [54 头条I确认](54-tt-import-confirmation.png) / [原图](54-tt-import-confirmation-raw.png) | 复用显式本地材料导入、原因与权限校验，不外发 |
| [55 头条I完成](55-tt-import-completed.png) / [原图](55-tt-import-completed-raw.png) | 文章关联与隔离权限保持、未知时间不冒充今天 |
| [56 头条评论订阅](56-tt-comment-subscription.png) / [原图](56-tt-comment-subscription-raw.png) | 单页研究S、默认停用，无材料导入 |
| [57 头条评论快照完成](57-tt-comment-snapshot-completed.png) / [原图](57-tt-comment-snapshot-completed-raw.png) | 原执行器单次完成、摘要/回执与占用释放 |
| [58 头条任务列表](58-tt-operation-list.png) / [原图](58-tt-operation-list-raw.png) | 三条Q和评论快照共用任务页 |
| [59 头条订阅列表](59-tt-subscription-list.png) / [原图](59-tt-subscription-list-raw.png) | 测试订阅最终disabled、无在途占用 |

## 小红书九条及完整本地流程（60–87）

对应主方案§12.13。后端相关29/29+末次可选作者1/1；Web最终4文件29/29、types/build通过。仅AgentKey推荐禁I和嵌套stats展示两处评审缺陷已修。九Q、实际两类UI S（搜索有界详情、评论快照；五条是后端S种类）、同轮有界详情默认0/显式1、研究无I、账号绑定、跨商预检阻断、去重/权限及最终停用均已核验，回复非空合同未证仍未接。

| 批注截图 / 原图 | 核对点 |
| --- | --- |
| [60 XHS搜索表单](60-xhs-search-query.png) / [原图](60-xhs-search-query-raw.png) | AgentKey · TikHub、2credits；会话/第一页冻结 |
| [61 XHS账号笔记表单](61-xhs-posts-query.png) / [原图](61-xhs-posts-query-raw.png) | 实际user_id、首页cursor空 |
| [62 XHS统一详情表单](62-xhs-detail-query.png) / [原图](62-xhs-detail-query-raw.png) | 同一note_id内容详情，含视频笔记文本，无播放下载 |
| [63 XHS账号搜索表单](63-xhs-account-search-query.png) / [原图](63-xhs-account-search-query-raw.png) | 关键词首页研究，不按昵称绑定 |
| [64 XHS资料表单](64-xhs-profile-query.png) / [原图](64-xhs-profile-query-raw.png) | 返回稳定userid才允许显式绑定 |
| [65 XHS话题表单](65-xhs-topic-query.png) / [原图](65-xhs-topic-query-raw.png) | page_id与单页研究，未发明会话 |
| [66 XHS评论表单](66-xhs-comments-query.png) / [原图](66-xhs-comments-query-raw.png) | 固定首页index0/cursor/pageArea及已证排序 |
| [67 XHS建议表单](67-xhs-suggest-query.png) / [原图](67-xhs-suggest-query-raw.png) | keyword可空，研究词条，无I/S |
| [68 XHS推荐表单](68-xhs-recommendations-query.png) / [原图](68-xhs-recommendations-query-raw.png) | 首页推荐、默认20，纯研究不自动材料 |
| [69 XHS搜索结果](69-xhs-search-result.png) / [原图](69-xhs-search-result-raw.png) | 广告不计笔记，缺原文列表pending |
| [70 XHS账号笔记结果](70-xhs-posts-result.png) / [原图](70-xhs-posts-result-raw.png) | normal/video混合，作者按返回核，不用请求补身份 |
| [71 XHS统一详情结果](71-xhs-detail-result.png) / [原图](71-xhs-detail-result-raw.png) | 视频笔记本身文本、原生签名query保留，未知时间不猜 |
| [72 XHS账号搜索结果](72-xhs-account-search-result.png) / [原图](72-xhs-account-search-result-raw.png) | 按实际id显式绑定，不把red_id作稳定身份 |
| [73 XHS资料结果](73-xhs-profile-result.png) / [原图](73-xhs-profile-result-raw.png) | 实际资料及嵌套stats展示，计数缺失不写0 |
| [74 XHS话题结果](74-xhs-topic-result.png) / [原图](74-xhs-topic-result-raw.png) | 实际作者与原生discovery/item方可I |
| [75 XHS评论结果](75-xhs-comments-result.png) / [原图](75-xhs-comments-result-raw.png) | 完整评论ID、实际文本与笔记上下文，无I |
| [76 XHS建议结果](76-xhs-suggest-result.png) / [原图](76-xhs-suggest-result-raw.png) | 本路线code1000成功，词条不作为文章 |
| [77 XHS推荐结果](77-xhs-recommendations-result.png) / [原图](77-xhs-recommendations-result-raw.png) | 仅AgentKey推荐禁I，不误伤Redfox原规则 |
| [78 XHS I确认](78-xhs-import-dialog.png) / [原图](78-xhs-import-dialog-raw.png) | 原显式导入/身份/原文/隔离检查，不触发供应商 |
| [79 XHS I完成](79-xhs-imported.png) / [原图](79-xhs-imported-raw.png) | 同笔记跨来源与query变化去重，保留原归属权限 |
| [80 XHS账号绑定](80-xhs-account-binding.png) / [原图](80-xhs-account-binding-raw.png) | 仅返回稳定ID，绑定隔离来源不升级全文许可 |
| [81 XHS内容订阅](81-xhs-new-subscription.png) / [原图](81-xhs-new-subscription-raw.png) | 默认details0；需要才显式同run有界详情1 |
| [82 XHS评论订阅](82-xhs-comment-subscription.png) / [原图](82-xhs-comment-subscription-raw.png) | 单页研究S，无详情/材料动作 |
| [83 XHS有界详情结果](83-xhs-bounded-collection-result.png) / [原图](83-xhs-bounded-collection-result-raw.png) | 同轮原列表→显式详情1，保留首次发现与原回执 |
| [84 XHS评论快照结果](84-xhs-comments-snapshot-result.png) / [原图](84-xhs-comments-snapshot-result-raw.png) | 研究无source/article关联，摘要与占位收尾 |
| [85 XHS停用订阅列表](85-xhs-subscription-list.png) / [原图](85-xhs-subscription-list-raw.png) | 本次两条S及RF对照全部disabled，active_run_id释放 |
| [86 XHS切换阻断](86-xhs-switch-blocked.png) / [原图](86-xhs-switch-blocked-raw.png) | 原预检明确不支持，旧provider/配置/权限保持 |
| [87 XHS任务列表](87-xhs-operation-list.png) / [原图](87-xhs-operation-list-raw.png) | 九条Q及本次两条S共用原任务列表与费用回执 |

## B站十一条及代表采集流程（88–123）

对应主方案§12.14。后端S20/20；Web最终7文件58/58与types通过。UI本次实际运行11Q及3S代表（搜索显式有界详情1、评论截断保留1、统计候选0），九条是后端S种类，不是九类全部浏览器运行。Root另发现嵌套pagination.page/accountTotal摘要P3-1，SSR红1/1→修复绿1/1；两次独立review漏项记录保留。99–109最终重拍；88–123共36处最终批注图均已由Lead逐张回看，原图配对留证。

| 批注截图 / 原图 | 核对点 |
| --- | --- |
| [88 B站综合搜索表单](88-bili-search-query.png) / [原图](88-bili-search-query-raw.png) | 首页参数与AgentKey · TikHub，非AV分型只研究 |
| [89 B站分类搜索表单](89-bili-typed-search-query.png) / [原图](89-bili-typed-search-query-raw.png) | 仅已证video分型，不开放未证类型 |
| [90 B站账号视频表单](90-bili-posts-query.png) / [原图](90-bili-posts-query-raw.png) | 实际user_id与archive首页，缺MID不注入身份 |
| [91 B站视频详情表单](91-bili-detail-query.png) / [原图](91-bili-detail-query-raw.png) | 已收AV/BV别名参数，视频说明不是转写 |
| [92 B站评论表单](92-bili-comments-query.png) / [原图](92-bili-comments-query-raw.png) | 冻结视频，next_offset整数合同 |
| [93 B站回复表单](93-bili-replies-query.png) / [原图](93-bili-replies-query-raw.png) | 冻结root与OID，回复层级不混顶层 |
| [94 B站账号资料表单](94-bili-profile-query.png) / [原图](94-bili-profile-query-raw.png) | 实际MID可显式绑定 |
| [95 B站统计表单](95-bili-stats-query.png) / [原图](95-bili-stats-query-raw.png) | 账号统计研究，不要求文章正文 |
| [96 B站动态表单](96-bili-dynamics-query.png) / [原图](96-bili-dynamics-query-raw.png) | 当前作者与orig角色分开 |
| [97 B站热门视频表单](97-bili-trending-query.png) / [原图](97-bili-trending-query-raw.png) | 推荐研究，不冒充搜索命中 |
| [98 B站热搜表单](98-bili-hot-search-query.png) / [原图](98-bili-hot-search-query-raw.png) | 词条研究，不虚构排名 |
| [99 B站综合搜索结果](99-bili-search-result.png) / [原图](99-bili-search-result-raw.png) | AV内容候选，原分页字段按实际展示，最终重拍 |
| [100 B站分类搜索结果](100-bili-typed-search-result.png) / [原图](100-bili-typed-search-result-raw.png) | video结果与可选有界详情用途，最终重拍 |
| [101 B站账号视频结果](101-bili-posts-result.png) / [原图](101-bili-posts-result-raw.png) | BV有据、MID缺失不直接I，最终重拍 |
| [102 B站视频详情结果](102-bili-detail-result.png) / [原图](102-bili-detail-result-raw.png) | 实际BV+MID详情I，未知时间回填，最终重拍 |
| [103 B站评论结果](103-bili-comments-result.png) / [原图](103-bili-comments-result-raw.png) | 真实评论/OID与嵌套pagination.page，最终重拍已回看 |
| [104 B站回复结果](104-bili-replies-result.png) / [原图](104-bili-replies-result-raw.png) | root/replies层级与嵌套page，最终重拍已回看 |
| [105 B站账号资料结果](105-bili-profile-result.png) / [原图](105-bili-profile-result-raw.png) | 实际MID绑定同来源，最终重拍 |
| [106 B站统计结果](106-bili-stats-result.png) / [原图](106-bili-stats-result-raw.png) | 直接统计值及accountTotal按实际展示，最终重拍已回看 |
| [107 B站动态结果](107-bili-dynamics-result.png) / [原图](107-bili-dynamics-result-raw.png) | nullable字段及orig角色，最终重拍已回看 |
| [108 B站热门视频结果](108-bili-trending-result.png) / [原图](108-bili-trending-result-raw.png) | 推荐研究无I，最终重拍已回看 |
| [109 B站热搜结果](109-bili-hot-search-result.png) / [原图](109-bili-hot-search-result-raw.png) | 词条无文章I、无虚构排名，最终重拍已回看 |
| [110 B站详情参数预填](110-bili-detail-prefill.png) / [原图](110-bili-detail-prefill-raw.png) | 仅使用已收AV/BV，不换算或猜ID |
| [111 B站详情I确认](111-bili-import-dialog.png) / [原图](111-bili-import-dialog-raw.png) | 沿原材料身份/权限/隔离门，不额外请求 |
| [112 B站详情I完成](112-bili-imported.png) / [原图](112-bili-imported-raw.png) | 同BV唯一材料与原归属复用 |
| [113 B站账号绑定](113-bili-account-binding.png) / [原图](113-bili-account-binding-raw.png) | profile40复用同source |
| [114 B站订阅默认值](114-bili-subscription-default.png) / [原图](114-bili-subscription-default-raw.png) | 默认首页pages1/details0 |
| [115 B站显式有界详情](115-bili-subscription-explicit-detail.png) / [原图](115-bili-subscription-explicit-detail-raw.png) | 同run可选详情1，不自动补购 |
| [116 B站评论订阅](116-bili-comment-subscription.png) / [原图](116-bili-comment-subscription-raw.png) | 研究快照截断保留1、无材料I |
| [117 B站统计订阅](117-bili-stat-subscription.png) / [原图](117-bili-stat-subscription-raw.png) | 统计快照候选0，不作文章 |
| [118 B站切换阻断](118-bili-switch-blocked.png) / [原图](118-bili-switch-blocked-raw.png) | RF对照sub11预检阻断，原provider/config不变 |
| [119 B站有界采集结果](119-bili-bounded-collection-result.png) / [原图](119-bili-bounded-collection-result-raw.png) | run45列表与详情各原回执，复用detail37同BV/article |
| [120 B站评论快照结果](120-bili-comment-snapshot-result.png) / [原图](120-bili-comment-snapshot-result-raw.png) | run46保留1/剩余1，不关联source/article |
| [121 B站统计快照结果](121-bili-stat-snapshot-result.png) / [原图](121-bili-stat-snapshot-result-raw.png) | run47候选0，统计有值且无source/article |
| [122 B站停用订阅列表](122-bili-subscription-list.png) / [原图](122-bili-subscription-list-raw.png) | 本次3条S及RF对照disabled，active_run_id/next_run_at清空 |
| [123 B站任务列表](123-bili-operation-list.png) / [原图](123-bili-operation-list-raw.png) | 11Q+实际3S共14run（34–47）全部completed |

## 微博八条及六类采集流程（124–163）

对应主方案§12.15。后端Q8/8、I28/28、S/X Lead接管修复后36/36及独立定向review通过；保留预算fixture失败、purpose陈旧与冻结账号UID P2二错停工轨迹。Web早期两错经升级接管恢复，Root评论ID/时间标签P3实际红13/15→绿15/15，types通过，135已重拍。实际Q48–55、S56–61，sub12–17六类全部运行（items1，sub12 details1其余0）。原writer/执行器手动调用，无常驻Worker、真实UI供应商请求或额外API。

| 批注截图 / 原图 | 核对点 |
| --- | --- |
| [124 微博搜索表单](124-weibo-search-query.png) / [原图](124-weibo-search-query-raw.png) | 同一搜索1/61首页，AgentKey · TikHub与报价 |
| [125 微博账号作品表单](125-weibo-posts-query.png) / [原图](125-weibo-posts-query-raw.png) | 冻结uid与all/page1，实际作者缺失保留pending |
| [126 微博内容详情表单](126-weibo-detail-query.png) / [原图](126-weibo-detail-query-raw.png) | 实际numeric status_id，不用mblogid换算 |
| [127 微博评论表单](127-weibo-comments-query.png) / [原图](127-weibo-comments-query-raw.png) | 首页offset/scope，研究无I |
| [128 微博账号资料表单](128-weibo-profile-query.png) / [原图](128-weibo-profile-query-raw.png) | 实际UID才显式绑定 |
| [129 微博关注表单](129-weibo-following-query.png) / [原图](129-weibo-following-query-raw.png) | 首页关系研究，不从成员发文章 |
| [130 微博热搜表单](130-weibo-trending-query.png) / [原图](130-weibo-trending-query-raw.png) | 词条研究，无虚构排名 |
| [131 微博相关词表单](131-weibo-related-query.png) / [原图](131-weibo-related-query-raw.png) | 建议研究，不作账号搜索 |
| [132 微博搜索结果](132-weibo-search-result.png) / [原图](132-weibo-search-result-raw.png) | 外层原帖/作者独立，列表直接I或显式详情预填 |
| [133 微博账号作品结果](133-weibo-posts-result.png) / [原图](133-weibo-posts-result-raw.png) | 请求范围与实际UID校验，长文pending |
| [134 微博内容详情结果](134-weibo-detail-result.png) / [原图](134-weibo-detail-result-raw.png) | isLongText/文本按实际正文合同，未知时间回填 |
| [135 微博评论结果](135-weibo-comments-result.png) / [原图](135-weibo-comments-result-raw.png) | 顶层评论ID与嵌套作者ID分开，原始带时区时间，修复重拍已回看 |
| [136 微博账号资料结果](136-weibo-profile-result.png) / [原图](136-weibo-profile-result-raw.png) | 实际UID绑定，不注入请求身份 |
| [137 微博关注结果](137-weibo-following-result.png) / [原图](137-weibo-following-result-raw.png) | 真实成员关系研究，无I/账号绑定 |
| [138 微博热搜结果](138-weibo-trending-result.png) / [原图](138-weibo-trending-result-raw.png) | 真实词条无rank/材料关联 |
| [139 微博相关词结果](139-weibo-related-result.png) / [原图](139-weibo-related-result-raw.png) | suggestion研究，不夹带账号导入 |
| [140 微博详情参数预填](140-weibo-detail-prefill.png) / [原图](140-weibo-detail-prefill-raw.png) | 沿原平台查询入口，只预填；显式独立提交才请求 |
| [141 微博导入确认](141-weibo-import-dialog.png) / [原图](141-weibo-import-dialog-raw.png) | Q50原证据/权限/身份门，无额外API |
| [142 微博导入完成](142-weibo-imported.png) / [原图](142-weibo-imported-raw.png) | 原writer写入，同材料权限保持 |
| [143 微博账号绑定确认](143-weibo-binding-dialog.png) / [原图](143-weibo-binding-dialog-raw.png) | Q52实际UID匹配既有来源 |
| [144 微博账号绑定完成](144-weibo-bound-profile.png) / [原图](144-weibo-bound-profile-raw.png) | 绑定同source，隔离及全文许可不升级 |
| [145 微博订阅默认值](145-weibo-subscription-default.png) / [原图](145-weibo-subscription-default-raw.png) | pages1/details0，无自动后页 |
| [146 微博显式详情配置](146-weibo-subscription-explicit-detail.png) / [原图](146-weibo-subscription-explicit-detail-raw.png) | 仅账号/搜索有界同run可选详情，sub12 details1 |
| [147 微博搜索订阅](147-weibo-search-subscription.png) / [原图](147-weibo-search-subscription-raw.png) | 首页items1、details0 |
| [148 微博评论订阅](148-weibo-comment-subscription.png) / [原图](148-weibo-comment-subscription-raw.png) | 首页研究items1、details0 |
| [149 微博关注订阅](149-weibo-following-subscription.png) / [原图](149-weibo-following-subscription-raw.png) | 首页关系研究items1、details0 |
| [150 微博热搜订阅](150-weibo-trending-subscription.png) / [原图](150-weibo-trending-subscription-raw.png) | 首页词条研究items1、details0 |
| [151 微博相关词订阅](151-weibo-related-subscription.png) / [原图](151-weibo-related-subscription-raw.png) | 首页建议研究items1、details0 |
| [152 微博支持切换预检](152-weibo-switch-supported.png) / [原图](152-weibo-switch-supported-raw.png) | basic搜索同语义page1，RF→AK同ID |
| [153 微博反向切换预览](153-weibo-switch-confirm.png) / [原图](153-weibo-switch-confirm-raw.png) | 最终图仅反向预览后取消，不声称实际AK→RF |
| [154 微博切换后状态](154-weibo-switched.png) / [原图](154-weibo-switched-raw.png) | sub18实际RF→AK，原订阅ID保留；同内容fullPage最终替换已完成，Lead确认无裁切 |
| [155 微博不支持切换阻断](155-weibo-switch-blocked.png) / [原图](155-weibo-switch-blocked-raw.png) | sub19 extParam2预检拒绝，原配置不变；同内容fullPage最终替换已完成，Lead确认无裁切 |
| [156 微博账号采集结果](156-weibo-account-collection-result.png) / [原图](156-weibo-account-collection-result-raw.png) | sub12同run详情1，冻结账号/实收UID验证 |
| [157 微博搜索采集结果](157-weibo-search-collection-result.png) / [原图](157-weibo-search-collection-result-raw.png) | 搜索首页直接I，details0 |
| [158 微博评论快照](158-weibo-comment-snapshot.png) / [原图](158-weibo-comment-snapshot-raw.png) | 研究无source/article，实际首页截断 |
| [159 微博关注快照](159-weibo-following-snapshot.png) / [原图](159-weibo-following-snapshot-raw.png) | 关系研究无材料关联 |
| [160 微博热搜快照](160-weibo-trending-snapshot.png) / [原图](160-weibo-trending-snapshot-raw.png) | 词条研究无材料关联 |
| [161 微博相关词快照](161-weibo-related-snapshot.png) / [原图](161-weibo-related-snapshot-raw.png) | 建议研究无材料关联 |
| [162 微博停用订阅列表](162-weibo-subscription-list.png) / [原图](162-weibo-subscription-list-raw.png) | 全部UI sub1–19 disabled，无active/next |
| [163 微博任务列表](163-weibo-operation-list.png) / [原图](163-weibo-operation-list-raw.png) | 本次8Q/6S均完成，原任务/回执展示 |

微博检查点当时163对/326PNG链接文件均存在，124–163共40处最终批注图由Lead逐张回看，原图配对留证，135/153已重拍；154/155同内容fullPage最终替换已完成，Lead逐张确认无裁切，124–163共40对均完成最终视觉验收；文档只核链接，不替代Lead视觉确认。原图和批注均为独立UI测试库/本地桩与真实应用；无真实UI供应商请求或常驻Worker，脚本复用原执行器。最终articles6/sources6，WB新作者isolated/site_fulltext=false/syndicate=false；Q50手动I与Q52资料绑定同source。sub1–19全disabled且active/next为空，本批WB源停用；旧DY external作者仍enabled但无采集调度，不称所有sources停用。X当时检查点见下节，后续P2收尾见文末。该检查点截至2026-10-23，65条中60条已按用途完成本地验收（抖音11、公众号6、头条3、小红书9、B站11、微博8、X12）；X已接通12类Q、5类作品手动I及10类单页S，后端、Web和真实本地浏览器已验，最终状态/清理已通过，截图1–228每处均有原图和批注图共456PNG，最终批注图由Lead逐张回看；另5条尚未接入（抖音粉丝、头条视频、小红书回复、微博粉丝、公众号相关文章各1），仍保留在65条范围，未移入第三阶段。


## X十二条及十类单页采集流程（164–228）

真实本地浏览器完成13Q（十二类Q62–73，账号帖Q74仅为193选择重拍并清选择、无I；UI搜索仅Top，Latest由后端/真实补证覆盖）、6个结果手动I复用3个唯一材料、10类S（75–84）各一轮。后端、Web、假loopback MCP与专用UI test库连通；原executor单独步进，无常驻Worker、真实付费或额外API，不称Worker E2E。详情/资料不单独建订阅，其余S全单页/零详情/无补购/无自动翻页。164–228每处均有原图与批注图，最终批注图已由Lead实际查看；217使用中性旧fixture说明，旧quote清空后不回填，不冒充修复后的UI历史回填验证。

| 截图 | 核对点 |
| --- | --- |
| [164 X搜索查询](164-x-search-query.png) / [原图](164-x-search-query-raw.png) | AgentKey · TikHub；Top/Latest与原关键词输入 |
| [165 X账号帖查询](165-x-posts-query.png) / [原图](165-x-posts-query-raw.png) | 实际账号定位；单页输入 |
| [166 X详情查询](166-x-detail-query.png) / [原图](166-x-detail-query-raw.png) | 显式Tweet ID；不创建详情订阅 |
| [167 X评论查询](167-x-comments-query.png) / [原图](167-x-comments-query-raw.png) | 根帖与thread研究用途 |
| [168 X资料查询](168-x-profile-query.png) / [原图](168-x-profile-query-raw.png) | 既有单账号绑定用途 |
| [169 X粉丝查询](169-x-followers-query.png) / [原图](169-x-followers-query-raw.png) | 关系研究，不自动导入 |
| [170 X关注查询](170-x-following-query.png) / [原图](170-x-following-query-raw.png) | Q保留供应商选择 |
| [171 X列表帖查询](171-x-list-posts-query.png) / [原图](171-x-list-posts-query-raw.png) | 列表容器与实际作者区分 |
| [172 X社区帖查询](172-x-community-posts-query.png) / [原图](172-x-community-posts-query-raw.png) | community_id定位；ranking不补默认 |
| [173 X趋势查询](173-x-trending-query.png) / [原图](173-x-trending-query-raw.png) | 国家默认UnitedStates |
| [174 X列表成员查询](174-x-list-members-query.png) / [原图](174-x-list-members-query-raw.png) | 成员研究，不自动绑定来源 |
| [175 X社区成员查询](175-x-community-members-query.png) / [原图](175-x-community-members-query-raw.png) | 首页成员；不续传无效cursor |
| [176 X搜索结果](176-x-search-result.png) / [原图](176-x-search-result-raw.png) | 作品/引用角色与I资格分别展示 |
| [177 X账号帖结果](177-x-posts-result.png) / [原图](177-x-posts-result-raw.png) | 置顶/转发/引用与原帖分开 |
| [178 X详情结果](178-x-detail-result.png) / [原图](178-x-detail-result-raw.png) | 实收文本保持pending，不宣称全文 |
| [179 X评论结果](179-x-comments-result.png) / [原图](179-x-comments-result-raw.png) | 根对象不混作评论，不宣称直接回复 |
| [180 X资料结果](180-x-profile-result.png) / [原图](180-x-profile-result-raw.png) | 实际账号资料与绑定入口 |
| [181 X粉丝结果](181-x-followers-result.png) / [原图](181-x-followers-result-raw.png) | 有意义成员/计数；研究无I |
| [182 X关注结果](182-x-following-result.png) / [原图](182-x-following-result-raw.png) | 有意义成员/计数；研究无I |
| [183 X列表帖结果](183-x-list-posts-result.png) / [原图](183-x-list-posts-result-raw.png) | 容器不是作者；实际作品资格 |
| [184 X社区帖结果](184-x-community-posts-result.png) / [原图](184-x-community-posts-result-raw.png) | 实际作者与作品；研究/导入分开 |
| [185 X趋势结果](185-x-trending-result.png) / [原图](185-x-trending-result-raw.png) | 不虚构排名、热度或原文 |
| [186 X列表成员结果](186-x-list-members-result.png) / [原图](186-x-list-members-result-raw.png) | 公开成员研究，无材料导入 |
| [187 X社区成员结果](187-x-community-members-result.png) / [原图](187-x-community-members-result-raw.png) | 首页快照，不承诺完整成员 |
| [188 X已有绑定目标](188-x-binding-target.png) / [原图](188-x-binding-target-raw.png) | 只选既有完整匹配单账号x_search |
| [189 X绑定确认](189-x-binding-dialog.png) / [原图](189-x-binding-dialog-raw.png) | 显式确认既有来源，不新建external |
| [190 X资料已绑定](190-x-bound-profile.png) / [原图](190-x-bound-profile-raw.png) | 资料查询绑定复用同source |
| [191 X搜索导入确认](191-x-search-import-dialog.png) / [原图](191-x-search-import-dialog-raw.png) | 原入口显式导入及资格提示 |
| [192 X搜索已导入](192-x-search-imported.png) / [原图](192-x-search-imported-raw.png) | 材料关联沿原writer保存 |
| [193 X账号帖选择](193-x-posts-selection.png) / [原图](193-x-posts-selection-raw.png) | 转发/置顶/引用角色与可导入项区分 |
| [194 X账号帖导入确认](194-x-posts-import-dialog.png) / [原图](194-x-posts-import-dialog-raw.png) | 仅符合身份/文本/原生链接的项 |
| [195 X账号帖已导入](195-x-posts-imported.png) / [原图](195-x-posts-imported-raw.png) | 复用既有作品身份与材料 |
| [196 X详情导入确认](196-x-detail-import-dialog.png) / [原图](196-x-detail-import-dialog-raw.png) | 显式导入实收详情 |
| [197 X详情已导入](197-x-detail-imported.png) / [原图](197-x-detail-imported-raw.png) | 不隐式补购正文/Article |
| [198 X列表帖导入确认](198-x-list-import-dialog.png) / [原图](198-x-list-import-dialog-raw.png) | 实际作品作者，不将列表当作者 |
| [199 X列表帖已导入](199-x-list-imported.png) / [原图](199-x-list-imported-raw.png) | 原材料身份/去重入口 |
| [200 X社区帖导入确认](200-x-community-import-dialog.png) / [原图](200-x-community-import-dialog-raw.png) | 实际作品作者，不将社区当作者 |
| [201 X社区帖已导入](201-x-community-imported.png) / [原图](201-x-community-imported-raw.png) | 沿原材料与权限边界 |
| [202 X搜索订阅](202-x-search-subscription.png) / [原图](202-x-search-subscription-raw.png) | 普通关键词Top/Latest；默认停用/单页/零详情 |
| [203 X账号帖订阅](203-x-posts-subscription.png) / [原图](203-x-posts-subscription-raw.png) | 实际账号定位；无自动续页/补购 |
| [204 X评论订阅](204-x-comment-subscription.png) / [原图](204-x-comment-subscription-raw.png) | S仅AgentKey；保留会话研究 |
| [205 X粉丝订阅](205-x-followers-subscription.png) / [原图](205-x-followers-subscription-raw.png) | 单页研究快照 |
| [206 X关注订阅](206-x-following-subscription.png) / [原图](206-x-following-subscription-raw.png) | S仅AgentKey，Q仍保留Redfox |
| [207 X列表帖订阅](207-x-list-posts-subscription.png) / [原图](207-x-list-posts-subscription-raw.png) | 单页零详情；固定list_id |
| [208 X社区帖订阅](208-x-community-posts-subscription.png) / [原图](208-x-community-posts-subscription-raw.png) | 单页零详情；固定community_id |
| [209 X趋势订阅](209-x-trending-subscription.png) / [原图](209-x-trending-subscription-raw.png) | 国家条件与单次榜单快照 |
| [210 X列表成员订阅](210-x-list-members-subscription.png) / [原图](210-x-list-members-subscription-raw.png) | 成员研究，不成为新闻 |
| [211 X社区成员订阅](211-x-community-members-subscription.png) / [原图](211-x-community-members-subscription-raw.png) | 严格首页，不续传cursor |
| [212 X搜索采集结果](212-x-search-collection.png) / [原图](212-x-search-collection-raw.png) | 单页结果与selected/unprocessed分开 |
| [213 X账号帖采集结果](213-x-posts-collection.png) / [原图](213-x-posts-collection-raw.png) | 转发/置顶角色保留；零详情 |
| [214 X评论采集结果](214-x-comment-collection.png) / [原图](214-x-comment-collection-raw.png) | 研究结果不导入材料 |
| [215 X粉丝采集结果](215-x-followers-collection.png) / [原图](215-x-followers-collection-raw.png) | 实际成员摘要；无I |
| [216 X关注采集结果](216-x-following-collection.png) / [原图](216-x-following-collection-raw.png) | 实际成员摘要；无I |
| [217 X列表帖采集结果](217-x-list-posts-collection.png) / [原图](217-x-list-posts-collection-raw.png) | 中性旧fixture说明；不作为metadata修复后历史回填证明 |
| [218 X社区帖采集结果](218-x-community-posts-collection.png) / [原图](218-x-community-posts-collection-raw.png) | 实际角色/材料资格与未处理数 |
| [219 X趋势采集结果](219-x-trending-collection.png) / [原图](219-x-trending-collection-raw.png) | 无虚构rank/heat/原文 |
| [220 X列表成员采集结果](220-x-list-members-collection.png) / [原图](220-x-list-members-collection-raw.png) | 仅研究结果，无自动绑定 |
| [221 X社区成员采集结果](221-x-community-members-collection.png) / [原图](221-x-community-members-collection-raw.png) | 首页完成，无后页请求 |
| [222 X基础搜索切换预检](222-x-switch-supported.png) / [原图](222-x-switch-supported-raw.png) | 显式切换兼容配置 |
| [223 X切换确认](223-x-switch-confirm.png) / [原图](223-x-switch-confirm-raw.png) | 同ID保留历史，明确供应商 |
| [224 X切换完成](224-x-switched.png) / [原图](224-x-switched-raw.png) | sub31实际基础搜索切换成功 |
| [225 X高级配方切换阻断](225-x-switch-blocked.png) / [原图](225-x-switch-blocked-raw.png) | sub32预检拒绝，保留原配置 |
| [226 XRedfox查询与S边界](226-x-redfox-query-only.png) / [原图](226-x-redfox-query-only-raw.png) | 共享评论/关注Q保留RF+AK，选择RF可查询、建S入口禁用；S仅AK |
| [227 X最终订阅列表](227-x-subscription-list.png) / [原图](227-x-subscription-list-raw.png) | UI32订阅全部停用，active/next清空；X10订阅沿原命令停用 |
| [228 X最终任务列表](228-x-task-list.png) / [原图](228-x-task-list-raw.png) | X13Q/10S完成；23个原回执，原任务历史保留 |

X检查点当时228对/456PNG配对链接均存在；1–228每处均有原图和批注图共456PNG，最终批注图由Lead逐张回看，217最终中性批注亦已回看。sub31基础搜索实际显式切换同ID历史，当前AK/version2；sub32高级配方预检阻断，仍RF/version1。最终state/cleanup通过：23个原回执对应13Q/10S且query/collect服务正确，研究无article/source关联，原native主订阅仍SocialData；本批10个X订阅及账号信源经原domain command停用，UI全部32订阅disabled、active/next均为空，最终articles9/sources7。原failed state的旧quote断言保留；本次state只验证身份/持久链路，metadata修复以fresh revision70/70为据。已按用途完成60/65条，剩余5条仍在第二阶段未开放。


## 追加P2修复：RF详情能力保持（229–235）

本批沿真实Web编辑5个停用RF合成订阅33–37，只改周期为16，保存并重新载入以核对已开启详情仍保留；不发起采集或真实供应商调用。space35与原独立UI测试库，原32订阅仍停用。API18/18、相关339/339及typecheck证据见主方案§12.17，不将截图替代恢复、材料身份或parser回归。

| 截图 | 核对点 |
| --- | --- |
| [229 RF微博详情保持](229-redfox-weibo-detail-preserved.png) / [原图](229-redfox-weibo-detail-preserved-raw.png) | 只改周期为16，真实Web保存/重载后RF详情开关、目标和价格仍保持；最终批注图已由Lead回看 |
| [230 RF B站搜索详情保持](230-redfox-bilibili-search-detail-preserved.png) / [原图](230-redfox-bilibili-search-detail-preserved-raw.png) | 只改周期16；原RF/params/3页2条1详情/enrich/详情目标保存重载后保持 |
| [231 RF B站账号帖详情保持](231-redfox-bilibili-posts-detail-preserved.png) / [原图](231-redfox-bilibili-posts-detail-preserved-raw.png) | 原供应商与详情配置保持，execution_version仍1 |
| [232 RF小红书搜索详情保持](232-redfox-xhs-search-detail-preserved.png) / [原图](232-redfox-xhs-search-detail-preserved-raw.png) | 原RF详情目标与已开启补全保存重载后保持 |
| [233 RF小红书账号笔记详情保持](233-redfox-xhs-posts-detail-preserved.png) / [原图](233-redfox-xhs-posts-detail-preserved-raw.png) | 原RF/params/限额与详情目标保持，仅周期16 |
| [234 RF保存后订阅列表](234-redfox-saved-subscription-list.png) / [原图](234-redfox-saved-subscription-list-raw.png) | 五条原配置保持；37个订阅均停用、无active/next |
| [235 AK草稿价格与能力边界](235-agentkey-draft-price-boundary.png) / [原图](235-agentkey-draft-price-boundary-raw.png) | 新草稿仅选AK/XHS，2credits/首页/零详情；未保存、未调用 |

UI229–233五个RF合成订阅33–37均经真实Web保存并reload：只将周期改16，原RF、params、3页/2条/1详情、enrichDetails=true及原detail target完整保留；execution_version均1，edit_version为33/35/36/37=2、34=3。34首次数字fill得到1416且已保存，断言超时后用Meta+A逐键16再次保存/重载；这是UI自动化输入错误，未改产品逻辑。229初版CDP截图裁底后已用zoom坐标重拍，最终229–235七处批注图逐张回看且无裁切，原图配对共14PNG；累计235处/470PNG。234为保存后列表，235仅新草稿选AK/XHS显示2credits/首页/零详情，未保存、未调用。

最终UI state脚本exit0：37订阅全disabled、active/next为空；runs84/receipts89/articles9/sources7与本轮前一致，没有新增call/run/material/source。新增5个停用合成订阅是验收fixture。临时本地3310/3311/3312保留便于查看，无常驻Worker，真实阀门均false。本地假MCP和独立UI库，不称Worker E2E；恢复的新旧轮占位测试为顺序检查，未宣称并发交错已测；修复前stopped历史脏占位及既有冲突重复owner没有批量修生产。完整typecheck后，Root更正旧RF目录测试断言再跑tests tsc亦exit0。

## 追加文案验收：数据工具入口（236–237）

本次按最小方案把后台侧边栏入口、浏览器页面标题、页面主标题和工作区无障碍名称改为“数据工具”，正式路径为 `/admin/data-tools`；旧 `/admin/redfox` 返回 308 并保留查询参数跳转到新地址，既有书签和通知链接继续可用。“平台查询”中的供应商字段、查询表单、持久任务和订阅入口未改；Redfox 专属能力仍保留 Redfox 名称。桌面与760px窄屏均来自实际运行的本地 Web，没有创建任务、启用订阅或请求外部供应商。

| 截图 | 核对点 |
| --- | --- |
| [236 数据工具桌面入口](236-data-tools-desktop.png) / [原图](236-data-tools-desktop-raw.png) | 侧边栏和页面标题均为“数据工具”，入口指向 `/admin/data-tools`；供应商字段仍显示实际路线 AgentKey · TikHub |
| [237 数据工具窄屏布局](237-data-tools-narrow.png) / [原图](237-data-tools-narrow-raw.png) | 顶部导航和页面主标题均显示“数据工具”；平台查询和实际供应商保持可用；旧路径兼容跳转 |

页面 DOM 另确认浏览器标题为“数据工具 · MyHOT 后台”、工作区名称为“数据工具工作区”；实际浏览器访问旧地址后落到 `/admin/data-tools?view=platforms`。定向测试另覆盖 308 状态、查询参数保留以及跳转前不读取 API；Web typecheck、构建、全量 Web 354/354 和 `collection-source-entry` 8/8 均通过。

236–237检查点共237处原图和批注图、474PNG，最终批注图经Lead逐张回看；229–237九处最终版本均无裁切。路线60/65、未开放5条的补证路径及59/57/29.4credits/两个400费用未知均保持，无新增真实调用、提交、推送或部署。


## 追加命名验收：采集订阅与执行记录（238–255）

信源中的长期配置统一称为“采集订阅”；每轮采集、单次查询或工具执行统一在“执行记录”列表与详情中查看。关联入口、表单按钮、结果说明、返回链接及切换说明同步调整；供应商返回的任务 ID 与系统定时任务仍保留原有含义。API、数据模型、预算、恢复与调度逻辑未改变。

复用上述本地桩环境，只打开页面、切换视图、做本地只读预检和打开后取消确认框；没有发起查询、采集、切换或真实供应商调用。已核对数据工具 → 采集订阅、执行记录列表 → 详情 → 对应订阅的导航；桌面和760px窄屏没有新增文案裁切，浏览器未记录相关 error/warn。这里的截图证明文案与导航，不代替新一次业务执行或恢复验收。

| 截图 | 核对点 |
| --- | --- |
| [238 data-tools](238-data-tools.png) / [原图](238-data-tools-raw.png) | 入口区分采集订阅与执行记录；查询按钮指向执行记录，带入订阅只生成草稿。 |
| [239 subscriptions-list](239-subscriptions-list.png) / [原图](239-subscriptions-list-raw.png) | 采集订阅负责长期配置；当前执行记录单独展示每轮状态。 |
| [240 subscription-editor](240-subscription-editor.png) / [原图](240-subscription-editor-raw.png) | 编辑已有订阅；历史执行记录保留供应商，配置变更对旧轮执行的影响明确。未保存、未预览、未启用。 |
| [241 execution-list](241-execution-list.png) / [原图](241-execution-list-raw.png) | 列表统一为执行记录；每行表示一次执行，供应商与状态仍取原数据。 |
| [242 execution-detail](242-execution-detail.png) / [原图](242-execution-detail-raw.png) | 详情标题、返回列表及返回采集订阅统一命名；进度、结果、回执仍在原执行记录中。 |
| [243 source-subscription](243-source-subscription.png) / [原图](243-source-subscription-raw.png) | 信源详情明确区分主采集订阅与当前执行记录；右侧入口查看每轮执行。 |
| [244 source-history](244-source-history.png) / [原图](244-source-history-raw.png) | 历史采集记录链接统一为查看执行记录；时间标注执行记录创建。 |
| [245 runs](245-runs.png) / [原图](245-runs-raw.png) | 运行概览入口改为执行记录、结果及恢复；系统定时任务保持原称呼。 |
| [246 x-query](246-x-query.png) / [原图](246-x-query-raw.png) | X 查询说明统一将结果保存到执行记录；本次没有输入或提交查询。 |
| [247 ai-search-entry](247-ai-search-entry.png) / [原图](247-ai-search-entry-raw.png) | 提交或查询 AI 搜索后进入执行记录；供应商任务 ID 与本地执行记录含义区分。 |
| [248 tool-query](248-tool-query.png) / [原图](248-tool-query-raw.png) | 工具查询按钮统一进入执行记录；本次只查看空表单。 |
| [249 transcription-query](249-transcription-query.png) / [原图](249-transcription-query-raw.png) | 查询已有供应商转写任务，按钮明确进入本次执行记录；未提交查询。 |
| [250 comment-query](250-comment-query.png) / [原图](250-comment-query-raw.png) | 异步评论保留供应商任务名称；本地等待时限明确从执行记录创建时起算。 |
| [251 source-preview](251-source-preview.png) / [原图](251-source-preview-raw.png) | 新建信源的预览区提示改为执行记录链接；未预览、未创建信源。 |
| [252 execution-detail-narrow](252-execution-detail-narrow.png) / [原图](252-execution-detail-narrow-raw.png) | 760px 窄屏：执行记录标题、返回列表和返回采集订阅可见，无文字截断。 |
| [253 data-tools-narrow](253-data-tools-narrow.png) / [原图](253-data-tools-narrow-raw.png) | 760px 窄屏：采集订阅与执行记录入口保持可见，长说明正常换行。 |
| [254 source-switch-dialog](254-source-switch-dialog.png) / [原图](254-source-switch-dialog-raw.png) | 切换说明使用旧轮执行，与保留的主订阅区分。只打开说明，未确认切换。 |
| [255 subscription-switch-dialog](255-subscription-switch-dialog.png) / [原图](255-subscription-switch-dialog-raw.png) | 切换说明区分保留的订阅与停止的旧轮执行。只读预检后查看说明，未确认切换。 |

命名调整后的定向验证：`collection-source-entry`、`detail-query-render`、`source-history-data` 共14项通过，Web typecheck与差异格式检查通过。沿用236–237阶段的旧路径308、查询参数保留和构建证据；本批没有重新执行付费或生产流程。18处原图与批注图在发布前已回看，累计255处/510PNG。
