# 订阅视频自动保存：本地验收报告

日期：2026-10-25。分支 `codex/subscription-video-download`，基线 `92367007cf4924ad831ebd12a2afdeb71154973b`（PR #6）。本报告记录提交前的本地验收；后续提交、PR 与远端 CI 状态以对应 PR 描述为准。

最新复验：2026-10-26。后续完整代码复审发现的 2 项 P2 和 1 项 P3 已修复，见文末[追加复验](#2026-10-26-追加复验)。下方原验收计数和结论为当时的历史证据；最新状态以追加复验为准，不将不同轮次的测试数累加为全量结果。

## 结论与范围

实现和本地验收完成。订阅开启后，成功入库且有可靠视频事实的材料登记独立保存执行；采集完成不等待下载。优先使用已核直接地址，需要时走固定九个 Redfox 解析器和 `redfox.media` 预算，后台分别说明采集商与解析商。文件不超过 50,000,000 字节；超限只尝试已证实为同一视频的备选，不转码、不换供应商。无合适文件时保留原因；超限空占位只出现在后台。首次注册后 30 天删除文件、保留历史，复用不续期、墓碑不自动重下。

复用现有订阅 JSON、operation_runs/results、receipts、budgets、stored_files、operations.execute 与私有素材清理机制。没有新增表、列、任务状态、队列、后台导航或独立文件管理器。新增的是一个具体本地操作及其候选、归属辅助代码；不是通用媒体框架。固定解析分工和历史 `uploads/redfox/` 前缀兼容已写代码注释。

[完整方案](../subscription-video-download-plan.md) · [上游免费证据与明确缺口](2026-10-25-subscription-video-download-evidence.md)。AgentKey 第三阶段未启动，五条暂缓路线不变。

## 环境与验证

Node 24.19.0，PostgreSQL 17.9，`127.0.0.1:55473`。任务库 `aihot_subscription_video_test`，界面库 `aihot_subscription_video_ui_test`，全量回归使用新建空库 `aihot_subscription_video_ci_test`。均由既有 75 个迁移建立，没有本次迁移；未读取或写入日常/生产数据库、`.env`、真实凭据或 `.data/`。

API 3361 / Web 3360 为任务专用服务，没有启动连接界面库的后台采集 worker。测试供应商与视频只绑定 loopback；使用显式合成凭据。浏览器表单操作只保存隔离虚构配置，未点击真实抓取、切换或上传。用户日常 3310 服务未动。

| 验证 | 结果及适用范围 |
| --- | --- |
| 后端全量 | 新空测试库 **987/987** 通过；这是整体复审修复前的完整基线。 |
| 复审修复后受影响回归 | **51/51**：下载、候选、所有权、实际导入、执行存储、恢复和素材；包括新加的两种共享文件恢复场景。最终移除不完整次数汇总后，下载/候选 **20/20** 再次通过（51 项的子集）。计数不与全量相加。 |
| Web 全套 | **374 项覆盖通过**：首次 365 通过、9 项因沙箱禁止监听本地端口而失败；允许本地监听后仅重跑缓存文件 9/9 通过。 |
| 后续 UI 定向 | 配置/结果等 **27/27**；最终完成态隐藏不完整尝试数的渲染断言 **2/2**（为上述子集，不相加）。 |
| 类型 | contracts/backend/api/worker/tests/web 均通过。 |
| 构建与格式 | React Router/Vite 生产构建及 `git diff --check` 通过。 |
| 队列占用 | 实际 pg-boss 本地测试：同一队列下载 consumer `maxPriority:-1/localConcurrency:1` 占用时，普通 `minPriority:0/localConcurrency:2` 仍能完成；不宣称全实例并发上限。 |
| 私有下载 | 浏览器已登录的现有 `/api/admin/assets/.../content` 返回 200，取得 912 字节本地 MP4 桩，逐字节等于仓库夹具。到期清理记录没有 video/content 下载入口；拒绝到期读取及删除恢复另有后端验证。 |

最初全量使用默认关闭模型开关的检查点库时，有 30 项既有模型桩测试被阻止；另 1 项旧断言需加入新增 `videoDownload` 预检说明。测试进程启用明确的本地模型桩后，旧失败留存影响了一项翻译测试；改用全新任务 CI 库后 987/987 通过。没有修改无关模型/翻译业务来迎合测试。

验证命令通过任务临时 `run-isolated.py` 清理继承环境、显式绑定测试库；等价范围是 `node --test --test-concurrency=1 tests/*.test.ts`、相应七个受影响文件、`apps/web/tests/*.test.ts`、各 workspace 的 `tsc -p` 和 React Router build。临时日志位于 `/tmp/aihot-subscription-video-20261025.daf5suv6/`，日志与合成运行库不纳入源码。

## 主流程实测

- 平台订阅：浏览器关闭→保存→刷新确认关闭；再开启→保存→刷新确认开启。预览参数不携带自动保存副作用。
- 原生 X：浏览器开关更新原 JSON→确认保存→刷新读回；使用该保存配置实际跑本地 SocialData 桩采集→导入→Redfox 本地解析→文件保存→信源最新保存入口。公众号新建默认关闭；非法 JSON 保留原草稿且禁用开关。
- AgentKey：本地 V4 搜索响应经现有执行器导入，创建下载执行，经过 Redfox 本地解析和真实文件校验入私有素材。已保存、超限、无地址、到期和等待执行分别有持久记录。
- 备选：本地 Redfox X 首选返回 50,000,001 字节 Content-Length，随后同一视频的较低码率 MP4 保存；无额外解析请求。显示码率，不把码率、水印或文件名当作原画证明。
- 导航：采集结果→保存执行；订阅列表/信源列表→保存执行；同订阅执行历史；保存结果→关联材料/信源/私有文件。没有再添加同义导航入口。
- 窄屏：390×844 的配置和超限结果，页面 scrollWidth 均为 390；说明、原因、关联链接和保存按钮可见。

这些是本地桩业务流程证据，不能证明真实供应商文件可达或音画正常。912 字节 MP4 为仓库容器校验夹具；截图中的播放控件不代表已验收真实视频播放。

## 整体复审及收尾

主监督检查集成差异、执行归属、候选身份、预算/回执恢复、存储生命周期和实际 UI；独立 Astra Medium 做只读复核。后端由 Astra Medium 实施，UI 由 GPT‑6.1‑Sol High 实施，按依赖串行交接。主监督完成环境、集成验收和少量类型/文案收尾。

| 问题 | 修复与证据 |
| --- | --- |
| P2：A 的解析响应已收但尚未消费，B 已保存同作品或留下完整孤儿文件，A 恢复被 receipt 消费校验卡住 | 已收响应先本地重放再复用文件；两种中断场景先复现，关闭出站后均可完成，解析/文件请求不增加。unknown 回执不伪装已消费。 |
| P3：完成时 progress 清空，顶部保存数/字节/解析标记错误 | 从持久逐媒体结果汇总，不重复计算 summary，解析事实读取解析结果；真实单视频、多视频、复用 DTO 断言通过。 |
| P3：完成态最后候选的尝试数不能代表总次数 | 完成态不展示该数，进行中保留当前候选次数；无需新增累计状态。渲染断言和最终截图已核对。 |
| 页面小收尾 | 移除视频详情里指向执行历史却称“返回订阅”的重复链接，保留同订阅历史与原采集结果；收窄 UI 辅助函数参数，避免导入整套操作类型形成类型依赖环。 |

主监督最终复核未发现剩余有证据支持的 P1/P2/P3。无历史全站补下载、无数据库迁移、无旧采集生命周期替换；旧订阅缺字段默认关闭。代码及截图保留在本任务分支工作区，测试库与 3360/3361 服务保留供人工查看；本轮浏览器专用空间已结束。

## UI 截图批注

全部为真实本地应用页面、合成数据。批注作为截图覆盖层，未写入产品 UI；原图一并保存。已逐张查看，截图不含真实密钥或签名媒体地址。

| 编号 | 位置与验收点 | 截图 |
| --- | --- | --- |
| 01 | 平台订阅开关与保存边界 | [批注](subscription-video-download-2026-10-25/01-platform-setting-annotated.png) · [原图](subscription-video-download-2026-10-25/01-platform-setting.png) |
| 02 | X 主订阅 JSON 与开关同步、保存读回 | [批注](subscription-video-download-2026-10-25/02-source-setting-annotated.png) · [原图](subscription-video-download-2026-10-25/02-source-setting.png) |
| 03 | 新建公众号默认关闭 | [批注](subscription-video-download-2026-10-25/03-new-source-annotated.png) · [原图](subscription-video-download-2026-10-25/03-new-source.png) |
| 04 | 采集结果进入视频保存记录 | [批注](subscription-video-download-2026-10-25/04-parent-result-annotated.png) · [原图](subscription-video-download-2026-10-25/04-parent-result.png) |
| 05 | 采集商、解析商、预算与完成统计 | [批注](subscription-video-download-2026-10-25/05-save-progress-annotated.png) · [原图](subscription-video-download-2026-10-25/05-save-progress.png) |
| 06 | 文件来源、到期和现有操作 | [批注](subscription-video-download-2026-10-25/06-private-file-annotated.png) · [原图](subscription-video-download-2026-10-25/06-private-file.png) |
| 07 | 超限后台占位 | [批注](subscription-video-download-2026-10-25/07-too-large-annotated.png) · [原图](subscription-video-download-2026-10-25/07-too-large.png) |
| 08 | 同一视频较低码率备选 | [批注](subscription-video-download-2026-10-25/08-lower-bitrate-annotated.png) · [原图](subscription-video-download-2026-10-25/08-lower-bitrate.png) |
| 09 | 到期删除后保留历史，移除失效操作 | [批注](subscription-video-download-2026-10-25/09-expired-file-annotated.png) · [原图](subscription-video-download-2026-10-25/09-expired-file.png) |
| 10 | 现有私有素材列表 | [批注](subscription-video-download-2026-10-25/10-assets-annotated.png) · [原图](subscription-video-download-2026-10-25/10-assets.png) |
| 11 | 订阅列表最近保存与独立进度 | [批注](subscription-video-download-2026-10-25/11-subscription-list-annotated.png) · [原图](subscription-video-download-2026-10-25/11-subscription-list.png) |
| 12 | 执行列表区分采集与视频保存 | [批注](subscription-video-download-2026-10-25/12-execution-list-annotated.png) · [原图](subscription-video-download-2026-10-25/12-execution-list.png) |
| 13 | 原信源名称下的最新保存入口 | [批注](subscription-video-download-2026-10-25/13-source-list-annotated.png) · [原图](subscription-video-download-2026-10-25/13-source-list.png) |
| 14 | 原主订阅卡的开关与保存结果 | [批注](subscription-video-download-2026-10-25/14-source-detail-annotated.png) · [原图](subscription-video-download-2026-10-25/14-source-detail.png) |
| 15 | 390 px 超限结果 | [批注](subscription-video-download-2026-10-25/15-mobile-oversize-annotated.png) · [原图](subscription-video-download-2026-10-25/15-mobile-oversize.png) |
| 16 | 390 px 配置与保存按钮 | [批注](subscription-video-download-2026-10-25/16-mobile-setting-annotated.png) · [原图](subscription-video-download-2026-10-25/16-mobile-setting.png) |
| 17 | 现有只读切换预检的视频能力说明 | [批注](subscription-video-download-2026-10-25/17-switch-preflight-annotated.png) · [原图](subscription-video-download-2026-10-25/17-switch-preflight.png) |

## 仍未验证的外部事实

没有真实付费、业务 API 或远程视频/CDN 调用。媒体有效期、反盗链、大小与音画可用性仍需日后单独授权的有界联调。未闭合的视频类型、地址数组元素和多视频版本身份只阻塞对应路线/记录；不会为未知类型自动购买解析。视频号定时列表、部分 TikHub 抖音 APP/X/微博事实缺口、头条/公众号地址字段边界按证据文档保留。不承诺所有视频可下载，更不承诺原始上传文件。

## 2026-10-26 追加复验

本轮由主监督决定最小修复与验收，Astra Medium 执行后端限定任务包；主监督补充渲染断言、独立复现、相邻回归与浏览器截图。沿用上述分支、Node 24.19 和两套任务测试库，没有新增迁移、表、列、任务状态、队列或组件。

| 本轮问题 | 最小修复及复验 |
| --- | --- |
| P2：已收解析为空或重复地址时，恢复遗漏其他订阅的文件 | 先持久化解析结果并保留回执，再进入现有保存步骤。覆盖空响应、重复地址、归属不足分别遇共享文件、完整孤儿、墓碑及无文件；消费回执后正确收尾，离线恢复不增加请求，不重传失败候选。原复现由 `saved=0/no_video_address` 变为 `saved=1/reused`，解析回执完成。 |
| P2：每日只删除一批 50 个到期文件 | 保留 50 条分页和原删除函数，在固定截止时间及最大 key 内继续并回绕游标；失败每轮只尝试一次。原 51 个到期文件复现由“删除 50、残留 1”变为“删除 51、残留 0”。正式测试还覆盖 unlink 失败、人工任务保护不阻塞后续、本轮截止后到期暂缓、下一轮解除保护后删除。 |
| P3：复用记录错误标注本轮未下载候选 | 复用时 `selectedCandidate=null`；原保存记录保留真实版本，现有结果组件自动不显示未经验证的码率/字段，也不生成错误的低码率结论。实际本地采集链中 A 保存 500000 bps，B 离线复用相同 file key，新增请求 0，首次保存和到期时间不变。 |

验证结果（均为本地）：

- 正式受影响后端三文件：先将 10 个新增场景跑红（8 个预期失败，2 个原行为已正确），修复后整套 **46/46** 通过；再补归属不足场景 **4/4** 通过。合计 **50 项覆盖**，并非一次运行 50 项；正式新增共 14 项。
- 主监督独立重跑上一轮原始三份复现脚本：**3/3** 通过，未改变原断言来适配实现。
- 主监督相邻回归：`subscription-video-ownership`、`operation-recovery`、`operation-result-retention`，**12/12** 通过，验证订阅失效/切换、未知回执和历史结果保留。
- Web 真实组件渲染：`subscription-video-ui.test.ts` **2/2** 通过，新增复用卡片仍可下载、显示实际到期，但不显示版本字段或低码率结论的断言。
- backend/tests TypeScript 检查及 `git diff --check` 通过。本轮未重跑前述全量后端/Web 测试或生产构建，沿用其基线证据，不宣称本轮全量 CI。

后端正式命令使用既有隔离 runner：

```sh
python3 /tmp/aihot-subscription-video-20261025.daf5suv6/run-isolated.py node --test --test-concurrency=1 tests/subscription-video-download.test.ts tests/subscription-video-candidates.test.ts tests/operation-assets.test.ts
python3 /tmp/aihot-subscription-video-20261025.daf5suv6/run-isolated.py node --test --test-name-pattern='ambiguous received parser' tests/subscription-video-download.test.ts
```

### 修复后的 UI 对照批注

浏览器使用任务服务 API 3361 / Web 3360、隔离 UI 库与本地 MP4 桩。复用组件，无新页面、入口或操作。两组截图均保留原图；批注不进入产品代码。

| 位置 | 截图 |
| --- | --- |
| 原保存记录：真实低码率版本及原始尝试事实保留 | [批注](subscription-video-fixes-2026-10-26/01-original-version-annotated.png) · [原图](subscription-video-fixes-2026-10-26/01-original-version.png) |
| 另一订阅复用：0 字节传输、实际到期、不显示未下载候选，现有链接回到原保存记录 | [批注](subscription-video-fixes-2026-10-26/02-reused-result-annotated.png) · [原图](subscription-video-fixes-2026-10-26/02-reused-result.png) |

主监督整体复审结论：本轮三项缺陷已闭合，未发现新的有证据支持的 P1/P2/P3。解析预算/次数、订阅所有权、文件墓碑及人工输入保护继续由原机制负责；到期清理的失败不自旋、不饿死后续页，没有引入平行状态源或通用媒体框架。既有上游证据缺口与真实文件可用性边界不变。未提交、推送、合并、部署或发起真实调用。
