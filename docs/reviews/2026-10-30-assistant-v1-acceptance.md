# 创作助手第一版本地验收

日期：2026-10-30。范围为已评审方案阶段 A：统一底座、综合创作入口与小红书专属入口；暂不部署，不调用真实付费供应商。

## 交付行为

- 综合入口 `/tools/assistant` 和专属入口 `/tools/assistant/xiaohongshu` 共用 `features/assistant` 及后端领域；会话固定身份，历史/执行记录回到 canonical session。
- assistant-ui 使用真实 ExternalStore runtime；AI SDK 负责一次模型决策。后端 operation/pg-boss 推进持久步骤、工具批准和交付，页面只读轮询；本版不做 token 流式输出。
- 通用写作、原创小红书 M1 单关键词检索子集及 M2 改写；模型从冻结候选中选择模块，含糊时追问。检索复用 Redfox 既有业务，单独报价批准。公众号显示“未开放”，不能被按钮或伪造 taskHint 启用。
- 私有会话、父回合报价/积分预占、消息与作品来源保存、手动新版本、历史版本、选定稿件显式转交、停止/恢复、管理员整组控制。
- 原技能包无明确许可：保留既有审计和固定版本证据，使用自有规则；不复制上游提示词，不执行包内脚本。完整多批次研究、封面分析/制作、发布及公众号专属能力未纳入本版。

## 复用与扩展评审

付费请求仍经过 receipts 与预算，费用仍经过 member_credit_charges/ledger；父子任务使用原会员 actor，通用 admission 限额保持单一权威。没有新增助手服务器、第二套队列/钱包或任意代码执行器。

首版标准已对应到本地严格manifest、包/模块/资源哈希、受控加载与引用读取、模块工具边界、冻结版本、权限复查和执行恢复。后续公众号可以添加技能和profile/快捷动作；新工具/作品类型必须新增对应业务合同与验收，不能只上传SKILL.md。具体步骤见 [技能接入标准](../assistant-skill-integration-standard.md)。

模型适配目前为 OpenAI-compatible Chat Completions text-tools，仅实现 cl100k_base tokenizer。配置中“已验证”是运营声明；真实模型能力/输出质量不由本地桩证明。

## 环境与有效性

- 工作树：`/Users/nickfury/.codex/worktrees/assistant-v1/AIHOT`，`codex/assistant-v1`，基线 `47d7ec6aea4ec661c26c0da5b452fe1f4c48f5a6`。包含必要的既有 Wan/Redfox未提交前置源码，本次不能把整份git diff都当作助手修改。
- Node 24.19.0、PostgreSQL 17.9，专用集群127.0.0.1:56483。执行者使用 `aihot_assistant_v1_test`；主导独立使用 `aihot_assistant_v1_acceptance_test`。后者空库应用83份迁移至0086；初始化assistant.text预算0/0/0，测试进程显式使用假凭据和本地桩。
- 浏览器闭环：页面3400 → 真实API3401 → pg-boss Worker → 本地模型/Redfox桩3402 → 实际PostgreSQL → 页面持久结果。仅注册operation队列，不运行采集/推送服务。
- 精确依赖：ai 7.0.157、@ai-sdk/openai-compatible 3.0.81、js-tiktoken 1.0.21、@assistant-ui/react 0.15.32，保留npm锁文件。审计发现的现存依赖风险未通过升级无关依赖来掩盖。

## 浏览器与持久事实

| 用例 | 结果与证据范围 |
| --- | --- |
| 登录与入口 | 匿名重定向登录；已登录可进入双入口，公众号禁用；读取/免费建会话不调用模型 |
| 报价取消/提交 | 取消保留输入；明确确认后才创建父回合；通用稿和M2笔记可读且重载保留 |
| 编辑/版本/转交 | 生成版本1→手动版本2→查看版本1→预览确认转交小红书新会话；带入的是选定版本1，后续创作另报价 |
| M1检索 | 等待卡显示关键词/日期及独立3积分；重载仍等待，批准后child执行并交回可读来源；部分交付显示实际样本范围 |
| 澄清 | 含糊需求进入问题卡；回答后继续同一回合，不另开收费回合 |
| 未知提交 | 对一次POST在服务器返回202后丢弃浏览器响应；页面保留原输入并阻止新报价。站内离开返回后重试原命令成功，原任务只有一张charge |
| 停止与恢复 | 等待问题时停止，重载/恢复仍呈现原问题；回答后才继续。管理界面填写原因后整组停止/恢复也保留会员问题 |
| 管理子任务 | 子任务详情链接父回合，不出现独立恢复/放弃；父回合不提供通用abandon |
| 视觉与运行时 | 桌面1745px、移动390×844；深色入口和浅色作品页无横向溢出；最终站内导航error/unhandledrejection采集为空 |

独立SQL核对：父run 22/23/24/26/27/28分别model_calls 2/2/3/2/2/3，均completed、settled各7积分；检索child25 settled3积分。26为整页重载响应丢失用例，27为站内返回重试原命令用例，没有重复任务/charge。29为会员停止/恢复问题，30为管理员停止/恢复问题，均通过实际页面回答后交付。7/3为本地fixture价格，不是正式售价。

未发送草稿/原命令重试上下文只在当前页面进程内存保留；站内导航支持恢复，整页刷新以服务端已接受的任务为准，不承诺未发送草稿跨刷新保存。浏览器故障注入只丢弃本地测试响应，未模拟或调用真实供应商。

## 发现与修复

1. 主导发现等待phase恢复直接改waiting绕过全局5任务限制；复现为activeRuns=6。Astra Max统一走resumeRun，任一child准入失败整组回滚，等待问题/批准不自动入队。
2. 已结算stopped child原先仍显示可恢复；现在读投影与实际charge围栏一致，不能重开费用。
3. 认证后等待会员锁期间账号被停用，原resume仍能变active（Worker已阻止外发）；共享恢复事务在锁后复核账号状态，关闭该竞态。
4. 通用管理控制原先拒绝所有助手任务但页面显示可操作；现在管理员父stop/resume复用领域整组控制和会员配额，审计同事务；child单独控制与abandon明确拒绝。已收到的原响应在外发阀关闭时仍可本地消费；unknown/pending不重买。
5. 等待问题/批准/child的管理“下一动作”由旧恢复调度提示改为具体等待说明。

前端初次类型检查/构建的问题（恢复参数和跨route loader导入）及测试fixture冲突已修正并重跑；不把最终通过写成首次全绿。

## 自动化证据

主导在最终源码上独立执行：

- `node --test --test-concurrency=1 --test-timeout=120000 tests/assistant-api.test.ts tests/assistant-catalog.test.ts tests/assistant-recovery.test.ts tests/assistant-resume.test.ts tests/assistant.test.ts`：20/20，0失败/跳过；独占acceptance_test，本地桩。
- `npm run typecheck`：contracts/backend/api/worker/tests及web均通过。
- `npm run build -w @aihot/web`：通过，随后对当前构建执行3份assistant web测试，9/9通过，含真实runtime SSR。
- `git diff --check`：通过。
- 执行者补充有效证据：既有积分/恢复/会员工具32项通过；Max修复后的助手专项18/18、普通会员并发恢复3/3。以上与主导20项有交集，不相加虚报总数。

最终日志及截图已另存 [持久验收证据](/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-v1-acceptance/README.md)。临时原始证据在 `/private/tmp/aihot-assistant-v1-01a18c93`。

结论：冻结工作树范围内首版本地验收通过，真实供应商及与另一会员报价任务的合并验收未执行。

## 模型分工

主会话由用户确认Astra High，工具未提供主模型元数据，不声称工具核验。后端关键包实际使用gpt-6-astra/medium；合同稳定后的前端包实际使用gpt-6.1-sol/xhigh；用户允许复杂/不明确任务用Astra Max后，恢复与管理控制修复包实际使用gpt-6-astra/max。执行包顺序进行，默认同时一个执行者；最终设计、集成和验收由主会话负责。恢复配额是首个后端交付后实质缺陷，保留红例及后续专项，不重置失败历史。未获取可归属本任务的精确token/费用数据。

## 交付边界与后续集成

代码、方案与测试保留在本工作树，未提交、推送、合并或部署；业务数据库未迁移，真实模型/Redfox未付费调用。未运行完整远端CI/Docker发布检查，不把本地typecheck/build描述为远端CI通过。真实内容质量、供应商兼容与正式费用须在另行授权范围内联调。

本轮期间“AIHOT 后台积分与前台工具端到端验收”任务已在日常目录同步新的会员套餐/工具报价及按钮。已只读核实来源；本任务没有覆盖或拷回日常目录，也没有把该任务新增变动自动并入冻结工作树。后续合并应保留两边对tools入口、tool-run、工具价格/credits等文件的增量，并复验成本准入。两任务均有0085/0086前缀迁移但完整文件名不同；迁移器按完整名称记账，合并时应并存验证，不覆盖已应用迁移或擅自改写历史。此报告不外推尚未执行的合并验收。

## 临时资源收尾

浏览器任务空间17已finish，恢复跟随系统主题；3400前端、3401 API/Worker和3402桩已停止；本任务56483测试PostgreSQL已正常停止，磁盘数据保留。独立工作树与分支保留供代码审阅，未归档以免影响未提交成果。既有本地/生产服务未重启。
