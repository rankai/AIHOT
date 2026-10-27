# 信源 → 采集订阅 → 内容入库 → 栏目展示：本地验收

2026-10-27；代码提交 `5373e038f5ef931db502e81d35c40b0678bf0a1e`。结论：本次合成场景通过，未发现归属或栏目权限问题。

## 环境与验证边界

- 后台 http://127.0.0.1:3370；API 3371；专用数据库 `aihot_source_ownership_ui_test`，端口 55527，执行前断言库名及端口。
- 实际浏览器从既有信源详情点击“新建所属采集订阅”，经真实本地表单/API 创建订阅 #9、#10；没有拦截页面成功响应。
- 采集阶段调用现有 startPlatformSubscription / executeOperationStep，以本机 loopback 桩替代 Redfox，经过真实适配器、预算、回执、入库及结果流程。仅验证 OWIBYU1V 一条代表性路线，不扩称所有供应商路线重验通过。
- 两次本地桩请求；回执 #26、#27 均 completed、attempts=1。无真实供应商、模型、媒体下载或平台访问；没有打开原站链接。
- API 服务外部开关保持关闭、没有启动 Worker。测试脚本独立环境无真实凭据；采集进程 fetch 只允许桩 origin，分析/投影脚本禁止全部 fetch。
- 模型分类、标签、相关性和摘要为显式写入的合成分析夹具，随后调用既有 publishArticle 生成投影。**未验证真实模型判断、完整分析流水线或持续定时 Worker**，不把合成结果当成真实模型运行。

## 结果

| 验收点 | 结果 |
| --- | --- |
| 来源详情新建 | 直接继承 ownership-ui-editorial / ownership-ui-isolated，表单没有重复信源选择 |
| 订阅与执行冻结 | #9 → 执行 #25 → 普通信源；#10 → 执行 #26 → 隔离信源 |
| 入库 | 普通 3 篇、隔离 1 篇，文章源与订阅一致；全部样例不提供作者 ID |
| 入库不等于公开 | 注入合成分析前，无可公开列表资格 |
| 已确认视频 | videoType=0 两篇普通视频、一篇隔离视频保存 confirmed 视频事实；图文 videoType=2 没有视频事实 |
| 全部内容 | 匿名 /api/site/pool 仅包含三篇普通材料，无隔离样例 |
| 视频列表 | 匿名 videosOnly=true 仅包含两篇公开视频；排除图文与隔离视频 |
| 自建栏目 | 模型分类＋闭环验收标签＋仅含视频，恰好一篇；pageSize=5 |
| 前台详情 | 公开视频 200，显示正确信源和原文观看链接；隔离视频页面和匿名 API 都为 404 |
| 隔离防护 | 即使给隔离材料相同合成通过判断、摘要、分类和标签，投影仍 withdrawn、eligible=false |
| 全文权限 | 沿用来源实际配置：普通测试源 site_fulltext=true，投影 full；隔离源 false，投影 summary，且整个详情不可公开。未修改信源权限 |
| 栏目隐藏 | 预置视频入口原本隐藏；/videos 旧链接仍可访问，且只返回公开合格视频 |

## 样例与收尾

- 公开匹配视频：`x6l410e852mp71cj2xn2erbvf`。
- 普通图文：`efqx17hqe5swbn46audtjwmum`。
- 不匹配标签视频：`kvfvg8t6al1vilvc55zp5n7ow`。
- 隔离视频：`x8upewelijw69gz95nooirbzs`。
- [测试栏目](http://127.0.0.1:3370/columns/custom-ad13b70b-80b0-45b9-8382-62fa6ce8db0f) 保留供人工复核；这是本地合成栏目。
- 本轮新增订阅 #9、#10 已用现有更新入口停用，无在途执行；原有订阅和信源权限未改。
- 采集首次已完成后，验收脚本查询误用了 articles.input_revision / status，已改为 revision 并复用原执行，不重采。另一个验收断言误以为既有普通测试源禁用全文，核对实际配置后改为按其真实权限断言。这些是本次临时验收脚本错误，不是产品修复。
- 验收时工作树干净，未修改业务代码、提交、推送、合并、部署或更新 PR。随后按用户授权将本记录和截图同步到 PR #8；仅提交验收证据。

## 截图原图与批注

蓝色框和说明为验收覆盖层，不属于产品 UI。7 组截图均已逐张查看。

- 信源新建订阅：直接继承，无重复选择：[批注](01-inherited-source-annotated.png) · [原图](01-inherited-source.png)
- 执行结果：缺作者 ID 仍入库，沿用所属信源：[批注](02-collected-result-annotated.png) · [原图](02-collected-result.png)
- 栏目配置：分类＋标签＋视频，每页 5 条：[批注](03-column-configuration-annotated.png) · [原图](03-column-configuration.png)
- 自建栏目：只命中 1 条符合条件的公开视频：[批注](04-public-column-annotated.png) · [原图](04-public-column.png)
- 详情：所属信源、合成摘要与原站观看入口：[批注](05-public-detail-annotated.png) · [原图](05-public-detail.png)
- 隔离内容：公开详情 404：[批注](06-isolated-denied-annotated.png) · [原图](06-isolated-denied.png)
- 视频列表：两条公开视频，隐藏入口不撤销旧链接：[批注](07-video-list-annotated.png) · [原图](07-video-list.png)

## 机器证据

- [collected.json](collected.json)
- [publications.json](publications.json)
- [http-check.json](http-check.json)
- [final-state.json](final-state.json)

collected.json 的 hits=1 是收尾进程新增请求数；公开订阅在首次脚本中已经调用本地桩一次。最终两张回执各一次，合计本地桩请求两次。
