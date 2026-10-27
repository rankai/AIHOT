# Redfox API 能力清单（2026-10-19）

> 状态（2026-10-21）：169项本地开发与分阶段验收完成，全部固定执行入口及对应后台工具已接通。125项同步、44项专用；正式采集为48项作品能力加4项热点研究快照，共52项。实际供应商验证仍只有三个X只读接口，不能将其余本地桩证据写成真实通过。主方案的[当前落地与验收状态](redfox-integration-plan.md#当前落地与验收状态2026-10-21)说明兼容限制、迁移和验证边界；逐处UI证据见[截图批注](reviews/redfox-ui-2026-10-20/README.md)。五张表和两张轻量身份映射的决定不变，生产尚未迁移/发布。

## 盘点口径

数据采集时间（UTC）：`2026-10-19T14:35:33.581Z`。来源为 [Redfox 文档目录](https://redfox.hk/apis)及每行所链的官方接口文档；公开目录元数据共 21 个一级栏目、5 个工具子栏目、169 个唯一接口，162 个 POST、7 个 GET。接口展示状态有 55 个“限时开放”、7 个“new”；这不等于账户已获授权或实测可用。后续新接口须评审后增补，不从在线目录自动开放执行。

表中参数是文档字段名：`*` 表示文档标为必填，`@query` / `@header` 为非 body 位置，`[File]` 为文件。它们是盘点事实，不是已验证的运行时契约；密钥字段仅服务端注入。分页、默认值、枚举、类型和响应结构需在各操作适配中逐项落实。

目录覆盖不等于可切换性：信源切换须按主方案 4.2 检查当前任务实际使用的全部必需能力、目标适配和参数/结果映射。缺少必要接口、语义不兼容或必要语义待核实时禁止切换；未使用的能力不参与阻断，此规则同样适用于切回其他供应商。账户尚无成功记录与能力语义未知分开：已配置凭证、语义已确认且无已知拒绝时，不强制付费探测，首次有界执行仍可因账户权限暂停；已有明确拒绝时阻断。前端显示实际证据和原因，提交时后端复核，失败不停止原采集。此清单是实施与验收依据，不建设运行时能力数据库。

采集订阅、业务任务与结果使用三张供应商无关的生命周期表；2026-10-20 补查全部文档后，用户已确认采用两张轻量账号/作品身份映射表，合计五张，撤回此前备用规范键列方案。公众号 wxId/bizInfo、TikTok userId/secUserId、微博 opusId/mblogid 等是实际一对多证据；17 个内容平台的字段与限制见[主方案 4.1.3](redfox-integration-plan.md#413-已完成的官方文档身份核对2026-10-20)，缺字段的具体补全接口、输入要求、预算、人工动作与进度处理见[4.1.4](redfox-integration-plan.md#414-缺失信息的补全路径与运行边界)。原 sources/articles、权限与历史继续复用。用户已确认同时迁入 SocialData X/大加辣公众号主采集；其他依赖仍按主方案 4.1.2 处理，完整方案已获分阶段开发授权，接口实现/验证状态随实际证据更新，真实付费与生产操作仍另行确认。

本轮重新读取文档网站公开的目录与 169 项详情，请求的是说明页数据，不是业务 API，无密钥或业务付费调用；162 POST/7 GET、26 栏目及本清单方法/路径均一致，21 项示例的 JSON 问题仍存在。身份表取舍现已按文档完成，后续真实联调验证实际响应和具体文档矛盾，不再替代方案阶段调查。视频号只有昵称、头条 uid/token 输入不同等已查明限制须直接展示，不能因“完整接入”而猜测来源或原文身份。

2026-10-20 全案必要性评审补充：接口定义只保留执行/表单实际需要的静态信息，差异随对应阶段适配；采集管理复用信源入口，查询/创作共用任务和结果视图，转写与素材不各建独立业务库。run 保存业务生命周期，队列状态、请求未知与文件保存阶段分别读各自权威。上述精简不删减下列 169 项能力，逐章取舍见主方案第 12 节。

补全流程复审：页内补全保留原 run 的源页回执与项位置，整页消费完成才推进正式游标；任务结束后显式补全创建普通一次性 run，结果导入不隐式付费。旧 X 草稿试抓保留无订阅的一次性执行，未知回执告警读取真实重试事实。均复用已定五张表、恢复与后台入口，具体修订见主方案 4.1.4、4.2.5、7.3 和 12.2。

## 能力进入系统的规则

| 能力 | 后台入口 | 定时任务 | 结果用途 |
| --- | --- | --- | --- |
| 账号 | 平台查询 | 不独立定时；可供采集配置解析账号 | 账号记录；人工绑定真实信源 |
| 作品采集 | 平台查询、采集配置 | 支持；须显式启用并设置页数/条数/窗口上限 | 有稳定身份与原文地址的作品进入现有材料链；未知作者先隔离 |
| 作品详情 | 详情查询、采集补全 | 作为采集子步骤；不独立循环刷详情 | 补全作品材料；权限和正文质量约束见主方案 |
| 研究查询 | 评论、关注、话题查询 | 本次为人工查询；异步轮询由 Worker 执行 | 研究记录；评论、关系、话题不自动成为文章 |
| 转写字幕 | 转写/字幕工具、任务结果 | 人工提交，Worker 有界轮询；当前采集详情配置不隐式附加此步骤 | 转写/字幕可人工保存附件或填补已有材料的空正文 |
| 媒体处理 | 媒体工具 | 人工查询；不自动附加到采集链 | 媒体链接可明确保存独立私有资产，不自动发新闻 |
| 上传 | 创作、媒体输入 | 不支持周期上传 | 上传资产与供应商文件引用 |
| 文本检查 | 文本检查 | 不独立定时 | 检查结果；不替代现有筛选策略 |
| 图片生成 | 创作工具 | 不支持周期生成；Worker 执行已提交任务 | 独立图片资产，人工使用 |
| 视频生成 | 创作工具 | 不支持周期生成；Worker 执行已提交任务 | 独立视频资产，人工使用 |
| AI搜索 | AI 搜索 | 本次为人工提交；Worker 轮询结果 | 研究回答和引用；只有引用原文可人工转为材料 |
| 热点研究 | 热点工具、采集配置 | 支持定时抓取榜单快照 | 趋势记录；搜索页/热词不能直接转文章 |
| 账户 | 账户与用量 | 人工同步；未预设余额/账单周期任务 | 余额/调用账单快照；费用页面只读已存数据，不直接请求供应商 |

## 栏目与接口数

| 栏目 | 接口数 |
| --- | ---: |
| 抖音 | 16 |
| 小红书 | 15 |
| 公众号 | 17 |
| 视频号 | 7 |
| 快手 | 6 |
| 哔哩哔哩 | 9 |
| 今日头条 | 5 |
| 工具 | 5 |
| GPT图片生成 | 4 |
| 短视频下载（去水印）工具 | 10 |
| Gemini图片生成 | 2 |
| 豆包图片生成 | 4 |
| 豆包视频生成 | 2 |
| AI搜索 | 13 |
| TikTok | 10 |
| X(Twitter) | 7 |
| Youtube | 4 |
| Instagram | 4 |
| 汽车之家 | 4 |
| 懂车帝 | 4 |
| 易车 | 5 |
| 多平台 | 3 |
| 微博 | 5 |
| 百家号 | 5 |
| 知乎 | 1 |
| 红狐 | 2 |
| 合计 | 169 |

## 逐接口映射

同一异步能力的提交/结果接口合并为一个用户流程；每次供应商 HTTP 调用仍独立留回执。除表中标明的提交/查询结果，均为单次响应接口；返回链接后的文件保存是本地任务子步骤。未在下列实施记录中列明证据的接口，仍为未执行；局部证据不等于完整用户路径交付。

2026-10-20 P1 记录：AKFHJMXQ、API_1790148502632、QCP75W33 已实现账号查询、同订阅切换后的时间线采集及详情查询，共用 run、队列、原始 HTTP 回执与结果；本地桩覆盖缺凭证/预算、损坏 JSON、重定向拒绝、密钥回显脱敏、大整数保真、共享限流、分页中断和版本收尾。浏览器经常驻 API/Worker 完成三家采集、绑定、显式往返切换、409 保留输入、草稿试抓以及预算等待后的停止/恢复；桌面与窄屏暗色有代表性检查。

真实联调在独立任务库完成上述三个接口各 1 次，均 HTTP 200 / code 2000，run/receipt 完成。时间线实际返回的用户名为空，首轮保留原页后暂停；补齐同稳定 ID 账号证据复用后，关双阀、无 key 从原步骤恢复成功，没有重购响应。真实累计 3 次，按公开基价保守估算上界 0.18 元，实扣未核对；全部真实预算及持钥进程已关闭。这不证明关键词/多作者、其他平台或其余 166 项已完成。全部真实调用累计上限为 20 元且不超过 100 次，生成/上传未获授权。

2026-10-20 P2 记录：FXDGJO1V、ATY07YGY、849ONCDF 的参考图→提交→轮询→私有文件流程已完成本地桩、常驻 Worker 和后台浏览器验收；已有任务 ID 查询不重新生成，保存失败恢复原步骤，上传/提交未知不自动重发。图片结果、引用保护和删除复用 stored_files；独立库实际备份恢复及 dev/构建版 Web 上传代理验证通过。[逐处截图和批注](reviews/redfox-ui-2026-10-20/README.md)覆盖表单、参考选择/取消、等待/进度、结果/历史、删除保护、既有任务和窄屏。FXDGJO1V 文档把 file 标 query、说明为 MultipartFile 且示例不一致，实现采用 multipart file 加 format query；这一供应商真实协议尚未联调。生成按尺寸/张数的实际计费口径未明确，不提供伪精确估价；免费上传/轮询仍计请求预算。以上均为合成调用，真实累计仍为 3 次。

2026-10-20 P3 记录：微博五项和公众号17项已完成查询、本地导入及对应浏览器验收，微博另验证有界搜索/研究快照定时；公众号主采集切换已确认允许显式选库、默认广域并展示T+1延迟，保留原周期且不自动跨库；已初始化信源的双库切换/采集及显式切回已完成本地阶段验收，用户进一步确认首次最多8条、全部标记历史回填，该补充分支已完成本地后端与界面验收。抖音14项同步查询与本地导入已完成后端定向回归和对应本地浏览器验收，定时采集仍在实施；短链和泛化ID不自动推断。小红书11项同步查询与本地导入也已完成后端及浏览器阶段验收，包含变化签名参数复用旧文章、推荐候选与研究分型及人工补录。详见主方案第9节及[界面截图批注](reviews/redfox-ui-2026-10-20/README.md)，未列实测的其余接口仍未交付，不从目录覆盖推定运行覆盖。

2026-10-20 补充检查点：视频号5项、快手4项查询已完成后端与后台本地桩验收，11次UI请求及189–213截图证明查询、缺项展示、分页与输入错误路径，未接通人工导入/定时。今日头条4项查询、导入与同作品显式补全已完成本地阶段验收，9次UI合成查询/6次本地绑定导入及214–240截图批注，保留原归属与发现时间；前端48项定向回归/typecheck/build通过。汽车之家4/懂车帝4/易车5/百家号5/知乎1共19项查询后端已审，官方19样本/实际19wire与7项专项及24项共享回归/typecheck通过，界面、导入、定时仍未完成。缺作者字段按具体接口及已核实账号上下文判断，不把账号定向查询与跨作者搜索混为一类；不据昵称建立永久绑定。真实累计仍3次，未列证据的能力仍未交付。

### 抖音（16）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [P5CHB3BZ](https://redfox.hk/apis/douyin/P5CHB3BZ) · 搜索关键词获取抖音账号 (优质库) | `POST /story/api/dyData/searchUser` | `keyword*`, `offset`, `sortType` | 账号；单次响应；响应示例非合法 JSON、T+1 |
| [L6OUNUN1](https://redfox.hk/apis/douyin/L6OUNUN1) · 搜索关键词获取抖音账号 (广域库) | `POST /story/api/dy/data/searchAccount` | `keyword*`, `pageNum`, `pageSize` | 账号；单次响应；限时开放、T+1 |
| [QEQLCKD6](https://redfox.hk/apis/douyin/QEQLCKD6) · 获取抖音账号作品列表 (优质库) | `POST /story/api/dyData/queryWorkList` | `accountId`, `authorUrl`, `secUserId`, `offset`, `sortType` | 作品采集；单次响应；响应示例非合法 JSON、T+1 |
| [QSL2ZSXM](https://redfox.hk/apis/douyin/QSL2ZSXM) · 获取抖音账号作品列表 (广域库) | `POST /story/api/dy/data/listWorkByAccount` | `userId`, `uniqueName`, `shortId`, `pageNum`, `pageSize`, `startDate`, `endDate` | 作品采集；单次响应；限时开放、T+1 |
| [774OBKK0](https://redfox.hk/apis/douyin/774OBKK0) · 搜索关键词获取抖音作品 (优质库) | `POST /story/api/dyData/searchArticle` | `keyword*`, `startDate`, `endDate`, `offset`, `sortType` | 作品采集；单次响应；响应示例非合法 JSON、T+1 |
| [OWIBYU1V](https://redfox.hk/apis/douyin/OWIBYU1V) · 搜索关键词获取抖音作品 (广域库) | `POST /story/api/dy/data/searchWork` | `keyword`, `exactMatch`, `startDate`, `endDate`, `pageNum`, `pageSize` | 作品采集；单次响应；限时开放、T+1 |
| [0OT1E306](https://redfox.hk/apis/douyin/0OT1E306) · 获取抖音作品内容详情 (优质库) | `POST /story/api/dyData/queryWork` | `workId`, `workUrl` | 作品详情；单次响应；T+1 |
| [FK67XDVQ](https://redfox.hk/apis/douyin/FK67XDVQ) · 获取抖音作品内容详情 (广域库) | `POST /story/api/dy/data/workDetail` | `videoId*` | 作品详情；单次响应；限时开放、T+1 |
| [20060017](https://redfox.hk/apis/douyin/20060017) · 抖音热门账号推荐 | `POST /story/api/dyData/query` | `dateType*`, `rankDate*`, `type*` | 账号；单次响应；T+1 |
| [HUCIASU](https://redfox.hk/apis/douyin/HUCIASU) · 抖音每日热门作品榜 | `POST /story/api/dy/search/likesRank` | `type*`, `startTime*`, `endTime*` | 作品采集；单次响应；T+1 |
| [XUT4CECZ](https://redfox.hk/apis/douyin/XUT4CECZ) · 获取抖音账号信息  (优质库) | `POST /story/api/dyData/queryUser` | `accountId*` | 账号；单次响应；T+1 |
| [I8P3HTVH](https://redfox.hk/apis/douyin/I8P3HTVH) · AI垂类——搜索抖音AI相关作品 | `POST /story/api/parseWork/queryDyAiMsgs` | `keyword*`, `pageNum`, `pageSize`, `startTime`, `endTime` | 作品采集；单次响应；响应示例非合法 JSON、T+1 |
| [WD6UT8DQ](https://redfox.hk/apis/douyin/WD6UT8DQ) · 抖音每日点赞飙升榜 | `POST /story/api/dy/search/getDailyRank` | `type`, `startTime` | 作品采集；单次响应；T+1 |
| [0ZB9S2FW](https://redfox.hk/apis/douyin/0ZB9S2FW) · 抖音七日点赞飙升榜 | `POST /story/api/dy/search/getWeeklyRank` | `type`, `startTime` | 作品采集；单次响应；T+1 |
| [8DCJW2ZF](https://redfox.hk/apis/douyin/8DCJW2ZF) · 视频提文案-提交任务 | `POST /story/api/parseWork/audioTextExtract/submit/douyin` | `url*` | 转写字幕；提交→D4YT0XVJ |
| [D4YT0XVJ](https://redfox.hk/apis/douyin/D4YT0XVJ) · 视频提文案-查询结果 | `POST /story/api/parseWork/audioTextExtract/result/douyin` | `taskId*` | 转写字幕；查询结果；响应示例非合法 JSON |

### 小红书（15）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [20060016](https://redfox.hk/apis/xiaohongshu/20060016) · 小红书热门账号推荐 | `POST /story/api/xhsData/query` | `dateType`, `rankDate`, `type` | 账号；单次响应；T+1 |
| [4IVIDHEN](https://redfox.hk/apis/xiaohongshu/4IVIDHEN) · 获取小红书账号信息  (优质库) | `POST /story/api/xhsUser/queryAccountDetail` | `accountId*`, `userId` | 账号；单次响应；响应示例非合法 JSON、T+1 |
| [KR1LPTBF](https://redfox.hk/apis/xiaohongshu/KR1LPTBF) · 获取小红书作品内容详情 (优质库) | `POST /story/api/xhsUser/queryWorkDetail` | `workId`, `workLink` | 作品详情；单次响应；响应示例非合法 JSON、T+1 |
| [439NFLBD](https://redfox.hk/apis/xiaohongshu/439NFLBD) · 搜索关键词获取小红书账号 (优质库) | `POST /story/api/xhsUser/searchUser` | `keyword*`, `offset`, `sortType` | 账号；单次响应；响应示例非合法 JSON、T+1 |
| [384C6W6B](https://redfox.hk/apis/xiaohongshu/384C6W6B) · 搜索关键词获取小红书作品 (优质库) | `POST /story/api/xhsUser/searchArticle` | `keyword*`, `offset`, `sortType`, `exactMatch` | 作品采集；单次响应；响应示例非合法 JSON、T+1 |
| [047JJ3UA](https://redfox.hk/apis/xiaohongshu/047JJ3UA) · AI垂类——搜索小红书AI相关作品 | `POST /story/api/parseWork/queryXhsAiMsgs` | `keyword*`, `pageNum`, `pageSize`, `startTime*`, `endTime*` | 作品采集；单次响应；响应示例非合法 JSON、T+1 |
| [5AM3X4HZ](https://redfox.hk/apis/xiaohongshu/5AM3X4HZ) · 获取小红书一级评论（广域库）-（提交任务） | `POST /story/api/xhs/commentSubmit` | `opusId*`, `dataNum*` | 研究查询；提交→LO93CE5K；限时开放、T+1 |
| [LO93CE5K](https://redfox.hk/apis/xiaohongshu/LO93CE5K) · 获取小红书一级评论（广域库）-（查询结果） | `POST /story/api/xhs/commentResult` | `taskId*@query` | 研究查询；查询结果；限时开放、T+1 |
| [3X8FGEEM](https://redfox.hk/apis/xiaohongshu/3X8FGEEM) · 小红书爆款笔记洞察 | `POST /story/api/xhs/search/search` | `keyword`, `pageNum`, `pageSize`, `startDate`, `endDate` | 作品采集；单次响应；T+1 |
| [LBYLC5AK](https://redfox.hk/apis/xiaohongshu/LBYLC5AK) · 小红书七日爆款笔记 | `GET /story/api/cozeSkill/getXhsCozeSkillDataSeven` | `rankDate@query`, `category@query` | 作品采集；单次响应；T+1 |
| [XN3ULENA](https://redfox.hk/apis/xiaohongshu/XN3ULENA) · 查询小红书账号作品列表（优质库） | `POST /story/api/xhsUser/queryWorkList` | `redId`, `userid`, `offset`, `sortType`, `publishTimeStart`, `publishTimeEnd` | 作品采集；单次响应；T+1 |
| [P3W2W18P](https://redfox.hk/apis/xiaohongshu/P3W2W18P) · 小红书黑马爆文榜 | `POST /story/api/cozeSkill/getLowPowderExplosiveArticle` | `category*`, `rankDate*` | 作品采集；单次响应；T+1 |
| [AEA6YE0J](https://redfox.hk/apis/xiaohongshu/AEA6YE0J) · 小红书每日爆款笔记榜单 | `GET /story/api/cozeSkill/getXhsCozeSkillDataOne` | `rankDate*@query`, `category*@query` | 作品采集；单次响应；T+1 |
| [DCZW5V7A](https://redfox.hk/apis/xiaohongshu/DCZW5V7A) · 视频提文案-提交任务 | `POST /story/api/parseWork/audioTextExtract/submit/xhs` | `url*` | 转写字幕；提交→9UHXOXSF |
| [9UHXOXSF](https://redfox.hk/apis/xiaohongshu/9UHXOXSF) · 视频提文案-查询结果 | `POST /story/api/parseWork/audioTextExtract/result/xhs` | `taskId*` | 转写字幕；查询结果；响应示例非合法 JSON |

### 公众号（17）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [6C4A77XR](https://redfox.hk/apis/gongzhonghao/6C4A77XR) · 获取公众号账号信息  (优质库) | `POST /story/api/gzhData/queryUser` | `account*`, `accountName` | 账号；单次响应；T+1 |
| [KUQYSQNX](https://redfox.hk/apis/gongzhonghao/KUQYSQNX) · 获取公众号账号信息  (广域库) | `POST /story/api/gzh/data/accountInfo` | `account`, `wxId`, `bizInfo` | 账号；单次响应；限时开放、T+1 |
| [XEO0QQNF](https://redfox.hk/apis/gongzhonghao/XEO0QQNF) · 根据作品uuid获取公众号作品 (优质库) | `POST /story/api/gzhData/queryWork` | `workUuid*` | 作品详情；单次响应；T+1 |
| [1LDQ7E1C](https://redfox.hk/apis/gongzhonghao/1LDQ7E1C) · 根据作品uuid获取公众号作品 (广域库) | `POST /story/api/gzh/data/workDetail` | `workUuid*` | 作品详情；单次响应；限时开放、T+1 |
| [DNVPQZEZ](https://redfox.hk/apis/gongzhonghao/DNVPQZEZ) · 搜索关键词获取公众号账号 (优质库) | `POST /story/api/gzhData/searchUser` | `keyword*`, `offset`, `sortType` | 账号；单次响应；响应示例非合法 JSON、T+1 |
| [5Y84NI1D](https://redfox.hk/apis/gongzhonghao/5Y84NI1D) · 搜索关键词获取公众号账号 (广域库) | `POST /story/api/gzh/data/searchUser` | `keyword*`, `offset` | 账号；单次响应；限时开放、T+1 |
| [PW97QFBS](https://redfox.hk/apis/gongzhonghao/PW97QFBS) · 搜索关键词获取公众号作品 (优质库) | `POST /story/api/gzhData/searchArticle` | `keyword*`, `offset`, `sortType`, `exactMatch` | 作品采集；单次响应；响应示例非合法 JSON、T+1 |
| [FVQ8D4W5](https://redfox.hk/apis/gongzhonghao/FVQ8D4W5) · 搜索关键词获取公众号作品 (广域库) | `POST /story/api/gzh/data/searchArticle` | `keyword*`, `exactMatch`, `offset`, `sortType` | 作品采集；单次响应；限时开放、T+1 |
| [XNV30XZ3](https://redfox.hk/apis/gongzhonghao/XNV30XZ3) · 获取公众号账号作品列表 (优质库) | `POST /story/api/gzhData/queryWorkList` | `account*`, `accountName`, `offset`, `sortType`, `publishTimeStart`, `publishTimeEnd` | 作品采集；单次响应；响应示例非合法 JSON、T+1 |
| [8IQD0BJC](https://redfox.hk/apis/gongzhonghao/8IQD0BJC) · 获取公众号账号作品列表 (广域库) | `POST /story/api/gzh/data/queryWorkList` | `account`, `wxId`, `bizInfo`, `offset`, `sortType` | 作品采集；单次响应；限时开放、T+1 |
| [IE0887SO](https://redfox.hk/apis/gongzhonghao/IE0887SO) · AI垂类——搜索公众号AI相关作品 | `POST /story/api/parseWork/queryAiMsgs` | `keyword*`, `pageNum*`, `pageSize*`, `startTime`, `endTime` | 作品采集；单次响应；响应示例非合法 JSON、T+1 |
| [I3CIBRI2](https://redfox.hk/apis/gongzhonghao/I3CIBRI2) · 根据作品地址获取公众号作品（实时） | `POST /story/api/gzh/ability/temp/article/content` | `articleUrl*` | 作品详情；单次响应；限时开放 |
| [ZIGAGYYT](https://redfox.hk/apis/gongzhonghao/ZIGAGYYT) · 公众号10W+文章推荐 | `POST /story/api/cozeSkill/getTenWReadingRank` | `type*`, `startDate*`, `endDate*` | 作品采集；单次响应；T+1 |
| [OFFSPQ0U](https://redfox.hk/apis/gongzhonghao/OFFSPQ0U) · 公众号原创爆款文章推荐 | `POST /story/api/cozeSkill/getOriginalRank` | `type*`, `startDate*`, `endDate*` | 作品采集；单次响应；T+1 |
| [DL4YNCTQ](https://redfox.hk/apis/gongzhonghao/DL4YNCTQ) · 公众号阅读增长榜单 | `GET /story/api/cozeSkill/getGzhCozeSkillDataRaise` | `rankDate*@query` | 作品采集；单次响应；T+1、账号增长榜含代表作品，仅实际作品可入库 |
| [JBGBKQ4B](https://redfox.hk/apis/gongzhonghao/JBGBKQ4B) · 公众号综合实力榜 | `GET /story/api/cozeSkill/getGzhCozeSkillDataIndex` | `rankType*@query`, `rankDate*@query`, `category*@query` | 账号；单次响应；T+1 |
| [API_1789637464311](https://redfox.hk/apis/gongzhonghao/API_1789637464311) · 公众号头条增长榜 | `POST /story/api/gzh/heima/rankList` | `page`, `rank_date`, `author_type`, `sort` | 账号；单次响应；new、返回账号增长指标，不是作品列表 |

### 视频号（7）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [E7G00COY](https://redfox.hk/apis/shipinhao/E7G00COY) · 搜索关键词获取视频号作品 (广域库) | `POST /story/api/sphAllData/searchWork` | `keyword*`, `sort`, `page`, `size`, `exactMatch` | 作品采集；单次响应；限时开放、T+1 |
| [NL4I3533](https://redfox.hk/apis/shipinhao/NL4I3533) · 搜索关键词获取视频号账号 (广域库) | `POST /story/api/sphAllData/searchUser` | `accountName*`, `page`, `pageSize` | 账号；单次响应；限时开放、响应示例非合法 JSON、T+1 |
| [OE4KUEUO](https://redfox.hk/apis/shipinhao/OE4KUEUO) · 获取视频号作品内容详情 (广域库) | `POST /story/api/sphAllData/queryWorkDetail` | `videoId*` | 作品详情；单次响应；限时开放、T+1 |
| [OVUTOTCV](https://redfox.hk/apis/shipinhao/OVUTOTCV) · 获取视频号账号作品列表 (广域库) | `POST /story/api/sphAllData/queryWorkList` | `nickname*`, `page`, `size` | 作品采集；单次响应；限时开放、T+1 |
| [HR8CU3GG](https://redfox.hk/apis/shipinhao/HR8CU3GG) · 链接提文案-提交任务（视频号） | `POST /story/api/parseWork/sphSubtitle/submit` | `url*` | 转写字幕；提交→6QSXFDZV |
| [6QSXFDZV](https://redfox.hk/apis/shipinhao/6QSXFDZV) · 链接提文案-查询结果 | `POST /story/api/parseWork/sphSubtitle/result` | `taskId*` | 转写字幕；查询结果；响应示例非合法 JSON |
| [MH5YA9DL](https://redfox.hk/apis/shipinhao/MH5YA9DL) · 视频号作品链接更新详情（实时） | `POST /story/api/sph/ability/workLinkDetail` | `url*` | 作品详情；单次响应；限时开放 |

### 快手（6）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [GU17EVLV](https://redfox.hk/apis/kuaishou/GU17EVLV) · 快手账号搜索（广域库） | `POST /story/api/ksAllData/searchUser` | `accountName*`, `page*`, `pageSize*` | 账号；单次响应；限时开放、T+1 |
| [27DQ6SF9](https://redfox.hk/apis/kuaishou/27DQ6SF9) · 快手按账号获取作品列表(广域库) | `POST /story/api/ksAllData/queryWorkList` | `kwaiId`, `threeXId`, `page*`, `size*` | 作品采集；单次响应；限时开放、T+1 |
| [UOM99OQI](https://redfox.hk/apis/kuaishou/UOM99OQI) · 快手按作品获取正文详情（广域库） | `POST /story/api/ksAllData/queryWorkDetail` | `photoId*` | 作品详情；单次响应；限时开放、T+1 |
| [ZWR31P2A](https://redfox.hk/apis/kuaishou/ZWR31P2A) · 快手按关键词搜索作品（广域库） | `POST /story/api/ksAllData/searchWork` | `keyword*`, `page*`, `size*`, `sort*` | 作品采集；单次响应；限时开放、T+1 |
| [8TUUDDCJ](https://redfox.hk/apis/kuaishou/8TUUDDCJ) · 视频提文案-提交任务 | `POST /story/api/parseWork/audioTextExtract/submit/kuaishou` | `url*` | 转写字幕；提交→PNNXJ463 |
| [PNNXJ463](https://redfox.hk/apis/kuaishou/PNNXJ463) · 视频提文案-查询结果 | `POST /story/api/parseWork/audioTextExtract/result/kuaishou` | `taskId*` | 转写字幕；查询结果；响应示例非合法 JSON |

### 哔哩哔哩（9）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [TIN1NMTZ](https://redfox.hk/apis/bilibili/TIN1NMTZ) · 获取哔哩哔哩作品内容详情 (优质库) | `POST /story/api/bili/data/workDetail` | `bvId`, `workUrl` | 作品详情；单次响应；T+1 |
| [EH53TOT7](https://redfox.hk/apis/bilibili/EH53TOT7) · 获取哔哩哔哩账号信息 (优质库) | `POST /story/api/bili/data/accountDetail` | `mid*` | 账号；单次响应；T+1 |
| [ZXJLJQ21](https://redfox.hk/apis/bilibili/ZXJLJQ21) · 搜索关键词获取哔哩哔哩账号 (优质库) | `POST /story/api/bili/data/accountSearch` | `keyword*`, `page*`, `pageSize`, `order` | 账号；单次响应；T+1 |
| [LEN9QXR3](https://redfox.hk/apis/bilibili/LEN9QXR3) · 搜索关键词获取哔哩哔哩作品 (优质库) | `POST /story/api/bili/data/workSearch` | `keyword*`, `exactMatch`, `page*`, `pageSize`, `order` | 作品采集；单次响应；T+1 |
| [VPA67I98](https://redfox.hk/apis/bilibili/VPA67I98) · 获取哔哩哔哩账号作品列表 (优质库) | `POST /story/api/bili/data/accountWorkList` | `mid`, `accountUrl`, `page`, `pageSize`, `order` | 作品采集；单次响应；T+1 |
| [9Q2PQBKU](https://redfox.hk/apis/bilibili/9Q2PQBKU) · 获取哔哩哔哩音频地址 | `POST /story/api/parseWork/audioExtract/bilibili` | `url*` | 媒体处理；单次响应 |
| [SQ4FHFZX](https://redfox.hk/apis/bilibili/SQ4FHFZX) · 链接提文案-提交任务（哔哩哔哩） | `POST /story/api/parseWork/bilibiliSubtitle/submit` | `url*` | 转写字幕；提交→YYXG62WO |
| [YYXG62WO](https://redfox.hk/apis/bilibili/YYXG62WO) · 链接提文案-查询结果 | `POST /story/api/parseWork/bilibiliSubtitle/result` | `taskId*` | 转写字幕；查询结果 |
| [API_1792053861083](https://redfox.hk/apis/bilibili/API_1792053861083) · 哔哩哔哩视频字幕提取 | `POST /story/api/parseWork/videoSubtitle/bili` | `url*` | 转写字幕；单次响应 |

### 今日头条（5）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [28CFGF5I](https://redfox.hk/apis/jinritoutiao/28CFGF5I) · 搜索今日头条作品列表 (实时) | `POST /story/api/toutiao/searchWork` | `keyword*`, `offset*` | 作品采集；单次响应；限时开放 |
| [PAB6Z75Y](https://redfox.hk/apis/jinritoutiao/PAB6Z75Y) · 获取今日头条作品内容详情 (实时) | `POST /story/api/toutiao/workDetail` | `opusId*` | 作品详情；单次响应；限时开放 |
| [ZMFVK589](https://redfox.hk/apis/jinritoutiao/ZMFVK589) · 获取今日头条作品评论 (实时) | `POST /story/api/toutiao/workComment` | `opusId*`, `offset` | 研究查询；单次响应；限时开放 |
| [4QS1F8DE](https://redfox.hk/apis/jinritoutiao/4QS1F8DE) · 获取今日头条关键词搜索账号 (实时) | `POST /story/api/toutiao/searchAccount` | `name*`, `offset`, `searchId` | 账号；单次响应；限时开放 |
| [R1IGR09H](https://redfox.hk/apis/jinritoutiao/R1IGR09H) · 获取今日头条账号作品列表 (实时) | `POST /story/api/toutiao/userWorkList` | `category*`, `token*`, `offset*` | 作品采集；单次响应；限时开放 |

### 工具（5）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [FXDGJO1V](https://redfox.hk/apis/tool/FXDGJO1V) · 上传图片 | `POST /story/api/parseWork/imageGen/uploadImage` | `format*@query`, `file*[File]@query` | 上传；单次响应 |
| [6L178PZD](https://redfox.hk/apis/tool/6L178PZD) · 上传视频/图片/音频 | `POST /story/api/parseWork/videoGen/uploadFile` | `format*@query`, `file*[File]@query` | 上传；单次响应 |
| [API_1791881343238](https://redfox.hk/apis/tool/API_1791881343238) · 多平台违禁词查询 | `POST /story/api/cozeSkill/sensitiveWordSearch` | `content*` | 文本检查；单次响应 |
| [API_1792033347215](https://redfox.hk/apis/tool/API_1792033347215) · 视频播放链接提取文案-提交任务 | `POST /story/api/parseWork/audioTextExtract/submit/videoUrl` | `url*` | 转写字幕；提交→3J8LSOJZ |
| [3J8LSOJZ](https://redfox.hk/apis/tool/3J8LSOJZ) · 视频播放链接提取文案-查询结果 | `POST /story/api/parseWork/audioTextExtract/result` | `taskId*` | 转写字幕；查询结果 |

### GPT图片生成（4）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [ATY07YGY](https://redfox.hk/apis/tool-gpt-image/ATY07YGY) · 提交GPT-Image-2图片生成任务 | `POST /story/api/parseWork/imageGen/gptImage2Submit` | `prompt*`, `resolution*`, `size*`, `n*`, `referenceImages*` | 图片生成；提交→849ONCDF |
| [849ONCDF](https://redfox.hk/apis/tool-gpt-image/849ONCDF) · 查询GPT-Image-2图片生成结果 | `POST /story/api/parseWork/imageGen/gptImage2Result` | `taskId*` | 图片生成；查询结果 |
| [API_1791533630312](https://redfox.hk/apis/tool-gpt-image/API_1791533630312) · 提交GPT-Image-2.5图片生成任务 | `POST /story/api/parseWork/imageGen/gptImage25Submit` | `REDFOX_API_KEY@header`, `prompt*`, `resolution*`, `size*`, `referenceImages*`, `background*` | 图片生成；提交→API_1791533630405 |
| [API_1791533630405](https://redfox.hk/apis/tool-gpt-image/API_1791533630405) · 查询GPT-Image-2.5图片生成结果 | `POST /story/api/parseWork/imageGen/gptImage25Result` | `REDFOX_API_KEY@header`, `taskId*` | 图片生成；查询结果 |

### 短视频下载（去水印）工具（10）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [AWUTFI4V](https://redfox.hk/apis/tool-video-download/AWUTFI4V) · 短视频下载器 | `POST /story/api/parseWork/parse` | `url*` | 媒体处理；单次响应；响应示例非合法 JSON |
| [D52IUEIM](https://redfox.hk/apis/tool-video-download/D52IUEIM) · YouTube视频下载 | `POST /story/api/parseWork/videoDownload/youtube` | `url*` | 媒体处理；单次响应 |
| [7UW1PT1F](https://redfox.hk/apis/tool-video-download/7UW1PT1F) · X(Twitter)视频下载 | `POST /story/api/parseWork/videoDownload/x` | `url*` | 媒体处理；单次响应 |
| [MQMDU19Q](https://redfox.hk/apis/tool-video-download/MQMDU19Q) · TikTok视频下载 | `POST /story/api/parseWork/videoDownload/tiktok` | `url*` | 媒体处理；单次响应 |
| [QPNFJRG1](https://redfox.hk/apis/tool-video-download/QPNFJRG1) · 小红书视频下载 | `POST /story/api/parseWork/videoDownload/xhs` | `url*` | 媒体处理；单次响应 |
| [U2NJ13MW](https://redfox.hk/apis/tool-video-download/U2NJ13MW) · 视频号视频下载 | `POST /story/api/parseWork/videoDownload/sph` | `url*` | 媒体处理；单次响应 |
| [0W27H3O6](https://redfox.hk/apis/tool-video-download/0W27H3O6) · 抖音视频下载 | `POST /story/api/parseWork/videoDownload/douyin` | `url*` | 媒体处理；单次响应 |
| [0ZIWOO8P](https://redfox.hk/apis/tool-video-download/0ZIWOO8P) · 快手视频下载 | `POST /story/api/parseWork/videoDownload/kuaishou` | `url*` | 媒体处理；单次响应 |
| [CWX77QIH](https://redfox.hk/apis/tool-video-download/CWX77QIH) · 哔哩哔哩视频下载 | `POST /story/api/parseWork/videoDownload/bilibili` | `url*` | 媒体处理；单次响应 |
| [UUSP1G1P](https://redfox.hk/apis/tool-video-download/UUSP1G1P) · Instagram视频下载 | `POST /story/api/parseWork/videoDownload/instagram` | `url*` | 媒体处理；单次响应 |

### Gemini图片生成（2）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [API_1791793667945](https://redfox.hk/apis/tool-gemini-image/API_1791793667945) · 提交Gemini Nano Banana 2.1图片生成任务 | `POST /story/api/parseWork/imageGen/geminiBanana21Submit` | `REDFOX_API_KEY@header`, `prompt*`, `size*`, `imageUrls*`, `metadata*`, `resolution*` | 图片生成；提交→API_1791793668017 |
| [API_1791793668017](https://redfox.hk/apis/tool-gemini-image/API_1791793668017) · 查询Gemini Nano Banana 2.1图片生成结果 | `POST /story/api/parseWork/imageGen/geminiBanana21Result` | `REDFOX_API_KEY@header`, `taskId*` | 图片生成；查询结果 |

### 豆包图片生成（4）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [K8CWLR4I](https://redfox.hk/apis/tool-doubao-image/K8CWLR4I) · Seedream 5.0 Pro 提交任务 | `POST /story/api/parseWork/imageGen/arkProSubmit` | `prompt*`, `image`, `size*`, `outputFormat`, `responseFormat`, `watermark`, `optimizePromptOptions`, `mode` | 图片生成；提交→HMOMP642 |
| [HMOMP642](https://redfox.hk/apis/tool-doubao-image/HMOMP642) · Seedream 5.0 Pro 查询任务 | `POST /story/api/parseWork/imageGen/arkProResult` | `taskId*` | 图片生成；查询结果；响应示例非合法 JSON |
| [7OM96HCF](https://redfox.hk/apis/tool-doubao-image/7OM96HCF) · Seedream 5.0 lite 提交任务 | `POST /story/api/parseWork/imageGen/arkSubmit` | `prompt*`, `image`, `size*`, `sequentialImageGeneration`, `sequentialImageGenerationOptions`, `maxImages`, `outputFormat`, `responseFormat`, `watermark`, `optimizePromptOptions`, `mode` | 图片生成；提交→WH5U8KZE |
| [WH5U8KZE](https://redfox.hk/apis/tool-doubao-image/WH5U8KZE) · Seedream 5.0 lite 查询任务 | `POST /story/api/parseWork/imageGen/arkResult` | `taskId*` | 图片生成；查询结果；响应示例非合法 JSON |

### 豆包视频生成（2）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [JE93E37A](https://redfox.hk/apis/tool-doubao-video/JE93E37A) · 提交Seedance-2.0视频生成任务 | `POST /story/api/parseWork/videoGen/seedanceSubmit` | `prompt*`, `url`, `aspectRatio*`, `role`, `duration*`, `resolution*`, `generateAudio*`, `returnLastFrame*`, `imageWithRoles*` | 视频生成；提交→VBALJNC7 |
| [VBALJNC7](https://redfox.hk/apis/tool-doubao-video/VBALJNC7) · 查询Seedance-2.0视频生成结果 | `POST /story/api/parseWork/videoGen/seedanceResult` | `taskId*` | 视频生成；查询结果 |

### AI搜索（13）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [USDIOVU24](https://redfox.hk/apis/tool-ai-search/USDIOVU24) · kimi-K3纯文字搜索 提交任务 | `POST /story/api/kimi/submitK3` | `inquiryText*` | AI搜索；提交→IUAIUVB24 |
| [USDIOVU23](https://redfox.hk/apis/tool-ai-search/USDIOVU23) · kimi-K2.5纯文字搜索 提交任务 | `POST /story/api/kimi/submit` | `inquiryText*` | AI搜索；提交→IUAIUVB24 |
| [IUAIUVB24](https://redfox.hk/apis/tool-ai-search/IUAIUVB24) · kimi纯文字搜索 查询任务(通用) | `POST /story/api/kimi/result` | `taskId*` | AI搜索；查询结果 |
| [O0DGBU8M](https://redfox.hk/apis/tool-ai-search/O0DGBU8M) · 元宝纯文字搜索 提交任务 | `POST /story/api/deepSearch/ybSubmit` | `inquiryText*` | AI搜索；提交→PVQWHXGO |
| [PVQWHXGO](https://redfox.hk/apis/tool-ai-search/PVQWHXGO) · 元宝纯文字搜索 查询任务 | `POST /story/api/deepSearch/ybResult` | `taskId*` | AI搜索；查询结果 |
| [3AFD5MIX](https://redfox.hk/apis/tool-ai-search/3AFD5MIX) · 千问纯文字搜索 提交任务 | `POST /story/api/deepSearch/qwSubmit` | `inquiryText*` | AI搜索；提交→QLG22Y7Y |
| [QLG22Y7Y](https://redfox.hk/apis/tool-ai-search/QLG22Y7Y) · 千问纯文字搜索 查询任务 | `POST /story/api/deepSearch/qwResult` | `taskId*` | AI搜索；查询结果 |
| [UOTABJXI](https://redfox.hk/apis/tool-ai-search/UOTABJXI) · 百度纯文字搜索 提交任务 | `POST /story/api/deepSearch/bdSubmit` | `inquiryText*` | AI搜索；提交→T8BIOV6J |
| [T8BIOV6J](https://redfox.hk/apis/tool-ai-search/T8BIOV6J) · 百度纯文字搜索 查询任务 | `POST /story/api/deepSearch/bdResult` | `taskId*` | AI搜索；查询结果 |
| [I9R9LIDL](https://redfox.hk/apis/tool-ai-search/I9R9LIDL) · 豆包纯文字搜索 提交任务 | `POST /story/api/deepSearch/dbSubmit` | `inquiryText*` | AI搜索；提交→3A3CIGL8 |
| [3A3CIGL8](https://redfox.hk/apis/tool-ai-search/3A3CIGL8) · 豆包纯文字搜索 查询任务 | `POST /story/api/deepSearch/dbResult` | `taskId*` | AI搜索；查询结果 |
| [KGX4SDXQ](https://redfox.hk/apis/tool-ai-search/KGX4SDXQ) · Deepseek纯文字搜索 提交任务 | `POST /story/api/deepSearch/dsSubmit` | `inquiryText*` | AI搜索；提交→AJWHKFQI |
| [AJWHKFQI](https://redfox.hk/apis/tool-ai-search/AJWHKFQI) · Deepseek纯文字搜索 查询任务 | `POST /story/api/deepSearch/dsResult` | `taskId*` | AI搜索；查询结果 |

### TikTok（10）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [6SE9WIHJ](https://redfox.hk/apis/tool-tiktok/6SE9WIHJ) · TikTok获取单个作品数据 | `POST /story/api/tiktok/ability/awemeDetail` | `awemeId*` | 作品详情；单次响应 |
| [R473NUE9](https://redfox.hk/apis/tool-tiktok/R473NUE9) · TikTok获取用户主页作品数据 | `POST /story/api/tiktok/ability/userAwemeList` | `secUserId*` | 作品采集；单次响应 |
| [PXZXY8KQ](https://redfox.hk/apis/tool-tiktok/PXZXY8KQ) · TikTok关键词视频搜索 | `POST /story/api/tiktok/ability/searchVideo` | `keyword*`, `offset`, `count`, `sortType`, `publishTime`, `region` | 作品采集；单次响应 |
| [VBBTYLMV](https://redfox.hk/apis/tool-tiktok/VBBTYLMV) · TikTok关键词搜索用户 | `POST /story/api/tiktok/ability/searchUser` | `keyword*`, `offset*`, `count*`, `followerCountFilter`, `profileTypeFilter`, `otherPrefFilter` | 账号；单次响应 |
| [API_1790149158205](https://redfox.hk/apis/tool-tiktok/API_1790149158205) · 获取指定话题作品数据 | `POST /story/api/tiktok/ability/topicAwemeList` | `ch_id`, `cursor`, `region` | 作品采集；单次响应；new |
| [API_1790149281139](https://redfox.hk/apis/tool-tiktok/API_1790149281139) · 指定关键词话题搜索 | `POST /story/api/tiktok/ability/searchTopic` | `keyword`, `offset` | 研究查询；单次响应；new |
| [API_1790577699794](https://redfox.hk/apis/tool-tiktok/API_1790577699794) · 获取指定用户的关注列表数据 | `POST /story/api/tiktok/ability/userFollowing` | `REDFOX_API_KEY@header`, `userId`, `secUserId`, `minTime*`, `pageToken*` | 研究查询；单次响应；new |
| [API_1790581450500](https://redfox.hk/apis/tool-tiktok/API_1790581450500) · 获取用户喜欢作品数据 | `POST /story/api/tiktok/ability/userFavoriteAwemeList` | `sec_user_id`, `max_cursor` | 作品采集；单次响应；new |
| [API_1790581645603](https://redfox.hk/apis/tool-tiktok/API_1790581645603) · 获取单个视频评论数据 | `POST /story/api/tiktok/ability/commentList` | `aweme_id`, `cursor` | 研究查询；单次响应；new |
| [API_1791446025175](https://redfox.hk/apis/tool-tiktok/API_1791446025175) · 获取指定视频的评论回复数据 | `POST /story/api/tiktok/ability/commentReply` | `REDFOX_API_KEY@header`, `itemId*`, `commentId*`, `cursor*`, `count*` | 研究查询；单次响应 |

### X(Twitter)（7）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [ABJQXHUE](https://redfox.hk/apis/X(Twitter)/ABJQXHUE) · X(Twitter)获取评论 | `POST /story/api/x/tweetComments` | `tweetId*`, `cursor` | 研究查询；单次响应；限时开放 |
| [AKFHJMXQ](https://redfox.hk/apis/X(Twitter)/AKFHJMXQ) · X(Twitter)获取用户信息 | `POST /story/api/x/userInfo` | `screenName`, `restId` | 账号；单次响应；限时开放 |
| [5K5EG87P](https://redfox.hk/apis/X(Twitter)/5K5EG87P) · X(Twitter)搜索推文 | `POST /story/api/x/search` | `keyword*`, `searchType`, `cursor` | 关键词作品采集；逐条作者归属；单次响应；限时开放 |
| [QCP75W33](https://redfox.hk/apis/X(Twitter)/QCP75W33) · X(Twitter)获取单个推文详情 | `POST /story/api/x/tweetDetail` | `tweetId*` | 作品详情；单次响应；限时开放 |
| [API_1790063277084](https://redfox.hk/apis/X(Twitter)/API_1790063277084) · X（Twitter）热门账号榜（优质库） | `POST /story/api/x/hotAccount/rankList` | `pageNum*`, `rankDate*`, `gender*`, `category*` | 账号；单次响应；new |
| [5QY3G5TY](https://redfox.hk/apis/X(Twitter)/5QY3G5TY) · X(Twitter)获取用户关注列表 | `POST /story/api/x/userFollowing` | `screenName*`, `cursor` | 研究查询；单次响应；限时开放 |
| [API_1790148502632](https://redfox.hk/apis/X(Twitter)/API_1790148502632) · X(Twitter)获取用户发帖 | `POST /story/api/x/userTimeline` | `REDFOX_API_KEY@header`, `screenName`, `restId`, `cursor` | 作品采集；单次响应；限时开放 |

X 搜索补充核验（2026-10-20）：5K5EG87P 的字段表明确支持 keyword、searchType、cursor，结果包含 tweets、tweetId 及 user.userId，可按关键词检索并逐作者归属。searchType 默认 Top，可选 Top、Latest、Media、People、Lists；文章采集先明确使用 Top/Latest，其他类型按结果结构和用途分别验证。文档没有保证 `from:`、`OR`、排除回复等 SocialData 表达式兼容。已有多作者源转换须预览查询/权限/在途影响，未知表达式先核实或改写，不静默删除条件；具体以主方案 4.2 为准。

### Youtube（4）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [GC5SC5HS](https://redfox.hk/apis/Youtube/GC5SC5HS) · Youtube搜索视频 | `POST /story/api/youtube/searchVideo` | `searchQuery*`, `continuationToken` | 作品采集；单次响应；限时开放 |
| [609DF2IR](https://redfox.hk/apis/Youtube/609DF2IR) · Youtube获取视频详情 | `POST /story/api/youtube/videoDetail` | `videoId*` | 作品详情；单次响应；限时开放 |
| [WULKP6JP](https://redfox.hk/apis/Youtube/WULKP6JP) · Youtube获取视频评论 | `POST /story/api/youtube/videoComments` | `videoId*`, `languageCode`, `countryCode`, `sortBy`, `continuationToken` | 研究查询；单次响应；限时开放 |
| [API_1792051516512](https://redfox.hk/apis/Youtube/API_1792051516512) · YouTube视频字幕提取 | `POST /story/api/parseWork/videoSubtitle/youtube` | `url*` | 转写字幕；单次响应；限时开放 |

### Instagram（4）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [GM0TISWI](https://redfox.hk/apis/Instagram/GM0TISWI) · Instagram综合搜索 | `POST /story/api/ins/search` | `keyword*`, `paginationToken` | 作品采集；单次响应；限时开放 |
| [3YJT69FL](https://redfox.hk/apis/Instagram/3YJT69FL) · Instagram获取用户信息 | `POST /story/api/ins/userInfo` | `username`, `userId` | 账号；单次响应；限时开放 |
| [Z9M88QI8](https://redfox.hk/apis/Instagram/Z9M88QI8) · Instagram获取帖子详情 | `POST /story/api/ins/postDetail` | `codeOrUrl*` | 作品详情；单次响应；限时开放 |
| [U1SGKF2G](https://redfox.hk/apis/Instagram/U1SGKF2G) · Instagram获取帖子评论 | `POST /story/api/ins/postComment` | `codeOrUrl*`, `sortBy*`, `paginationToken` | 研究查询；单次响应；限时开放 |

### 汽车之家（4）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [CI7VW144](https://redfox.hk/apis/qichezhijia/CI7VW144) · 汽车之家关键词搜索作品 | `POST /story/api/autohome/searchWork` | `keyword*`, `offset*`, `page*`, `sourceType*` | 作品采集；单次响应；限时开放 |
| [LLCI8QTE](https://redfox.hk/apis/qichezhijia/LLCI8QTE) · 汽车之家文章详情（车家号） | `POST /story/api/autohome/articleDetail` | `workId*`, `page*` | 作品详情；单次响应；限时开放 |
| [TE6AGWAF](https://redfox.hk/apis/qichezhijia/TE6AGWAF) · 汽车之家视频详情（原创账号+车家号） | `POST /story/api/autohome/videoDetail` | `videoId*`, `videoType*` | 作品详情；单次响应；限时开放 |
| [4BOZ9DLE](https://redfox.hk/apis/qichezhijia/4BOZ9DLE) · 汽车之家作品列表（原创账号） | `POST /story/api/autohome/workList` | `authorId*`, `page*` | 作品采集；单次响应；限时开放 |

### 懂车帝（4）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [W86F8SSK](https://redfox.hk/apis/dongchedi/W86F8SSK) · 懂车帝关键词搜索作品 | `POST /story/api/dongchedi/searchWork` | `keyword*`, `offset*`, `sourceType*` | 作品采集；单次响应；限时开放 |
| [QQ5E3EZ9](https://redfox.hk/apis/dongchedi/QQ5E3EZ9) · 懂车帝作品详情 | `POST /story/api/dongchedi/workDetail` | `workId*`, `workType*` | 作品详情；单次响应；限时开放 |
| [X16I71WV](https://redfox.hk/apis/dongchedi/X16I71WV) · 懂车帝用户搜索 | `POST /story/api/dongchedi/searchUser` | `keyword*`, `offset*` | 账号；单次响应；限时开放 |
| [API_1791793668086](https://redfox.hk/apis/dongchedi/API_1791793668086) · 懂车帝账号详情+作品列表 | `POST /story/api/dongchedi/accountWorks` | `REDFOX_API_KEY@header`, `userId*` | 作品采集；单次响应；限时开放、账号信息与作品分别归一化 |

### 易车（5）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [3BXWEB6Y](https://redfox.hk/apis/yiche/3BXWEB6Y) · 易车视频详情 | `POST /story/api/yiche/videoDetail` | `workId*` | 作品详情；单次响应；限时开放 |
| [9KFOB9M2](https://redfox.hk/apis/yiche/9KFOB9M2) · 易车账号搜索 | `POST /story/api/yiche/searchAccount` | `keyword*`, `page*` | 账号；单次响应；限时开放 |
| [YGYYT0G0](https://redfox.hk/apis/yiche/YGYYT0G0) · 易车全部作品列表 | `POST /story/api/yiche/workList` | `userId*`, `timestamp*` | 作品采集；单次响应；限时开放 |
| [YIGCY5US](https://redfox.hk/apis/yiche/YIGCY5US) · 易车关键词搜索作品 | `POST /story/api/yiche/searchWork` | `keyword*`, `page*`, `sourceType*` | 作品采集；单次响应；限时开放 |
| [VYSP68M2](https://redfox.hk/apis/yiche/VYSP68M2) · 易车文章详情V2 | `POST /story/api/yiche/articleDetailV2` | `url*` | 作品详情；单次响应；限时开放 |

### 多平台（3）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [9Y4EX7RW](https://redfox.hk/apis/all/9Y4EX7RW) · 全网聚合热点TOP10列表 | `POST /story/api/hotKeyword/list` | `startDate*`, `endDate*` | 热点研究；单次响应；小时级更新 |
| [W94P1QH1](https://redfox.hk/apis/all/W94P1QH1) · 全网热搜查询（关键词） | `POST /story/api/hotSpot/getListByPlatformWithKeyword` | `platforms*`, `keywords*`, `startDate*`, `endDate*` | 热点研究；单次响应；小时级更新 |
| [S28Q6HUD](https://redfox.hk/apis/all/S28Q6HUD) · 各平台热点榜 | `GET /story/api/hotSpot/getListByPlatform` | `platform*@query`, `startDate*@query`, `endDate*@query` | 热点研究；单次响应；小时级更新 |

### 微博（5）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [API_1789098514899](https://redfox.hk/apis/weibo/API_1789098514899) · 微博内容详情 | `POST /story/api/weibo/ability/opusDetail` | `opusId*` | 作品详情；单次响应 |
| [API_1789098515117](https://redfox.hk/apis/weibo/API_1789098515117) · 微博用户详情 | `POST /story/api/weibo/ability/userDetail` | `userId*` | 账号；单次响应 |
| [API_1789098515245](https://redfox.hk/apis/weibo/API_1789098515245) · 微博账号搜索 | `POST /story/api/weibo/ability/accountSearch` | `page*`, `keyword*` | 账号；单次响应 |
| [TXQPVGJG](https://redfox.hk/apis/weibo/TXQPVGJG) · 微博关键词搜索作品 | `POST /story/api/weibo/ability/searchWork` | `searchType`, `page`, `keyword`, `extParam` | 作品采集；单次响应；限时开放 |
| [UAQ90A1F](https://redfox.hk/apis/weibo/UAQ90A1F) · 微博热搜 | `POST /story/api/weibo/ability/hotSearch` | 无 | 热点研究；单次响应；限时开放 |

### 百家号（5）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [API_1789097000710](https://redfox.hk/apis/baijiahao/API_1789097000710) · 百家号作品内容html | `POST /story/api/bjh/ability/opusHtml` | `articleId*` | 作品详情；单次响应 |
| [API_1789097000761](https://redfox.hk/apis/baijiahao/API_1789097000761) · 百家号视频详情 | `POST /story/api/bjh/ability/videoDetail` | `svId*` | 作品详情；单次响应 |
| [API_1789097000814](https://redfox.hk/apis/baijiahao/API_1789097000814) · 百家号账号信息 | `POST /story/api/bjh/ability/accountDetail` | `uk*` | 账号；单次响应 |
| [API_1789097000858](https://redfox.hk/apis/baijiahao/API_1789097000858) · 百家号关键词搜索作品 | `POST /story/api/bjh/ability/searchWork` | `sort`, `pn*`, `keyWord*` | 作品采集；单次响应 |
| [API_1789097000885](https://redfox.hk/apis/baijiahao/API_1789097000885) · 百家号账号关键词搜索 | `POST /story/api/bjh/ability/accountSearch` | `page*`, `keyword*` | 账号；单次响应 |

### 知乎（1）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [API_1789095347662](https://redfox.hk/apis/zhihu/API_1789095347662) · 知乎关键词搜索作品 | `POST /story/api/zhihu/ability/searchWork` | `offset*`, `sort`, `timeInterval`, `vertical`, `keword*` | 作品采集；单次响应 |

### 红狐（2）

| 接口 ID / 官方说明 | 请求 | 文档输入字段 | 系统用途 / 执行方式 |
| --- | --- | --- | --- |
| [API_1792036841619](https://redfox.hk/apis/redfox/API_1792036841619) · 用户余额查询 | `GET /story/web/points/api-key/balance` | `apiKey*@query` | 账户；单次响应 |
| [API_1792043329817](https://redfox.hk/apis/redfox/API_1792043329817) · 接口调用记录查询 | `GET /story/web/points/api-key/consume-flows` | `apiKey*@query`, `pageNum@query`, `pageSize@query` | 账户；单次响应 |

## 必须修正或核实的文档差异

1. 上表标注的 21 个接口至少有一个响应示例不能通过 JSON 解析；不能直接作为成功测试样本。依据字段表制作最小合成样本，并在获准的真实联调后校正。
2. 余额和调用账单接口标记 `requireAuth=false`，但 `apiKey` 是必填查询参数。密钥由后端注入并从请求摘要、回执身份、日志和错误 URL 中剔除；前端不得提交/回显该字段。
3. 上传图片文档将 `file` 标在 query，但类型为 File / MultipartFile。应按文件上传契约实现 multipart，不能把文件内容拼进 URL；上传媒体的返回字段名可能仍为 `imageUrl`。
4. 小红书评论结果是 POST + query `taskId`；提交有 `visibleAfterTime`，应按此延后轮询。`dataNum=-1` 表示全部，界面不默认或悄悄切换到无限量。
5. Kimi 结果字段表与示例的根层级不一致；其他 AI 搜索结果也应逐个解包。生成接口对参考图的必填标记与文字描述存在冲突，支持范围须由确认后的契约决定，界面应呈现具体限制。
6. 热点接口的平台数字枚举不统一；每个接口分别映射。热词/搜索页链接只保存为趋势，不直接当作作品或新闻。
7. 账单示例只有积分、原因、描述、时间，未见可用于逐笔匹配本地回执的唯一请求 ID。只能承诺账单展示和汇总核对；无关联证据的条目标为“未匹配”，不宣称精确逐笔对账。
8. 目录列出的模型名称按 Redfox 产品标签展示，不代表已验证对应官方模型版本。图像/视频任务状态、进度和结果字段各自归一化；目录未列取消接口，本地停止轮询不等于供应商取消或退款。
9. X 关键词搜索已获文档确认，复杂查询表达式等价性未获确认；关键词检索返回多个作者与兼容指定多作者表达式是两件事。实测前界面不得把未知语法标为可直接转换。
10. 身份/原文缺失不再统一留到开发时处理：按主方案 4.1.4 使用明确的详情接口或人工核实；小红书 4IVIDHEN 的 accountId 标必填，不能承诺仅 userId 调用；头条未列 uid→token 转换，视频号未列稳定作者及 videoId↔exportId 转换，知乎未列通用详情。百家号视频 playUrl 是媒体、url 是作者主页，不能冒充作品页。已知单项信息不足保存待处理结果，整页解析失败不推进；补全纳入已有预算、回执及验收，不新增表或通用解析系统。

## 完整性验收口径

逐行维护：请求编码与校验、鉴权方式、分页/异步配对、解析器、对应后台操作、结果保存方式、恢复策略、桩证据、真实联调证据。可以引用共用层的验证证据；各接口独有的参数、响应和异步差异必须单独覆盖，不为每项重复整套失败矩阵或浏览器演练。接口退出限时开放、失效或账号无权限时，保留具体不可用原因；不能用一个通用 JSON 请求框替代功能实现。以本快照 169 项作为本轮范围，新增/删除能力需更新这份清单和主方案。

2026-10-21 P3ah：新增六项同步评论/关注后端完成本地验收，50项专项/四平台回归与六份官方样本通过。ZMFVK589、API_1790577699794、API_1790581645603、API_1791446025175、WULKP6JP、U1SGKF2G 均只读研究；UI仍待验收。累计117条已接通执行链、剩余52项接口尚未接通；此计数不代表定时采集、补全与迁移收尾均已交付，169项范围不变。

2026-10-20追加：TikTok 7项同步查询与本地导入已完成本地后端/浏览器阶段验收，全部固定表单及研究/作品分型、完整整数游标、双ID/真实作者归属、缺项补证、短链限制均有证据，尚不包含定时采集和P4关系/评论。B站5项同步查询和导入后端已完成检查点，UI冻结但浏览器尚未验收；169项总范围不变，未完成能力不从静态目录推定已交付。

2026-10-20 P3o/P3p：B站5项同步查询、账号绑定、真实MID作品导入及严格BV身份完成本地阶段验收。UI#62–69共8次localhost查询、5次本地绑定/导入；旧文章归属/URL/identity/时间保留，无新增alias。缺原文/作者带依据补录，新增作者隔离、未知时间回填；9类测试预算关闭，真实仍3次。122–145逐处截图批注已补。B站其余采集/评论/转写未交付。YouTube两项查询、同视频显式补全和本地导入后端已审阅，0055仅任务库应用，UI实施中。

2026-10-20 P3q/P3r：YouTube两项同步查询、严格watch身份、本地导入与搜索结果的显式详情补全完成本地阶段验收。UI#70–75共6次合成查询/4次导入，另#76仅窄屏确认区复查并取消，合计7次桩请求；原发现时间冻结、原结果保持、旧文章复用、人工身份隔离、空页及390px有证据。146–165已逐处批注，九类测试预算关闭，真实仍3次。其余字幕/转写/采集未交付。Instagram三项同步查询/origin/身份SQL首检查点已审，发现上游count与本页items数量混淆计P3s1，已明确区分实际count与reportedCount，导入和身份专项继续实施。

2026-10-20 P3s/P3t：Instagram三项查询、账号绑定、严格p/reel身份与本地导入、同帖显式补全完成本地阶段验收。UI#77–84共8次桩查询/6次本地绑定导入，旧材料身份/归属/时间与原发现时间保持，一致时间保留、冲突时间回填；缺项人工补录新作者隔离。实际count与reportedCount已分开，166–188逐处截图批注齐全，所有UI预算关闭，真实仍3次；评论/定时采集未交付。视频号五项同步查询已完成首后端检查点审阅，0057仅任务库应用至54项（UI53），尚无导入/定时或P4验收。无稳定作者ID结果的人工归属方式正逐项向用户确认，相关导入不先实现。

2026-10-20补充：视频号/快手逐项人工导入及固定同作品详情已完成本地阶段验收（UI #105–112，8次合成查询、5次本地导入、2个明确创建的隔离external、242–265截图批注）。不建立昵称或展示号永久绑定，保留原发现时间和旧文章归属；正式采集尚未完成。五平台19查询界面已冻结待浏览器验收，剩余X/热点/账户9项后端实施中。真实仍3次，169项完整范围不变。

2026-10-20阶段补证：五平台19查询已完成后端和后台本地阶段验收，20次UI桩调用/266–309截图批注，保留身份范围及分页类型，未启用导入/定时。X研究4+热点3+账户2共9查询后端已审，新6项与32项分环境共享回归通过，0062/63仅文档价格，余额/账单为account用途、0估价，界面实施中。静态去重盘点169=102已有链路+9此检查点+58未接，链路数不等于验收数；正式采集和显式补全流程另行记录，不借同ID重复计数。

2026-10-20追加：研究/热点/账户9项现已完成后台本地阶段验收，UI10次合成调用、310–334截图批注；账户独立预算、无凭证持久化或伪造账单匹配。接口执行链路111项的事实不等于完整169验收，另58项及正式采集/补全尾部仍待；下个包为6项同步评论/关注。

2026-10-21 P3ai：六项评论/关注已完成本地后端与UI阶段验收，七次合成请求覆盖六项与空页，335–354截图批注齐全，预算关闭、真实仍3次。累计117条执行链；正式采集和其余52项、补全/迁移收尾继续实施。

计数说明：本日志中的117/169等覆盖数均按唯一接口ID计数，不是独立页面、业务任务链或已经完成正式采集的数量；异步提交与结果接口分别计入其原有两项范围，UI合并为同一工作流。

2026-10-21 P4a：六组ASR共12个固定接口后端完成本地检查点，44项专项/相关回归通过；严格data响应、三种ASR状态和毫秒分段保持各自语义，四个坏JSON文档样例未修复。累计129个接口ID已有执行入口，剩余40项尚未接通；ASR UI/材料及文件关联、整体正式采集和P5仍未完成。尚无真实ASR调用授权/验证，不将本地桩称真实供应商联调。

2026-10-21 P4b/P4c：ASR六组完成本地后端/UI阶段验收，UI9run/22合成调用，355–385逐处截图批注，所有UI预算关闭、真实仍3次。14项同步媒体/字幕元数据/文本工具后端随后完成检查点，20不同测试与13合法官方样本通过；AW非法响应原文拒绝，尚未下载媒体/字幕文件或关联文章。覆盖累计143/169个唯一接口ID，余26（AI搜索13、剩余生成10、通用上传1、小红书异步评论2）未接通；14工具UI、正式采集/补全/附件与P5继续。

2026-10-21 P4d：上述14同步工具完成后台本地阶段验收；UI #159–173共15个任务/15次合成调用，覆盖全部14项及空资源响应。11类媒体接口使用media（含空页共12次），两字幕元数据接口使用transcript，文本检查使用query；原串、0/null/未知类型、多格式字幕及安全HTML边界均有持久化/页面证据，0资源自动读取或材料导入。386–410截图已逐处批注；131项前端定向测试/typecheck/build通过，九类UI预算关闭，真实仍3次。169范围和143/26执行入口计数不变，字幕文件正文/关联、资产扩展及其他完整流程仍待。

2026-10-21 P4e/P4f：同一stored_files与私有文件路由扩展15类输入格式，m4a仅输出；实际上传、播放、下载、取消重试、409保护、成功删除、50+1分页及390px已完成本地验收，新增截图逐处批注。没有新增Redfox调用；素材不是另一套任务/媒体库生命周期。P4g固定6L178PZD通用上传后端38项回归通过；P4i十三AI搜索接口后端31项回归及13份官方合法样本通过，上传/AI搜索UI正在顺序接入。累计157/169已有执行入口，余12（生成10、小红书异步评论2）尚未接通；完整定时采集/补全/附件/账单及P5仍待。main/UI均迁移至0068，真实仍累计3次。

2026-10-21 P4h/P4j：通用上传和AI搜索完成本地UI阶段验收，5run/7次合成请求、111引用，49定向测试/typecheck/build及390px实际截图。新增显示但不保存的备注已精简，缺漏1保留；预算全关，真实仍3次。累计157/169入口、余12的口径不变；四组图片8接口正在沿现有生成链扩展，不预先算完成。

2026-10-21 P4k：API_1791533630312/0405、API_1791793667945/8017、K8CWLR4I/HMOMP642、7OM96HCF/WH5U8KZE八项沿原图片生命周期接通，56不同测试/全workspace typecheck通过；两份Seedream坏JSON原样拒绝，未真实验证。现累计165/169入口，余4（Seedance2、小红书异步评论2）；图片UI在同一区域扩展，正式采集/附件/账单/P5范围继续，真实仍3次。

P4m Seedance两项后端已验收：JE93E37A/VBALJNC7，66不同定向测试、workspace typecheck及2官方样本解析通过，未真实生成。累计167/169执行入口，余5AM3X4HZ/LO93CE5K；正式采集、补全、附件、账单与迁移收尾仍待完整验收。

P4o小红书异步评论两项后端已验收，44不同定向测试/全workspace TS与2官方样本解析通过；0071记录提交费用未知及查询0价。累计169/169具备执行入口，未等同所有端到端业务流程交付。UI、正式定时采集、缺项补全、文件关联、账单核对及迁移收尾继续。真实仍3次只读，未真实提交评论任务、上传或生成。

P5c共用订阅阶段验收：原微博生命周期已复用于抖音8、小红书7及20项其他既有平台采集，前端仍一个编辑器/列表，预览独立query不写正式订阅。六个UI任务/六次合成调用、原令牌两页、混合研究条目、零预算和原轮失效保护、后续详情及逐项人工补证均有持久化与截图证据；23张新增有效截图已逐处批注，三个临时订阅停用、预算全关，真实仍3。P5d五平台本地导入及八项采集实施中；X关键词转换/配置内补全/附件/研究下载/账单与迁移收尾未完成。169唯一接口范围不变，阶段日志中的“已接通”不替代完整业务验收。
