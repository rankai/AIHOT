# 数据工具验收及布局、文案、P3 修复

日期：2026-10-27。属于 PR #8 的增量交付。初次全工具本地验收基于 `05c3cb3`；随后按用户反馈修复布局、视频称呼和缺依据中文提示。本文件区分初验与修复后的证据，不将不同轮次重复相加。

## 最终变更

- 关联材料操作行垂直居中；信源搜索／新建操作统一居中，结果导入与采集订阅共用。
- 图片／视频创作参考图上传按钮与输入框对齐，说明置于下方，并用 `aria-describedby` 保持说明关联。
- 栏目管理顶部说明与“新建栏目”居中；窄屏保留自然换行。
- “私有视频产物”改为“生成的视频”；表单、进度和结果同步使用生成的视频／文件／结果，明确保存在私有素材，不自动发布。
- 转写填正文缺少核实依据的英文提示改为：**请填写“同一作品核实依据”，说明此结果与所选材料属于同一作品。仅凭任务 ID、媒体地址或分享文案无法确认。**
- 复用既有组件、错误响应和 Toast。没有更改查询、预算、执行、上传、权限或发布逻辑，没有新增表、列、队列、业务状态或抽象。

## 本地验收结果

| 轮次 | 范围与结果 | 边界 |
| --- | --- | --- |
| 初次完整检查 | 8 个工具页；48 条页面实际提交的合成执行全部完成，逐条回访有结果、可返回工具 | 通过现有 API、执行器与持久化；执行器由测试脚本驱动，未持续运行 Worker |
| 平台表单检查 | 19 个分组、171 个接口／供应商组合全部呈现，无收集到的表单错误 | **171 是表单组合数，不是逐接口端到端执行或真实调用数** |
| 初次测试 | 后端 650/650＋附件 18/18＋Web 382/382＝1,050/1,050，失败/取消/跳过均 0 | 基于修复前代码；不把后续重跑叠加成新增用例 |
| 首轮 UI 修复 | result-use-data / video-data 17/17；桌面及窄屏实看 | 布局和文案，不验证真实视频生成质量 |
| 后台同类检查 | 26 个页面／工具视图；修复 3 个共用组件，回看 5 个入口及 3 类窄屏 | 6 个现有相关测试文件 26/26；没有枚举全部运行状态、错误弹窗 |
| P3 定向修复 | 先红：HTTP 实际仍返回英文；修改后附件集成测试 18/18 | 缺依据的 attach / fill-body 均 422、无写入；补证 fill-body 成功且不请求供应商 |

本地命令均使用干净环境、测试凭据、localhost 桩和独立 `_test` 数据库，未读取日常 `.env` 或真实密钥。数据库为 `aihot_data_tools_acceptance_test`（自动化）和 `aihot_data_tools_ui_test`（浏览器合成记录），服务位于 localhost，非日常数据库。临时 3380–3383 服务和验收浏览器空间已关闭。

## 8 个工具页的实际覆盖

| 工具页 | 实际执行和后续操作 |
| --- | --- |
| X 查询 | 账号及推文详情；账号关联既有信源，权限保持 |
| 平台查询 | Redfox / AgentKey 抖音代表路线；作品查询后选源导入；余额及账单；配置带入未启用订阅草稿 |
| 图片创作 | 5 种模型提交、合成图片结果、已有任务查询、复用已上传参考素材 |
| 辅助工具 | 6 种转写入口、14 种同步工具、评论提交与取结果、已有任务查询 |
| 私有素材 | 本地上传下载、显式供应商上传、生成引用复用、删除与历史状态、本地 H.264 播放 |
| AI 搜索 | 7 种模型提交与结果、已有任务查询 |
| 视频创作 | 生成、结果、已有任务查询、参考素材上传复用 |
| 费用与账单 | 本地记录、已存账单选择、分页范围及未知分类边界；没有推断逐笔实扣 |

具体 48 条清单见 [browser-run-checks.json](browser-run-checks.json)，171 个表单记录见 [platform-ui-matrix.json](platform-ui-matrix.json)，其他后台页面检查范围见 [checked-pages.json](checked-pages.json)。

## 关键闭环与不变量

- 独立查询无需信源，作品导入时选择信源；导入沿用原权限，不自动公开。此处的样例停留在材料处理入口，本轮没有真实分析。
- 转写成功可保存 TXT、关联材料、经核实填入缺失正文；已有正文不覆盖。P3 在浏览器实际经过“空依据拒绝 → 中文 Toast → 保留原因 → 填写依据 → 成功”，原归属不变。
- 媒体解析仅返回地址，显式保存才保存私有文件；字幕可存 VTT。不是所有查询结果都可导入文章。
- 普通本地上传只产生私有素材；供应商上传产生执行记录。同一参考图用于图片与视频生成，桩上传接口仅收到 1 次，复用有效。
- PNG / MP4 下载与本地源文件一致，JSON 可导出；删除素材后不可继续下载或引用，历史回执保留。
- tiny.mp4 是传输夹具，不能证明播放质量。另用本地生成的 2 秒 H.264 验证播放器时间推进且无解码错误。
- 查询已有图片、视频、转写、AI 搜索和评论任务未重新提交生成任务。
- 评论等待以模拟时间超过 24 小时后查询，未重复提交；AgentKey 本地传输 unknown 回执模拟超过恢复窗口后仅恢复一次，沿同一回执完成。**不是实际长时间运行或真实上游故障联调。**
- “带入新采集订阅”只带配置草稿，没有创建或启用订阅。

## 仍未验证的范围

真实供应商响应、真实模型质量、真实媒体地址及实际扣费均未在本轮验证。所有查询、转写、生成、余额、账单和媒体响应来自本地合成服务；费用页数值不代表真实消费。没有验证持续 Worker 调度、完整分析流水线或真实模型。

此前 5 条暂缓路线继续暂缓：抖音粉丝、头条视频详情、微博粉丝、小红书评论回复、公众号相关文章。没有开放或调用这些真实路线。

原 PR 信源到栏目验收的“合成分析、未验证真实模型及持续定时运行”边界继续有效。本轮只补充数据工具验收与局部修复；不合并、不部署、不开启自动合并。

## 截图索引

共 34 组（68 张 PNG），每组保留原图与蓝框批注。1–17 为修复前完整流程验收；18–21 为首轮布局与视频称呼修复；22–24 为同类检查修改前，25–32 为修复后；33–34 为中文提示与补证成功。不要用早期旧称呼／旧布局截图判断当前实现。蓝框和注释不是产品 UI。

| 编号 | 内容 | 链接 |
| --- | --- | --- |
| 1 | 评论任务等待与下一步 | [批注](01-comment-wait-annotated.png) · [原图](01-comment-wait.png) |
| 2 | 查询结果导入信源 | [批注](02-platform-import-annotated.png) · [原图](02-platform-import.png) |
| 3 | 转写关联材料（修复前） | [批注](03-transcript-use-annotated.png) · [原图](03-transcript-use.png) |
| 4 | 媒体显式保存附件 | [批注](04-media-save-annotated.png) · [原图](04-media-save.png) |
| 5 | 素材上传确认 | [批注](05-upload-confirm-annotated.png) · [原图](05-upload-confirm.png) |
| 6 | X 账号与信源 | [批注](06-x-account-annotated.png) · [原图](06-x-account.png) |
| 7 | 费用与账单 | [批注](07-costs-annotated.png) · [原图](07-costs.png) |
| 8 | 图片生成结果 | [批注](08-image-annotated.png) · [原图](08-image.png) |
| 9 | 视频生成结果（旧称呼） | [批注](09-video-annotated.png) · [原图](09-video.png) |
| 10 | AI 搜索结果 | [批注](10-ai-search-annotated.png) · [原图](10-ai-search.png) |
| 11 | AgentKey 独立路线与恢复 | [批注](11-agentkey-annotated.png) · [原图](11-agentkey.png) |
| 12 | 字幕保存私有附件 | [批注](12-subtitle-annotated.png) · [原图](12-subtitle.png) |
| 13 | 评论完成结果 | [批注](13-comment-result-annotated.png) · [原图](13-comment-result.png) |
| 14 | 素材删除后保留历史 | [批注](14-asset-deleted-annotated.png) · [原图](14-asset-deleted.png) |
| 15 | 私有视频播放 | [批注](15-private-video-play-annotated.png) · [原图](15-private-video-play.png) |
| 16 | 已存账单核对边界 | [批注](16-stored-bill-annotated.png) · [原图](16-stored-bill.png) |
| 17 | 查询带入订阅草稿 | [批注](17-subscription-draft-annotated.png) · [原图](17-subscription-draft.png) |
| 18 | 关联材料操作已对齐 | [批注](18-linked-actions-aligned-annotated.png) · [原图](18-linked-actions-aligned.png) |
| 19 | 关联操作窄屏 | [批注](19-linked-actions-mobile-annotated.png) · [原图](19-linked-actions-mobile.png) |
| 20 | 生成的视频（新称呼） | [批注](20-generated-video-label-annotated.png) · [原图](20-generated-video-label.png) |
| 21 | 视频表单文案 | [批注](21-video-form-copy-annotated.png) · [原图](21-video-form-copy.png) |
| 22 | 信源选择修复前 | [批注](22-source-before-annotated.png) · [原图](22-source-before.png) |
| 23 | 参考图上传修复前 | [批注](23-reference-before-annotated.png) · [原图](23-reference-before.png) |
| 24 | 栏目说明修复前 | [批注](24-columns-before-annotated.png) · [原图](24-columns-before.png) |
| 25 | 信源选择修复后 | [批注](25-source-after-annotated.png) · [原图](25-source-after.png) |
| 26 | 图片参考上传修复后 | [批注](26-image-reference-after-annotated.png) · [原图](26-image-reference-after.png) |
| 27 | 视频参考上传修复后 | [批注](27-video-reference-after-annotated.png) · [原图](27-video-reference-after.png) |
| 28 | 栏目说明修复后 | [批注](28-columns-after-annotated.png) · [原图](28-columns-after.png) |
| 29 | 订阅信源选择修复后 | [批注](29-subscription-source-after-annotated.png) · [原图](29-subscription-source-after.png) |
| 30 | 信源选择窄屏 | [批注](30-source-mobile-annotated.png) · [原图](30-source-mobile.png) |
| 31 | 参考图上传窄屏 | [批注](31-reference-mobile-annotated.png) · [原图](31-reference-mobile.png) |
| 32 | 栏目说明窄屏 | [批注](32-columns-mobile-annotated.png) · [原图](32-columns-mobile.png) |
| 33 | P3 缺依据中文提示 | [批注](33-evidence-chinese-error-annotated.png) · [原图](33-evidence-chinese-error.png) |
| 34 | P3 补齐依据后成功 | [批注](34-evidence-filled-success-annotated.png) · [原图](34-evidence-filled-success.png) |
