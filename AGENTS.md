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

> **这份文档记录的是当前的约定，不是不可动的教条。** 每条规则都是在当时的信息下做的取舍，实际写代码时完全可能发现它别扭、成本高过收益，或者跟一个当初没想到的场景冲突——**发现了就直接提出来改**，带上具体的 case，不用忍着照做。
>
> 唯一的要求是：改动连同**理由**一起写回这里（大的方向性取舍写进 [docs/architecture-decisions.md](docs/architecture-decisions.md)），别绕开规则默默写例外——一个没记录的例外会变成下一个人眼里的"这里本来就没规矩"。

## 第一版原型参考
相关文件目录 \docs\20260811交接
注意H5相关的功能目前都不做！

## 旧项目代码参考
当用户要求参考旧代码时 再从这两个目录中读取代码研究

测试环境 http://10.2.1.16:30053/  账号：admin 密码：Sjzt@123
前端代码： ../ruoyi-antdp
后端代码： ../fashion_actions_management

## 新建 CRUD 模块

照着 supplier 模块抄（后端 `modules/supplier/`，前端 `routes/_authenticated/supplier/`）。踩过的坑、定下的模式、配色/表格/按钮的视觉规范、一份可以照抄的检查清单，都在 [docs/crud-page-guide.md](docs/crud-page-guide.md)——写新模块之前先看这份，别重新踩一遍已经踩过的坑（比如 `ok()`/`err()` 千万不能加类型标注、列表别按 `updatedAt` 排序）。

## 仓库结构

Bun workspaces monorepo，两个包：

```
apps/web       Vite + TanStack Router，纯 SPA（端口 3000）
apps/server    Hono + Better Auth + Drizzle（端口 8787）
```

包名分别是 `@repo/web`、`@repo/server`。根 `package.json` 只放 workspaces 声明、Biome、TypeScript 和跨包编排脚本，**不要**往根上加业务依赖。

**没有独立的 `packages/db`。** Drizzle 客户端和表定义都在 `apps/server` 内部（见下面"后端目录结构"）——2026-08-06 讨论过，`@repo/db` 当时唯一的消费方就是 `apps/server`，"给 drizzle-kit 和 server 共用"这个理由不成立（drizzle-kit 认的是配置文件里的路径，不是 workspace 包），拆出去反而让 `bun --hot` 监听不到 schema 文件、改了不触发热重载。**只有出现第二个运行时消费方**（后台 worker、CLI 脚本、第二个服务）时才重新拆出来，那时候成本和现在一样低。

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

开发端口约定：根目录的 `bun run dev` 由 `scripts/dev.ts` 统一启动前后端。`SERVER_PORT`（默认 `8787`）和 `WEB_PORT`（默认 `3000`）是首选端口，被占用时向上寻找可用端口；最终的后端端口同时传给 Hono 和 Vite 代理，前端端口变化时同步更新认证 origin。这样做是为了避免端口自动变化后代理或 Better Auth 仍指向旧端口。单独运行某个 workspace 的 `dev` 脚本不经过这层协调。

单独起某个包用 `bun run --filter '@repo/server' dev`。

### 参考资料目录与 IDE 索引

`docs/20260811交接/` 保存产品需求和静态 HTML 原型，仍需在工作区和 Git 中可见，但不属于应用源码。`.cursorignore` 排除 Cursor 索引，`.vscode/settings.json` 排除 VS Code 搜索和文件监听，`biome.json` 只纳入 `apps/web/index.html`，避免原型目录中的 `prototype/index.html` 被代码检查工具处理。新增同类交接资料时沿用这个原则，不要把目录加入 `.gitignore`。

**在 `.claude/worktrees/` 这类深路径下跑 `bun install`/`bun add` 报 `ENOENT ... (copyfile)`，或者装完页面到处 `Invalid hook call`：** 这是 Windows + 深路径 worktree 的已知环境问题，不是仓库配置或依赖本身的问题，修法见 [docs/windows-worktree-notes.md](docs/windows-worktree-notes.md)——一句话版：带上 `--linker=hoisted`，且不要中途在 isolated/hoisted 之间切换。

## 开发调试
如果需求可自行通过浏览器进行登录、注册，通过真实的页面操作进行调试。
账号 x1nyhh@163.com 密码xiny1118

## 前后端边界

**不遵循 REST，业务语义和 HTTP 协议解耦，但不引入 RPC 框架（不上 tRPC/oRPC）——就用 Hono 本身 + 一份共享约定。** 详细讨论和实测数据见 [docs/architecture-decisions.md](docs/architecture-decisions.md#前后端类型安全)，这里只写规则：

- **路径是动作名，不是资源。** 用 `getServerInfo`、`submitEcho` 这种动词开头的名字，不要建 `/projects/:id` 这种资源路径。业务接口**全部用 POST**，HTTP 动词不承载任何业务含义；文件二进制读取接口 `GET /api/file/:fileId` 是为了支持浏览器原生预览/下载而保留的传输层例外。
- **HTTP 状态码不表达业务结果，只有 `code` 字段表达。** 见 `apps/server/src/shared/result.ts` 的 `ApiResult<T>` —— `{ code: "OK", data } | { code: "UNAUTHORIZED" | "VALIDATION_ERROR" | ..., message }`。业务失败（未登录、校验不过）也返回 HTTP 200，前端永远靠 `result.code` 分支，不看 `res.status`。真正的非 200 只留给两种非业务场景：请求体不合法（`zValidator` 的 error hook）、handler 里未捕获的异常（`index.ts` 的 `app.onError`）。
- 输入用 `shared/validate.ts` 的 `jsonBody(Schema)`（它内部就是 `zValidator("json", …)` 加统一的 error hook），输出用 `c.json(ok(...))` / `c.json(err(...))`——业务接口**两边都过一遍 `shared/result.ts` 的信封**。文件二进制读取成功时返回原始文件内容，读取失败仍返回同一错误信封。
- **绝对不要给 `ok()` / `err()` 补上 `: ApiResult<T>` 返回类型标注。** 它们现在故意让 TS 自然推导，`c.json(ok(row))` 的类型就是 `{code:"OK"; data: Row}` 这一种。补上标注看着更"规范"，代价是每个接口的响应类型都变成「OK ∪ 全部四种错误」，于是：前端 `Extract<响应, {code:"OK"}>` 再也取不回精确的 `data`（只能手抄一份领域类型，然后慢慢跟服务端漂移），错误分支还要处理一堆这个接口根本不会返回的 code。理由写在 `shared/result.ts` 的注释里。
- 分页接口统一用 `shared/pagination.ts` 的 `PageInput.extend({ …筛选条件 })` 作入参、`{ list, total }` 作出参，别各模块自己定 `pageNo` / `pageNum` / `current`。
- 需要登录的模块在路由链头上挂 `modules/auth` 的 `requireUser`，然后用 `c.get("authedUser")`（非空），不要每个 handler 里各写一遍 `c.get("user")` 判空。
- 路由必须**接在链上**（`app.post(...).post(...)`），单独写 `app.post(...)` 不会进 `AppType`
- `apps/web` 只用 `import type` 引 `@repo/server`，**绝不 runtime import** —— 服务端代码不能进浏览器包
- 客户端用 `apps/server/src/client-type.ts` 导出的 `hcWithType`，不要直接用 `hc`——前者把类型计算挪到编译期，路由多了以后 IDE 不会变卡（[Hono 官方的 known issue](https://hono.dev/docs/guides/rpc#using-rpc-with-larger-applications)）
- **不要引入 tRPC 或 oRPC**，这是明确讨论过否掉的方向,不要因为"更方便"就重新引入

浏览器只认一个 origin：`apps/web/vite.config.ts` 里的 proxy 把 `/api` 转发到 8787。因此开发环境不需要 CORS，Better Auth 的 cookie 也不涉及跨站问题。**如果要把前后端部署到不同域名**，得同时做三件事：server 加 `hono/cors` 中间件、`auth.ts` 的 `trustedOrigins` 加上 web 域名、web 侧设 `VITE_API_URL`。

## 后端目录结构：基础设施 / 业务模块 / 共享逻辑

三个桶，靠**依赖方向**裁决归属，不是靠感觉：

```
infra/     知道外部世界（DB、缓存、邮件……），不知道任何业务
shared/    纯逻辑、纯类型，谁都不知道
modules/   可以用 infra 和 shared；反过来绝对不行 —— infra/shared 永远不 import modules
```

判据：**有 I/O、持有连接/句柄 → `infra`；纯函数/纯类型、无状态 → `shared`。** 新文件先问"它连不连外部资源"，不是"看着像哪类"。

```
apps/server/
├── drizzle.config.ts     schema: "./src/modules/**/schema.ts" —— glob，新模块自动纳入迁移
└── src/
    ├── infra/
    │   └── db.ts          drizzle 连接池，不带 schema（见下面的取舍说明）
    ├── modules/
    │   ├── auth/           Better Auth 相关的一切，包括它自己的表
    │   │   ├── auth.ts               betterAuth() 实例
    │   │   ├── context.ts            Variables 类型（user/session 在 Hono context 里的形状）
    │   │   ├── routes.ts             /api/auth/* 的官方挂载写法
    │   │   ├── schema.ts             user/session/account/verification 表定义
    │   │   └── session-middleware.ts 填充 c.get("user")/c.get("session")
    │   │   └── require-user.ts       requireUser 中间件 + AuthedVariables
    │   ├── supplier/        **真实业务模块的范式**，新模块照着它抄
    │   │   ├── schema.ts             表定义 + 领域枚举（列里能出现什么）
    │   │   ├── validation.ts         zod 入参契约，从 schema 的枚举拼
    │   │   └── routes.ts             7 个动作接口 + 显式的字段投影
    │   └── example/         占位示例，不是真实业务，随时可以删掉这个目录
    │       ├── validation.ts
    │       └── routes.ts
    ├── shared/
    │   ├── result.ts       ApiResult<T> / ok() / err()，唯一跨模块的公共词汇表
    │   ├── validate.ts     jsonBody()，统一的请求体校验器
    │   └── pagination.ts   PageInput / Paged<T> / toLimitOffset()
    ├── client-type.ts       hcWithType 预编译导出
    └── index.ts              只做组合：挂 authHandler → session 中间件 → 各模块 .route("/", xxxRoutes)
```

**`infra/db.ts` 故意不传 `schema` 参数给 `drizzle()`。** 传了就得把所有模块的表 import 进 `infra/`，违反上面那条依赖方向。代价是拿不到 `db.query.user.findMany()` 这种关系查询语法，改用 `db.select().from(table)`，`table` 从拥有它的模块 import。现在的代码从没用过 `db.query`（Better Auth 是显式接收 schema 的），零损失；真需要关系查询时再单独决定要不要开个 barrel 聚合 schema。

**新增一个业务功能时，在 `modules/` 下新建一个同名目录**（如 `modules/project/{schema,validation,routes}.ts`），在 `index.ts` 里 `.route("/", projectRoutes)` 接上链条即可。表定义放在该模块目录下的 `schema.ts`，会被 `drizzle.config.ts` 的 glob 自动捡到。不要把新路由塞进 `modules/example`——那个目录只是范式演示，真实业务上线后可以整个删掉。

`shared/` 只放真正跨模块、且不碰外部资源的东西（目前只有 `result.ts`）。如果某个类型/工具只有一个模块在用，就放回那个模块目录里；如果它连接外部资源，归 `infra/`，不归 `shared/`。

## 前端目录结构：页面本地优先

四个桶，跟后端同一个思路——**靠依赖方向裁决归属，不靠感觉**：

```
app/       组合根，全应用只有一份的东西
routes/    路由树，物理结构 = URL 结构
features/  跨页面复用的业务逻辑，按业务域分
shared/    通用复用，不认识任何业务
```

依赖方向单向，**反向绝对不行**：

```
app/       可以 import 任何东西
routes/    可 import features / shared；绝不 import 别的路由目录下的东西
features/  可 import shared、可 import 别的 feature（必须无环）；绝不 import routes / app
shared/    谁都不 import（除了 shared 内部和三方库）
```

### 判据：新代码放哪，按顺序问两个问题

| | 问题 | 答案 → 去处 |
| --- | --- | --- |
| Q1 | 有几个页面在用它？ | 1 个 → 留在那个页面的 `-components/`、`-hooks/` 里。≥2 个 → 问 Q2 |
| Q2 | 它认不认识业务？（import 领域类型 / 调 API / 编码业务规则） | 认识 → `features/<域>/`。只认 props 和 DOM → `shared/` |

**提升阈值是不对称的：业务逻辑第 2 个消费方就提，纯 UI 容忍到第 3 个。** 业务逻辑复制一份会静默分叉（两个页面的校验规则慢慢就不一致了，而且没人会发现）；纯 UI 复制一份最多是丑，反倒是只见过两个用例就抽象，容易抽出一个参数一大堆的"万能组件"。

**降级同样是规则**：消费方掉回 1 个时，把它搬回那个页面。只写提升规则不写降级规则，`features/` 三个月后就会变成谁都不敢删的坟场。

**铁律：跨路由 import 别人的 `-` 目录 = 该提升了，不是加个 `../../`。** 这条是让"页面本地优先"不腐烂的唯一保证，破了这条，上面所有规则都失效。

### 目录树

```
apps/web/src/
├── main.tsx                       Vite 入口，index.html 指着它——留在根，不进 app/
├── styles.css
├── routeTree.gen.ts               生成物，绝不手改
├── app/                           组合根
│   ├── router.tsx
│   ├── providers.tsx              QueryClient / RouterContext
│   ├── devtools.tsx
│   ├── nav.ts                     侧边栏菜单配置
│   └── layout/{app-layout,app-sidebar,nav-main,nav-user}.tsx
├── routes/                        物理结构 = URL 结构
│   ├── __root.tsx                 必须留在这里（路由生成器要求）
│   ├── index.tsx
│   ├── login.tsx                  暂无本地代码 → 保持单文件
│   ├── _authenticated.tsx         登录守卫
│   └── _authenticated/
│       ├── $.tsx
│       ├── dashboard.tsx
│       ├── project/list.tsx
│       ├── supplier/               **业务页面的范式**，新页面照着它抄
│       │   ├── index.tsx           筛选（走 URL search params）+ 表格 + 分页
│       │   ├── -queries.ts         queryOptions / 变更函数 / 领域类型
│       │   ├── -utils.ts           中文标签映射、格式化
│       │   └── -components/{supplier-form-dialog,supplier-detail-sheet}.tsx
│       └── system/{user,role}.tsx
├── features/                      跨页面的业务逻辑，按域分
│   └── auth/
│       ├── auth-client.ts
│       └── queries.ts             sessionQueryOptions / sessionQueryKey
└── shared/                        不认识任何业务
    ├── components/
    │   ├── ui/…                   shadcn registry，原样
    │   ├── not-found.tsx
    │   └── page-placeholder.tsx
    ├── hooks/use-mobile.ts
    └── lib/{utils.ts, api.ts}
```

### routes/：页面本地优先

一个页面的组件、hooks 默认先放在它自己的目录里，**别急着往公共目录搬**——放公共目录是要还债的（谁在用、能不能改、能不能删，从此都要查）。

- `-` 前缀是 TanStack Router 的官方机制（`routeFileIgnorePrefix` 默认就是 `-`），带 `-` 的文件和目录不进路由树，不用改配置
- **单文件也必须带 `-` 前缀。** `project/list/queries.ts` 会变成 `/project/list/queries` 这条路由，`-queries.ts` 才不会。这个坑最容易踩
- 白名单四个名字：**`-components/`、`-hooks/`、`-queries.ts`、`-utils.ts`**。需要第五个名字可以加，但**要同步更新这份文档**——不许各页面自由发挥，页面文件夹长得都一样，扫一眼就知道里面有什么；想放个不在名单上的东西时，正好被迫先想清楚它是不是该提升了
- **flat 和 folder 不混用。** 没有本地代码就是单文件（现在所有页面都是这样）；一旦需要本地目录，升级成同名文件夹、页面主体改名 `index.tsx`：

  ```
  project/list.tsx        →   project/list/
                                ├── index.tsx                       原来的 list.tsx
                                ├── -components/project-table.tsx
                                └── -queries.ts
  ```

  唯一副作用：生成的 route id 从 `/project/list` 变成 `/project/list/`（URL 不变，`Link to` 的自动补全会跟着变）
- **测试文件放 `-` 目录里**，或者靠 `tsr.config.json` 的 `routeFileIgnorePattern` 兜住。直接写 `routes/xxx.test.tsx` 会被当成一条路由

`_authenticated` 这层 pathless layout 会进物理路径：业务页面的本地代码实际落在 `routes/_authenticated/project/list/-components/`。**这是页面本地优先的代价，已经接受**——物理路径由路由树决定，不由业务决定；哪天页面换布局，整个目录一起搬走就是了。

顺带一个白拿的好处：`vite.config.ts` 开了 `autoCodeSplitting`，**目录边界天然就是 chunk 边界**，页面本地组件自动进该路由的 chunk；扔在全局 `components/` 里的反而容易被拽进公共包。

### features/：跨页面的业务逻辑

- 按**业务域**分子目录（`features/auth/`），**不按技术类型分**（不要 `features/hooks/`、`features/components/`）
- feature 内部保持扁平：`queries.ts` / `mutations.ts` / `components/` / `hooks/` / `types.ts`。深度超过 2 层，说明该拆成两个域了
- **现在不写 barrel `index.ts`。** 收益（封装公共 API）在当前体积拿不到，代价（循环依赖、HMR 变差、`organizeImports` 之后一堆假依赖）立刻就有。等 feature 内部真需要区分公开/内部时再加，那时 Biome 2 的 `noPrivateImports` 正好是配套机制
- 跨 feature import 直接写深路径，但**不许成环**。两个 feature 互相需要时，把公共部分下沉到 `shared/` 或提成第三个 feature——跟后端 `modules/` 一个道理
- **`features/` 是"多页面共用的业务逻辑"的家，不是"所有业务逻辑"的家。** 单页面用的业务逻辑留在页面里。放松这一条，`features/` 会吸走一切、`routes/` 只剩空壳，这套东西就退化成了传统的 `pages/ + services/` 分层——那前面所有规则都白定了

`features/auth/` 是目前唯一真实的 feature，可以当范式看（login 页、`_authenticated` 守卫、`nav-user` 登出三处在用），地位相当于后端的 `modules/example`。

### shared/：不认识任何业务

硬线，可以直接 grep 验证：**`shared/**` 里不许 import `@repo/server`。**

唯一例外是 `shared/lib/api.ts`——它是传输层客户端，认识的是整个 `AppType` 契约，不是某个具体业务域，对应后端的 `infra/`（"知道外部世界，不知道任何业务"）。前端就这一个这样的文件，不值得为它单开一层 `infra/` 目录。校验方式：`grep -r "@repo/server" apps/web/src/shared/` **只应命中 `api.ts`**。

子目录固定四个：`components/ui`（shadcn registry）、`components/`（自研通用组件）、`hooks/`、`lib/`。**不要同时有 `lib/` 和 `utils/`**，两个名字一个意思，迟早各放一半。

### app/：组合根，不是杂项抽屉

进 `app/` 的判据：**全应用只有一份，且每个页面都间接依赖它。** 不满足就不进——否则它立刻变成第二个垃圾桶。

- `src/main.tsx` 和 `src/styles.css` **留在 `src/` 根**，不进 `app/`。`main.tsx` 是 Vite 约定入口，`index.html` 的 `<script src="/src/main.tsx">` 指着它，本身就 3 行 bootstrap，搬它纯粹为了好看
- `routes/__root.tsx` **必须留在 `routes/`**（路由生成器要求）。它只放 `Outlet` + devtools，**真正的布局在 `app/layout/`**

### shadcn 组件分三层，不是都堆在 ui/

新组件优先用 shadcn，但**装完要想一下它是哪一层**，别无脑留在 CLI 放的位置：

| 层 | 例子 | 归属 | 规矩 |
| --- | --- | --- | --- |
| registry primitive | `button` `sidebar` `empty` | `shared/components/ui/`，**保持扁平、保持原文件名** | 当成 vendored 三方代码。改了必须留注释说明改了什么，否则下次 `shadcn add` 静默覆盖掉你的改动 |
| block / 组合件 | `app-sidebar` `nav-user` `nav-main` | 全应用一份 → `app/layout/`；单页专用 → 该页 `-components/` | 这是**你的代码**，shadcn 只给了初稿，随便改 |
| 业务组件 | `UserTable` | 单页 → 页面本地；多页 → `features/<域>/components/` | 按上面的两个问题裁决 |

**改目录必须同步改 `apps/web/components.json` 的 `aliases`**，否则下次 `bunx shadcn@latest add` 会重新造一个 `src/components/ui/` 出来：

```json
"aliases": {
  "components": "#/shared/components",
  "ui": "#/shared/components/ui",
  "utils": "#/shared/lib/utils",
  "lib": "#/shared/lib",
  "hooks": "#/shared/hooks"
}
```

`shared/hooks/use-mobile.ts` 是 shadcn 自己带进来的（`ui/sidebar.tsx` 在用），属于 registry 的一部分，跟着 alias 走。

### 命名

- 文件一律 kebab-case
- 一个文件一个主导出，文件名 = 导出名的 kebab 形式（`app-layout.tsx` → `AppLayout`）
- 组件 props 类型就地写 `type XxxProps`，不集中到 `types.ts`

### 明确否掉的

这些是讨论过否掉的方向，不要因为"看着更整齐"重新引入：

- ❌ `components/common` + `components/business` 这种**按通用性分目录**——通用性是连续量，边界天天要吵
- ❌ 现阶段的 barrel `index.ts`（理由见 `features/` 那节）
- ❌ 在 `features/*/queries.ts` 之外再叠一层 `services/`
- ❌ 为了对称给每个 feature 预建空的 `components/hooks/utils/types` 四件套——**用到再建**

## 认证

- `apps/server/src/modules/auth/auth.ts` — Better Auth 实例（Drizzle adapter + 邮箱密码），用 `infra/db.ts` 的连接池 + 自己的 `schema.ts`。`auth:generate` 脚本的 `--config`/`--output` 都指向 `modules/auth/` 下的这两个文件
- `apps/server/src/modules/auth/routes.ts` — `app.on(["GET","POST"], "/api/auth/*", ...)` 挂载 handler，写法照抄官方文档，**不要改动这一行的结构**
- `apps/server/src/index.ts` 里，`authHandler` 的 `.route()` **必须注册在 session 中间件之前**——这不是官方文档要求的顺序（官方文档把两者当独立示例展示，没给出相对先后），是我们自己的选择：`auth.handler()` 直接处理 raw `Request`/`Response`，从不读 Hono context，所以顺序不影响正确性；排前面纯粹是为了让 Better Auth 自己的路由跳过后面注册的 session 查询（Hono 的中间件按注册顺序生效，前面的路由命中且不调用 `next()` 时，后面注册的 `app.use` 根本不会跑）
- session 中间件把 `user`/`session` 放进 Hono context，受保护的接口从 `c.get("user")` 取，为空时返回 `err({ code: "UNAUTHORIZED", ... })`（见 `modules/example/routes.ts` 的 `getMe`）——**不是 401**，见上面"前后端边界"一节
- `apps/web/src/features/auth/queries.ts` — 用 react-query 缓存 `authClient.getSession()`。这条走的是 Better Auth 自己的客户端，跟 `apps/server` 自定义的业务接口是两条独立的路，不要混着改
- `apps/web/src/routes/_authenticated.tsx` — 登录守卫（pathless layout），未登录跳 `/login?redirect=...`；受保护页面放在 `_authenticated/` 下自动继承

**登录/登出后必须 `queryClient.removeQueries({ queryKey: sessionQueryKey })`。** 守卫用的是 `ensureQueryData`，它**即使数据已过期也会先返回缓存**，所以 `invalidateQueries` 不够 —— 登录成功后守卫会读到旧的 `null` 并把用户弹回登录页。必须把缓存条目删掉，逼守卫重新请求。

## 渲染模型

`apps/web` 是**纯客户端 SPA**，没有 SSR，也没有 server function 这种东西。`index.html` 是唯一的 HTML 壳，`src/main.tsx` 挂载 `RouterProvider`，`QueryClientProvider` 也在那里。路由的 `beforeLoad`、`loader`、组件全部只在浏览器执行。

安全含义：前端的路由守卫、菜单过滤、按钮显隐**都不是安全边界**，用户绕过界面直接打 `/api/*` 即可。每个受保护的接口必须在 Hono handler 内部独立校验。

## 技术栈

- TanStack Router 文件式路由 —— 路由文件在 `apps/web/src/routes`，`routeTree.gen.ts` 由 `@tanstack/router-plugin` 自动生成，**绝对不要手改**。`vite.config.ts` 里 `tanstackRouter()` 必须排在 `viteReact()` 前面
- TanStack Query，router context 里带 `queryClient`（见 `apps/web/src/app/providers.tsx`）
- Tailwind CSS v4 + shadcn/ui（配置见 `apps/web/components.json`）
- Hono，运行在 Bun 上（`export default { port, fetch }`）
- Drizzle ORM + Postgres（docker-compose 起本地库，客户端在 `apps/server/src/infra/db.ts`）
- TanStack Form（`@tanstack/react-form`）负责表单，**不用 react-hook-form**。理由：shadcn 的 `base-vega` 注册表根本没有 `form.tsx`（只给 `field.tsx`，跟表单库无关），RHF 那点集成优势在这里拿不到；而本项目的输入组件全是 Base UI **受控**组件，用 RHF 的话每个 Select 都得包一层 `Controller`；TanStack Form 受控优先、原生吃 Standard Schema（zod 4 直接当 validator，不需要 `@hookform/resolvers`）。校验错误是 `StandardSchemaV1Issue[]`，正好喂给 `ui/field.tsx` 的 `<FieldError errors={…} />`
- Biome 负责 lint 和格式化。**缩进：TS/TSX 是 2 空格，不是 tab** —— `biome.json` 顶层的 `formatter.indentStyle: "tab"` 被 `javascript.formatter.indentStyle: "space"` 覆盖了，只有 json 之类才是 tab。字符串双引号。收尾前务必跑 `bun run check`
- Vitest + happy-dom + Testing Library，只在 `apps/web`，配置在 `vitest.config.ts`，**刻意**与 `vite.config.ts` 分开

## 运行时

开发和生产目前都是 Bun：`apps/server/src/index.ts` 的默认导出 `{ port, fetch }` 是 Bun 的服务器约定，Node 不认。

> 拆 monorepo 之前的规则是"开发 Bun、生产 Node"，那是因为 Nitro 会打包出自包含的 Node 服务器。现在没有 Nitro 了。如果仍要在生产用 Node，需要加 `@hono/node-server` 并改 `start` 脚本 —— 这个决定还没做，动之前先问。

`typeof Bun !== "undefined" ? Bun.version : process.version` 这种运行时探测的写法保留在 `modules/example/routes.ts` 的 `getServerInfo` 里，仍然是引用 `Bun` 全局的唯一合法方式。

## 路径别名

`apps/web` 里用 `#/*` 指向 `apps/web/src/*`（`package.json` 的 `imports` + `tsconfig.json` 的 `paths` 两处都要有）。

**`apps/server` 里只用相对路径导入。** `tsconfig` 的 `paths` 是整个 program 级别的，`apps/web` 通过 `import type` 把服务端源码拉进自己的 program 后，会拿 web 的 `#/*` 去解析服务端文件里的 `#/`，直接解析错。相对路径没这个问题。

## 404 与错误处理

`apps/web/src/app/router.tsx` 把 `defaultNotFoundComponent` 指向 `src/shared/components/not-found.tsx`。单个路由可以用自己的 `notFoundComponent` 覆盖。目前**还没有**配置 `defaultErrorComponent`。

## 样式

深色模式是**有意禁用**的。`apps/web/src/styles.css` 只定义亮色 token，并把 Tailwind 的 `dark:` 变体绑定到一个永远不会被添加的 `.dark` class 上 —— 正是这一点，才挡住了 shadcn 组件内置的 `dark:` 工具类跟随操作系统 `prefers-color-scheme` 生效。**不要擅自**添加 `.dark` token 块、主题切换开关，或 `prefers-color-scheme` 媒体查询，先问过再说。
