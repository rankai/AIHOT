# 会员套餐与工具报价实施

> 后续状态：用户已确认启用，会员套餐、报价与预算分池均已部署到 localhost:3000，前台/admin共14个代表真实用例完成。当前运行与计费证据见[分池真实验收](../reviews/2026-10-30-budget-scopes-live-acceptance.md)。下文保留各阶段当时的授权边界。

用户批准：三档月费套餐、已建议的工具报价，前台/admin同步；成本不清的规格不可付费。支付方式已选择 admin 确认线下收款后开通/续费。无自动支付、无新真实供应商付费测试授权。

基线：origin/main 47d7ec6，独立分支 codex/membership-tool-pricing，目录 /private/tmp/aihot-membership-20261030。从日常目录复制既有视频功能源代码作为前置基线，清单与hash在 /private/tmp/aihot-membership-baseline.json；不得覆盖日常目录或其他任务改动。日常目录 /Users/nickfury/projects/AIHOT main 保留原状。

测试：专用 Docker aihot-membership-pg-20261030，127.0.0.1:55494，aihot_membership_test，空库postgres本地测试账号，无真实凭据。使用 env -i、Node24.19、关闭所有真实外发，仅本地桩。普通服务 localhost:3000 不做测试写入。

## 最小设计

复用账户、会员积分账本、工具报价/预约/结算，不另建钱包。增加最小套餐定义和不可重复的人工收款开通记录。套餐基础99元10000积分、创作299元33000积分、工作室699元80000积分。服务端决定金额和积分，admin必须确认已收款、记录唯一外部收款编号/说明；同一编号不得跨用户/重复发放，相同幂等键相同请求重放返回原结果，异参拒绝。收款记录/周期/积分发放/审计同事务。未支付不能自助开通。

每次确认一月收款发放一期积分。日历月周期，续费从max(当前到期时间,现在)延长，月末截断；活跃期仅续原套餐，换档到期后办理，避免隐含补差/即时升级。保留已有积分及账本；本版已发积分不自动清零、不自动扣费续费，页面说明。到期显示到期，原积分仍可使用，不改变既有试用积分权限。

复用现有member_tool_prices，提供可审计、幂等的明确应用已批准价目动作，避免写DB绕过领域。固定成本工具允许文档基价作依据；未知计费组合由服务端硬性拒绝收费，不能通过admin添加价格绕过。前台展示公开零售价/扣分和暂未开放原因；admin同时展示供应商成本依据与收款/发分记录。历史结果及原任务恢复不受新开通限制。

报价来源：/Users/nickfury/.codex/visualizations/2026/10/29/01a1858a-ca6f-7412-a2dd-c9390a0d67cc/tool-pricing-20261030/全工具报价与毛利.md。

开放价：Redfox固定平台query20；AI基础六引擎30、K3 60、商品卡50；GPTImage2仅1k单张300；平台转写200、直链30；字幕20、B站音频30、下载解析20、违禁词20。素材上传0/正常恢复不追加收费。万相std100/输入ceil秒、pro150。Seedance只开放成本已验证8秒480p有声3张参考图样例规格3000，其余成本未核先关闭（既有宽泛720p/480p价不得兜底）。GPT2.5/Gemini/Seedream所有新生成、GPT2多张/高分辨率、XHS异步评论、AgentKey不开放付费。Lite继续停止新生成。不得开启采集、信源、供应商预算或增加真实调用限额。

## 验收责任

执行者：后端/DTO/API/迁移、前台/admin实施及定向测试；监督者：设计、风险检查点、差异评审、最终浏览器验收。
1. 套餐价格与积分两端一致；admin线下收款→开通→用户重载可见周期与积分/流水。
2. 幂等/并发重复收款不重复发分；不同参数、跨用户引用、未登录、非admin、CSRF拒绝。
3. 已知工具报价匹配表；未知成本通过UI及直接API均不可报价/提交，不产生占用或供应商调用；旧报价在门禁变更后不可绕过。
4. 余额不足、价格变更、重复提交、任务成功/失败结算保留原不变量，用隔离库/本地桩验证。
5. admin套餐续费/到期/收款记录/前台三档卡片与工具价格可读，窄屏无主要遮挡。
6. 类型检查、web构建、相关积分/账户/工具回归通过。无commit/push/merge；本轮部署待集成验收后再按用户本地服务授权处理，不把测试环境验收当已发布。

## 追加：工具提交按钮与即时积分提示

用户追加要求（本轮）：前台/admin每个数据工具按钮改为“提交xx”，按钮后以辅助文字色显示积分。第一阶段已发布到localhost3000，149条批准价目，预算/用户/任务计数不变，无真实收款。新增改动仍在同一分支，阶段基线hash为 /private/tmp/aihot-membership-buttons-baseline.json。

前台保留服务端最终报价确认，按钮旁按当前服务端价目和用户所选规格作预计展示；无匹配/不明数量不显示虚构0。小型共用展示组件与纯计算函数复用当前价格规则，不另建费用权威，不按键生成持久报价。万相按所选本地视频可读时长向上取整预估，实际以服务端probe与确认值为准。admin显示会员价并明确管理员执行不扣会员积分，供应商费用仍照常。历史恢复和上传附加会员积分0。

执行者继续负责受影响工具表单和展示helper；主监督者负责最终视觉/交互、前后台一致性和本地同步。增加已知档位切换、未知规格、取整、歧义价格、窄屏换行的定向验收。不扩展采集/信源、用户管理或预算。


## Final acceptance — 2026-10-30
Both phases implemented, independently reviewed and browser-accepted in isolated database; deployed to authorized localhost:3000. 149 prices; budgets unchanged; no real supplier generation in this phase. Full evidence: /Users/nickfury/.codex/visualizations/2026/10/29/01a1858a-ca6f-7412-a2dd-c9390a0d67cc/membership-pricing-20261030/README.md. Source synchronized; no commit/push/merge. Feature branch and test DB deliberately retained.
