# pszx-hdyy Docker 流程

## 镜像里装了什么

一个容器、一个进程、**两个端口**：管理端和 h5 跑在同一个 Hono 里。

| 端口 | 前端 | 静态目录 | API |
| --- | --- | --- | --- |
| 80 | `apps/web` 管理端 | `/app/web` | 完整的 `/api/*` |
| 81 | `apps/h5` 移动公众端 | `/app/h5` | 完整的 `/api/*` |

- `bun build` 把 `apps/server` 打成单文件 `/app/server.js`，依赖全部内联，所以
  运行阶段**不带 node_modules**。
- 两份 Vite 产物由 `apps/server/src/index.ts` 里的 `serveStatic` 托管，挂在
  session 中间件之前 —— 静态资源不查库。端口之间唯一的差别就是静态目录，它通过
  Hono 的 bindings 由每个 server 各自传进来。
- `/api/*` 归业务路由，其余路径找不到文件就回落各自的 `index.html` 交给
  TanStack Router。

**两个端口都提供完整的 API，所以两端各自同源。** 直接好处：不需要 CORS、
`trustedOrigins` 不用加域名、`VITE_API_URL` 不用设（前端走
`window.location.origin`），所以**同一个镜像能跑遍所有环境**。

线上把两个端口分别挂到两个域名下（管理端 / h5 各一个），前端的 `base` 和路由
`basepath` 因此都保持 `/`，不需要任何路径前缀处理。

> **Cookie 不按端口隔离。** `http://ip:80` 和 `http://ip:81` 在 CORS 意义上是不同
> origin，但共用同一个 cookie jar —— 端口不参与 cookie 作用域。生产上两个端口挂在
> 不同域名后面，域名会把它们隔开；但**按 `IP:端口` 直接访问测试环境时会串**。所以
> h5 那套会话的 cookie 必须显式起一个不和 Better Auth 冲突的名字。

## 本地构建

```bash
docker buildx build --platform linux/amd64 --file docker/Dockerfile --load --tag pszx-hdyy:dev .
```

构建机拉不到 Docker Hub 时，把基础镜像换成私有仓库里的：

```bash
docker buildx build --build-arg BUN_IMAGE=<私有仓库的 bun 镜像> --file docker/Dockerfile --load --tag pszx-hdyy:dev .
```

## 构建并推送

```bash
bun run docker:build-push v0.1.0
```

不传版本号时用最新 Git tag。单架构镜像先 `--load` 到本地再 push，多架构由
Buildx 直接推。`BUN_IMAGE` / `NPM_REGISTRY` 两个环境变量会透传成 `--build-arg`。

## 发布版本

```bash
bun run release
```

依次接受 `major` / `minor` / `vX.Y.Z`，不传参数就是 patch。要求工作区干净、
当前在 `master`、且与 `origin/master` 同步（可用 `RELEASE_MAIN_BRANCH` 覆盖分支）。

## 测试环境部署

先把 Rancher 的 workload redeploy 地址和 token 填进 `scripts/deploy-test.config.ts`，然后：

```bash
bun run deploy:test
```

脚本会先构建并推送 `:test` 镜像，再调 Rancher redeploy API。也可以用
`RANCHER_REDEPLOY_URL` / `RANCHER_DEPLOY_TOKEN` / `DEPLOY_INSECURE_TLS` 临时覆盖。
测试环境的运行时变量由 Rancher workload 管理，不读取仓库根目录的 `.env`；
要让会话在 8 小时后过期，在 workload 中设置
`BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS=28800` 后再部署。

## 容器运行

```bash
docker run -d -p 80:80 -p 81:81 -e DATABASE_URL=postgresql://user:pass@db:5432/pszx_hdyy -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) -e APP_URL=https://hdyy.example.com -v pszx-hdyy-files:/app/data/files pszx-hdyy:dev
```

### 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 是 | — | Postgres 连接串。缺失时容器直接退出 |
| `BETTER_AUTH_SECRET` | 是 | — | `openssl rand -base64 32`。缺失时容器直接退出 |
| `APP_URL` | 是* | — | **管理端**在浏览器里的访问地址。entrypoint 用它派生下面两个。h5 不需要配，它和自己的 API 同源，前端直接用 `window.location.origin` |
| `BETTER_AUTH_URL` | 是* | 由 `APP_URL` 派生 | 单独设会覆盖派生值 |
| `WEB_ORIGIN` | 是* | 由 `APP_URL` 派生 | 同上 |
| `BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS` | 否 | `604800`（7 天） | 会话有效期，单位秒；测试环境设为 `28800` 即 8 小时 |
| `SERVER_PORT` | 否 | `80` | 管理端端口 |
| `FILE_STORAGE_DIR` | 否 | `/app/data/files` | |
| `FILE_MAX_SIZE_BYTES` | 否 | `52428800`（50 MiB） | |
| `WEB_DIST_DIR` | 否 | `/app/web` | 置空则 80 端口只跑 API，不托管管理端 |
| `H5_PORT` | 否 | `81` | h5 端口 |
| `H5_DIST_DIR` | 否 | `/app/h5` | **置空则整个 h5 端口不启动**（只有它设了才 listen 第二个端口） |
| `SKIP_MIGRATIONS` | 否 | `0` | 设为 `1` 跳过启动时的数据库迁移。应急用，正常部署不要设 |
| `MIGRATIONS_DIR` | 否 | `/app/drizzle` | 迁移 SQL 的位置，基本不需要改 |

\* `APP_URL` 和 `BETTER_AUTH_URL`/`WEB_ORIGIN` 二选一，都不给容器起不来。

### 上传文件必须挂卷

`/app/data/files` 是上传文件的落盘位置，写的是容器本地磁盘。**不挂卷的话每次
重新部署已上传的文件全部丢失**。Rancher 上要挂 PVC，`docker run` 要带 `-v`。

### 数据库迁移在容器启动时自动执行

entrypoint 在 `exec` 应用之前跑一次 `/app/migrate.js`，把 `/app/drizzle` 下的迁移
SQL 应用到 `DATABASE_URL` 指向的库。**部署前不需要人手做任何 schema 操作。**

- 幂等：没有待执行的迁移就空转返回。
- 并发安全：用 Postgres 的 advisory lock 串行化，多副本同时启动会自动排队
  （drizzle 的 migrator 自己一把锁都没有，那把锁是我们加的）。
- 失败即拒绝启动：entrypoint 是 `set -eu`，迁移失败容器就起不来。这是有意的 ——
  schema 没就位却把应用放出去服务，故障会以「某个页面偶尔 500」的形式出现。
- 应急阀门：`SKIP_MIGRATIONS=1` 可以跳过这一步。

镜像里**仍然没有 drizzle-kit**：`migrate.js` 只内联了 drizzle-orm 的 migrator 和 pg
（281 KB），运行阶段依然零 node_modules。

**已有数据的库第一次接入时需要先打基线**（否则会从 `0000` 开始建表并报
`relation already exists`）。测试环境属于这种情况，步骤见
[docs/database-migrations.md](../docs/database-migrations.md) 第 6 节。

滚动发布、回滚、并行分支的坑，同一份文档里都有。一条硬规矩先记住：
**迁移只做加法**，删列改类型必须拆成两次发版。
