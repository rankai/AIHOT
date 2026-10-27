# 全站含视频内容：免费补证与方案复审

日期：2026-10-24。代码基线：`codex/admin-workflow-usability` / `b90b198`。

对应[完整实施方案](../site-presentation-and-video-plan.md)。本轮只读代码、仓库内既有脱敏结论、官方公开文档和 AgentKey 免费 `describe_tool`。未执行供应商工具、未读运行库或真实凭据、未修改产品代码。

## 1. 判定口径与证据强度

用户最新决定：视频栏目覆盖全站已确认包含视频的公开内容，包括带视频的 X 推文、图文中的视频附件；信息不足先不纳入。只有经过现有身份/原文校验并进入材料链、满足已有公开资格的内容才可能进入列表。含视频确认不能替代这些条件。此前只收主体视频的口径已撤回。

- **字段契约**：官方说明明确字段和值的含义，可据实际收到的值判断。未知值保持未知；不能把数字字符串与布尔值随意转换。
- **专用路线契约**：官方明确返回原生视频作品，并且本条结果满足已验身份及结构契约，可识别；不能只看接口名称含 video。
- **样例组合**：只证明官方样例覆盖的字段组合，不宣称得到完整类型枚举。快手按此处理。
- **未闭合**：接口混合图文/视频、类型只给占位值或正向枚举不足；不猜类型。合成测试只验证本地处理，不能作为上游真实输出证据。

本轮通过官方页面及其公开 Markdown 读取补证；TikHub 部分页面在网页工具超时，改为直接下载同一官方 `.md` 文档核对。只保存短字段结论和链接，不把签名媒体地址、整份示例或临时文档拷入仓库。

## 2. 已有平台逐项证据与当前允许范围

| 平台 / 已有路线 | 本轮查到的官方证据与现有代码 | 最小实现结论 / 剩余边界 |
| --- | --- | --- |
| 抖音 Redfox 广域：`QSL2ZSXM`、`OWIBYU1V`、`FK67XDVQ` | [账号作品](https://redfox.hk/apis/douyin/QSL2ZSXM)、[搜索](https://redfox.hk/apis/douyin/OWIBYU1V)、[详情](https://redfox.hk/apis/douyin/FK67XDVQ)明确 `videoType` 是字符串：`0` 普通视频、`68` 图集、`63` 直播录屏。当前 `WideWork.passthrough()` 可保留它，导入仅取图片。 | **类型缺口已补齐。** 仅实际字符串 `0`、`63` 可据此确认视频，`68` 不据此确认，其他值未知。录屏是已有视频作品，不是新增直播功能。图片和视频可共存；仅明确类型证据互相矛盾时跳过，不能因有图片就排除。无需新调用或新接口。 |
| 抖音 Redfox 优质：`QEQLCKD6`、`774OBKK0` | [账号作品](https://redfox.hk/apis/douyin/QEQLCKD6)、[搜索](https://redfox.hk/apis/douyin/774OBKK0)把 `workType` 解释为视频/图文，示例值为中文 `视频`。 | **这两条的允许值可确认。** 精确 `视频` 可补，`图文` 不补；不能与广域的 `videoType` 数字编码混用。示例 JSON 本身有排版错误，不能整份照抄为成功响应 fixture。 |
| 抖音 Redfox 其他作品路线 | [优质详情 `0OT1E306`](https://redfox.hk/apis/douyin/0OT1E306)仅给 `workType=default`；[热门作品 `HUCIASU`](https://redfox.hk/apis/douyin/HUCIASU)字段称视频/图文但示例 `0`，无枚举映射；[AI 搜索 `I8P3HTVH`](https://redfox.hk/apis/douyin/I8P3HTVH)和[日增长榜 `WD6UT8DQ`](https://redfox.hk/apis/douyin/WD6UT8DQ)未提供可用的作品类型映射。[七日增长榜 `0ZB9S2FW`](https://redfox.hk/apis/douyin/0ZB9S2FW)本轮也未发现类型字段，不能从日榜或广域库借枚举。 | **独立结果仍不足。** 已有同作品、同作者且经过 origin 校验的列表证据可沿用；不能自动购买详情或把 `default`、榜单 `0` 当成视频。只阻塞缺证结果的视频标记，不阻塞已有查询/采集。 |
| 抖音 AgentKey → TikHub V4 搜索 | [官方 V4 文档](https://docs.tikhub.io/501036596e0.md)及本轮精确工具 describe 均明确返回匹配视频列表。既有[路线证据](2026-10-21-agentkey-route-matrix.md)确认 `data.data.itemList[].AwemeInfo`、`Video.ItemID` 与作品身份；当前 parser 合成 URL，但 URL 不作为类型依据。 | **可按专用路线闭合。** 固定 V4 工具、成功回执、本条 `AwemeInfo.Video` 和一致作品 ID 同时成立才补；不是所有 `douyin_work` 都直接标视频。没有 Video 作品结构或有冲突的条目保持未知。 |
| 抖音 AgentKey → TikHub APP 账号作品、详情 V2、话题作品 | [账号作品](https://docs.tikhub.io/186826223e0.md)、[详情 V2](https://docs.tikhub.io/232379587e0.md)、[话题作品](https://docs.tikhub.io/186826238e0.md)未给所需类型输出合同；V2 明确同时支持图文与视频。本轮 describe 也未补出正向枚举。官方[图文搜索 V3](https://docs.tikhub.io/394624794e0)证明该接口的 `aweme_type=68` 是图文，但不是这三条路线的完整正向合同。当前安全投影不保留 `aweme_type`，既有脱敏证据未记录它。 | **独立类型仍未闭合。** 不将 Redfox `videoType` 编码直接套到 TikHub，不从 `video.cover`、时长或合成链接猜。补齐方式是官方给出这三条的明确字段合同，或另获授权核对已知视频/图文的响应；本轮不调用。保留既有查询、订阅、材料能力，仅这些独立结果暂不新增含视频确认。 |
| 快手 Redfox：`27DQ6SF9`、`ZWR31P2A`、`UOM99OQI` | [列表](https://redfox.hk/apis/kuaishou/27DQ6SF9)、[搜索](https://redfox.hk/apis/kuaishou/ZWR31P2A)、[详情](https://redfox.hk/apis/kuaishou/UOM99OQI)的作品样例均有 `workType="1"`、作品级 `videoUrl`、视频时长；没有完整类型枚举，也没有可靠作者 ID/原生作品页。 | **有限组合可用，完整枚举未证实。** 仅 `workType="1"` + 有效作品级视频地址且无冲突，并完成既有逐条原文/作者人工核验的结果可补标记。不单凭 `1` 或封面判断。继续导入隔离 external 信源，再由现有权限/处理流程决定公开；定时查询结果仍不自动入库。 |
| 头条 Redfox：`PAB6Z75Y` | [详情官方字段](https://redfox.hk/apis/jinritoutiao/PAB6Z75Y)明确：布尔 `workType=true` 为视频、`false` 为图文；`hasVideo` 单独表示是否含视频。当前 parser 已接这两个字段，导入尚未保存含视频确认。[账号列表](https://redfox.hk/apis/jinritoutiao/R1IGR09H)的 `type` 示例为 `article`，未给完整视频枚举；[搜索](https://redfox.hk/apis/jinritoutiao/28CFGF5I)缺明确视频字段。 | **含视频条件已补齐。** 严格布尔 `workType===true` 或 `hasVideo===true` 可作正向证据，图文包含视频也符合新范围。仅页面类型 false 不是完整无视频反证；请求参数、任意下载地址不能代替合同。列表/搜索只用现有同作品已取详情，不默认追加请求。 |
| 头条 AgentKey | 当前 `toutiao-contract.ts` 只注册文章详情、评论、账号资料。[第二阶段结论](../agentkey-integration-plan.md)明确视频详情因 10400 未获得成功合同，属于 5 条暂缓路线。 | **更正原方案错误。** 不存在可直接复用的已开放 AgentKey 头条视频详情。本任务不恢复它，不跨供应商把 Redfox 列表串到 AgentKey 详情。 |
| 小红书 Redfox：`384C6W6B`、`XN3ULENA`、`KR1LPTBF` | [搜索](https://redfox.hk/apis/xiaohongshu/384C6W6B)、[账号作品](https://redfox.hk/apis/xiaohongshu/XN3ULENA)、[详情](https://redfox.hk/apis/xiaohongshu/KR1LPTBF)说明 `workType` 的视频/图文语义，给出 `normal`、`video`。当前结果已保留该字段。 | **类型缺口已补齐。** 精确 `video` 补含视频确认，`normal` 不据此确认，若存在独立已核视频附件则仍可纳入；不把文档示例中混入的说明字符串当作真实枚举。其它 AI/榜单记录没给类型时不推断。 |
| 小红书 AgentKey → TikHub | [统一详情](https://docs.tikhub.io/420136391e0.md)明确两类 `normal`、`video`，也明确视频笔记只返回封面不返回播放链接。当前 `xiaohongshu-parser.ts` 验证 `type`，转为 `record.workType`；已开放搜索/账号/话题作品共用此 note 投影。 | **无需再付费补类型。** 从现有验证后 `record.workType` 补媒体即可；无需额外视频播放接口。列表缺原文/作者的既有导入限制仍生效，推荐研究结果仍不导入。 |
| B 站 Redfox / AgentKey | [Redfox 视频详情](https://redfox.hk/apis/bilibili/TIN1NMTZ)和既有 AgentKey 视频路线/导入使用原生 BV 身份与视频 URL 校验；搜索的作者、专栏、动态等已分流。 | **已具备。** 只对通过现有视频作品身份校验的结果补标记；不把所有 B 站结果标成视频。缺封面不影响类型。 |
| 公众号 AgentKey → TikHub H5 | [官方 H5 文档](https://docs.tikhub.io/511928397e0.md)及本轮 describe 明确 `_content_type`：`article` 为经典图文、`immersive` 为沉浸图片页、`video` 为视频页、`unknown` 为未识别。当前 parser 已验证并保留。 | **视频页正向语义已核实。** 详情 `video` 可补；article/immersive/unknown 不能直接确认有或无视频附件，已有明确正文可另走本地识别。视频页无HTML不追加供应商请求。列表缺字段保持未知。 |
| 公众号 Redfox | [实时详情](https://redfox.hk/apis/gongzhonghao/I3CIBRI2)给 `videoLink`/视频片段列表；[广域详情](https://redfox.hk/apis/gongzhonghao/1LDQ7E1C)没有明确视频页类型。 | **新口径下实时详情缺口解除。** 本条非空有效 videoLink 可证明含视频，`import-wechat.ts` 已映射 kind=video，直接复用并加确认；gifList/audioLink 不混入。videoPageInfoList 内层结构未说明，不能凭任意非空数组猜。广域/列表仍缺证，不借用实时合同。 |
| X / SocialData | `providers/socialdata.ts:109` 接收原始 `photo/video/animated_gif`，但后两者同存 kind=video；[官方概述](https://docs.socialdata.tools/getting-started/overview/)说明 tweet 含媒体。 | 新输入原始 video 才写 confirmed，明确GIF不写；旧 kind=video 单独不足。已有内嵌quoted_status经父引用关系/ID/作者/原始video类型局部运行时校验后，可只给父材料合并含视频事实，不改变作者、不复制引用封面或递归抓取。官方通用详情示例没有视频对象，本结论的具体类型依据为现有接入契约，不冒称本轮获得新真实样本。 |
| X / Redfox 搜索 `5K5EG87P`、详情 `QCP75W33` | [搜索](https://redfox.hk/apis/X%28Twitter%29/5K5EG87P)、[详情](https://redfox.hk/apis/X%28Twitter%29/QCP75W33)明确当前帖 medias[].type 为 video/photo，并有非空视频例、durationMillis及variants。现有搜索/主采集映射仅保留photo。 | 可按本条 type=video 确认并补现有映射；无需播放流或新详情调用。文档未说明原平台GIF转换，不能宣称已证明其所有GIF都可严格排除；收到明确GIF/冲突信息仍不确认。 |
| X / Redfox 时间线 `API_1790148502632` | [时间线](https://redfox.hk/apis/X%28Twitter%29/API_1790148502632)明确 medias.videos 为“视频列表，无视频为空数组”；quoted/retweetedTweet 独立。未给非空视频元素字段。 | 本条 medias.videos 为符合合同的非空数组可保存含视频事实，无需编造元素/封面/播放链接。只读当前帖，不递归引用/转发；空数组/畸形/冲突不补。没有元素样例不应成为这个布尔事实的额外门禁。 |
| X / AgentKey→TikHub | [搜索](https://docs.tikhub.io/215701673e0.md)、[账号作品](https://docs.tikhub.io/191321711e0.md)、[详情](https://docs.tikhub.io/191321709e0.md)及免费 describe 仍未定义媒体层级；现有安全投影未保留。 | 仍缺证，不猜字段或借Redfox合同；查询/采集照常，缺证记录不入视频栏目。 |
| 微博 / Redfox | [搜索TXQPVGJG](https://redfox.hk/apis/weibo/TXQPVGJG)明确 type 为 pictures/video/hudongvote 等；[详情API_1789098514899](https://redfox.hk/apis/weibo/API_1789098514899)明确 videoUrl、duration、cover。 | 搜索 type=video 可补无封面确认；详情有效videoUrl沿现有 weiboMedia 映射，只补确认，不重建识别器。图片与视频共存不是冲突。 |
| 微博 / AgentKey→TikHub | [搜索](https://docs.tikhub.io/410358109e0.md)、[详情](https://docs.tikhub.io/410358103e0.md)称返回媒体，但未给具体输出层级，免费describe未补齐。 | 不猜page_info/media_info；账号作品也无已闭合媒体证据。缺口只影响该路线记录的视频资格。 |

## 3. 其它既有平台及非平台入口

以下是 AIHOT **现有 Redfox 路线**的媒体连接点清单，不是启动 AgentKey 第三阶段，也不新增平台 API。仅对表内已证合同做小范围媒体映射；未列举的混合路线保持现状，不为补齐平台数编写推断规则。

| 既有平台 | 免费证据 / 允许条件 | 保留边界 |
| --- | --- | --- |
| TikTok | [详情 `6SE9WIHJ`](https://redfox.hk/apis/tool-tiktok/6SE9WIHJ)、[账号作品 `R473NUE9`](https://redfox.hk/apis/tool-tiktok/R473NUE9)、[搜索 `PXZXY8KQ`](https://redfox.hk/apis/tool-tiktok/PXZXY8KQ)明确 `mediaType` 的 `video/photo`；只用精确 `video`。 | `workType=0` 不另猜语义；话题/喜欢列表缺类型时不从有 videoData 推断；沿现有作者、作品与原生链接校验。 |
| Instagram | [搜索 `GM0TISWI`](https://redfox.hk/apis/Instagram/GM0TISWI)、[详情 `Z9M88QI8`](https://redfox.hk/apis/Instagram/Z9M88QI8)区分图片1、视频2，详情另有轮播8。 | 顶层 `mediaType===2` 且字段不冲突可确认。轮播内确有视频也符合新范围，但本轮详情文档未给子项结构，不能仅因本地Child schema接受isVideo就认为已补证；子项缺证先不纳入。不以合成URL作唯一证据。 |
| YouTube | [搜索 `GC5SC5HS`](https://redfox.hk/apis/Youtube/GC5SC5HS)、[详情 `609DF2IR`](https://redfox.hk/apis/Youtube/609DF2IR)为视频作品合同，当前 `youtube.ts` 已校验 videoId 与原生 watch URL。 | 沿现有原生作品导入；`isLiveContent` 仅说明直播内容，不增加直播在线状态、播放流或订阅能力。评论/字幕不独立成为视频。 |
| 视频号 | [广域详情 `OE4KUEUO`](https://redfox.hk/apis/shipinhao/OE4KUEUO)有作品级 videoUrl；与快手共用现有人工原文核验导入。 | 对该详情实际有视频地址且无图文冲突、人工核验通过的作品补标记；没有明确作品级视频证据的列表或链接详情不猜。仍隔离导入，不用昵称绑定作者，不公开临时播放地址。 |
| 汽车之家 | [视频详情 `TE6AGWAF`](https://redfox.hk/apis/qichezhijia/TE6AGWAF)明确专用视频合同，`videoType=0/4` 是原创/车家号命名空间。 | 复用现有 `import-qichezhijia.ts`/origin 的作品和作者空间校验；只有已验证视频详情或已有明确 video 命名空间结果，不能仅凭车家号页面 URL 推断。 |
| 懂车帝 | [详情 `QQ5E3EZ9`](https://redfox.hk/apis/dongchedi/QQ5E3EZ9)：请求 video/article，响应 workType1图文、2视频；现有导入已经拒绝冲突。 | 响应2且请求/来源命名空间一致才补。官方示例请求 video 却响应1，是冲突反例，不能修成假成功样例。其它列表只复用现已验证的 video 命名空间。 |
| 易车 | [视频详情 `3BXWEB6Y`](https://redfox.hk/apis/yiche/3BXWEB6Y)为专用视频；现有导入/来源关联已经区分 article/club/video。 | 复用已核验 video 命名空间，文章/论坛若有已核附件视频也符合范围，但当前表仅证实专用视频合同，不能借名称推断其它结果。 |
| 百家号 | [视频详情 `API_1789097000761`](https://redfox.hk/apis/baijiahao/API_1789097000761)与文章详情分开，现有导入按专用路线判命名空间。 | 只对现有视频详情、原文/作者/作品身份已闭合的材料补标记；列表、人工单填类型、播放链接本身不是替代证据。 |

当前 `sources/platform-execution.ts` 没有独立西瓜作品材料导入分支。本任务不把目录接口扩展成新平台采集链。

| 非平台入口 | 免费核实的现状及标准 | 最小补齐 |
| --- | --- | --- |
| RSS/Atom | `sources/rss.ts` 仅取图片enclosure/正文图片；[RSS2规范](https://www.rssboard.org/rss-specification)规定enclosure的type为MIME；[Atom规范](https://www.rfc-editor.org/rfc/rfc4287#section-4.2.7)定义enclosure链接及type | 同一XML解析中接本条明确video MIME；验证URL，无需请求媒体。保持候选身份/回填/任务逻辑，不扩展付费流程。 |
| Media RSS | [官方规范](https://www.rssboard.org/media-rss)定义media:content的type/medium，video为明确媒体类型 | 只读本条明确视频媒体节点，排除角色/类型冲突；无需支持完整Media RSS扩展体系。 |
| 现有正文提取 | `content/extract.ts` 用Readability/linkedom取正文，当前只取图片；[HTML标准](https://html.spec.whatwg.org/multipage/media.html#the-video-element)定义video及src/source资源 | 在已确认正文片段中读明确video，sanitize删除source之前仅提取事实；不扩大HTML许可，不把全页广告/示例代码当正文视频，不加网络请求。 |
| JSON/外部ingest | `ingest/items.ts` 没有media输入合同；raw任意结构不受媒体校验 | 不扩展外部协议、不信任自报confirmed。若已有正文提取有证据可纳入，否则未知。 |

保留确认事实独立于图片数量截断，不让RSS六图/正文十二图上限挤掉视频项。不加JS/iframe/JSON-LD通用识别器、播放器、爬虫或模型分类。

## 4. 尚未闭合的边界与最小补证路径

| 剩余事项 | 具体阻塞什么 | 最小方式 |
| --- | --- | --- |
| TikHub抖音APP账号/详情/话题；X/微博媒体输出层级 | 对应独立结果的含视频确认；其它已证路线不受影响 | 先取官方具体合同；若确需真实对照响应则另行授权，不调用兜底、不猜字段。 |
| Redfox抖音占位类型/榜单；公众号广域/列表及头条列表无附件信息 | 没有同作品明确详情的这些条目 | 使用已经取得且身份匹配的详情；否则未知，不自动补购。 |
| Redfox X 的原平台GIF归类；Instagram轮播子项字段 | 不能承诺上游video对全部GIF的严格分辨；没有已核视频子项的轮播暂不确认 | 对Redfox按官方明确video事实处理，明确GIF/冲突排除；供应商如给进一步语义再收窄。轮播需官方子项合同，不能用本地宽schema冒充证据。 |
| X引用对象只有链接或媒体关系未验证 | 这些引用不能用于确认父帖含视频；SocialData已验证的完整内嵌引用不受此阻塞 | 利用现有quoted_status本地校验，原始video可补父材料事实；仅旧quoted.kind=video不足，不复制引用作者/封面、不递归，保留原转发导入限制。 |
| RSS/网页只有iframe/JS/未取得的正文，外部raw无合同 | 对应记录暂不进入栏目 | 不追查；以后有实际需求再按具体入口扩展，不预建通用媒体发现系统。 |
| 快手/视频号作者原文缺失 | 不允许自动归属/公开 | 复用已确认的人工路径与隔离权限，视频字段不能替代作者证据。 |
| 真实历史数量、旧回执是否仍在、旧X视频/GIF已合并 | 无法承诺历史全覆盖 | 以后获准运行库dry-run；有原始明确类型才补，证据清理后不重采。 |
| AgentKey头条视频详情等5条路线 | 原路线继续暂缓 | 不在本任务恢复，也不是视频栏目上线前置。 |

缺口只影响具体记录，不阻塞栏目管理或已证内容。未知不新增任务状态，不触发自动补查/模型判定。

## 5. 架构复用与整体复审

上一轮已确认的settings复用、展示保存沿用最后一次有效保存与审计、pool统一分页、旧结果严格投影兼容继续有效。范围扩大后，以下修正已纳入完整方案：

| 发现/设计取舍 | 级别 | 最小处理 |
| --- | --- | --- |
| 主体视频标记与X排除已经不符合新范围 | 范围变更 | 撤回primary及主体/附件分类；article仍是一条，统一含视频筛选。 |
| 直接筛kind=video会把旧SocialData动图混入 | P2 | articles.media只加可选confirmed，旧模糊记录不自动确认；不新增GIF公开枚举、不改旧显示。 |
| X两处媒体表示容易各自成为栏目权威 | P2 | articles.media唯一管筛选，x_post.media保留原展示；不双写确认字段、不顺带重构X。 |
| 全站含视频若只接顶层附件，会漏掉SocialData已取得的内嵌引用 | P2 | `sources/x.ts`已有引用正文/URL/媒体；局部校验父引用关系、引用ID/作者及原始video类型后只补父材料事实，不扩展转发导入、不复制封面、不递归、不加role状态。旧引用kind歧义仍排除。 |
| 媒体填空在旧seen判断前、正文修订直接覆盖；raw.resultId非最新时间线 | P2 | 同源同作品、文章锁、当前revision/media快照；各分支共用合并，迟到不覆盖，无法证明更新的反证跳过。纯媒体变动不入队分析。 |
| 仅供应商导入接通会漏掉主采集、RSS/正文现有确定信息 | P2 | 列清主采集/订阅/手工入口，RSS与正文只做已取数据的局部映射，防图片上限挤掉事实。 |
| 微博/公众号已有videoUrl/videoLink映射却另建识别逻辑 | P3 | 直接复用weiboMedia/importWechatResult，只加可信确认及有据历史合并。 |
| 要求时间线视频元素完整样例才保存布尔事实，会形成不必要门槛 | P3 | Redfox已明确medias.videos语义，非空合法集合即可确认；不映射未证元素的封面/流。 |

最小持久化为settings一项配置及既有video媒体JSON一项确认字段；没有新表、队列、任务状态、供应商框架、播放器或额外付费流程。正式验证仍需在授权开发后执行，当前只做文档/代码静态核对。

独立复审发现1项P2：遗漏SocialData已取得且可核验的内嵌引用视频。现已同步修正主方案范围、局部校验/合并、证据边界和验收；定向复核通过，未发现剩余P1/P2/P3。两文的本地链接与格式检查通过，工作区仅这两份方案文档变化，未改产品代码或执行测试/数据库操作。

此结论是方案静态审阅，不是实现或运行验收。免费官方查询已完成；未调用供应商业务接口、未读凭据/运行数据，未提交、推送、合并或部署。
