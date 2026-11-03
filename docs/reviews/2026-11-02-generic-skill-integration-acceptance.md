# 通用 Skill 接入、公众号创作与图片能力验收

日期：2026-11-02。状态：**M2限定范围通过；M3核心回归通过；M4真实A/B/D小规模联调通过；M5验收记录已收口。代码未提交、未推送、未部署，远端CI未执行。**

- 工作树：`/Users/nickfury/.codex/worktrees/assistant-v1/AIHOT`
- 功能分支：`codex/generic-skill-integration`
- 核对基线：`dev@67a9a561cea9301ae86bd0ff410a7cdaf430c06e`
- M2/M3测试库：`127.0.0.1:56504/aihot_generic_skill_test`
- M4真实联调库：`127.0.0.1:56504/aihot_generic_skill_m4_test`
- 交付状态：未提交、未推送、未合并、未部署；现有`localhost:3000`未修改

按用户确认的顺序，本轮先用现有助手、operation、积分、预算和成本中心完成最小通用接入与公众号创作，再用单图能力验证图片交付，先以外部`claude-image-generation`包验证单图子集，再在业务冻结后加入独立外部`ai-image-generator`验证Direct核心配置复用。保留现有小红书 v3/v2 及既有历史、在途任务路径。

## 1. 验收结论

| 验收项 | 状态 | 证据与边界 |
| --- | --- | --- |
| A：公众号研究创作 | **真实接口通过** | 真实Redfox热文查询→44条原始结果投影为10条去重样本→六维分析→4,688字符完整文章；父创作/子查询各结算200/20积分。无分析或伪造样本不能保存；查询失败/未知不重试；余额不足代码只在后台观测 |
| 固定注册与目录 | **通过** | `skills/registry.json`登记当前/历史包；binding只能引用代码能力，不能注入脚本、URL、密钥、价格或动态处理器；目录/binding/contract不一致拒绝 |
| B：`image-generator`单图能力 | **真实接口通过** | 1K、单张、无参考图；真实提交1次、轮询4次并保存1024×1024 PNG；父创作/图片各结算200/300积分。停止/未知恢复仍按现有测试证据 |
| 旧D：外部`claude-image-generation`子集 | **本地通过** | 固定`guinacio/claude-image-gen@9ae689d2f1163ccba1900fa58a75436ef4d8d75b`、MIT、文件hash；只覆盖提示词参考与单图纯提示词子集，不运行原CLI/MCP |
| M2：独立外部`ai-image-generator` Direct | **真实接口通过** | 固定`chemny/ai-image-generator@90736de1c8f6b672a235e43113d7a90c86e73119`、MIT、21文件hash；932文件业务冻结前后不变，直接复用`generate_image@1`。真实原prompt/4:5透传，提交1次、轮询4次，保存1024×1280 PNG；独立Skill归因通过（§10）。只开放Direct单图核心，非全上游功能 |
| B/旧D/新D共享执行链 | **通过** | 三包映射同一`generate_image@1`/`image-input@1`/`image-delivery@1`；无图片skillId专用业务分支。M2通过业务代码冻结对照；整镜像不变、运行时导入实验仍未执行 |
| 现有小红书 | **回归通过** | v3/v2身份和资源边界保留；检索→分析→交付、拒绝/空结果/停止恢复和积分路径未改 |
| 手机与桌面 | **通过** | 同一批真实会话复查1366px、390px、320px；两份文本附件、技能选择、执行步骤、公众号长文及两张图片作品均可用，三个宽度均无页面级横向溢出；D图片资产接口返回200和完整1,698,374字节PNG |
| 真实费用联调 | **通过（账单边界已标注）** | 9次模型、1次公众号查询、2次图片提交、8次轮询；6笔会员积分全部settled，消费1,220，reserved=0；成本中心估算¥2.167928。Redfox A/B有直接扣点，D最终余额未再查询，不写“供应商账单已完全核销” |
| 运行时安装器 | **未实施** | 只支持随版本发布的固定目录；不提供ZIP上传、Git URL拉取、依赖安装或任意脚本执行 |
| 视频和图片参考图 | **未实施** | 视频事务、播放、计费及参考图/编辑/mask/批量不在本轮范围 |

总体结论是：**M1–M5在限定范围内已完成。公众号研究创作、内置单图Skill和独立外部单图Skill均通过真实接口闭环；现有预算、价目、operation、积分、作品和成本中心可串联，移动端可用，未发现重复扣费或重复子单。视频、参考图、批量/编辑、运行时导入、远端CI和生产部署不在本轮完成范围。**

## 2. 已实现的业务边界

### 公众号创作

- 精确provider合同固定为`POST /story/api/gzh/search/hotArticleNew`，使用该端点的`X-API-Key`与固定`source`；没有拿普通公众号搜索代替。
- `search_wechat_articles`每次请求查询人工确认；小红书自动 search 授权不能批准公众号查询。每回合最多两次，单查询子任务不自动重试。
- 结果只投影最多10条真实标题/摘要/来源/互动字段；缺失值为未知，可靠0保留，不以摘要冒充全文。
- `analyze_wechat_research`必须引用本回合实际查询样本；`save_draft`必须引用已完成分析，不能降级为通用材料稿。
- 最终继续使用`text-draft`，复用现有编辑器、版本、稿件引用和成本归因，没有新增公众号富文本系统或发布接口。
- 业务码3210/3201只形成后台Redfox余额观测；会员界面不显示供应商充值信息，旧失败回执不会自动重发。

### 图片能力

- 图片入口只公开`gptImage2`、`1k`、单张、无参考图。报价从现有会员价目读取，执行复用现有图片operation、预算、回执和成本中心。
- `generate_image`只生成本地待批准建议；批准后在同一事务创建子 operation、报价和积分预约。
- 只有图片保存到本地`stored_files`并验证可用后才生成`image`作品；供应商URL、原始响应或下载失败不会被当成已完成作品。
- 图片不进入文字稿件编辑、引用或转交；右侧统一为“会话作品”，支持本地图片预览与下载。

## 3. 验证证据

### 自动测试

以下为M2前已记录的测试，保留当时范围与结果；Node24的M2命令和新结果见§7。独立测试库及本地HTTP/模型桩，未使用真实凭据：

```text
node --test ... \
  tests/assistant-images.test.ts \
  tests/assistant-catalog.test.ts \
  tests/assistant-input-fees.test.ts \
  tests/assistant-xhs-research.test.ts \
  tests/assistant-wechat.test.ts \
  tests/assistant-skill-policy.test.ts

结果：36/36 通过，17.6 秒
```

覆盖公众号正常闭环、人工确认、失败/未知不重试、余额观测、真实来源校验、禁用/历史兼容、小红书研究回归、图片批准/拒绝/停止/未知恢复、本地图片交付、重复通知幂等、父7积分与子300积分的合成价目结算、目录和旧版本边界。余额观测按同一receipt/attempt读取`receipt_attempts.response`或当前主回执的`receipts.response`；后台技能依赖由固定capability映射生成，两个图片技能均显示`gptImage2`、`redfox.image`和`redfox.poll`，公众号显示精确运营标识`wechat.hotArticleNew`。

```text
node --test \
  apps/web/tests/assistant-images.test.ts \
  apps/web/tests/assistant-render.test.ts \
  apps/web/tests/assistant-data.test.ts

结果：12/12 通过，1.4 秒
```

覆盖图片作品SSR、本地图片地址、alt、提示词、下载、无文字稿件编辑入口、公众号等待确认文案、通用工具状态文案及仅文字稿件可作为引用。

```text
npm run typecheck
结果：通过，5.6 秒
```

### 实际渲染

在隔离API `127.0.0.1:3101`和Web `127.0.0.1:3100`上，用独立测试库及合成图片检查：

- `1366px`：三栏并存；对话、执行步骤与右侧作品同时可读。
- `390px`：对话/作品切换正常；图片卡片、公众号长文、按钮和来源均无横向溢出。
- `320px`：图片和长文继续按容器换行；文件名、提示词和正文没有撑破页面。
- 图片执行过程显示“已提出图片生成需求”“图片已保存，可在作品栏查看和下载”“处理结果已保存”，报价来自价目而不是写死在展示层。
- 公众号执行过程显示“已提出公众号查询需求”“公众号热文查询结果已返回”“公众号规律分析已返回”“已保存公众号稿件”；供应商名称和私有思考未进入步骤。

测试会话中的技能启停设置已被回归测试恢复为默认关闭，因此视觉页面出现“助手尚未开放”；这是合成测试状态，不代表已有`dev@67a9a56`后台启停或本轮功能失效。视觉验收使用只读合成作品，没有从页面发起真实付费请求。

## 4. 未验证项与风险

| 项目 | 限制 |
| --- | --- |
| 真实公众号合同边界 | 已真实调用并核对日期边界、响应字段分布与会员扣费；供应商侧仅有查询前后余额差，A查询直接观察为0.4 Redfox points，未取得供应商发票/月账单 |
| 真实图片合同边界 | B/D均已真实提交、轮询和下载；B图片直接观察10 points扣减，D图片交付成功但完成后未再查最终余额；供应商发票/月账单仍未取得 |
| Node版本与候选验证 | 系统默认Node为`22.22.2`；最终候选已用Node `24.11.1`通过后端21/21、Web图片1/1、类型检查、Web生产构建及迁移重跑，见§8。尚未提交，因此远端CI和部署仍未执行 |
| 通用性证据边界 | M2新增独立`ai-image-generator`时，932文件业务代码/合同/依赖冻结对照通过；Direct核心本地桩闭环通过。更强的整镜像不变/运行时导入仍未执行；旧`claude-image-generation`仍仅算子集 |
| 自动技能选择 | 公众号显式动作和冻结候选已测；真实模型对自然语言意图的准确率未评估，不作100%承诺 |
| 费用 | 真实会员积分已实扣1,220；模型成本按真实usage和当前价目估算，公众号查询与图片成本按固定价目计入成本中心。供应商产品点数可核范围与人民币账单边界见§10 |

## 5. 工时与收益记录

人工开发、监督和复核的有效工时没有可核对计时，记为**unknown**，不根据对话时长、消息数或测试时长倒推。自动测试耗时为上一节实际输出；没有真实供应商等待。旧方式逐技能接线的同范围基线也不存在，因此本轮不计算节省金额、节省比例或净收益。

当前可以确认的结构性收益是：新增同能力技能时，目录、展示、权限交集、输入规范化、报价、执行、恢复、作品交付和成本归属可复用；仍必须逐包审阅规则、来源/许可、脚本核心逻辑、输入交付合同及验收，不能省略接入工作。

## 6. 文件与工作区状态

本轮相关改动包括backend受控binding/registry、公众号provider与研究合同、图片operation/作品交付、`0095_assistant_image_artifacts.sql`、三个图片包、公众号包、合同/Web/后台余额投影及核心测试。

工作区中原有旧视频文档、评审及截图仍为未跟踪文件，没有删除或纳入本轮实现。当前没有提交、推送、部署或应用业务库迁移；只向已批准的独立`_test`数据库应用了新增图片作品约束。


## 7. M2独立外部Skill配置复用验证

本项只扩展既有能力的包配置与证据，未改产品执行逻辑。新D为`ai-image-generator`，来源[chemny/ai-image-generator](https://github.com/chemny/ai-image-generator)，固定commit `90736de1c8f6b672a235e43113d7a90c86e73119`（上游0.4.2），MIT；本地registry版本1。[外部包清单](2026-11-02-external-ai-image-generator-manifest.json)逐项记录17份上游归档和4份本地包文件，共21份文件的path、bytes、SHA256，以及必要行为映射、例外与限制。

### 核心兼容与执行证据

| 原行为 | 当前映射与证据 | 边界 |
| --- | --- | --- |
| Direct原提示词直接生成 | `generate.md`要求不改写/扩写/翻译，`generate_image@1`沿现有输入规范化；M4真实D的原提示词与4:5透传、页面作品均通过 | 任意复杂尺寸和Pro语义仍未验证；未运行上游脚本 |
| 比例/用途解析 | 读取上游平台规格与优先级，竖版海报为4:5，工具与提交HTTP维持4:5 | 未增加确定性尺寸解析器；桩固定预期输出，不能证明真实模型对任意尺寸推断正确；2.35:1→21:9沿上游规格，其他不支持比例不得静默近似 |
| 请求、状态、下载和图片交付 | 直接复用`generate_image@1`、`image-input@1`、`image-delivery@1`和现有图片operation/回执/本地存储 | 单张、1K、`gptImage2`、无参考图；未知结果不重发 |
| 价格、人工批准、独立归因 | 报价300测试积分，批准前提交数不变；重复批准仅创建/提交一次；父7/子300合成积分结清；成本中心按各包Skill定位提交/轮询及父turn | 300来自既有会员价目测试夹具，非新Skill专用价格；不是已核实的目标环境会员价或真实供应商实扣 |
| 原脚本与配置 | 4个shell文件均静态归档；`scriptBindings: []`，复用现有服务配置 | 不执行脚本、不加载`.env`、不安装依赖；Pro、参考图/编辑/mask、透明背景、多供应商配置和批量未开放 |

同一次局部测试中B、旧D、新D分别完成一次合成提交/轮询/下载；作品关联owned `stored_files`，读取真实本地PNG字节与桩输出相同，重复交付幂等。三包共用同一执行链；小红书范围、旧版本和关闭后已受理任务的相关回归通过。M2不能推导所有外部包通用兼容，也不代替真实模型/供应商联调。

### 业务冻结对照

冻结文件：`/private/tmp/aihot-generic-skill-m3/business-before.json`，基线HEAD `67a9a561cea9301ae86bd0ff410a7cdaf430c06e`，记录932个TS/TSX/SQL及package/类型配置文件，覆盖业务源代码、路由、组件、依赖和能力合同。文件自身SHA256为`551d8169104693dea53411f4d79e9b6c9bd8d9dbf1b53a037067a8b93b2e349a`。

聚合计算为按原路径排序的`[{path,sha256},…]`执行`SHA256(JSON.stringify(records))`。冻结前后均为`c2a5d247c789627052cf5dbe77a8afecc52b7aca1c0f6d0de6349a23ecce67ea`：932文件逐一相同、无缺失；另扫描`apps/packages/database/scripts/industry`，排除Skill包后的TS/TSX/SQL、package/类型配置与锁文件无新增。业务源码中未出现`ai-image-generator`、`image-generator`、`claude-image-generation`专用分支。

基线含此前A/B能力实现的未提交改动；M2前后不变不表示整个功能分支相对HEAD没有业务改动。新增包的manifestHash为`3d46f4832c7bd75c3529185402b2aca54cdc279512c7c5c6a658ed4012d39636`，packageHash为`b282991345bd920416518677ce4853c857351caf47137c9221766bc38b760ea9`。包和registry可随版本发布，所以完整镜像hash无需保持不变；运行时导入/整镜像冻结未验证。

### Node24命令与结果

使用已安装的Node `v24.11.1`，显式`env -i`清空继承环境，仅访问指定独立测试库与本地模型/HTTP桩；没有读取真实凭据或业务库。初始模型/Redfox开关均为false；测试内部只为合成密钥和回环桩临时启用并恢复。实际命令如下：

```bash
env -i PATH=/Users/nickfury/.npm/_npx/172230ac6533d490/node_modules/node/bin:/opt/homebrew/bin:/usr/bin:/bin TMPDIR=/tmp DATABASE_URL=postgres://nickfury@127.0.0.1:56504/aihot_generic_skill_test NODE_ENV=test AIHOT_ENVIRONMENT=test AIHOT_DATA_DIR=/tmp/aihot-node24-acceptance AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials COLLECT_ENABLED=false MODEL_CALLS_ENABLED=false REDFOX_CALLS_ENABLED=false FEISHU_INTERNAL_ENABLED=false FEISHU_CONTENT_PUSH_ENABLED=false INDEXNOW_SUBMIT_ENABLED=false /Users/nickfury/.npm/_npx/172230ac6533d490/node_modules/node/bin/node --test --test-concurrency=1 --test-timeout=120000 tests/assistant-images.test.ts tests/assistant-catalog.test.ts tests/assistant-input-fees.test.ts tests/assistant-skill-policy.test.ts
# 21/21通过，0失败，duration_ms=10155.509625

env -i PATH=/Users/nickfury/.npm/_npx/172230ac6533d490/node_modules/node/bin:/opt/homebrew/bin:/usr/bin:/bin TMPDIR=/tmp DATABASE_URL=postgres://nickfury@127.0.0.1:56504/aihot_generic_skill_test NODE_ENV=test AIHOT_ENVIRONMENT=test AIHOT_DATA_DIR=/tmp/aihot-node24-acceptance AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials COLLECT_ENABLED=false MODEL_CALLS_ENABLED=false REDFOX_CALLS_ENABLED=false FEISHU_INTERNAL_ENABLED=false FEISHU_CONTENT_PUSH_ENABLED=false INDEXNOW_SUBMIT_ENABLED=false /Users/nickfury/.npm/_npx/172230ac6533d490/node_modules/node/bin/node --test --test-timeout=120000 apps/web/tests/assistant-images.test.ts
# 1/1通过，0失败，duration_ms=234.469166
```

运行历史如实保留：首次沙箱运行3个数据库场景因`EPERM 127.0.0.1:56504`失败；获准解除本地网络限制后20/21通过，唯一失败是增加第三个图片包后旧轮询/下载断言仍为2（实际3）。改为`ids.length`，同时补原提示词/比例、真实本地文件字节、现有成本中心独立Skill归因断言后，上述21/21通过。包入口原先允许Pro，已改为明确只开放Direct并重算hash；未改上游归档。已有Fastify弃用警告未影响通过。本M2未运行类型检查、Web构建、迁移或远端CI；不复写M3的独立证据。

### 剩余验收与交付状态

本节记录M2结束时的边界：当时真实模型、Redfox、图片供应商及付费外呼均为0。其后M4已按方案§13以A公众号、B `image-generator`、D `ai-image-generator`完成真实主流程，结果和供应商账单边界见§10；旧§9.3及§10 P5涉及视频/参考素材的预算仍只是历史提案，不能作为当前授权或额度。

本项人工有效工时和可比旧方式基线仍为unknown，不造节省比例。全部保留未提交、未推送、未合并、未部署状态；未重启现有服务，未删除或纳入旧视频文档与截图。

## 8. M3 Node 24本地核心验收

以下复核在M2包、测试和文档完成后执行，使用Node `v24.11.1`及`env -i`隔离环境；模型、采集、Redfox、飞书和IndexNow外发开关均关闭，只有测试内部的回环模型/HTTP桩临时启用，未使用真实凭据、业务库或付费供应商。

| 检查 | 结果 |
| --- | --- |
| 后端核心局部测试 | `tests/assistant-images.test.ts`、`assistant-catalog`、`assistant-input-fees`、`assistant-skill-policy`：**21/21通过**，9.937秒 |
| Web图片验收 | `apps/web/tests/assistant-images.test.ts`：**1/1通过**，0.443秒 |
| 全workspace类型检查 | `npm run typecheck`：通过 |
| Web生产构建 | `npm run build -w @aihot/web`：客户端与服务端构建通过 |
| 当前测试库迁移复核 | `node scripts/migrate.ts`：`database is up to date`，94个迁移已应用 |
| 增量升级数据保护 | 独立迁移库保留1个旧任务、2个旧非图片作品和1个新图片作品；0095重跑为no-op，未知作品kind仍被拒绝 |

核心用例同时覆盖技能关闭后的已接受任务、历史稿件、积分结算与停止/恢复，以及重复批准、未知提交不重发和图片保存恢复。当前的自动测试、构建和迁移证据不等于远端CI、真实供应商账单或部署通过；这三项仍单列，没有用本地结果替代。

## 9. 评审修复与本轮局部回归

本轮评审发现三个局部缺陷并完成修复。§8的构建和迁移结果是修复前的历史证据；本轮没有重跑构建或迁移，以以下局部测试和类型检查作为本轮证据。

| 发现 | 最小修复 | 核心局部证据 |
| --- | --- | --- |
| P1：模型生成非法`save_draft.activationId`时，活动查询的原始输入UUID强转使整个会话快照失败 | 以已存activation的UUID文本关联模型输入，不再强转不可信输入；合法大小写沿文本规范化比较 | 公众号桩实际输出`not-a-uuid`，保存调用落为`failed/invalid_tool_arguments`；`sessionSnapshot`可读且显示失败，无作品；下一步修正后完成原文章，不重新查询 |
| P1：图片submit/poll耗尽助手20次child_calls，被当作stale跳过，子run active/父waiting_child卡住 | 专用`AssistantChildCallLimitError`与真正stale区分，复用Redfox现有错误处理进入`needs_review`及父流程恢复；不改20次计数，不清空进度或重建任务 | 持续`in_progress`桩实际submit 1次、poll 19次；第21次在外呼前拒绝。子任务待核对、父活动可见并转待核对；taskId、20份已保存attempt回执保留。停止/恢复仍无二次submit或额外poll，child_calls保持20；父7/子300合成积分各一笔预约、307保留占用，未消费/释放/重复预约。小红书原研究回归通过 |
| P2：余额观察WHERE与SELECT证据表达式不一致，旧attempt缺证据时返回null导致解引用异常；提醒接口失败阻断工具页 | WHERE与SELECT统一使用同attempt回执证据；读取时容忍null与异常旧值。Web提醒请求单独catch为空，主体请求沿原错误处理 | 真实SQL生成“旧attempt response为NULL、主回执属于较新attempt”的null evidence；另测JSON null、字符串与非法body。均不抛错、不冒用较新证据；提醒HTTP500/网络失败时loader保留工具选项、素材、operations和价目，主体失败仍报错 |

后台技能页的“技术信息”折叠同时补充只读的支持能力与开放输入/交付范围，由已验证manifest/binding及能力合同投影；明确“上游脚本仅归档，不会执行；所需接口由平台受控能力接管”。未增加管理配置、数据库、编辑或执行入口。后端验证三份图片包均映射`generate_image@1`及单张1K无参考图/本地作品范围；Web SSR核对桌面和手机两处折叠均展示相同说明，折叠内没有编辑控件。

### 命令与运行历史

以下命令均使用Node `v24.11.1`，`env -i`清空真实环境；无真实凭据，测试只连接指定`_test`数据库与回环模型/HTTP桩。默认外呼阀全关，测试内部仅用合成密钥启用并恢复桩调用。

```bash
env -i PATH=/Users/nickfury/.npm/_npx/172230ac6533d490/node_modules/node/bin:/opt/homebrew/bin:/usr/bin:/bin TMPDIR=/tmp DATABASE_URL=postgres://nickfury@127.0.0.1:56504/aihot_generic_skill_test NODE_ENV=test AIHOT_ENVIRONMENT=test AIHOT_DATA_DIR=/tmp/aihot-generic-review AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials COLLECT_ENABLED=false MODEL_CALLS_ENABLED=false REDFOX_CALLS_ENABLED=false FEISHU_INTERNAL_ENABLED=false FEISHU_CONTENT_PUSH_ENABLED=false INDEXNOW_SUBMIT_ENABLED=false /Users/nickfury/.npm/_npx/172230ac6533d490/node_modules/node/bin/node --test --test-concurrency=1 --test-timeout=120000 tests/assistant-images.test.ts tests/assistant-wechat.test.ts tests/assistant-skill-policy.test.ts tests/assistant-xhs-research.test.ts
# 36/36通过，0失败，duration_ms=17255.48925

env -i PATH=/Users/nickfury/.npm/_npx/172230ac6533d490/node_modules/node/bin:/opt/homebrew/bin:/usr/bin:/bin TMPDIR=/tmp NODE_ENV=test AIHOT_ENVIRONMENT=test COLLECT_ENABLED=false MODEL_CALLS_ENABLED=false REDFOX_CALLS_ENABLED=false FEISHU_INTERNAL_ENABLED=false FEISHU_CONTENT_PUSH_ENABLED=false INDEXNOW_SUBMIT_ENABLED=false /Users/nickfury/.npm/_npx/172230ac6533d490/node_modules/node/bin/node --test --test-timeout=120000 apps/web/tests/admin-assistant-services.test.ts apps/web/tests/assistant-images.test.ts
# 4/4通过，0失败，duration_ms=306.239875

env -i PATH=/Users/nickfury/.npm/_npx/172230ac6533d490/node_modules/node/bin:/opt/homebrew/bin:/usr/bin:/bin TMPDIR=/tmp NODE_ENV=test AIHOT_ENVIRONMENT=test AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials COLLECT_ENABLED=false MODEL_CALLS_ENABLED=false REDFOX_CALLS_ENABLED=false FEISHU_INTERNAL_ENABLED=false FEISHU_CONTENT_PUSH_ENABLED=false INDEXNOW_SUBMIT_ENABLED=false npm run typecheck
# 全workspace通过

git diff --check
# 通过
```

监督复核以相同 Node 24、隔离测试库和环境关闭口径独立复跑：后端四文件`36/36`通过，16.114秒；后台Web两文件`4/4`通过，0.195秒；全workspace类型检查及`git diff --check`通过。复核结果与执行器记录一致，期间未触发真实模型、Redfox或图片供应商请求。

首次运行仅images/wechat/skill-policy三个文件，3/6通过、3个数据库场景因沙箱`EPERM 127.0.0.1:56504`失败；未进入业务断言。解除该次本地测试网络限制后加入受影响小红书回归，以上36/36通过。既有Fastify弃用警告未影响结果。本轮没有实现断言失败后删断言或改弱预期。

| 阶段 | 当前状态与边界 |
| --- | --- |
| M1 | 本轮已确认并复用现有模型、Redfox、价目、预算和积分；实际用量见§10 |
| M2 | 限定范围通过：独立外部Direct单图核心的配置复用，沿用§7冻结证据；本轮缺陷修复不是M2冻结实验的一部分 |
| M3 | 本轮修复后本地核心回归通过：后端36/36、Web4/4、类型检查及差异检查。远端CI未执行；本轮未重跑构建、迁移或浏览器验收 |
| M4 | 真实A/B/D限定范围通过；调用、作品、成本中心和积分已对账，供应商账单边界见§10 |
| M5 | 本轮完成；人工有效工时及可比旧方式基线仍unknown，不计算节省比例 |

工作区保留进入本轮时已有的未提交/未跟踪改动及旧视频文档、截图；本轮只增补上述局部修复、对应测试与阶段记录。没有提交、推送、合并、部署、业务库迁移或服务重启。

## 10. M4真实接口小规模联调

执行前用户确认A→B→D串行、每项只跑一个成功主流程，所有外呼由主会话按Astra High监督式流程完成。工具接口未返回主模型运行时元数据，因此本记录只证明执行流程，不声称运行时模型设置已被工具验证。故障分支没有为制造成败额外付费；结果未知一律停止原任务核对。

### 10.1 预算与数量

| 项目 | 实际 | 硬上限 |
| --- | ---: | ---: |
| 模型HTTP | 9（A 4、B 2、D 3） | 24；单项各8 |
| 公众号热文查询 | 1 | 2 |
| 图片生成提交 | 2（B/D各1张） | 2 |
| 图片状态轮询 | 8（B/D各4） | 20 |
| Redfox业务HTTP | 11 | 24 |
| Redfox网络请求合计 | 13（另含2次免费账户核对） | 24 |
| 成本中心估算支出 | **¥2.167928** | **¥8** |
| 会员测试积分 | **1,220** | **1,500** |

用户2的测试库会话产生20个真实请求回执：全部`received`，没有`pending/failed/unknown`。成本中心能按用户、Skill、module、服务、模型、父/子run关联；A/B/D三个父回合中首次选路的模型调用按既定语义归为`not_activated`，没有伪造到尚未激活的Skill。

### 10.2 A：公众号研究创作

- 会话：`bc8469b4-fb26-4a66-8d47-c194d686b528`；父turn `501d58f4-0f60-40b9-93c1-9b47db93878a`，父run 1，热文查询子run 2。
- 两份TXT/MD附件多选取入、手动选择`wechat-write`、会话内200积分创作确认和20积分查询确认通过；文风追问后继续原任务，没有重复报价。
- 真实热文查询返回44条原始结果，页面安全投影/去重后10条，日期`2026-10-26`至`2026-11-02`；完成标题、关键词、开头、语言、结构、互动六维分析并附真实来源。
- 作品`8401efcf-c92c-46be-ac67-c246fb6131e1`：标题“5个环节，决定AI客服到底能省多少时间”，正文4,688字符、6个备选标题、10个标签、5个来源，`partial=true`。
- 部分交付明确披露：原始44条截断到10条、仅2条直接相关、样本只含标题/摘要、部分互动与来源字段未知；模型没有用材料写作伪装成研究成稿。

### 10.3 B：内置`image-generator`

- 与A同一会话；父run 3、图片子run 4。手动选择图片Skill，1K、单张、1:1、无参考图。
- 会话内200积分创作确认与300积分图片确认通过；提交1次、轮询4次，taskId保持同一任务，没有重试或重生。
- 作品`3520f51b-2dba-4604-bb40-18bc5bf4de4b`，fileKey `uploads/redfox/52d61f6f3cf180a7069bedf1eda51d1eb52ba6e89e9f9e4e163b7527b3f4fce8`。
- 文件`/private/tmp/m4-b-image.png`为1024×1024 PNG，SHA256 `75c20edbb0794212b8d2c889686e807b3088b0a5127e4368dcb51ff49141a7cd`。

### 10.4 D：独立外部`ai-image-generator`

- 会话：`ee727b1e-a8df-4345-b67f-f3746cc0e1c0`；父run 7、图片子run 8。手动选择外部Skill，显示“直接图片生成”。
- 用户原提示词完整透传，用途解析为4:5，保持1K、单张、无参考图；200积分创作确认与300积分图片确认通过。
- 提交1次、轮询4次，同一taskId；没有切换Pro、改写提示词、扩图、批量或重生。
- 作品`65c8283e-8def-422e-82aa-332599a0f6da`，fileKey `uploads/redfox/54ae19936f29e4848acfdaa6a038e5e502e346317744a6193a2c8fd51ba40753`。
- 文件`/private/tmp/m4-d-image.png`为1024×1280 PNG，SHA256 `856d3a928f50ee0052e181c4cfea8c6816cf92afcc4161ea13945dfd46676eaa`；320px页面再次从资产接口下载1,698,374字节，hash一致。
- 页面步骤原先把Skill包内资料称为“创作参考”，无参考图时容易误解；已改为“技能资料”，受影响Web测试1/1通过，并在真实会话复核。

### 10.5 成本、积分与供应商证据

成本中心`/private/tmp/m4-cost-check.json`合计`¥2.167928`：

| 组成 | 估算费用 | 依据 |
| --- | ---: | --- |
| 9次DeepSeek模型 | `¥0.107928` | 真实usage按input/output/cache和当前费率计算 |
| 公众号查询 | `¥0.060000` | 回执固定保守费率 |
| `gptImage2/1k`两张 | `¥2.000000` | 现有价目每张`¥1` |

六笔会员积分全部为`settled`，`released=0`：

| 用途 | root run | 积分 |
| --- | ---: | ---: |
| A创作 | 1 | 200 |
| A公众号查询 | 2 | 20 |
| B创作 | 3 | 200 |
| B图片 | 4 | 300 |
| D创作 | 7 | 200 |
| D图片 | 8 | 300 |

账户从1,500扣至280，`reserved=0`；没有重复预约、重复子单、释放后重扣或额外父回合。

Redfox初始余额326.6 points，D执行前316.2 points；A热文查询直接观察扣0.4 points，B图片直接观察扣10 points，均为产品点数而非人民币发票。D图片真实生成、保存和页面交付成功，按同规格预计再扣10 points，但D后没有再次调用余额查询，因此最终余额和厂商人民币账单保持“未完全核销”，成本中心的人民币金额只称“按回执/价目估算”。

### 10.6 界面与执行步骤

- 1366px桌面、390px和320px手机视图均无页面级横向溢出；公众号两份附件、长文、图片作品和技能选择可操作。
- 390px/320px作品页可切换图片与公众号长文，图片自然尺寸和页面容器尺寸正确；下载资产返回`200 image/png`和完整文件。
- A步骤为收到请求、下一步安排、加载Skill、追问、提出公众号查询、查询返回、规律分析、保存分析和稿件；B/D显示选择/加载Skill、读取技能资料、提出图片需求、等待确认、图片保存。
- 步骤只显示业务动作，不显示供应商名称或私有思考；发送按钮在执行时切换为处理中/停止，完成后恢复发送。
- 深色主题下空输入按钮原先把整个高亮按钮降到40%不透明度，留下浑浊青底和低对比文字。禁用态已改为中性字段底色、弱文字与细边框，启用态继续使用品牌青色和黑色高对比内容；390px、320px和桌面宽度均无尺寸溢出。
- 一次120秒浏览器等待曾超时，随后不刷新快照已显示D完成；没有形成可复现的产品故障，因此不据此宣称自动刷新失败。
- “创作参考”文案修正后，使用Node24运行`apps/web/tests/assistant-data.test.ts`与`assistant-render.test.ts`，11/11通过；全workspace类型检查和`git diff --check`通过。没有因此重跑全仓库测试或远端CI。

### 10.7 本轮结论与边界

限定范围通过：同一现有底座可以运行研究写作和一个内置图片包，并只通过包、binding和注册数据复用同一图片能力接入独立外部包；统一报价、父/子operation、会员积分、本地作品和成本中心均能串联。

不包含视频、图片参考图、编辑/mask、批量、运行时ZIP/Git导入、任意脚本执行、自动发布、供应商充值或人民币账单自动核销。本轮没有提交、推送、合并、部署，也没有修改现有`localhost:3000`。

## 11. 可视化五项修订收口

以下表格保留2026-11-02的验收事实；费用文案和图片名称的当前约定以本节§11.4–11.5追加修订为准。2026-11-03扩大排查发现的其他遗留问题见[清理复审](2026-11-03-assistant-integration-cleanup-review.md)，尚待S0修复/验收；本记录的历史通过不覆盖那些新场景。

方案§14的V1–V5已在独立`aihot_visual_1102_test`库完成代码修订、核心局部测试和桌面/手机操作复核。本轮没有新增真实模型或供应商请求，没有确认任何测试报价，也没有新增会员积分消费；M4的真实调用和账本仍是上一阶段的独立证据。

| 问题 | 收口结果 | 实施与验收证据 |
| --- | --- | --- |
| V1 图片确认规格 | **通过** | 安全摘要来自待批准冻结参数或已完成子任务保存参数。构造原提案`1:1`、规范化`4:5`的待确认记录，1366px、390px、320px均显示`1K · 1 张 · 4:5`；刷新后一致。重报价在同一事务中更新参数和报价，并清除已失效的阻塞原因 |
| V2 收费范围 | **通过** | 父创作费用卡默认显示“检索、图片生成另行计费；图片生成前会单独确认”；390px、320px无溢出，金额仍来自报价 |
| V3 交付称谓 | **通过** | 图片完成通知使用“作品已更新／查看作品” |
| V4 文字类型 | **通过** | 公众号作品显示“文章草稿”，小红书仍显示“小红书笔记” |
| V5 Skill名称 | **通过** | “图片创作 · 帮我完善描述”和“图片生成 · 使用原提示词”同时出现在快捷入口与下拉；原skillId、规则、执行能力和费用归因未改 |

### 11.1 核心回归

```text
后端：tests/assistant-images.test.ts tests/assistant-catalog.test.ts
结果：11/11通过

Web：apps/web/tests/assistant-images.test.ts apps/web/tests/assistant-render.test.ts
结果：2/2通过

全workspace类型检查：通过
git diff --check：通过
```

后端覆盖“提案1:1→冻结4:5”、重报价修复、历史参数、公开结果脱敏、批准/拒绝、重复批准、停止/恢复、提交未知不重发、子调用上限及积分不重复结算。Web覆盖图片作品和下载入口、“文章草稿”、技能名称、收费提示、持久消息和作品读取。首次后端执行因沙箱禁止连接`127.0.0.1:56504`返回`EPERM`，获准后连接同一隔离`_test`库重跑通过；这不是断言失败或代码放宽。

### 11.2 桌面、手机与下载

隔离API/Web只绑定`127.0.0.1:3101/3100`，使用合成账号、本地模型/供应商配置和测试数据目录。浏览器操作证据保存在本地临时目录：

- 待确认图片：`/tmp/aihot-visual-pending-desktop.png`、`/tmp/aihot-visual-pending-390.png`、`/tmp/aihot-visual-pending-320.png`、`/tmp/aihot-visual-pending-light-390.png`
- 父费用确认：`/tmp/aihot-visual-quote-390.png`、`/tmp/aihot-visual-quote-320.png`
- 图片作品与下载入口：`/tmp/aihot-visual-image-390-artifact.png`、`/tmp/aihot-visual-image-320-download.png`

实际内容宽度分别为1366px、390px和320px，三者的`scrollWidth`都与视口相等；浅色和深色确认卡均可读，无页面级横向溢出。公众号长文、引用来源和图片作品均可切换；图片自然尺寸为1024×1280。320px下原生选择器沿用现有紧凑省略，费用和主操作仍完整可见。

“下载图片”链接在390px和320px可见且具有原生`download`属性。使用同一隔离账号直接请求其受保护目标，得到HTTP`200`、`image/png`、20,064字节、1024×1280文件；SHA-256为`a81b53c60d700e12b823fc665b095ade870efe95d1ce04e6ad9359f3918a1997`，与原资产完全一致。`ego-browser`的下载事件没有在自动化层被捕获，因此本轮不把“浏览器下载事件回调”列为已验证；受保护HTTP下载与文件hash已经验证。

刷新待确认页后仍显示同一4:5冻结规格；后端既有用例继续覆盖未知提交、停止/恢复、重复批准和积分关联，没有发现新的恢复或结算问题。

### 11.3 交付状态

本轮相关改动仍未提交、未推送、未合并、未部署；远端CI未执行，M4之后没有新增真实供应商支出。现有`localhost:3000`未被修改或重启。工作区中早先的视频文档、截图和其他无关未跟踪文件继续保留，没有纳入本次实现或验收记录。

### 11.4 2026-11-03追加修订：按技能说明费用

§11所述固定费用提示由用户追加要求调整，当前行为以方案§14.3、§14.9为准：纯文字不提示图片/检索费用，研究写作仅提示检索，图片技能仅提示生图；允许两类能力的自动选择使用“如需”提示。服务端从本次报价的冻结模块能力生成只读说明，首条、后续、排队和报价恢复共用；原金额、授权和结算未变。

局部验证：目录/渲染/本地恢复`5/5`、专用空`_test`库后端`23/23`、全workspace类型检查和差异空白检查通过。旧演示库残留的技能开启状态曾使一项既有范围断言失败，换用本次正常迁移的空库后原断言通过，未放宽断言。实际浏览器验证了四类报价、纯文字刷新恢复和旧报价不随新技能选择改变；实际CSS宽1242px、354px、320px无横向溢出。仅获取测试报价，没有批准真实调用、提交或部署。

### 11.5 2026-11-03追加修订：图片入口与启停一致

当前产品约定与证据见方案§14.10：外部`ai-image-generator`显示“图片生成”；验证技能默认停用并留在后台，管理员开启后会显示到前台。撤销曾试作的固定隐藏限制，继续复用现有启停权威，不增加第二层开关或迁移。

纠偏后定向测试为后端`24/24`、目录/Web/后台`6/6`通过；实际后台“暂停→隐藏→开启→出现→暂停”通过，最终测试环境仅外部图片入口开启。后台记录、已受理验证技能队列、图片文件和原费用归因保留；外部生成仍覆盖重复批准、停止恢复及未知提交不重发。桌面1366px、手机390px与320px无页面级横向溢出。本轮仅改开发代码和合成测试配置，未部署或修改真实业务配置。
