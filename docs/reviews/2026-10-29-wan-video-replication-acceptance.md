# 视频复刻实施与验收

> 后续状态：常用本地实例已启用，并完成前台AI口播和admin万相标准模式真实验收，见[视频试运营记录](2026-10-30-video-trial-live-acceptance.md)。本文件为隔离复验当时的证据。

2026-10-30 更新：前台与 admin 四 Tab 已实现，本地验收通过，标准模式的一条真实万相用例复验通过。专业模式与生产启用尚未验证，未发布、提交或推送。

## 实现与本地证据

- 使用 wan2.2-animate-mix、北京业务空间、私有 OSS；复用任务、回执、队列、私有文件、积分、预算和成本，不属于采集/信源接入。
- 前台/admin 在“视频创作”内提供文生视频、图生视频、AI口播、视频复刻 Tab；视频复刻独立两素材表单。
- 提交未知不自动重发，轮询递增独立身份、累计40次/2小时，结果下载失败只恢复保存。签名远端地址不进入常规任务 DTO 或导出。
- 本地定向后端78/78、前端400/400、类型检查与Web构建通过。后缀修复后万相专项14/14、全项目类型检查通过。
- 原合成桩视频用于传输、存储、播放及账务验证，不是换人效果证据。

## 真实验收历史

首次任务 #1：2上传、1提交、1查询后 FAILED / InvalidVideo.FileFormat，12测试积分退回。发现 OSS 对象只有哈希而缺少扩展名；已按验证后的 MIME 保留后缀，同时保持旧回执身份和旧对象路径，不自动重传。用户另行授权一次新增复验、费用上限5元。

## 2026-10-30 真实复验通过

2026-10-30。本轮通过前台实际完成上传、报价、提交、轮询、保存、播放、下载与完整导出；admin 核对同一任务的播放和费用。已取得真实万相输出。此结论覆盖标准模式的一条官方演示用例，生产环境尚未启用。

## 视频产物

- [真实输出 MP4](/Users/nickfury/.codex/visualizations/2026/10/29/01a1858a-ca6f-7412-a2dd-c9390a0d67cc/wan-video-replication/real-retest-20261030/wan-video-replication.mp4)：5.000 秒，1252×704，15fps，H.264 视频＋AAC 单声道音轨（16kHz），623,427 字节。
- [官方人物照片](/Users/nickfury/.codex/visualizations/2026/10/29/01a1858a-ca6f-7412-a2dd-c9390a0d67cc/wan-video-replication/live-case/official-portrait.jpeg)、[本轮参考视频](/Users/nickfury/.codex/visualizations/2026/10/29/01a1858a-ca6f-7412-a2dd-c9390a0d67cc/wan-video-replication/live-case/reference-5s.mp4)：输入片长 5.005 秒，1282×720，有音轨。
- SHA-256：`bcddbe31cb6fee01cf52d8b56baa4a22808bc084621408d9e7ba186373527ca2`。前台下载文件与私有存储登记的哈希及字节数一致。
- [完整交付总览](/Users/nickfury/.codex/visualizations/2026/10/29/01a1858a-ca6f-7412-a2dd-c9390a0d67cc/wan-video-replication/index.html)：可并排播放参考视频和输出视频，并查看人物照片及截图。

已逐帧抽查 0.5、2.5、4.5 秒：画面中的主角外观、背心与项链替换为人物照片的形象；窗边场景、光线及表演姿态得到保留，可见“通义AI生成”水印。手部与面部细节有生成画面的柔化，不把单次样片结论推广到所有素材。

前台和 admin 均实际播放至 1 秒以后，无媒体错误；前台未静音。已确认音轨存在，本轮没有进行音色相似度、逐字口型或听感评分，不将结果解释为音色克隆。标准模式实际输出不是精确 1280×720，以文件探测值为准。专业模式、多主角、遮挡和长视频质量未做真实验收。

## 任务、额度与积分

| 项目 | 实收结果 |
| --- | --- |
| 本地 / 供应商任务 | #2 / 95513240-59f2-425a-9a7c-32aeebf51cef |
| 模型 / 模式 | wan2.2-animate-mix / wan-std |
| 生成提交 | 2026-10-30 17:13:04（上海） |
| 本地文件登记 | 2026-10-30 17:15:07（上海） |
| 实际外发增量 | 2 次 OSS 上传、1 次生成、4 次查询，未重发生成 |
| 用户成果 | 1 条视频；完整 JSON 导出 scope=all-saved-results、resultCount=1、nextCursor=null |
| 后台结果 | 8 项：1 条视频＋7 条上传/提交/查询过程记录；nextCursor=null |
| 测试积分 | 报价 / 预占 12，完成结算 12；余额 20/0 → 8/12 → 8/0（可用/占用） |
| 用量 | 终态 SUCCEEDED，outputSeconds=5，usageValid=true，关联原提交回执 #7 的第 1 次尝试 |
| 模型费用估算 | 5 秒 × ¥0.6/秒 = ¥3，needsReview=false；去重后只计 1 个成功任务 |

新增授权上限为 5 元，仅执行上述一次。¥3 是按回执用量与[北京标准模式官方原价](https://help.aliyun.com/zh/model-studio/wan2-2-animate-mix)计算的模型估算，不是阿里云账单；OSS 存储、请求与流量另计，实际云账单未读取。此前失败任务 #1 没有视频用量，仍保留为待核对，费用页中的 unknownTasks=1 属于该历史失败任务。

## 修复与验证

首次真实任务 #1 返回 InvalidVideo.FileFormat。已将 OSS 对象路径从无后缀哈希改为 MIME 对应的 .mp4/.jpeg/.png/.webp；同一组素材在修复后成功，支持首次失败由缺失文件扩展名导致的判断。旧回执身份及原任务保留，升级后不会自动重新上传或生成。

修复后 14/14 万相专项回归和全项目类型检查通过，测试使用假密钥及本地桩。此前本地验收记录为后端定向 78/78、前端 400/400、类型与 Web 构建通过；本次无新增产品代码改动，没有重复全套测试。浏览器采集到的运行异常 / error 事件为空。

## 证据清单

- `wan-video-replication.mp4`、`media-probe.json`：前台实际下载的视频与独立文件探测。
- `user-results.json`、`admin-results.json`：前台完整导出及后台本页导出。均未包含 OSS 签名或供应商输出 URL。
- `evidence.json`：任务、积分和按任务成本统计。完成后 progress 已清理，任务身份与查询次数由结果、usage 及尝试明细核对。
- `closure-and-usage.json`：2/1/4 次调用、带后缀 OSS 对象、成功用量、存储哈希与归零预算。
- `quote.png`、`user-result-playing.png`、`admin-result-playing.png`、`credit-ledger.png`、`admin-costs.png`：报价、两端播放、结算与费用截图。
- `browser-checks.json`、`worker.log`：播放状态与仅处理任务 #2 的 Worker 安全日志。
- `reference-2.5s.png`、`output-0.5s.png`、`output-2.5s.png`、`output-4.5s.png`：参考与输出的抽查画面。
- `authorization.json`：本轮新增授权范围。

## 收尾

本轮 Worker 已自动退出；三项万相预算均归零，专用 Web/API/PostgreSQL 已停止。外发双开关保持关闭，数据、原失败任务及成功任务均保留；未提交、推送或部署代码。

专用凭据保留在隔离目录供后续授权使用，未进入代码或交付 ZIP。已确认 OSS 为私有；远端暂存对象没有在本轮删除，自动生命周期清理规则尚未核验。


产物根目录：`/Users/nickfury/.codex/visualizations/2026/10/29/01a1858a-ca6f-7412-a2dd-c9390a0d67cc/wan-video-replication`。
