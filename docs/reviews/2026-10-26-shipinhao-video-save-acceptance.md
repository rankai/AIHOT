# 视频号订阅自动保存：最小补齐验收

日期：2026-10-26。分支：`codex/subscription-video-download`，基线 `ff9f533b962807de1a83b9a3d57a2dccc09471c1`。本次改动保留在工作区，未提交、推送、合并或部署。

结论：**已完成本地实现和定向验收。** 视频号两条列表路线在逐项人工核实作者/原文并成功入库后，可以复用原执行器自动保存；真实视频号媒体联调尚未执行，不能据本地样本承诺上游实际可达。

## 1. 实际改动

- `video-media.ts` 增加一个局部视频判断，限定官方已证的 `E7G00COY/OVUTOTCV/OE4KUEUO`，要求本条合法非空 `videoUrl`，拒绝原有明确非视频类型矛盾。合同未要求 `workType`，没有该字段不误拒绝。
- 人工导入的材料视频事实与保存登记共用同一判断；快手条件、隔离信源权限、原文核验、重复导入早退保持原行为。
- 历史证据校验共用该判断，并统一缺失作品 ID 的 `null/undefined` 语义；真实 ID 不一致仍拒绝。不执行历史扫描或回填业务数据。
- 原能力说明及人工导入弹窗明确人工核验、直链优先、必要时可能额外产生 Redfox 解析费用、`redfox.media` 次数预算和结果去向。
- 复审发现的跨信源停用 P2 已修复：共用保存登记在创建新记录前复用带锁资格检查，资格不足只跳过下载；合法人工导入及发现关系保留，真实关联/回执/持久化错误仍抛出。

生产代码共改六个既有文件；验证扩展两个既有测试文件。未新增表、列、任务状态、队列、HTTP 接口、供应商路线、详情步骤或依赖。原保存登记只补上述资格分支，继续复用现有所有权检查；回执、预算、私有文件及 30 天清理实现未改写。

执行器为工具提供的 `gpt-6-astra / medium`，承担受预算/身份边界影响的局部实现和自检；主会话保留设计、首个关键 diff 检查、浏览器验收和最终复审责任。主会话具体模型/档位未有可核验的运行时元数据，不将用户切换动作当作工具确认结果。

## 2. 先复现，再验证

实查测试环境：Node **24.19.0**；专用 PostgreSQL **127.0.0.1:55473 / aihot_subscription_video_test**。UI 使用独立 `aihot_subscription_video_ui_test`，本次 API **3381** / Web **3380**。沿用现有迁移，无新增迁移；默认关闭真实供应商/模型/推送，测试使用假凭据和本机 HTTP 桩。

修改前取得两项断言失败：

1. E7 列表人工导入后，材料没有 `confirmed` 视频事实，无法登记保存。
2. 无作品 ID 的视频号人工证据在历史核验中未被接受。

首轮视频号补齐后相关八文件 **77/77 通过**；以下为当时验证，后续 P2 修复的定向回归另列在本节末尾：

```sh
python3 /tmp/aihot-subscription-video-20261025.daf5suv6/run-isolated.py node --test --test-concurrency=1 --test-timeout=120000 tests/subscription-video-entrypoints.test.ts tests/video-history.test.ts tests/redfox-manual-work.test.ts tests/video-media.test.ts tests/subscription-video-download.test.ts tests/subscription-video-ownership.test.ts tests/subscription-video-candidates.test.ts apps/web/tests/manual-work-data.test.ts
```

| 验收项 | 证据 |
| --- | --- |
| E7 搜索、OV 账号列表有/无收到的 videoId | 四组均经真实本地采集入口、人工导入、材料确认、保存登记和本地 MP4 保存；不伪造请求 ID。 |
| 人工核验前、空地址、仅封面、明确非视频或非法协议 | 不登记保存；反例不会写成已确认视频。 |
| 独立查询 | 即使人工导入确认视频，也不派生订阅下载。 |
| 重复导入与跨订阅复用 | 同结果复用原保存 run；同规范化原文的另一订阅复用同一文件，零新增媒体 GET，到期不续期。 |
| 停用/关闭保存 | 已登记任务停止，无新增媒体传输或解析回执；原供应商切换和未知回执收尾回归通过。 |
| 历史核验 | 三操作有/无 ID 正例；替换真实收到的 ID 后拒绝。只操作合成测试材料，不运行真实历史回填。 |
| 原执行器恢复与素材生命周期 | 既有下载/所有权/候选测试回归通过，包含已收解析恢复、共享文件、墓碑及到期边界。没有改写这些机制。 |

另有 **2/2 UI 组件测试**通过（`apps/web/tests/subscription-video-ui.test.ts`），backend、tests、web 的 TypeScript 检查通过，`git diff --check` 通过。本轮未运行全量 CI、全量后端测试或生产构建，不把此前 PR 的 CI 结果记为当前未提交代码的 CI 结果。

验证过程中的环境/测试调整：首次本机连接被沙箱 EPERM 阻止，获准本机执行后完成真实红测；一个新测试曾误设“有 videoId 就用 videoId 作下载身份”，核对现有行为后改为已核实原文 `identity_key`，没有为测试改动生产身份规则。

### 后续 P2 修复与复验

整体复审新增复现：同原文已属于另一个停用信源时，关闭自动保存可以合法导入；开启后原保存登记抛错，使整笔导入回滚。先将此反例加入现有测试，确认修复前失败，再在 `registerSubscriptionVideo` 的关联、回执和 manifest 校验之后、创建新记录之前复用 `lockVideoDownloadOwners`。返回不合格时只跳过新下载，保留原有执行记录复用和后续严格检查；没有捕获全部异常。

修复后四文件 **46/46 通过**，backend/tests TypeScript 检查通过：

```sh
python3 /tmp/aihot-subscription-video-20261025.daf5suv6/run-isolated.py node --test --test-concurrency=1 --test-timeout=120000 tests/subscription-video-entrypoints.test.ts tests/subscription-video-ownership.test.ts tests/subscription-video-download.test.ts tests/redfox-manual-work.test.ts
python3 /tmp/aihot-subscription-video-20261025.daf5suv6/run-isolated.py node node_modules/typescript/bin/tsc -p packages/backend
python3 /tmp/aihot-subscription-video-20261025.daf5suv6/run-isolated.py node node_modules/typescript/bin/tsc -p tests
```

- E7/OV 两路线分别验证原信源停用及启用对照：旧文章、归属、权限不改；人工关联和 discovery 保留。停用时没有新下载记录、任务链接、媒体 GET 或媒体解析回执；启用时正常登记。
- 真实父结果关联契约错误仍传播，并回滚同事务材料、discovery 和结果关联。没有注入数据库或入队故障，不把该测试称作此类故障验证；代码中这些异常仍原样向上传递。
- 正常保存、停用保护、回执恢复、跨订阅复用、墓碑和 30 天期限由上述四文件回归覆盖。
- 主监督独立重跑上一轮未改动的临时复现脚本：**1/1 通过**，自动保存关闭/开启均合法导入，均无下载记录，媒体 GET 均为 0。

新测试首次正常源对照误读冻结字段 `videoOwnership`，随后修正为实际的 `videoDownloadOwnership`；没有为测试修改生产字段。此次修复未调整 UI，沿用下节截图，不补拍没有变化的页面。未运行全量 CI 或新增真实调用。

## 3. 实际后台流程与截图

使用 `ego-browser`，仅访问端口 3380 的真实应用和 localhost 媒体。合成订阅 #16 的列表执行 #29 / 结果 #51 没有作品 ID：通过现有弹窗搜索/选择隔离作者、填写合成原文与核验依据、填写审计原因后提交；服务端登记保存 #30，原执行器读取 1 次本地 MP4 并完成。

结果为 **1 个文件、912 字节、0 次媒体解析调用**；从原结果的“视频保存记录”进入 #30，现有私有文件下载链接返回 **HTTP 200**，取回字节与本地 fixture 完全一致（SHA-256：`3429085dc93ecca610970f7c1531c4ce531287ae1ffa9c7fc045631d8ff09acb`）。界面显示首次保存、实际 30 天到期、来源及原执行记录。这个小型本地容器验证保存/读取链路，不代表真实视频号的画质、音轨或 CDN 行为。

| 截图 | 内容 |
| --- | --- |
| [01 桌面批注](shipinhao-video-save-2026-10-26/01-manual-import-desktop-annotated.png) · [原图](shipinhao-video-save-2026-10-26/01-manual-import-desktop.png) | 原人工导入弹窗：保留隔离/原文核验，明确直链优先与可能产生解析费用。 |
| [02 窄屏批注](shipinhao-video-save-2026-10-26/02-manual-import-mobile-annotated.png) · [原图](shipinhao-video-save-2026-10-26/02-manual-import-mobile.png) | 390×844：说明换行、原弹窗可滚动，页面和弹窗均无横向溢出。 |
| [03 结果入口批注](shipinhao-video-save-2026-10-26/03-parent-save-link-annotated.png) · [原图](shipinhao-video-save-2026-10-26/03-parent-save-link.png) | 人工导入后保留上游缺项，沿原“视频保存记录”入口查看结果。 |
| [04 私有结果批注](shipinhao-video-save-2026-10-26/04-private-video-result-annotated.png) · [原图](shipinhao-video-save-2026-10-26/04-private-video-result.png) | 原私有素材组件展示文件、下载入口和 30 天到期，不新增页面。 |

截图均经主监督逐张查看。批注是浏览器临时覆盖层，未写入产品。后台 `videoDownloadCapability` 的视频号提示已更新并由定向测试核对；当前视频号没有可切换的第二供应商，不为制造该预检截图新增虚假选择或开放路线。

本地 Vite 首次依赖优化曾导致 React 模块 504、按钮未激活，刷新优化后的页面恢复。浏览器移动/点击提交未实际提交时，验收脚本过早检查子任务而停止；核对表单有效且未导入后，使用原确认按钮键盘提交成功，再以原冻结的 localhost 地址完成保存。未改业务代码绕过 UI，也未重采真实内容。

## 4. 整体复审与残余边界

首轮复审未覆盖跨信源停用后人工导入的边界，后续整体复审发现上述 P2；现已按最小方案修复并完成定向验证。主监督复核完整变更与原始复现结果，独立 `gpt-6-astra / medium` 只读复审也未发现有充分证据支持的剩余 P1/P2/P3。人工归属、材料事实、订阅授权、解析回执与文件生命周期继续由原模块负责，没有新建第二套身份、状态或恢复机制。重复入库不重建下载，独立查询不借订阅权限；未知作者不自动绑定，文件保存不提高公开权限。

仍需明确保留：

- **视频号真实媒体联调尚未执行**，可达性、签名有效期、反盗链、真实音画与收费仍未验证。
- 不承诺不同分享链接属于同一视频；按原规范化 URL 身份复用，不新增跨链接映射。
- 不承诺作者上传的原始文件；50 MB、现有低清候选、后台过大占位、30 天删除的共用边界不变。
- 本轮没有等待 30 个自然日；既有真实抖音验收中的删除为模拟到期。本轮仅回归原清理机制，并核实新视频号保存的期限及复用不续期。
- 完全无人值守的视频号入库仍缺可靠作者与原文关联，本次只完成已确认的“人工核实入库后自动保存”。

未读取日常 `.env`、真实凭据或业务运行目录；未发起真实供应商或媒体请求。任务测试库和合成记录保留以便复核，不影响日常订阅。本次浏览器空间及 3380/3381 临时服务已关闭，原有服务和用户页面未动。三份相关文档的本地链接及 diff 格式检查通过。
