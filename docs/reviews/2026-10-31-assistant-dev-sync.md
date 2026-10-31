# 助手开发分支同步 dev 验收记录

日期：2026-10-31。范围：将现有助手开发内容接到最新 dev 的会员、预算池及已批准工具价目机制上；不部署、不推送、不创建功能提交。

## 基线与保留方式

用户确认“同步最新 dev，保留助手开发内容”。main 仍为 `47d7ec6aea4ec661c26c0da5b452fe1f4c48f5a6`；预算等新配置位于 dev。`codex/assistant-v1` 已由该基线快进至 `53556784a0d12dbede74846065312ba70ad0f80b`，完成前再次 fetch 确认与 origin/dev 一致。

同步前的 164 个已修改或未跟踪文件均已归档并记录 SHA-256；另保留 Git stash `59b8ce0208abbee8ff1a07e1cab78e0247e3dcfc`。备份目录：`/private/tmp/aihot-assistant-sync-20261031-1793406320`，含 `working-changes.tar.gz`、`manifest.json`、补丁及逐文件核对结果 `preservation-audit.json`。

恢复开发内容后逐项处理 17 个已跟踪文件冲突，并核对 6 个内容不同的未跟踪文件重叠项。原清单没有文件缺失；助手前端目录的 18 个文件及全局样式共 19 个文件与同步前逐字节一致。重叠处保留 dev 的新约束，同时保留助手路由、执行、积分、恢复及后台控制。已有 Wan 等开发内容继续保留或与 dev 对应实现合并。

开发改动保持未暂存状态；没有残留冲突标记或未合并索引项。备份与 stash 均未删除。

## 必要适配与评审结果

- 助手模型的 `beforeClaim` 继续执行父任务锁和会员积分校验，并返回共享回执层产生的预算上下文，使实际调用归入持久化 actor 对应的会员池。全站总预算与会员池同时生效，不能借用 admin 额度。
- 新增 `0088_assistant_budget_scopes.sql`，以零额度初始化 `assistant.text` 的 member/admin 池，存在时不覆盖。后台设置展示该项；迁移不自动启用调用或创建模型价格。
- 小红书查询在报价和新的批准动作中复用 dev 的已核定成本准入。已批准命令的幂等恢复继续沿原授权处理，不重新购买或重复占用。
- 应用已批准工具价目时，保留精确匹配 `assistant-turn` / `assistant` 的独立助手价格；其他旧工具价格仍按 dev 原规则处理。
- 后台积分表单同时保留助手与阿里云万相配置。切换工具类别时修正供应商默认值，切换万相时正确设置模型与模式档位；说明文字同步明确助手价格独立保留。
- 保留现有 `0085_assistant.sql`、`0086_assistant_source_snapshots.sql` 文件名。迁移器按完整文件名记录，不因 dev 的同数字前缀会员迁移而重命名已使用的助手迁移。

主会话处理 Git 与集成验收；Astra 执行器负责预算、价格适配及专项测试，并独立复核共享回执、任务恢复、助手父子操作与成本限制。未发现已确认的集成回归。助手未知结果不会被自动释放再购买，等待用户补充、批准或子任务的父任务也不会被当成新模型步骤重跑。

## 验证证据

使用 Node.js 24、本地桩和隔离的 `_test` 数据库，未调用真实付费模型或供应商。

| 检查 | 结果 | 本地日志（位于上述备份目录） |
| --- | --- | --- |
| 助手 API、技能目录、恢复、续跑、预算池、会员价目 | 38/38 通过 | `assistant-integration.log` |
| 共享回执、操作任务与恢复、积分、会员工具、视频和转写 | 85/85 通过 | `provider-integration.log` |
| 助手前端、账号导航、缓存、展示、口播视频及报价估算 | 41/41 通过 | `web-tests.log` |
| 全项目 `npm run typecheck` | 通过 | `typecheck.log` |
| `npm run build -w @aihot/web` | 通过 | `build.log` |
| `git diff --check`、未合并索引项检查 | 通过 | 完成时再次检查 |

合计 164 项测试通过。专项测试首次运行因隔离环境清除了 PostgreSQL 用户名而失败；补上测试环境的显式 `PGUSER` / `USER` 后重跑通过，没有为此修改业务逻辑。初次日志保留为 `assistant-integration-initial-environment-failure.log`。

新建 `aihot_assistant_dev_sync_test`，从空库完成 87 个迁移。已有合成验收库 `aihot_assistant_chat_ui_test` 从 83 个迁移升级到 87 个；升级前后均为 111 个会话、338 条消息。直接核对新增助手 member/admin 池默认额度为零；后续浏览器夹具仅为本地桩显式设置测试额度。证据为 `fresh-migrate.log`、`upgrade-before.txt`、`upgrade-migrate.log`。

浏览器检查了已有助手会话、稿件、版本、来源及执行步骤，均可读取；三栏页面保持原实现。后台新增规则表单验证了“助手 → 视频 → 万相”的供应商、模型及档位切换；未保存表单或应用价目。设置页可见 `assistant.text` 总池、admin 池、会员池。本轮未重新执行整套手机端交互验收，助手界面文件保持原样，相关前端测试通过。

页面证据：`/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-dev-sync/preserved-assistant.png`。

## 收尾与限制

本次启动的浏览器任务空间、本地 API / 模型桩 / Web 服务以及 56483 端口的独立 PostgreSQL 测试实例均已关闭，3400、3401、3402、56483 端口无监听。未读取真实密钥或运行数据，未操作日常开发或生产数据库，未部署、推送或运行远端 CI。真实模型与供应商兼容性仍沿用原有另行验收要求，本次本地桩结果不替代真实付费验证。
