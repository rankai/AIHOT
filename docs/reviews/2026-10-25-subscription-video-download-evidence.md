# 订阅视频私有下载：免费文档证据

日期：2026-10-25。调查基线：`9236700` / `codex/site-presentation-video`。本文记录实施前免费文档调查，**不证明真实上游文件已下载**。同日实现与本地桩验收已完成，见[验收报告](2026-10-25-subscription-video-download-acceptance.md)；本页上游证据边界不因本地桩通过而升级。

调查阶段只读当前契约、目录和既有脱敏证据，并免费 GET 官方公开文档。Redfox 核对了 71 页采集/详情文档及 10 条媒体工具文档元数据；TikHub/SocialData 核对当前固定路线。未调用 `execute_tool`、供应商业务 API、视频/CDN 文件或付费服务，未读凭据、运行库和真实回执，未开发、运行采集、提交或发布。正文不保存上游完整样例或签名媒体地址。

## 1. 当前决定与证据口径

用户已确认的新方案是：**成功进入材料链且已确认含视频的内容，保存全部已确认视频的私有副本；缺少可用地址时允许按预算付费解析；文件保存 30 天后删除。** 单个视频超过 50MB 时尝试同一视频的非高清/较低清晰度版本，有不超过 50MB 的版本才下载；没有合适版本则后台空图占位并注明“原视频过大”，前台封面和原站链接不变。解析固定复用 Redfox 已有九个专用下载器，采集可以来自 AgentKey，解析来自 Redfox；这一组合须在代码注释和后台展示中明确，不自动改换服务。上述决定已按本地验收报告实施，本轮不执行付费调用，也不改变网站“详情 → 原站观看”的公开展示选择。

旧记录中的“不自动追加解析”反映此前未确认的范围；本方案已获得缺地址付费解析授权，但仅使用第 4 节固定映射，仍受预算、回执和失败恢复约束。确认视频、成功入库、拿到地址、下载完成分别是独立事实：查询结果、封面、视频 ID、播放器页面和下载工具的成功响应都不能相互替代。

| 证据 | 能确定什么 | 不能据此确定什么 |
| --- | --- | --- |
| 明确类型/附件合同 | 本条包含视频；可沿既有身份与原文校验进入材料链 | 文件地址、可达性、下载完成 |
| 原站作品/分享/播放页面 URL | 内容身份和原站入口 | CDN 文件地址；YouTube 的 `videoUrl` 就属于页面 |
| 封面/缩略图/原始封面 | 图片资源 | 视频文件；位于视频域名也不能改变含义 |
| 视频/播放地址 | 有已声明语义的媒体候选 | 无水印、音画完整、长期有效、原始上传文件 |
| 明确下载/无水印下载字段 | 按字段合同选择下载候选 | 每次必有值、实际可达、字节等同原始上传文件 |

以下 `[]` 表示数组项。Redfox 路径相对完整官方响应；本地 parser 通常已解开 `data`。TikHub 使用 `P` 表示供应商 payload，`E` 表示 AgentKey envelope，通常 `P=E.data`；历史多层 `data` 按证据保留，不统一删除。表中“无地址”指已核路线没有已闭合的地址合同，不宣称平台永远不能下载。

## 2. Redfox 当前采集/详情路线

### 2.1 已明确下载地址

| 平台 / 操作 | 精确字段与官方链接 | 结论和边界 |
| --- | --- | --- |
| TikTok 详情、账号、搜索 | [6SE9WIHJ](https://redfox.hk/apis/tool-tiktok/6SE9WIHJ)：`data.videoData.*`；[R473NUE9](https://redfox.hk/apis/tool-tiktok/R473NUE9)、[PXZXY8KQ](https://redfox.hk/apis/tool-tiktok/PXZXY8KQ)：`data[].videoData.*`。`playAddress`=播放、`downloadAddress`=带水印下载、`downloadNoMarkAddress`=无水印下载。 | 可直接选择实际收到的无水印下载候选。`shareLink` 是作品页，`coverImage/originCoverImage/dynamicCoverImage` 都是封面；原始封面不代表原始视频。空值或不可用地址再按固定 Redfox 解析路线处理。 |
| TikTok 话题、喜欢 | [API_1790149158205](https://redfox.hk/apis/tool-tiktok/API_1790149158205)、[API_1790581450500](https://redfox.hk/apis/tool-tiktok/API_1790581450500)：`data.workList[].videoData.{playAddress,downloadAddress,downloadNoMarkAddress}`，语义同上；`data.workList[].mediaType` 明确 `video/photo`，样例有 `video`。 | **本次已比 10-24 历史证据补齐类型与地址**，不再沿用“话题/喜欢缺类型”的结论。喜欢作品的作者按每条作品确定，不以收藏者替代。 |
| 易车视频详情 | [3BXWEB6Y](https://redfox.hk/apis/yiche/3BXWEB6Y)：`data.resources[].downloadUrl`=视频下载地址；`data.resources` 说明包含多个清晰度。`data.coverUrl` 是封面。 | 有明确下载候选；资源元素只定义 `downloadUrl`，没有清晰度标签、排序或大小合同，不能声称可选最高画质。官方 `workUrl` 样例为字符串 `[]`，不能当有效原文链接。 |
| 头条账号作品 | [R1IGR09H](https://redfox.hk/apis/jinritoutiao/R1IGR09H)：`data.workList[].downloadUrl`=视频下载地址数组，文章时为空；`workUrl`=作品原始链接。 | 下载集合语义已明，但官方样例数组为空，**未定义元素结构**。不能发明 `downloadUrl[].url` 或假定全部视频非空；只接受实际收到且能按既定严格结构验证的值，其他保持缺地址。固定九下载器没有头条映射。 |

### 2.2 已有播放或视频媒体候选

| 平台 / 操作 | 精确字段与官方链接 | 结论和边界 |
| --- | --- | --- |
| X 搜索、详情 | [5K5EG87P](https://redfox.hk/apis/X%28Twitter%29/5K5EG87P)：`data.tweets[].medias[].variants[].url`；[QCP75W33](https://redfox.hk/apis/X%28Twitter%29/QCP75W33)：`data.medias[].variants[].url`，均称播放地址。同项 `contentType` 明确 `video/mp4` 或 `application/x-mpegURL`；媒体 `type`=video/photo，`coverUrl`=封面。 | 只取本条已确认视频；MP4 与 HLS 分开，保存 m3u8 清单不等于保存视频。`bitrate` 是码率，不能证明原始上传文件。 |
| 微博详情 | [API_1789098514899](https://redfox.hk/apis/weibo/API_1789098514899)：`data.videoUrl`=视频 URL，样例为 MP4；`data.cover`=封面、`data.opusUrl`=博文页。 | 有媒体候选，未保证下载/无水印/原文件。搜索 [TXQPVGJG](https://redfox.hk/apis/weibo/TXQPVGJG) 只有 `data[].url` 博文页，`type=video` 仅证类型。没有固定微博下载器。 |
| 公众号实时详情 | [I3CIBRI2](https://redfox.hk/apis/gongzhonghao/I3CIBRI2)：`data.videoLink`=视频链接；`coverImageUrl`=封面；`articleUrl/originalUrl/sourceLink`=页面/来源链接。 | `videoLink` 非空且合法时是媒体候选，官方样例为空。`videoPageInfoList[].mpVideoTransInfo` 是转码信息数组，但无内部地址合同；`dramaVideoInfo`、`downloadState` 也不能补出 URL 或下载完成。没有固定公众号下载器。 |
| 视频号广域 | [E7G00COY](https://redfox.hk/apis/shipinhao/E7G00COY)、[OVUTOTCV](https://redfox.hk/apis/shipinhao/OVUTOTCV)：`data.list[].videoUrl`；[OE4KUEUO](https://redfox.hk/apis/shipinhao/OE4KUEUO)：`data.videoUrl`，均称视频 URL；`coverUrl/thumbUrl` 是封面/缩略图。 | 有媒体候选。**当前无自动材料导入**，稳定作者/原文仍依现有人工核验及隔离路径；不能宣称配置订阅即自动下载。 |
| 快手 | [27DQ6SF9](https://redfox.hk/apis/kuaishou/27DQ6SF9)、[ZWR31P2A](https://redfox.hk/apis/kuaishou/ZWR31P2A)：`data.list[].videoUrl`；[UOM99OQI](https://redfox.hk/apis/kuaishou/UOM99OQI)：`data.videoUrl`，样例为 MP4；`coverUrl` 是封面。 | 有媒体候选。**当前无自动材料导入**，作品/作者/原文人工核验仍是入库门槛；已有下载器不补这个权限和身份缺口。 |
| Instagram | [GM0TISWI](https://redfox.hk/apis/Instagram/GM0TISWI)：`data.items[].videoUrl`；[Z9M88QI8](https://redfox.hk/apis/Instagram/Z9M88QI8)：`data.videoUrl`=视频播放地址，图片时 null；`imageUrl/thumbnailUrl` 是封面/缩略图。 | 顶层有媒体候选。搜索轮播子项的 `carouselItems[].isVideo/mediaType` 已说明类型，但仅给 `thumbnailUrl`，没有子项视频地址合同；本地 Child schema 接受 `videoUrl` 不构成上游证据。 |
| 百家号视频详情 | [API_1789097000761](https://redfox.hk/apis/baijiahao/API_1789097000761)：`data.playUrl`=视频播放 URL（样例 MP4），`posterImage`=封面，`url`=作者主页。 | 有播放候选，尤其不能把 `data.url` 当视频文件。没有固定百家号下载器。 |
| 汽车之家视频详情 | [TE6AGWAF](https://redfox.hk/apis/qichezhijia/TE6AGWAF)：`data.videoUrl`=播放链接（样例 MP4），`cjhUrl/ycUrl`=作品页、`coverUrl`=封面。 | 只有已取得的视频详情提供媒体候选。`videoType=0/4` 是原创账号/车家号命名空间，不是文件格式。没有固定汽车之家下载器。 |
| 易车账号列表 | [YGYYT0G0](https://redfox.hk/apis/yiche/YGYYT0G0)：`data.workList[].videoUrl`=视频播放链接，部分类型 null；`workUrl/communityUrl/articleUrl` 是作品页面。 | 有实际非空播放候选时可验证；不能从作品页合成文件地址。没有固定易车下载器，已取得的专用详情另见上表。 |

### 2.3 只有页面、封面或身份，未闭合下载地址

| 平台 / 必要操作 | 精确字段与官方链接 | 阻塞什么 |
| --- | --- | --- |
| 抖音广域 | [QSL2ZSXM](https://redfox.hk/apis/douyin/QSL2ZSXM)、[OWIBYU1V](https://redfox.hk/apis/douyin/OWIBYU1V)：`data.list[].opusUrl/coverUrl/imageUrlList`；[FK67XDVQ](https://redfox.hk/apis/douyin/FK67XDVQ)：对应 `data.*`。 | 作品页、封面、图文图片；`videoType=0/63` 只证视频类型。需固定抖音下载器解析。 |
| 抖音优质及榜单 | [QEQLCKD6](https://redfox.hk/apis/douyin/QEQLCKD6)、[774OBKK0](https://redfox.hk/apis/douyin/774OBKK0)：`data.list[].workUrl/coverUrl`；[0OT1E306](https://redfox.hk/apis/douyin/0OT1E306)：`data.workUrl/coverUrl/audioUrl`；[HUCIASU](https://redfox.hk/apis/douyin/HUCIASU)：`data[].workUrl/coverUrl`；[I8P3HTVH](https://redfox.hk/apis/douyin/I8P3HTVH)：`data.list[].url/coverUrl`；[WD6UT8DQ](https://redfox.hk/apis/douyin/WD6UT8DQ)、[0ZB9S2FW](https://redfox.hk/apis/douyin/0ZB9S2FW)：`data[].share_url/cover_url`。 | 无视频文件地址；音频不能替代视频。部分优质/AI 样例非法 JSON，字段表不能冒充可运行成功样例。作品类型未闭合的结果仍先卡在确认视频门槛。 |
| 头条搜索、详情 | [28CFGF5I](https://redfox.hk/apis/jinritoutiao/28CFGF5I)：`data[].opusUrl`；[PAB6Z75Y](https://redfox.hk/apis/jinritoutiao/PAB6Z75Y)：`data.workUrl`。 | `hasVideo/workType/duration` 不提供地址，不能套账号列表 `downloadUrl` 合同；无固定解析器。 |
| 小红书主体路线 | [XN3ULENA](https://redfox.hk/apis/xiaohongshu/XN3ULENA)、[384C6W6B](https://redfox.hk/apis/xiaohongshu/384C6W6B)：`data.list[].workUrl/coverUrl`；[KR1LPTBF](https://redfox.hk/apis/xiaohongshu/KR1LPTBF)：`data.workUrl/coverUrl`。 | `workType=video` 只证类型；需固定小红书下载器解析。 |
| 小红书其它订阅 | [047JJ3UA](https://redfox.hk/apis/xiaohongshu/047JJ3UA)：`data.list[].url/coverUrl`；[3X8FGEEM](https://redfox.hk/apis/xiaohongshu/3X8FGEEM)：根级 `articles[]/latestHotArticles[]` 的 `shareInfoLink/cover`；[LBYLC5AK](https://redfox.hk/apis/xiaohongshu/LBYLC5AK)、[AEA6YE0J](https://redfox.hk/apis/xiaohongshu/AEA6YE0J)：`data[].photoJumpUrl/coverUrl`；[P3W2W18P](https://redfox.hk/apis/xiaohongshu/P3W2W18P)：`data[].coverUrl`。 | 无播放/下载地址；洞察响应不能统一加 `data`。仍须先有本条可靠视频证据和入库身份。 |
| B站 | [TIN1NMTZ](https://redfox.hk/apis/bilibili/TIN1NMTZ)：`data.picUrl`；[LEN9QXR3](https://redfox.hk/apis/bilibili/LEN9QXR3)、[VPA67I98](https://redfox.hk/apis/bilibili/VPA67I98)：`data.workList[].picUrl`。 | 仅封面、BV 身份和统计，`playCount` 是播放数。合成原站页不提供文件；需固定 B站下载器。 |
| X 时间线 | [API_1790148502632](https://redfox.hk/apis/X%28Twitter%29/API_1790148502632)：`data.pinned.medias.videos`、`data.timeline[].medias.videos`。 | 视频集合语义明确，内部无地址字段/非空样例；不可借搜索 `variants` 结构。缺地址可走固定 X 下载器，引用/转发仍须验证媒体归属。 |
| 公众号优质/广域/榜单 | [XEO0QQNF](https://redfox.hk/apis/gongzhonghao/XEO0QQNF)、[1LDQ7E1C](https://redfox.hk/apis/gongzhonghao/1LDQ7E1C)：`data.workUrl/sourceUrl/coverUrl`；[PW97QFBS](https://redfox.hk/apis/gongzhonghao/PW97QFBS)、[FVQ8D4W5](https://redfox.hk/apis/gongzhonghao/FVQ8D4W5)、[XNV30XZ3](https://redfox.hk/apis/gongzhonghao/XNV30XZ3)、[8IQD0BJC](https://redfox.hk/apis/gongzhonghao/8IQD0BJC)：对应 `data.list[].*`；[IE0887SO](https://redfox.hk/apis/gongzhonghao/IE0887SO)：`data.list[].url/coverUrl`；[ZIGAGYYT](https://redfox.hk/apis/gongzhonghao/ZIGAGYYT)、[OFFSPQ0U](https://redfox.hk/apis/gongzhonghao/OFFSPQ0U)：`data[].oriUrl/coverUrl`；[DL4YNCTQ](https://redfox.hk/apis/gongzhonghao/DL4YNCTQ)：`data[].maxWork/minWork` 的 `oriUrl/coverUrl`。 | 作品/阅读原文页和封面；不能借实时详情 `videoLink`。没有固定公众号解析器。 |
| 视频号实时链接详情 | [MH5YA9DL](https://redfox.hk/apis/shipinhao/MH5YA9DL)：`data.cover`=封面。 | 无视频地址；不能因封面域名像视频域名就下载。仍不能自动导入。 |
| YouTube | [GC5SC5HS](https://redfox.hk/apis/Youtube/GC5SC5HS)：`data.videos[].videoId/thumbnails[].url`；[609DF2IR](https://redfox.hk/apis/Youtube/609DF2IR)：`data.videoUrl` 明确视频播放页 URL。 | 原站 watch 页、缩略图和 `playabilityStatus` 均非文件地址；需固定 YouTube 下载器。 |
| 知乎 | [API_1789095347662](https://redfox.hk/apis/zhihu/API_1789095347662)：`data[].opusId/uid/nickname/publishTime/title/isEnd`。 | 无地址；请求 `vertical=zvide` 不构成逐条媒体合同，也没有固定知乎解析器。 |
| 西瓜 | 当前 Redfox 契约/目录及官方 [platforms](https://redfox.hk/story/web/api/doc/platforms) 无独立西瓜平台或 operation。 | 不属于当前独立订阅路线；不能以 `365yg` 域名或通用下载工具补出接入事实，不扩 AgentKey 第三阶段。 |
| 百家号搜索/文章 | [API_1789097000858](https://redfox.hk/apis/baijiahao/API_1789097000858)：`data[].titleLink`；[API_1789097000710](https://redfox.hk/apis/baijiahao/API_1789097000710)：`data.opusUrl/imageList`。 | 页面和图片；不借视频详情 `playUrl`，没有固定解析器。 |
| 汽车之家搜索/账号/文章 | [CI7VW144](https://redfox.hk/apis/qichezhijia/CI7VW144)：`data[].workUrl/coverUrl`；[4BOZ9DLE](https://redfox.hk/apis/qichezhijia/4BOZ9DLE)：`data.workList[].workUrl/coverUrl`；[LLCI8QTE](https://redfox.hk/apis/qichezhijia/LLCI8QTE)：`data.workUrl/coverUrl`。 | 页面和封面；视频命名空间不提供媒体地址，没有固定解析器。 |
| 懂车帝 | [QQ5E3EZ9](https://redfox.hk/apis/dongchedi/QQ5E3EZ9)：`data.videoId/articleVideoId/coverUrl`；[W86F8SSK](https://redfox.hk/apis/dongchedi/W86F8SSK)、[API_1791793668086](https://redfox.hk/apis/dongchedi/API_1791793668086)：`data.workList[].workUrl`，账号另有 `videoId/coverUrl`。 | ID、页面和封面；不能合成文件 URL。详情官方请求 video 却响应图文的冲突不能修成正例。没有固定解析器。 |
| 易车搜索/文章 | [YIGCY5US](https://redfox.hk/apis/yiche/YIGCY5US)：`data[].workUrl`；[VYSP68M2](https://redfox.hk/apis/yiche/VYSP68M2)：`data.coverUrl/shareImageUrl`。 | 页面和图片；没有固定解析器，已取视频详情的明确下载地址独立成立。 |

## 3. AgentKey → TikHub 与 SocialData

当前固定工具名与路由以仓库 [AgentKey 路线矩阵](2026-10-21-agentkey-route-matrix.md)、`routes.ts`/各平台 contract 及 catalog 为准。下表按后台 operation 名标识固定路线，不引入同供应商目录里的替代接口。

| 平台 / 当前 operation 与官方文档 | 已有精确证据 | 下载结论与固定解析范围 |
| --- | --- | --- |
| 抖音 `search/account_posts/detail/topic_posts`：[V4 搜索](https://docs.tikhub.io/501036596e0.md)、[APP账号](https://docs.tikhub.io/186826223e0.md)、[详情V2](https://docs.tikhub.io/232379587e0.md)、[话题](https://docs.tikhub.io/186826238e0.md) | 历史搜索 `P.data.data.itemList[].AwemeInfo.Video.Cover.UrlList`；账号 `P.data.aweme_list[].video.cover.url_list`；详情 `P.data.aweme_detail.video.cover.url_list`；话题有 `mix_list[].aweme_info`。均未记录下载字段；分享/合成原站链接为页面。V4 专用视频结构与 APP 混合图文/视频合同不同。 | 当前固定官方页未闭合播放/下载输出。成功入库且已确认视频后，可走 Redfox `0W27H3O6`；不从封面猜流。 |
| 头条仅开放 `article_detail`：[文章详情](https://docs.tikhub.io/251380586e0.md)；另有评论/账号资料 | 无媒体下载字段合同。[视频详情](https://docs.tikhub.io/251380587e0.md) 历史 `err_no=10400/data=null`，仍暂缓，非已接能力。 | 无已闭合下载字段，也无固定头条解析器；不恢复暂缓路线或串接到未开放 AgentKey 视频详情。 |
| 小红书 `search/account_posts/detail/topic_posts`：[搜索](https://docs.tikhub.io/420136398e0.md)、[账号](https://docs.tikhub.io/420136396e0.md)、[统一详情](https://docs.tikhub.io/420136391e0.md)、[话题](https://docs.tikhub.io/420136408e0.md) | 统一详情明确 `type=normal/video`，且视频只返回封面，不返回播放文件链接；`share_info.link` 是笔记页。当前其它固定投影也无已证播放字段。 | 类型可以闭合，地址不能；可走 Redfox `QPNFJRG1`。不增加 TikHub [视频专用详情](https://docs.tikhub.io/420136392e0.md) 调用来替换既定服务。 |
| B站 `search/typed_search/account_posts/detail/trending`：[综合搜索](https://docs.tikhub.io/382707669e0.md)、[分类搜索](https://docs.tikhub.io/382707670e0.md)、[账号](https://docs.tikhub.io/382707665e0.md)、[详情](https://docs.tikhub.io/382707662e0.md)、[热门](https://docs.tikhub.io/382707668e0.md) | 历史详情 `E.data.data.data.short_link/short_link_v2` 是页面；列表 `uri=bilibili://video/<AV>` 是原生 URI；无媒体 schema。 | 可走 Redfox `CWX77QIH`；不能猜 `durl/dash/video/audio` 或承诺 DASH 合流。[另一个播放信息接口](https://docs.tikhub.io/321173064e0.md) 未接，不计入当前能力。 |
| 微博 `search/account_posts/detail`：[搜索](https://docs.tikhub.io/410358109e0.md)、[账号](https://docs.tikhub.io/410358096e0.md)、[详情](https://docs.tikhub.io/410358103e0.md) | 文档称返回图片/视频，搜索支持视频类型、账号支持 video 筛选，但无媒体输出层级；历史没有成功视频 shape。`scheme` 是深链；original 过滤指原创微博。 | 不能猜 `page_info.media_info.stream_url/playback_list`；无固定微博解析器。筛选条件也不能替代逐条视频确认。 |
| X `search/account_posts/detail/list_posts/community_posts`：[搜索](https://docs.tikhub.io/215701673e0.md)、[账号](https://docs.tikhub.io/191321711e0.md)、[详情](https://docs.tikhub.io/191321709e0.md)、[列表](https://docs.tikhub.io/511118457e0.md)、[社群](https://docs.tikhub.io/511118450e0.md) | **已有历史 shape，不是完全无层级**：搜索 `E.data.data.timeline[].media.video[].variants[]`、详情 `E.data.data.media.video[].variants[]` 有 `content_type/url` 键；`media_url_https` 为字符串；部分有 bitrate。账号视频仅在 `retweeted_tweet`，列表只存 variants 键，社群只有 photo 正例。另见下段。 | 缺 MIME 实值、URL文件语义和媒体角色合同，不能把所有 variants 当 MP4/HLS；当前 parser 白名单也未保留这些字段。作为候选适配点，不能写“已接直接下载”。已完成可靠视频确认/入库后可走 Redfox `7UW1PT1F`。 |
| 公众号 `account_articles/detail`：[列表](https://docs.tikhub.io/472974858e0.md)、[H5详情](https://docs.tikhub.io/511928397e0.md) | 列表 `P.data.articles[].url` 是文章页，`item_show_type=5` 是视频栏目筛选。详情 `P.data.content._content_type=video` 确认视频页，`cdn_url` 是封面；`P.data.url`、content 中 `link/source_url` 是页面。 | 视频页无文件 URL；`content_noencode` 只在 article 有 HTML，其它为空。当前 raw=false；raw=true 也不代表原始视频。没有固定公众号解析器。 |
| SocialData X，当前 `/twitter/search`：[搜索](https://docs.socialdata.tools/reference/get-search-results/)、[概述](https://docs.socialdata.tools/getting-started/overview/) | 本地优先接 `tweets[].extended_entities.media[]`，否则接 `tweets[].entities.media[]` 的原始 `type=photo/video/animated_gif`、`media_url_https/original_info`；旧投影把 video/GIF 都存 kind=video，url/poster 均用 media_url_https，未接 variants。当前搜索官方成功样例没有真正 video 对象。 | 旧 kind=video 不能直接确认；`media_url_https` 不能当视频文件。成功入库且原始 type=video 已确认后，可走 Redfox `7UW1PT1F`；引用关系和原作者仍按现有校验。 |

X TikHub 的 2026-10-23 脱敏证据位于 `catalog.phase2Evidence.xLiveContractEvidence`。搜索/详情中 `entities.media[].video_info.variants[]` 也仅有 shape；`allow_download_status.allow_download` 仅记录 boolean 类型，没有实际值，不能认定允许下载。账号转发媒体不能冒充当前帖媒体；`original_info` 是尺寸/焦点信息，不是原始文件声明。此处更正 [10-24 历史证据](2026-10-24-video-work-evidence.md) 的笼统缺证描述，**未补出下载语义或放开未知视频确认**。

SocialData [评论](https://docs.socialdata.tools/reference/get-tweet-comments/)与[引用](https://docs.socialdata.tools/reference/get-tweet-quotes/)文档有可核非空 GIF：`tweets[].entities.media[].type=animated_gif`，`media_url_https` 是缩略 JPG，`video_info.variants[].content_type=video/mp4` 且 url 是 MP4。这是未接评论/引用路线的 GIF 样例，不能外推为当前搜索原生视频合同，但已免费证明“MP4/variants 存在”不能替代原始 type，更不能把 GIF 纳入确认视频。

## 4. 固定复用的 Redfox 九个专用下载器

原 `/apis/tool-video-download/{id}` 页面本轮没有正文，使用官方文档前端公开的 `GET /story/web/api/doc/detail/no/{id}` 核对。以下九条逐一确认相同响应 schema，**不是从一个平台外推其它平台**。采集供应商与解析供应商分别记录；AgentKey 采集后调用此表 Redfox 操作是已确认的固定组合，不是静默换服务。

| 内容平台 | 固定 Redfox operation / 官方字段文档 |
| --- | --- |
| 抖音 | [0W27H3O6](https://redfox.hk/story/web/api/doc/detail/no/0W27H3O6) |
| 小红书 | [QPNFJRG1](https://redfox.hk/story/web/api/doc/detail/no/QPNFJRG1) |
| B站 | [CWX77QIH](https://redfox.hk/story/web/api/doc/detail/no/CWX77QIH) |
| X | [7UW1PT1F](https://redfox.hk/story/web/api/doc/detail/no/7UW1PT1F) |
| 视频号 | [U2NJ13MW](https://redfox.hk/story/web/api/doc/detail/no/U2NJ13MW) |
| 快手 | [0ZIWOO8P](https://redfox.hk/story/web/api/doc/detail/no/0ZIWOO8P) |
| TikTok | [MQMDU19Q](https://redfox.hk/story/web/api/doc/detail/no/MQMDU19Q) |
| Instagram | [UUSP1G1P](https://redfox.hk/story/web/api/doc/detail/no/UUSP1G1P) |
| YouTube | [D52IUEIM](https://redfox.hk/story/web/api/doc/detail/no/D52IUEIM) |

共同完整响应字段：`data.videoUrl`=视频下载地址；`data.resources[]`=全部媒体资源；资源 `type` 明确 video/audio/mp3/image，`downloadUrl`=下载链接，`coverUrl`=封面，`durationSeconds`=秒。只取 `type=video` 且能对应本条已确认视频的资源，保留有据的多视频，不把 audio/image 或重复的顶层 videoUrl 当额外视频。小红书官方成功样例恰为图集：videoUrl=null、resources 全 image；所以“解析成功”不等于“找到了视频”，不得把已确认视频静默降成图片或认定下载完成。

九个下载器均未在本轮所查字段中保证原始上传文件、每条必可下、无水印、音画完整、URL 有效期或必需媒体请求头。历史目录“去水印工具”的分类名不能替代各响应的具体保证。TikTok 当前采集的 `downloadNoMarkAddress` 另有明确无水印语义，不能移植成九下载器通用合同。

通用 [AWUTFI4V](https://redfox.hk/story/web/api/doc/detail/no/AWUTFI4V) 仅定义 `data.videoUrl` 为视频 URL、imageUrls 为图片列表，官方样例非法 JSON，且没有上述 resources 或逐平台支持合同；**不作为固定九条失败后的兜底**。本地 parser 接受某字段也不能提升上游保证。

## 5. 50MB 与同一视频的较低清晰度

本轮未请求任何媒体 HEAD/GET；没有验证 Content-Length 是否存在或可信，也没有测得实际文件大小、格式或地址可达性。50MB 的精确字节口径由方案统一定义；码率、分辨率、时长和 URL 名称均不能代替实际大小验证，缺大小也不能先宣称小于限额。未来的受控 HEAD/GET 能否成功须按实际响应处理，不能从文档假定服务必支持 HEAD、Range 或完整长度头。

| 已有字段 | 能否证明同视频的备选版本 | 对超限重试的约束 |
| --- | --- | --- |
| Redfox X 搜索/详情：同一个 `medias[]` 项的 `variants[].contentType/bitrate/url` | 文档明确视频清晰度列表；在已验同一媒体项内可比较 MP4 码率。HLS 的 bitrate 可为 null。 | 有较低 MP4 码率项时可作为同一视频候选，再验证是否不超过50MB；不能跨 `medias[]`、引用/转发换成另一个视频，也不能将 HLS 清单当低清完整文件。 |
| 易车 `3BXWEB6Y`：`data.resources[].downloadUrl` | 文档明确本条视频资源含多个清晰度，但没有逐项标签、排序、码率或大小。 | 仅在同一已验作品详情内尝试其余合法地址并验证大小；不能把第一个/最后一个认定为高清/低清，也不能猜 URL 参数生成低清。 |
| TikTok 五路线：`videoData.definition/videoWidth/videoHeight`，三种播放/下载地址 | `definition` 明确当前视频清晰度、width/height 是尺寸；没有不同清晰度的数组/映射。带水印与无水印地址仅区分水印，不证明谁更低清。 | 不能用另一个水印地址冒充低清版本，不能修改 definition 或 URL 请求未证版本；无同视频较低版本证据时不承诺此能力。 |
| Redfox 九下载器的 `data.resources[]` | 这是全部媒体资源，样例混有 video/audio/image；多个 video 也未承诺都是同一视频的不同清晰度。没有统一的质量、码率、大小或同视频变体 ID 合同。 | **不能把下一个 resource 当低清重试**，不能换另一个附件或音频来满足50MB；只有另外已证属于同一视频变体的地址才可用，缺证则按无合适版本处理。 |
| TikHub X 历史 `variants[]`；其他平台单一 videoUrl/playUrl/videoLink 或宽高字段 | X 只有键形状，缺 MIME/码率实值和当前可用投影；其它单地址/尺寸不构成变体集合。 | 不能借 Redfox X 语义或平台常识补齐，也不能猜低清 URL。本方案使用固定解析器后仍须遵守上述混合资源边界。 |

因此，低清尝试以“有证据是同一视频的另一版本”为前提。若都超过50MB、没有备选、无法确认同视频版本或实际验证失败，均不能声称已保存文件；产品已确定的超限情形使用后台空图“原视频过大”，其它失败保持相应原因，前台仍用既有封面/原站链接。这里不引入转码、模型压缩、新播放接口或换供应商来补证。

## 6. 尚未确认的事项具体阻塞什么

| 未知或限制 | 影响与方案边界 |
| --- | --- |
| 全部已核路线缺原始文件保真保证 | 可以规划“保存可用视频副本”，不能命名为上传原文件归档。TikHub 未接的[抖音高画质播放接口](https://docs.tikhub.io/312096107e0.md)虽另称原始上传画质/高清无水印，也不证明字节相同；本方案不接入。 |
| URL 可达、时效、反盗链、大小、MIME、容器与音轨均未请求验证 | 文档只证明地址语义；未来实现需要受控获取并验证实际文件，不能仅 URL 非空即标下载成功。HLS/DASH 清单和音画分轨不能冒充单个完整视频文件；免费调查未下载上游媒体，后续本地桩验证不证明真实上游可达性。 |
| TikHub cache_url/cache_message 的 24 小时 | 是 JSON 响应追溯缓存，不是媒体文件地址，也不证明视频 URL 有效 24 小时。API Authorization 不能转发给媒体 CDN。 |
| 头条 downloadUrl 元素、Redfox X时间线视频元素、公众号转码信息、Instagram轮播子项地址、TikHub媒体下载语义未闭合 | 只阻塞对应直接地址适配。九平台可按固定专用下载器解析；不猜未知子字段，不购买未接 TikHub 替代接口。头条/公众号等无固定解析映射的记录保留缺地址。 |
| 头条、微博、公众号、知乎、百家号、汽车之家、懂车帝、易车不在固定九解析平台中 | 已取得且验证有效的媒体候选可走通用文件保存；没有地址的记录仍不能覆盖。不得自动套通用解析器、其它平台下载器或新增服务；这不是“全平台必下”的承诺。 |
| 快手/视频号无自动材料导入；其它记录也可能缺可靠身份、原文或视频确认 | 下载器不授予入库权限。仅查询/定时研究结果不能触发“入库后下载”；须先满足既有材料入口，保持人工核验和隔离规则。 |
| 真实历史数量、原始 type/variants 是否仍保留未核对 | 不承诺历史全部补下；旧 GIF 歧义和缺失证据不猜、不自动重采。 |
| 私有存储、50MB备选尝试、30天删除及预算解析流程 | 同日已实现并通过本地桩验证（见验收报告）；真实供应商和 CDN 的下载成功仍未验证。实现未扩大这里列明的字段与身份边界。 |

这些缺口按路线与记录局部生效，不阻塞已有可用地址或固定九平台解析路径的方案设计。本轮免费证据已覆盖能确定的字段与边界；未知项保持明确，不以付费调用或合成样例补成“已验证”。
