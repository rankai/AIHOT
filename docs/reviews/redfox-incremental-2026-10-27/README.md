# Redfox 增量工具开发与本地验收记录

本文件记录本地开发验收时的状态；后续提交与 CI 结果以 PR 为准。

日期：2026-10-27。结论：本轮约定范围已实现并通过本地合成验收，最终复审未发现尚未解决的 P1／P2／P3。真实供应商联调未进行。

## 实施与复用

- Seedream 5.0 Lite 禁止新生成及旧排队任务的新上传／生成，保留幂等返回、已收回执恢复、已有任务查询及私有文件；未知提交不自动重发。
- 知乎补齐文章详情、评论、账号、专用热点查询；文章搜索结果可显式查询同作品详情，文章搜索订阅可显式开启详情补全，沿用订阅信源及权限。评论接已有无源研究快照订阅，每轮首页一次、不自动续页，不作为文章导入。
- 账号及专用热点只有手工查询；定时热点仍是既有聚合路线，不新建第二条。未扩大 Facebook 范围。
- 千问／豆包含商品卡搜索分别接现有异步 AI 搜索流程；商品字段保存在已有答案结果中，普通搜索与历史任务保持原路线。商品、价格、销量和引用仅展示实收事实，不新增商品库。
- 复用订阅、同步执行器、AI 搜索执行器、回执、用途次数预算、材料导入及结果组件。没有新增表、列、任务状态、队列或通用框架。仅新增 0079／0080 两个价格数据迁移，共十条估价种子，不覆盖管理员已有价格。

## 验证结果

- 相关回归 172/172 通过（17 个测试文件）；原聚合热点相关回归 16/16 通过。两组共 188 项。
- 最后只读提示修正后，前端相关 41/41 复查通过；与前述测试有重叠，不累加成独立总数。
- 全仓类型检查、前端生产构建通过；最终 diff 空白检查通过。
- 覆盖新建退役、旧任务收尾、忙碌／未知／已收回执、正确预算、预算等待、响应重放不重买、同作品 ID／类型／原文约束、正文清洗、去重和归属、评论空页／错误／截断／首页约束、编辑与停用恢复、商品卡状态差异及旧引擎兼容。
- 浏览器实际操作了 11 条合成执行记录，均已完成；16 份回执均已完成、每份一次尝试。两条订阅占用均释放，验收后通过现有更新命令停用，next_run_at 为空。
- 独立详情导入与订阅详情补全去重为同一篇材料。创建审计与验收后均为 editorial、site_fulltext=true、syndicate_fulltext=false，未扩大权限。合成 script 被正文清洗去除。没有启动模型分析或公开发布。
- UI 覆盖入口、提交、进度、结果、导入、订阅及约 390 CSS px 的窄屏；18 组原始截图与批注图见图册。

## 复审与修正

1. Lite 执行中的预算／总开关异常可能先于退役检查：在原图片执行边界局部处理，避免旧未发任务无限等待；已收、忙碌和未知回执仍沿原恢复规则。定向验证通过。
2. 知乎账号／专用热点共用提示误称可导入／绑定：以局部提示函数修正，前后端能力边界一致；无新增入口或状态。复查与截图通过。
3. 旧目录测试原来只预期一个知乎操作，随新四项能力更新为五项；首次相关运行该断言失败，修正后全套通过。
4. 收尾审计最初误用 site_fulltext=false 作为 UI 基线；对照实际 source.create 审计确认创建值为 true，改为核对创建前后一致。产品权限未发生变化，此项是验收脚本基线修正。

## 环境与执行方式

- 基线 main@88e27722ad576f9613cf9ed407a1280b53e0e999；任务分支 codex/redfox-incremental-tools，工作区 /tmp/aihot-redfox-incremental-20261027。
- Node 24.19.0；独立 PostgreSQL 17，127.0.0.1:55528，仅 aihot_redfox_incremental_test 与 aihot_redfox_incremental_ui_test。0079／0080 只应用于这两个隔离库。
- UI 3380、API 3381、供应商桩 3382；合成凭据与样本，不使用日常数据或真实平台会话。没有运行通用 Worker／调度器；有界测试驱动推进指定执行步骤及轮询等待，用于验证恢复路径，不代表持续定时运行已验收。
- 监督执行采用一个 gpt-6-astra / medium 执行器，主监督负责边界、集成、UI 与最终验收；未使用并行执行器。主对话模型未由工具提供可验证标识；未声称任务成本或模型节省。
- 没有提交、推送、合并、部署或真实供应商调用。日常仓库及其数据库没有同步本次改动。任务分支、未提交代码、隔离测试库与证据保留。验收后已关闭任务浏览器页并停止任务专用 API、前端和供应商桩；日常后台不受影响。

## 尚未验证

真实账号接口可用性和扣费；真实知乎搜索与新文章详情的对应、删除／限流等响应；评论完整性与排序稳定性；商品卡实际响应和正文引用关联；Lite 已有任务查询端点的当前真实可用性；真实模型分析和持续定时运行。文档及合成测试不替代这些联调，后续须按授权范围验证。

## 截图批注

- [Lite 停止新生成](01-lite-retired-entry-annotated.png) · [原图](01-lite-retired-entry.png)：旧草稿显示停用原因，不自动换模型；保留旧任务查询。
- [Lite 历史查询与文件](02-lite-history-result-annotated.png) · [原图](02-lite-history-result.png)：已有任务经本地桩查询完成，私有图片可查看、下载，没有重新生成。
- [知乎评论查询](03-zhihu-comment-query-annotated.png) · [原图](03-zhihu-comment-query.png)：固定文章 ID 查询评论，实际续页事实保留。
- [评论快照订阅](04-comment-subscription-annotated.png) · [原图](04-comment-subscription.png)：从查询带入，清除续页；无源研究订阅、每轮首页，隐藏详情与视频选项。
- [评论快照结果](05-comment-snapshot-result-annotated.png) · [原图](05-comment-snapshot-result.png)：查询到的下一页不自动跟随；研究计数、截止原因、结果和回执共用原页面。
- [知乎账号结果](06-zhihu-account-result-annotated.png) · [原图](06-zhihu-account-result.png)：账号资料仅供研究，不出现材料导入或账号绑定动作。
- [知乎专用热点结果](07-zhihu-hot-result-annotated.png) · [原图](07-zhihu-hot-result.png)：专用接口手工查询；定时采集继续复用既有聚合热点路线。
- [知乎详情导入](08-zhihu-detail-import-annotated.png) · [原图](08-zhihu-detail-import.png)：原文、文章 ID、类型核对后显式导入，沿用所选信源。
- [商品卡搜索入口](09-products-search-entry-annotated.png) · [原图](09-products-search-entry.png)：AI 搜索新增千问／豆包含商品卡选项，普通搜索保留。
- [商品卡查询进度](10-product-search-progress-annotated.png) · [原图](10-product-search-progress.png)：提交后进入现有执行记录，处理中状态可见。
- [千问商品卡结果](11-qianwen-products-result-annotated.png) · [原图](11-qianwen-products-result.png)：回答、卡片与独立引用事实展示，不猜正文引用关联。
- [豆包商品卡结果](12-doubao-products-result-annotated.png) · [原图](12-doubao-products-result.png)：独立查询路线；价格异常文本保留原值，不猜测金额。
- [商品卡窄屏](13-products-mobile-annotated.png) · [原图](13-products-mobile.png)：约 390 CSS px，长标题换行，结果卡无横向页面溢出。
- [搜索结果查询详情](14-zhihu-search-detail-action-annotated.png) · [原图](14-zhihu-search-detail-action.png)：仅明确文章范围的结果可请求同作品文章详情。
- [文章订阅详情补全](15-zhihu-subscription-detail-annotated.png) · [原图](15-zhihu-subscription-detail.png)：从信源创建，无须重复选择；显式开启补全并限制详情次数。
- [订阅结果与归属](16-zhihu-subscription-result-annotated.png) · [原图](16-zhihu-subscription-result.png)：搜索、补全、导入完成；去重后关联原材料与信源。
- [账号／热点只读提示](17-zhihu-readonly-hint-annotated.png) · [原图](17-zhihu-readonly-hint.png)：移除导入、绑定或独立定时入口的误导性说明。
- [Lite 窄屏提示](18-lite-mobile-annotated.png) · [原图](18-lite-mobile.png)：旧模型停用说明换行展示，保留已有任务查询。
