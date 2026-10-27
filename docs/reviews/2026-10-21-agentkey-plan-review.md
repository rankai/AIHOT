# AgentKey 接入方案整体评审（2026-10-21）

> 对象：[AgentKey 接入方案](../agentkey-integration-plan.md)，以及当前 `codex/redfox-integration` 工作区。下方首次评审记录保留当时结论；同日方案更新后的复审见文末。本轮只更新文档，未修改业务代码、执行真实数据工具、读取密钥、提交、推送或部署。本文是评审证据，不另立开发规则。

## 结论

复用现有订阅、任务、回执、结果、身份映射和材料入口的方向正确。没有发现需要新增业务表、通用 Provider Registry 或工作流引擎的理由。但方案尚不宜视为可直接实施的完整设计：有 6 组具体缺漏/边界问题，以及 3 处可以精简的设计。

这里指出的是**方案按现有写法实施会遇到的问题**，不是声称当前已上线 AgentKey 缺陷。现有 Redfox 的 12/12 测试也不能证明这些未来路径已打通，本轮没有重跑这些测试。

## 需要补齐或修正的 6 组问题

### R1 · P1：回执身份缺少采集轮次，重复解析与重新付费的身份混在一起

方案 §4.2 的 `receipts.identity` 示例含工具、参数、schema hash 和 parserVersion，却没有现有的 `window`、run 或等价的本轮请求范围。现有 `logicalKeyFor()` 只使用 service、purpose、model、identity 和 attemptTag，`subject` 不参与判重。

如果照此示例接入，同一关键词下一轮仍可能命中上一轮 completed 回执，任务显示成功，却永远重复消费旧结果。另一方面，parserVersion 进入付费请求身份，若修解析器时按新版本重建身份，又可能重新购买本可本地复用的响应。

- 代码依据：[receipts.ts](../../packages/backend/src/providers/receipts.ts) 的 `logicalKeyFor()`；[Redfox client](../../packages/backend/src/providers/redfox/client.ts) 已把 `window` 纳入请求身份。
- 最小修改：明确使用稳定的本轮 window/run 范围、步骤/页/轮询序号、工具和真正影响外发的参数；同一请求恢复保持该身份，下一轮重新查询使用新范围。parser 修复记录在处理版本/结果溯源中，不因此改变已发请求的逻辑键。
- 验收：同轮恢复不增加桩调用；下一轮同参数确实再调用；关闭外发后修 parser 仍可消费原回执。不要使用会随恢复递增的 generation 充当付费请求身份。

### R2 · P1：复用生命周期尚未覆盖主信源创建和材料导入两端

方案的改动清单主要列出 `platform-subscriptions`、统一执行分发和恢复器。但现有系统有两类真实入口：独立平台订阅，以及绑定 X/公众号信源的主订阅；它们共用状态模型，创建和调度入口仍不同。

当前 [collection-commands.ts](../../packages/backend/src/sources/collection-commands.ts) 把所有非 Redfox provider 交给 native 创建路径；[native-scheduling.ts](../../packages/backend/src/sources/native-scheduling.ts) 也只特殊判断 Redfox 总阀。只改独立订阅调度器，不能使切到 AgentKey 的 X/公众号主订阅正确创建任务。

末端也不能直接复用原导入函数：[import-douyin.ts](../../packages/backend/src/providers/redfox/import-douyin.ts)、[import-toutiao.ts](../../packages/backend/src/providers/redfox/import-toutiao.ts) 验证 `provider=redfox`、Redfox operation key、回执 model 和原始记录，并写入 Redfox 溯源。把 AgentKey 结果转成相似的 `operation_results.data` 并不足以通过这些校验。

- 最小修改：明确补全两类订阅的创建、调度、手工运行、配置编辑/切换入口；保留 SocialData 批量行为。对首期平台，将供应商证据验证留在适配器，将确实相同的身份归属、权限校验和材料提交提取为功能内共享函数。不能简单删掉 `provider=redfox` 校验，也不能复制整套导入流程。
- 验收：独立订阅和 X/公众号主订阅分别完成“保存/切换 → 调度/手工 → 回执 → 实际材料/研究结果 → 收尾”；同一作品经直连和网关导入仍去重，未知作者仍隔离。只断言 run completed 不够。

### R3 · P1：MCP 原始响应、错误分类及大整数身份的处理不完整

方案 §5.2 描述拿到 SDK result 后落回执，§7.1 主要按 HTTP 状态与异常分类。但 MCP 有 HTTP、JSON-RPC error、`isError=true`、工具业务 payload 等不同错误层。已收到错误响应不能一概当作“请求结果未知”。

现有 `paidRequest` 在 callback 抛出普通错误时会把回执标为 unknown；只有 callback 返回的 response 才会持久化为 received。SDK 可能先抛协议错误，导致错误正文没有进入回执，再被只读 unknown 策略自动重发。相反，仅按 HTTP 200 成功也会把工具失败交给业务 parser。

此外，本机 SDK 的 JSON/SSE 路径使用普通 `JSON.parse`/`response.json`。若平台 ID 以超出安全整数的 JSON 数字返回，优先取 structuredContent 再转字符串会失真。现有 Redfox client 已特意保留整数原始字面量，这项保护不能在 MCP 路径丢失。

- 最小修改：在 AgentKey transport 内保留有界、脱敏的工具响应或已确认错误 envelope，交回执保存后再分类；真正未收到完整结果才进入 unknown。明确 `isError`、业务错误、拒绝、限流各自的已有状态和恢复动作，限流仍受已有重试上限约束。收到结果后关闭 transport 的清理失败，也不应抹掉已收结果。
- 身份处理：使用已核实的字符串 ID 或完整 JSON text 的无损解析；只拿到不安全数值时拒绝绑定/导入，不把舍入后的数字冒充稳定 ID。无需自建 MCP 协议栈。
- 验收：HTTP 200 + `isError`、JSON-RPC 参数拒绝、已收原文但 parser 失败、超时未知各走正确分支；大整数 ID 保真或明确拒绝；关阀恢复、迟到响应和预算计数保持一致。
- 依据：[MCP 工具错误规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling)、本机 `@modelcontextprotocol/client` 实现、现有 `paidRequest`。

### R4 · P2：供应商中立能力仍借用 Redfox 的全部描述，预览也可能调用错供应商

方案 §4.2 把 Redfox ID `OWIBYU1V` 当作 AIHOT 业务操作，§9 再给现有接口增加中立名称。但当前契约和后台仍以 Redfox operation 为中心：

- [platform-subscriptions.ts](../../packages/backend/src/sources/platform-subscriptions.ts) 的参数与详情目标来自 Redfox schema。
- [PlatformOperationDescriptor](../../packages/contracts/src/redfox.ts) 只有一份 fields、price 和 detailCapabilities；provider 选项仅有 id/label。
- 新建页的“预览当前条件”固定请求 `/api/admin/redfox/queries`，请求体没有 provider，见 [collection-subscriptions.tsx](../../apps/web/app/features/admin/collection-subscriptions.tsx)。

如果只增加 AgentKey 下拉项，仍可能出现 AgentKey 选择配 Redfox 价格/必填项，或者保存走 AgentKey、预览却走 Redfox。AgentKey 独有的能力也没有自然的业务入口。

- 最小修改：只对首期确有多供应商复用的操作建立小型静态映射，区分业务用途与供应商工具；保留旧 Redfox ID 的兼容解释，不全量重命名 169 项。所选 provider 决定字段、默认值、价格、分页、详情能力及预览请求；前后端使用同一份后端描述。AgentKey 独有能力使用自己的明确操作入口。
- 验收：切换表单供应商后，参数、费用说明、详情目标和预览一起变化；预览桩只收到所选供应商请求，保存后的 provider 一致。目录新出现工具不自动进入可执行选项。

### R5 · P2：预算方向合理，但积分、实扣和价格表的落点未闭合

按用途复用请求次数预算、缺预算拒绝外发是正确的。问题在 §6.2、§6.3 和 §9.2：方案主要展示估价，并统一把实扣标为未核对；但本次可见的 AgentKey 官方 `execute_tool` 元数据明确声明成功 envelope 含 `credits_charged`，按量计价工具可能不同于 `credits_per_call`。

现有 [service_prices](../../database/migrations/0010_service_prices.sql) 只接受 CNY/USD；只有 credits 的工具没有可直接写入该表的真实货币价。方案写“增加文档估价迁移”却没有给出此分支。

- 最小修改：固定工具契约保存 credits 估价和来源；每次回执/attempt 的 `usage` 分开记录 estimatedCredits 与供应商返回的 chargedCredits，缺失实扣字段时才标未知。只有可信 CNY/USD 价格才写 `service_prices` 和金额 cost；不新增账本表，不用 0 代表未知价。积分实扣仍不等于人民币账单已对账。
- 明确边界：次数预算限制请求数量，不能承诺金额/credits 硬上限。原评审引用了额度用尽后 overage 的旧说明；**同日输出证据复核已撤回此事实判断，见文末更正**。常规定时任务沿用次数预算；需要硬费用上限的真实联调须另有已核实的供应商额度限制或可证明的固定价格调用界限，不能用估价伪装硬上限。
- 验收：估价和实扣不同、实扣为 0、没有实扣字段、重试和迟到响应都按 attempt 保留；CNY/USD 与 credits 不混加。首期仅创建实际使用的用途预算，尚未接入轮询不预建 poll 业务。
- 依据：当时读取的 [AgentKey 订阅文档](https://docs.agentkey.app/concepts/subscription)；本次同日复核以其当前官方 Markdown 为准。原评审没有执行真实工具验证收费。

### R6 · P2：切换预检混淆业务必需条件、供应商差异和参数上限

方案 §8.4 把 Redfox 的库选择、特定 T+1 语义也列为潜在切换硬条件；§5.4 提到目标无 offset 就不支持翻页，却没有结合现有 `limits.pages` 的上限语义。当前系统文案明确“最多页数只是上限，不保证有后页”，默认 pages=3 也不等于用户要求必须抓满 3 页。

如果实现为“原供应商有的字段或行为目标必须相同”，许多本可满足业务目的的切换会被误拒绝。没有历史成功回执也不能自动升级为必须先付费试跑的门槛；当前预检允许权限证据 unverified，但不允许已知必需能力缺失。

- 最小修改：预检只阻断身份、过滤、必需正文、必需分页覆盖等真实业务条件；库名、延迟变化、单页限制作为影响展示，由管理员按已有显式切换流程确认。业务确实要求覆盖后续页时，无分页能力必须阻断。
- 同时明确：现有独立平台订阅编辑器禁止改 provider，只有 X/公众号主订阅已有切换命令。方案应说明本期只支持新建时选商，还是也增加独立订阅显式切换；不能用“按订阅选择/切换”一句话涵盖未设计的入口。
- 验收：未使用过滤不阻断；必需过滤缺失阻断；仅有最大页数时正确提示目标单页能力；真实需要完整分页时阻断；切换失败保留旧订阅和旧采集资格。

## 可以精简的 3 处

### S1：复用现有契约版本，避免多个版本/身份重复权威

run 和 subscription 已有 `contract_version`。方案再引入 `toolContractVersion`、`schemaSha256`、`parserVersion` 和重复的 gateway，尚未解释为何每个都需独立演进；`accountScope` 也没有当前多账号需求与来源定义。

首期建议使用现有 contract_version 表达已审核执行契约，冻结精确 tool 和输入即可。schema hash 可留开发证据，不成为自动执行门槛；确有独立 parser 演进时再在结果处理溯源记录。价格更新不应顺带改变请求/执行身份。这样同时解决 R1 的恢复冲突。

### S2：兼容别名要有退出条件，不增加无依据的 API 开关

方案 §9、§12 的“暂时兼容”没有结束条件，还提出可能增加 provider-neutral API 兼容开关。新旧路径应共用处理函数，但只有存在已知调用方才保留别名；明确前端、测试、文档迁移完成及旧调用方退出后移除。

特别是 `/redfox/operations` 当前还承载非采集查询目录，而 `/collection-operations` 只服务采集，两者不能不加区分地返回同一目录。共享描述生成函数并按用途投影即可，不复制目录、不增配置开关。

### S3：将回退和并发要求限定到已证实的边界

当前 `governedReceipt()` 按 operation_runs/operation_results 关联保护回执，已经与 provider 无关。回退到含这项保护的当前 Redfox 基线，不需要再建 AgentKey 专属回执保护或新的发布门禁。写清支持的回退基线；关闭 AgentKey 后保留可处理已有结果的 Worker，直接复用现有恢复能力。

官方“one execute_tool call per turn”是调用方顺序指导，不能直接推导为“同一 key 所有 Worker 必须全局串行”的服务端限制。当前资料不足以要求新增全局锁或专属队列；按现有 Worker 并发和已确认限流处理。SDK 的 SSE 续接与重新执行付费工具也须区分，只禁止未经回执治理的工具重发。

## 保留的设计与状态归属

以下内容合理，应继续保留：

| 事实 | 权威位置 |
| --- | --- |
| 订阅选择、周期、启停和配置版本 | collection_subscriptions；主信源权限仍读 sources |
| 某轮冻结的 provider、工具、参数与进度 | operation_runs |
| 每次外发尝试、原始响应、计费证据 | receipts / receipt_attempts |
| 已解析结果及材料关联 | operation_results |
| 来源权限、稳定身份、作品去重与修订 | sources / bindings / materials 现有入口 |

不自动改投其他供应商、未知只读请求最多自动放行一次、提交/上传不自动重发、关阀后仍能本地恢复，以及切换后旧轮失去提交资格，均有明确业务作用。补齐时应复用这些规则，避免再造状态机。

## 本轮证据与未验证项

- 只读核对方案、实际订阅/调度/导入/回执/恢复/API/UI 代码、价格表约束和本机 MCP SDK。
- 查阅 AgentKey 官方执行/计费/failover 文档与 MCP 规范；免费重读抖音搜索和 Sorsa X 搜索的 describe 元数据，没有 execute 调用。
- 抖音搜索元数据提供输入 schema，没有完整字段级输出契约；X 元数据说明高级搜索和分页，但输入 schema 也未完整表达全部约束。不能把输入 describe 当作所有响应语义已核实。
- 首期四组只读能力仍是待确认的推荐范围。每组需在方案中列清定时采集、一次查询、详情补全、主信源切换哪些开放；后续其他领域和生成能力不应成为首期验收前置条件。
- 本轮没有新集成测试结果、UI 改动或截图。原方案未改，以上建议待下一轮明确更新方案。

## 同日方案修订后的整体复审

此节记录用户授权更新方案后的复审，前文“原方案未改”“四组范围待确认”描述的是首次评审时点，不是最新状态。

### 已确认的范围变化

用户逐项确认：覆盖全部相关平台及资讯查询采集；排除生成、上传、转写、营销投放等工具类能力；独立平台订阅也支持显式切换；每项能力先接一条固定路线，页面显示上游；AgentKey 优先 TikHub，已有 Redfox 直连承担其可覆盖的缺口，JustOneAPI 和 Serper/Jina 等补齐其余相关能力。不重复接入 AgentKey 内的 RedFox，不自动兜底。

本轮逐项读取 social/search/scrape 共 1,442 项免费元数据并核验规范工具名：social 1,406 项中 TikHub 1,037 项（73.8%），31 个 social 分组中 22 个含 TikHub；search/scrape 的 36 项均非 TikHub。详见[目录核验证据](2026-10-21-agentkey-catalog.json)及方案 §2。数字包含同义版本、营销及工具类接口，不能作为本次业务覆盖率。

关键差异已经进入方案：TikHub 的头条目录没有关键词搜索和账号作品列表；汽车之家、懂车帝、易车及通用热点继续直连 Redfox；豆瓣/Facebook/IMDb/优酷当前由 JustOneAPI 提供；通用资讯搜索/正文提取需其他上游。七个平台改为首批实施顺序，不再是最终范围上限。

### 6 项缺漏与 3 项精简的闭合情况

| 项目 | 方案处理与复审结论 |
| --- | --- |
| R1 | §5.3 明确稳定 window + 请求位置 + 真实外发参数；工具由 model 入键，不重复维护；generation、parser 修复和价格变化不改已发请求身份。新轮与同轮恢复已区分。 |
| R2 | §7 同时覆盖独立订阅和 X/公众号主订阅的创建、调度、手工/维护入口，保留 SocialData 批量；拆分供应商证据与平台材料提交，验收包含实际材料/研究结果和订阅释放。 |
| R3 | §6/§9 区分 HTTP、JSON-RPC、isError 和业务错误；完整响应先保存、清理失败不覆盖结果；大整数保真或拒绝绑定；未知只读最多一次自动放行，保留既有状态机。 |
| R4 | §5.1/§11 按 provider 提供字段/价格/详情能力；中立预览与保存使用同一供应商；非采集 Redfox 目录保留原用途；旧操作 ID 的契约解释与幂等不重写。 |
| R5 | §8 区分估价、供应商报告实扣及账单核对；credits 存 usage，CNY/USD 才进价格表；每 attempt 保留估价、迟到实扣和响应，避免头记录/attempt 双计。无新增账本，次数不宣称金额上限。 |
| R6 | §10 仅核对当前业务必需条件；单页与最大页数、库名/延迟差异分别处理；独立订阅增加显式切换命令，失败保留原资格，成功使旧轮失效。 |
| S1 | 复用 contract_version，不并列引入 toolContractVersion/schemaSha256/parserVersion/accountScope 运行权威。 |
| S2 | 兼容 API 只委托同一领域函数；目录按用途投影；列明实际调用方迁完后的删除条件，移除新兼容开关提议。 |
| S3 | 复用当前 governedReceipt 的供应商中立保护与 Worker 并发；说明可回退基线、暂停在途任务和向前修复，不建 AgentKey 专属保护、全局串行锁或新的发布门禁。 |

以上为**方案层面已处理**，不是代码修复或测试已通过的声明。

### 对扩大范围的再次检查

1. **重复建设**：没有新增订阅、任务、结果、目录、账单或身份表；没有注册中心、插件框架或通用工作流。按平台提取实际共享材料函数，协议和供应商证据留在适配器。同义上游版本不全部实现；既有直连 Redfox 不再通过 AgentKey 重做一次。
2. **状态归属**：订阅掌握当前配置及调度，run 掌握本轮冻结输入和进度，回执掌握外发与费用，结果掌握解析及材料关联，来源掌握权限。评论/榜单留研究结果，搜索供应商不成为作者；普通网页、RSS 和现有模型链没有被连带迁移。
3. **预算和恢复**：收到但无法理解的结果与真正未知结果分开；关阀只阻止新的外发，不阻止已有响应处理。复审补明了连接失败仍按现有保守 attempt 口径计数、迟到实扣归原 attempt，以及异步采集提交不能按只读轮询自动重发。
4. **迁移收尾**：明确两类切换入口、版本冲突/旧轮迟到、旧 ID 和创建命令兼容；API 别名有退出条件，既有恢复保护有确定基线，未新增迁移开关。

复审未发现仍需新增表、状态或通用抽象才能解决的缺口。当前方案可以作为后续契约补证与分阶段实施的依据；不将其表述为所有接口已经具备完整输出契约或真实可用性证据。

### 验证与保留边界

- 核对当前订阅、调度、材料导入、回执/attempt、恢复及 UI 预览入口，与方案逐项比对；保留首次评审的代码依据。
- 核对目录条数、规范工具唯一性、逐分组计数、TikHub 汇总，全部一致；元数据证据不是运行时配置。
- 核对本地文档链接、格式和全文一致性；本轮开始时已有的业务文件修改保持原样。
- 仅文档更新，没有运行代码测试。原 12/12 属于此前 Redfox HTTP/API 到本地桩的测试，不是 AgentKey 或浏览器验收。
- 部分描述只提供输入，稳定 ID/完整正文/输出语义仍需官方样本或另行授权的真实验证。对应能力没有证据就不能开放；不能以 mock 或目录名称作替代证明。目录中的健康提示也不等于本机真实验证结果。
- 无业务实现、建表、真实数据查询、UI 调整、提交、推送、合并或部署；当前没有待用户决定的范围问题。

## 同日补充：输出证据专项核验与一致性复审

用户要求把现在能查清的输出合同补齐，不留待开发时再查。本轮新增[逐项输出证据](2026-10-21-agentkey-output-evidence.md)，对应完整方案 §2.4/§3/§6/§8/§9/§10/§12；目录快照增加 outputEvidence，仅保存文档来源、摘要和样例校验信息，不作为运行时注册表。

调查覆盖 TikHub 官方 SDK OpenAPI 与 67 条具体接口文档依据，以及 JustOneAPI 四个平台全部 32 条接口 OpenAPI/公开样例查询，取得 30 份公开样例。AgentKey、Serper、Jina 的网关/正文/搜索输出也已核对。样例由官方文档提供，不是使用本项目凭据执行所得。

### 已纠正的旧判断

1. **固定工具路由**：当前官方 execute_tool 明确不会自动换商；无需把“网关可能暗中替换”作为常态不确定项。Scenario REST 才有独立路由合同。
2. **输出与费用**：provider/category/took_ms/credits_charged/data 已有文档；当前计费为月度额度加预购 extra credits，耗尽返回 402，不自动产生套餐外费用。撤回原 R5 的 overage 断言；次数预算不是任务金额硬上限的结论保留。
3. **REST 文档**：目前官方公开 Scenario REST 及输出 schema，不再说 REST 只能进 Console 才知道。方案继续采用已经约定的固定工具 MCP，不顺带增加第二条执行路径。
4. **不能继续笼统写“输出未知”**：公众号列表—详情—账号映射、视频号明文 ID、Facebook 帖子、YouTube 列表/详情等已有具体字段依据；同时记明正文摘要、相对时间、列表缺字段、无效分页等边界。
5. **文档缺口与运行验证分开**：X 输出/高级语法、若干平台字段层级、豆瓣两项样例等仍待官方说明；不将其自动变成付费测试要求，更不声称一次实测可证明长期服务保证。

### 复审结果

- 未引入新表、状态、自动兜底、全局限流平台或文档同步服务。固定工具与既有治理生命周期不变。
- 上游响应时间、作品时间、摘要/正文、账号 ID/昵称各自解释；账单以 AgentKey 外层实扣为准，attempt 仍是计次与恢复归属。
- Threads、IMDb 分页等已知限制现在就纳入预检，不等实现时试错；可选字段缺失不增加全局门禁。
- 仍有明确文档缺口，清单逐项标记；“范围覆盖全部相关平台”不是“每个操作已经核验可用”。本轮未开发、运行业务测试、发起数据调用、提交或部署。

## 同日补充：四项复审闭合与整体复查

用户要求补齐“完整固定路线与输入输出矩阵、错误响应持久化契约、空结果步骤结果、AgentKey 恢复分类”后，再做整体复审。本轮只更新方案与评审证据，没有修改运行代码、数据库、测试或外部系统。

### 四项闭合结果

| 项目 | 复核结论 |
| --- | --- |
| 固定路线与输入输出矩阵 | [矩阵](2026-10-21-agentkey-route-matrix.md)现有 233 行：212 条 AgentKey、21 条直连 Redfox。AgentKey 工具 212/212 命中目录快照且无重复；Redfox ID 21/21 命中 inventory 和现有源码且无重复。每行有输入、输出、分页、恢复键、Q/I/S/X 及证据/阻断。 |
| 错误响应持久化 | §6.1 复用 `ProviderRejectedError` 与现有 receipts/receipt_attempts 字段，完整错误 envelope 先落库再分类。完整响应后的 parser/身份失败保持 received 并本地恢复；只有无完整 envelope、断连或落库前中断进入 unknown；没有再购买或错误归零实扣的路径。 |
| 空结果步骤结果 | §7.3 对齐 `advanceRun()` 的“当前回执必须有结果”约束：每个成功 execute 都写 receipt-linked `query_summary`，搜索/评论/最终空页为 `count=0`。失败、未知和非法 payload 不能伪装为空；不新增 result kind 或状态。 |
| AgentKey 恢复分类 | §9 只认精确静态 operation/step 对。212 条 AgentKey 行中 91 条 `readOnly`、121 条 `needs_review`，数据行没有 `readOnlyPoll`/`remoteSubmit`；后两类仅保留未来规则，轮询缺 task ID 和未知键必须人工处理。 |

### 重复建设复查

- **目录与能力**：212 个 AgentKey 精确工具全部唯一，同一业务没有并列的同义工具行；AgentKey 内的 RedFox 路线不重复接入，现有 21 个直连缺口由仓库已有 Redfox operation 承担。
- **生命周期**：订阅继续保存 provider/operation/contract；run 冻结本轮工具与输入；receipt/attempt 保存外发和费用；operation_results 保存解析、summary 和材料关联；source 保存发布权限。没有第二套订阅、任务、回执或结果生命周期。
- **数据模型**：新增 0 张业务表、0 个状态枚举；错误字段、费用、空结果 summary 和恢复都落在现有列/状态。
- **抽象层**：没有 Tool Router Registry、插件运行时、通用工作流、金额账本或目录同步数据库。矩阵是实施前的静态白名单候选，不是运行时元数据平台。
- **排除范围**：营销投放、生成、上传、转写、刷量、互动写入和播放流下载没有进入可执行行；评论/关系/榜单仍只作研究用途。

### 状态归属复查

- 手工查询、采集和切换仍由不同既有入口创建；订阅的旧轮在成功切换后失去提交资格，历史回执和结果保留。
- `unknown` 是回执事实，不是供应商状态；收到完整错误/成功 envelope 不能误报 unknown。只有真正缺少完整外发结果才使用该状态。
- 空搜索是成功步骤，由 `query_summary(count=0)` 消费回执；评论/榜单/账号文档不会自动成为新闻材料或信源权限。
- 旧轮迟到响应归原 run/attempt，只允许本地证据收尾；不得把新游标写回已切换订阅，也不得改投新供应商。

### 预算与恢复复查

- AgentKey 每次外发、重试、分页、详情和显式重查分别经 paidRequest 与用途预算；目录读取、预检和本地解析不扣调用次数。
- `estimatedCredits` 与 `chargedCredits` 分开；`0` 只有供应商明确返回时有效，字段缺失仍是未知。次数预算不冒充积分或人民币硬上限。
- 429 只有在完整拒绝 envelope 已保存后才通过既有 `retryReceivedRejection` 有界重试；`readOnly` 未知最多沿用一次 30 分钟自动放行；异步提交永不自动重发。
- 关阀阻止新外发，不阻止已有响应解析、材料提交、合法旧轮失效和订阅收尾；该行为与“先 paidRequest、后业务”的现有顺序一致。

### 迁移与收尾复查

- 旧 Redfox operation ID、contract_version、创建命令幂等和原 run 输入保持兼容；别名只解释成业务能力，不批量改写历史。
- X/公众号和独立平台订阅都通过显式切换更新同一订阅；成功切换保留历史并释放旧轮，失败保留原供应商资格。
- 回退基线仍要求含有供应商中立 `governedReceipt()` 保护的当前 Redfox 分支；旧 Worker 不消费 AgentKey 在途任务。没有新增发布门禁或 AgentKey 专属恢复器。
- 正式实施仍需补矩阵中会阻断实际用途的 exact schema/字段证据，并按 §12 做本地桩定向验证；这些是实现前门禁，不是遗漏新的持久化模型。

### 最终复审结论

方案层面的四项问题已经闭合，未发现需要新增表、状态或通用抽象才能解决的遗漏。矩阵仍有 121 条 `needs_review` 路线和 201 次 `gap` 标记，这是有意保留的能力证据边界：范围被记录，但在 exact 输入、身份、正文、时间或分页仍不足时不会开放查询导入、定时采集或切换，也不会把目录存在冒充真实可用。

本轮静态检查只读取现有文件和目录快照；没有执行数据库、业务测试、MCP、上游数据接口或真实付费调用，也没有提交、推送、合并或部署。后续开发必须带上 §12 的七类错误、三类空结果、静态恢复分类及矩阵校验，不能把本文当作 AgentKey 运行验收。

## 实施后最终复审

方案获批后，阶段 1 已按最小纵向链路实施完成。复审代码、迁移、运行时代码白名单、供应商切换、恢复和 UI 后，没有发现新的 P1、P2 或 P3。

已完成的范围如下：

- 仅开放抖音 V4 搜索 `agentkey.douyin.search` / `agentkey.douyin.search.query`，固定工具为 `TikHub/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post`。
- 233 条矩阵仍为 212 条 AgentKey 与 21 条直连 Redfox；其余 211 条 AgentKey 路线继续按证据阻断，没有自动扩充白名单。
- 复用既有 `collection_subscriptions`、`operation_runs`、`receipts` / `receipt_attempts`、`operation_results`、`articles`、`sources` 和 `source_account_bindings`，没有增加 AgentKey 专属订阅、任务、结果、身份或账单生命周期。
- 数据层唯一新增迁移为 `database/migrations/0078_agentkey_budgets.sql`，只写入 `agentkey.collect` 与 `agentkey.query` 两条默认 0 预算。
- 显式切换只对上述抖音路线开放；成功时保留同一订阅和历史，停止旧轮并让旧执行失去提交资格，失败时保留原供应商资格，没有自动跨供应商兜底。
- 付费请求恢复复用原回执；`generation` 不进入付费身份。完整响应后的解析失败不重新购买，真正未知的同步只读请求最多沿用现有的一次自动放行。
- 分页缺失、异常或重复时，先保存已收结果和 received 回执，再进入 `needs_review`；达到用户页数/条数上限时正常完成。
- 调度在 `LIMIT` 前按供应商阀过滤；关闭 Redfox 不会占满批次并阻塞 AgentKey，反之亦然。
- UI 在 AgentKey 缺少稳定作者或作品 ID 时明确阻断作品导入，不提供人工编造身份；供应商、上游、固定工具、预检和费用状态均来自实际后端运行链。

验证结果：

- 修复前 10 个预期失败已真实复现；修复后定向 **10/10** 通过。
- 在全新隔离库 `aihot_agentkey_verify_20261021_2140_test` 应用全部 75 个迁移后，AgentKey 传输、路由、恢复、采集、切换和费用测试 **58/58** 通过。
- 既有回执、恢复、任务治理和 Redfox 回归 **79/79** 通过。
- Web 定向测试 **36/36** 通过。
- `npm run typecheck` 通过；`npm run build -w @aihot/web` 通过。

验证边界：

- 本轮没有读取真实凭据或运行数据，也没有发起 AgentKey、TikHub、Redfox 或模型真实调用；真实供应商权限、响应、分页、内容与实扣仍待另行授权。
- 没有提交、推送、合并或部署；本结论只证明隔离数据库、本机 MCP/HTTP 桩、类型检查和 Web 构建下的本地实现一致。
- 其余 211 条 AgentKey 路线保持证据门禁；矩阵是候选与阻断清单，不是真实可用声明。
