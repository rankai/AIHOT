# 部署

## 用 Docker（推荐）

需要一台装了 Docker（带 Compose）的机器。云服务器建议至少 2 核、4 GB 内存，构建镜像时要用到。

```bash
git clone https://github.com/KKKKhazix/AIHOT.git myhot
cd myhot
node scripts/init-env.ts --llm-key <你的模型 API Key>
docker compose up -d --build
```

`init-env.ts` 会生成 `.env`，填好随机密钥和管理员密码，并把密码打印一次。机器上没有 Node 的话，把 `.env.example` 复制成 `.env`，自己填 `ADMIN_PASSWORD`（至少 12 位）、`SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`、`POSTGRES_PASSWORD`（各用 `openssl rand -hex 32` 生成）和 `LLM_API_KEY`。

启动后打开 `http://服务器地址:3000`，后台在 `/admin`，用管理员密码登录。第一次启动会导入示范信源，一两分钟后开始出现内容；第一次导入的一百多条资料大约半小时处理完（每条都要预筛、评分，入选的还要写标题摘要）。

`docker compose` 会起五个容器：`db`（PostgreSQL 17）、`setup`（每次启动先跑数据库迁移和种子数据，然后退出）、`api`、`worker`（抓取、模型处理、定时任务）、`web`（网页）。

### 在中国大陆的服务器上

- 构建时 npm 走国内镜像：`docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com`，然后 `docker compose up -d`。
- 拉取 Docker 镜像慢，先给 Docker 配置镜像加速。
- 海外信源抓不到时，在 `.env` 里设置 `EGRESS_PROXY_URL`：抓信源、图片和模型榜数据时走这个代理，调用模型接口不走。
- 对外提供网站服务需要先完成 ICP 备案，备案号填在 `industry/site.ts` 的 `icp`。

### 配域名和 HTTPS

先把域名解析到服务器，然后在 `.env` 里设置：

```bash
SITE_URL=https://example.com
SITE_DOMAIN=example.com
PORT=127.0.0.1:3000        # 3000 端口只给本机的 Caddy 用，不直接对外
TRUST_PROXY=true           # 访客地址从 Caddy 转来的请求头里读
```

再用带 HTTPS 的方式启动，Caddy 会自动申请和续期证书：

```bash
docker compose --profile https up -d --build
```

已经有 Nginx 的话，不用 Caddy，把站点反向代理到 `http://127.0.0.1:3000`，带上 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，并在 `.env` 里设 `TRUST_PROXY=true`。`SITE_URL` 一定要写成读者实际访问的地址：生成的链接、RSS、分享图和 MCP 都用它。

### 更新

```bash
git pull
docker compose up -d --build
```

数据库结构迁移更新时自动执行；它不代替已有 X/公众号的采集数据切换。

### 已有 X/公众号站点的一次性切换

这一步只用于升级到共用采集订阅生命周期的旧站点。生产操作须另外授权，先安排维护窗口：

1. 停止旧 API/Worker 的手工采集、配置写入和新调度，让已发出的请求落回执并收尾，确认旧写者全部停止。备份数据库。
2. 使用当前版本执行数据库结构迁移，再显式运行 `node --env-file=.env scripts/migrate-native-collection.ts --old-writers-stopped`。Docker 可在旧写者停止后用当前镜像的一次性 setup 容器执行此命令；不要先启动旧 Worker。常规 setup 只跑结构迁移与 seed，不执行此数据切换。
3. 核对输出的 `inspected`、`created`、`blocked` 和主订阅状态，确认旧队列已收尾。`blocked` 表示原请求输入不可安全重建或原配置不合法；到原任务核实并显式放弃阻断轮次，必要时修正订阅配置。不要删除回执或猜测参数重新外发。
4. 确认范围内订阅与旧队列处理完成后，启动当前 API/Worker。先保持 Redfox 总阀关闭，验证原供应商共用流程，再按授权选择合格源显式切换。

可重复传 `--source <id>` 只迁指定源，例如 `--source x-example --source mp-example`；部分迁移的统计仅代表指定范围，不表示全站完成。默认处理全部 X/公众号源，包括停用源。脚本按源事务、可失败重跑，已接管订阅不会被旧快照覆盖；它读取有限的本地历史范围，但不限制每个源的未决回执数量，不截断证据，不调用供应商。

回退优先关闭 `REDFOX_CALLS_ENABLED` 或 `AGENTKEY_CALLS_ENABLED`，保留当前 Worker 与已收证据供本地恢复。换回 SocialData/Dajiala 须通过当前版本同一主订阅的预检和更新。旧 Worker 只认识旧 source 快照，也不了解 AgentKey 工具/解析合同，不能直接恢复运行；程序降级须另外暂停在途 AgentKey 任务并核对有效订阅、水位、回执与私有文件，或向前修复。

### 备份

在 `.env` 里配置 `DB_BACKUP_STORE_*`（任何 S3 兼容的对象存储），每天 04:10 自动备份到那里。也可以手动导出：

```bash
docker compose exec -T db pg_dump -U aihot aihot | gzip > myhot-$(date +%F).sql.gz
```

数据都在三个 Docker 卷里：`db`（数据库）、`data`（上传的图片、图片缓存、本地备份）、`caddy`（证书）。`docker compose down` 不会删除它们；`docker compose down -v` 会。

### 看日志

```bash
docker compose logs -f --tail 100 api worker web
```

后台的“运行”页能看到每个定时任务最近的结果，“信源”页能看到每个信源的抓取状况。

## 花多少钱

- **模型**：每条新资料至少预筛一次；可能入选的再评分两次，入选的还要写标题摘要、打标签、归组，另外还有日报和事件综述。我们用示范信源在本地试跑，第一次导入的 152 条资料一共用了大约 930 次模型调用。之后每天用多少，取决于你的信源每天更新多少条。后台“模型与评测”页能看到每一步的调用次数和输入输出 token 数。
- **付费采集**（X、公众号、Jina、Redfox、AgentKey）：按请求计费，需要后端凭证及预算。Redfox 还需显式设置 `REDFOX_CALLS_ENABLED=true`，其 9 个用途预算默认均为 0；AgentKey 还需显式设置 `AGENTKEY_CALLS_ENABLED=true`，`agentkey.collect` / `agentkey.query` 默认均为 0。填 key 不会启用或切换供应商。采集另受 `COLLECT_ENABLED` 控制，`MODEL_CALLS_ENABLED` 只控制模型处理。
- 所有付费服务都有每分钟、每小时、每天的调用上限（后台“设置 → 预算”），超过就暂停，不会一夜之间刷爆账单。填 0 表示立即停用这个服务。

## 不用 Docker

需要 Node.js 24.11 以上和 PostgreSQL 16 或 17。

```bash
npm ci
node scripts/init-env.ts --llm-key <你的模型 API Key>
createdb myhot
```

在 `.env` 里加上：

```bash
DATABASE_URL=postgres://你的用户名@127.0.0.1:5432/myhot
API_BASE_URL=http://127.0.0.1:3001
```

然后：

```bash
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
npm run build -w @aihot/web

node --env-file=.env apps/api/src/main.ts          # 接口，3001 端口
node --env-file=.env apps/worker/src/main.ts       # 后台任务
cd apps/web && NODE_ENV=production node --env-file=../../.env server.ts   # 网页，3000 端口
```

三个进程要一直运行，生产环境用 systemd 或 pm2 守护。

开发时用带热更新的方式：`npm run dev:api`、`npm run dev:worker`、`npm run dev:web`。开发时想免登录进后台，在 `.env` 里设 `DEV_AUTH_ROLE=admin`（生产环境会拒绝启动）。
