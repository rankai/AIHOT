# AgentKey 接入方案整体评审（含 2026-10-22 第二阶段复审）

> 对象：[AgentKey接入方案](../agentkey-integration-plan.md)。当前阶段见文末2026-10-23状态复核及主方案§12.12–12.16。此前各分支、日期、授权与测试数字均为当时历史事实，不改写为最新通过；本文件只存评审证据，不另立规则。截至2026-10-23，65条中60条已按用途完成本地验收（抖音11、公众号6、头条3、小红书9、B站11、微博8、X12）；X已接通12类Q、5类作品手动I及10类单页S，后端、Web和真实本地浏览器已验，最终状态/清理已通过，截图1–228每处均有原图和批注图共456PNG，最终批注图由Lead逐张回看；另5条尚未接入（抖音粉丝、头条视频、小红书回复、微博粉丝、公众号相关文章各1），仍保留在65条范围，未移入第三阶段。

## 首次评审结论（历史记录）

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

## 第一阶段本地实施后的复审（历史记录）

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

## 第二阶段方案修订与整体复审（2026-10-22）

用户已锁定七个平台：抖音、今日头条、小红书、B 站、微博、X、微信公众号。本轮只根据四项评审意见更新完整方案和证据口径，核对当前代码的真实连接点；不实施第二阶段、不提交、不推送、不改变 PR 或部署，也不读取凭据或执行真实数据工具。

### 四项意见的闭合情况

| 评审意见 | 已更新内容 | 与代码的对应关系 |
| --- | --- | --- |
| 全字段门槛过宽 | 主方案 §12.2 和矩阵分别定义 Q/I/S/X；正文待补、时间未知不普遍阻断，身份/权限/原文仍必须有据 | [材料入口](../../packages/backend/src/content/materials.ts)支持非完整正文；[抖音导入](../../packages/backend/src/providers/redfox/import-douyin.ts)已有 pending 和未知时间回填，不另造隔离状态 |
| 辅助矩阵模板要求失真 | 公众号文章统计改核文章与计数，建议改核建议词；单账号/单详情不要求分页；评论作者/时间按用途决定 | 复用现有研究结果和 summary，不把辅助能力变成完整文章流程；缺证仍标记缺证，未伪造字段或开放许可 |
| 共享改造范围过大 | 主方案 §11/§12.3 取消非必要 URL/文件/ID 迁移，静态路线扩展随第二个实际工具落地；材料校验与提交只局部拆分 | 当前 [admin-redfox](../../apps/api/src/routes/admin-redfox.ts) 已按 provider 分发查询和订阅，历史 URL 不等于只调用 Redfox；[transport](../../packages/backend/src/providers/agentkey/transport.ts) 则确实仍固定抖音输入/工具，必须调整 |
| 验证重复且范围偏大 | §12.6 按路线验证合同差异，共用治理测试复用一套；新增列表→详情与主订阅的集成案例；每处实际 UI 改动截图批注 | 复用现有 AgentKey、receipts/recovery、材料及切换测试，不为 65 个工具复制全部中断/预算套件，不创建新测试或质量平台 |

### 必要连接点复审

1. **入口到执行**：现有 [platform-subscriptions](../../packages/backend/src/sources/platform-subscriptions.ts) 只给 OWIBYU1V 增加 AgentKey，执行映射也只识别抖音。方案明确按操作提供 provider 变体和固定执行契约，表单、API、订阅、调度、查询和手工执行使用同一选择。不能仅新增下拉选项。
2. **主订阅**：[collection-commands](../../packages/backend/src/sources/collection-commands.ts)、[native-scheduling](../../packages/backend/src/sources/native-scheduling.ts) 和现有 replacement 需要 AgentKey 分支；复用来源权限、版本锁和订阅生命周期，保留 SocialData 批量及大加辣初始化/缓存/频率。
3. **材料末端**：其他平台导入器仍多为 Redfox 专用证据校验。方案保留各供应商原始响应验证，只共享已有平台身份、权限、去重和材料写入；不删除校验，不复制整套 importer，也不把请求 ID/昵称当返回身份。
4. **列表补详情与恢复**：主方案 §9 明确保留原 run/operation，详情使用选定 step/tool，在现有静态 lookup 登记实际组合；通过 [store](../../packages/backend/src/providers/operations/store.ts) 的 retainCurrentReceipt/advanceRun 保留列表证据并回到列表进度。独立查询键对不错误约束所有组合步骤，不建立子任务系统或任意工具编排。

### 重复建设、状态归属和迁移收尾

- **持久化**：没有第二阶段新增表、列或状态计划。第一阶段的两条默认 0 用途预算足够；不按平台再建预算、账单、身份或目录表。新增字段仅在既有契约/DTO 和 progress/data/usage 语义范围内使用。
- **唯一归属**：订阅保存当前 provider/周期/版本/占位；run 冻结本轮输入和步骤；receipt/attempt 保存真实外发、原始响应与费用；result 保存解析/材料关联；source 决定权限；materials 决定作品身份和修订。新 parser 不回写历史请求身份，也不再购买已收响应。
- **最小补全**：详情只有当前任务需要时才执行。头条的 Redfox 列表不自动串 AgentKey 详情，评论/建议/统计不默认进入文章链；其他平台进入第三阶段，排除的工具类能力不因分期而纳入。
- **切换收尾**：同一订阅及 source ID、权限、历史、启停、周期和初始化事实保留；预检失败不动旧配置，确认时复核版本，成功使旧轮失效，旧游标归档而不跨商挪用。迟到响应只归原 attempt 存证，不能改新订阅进度；既有回执恢复关联保护继续有效。
- **回退边界**：第二阶段回退以第一阶段为基线，只有原 V4 路线可由它继续理解；其他新增步骤先暂停/处理在途结果。该安排复用现有能力，不新加保护状态或发布门禁。
- **验证边界**：received 的本地恢复不增加外发；真正 unknown 的同步只读请求仍按已批准规则最多重试一次，可能重复计费。方案不再宣称所有同轮恢复都不会调用供应商。

### 范围、实施顺序与剩余证据

矩阵保持 233 行：212 条 AgentKey、21 条 Redfox。第二阶段 65 条分别为抖音 12、头条 4、小红书 10、B 站 11、微博 9、X 12、公众号 7；其中 1 条已在第一阶段实现，64 条待补齐，其他 147 条属于第三阶段。精确工具和恢复分类保持不变，91 条 readOnly / 121 条 needs_review 是候选证据分类，不是运行许可。

主方案 §12.4 的顺序为：免费补证 → 抖音多路线和详情衔接 → 公众号主订阅 → 小红书 → B 站 → 微博 → 头条辅助查询 → X → 整体收尾。X 的证据调查提前进行，缺证只阻断相关用途。每批涵盖对应辅助能力，不能只接一个搜索便宣称该平台全部完成。

待补输出/输入、分页会话、稳定身份或高级搜索语义见主方案 §12.5。已有公众号列表/H5 合同直接使用；不再等待可选头像、用户名长期保证或全部错误枚举。文档不足不等于必须付费测试；账户可用性、真实第二页/长内容、端到端保真和实扣单列为另行授权的运行验证。仍有 64 条待实现和具体证据缺口，不把方案复审通过表述为能力已经可用。

### 本轮验证与结论

- 静态核对矩阵行数、七平台计数、工具唯一性、目录快照命中、operation/step、恢复类及直连 Redfox ID；本轮没有变更工具绑定或第一阶段运行白名单。
- 核对主方案、矩阵、输出证据和本记录的阶段范围、最低用途要求、代码连接点、实施顺序、验证和迁移边界一致；本地链接与 diff 格式检查通过。
- 仅这四份既有 Markdown 文档更新；未改运行代码、测试、迁移或配置，未运行应用测试。历史测试数字单独标识，不充作本轮结果；无 UI 实现变更，截图留在未来实际改动的验收中。

在本次方案复审范围内，四项意见已落实，未发现新的需调整方案的 P1/P2/P3。方案没有以“精简”为由省掉主订阅、材料证据、步骤恢复和切换收尾，也没有引入新的业务生命周期。可以作为后续获准分批实施的依据；第二阶段仍等待用户开发指令，真实付费调用仍单独确认。


## 第二阶段首批抖音实现复审（2026-10-22）

范围：保留 V4 CV1，新增账号作品和详情 V2，并复用原页面元数据、订阅及切换流程；65 条中运行时现为 3 条，其他 62 条未实现。七平台范围不变。

Astra Medium 独立只读审查后端契约、解析、回执、预算、恢复、历史导入、身份权限和切换收尾，未发现新增且可明确复现的 P1/P2/P3 或不必要的表/状态/框架。未重复运行执行者测试。前端独立复审发现 P3：操作下拉选项用当前项的供应商渲染所有候选名称，选择另一项后却恢复它自己的默认供应商。已改为按每项自己的 provider/draft 生成标签，补渲染断言并在浏览器确认；复核无剩余发现。

状态归属：订阅保存当前配置/周期/占用；run 冻结路线和原参数，progress 保存页及逐项详情进度；receipt 保存每次外发和费用/原始证据；result 保存相应步骤结果及原 summary；材料与作者权限仍由原入口负责。历史页不借当前 step 证明身份；旧轮失效仍保存迟到回执而不能写新材料。没有第二套身份哈希、额外详情版本列、通用化运行时注册器或自动兜底。

验证详见[主方案 §12.8](../agentkey-integration-plan.md)和[截图索引](agentkey-phase2-ui-2026-10-22/README.md)。Lead 选中的后端 121 项、Web 319 项经环境修正后最终通过；最后前端修复另做受影响 16/16 验证，类型检查及构建通过。121 和 319 是各自选中集合，不累加重跑项。两次真实只读调用合计 0.4 credits，仅用于指定成功结构；本地验收均为假凭据/本地桩/独立 _test 库。

本批最小边界仍有：旧详情配方跨商等价未证实时拒绝切换；真实后页/末页、受限作品和未实现工具没有被验证。没有把剩余能力悄悄删减或移到第三阶段。本轮未提交、推送、合并或部署。


### 同日追加两条抖音辅助查询复核

账号搜索/搜索建议各另获准验证一次，实际各0.2，本阶段累计四次0.8credits；输出合同见证据§13。实现沿原 transport/run/receipt/查询与显式绑定，没有新增订阅/表/状态/框架。账号搜索 JSON 字符串只无损解析白名单，不执行模板/URL；仅无筛选首页，建议词仅研究。独立只读复审无新增问题。

浏览器另发现一个 P3：单次研究查询继承采集专用字段，误显示作品候选。已限制四字段只在 collection 保存；历史 AgentKey single-request 走查询展示，复核无剩余发现。四个 AgentKey 回归76/76、Web320/320单轮通过，类型检查与构建通过。追加六处批注截图及原图已保存；实际本地绑定未增加文章或权限。当前合计五条已验收，公众号六条在实施中；没有提交、推送、合并或部署。


## 第二阶段公众号六条与主信源收尾评审（2026-10-22）

已完成六条raw=false固定路线、原source命令/调度/force/preview与显式三方切换、同轮最多8条H5补正文。复用原request/receipt/run/result/importer、typed绑定与别名表，无新表/状态/队列。

初审2P2（passthrough字段污染材料、矛盾URL未拒绝）及1P3（辅助用途文案）已修；收尾P2证据保留链、P3矛盾content.link也已修。保留同run/step/receipt摘要和同run前序来源页，跨run伪引用无效，解除受保护叶子后整链仍能过期。独立复核无具体剩余发现。实际UI又修无库目标发送library:null导致失败的接线；重新预检后切换与主采集已完整保存，失败不改变原供应商。

验证边界：先前105/105组合；最终MP/retention14/14；类型检查；公众号Web321/321和构建；18处真实本地应用截图及SQL事实在UI索引14–31。没有真实公众号调用、Git写操作或部署。后续抖音新批仍独立验收，不以本节代替65条全完成。


## 第二阶段抖音单页快照及受限资料复审（2026-10-22）

新增5条首页Q/单页S、仅注销态资料Q；粉丝不注册。字段/父关系按真实有出处结构校验，topic混合列表不按aweme_list=[]误判空；研究类型不进入材料，注销资料无绑定/导入。原订阅固定pages1/details0、保留items；following source_type2实收19，不自动发第二步。无新表、状态、队列、注册框架或混商编排。

后端独立复核、随后必要UI接线复核均无剩余P1/P2/P3。UI修正新snapshot摘要被历史single-request兼容掩盖的展示问题，兼容现在仅作用于snapshot!==true；actualUI已展示19/3/16与nextParameters=null。已有原键识别补入5条S，任务可返回同一订阅。没有为这处显示修正引入模式/状态。

验收范围：parser6/6、集成5/5；组合首轮101/102后原kind错误文本顺序修正，相关32/32通过；类型检查通过。Web322/322与构建通过。16处新增UI含原图/批注并逐一回看，SQL确认研究无source/article关联、active_run_id已释放；验收后3条测试订阅均停用且next_run_at=NULL。详见主方案§12.11与截图32–47。17条运行接通含1条受限资料，并非65条全部完成；15次真实补证费用及头条新证据另记，不提交、推送、合并或部署。

## 第二阶段头条/小红书验收与B站/微博状态复核（2026-10-23）

截至2026-10-23，65条中60条已按用途完成本地验收（抖音11、公众号6、头条3、小红书9、B站11、微博8、X12）；X已接通12类Q、5类作品手动I及10类单页S，后端、Web和真实本地浏览器已验，最终状态/清理已通过，截图1–228每处均有原图和批注图共456PNG，最终批注图由Lead逐张回看；另5条尚未接入（抖音粉丝、头条视频、小红书回复、微博粉丝、公众号相关文章各1），仍保留在65条范围，未移入第三阶段。累计59次真实数据请求，57个响应报告扣费合计29.4 credits；抖音粉丝400和微博粉丝400两次缺credits_charged，保留未知，不按实测0或已完整对账表述。

头条三条已本地验收，profile既支持已见全空，也允许同字段真实非空Q，不I/S/绑定，不推断注销。后端33/33+元数据1/1，Root最后profile8/8；Web先前323/323与最后profile局部33/33分开记录，types/build过。Root评论ID展示P3已修。视频10400仍为缺成功合同。

小红书九Q、后端五类首页S（UI实际搜索有界详情/评论快照两类）、有界同run详情默认0/显式1、有据I/绑定、研究无I、跨商阻断及去重/权限完成本地验收。后端29/29+末次可选作者1/1；Web最终4文件29/29、types/build过。两项Web评审缺陷（仅AgentKey推荐禁I不得误伤Redfox、嵌套stats展示）均已修；回复非空合同未证，仍未接入。

B站十一条已按用途本地验收，S20/20、Web最终7文件58/58/types通过，UI实际11Q/3S代表完成。Q初8/8不能掩盖后发现的两个实质缺陷；Root红2/2→修复绿10/10。I初21/23，fixture/隔离预算修正后23/23；保留全过程，不称首次全绿。微博九条十次只读补证后，八条后端Q8/8、I28/28、S/X Lead修复后36/36及Web/UI已按用途验收。粉丝400仍未接，不通过关注替代。

截至头条/小红书批次UI索引87处/174PNG均已逐张看过，新增48–59头条、60–87小红书；其后B站追加88–123见下文。独立_test库/假MCP、脚本复用原执行器，无真实UI外发或常驻Worker，不能称resident E2E。最终测试订阅均disabled，未提交/推送/部署。本次文档状态同步只检查数字、JSON与本地链接，不运行应用测试、不冒称独立重审后端或新的全量测试。持续只读补证授权及停止规则以主方案§16为准，历史单次授权仍保留。

### 本轮收尾追加：B站S与X字段证据（2026-10-23）

Lead运行B站S20/20、Web最终7文件58/58/types，UI88–123实际11Q/3S代表完成，该批11条计入当时40条整体验收。S中曾修正verified AgentKey typed_search误依赖Redfox shape，历史Q两实质缺陷和I21/23→23/23轨迹继续保留。

X固定12工具13次（search Top/Latest两次），全部成功，13回执报告2.6credits；累计59次、57回执29.4credits、2失败费用未知。该补证时普通Q已有有意义字段、十二条尚未开发；其后后端Q/I已验收，最新见文末。引用/转发/pinned角色已收，搜索/账号帖直接reply-parent、高级算子/后页/Article全文尚缺；详情text/display_text不同，不能宣称正文全文已证。社区成员官方无分页，返回cursor也不续传。用途缺口见主方案§12.16与输出证据§20，本次仅文档静态校验，不宣称新跑应用测试或真实UI请求。

### B站Web/UI收尾及微博Q/I复核（2026-10-23）

B站Root浏览器发现摘要误把嵌套pagination.page和accountTotal称未提供的P3-1，SSR红1/1→修复绿1/1；99–109最终重拍。此前两次独立review未发现此项，保留遗漏，不把review无问题当总验收。实际UI11Q、3S代表（search有界详情1、comments截断1、stats候选0），九条是后端S种类，不是九类浏览器运行。run34–47 completed、sub8/9/10确认progress/scheduled后停用并清空占位/调度；RF对照sub11预检阻断保留旧配置。详情/同BV有界采集共用文章，资料复用来源，研究无材料/来源关联，最终articles5/sources5、全部订阅disabled。无新增表/状态/框架。

小红书此前UI仅实际运行搜索有界详情、评论快照两类S；五条为后端S种类，85为本次两S与RF对照停用，87为九Q与本次两S。已纠正文档，未增加运行验收声明。

微博Q最终8/8；I最终28/28（13 AgentKey+15原Redfox）。首次26/28来自cross-provider测试前置未raise Redfox预算，一项子test失败连带父传播为两fail；补全前置且恢复两budget后通过，产品预算逻辑未变。Ireview无具体问题；随后S/X Lead修复后36/36及Web/UI完成，八条计整体验收，粉丝未接。付费统计仍59请求/57收费字段/29.4credits，2失败费用未知，本轮无新增paid。

B站最终103/104/106–109已由Lead复看，88–123共36处及总123处最终批注图均已视觉回看，123处原图与批注配对共246PNG。微博I已正式接受最终28/28与独立评审；该S6/directI初始checkpoint当时仅实现；最新S/X及X状态见下段，不把历史待验改成首次通过。

### 微博按用途验收与X后端Q/I历史检查点（2026-10-23）

微博八条计入48整体验收。后端S/X此前35/35漏账号列表无UID/详情异UIDP2，第二实质错误后执行者停止、Lead接管；回归fixture漏detailOperationId先误停在校验，修正fixture再红测复现，最小冻结账号/实收详情UID校验后36/36，独立定向review关闭P2。缺实际UID仍pending、普通Q不收紧。第一项research purpose陈旧、I预算fixture26/28和早期Web两错均保留。升级Web恢复原测试并连接详情显式预填；Root又发现评论ID/带时区时间标签P3，helper/SSR红13/15→绿15/15与types通过，135重拍回看。

UI124–163共40处最终批注图已由Lead逐张回看，原图配对留证：实际8Q/6S六类全运行，items1、账号sub12 details1其他0；原执行器手动执行，无常驻Worker/真实UI调用/额外API。Q50手动I和Q52资料绑定同source，WB新作者isolated与全文权限false，最终articles6/sources6。sub18实际RF→AK同ID，反向只预览取消（153）；sub19 extParam2拒绝原配置不变。sub1–19全停用无active/next，本批WB源停用；旧DY external作者仍enabled但无采集调度。154/155同内容fullPage最终替换已完成，Lead逐张确认无裁切，124–163共40对均完成最终视觉验收；本次仅更新该状态，不替Lead视觉。总索引163对326PNG。

本检查点当时X12后端Q/I已验收、I Web接线中，无X截图/整体验收；最新状态见下节。Q第二错误缺root/thread ID相等丢评论，Lead红0!=2→绿10/10，原RF6/6另记。I+Q+RF45/45，后advisory22/22、文案2/2，不相加；独立Ireview无具体剩余问题。正文pending、未知时间历史回填、实际provider guard禁止隐式SocialData/Jina、原有单账号绑定保持；无Article/自动详情/原生S/续页/切换。Web31/31只是Q阶段，不称最终I验收。付费仍59/57/29.4、两失败费用未知；无新增表/状态/框架。


### X按用途本地验收与最终连接复核（2026-10-23）

新增X12后共60/65条按用途本地验收；既有65范围、其余147条第三阶段与21条Redfox直连、233矩阵总行数保持。X12类Q、5类作品手动I、资料显式绑定既有完整单账号x_search、10类单页零详情S均沿原入口完成，真实本地浏览器十二类Q62–73、账号帖Q74选择重拍及S75–84已运行（UI搜索仅Top；Latest由后端/真实补证覆盖）；6个结果I复用3个唯一材料。基础搜索RF↔AK显式同ID保留历史，sub31切换成功、sub32高级配方阻断；native连续采集/高级配方/全文/Article与未证真实后页仍未开放。共享评论/关注Q保留RF+AK而S仅AK，DTO queryProviders只在差异时发送，Q兼容回退collectionProviders，S保持实际collectionProviders。

metadata P2已作最小修复：原materials revision SQL原子顶层合并x_post，缺省unknown保留、显式null/[]清空、incoming quote整体替换，AK未收到media/avatar/lang省略；RF/SocialData明确值行为保持。不宣称旧历史回填或同内容metadata-only更新。临时旧quote先被清空，修复后未回填；217改为中性旧fixture批注，不能据其声称UI回填验证。

执行质量历史保留：X S Web的Sol两项fixture错误后停并升级Astra Medium，升级包0错误；metadata Astra Medium两项fixture错误后停，Lead修fixture/旧catalog断言后最终70/70。最终Web64/64、真实161 DTO/10S probe、整项目types通过，不与早期45/45、22/22、2/2或Web31/31累加。独立X连接与跨平台共享机制静态review均无新增P1/P2/P3，未替代实测。

更广AgentKey旧长期test库曾日预算耗尽连续失败/挂起，Lead终止并用单例确认`agentkey.query` day budget exhausted，不能抹作一次全绿或归为产品预算缺陷。新独立`aihot_agentkey_phase2_final_20261023_test`（65433）应用75份现有迁移后串行189/189通过、exit0，无新增迁移。上述测试集合各自记录。

UI164–228共65处各有原图与批注图，最终批注图由Lead逐张回看；真实浏览器/loopback假MCP/独立UI test库，原executor单独步进，无常驻Worker，不称Worker E2E。最终state/cleanup通过：23个原回执对应13Q/10S且query/collect服务正确，研究无article/source关联，原native主订阅仍SocialData；本批10个X订阅及账号信源经原domain command停用，UI全部32订阅disabled、active/next均为空，最终articles9/sources7。剩余5条仍phase2未开放：DY粉丝400、TT视频10400、XHS回复只合法空、WB粉丝400、MP相关文章只空articles/count；免费重describe健康/价格未变不补成功证据，不加count-only路线凑数。费用仍59/57/29.4，两400扣费未知，X前421.6不冒充最终余额；无新付费、提交、推送或发布。

## 第二阶段60条实现整体复审与五条最小补证路径（2026-10-23，追加轮）

> 以下记录发现问题时的检查点。用户其后授权的5项最小修复已完成，当前验证与UI状态见文末“追加五项P2修复收尾”；原发现与待修建议保留为历史。

结论：**确认5项P2，暂不能认为整体评审通过；没有确认P1或独立P3。** 既有60条按用途实现、189/189 AgentKey回归、70/70相关修订回归、64/64 Web定向及类型检查是上一轮证据，本轮发现这些集合未覆盖的组合场景；不把旧通过结果扩成无缺陷证明。65条范围不变，另外5条仍未接通，未移第三阶段。本轮不改业务代码、不提交/推送/部署，也未发起真实供应商请求。

### 1. P2：追加AgentKey变体绕过原Redfox详情能力，普通保存会关闭已开启补全

- 位置：[admin-redfox.ts](../../apps/api/src/routes/admin-redfox.ts#L99)第99–108行在原价格/能力投影前返回；消费位置为[collection-subscription-data.ts](../../apps/web/app/features/admin/collection-subscription-data.ts#L96)。
- 触发：原Redfox微博搜索`TXQPVGJG`已保存`enrichDetails=true`及详情目标，管理员只改名称/周期或原样保存。API返回的RF基础descriptor缺`collectionCapabilities`，编辑器不能显示原详情能力，实际`collectionConfig`静默输出`enrichDetails=false`并移除详情目标，保存后旧轮按执行配置变化停止。同类明确影响B站`LEN9QXR3/VPA67I98`、小红书`384C6W6B/XN3ULENA`；价格显示缺失是同根因，不重复计数。属于本次新增回归。
- 证据：只读既有真实161条DTO，调用实际`providerOperation/collectionDraft/collectionConfig/subscriptionExecutionChanges`，原样草稿`true`变保存输出`false`，`executionChanged=true`，无DB/网络。临时证明为`/private/tmp/aihot-phase2-review-ui-proof.mjs`及同名前缀`-output.json`；也已对照当前API提前返回分支。
- 最小修复：先完整构造原RF价格和`collectionDetailTargets`能力，再追加AK变体及确有差异的queryProviders。Web继续消费服务端能力，不再硬编码另一份。定向验证用实际API DTO覆盖三组RF保存保持原详情配置及AK限制；UI修复后截图相应控件。

### 2. P2：小红书详情缺作者被误判为作者冲突，卡住有界详情与订阅

- 位置：[xiaohongshu-evidence.ts](../../packages/backend/src/providers/agentkey/xiaohongshu-evidence.ts#L37)，[xiaohongshu-execution.ts](../../packages/backend/src/providers/agentkey/xiaohongshu-execution.ts#L50)在导入savepoint/catch之外调用该证据校验。属于本次新增问题。
- 触发：列表已有实际作者，或从账号笔记订阅补详情；详情返回同一note_id及有意义内容，但省略`user.userid`。parser允许该缺失并投影`identity={}`，`actual !== author`却把undefined当作矛盾。详情结果事务回滚、received保留、run进入needs_review，后续详情和订阅占位停住；重放同响应仍失败。
- 最小修复：仅在详情实际返回作者时比较冲突；缺作者交现有导入资格校验拒绝，沿已有catch落pending，再推进并释放占位。B站/微博已采用这种区分。补同ID缺作者可保留结果并完成、实有异作者仍拒绝的定向验证，不降低导入身份要求。

### 3. P2：头条移动端链接识别已扩展，旧移动URL身份复用未同步

- 位置：[material-identities.ts](../../packages/backend/src/content/material-identities.ts#L65)只查`url:https://toutiao.com/...`旧身份，而[toutiaoWorkId](../../packages/backend/src/lib/url.ts#L44)新接纳`https://m.toutiao.com/article/<id>/`且要求末尾斜线。属于本次扩大链接识别后的迁移收尾遗漏。
- 触发：已有通用材料使用规范化后的移动原文`https://m.toutiao.com/article/<id>`，保存为`url:`身份；AgentKey详情收到同URL带末尾斜线，按原生workId导入。两者`identityKeyForUrl`相同，但旧身份查询不覆盖移动域，形成两篇材料。
- 证据：任务独立`aihot_agentkey_phase2_final_20261023_test`（65433）内合成事务调用实际`upsertMaterial`两次，确认sameCanonicalUrl=true但articleId不同；事务最终全部回滚，没有回执/队列/供应商调用。临时脚本和输出为`/private/tmp/aihot-phase2-review-toutiao-identity.ts`及`.log`。首次命令因本轮无继承环境变量未执行，显式隔离环境后才运行成功，不能计作产品失败。
- 最小修复：在现有URL/身份解析中一致处理已接纳移动原文及规范化形态，复用现有旧身份/冲突逻辑；不加表、不批量改历史。验证旧移动URL先入、原生ID先入及重复/并发发现均只有一个材料，原来源、权限和历史保留。

### 4. P2：来源权限编辑后恢复器关闭旧轮，却留下主订阅占位

- 位置：[recovery.ts](../../packages/backend/src/providers/operations/recovery.ts#L106)，真实入口为[updateSource](../../packages/backend/src/admin/sources.ts#L152)。这是旧公共恢复缺陷，本轮新增AK公众号主订阅继承，不能归因于新增AgentKey恢复机制。
- 触发：公众号主订阅有active/waiting轮次，管理员改tier、参与方式或全文权限。来源execution_version增加，`exitsMember=false`保留占位；旧成员失效后，恢复器仅把run标stopped，未释放`active_run_id`。调度要求占位为空，手动force创建也被occupied拒绝，正常采集持续停住；额外abandon/启停/换商可解，不能称绝对不可恢复。
- 最小修复：共用恢复器在关闭无资格轮次的同一事务中调用现有`releaseSubscriptions`，按当前active_run_id保护，保留原回执及未知结果治理。补AK公众号活跃时权限编辑→旧轮关闭/占位释放→同订阅能建新轮，并核对未知/迟到响应仍不能提交。无需新增状态或供应商专用恢复器。

### 5. P2：抖音V4透传未契约字段，被共用writer优先当作正文

- 位置：[douyin-parser.ts](../../packages/backend/src/providers/agentkey/douyin-parser.ts#L48)的`record={...item,...}`与[import-douyin.ts](../../packages/backend/src/providers/redfox/import-douyin.ts#L75)的`record.content`优先级。两处HEAD中已存在，属第一阶段残留，第二阶段APP/topic投影已用白名单但V4未同步。
- 触发：正常AwemeId、Author、Desc之外带未验证`content`字段。重放receipt仍生成相同原样record，不能拦截；I/S标题来自Desc，正文却来自未知content并标ok，同源可形成错误修订。
- 证据：Root用实际纯parser构造响应，title=Verified description、writer选body=UNVERIFIED BODY、importBlockers=[]；无DB/网络。脚本及输出为`/private/tmp/aihot-phase2-review-douyin-proof.mjs`及`.log`。
- 最小修复：V4材料record仅投影已核实字段，原始响应留在receipt；不改变原RF正文语义。补未知content不进入正文、已证Desc正常保留及旧RF流程不受影响的回归。

### 共同机制、重复建设与预算结论

现有订阅、run、receipt/attempt、结果、身份/别名、材料修订及入队仍是各自唯一持久权威；没有发现新建业务表、第二套调度、自动换商或隐式补购路径。Q/S供应商差异有实际用途，不能为统一外观合并资格。各平台parser/evidence/execution处理的输出层级和身份语义不同，不建议为了减少文件抽成万能执行引擎；本轮修复均可留在已有入口/领域函数。恢复枚举和UI单页名单存在人工维护点，但本轮未确认漏登已实现路线，不把未来可能变化另计P3或新增注册中心。

paidRequest仍统一次数预算、持久尝试、估价/实扣、unknown与已收响应恢复；本轮未确认预算绕过或重复购买的新缺陷。权限失效后的占位释放是第4项实际缺口。credits不等于金额、两条400缺扣费仍未知，费用累计不变；无新增迁移、未执行生产迁移/运营切换，不能将75份测试库历史迁移当成生产切换完成。

### 剩余5条：最小补齐路径

| 路线 | 可以免费补的工作 | 开放最低Q所需的下一份证据 |
| --- | --- | --- |
| 小红书回复 | 复用现有评论/研究路径补合法空分支的离线合同，保留note/父评论及page_context；未知非空不得报空 | 同固定工具的非空文字/定位与父评论角色。只有既有同笔记、实收回复数>0的父评论才值得一次最小补证；无依赖则跳过，不买新评论页或轮换ID。无需等稳定作者/正文/时间/后页。 |
| 公众号相关文章 | 显式raw=false，补已文档化ret/count/articles空容器合同；不加独立count-only工具或为计数开放半条路线 | 非空文章至少有可理解标题或可靠定位。优先官方完整样例；真实补证需已知开启相关文章的公开原文正例，官方已知空例无需再付费。无需等I/S身份与全文全部闭合。 |
| 抖音粉丝 | 现有准确输入保留；sec_user_id、max_time字符串与count整数的说明有据，但不是400原因证明 | 免费取得明确validation诊断/路由修复证据或成功/合法空列表。无新条件不重试旧示例、不换ID、不套关注结构。 |
| 微博粉丝 | 保留官方users/next_page/总数容器候选；不将following字段套入 | 400原因、精确成功层级和最小可理解成员投影。健康标记不能代替成功，先取得上游诊断或完整样例。 |
| 头条视频详情 | 沿已有错误回执/诊断显示；10400与data=null不是合法空 | 同固定工具的正常视频节点和可理解标题/说明/定位，或明确的错误/修复说明。现无可区分原因的新参数实验，不以换group_id碰成功。 |

本轮核对的是已有官方文档缓存和脱敏实收证据，没有重新联网、联系上游或执行真实补证。可免费补空分支的事实不代表这两条完整路线已接通，不将60计为62/65。补齐路径不需要新表、状态、抽象或额外发布门禁；后续实施先修5项P2，再按已有持续授权及停止条件补真实证据。当前只是评审记录，不自动实施这些修复。

### 本轮验证与限制

三个不重叠范围的只读审查覆盖60条及UI/共同连接，Root独立复核发现的调用链；仅补真实Web纯函数证明、抖音纯parser证明及头条真实DB回滚证明。未重跑既有189/70/64全套，也未修源码或调整UI，因此本轮没有新增截图。只修改本节及主方案当前评审提示，保留既有脏树和历史证据；旧“无新增P1/P2/P3”仅是上一轮当时结论，本节为较新结论。


## 追加五项P2修复收尾（2026-10-23）

此前确认的5项P2均已按授权最小修复；下列是较新状态，前节“未修源码/无新增截图/待修”均为当时历史，不改写为首次通过。

| 项目 | 最小修复与验证 |
| --- | --- |
| P2-1 RF能力/价格被AK变体提前返回遮蔽 | API先按原service_prices、collectionDetailTargets等生成RF价格/详情能力，再追加AK variants；实际API DTO与现有Web helper定向18/18，RF配置继续保留已开启详情，AK各自限制仍在。 |
| P2-2 XHS缺作者误判冲突 | 仅有实收actual作者才比较冲突；缺作者保留pending并继续下一详情，真实异作者仍needs_review，导入身份门不放宽。新增search/account_posts两个真实executor场景，相关31/31。 |
| P2-3 TT移动旧URL重复材料 | 兼容slashless/slash移动原文，在原typed-ID事务锁内查旧owner，沿既有冲突/来源规则复用材料；5红→5绿及真实query→receipt→I验证，不批量改历史或自动合并多owner。 |
| P2-4 无资格旧轮未释放主订阅占位 | Root在recoverOperations无eligible分支同事务调用现有releaseSubscriptions，按active_run_id=旧run保护新轮占位；真实主订阅编辑权限的active、waiting-unknown、received三场景3红→3绿，回执/未知结果治理保持。未宣称实测并发race或清理修复前已stopped历史脏占位。 |
| P2-5 DY V4透传未知正文 | V4只投影已契约白名单；旧record仅从同receipt/同item完整重建且精确匹配才兼容，writer消费重新解析安全投影。4红→4绿，相关74/74；原始回执保留，未知content不入正文，原RF语义不变。 |

三份独立静态review（目录、恢复/XHS、材料）均未发现具体新增P1/P2/P3；review没有独立重跑测试，不将静态结论替代实测。本轮复用原表、状态、迁移、事务锁、writer和订阅释放函数，无新增表/状态/迁移。

最终独立库`aihot_agentkey_p2_final_20261023_test`（65433）应用75份现有迁移后，串行运行全AK及RF/材料/恢复/native相关339项。首次338/339，唯一失败为旧RF抖音目录总数14断言过期；Root改为核验原14接口保留后最终339/339、exit0，未改变产品目录或价格。完整`npm run typecheck` exit0。18/18、31/31、74/74及各红绿集合与339有重叠，分别记录、不累加。Sol目录fixture两次错误后按流程升级Astra Medium；升级修正XHS2credits及RF B站字符串page预期，产品价格未改。

UI229–233五个RF合成订阅33–37均经真实Web保存并reload：只将周期改16，原RF、params、3页/2条/1详情、enrichDetails=true及原detail target完整保留；execution_version均1，edit_version为33/35/36/37=2、34=3。34首次数字fill得到1416且已保存，断言超时后用Meta+A逐键16再次保存/重载；这是UI自动化输入错误，未改产品逻辑。229初版CDP截图裁底后已用zoom坐标重拍，最终229–235七处批注图逐张回看且无裁切，原图配对共14PNG；累计235处/470PNG。234为保存后列表，235仅新草稿选AK/XHS显示2credits/首页/零详情，未保存、未调用。

最终UI state脚本exit0：37订阅全disabled、active/next为空；runs84/receipts89/articles9/sources7与本轮前一致，没有新增call/run/material/source。新增5个停用合成订阅是验收fixture。临时本地3310/3311/3312保留便于查看，无常驻Worker，真实阀门均false。本地假MCP和独立UI库，不称Worker E2E；恢复的新旧轮占位测试为顺序检查，未宣称并发交错已测；修复前stopped历史脏占位及既有冲突重复owner没有批量修生产。完整typecheck后，Root更正旧RF目录测试断言再跑tests tsc亦exit0。

路线仍60/65；未开放5条的补证路径保持本轮之前的具体约束，不因修复5项P2而计为65/65。累计仍59次数据请求/57响应报告29.4credits，两400缺charge保持未知，未完整对账。未提交、推送、部署或新增真实调用。


## 修复后完整代码只读整体评审（2026-10-23，3项P2已修复并复审闭合）

**原5项P2定向修复主链完整，未确认其补丁引入新缺陷；随后确认的3项P2已按本节最小方向修复，并通过全AgentKey回归与最终独立复审。** 本节保留当时的缺陷发现及红灯证据作为历史。此结论不撤销此前5项最小修复、339/339、types及UI保存验证的实际结果；本轮补上那些集合没有覆盖的传输/恢复组合。材料边界及API/Web分域静态复审未确认具体新发现，生命周期域与Lead本地实证确认以下三项。原235处截图不变，本轮没有UI改动或新截图。

### 1. P2：工具已发送但断连时，把辅助GET405当作工具确定拒绝

- 位置：[transport.ts](../../packages/backend/src/providers/agentkey/transport.ts#L89)第89行`toolWire ?? lastWire`及后续拒绝分类。该逻辑第一阶段HEAD已存在，第二阶段继承，不是此前5项补丁引入。
- 触发与结果：实际工具POST已到达本地桩，fetch在获得工具response前断连；并行辅助GET返回405并留在lastWire。工具没有完整响应，却被保存为httpStatus=405、receipt failed，run进入needs_review，丢失应有unknown等待/放行/人工核对治理。辅助GET405足以解释污染，不把未证实的DELETE当作本次原因；没有证据证明已发生自动重复扣费。
- 最小方向：工具发送后只以该工具请求自己的响应证据作HTTP/MCP拒绝分类；缺失工具响应就保持unknown。辅助GET与确定拒绝均核实请求归属，握手失败证据另按真实阶段处理，保留真正工具HTTP405/429的原分类。不新建状态、回执或供应商专用恢复链。

### 2. P2：小红书拒绝合法failed回执，429或unknown放行后无法重试

- 位置：[xiaohongshu-execution.ts](../../packages/backend/src/providers/agentkey/xiaohongshu-execution.ts#L33)第33–36行。它只接受received本地回执，而current_receipt_id存在但非received一律拒绝；这是第二阶段新增执行器的现存问题，不是上一轮缺作者evidence guard修复引入。
- 触发与结果：完整429经原分类改receipt为failed并安排waiting，或unknown经原自动/人工release改failed，current_receipt_id按原设计仍保留。下一执行在进入requestAgentKey/paidRequest之前抛错，不能创建同logical key的新attempt；run反复needs_review，S占位不能释放。Root实证两条路径均停在attempts=1，没有新增外发。
- 最小方向：区分匹配且合法可重试的回执状态与错误关联，让合法failed进入原paidRequest的attempt/预算路径；received仍本地校验，unknown仍先治理。不能通过清current_receipt_id、绕过预算或直接盲重发解决。

### 3. P2：本地received429恢复绕过共用限流分类

- 位置：[request.ts](../../packages/backend/src/providers/agentkey/request.ts#L32)第32–51行的429分类，与七平台各执行器本地received消费分支（代表：[x-execution.ts](../../packages/backend/src/providers/agentkey/x-execution.ts#L18)第18–24行）。第一阶段DY本地消费模式已存在，第二阶段扩散，不归因于原5项定向补丁。
- 触发与结果：paidRequest已提交完整HTTP429为received，但在requestAgentKey执行429分类前中断。恢复时本地received分支直接parse，跳过retryReceivedRejection/Retry-After；run变needs_review、retry_count仍0、receipt仍received，S持续占位。即使修复小红书failed guard，这条独立中断路径仍存在。
- 最小方向：现有限流分类同时覆盖新响应与本地received恢复，复用原attempt CAS、重试次数和Retry-After规则；关外呼时仍能本地分类已有响应，不因此额外购买，也不为七平台复制新状态/队列/注册中心或生命周期。

### 本地实证与执行历史

三份Astra Medium分域报告为`/private/tmp/aihot-phase2-postfix-lifecycle-review.md`、`/private/tmp/aihot-phase2-postfix-material-review.md`、`/private/tmp/aihot-phase2-postfix-api-ui-review.md`；均为静态检查，没有独立重跑。Lead用真实本地桩、既有执行/恢复入口和独立任务库`aihot_agentkey_p2_final_20261023_test`（65433）的合成数据补实证，脚本`/private/tmp/aihot-phase2-postfix-recovery-proof.ts`，最终`/private/tmp/aihot-phase2-postfix-recovery-proof-confirmed.log` exit0：

| 场景 | 实际持久结果 |
| --- | --- |
| run1097：XHS完整429后下一执行 | needs_review，receipt failed，attempts1，桩calls1；未进入新attempt。 |
| run1098：工具POST断连、辅助GET405 | needs_review，receipt failed，存http405，attempts1，桩calls1；应有的unknown被误归确定失败。 |
| run1099：合成unknown沿原自动release后下一执行 | needs_review，receipt failed，attempts1；本场景新桩calls0，放行仍不能重试。 |
| run1100：模拟received429分类前中断点，关valve恢复X详情 | needs_review，receipt仍received，retryCount0，attempts1，桩calls1；没有实际kill进程。 |

最终脚本exit0表示四项缺陷场景得到确认，**不是产品修复后的绿测**，也不是新一轮全面339项回归。首轮桩未处理GET而断言崩溃是fixture错误，保留原`proof.log`；补GET后的`-verified.log`中unknown预期得到failed，进一步确认传输归属这一产品发现；最终`-confirmed.log`按实际结果确认四场景，不把中途失败改成首次通过。原339/339及types结果仍是有效历史证据，但不能证明这次组合已覆盖或问题已修复。

### 最小修复落地与最终复审

| 修复 | 最终实现与定向验证 |
| --- | --- |
| 工具断连误取辅助GET405 | `transport.ts`在`execute_tool`已发送后只使用该工具的`toolWire`；没有工具响应时保留incomplete，由原回执恢复流程转unknown。真实SDK桩红1/1→绿1/1。 |
| 小红书failed头回执不能重试 | 仅对工具、用途、主体、参数和logical key均匹配且状态为`failed`的头回执放行；进入同一`paidRequest`，由现有预算和attempt机制创建下一次attempt。隔离库红1/1→绿1/1，receipt attempts 1→2。 |
| 本地received429绕过限流分类 | 新建`request.ts`内单一429分类入口，七平台在解析received响应前调用；复用`retryReceivedRejection`、`Retry-After`、`retry_count`、`limits.retries`及既有waiting/needs_review状态。 |

整体复审又发现抖音、头条、公众号只用model/service/purpose过滤，仍可能消费同路线但错误subject、参数、step或run的回执。三处均改为与其余四平台相同的完整冻结身份检查：使用现有`logicalKeyFor + stableJson`核对subject、request.tool、规范化params及logical key中的run/step/endpoint/contractVersion/tool/params。新增同路线错误subject与参数共6种错配，初跑红灯确认会误改failed并增加retry_count；修复后回执保持received、attempt不变、run保持active且retry_count=0。没有补做更强篡改防护或新增抽象，因为subject/logical key已经覆盖本次归属边界。

最终验证：七平台正常received429恢复、抖音跨工具/用途拒绝、抖音/头条/公众号同路线subject与参数错配定向3/3通过；全部`tests/agentkey-*.test.ts`串行222/222、exit0；完整`npm run typecheck`通过；`git diff --check`通过。恢复测试原有一个成功本地夹具仍使用早期无subject/request摘要的合成回执，新校验如实拒绝；该夹具按`requestAgentKey`真实最小身份改成完整冻结请求后原恢复用例通过，不是放宽产品校验。最终独立复审确认归属问题闭合，无新增P1/P2/P3。新增表、状态、队列、迁移或另一套生命周期均为0；本批无UI改动，不新增截图。

此前失败遗留7个合成run已沿原domain abandon关闭；Lead随后通过原getBoss.cancel仅取消这7个合成队列，cleanup脚本exit0，review活跃轮次与pending jobs均为0，query预算恢复0/0/0。7个run在旧339测试库以failed保留审计证据，UI库及原235处截图不变。本轮修复只使用现有transport、回执、执行器和恢复入口；没有真实供应商调用、生产数据操作、新迁移、表、状态、队列、注册中心或第二套生命周期。

60/65实现范围、未开放5条上游证据及最小补齐路径保持；累计59请求、57响应报告29.4credits，两400扣费未知且未完整对账。原235处/470PNG不变；本轮同步方案与评审记录，不改catalog或截图，不提交、推送或部署。
