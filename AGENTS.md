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

**开发工具链用 Bun，生产运行时用 Node** —— 这是本项目的硬性规定，两者不要混淆。开发、构建、测试、lint 一律用 `bun` / `bunx`，**不要**用 `npm`、`pnpm`、`yarn`；但生产环境启动服务器用的是纯 `node`，不依赖 Bun 运行时。

| 任务 | 命令 | 实际运行时 |
| --- | --- | --- |
| 安装依赖 | `bun install` | Bun |
| 开发服务器 | `bun run dev`（端口 3000） | Bun |
| 生产构建 | `bun run build` → 产物在 `.output/` | Bun（构建工具本身） |
| 运行构建产物 | `bun run start` | **Node**（脚本内部是 `node .output/server/index.mjs`） |
| 测试 | `bun run test` | Bun |
| 类型检查 | `bun run typecheck` | Bun |
| Lint + 格式化 | `bun run check` | Bun |
| 添加 shadcn 组件 | `bunx shadcn@latest add <name>` | Bun |

`dev`/`build`/`test` 等脚本用 `bun --bun` 包裹 Vite，这只影响*开发和构建时*用什么运行时跑工具链，不影响生产产物本身跑在哪。`vite.config.ts` 里 Nitro 的 preset 是 `'node-server'`，构建出的 `.output/server/index.mjs` 是自包含的 Node 服务器，用 `node` 直接跑，不需要 Bun。

### 不要在服务端代码里写 Node 不兼容的操作

任何会打进 `.output` 产物的代码 —— `createServerFn` 的 handler、路由的 `server.handlers`、middleware —— 最终都跑在 Node 上，必须对 Node 兼容。具体来说：

- **不要**无条件调用 Bun-only API：`Bun.file()`、`Bun.serve()`、`Bun.$`、`Bun.password`、`bun:sqlite`、`bun:ffi` 等，这些在 Node 下会直接报错（`Bun is not defined` 或模块找不到）
- 如果确实需要探测运行时（比如打日志），只能用 `typeof Bun !== "undefined"` 做守卫后再访问，参考 `src/routes/index.tsx` 里 `getServerInfo` 的写法 —— 这是唯一允许出现 `Bun` 全局引用的方式
- 引入新依赖前，确认它在 Node 上能跑（原生绑定库要留意是否只提供 Bun 的预编译产物）。之前讨论过的 Drizzle、Better Auth 都是 Node 兼容的，可以放心选

开发时用 `bun run dev` 跑，本地会看到 `Server runtime: Bun x.x.x`；生产用 `bun run start` 跑（内部是 `node .output/server/index.mjs`），会看到 `Server runtime: Node x.x.x`。这两个值不一致是预期行为，不是 bug。

## 技术栈

- TanStack Start，运行在 **SPA 模式**（`vite.config.ts` 中的 `spa: { enabled: true }`），路由用 TanStack Router 的文件式路由 —— 路由文件放在 `src/routes`，`src/routeTree.gen.ts` 是自动生成的，**绝对不要手改**
- TanStack Query，通过 `src/router.tsx` 里的 `setupRouterSsrQueryIntegration` 挂到 router 上（即使关掉了 SSR 也要保留 —— 它负责 query 缓存围绕预渲染 shell 的脱水/注水）
- Tailwind CSS v4 + shadcn/ui（配置见 `components.json`、`src/lib/utils.ts`）
- Nitro，使用 `preset: 'node-server'` 产出生产构建（自包含 Node 服务器，见上方"开发工具链用 Bun，生产运行时用 Node"）
- Biome 负责 lint 和格式化（缩进用 tab，字符串用双引号）—— 收尾前务必跑一次 `bun run check`
- Vitest + happy-dom + Testing Library，配置在 `vitest.config.ts`，**刻意**与 `vite.config.ts` 分开

## 渲染模型

SSR 是**有意关闭**的。`beforeLoad`、`loader` 和路由组件全部**只在客户端执行**；构建时会预渲染出唯一的 `.output/public/_shell.html`。不要重新开启 SSR，不要给路由加 `ssr: true`，也不要写任何假定路由组件会在服务端执行的代码。

但服务器仍然要部署、仍然是必需的 —— `createServerFn` 调用和 `/api/*` 路由在运行时都要打到它上面，实际运行的是 `node .output/server/index.mjs`。SPA 模式去掉的是服务端**渲染**，不是服务器本身。

## 404 与错误处理

`src/router.tsx` 里把 `defaultNotFoundComponent` 指向了 `src/components/not-found.tsx`，因此匹配不到的路径会渲染真正的 404 页面，而不是 Router 内置的裸 `<p>Not Found</p>`。单个路由可以用自己的 `notFoundComponent` 覆盖。目前**还没有**配置 `defaultErrorComponent`，运行时异常仍然走 Router 的默认错误边界。

## 客户端与服务端的边界

没有独立的 API 层。服务端逻辑写在 `createServerFn` 的 handler 里（示例见 `src/routes/index.tsx`），或者写在路由的 `server.handlers` 中作为原始 HTTP 端点。**不要擅自引入 tRPC 或 oRPC，先问过再说。**

本模板不含数据库，也不含认证。

## 样式

深色模式是**有意禁用**的。`src/styles.css` 只定义亮色 token，并把 Tailwind 的 `dark:` 变体绑定到一个永远不会被添加的 `.dark` class 上 —— 正是这一点，才挡住了 shadcn 组件内置的 `dark:` 工具类跟随操作系统 `prefers-color-scheme` 生效。**不要擅自**添加 `.dark` token 块、主题切换开关，或 `prefers-color-scheme` 媒体查询，先问过再说。
