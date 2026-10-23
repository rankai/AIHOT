# 后台主流程易用性验收

2026-10-23，基于 PR #4 的 `c7671c1`，分支 `codex/admin-workflow-usability`。本文记录提交前的本地验收；用户随后授权提交、推送及创建独立 PR，远端 CI 与交付状态见该 PR。使用独立 `_test` 数据库和本地供应商桩，无真实付费调用。

本轮复用现有页面与 UI 组件，将操作入口连接得更明确：

- 数据工具 → 提交 → 对应执行记录 → 进度 / 结果 → 返回对应工具工作区。
- 信源 → 采集订阅 → 执行历史与结果 → 本轮详情 → 返回对应订阅或选择相关信源。

后端只增加既有执行记录的订阅与状态过滤，使用现有持久化归属；没有新增表、状态、队列或执行框架。具体实现与验证见 [实施记录](../../admin-workflow-usability.md)。

## 截图与批注

每项均有原图和批注图。桌面截图 1440×1000，窄屏 430×1000；使用同一浏览器的 CDP 原生截图，避免宿主窗口截图裁切。批注是临时 DOM 覆盖层，未写入产品界面。

| 验收位置 | 操作与变化 | 批注图 | 原图 |
| --- | --- | --- | --- |
| 数据工具 | 顶部突出进度与结果、采集订阅；工作区保留草稿并写入 URL；说明提交后的去向 | [查看](01-data-tools-annotated.png) | [原图](01-data-tools.png) |
| 费用工作区 | 将预算设置、运行与回执收拢到费用与账单 | [查看](02-costs-annotated.png) | [原图](02-costs.png) |
| 执行记录列表 | 状态筛选与明确的查看进度 / 查看结果入口，编号仍可进入详情 | [查看](03-execution-list-annotated.png) | [原图](03-execution-list.png) |
| 查询详情 | 本地查询真实落库；定位进度或结果；返回平台查询工作区 | [查看](04-query-result-annotated.png) | [原图](04-query-result.png) |
| 订阅运行进度 | 运行一轮后进入对应详情；可返回订阅或同订阅历史 | [查看](05-collection-progress-annotated.png) | [原图](05-collection-progress.png) |
| 同订阅历史 | 已完成且无在途执行时，仍可按订阅找到结果 | [查看](06-subscription-history-annotated.png) | [原图](06-subscription-history.png) |
| 采集结果 | 从列表直接定位结果区，沿用候选、原文及关联信源 / 材料的现有展示 | [查看](07-collection-result-annotated.png) | [原图](07-collection-result.png) |
| 采集订阅列表 | 收拢平台、供应商和调度列；历史入口持续存在；编辑直接定位 | [查看](08-subscriptions-annotated.png) | [原图](08-subscriptions.png) |
| 订阅编辑区 | 返回指定订阅、带入草稿、新建和编辑均定位现有配置区域；刷新不抢焦点 | [查看](09-subscription-editor-annotated.png) | [原图](09-subscription-editor.png) |
| 信源详情 | 主订阅的范围历史入口；原有历史清单中的完成记录可直达结果 | [查看](10-source-history-annotated.png) | [原图](10-source-history.png) |
| 批量 / 空结果详情 | 多信源逐一提供链接；完成空结果不再提示继续等待 | [查看](11-batch-source-return-annotated.png) | [原图](11-batch-source-return.png) |
| 待核对详情 | 原因、下一动作、诊断与恢复操作仍可访问 | [查看](13-review-progress-annotated.png) | [原图](13-review-progress.png) |
| 窄屏工具页 | 工作区与主操作换行，保持原有样式 | [查看](14-tools-narrow-annotated.png) | [原图](14-tools-narrow.png) |
| 窄屏记录列表 | 状态筛选可直接操作，表格沿用横向滚动 | [查看](15-executions-narrow-annotated.png) | [原图](15-executions-narrow.png) |
| 窄屏记录操作 | 横向滚动后可访问进度和结果链接 | [查看](16-executions-narrow-actions-annotated.png) | [原图](16-executions-narrow-actions.png) |
| 窄屏订阅列表 | 原有横向滚动保留，新建 / 编辑可以定位配置区 | [查看](17-subscriptions-narrow-annotated.png) | [原图](17-subscriptions-narrow.png) |

## 验证结果与边界

- Web 定向测试 43/43 通过；后端历史筛选集成测试 1/1 通过；类型与 diff 检查通过。
- 两条代表性浏览器路径实际提交到本地 API，由现有执行器使用本地桩响应完成并保存结果与回执。采集完成后订阅占用已释放。
- 状态筛选保留订阅范围；无匹配记录显示空态。后端验证了超过全站最近 100 条的旧订阅记录仍可查询，并覆盖同一执行关联多个订阅。
- 旧 RSS 仅保留实际抓取历史，不产生不存在的统一执行记录入口。批量信源、异常状态和空结果画面为人工构造的本地样本。
- 未执行真实供应商调用、生成任务、生产操作或全量 Worker 回归；本次没有修改这些业务流程。PR #4 保持原状，第三阶段及五条未开放路线继续暂缓。
