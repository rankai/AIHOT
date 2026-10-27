# 历史视频事实补齐

入口为 `scripts/video-history.ts`，复用 `content/video-history.ts` 的材料媒体领域能力。默认只读 dry-run，不加载 `.env`；必须显式设置 `DATABASE_URL`，并由操作者确认目标。真实库执行须单独授权，本轮仅验证独立测试库。

```sh
# 使用已经明确指定的 DATABASE_URL；不要通过 npm 的 env-file 入口运行。
node scripts/video-history.ts --manifest /private/tmp/video-history.json --limit 500
node scripts/video-history.ts apply --manifest /private/tmp/video-history.json
node scripts/video-history.ts restore --manifest /private/tmp/video-history.json
```

`--limit` 取 1–5000，按文章 ID 扫描一批；输出与清单中的 `nextCursor` 非空时，以它作为下次 `--after ARTICLE_ID`，并使用新的清单路径。游标按已扫描文章推进，首批没有可补齐项也能继续；`nextCursor: null` 表示该次扫描已到末尾。新插入且 ID 位于已扫区间的文章可从头重新扫描。dry-run 拒绝覆盖已有清单，输出候选数量和具体跳过原因。不要把清单提交到 Git。清单保存文章/来源/结果身份、修订、来源时间、媒体前后哈希、证据哈希、无 URL 视频槽位置及本轮状态，不保存媒体 URL、正文或原始回执。已有 URL 型材料身份仍保留其原文身份键。

允许两类已存证据：

- 当前 `articles.body_html` 中通过既有 `videoMediaFromHtml` 检查的真实视频元素；apply 重验正文哈希、修订和来源时间。模型译文、链接、iframe、代码示例不算。
- 已关联 operation result 及原始成功回执：复用平台 parser 与既有 AgentKey 证据校验，重验请求、结果、作品和作者绑定。缺少可信证据时跳过；只有一个关联结果、首修订且没有来源更新时钟的历史导入，才采用这条保守的回执路径。多次结果、已修订或有来源时钟的记录不据旧回执推断最新视频状态；如当前原始正文有证，仍可走正文路径。

Redfox 仅复用既有已证平台字段及已验证回执中原本作为全文导入的正文，识别发生在净化删除 `<source>` 之前；MP 详情有直接作者证据时可复用，只有账号上下文而无可复核作者字段的旧详情仍跳过。AgentKey 只覆盖 V4、BV、小红书与 H5 的已有成功证据。缺证路线不恢复、不补购。旧 SocialData 模糊 `kind=video` 没有原类型/已关联回执时不猜。工具不调用供应商、下载视频、入队分析、评分或修改权限、正文、内容 hash、发布时间。

apply 每条重新验证，在文章行锁内比较快照，再通过 `mergeMaterialMedia` 只补一个无 URL 确认事实。restore 通过 `restoreMaterialMedia`，要求当前媒体精确等于本轮 after、身份/修订/来源时间未变；只恢复该槽，后续变化一律跳过。

CLI 采用一个数据库事务与每条 savepoint，先把结果清单写入同目录临时文件、fsync、原子 rename 并 fsync 目录，再提交数据库，避免数据库已提交而清单仍为 planned。若在文件落盘后、数据库提交前中断，下一次执行会按完整 before/after 快照重新核对清单状态：apply 回滚恢复为 planned，restore 回滚恢复为 applied；有任何后续变化则跳过。该恢复使用同一清单，不新增表或日志框架。输出中的 changed 只在事务提交成功后打印。
