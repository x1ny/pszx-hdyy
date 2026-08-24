# pszx-hdyy Docker 流程

## 镜像里装了什么

一个容器、一个进程、一个端口：**前后端跑在同一个 Hono 里**。

- `bun build` 把 `apps/server` 打成单文件 `/app/server.js`，依赖全部内联，所以
  运行阶段**不带 node_modules**。
- `apps/web` 的 Vite 产物放在 `/app/web`，由 `apps/server/src/index.ts` 里的
  `serveStatic` 托管，挂在 session 中间件之前 —— 静态资源不查库。
- `/api/*` 归业务路由，其余路径找不到文件就回落 `index.html` 交给 TanStack Router。

同源带来的直接好处：不需要 CORS、`trustedOrigins` 不用加域名、`VITE_API_URL`
不用设（前端走 `window.location.origin`），所以**同一个镜像能跑遍所有环境**。

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
docker run -d -p 80:80 -e DATABASE_URL=postgresql://user:pass@db:5432/pszx_hdyy -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) -e APP_URL=https://hdyy.example.com -v pszx-hdyy-files:/app/data/files pszx-hdyy:dev
```

### 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 是 | — | Postgres 连接串。缺失时容器直接退出 |
| `BETTER_AUTH_SECRET` | 是 | — | `openssl rand -base64 32`。缺失时容器直接退出 |
| `APP_URL` | 是* | — | 浏览器访问的地址。entrypoint 用它派生下面两个 |
| `BETTER_AUTH_URL` | 是* | 由 `APP_URL` 派生 | 单独设会覆盖派生值 |
| `WEB_ORIGIN` | 是* | 由 `APP_URL` 派生 | 同上 |
| `BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS` | 否 | `604800`（7 天） | 会话有效期，单位秒；测试环境设为 `28800` 即 8 小时 |
| `SERVER_PORT` | 否 | `80` | |
| `FILE_STORAGE_DIR` | 否 | `/app/data/files` | |
| `FILE_MAX_SIZE_BYTES` | 否 | `52428800`（50 MiB） | |
| `WEB_DIST_DIR` | 否 | `/app/web` | 置空则只跑 API，不托管前端 |

\* `APP_URL` 和 `BETTER_AUTH_URL`/`WEB_ORIGIN` 二选一，都不给容器起不来。

### 上传文件必须挂卷

`/app/data/files` 是上传文件的落盘位置，写的是容器本地磁盘。**不挂卷的话每次
重新部署已上传的文件全部丢失**。Rancher 上要挂 PVC，`docker run` 要带 `-v`。

### 数据库迁移不在容器里做

镜像里没有 drizzle-kit，entrypoint 也不碰数据库。schema 变更由人在部署前执行：

```bash
bun run db:push
```

这是刻意的选择 —— 容器启动时自动 `push` 会为了对齐 schema 而删列改类型，且没有
任何审计记录。等哪天需要自动化了，先 `bun run db:generate` 把迁移落成 SQL 文件
纳入仓库，再让 entrypoint 跑 `drizzle-kit migrate`。
