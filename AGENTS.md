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

**不遵循 REST，业务语义和 HTTP 协议解耦，但不引入 RPC 框架（不上 tRPC/oRPC）——就用 Hono 本身 + 一份共享约定。** 详细讨论和实测数据见 [docs/architecture-decisions.md](docs/architecture-decisions.md#前后端类型安全)，这里只写规则：

- **路径是动作名，不是资源。** 用 `getServerInfo`、`submitEcho` 这种动词开头的名字，不要建 `/projects/:id` 这种资源路径。**全部用 POST**，HTTP 动词不承载任何业务含义。
- **HTTP 状态码不表达业务结果，只有 `code` 字段表达。** 见 `apps/server/src/shared/result.ts` 的 `ApiResult<T>` —— `{ code: "OK", data } | { code: "UNAUTHORIZED" | "VALIDATION_ERROR" | ..., message }`。业务失败（未登录、校验不过）也返回 HTTP 200，前端永远靠 `result.code` 分支，不看 `res.status`。真正的非 200 只留给两种非业务场景：请求体不合法（`zValidator` 的 error hook）、handler 里未捕获的异常（`index.ts` 的 `app.onError`）。
- 输入用 `zValidator("json", Schema, errorHook)`，输出用 `c.json(ok(...))` / `c.json(err(...))`——**两边都过一遍 `shared/result.ts` 的信封**，别有的接口走信封有的不走。
- 路由必须**接在链上**（`app.post(...).post(...)`），单独写 `app.post(...)` 不会进 `AppType`
- `apps/web` 只用 `import type` 引 `@repo/server`，**绝不 runtime import** —— 服务端代码不能进浏览器包
- 客户端用 `apps/server/src/client-type.ts` 导出的 `hcWithType`，不要直接用 `hc`——前者把类型计算挪到编译期，路由多了以后 IDE 不会变卡（[Hono 官方的 known issue](https://hono.dev/docs/guides/rpc#using-rpc-with-larger-applications)）
- **不要引入 tRPC 或 oRPC**，这是明确讨论过否掉的方向,不要因为"更方便"就重新引入

浏览器只认一个 origin：`apps/web/vite.config.ts` 里的 proxy 把 `/api` 转发到 8787。因此开发环境不需要 CORS，Better Auth 的 cookie 也不涉及跨站问题。**如果要把前后端部署到不同域名**，得同时做三件事：server 加 `hono/cors` 中间件、`auth.ts` 的 `trustedOrigins` 加上 web 域名、web 侧设 `VITE_API_URL`。

## 后端目录结构：按业务功能拆，不按类型拆

```
apps/server/src/
├── modules/
│   ├── auth/            Better Auth 相关的一切
│   │   ├── auth.ts               betterAuth() 实例
│   │   ├── context.ts            Variables 类型（user/session 在 Hono context 里的形状）
│   │   ├── routes.ts             /api/auth/* 的官方挂载写法
│   │   └── session-middleware.ts 填充 c.get("user")/c.get("session")
│   └── example/          占位示例，不是真实业务，新功能来了随时可以删掉这个目录
│       ├── schemas.ts
│       └── routes.ts
├── shared/
│   └── result.ts         ApiResult<T> / ok() / err()，唯一跨模块的公共词汇表
├── client-type.ts        hcWithType 预编译导出
└── index.ts               只做组合：挂 authHandler → session 中间件 → 各模块 .route("/", xxxRoutes)
```

**新增一个业务功能时，在 `modules/` 下新建一个同名目录**（如 `modules/project/{schemas,routes}.ts`），在 `index.ts` 里 `.route("/", projectRoutes)` 接上链条即可。不要把新路由塞进 `modules/example`——那个目录只是范式演示，真实业务上线后可以整个删掉。

`shared/` 只放真正跨模块的东西（目前只有 `result.ts` 这一个文件）。如果某个类型/工具只有一个模块在用，就放回那个模块目录里，不要为了"统一放 shared"而把本该属于某个 feature 的东西挪出去。

## 认证

- `apps/server/src/modules/auth/auth.ts` — Better Auth 实例（Drizzle adapter + 邮箱密码）。`auth:generate` 脚本的 `--config` 指向这个文件
- `apps/server/src/modules/auth/routes.ts` — `app.on(["GET","POST"], "/api/auth/*", ...)` 挂载 handler，写法照抄官方文档，**不要改动这一行的结构**
- `apps/server/src/index.ts` 里，`authHandler` 的 `.route()` **必须注册在 session 中间件之前**——这不是官方文档要求的顺序（官方文档把两者当独立示例展示，没给出相对先后），是我们自己的选择：`auth.handler()` 直接处理 raw `Request`/`Response`，从不读 Hono context，所以顺序不影响正确性；排前面纯粹是为了让 Better Auth 自己的路由跳过后面注册的 session 查询（Hono 的中间件按注册顺序生效，前面的路由命中且不调用 `next()` 时，后面注册的 `app.use` 根本不会跑）
- session 中间件把 `user`/`session` 放进 Hono context，受保护的接口从 `c.get("user")` 取，为空时返回 `err({ code: "UNAUTHORIZED", ... })`（见 `modules/example/routes.ts` 的 `getMe`）——**不是 401**，见上面"前后端边界"一节
- `apps/web/src/lib/session.ts` — 用 react-query 缓存 `authClient.getSession()`。这条走的是 Better Auth 自己的客户端，跟 `apps/server` 自定义的业务接口是两条独立的路，不要混着改
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

`typeof Bun !== "undefined" ? Bun.version : process.version` 这种运行时探测的写法保留在 `modules/example/routes.ts` 的 `getServerInfo` 里，仍然是引用 `Bun` 全局的唯一合法方式。

## 路径别名

`apps/web` 里用 `#/*` 指向 `apps/web/src/*`（`package.json` 的 `imports` + `tsconfig.json` 的 `paths` 两处都要有）。

**`apps/server` 里只用相对路径导入。** `tsconfig` 的 `paths` 是整个 program 级别的，`apps/web` 通过 `import type` 把服务端源码拉进自己的 program 后，会拿 web 的 `#/*` 去解析服务端文件里的 `#/`，直接解析错。相对路径没这个问题。

## 404 与错误处理

`apps/web/src/router.tsx` 把 `defaultNotFoundComponent` 指向 `src/components/not-found.tsx`。单个路由可以用自己的 `notFoundComponent` 覆盖。目前**还没有**配置 `defaultErrorComponent`。

## 样式

深色模式是**有意禁用**的。`apps/web/src/styles.css` 只定义亮色 token，并把 Tailwind 的 `dark:` 变体绑定到一个永远不会被添加的 `.dark` class 上 —— 正是这一点，才挡住了 shadcn 组件内置的 `dark:` 工具类跟随操作系统 `prefers-color-scheme` 生效。**不要擅自**添加 `.dark` token 块、主题切换开关，或 `prefers-color-scheme` 媒体查询，先问过再说。
