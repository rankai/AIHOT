# 通用 Skill 接入深度复审与复盘

日期：2026-11-02。评审对象：`codex/generic-skill-integration`，HEAD `67a9a561cea9301ae86bd0ff410a7cdaf430c06e` 加当前未提交实现。依据：[完整方案](../generic-skill-integration-validation-plan.md)、[接入标准](../assistant-skill-integration-standard.md)、[公众号方案](../wechat-skill-integration-plan.md)、[阶段验收](2026-11-02-generic-skill-integration-acceptance.md)。

本轮只读审代码、核对已有隔离测试库和产物、运行一个目录局部测试及无外呼验证；仅新增本评审记录。没有修业务代码、供应商调用、数据库业务写入、提交、推送或部署。未重复成本中心性能测试。

## 1. 结论

**研究写作和单图生成的真实主流程已跑通；同一图片能力新增外部 Skill 不改业务执行代码的限定验证成立；主要接口、配置、预算、积分及成本中心复用成立。当前仍有恢复边界、扩展准入、参数兼容和价目维护问题，不能给出“完全无遗漏、可直接发布”的结论。**

未发现需要重做架构或另建技能平台的理由。问题应在现有领域入口补齐，而不是增加脚本沙箱、插件安装器、工作流语言或第二套支付系统。

本记录补充阶段验收：之前的成功主流程与局部回归仍有效，但“全部完成”不能覆盖本轮发现的交叉入口和接入边界。视频、参考图、批量、编辑、运行时安装器等是已明确后置的能力，不算本轮遗漏。

## 2. 两个 Skill 到底如何接入

### 公众号 `wechat-write`

- 固定归档 Redfox `d2e24f02340a440a73a96aa6ad6a65f681fba89f/skills/wechat-write` 的六份原文件；上游 Python、支付说明均不执行。
- 实际加载的是本地 `write.md`，其中保留上游写作核心并增加宿主约束；另可读取原字段说明。原始 `upstream/SKILL.md` 是完整性归档，不在该模块的运行资源允许集合中。不能描述成“不加适配直接执行完整原包”。
- `manifest.json` 定义规则、资源 hash、工具、输入和交付合同；`binding.json` 将动作绑定到 `save-writing@1`、`search-wechat-hot@1`、`analyze-wechat-research@1`；`registry.json` 登记当前版本。
- 平台新增了一次精确热文能力：`POST /story/api/gzh/search/hotArticleNew`，内部标识 `wechat.hotArticleNew`，复用已有 Redfox client、密钥、同步查询 operation、预算和回执；没有用普通公众号搜索冒充原接口。
- 真实执行为：选技能和材料 → 创作报价/批准 → 加载规则/必要追问 → 查询报价/批准 → 热文检索 → 保存真实来源关联的六维规律分析 → 完整文章保存。后端阻止缺少研究证据的材料稿交付；修改准确选定的旧稿可以复用已验证研究。
- 有意适配：自动扩期改为另行确认；缺字段为未知；只使用实际标题/摘要并披露范围；不自动支付、发布或安装软件；父回合仍由现有助手文本模型分析和写作。Redfox提供热文数据，不是包办文章生成的单一接口。

### 外部 `ai-image-generator`

- 固定归档独立项目 `chemny/ai-image-generator@90736de1c8f6b672a235e43113d7a90c86e73119`（上游0.4.2、MIT），包含17份上游文件；另有4份本地接入文件。此次逐文件核对21个SHA256均匹配。
- 本地 `generate.md` 为受控入口，通过 `read_skill_reference` 读取原 `SKILL.md`、平台尺寸表和集成合同；四份Shell脚本仅归档，`scriptBindings` 为空。
- 绑定既有 `generate_image@1` / `image-input@1` / `image-delivery@1`。选包、报价、批准、提交、按原taskId轮询、本地文件保存、作品预览下载和成本归因走同一执行链。
- 本阶段仅承接 Direct、`gptImage2`、1K、单张、无参考图；平台集中提供供应商配置，用户无需逐包填写密钥。Pro、其他供应商、透明背景、图片编辑和批量没有接入。
- M2的932文件冻结记录证明当时新增这个包只修改包、注册数据、测试和记录，没有为它增加业务分支。之后的通用缺陷修复不属于冻结实验，不能将历史冻结结论解释为当前工作树相对HEAD零业务变更。
- 原提示词/4:5实际样例成功；但上游确定性尺寸解析尚未被等价承接，见问题R3。因此成立的是受限图片执行链复用，不是全部Direct参数语义已验证。

## 3. 复用是否真实成立

| 领域 | 当前复用 | 新增且必要的适配 / 限制 |
| --- | --- | --- |
| 助手及前端 | `creative`、已有会话/附件/技能下拉/费用卡/队列/步骤/作品面板 | 图片展示与`image`作品类型；没有新建公众号窗口或编辑器 |
| 文本模型 | `modelFor("assistant")`、模型快照、`assistant.text`回执与预算 | 规则、工具schema和研究交付合同；没有每Skill单独模型凭据 |
| 公众号接口 | Redfox client、`createSynchronousQueryTx`、既有operation和回执 | 精确端点、固定鉴权/source、输入及结果投影、研究校验；首次属于能力开发 |
| 图片接口 | 已有图片submit/poll/save、私有资产与所有权 | `createImageGenerationTx`支持助手批准同事务；图片交付桥接与0095增量约束 |
| 积分 | `quoteTool`、现有价目、预约/结算/核对与幂等命令 | 父创作及子查询/图片各自报价；没有新建钱包或账本 |
| 成本中心 | 现有attempt、operation、用户、激活Skill/module归因 | 首次未激活模型请求仍标`not_activated`；供应商金额仍按证据区分估算和实扣 |
| 技能启停 | 既有settings、审计、revision锁及已受理范围 | 图片依赖按能力分发；研究类依赖检查尚有具体action硬编码，见R2 |
| 异常恢复 | 原任务停止、回执重放、未知不重发、费用核对 | 助手恢复测试已过；通用工具独立续查交叉入口漏保护，见R1 |

## 4. 新发现，按优先级排列

### R1 / P1：助手图片子任务能进入独立工具续查，脱离父任务约束

位置：`packages/backend/src/users/tool-input.ts:33`、`providers/operations/store.ts:57`、`users/tools.ts:37`、`apps/api/src/routes/user-tools.ts:23`。

`recoveryInput`只检查所有者、原任务种类、poll状态和供应商taskId，未排除`assistantParentTurnId`。公开会员工具报价/执行入口可接收助手图片子任务。新续查run只携带`memberRecovery`，没有助手父回合关联；`requireExecution`及child_calls计数依赖这个关联。助手作品交付却继续认原`child_run_id`。

只读实证：既有`aihot_generic_skill_test`合成任务472已达`child_calls=20`、处于`needs_review/redfox.image.poll`，300积分待核对；在清空环境、外呼全关、数据库只读连接中，`normalizeToolInput('user:89','images/query',{runId:472})`仍成功返回恢复输入。原图片操作自身的60次poll/100次attempt限制尚余41/80，后续createRun的余额检查不能替代父回合20次限制。本轮没有真正建立续查或外发。

后果：可以绕过助手停止/次数边界，续查结果无法正常回到助手作品；原积分关联恢复单后，原任务恢复也受`recovery_active`限制。这不等于已发现重复扣款，但破坏恢复与归属合同。

最小修复：通用恢复准入及事务创建处拒绝助手拥有的子任务，提示从原会话核对/恢复；保持原taskId、回执、预约和调用计数。无需新增恢复状态机。局部验收同时证明普通独立图片续查仍可用。

### R2 / P2：同能力新研究Skill不能完整复用依赖准入

位置：`packages/backend/src/assistant/skill-policy.ts:118`及`:125`。

图片依赖错误按`generate_image@1`传播到各action；公众号与小红书则写死`wechat-write`、`xiaohongshu-write`。仅增加一份使用`search-wechat-hot@1`的新包和新action时，它不会收到对应查询服务的缺价、缺凭据、预算错误。后台可误报健康并启用，前端可误报可用。

执行层仍有成本/报价/外呼检查，故不能据此声称会绕过供应商预算；但是用户可先接受父创作报价、耗用模型，再在子查询失败。`skillAdmission`只锁定运营受理范围，没有补上这份health投影。

最小修复：沿当前图片做法按已实现capability分发已有研究依赖检查，保持健康检查与报价身份分离；不增加动态provider平台。补一个同公众号能力、不同action的局部验收即可。

### R3 / P2（方案兼容缺口）：外部图片脚本的确定性参数处理被提示词替代

位置：`skills/ai-image-generator/generate.md:7`、`assistant/tools.ts:65`及`:279`；对应方案§2.1。

上游`resolve-image-spec.sh`执行明确尺寸/比例提取、优先级和规格表匹配。当前只有要求模型遵守这些规则的Markdown；`ImageProposal`校验枚举，`prepareCall`直接使用模型给出的prompt/size。没有服务端对明确用户比例、解析结果或Direct原文的交叉检查。

本轮无外呼验证：`ImageProposal`接受`prompt='生成一张 16:9 的图片'`与`size='1:1'`的矛盾组合。该验证证明合同目前不拒绝这种错误，不代表M4真实模型已经出错。M4单次4:5成功与固定模型桩不能证明确定性语义等价。

最小修复方向：明确Direct的原文边界，复用一个受控参数规范化入口承接已支持范围中的确定性比例规则；不支持的尺寸明确拒绝/澄清，不增加任意脚本执行。若决定继续完全依赖模型，须收窄兼容承诺，不能在同一方案中同时宣称确定性核心已覆盖。

### R4 / P2：公众号精确价格尚未进入统一价目维护的完整生命周期

位置：`packages/backend/src/users/member-pricing.ts:19`、`:44`及`:64`。

运行准入增加了`wechat.hotArticleNew`的精确会员价检查，但该接口未进入`memberPriceCatalog`的offer列表。会员公开价格表遗漏这一项；在某环境尚未应用当前价目版本、先配置公众号价后执行“应用已批准价目”时，现有实现会禁用所有非助手父回合价，然后仅恢复offer列表，公众号价会被禁用且不会重建。

此问题有明确触发条件，不表示M4已经被错误扣费，也不表示已应用相同价目版本的环境每次点击都会覆盖（该入口有版本幂等）。

最小修复：使已批准公众号精确价纳入既有价目维护，或明确保留不归该批次管理的独立规则；避免启用一个功能后被正常价目维护意外关停。无需新定价系统，不必把助手专用热文接口开放为普通查询工具。

### R5 / P3：当前SOP与阶段完成记录存在冲突

`docs/assistant-skill-integration-standard.md:3`和`docs/wechat-skill-integration-plan.md:3`仍称未调用真实接口，与M4不符。完整方案§4.1还保留“注册/绑定hash写settings、每次重新核对注册修订”的表述，而当前是发版携带固定registry、进程缓存校验，settings只管理启停。阶段工时表混有旧D与新D及旧阶段状态。

最小处理：统一当前状态与历史阶段的标识，描述实际固定注册边界；不应为了满足旧规划语句额外开发运行时注册服务。实际人工工时和对照基线unknown保持如实，不补造节省比例。

## 5. 本轮重新核对的真实证据

只读连接`127.0.0.1:56504/aihot_generic_skill_m4_test`，未使用真实.env或读取密钥、会话令牌：

| 项目 | 本轮核对结果 |
| --- | --- |
| 真实付费attempt | 20个，全部received；9模型＋1公众号查询＋2图片提交＋8图片轮询 |
| receipt处理状态 | 上述20个均completed；另2个免费账户核对receipt也completed。receipt与attempt是不同状态层 |
| 会员积分 | 6笔settled，总额1,220；联调用户available=280、reserved=0 |
| 公众号产物 | 1篇text-draft、正文4,688字符；既有M4记录为44条原始结果、10条投影样本、partial范围披露 |
| 图片产物 | 2张，1024×1024及1024×1280；本地PNG的SHA256与M4记录逐一相符 |
| 成本 | model ¥0.107928＋query ¥0.06＋images ¥2，poll ¥0；合计¥2.167928，20项均为estimated，不能称厂商人民币账单实扣 |
| 外部包 | 21文件hash全部吻合；M2冻结清单文件自身hash吻合 |
| 目录局部测试 | Node24.11.1，`tests/assistant-catalog.test.ts` 1/1通过；外呼关闭，没有启动API/Worker |

M4的桌面/390px/320px浏览器证据和既有36项后端局部回归、Web及类型检查沿用其记录，本轮没有重新假称跑过。D图片最后一次供应商余额未核查、自然语言路由准确率未评估、远端CI未执行，边界维持不变。

## 6. 对方案规模与下一步的判断

本轮规模总体合理：固定registry、受限binding、静态能力、现有执行链及单一账本足以承担当前任务；公众号领域校验独立于小红书，图片只扩展必要事务和作品类型。未发现重复支付平台、新队列平台或任意脚本环境等过度设计。

需要补的是R1–R4的局部边界与R5文档收口。优先修恢复隔离，其次按能力统一健康检查、补参数兼容及价目维护，并分别选择最小局部验收。既有成功链路与费用证据不必为每项修复重新花钱重跑；只有改动影响真实接口合同时再评估针对性联调。

“通用接入跑通”的准确表述：**已有能力覆盖范围内，可以通过归档包、规则适配、manifest/binding和registry接入新Skill，复用统一执行、支付和成本归因；不能承诺任意标准包、任意脚本或所有参数无适配运行。** 同图片能力的配置复用已经有实际证据；同研究能力的配置复用还需要R2关闭，完整Direct参数兼容还需要R3关闭。


## 7. 修复状态（2026-11-02）

以上§1–6保留发现时的只读结论；本节记录随后获准的局部修复，不把此前问题改写成从未存在。R1–R5在当前未提交工作树中关闭，未执行远端CI、提交、推送、合并或部署。

| 项目 | 修复与局部证据 |
| --- | --- |
| R1 已关闭 | recoveryInput与createRun锁定父任务后均拒绝带assistantParentTurnId的任务，引导回原会话；会员投影不提供通用续查。child-limit夹具证明规范化/报价/直接事务构造都拒绝，无新增run/receipt/quote；原taskId、费用与child_calls不变，独立图片恢复规范化仍可用。 |
| R2 已关闭 | XHS、公众号、图片健康接收动作从当前版本binding的capability派生。纯映射测试覆盖同公众号能力两个action、不同能力和历史版本排除，当前动作行为保持原状。 |
| R3 已关闭 | 激活校验后、报价前解析明确比例/像素、经完整性校验的platform-specs用途、模型候选及1:1默认；2.35:1与规格表1800×766/900×383映射21:9，其他比例必须精确等价且无冲突。测试覆盖矛盾覆盖、竖版海报、像素、默认与拒绝；不支持参数成为failed工具结果，无报价/子单/外呼；本地HTTP实际收到含前后空白的原提示词。保留原始object/enum供JSON Schema，未改skill归档与hash、未运行脚本。 |
| R4 已关闭 | 核定service_prices存在时加入wechat.hotArticleNew的20积分offer，价目版本升至2026-11-02-v3；现有事务体提取供回滚测试复用。测试证明缺成本拒绝、精确价创建/恢复/版本幂等、成本准入、普通工具目录和报价仍不开放；未修改非测试库价目或预算。 |
| R5 已关闭 | SOP、公众号方案、通用方案已同步M4真实用量、价目生命周期、确定性比例、能力健康及fixed registry与settings职责；历史D与当前D分开，保留工时unknown。 |

验证环境：实际Node v24.11.1，隔离库aihot_generic_skill_test、127.0.0.1:56504，经env -i清空环境；预检外呼阀全部关闭，测试只在自身进程使用合成凭据和本地桩。最终`node --test --test-concurrency=1 --test-timeout=120000 tests/assistant-images.test.ts tests/assistant-skill-policy.test.ts tests/membership-pricing.test.ts`：31/31通过；`npm run typecheck`全workspace通过；`git diff --check`通过。未重复全套、浏览器或真实付费验收。

失败历史保留：首次沙箱预检连接本地数据库EPERM，经授权沙箱升级后预检通过。首次三文件30/31通过，新R4夹具删除被报价引用的价目触发外键；第二次该文件8/9通过，夹具删除应用历史触发append-only。已改为保留引用行、在回滚事务内验证合成版本，不禁用约束、不删除历史；单文件9/9及最终31/31通过。Fastify输出既有disableRequestLogging弃用提醒，无测试失败。

M4证据不变：9次模型HTTP、1次公众号查询、2次图片提交、8次轮询；6笔会员扣费settled合计1,220，成本中心估算CNY 2.167928。D图片最后一次Redfox余额没有重新核查，供应商人民币账单未完全核销。本轮修复没有新增真实接口调用。
