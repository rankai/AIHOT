# AIHOT 源码与模块清单

> 2026-10-19 审查前快照；是范围索引，不是逐行审计证明或当前开发规则。
> 审查结论、深读范围与未验证项见 [项目审查](2026-10-19-project-review.md)。

共 444 个文本文件、53,412 行：主体盘点 443 文件、49,844 行，另列公开 OpenAPI 参考文件。行数按文本 splitlines 计，不表示代码有效行数。

排除依赖、构建产物、运行数据、`.env` 与其他真实配置秘密、lockfile 内容、图片/品牌资源和其他 reference 文件。本轮新增的规则/报告与更新后的 AGENTS 不计入审查前快照。

全部主体文件建立路径、导入/声明与哈希索引；关键链路深读与结构盘点的区别见主报告。短指纹用于识别当时文本，不是远端 Git 提交证明，也不单独证明文件可信。

## 根目录与部署

13 文件，665 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `.claude/launch.json` | 17 | `8b45261342b4` |
| `.dockerignore` | 11 | `8ccc18fcb469` |
| `.env.example` | 119 | `f99f7d6703c0` |
| `.github/workflows/check.yml` | 104 | `2791262cf9ca` |
| `.gitignore` | 16 | `e3e7a5945355` |
| `AGENTS.md` | 41 | `3b7cb3b75dc2` |
| `CLAUDE.md` | 1 | `336cc4fbf19b` |
| `Dockerfile` | 29 | `2b1672f7e465` |
| `README.md` | 177 | `3e2891ae37fb` |
| `deploy/Caddyfile` | 6 | `82991ed2c631` |
| `docker-compose.yml` | 96 | `49952ac74b5a` |
| `package.json` | 29 | `8373bc62e8d2` |
| `tsconfig.base.json` | 19 | `aac65703ed5d` |

## API

19 文件，2,157 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `apps/api/package.json` | 21 | `3f30135461c5` |
| `apps/api/src/app.ts` | 98 | `86a62e0d3f7d` |
| `apps/api/src/http/respond.ts` | 126 | `c457710f0eb0` |
| `apps/api/src/main.ts` | 31 | `3dfa5ce9cb09` |
| `apps/api/src/og/poster.ts` | 121 | `5794f21edc09` |
| `apps/api/src/og/render.ts` | 142 | `48c14075674a` |
| `apps/api/src/routes/admin-auth.ts` | 137 | `4a7d983e4273` |
| `apps/api/src/routes/admin.ts` | 158 | `2ce77b03dece` |
| `apps/api/src/routes/feedback.ts` | 50 | `d28b28c12a2b` |
| `apps/api/src/routes/feeds.ts` | 53 | `2be7a40ab049` |
| `apps/api/src/routes/ingest.ts` | 48 | `f784ecb18218` |
| `apps/api/src/routes/leaderboard.ts` | 53 | `2a3b7f3d16b7` |
| `apps/api/src/routes/mcp.ts` | 306 | `4d2662196cc2` |
| `apps/api/src/routes/media.ts` | 40 | `fe765feff6d6` |
| `apps/api/src/routes/og.ts` | 137 | `f48c06765277` |
| `apps/api/src/routes/site.ts` | 279 | `8235b2b8c3c6` |
| `apps/api/src/routes/static.ts` | 175 | `4cf2be060202` |
| `apps/api/src/routes/v1.ts` | 178 | `7e6d6113806e` |
| `apps/api/tsconfig.json` | 4 | `88020c5d0c63` |

## Web

126 文件，15,728 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `apps/web/app/app.css` | 534 | `35c67155810d` |
| `apps/web/app/components/CodeBlock.tsx` | 47 | `1e546bdfcde6` |
| `apps/web/app/components/Logo.tsx` | 24 | `886f0f65cc10` |
| `apps/web/app/components/icons.tsx` | 49 | `8a9918f7c370` |
| `apps/web/app/components/shell/Chrome.tsx` | 53 | `0ecf7d2d284a` |
| `apps/web/app/components/shell/MobileTabBar.tsx` | 32 | `1bcb83433c8f` |
| `apps/web/app/components/shell/Sidebar.tsx` | 70 | `d9efd95dd28c` |
| `apps/web/app/components/shell/ThemeSwitch.tsx` | 55 | `50c9ba135269` |
| `apps/web/app/components/shell/nav.ts` | 69 | `9d6d87dcc27b` |
| `apps/web/app/components/ui/Badge.tsx` | 31 | `3ee83eb6f1b0` |
| `apps/web/app/components/ui/Controls.tsx` | 47 | `749ad4d76bb7` |
| `apps/web/app/components/ui/IntentLink.tsx` | 28 | `172a896879c9` |
| `apps/web/app/components/ui/Kicker.tsx` | 11 | `92dc39286326` |
| `apps/web/app/components/ui/Lightbox.tsx` | 91 | `ace932c96906` |
| `apps/web/app/components/ui/Menu.tsx` | 67 | `05612543ba4c` |
| `apps/web/app/components/ui/Page.tsx` | 84 | `95614c7edd08` |
| `apps/web/app/components/ui/Presence.tsx` | 50 | `e6b16ff66c4e` |
| `apps/web/app/components/ui/Score.tsx` | 31 | `9ab1ad552e8f` |
| `apps/web/app/components/ui/SourceAvatar.tsx` | 36 | `9e85be6cd4b4` |
| `apps/web/app/components/ui/Tabs.tsx` | 113 | `845a0e04dd85` |
| `apps/web/app/features/about/SignalRiver.tsx` | 579 | `e7278d70e432` |
| `apps/web/app/features/admin/action.ts` | 78 | `b326b52f1bfe` |
| `apps/web/app/features/admin/charts.tsx` | 193 | `08cb02f51fef` |
| `apps/web/app/features/admin/format.ts` | 50 | `a42aca3fc498` |
| `apps/web/app/features/admin/labels.ts` | 7 | `05c9ee49035d` |
| `apps/web/app/features/admin/toast.tsx` | 59 | `03daaaab2227` |
| `apps/web/app/features/admin/ui.tsx` | 356 | `cb0409743a48` |
| `apps/web/app/features/changelog/text.tsx` | 11 | `183112d5b637` |
| `apps/web/app/features/copy/CopyPage.tsx` | 84 | `2ebd85cf5dd2` |
| `apps/web/app/features/feed/DayList.tsx` | 76 | `45f855418a0d` |
| `apps/web/app/features/feed/FeedItem.tsx` | 103 | `a09fe1cfdc85` |
| `apps/web/app/features/feed/Filters.tsx` | 141 | `afab156ad371` |
| `apps/web/app/features/feed/HotTopics.tsx` | 72 | `005a4076ebed` |
| `apps/web/app/features/feed/ReadingGroup.tsx` | 240 | `8d6d174454d5` |
| `apps/web/app/features/feed/Timeline.tsx` | 331 | `29de10dad127` |
| `apps/web/app/features/feed/parts.tsx` | 82 | `915dc6973c90` |
| `apps/web/app/features/feed/restore.ts` | 80 | `fd2e0669dd04` |
| `apps/web/app/features/feed/session-cache.ts` | 73 | `7933208195a3` |
| `apps/web/app/features/hot/Delta.tsx` | 15 | `8dc14d87c1b5` |
| `apps/web/app/features/hot/Faces.tsx` | 108 | `a3050da8512c` |
| `apps/web/app/features/hot/Sparkline.tsx` | 48 | `7f9f00aeb559` |
| `apps/web/app/features/item/MediaGallery.tsx` | 61 | `80157eb6c634` |
| `apps/web/app/features/item/PosterSheet.tsx` | 90 | `5a83632a09aa` |
| `apps/web/app/features/item/QuotedPost.tsx` | 52 | `5b5d9a3a948f` |
| `apps/web/app/features/item/StoryFollowups.tsx` | 69 | `4aa48ec8568e` |
| `apps/web/app/features/leaderboard/BoardTable.tsx` | 174 | `add7ae8e2e95` |
| `apps/web/app/features/leaderboard/BoardTabs.tsx` | 18 | `8e29d4e55c9a` |
| `apps/web/app/features/leaderboard/BrandMark.tsx` | 30 | `b418eb7e9880` |
| `apps/web/app/features/leaderboard/Evidence.tsx` | 71 | `711ba70966c7` |
| `apps/web/app/features/leaderboard/Podium.tsx` | 50 | `7e297541ff5e` |
| `apps/web/app/features/leaderboard/StatusChip.tsx` | 18 | `9e633b944da2` |
| `apps/web/app/features/leaderboard/format.ts` | 44 | `5e30cb451001` |
| `apps/web/app/features/monitor/PostCard.tsx` | 78 | `fe93663af529` |
| `apps/web/app/features/monitor/ResetCalendar.tsx` | 290 | `0e7592867ee6` |
| `apps/web/app/features/monitor/format.ts` | 48 | `c5031b361d98` |
| `apps/web/app/features/report/Halftone.tsx` | 342 | `21ba848d75f9` |
| `apps/web/app/features/report/IssueDots.tsx` | 169 | `de49ddead269` |
| `apps/web/app/features/report/Nameplate.tsx` | 24 | `a4c345f13e51` |
| `apps/web/app/features/report/ReportLayout.tsx` | 20 | `83b898f1b36a` |
| `apps/web/app/features/report/ReportNav.tsx` | 117 | `0c7f0dd06b21` |
| `apps/web/app/features/report/ReportPaper.tsx` | 421 | `92ad53d8eac3` |
| `apps/web/app/features/report/format.ts` | 218 | `6ddc7c9451c0` |
| `apps/web/app/features/story/HeatChart.tsx` | 181 | `5929d95460d0` |
| `apps/web/app/lib/admin.server.ts` | 26 | `01e5b647ff11` |
| `apps/web/app/lib/api.server.ts` | 76 | `31edcfb298c6` |
| `apps/web/app/lib/format.ts` | 48 | `e5e7fb28287d` |
| `apps/web/app/lib/hydration.ts` | 17 | `6ccbfaa6194c` |
| `apps/web/app/lib/local-state.ts` | 348 | `328bdf7e3d3a` |
| `apps/web/app/lib/markdown.ts` | 114 | `c989f02d72ff` |
| `apps/web/app/lib/seo.ts` | 97 | `b56ca31f0da4` |
| `apps/web/app/lib/site-copy.ts` | 14 | `5433ce3e2c9e` |
| `apps/web/app/root.tsx` | 132 | `66e9bd3e443d` |
| `apps/web/app/routes/about.tsx` | 295 | `ac5885c0f68b` |
| `apps/web/app/routes/admin/audit.tsx` | 59 | `12238b90e7fe` |
| `apps/web/app/routes/admin/content-item.tsx` | 454 | `fd7a47ec73f1` |
| `apps/web/app/routes/admin/content.tsx` | 78 | `c65ea851dcad` |
| `apps/web/app/routes/admin/feedback.tsx` | 151 | `93ae38dbcc92` |
| `apps/web/app/routes/admin/index.tsx` | 10 | `c3e18ddbbd8a` |
| `apps/web/app/routes/admin/layout.tsx` | 126 | `4e6118cb507d` |
| `apps/web/app/routes/admin/models.tsx` | 191 | `a7c78f08c357` |
| `apps/web/app/routes/admin/monitor.tsx` | 336 | `f5222b3652d6` |
| `apps/web/app/routes/admin/runs.tsx` | 320 | `3feb5a59547c` |
| `apps/web/app/routes/admin/selectbench-run.tsx` | 148 | `9d38edad8fbe` |
| `apps/web/app/routes/admin/selectbench.tsx` | 112 | `89fd5483e199` |
| `apps/web/app/routes/admin/settings.tsx` | 148 | `31a6efa213b4` |
| `apps/web/app/routes/admin/source-new.tsx` | 163 | `4815393ce1df` |
| `apps/web/app/routes/admin/source.tsx` | 367 | `6464ea7c6718` |
| `apps/web/app/routes/admin/sources.tsx` | 135 | `40c8a57622dd` |
| `apps/web/app/routes/admin-login.tsx` | 73 | `2069979ced00` |
| `apps/web/app/routes/agent.tsx` | 279 | `d36588b11965` |
| `apps/web/app/routes/all.tsx` | 156 | `a1dc40d93b42` |
| `apps/web/app/routes/changelog.tsx` | 169 | `55e1dde63ecb` |
| `apps/web/app/routes/codex-reset.tsx` | 253 | `f931c64cdfb3` |
| `apps/web/app/routes/daily-archive.tsx` | 69 | `410a750e3242` |
| `apps/web/app/routes/feedback.tsx` | 267 | `953407e43df1` |
| `apps/web/app/routes/home.tsx` | 78 | `fa8eb6917a58` |
| `apps/web/app/routes/hot.tsx` | 315 | `2fecbb3828df` |
| `apps/web/app/routes/item-original.tsx` | 10 | `87545248d1e4` |
| `apps/web/app/routes/item.tsx` | 404 | `5cc0be9e387e` |
| `apps/web/app/routes/leaderboard-boards.tsx` | 36 | `0d91829ba345` |
| `apps/web/app/routes/leaderboard-model.tsx` | 397 | `de6e58573560` |
| `apps/web/app/routes/leaderboard-rules.tsx` | 253 | `56f3da6330eb` |
| `apps/web/app/routes/leaderboard-source.tsx` | 168 | `dad67d077907` |
| `apps/web/app/routes/leaderboard-sources.tsx` | 107 | `e5e8bee195a2` |
| `apps/web/app/routes/leaderboard.tsx` | 104 | `b0ca541a71eb` |
| `apps/web/app/routes/more.tsx` | 96 | `7cc453a70f54` |
| `apps/web/app/routes/privacy.tsx` | 27 | `85b28222950a` |
| `apps/web/app/routes/report-detail.tsx` | 52 | `494212d11976` |
| `apps/web/app/routes/report-latest.tsx` | 40 | `3ac9ba2b446f` |
| `apps/web/app/routes/search-busy.tsx` | 13 | `a87803764f22` |
| `apps/web/app/routes/starred.tsx` | 142 | `2903f054083a` |
| `apps/web/app/routes/story.tsx` | 433 | `d5fb08def3c1` |
| `apps/web/app/routes/terms.tsx` | 27 | `dd8f1cdfa633` |
| `apps/web/app/routes/topic.tsx` | 96 | `b6f3e3972270` |
| `apps/web/app/routes/topics.tsx` | 76 | `9f33108c76c3` |
| `apps/web/app/routes.ts` | 57 | `24b8fcac0edd` |
| `apps/web/package.json` | 29 | `831f55b24c55` |
| `apps/web/react-router.config.ts` | 10 | `26c948d63b25` |
| `apps/web/server.ts` | 165 | `2248e399d44b` |
| `apps/web/tests/cache.test.ts` | 222 | `1c2fc5a097b9` |
| `apps/web/tests/local-state.test.ts` | 68 | `bc48bb6c515c` |
| `apps/web/tests/markdown.test.ts` | 19 | `26df2702ebc5` |
| `apps/web/tests/request-cancellation.test.ts` | 29 | `1d1360c30c80` |
| `apps/web/tests/session-cache.test.ts` | 45 | `85388c9eaf29` |
| `apps/web/tsconfig.json` | 20 | `91b22b5acb4c` |
| `apps/web/vite.config.ts` | 66 | `193bb4556311` |

## Worker

4 文件，174 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `apps/worker/package.json` | 14 | `6a82d3bb005a` |
| `apps/worker/src/main.ts` | 44 | `ec6f06bc66e4` |
| `apps/worker/src/schedules.ts` | 112 | `6ec8bac408d5` |
| `apps/worker/tsconfig.json` | 4 | `88020c5d0c63` |

## Backend

133 文件，18,975 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `packages/backend/package.json` | 26 | `a32c5231b668` |
| `packages/backend/src/admin/auth.ts` | 184 | `01587dd62df2` |
| `packages/backend/src/admin/content.ts` | 216 | `353ce0dac1b3` |
| `packages/backend/src/admin/feedback.ts` | 77 | `d8d61efa4058` |
| `packages/backend/src/admin/models.ts` | 108 | `53dd7a60b112` |
| `packages/backend/src/admin/monitor.ts` | 174 | `e1dca34581d3` |
| `packages/backend/src/admin/runs.ts` | 163 | `3e6e085a7795` |
| `packages/backend/src/admin/selectbench.ts` | 100 | `f81039a14caa` |
| `packages/backend/src/admin/settings.ts` | 71 | `c761e25ed6e9` |
| `packages/backend/src/admin/sources.ts` | 195 | `09bb743e175b` |
| `packages/backend/src/config.ts` | 102 | `da1da3beb1ac` |
| `packages/backend/src/content/extract.ts` | 163 | `adbe031d1b8f` |
| `packages/backend/src/content/materials.ts` | 205 | `84c029ce0c99` |
| `packages/backend/src/content/sanitize.ts` | 195 | `23deabdb8cc4` |
| `packages/backend/src/db.ts` | 53 | `b04d24652386` |
| `packages/backend/src/editorial/analyze.ts` | 455 | `8a190d94a19e` |
| `packages/backend/src/editorial/input.ts` | 116 | `66bc6f2de755` |
| `packages/backend/src/editorial/models.ts` | 65 | `87e3b2fca576` |
| `packages/backend/src/editorial/prompts.ts` | 56 | `dde539a023f4` |
| `packages/backend/src/editorial/translate.ts` | 342 | `e8ecb7f8a643` |
| `packages/backend/src/editorial/vocabulary.ts` | 29 | `58d4cc58e1dc` |
| `packages/backend/src/editorial/writing.ts` | 376 | `aa046c22d968` |
| `packages/backend/src/events/digest.ts` | 90 | `bde101e25bce` |
| `packages/backend/src/events/group.ts` | 864 | `e2992d7445ff` |
| `packages/backend/src/events/hot-read.ts` | 137 | `dfbc6340be47` |
| `packages/backend/src/events/hot.ts` | 213 | `7336dd6378fa` |
| `packages/backend/src/events/merge.ts` | 35 | `6cc7f71c0f8c` |
| `packages/backend/src/events/relate.ts` | 176 | `20947ca5f05b` |
| `packages/backend/src/ingest/items.ts` | 72 | `7fa66ee9d799` |
| `packages/backend/src/jobs/content.ts` | 235 | `13d49b385681` |
| `packages/backend/src/jobs/events.ts` | 32 | `e80cc1c5a41d` |
| `packages/backend/src/jobs/notify.ts` | 28 | `0fa560c35030` |
| `packages/backend/src/jobs/publication.ts` | 29 | `86adf620b4a2` |
| `packages/backend/src/jobs/queue.ts` | 106 | `14401b9add15` |
| `packages/backend/src/jobs/sources.ts` | 27 | `b086456309cb` |
| `packages/backend/src/leaderboard/directory.ts` | 46 | `aa0e6455e6de` |
| `packages/backend/src/leaderboard/fetch/configuration.ts` | 146 | `70f8ffa2526e` |
| `packages/backend/src/leaderboard/fetch/csv.ts` | 34 | `50e0cff960ae` |
| `packages/backend/src/leaderboard/fetch/github.ts` | 21 | `b9e49db49221` |
| `packages/backend/src/leaderboard/fetch/hf.ts` | 38 | `8fe8336a48b2` |
| `packages/backend/src/leaderboard/fetch/identity.ts` | 73 | `a199c68d09e9` |
| `packages/backend/src/leaderboard/fetch/index.ts` | 14 | `f839216fb218` |
| `packages/backend/src/leaderboard/fetch/rank.ts` | 4 | `4b8a913395d4` |
| `packages/backend/src/leaderboard/fetch/refresh.ts` | 101 | `0c9764702ec3` |
| `packages/backend/src/leaderboard/fetch/sources/arena.ts` | 93 | `02fbf520505c` |
| `packages/backend/src/leaderboard/fetch/sources/artificial-analysis.ts` | 65 | `6f7a60960ae7` |
| `packages/backend/src/leaderboard/fetch/sources/deepswe.ts` | 63 | `899cb57bc568` |
| `packages/backend/src/leaderboard/fetch/sources/epoch.ts` | 101 | `6020f2a994c3` |
| `packages/backend/src/leaderboard/fetch/sources/eqbench.ts` | 62 | `f07fc2eefac1` |
| `packages/backend/src/leaderboard/fetch/sources/livebench.ts` | 81 | `43021698784b` |
| `packages/backend/src/leaderboard/fetch/sources/mercor.ts` | 105 | `930c6b6a1ef6` |
| `packages/backend/src/leaderboard/fetch/sources/taptap.ts` | 58 | `287cc1938c36` |
| `packages/backend/src/leaderboard/fetch/sources/terminal-bench.ts` | 112 | `ca7df9e23b1d` |
| `packages/backend/src/leaderboard/fetch/sources/vals.ts` | 115 | `df6907cc60f0` |
| `packages/backend/src/leaderboard/fetch/store.ts` | 164 | `aaaa19587611` |
| `packages/backend/src/leaderboard/fetch/types.ts` | 44 | `867e07f6e829` |
| `packages/backend/src/leaderboard/fetch/unzip.ts` | 35 | `61d8395ad301` |
| `packages/backend/src/leaderboard/method/compute-worker.ts` | 15 | `5117626498b4` |
| `packages/backend/src/leaderboard/method/compute.ts` | 23 | `9869cdb73ce6` |
| `packages/backend/src/leaderboard/method/inputs.ts` | 279 | `80c8f98d95a7` |
| `packages/backend/src/leaderboard/method/kemeny.ts` | 149 | `b895a830de0f` |
| `packages/backend/src/leaderboard/method/ndtr.ts` | 49 | `b626d304ecd5` |
| `packages/backend/src/leaderboard/method/run.ts` | 99 | `f43cebbd8d03` |
| `packages/backend/src/leaderboard/method/v15.ts` | 379 | `79eaa436bd69` |
| `packages/backend/src/leaderboard/prices.ts` | 38 | `e9790d3b7fa9` |
| `packages/backend/src/leaderboard/read.ts` | 575 | `bc5d6602a0d5` |
| `packages/backend/src/leaderboard/registry.ts` | 156 | `cfbd9a25b0c0` |
| `packages/backend/src/leaderboard/source-registry.json` | 1025 | `6cccc872adce` |
| `packages/backend/src/lib/cache.ts` | 47 | `f87abaa89471` |
| `packages/backend/src/lib/cursor.ts` | 24 | `3b59f5b3e094` |
| `packages/backend/src/lib/http-fetch.ts` | 139 | `1266fcffff05` |
| `packages/backend/src/lib/ids.ts` | 35 | `e14fbf18a75c` |
| `packages/backend/src/lib/text.ts` | 55 | `e012a381f747` |
| `packages/backend/src/lib/url.ts` | 220 | `e38b99795165` |
| `packages/backend/src/media/images.ts` | 207 | `c827ab40130d` |
| `packages/backend/src/media/imgproxy.ts` | 89 | `408af3849997` |
| `packages/backend/src/media/prepare.ts` | 51 | `5c7283eba6de` |
| `packages/backend/src/media/renditions.ts` | 17 | `35270213432b` |
| `packages/backend/src/monitor/assemble.ts` | 294 | `67d0cc981502` |
| `packages/backend/src/monitor/read.ts` | 335 | `90f8e634761d` |
| `packages/backend/src/monitor/recognize.ts` | 129 | `495753c8a728` |
| `packages/backend/src/monitor/scan.ts` | 216 | `c940ec8c68fa` |
| `packages/backend/src/monitor/time.ts` | 178 | `57310ca2f7aa` |
| `packages/backend/src/notify/deliver.ts` | 108 | `33c5da3ecab0` |
| `packages/backend/src/notify/feishu.ts` | 203 | `f3d422b5c26c` |
| `packages/backend/src/notify/selected.ts` | 83 | `8f7094853a3f` |
| `packages/backend/src/operations/alerts.ts` | 285 | `f5dba5ff23fc` |
| `packages/backend/src/operations/backup.ts` | 127 | `1fc361a8d3c7` |
| `packages/backend/src/operations/feedback.ts` | 100 | `b1145f33e42a` |
| `packages/backend/src/operations/heartbeat.ts` | 19 | `cf1c278bc784` |
| `packages/backend/src/operations/indexnow.ts` | 40 | `be63243ca371` |
| `packages/backend/src/operations/reports.ts` | 44 | `a4a0b621ca29` |
| `packages/backend/src/operations/retention.ts` | 39 | `81d4ae0ef42a` |
| `packages/backend/src/operations/watch.ts` | 61 | `378e1d310d4e` |
| `packages/backend/src/providers/dajiala.ts` | 94 | `9750c390862e` |
| `packages/backend/src/providers/embeddings.ts` | 113 | `973d75b278b8` |
| `packages/backend/src/providers/jina.ts` | 59 | `f0119f13dc35` |
| `packages/backend/src/providers/llm.ts` | 245 | `927d72a96e52` |
| `packages/backend/src/providers/receipts.ts` | 216 | `c0be41d6b65e` |
| `packages/backend/src/providers/socialdata.ts` | 171 | `fb5b527b2d6e` |
| `packages/backend/src/publication/availability.ts` | 19 | `78aaacf9b81d` |
| `packages/backend/src/publication/detail.ts` | 192 | `dab385afbf32` |
| `packages/backend/src/publication/feeds.ts` | 178 | `c4b04b7693cb` |
| `packages/backend/src/publication/followups.ts` | 9 | `0f9fdda81ac1` |
| `packages/backend/src/publication/groups.ts` | 154 | `dc6cfc6ef178` |
| `packages/backend/src/publication/items.ts` | 203 | `6fa69eb25a83` |
| `packages/backend/src/publication/links.ts` | 9 | `9b8b3df5c3f7` |
| `packages/backend/src/publication/llms.ts` | 76 | `de8325f55a29` |
| `packages/backend/src/publication/monitor.ts` | 19 | `0a64cc899efb` |
| `packages/backend/src/publication/og.ts` | 18 | `99b7446de3ac` |
| `packages/backend/src/publication/pool.ts` | 208 | `452e98ca8cdb` |
| `packages/backend/src/publication/publish.ts` | 361 | `f4b557e20b3d` |
| `packages/backend/src/publication/reports.ts` | 370 | `40ba50af6a05` |
| `packages/backend/src/publication/rules.ts` | 66 | `3572891867b8` |
| `packages/backend/src/publication/sitemap.ts` | 116 | `12a9fbf33290` |
| `packages/backend/src/publication/stories.ts` | 328 | `66bea5b5ba64` |
| `packages/backend/src/publication/timeline.ts` | 209 | `cb9379dca20a` |
| `packages/backend/src/publication/topics.ts` | 148 | `1350554721c8` |
| `packages/backend/src/publication/v1.ts` | 209 | `31a6d5ee91f0` |
| `packages/backend/src/reports/compose.ts` | 300 | `0a73d33b1d18` |
| `packages/backend/src/site/contact.ts` | 27 | `c7b3e2a36a25` |
| `packages/backend/src/site/meta.ts` | 28 | `19fa44357c9e` |
| `packages/backend/src/site/stats.ts` | 49 | `609b19d78d29` |
| `packages/backend/src/sources/collect.ts` | 363 | `f718c943e5ad` |
| `packages/backend/src/sources/config-keys.ts` | 66 | `dcf89b3511de` |
| `packages/backend/src/sources/icons.ts` | 134 | `6e39a375c267` |
| `packages/backend/src/sources/json-list.ts` | 184 | `6d4394653e7f` |
| `packages/backend/src/sources/mp.ts` | 139 | `f08cd4348b35` |
| `packages/backend/src/sources/rss.ts` | 209 | `6c5d1b7f59ab` |
| `packages/backend/src/sources/types.ts` | 31 | `0d1aed284681` |
| `packages/backend/src/sources/web-list.ts` | 381 | `9ab658f813d9` |
| `packages/backend/src/sources/x.ts` | 248 | `2ee111e93de4` |
| `packages/backend/tsconfig.json` | 4 | `88020c5d0c63` |

## Contracts

10 文件，1,030 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `packages/contracts/package.json` | 12 | `b039f84ae733` |
| `packages/contracts/src/http-policy.ts` | 126 | `cafba156e89f` |
| `packages/contracts/src/index.ts` | 1 | `685c5b8b8783` |
| `packages/contracts/src/leaderboard.ts` | 235 | `9875f7854f58` |
| `packages/contracts/src/mcp.ts` | 15 | `b9e03afbe086` |
| `packages/contracts/src/monitor.ts` | 124 | `3997ff358f45` |
| `packages/contracts/src/site.ts` | 389 | `d667496a5242` |
| `packages/contracts/src/taxonomy.ts` | 51 | `efbd68250686` |
| `packages/contracts/src/time.ts` | 73 | `a88c799b3bc2` |
| `packages/contracts/tsconfig.json` | 4 | `88020c5d0c63` |

## 行业包

41 文件，1,747 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `industry/README.md` | 17 | `141177ff5d9d` |
| `industry/changelog.json` | 15 | `c04b0acf84a2` |
| `industry/features.ts` | 9 | `667078c63d9d` |
| `industry/gold.example.jsonl` | 2 | `173d4e87d50c` |
| `industry/package.json` | 10 | `36d4ff2e0964` |
| `industry/pages/privacy.md` | 34 | `2904fb92c299` |
| `industry/pages/terms.md` | 34 | `3dec1153a1e9` |
| `industry/prompts/content-understanding.md` | 62 | `1258869a3807` |
| `industry/prompts/group-batch.md` | 8 | `13a5e1fc1915` |
| `industry/prompts/group-definitions.md` | 7 | `b7e5aae668e8` |
| `industry/prompts/group-method.md` | 1 | `8c51856fbfa4` |
| `industry/prompts/group-pair.md` | 8 | `ef967620b842` |
| `industry/prompts/group-signal.md` | 3 | `e5f3746474e6` |
| `industry/prompts/identity-context.md` | 2 | `6ac2adecce61` |
| `industry/prompts/prefilter.md` | 7 | `bc27aaf56298` |
| `industry/prompts/report-daily-lead.md` | 1 | `77f6576c77a1` |
| `industry/prompts/report-period.md` | 1 | `125f7b603aab` |
| `industry/prompts/rules-answer-first-summary.md` | 9 | `b8a517e60351` |
| `industry/prompts/rules-anti-hallucination.md` | 12 | `37026fd742a2` |
| `industry/prompts/rules-domain.md` | 45 | `d2ae6066259b` |
| `industry/prompts/rules-self-contained-title.md` | 10 | `4f1652d77ef6` |
| `industry/prompts/safety.md` | 1 | `3963b20e601f` |
| `industry/prompts/selection-score.md` | 109 | `11700da358cf` |
| `industry/prompts/story-digest.md` | 9 | `db6c73aab6f7` |
| `industry/prompts/structure.md` | 17 | `8040e4b8f864` |
| `industry/prompts/summarize-article-empty.md` | 1 | `776095e536b4` |
| `industry/prompts/summarize-article.md` | 30 | `da153a6788fb` |
| `industry/prompts/summarize-long-post-quoted.md` | 2 | `4b9d46e6f676` |
| `industry/prompts/summarize-long-post.md` | 27 | `4ff01e94427e` |
| `industry/prompts/summarize-short-post-quoted.md` | 3 | `13932cd0485a` |
| `industry/prompts/summarize-short-post.md` | 20 | `b0555ac7545d` |
| `industry/prompts/translate-body.md` | 8 | `36485f1e8373` |
| `industry/prompts/translate-post.md` | 4 | `ebb220eeabad` |
| `industry/prompts/understand.md` | 11 | `39bbbd78478b` |
| `industry/relation-gold.example.jsonl` | 4 | `adaf5cb715fd` |
| `industry/selection.ts` | 18 | `770195fcae04` |
| `industry/site.ts` | 77 | `fc6f010c374e` |
| `industry/sources.json` | 388 | `e4382bc87997` |
| `industry/taxonomy.ts` | 139 | `b452537054e6` |
| `industry/topics.json` | 578 | `5c8d7ba4ae7f` |
| `industry/tsconfig.json` | 4 | `487cd5319c8b` |

## 数据库

37 文件，3,357 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `database/migrations/0001_core.sql` | 279 | `ba4cf0e345f0` |
| `database/migrations/0002_events_reports.sql` | 158 | `c0263f260186` |
| `database/migrations/0003_monitor_leaderboard_notify.sql` | 212 | `452070bf5615` |
| `database/migrations/0004_admin_ops.sql` | 107 | `ad435396e832` |
| `database/migrations/0005_grouping_state.sql` | 7 | `05b83d2e4af4` |
| `database/migrations/0006_embeddings.sql` | 25 | `f8ff46c206b7` |
| `database/migrations/0007_leaderboard_prices.sql` | 16 | `166ce24631a9` |
| `database/migrations/0008_monitor_display.sql` | 12 | `6c4a2aa29b6a` |
| `database/migrations/0009_selectbench.sql` | 31 | `2b3ab0cd3166` |
| `database/migrations/0010_service_prices.sql` | 16 | `70d5124065dd` |
| `database/migrations/0011_lb_alias_unique.sql` | 2 | `069783d7ed49` |
| `database/migrations/0013_translation_attempts.sql` | 10 | `58ce72ace640` |
| `database/migrations/0014_pool_search.sql` | 19 | `45546c4abe1e` |
| `database/migrations/0015_pool_freshness_idx.sql` | 2 | `91a897168dc0` |
| `database/migrations/0016_publication_fact_release_idx.sql` | 4 | `0748c6ef30f8` |
| `database/migrations/0017_sitemap_idx.sql` | 2 | `3868e8f38c06` |
| `database/migrations/0018_publication_sort_at.sql` | 14 | `139ec00a4333` |
| `database/migrations/0019_seo_indexed.sql` | 4 | `a7a93ed796a9` |
| `database/migrations/0020_story_summary.sql` | 3 | `f74785110738` |
| `database/migrations/0021_seo_auto_index.sql` | 5 | `28ea4c10fef5` |
| `database/migrations/0022_receipt_attempts_budgets.sql` | 49 | `deb8ed2a4770` |
| `database/migrations/0023_processing_retry.sql` | 10 | `4563f5bc1da4` |
| `database/migrations/0024_grouping_overrides_digest_inputs.sql` | 13 | `8e9510af8f50` |
| `database/migrations/0026_source_icon_checked.sql` | 3 | `4ed154a6ba49` |
| `database/migrations/0027_feedback_forward_error.sql` | 3 | `eae7d9ae3264` |
| `database/migrations/0028_selectbench_mean_score.sql` | 3 | `3cd1fab13375` |
| `database/migrations/0029_source_config_content_public.sql` | 4 | `ba55d3cb46da` |
| `database/migrations/0030_collection_url_index.sql` | 4 | `29bdacc63c64` |
| `database/migrations/0031_selected_ready_index.sql` | 4 | `0fe7f6996930` |
| `database/migrations/0032_regroup_pending.sql` | 7 | `aa7547725e44` |
| `database/migrations/0033_receipt_budget_index.sql` | 5 | `5374022dc798` |
| `database/migrations/0034_lz4_toast.sql` | 6 | `c8d50799c2f6` |
| `database/migrations/0036_open_source_defaults.sql` | 8 | `5c119eab2d95` |
| `database/migrations/0037_x_article.sql` | 3 | `ab21cc9e6d02` |
| `database/migrations/0038_quote_translations.sql` | 10 | `32f9674ba2e8` |
| `database/seeds/lb-models-2026-09-29.json` | 2238 | `ee486f37bfb6` |
| `database/seeds/lb-official-prices-2026-09-26.json` | 59 | `65f7eb58a4f7` |

## 脚本

16 文件，1,298 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `scripts/collect.ts` | 13 | `c456346623b7` |
| `scripts/delete-sources.ts` | 47 | `7c0116070a30` |
| `scripts/enqueue-analysis.ts` | 16 | `092fa4b83710` |
| `scripts/eval-relations-core.ts` | 221 | `ea81683b926f` |
| `scripts/eval-relations.ts` | 198 | `4c515adeafa8` |
| `scripts/eval-selection.ts` | 167 | `a40060bf198b` |
| `scripts/import-leaderboard-prices.ts` | 10 | `b39378fe569c` |
| `scripts/init-env.ts` | 22 | `439e7e2feb20` |
| `scripts/lb-fetch-check.ts` | 99 | `6bc419ee14b1` |
| `scripts/lb-round.ts` | 10 | `01b7d6643090` |
| `scripts/mcp-check.ts` | 27 | `8287b7586306` |
| `scripts/migrate.ts` | 24 | `cf821d86012f` |
| `scripts/nameplates.ts` | 108 | `bc44877498d7` |
| `scripts/regroup-events.ts` | 219 | `f16a4dc7eee5` |
| `scripts/seed.ts` | 53 | `1b3706b42de3` |
| `scripts/smoke.ts` | 64 | `cadd51bcc531` |

## 根测试

37 文件，4,095 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `tests/alerts.test.ts` | 60 | `1eb20c7d651c` |
| `tests/analyze-shutdown.test.ts` | 157 | `0351037672a9` |
| `tests/analyze.test.ts` | 198 | `ee1acc0942fd` |
| `tests/collection.test.ts` | 107 | `431c9d735e85` |
| `tests/default-model.test.ts` | 55 | `a381a81dc543` |
| `tests/embeddings.test.ts` | 53 | `f2bca6bd581e` |
| `tests/events.test.ts` | 314 | `fce6cfff4ad5` |
| `tests/feedback-upload.test.ts` | 54 | `2696ccc14bde` |
| `tests/feedback.test.ts` | 105 | `612914745079` |
| `tests/hot-avatar-payload.test.ts` | 69 | `4e9bdb7a45b8` |
| `tests/icons.test.ts` | 66 | `094defda347d` |
| `tests/leaderboard-worker.test.ts` | 30 | `916fdf701a22` |
| `tests/listings.test.ts` | 119 | `8345e18fc5d3` |
| `tests/materials.test.ts` | 169 | `b1a2f2db35f6` |
| `tests/mcp-shutdown.test.ts` | 31 | `01b71508ec91` |
| `tests/media-performance.test.ts` | 234 | `3d50c4155ea9` |
| `tests/monitor.test.ts` | 48 | `bde019d5ff0c` |
| `tests/publication.test.ts` | 386 | `984df1e0b3da` |
| `tests/receipts.test.ts` | 131 | `49a0eb5a10d0` |
| `tests/relation-eval-runtime.test.ts` | 91 | `6095904412e1` |
| `tests/relation-eval.test.ts` | 110 | `2d5ad86f9371` |
| `tests/report-candidates.test.ts` | 180 | `981c1e7abd09` |
| `tests/report-lead.test.ts` | 23 | `f52493840bcf` |
| `tests/rss-conditional.test.ts` | 86 | `f54443c6eef1` |
| `tests/rss-xhtml.test.ts` | 58 | `03da792c79b7` |
| `tests/setup.ts` | 68 | `dc27d5d63dd3` |
| `tests/signals.test.ts` | 129 | `63efc58ba230` |
| `tests/source-rules.test.ts` | 139 | `ee9c9b7539f6` |
| `tests/sources.test.ts` | 212 | `714058869cad` |
| `tests/translate-shutdown.test.ts` | 78 | `ee28b33011ad` |
| `tests/translate.test.ts` | 138 | `739d71d18aa2` |
| `tests/tsconfig.json` | 4 | `487cd5319c8b` |
| `tests/url-identity.test.ts` | 49 | `954fdb5e788b` |
| `tests/url.test.ts` | 53 | `ce40bbe90d81` |
| `tests/web-list-date.test.ts` | 35 | `62da3679fe9e` |
| `tests/x-article.test.ts` | 97 | `6bebdcfd5fde` |
| `tests/x-shards.test.ts` | 159 | `3962b99fbdf9` |

## 既有文档

7 文件，618 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `docs/architecture.md` | 77 | `864c9209f25f` |
| `docs/customize.md` | 124 | `734ce7664652` |
| `docs/deploy.md` | 110 | `3d2646b69022` |
| `docs/grouping.md` | 77 | `6fdde62197c5` |
| `docs/leaderboard.md` | 53 | `f0d35f4a2aa4` |
| `docs/selection.md` | 80 | `448e08b11315` |
| `docs/sources.md` | 97 | `e74189723fef` |

## 协议参考

1 文件，3,568 行。

| 路径 | 行数 | SHA-256 前 12 位 |
| --- | ---: | --- |
| `reference/public-v1.openapi.json` | 3568 | `a227900ab6f6` |
