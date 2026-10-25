# 栏目管理与全站视频：实施与验收

对应 [完整方案](../site-presentation-and-video-plan.md)。用户于 2026-10-24 授权分阶段监督式开发；2026-10-25 进一步授权提交、推送、创建 PR 及等待 CI。合并、部署和供应商真实调用未授权。

范围说明：下文一期测试/截图只覆盖已有栏目显隐/排序/数量及全站视频。2026-10-25 用户已授权追加“独立栏目管理入口、设置页迁移、栏目改名和新建”的监督式开发；追加进度单独记在下节，不把一期证据当作新能力验收。原设置页上的栏目截图属于迁移前证据。

## 2026-10-25 Git 交付记录

本次交付包含全部栏目管理、全站视频及长名称窄屏修复。下方各阶段记录保留当时的工作区、授权与 CI 状态；当前交付状态以本节为准。分支 `codex/site-presentation-video` 基于仍打开的 PR #5（`codex/admin-workflow-usability`、`b90b198`），后续 PR 以该分支为基线，只展示本次变更。完整实现已由 `fd39fb0` 提交并推送，已创建 [PR #6](https://github.com/rankai/AIHOT/pull/6)。本次文档收尾与实现共同交付；最新提交的远端 CI 最终结果以 PR 描述和 Checks 为准。未合并、未部署、未发起供应商真实调用，也未对真实库执行历史视频回填。

可审阅截图共 **63 组原图/批注对照，另 1 张修复前复现图**：一期视频 19 组、独立栏目管理/改名/新建 34 组、长名称修复 10 组。设置页原栏目表单的截图仅为迁移前历史证据，当前入口以独立栏目管理截图为准。各阶段的验证数字有重叠，不累加为单一测试总数。

## 2026-10-25 长名称 P2 修复与验收（已完成）

用户已授权修复此前唯一的长名称窄屏适配 P2。本次增量仅涉及原有三处 JSX 的样式/文字容器及本验收记录，先前完整未提交改动保留；没有提交、推送、部署或供应商真实调用。

- 手机底栏：原 Link 可收缩，名称按格内宽度 CSS 省略；完整名称保留在 DOM 与原生 title，54px 行高和 21px 图标不变。
- 列表标题：手机标题可收缩并允许连续英文在任意位置换行；今日数量不压缩、不拆行，保留原标题/搜索/分页逻辑。
- 更多入口：原行内文字区可收缩，名称省略；图标、箭头和更新点不压缩，50px 行高保留。未新建组件、表、状态、抽象或依赖，没有缩短20字合同。

执行采用 `gpt-6.1-sol / high`，只拥有上述三处；独立复核采用 `gpt-6-astra / medium`。主控负责真实浏览器验收、恢复测试配置及最终整体复审。执行包实质错误计数为0；主控精确模型/effort仍未从运行时核实。

### 本轮验证与证据边界

本轮继续使用既有本地 `3350/3351`、独立 `aihot_columns_ui_test:55472`，供应商/模型/采集等开关关闭，没有启动 Worker，没有连接日常/生产数据。新修复验收使用 Ego 专用空间76。

| 检查 | 实际结果 |
| --- | --- |
| 定向组件回归 | **4/4**：Node24 执行 `node --test apps/web/tests/presentation-render.test.ts apps/web/tests/custom-column.test.ts apps/web/tests/video-feed-render.test.ts`，退出0。没有添加镜像CSS类名的测试。 |
| Web 类型 | `npm run typecheck -w @aihot/web` 退出0。 |
| Web 构建 | `npm run build -w @aihot/web` 退出0，日志 `/tmp/aihot-columns-p2-build.log`。 |
| 差异检查 | `git diff --check` 通过；未重跑未受影响的后端/供应商或全量371项。 |
| 长英文，320/375px | 通过后台真实表单保存20个连续W并重载后验证；列表/更多/底栏均无横向溢出，文档宽度分别为320/375px。标题全文可见，今日数不覆盖；底栏标签和更多文字在各自宽度内省略，DOM/无障碍快照及title仍有完整20字。 |
| 长中文，320/375px | 通过同一表单保存“人工智能行业热点与产品技术视频精选栏目集”（20字），深色主题下验证同三处，文档宽度分别为320/375px；标题自然换行，图标/箭头尺寸与原行高保持。 |
| 操作回归 | 375px 下原生触摸更多里的长名称入口可进入同一栏目；键盘激活底栏/更多、搜索“教程”保持产品＋Agent＋视频范围并返回正常空结果，清搜索留在本栏目，下一页仍为同栏目每页2条，实际返回2条。各底栏格中心的命中元素均为自身链接。 |
| 原样式及收尾 | 桌面实际CSS视口1163px的更多页分组/行高/主题正常，长中文空间足够时完整显示；恢复原名字后375px短名正常。原始整份presentation与备份深比较一致，主题回到跟随系统（当时为浅色），视口及触摸模拟已清除。 |

这次长名称证据来自实际“后台表单保存 → 重载 → 前台”的路径，不再仅靠临时改DOM。验收只改隔离UI库中原有四行名称；全部已恢复，审计/修改时间按原流程产生。浏览器属于Chromium模拟视口，未宣称经过iOS/Android真机或真实屏幕阅读器测试。

验证脚本曾遇到窄屏指针定位、分段文本及桌面重复主题控件的选择器失败，已按当前DOM改为精确href/主内容定位，并用原生触摸补验；跨样本切换曾读到已有预取缓存中的旧名称，按原有刷新说明复核。没有为迁就验证改变产品路由、缓存或业务逻辑。

### 本轮截图批注

**10组、20张**，原图与批注图均已由主控查看。按本轮仅本地验证、不交付Git的边界，新增图存放在本地验收目录，未复制进入仓库：

`assets/columns-p2-20261025/`

| 场景 | 原图 | 批注图 |
| --- | --- | --- |
| 320px 英文20字：列表标题、今日数量和底栏 | [原图](assets/columns-p2-20261025/01-en-320-list-raw.png) | [批注](assets/columns-p2-20261025/01-en-320-list-annotated.png) |
| 320px 英文20字：更多入口、图标/箭头和底栏 | [原图](assets/columns-p2-20261025/02-en-320-more-raw.png) | [批注](assets/columns-p2-20261025/02-en-320-more-annotated.png) |
| 375px 英文20字：完整标题断词与底栏省略 | [原图](assets/columns-p2-20261025/03-en-375-list-raw.png) | [批注](assets/columns-p2-20261025/03-en-375-list-annotated.png) |
| 375px 英文20字：更多入口及完整名称 | [原图](assets/columns-p2-20261025/04-en-375-more-raw.png) | [批注](assets/columns-p2-20261025/04-en-375-more-annotated.png) |
| 320px 中文20字：深色标题换行与底栏 | [原图](assets/columns-p2-20261025/05-zh-320-list-raw.png) | [批注](assets/columns-p2-20261025/05-zh-320-list-annotated.png) |
| 320px 中文20字：深色更多入口及原行高 | [原图](assets/columns-p2-20261025/06-zh-320-more-raw.png) | [批注](assets/columns-p2-20261025/06-zh-320-more-annotated.png) |
| 375px 中文20字：深色列表与今日条数 | [原图](assets/columns-p2-20261025/07-zh-375-list-raw.png) | [批注](assets/columns-p2-20261025/07-zh-375-list-annotated.png) |
| 375px 中文20字：深色更多与底栏 | [原图](assets/columns-p2-20261025/08-zh-375-more-raw.png) | [批注](assets/columns-p2-20261025/08-zh-375-more-annotated.png) |
| 恢复原配置及主题后的375px短名回归 | [原图](assets/columns-p2-20261025/09-restored-375-list-raw.png) | [批注](assets/columns-p2-20261025/09-restored-375-list-annotated.png) |
| 桌面布局视口1163px：长中文完整显示及原分组 | [原图](assets/columns-p2-20261025/10-desktop-more-raw.png) | [批注](assets/columns-p2-20261025/10-desktop-more-annotated.png) |

### 修复后整体复审

独立审阅和主控集成复核均未发现新的可触发P1/P2/P3。此P2在底栏、列表标题及更多入口的代码与实际窄屏表现中已关闭；完整可访问文本、现有入口、配置/排序、内容权限和查询恢复连接保持。复用此前仍有效的独立入口迁移、持久化、固定范围与公开读取评审，没有重复做一次全仓审查或扩建设施。

HEAD仍为 `b90b198edb1be260b747af3acc48a64eade1b17d`，分支仍为 `codex/site-presentation-video`；所有改动留在工作区。本地测试服务和合成库保留供查看，没有Git交付或上线。

以下是此次修复前的历史评审，P2状态以上节为准：

## 2026-10-25 再次整体评审：1 项 P2（后续已修复）

本轮按用户要求只做评审，没有修业务代码。两名独立只读审阅者使用 `gpt-6-astra / medium`，分别复核配置/入口合同与 Web 流程；主控核对当前集成代码、公开读取和定向布局复现。分支和 HEAD 不变，既有未提交改动保留。

**P2：新允许的长栏目名未完整适配手机布局。** 名称合同允许 20 字，`MobileTabBar.tsx:26` 将名称直接放入固定四等分底栏，`PoolPage.tsx:42` 的手机标题缺少可收缩及断词处理，`more.tsx:42` 的可变名称同样没有宽度保护。后台可保存的合法连续英文名称，会在手机底栏覆盖相邻入口，在列表页造成横向溢出；更多入口也应在同一修复中核对。

主控在真实本地页面的现有 DOM 中临时将标题及三个底栏文字换为 20 个 W（合同允许的输入），只验证已有 CSS，不保存配置、不修改源码：375px 视口下，文档滚动宽度由正常 360px 增至 457px；标题宽 428.83px，右边缘 444.83px；每个底栏格宽 90px，文字宽 214.20px，出现明显重叠。[布局复现截图](assets/columns-20261025-review/01-long-name-mobile.png)。截图属于临时文本样本，不能当作“已通过表单保存该名称”的证据；校验、保存与 root 下发链路已在代码/既有测试中确认。复现后已刷新恢复原始名称，并恢复默认浏览器视口；没有改 UI 库配置。

最小补齐：继续使用现有组件，标题允许收缩/断词，底栏和更多入口约束文字宽度并采用省略或受控换行，保留完整可访问名称；核对其它已接入改名的窄屏位置。补 320/375px 下长中文、连续英文的实际布局验证。不降低合同允许的名称长度，不新增组件框架或持久化。

其余本轮已核范围没有新的具体 P1/P2/P3：

- 独立入口迁移已收尾：同一后台 NAV、唯一 `/admin/columns` 挂载，设置正文和聚合读取已退出；原二维码/预算/通知职责保留。
- 预置改名和自建定义复用一项 settings、同一 navigation 顺序、原事务审计与认证/CSRF，没有平行栏目 CRUD 或第二份配置。自建 ID 稳定，原链接不随改名变化。
- 自建范围经 API 固定并传入既有 publication pool；分类/标签/视频求交，读者参数不能覆盖定义。继续按现有公开池资格、发布时间、正文展示规则及既有缓存/重建时效读取，没有从栏目配置授予内容权限。
- 查询、计数、页大小、搜索排序、卡片/详情连接及配置 503 与搜索繁忙分流均已接通；取消/放弃、错误定位、失败草稿、恢复默认保留定义、陈旧提交漏 ID 的 409 有实现和既有验证。
- 没有发现需扩大架构的理由；当前新增薄页面/DTO/展示辅助与实际边界对应，没有新增业务表、队列、任务状态或供应商路线。

本轮复用了此前后端 16/16、Web 371/371、类型/构建证据，没有将其写为本轮重跑结果；`git diff --check` 本轮通过。正常短名称的既有截图不能覆盖此次长名称缺口。当时结论为“主体落地完整，1 项窄屏适配 P2 待修”，取代该轮之前“没有剩余具体问题”的状态；P2 现已修复，见顶部新证据，不抹去下文历史验收记录。没有提交、推送、部署或供应商真实调用。

## 2026-10-25 追加开发与验收（已完成）

- 环境：`codex/site-presentation-video`，HEAD 仍为 PR #5 基线 `b90b198edb1be260b747af3acc48a64eade1b17d`；原有未提交的一期实现完整保留，本轮没有 Git 写操作。
- 独立 PostgreSQL 集群 `/tmp/aihot-columns-20261025-pg`，只监听 `127.0.0.1:55472`；测试库 `aihot_columns_test`、UI 库 `aihot_columns_ui_test`，分别应用现有 75 个迁移。没有新增表或迁移，未连接日常/生产数据库；上一轮集群保留。
- Node `v24.19.0`；凭据指向不存在的测试目录，运行目录在本任务 `/tmp`；采集、模型、Redfox、AgentKey、飞书、IndexNow 均关闭，不启动 Worker。UI 前端 `127.0.0.1:3350`，API `127.0.0.1:3351`，浏览器专用空间 72；这些是本地验收服务，不是部署。
- [x] A：唯一后台入口 `/admin/columns`，设置正文不保留栏目编辑、说明或跳转；桌面和手机继续使用同一后台 NAV。presentation GET/PUT 复用原认证/CSRF/领域/审计，聚合设置不再依赖栏目读取。
- [x] B：可选预置名称覆盖保存、重载及 root 配置下发；导航、手机更多、适用页面标题和入口同步。原路径、文章/主题/榜单实体名不变，首页品牌 SEO 保留；无额外逐页配置请求。
- [x] C：同一 navigation 草稿新建默认隐藏的自建栏目；分类、单标签、视频范围和页大小保存在原 settings 值中。统一保存/放弃、取消新行、错误定位、查看已保存版本及恢复默认均已接通。
- [x] D：`/columns/:id` 是既有 pool 的薄连接；固定范围与读者搜索分开，公开资格、查询/计数/分页/卡片/详情复用。404、非法覆盖 400、配置 503、搜索繁忙及正常空态不混淆。
- [x] E：主控操作验收、逐处原图/批注、独立只读复审完成；当前已核范围没有剩余具体 P1/P2/P3。

### 本轮监督执行与修正记录

主控精确模型/effort 无法从运行时核实，没有宣称已核实为 Astra。工具支持并实际选择的执行组合：入口迁移 `gpt-6.1-sol / high`，配置/公开读取边界 `gpt-6-astra / medium`，Web 既定集成 `gpt-6.1-sol / xhigh`；独立审阅 `gpt-6-astra / medium`。执行包按依赖顺序推进，保留其他人的修改。

- 入口迁移有一次 SSR 断言错误：把布局退出登录表单计入正文；修正验收范围，保留设置正文无入口的要求。
- 后端包出现测试类型推断错误，以及把冲突写成 `statusCode:409` 而既有 handler 实际按 `code:"conflict"` 映射的错误；累计两次后停止包，由主控诊断并局部修正，保留真实 HTTP 409 断言，未改认证处理器。
- Web Sol 包累计两次类型/夹具错误后升级到 Astra Medium；该包在 root meta matches 的 `loaderData` 形状、PoolPage 类型及夹具问题收尾时又触及升级阈值，主控接管诊断。错误分类 key `product` 改为现有 `ai-products`，UUID 夹具使用固定字面量；没有为迁就测试放宽产品合同。主控补完预置页面标题及回链名称连接。
- 新增代表性栏目名称测试首次不识别 Vite 的 SVG URL 导入，补仅用于该测试的静态资源桩后通过。完整 Web 测试首次受沙箱本机监听 EPERM 阻止，在已授权的本地测试环境重跑通过；不计作产品失败。
- 浏览器视口模拟/裁剪导致少量验收图位置不准，已用正确的实际视口重拍并目视检查；旧设置跳转图已删除。同目录保留的图片是本轮有效证据，批注只在验收 DOM 注入，不进入产品代码。

### 本轮最终验证

| 检查 | 结果与证据范围 |
| --- | --- |
| 后端定向集成 | **16/16**：`node --test --test-concurrency=1 tests/presentation-contract.test.ts tests/presentation.test.ts tests/presentation-pool.test.ts`，独立 `aihot_columns_test`。覆盖认证/CSRF、读写拆分、并发审计/回滚、旧值兼容、名称/自建持久化、陈旧表单漏 ID 的 409、分类失效隔离、固定交集、范围改动、搜索/计数/分页、后续公开材料自然进入、错误分类和真实 SearchBusy code。日志 `/tmp/aihot-columns-backend-tests.log`。 |
| Web 全部回归 | **371/371**：`node --test --test-concurrency=1 'apps/web/tests/*.test.ts'`。含实际 route loader/meta、组件 SSR、导航、草稿、名称默认/覆盖、固定条件链接与两类 503 分流。日志 `/tmp/aihot-columns-final-webtests.log`。 |
| 全项目类型检查 | `npm run typecheck` 通过；contracts/backend/API/Worker/tests/Web 均通过，日志 `/tmp/aihot-columns-final-typecheck.log`。 |
| Web 生产构建 | `npm run build -w @aihot/web` 通过，日志 `/tmp/aihot-columns-final-build.log`。这是构建，未部署。 |
| 差异检查 | `git diff --check` 通过；没有新增业务表、SQL 迁移、队列、预算、任务状态或供应商调用。 |
| 浏览器实际操作 | 后台新建/改名/显隐/排序/保存/重载 → 前台范围、搜索、分页 → 原内容详情；取消新行、放弃修改、恢复默认草稿、失败保留草稿/重试、提交中禁用、键盘新建/Tab/取消、桌面/430px/深浅主题均已核对。 |

上表是追加范围的验证，不与下方一期重叠测试数字相加。没有重跑未受影响的供应商全套测试来充数。

UI 库含 11 条合成材料：公开池 10 条，产品 9 条，Agent 标签 9 条，产品＋Agent 8 条，产品＋Agent＋确认视频 4 条（含 X）；隔离内容和缺证视频按原规则排除。通过真实后台表单保存了“产品资讯”“Agent 专区”“产品 Agent”“产品 Agent 视频”四个定义，分别验证单条件、交集和视频。未触发采集、模型或内容复制。模拟已删分类时只暂改 UI 库并完整备份，截图后恢复，实际点击“重试此栏目”已恢复正常；临时失败/等待响应拦截只限验收页且已解除。模型榜截图使用本库合成空榜单，不含真实模型评分；日报没有生成数据，故显示原空态。

### 本轮截图索引

**34 组、68 张**，每组均有原图及批注图。主控已查看批注图；同编号重拍覆盖本轮工具裁剪错误图。原一期设置编辑图仍保留在下文，明确属于迁移前历史证据。

| 场景 | 原图 | 批注图 |
| --- | --- | --- |
| 桌面独立栏目入口、统一管理列表 | [原图](assets/columns-20261025/01-entry-desktop-raw.png) | [批注](assets/columns-20261025/01-entry-desktop-annotated.png) |
| 设置正文无栏目入口；共用导航仍有 | [原图](assets/columns-20261025/02-settings-no-column-entry-raw.png) | [批注](assets/columns-20261025/02-settings-no-column-entry-annotated.png) |
| 新建空名称校验、定位、默认隐藏 | [原图](assets/columns-20261025/03-new-validation-raw.png) | [批注](assets/columns-20261025/03-new-validation-annotated.png) |
| 新建分类＋标签、页大小草稿，无未保存链接 | [原图](assets/columns-20261025/04-new-column-draft-raw.png) | [批注](assets/columns-20261025/04-new-column-draft-annotated.png) |
| 隐藏栏目直达；交集 8 条／每页 3 条 | [原图](assets/columns-20261025/05-hidden-column-public-raw.png) | [批注](assets/columns-20261025/05-hidden-column-public-annotated.png) |
| 栏目内搜索、两种排序和清除入口 | [原图](assets/columns-20261025/06-custom-search-raw.png) | [批注](assets/columns-20261025/06-custom-search-annotated.png) |
| 仅含视频条件与独立数量 | [原图](assets/columns-20261025/07-video-column-editor-raw.png) | [批注](assets/columns-20261025/07-video-column-editor-annotated.png) |
| 确认视频 4 条／每页 2 条，含 X | [原图](assets/columns-20261025/08-video-column-public-raw.png) | [批注](assets/columns-20261025/08-video-column-public-annotated.png) |
| 原详情、原文与原有返回 | [原图](assets/columns-20261025/09-custom-content-detail-raw.png) | [批注](assets/columns-20261025/09-custom-content-detail-annotated.png) |
| 本页模拟保存 503，草稿保留并可重试 | [原图](assets/columns-20261025/10-save-failure-raw.png) | [批注](assets/columns-20261025/10-save-failure-annotated.png) |
| 手机独立入口和管理列表 | [原图](assets/columns-20261025/11-admin-mobile-entry-raw.png) | [批注](assets/columns-20261025/11-admin-mobile-entry-annotated.png) |
| 手机行内编辑、未保存与查看已保存版本 | [原图](assets/columns-20261025/12-admin-mobile-edit-raw.png) | [批注](assets/columns-20261025/12-admin-mobile-edit-annotated.png) |
| 手机更多与底栏新名称 | [原图](assets/columns-20261025/13-mobile-more-raw.png) | [批注](assets/columns-20261025/13-mobile-more-annotated.png) |
| 手机自建视频列表与分页 | [原图](assets/columns-20261025/14-custom-mobile-raw.png) | [批注](assets/columns-20261025/14-custom-mobile-annotated.png) |
| 范围内空结果及清搜索 | [原图](assets/columns-20261025/15-custom-empty-raw.png) | [批注](assets/columns-20261025/15-custom-empty-annotated.png) |
| 不存在的栏目 404 | [原图](assets/columns-20261025/16-custom-not-found-raw.png) | [批注](assets/columns-20261025/16-custom-not-found-annotated.png) |
| 深色主题编辑与基础组件 | [原图](assets/columns-20261025/17-editor-dark-raw.png) | [批注](assets/columns-20261025/17-editor-dark-annotated.png) |
| 已删分类 503，保持栏目原址、重试后恢复 | [原图](assets/columns-20261025/18-custom-unavailable-raw.png) | [批注](assets/columns-20261025/18-custom-unavailable-annotated.png) |
| 精选：首页名称覆盖，品牌 SEO 保留 | [原图](assets/columns-20261025/19-name-home-raw.png) | [批注](assets/columns-20261025/19-name-home-annotated.png) |
| 全部动态名称覆盖 | [原图](assets/columns-20261025/19-name-all-raw.png) | [批注](assets/columns-20261025/19-name-all-annotated.png) |
| 视频名称覆盖 | [原图](assets/columns-20261025/19-name-videos-raw.png) | [批注](assets/columns-20261025/19-name-videos-annotated.png) |
| 热点名称覆盖 | [原图](assets/columns-20261025/19-name-hot-raw.png) | [批注](assets/columns-20261025/19-name-hot-annotated.png) |
| 日报导航/浏览器标题；原报告空态保留 | [原图](assets/columns-20261025/19-name-daily-raw.png) | [批注](assets/columns-20261025/19-name-daily-annotated.png) |
| 主题栏目名覆盖；实体名不变 | [原图](assets/columns-20261025/19-name-topics-raw.png) | [批注](assets/columns-20261025/19-name-topics-annotated.png) |
| 收藏栏目名及返回入口 | [原图](assets/columns-20261025/19-name-starred-raw.png) | [批注](assets/columns-20261025/19-name-starred-annotated.png) |
| 模型榜栏目名；本地合成空榜单 | [原图](assets/columns-20261025/19-name-leaderboard-raw.png) | [批注](assets/columns-20261025/19-name-leaderboard-annotated.png) |
| 重置监控栏目名 | [原图](assets/columns-20261025/19-name-codex-raw.png) | [批注](assets/columns-20261025/19-name-codex-annotated.png) |
| 接入指南浏览器/导航名；说明性主标题保留 | [原图](assets/columns-20261025/19-name-agent-raw.png) | [批注](assets/columns-20261025/19-name-agent-annotated.png) |
| 关于浏览器/导航名及回链；品牌主标题保留 | [原图](assets/columns-20261025/19-name-about-raw.png) | [批注](assets/columns-20261025/19-name-about-annotated.png) |
| 更新日志栏目名与反馈回链 | [原图](assets/columns-20261025/19-name-changelog-raw.png) | [批注](assets/columns-20261025/19-name-changelog-annotated.png) |
| 反馈浏览器/导航名；任务主标题保留 | [原图](assets/columns-20261025/19-name-feedback-raw.png) | [批注](assets/columns-20261025/19-name-feedback-annotated.png) |
| 仅分类新栏目：9 条／每页 4 条 | [原图](assets/columns-20261025/20-scope-category-raw.png) | [批注](assets/columns-20261025/20-scope-category-annotated.png) |
| 仅标签新栏目：9 条／每页 4 条 | [原图](assets/columns-20261025/20-scope-tag-raw.png) | [批注](assets/columns-20261025/20-scope-tag-annotated.png) |
| 本页暂停响应：禁止重复提交/新建，随后移除临时草稿 | [原图](assets/columns-20261025/21-pending-submit-raw.png) | [批注](assets/columns-20261025/21-pending-submit-annotated.png) |

### 整体复审结论与交付状态

独立审阅已核对契约/规范化、持久化归属、陈旧保存、固定范围/API/计数、分类失效及修复、root 标题/回链和编辑草稿，未发现剩余具体 P1/P2/P3。主控对当前集成结果与截图复核：没有平行栏目 CRUD、内容关联表、规则框架、第二份排序或权限来源；旧 settings 编辑器挂载和聚合读取已退出。必要新增仅为同资源 GET、薄管理/列表路由、DTO 字段、共用页面连接和有限展示辅助。

追加实施及本地验收完成，等待用户查看。工作树保留全部未提交改动；没有提交、推送、合并、部署、真实库迁移或真实调用。本地验收服务、合成 UI 配置/材料及专用测试库有意保留供用户查看，未把这些测试数据写入仓库。AgentKey 第三阶段未开始，暂缓的 5 条路线不变。

下文为 2026-10-24 一期实施与验收历史：

## 环境与分工

- 基线：PR #5 `b90b198`；原日常分支 `codex/admin-workflow-usability`，本次分支 `codex/site-presentation-video`，工作目录 `/Users/nickfury/projects/AIHOT`。保留已有两份方案文档。
- Node `v24.19.0`；临时 PostgreSQL 17.9 集群 `/tmp/aihot-site-presentation-20261024-pg`，仅 `127.0.0.1:55471`。新建 `aihot_site_presentation_test`、`aihot_site_presentation_ui_test`、`aihot_site_video_material_test`、`aihot_site_video_provider_test`，均按仓库现有 75 个迁移初始化，未改迁移历史。
- 测试与 UI 库分开；不使用日常/生产数据。凭据目录指向不存在的测试位置，采集、模型、飞书、IndexNow 关闭；不启动采集 Worker。
- UI 验收前端 `127.0.0.1:3340`，API `127.0.0.1:3341`；开发认证与材料均为合成数据。浏览器专用空间 69。
- 监督使用当前主会话（精确模型配置未能从运行时核实）。受工具当前列表支持，配置后端/跨进程边界使用 `gpt-6-astra / medium`，Web 既定流程使用 `gpt-6.1-sol / high`；主代理保留集成、阶段验收和 Git 操作。
- 供应商连接先由 `gpt-6.1-sol / xhigh` 执行；发生两次实质契约错误（抖音类型误用数字、Instagram 类型冲突未排除）后停止该执行包，按监督式开发规则升级到 `gpt-6-astra / medium` 修复、补实际导入验证并完成历史工具。独立 Astra 审阅者只读复审，主代理负责最终验收。

## 阶段 1：栏目配置

- [x] 单一 `settings.site_presentation` 保存、回读及审计；有限输入与固定入口校验；公共 meta 安全投影。
- [x] 后台设置表单与桌面/手机/更多/分类入口连接。
- [x] 后端专用库验证认证/CSRF、整份配置与审计原子性、并发保存、无效配置与安全公共投影。
- [x] 桌面、手机底栏和更多页复用同一配置，保留既有各端分组；模块关闭不能通过展示配置启用。
- [x] 主代理真实浏览器完成保存、刷新、重启读回、多端、恢复默认草稿与失败草稿验收。
- [x] 原图、批注图和图文索引。

复用现有 `settings` 一项 `site_presentation`、现有审计与设置入口；未新建栏目表、配置版本或发布审批。固定精选与手机“更多”；隐藏入口不禁止旧链接，隐藏分类不删除其内容。

首次验证中的环境问题已明确处理：shell 默认 Node 22，改用已有 Node24；默认数据库未启动，建立本次专用集群；沙箱阻止本地连接和浏览器时仅为授权的本地验收申请执行权限。未读取 `.env` 或已有运行数据。Web 首轮类型错误为 readonly 默认值转换，已局部修正；不把重跑通过写成首次全绿。

## 阶段 2：数量与全站视频

- [x] 网站 timeline/pool 接通三项数量；pool 回传有效页大小，筛选/搜索/翻页链接保留该大小，最多浏览 2,000 条的末页正确截断。v1/RSS/MCP 沿用旧契约。
- [x] `articles.media` 的 video 项增加可选 `confirmed:true`，支持无 URL 视频事实；同作品锁内合并，不增文章或修改纯媒体更新的 revision/hash/处理状态，不入队分析。
- [x] 已有 SocialData、Redfox、已证 AgentKey 路线的手工导入、平台订阅、X/公众号主采集，以及 RSS/Atom、已取得正文均接通；未证字段保持未知，不新购详情。
- [x] `/videos` 与 `/all` 共用 pool、公开资格、搜索、分类、计数和分页；跨 news/X，一条原内容仍只展示一次。纯图片、明确 GIF、旧模糊视频与信息不足的内容不纳入。
- [x] 卡片/现有详情增加视频标识、合规封面或占位、原站观看入口；X 已有媒体不重复显示。无播放流下发、下载或新播放器。
- [x] 提供[历史补齐工具说明](../video-history.md)：默认只读，显式目标库，按实际扫描行分页；已存证据重验、材料领域合并、精确快照恢复及文件落盘/事务中断恢复。仅在本次测试库应用和恢复，未扫描或补写真实库。
- [x] 独立整体复审完成，发现的具体问题已修复并定向复核，当前复核范围内没有剩余 P1/P2/P3。

复用现有材料、来源身份、回执、执行器与 publication；不新增业务表、SQL 迁移、预算、队列或任务状态。只在原有已取得的正文/响应里识别事实，不改变采集频率、导入授权或公开权限。AgentKey 原 5 条路线继续暂缓，第三阶段未开始。

## 收尾中修复的具体问题

1. 卡片的分类/标签链接原先没有传递本次有效页大小：通过现有列表属性补传，并用真实卡片 SSR 验证；未建立另一套分页状态。
2. RSS 同一附件的 MIME 与 medium 明确矛盾时仍可能确认：改为保守排除该附件，允许同条内容的其它真实视频附件。
3. 历史扫描仅取前 N 条会阻塞后批：增加 `--after` 与 `nextCursor`，按已扫描行推进，空候选批次仍可继续；不持久化游标。
4. 坏封面可能在 React 绑定事件前失败：挂载时补检查 `complete/naturalWidth`，保留原 onError；真实浏览器重载坏图已显示占位。
5. 公众号等正文先净化会丢失 `<source>` 证据：六个既有全文导入入口及 MP 执行器在净化前调用共用识别，历史证明使用同一已验证回执正文，公开 HTML 净化不变。
6. 原始正文中的推广视频可能误入：共用识别器复用现有 `sanitizeBody` 推广块和整块删除规则，保留代码示例排除；未新建广告识别框架。

上述第 5、6 项由独立复审提出并关闭。最后正文回归还修正易车历史证明对既有请求 URL 的复用，保持与原导入器相同的身份校验；测试夹具补齐原有必需作者证据，没有放宽导入边界。

## 最终验证

| 检查 | 结果与覆盖 |
| --- | --- |
| 核心定向回归 | **69/69**：presentation contract/settings/pool、materials/identities、video-media、extraction、RSS conditional/XHTML、publication |
| Web 回归 | **364/364**：`node --test --test-concurrency=1 apps/web/tests/*.test.ts`；含导航、草稿、共享 pool 链接、新闻/X 卡片与详情 SSR |
| 供应商及采集回归 | 执行者分组 **137/137**、**73/73**；含精确类型、实际导入、主采集及旧详情兼容。各组有重叠，不作为不重复总数累加 |
| 类型与实际导入补验 | 抖音/Instagram **25/25**；覆盖字符串类型、明确冲突、普通图片/轮播不误入；纯字段检查另已通过 |
| 最终正文/历史回归 | **57/57**：`agentkey-wechat`、`redfox-cars-import`、`redfox-wechat`、`redfox-toutiao-import`、`redfox-mp-collection`、`video-history`；含回执正文、实际导入、恢复、分批游标和中断窗口 |
| 类型与构建 | 最终 `npm run typecheck`、`npm run build -w @aihot/web` 均通过 |
| 本地冒烟 | `node scripts/smoke.ts --base http://127.0.0.1:3340` 通过，已将 `/videos` 加入现有公共路由检查 |
| 重启持久化 | API 重启后仍为精选 10、全部 12、视频 6；视频总数 13、全部总数 15，视频首页 6 条。全部/日报显示已恢复 |
| 历史 CLI | 隔离库 dry-run 9 → apply 9 → restore 9；另验证首批 0 候选仍能推进到后批；缺 DATABASE_URL 在导入 DB 模块前拒绝 |
| 外部副作用 | UI 测试库 `receipts=0`、`receipt_attempts=0`；供应商回归仅本地 HTTP 桩。无真实供应商/模型调用 |
| 差异与交付边界 | `git diff --check` 通过；无新增迁移。未提交、推送、合并或部署，未启动采集 Worker |

测试日志留在本机 `/tmp/aihot-site-final-{core-tests,web-tests,typecheck,web-build,smoke}.log` 和 `/tmp/aihot-provider-body-video-tests.log`，不作为仓库运行数据提交。分组测试有重叠，未虚构一个累加的全仓测试数字；也未执行远端 CI。

执行阶段 137 项分组的文件为 `redfox-{collection,platform-collection,platform-collection-next,wechat,weibo,toutiao-import,x-search-import,youtube,manual-work,cars-import,bilibili,xiaohongshu,tiktok}` 及 `agentkey-douyin-v4-materials`；73 项分组为 `redfox-{collection,extraction,mp-collection,configured-detail,work-detail-origin,weibo-car-origin}`（均位于 `tests/`，后缀 `.test.ts`）。正文收尾改动按影响重跑了上表 69 项核心与 57 项正文/历史分组，其数字以最终日志为准。

## 逐处截图与人工验收

**19 组、38 张**，每组同时保留原图和批注图。全部为隔离库的合成数据；蓝色标记仅注入验收页面，不在产品代码中。测试配置视频已开启、隐藏热点和模型分类、产品分类提前，便于核对；行业默认仍保持原入口与数量，视频默认隐藏。测试封面使用本地静态图，没有获取供应商图片。

| 场景及人工核对点 | 原图 | 批注图 |
| --- | --- | --- |
| 后台栏目显隐、组内上下移、精选固定、分类与数量 | [原图](assets/site-presentation-video/01-settings-light-raw.png) | [批注](assets/site-presentation-video/01-settings-light-annotated.png) |
| 保存反馈、服务器值与修改时间、恢复默认及查看前台 | [原图](assets/site-presentation-video/02-settings-saved-raw.png) | [批注](assets/site-presentation-video/02-settings-saved-annotated.png) |
| 隐藏分类旧 URL 仍可访问，并可清除筛选 | [原图](assets/site-presentation-video/03-hidden-category-raw.png) | [批注](assets/site-presentation-video/03-hidden-category-annotated.png) |
| 本页模拟 503：草稿 11 保留，已保存值仍为 10 | [原图](assets/site-presentation-video/04-settings-failure-raw.png) | [批注](assets/site-presentation-video/04-settings-failure-annotated.png) |
| 手机更多：①视频入口；②底栏既有入口，无重复项 | [原图](assets/site-presentation-video/05-mobile-more-raw.png) | [批注](assets/site-presentation-video/05-mobile-more-annotated.png) |
| 手机设置：①既有设置区域；②精选固定，栏目区窄屏排列 | [原图](assets/site-presentation-video/06-settings-mobile-top-raw.png) | [批注](assets/site-presentation-video/06-settings-mobile-top-annotated.png) |
| 手机设置：①数量；②保存及反馈，无横向溢出 | [原图](assets/site-presentation-video/06-settings-mobile-bottom-raw.png) | [批注](assets/site-presentation-video/06-settings-mobile-bottom-annotated.png) |
| 视频列表：news/X 混排，视频标识及已有 X 媒体只显示一次 | [原图](assets/site-presentation-video/07-videos-desktop-raw.png) | [批注](assets/site-presentation-video/07-videos-desktop-annotated.png) |
| 普通视频详情：合规封面、原站观看和原有返回入口 | [原图](assets/site-presentation-video/08-video-detail-raw.png) | [批注](assets/site-presentation-video/08-video-detail-annotated.png) |
| X 视频详情：复用 X 原有媒体，不新增重复封面 | [原图](assets/site-presentation-video/09-x-video-detail-raw.png) | [批注](assets/site-presentation-video/09-x-video-detail-annotated.png) |
| 手机视频列表：原有列表密度、封面及底栏 | [原图](assets/site-presentation-video/10-videos-mobile-raw.png) | [批注](assets/site-presentation-video/10-videos-mobile-annotated.png) |
| 视频内搜索/排序保留范围与每页数量 | [原图](assets/site-presentation-video/11-video-search-raw.png) | [批注](assets/site-presentation-video/11-video-search-annotated.png) |
| 视频空结果及清除筛选 | [原图](assets/site-presentation-video/12-video-empty-raw.png) | [批注](assets/site-presentation-video/12-video-empty-annotated.png) |
| 深色设置：①栏目控件；②数量，沿用现有主题 | [原图](assets/site-presentation-video/13-settings-dark-raw.png) | [批注](assets/site-presentation-video/13-settings-dark-annotated.png) |
| 视频末页：13 条按每页 6 条，第 3 页只剩 1 条 | [原图](assets/site-presentation-video/14-video-last-page-raw.png) | [批注](assets/site-presentation-video/14-video-last-page-annotated.png) |
| 无封面与坏封面均显示本地占位；含挂载前失败场景 | [原图](assets/site-presentation-video/15-bad-cover-raw.png) | [批注](assets/site-presentation-video/15-bad-cover-annotated.png) |
| ①隐藏全部/日报后，精选与更多仍固定等分；拍后已恢复 | [原图](assets/site-presentation-video/16-mobile-fixed-tabs-raw.png) | [批注](assets/site-presentation-video/16-mobile-fixed-tabs-annotated.png) |
| 首页分类显隐与顺序，精选入口保留 | [原图](assets/site-presentation-video/17-selected-raw.png) | [批注](assets/site-presentation-video/17-selected-annotated.png) |
| 全部动态复用列表、分类及 12 条页大小，普通内容仍保留 | [原图](assets/site-presentation-video/18-all-raw.png) | [批注](assets/site-presentation-video/18-all-annotated.png) |

截图中既有“关于页二维码”的测试资源未配置；该区域不在本次修改范围，没有借此替换真实二维码。

## 剩余边界

尚缺官方媒体输出契约的 AgentKey X/微博、部分抖音路线、Instagram 轮播子项，以及只有封面/脚本/iframe 等未知记录继续不纳入。它们不阻塞已证内容浏览，不新增自动补购、识别队列或模型判断。Redfox X 仅按已证合同，明确 GIF/矛盾字段排除，不承诺供应商对原平台零误分。

历史工具对多结果、旧修订或缺证回执会报告原因并跳过，没有历史全覆盖承诺。真实库 dry-run/写入、备份与上线均需另行授权；当前仍仅有独立测试库的验证结果。

## 当前状态

一期和追加主体、长名称窄屏P2修复均已完成本地实施与验收；当前已核范围没有未解决的具体P1/P2/P3。现已获提交、推送和创建 PR 授权，Git 交付与 CI 结果见顶部交付记录；下文各阶段“未提交”等描述保留为当时事实。没有部署或供应商真实调用。
