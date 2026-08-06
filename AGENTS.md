<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `bunx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# 项目约定

## 仓库结构

Bun workspaces monorepo，三个包：

```
apps/web       Vite + TanStack Router，纯 SPA（端口 3000）
apps/server    Hono + Better Auth（端口 8787）
packages/db    Drizzle schema + 数据库客户端，被 server 和 drizzle-kit 共用
```

包名分别是 `@repo/web`、`@repo/server`、`@repo/db`。根 `package.json` 只放 workspaces 声明、Biome、TypeScript 和跨包编排脚本，**不要**往根上加业务依赖。

**开发工具链一律用 `bun` / `bunx`**，不要用 `npm`、`pnpm`、`yarn`。

| 任务 | 命令（在仓库根执行） |
| --- | --- |
| 安装依赖 | `bun install` |
| 起开发环境 | `bun run dev`（先 `docker compose up -d`，再同时起 server 和 web） |
| 生产构建（web） | `bun run build` → 产物在 `apps/web/dist/` |
| 类型检查（全部包） | `bun run typecheck` |
| 测试 | `bun run test` |
| Lint + 格式化 | `bun run check` |
| 数据库推送 / 迁移 | `bun run db:push` / `db:generate` / `db:migrate` / `db:studio` |
| 重新生成路由树 | `bun run --filter '@repo/web' generate-routes` |
| 添加 shadcn 组件 | 在 `apps/web` 下 `bunx shadcn@latest add <name>` |

单独起某个包用 `bun run --filter '@repo/server' dev`。

## 前后端边界

**前端不直接 fetch，走 Hono RPC。** `apps/server/src/index.ts` 把路由**链式**定义在一个 `const routes` 上并导出 `AppType`，`apps/web/src/lib/api.ts` 用 `hc<AppType>()` 建客户端，请求和响应类型全自动推断。

- 加接口时必须**接在链上**（`.get(...).post(...)`），单独写 `app.get(...)` 不会进 `AppType`，前端就拿不到类型
- `apps/web` 只用 `import type` 引 `@repo/server`，**绝不 runtime import** —— 服务端代码不能进浏览器包
- **不要引入 tRPC 或 oRPC**，先问过再说

浏览器只认一个 origin：`apps/web/vite.config.ts` 里的 proxy 把 `/api` 转发到 8787。因此开发环境不需要 CORS，Better Auth 的 cookie 也不涉及跨站问题。**如果要把前后端部署到不同域名**，得同时做三件事：server 加 `hono/cors` 中间件、`auth.ts` 的 `trustedOrigins` 加上 web 域名、web 侧设 `VITE_API_URL`。

## 认证

- `apps/server/src/lib/auth.ts` — Better Auth 实例（Drizzle adapter + 邮箱密码）
- `apps/server/src/index.ts` — `app.on(["GET","POST"], "/api/auth/*", ...)` 挂载 handler。**它必须注册在 session 中间件之前**：该 handler 不调用 `next()`，先注册就能让 auth 自己的路由跳过多余的 session 查询
- session 中间件把 `user`/`session` 放进 Hono context，受保护的接口从 `c.get("user")` 取，为空返回 401（见 `/api/me`）
- `apps/web/src/lib/session.ts` — 用 react-query 缓存 `authClient.getSession()`
- `apps/web/src/routes/_authenticated.tsx` — 登录守卫（pathless layout），未登录跳 `/login?redirect=...`；受保护页面放在 `_authenticated/` 下自动继承

**登录/登出后必须 `queryClient.removeQueries({ queryKey: sessionQueryKey })`。** 守卫用的是 `ensureQueryData`，它**即使数据已过期也会先返回缓存**，所以 `invalidateQueries` 不够 —— 登录成功后守卫会读到旧的 `null` 并把用户弹回登录页。必须把缓存条目删掉，逼守卫重新请求。

## 渲染模型

`apps/web` 是**纯客户端 SPA**，没有 SSR，也没有 server function 这种东西。`index.html` 是唯一的 HTML 壳，`src/main.tsx` 挂载 `RouterProvider`，`QueryClientProvider` 也在那里。路由的 `beforeLoad`、`loader`、组件全部只在浏览器执行。

安全含义：前端的路由守卫、菜单过滤、按钮显隐**都不是安全边界**，用户绕过界面直接打 `/api/*` 即可。每个受保护的接口必须在 Hono handler 内部独立校验。

## 技术栈

- TanStack Router 文件式路由 —— 路由文件在 `apps/web/src/routes`，`routeTree.gen.ts` 由 `@tanstack/router-plugin` 自动生成，**绝对不要手改**。`vite.config.ts` 里 `tanstackRouter()` 必须排在 `viteReact()` 前面
- TanStack Query，router context 里带 `queryClient`（见 `integrations/tanstack-query/root-provider.tsx`）
- Tailwind CSS v4 + shadcn/ui（配置见 `apps/web/components.json`）
- Hono，运行在 Bun 上（`export default { port, fetch }`）
- Drizzle ORM + Postgres（docker-compose 起本地库）
- Biome 负责 lint 和格式化（缩进 tab，字符串双引号）—— 收尾前务必跑 `bun run check`
- Vitest + happy-dom + Testing Library，只在 `apps/web`，配置在 `vitest.config.ts`，**刻意**与 `vite.config.ts` 分开

## 运行时

开发和生产目前都是 Bun：`apps/server/src/index.ts` 的默认导出 `{ port, fetch }` 是 Bun 的服务器约定，Node 不认。

> 拆 monorepo 之前的规则是"开发 Bun、生产 Node"，那是因为 Nitro 会打包出自包含的 Node 服务器。现在没有 Nitro 了。如果仍要在生产用 Node，需要加 `@hono/node-server` 并改 `start` 脚本 —— 这个决定还没做，动之前先问。

`typeof Bun !== "undefined" ? Bun.version : process.version` 这种运行时探测的写法保留在 `/api/server-info` 里，仍然是引用 `Bun` 全局的唯一合法方式。

## 路径别名

`apps/web` 里用 `#/*` 指向 `apps/web/src/*`（`package.json` 的 `imports` + `tsconfig.json` 的 `paths` 两处都要有）。

**`apps/server` 里只用相对路径导入。** `tsconfig` 的 `paths` 是整个 program 级别的，`apps/web` 通过 `import type` 把服务端源码拉进自己的 program 后，会拿 web 的 `#/*` 去解析服务端文件里的 `#/`，直接解析错。相对路径没这个问题。

## 404 与错误处理

`apps/web/src/router.tsx` 把 `defaultNotFoundComponent` 指向 `src/components/not-found.tsx`。单个路由可以用自己的 `notFoundComponent` 覆盖。目前**还没有**配置 `defaultErrorComponent`。

## 样式

深色模式是**有意禁用**的。`apps/web/src/styles.css` 只定义亮色 token，并把 Tailwind 的 `dark:` 变体绑定到一个永远不会被添加的 `.dark` class 上 —— 正是这一点，才挡住了 shadcn 组件内置的 `dark:` 工具类跟随操作系统 `prefers-color-scheme` 生效。**不要擅自**添加 `.dark` token 块、主题切换开关，或 `prefers-color-scheme` 媒体查询，先问过再说。
