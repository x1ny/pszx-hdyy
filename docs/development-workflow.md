---
status: current
summary: 开发环境、数据库连接、运行入口、检查与交付
read_when:
  - 启动开发环境
  - 连接数据库或维护种子
  - 修改 Bun 服务入口或端口
  - 执行检查和交付
---

# 开发工作流

本文记录当前操作方式。部署参数和发版步骤见 [Docker 流程](../docker/README.md)，迁移操作见 [数据库迁移](database-migrations.md)。

## 启动与数据库

**默认的 `bun run dev` 起的是一次性数据库**：每个 worktree 一个 tmpfs 容器、随机端口，自动建表 + 灌种子（约 3 秒），Ctrl-C 就销毁——多个 worktree 并行不会互相踩数据。要看积累的真实数据用 `bun run dev:persist`（连 docker-compose 那个持久库，**只跑迁移、不灌种子**——它和生产走同一份 `migrate.ts`，正好预演生产的迁移路径）。

**登录直接访问 `/api/dev/login`**：一次 GET 就进登录态（种子账号 `dev@example.com`），带 `?redirect=/project/1` 可直接落到指定页面。它走 Better Auth **完整的真实认证链路**（真 session、真 cookie、照常过 `sessionMiddleware`），所以守卫和会话相关的坑照样暴露得出来。只在 `DEV_AUTH_BYPASS=1` 时存在，生产形态下带着这个开关启动会直接拒绝启动。**可以自行用浏览器登录、点页面、走真实操作来调试，不用每次问。**

**要连"正在跑的那个"临时库**（`db:studio`、排查脚本）：已经配好了——`bun run dev` 把真实连接串写进 gitignored 的 `apps/server/.dev-db.env`，db 系列脚本按 `.env` → `.dev-db.env` 顺序读，后者覆盖前者。**别手写 `localhost:5432`**，那是持久库，你会在另一个库里看到一堆真实数据，然后得出完全错误的结论。

**种子在 `apps/server/src/dev-seed/`**，数字前缀决定执行顺序，固定 ID 在 `context.ts`。可直接导航：`/project/1`、`/project/1/activity/1/agenda`（**刻意埋了一处人员时间冲突**）、`/project/1/activity/1/seating/1`（50 座位 / 50 候选人）、`/member`（51 人）、`/venue`、`/supplier`。**改了 schema 就顺手 `bun run db:generate` 生成迁移**（`bun run test` 会拦住漏生成的），**并顺手改种子**——一律用 typed insert，字段改了 `typecheck` 直接报错；新增模块加一个带数字前缀的文件即可（序号留了间隔，**不用改任何已有文件**），种子只对空库负责，不需要幂等逻辑。

## 进程与端口

**开发端口**：`bun run dev` 由 `scripts/dev.ts` 统一起三个进程。`SERVER_PORT`(8787) / `WEB_PORT`(3000) / `H5_PORT`(3001) 是首选值，被占用时向上找且互相排除；后端端口同时传给 Hono 和两个 Vite 代理，前端端口变化时同步更新认证 origin——避免端口漂移后代理或 Better Auth 还指着旧的。`WEB_ORIGIN` / `BETTER_AUTH_URL` 只跟管理端走（h5 是另一套身份，不进 `trustedOrigins`）。两个 Vite 的 stdin 给 `"ignore"`，否则两个进程抢同一个 TTY 会把按键随机分走。**Vite 必须用 `bun vite …`，不要加 `--bun`**：Windows 下会导致自动换端口失效（已有进程监听 `[::1]:3000` 时仍可能另绑 `127.0.0.1:3000`）。单独起某个包用 `bun run --filter '@repo/server' dev`，不经过这层协调。

依赖安装在 Windows 深路径 worktree 中出现 copyfile ENOENT 或 Invalid hook call 时，按 [Windows 专题](windows-worktree-notes.md) 排查；不要在同一个工作树中途切换 isolated/hoisted linker。

## 检查命令

| 任务 | 仓库根命令 |
| --- | --- |
| 类型检查 | `bun run typecheck` |
| 全部测试（包括知识入口检查） | `bun run test` |
| 本次 TS/TSX 文件格式与 lint | `bunx biome check <文件...>`，不加 `--write` |
| 当前资料发现 / 校验 | `bun run docs:list` / `bun run docs:check` |
| 项目 skill 入口同步 / 校验 | `bun run skills:sync` / `bun run skills:check`，见 [Skill 工作流](skill-workflow.md) |
| 生产构建 | `bun run build` |
| 路由树生成 | `bun run --filter '@repo/web' generate-routes`；h5 换为 `@repo/h5` |
| 垃圾容器、卷与分支回收 | `bun run prune` 只列；`--yes` 才执行 |

`bun run check` 当前是 `biome check --write`，不是只读收尾。全仓格式化仅在明确需要且工作树干净时执行，随后核对 `git diff --name-only`。Biome 决定格式：TS/TSX 两空格、双引号，JSON 等使用配置中的 tab；不要手工重复维护一套格式规则。

管理端有 Vitest + happy-dom + Testing Library，`vitest.config.ts` 与 Vite 配置分开。H5 已有 `bun test`（例如座位图布局纯逻辑），尚不能据此推断具有同等组件测试装置。服务端使用 Bun 测试；SQL 字符串和 Mock 检查不能替代真实数据库事务验收。

## 交付与已知失败

master 历史必须线性，**这条由 git 自己执行**：`merge.ff = only` / `pull.ff = only` 让非快进合并直接失败，`.githooks/` 下的 `pre-merge-commit` 和 `pre-commit` 堵住 `--no-ff` 和"解完冲突再 commit"这条绕过路径，由 `postinstall` 自动落地。**别用 `git merge --no-ff` 抄近路**——钩子会拒绝，并把仓库留在未完成的合并状态（要 `git merge --abort` 才能退出）。

**agent 干完活的终点是"rebase 完成且检查通过"，不是"已合并"：**

```bash
git fetch
git rebase master          # 在功能分支里做，冲突自己解
bun run typecheck && bun run test
```

然后停下来告诉用户可以合了。合进 master 由用户执行 `git merge --ff-only <分支>`——不可逆，且并行分支的合并顺序互相影响，需要人来编排；那条 `--ff-only` 如果失败就说明 rebase 没做对。

**2026-09-13 在 `7e72b28` 复核的 `bun run test` 基线有 3 个已知失败**，都在 `apps/server/src/modules/invitation/docx.test.ts` 的「真实模板（商会）」用例上，**在 master 上同样是红的**：出厂模板带 4 个占位符，而测试是照更早那版写的。**不是你造成的，也不要顺手改**——改测试期望等于替 invitation 模块决定「出厂模板该不该预置占位符」，那是产品口径。除这 3 个之外必须全绿，多出任何一个失败都是你的。

新的检查结果优先于旧的统计数字。遇到不同基线先复现，不自动沿用失败豁免；不吞掉测试退出码，不放宽产品期望。当前根脚本会在测试中执行知识入口检查，文档维护不依赖某个 Agent 宿主 hook。

## 应用服务入口

开发和生产目前都是 Bun：`apps/server/src/index.ts` 的默认导出 `{ port, fetch }` 是 Bun 的服务器约定，Node 不认。同一个文件末尾还有一处显式 `Bun.serve`，那是 h5 的第二个端口（只在设了 `H5_DIST_DIR` 时执行）。这两处加上 `modules/example/routes.ts` 里 `getServerInfo` 的运行时探测，是应用服务入口中引用 `Bun` 全局的位置（本仓库的 Bun 开发脚本另计）。

两处 `fetch` 都不能简写成 `fetch: app.fetch`，但**包装时必须把 Bun 的 Server 一起传进去**：

```ts
fetch: (request, server) => app.fetch(request, { server, staticApp: … })
```

Bun 传给 `fetch` 的第二个参数是它自己的 Server 对象，默认会成为 Hono 的 `c.env`。直接用 `app.fetch` 则静态中间件读不到该端口的 `staticApp`；而只传 `{ staticApp }` 又会把 Server 挤掉，`hono/bun` 的 `getConnInfo()` 就拿不到 `requestIP()`——免密登录入口的回环地址检查（`modules/auth/routes.dev.ts`）会直接抛 `TypeError: server.requestIP is not a function`。Hono 的 Bun 适配器认两种形状（`c.env` 本身是 Server，或 `c.env.server` 是 Server），我们要在同一个 env 里塞第二样东西，所以只能用后者。

**在 `c.env` 里加东西时，先 grep 一遍 `hono/bun` 的用法。** 这个坑不会在类型层面暴露，只会在运行时炸在某一条具体路由上。

> 拆 monorepo 之前的规则是"开发 Bun、生产 Node"，那是因为 Nitro 会打包出自包含的 Node 服务器。现在没有 Nitro 了。如果仍要在生产用 Node，需要加 `@hono/node-server` 并改 `start` 脚本 —— 这个决定还没做，动之前先问。


## 参考资料的工具范围

交接和静态原型目录保留 Git 可见性，但不进入应用源码检查或默认知识索引。`.cursorignore`、`.vscode/settings.json` 和 Biome 各自负责对应工具范围；新增同类资料沿用该原则，不通过 `.gitignore` 隐藏资料。Biome HTML 只纳入实际应用入口，避免 `**/index.html` 扫到原型。
