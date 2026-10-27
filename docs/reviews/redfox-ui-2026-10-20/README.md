# Redfox UI 截图与批注

状态：持续补充的开发验收记录，尚非 169 项完整交付。截图均来自独立本地测试库和合成数据，图片生成使用 localhost 桩；没有真实生成、上传或生产操作。

图片保留原始浏览器画面，下面按编号标注观察区域、变化和验证结论。桌面截图使用完整内容区域；浏览器缩放造成的早期裁切图已替换，窄屏单独验证为 390 CSS px，无横向溢出。

## P2 图片工具

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [01 创作表单](01-image-form.png) | `/admin/redfox`：上方工作区切换、创作参数、底部次数/费用说明 | X 查询继续保留；分辨率、比例、张数来自服务端已接通契约。生成费用标为未知，不把请求次数当金额；图片不会自动成为新闻。 |
| [02 参考选择](02-reference-selected.png) | 图片区中段：已选参考、已有私有图片 | 从生成结果点击“用作参考”后预选同一本地文件；最多两张，支持移除。缩略图读取同源私有文件接口，不嵌入供应商链接。 |
| [03 取消上传](03-upload-cancel.png) | 上传控件下方的取消提示及文件选择框 | 实际限速上传后取消，文件仍被保留，可用原文件重试；本地上传不触发供应商请求。文件类型、体积、像素及单帧限制在控件旁说明。 |
| [04 预算等待](04-image-budget-wait.png) | 任务进度：等待原因、下一动作、下次尝试 | `redfox.image` 预算为 0 时，新生成提交在外发前等待；此轮未请求桩供应商，截图后通过正常放弃入口结束。 |
| [05 停止确认](05-image-stop-dialog.png) | 停止任务对话框 | 明示停止本地后续步骤、仍占用可恢复输入、不会取消远端生成或保证不计费；原因进入审计。已实际停止并恢复原 run。 |
| [06 异步进度](06-image-progress.png) | 任务进度上半部：30% 进度条、供应商任务 ID | 展示供应商最近返回的进度，ID 可带入已有任务查询。下方查询历史折叠，图片尚未保存时不显示伪完成。 |
| [07 图片结果](07-image-results.png) | 完成页：顶部任务 ID、两个图片结果及操作 | 从表单提交到 Worker 轮询、私有落盘、两图显示已跑通。完成后从保存的控制结果派生任务 ID，不增加状态字段；可查看、下载、复用参考和删除。 |
| [08 处理记录](08-image-history.png) | 结果页：展开“参考上传与生成查询记录” | 保留参考上传、提交和轮询记录；默认以产物为先，展开才挂载历史，避免大量轮询结果挡在图片之前。 |
| [09 删除受保护素材](09-delete-protected.png) | 删除对话框及错误提示 | 浏览器实际 DELETE 返回 409：另一活动/可恢复任务仍引用该文件。对话框保留，允许取消和处理占用；截图不是空 JSON 请求的 400。 |
| [10 删除后的历史](10-image-deleted.png) | 第一张图片结果的删除提示及第二张仍可用图片 | 通过正常业务放弃占用轮次后，第一张删除成功；该结果不再请求图片或提供下载/参考入口，第二张不受影响。结果历史和文件元数据继续保留。 |
| [11 已有任务查询](11-query-existing.png) | 独立查询表单的任务 ID | 从已完成任务带入原 ID，实际查询并保存两张结果；生成提交次数没有增加。查询与重新生成有明确不同的次数说明。 |
| [12 窄屏表单](12-image-form-narrow.png) | 390 px 全页 | 参数控件改为单列，上传和操作按钮可用，预算说明正常换行；实测 `innerWidth=scrollWidth=390`。 |

P2 前端验收中曾发现并修正两处缺漏：完成后任务 ID 丢失；无正文的 DELETE 错带 JSON Content-Type、被 Fastify 提前拒绝。后一处按监督规则由 Sol High 升级 Astra Medium，主代理重新验证了真实 409 和释放后的成功删除。截图均为修正后的对应状态。

## P3 平台查询、导入与订阅

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [13 平台查询](13-platform-query.png) | 平台查询工作区的操作选择与参数表单 | 首批为五项微博操作，参数由已接通的固定契约提供；数字身份保持字符串，页面 GET 不请求供应商。后续平台继续在此入口扩展。 |
| [14 账号结果](14-weibo-account-result.png) | 共同任务页的账号类型、完整 UID 与导入入口 | 查询已完成，账号结果没有冒充文章；诊断字段默认折叠。 |
| [15 账号本地导入](15-weibo-account-import.png) | 身份导入对话框的默认目标、固定 UID 与原因 | 默认按 UID 复用，否则新建隔离信源并关闭全文权限；已有 external 目标须显式核实。实际默认导入成功，没有再次请求供应商。 |
| [16 作品本地导入](16-weibo-work-imported.png) | 作品字段、原始时间、媒体链接及实际文章/信源入口 | 作者和原文不能被任意替换；实际入库日期为对应 UTC 时间，媒体已映射，数字/短 ID 指向同一文章，信源仍隔离。媒体只给安全链接，不自动嵌入远端资源。 |
| [17 搜索参数](17-weibo-search-form.png) | 关键词、搜索类别、字符串页码及可选认证类别 | 不暴露任意路径或 JSON 代理；可选空条件省略。账号整数页码和作品字符串页码分别按上游要求发送。 |
| [18 空页结果](18-weibo-empty-result.png) | 已完成状态及 0 项摘要 | 实际空页正常消费并结束，不因缺少结果行卡住，也不创建文章。 |
| [19 热搜研究结果](19-weibo-trend-result.png) | 研究快照标记、上游热度与时间 | 热搜没有文章或身份导入按钮，不把热词变成新闻。 |
| [20 新建订阅](20-weibo-subscription-new.png) | 默认启停、周期、页数/条数/详情上限和补全开关 | 默认停用、15 分钟，详情补全默认关闭；仅启用后进入采集调度。作品采集按真实作者归属，新作者隔离。 |
| [21 订阅预算等待](21-weibo-subscription-wait.png) | 等待原因、当前无回执和返回订阅链接 | `collect` 预算为 0 时外发前等待，保留同一订阅占用；任务页可回到具体订阅。 |
| [22 周期编辑影响](22-weibo-period-impact.png) | 在途任务链接、周期草稿与影响说明 | 实际只改周期后，原 run ID、占用和执行版本保持，未重新购买或重建轮次。 |
| [23 编辑冲突](23-weibo-edit-conflict.png) | 版本变化提示、保留的草稿和同步版本按钮 | 真实保存返回 409；名称与周期草稿保留。刷新仅更新服务端事实，管理员核对并同步版本后保存成功。 |
| [24 执行配置变化](24-weibo-execution-impact.png) | 查询草稿下方对旧任务的影响说明 | 改查询前明确会停止旧任务并解除该订阅占用，旧响应保留；没有额外审批流程。 |
| [25 失效旧轮次](25-weibo-fenced-run.png) | 停止原因、订阅回链和恢复限制 | 查询变更后旧 run 停止，恢复按钮实际禁用；不能把旧响应当成新配置继续执行。下一动作已对齐为“返回订阅，按当前配置运行新轮次”；本图为调整后重新经领域命令生成的合成旧轮次 #35，截图后正常放弃。 |
| [26 有界采集结果](26-weibo-collected-results.png) | 两页消费摘要、三条真实作者归属及文章链接 | 实际两页/三次详情补全结束；已有作品复用原文章 ID，两个作者分别归属各自隔离信源。 |
| [27 窄屏订阅](27-weibo-subscription-narrow.png) | 390 px 表单与列表 | 输入和操作改为单列；表格在自身容器横向滚动。实测 `innerWidth=scrollWidth=390`。 |
| [28 到期热搜订阅](28-weibo-scheduled-trend.png) | 定时采集任务及快照结果 | 实际由到期扫描创建 schedule 任务并完成，仅保存摘要与研究快照，无 article 关联。 |

微博验收使用的两个合成订阅已通过领域命令停用，采集/查询测试预算已关闭。以上均是 localhost 桩与独立测试库证据，未新增真实 Redfox 调用。公众号查询与导入的本地界面验收见下表；其余平台继续实施，不以微博截图代替其他平台验收。

## P1 共同采集入口与回执

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [29 信源编辑](29-source-edit.png) | 现有设置、右侧采集任务与供应商 | 权限继续归原信源；周期与采集状态读有效主订阅，显示当前供应商、订阅和在途任务入口。 |
| [30 能力预检](30-source-preflight.png) | 切换采集器卡片的结论和折叠诊断 | 仅检查当前查询实际需要的能力，使用本地配置、映射和已有回执；执行预检没有供应商调用。完整技术证据默认折叠。 |
| [31 切换影响](31-source-switch-dialog.png) | 同 source/subscription ID、历史权限、水位和在途计费说明 | 预检通过后仍显式展示影响和审计原因；截图时取消。此前同一合成信源的往返切换已实际验证，没有第二条有效采集配置。 |
| [32 新建草稿试抓](32-source-draft-preview.png) | 新建 X 表单和右侧持久任务链接 | 试抓返回任务 #23，输入保留，结果可在新标签查看；没有提前建立 source 或占用正式订阅。数据库已核实该草稿 source 不存在。 |
| [33 X 查询](33-x-query-workspace.png) | 账号名/稳定 ID 选择及推文详情输入 | 两项查询分别建任务，数字 ID 不经过浮点转换。保留已有 X 入口，与后续平台/创作工作区并列。 |
| [34 X 身份绑定](34-x-account-binding.png) | 稳定账号、明确匹配的原信源及确认原因 | 只允许完整单账号查询对应的候选，保留原参与方式和权限，绑定不自动切换供应商。本图取消；已有首次绑定和切换的运行证据保留。 |
| [35 草稿结果](35-source-draft-result.png) | 一次性任务的草稿标记与结果 | 结果只供预览，没有把不存在的草稿 source 渲染成详情链接，也没有正式采集占用。 |
| [36 共同任务列表](36-operation-list.png) | 供应商/中文操作、状态、等待原因与任务链接 | SocialData、大加辣及 Redfox 共用列表与结果/恢复入口，任务状态来自业务 run。 |
| [37 回执关联任务](37-runs-receipts.png) | 运行页的未知回执和关联任务列 | 本地桩实际断开请求，回执显示 unknown，并可跳回对应业务任务 #25；不把回执颜色当业务完成状态。 |
| [38 只读未知任务](38-readonly-unknown-run.png) | 未知原因、下一动作及下次尝试 | 首次未知的只读任务进入等待，显示 30 分钟后的尝试时间；没有立即重发。 |
| [39 人工核对](39-readonly-receipt-review.png) | 计费选择、再次计费提示与审计原因 | 实际通过 UI 放行该合成只读回执；测试预算先关闭，原 run 恢复后因预算等待，尝试次数仍为 1。随后正常放弃该轮，没有遗留可重发任务。 |
| [40 次数预算复用](40-settings-budgets.png) | 现有设置页中的九类 `redfox.*` 预算 | 复用原每分钟/小时/天限额和使用量；图中 Redfox 上限均为 0。画面上的使用量是合成测试调用，不是真实账户账单。没有新增预算设置系统。 |

## P3 公众号查询与本地导入

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [41 公众号表单](41-wechat-query-form.png) | 平台、17 项操作、三选一账号参数及费用说明 | 账号、作品、榜单及实时接口保留各自契约；优质/广域/T+1 标明，不自动换库。页面读取不请求供应商。 |
| [42 原文结果](42-wechat-work-result.png) | 作者两种 ID、正文文本折叠、原始时间与媒体链接 | 实时原文查询已由 API→Worker→共同结果页完成；原始 HTML 不执行，远程媒体不自动嵌入，未带时区的时间不冒充今日发表。 |
| [43 原文导入确认](43-wechat-work-import-dialog.png) | 已收到字段、归属与审计原因 | 不提供任意文章目标信源，作者随稳定身份绑定；操作只在本地提交，不隐式购买补全。 |
| [44 复用旧文章](44-wechat-work-reused.png) | 导入后的作者信源和原文章链接 | 实际复用原 MP source 与旧 article ID；旧归属与原时序保持，公众号主采集器未自动切换。 |
| [45 搜索参数](45-wechat-search-parameters.png) | offset=40、步长20、精确匹配 false、库排序提示 | 实际切换优质/广域操作后，各自草稿保留；run #31 冻结参数核对为 keyword=missing-fixture、offset=40、exactMatch=false，false 没被省略或变字符串。 |
| [46 缺项结果](46-wechat-work-missing.png) | 原文及作者身份缺项提示 | 供应商 workUuid 留作原操作定位，不能代替原文或稳定作者；结果可继续查看，不猜测入库。 |
| [47 人工补录](47-wechat-supplement-dialog.png) | 补原文、核实依据、审计原因 | 补入已核实长链接后，其 __biz 提供账号身份，无需再填备用 ID；收到字段不可替换，没有昵称自动匹配。 |
| [48 补录成功](48-wechat-supplement-imported.png) | 新作者与文章链接 | 实际新建 isolated / 禁止全文的 external source 并导入，未知发表时间按历史/回填处理；没有供应商外发。 |
| [49 已有账号目标](49-wechat-account-target.png) | explicit MP 候选、两种收到的 ID、长对话框 | external 与 MP 类型分开搜索；MP 匹配由服务端按 ghid 或明确 wxid 校验。对话框已限制视口高度并可内部滚动。 |
| [50 空候选阻断](50-wechat-candidate-empty.png) | 空列表、重选提示及保留的原因 | 先选择再搜索为空，确认实际未发导入请求；旧 sourceId 已清除。改回查询并重选后成功绑定。图为滚动到对话框底部的修正后状态。 |
| [51 绑定原信源](51-wechat-account-bound.png) | 绑定后原 MP source 链接 | 实际绑定原信源，两个 ID 唯一归属不变，权限和历史保持。 |
| [52 身份不足](52-wechat-account-unconfirmed.png) | 优质库账号结果及禁用按钮 | 未收到 wxId/bizInfo 时不能绑定；不拿展示微信号或昵称替代稳定身份，不隐式调用付费详情。 |
| [53 窄屏表单](53-wechat-form-narrow.png) | 390px 平台与参数表单 | 控件、库区别和费用说明可用，实测 innerWidth=scrollWidth=390。 |
| [54 热搜表单精简](54-weibo-trend-simplified.png) | 无参数热搜订阅配置 | 不再显示未使用的页数、材料条数或详情调用上限；保留固定研究快照语义。 |
| [55 窄屏长对话框](55-wechat-dialog-narrow.png) | 390px 对话框底部与确认/取消 | 对话框范围 top=12、bottom=832、viewport=844；内部滚动后确认按钮完整可见，页面无横向溢出。取消实测成功。 |

P3e 验收中修正两处缺漏：搜索为空仍提交旧选择；展开候选后长对话框超出视口。第二处按监督规则交 Astra Medium，仅为共用 ReasonDialog 增加高度限制和内部滚动。选择校验在公众号、微博两处实际复用，提交时核对当前页及候选类型；失败保留输入与原因。首次“关键词为空”的检查读到了隐藏订阅面板，后按可见控件及已存 run 输入核对，未当成产品缺陷。

本阶段新增合成 run #29–34 均已完成；补录新作者仍隔离。用于更新旧轮次截图的 #35 已正常放弃，订阅 #5 停用。Redfox 九类测试预算均已关闭，真实累计仍 3 次。当前共 55 张截图，其他平台和工具继续补充。

## P3 抖音查询与本地导入

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [56 抖音查询表单](56-douyin-query-form.png) | 平台选择、14项查询、广域账号关键词/分页 | 已接通接口驱动表单，优质/广域/T+1 保留差别；估价多数0.04、热门推荐及热门作品0.06元，实际实扣未知。 |
| [57 账号双ID](57-douyin-account-result.png) | 收到的UID和安全ID、账号类型与本地导入入口 | 两种身份保留完整字符串，不使用展示抖音号或未知secUid。账号结果与新闻作品分型。 |
| [58 账号导入确认](58-douyin-account-import.png) | 默认隔离目标、固定身份与审计原因 | 实际默认绑定同一新隔离external源、关闭全文，两类身份各自唯一；未自动创建采集订阅。 |
| [59 作品导入](59-douyin-work-imported.png) | 作品ID/链接ID、原文/媒体、安全日期说明、信源与文章链接 | 实际详情查询后导入，按已收到作者归属；原文为受支持iesdouyin/share/video，未带时区日期按未知时间回填。 |
| [60 缺作者补录](60-douyin-author-supplement.png) | 只补一种稳定作者ID、证据与审计原因 | 优质库结果没有稳定作者时不按昵称或展示号猜测；收到的作品ID和原文不可换。实际补录后仅本地提交。 |
| [61 跨地址复用](61-douyin-work-reused.png) | 优质库douyin/video与原文章链接 | 另一原生地址仍指向原article ID，没有新建重复作品或冗余URL alias；原信源与文章归属保持。 |
| [62 账号榜单](62-douyin-account-rank.png) | 研究类型、排名/日期与主页链接 | 实际保存账号推荐，页面没有文章导入或账号绑定按钮；主页/昵称不足以确认稳定身份。 |
| [63 AI结果待核实](63-douyin-ai-pending.png) | 泛化ID缺项、非原生地址说明与禁用导入 | AI photoId/authorId和example.com地址不当原生身份；不自动解析、换地址或购买详情。收到非原生地址时先显式核实。 |
| [64 窄屏结果](64-douyin-result-narrow.png) | 390px任务、两类作者ID、原文与材料链接 | 字符串可换行且保持完整，原文/文章链接可用，诊断折叠；实测页面宽度与滚动宽度均390。 |
| [65 窄屏表单](65-douyin-form-narrow.png) | 390px作品搜索、布尔与日期/分页输入 | 参数改单列，库差异提示正常换行；实测页面无横向溢出。 |

本阶段实际后台发起5次合成查询（run #36–40），均完成；三次本地绑定/导入未增加桩请求。账号两个ID归同一isolated源，原生作品主身份为douyin:aweme_id，未知发表时间带回填。UI前端22项定向测试、typecheck和构建通过，主代理实读截图并验收以上路径；不代表抖音定时采集、短链解析或其余平台已交付。九类Redfox测试预算已再次关闭，真实仍累计3次。截图累计65张。

## P3 小红书查询与本地导入

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [66 小红书表单](66-xiaohongshu-query-form.png) | 平台、11项操作、作品ID/链接二选一及费用说明 | 固定接口目录驱动参数表单；优质库/T+1及文档基价0.04–0.06元可见，未承诺实际实扣。 |
| [67 账号结果](67-xiaohongshu-account-result.png) | 稳定userId与展示小红书号 | 实际账号查询完成，完整字符串保留；展示号与稳定身份分开。 |
| [68 绑定已有信源](68-xiaohongshu-account-binding.png) | explicit external候选、固定身份、确认原因 | 实际选择已核实的隔离旧信源并绑定；不按昵称自动匹配，不自动建立采集订阅。 |
| [69 作品导入确认](69-xiaohongshu-work-import.png) | 已收到身份、带签名原文及审计原因 | 作品按真实作者绑定，不提供任意目标信源；本地导入不购买额外详情。 |
| [70 复用旧笔记](70-xiaohongshu-work-reused.png) | 作者信源与原文章链接 | 新旧签名参数不同仍复用原article ID；数据库核实原URL、归属和历史时间保持，没有增加URL别名。 |
| [71 洞察分型](71-xiaohongshu-insight-roles.png) | 主查询结果、上游推荐候选、研究卡片 | root对象响应已接通；两类作品各保留角色，话题/相关搜索/计数只作研究，无文章导入按钮。 |
| [72 人工采用推荐](72-xiaohongshu-recommendation-imported.png) | 推荐候选的信源/文章链接 | 实际人工导入推荐候选，结果和材料溯源保留provider_recommendation；研究卡片与未导入主结果不受影响。 |
| [73 补录ID不符](73-xiaohongshu-url-mismatch.png) | 错误提示、补充地址与保留的核实依据 | 已收到作品ID不可替换；补充链接ID不符时阻断提交，输入和原因保留。 |
| [74 原文补录](74-xiaohongshu-url-supplement.png) | 已纠正的原生笔记地址、证据与原因 | 缺失地址可人工补入并保留签名参数；图为纠正后尚未再次确认的状态，上一条校验提示尚在。 |
| [75 补录成功](75-xiaohongshu-supplement-imported.png) | 导入后作者及文章入口 | 实际纠正后提交成功；缺少可信时区的新材料标记历史回填，未当作今天发生。 |
| [76 身份不足的账号](76-xiaohongshu-unconfirmed-account.png) | 搜索结果展示号、缺项说明和禁用绑定 | 没有收到userId时不能人工补账号身份；需显式查询详情，不按展示号或昵称猜测。 |
| [77 AI结果待核实](77-xiaohongshu-ai-pending.png) | 泛化字段、非原生地址及禁用导入 | AI authorId/photoId与example.com地址不成为原生身份，不隐式换地址、解析或购买补全。 |
| [78 账号研究榜单](78-xiaohongshu-account-rank.png) | 榜单类型、缺失稳定作者提示 | 页面只作账号研究，没有文章导入或账号绑定动作。 |
| [79 窄屏结果](79-xiaohongshu-result-narrow.png) | 390px作品ID、原文与本地文章链接 | 不透明长串可换行，签名地址保持原串；实测innerWidth与scrollWidth均390。 |
| [80 窄屏表单](80-xiaohongshu-form-narrow.png) | 390px账号作品参数及日期/排序说明 | 表单改单列，日期两种文档格式和default排序待核实说明可见；页面无横向溢出。 |

本阶段主代理实际发起7次本地桩查询（run #41–47），全部完成；账号绑定、作品导入、推荐候选导入与补录没有增加供应商请求。旧笔记保持原article/source/URL及时间，新材料未知时间均回填；原信源仍隔离，研究结果没有变成文章。前端21项定向测试、typecheck和构建通过，主代理实读代表截图并验收上述路径。九类Redfox测试预算再次关闭；真实调用仍累计3次。本阶段不代表小红书定时采集、评论、转写或其余平台已交付，截图累计80张。

## P3 公众号主采集切换

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [81 默认广域预检](81-mp-wide-preflight.png) | 信源页选库、原周期、能力和权限结论 | 默认广域，预检仅本地读取；显示T+1、同库正文、时间回填、正常流程费用估算及次数预算。无成功回执的权限待核实，未额外探测。 |
| [82 改库使预检失效](82-mp-library-change-invalidates.png) | 优质库选择与失效状态 | 改库后旧预检不能直接提交，按钮禁用，须重新检查所选库。 |
| [83 广域切换确认](83-mp-wide-switch-dialog.png) | 选库、ID/周期/权限、延迟、计费和审计原因 | 实际确认后原source和订阅#2转Redfox广域，保持1440分钟周期；已发旧请求仍可能计费，不自动跨库或失败回退。 |
| [84 零预算等待](84-mp-collection-budget-wait.png) | 冻结广域、读取第一页步骤及等待原因 | 实际从原信源提交run #48，collect预算为0，在创建回执前等待；桩请求为0。 |
| [85 恢复原任务](85-mp-resume-original-run.png) | 停止后恢复确认及同一run编号 | 通过UI停止，开启仅本地桩预算后恢复同一#48；不重新创建采集配置，库和原周期保持。 |
| [86 广域采集完成](86-mp-wide-collection-completed.png) | 完成任务、文章/信源回链及第一页摘要 | 实际1次列表+1次正文，旧完整作品跳过，新材料进入原作者；不复制文章正文到结果，摘要不宣称覆盖全部历史。 |
| [87 同供应商换库](87-mp-same-provider-library-switch.png) | Redfox优质库的显式确认 | 当前为Redfox广域仍可预检并切到优质；提交固定所选库/版本，未把跨库UUID或分页当可移植进度。 |
| [88 优质采集完成](88-mp-premium-collection-completed.png) | 优质库、文章原文和作者依据 | 实际run #49经优质列表及同库详情完成；短原文没有返回稳定作者时，只在已核实账号的严格同库列表上下文内归属，不伪造bizInfo。 |
| [89 切回大加辣](89-mp-switch-back-dajiala.png) | 原生目标的影响与审计原因 | 实际显式切回同一主订阅，仍使用共用生命周期；不恢复旧调度写入器。原身份、权限与周期保持。 |
| [90 缺少身份阻断](90-mp-unbound-switch-blocked.png) | 合成未绑定公众号的预检原因与禁用按钮 | 缺少必需账号证据不能切到Redfox；没有用昵称匹配、付费探测或新建平行采集绕过。 |
| [91 窄屏信源页](91-mp-source-narrow.png) | 390px设置、选库、采集与最近条目 | 局部补grid子项min-width后，表格在自身容器横滚，页面不被撑宽；实测innerWidth=scrollWidth=390。 |
| [92 窄屏确认](92-mp-switch-dialog-narrow.png) | 390px对话框、原因及确认/取消 | 确认与取消完整可见，实测按钮底部约822px、视口844px；检查后实际取消，保持已切回的大加辣。 |

主代理实际完成广域→优质→大加辣的同源切换，run #48/#49均完成，共4次合成请求；预检、切换和本地写入未新增供应商调用。两个新材料正文有效，未知时区均回填，作者依据保留account-list-context；source、订阅#2、isolated/禁止全文及1440分钟保持。九类测试预算再次关闭，真实仍累计3次。原X页面另外复验仍显示X预检/Redfox与SocialData，不出现公众号库选项。

前端9项定向测试、typecheck/build通过；验收发现既有信源grid最小内容宽度使新MP入口在390px扩为656px，已仅给该页两列子容器增加min-w-0并通过类型检查，主代理重拍91/92核验修正，未改全站表格。P3k累计1处实质缺漏保留。这组截图验收时首次范围尚未确认，后续用户决定及补包证据见下；信源历史/健康汇总迁移尾部和其余平台继续实施。

## P3 公众号首次采集补充

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [93 首次预检](93-mp-first-import-preflight.png) | Redfox目标下的首次影响提示 | 实际未初始化合成订阅预检可切，醒目展示最多8条、全部标记历史回填及不模拟无时区7天过滤；大加辣目标不显示该策略，预检未请求桩。 |
| [94 首次确认](94-mp-first-import-confirmation.png) | 确认框顶部首次影响、T+1及原因 | 首次影响在提交前直接可见，实际经此入口切换原source/订阅#2，未新增配置或更改权限周期。 |
| [95 窄屏首次确认](95-mp-first-import-confirmation-narrow.png) | 390px提示、原因及确认/取消按钮 | innerWidth与scrollWidth均390，按钮底部812px、视口844px；提示完整换行，操作可见。 |
| [96 首次采集完成](96-mp-first-import-completed.png) | 同一任务#50、两个材料与第一页摘要 | 经常驻API/Worker实际完成1次列表、2次正文；已完整作品跳过，新鲜可信时间和无时区时间两个新增材料均为backfill=true、reason=first-import，保留原作者。 |
| [97 初始化后预检](97-mp-initialized-preflight.png) | 完成后的Redfox目标与已保存订阅 | 整轮完成才更新lastCheckedAt，再预检firstImport=false，首次影响消失；随后显式切回大加辣，同source/sub/权限/1440分钟保持。 |

首次运行最初因测试进程采集阀关闭而在外发前等待，桩次数为0；开启仅localhost采集阀后，经UI停止/恢复原#50完成，没有新建轮次，冻结首次策略保持。后端11项及类型检查、UI选择逻辑5项及web类型检查通过；主代理实读桌面/窄屏截图，材料与桩计数见隔离环境证据。全部九类预算再次关闭，真实累计仍3次。沿用项目统一first-import和新鲜度规则，不另建Redfox事件时间规则。截图累计97张。

## P3 TikTok查询与本地导入

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [98 用户搜索表单](98-tiktok-query-form.png) | 用户搜索表单 | 7项固定操作、字符串offset/count、文档基价与分页限制均可见。 |
| [99 双ID账号结果](99-tiktok-account-result.png) | 双ID账号结果 | 收到的userId与secUserId保持完整字符串；昵称/handle只作展示。 |
| [100 显式账号绑定](100-tiktok-account-binding.png) | 显式账号绑定 | 实际选择已核实旧external源，两个ID归同一source，隔离与禁止全文保持。 |
| [101 作品结果](101-tiktok-work-result.png) | 作品结果 | 原生作品ID、真实作者、Unix秒原串与UTC说明、正文及安全媒体链接分开显示。 |
| [102 本地导入确认](102-tiktok-work-import.png) | 本地导入确认 | 只按实际作者导入，不能任意指定目标或覆盖已收ID/地址；确认不再请求供应商。 |
| [103 旧作品复用](103-tiktok-work-reused.png) | 旧作品复用 | handle及分享参数变化仍关联ui-tiktok-legacy-article；数据库核实旧source/URL/identity/time保持，无冗余alias。 |
| [104 主页作品表单](104-tiktok-homepage-form.png) | 主页作品表单 | 只要求secUserId，未虚构接口不存在的分页参数。 |
| [105 主页作品结果](105-tiktok-homepage-result.png) | 主页作品结果 | 实际按收到作者呈现作品，未把请求昵称或handle视为身份。 |
| [106 视频搜索表单](106-tiktok-video-search-form.png) | 视频搜索表单 | 数量51仍作为文档字符串传递，未凭经验加50上限；排序与日期枚举来自固定契约。 |
| [107 视频搜索结果](107-tiktok-video-search-result.png) | 视频搜索结果 | 实际保存单次查询作品，不宣称已覆盖所有结果或自动完成分页。 |
| [108 话题作品表单](108-tiktok-topic-works-form.png) | 话题作品表单 | 大整数话题ID和游标以原字符串输入，不经浏览器Number舍入。 |
| [109 话题作品与游标](109-tiktok-topic-works-result.png) | 话题作品与游标 | nextCursor完整展示，hasMore与作品分开；不会自动把返回游标换成offset。 |
| [110 喜欢列表表单](110-tiktok-likes-form.png) | 喜欢列表表单 | 被查询收藏者与作品作者分开，游标字段遵守该接口契约。 |
| [111 喜欢列表结果](111-tiktok-likes-result.png) | 喜欢列表结果 | 返回真实authorData，不把收藏者当作者；后续实际导入复用原作者的旧作品。 |
| [112 话题搜索表单](112-tiktok-topic-search-form.png) | 话题搜索表单 | 关键词与整数offset按文档输入，不复用视频搜索字符串offset契约。 |
| [113 话题研究结果](113-tiktok-topic-research-result.png) | 话题研究结果 | 话题只展示研究统计和上游链接，无文章导入/账号绑定动作。 |
| [114 缺作者与原文](114-tiktok-missing-evidence.png) | 缺作者与原文 | 逐项说明缺失，不用昵称或媒体地址猜测，保留人工补证入口。 |
| [115 错误补证阻断](115-tiktok-supplement-id-mismatch.png) | 错误补证阻断 | 实际原生链接ID不符时阻断，已填作者、证据与原因保留；图已随提示局部修正更新。 |
| [116 补证导入成功](116-tiktok-supplement-imported.png) | 补证导入成功 | 纠正链接后实际导入，新增source默认isolated且无全文，未知时间回填；上游缺项仍作为原始记录保留。 |
| [117 窄屏补证提示与错误](117-tiktok-supplement-narrow.png) | 窄屏补证提示与错误 | 390px对话框已滚动到错误及确认区域；长URL提示局部断行，按钮可见，标题可向上滚动查看。图由#61仅查询复验替换，随后取消，未重复导入。 |
| [118 短链阻断](118-tiktok-short-link-blocked.png) | 短链阻断 | 收到短链只保留上游地址，不能覆盖成猜测的native地址，导入禁用且原因可见。 |
| [119 空页摘要](119-tiktok-empty-summary.png) | 空页摘要 | 实际空列表保存0项及返回游标，不创建材料或显示伪导入动作。 |
| [120 窄屏结果与分页](120-tiktok-result-narrow.png) | 窄屏结果与分页 | 390px作者/作品ID可换行，链接与游标可读，page宽度与scrollWidth均390；已移除瞬时Toast后重拍。 |
| [121 窄屏大整数表单](121-tiktok-form-narrow.png) | 窄屏大整数表单 | 390px话题ID与游标完整保留，单列表单和费用说明可用，无页面横向溢出。 |

主代理实际提交#51–60共10次本地查询，覆盖全部7项及缺项/短链/空页；4次账号或作品导入不增加外发，旧材料身份/归属/时间保持，补证新材料隔离且未知时间回填。发现长URL提示在窄屏被裁切，已仅对该hint加break-all，再以#61新增1次纯合成查询复验并取消导入；117已替换，累计11次桩查询。P3n累计1处实质漏项保留，UI29项相关测试及typecheck/build通过，局部修正后再次类型/构建检查通过。所有九类测试预算关闭，真实仍累计3次。截图累计121张；本阶段不代表TikTok定时采集、评论/关注或其余平台完成。

## P3 B站查询、绑定与本地导入

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [122 账号详情表单](122-bilibili-query-form.png) | 账号详情表单 | 完整MID字符串、五项固定操作和优质库T+1/.04元基价可见。 |
| [123 账号结果](123-bilibili-account-result.png) | 账号结果 | 稳定MID提供显式绑定；昵称及无时区最近发文时间仅展示。 |
| [124 绑定已有账号源](124-bilibili-account-binding.png) | 绑定已有账号源 | 实际选择核实过的ui-bilibili-legacy，原ID及隔离/无全文保持。 |
| [125 详情互斥输入](125-bilibili-detail-form.png) | 详情互斥输入 | BV与作品链接二选一，b23仅交显式详情请求核实。 |
| [126 可读校验错误](126-bilibili-detail-choice-error.png) | 可读校验错误 | 实际400阻断且不建run/不调用；修正共享JSON错误展示后重拍，输入保留、提示中文。 |
| [127 详情作品结果](127-bilibili-work-result.png) | 详情作品结果 | b23请求所得BV生成原生原文，真实MID/原始日期/封面分开。 |
| [128 旧材料复用](128-bilibili-work-reused.png) | 旧材料复用 | SQL核实关联旧文章且原source/URL/identity/时间/回填保持，无新增alias。 |
| [129 账号搜索表单](129-bilibili-account-search-form.png) | 账号搜索表单 | 必填字符串页码、关键词、每页和排序按契约输入。 |
| [130 账号搜索结果](130-bilibili-account-search-result.png) | 账号搜索结果 | 账号列表及单次分页事实保存，不宣称已采全部。 |
| [131 作品搜索表单](131-bilibili-work-search-form.png) | 作品搜索表单 | 字符串页码、布尔精准匹配与固定排序分开提交。 |
| [132 作品搜索结果](132-bilibili-work-search-result.png) | 作品搜索结果 | 真实MID归属，页码/每页/总数可读，无时区日期不伪装新鲜新闻。 |
| [133 账号作品表单](133-bilibili-account-works-form.png) | 账号作品表单 | 主页与MID二选一，此接口页码按整数提交。 |
| [134 外层MID作品结果](134-bilibili-account-works-result.png) | 外层MID作品结果 | 使用已收外层MID证明账号归属，不从昵称或封面推断。 |
| [135 账号作品导入](135-bilibili-account-work-imported.png) | 账号作品导入 | 实际复用绑定源，新作品未知时间回填。 |
| [136 缺BV/原文](136-bilibili-missing-original.png) | 缺BV/原文 | 保留上游缺项，可带核实依据补原生BV链接，不要求不存在的已收BV。 |
| [137 人工短链阻断](137-bilibili-short-supplement-rejected.png) | 人工短链阻断 | 实际补b23时阻断，已填证据和原因保留，不外发。 |
| [138 390px补证对话框](138-bilibili-supplement-narrow.png) | 390px补证对话框 | 标题、长hint、错误与确认按钮可见，页面/scrollWidth均390。 |
| [139 原文补证导入](139-bilibili-original-supplement-imported.png) | 原文补证导入 | 改核实native BV后导入，已收MID仍复用原源，原record不改写。 |
| [140 缺作者作品](140-bilibili-missing-author.png) | 缺作者作品 | 已知BV原文与缺作者分开展示，不按昵称绑定。 |
| [141 人工作者补证](141-bilibili-author-supplement.png) | 人工作者补证 | 只补缺失MID及依据，不提供任意目标或替换已收BV。 |
| [142 补作者后隔离](142-bilibili-author-supplement-imported.png) | 补作者后隔离 | 新作者源isolated且无全文、未知时间回填；原record仍不含authorId。 |
| [143 空搜索摘要](143-bilibili-empty-summary.png) | 空搜索摘要 | 实际0项保存，不创建材料或显示导入。 |
| [144 390px结果及摘要](144-bilibili-result-narrow.png) | 390px结果及摘要 | 长MID、链接、分页与已导入入口可用，无页面横向溢出。 |
| [145 390px账号作品表单](145-bilibili-form-narrow.png) | 390px账号作品表单 | 输入、整数页码、T+1/成本说明、提交按钮均在单列页面内，无横向溢出。 |

主代理实际UI#62–69共8次纯合成查询，覆盖5项及缺原文/缺作者/空页，5次本地绑定或导入。SQL核实旧材料归属/URL/身份/时间保持、无冗余alias，3条新材料均未知时间回填，新增作者隔离/无全文。截图后浏览器曾在页面底部点击坐标失准，观察后以聚焦按钮按Enter继续同一表单，未重复前两次查询，不计业务缺陷。P3p累计1处提示歧义已修；本轮共享校验错误JSON由lead局部格式化并补中文XOR，17项admin/B站测试和typecheck通过，126重拍。九类UI测试预算已关闭，此时主任务库/UI库均51项迁移至0054。截图累计145张，真实仍累计3次；不代表B站定时采集、评论或转写完成。

## P3 YouTube查询、显式补全与本地导入

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [146 搜索表单](146-youtube-search-form.png) | 搜索表单 | 两项固定操作、.06元文档基价与query预算可见；输入opaque token首尾空格在run中原样保留。 |
| [147 搜索结果](147-youtube-search-result.png) | 搜索结果 | 已收video/channelID、描述、相对日期原串、原生watch与缩略图分开；不把描述当字幕。 |
| [148 本地导入确认](148-youtube-local-import.png) | 本地导入确认 | 按真实channelID建隔离作者源，不能任选目标，导入不请求供应商。 |
| [149 旧材料复用](149-youtube-legacy-reused.png) | 旧材料复用 | 实际关联ui-youtube-legacy-article；原source/URL/identity/时间保持且无alias。 |
| [150 显式详情补全入口](150-youtube-explicit-detail-entry.png) | 显式详情补全入口 | 从已收同视频ID发起普通新查询，说明query费用、不改原结果且不自动导入。 |
| [151 补全详情结果](151-youtube-origin-detail-result.png) | 补全详情结果 | 详情只有handle时使用原搜索同视频已收频道证据，显示原结果引用；名称/handle不作为身份。 |
| [152 补全详情导入](152-youtube-origin-detail-imported.png) | 补全详情导入 | 实际导入新材料；SQL核实discoveredAt等于原搜索结果created_at，原搜索run终态和结果关联不改写。 |
| [153 详情表单](153-youtube-detail-form.png) | 详情表单 | 输入固定11位视频ID，不把频道handle当视频参数。 |
| [154 独立详情缺频道](154-youtube-handle-not-identity.png) | 独立详情缺频道 | 没有来源证据的独立详情仍明确缺稳定channelId，不能沿用handle猜作者。 |
| [155 频道人工补证](155-youtube-channel-supplement.png) | 频道人工补证 | 仅补缺失channelId及依据，带短横线的真实浏览器pattern可提交。 |
| [156 补频道后导入](156-youtube-channel-supplement-imported.png) | 补频道后导入 | 新增作者源isolated/无全文，未知日期回填；原始record保留缺失。 |
| [157 缺作品与作者](157-youtube-missing-original-and-channel.png) | 缺作品与作者 | 两类缺项逐项保留；没有已收videoID时显式详情按钮禁用，本地核实补录仍可用。 |
| [158 人工短链阻断](158-youtube-short-supplement-rejected.png) | 人工短链阻断 | 实际补youtu.be时错误保留原因和依据，不产生导入或外发。 |
| [159 390px补证上部](159-youtube-supplement-narrow.png) | 390px补证上部 | 顶部标题与长watch提示可读、无横向溢出；确认区需向下滚动，见165。 |
| [160 补齐原文后导入](160-youtube-missing-supplement-imported.png) | 补齐原文后导入 | 换核实native watch后实际导入，新作者隔离/无全文，未知时间回填。 |
| [161 空页及游标摘要](161-youtube-empty-summary.png) | 空页及游标摘要 | 实际0项仍保留返回token，不创建材料、不自动发下一页。 |
| [162 390px结果](162-youtube-result-narrow.png) | 390px结果 | 稳定ID、描述/日期、显式补全说明与长opaque token换行可读，页面/scrollWidth均390。 |
| [163 390px搜索表单](163-youtube-form-narrow.png) | 390px搜索表单 | 关键词/原始游标、费用说明与提交按钮均可用，无页面横向溢出。 |
| [164 非法视频ID](164-youtube-invalid-video-id.png) | 非法视频ID | 实际客户端阻断不满11位ID，保留输入并显示可纠正错误，不创建run或请求供应商。 |
| [165 390px补证确认区](165-youtube-supplement-narrow-footer.png) | 390px补证确认区 | 同一任务76仅复查对话框向下滚动后的错误、确认/取消；随后取消、不重复导入。 |

主代理实际从UI完成#70–75共6次合成查询、4次本地导入，覆盖搜索、独立详情、同作品显式补全、人工缺项、空页和客户端错误；原始token首尾空格保留。SQL核实旧文章归属/URL/身份/时间保持，无冗余alias；补全按原搜索发现时间保存，原搜索结果不被自动导入，三个新材料均未知时间回填且作者源隔离/无全文。另以#76增加1次纯合成查询复查窄屏滚动确认区，取消不导入，合计7次桩调用；浏览器跨调用仿真状态/自动点击滚动有差异，最终在同次390px设定下用浏览器DOM滚动核实、点击实际取消控件并重拍165，不计业务缺陷。P3q/P3r实质错误均0；后端14项专项+11项受影响材料回归、前端31项相关测试及typecheck/build通过。主任务库/UI库均52项至0055，九类UI预算已关闭，真实仍3次。累计165张截图，不代表YouTube定时采集/字幕转写或其余P3/P4/P5完成。

## P3 Instagram查询、显式补全与本地导入

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [166 账号双输入表单](166-instagram-account-form.png) | 账号双输入表单 | 用户名和userId同时输入被允许，按文档说明userId优先，完整数字串不舍入。 |
| [167 账号结果](167-instagram-account-result.png) | 账号结果 | 响应username与被忽略输入不同仍正常；稳定userId与显示名称分开。 |
| [168 账号显式绑定](168-instagram-account-binding.png) | 账号显式绑定 | 实际选核实过的ui-instagram-legacy，保留sourceID/隔离/无全文，不凭昵称合并。 |
| [169 帖子搜索表单](169-instagram-search-form.png) | 帖子搜索表单 | keyword及opaque paginationToken独立，首尾空格在run参数原样保留。 |
| [170 视频与轮播结果](170-instagram-video-and-carousel-result.png) | 视频与轮播结果 | caption正文、秒/ISO时间、reel原文、视频/缩略图及实际轮播子项分开；实际1项与上游reportedCount13分开。 |
| [171 旧帖子复用](171-instagram-legacy-reused.png) | 旧帖子复用 | reel链接与旧p链接同shortcode复用旧文章；SQL核实旧owner/URL/identity/时间保持，无alias。 |
| [172 显式详情补全入口](172-instagram-explicit-detail-entry.png) | 显式详情补全入口 | 按已收shortcode创建普通新查询，说明费用/预算，原结果不改写、不自动导入。 |
| [173 同帖作者上下文](173-instagram-origin-detail-result.png) | 同帖作者上下文 | 详情未返回user.id时可复用原搜索同帖userId，不靠username猜；显示来源结果引用。 |
| [174 补全结果本地导入](174-instagram-origin-detail-imported.png) | 补全结果本地导入 | 实际导入并保留原搜索created_at作为发现时间，原搜索结果仍未关联材料。 |
| [175 帖子详情表单](175-instagram-detail-form.png) | 帖子详情表单 | 接受shortcode或p/reel原文，费用与单次查询说明可见。 |
| [176 时间冲突原值](176-instagram-conflicting-times.png) | 时间冲突原值 | 收到秒时间与2001年ISO明显不一致，两原值保留供核查。 |
| [177 时间冲突入库](177-instagram-time-conflict-imported.png) | 时间冲突入库 | 实际入库published_at为空、未知时间回填，不将较新的字段当新鲜时间。 |
| [178 图片帖结果](178-instagram-image-post-result.png) | 图片帖结果 | feed/image按已收短码生成p原文，图片链接不是作品原文，不要求reel路径。 |
| [179 图片帖导入](179-instagram-image-post-imported.png) | 图片帖导入 | 实际保留一致可信秒/ISO发布时间，图片媒体映射；来源保持隔离/无全文。 |
| [180 缺作者与原文](180-instagram-missing-identity-and-original.png) | 缺作者与原文 | 原始缺项保留；无shortcode时详情按钮禁用，本地人工核实入口仍可用。 |
| [181 非帖子补证阻断](181-instagram-non-post-supplement-rejected.png) | 非帖子补证阻断 | 实际补Stories地址时阻断，作者/依据/原因保留，不导入或外发。 |
| [182 390px补证上部](182-instagram-supplement-narrow-top.png) | 390px补证上部 | 标题、两类缺项及长p/reel示例提示可读，无横向溢出；下部确认区见183。 |
| [183 390px补证确认区](183-instagram-supplement-narrow-footer.png) | 390px补证确认区 | 浏览器DOM滚动后错误及确认/取消在视口内，按钮底部812px；标题可向上滚动查看。 |
| [184 补证后隔离导入](184-instagram-missing-supplement-imported.png) | 补证后隔离导入 | 纠正为核实p原文后导入，新作者isolated/无全文；原record仍缺code/user.id，不篡改上游事实。 |
| [185 空页与上游数量](185-instagram-empty-summary.png) | 空页与上游数量 | 实际0项、reportedCount13分别显示，不误报已采13条，不创建材料或自动下一页。 |
| [186 390px结果与摘要](186-instagram-result-narrow.png) | 390px结果与摘要 | 长ID、轮播、显式补全、token和两种数量口径均可读，页面/scrollWidth均390。 |
| [187 390px账号表单](187-instagram-account-form-narrow.png) | 390px账号表单 | 双输入优先提示、完整ID、费用和提交入口可用，无页面横向溢出。 |
| [188 账号输入为空](188-instagram-empty-account-input.png) | 账号输入为空 | 两定位字段都空时实际客户端阻断，提示至少一项，不建run或请求供应商。 |

主代理实际UI#77–84共8次localhost查询，覆盖3项及图片/视频轮播/时间冲突/缺项/空页，完成6次本地绑定或导入。SQL核实旧材料归属/URL/identity/时间保持无alias；原发现时间冻结、原结果不自动导入；一致可信时间保留、冲突时间回填；新增作者隔离/无全文；原始opaque token首尾空格保留，实际1/0与上游13明确区分。P3s累计1处数量口径错误已修，P3t0；后端19项及共享YT11项、前端36项/typecheck/build通过。主任务库/UI库在本阶段均53项至0056，所有9类UI预算关闭，真实仍3次。累计188张截图，不代表Instagram评论/定时采集或其余P3/P4/P5完成。

## P3 视频号、快手只读查询检查点

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [189 视频号搜索表单](189-shipinhao-search-form.png) | 视频号搜索表单 | 5项固定操作；关键词、中文排序、页码、size、精准匹配与T+1/.04估价可见。 |
| [190 视频号账号表单](190-shipinhao-account-form.png) | 视频号账号表单 | 模糊账号名称、page/pageSize保留，不把名称当永久作者。 |
| [191 视频号详情表单](191-shipinhao-detail-form.png) | 视频号详情表单 | videoId原串输入，并提示详情未必回显；不拿请求值补作响应身份。 |
| [192 视频号账号作品表单](192-shipinhao-account-works-form.png) | 视频号账号作品表单 | 昵称精准匹配与分页输入可见；不据同名建立永久绑定。 |
| [193 视频号实时分享表单](193-shipinhao-share-form.png) | 视频号实时分享表单 | 固定weixin.qq.com/sph输入及实时/.06估价，未在本地解析短链。 |
| [194 快手账号表单](194-kuaishou-account-form.png) | 快手账号表单 | 4项固定操作；accountName与pageSize输入，T+1/.04和单次查询说明可见。 |
| [195 快手定位参数表单](195-kuaishou-account-works-form.png) | 快手定位参数表单 | 展示号与主页定位ID恰填一个；不同参数命名和页大小保留。 |
| [196 快手详情表单](196-kuaishou-detail-form.png) | 快手详情表单 | opaque photoId完整原串，不强制数字、不舍入。 |
| [197 快手作品搜索表单](197-kuaishou-search-form.png) | 快手作品搜索表单 | 关键词、page/size及中文排序保留，默认值按文档发送。 |
| [198 视频号作品与分页](198-shipinhao-work-result.png) | 视频号作品与分页 | 实际1项、上游total12、page2/size5分别显示；昵称、videoId、媒体及缺项不混为作者/原文。 |
| [199 视频号账号结果](199-shipinhao-account-result.png) | 视频号账号结果 | nickname/findName按已收字段展示；账号缺稳定身份，不显示自动绑定动作。 |
| [200 视频号详情缺回显ID](200-shipinhao-detail-missing-response-id.png) | 视频号详情缺回显ID | 请求videoId与响应未提供分开，保留未知时间和时长原串，不造已收身份。 |
| [201 视频号错误输入](201-shipinhao-invalid-share-input.png) | 视频号错误输入 | 实际非支持域名在客户端阻断，保留输入；桩计数不增加。 |
| [202 视频号实时分享结果](202-shipinhao-share-export-id.png) | 视频号实时分享结果 | exportId独立展示；分享地址只标查询输入，CDN只标媒体，不自动等同videoId/原文。 |
| [203 视频号昵称列表](203-shipinhao-nickname-work-list.png) | 视频号昵称列表 | 实际精准昵称列表查询完成，只保存本次已收页事实，不凭昵称永久绑定作者。 |
| [204 视频号空页](204-shipinhao-empty-summary.png) | 视频号空页 | 实际0项与上游total12并列，未创建材料或自动翻页。 |
| [205 快手账号结果](205-kuaishou-account-result.png) | 快手账号结果 | 响应kwaiId是账号展示定位信息；与昵称分开，不补造稳定UID。 |
| [206 快手定位参数冲突](206-kuaishou-locator-choice-error.png) | 快手定位参数冲突 | 实际双填被客户端阻断，输入保留且桩计数不增加；清除一个后可提交。 |
| [207 快手账号作品结果](207-kuaishou-account-work-result.png) | 快手账号作品结果 | 响应photoId完整保留；57000标为毫秒；缺total/hasMore不造0或无更多。 |
| [208 快手详情缺回显ID](208-kuaishou-detail-missing-response-id.png) | 快手详情缺回显ID | 只展示请求photoId作为输入，响应workId仍为空，不用昵称猜作者。 |
| [209 快手作品搜索结果](209-kuaishou-search-result.png) | 快手作品搜索结果 | 实际1项与上游total25分开；媒体仅链接，无主动图片/视频读取。 |
| [210 快手空页](210-kuaishou-empty-summary.png) | 快手空页 | 实际0项仍保留total25，未生成文章或发起下一页。 |
| [211 390px视频号结果](211-shipinhao-result-narrow.png) | 390px视频号结果 | 长ID、媒体/原文边界、缺项及分页摘要可读，页面/scrollWidth均390。 |
| [212 390px快手表单](212-kuaishou-form-narrow.png) | 390px快手表单 | 恰一定位输入、解释、分页、费用和提交入口完整可用，页面无横向溢出。 |
| [213 390px快手结果](213-kuaishou-result-narrow.png) | 390px快手结果 | opaque ID、毫秒时长、缺项与实际/上游数量换行可读，页面/scrollWidth均390。 |

主代理实际从UI提交#85–95共11次localhost合成查询，覆盖两平台9项操作及各一空页。SQL及桩请求体核实中文排序、true布尔值、page/pageSize/size与opaque ID按冻结输入发送，11个回执均完成且各1次attempt；所有结果未关联source/article，本检查点未做导入。错误输入两次均客户端阻断，媒体只作链接，桩未收到任何媒体抓取。P3u/P3v/P3w实质错误均0；前端34项定向测试/typecheck/build通过。0058已在主任务库/UI库应用至55项，UI九类预算关闭，真实仍3次。累计213张截图。人工导入与已核实账号上下文、定时采集、转写等仍未完成，不能把此查询检查点当作整个平台交付。

## P3 今日头条查询、显式详情与本地导入

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [214 账号搜索表单](214-toutiao-account-form.png) | 账号与翻页输入 | 4项固定操作；账号offset/searchId原始字符串独立，不把数字uid当主页token。 |
| [215 账号结果](215-toutiao-account-result.png) | 账号和分页摘要 | 实收uid、昵称和账号主页分开，false与opaque分页保留；账号查询无code/data的文档响应可正常完成。 |
| [216 旧作者信源绑定](216-toutiao-account-binding.png) | 显式候选选择 | 实际搜索并选择ui-toutiao-legacy，确认同一作者后绑定实收uid，保留隔离与全文权限。 |
| [217 作品搜索表单](217-toutiao-search-form.png) | 首次offset | 首次预填字符串0，按文档每页加1，不自动翻页。 |
| [218 搜索作品结果](218-toutiao-search-work-result.png) | 身份、秒时间与逐项分页 | 实收opusId/uid、原生a链接、秒时间分别展示；pageCount/hasNext属于本项，不冒充整页hasMore。 |
| [219 旧材料复用](219-toutiao-legacy-work-reused.png) | 文章与作者链接 | 实际导入复用旧文章；作者发现来源与文章原归属分别保留，SQL核实原URL/身份/时间未改，无新增alias。 |
| [220 显式详情入口](220-toutiao-explicit-detail-entry.png) | 同作品补全动作 | 使用已收作品ID创建普通新查询，费用和query预算说明可见，原结果不自动导入。 |
| [221 同作品详情结果](221-toutiao-origin-detail-result.png) | 详情身份与来源引用 | 详情未收到作者ID时只使用已核验同作品上下文；false、0和未注明时区的原串保留。 |
| [222 补全后导入](222-toutiao-origin-detail-imported.png) | 本地材料关联 | 实际导入正文与媒体链接；SQL核实发现时间等于原搜索结果created_at，原搜索run/结果未重开或导入。 |
| [223 账号作品表单](223-toutiao-account-works-form.png) | 分类、token与offset | 六种文档分类独立，主页token不代入uid，offset按字符串。 |
| [224 账号作品与大整数游标](224-toutiao-account-works-result.png) | secUid、时长与分页 | 实收secUid不和uid互换，57明确为秒；超安全整数的offset完整保留为900719925474099312345。 |
| [225 人工关联隔离作者](225-toutiao-secuid-manual-association.png) | 既有隔离目标及依据 | 选择同一作者的隔离external并填写证据，不按token或昵称自动绑定两种身份。 |
| [226 列表作品导入](226-toutiao-account-work-imported.png) | 文章与作者关联 | 实际导入，SQL核实uid/secUid指向同一隔离信源、未知时间回填；既有权限未提高。 |
| [227 独立详情表单](227-toutiao-independent-detail-form.png) | opusId输入 | 请求作品ID仅作请求定位，不在响应缺失时冒充已收身份。 |
| [228 详情缺少回显](228-toutiao-detail-missing-response-fields.png) | 响应字段与请求字段 | 缺workId/原文/作者明确显示，保留已收正文、false与0，允许人工补证。 |
| [229 原文作品不符阻断](229-toutiao-wrong-work-supplement-rejected.png) | 补证错误与输入保留 | 实际补另一作品ID时客户端阻断，保留作者、原文和依据，无供应商外发。 |
| [230 390px补证上部](230-toutiao-supplement-narrow-top.png) | 标题与身份/原文控件 | 重新复核的#104，dialog top12/bottom832、宽366px；长原文提示正常断行，下部可滚动。 |
| [231 390px补证确认区](231-toutiao-supplement-narrow-footer.png) | 错误、原因及操作区 | 滚动后错误可读，确认/取消位于视口内；仿真原生点击有工具投射偏差，取消逻辑以浏览器DOM点击核实。 |
| [232 详情人工补证导入](232-toutiao-detail-manual-imported.png) | 缺项纠正后本地导入 | 纠正为请求作品后实际导入，原record仍无workId/原文；新作者隔离、无全文、未知时间回填。 |
| [233 搜索缺项](233-toutiao-search-missing-fields.png) | 无作品ID/原文/作者 | 不能发起同作品详情，允许核实原文和作者后本地导入，不凭昵称生成身份。 |
| [234 搜索人工补证](234-toutiao-search-manual-supplement.png) | 原文与作者证据 | 填写核实原文、数字uid和对应关系依据；不覆盖收到的字段。 |
| [235 搜索补证后导入](235-toutiao-search-manual-imported.png) | 新材料关联 | 实际导入并保留该查询结果的发现时间；SQL核实隔离/无全文/未知时间回填。 |
| [236 空页](236-toutiao-empty-summary.png) | 实际数量与后续动作 | 实际0项，不创建材料或自动下一页；截图按真实#103重拍，未重复查询。 |
| [237 390px账号作品表单](237-toutiao-account-works-form-narrow.png) | 分类、token与提交 | 参数、限制与费用可读，页面与scrollWidth均390，首次offset为0。 |
| [238 390px作品结果](238-toutiao-work-result-narrow.png) | 长ID与分页摘要 | 完整secUid/作品ID、大整数游标、媒体和补全入口正常换行，无页面横向溢出。 |
| [239 窄屏复核独立查询](239-toutiao-narrow-review-query.png) | 额外合成详情结果 | #104为补证布局/取消复核增加1次合成查询，不导入、不重复生成文章。 |
| [240 窄屏取消后](240-toutiao-narrow-cancelled.png) | 对话框关闭与结果保留 | 浏览器DOM取消后回到原结果；数据库确认#104仍无source/article关联，无新请求。 |

主代理UI#96–104共9次localhost合成查询、6次本地绑定或导入，覆盖4操作、旧材料、显式补全、缺项和空页；新增4材料。SQL及桩请求体核实原始游标首尾空格、字符串offset、无媒体抓取、回执各1次attempt、旧文章归属/URL/identity/时间不变且无alias、origin与直接导入发现时间保留、新作者隔离/无全文。P3aa前端48项/typecheck/build通过，本阶段产品实质错误0。截图脚本一次并行操作造成空页任务号和截图混淆，已依据持久记录纠正并重拍236；不计产品缺陷。设备仿真输入投射未命中可见按钮，布局按实际DOM边界及截图核实、取消事件用DOM点击验证，不声称已完成真实手机触控验证。230/231已重拍。全部9类UI预算关闭，真实仍3次；累计240张截图，尚不代表头条定时、评论或其余P3/P4/P5完成。

## P5 回执诊断收尾

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [241 当前回执响应保留](241-receipt-current-attempt-retained-response.png) | 任务详情下方“响应已保留” | 本地API重载后，#104当前attempt正确显示“是”；主raw在receipts.response，历史尝试仅依据自己的raw。预算全部关闭，读取既有记录没有供应商请求。 |

此项复用既有诊断表，无新字段状态或业务表；42个不同后端定向测试覆盖当前/历史attempt归属、八平台延迟导入与微博逐页发现时间。累计241张截图。

## P3ad 视频号 / 快手逐项人工导入

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [242 视频号作品动作](242-shipinhao-manual-work-actions.png) | 作品下方操作 | 显式详情与逐项导入各自触发，查询不自动导入或绑定。 |
| [243 视频号人工导入](243-shipinhao-manual-import-dialog.png) | 作者、原文和核实依据 | 必选隔离 external，必填本项关系证据与原因，不按昵称生成作者。 |
| [244 隔离作者草稿](244-isolated-author-source-preset.png) | 现有新建信源表单 | 新标签页预选 external / isolated，关闭一手与两种全文权限；名称和 ID 由管理员填写。 |
| [245 隔离作者已创建](245-isolated-author-source-created.png) | 信源详情 | 明确创建后得到普通信源；原结果表单仍保留，须返回搜索再选择。 |
| [246 视频号媒体原文被拒](246-shipinhao-media-original-rejected.png) | 原文输入和错误 | CDN 不是原文；客户端拦截并保留作者、证据和原因，不请求供应商。 |
| [247 视频号复用旧文章](247-shipinhao-manual-legacy-reused.png) | 作者与文章关联 | 结果记录本次人工目标，已存在文章保留原归属；SQL 核实正文、URL、身份和时间未改。 |
| [248 视频号原搜索](248-shipinhao-origin-search.png) | 已收到的 videoId | 点击详情只用本项实际收到的 ID；原结果不自动导入。 |
| [249 视频号详情来源](249-shipinhao-detail-origin.png) | 缺失字段、请求及来源结果 | 详情未回显 ID，仍保留缺失事实；请求 ID 与原结果引用分开。 |
| [250 视频号详情导入](250-shipinhao-detail-manual-import.png) | 本地导入后关联 | 明确核实原文和作者后导入；SQL 核实沿用 #106 原结果发现时间，未知发表时间回填。 |
| [251 实时分享详情](251-shipinhao-share-detail.png) | exportId 与查询输入 | exportId 不当作 videoId；分享输入不冒充响应原文，不显示同作品详情动作。 |
| [252 分享错配保留草稿](252-shipinhao-share-mismatch-rejected.png) | 错误作品原文和表单 | 换成其他分享作品被服务端拒绝，草稿保留；截图保留拒绝后状态，短暂 toast 未留在此图。 |
| [253 分享详情复用旧文](253-shipinhao-share-legacy-reused.png) | 纠正后的文章关联 | 改回本次输入作品后导入成功，仍是旧文章和旧归属。 |
| [254 快手账号只读](254-kuaishou-account-readonly.png) | 账号身份和动作 | 展示号不是永久作者 ID，账号结果无人工导入或永久绑定按钮。 |
| [255 快手作品动作](255-kuaishou-manual-work-actions.png) | photoId 与人工操作 | opaque photoId 保留原串，不转换为原生路径 ID。 |
| [256 快手隔离作者草稿](256-kuaishou-author-source-preset.png) | 复用的新建页 | 第二个平台复用同一现有信源创建入口，无平台专属作者表单。 |
| [257 快手隔离作者已建](257-kuaishou-author-source-created.png) | 信源权限 | 新作者隔离、非一手、无全文，数据库已核实。 |
| [258 快手主页原文被拒](258-kuaishou-profile-original-rejected.png) | 原文校验 | profile 地址不能作为作品原文；保留已填作者和证据。 |
| [259 快手复用旧文章](259-kuaishou-manual-legacy-reused.png) | 导入后的关联 | 原生作品路径与供应商 photoId 不同，依据人工核实导入；旧文章保持原归属、正文和时间，无身份别名。 |
| [260 快手原搜索](260-kuaishou-origin-search.png) | 已收 photoId | 显式详情创建新查询，原搜索结果不改写或导入。 |
| [261 快手详情来源](261-kuaishou-detail-origin.png) | 请求 ID / 缺失响应 ID / 来源结果 | 详情缺少 photoId 不造回显身份；来源仅保留最小同作品引用。 |
| [262 快手详情导入](262-kuaishou-detail-manual-import.png) | 本地关联 | 新材料沿用 #111 原搜索发现时间、未知发表时间回填，媒体只存引用。 |
| [263 390px 人工导入顶部](263-manual-work-dialog-narrow-top.png) | 说明、信源与原文 | 共用对话框宽 366px，页面宽 390px；等待布局稳定后重拍，长说明正常换行。 |
| [264 390px 人工导入底部](264-manual-work-dialog-narrow-footer.png) | 证据、原因与确认区 | 表单可滚动，确认 / 取消在视口内；取消用 DOM 点击验证，不声称真实手机触控已实测。 |
| [265 390px 隔离草稿](265-isolated-source-preset-narrow.png) | 新提示与现有创建表单 | 提示和字段可读，页面 scrollWidth 为 390，无横向溢出。 |

主代理实际 UI #105–112 共 8 次 localhost 合成查询、5 次本地人工导入、2 次 UI 明确创建信源，新增 2 条材料。持久证据核实两条旧文章字段不变、同作品详情沿用准确原发现时间、原结果无导入关联、新来源隔离且无全文、无永久账号绑定和身份别名；8 张回执各一次 attempt，桩记录无媒体读取。后端 40 项与前端 45 项定向测试、typecheck/build 证据保留，P3ac/ad 产品实质错误均 0。验收脚本两处误用表单标签 / 英文服务端错误的等待文字、一处证据列名误写已纠正，均未引发重复查询或产品修改；窄屏首图布局未稳定后已重拍。9 类 UI 预算已关闭，真实累计仍 3 次。累计 265 张截图；正式账号作用域采集及其他阶段仍未完成。

## P3ae 五平台 19 项只读查询

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [266 汽车之家搜索表单](266-qichezhijia-CI7VW144-form.png) | 固定接口 CI7VW144 · 表单 | offset 为字符串 0、page 为字符串 1，club/article/video 保留范围。 |
| [267 汽车之家搜索结果](267-qichezhijia-CI7VW144-result.png) | 固定接口 CI7VW144 · 结果 | workType=14 与 sourceType=club 分别保存，实际条数不猜总量。 |
| [268 汽车之家文章详情表单](268-qichezhijia-LLCI8QTE-form.png) | 固定接口 LLCI8QTE · 表单 | 作品 ID 与整数 page=0 显式提交，字段起点按本接口。 |
| [269 汽车之家文章详情结果](269-qichezhijia-LLCI8QTE-result.png) | 固定接口 LLCI8QTE · 结果 | 响应作品与请求定位分开；HTML 正文按纯文本展示。 |
| [270 汽车之家视频详情表单](270-qichezhijia-TE6AGWAF-form.png) | 固定接口 TE6AGWAF · 表单 | videoType=0 与 4 的用途由接口提示说明，不自动互换。 |
| [271 汽车之家视频详情结果](271-qichezhijia-TE6AGWAF-result.png) | 固定接口 TE6AGWAF · 结果 | 原生候选地址、视频时长秒数与媒体封面分别展示，无主动媒体读取。 |
| [272 汽车之家作品列表表单](272-qichezhijia-4BOZ9DLE-form.png) | 固定接口 4BOZ9DLE · 表单 | 作者 ID 和整数页码显式填写，不复用其他操作范围。 |
| [273 汽车之家作品列表结果](273-qichezhijia-4BOZ9DLE-result.png) | 固定接口 4BOZ9DLE · 结果 | 实际返回 1 与上游 total 字符串 25 分开。 |
| [274 懂车帝作品搜索表单](274-dongchedi-W86F8SSK-form.png) | 固定接口 W86F8SSK · 表单 | sourceType 采用本接口 1/2 编码，offset 保持字符串。 |
| [275 懂车帝作品搜索结果](275-dongchedi-W86F8SSK-result.png) | 固定接口 W86F8SSK · 结果 | hasMore 字符串 0 保留；相对协议 URL 只作文本，不补协议或抓取。 |
| [276 懂车帝详情表单](276-dongchedi-QQ5E3EZ9-form.png) | 固定接口 QQ5E3EZ9 · 表单 | 请求 workType=video 明确保存。 |
| [277 懂车帝详情结果](277-dongchedi-QQ5E3EZ9-result.png) | 固定接口 QQ5E3EZ9 · 结果 | 响应 workType=1 与请求类型冲突有提示，不擅自覆盖。 |
| [278 懂车帝用户搜索表单](278-dongchedi-X16I71WV-form.png) | 固定接口 X16I71WV · 表单 | 整数 offset=0 与字符串偏移接口区分。 |
| [279 懂车帝用户搜索结果](279-dongchedi-X16I71WV-result.png) | 固定接口 X16I71WV · 结果 | 超大 userId 和 offset 原始整数词法保存为完整字符串，hasMore 数字 0 保留。 |
| [280 懂车帝账号作品表单](280-dongchedi-API_1791793668086-form.png) | 固定接口 API_1791793668086 · 表单 | 仅请求账号范围 userId，不替本条作品填写作者。 |
| [281 懂车帝账号作品结果](281-dongchedi-API_1791793668086-result.png) | 固定接口 API_1791793668086 · 结果 | 外层账号单独展示，缺作者作品仍缺；summary 为 1 账号+1作品，共2项。 |
| [282 易车视频详情表单](282-yiche-3BXWEB6Y-form.png) | 固定接口 3BXWEB6Y · 表单 | 作品 ID 独立查询，不按其他汽车平台的同名 ID 合并。 |
| [283 易车视频详情结果](283-yiche-3BXWEB6Y-result.png) | 固定接口 3BXWEB6Y · 结果 | 嵌套 authorInfo 分开；非法原文不生成链接，resources 仅提供安全下载链接。 |
| [284 易车账号搜索表单](284-yiche-9KFOB9M2-form.png) | 固定接口 9KFOB9M2 · 表单 | 关键词与整数页码明确填写。 |
| [285 易车账号搜索结果](285-yiche-9KFOB9M2-result.png) | 固定接口 9KFOB9M2 · 结果 | 账号结果按收到的 userId 展示，页码回显不造下一页。 |
| [286 易车全部作品表单](286-yiche-YGYYT0G0-form.png) | 固定接口 YGYYT0G0 · 表单 | 首页 timestamp 留空，下一页要求原始 publishTime，不补当前时间。 |
| [287 易车全部作品结果](287-yiche-YGYYT0G0-result.png) | 固定接口 YGYYT0G0 · 结果 | publishTime 和 duration 分别标毫秒，57000 未误标成秒。 |
| [288 易车作品搜索表单](288-yiche-YIGCY5US-form.png) | 固定接口 YIGCY5US · 表单 | shipin 编码按本接口发送，不替换为 video。 |
| [289 易车作品搜索结果](289-yiche-YIGCY5US-result.png) | 固定接口 YIGCY5US · 结果 | workType 与 sourceType 单独保存，无时区发布时间保留原串。 |
| [290 易车文章详情表单](290-yiche-VYSP68M2-form.png) | 固定接口 VYSP68M2 · 表单 | 明确 URL 查询，不隐式抓网页补全。 |
| [291 易车文章详情结果](291-yiche-VYSP68M2-result.png) | 固定接口 VYSP68M2 · 结果 | 响应 contentType=21、正文及原文候选分别展示。 |
| [292 百家号图文表单](292-baijiahao-API_1789097000710-form.png) | 固定接口 API_1789097000710 · 表单 | articleId 只定位本次文章详情。 |
| [293 百家号图文结果](293-baijiahao-API_1789097000710-result.png) | 固定接口 API_1789097000710 · 结果 | uid 与作品 opusId 保留范围；HTML 纯文本查看，图片只为链接。 |
| [294 百家号视频表单](294-baijiahao-API_1789097000761-form.png) | 固定接口 API_1789097000761 · 表单 | svId 与文章 ID 范围区分。 |
| [295 百家号视频结果](295-baijiahao-API_1789097000761-result.png) | 固定接口 API_1789097000761 · 结果 | 响应 url 为作者主页、playUrl 为媒体，均不补作缺失的作品原文。 |
| [296 百家号账号表单](296-baijiahao-API_1789097000814-form.png) | 固定接口 API_1789097000814 · 表单 | 输入 uk 单独保存，不当作已收到的 uid。 |
| [297 百家号账号结果](297-baijiahao-API_1789097000814-result.png) | 固定接口 API_1789097000814 · 结果 | 响应 uid/secUid 分开展示，不生成跨类型永久映射。 |
| [298 百家号作品搜索表单](298-baijiahao-API_1789097000858-form.png) | 固定接口 API_1789097000858 · 表单 | 参数准确使用 keyWord、pn 字符串和排序编码。 |
| [299 百家号作品搜索结果](299-baijiahao-API_1789097000858-result.png) | 固定接口 API_1789097000858 · 结果 | “昨天”保留原串，不按查询日期换算；缺作者提示保留。 |
| [300 百家号账号搜索表单](300-baijiahao-API_1789097000885-form.png) | 固定接口 API_1789097000885 · 表单 | page 的首尾空格和 opaque 原串保留。 |
| [301 百家号账号搜索结果](301-baijiahao-API_1789097000885-result.png) | 固定接口 API_1789097000885 · 结果 | next page 原串及 hasMore=false 分开展示，不自动下一页。 |
| [302 知乎作品搜索表单](302-zhihu-API_1789095347662-form.png) | 固定接口 API_1789095347662 · 表单 | 实际发送 keword 拼写与 zvide 枚举，不能按常见拼写猜改。 |
| [303 知乎作品搜索结果](303-zhihu-API_1789095347662-result.png) | 固定接口 API_1789095347662 · 结果 | 十位时间戳单位未知，单项 isEnd=false 不冒充整页状态；不由 ID 猜原文。 |
| [304 汽车之家空页](304-qichezhijia-empty-result.png) | 汽车之家空页 | 实际返回0项，仅写消费摘要，不创建文章或自动翻页。 |
| [305 390px账号搜索表单](305-baijiahao-account-form-narrow.png) | 390px账号搜索表单 | 分页原串、提示与提交按钮正常换行，scrollWidth=390。 |
| [306 390px账号及分页结果](306-baijiahao-account-result-narrow.png) | 390px账号及分页结果 | 身份字段、opaque page 与 false 可读，无横向溢出。 |
| [307 390px易车单位](307-yiche-duration-result-narrow.png) | 390px易车单位 | 长标识与毫秒标签正常换行，页面宽390。 |
| [308 390px知乎作品与缺项](308-zhihu-result-narrow.png) | 390px知乎作品与缺项 | 范围、未知时间单位、单项isEnd和缺原文提示可读，页面宽390。 |
| [309 冻结参数诊断展开](309-baijiahao-frozen-parameters.png) | 冻结参数诊断展开 | 展开现有详情区域，准确显示首尾空格page；读记录不产生供应商请求。 |

主代理 UI #113–132 共20次localhost桩查询，覆盖19个唯一接口及1个空页；全部任务完成、回执各一次attempt，0导入、0自动账号关联。SQL与实际桩请求体核实分页字符串 / 整数区别、opaque page首尾空白、易车空timestamp、超大整数词法、false / 0 / 字符串0及操作身份范围；没有媒体读取。60项前端定向回归、typecheck/build证据保留，P3ab/P3ae实质错误0。lead首轮误填搜索page0被拒绝（未建run或外发），已按提示从1开始；证据脚本将知乎缺失url误断言null已改按undefined核实。9类UI预算关闭，真实仍3次。累计309张截图，五平台导入 / 正式采集及其他阶段仍待完成。

## P3ag X 研究、热点与账户只读快照

| 图 | 页面 / 批注区域 | 观察与验收 |
| --- | --- | --- |
| [310 X评论表单](310-x-research-ABJQXHUE-form.png) | ABJQXHUE · 表单 | 推文ID与原始cursor输入，查询不会自动成为材料。 |
| [311 X评论结果](311-x-research-ABJQXHUE-result.png) | ABJQXHUE · 结果 | 根推文与两条回复分角色、分作者；count=3，replyCount=2，不把根作者赋给评论。 |
| [312 X搜索表单](312-x-research-5K5EG87P-form.png) | 5K5EG87P · 表单 | 搜索类型Latest显式选择，提示高级表达式兼容性未证实。 |
| [313 X搜索结果](313-x-research-5K5EG87P-result.png) | 5K5EG87P · 结果 | 真实user.userId与推文ID保留，nextCursor原串不按竖线拆分。 |
| [314 X热门账号表单](314-x-research-API_1790063277084-form.png) | API_1790063277084 · 表单 | 日期可省、页码默认1、分类和性别采用接口定义。 |
| [315 X热门账号结果](315-x-research-API_1790063277084-result.png) | API_1790063277084 · 结果 | 完整粉丝数大整数、评分0、增长、日期和简介已补主视图；无稳定ID不自动绑定，图片仅链接。 |
| [316 X关注列表表单](316-x-research-5QY3G5TY-form.png) | 5QY3G5TY · 表单 | 请求handle只是关注范围，cursor保留首尾空格和竖线。 |
| [317 X关注列表结果](317-x-research-5QY3G5TY-result.png) | 5QY3G5TY · 结果 | 关注对象独立userId与请求handle分开，moreUsers=false及nextCursor分别保留。 |
| [318 聚合热点表单](318-hot-research-9Y4EX7RW-form.png) | 9Y4EX7RW · 表单 | 按本接口日期时间格式提交，不套其他接口30天约束。 |
| [319 聚合热点结果](319-hot-research-9Y4EX7RW-result.png) | 9Y4EX7RW · 结果 | 一组中两条热点和summary组数1分别显示；搜索落点不当新闻原文，不安全URL仅文本。 |
| [320 关键词热点表单](320-hot-research-W94P1QH1-form.png) | W94P1QH1 · 表单 | 平台复选1/5与逐行两个关键词；one,two保留为一个词，另一词首尾空白保留。 |
| [321 关键词热点结果](321-hot-research-W94P1QH1-result.png) | W94P1QH1 · 结果 | 按响应平台分组，空平台列表不猜hasMore或完整覆盖，不创建文章。 |
| [322 单平台热点表单](322-hot-research-S28Q6HUD-form.png) | S28Q6HUD · 表单 | GET接口允许平台6小红书，与关键词热点支持的平台列表分开。 |
| [323 单平台热点结果](323-hot-research-S28Q6HUD-result.png) | S28Q6HUD · 结果 | 相对协议搜索地址只作文本，热度字符串0和index0保留。 |
| [324 账户余额表单](324-redfox-account-API_1792036841619-form.png) | API_1792036841619 · 表单 | 无需手工输入凭证或参数，明确使用account次数预算，文档价格0。 |
| [325 账户余额结果](325-redfox-account-API_1792036841619-result.png) | API_1792036841619 · 结果 | 三类余额0正常展示，单位points，不自动换算货币或填本地实扣。 |
| [326 账户调用记录表单](326-redfox-account-API_1792043329817-form.png) | API_1792043329817 · 表单 | pageNum/pageSize为可选原始字符串，不造默认值或暴露apiKey。 |
| [327 账户调用记录结果](327-redfox-account-API_1792043329817-result.png) | API_1792043329817 · 结果 | 同时间同积分两行分别保存和展示，本地结果ID不冒充供应商请求ID，均明确未匹配。 |
| [328 关键词空行被拒](328-hot-keyword-empty-line-rejected.png) | 关键词空行被拒 | 空行明确提示，已填平台、日期及词内容保留，不建run或外发。 |
| [329 X空搜索页](329-x-research-empty-result.png) | X空搜索页 | 实际0项，无导入、自动翻页或隐藏补全调用。 |
| [330 390px数组表单](330-hot-keyword-array-form-narrow.png) | 390px数组表单 | 七个平台checkbox和逐行关键词正常换行，scrollWidth=390。 |
| [331 390px账户记录](331-account-records-narrow.png) | 390px账户记录 | 两条重复账单均可读，积分和未匹配提示清晰，无横向溢出。 |
| [332 390px热门账号](332-x-rank-result-narrow.png) | 390px热门账号 | 完整大整数粉丝数、评分0及长标签正常换行，图片只anchor，无主动读取。 |
| [333 账户冻结参数展开](333-account-frozen-parameters-no-key.png) | 账户冻结参数展开 | 只显示pageNum/pageSize和操作ID，不含apiKey；持久回执与实际UI链路另有SQL脱敏断言。 |
| [334 榜单JSON字符串展开](334-x-rank-original-json-string.png) | 榜单JSON字符串展开 | networksJson保持原始字符串，不解析为作者或分类永久身份。 |

主代理 UI #133–142 共10次localhost桩调用，覆盖9项固定接口与1次空搜索。SQL核实POST/GET、query凭证仅传输注入、原始cursor和账户页码、数组词边界、根/回复/关注作者分开、无身份绑定或材料导入；2个账户请求按redfox.account计数且估价0，其余按query估价0.06，均非实际扣款。重复账单不去重或造匹配，10回执各1次attempt，媒体未读取。P3ag首次审阅发现热门账号核心指标漏出主视图，累计1处已补齐并经实际截图确认；73项前端定向回归/typecheck/build通过。9类UI预算已关闭，真实累计仍3次；累计334张截图。时段汇总对账、剩余研究/转写/生成和正式采集仍未完成。

## P3ai 六项评论 / 关注只读查询

| 图 | 页面与批注 |
| --- | --- |
| [335](335-toutiao-ZMFVK589-form.png) | 头条评论表单：作品ID与offset首尾空白原样提交，不把评论作者当作品作者。 |
| [336](336-toutiao-ZMFVK589-result.png) | 头条评论结果：cid/uid、点赞字符串0与根分页total=0/hasMore=false保留；实际本页评论数另列，createTime秒与updateTime未知单位分开。 |
| [337](337-tiktok-API_1790577699794-form.png) | TikTok关注表单：数字用户ID与安全ID二选一；首次pageToken允许留空但请求必须包含空字符串。 |
| [338](338-tiktok-API_1790577699794-result.png) | 关注结果：实际followee身份不同于请求用户；粉丝0、认证false、hasMore=1和pageToken=null分别显示，不猜末页。 |
| [339](339-tiktok-API_1790581645603-form.png) | TikTok视频评论表单：作品ID完整字符串，首次数值cursor=0。 |
| [340](340-tiktok-API_1790581645603-result.png) | 评论结果：完整大整数commentId、点赞/置顶false、点赞数0，评论者身份与作品ID分开；超大nextCursor保留原值并提示不可无损填入数值输入。 |
| [341](341-tiktok-API_1791446025175-form.png) | 评论回复表单：作品ID、根评论ID、cursor和count按各自类型填写。 |
| [342](342-tiktok-API_1791446025175-result.png) | 回复结果：reply角色、实际评论者、回复对象null与线程0分别保留，不关联材料。 |
| [343](343-youtube-WULKP6JP-form.png) | YouTube评论表单：原始continuationToken及可选排序；不注入前端默认语言或地区。 |
| [344](344-youtube-WULKP6JP-result.png) | YouTube评论结果：点赞“1万”和“4年前”不换算；root令牌null与data令牌原串按路径分别显示，不合并。 |
| [345](345-instagram-U1SGKF2G-form.png) | Instagram评论表单：recent明确选择、分页令牌首尾空白保留。 |
| [346](346-instagram-U1SGKF2G-result.png) | Instagram评论结果：本页实际1条与上游count=15/total=2811分别展示，编辑/置顶/认证false保留，头像只链接不主动加载。 |
| [347](347-tiktok-following-xor-error.png) | 两个用户定位同时填写时显示二选一错误，保留输入，不建任务或请求。 |
| [348](348-tiktok-cursor-invalid-input.png) | 超过安全整数的数值游标显示明确错误，保留完整输入；未舍入后提交。 |
| [349](349-tiktok-comments-empty.png) | 空评论页仅保存/显示页摘要，实际0条，不推定是否末页，不提供导入。 |
| [350](350-tiktok-following-frozen-empty-token.png) | 关注任务的冻结参数展开：pageToken持久值确为空字符串，minTime为字符串0，未以响应null覆盖请求。 |
| [351](351-tiktok-following-form-narrow.png) | 390px关注表单：完整ID、空令牌提示和提交区可读，scrollWidth=390；重拍时回到顶部以消除截图的焦点滚动固定导航假象。 |
| [352](352-instagram-comment-result-narrow.png) | 390px Instagram结果：评论主字段、作者及actual/report计数正常换行，无整页横向溢出。 |
| [353](353-youtube-comment-two-tokens-narrow.png) | 390px YouTube结果：相对时间、字符串计数和两处令牌分别可读，无整页横向溢出。 |
| [354](354-tiktok-unsafe-cursor-narrow.png) | 390px TikTok结果：完整大整数游标与不可无损输入提示可读，无整页横向溢出。 |

主代理 UI #143–149 共7次localhost桩请求，覆盖六项及空页，全部完成，0导入/绑定；七回执各一次attempt、query估价0.06。SQL与桩记录核实冻结参数、首次空令牌、原始字符串空白、大整数保真、actual与reported计数和评论者作用域；未读取任何媒体。102项前端定向测试、typecheck/build通过，P3ai实质错误0，P3ag历史1保留；九类UI预算已关闭，真实累计仍3次。lead初次预算脚本误用SQL双引号已纠正，未影响产品或产生供应商请求；351焦点滚动的截图假象已重拍。累计354张原始截图及逐处批注，剩余P4/正式采集与P5仍在实施。

## P4b 六平台转写工作流

| 图 | 页面与批注 |
| --- | --- |
| [355](355-asr-new-douyin-form.png) | 工具入口的新建转写表单：完整分享文案/换行/emoji保留，五平台提交估价0.6，poll免费仍计次数，限制以建run冻结值为准。 |
| [356](356-asr-zero-budget-wait.png) | 零预算等待：尚无回执、桩计数0，不以等待状态自动外发。 |
| [357](357-asr-stop-dialog.png) | 停止确认：说明仅停止本地后续处理/轮询，不宣称供应商取消或退款；原因写入审计。 |
| [358](358-asr-stopped-run.png) | 同一run150停止后保留恢复入口，未产生供应商请求。 |
| [359](359-asr-resume-dialog-narrow.png) | 390px恢复确认：说明优先本地处理已收响应与提交未知先核对；原因及确认区完整可见。 |
| [360](360-asr-submitted-waiting-poll.png) | 恢复同一run后仅提交一次，taskId持久化，等待结果轮询；预算等待不新建另一业务任务。 |
| [361](361-asr-xiaohongshu-form.png) | 小红书转写表单：所选平台与原始输入独立，非抖音默认套用。 |
| [362](362-asr-shipinhao-form.png) | 视频号转写表单：支持完整分享文案，不本地抽取或跳转抓取。 |
| [363](363-asr-kuaishou-form.png) | 快手转写表单：链接原串提交，估价/轮询次数边界可见。 |
| [364](364-asr-bilibili-form.png) | B站转写表单：固定平台提交入口，材料附件关联尚未交付不冒充已支持。 |
| [365](365-asr-videoUrl-form.png) | 播放直链转写表单：该项提交估价0.06，与五平台0.6分开。 |
| [366](366-asr-douyin-completed-result.png) | 抖音完成态：progress已清空仍从持久结果显示任务ID；完整文本保留换行emoji，当前状态为已完成。 |
| [367](367-asr-segments-and-processing-history.png) | 分段及历史展开：毫秒0/1500/1600/3500保真；旧processing的text/stampSents=null中性显示，不覆盖已完成状态或误报需核对。全页截图已回顶部重拍，避免固定导航滚动假象。 |
| [368](368-asr-xiaohongshu-result.png) | 小红书完成态：对应task/result/receipt独立保留，无文章或作者关联。 |
| [369](369-asr-shipinhao-result.png) | 视频号完成态：转写文本是研究结果，不赋予原作者文字稿身份。 |
| [370](370-asr-kuaishou-result.png) | 快手完成态：原始输入与转写结果分别显示，分段按需展开。 |
| [371](371-asr-bilibili-result.png) | B站完成态：只保存本轮实际转写事实，无隐式文章入库。 |
| [372](372-asr-videoUrl-result.png) | 播放直链完成态：独立taskId及成功文本保留，未混用平台提交契约。 |
| [373](373-asr-existing-task-prefilled-form.png) | 从结果带入已有任务：平台及taskId明确，模式为查询已有任务。 |
| [374](374-asr-existing-task-result.png) | 已有任务结果：只新增一次poll，没有ASR提交；冻结提交步骤0。 |
| [375](375-asr-failure-case-form.png) | 合成失败用例：仍通过正常B站表单显式提交，输入保留为数据。 |
| [376](376-asr-failed-result.png) | 供应商failed：本地run已结束、失败原因与已收完整回执分开；不自动重提交。 |
| [377](377-asr-segments-first-page.png) | 27段合成分页样本：首组1–25，下一组可用，不一次创建全部段DOM。 |
| [378](378-asr-segments-last-page.png) | 点击下一组后显示26–27，上一组可用/下一组禁用；两组全部可达。首次等待文字选择器不能匹配React拆分文本已改查实际region，无重复查询。 |
| [379](379-asr-mode-draft-retained.png) | 切换模式后新建草稿的原始分享文案、空白和所选快手平台保留。 |
| [380](380-asr-clear-only-current-draft.png) | 清空当前新建草稿未提交，已有任务模式的另一份opaque taskId及videoUrl平台保留。 |
| [381](381-asr-existing-task-form-narrow.png) | 390px已有任务表单：原始taskId、模式/平台与按钮可读，PNG及文档宽390。 |
| [382](382-asr-result-segments-history-narrow.png) | 390px完成态/分段/处理中历史：原始ID、文本、null中性记录换行完整；仿真指针投射偏差后用原生键盘展开，并未声称真实手机触控实测。 |
| [383](383-asr-last-segments-narrow.png) | 390px长分段末组：26–27、毫秒值及前后按钮可读，无横向溢出；使用原生键盘激活验证。 |
| [384](384-asr-failed-result-narrow.png) | 390px失败态：供应商失败原因与本地状态可读，无横向溢出。 |
| [385](385-asr-common-task-list.png) | 共同任务列表：新建转写、查询已有转写、已完成/已结束及失败原因在同一任务生命周期中展示。 |

UI #150–158 共9个任务、22次localhost合成调用（7submit/15poll），覆盖六组、已有任务只查、失败、27段分页；初始零预算0外发，run150停止/恢复及审计核实，仍只提交一次。SQL核对原始分享文案、22回执各1次attempt、transcript/poll用途和估价、完成progress清空而结果ID仍存、0文章/信源/文件关联。V18记录21次后保存计数及输入，V19加载原记录并增加1次长分段poll，没有重置计数；测试预算已全关，真实仍3次。119项前端定向测试/typecheck/build通过；P4a恢复漏扫描1、P4b正常processing-null误警告1均已修并保留历史。字幕获取、显式文件保存、材料附件关联及整体P5尚未完成，未以本地桩证明真实ASR协议或扣费。

## P4d 十四项媒体、字幕元数据与文本工具

| 图 | 页面与批注 |
| --- | --- |
| [386](386-tools-media-form-desktop.png) | 工具页新增同一张同步工具表单，14项按媒体、字幕、文本分组；音频地址估价0.12，其余0.06，按用途计次数。 |
| [387](387-tools-audio-m4a-result-desktop.png) | B站音频：实收audio/m4a及原始分享文案分别保存；地址仅链接，未下载，也不据此宣称可再次上传。 |
| [388](388-tools-generic-image-list.png) | 通用解析：上游imageUrls原JSON字符串保留，实际解析两项；javascript地址只显示文本和诊断，没有可执行链接。 |
| [389](389-tools-youtube-video-audio.png) | YouTube下载解析：video/audio分别呈现，时长按上游秒值，不自动加载或下载资源。 |
| [390](390-tools-x-duration-zero.png) | X下载解析：durationSeconds=0照实显示，未替换成未知或根据工具名称猜时长。 |
| [391](391-tools-tiktok-media.png) | TikTok下载解析：视频与音频分项；缺失描述不注入默认正文。 |
| [392](392-tools-xiaohongshu-image-gallery.png) | 小红书解析：两项image图集与videoUrl=null保留，不因名称含“视频下载”改成视频。 |
| [393](393-tools-shipinhao-duration-null.png) | 视频号解析：durationSeconds=null明确为未知，与0秒分开；媒体地址不充当作者或原文证据。 |
| [394](394-tools-douyin-mixed-resources.png) | 抖音解析：video/image/audio三项均可读，页摘要实际资源数与结果总项数分别表示。 |
| [395](395-tools-kuaishou-media.png) | 快手解析：视频和图片各自保留实际类型，资源只显示安全HTTP(S)链接。 |
| [396](396-tools-bilibili-media.png) | B站下载解析：视频资源与空时长保留，独立于音频提取接口。 |
| [397](397-tools-instagram-unknown-type.png) | Instagram未知资源类型upstream-unknown原值完整显示、时长0保留，不硬编码为video。 |
| [398](398-tools-bilibili-subtitle-metadata.png) | B站字幕元数据：语言与json格式轨道分别列出，duration=0、createdAt原串和视频描述保留；描述明确不是字幕正文。 |
| [399](399-tools-youtube-subtitle-formats.png) | YouTube字幕元数据：srt/vtt/json3三个格式全部可见；第二轨道的未知格式与不安全地址保留为事实，未读取文件。 |
| [400](400-tools-text-sanitized-highlight.png) | 文本检查：originalContent按纯文本显示，重复命中类型不去重；实际DOM核实只剩两个限定class的span，script/img/事件属性均已清除。 |
| [401](401-tools-zero-resource-summary.png) | 空资源响应：仍显示title/描述/顶层videoUrl元数据，实际资源数0，不将空页认定失败或隐式请求顶层链接。 |
| [402](402-tools-text-check-form-desktop.png) | 文本工具表单：唯一content输入、2999字符上限和query用途可见，原始HTML字符作为文本提交。 |
| [403](403-tools-media-form-narrow-draft.png) | 390px媒体表单：长分享文案、空白和emoji保留；切换工具后恢复该工具草稿，未建新任务。 |
| [404](404-tools-text-form-narrow-draft.png) | 390px文本表单：清空媒体草稿不影响文本草稿，实际maxLength=2999；空白输入的提交按钮禁用。 |
| [405](405-tools-audio-result-narrow.png) | 390px音频结果：m4a、长地址和冻结输入正常换行，scrollWidth=390。 |
| [406](406-tools-subtitle-formats-narrow.png) | 390px字幕轨道：三种格式、未知格式、描述与元数据完整可读，无整页横向溢出。 |
| [407](407-tools-text-highlight-narrow.png) | 390px文本检查：纯文本脚本字符可读、安全高亮有区分，重复类型保留，无整页横向溢出。 |
| [408](408-tools-empty-summary-narrow.png) | 390px空结果摘要：0和顶层媒体元数据正常展示，未出现虚构导入或保存动作。 |
| [409](409-tools-image-list-unsafe-url-narrow.png) | 390px图集及原JSON字符串：不安全地址仅文本，诊断和长字符串均可换行。 |
| [410](410-tools-frozen-query-parameters.png) | 冻结工具参数展开：operationId及原url可查，任务仍复用同步查询生命周期，没有另建工具状态。 |

UI #159–173 共15个任务、15次localhost合成调用，覆盖14唯一接口和一次空资源响应；12次media、2次transcript、1次query，回执均完成且各1次attempt。SQL核实原始空白/换行、0/null/未知类型、字幕描述/格式、HTML原文与清洗字段分开，0文章/信源/文件关联；桩计数没有任何媒体或字幕文件读取。131项前端定向测试、typecheck/build通过，P4d实质错误0。lead验收脚本首次误写既有operation_key名称、第二处误记合成未知类型字符串，均按代码/桩事实纠正，只读取已有结果，没有重发调用；原失败日志保留。九类UI预算全关，真实累计仍3次；累计410张原始截图均已逐处批注。文件保存、字幕正文/材料附件、其余26项接口及正式采集/P5仍待，未以本地桩替代真实协议或扣费验证。

## P4f 私有素材上传、播放与复用

| 图 | 页面与批注 |
| --- | --- |
| [411](411-private-assets-entry-desktop.png) | 私有素材入口：沿用同一文件表、上传路由和结果文件关系；图片/音频/视频格式及10/20/50十进制MB限制来自服务端。 |
| [412](412-private-audio-upload-result.png) | 实际WAV上传后的本地音频卡片，controls、下载与删除齐全；没有向Redfox上传。 |
| [413](413-private-video-upload-result.png) | 实际MP4上传后的本地视频卡片；不虚构时长/宽高或保证浏览器支持编码。 |
| [414](414-private-gif-frames-result.png) | 实收GIF宽高32×32、3帧，按总帧像素校验；GIF不能作为当前GPT图片参考。 |
| [415](415-private-bmp-image-result.png) | 未压缩BMP可本地预览，结构验证边界明确；截图等待图片真正加载后保存。 |
| [416](416-private-upload-unsupported-input.png) | 不支持扩展名在提交前拒绝，文件选择保留。 |
| [417](417-private-upload-decimal-limit.png) | 图片10,000,001字节被本地限制拒绝，使用十进制10MB而非MiB。 |
| [418](418-private-upload-output-only-m4a.png) | m4a只可保存既有输出，不允许伪装为通用输入或自动转码。 |
| [419](419-private-upload-byte-mismatch.png) | 将PNG伪装MP4实际被服务端415拒绝；错误与原文件保留，没有供应商任务。 |
| [420](420-private-upload-pending-cancel.png) | 本地11MB文件实际限速上传中，提供取消，控件避免重复提交。 |
| [421](421-private-upload-cancelled-retained.png) | 取消后保留原File选择，可直接重试；CDP限速已在验收后解除。 |
| [422](422-private-upload-retry-11mb-success.png) | 同一原File重试成功，网络记录核实相同Idempotency-Key；11,000,000字节MP4穿过web/API流式限制。 |
| [423](423-private-audio-playback.png) | 原生WAV控件实际播放，currentTime推进；未把仅有头部验证称全部音频解码保证。 |
| [424](424-private-webm-playback.png) | WebM原生控件实际播放结束，无媒体错误；音视频默认preload=none/不自动播放。 |
| [425](425-private-video-unsupported-browser-fallback.png) | 合成MPEG4编码不被当前浏览器支持时显示下载提示，不误报服务端文件损坏。 |
| [426](426-private-asset-reference-popup.png) | “用作参考”新窗口初始化同一合格旧PNG，保留原窗口草稿；13份新GIF/BMP/音视频均不进入图片参考选择。 |
| [427](427-private-reference-pin-waiting.png) | run174复用已有参考记录后在零image预算等待；没有创建新的供应商回执。 |
| [428](428-private-asset-delete-protection-dialog.png) | 删除说明活动/可恢复任务占用与保留历史的边界；删除由服务端最终判定。 |
| [429](429-private-asset-delete-protected-409.png) | 实际DELETE409，文件仍可用；随后通过正常“放弃本轮”结束174并释放本轮占用，未删除旧参考夹具。 |
| [430](430-private-assets-narrow-entry.png) | 390px入口和上传说明：工作区按钮换行、单列布局，无页面横向溢出。 |
| [432](432-private-audio-deleted-narrow.png) | tiny.wav实际删除成功：历史元数据仍在，播放器、下载、复用动作均移除。 |
| [433](433-private-video-card-narrow.png) | 390px视频卡片，原生播放器与文件信息按容器宽度显示。 |
| [434](434-private-assets-format-limits-narrow.png) | 窄屏格式/大小/GIF总像素/BMP限制说明与媒体卡片正常换行。 |
| [436](436-private-assets-pagination-first50.png) | 51份可用素材的首批50项，“加载更多素材”来自实际nextCursor。 |
| [437](437-private-assets-pagination-complete51.png) | 实际点击加载后51个唯一key，无重复；33份专用分页夹具随后通过正常文件删除API清理。 |
| [438](438-existing-image-result-private-asset.png) | 既有完成图片任务也使用同一PrivateAssetView；已删和仍可用产物分别按文件现状显示。 |
| [439](439-private-audio-delete-narrow-native.png) | 390px原生截图：动画完成后的删除弹窗、说明、取消/确认完整可见。431/435为截图时机/滚动裁切异常，已替换并移除，不作为产品证据。 |

实际浏览器上传13份：2图片、5音频、6视频；本轮新增供应商请求0，原V20计数仍15。WAV原生下载3278字节、SHA256与原文件一致；11个音视频元素初始GET/HEAD为0。素材幂等取消重试、删除409和成功、任务放弃、分页50+1、390px实测均有数据库/文件/网络记录。33份分页测试文件已清理，临时目录为空，九类UI预算全为0。38项前端定向测试/typecheck/build通过，P4f产品错误0；临时夹具路径和截图环境错误由lead纠正，没有重新购买请求。真实调用仍3次；截图为本地合成环境，不证明真实上传、生成或实际扣费。当前437张有效截图已逐处批注。

## P4h / P4j 显式供应商上传与 AI 搜索

| 图 | 页面与批注 |
| --- | --- |
| [440](440-ai-search-submit-form-desktop.png) | 新AI搜索工作区：七引擎、原问题、文档估价及双阀/次数/时限说明；没有169接口逐个页面。 |
| [441](441-ai-search-zero-budget-waiting.png) | 实际表单创建run175后在ai_search零预算前等待，0外发、未创建回执。 |
| [442](442-ai-search-stop-confirmation.png) | 搜索停止确认：只停止本地、不取消已受理请求、原因写审计；实际停止并恢复同一175。 |
| [444](444-ai-search-kimi-answer-citations.png) | Kimi从提交到两次poll完成；答案按纯文本保留script/Markdown字面量，三个顺序引用仅安全地址可点击。 |
| [445](445-ai-search-processing-null-history.png) | 提交与轮询历史折叠，processing/result:null不冒充失败；当前本地状态和当前页历史事实分别表达。 |
| [446](446-ai-search-existing-task-prefill.png) | 从完成结果新窗口带入任务系列及含首尾空白的taskId；只查询，不重新提交搜索，原窗口草稿保留。 |
| [447](447-ai-search-query-form-narrow.png) | 390px已有任务表单：六查询系列，Kimi两引擎共用；原ID不trim，页面无横向溢出。 |
| [448](448-ai-search-citations-first-page.png) | 105引用响应的首批100结果，答案与当前页数量分别显示；报告引用数105不冒充当前页条数。 |
| [449](449-ai-search-citations-next-page.png) | 实际游标下一批6引用，requestedTaskId仍可派生带入链接，不声称本页有全局最新状态。 |
| [450](450-ai-search-citations-pagination-control.png) | 首批末尾的真实“下一批结果”入口；实收引用顺序、unsafe URL仅文本及原始字段诊断保留。 |
| [452](452-media-upload-result-local-and-supplier.png) | 实际WebM multipart上传到localhost桩并持久化：供应商URL仅外链，本地播放器读取受鉴权私有地址，不读取远端资源。 |
| [453](453-media-upload-result-narrow.png) | 上传结果390px：供应商链接/本地素材分开，尺寸未知不虚构，下载仍取本地文件。 |
| [454](454-media-upload-output-only-disabled.png) | 合成m4a输出可播放/下载，但通用上传按钮禁用并说明原因；该专用输出夹具随后删除。 |
| [455](455-ai-search-deepseek-answer-sources.png) | DeepSeek已有任务只查，固定业务码200解析成功；search_result来源保持0/null及完整大整数字符串，引用封面不加载。 |
| [456](456-ai-search-failed-null-facts.png) | 元宝失败历史：failed与failReason:null/result:null照实显示，不编造原因，也不当作正常完成答案。 |
| [457](457-ai-search-answer-narrow.png) | 390px任务进度：完成后progress清空仍显示实收/请求ID与冻结限额，查询入口保留原ID。 |
| [458](458-media-upload-confirmation-stable.png) | 初版上传确认稳定截图，明确第三方传输/预算/未知人工处理；其中无保存路径的可选备注已由462/463精简。451裁切截图已移除，不作证据。 |
| [459](459-media-upload-confirmation-narrow.png) | 初版390px上传确认，按钮完整可见；最终无无效备注版本见463。 |
| [460](460-ai-search-submit-draft-narrow.png) | 390px提交草稿：切换引擎与查询模式后问题原串恢复；清空查询草稿不清空提交草稿，纯空白查询禁用提交。 |
| [461](461-ai-search-answer-citation-narrow.png) | 390px答案及来源详情：长URL、大整数和原始字段可换行，null/0分开，未执行HTML或读取引用图片。 |
| [462](462-media-upload-confirmation-no-unused-note.png) | 最终桌面上传确认：移除没有处理路径的备注，只保留必要说明和取消/确认；初始键盘焦点实际为取消。 |
| [463](463-media-upload-confirmation-final-narrow.png) | 最终390px上传确认：无无效输入，说明及两个动作完整可见。 |
| [464](464-private-delete-confirmation-final-narrow.png) | 同一精简应用素材删除确认；需要审计原因的其他ReasonDialog默认行为保留。439为修正前的阶段证据，以本图为最终界面。 |

本轮实际UI #175–179共5个任务、7次localhost合成调用（1搜索提交/5查询/1通用上传），111条引用；run175停止/恢复仍只提交一次。查询ID及问题原空白、105引用的100+6分页、null/0/超大数字、safe URL、0文章/作者关联及0远端资源读取均由SQL/桩日志核实。上传确认先实际取消再提交，只有1次上传；所有上传预览仍为私有地址。49项前端定向测试、typecheck/build通过。lead发现新增上传确认沿用了未保存的可选备注，计P4h/j展示缺漏1，已直接按最小改动隐藏两处无用字段，补键盘焦点并重新typecheck/build及实际截图；未扩展后端参数或审计模型。两次20秒等待刚好撞上既有20秒页面刷新节奏、一处临时SQL列名误写均已按现状纠正，没有重复提交；原日志留在独立临时目录。九类UI预算全关，m4a测试夹具清理，真实仍3次；当前460张有效原始截图已逐处批注。真实上传/生成与实扣尚未验证。

## 后续截图清单

其余平台的参数、结果导入、采集切换和 P4 工具界面仍在实施，后续逐处补充截图批注。页面后续有实质调整时更新对应截图，不以已完成阶段的图片代替新界面。

真实外部验证仍限用户已授权的只读代表性调用。P2 证明本地闭环、恢复和界面行为，未证明 Redfox 的实际参考上传协议、生成可用性或实际扣费。

## P4l 五种图片模型阶段验收

| 截图 | 批注 |
| --- | --- |
| [465](465-image-upload-reuse-entry.png) | 通用PNG上传完成后出现明确的复用入口；远端URL与私有本地文件分开。 |
| [466](466-gpt25-explicit-reference-form.png) | GPT-Image-2.5带入指定上传记录，透明背景/2k/16:9及参考草稿可见；实际生成不再上传该参考。 |
| [467](467-gpt25-private-output-result.png) | run181完成，实收进度与任务ID保留，图片仅从私有受鉴权地址预览。 |
| [468](468-image-query-model-task-prefill.png) | 新窗口只查询入口带入gptImage25和包含首尾空格的原始taskID；未提交新请求。 |
| [469](469-seedream-pro-invalid-custom-size.png) | 0x1920在本地拒绝，给出可修改的尺寸提示；未创建任务。 |
| [470](470-gemini-uppercase-resolution-form.png) | Gemini独立2K大写分辨率与3:2；切换Pro后返回仍保留原始描述和参数。 |
| [471](471-gemini-private-output-result.png) | run182完整提交、轮询、私有图片保存；不把模型标签当作供应商身份验证。 |
| [472](472-seedream-pro-custom-output-form.png) | Pro自定义1920x1920、JPEG、快速优化与关闭水印；文档范围及本地范围区分。 |
| [473](473-seedream-pro-jpeg-output.png) | run183按实际JPEG字节保存、预览和下载，未以URL扩展名代替文件验证。 |
| [474](474-seedream-lite-ten-image-form.png) | Lite自动组图与十张请求上限；上限不保证供应商返回量。仿真恢复后的指针曾改动测试值，最终十张复验见478/476。 |
| [475](475-seedream-lite-form-narrow.png) | 390px模型表单布局，页面scrollWidth=390；不将浏览器仿真记录等同真实手机触控。 |
| [476](476-seedream-lite-ten-private-images.png) | run185实际返回并保存十张，页面共13条结果，十个预览src全部为私有地址；重复图仅是合成字节。 |
| [477](477-seedream-lite-result-narrow.png) | 390px完成任务及结果，无横向页面溢出，使用实际结果数量而非usage推百分比。 |
| [478](478-seedream-lite-ten-confirmed-before-submit.png) | 在原生键盘提交前核实上限10；后端持久参数与桩请求一致，最终保存十张。 |

实际UI run180–185共6任务：1次通用PNG上传、5次图片提交、10次轮询、14次远端图片保存；30次localhost合成HTTP调用，SQL核实14个私有产物。五种模型中的旧GPT2沿既有证据，本轮实际覆盖四个新模型。run184在仿真恢复后的指针操作中数量变为1，保留该真实记录；run185在提交前核实10并保存十张，未修改既有任务伪造结果。60秒等待超时是十次顺序保存尚未刷新，之后SQL和页面均完成。首验收脚本把referenceImages误写image已纠正，未修改产品或重复供应商生成；原失败日志保留。16个供应商回执均completed/attempt1，显式复用只产生一次通用上传，0文章/信源关联。59项前端定向检查、typecheck/build通过，P4l产品错误0。九类UI预算全关，真实仍3次、无真实上传或生成。当前474张有效原始截图均有批注。

## P4n Seedance视频阶段验收

| 截图 | 批注 |
| --- | --- |
| [479](479-video-duplicate-role-local-rejection.png) | 首帧重复角色立即提示并禁用提交；没有以静默丢弃角色满足上限。 |
| [480](480-video-same-image-two-roles-form.png) | 同图首帧/末帧按顺序提交，显式复用指定上传记录；独立文件1、待上传0，音频输出与返回末帧独立选择。 |
| [481](481-video-role-controls-narrow.png) | 390px角色、重复同图/删行/删全部角色操作可读；独立文件计数与两角色分开，无页面横向溢出。 |
| [482](482-video-private-output-and-last-frame.png) | run186视频和实际末帧分别保存；播放器preload=none、controls、无autoplay，src仅私有内容地址。实际播放currentTime0.2/readyState4/errornull。 |
| [483](483-video-existing-task-prefill.png) | 新窗口只查表单保留原taskId首尾空白，未重新购买生成。 |
| [484](484-video-query-saved-outputs.png) | run187只查并保存视频与返回末帧；无原始生成标记时不推断lastFrameMissing。 |
| [485](485-video-zero-budget-before-attempt.png) | run188在video零预算前等待、尚无回执；未阻止本地任务与草稿创建。 |
| [486](486-video-stop-dialog.png) | 视频停止说明明确只停止本地、保留恢复及素材占用，不取消远端或承诺退款；实际以原因停止同一188。 |
| [487](487-video-resume-dialog.png) | 恢复按当前步骤继续、未知提交先人工核对、下载仍受双阀；实际恢复同一188且最终只提交一次。 |
| [488](488-video-missing-requested-last-frame.png) | run188已保存视频但未返回所请求末帧；明确缺项与可只查核对，没有虚构末帧或自动重新生成。 |
| [489](489-video-missing-last-frame-narrow.png) | 390px缺末帧提示、原taskID与进度可读，页面scrollWidth=390。 |

UI run186–188共3任务：2提交/5poll/5远端产物保存，共12次新增localhost合成HTTP调用；3个实际WebM私有文件、2个末帧图片，显式双角色引用未增加通用上传。run188实际零预算等待→停止→恢复同一任务，只提交一次；生成缺末帧与独立查询不猜原标记的边界分别核实。源URL无扩展名且Content-Type为octet-stream，仍按实际WebM字节保存；浏览器可解码这份0.2秒合成夹具，不将上游duration6当作本地实际时长。0文章/信源关联，7个新供应商回执completed/attempt1，九类UI预算全关。72项前端定向tests、typecheck/build通过；P4n产品错误0。一次脚本等待了自检前旧文案而超时，依据实际页面完成状态纠正；一次审计字段名target误写subject已纠正，失败日志保留，均未重复生成。P5b+P4p整合全workspaceTS已通过。真实仍3次，未真实生成/上传；现485张有效截图已逐处批注。

## P4p 小红书异步评论阶段验收

| 截图 | 批注 |
| --- | --- |
| [490](490-xhs-comments-explicit-all-and-independent-query.png) | 工具页内新增两表单；全部评论必须显式选中，基价/按20条扣点和未知细则分开，查询草稿独立。实际提交前恢复指定20条。 |
| [491](491-xhs-comments-twenty-four-hour-wait.png) | run189提交成功后首查严格24小时，visibleAfterTime原串保留、无伪百分比。初版回执标签误导，最终等待标签见492。 |
| [492](492-xhs-comments-processing-hourly-wait.png) | 测试时间快进后处理状态，下一次约60分钟；当前步骤尚无回执，不错误声称此前未收任何回执。received不作进度。 |
| [493](493-xhs-comments-stop-dialog.png) | 停止仅停止本地、不取消远端，不延长期限；实际打开后取消，没有停止或重复提交。 |
| [494](494-xhs-comments-completed-two-records.png) | run189两次poll后完成两评论；评论文本纯文本、评论者ID与作品作者分开。初版派生安全地址null文案已由503替代。 |
| [495](495-xhs-comments-independent-counts.png) | 展开冻结输入及本页实收条数：dataNum50/received52/实际2独立，不强制相等、不伪造后续页。安全地址最终文案见503。 |
| [496](496-xhs-comments-existing-task-prefill.png) | 新窗口带入原始taskID首尾空格；截图与实际run190均为原任务只查询。早期快速fill未保留为新值，未据此冒称103条分页。 |
| [497](497-xhs-comments-original-task-query-result.png) | run190原任务只查真实得到两评论，保留该合法查询记录；之后以原生键盘核实many-comments再创建191。安全地址文案以503为准。 |
| [498](498-xhs-comments-next-result-page.png) | run191的下一批4评论真实可达，包含第103条；任务ID从冻结query输入保留，不假设本页存在全局最新状态。 |
| [499](499-xhs-comments-hundred-result-page.png) | run191首批100结果（1摘要+99评论），共103条评论；0图片/播放器/进度条，原文HTML字面量不执行。 |
| [500](500-xhs-comments-empty-completion.png) | run192合法空完成，actualCount0；不会将processing缺少列表或当前页无评论误判为空完成。 |
| [501](501-xhs-comments-independent-drafts-narrow.png) | 390px两类草稿独立：清空查询保留提交作品ID和显式全部选项；页面scrollWidth390。 |
| [502](502-xhs-comments-raw-text-safe-links-narrow.png) | 最终390px原文、超大ID、0及未标时区时间可读；unsafe地址显示中性不可打开说明，不把派生null冒充上游为空。 |
| [503](503-xhs-comments-safe-link-final.png) | 最终桌面评论结果：安全链接普通外链、unsafe无href，原始字段在诊断保留；0媒体加载。替代494/495/497中的初版fallback文案。 |

实际UI run189–192共4任务、6次localhost合成调用（1提交/5poll），107评论、0文章/信源/文件关联、0评论媒体读取；103评论的104结果按100+4真实分页。原始作品ID换行与空白、任务ID空白、50/52/2独立计数、超大字符串/0/null、空完成均由SQL/页面/桩wire核实。POST poll仅query taskId、body0字节，提交费用null、poll估价0仍计次数。原24h等待先实测零poll并保存时间证据，随后仅快进隔离合成夹具来验收小时轮询，结束后已恢复原receipt.received_at；没有宣称等待了真实24小时。九类UI预算全关，真实仍3次，无真实评论提交。

P4o恢复缺漏1已修：27不同专项/ASR/AI回归及全workspaceTS通过，实际HTTP停止/恢复的原job保留/丢失、反复恢复绝对首查时间、无新增attempt/step和已收raw关阀消费均有证据；未增加表、复制raw或修改其他任务恢复规则。P4p Sol High初次82定向tests/TS/build后，lead发现共享回执标签及派生null事实文案两处实质缺漏：首处Sol聚焦修复，第二处按skill升级Astra Medium并单处修复，Astra10项定向tests/TS/build通过，新错误0；Sol累计2保留。另有快速输入未进入最终草稿、选择器预期数量不符等验收脚本问题，保留真实run190，未修改产品冒充分页。当前499张有效原始截图已逐处批注。

## P5c 共用采集订阅与结果消费

| 截图 | 批注 |
| --- | --- |
| [504](504-shared-collection-youtube-draft-and-budgets.png) | 同一订阅编辑器按平台/固定操作选择，YouTube原始令牌、次数限额和公开估价分别展示；切换平台后原草稿仍在，新建默认停用。 |
| [505](505-collection-preview-link-preserves-draft.png) | 可选预览创建独立query任务，新标签链接保留名称/关键词草稿；没有创建、启用订阅或占正式游标。 |
| [506](506-collection-preview-query-budget-wait.png) | run193在query零预算前等待、尚无请求回执；与正式collect预算分开。随后通过原停止/恢复动作完成同一任务。 |
| [507](507-collection-preview-one-page-result.png) | run193只返回第一页作品和查询摘要；有下一页令牌也不自动续查或导入。 |
| [508](508-collection-created-disabled-and-platform-locked.png) | 订阅7创建后保持停用，已有平台锁定；手动运行需先显式保存启用。此时没有collect外发。 |
| [509](509-collection-name-period-preserve-active-round.png) | 名称/周期编辑明确保留等待中的run194；实际保存后executionVersion和active_run_id保持，周期变为1441。 |
| [510](510-collection-limit-change-shows-old-round-impact.png) | 修改条目限额前显示将停止旧轮；不把旧响应恢复成新配置。 |
| [511](511-collection-old-round-config-fenced.png) | 实际保存后run194停止、恢复按钮禁用，并提供回原订阅按新配置启动的入口。 |
| [512](512-shared-collection-zero-collect-budget-wait.png) | 新run195仍在collect零预算前等待；已有query预览成功不绕过采集预算。 |
| [513](513-shared-collection-two-pages-imported-results.png) | 首版完成两页及文章关联，但错误复用单次查询摘要；作为失败证据保留，最终统一摘要见518/528，515之前的表单不受影响。 |
| [514](514-platform-query-local-subscription-seed.png) | 平台查询新增“带入新采集订阅”，只复制本地条件，不自动创建或付费预览。 |
| [515](515-xhs-seeded-subscription-single-page-and-research.png) | 带入3X8FGEEM原始关键词空白和页码3，默认仍停用；明确带关键词只查一页，作品和推荐/话题研究分开保存。 |
| [516](516-shared-collection-corrected-page-summary.png) | 统一摘要首次修复：从returnedPage/nextParameters展示实际令牌，不再宣称正式采集不翻页、不导入；processedCount标签最终范围见518。 |
| [517](517-xhs-collection-work-recommendation-research-separated.png) | run196实际返回作品1、研究2（包括推荐候选），只有主作品关联文章；首版“已处理条目”标签范围错误，最终见518。 |
| [518](518-xhs-collection-final-count-ownership.png) | 最终桌面摘要：processedCount明确为已处理作品候选，研究单列；本地不续页null与上游字段事实分开，未把处理数当入库数。 |
| [520](520-non-weibo-trend-keeps-parameters-and-limits.png) | 非微博热搜的作品榜仍显示类别/日期及真实限额；只有UAQ90A1F采用单次研究快照规则。未因此发起榜单调用。 |
| [521](521-shipinhao-subscription-missing-identity-boundary.png) | 视频号作品搜索可定时保存结果，展示排序/精准匹配及1页上限；不承诺按昵称继承作者权限或自动补出稳定ID。 |
| [522](522-collection-result-explicit-youtube-detail-origin.png) | 从run195作品显式创建run197详情查询，来源结果575及原页发现时间保留；补全为独立query，不改原页/游标。 |
| [523](523-shipinhao-scheduled-result-awaits-per-item-evidence.png) | run198完成时缺作者/原文的项仍未入库；详情和人工导入动作可用于正式采集结果。 |
| [524](524-scheduled-result-manual-attribution-evidence.png) | 显式选择已有隔离作者、填写本条原文和核实依据；原因审计，没有永久昵称绑定或提高权限。 |
| [525](525-scheduled-result-manually-imported-isolated-source.png) | 预算全关后实际本地导入成功，关联从article/source字段派生；上游原始缺项事实保留，不被人工证据冒充。 |
| [527](527-shared-collection-editor-native-viewport.png) | 原生390px视口：平台锁定、参数、预览和限额仍可读，页面scrollWidth390；不是触屏硬件验收。 |
| [528](528-shared-collection-summary-native-viewport.png) | 原生390px最终摘要：数量范围、令牌计划及本页停止原因可读，无页面横向溢出。 |

实际UI run193–198共6任务，5完成、1因配置变化停止；新增6次localhost合成HTTP调用（2 query、4 collect），YouTube按原始空白令牌读取两页，小红书带词仅一页，视频号仅保留待补证结果。随后详情本地导入复用原文章，视频号人工补证新建1条材料；合计新增3文章/1隔离作者，0媒体自动读取、0视频号/快手永久账号绑定。原页created_at与材料discovered_at逐条核对一致。三个临时订阅已按领域命令停用，九类UI预算全关，真实仍累计3次。

P5c前端初次97项定向tests/TS/build通过；lead发现单次摘要误用与processedCount标签范围两处实质缺漏，Sol累计2按skill升级Astra Medium，最终16项聚焦/TS/build通过，Astra新错误0。后端扩producer后漏接既有origin/人工导入consumer计P5c-2第二处，lead诊断后以同页proof修正，48项实际DB/localhost回归与类型检查通过；此前增长榜父结果定位缺漏1保留，不重置错误历史。外发日预算初始未覆盖历史合成次数、可选空首页游标断言及等待API参数问题均为验收脚本/环境问题，未修改产品来迁就；临时API重载期间错误页已重开。两张CDP裁切导致固定导航投影错误的图片519/526已剔除，以527/528原生截图替代。当前522张有效原始截图均有批注。

## P5d 五平台本地导入与作者归属

下列均来自同一专用浏览器空间、独立 UI 测试库与 localhost 假供应商；原文链接只展示，没有访问这些平台或读取其媒体。

| 截图 | 批注 |
| --- | --- |
| [529](529-five-platform-qiche-separate-namespaces.png) | 汽车之家两条作品的 workId/authorId 数字相同，但分别属于车家号与原创范围；不凭相同数字合并。 |
| [530](530-five-platform-import-confirm.png) | 共用本地导入确认框：默认按真实作者归属，新作者隔离；人工目标/补充证据与审计原因分别说明。 |
| [531](531-qiche-imported-distinct-authors.png) | 两条实际导入后分别链接两个作者信源及两篇文章，重复导入按钮移除；没有继承其他作者权限。 |
| [532](532-dongchedi-received-account-and-work.png) | 懂车帝同次响应返回账号和作品；原始 authorId 与同页账号上下文分别保留，由后台验证关系。 |
| [533](533-dongchedi-account-binding-dialog.png) | 账号绑定仅采用实际收到的稳定身份，没有人工补 ID 字段或额外付费请求。 |
| [534](534-dongchedi-same-page-account-imported.png) | 先绑定账号再导入作品，后台复用已核实同页上下文；无需管理员重复填写备用作者 ID。 |
| [535](535-dongchedi-protocol-supplement.png) | 搜索响应是协议相对原文；管理员显式补同地址 https 协议并提供证据，没有自动补协议或替换路径。弹窗内滚动仍可提交。 |
| [536](536-dongchedi-search-reused-full-material.png) | 再次导入短描述复用原文章和作者；SQL 核对完整 text/html 均保留，未被搜索短描述降级。 |
| [537](537-yiche-invalid-original-placeholder.png) | 易车收到的 workUrl 为 `[]`，仅作为原始占位事实展示，不能当原文链接使用。 |
| [538](538-yiche-manual-original-dialog-mobile.png) | 390px 原生视口中人工补原文与证据，备用作者 ID 可空；弹窗可内部滚动，页面宽度保持390。截图为滚动中段。 |
| [539](539-yiche-manual-original-imported.png) | 人工补证后实际入库，原占位字段仍保留在响应诊断，材料归属从真实关联显示。 |
| [540](540-baijiahao-search-uk-bound.png) | 百家号账号搜索仅收到 uk，先按这一类型绑定隔离信源，不冒充 uid/secUid。 |
| [541](541-baijiahao-received-uid-secuid.png) | 以明确 uk 查询账号，实际响应 uid/secUid 分类型展示，不以字段外观互换。 |
| [542](542-baijiahao-three-typed-identities-bound.png) | 账号详情导入后复用原信源；SQL核实 uk、uid、secUid 三条绑定指向同一账号。 |
| [543](543-baijiahao-distinct-opus-and-url-identifiers.png) | 百家号 opusId 与原文 URL 的数字不同，页面保留两者事实，不强行做相等检查。 |
| [544](544-baijiahao-reused-author-full-html-imported.png) | 完整 HTML 作品沿已绑定 uid 导入同一信源；正文以安全纯文本查看，原 HTML 清洗后存入材料。 |
| [545](545-zhihu-missing-original-not-guessed.png) | 知乎缺少原文及时间单位仍明确展示，不根据 opusId 拼回答 URL，也不猜发布时间单位。 |
| [546](546-zhihu-original-evidence-dialog.png) | 对这一篇 article 人工核对原文、作者与范围，再填写证据；不是永久昵称映射。 |
| [547](547-zhihu-local-import-linked.png) | 实际导入隔离作者与文章，旧上游缺项事实保留；动作完成状态来自 article/source 关联。 |
| [548](548-zhihu-import-result-mobile.png) | 390px 原生视口：缺项原始事实、作者和文章链接、诊断入口均可读，无页面横向溢出。 |

run199–206 八次实际后台查询全部完成，新增8次 localhost HTTP、6篇材料、6个隔离且关闭全文的作者信源、9条分类型身份绑定；没有新增订阅、媒体读取或真实付费调用。懂车帝两次作品导入复用同一文章并保留完整正文，百家号三种账号标识复用同一信源。主/UI任务库均72项迁移至0075，九类UI预算已关闭，真实调用仍累计3次。

P5d-ui初次28项定向测试/TS/build通过；lead发现已关联结果仍可能显示保留的旧pendingReason，计本包实质1，修正后真实组件五状态渲染及TS通过。同页上下文说明一并校准。知乎弹窗首次自动化误向隐藏字段填写，未提交或增加请求；按实际展开状态纠正后完成，属于浏览器投射/脚本问题。当前542张有效原始截图均有逐处批注。

## P5e 源历史与当前任务归属

| 截图 | 批注 |
| --- | --- |
| [549](549-source-unified-formal-collection-history.png) | 同一源详情列出实际 SocialData 和 Redfox 正式任务；供应商取历史任务自身值。创建时间、该源关联材料数明确展示，未冒充新增数或抓取耗时。 |
| [550](550-source-active-budget-wait-health-separate.png) | run207因SocialData预算0等待，当前步骤、实际原因和下次尝试直接来自任务；信源健康仍正常、连续失败0。 |
| [551](551-source-active-operation-mobile.png) | 390px任务卡的长等待原因可换行，当前任务与源状态分栏呈现，没有把业务等待写成源故障。 |
| [552](552-source-operation-history-mobile.png) | 390px历史表在自身容器内横向滚动，不撑宽页面；任务链接、供应商和状态可达，材料/耗时列保留。 |
| [553](553-source-released-operation-history-retained.png) | 通过正常“放弃本轮”释放207占用后，当前任务为空且该正式任务历史仍保留；旧成功历史未丢失。 |

源详情实际发起run207、零预算等待、放弃与重载全过程没有增加供应商请求，SQL核实health=ok/fail_count=0/active_run_id=null，联合历史各任务唯一。后台的放弃沿现有failed终态语义，界面显示已结束；未增加另一个closed状态或abandoned字段。lead最初验收脚本误假设该字段/文案，已按实际契约纠正，不为脚本修改产品。后端57项不同定向测试、前端4项定向测试与对应类型检查/构建通过。当前547张有效原始截图均有逐处批注。

## P5f X 搜索作品与共用订阅

| 截图 | 批注 |
| --- | --- |
| [554](554-x-search-nonwork-subscription-blocked.png) | 选择People时普通查询仍可提交，但带入定时订阅禁用并说明只支持Top/Latest；不把全部查询类型冒充作品采集。 |
| [555](555-x-search-received-work-local-import.png) | 固定5K搜索作品保留实际tweetId、user.userId、用户名、正文与带时区时间；可显式本地导入，不以请求handle猜作者。 |
| [556](556-x-search-local-import-confirm.png) | 默认按实收稳定作者绑定归属，新作者隔离并关闭全文；没有新增人工补ID或跨作者选择动作。 |
| [557](557-x-search-imported-isolated-author.png) | 实际导入后链接真实作者与文章，去重身份为x:tweetId；重复按钮移除，源权限保持隔离。 |
| [558](558-x-search-shared-subscription-bounded-plan.png) | 查询条件只带入本地草稿；显式启用两页、四项上限与1440分钟周期，不宣称可替换未知高级查询语义。 |
| [559](559-x-search-collection-two-pages-same-author.png) | run209读取两页，页面分别保留returnedPage/nextParameters与实际文章关联，两条重复作品均复用query导入的同一文章和作者。本例因页数上限结束。 |
| [560](560-x-search-collection-summary-mobile.png) | 390px原生视口中页号、作品/研究数量及原始不透明游标可读，页面scrollWidth390。 |

run208/209共一次query、一次正式collection和3次localhost请求；1篇新文章、1个隔离作者，实际原串游标含首尾空白仍保持，两个采集结果都通过源页proof。3回执均一次attempt且completed，无媒体读取。临时订阅10已按领域命令停用，九类UI预算全关，真实仍3次。后端40不同专项/受影响回归、前端36项定向测试（其中新功能7项最终复验）及对应类型检查/构建通过，产品错误0；lead把“运行一轮”控件误写成不存在的等待文案后按DOM纠正，未重复创建订阅。当前554张有效原始截图均有逐处批注。

## P5g 转写、字幕及媒体附件与已有材料使用

以下32张均为本地合成响应和独立UI测试库。561在过时说明修正后重新拍摄，保留的是最终界面。保存动作不重开原任务；TXT来自已收转写，其他文件仅在明确保存后读取已收资源地址。

| 截图 | 页面 / 批注区域与验收 |
| --- | --- |
| [561](561-transcription-attachment-and-use-entry.png) | run150转写进度与结果动作：成功文本可以显式保存/关联/填空，进度说明已同步；原分享文案仍不冒充可信作品原文。 |
| [562](562-transcription-txt-save-confirm.png) | TXT保存确认：父结果249、格式、原因可见，只保存已收文本，不创建文章或调用供应商。 |
| [563](563-transcription-txt-saved-list.png) | 父结果下已存列表：附件606可跳转；同格式保存禁用，历史文件不能覆盖，显式刷新列表不读远端文件。 |
| [564](564-transcription-evidence-required-preserves-reason.png) | 空依据提交被拒绝：分享文案/任务ID不足以确认同一作品；对话框、原因和材料版本保留，依据可在框内修正。 |
| [565](565-transcription-fill-with-manual-evidence.png) | 只对合成夹具人工核对同一原文后补证；不凭昵称授予作者归属或发布权限。 |
| [566](566-transcription-fill-completed-no-overwrite.png) | 转写填入既有空正文后显示“已有，不能覆盖”，后续填空按钮禁用，文章原source保持。 |
| [567](567-private-txt-associate-existing-material.png) | 私有TXT显式关联已有材料，展示当前版本2及人工依据；正文已有仍允许附件关联。 |
| [568](568-private-txt-stale-version-retains-evidence.png) | 在独立夹具中把材料版本2改为3，旧版本提交实际409；未写关联，原因与证据保留。 |
| [569](569-private-txt-refresh-version-keeps-reason.png) | “重新读取材料版本”取得版本3，不清空原因/依据；可确认后重试。 |
| [570](570-private-txt-associated-existing-material.png) | 新版本确认后附件606关联成功，原转写正文未再次修订，材料链接可用。 |
| [571](571-subtitle-track-formats-safe-save-entry.png) | run210字幕轨道：原数组顺序SRT/VTT/json3分别选择；未知格式与javascript地址无保存动作，封面/描述不当字幕正文。 |
| [572](572-subtitle-srt-save-confirm.png) | 明确保存SRT格式序号0，不合并同语言的不同格式，也不允许输入任意下载地址。 |
| [573](573-subtitle-srt-private-download-and-use.png) | SRT成为私有文本附件610，可下载、关联或填空；父轨道原始文件地址保持。 |
| [574](574-subtitle-vtt-distinct-format-file.png) | VTT序号1保存为独立附件611，不覆盖SRT；两者分别保留文件格式与父结果。 |
| [575](575-subtitle-json3-explicit-format-confirm.png) | json3序号2显式保存，确认文字不承诺把未知JSON结构解析成正文。 |
| [576](576-subtitle-json3-associate-only.png) | json3附件612仅有材料关联，没有正文填空动作；SRT/VTT的正文能力仍保留。 |
| [577](577-subtitle-srt-same-original-fill-confirm.png) | SRT原输入与目标均为同一YouTube原生视频ID，按已证原文核对填空，无需猜测作者或ID。 |
| [578](578-subtitle-srt-filled-same-video.png) | 解析SRT去除时间轴及HTML标记后填入两段纯文本；已有正文后禁用再填，JSON文件未参与正文。 |
| [579](579-subtitle-json3-associated-without-body-action.png) | json3显式关联同一视频已有材料，既有SRT正文保持，不出现正文按钮。 |
| [580](580-media-audio-save-confirm.png) | 已收m4a媒体地址保存确认，不重新调用解析接口，不把媒体URL当作者/原文证明。 |
| [581](581-media-m4a-private-play-download-no-use.png) | 私有m4a附件613实际下载并播放；仅私有文件能力，没有材料正文使用或供应商上传动作。 |
| [582](582-media-actual-webm-private-play-no-body-use.png) | 上游URL虽为.mp4，实际字节识别为WebM，附件614以video/webm展示并实际播放，不做转码。 |
| [583](583-media-video-and-mp3-distinct-private-files.png) | 同页视频与MP3分别保存614/615，不因同父任务而互相覆盖，均无正文使用动作。 |
| [584](584-subtitle-attachment-delete-confirm-history.png) | 删除json3附件的既有删除确认：文件不可再下载，历史和结果保留，不创建新删除状态模型。 |
| [585](585-subtitle-deleted-file-retains-material-link.png) | 删除成功后仍可看关联材料；父列表显式刷新显示deleted，同格式不自动重下或重新保存。 |
| [586](586-media-private-image-validated-preview.png) | 图片附件616经实际解码为640×360 PNG，私有预览正常；图片不是作品原文，不能用于填正文。 |
| [587](587-mobile-subtitle-private-text-use.png) | 390px字幕附件：父结果、下载、材料状态及填空区域可读；页面宽度390，无全页横向溢出。 |
| [588](588-mobile-txt-associated-body-preserved.png) | 390px TXT：已关联材料、已存在正文状态及长原文地址正常换行。 |
| [589](589-mobile-media-private-image.png) | 390px图片附件：预览、字节/类型及私有操作在视口内，未出现材料使用动作。 |
| [590](590-asset-library-text-private-download-boundary.png) | 素材库说明新增文本边界：文本附件仅私有下载，不能作为普通上传或提交供应商。 |
| [591](591-asset-library-text-no-supplier-upload.png) | 素材库实际VTT/TXT卡片按文本展示，没有音视频标签、远端预览或供应商上传入口。 |
| [592](592-tools-explicit-attachment-capability-copy.png) | ASR与同步工具入口区分“本次查询只取结果”和后续显式附件动作；保留不自动下载、发布或改权限的说明。 |

实际新增一次localhost字幕查询、7次资源下载、8条附件/文件记录（TXT本地生成）；其中json3已通过正常UI删除。0篇新文章、0个新作者，2份原有空正文材料被填入，2份私有文本附件显式关联；实际下载TXT与完整转写逐字节一致，字幕保留换行/emoji。所有父run仍completed，无重新占用；媒体资源6条被桩单独记录的GET均无供应商凭证，另1张图片由原有通用资源处理器返回。九类UI预算再次全关，真实付费仍累计3次。

后端原59项专项/回归、附件关外发15项聚焦和相关类型检查通过。关总开关时新的远程下载返回503且0 GET/0文件/0附件；本地TXT、已有可用附件和完整本地孤儿仍可完成。此为现有外发边界对齐，没有新增开关或门禁。前端44项定向/TS/build通过；过时说明遗漏累计2处，按监督式开发交新Astra窄修，最终相关18项/TS通过。浏览器脚本曾在preload=none音频播放前等待loaded、以及预期字幕文本写错，均纠正验收脚本，未据此修改产品。当前至592共586张有效原始截图有逐处批注。

## P5 费用核对与当前页结果下载

| 图 | 页面与批注 |
| --- | --- |
| [593](593-costs-explicit-local-read-entry.png) | 费用入口只读已存数据；填写明确时区与起止时间，点击后读取，不自动请求供应商账单。 |
| [594](594-costs-attempt-groups-not-supplier-charges.png) | 本地外发尝试按服务、模型、来源、端点、环境、币种和依据分组；localhost 的 live 标记不当作真实付费。 |
| [595](595-costs-changed-filter-hides-old-report.png) | 改变所选账单页后旧报告收起，保留输入与清单，需再次明确读取。 |
| [596](596-costs-saved-page-points-no-exact-difference.png) | 旧合成账单141的两条相同记录分别保留；未知 Synthetic 原因不归入已确认 API 扣除，不计算精确差额。 |
| [597](597-costs-107-records-exact-points-face-value.png) | 新合成账单211实际107条：带符号积分−10.4、确认 API 消耗10.6、其他1条；1.06元仅为积分面值，非实际扣款。 |
| [598](598-costs-duplicate-records-and-unknown-positive.png) | 同秒相同积分逐条保留，正向0.2的 unknown_adjustment 按未知分类展示，不当作退款。 |
| [599](599-costs-local-second-group-seven-records.png) | 本地第二组实际7行，明确不是供应商翻页；没有新外发和虚构请求ID。 |
| [600](600-mobile-costs-explicit-query-conditions.png) | 390px费用查询条件、时区说明与所选账单页可操作，输入宽度保持在视口内。 |
| [601](601-mobile-bill-page-exact-points.png) | 390px账单事实、积分与面值说明可读；页面根宽390px，没有全页横向溢出。 |
| [602](602-mobile-bill-duplicates-unknown-positive.png) | 窄屏保留原记录表与未知正积分，表格可横向浏览，不将上游原时间改写成本地时区。 |
| [603](603-costs-invalid-zone-preserves-input.png) | 缺失时区的 ISO 时间实际被拒绝，错误指出可修正字段，输入和账单选择保留，未发起费用读取。 |
| [604](604-task-page-json-download-scope.png) | run211首批100条的下载入口明确“本页”；实际浏览器下载内容与当前结果 DTO 一致。 |
| [605](605-task-next-page-json-download-eight.png) | 翻到 cursor716 后下载8条；两份文件合计108个不同结果，无遗漏、重复或后台取全页。 |

后端账单4项实际DB/HTTP、前端7项定向/SSR及类型与构建通过。导出接口与SSR、鉴权及无副作用检查通过。浏览器实际创建一次合成账户查询，回执269仅一次attempt；账单读取、切换本地分组与两次JSON下载均没有供应商外发。精确小数、重复行、原参数空白、单页范围及四项不可直接比较依据由独立读取脚本核对。九类预算全关，真实调用仍3次。发现450、591、596–599的旧截图因浏览器长页缩放坐标错误为空白，已在同一真实页面重拍并逐项检查；没有修改图片内容。至605共599张有效原始截图已批注。


## P5h / P5k / P5l / P5m 详情、显式补全与结果过期

以下为Lead在独立UI测试库与本地桩完成的逐处验收。详情选项GET仅访问本地；实际详情查询、导入、绑定及采集恢复均通过各自明确入口执行。

| 图 | 页面与批注 |
| --- | --- |
| [606](606-douyin-explicit-work-detail-choice.png) | 抖音作品显式读取已确认详情选项，固定实收定位参数，不开放手填身份或自动换库；读取选项只访问本地数据。 |
| [607](607-xiaohongshu-explicit-work-detail-choice.png) | 小红书作品显示后台核实的详情接口与冻结作品定位，不用 AI 占位 ID 或昵称替代真实身份。 |
| [608](608-wechat-explicit-same-library-detail-choice.png) | 公众号作品保留所选库及其详情映射，冻结实收定位参数；不把详情查询当作实时发现或跨库回退。 |
| [609](609-tiktok-explicit-work-detail-choice.png) | TikTok 作品从实收作品 ID 提供单作品详情选项，账号称呼不补作稳定作者身份。 |
| [610](610-bilibili-explicit-work-detail-choice.png) | B站作品显示已确认详情接口及冻结 BV 定位，后续查询新建独立任务，不推进原采集游标。 |
| [611](611-weibo-explicit-work-detail-choice.png) | 微博有效搜索来源212/result725显示作品详情选项。旧collect40是历史详情回执，不是可用搜索原项；本次改用有效来源验收，并非产品修复。 |
| [612](612-autohome-explicit-typed-video-detail-choice.png) | 汽车之家按已收作品类型展示视频详情目标及冻结 typed 参数，作品命名空间不被笼统 ID 合并。 |
| [613](613-dongchedi-explicit-typed-work-detail-choice.png) | 懂车帝详情选项保留已确认作品 ID 与类型，不因外层账号上下文自行改写作者或作品类型。 |
| [614](614-yiche-explicit-video-detail-choice.png) | 易车视频作品显示已核实详情目标，冻结原作品定位，不提供任意地址或参数编辑。 |
| [615](615-douyin-account-locator-detail-choice.png) | 抖音账号选项仅使用后台已证明的账号定位字段；显式本地 GET 不调用供应商，也不自动绑定。 |
| [616](616-xiaohongshu-account-locator-detail-choice.png) | 小红书账号选项保留实收定位参数，不按展示昵称猜 userId；详情查询与后续绑定分开。 |
| [617](617-wechat-account-typed-locator-detail-choice.png) | 公众号账号选项展示冻结的 typed locator，库和账号定位由后台核实，不开放手填替换。 |
| [618](618-bilibili-account-mid-detail-choice.png) | B站账号详情选项使用已收到的 MID，保留完整字符串；本地读取选项不产生付费请求。 |
| [619](619-weibo-account-uid-detail-choice.png) | 微博账号详情选项使用已证明的 UID，不从请求词或昵称制造账号身份。 |
| [620](620-baijiahao-account-uk-detail-choice.png) | 百家号账号选项按该操作实收 uk 定位，uk、uid、secUid 不互换；选项读取仍仅本地。 |
| [621](621-x-search-independent-detail-entry.png) | X 搜索结果605提供“查询该作品详情”显式入口，使用实收 tweetId/userId；不要求已有正文或handle，不重开原任务、不自动导入。 |
| [622](622-tiktok-independent-detail-result-before-import.png) | TikTok 独立详情run213显示实收作品和作者事实，来源结果引用保留；尚未导入时仍需显式本地操作。 |
| [623](623-douyin-independent-account-result-before-bind.png) | 抖音独立账号详情run214显示实收账号定位和绑定入口，不因查询成功自动更改信源权限。 |
| [624](624-x-detail-raw-author-null-and-verified-context.png) | X详情run215的原author.username实际为null，context.username为search_author；两处分别展示，后台核实同一实收userId，不覆写原始author。 |
| [625](625-x-detail-local-import-confirm.png) | X详情本地导入确认仅提交操作原因，按稳定作者既有绑定归属；不手填身份、不提高参与或全文权限。 |
| [626](626-x-detail-imported-existing-article-body-preserved.png) | X详情实际关联原文章，保留既有正文与原归属；已关联状态提供真实文章/信源链接，重复导入按钮移除。 |
| [627](627-tiktok-detail-local-import-confirm.png) | TikTok详情显式本地导入确认，作品按实收作者归属，查询与导入不是同一自动动作。 |
| [628](628-tiktok-detail-imported-original-material.png) | TikTok详情导入后关联原材料，去重保留文章原归属；显示实际关联而非另存前端成功标记。 |
| [629](629-douyin-account-detail-local-binding-confirm.png) | 抖音账号详情绑定确认按实收稳定UID核对已有信源，仍需明确操作原因，不按昵称自动匹配。 |
| [630](630-douyin-account-detail-existing-binding.png) | 绑定后按UID复用已有external作者信源，没有提高该信源参与方式或全文权限。 |
| [631](631-mobile-x-detail-verified-context-and-existing-link.png) | 390px X详情页中原始author、核实上下文和已有文章链接可读；页面根宽度390，无全页横向溢出。 |
| [632](632-expired-result-local-metadata-no-actions.png) | 真实expireOperationResults仅把合成结果726老化并原位标为result_expired，原ID和receipt保留；卡片只显示本地元数据，没有导入、下载或自动重新购买动作。 |
| [633](633-mobile-expired-result-no-repurchase.png) | 390px过期结果卡显示原类型、实际过期时间与显式查询入口说明，不出现自动重买按钮或原内容操作。 |
| [634](634-collection-detail-requires-explicit-target.png) | 新采集订阅开启必要详情补全后，目标仍为空且必须显式选择；不自动选第一个接口或跨库。 |
| [635](635-collection-detail-selected-library-and-collect-cost.png) | 显式选择FK广域详情目标后显示目标库及collect请求估价，补全范围只覆盖可证明作品；估价不是整轮实扣承诺。 |
| [636](636-collection-detail-subscription-saved.png) | 正常UI保存订阅11，详情目标作为配置显式记录；不会因保存条件而另造任务或隐式预览详情。 |
| [637](637-collection-detail-budget-waiting-same-run.png) | run216在redfox.platform.detail步骤用完1次列表额度后等待；原pageReceipt274与index0保持固定，不重买列表，预算等待保留同一run。 |
| [638](638-collection-detail-stop-preserves-page-confirm.png) | 通过正常UI停止run216，确认文字说明保留恢复与订阅占用，已发请求仍可能完成计费，不保证远端取消或退款。 |
| [639](639-collection-name-interval-preserve-detail-run.png) | 仅修改名称和周期1440→1441后保存，run216和executionVersion1保持；名称/周期不被误判为执行配置变化。 |
| [640](640-collection-detail-resume-original-step-confirm.png) | 通过正常UI恢复原详情步骤，沿冻结目标与已保存列表继续，不创建另一轮或重新查询列表。 |
| [641](641-collection-detail-completed-same-run-two-receipts.png) | 同一run216完成第2次详情请求receipt275，当前3条结果；本轮仅2次localhost collect请求，无重买列表，原page与详情回执分别保留。 |

本轮查询新增3条详情链及1次微博搜索，共4次fake调用；169项范围没有新增真实付费调用，真实调用累计仍3次。原始截图保持不变。

补充订阅控件的原始截图与批注：

| 图 | 页面与批注 |
| --- | --- |
| [642](642-autohome-detail-page-blank-required.png) | 汽车之家文章详情LL接口要求显式填写整数page；初值保持空白并显示必填，不替管理员选择页码。仅编辑草稿，未保存或外发。 |
| [643](643-collection-source-type-change-needs-new-target.png) | 将文章采集改为视频类型后，原LL详情选择保留为“需重新选择”，不自动改投另一个详情接口；无隐式预览或新订阅。 |
| [644](644-mobile-collection-explicit-target-page-and-price.png) | 390px编辑器中改回文章类型后保留该操作草稿page=2；详情目标、必填参数与费用可读，页面根宽390。草稿没有保存。 |

独立SQL及localhost计数复核：run212–216五个任务均completed，6个新回执各1次attempt，分别为4次query与2次collect。X详情的原author.username仍为null，核实上下文另存；X/TikTok导入复用原材料且原正文保持，抖音账号沿用隔离external且全文权限仍关闭。run216原列表receipt274及详情receipt275共用同一轮，原项731与详情732关联同一材料；停止期间仅改名和周期保持executionVersion1，恢复没有重买列表。新文章和信源均为0。

临时Redfox订阅11已通过正常领域命令停用（正常停用使订阅执行版本升为2，不改已完成run冻结版本）；全部Redfox临时订阅停用，九类Redfox预算归零，无活动任务。两条既存SocialData/大加辣合成订阅配置保留；操作专用Worker不启动常规调度。验收脚本最初误把它们计入“全部订阅停用”，以及重跑时误用停用前版本，已修正证据口径，没有为满足断言改动其配置。SQL字段名假设也只修正脚本。证据为`/private/tmp/aihot-redfox-details-ui-evidence.json`与`/private/tmp/aihot-redfox-details-ui-evidence.log`。

至644共638张有效原始截图均有批注，像素检查未发现空白图，全部图片链接有效。真实付费接口仍累计3次；本轮没有真实生成、上传或生产操作。

## 最终整合：坏配置修正与本页多选导入

| 图 | 页面与批注 |
| --- | --- |
| [645](645-malformed-native-source-remains-visible.png) | 显式迁移的合成历史JSON null保持原样，信源页正常显示设置、权限和migration.review待处理任务；不因读库得到null而崩溃。 |
| [646](646-malformed-native-preflight-blocks-without-fallback.png) | 两个供应商预检均明确阻断“配置不是有效对象，请先修正”；订阅null不回退旧source快照，预检无供应商请求。 |
| [647](647-current-page-two-work-selection.png) | 当前页两个已具备信息的作品可全选，实际验证2→清空0→全选2；账号、研究及需逐条补证的结果不进入多选。此初版技术类型名称已由653的已收正文预览取代。 |
| [648](648-work-selection-one-reason-no-provider-call.png) | 一次确认使用同一操作原因，明确按顺序调用本地导入、首个失败停止、成功不回滚；没有批量供应商查询、新run或跨页全选。候选名称以653为最终状态。 |
| [649](649-work-selection-first-failure-preserves-reason.png) | 真实模拟第二个合成作者在确认前停用：第一项已关联、第二项422，页面停止且保留原因及第二项选择；服务端仍按当前作者状态复核。 |
| [650](650-work-selection-explicit-retry-completed-no-repurchase.png) | 恢复合成作者原enabled值后，管理员明确重试剩余项成功。此前手工422和此次200使用相同Idempotency-Key；没有自动续发、重买搜索或回滚第一项。 |
| [651](651-malformed-config-metadata-save-preserves-null.png) | 正常UI只改名称与周期30→31，源和订阅中的JSON null均保持，未被写成SQL NULL；不授予参与或全文权限。 |
| [652](652-malformed-config-explicit-repair-keeps-permissions.png) | 正常UI显式修正为合法query后保存成功；有效配置归订阅，原source快照仍保留null，信源继续停用、隔离且全文关闭。自建夹具验收后精确清理。 |
| [653](653-work-selection-readable-preview-and-page-reset.png) | 最终候选使用已收正文短预览，无标题时不再向用户显示技术kind。真实SPA点击“首批结果”后，选择从1清为0；原结果与过期项各自状态保持。 |
| [654](654-mobile-work-selection-page-scope-and-preview.png) | 390px多选范围、按钮、候选短预览和结果链接可读，根宽390；截图已按固定顶部导航偏移重拍，没有图像编辑。 |
| [655](655-mobile-work-selection-confirmation-and-reason.png) | 390px确认框中的原因输入、提交范围与取消/确认可用；本次仅打开并取消，没有导入或新外发。 |
| [656](656-shipinhao-query-copy-manual-import-boundary.png) | 视频号广域查询说明与已接通的逐条人工补证导入对齐：查询不自动翻页或导入，缺身份/原文时从具体结果核实。仅查看表单，未提交。 |
| [657](657-shipinhao-share-query-copy-no-implicit-import.png) | 实时分享链接详情分支同样说明逐条核实边界，不把实时详情当作自动入库或新作品发现。仅切换表单，未提交。 |

最终多选验收run218只新增1次localhost搜索、receipt276/attempt1，随后两条结果733/734均关联原有材料；本地导入、作者状态复核、手工重试和分页选择没有供应商外发。需要逐条核实的五类汽车/百家号/知乎作品，以及视频号/快手，不因多选绕过补证。多选组件对无合格候选的纯研究/过期/已关联页不显示空入口。候选命名展示缺漏累计1已修；15项相关测试及最终305项全部Web测试通过。导航期间不再发送下一项由实际执行helper的中断测试验证，本次未用浏览器延迟请求复测该项。

坏配置路径的33项专项及最终660项后端测试通过；类型检查首轮1处断言类型收窄已修，原失败日志保留。验收脚本曾误用日历日而非滚动24小时预算、猜测字段/设置键名及出现浏览器多匹配/指针偏移，均只修正脚本与精确清理，不据此改变产品规则。最终完整类型检查、Web构建、305项Web测试及Docker smoke通过；容器库18个种子/73迁移/0回执/0attempt，临时容器和新建卷已清理。真实调用仍3次，未真实生成/上传或操作生产。

最终至657共651张有效原始截图均逐处批注，最终像素/链接检查确认没有空白候选、缺失批注或断链。SQL和本地请求证据保留在`/private/tmp/aihot-redfox-{bulk-ui-evidence,null-metadata-ui-evidence,null-repair-ui-evidence}.json`。Redfox专用浏览器空间68已正常结束；本任务UI API、Web开发服务、操作Worker及localhost桩已停止。隔离测试库保留，九类Redfox预算均为0，全部Redfox临时订阅停用，无活动任务。
