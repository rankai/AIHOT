# 助手三栏聊天工作区本地验收

日期：2026-10-30。依据：[已确认方案](../assistant-chat-workspace-plan.md)。结论：前端实施完成，核心本地桩闭环与响应式验收通过；未部署，未真实付费联调。

## 交付范围

独立一级“助手”入口及 /assistant、/assistant/xiaohongshu、/assistant/sessions/:sessionId；原 tools/assistant 页面 GET 私有跳转兼容。左侧整合可折叠网站导航、助手与会话历史；中间真实消息、当前任务、共用输入与明确报价；右侧稿件预览、版本、编辑、引用和转交。手机切换对话/稿件，单 controller/runtime；站点普通手机导航有独立助手项。

复用原后端、积分与命令幂等机制；本轮开始与结束的 backend/API/contracts 文件 SHA256 一致。前端服务器增加 assistant 私有缓存排除。首次需求前60个码点用于新会话标题，复用已有title字段，不增加模型调用。等待反馈区分执行、待回答、待批准、核对和断线，不伪造流式输出或预计完成时间。

## 环境与模型分工

- 工作树 /Users/nickfury/.codex/worktrees/assistant-v1/AIHOT，分支 codex/assistant-v1，基线47d7ec6aea4ec661c26c0da5b452fe1f4c48f5a6；保留已有未提交Wan/Redfox及助手首版改动。
- 主会话按用户确认的Astra High主导，运行接口没有主模型元数据，不声称工具验证。单执行者实际派发gpt-6.1-sol/xhigh，负责已确定的前端实现；主会话独立复核、浏览器验收并完成小型标题修正。
- 新建独立测试库 aihot_assistant_chat_ui_test，127.0.0.1:56483，83份既有迁移；未改业务库。浏览器3400 → 真实API/operation队列3401 → 本地模型/Redfox桩3402 → PostgreSQL；合成账号、假凭据，无真实供应商费用。

## 自动化验证

1. 主导执行既有 assistant-api、assistant-recovery、assistant-resume：18/18通过，无失败或跳过；证明原授权、恢复和费用边界。
2. 执行者执行web typecheck、生产build，通过。7份前端测试26/26通过：assistant-data、assistant-drafts、assistant-command-keys、assistant-render、cache、account-navigation、presentation-render；包含冻结请求/后写草稿、引用恢复、canonical登录返回、独立导航和真实构建服务器的私有缓存/旧GET重定向。
3. 主导最后补会话标题后重新web typecheck/build通过，并从浏览器新建验证标题栏及历史正确，报价取消未执行；该小改动后没有重复无关后端套件。
4. git diff --check通过，backend/API/contracts哈希核对无变化。未执行远端CI，不把本地构建称为CI通过。

## 主导浏览器闭环

| 场景 | 实际结果 |
| --- | --- |
| 首次发送与报价 | 自动免费建会话，报价取消保留输入；明确确认后才生成并持久化稿件 |
| 编辑及引用 | 版本1编辑为版本2；未保存引用触发保护，“保存后继续”引用v2及新标题 |
| 小红书澄清 | 问题进入主输入框；停止、重载、恢复仍保留问题；回答继续原回合，无新创作报价 |
| 单独检索 | 显示关键词、日期和3积分本地报价；刷新仍等批准；批准后真实child队列返回资料、来源及部分交付稿件 |
| 提交响应丢失 | 服务器已接受后丢弃一次浏览器响应；冻结原命令。站内离开返回后重试原提交，只有1条用户消息，后写下一轮草稿保留 |
| 等待与断线 | 慢速模型桩展示真实执行状态及本次查看等待15秒；断开事件读取后保留稿件和上次状态，恢复网络后只读同步自动清除提示 |
| 转交与归档 | v2明确转交小红书新会话；源会话归档后历史隐藏、原地址仍可查看 |
| 删除结果丢失 | 删除合成源会话后丢弃响应，界面读取404确认并返回入口；转交副本仍可读取 |
| 输入与手机抽屉 | 中文composition+Enter不取报价；Shift+Enter换行；手机抽屉聚焦内部、背景inert，Esc关闭并回焦菜单按钮 |
| 响应式 | 实际CSS宽1440/1280/768/390及390×420短窗口，无横向溢出；始终只有1个composer。手机稿件切换正确，深浅主题检查通过 |

SQL独立核对：父run78/79/80/82各自completed且只有对应一张settled charge、amount/consumed均为7。82为响应丢失重试场景，没有重复turn或charge；检索child81沿独立检索费用合同。7/3仅为测试价，不是正式售价。

证据范围：桌面浏览器设备模拟和短视口验证，不是iOS/Android真机或系统软键盘认证；中文输入验证为组合事件及键盘操作。真实供应商内容质量、线上性能、生产费用及与日常目录会员改动的合并验收未执行。

测试期间发现并修正：等待用户操作时误用后台处理文案、4xx返回修改时引用恢复、保存后转交/引用的版本闭包、技术说明外露、历史默认标题难区分。工具验证过程中出现过密码管理器遮挡、过期快照引用及视口缩放导致的定位/截图问题；按真实DOM与CSS尺寸纠正，不计作业务成功，也未靠重发付费请求绕过。

## 证据与收尾

截图目录：[最终桌面](/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-chat-ui/final-desktop.png)、[手机稿件](/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-chat-ui/mobile-artifact.png)、[短视口](/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-chat-ui/final-390x420.png)。手机稿件截图为中间通过检查的构建，最终仅修改面板说明及会话标题，不将其称为最终像素截图。

原始环境/日志位于 /private/tmp/aihot-chat-ui-20261030；执行者构建日志 /tmp/assistant-chat-build.log，26项测试输出在本聊天工具记录。工作树保留未提交成果；未提交、推送、合并、部署或同步日常数据库。测试服务停止后的状态另见下方收尾记录。

收尾确认：浏览器空间20已finish，恢复跟随系统主题；3400前端、3401 API/Worker、3402本地桩及56483测试PostgreSQL已停止。测试库磁盘与专用工作树保留。

## 后续细化：对话定位与逐动作反馈

用户继续要求优化“本回合”等用语、参考 Codex 消息刻度及 GEO 步骤动画，并确认逐步展示真实动作、隐藏供应商品牌。此段是最新范围；前文“backend/API/contracts全部哈希不变”只描述最初三栏改版，不覆盖本次明确授权的只读投影扩展。

实施：桌面聊天区左侧使用真实用户消息刻度，支持预览、点击、方向键/Home/End与Enter，当前项跟随阅读并仅滚目录自身；手机采用44px触控目录，跳转后收起并聚焦目标。常用界面文案移除回合/父回合。执行过程可折叠，审批/补充问题/异常操作保持可见，真实活动才有动效，支持减少动态效果。

后端只读投影新增 turn.activities，来自已有模型步骤、工具调用、执行状态和回执状态，按模型序号/工具序号排列，稳定ID避免刷新重复。投影只包含白名单动作、状态、ID及最多120字符的字符串关键词；不返回供应商、模型、地址、请求快照、提示词、技能正文或原始回执。当前仅单关键词笔记查询，不宣称实现热门爆文查询。完成摘要只在本次有成功save_draft记录时说“稿件已保存”。队列空档显示“等待下一步处理”。已有后端执行writer、权限、费用、数据库结构与恢复机制均未改。新模块 activities.ts、sessions.ts读路径和assistant DTO是本次后端变更；此前哈希基线的其余文件保持一致。

分工：前端导航/文案由gpt-6.1-sol/xhigh实现，跨进程只读投影由gpt-6-astra/medium实现，均由主会话设计边界及独立复核验收；主模型设置仍依据用户已确认的Astra High，工具未返回主模型元数据。

验证：contracts/backend/web/tests类型检查通过；扩展真实库API与SSR定向2/2通过，最后关键词类型保护后API1/1复跑通过；最终集成4份assistant前端测试14/14通过，排队摘要小修后SSR1/1及web类型复跑通过。主导恢复/resume回归17/17通过，生产前端构建通过。没有远端CI或真实供应商费用。测试使用原有隔离库aihot_assistant_chat_ui_test、127.0.0.1:56483及本地模型/查询桩。

API验证覆盖逆UUID步骤顺序、只返回公开动作、私密哨兵不泄露、其他账号404、无回执/待批准不冒充执行、预算等待/未知/停止映射、只读GET不增加模型调用或积分记录。浏览器已验证40条需求/40条回复的合成长目录、首尾/中段定位和键盘焦点；390px目录展开与目标避让；慢速模型的真实调用反馈、15秒等待说明、断线停止动效和只读恢复；步骤收起后批准按钮仍可见，明确批准才显示正在查询，完成后显示真实保存动作。短视口和最终截图记录见后续收尾。

过程中修正：手机目录定位间距、隐藏控件焦点、长目录当前项可见性、供应商文案、停止后摘要优先级、队列空档摘要、查询响应已返回但尚未入库时的等待状态。一次web TS2367冗余分支错误已修复复跑；浏览器工具跨调用重置模拟视口、平滑滚动中间态和等待队列20秒观测超时均按实际状态复核，未重发原付费请求。

原始构建/测试日志与合成夹具：/private/tmp/aihot-dialog-ux-20261030。截图目录：/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-dialog-ux。actions-querying.png记录实际查询阶段；旧desktop-running.png仅记录细化前的状态卡，不能作为逐动作最终版本证据。

最终收尾：在最终构建上，新的请求开始时显示“等待下一步处理”，从第1条旧消息阅读直至后台完成，scrollTop保持在顶部范围并出现“有新消息”，未被拉回底部。真实检索必须明确批准，期间观察到“正在查询‘验收相机’”，最终动作序列为收到请求、接口返回、加载技能、接口返回、查询返回、接口返回、稿件保存；刷新后仍为相同记录。1440×900、390×844、390×420均无横向溢出且只有1个输入框，深浅主题已检查。

最终截图：[桌面逐动作与稿件](/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-dialog-ux/final-actions-desktop.png)、[手机动作](/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-dialog-ux/final-mobile-844.png)、[浅色手机](/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-dialog-ux/final-mobile-light.png)、[手机长目录](/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-dialog-ux/mobile-directory.png)。最后一图使用本轮导航实现的合成80条消息，不代表80次模型执行。

浏览器空间22已finish，恢复跟随系统主题；3400前端、3401 API/Worker、3402本地桩及56483 PostgreSQL已停止。工作树及隔离库磁盘保留；未提交、推送、部署或同步日常目录。手机仅浏览器模拟，真实供应商内容质量、线上环境和真机软键盘未验收。


## 本次完整复评与修复

用户要求完整复评并直接修复，重点为对话、步骤真实性、手机与原执行/计费边界，暂不部署。继续沿用同一工作树和隔离库；主会话承担最终验收，gpt-6-astra/medium 独立评审并修复只读状态同步，主会话直接修复局部界面问题。开始时文件文本保存在 `/private/tmp/aihot-dialog-review-20261030/before.json`。

确认并修复五类问题：

| 问题 | 修复与验证 |
| --- | --- |
| 停止后的迟到回执无新事件，界面停留旧状态；空事件成功会掩盖快照失败 | 新增可选只读 `needsSnapshotRefresh`，复用原有回执行；pending/unknown 继续同步，稳定后停止额外快照读取。只有成功接受快照才清除错误，失败自动重试。浏览器真实慢速桩中 eventSeq 持续为4，停止后的 `canResume=false` 自动变为true、显示“创作接口已返回”，任务仍停止；只有确认提交和停止两次POST。 |
| 完成检索还展示过时余额及“报价已过期” | 待批准仍显示确认所需报价；其余状态只显示“当时检索报价”，不冒充已结算金额或当前余额。停止历史报价每秒计时。渲染回归与已完成检索浏览器实测通过。 |
| 返回历史阅读位置误报“有新消息” | 初次挂载和切换会话不算新进展；仅消息或执行状态变化才提示。实测长对话第4条阅读位置恢复为885.45px，无虚假更新提示。 |
| 手机目录点击外部/移出焦点不能关闭 | 增加外部pointer及focus关闭、Esc归焦；跳转仍聚焦正文。实测第21条目标top167px，目录按钮bottom151px，保留16px间距，原生外部点击关闭成功。 |
| 短手机窗口快捷按钮换行挤压聊天和发送 | 高度小于560px时快捷按钮单行横向滑动、输入框48px。390×420时聊天区从88px增至129px，发送按钮bottom396px；320×480 bottom456px，均完整可见。普通手机保持原换行布局。 |

自动化：最终四份前端assistant测试15/15通过；API/recovery/resume串行18/18通过，0失败/跳过。新增API断言覆盖停止/待核对时无事件回执转换、独立子回执、稳定状态停止额外读取；GET不增加外部请求或积分记录。web/backend类型检查、最终前端构建和`git diff --check`通过。日志位于 `/private/tmp/aihot-dialog-review-20261030`，后端回归结果另见本任务执行者工具输出；未运行远端CI。

浏览器补充：只阻断snapshot、继续放行events，三次失败后错误提示仍在；恢复后自动清错，snapshot次数固定4次而events从23继续增至33，无POST。长目录键盘/聚焦、会话恢复、320/390/768宽度、390×420短窗口、对话/稿件切换验证通过，页面无横向溢出且只有一个输入框。截图在 [本次复评证据目录](/Users/nickfury/.codex/visualizations/2026/10/30/01a18c28-9e4c-79f0-95a8-eeb21c8d71d3/assistant-dialog-review)，包括 `completed-desktop.png`、`stopped-response.png`、`final-mobile-390x420.png`、`final-mobile-320x480.png` 和 `final-mobile-artifacts.png`。

边界复核：原376份backend/API/contracts哈希基线中，仅sessions.ts和assistant.ts发生预期只读合同变化，另有新增activities.ts；执行、授权、积分占用/结算/恢复及数据库结构均未改。轮询只GET、单请求作用域、隐藏页暂停，保留所有权校验与只读事务。未发起真实付费、未改生产数据。手机验证使用浏览器设备模拟，尚未做iOS/Android真机软键盘验收；真实供应商内容质量和线上性能不在本次本地验证结论内。

本次收尾：浏览器空间23已finish；3400前端、3401 API/Worker、3402本地桩及56483专用测试PostgreSQL均已停止，测试库文件和工作树保留。未提交、推送、部署或升级浏览器工具。
