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

> **这份文件有硬性体积预算：< 32 KiB。** Codex 的 `project_doc_max_bytes` 默认就是 32 KiB，**超出部分不报错、直接丢**（丢的是文件末尾，也就是"样式""路径别名"这些）；Claude Code 那边则是越长越不遵守。写之前先 `wc -c AGENTS.md` 看余量。
>
> 装不下时**不要往下堆**，按这个判据搬：**能从代码库看出来的**（目录树、依赖清单、架构概览）直接删；**踩过的坑、决策理由、和工具默认不一样的约定**留在这里；**成体系的细则**（结构判据、CRUD 范式、部署参数）搬进 `docs/` 并在这里留一行指针。`CLAUDE.md` 只是一行 `@AGENTS.md`——Claude Code 不读 `AGENTS.md`，删了它这份文档对 Claude 就完全失效。

## 第一版原型参考
相关文件目录 \docs\20260811交接

`prototype/admin/` 是 `apps/web` 的需求来源，`prototype/h5/` 是 `apps/h5` 的。

> 这里原先写着「H5 相关的功能目前都不做」，**该结论 2026-09-01 作废**——`apps/h5` 已建好并接通构建部署。业务功能仍按需求排期，不要看到目录存在就顺手开工；身份体系没定案、`/api/h5` 守卫也没有，**涉及登录态的页面现在做不了**。

> **已有页面：`/itinerary`（嘉宾专属行程，2026-09-02）——静态页，数据是 `routes/itinerary/-data.ts` 里的常量。** 需求来源是 `docs/新版H5_Demo/`（原型的 React 源码 + 截图）。接后端时把那个常量换成请求即可，类型就是接口约定的草稿。它同时是 h5 端的**视觉与结构范式**：Base UI 原语（Drawer / Collapsible / Toast）+ 自己写皮、内联 SVG 图标不装图标库、动画走 `styles.css` 的 `--animate-*`（不引 framer-motion）。视觉上**只有主题红一种强调色**——交通方式不再分色（`--color-transit`），提示块也是中性灰底 + 红图标，别再往里加第二套语义色。
>
> 进页面那道手机号校验（`key-gate.tsx`）**是界面不是安全边界**：判断在前端比一个常量，devtools 一开就绕过去了。接后端前不要把它当成"已经有权限控制了"，见文件顶部注释。

## 旧项目代码参考
当用户要求参考旧代码时 再从这两个目录中读取代码研究

测试环境 http://10.2.1.16:30053/ ——账号密码放在本地 `.env` 的 `LEGACY_TEST_USER` / `LEGACY_TEST_PASSWORD`（`.env` 不进 git），不要再写回这份文档。
前端代码： ../ruoyi-antdp
后端代码： ../fashion_actions_management

## 新建 CRUD 模块

照着 supplier 模块抄（后端 `modules/supplier/`，前端 `routes/_authenticated/supplier/`）。踩过的坑、定下的模式、配色/表格/按钮的视觉规范、一份可以照抄的检查清单，都在 [docs/crud-page-guide.md](docs/crud-page-guide.md)——写新模块之前先看这份，别重新踩一遍已经踩过的坑（比如 `ok()`/`err()` 千万不能加类型标注、列表别按 `updatedAt` 排序）。

**新模块记得在 `apps/server/src/dev-seed/` 加一个带数字前缀的种子文件**，不加的话新页面在临时库里永远是空的、没法调（见下面"开发调试"）。

## 环节配置：新旧两套入口并存中

环节现在有**两条编辑路径**，有意并存不是遗留：旧的四个弹窗，和新的单页 `agenda/$segmentId`（四块合一、整页原子保存）。两边写同一批表。

**改之前必须知道**：新页面的人员/绑定发的是**增量意图**（`add`/`remove`/`unbindIds`）而非完整名单，改成"发目标状态"会让草稿一保存就静默覆盖别人在旧弹窗里的改动——这是两套入口能并存的唯一前提。另有两条写入顺序硬约束（环节先于人员、需求先于资源），写反不报错只出怪结果，见 `agenda/segment-config.ts` 顶部。

背景、代价、**收敛旧入口时该删哪些文件**见 [docs/architecture-decisions.md](docs/architecture-decisions.md#环节配置合并为单页整页原子保存)。

## 仓库结构

Bun workspaces monorepo，三个包：

```
apps/web       管理端。Vite + TanStack Router，纯 SPA（端口 3000）
apps/h5        移动公众端。Vite + TanStack Router，纯 SPA（端口 3001）
apps/server    Hono + Better Auth + Drizzle（端口 8787）
```

包名分别是 `@repo/web`、`@repo/h5`、`@repo/server`。根 `package.json` 只放 workspaces 声明、Biome、TypeScript 和跨包编排脚本，**不要**往根上加业务依赖。

**`apps/h5` 不是 `apps/web` 的移动版，是另一个端**——用户、视觉语言、身份体系都不同，所以刻意不共享主题、不共享组件。h5 **不用 shadcn**（没有 `components.json` 和 `ui/` 目录）：那套中性灰桌面审美要对抗到底，而 `card`/`badge`/`button` 本体极薄，生成出来第一件事就是删 variants 重写。需要弹层交互（Dialog/Drawer/Collapsible/Select）时**直接 import `@base-ui/react` 原语自己套样式**——值钱的是焦点管理、滚动锁定和 `aria-*`，不是 shadcn 的皮。h5 另外：两份 `styles.css` 各自维护 token；不加载 Web 字体（系统字体栈）；没装 `class-variance-authority`，`cn()` + 字符串常量够用。

目录结构的四个桶和依赖方向两个前端**完全一致**，见下面「代码结构」。

**没有独立的 `packages/db`。** Drizzle 客户端和表定义都在 `apps/server` 内部——2026-08-06 讨论过，`@repo/db` 当时唯一的消费方就是 `apps/server`，"给 drizzle-kit 和 server 共用"不成立（drizzle-kit 认配置文件里的路径，不是 workspace 包），拆出去反而让 `bun --hot` 监听不到 schema、改了不热重载。**只有出现第二个运行时消费方**（worker、CLI、第二个服务）时才重新拆，那时成本和现在一样低。

**开发工具链一律用 `bun` / `bunx`**，不要用 `npm`、`pnpm`、`yarn`。

| 任务 | 命令（在仓库根执行） |
| --- | --- |
| 安装依赖 | `bun install` |
| 起开发环境（临时库，默认） | `bun run dev`——每个 worktree 一个一次性 tmpfs 容器，自动建表 + 灌种子，退出即销毁 |
| 起开发环境（持久库） | `bun run dev:persist`——连 docker-compose 那个库，只跑迁移，不灌种子 |
| 生产构建 | `bun run build` → `apps/web/dist/` + `apps/h5/dist/`（两份静态资源）+ `apps/server/dist/server.js`（bun build 打的单文件） |
| 类型检查（全部包） | `bun run typecheck` |
| 测试 | `bun run test` |
| Lint + 格式检查（收尾默认） | `bunx biome check <本次修改文件...>`（不要加 `--write`） |
| 全仓 Lint + 格式化（会写文件） | `bun run check`（仅在明确需要全仓修复且工作树干净时） |
| 数据库迁移 | `bun run db:generate` / `db:migrate` / `db:check` / `db:baseline` / `db:studio`。**没有 `db:push` 了**，理由和完整流程见 [docs/database-migrations.md](docs/database-migrations.md) |
| 重新生成路由树 | `bun run --filter '@repo/web' generate-routes`（h5 换成 `@repo/h5`） |
| 回收垃圾容器 / 卷 / 已合入的分支 | `bun run prune`（只列不删）→ `bun run prune --yes` |
| 添加 shadcn 组件 | 在 `apps/web` 下 `bunx shadcn@latest add <name>`。**`apps/h5` 不用 shadcn**，理由见上面「仓库结构」 |
| 打 tag 发版 | `bun run release`（`major` / `minor` / `vX.Y.Z`，默认 patch） |
| 构建并推送镜像 | `bun run docker:build-push [版本号]` |
| 部署测试环境 | `bun run deploy:test` |

**部署产物是单个镜像，三个包跑在同一个 Hono 里、占两个端口**：80 管理端（`WEB_DIST_DIR`）、81 h5（`H5_DIST_DIR`）。两个端口共用同一套路由，**`/api/*` 在两个端口上都完整存在**，差别只有静态目录（经 Hono bindings 逐 server 传入）；静态中间件挂在 session 中间件之前（静态资源不查库），`/api` 之外找不到文件就回落各自的 `index.html`。因此**两端各自同源**——不需要 CORS、`trustedOrigins` 不用加域名、`VITE_API_URL` 不用设，同一个镜像跑遍所有环境；线上两个端口各挂一个域名，前端的 `base` 和 `basepath` 都保持 `/`。开发环境两个 `*_DIST_DIR` 都不设，静态资源归 Vite，第二个端口也不启动。**环境变量表、端口表和一个 cookie 的坑见 [docker/README.md](docker/README.md)。**

**开发端口**：`bun run dev` 由 `scripts/dev.ts` 统一起三个进程。`SERVER_PORT`(8787) / `WEB_PORT`(3000) / `H5_PORT`(3001) 是首选值，被占用时向上找且互相排除；后端端口同时传给 Hono 和两个 Vite 代理，前端端口变化时同步更新认证 origin——避免端口漂移后代理或 Better Auth 还指着旧的。`WEB_ORIGIN` / `BETTER_AUTH_URL` 只跟管理端走（h5 是另一套身份，不进 `trustedOrigins`）。两个 Vite 的 stdin 给 `"ignore"`，否则两个进程抢同一个 TTY 会把按键随机分走。**Vite 必须用 `bun vite …`，不要加 `--bun`**：Windows 下会导致自动换端口失效（已有进程监听 `[::1]:3000` 时仍可能另绑 `127.0.0.1:3000`）。单独起某个包用 `bun run --filter '@repo/server' dev`，不经过这层协调。

### 参考资料目录与 IDE 索引

`docs/20260811交接/` 保存产品需求和静态 HTML 原型，仍需在工作区和 Git 中可见，但不属于应用源码。`.cursorignore` 排除 Cursor 索引，`.vscode/settings.json` 排除 VS Code 搜索和文件监听，`biome.json` 的 HTML 只逐个列入 `apps/web/index.html` 和 `apps/h5/index.html`（**不是**通配 `**/index.html`），避免原型目录中的 `prototype/index.html` 被代码检查工具处理——新增前端工作区时记得往这里加一行。新增同类交接资料时沿用这个原则，不要把目录加入 `.gitignore`。

**在 `.claude/worktrees/` 这类深路径下跑 `bun install`/`bun add` 报 `ENOENT ... (copyfile)`，或者装完页面到处 `Invalid hook call`：** 这是 Windows + 深路径 worktree 的已知环境问题，不是仓库配置或依赖本身的问题，修法见 [docs/windows-worktree-notes.md](docs/windows-worktree-notes.md)——一句话版：带上 `--linker=hoisted`，且不要中途在 isolated/hoisted 之间切换。

## 开发调试

**默认的 `bun run dev` 起的是一次性数据库**：每个 worktree 一个 tmpfs 容器、随机端口，自动建表 + 灌种子（约 3 秒），Ctrl-C 就销毁——多个 worktree 并行不会互相踩数据。要看积累的真实数据用 `bun run dev:persist`（连 docker-compose 那个持久库，**只跑迁移、不灌种子**——它和生产走同一份 `migrate.ts`，正好预演生产的迁移路径）。

**登录直接访问 `/api/dev/login`**：一次 GET 就进登录态（种子账号 `dev@example.com`），带 `?redirect=/project/1` 可直接落到指定页面。它走 Better Auth **完整的真实认证链路**（真 session、真 cookie、照常过 `sessionMiddleware`），所以守卫和会话相关的坑照样暴露得出来。只在 `DEV_AUTH_BYPASS=1` 时存在，生产形态下带着这个开关启动会直接拒绝启动。**可以自行用浏览器登录、点页面、走真实操作来调试，不用每次问。**

**要连"正在跑的那个"临时库**（`db:studio`、排查脚本）：已经配好了——`bun run dev` 把真实连接串写进 gitignored 的 `apps/server/.dev-db.env`，db 系列脚本按 `.env` → `.dev-db.env` 顺序读，后者覆盖前者。**别手写 `localhost:5432`**，那是持久库，你会在另一个库里看到一堆真实数据，然后得出完全错误的结论。

**种子在 `apps/server/src/dev-seed/`**，数字前缀决定执行顺序，固定 ID 在 `context.ts`。可直接导航：`/project/1`、`/project/1/activity/1/agenda`（**刻意埋了一处人员时间冲突**）、`/project/1/activity/1/seating/1`（50 座位 / 50 候选人）、`/member`（51 人）、`/venue`、`/supplier`。**改了 schema 就顺手 `bun run db:generate` 生成迁移**（`bun run test` 会拦住漏生成的），**并顺手改种子**——一律用 typed insert，字段改了 `typecheck` 直接报错；新增模块加一个带数字前缀的文件即可（序号留了间隔，**不用改任何已有文件**），种子只对空库负责，不需要幂等逻辑。

## 提交与合并：线性历史是强制的

master 历史必须线性，**这条由 git 自己执行**：`merge.ff = only` / `pull.ff = only` 让非快进合并直接失败，`.githooks/` 下的 `pre-merge-commit` 和 `pre-commit` 堵住 `--no-ff` 和"解完冲突再 commit"这条绕过路径，由 `postinstall` 自动落地。**别用 `git merge --no-ff` 抄近路**——钩子会拒绝，并把仓库留在未完成的合并状态（要 `git merge --abort` 才能退出）。

**agent 干完活的终点是"rebase 完成且检查通过"，不是"已合并"：**

```bash
git fetch
git rebase master          # 在功能分支里做，冲突自己解
bun run typecheck && bun run test
```

然后停下来告诉用户可以合了。合进 master 由用户执行 `git merge --ff-only <分支>`——不可逆，且并行分支的合并顺序互相影响，需要人来编排；那条 `--ff-only` 如果失败就说明 rebase 没做对。

**当前 `bun run test` 有 3 个已知失败**，都在 `apps/server/src/modules/invitation/docx.test.ts` 的「真实模板（商会）」用例上，**在 master 上同样是红的**：出厂模板带 4 个占位符，而测试是照更早那版写的。**不是你造成的，也不要顺手改**——改测试期望等于替 invitation 模块决定「出厂模板该不该预置占位符」，那是产品口径。除这 3 个之外必须全绿，多出任何一个失败都是你的。

## 前后端边界

**不遵循 REST，业务语义和 HTTP 协议解耦，但不引入 RPC 框架（不上 tRPC/oRPC）**——就用 Hono 本身 + 一份共享约定。讨论和实测数据见 [docs/architecture-decisions.md](docs/architecture-decisions.md#前后端类型安全)，这里只写规则：

- **路径 = `/api/<模块>/<动作>`，动作名不重复模块名。** 用 `getServerInfo`、`submitEcho` 这种动词开头的名字，不要 `/projects/:id` 这种资源路径——前缀只是命名空间。业务接口**全部用 POST**，HTTP 动词不承载业务含义；`GET /api/file/:fileId` 是为浏览器原生预览/下载保留的传输层例外。一个模块有多个子资源时拆成两个前缀，不要挤一个前缀又在动作名里加前缀区分。
- **HTTP 状态码不表达业务结果，只有 `code` 字段表达。** 见 `shared/result.ts` 的 `ApiResult<T>`。业务失败（未登录、校验不过）也返回 HTTP 200，前端永远靠 `result.code` 分支，不看 `res.status`。真正的非 200 只留给两种非业务场景：请求体不合法（`zValidator` 的 error hook）、未捕获异常（`index.ts` 的 `app.onError`）。
- 入参用 `shared/validate.ts` 的 `jsonBody(Schema)`，出参用 `c.json(ok(...))` / `c.json(err(...))`，**两边都过信封**。**需要 json 以外的校验目标（form/param/query）时用同一文件里的 `validate(...)`，不要直接调 `zValidator`**——前两者会把 schema 记进 `validatedInputs`，直接调 `zValidator` 的路由在接口文档里会变成"入参：无"。
- **绝对不要给 `ok()` / `err()` 补 `: ApiResult<T>` 返回类型标注。** 它们故意让 TS 自然推导，`c.json(ok(row))` 就是 `{code:"OK"; data: Row}` 一种。补上标注后每个接口的响应类型都变成「OK ∪ 全部四种错误」，前端 `Extract<响应,{code:"OK"}>` 再也取不回精确的 `data`。理由写在 `shared/result.ts` 的注释里。
- 分页统一用 `shared/pagination.ts` 的 `PageInput.extend({ …筛选 })` 作入参、`{ list, total }` 作出参，别各模块自己定 `pageNo`/`pageNum`/`current`。
- 需要登录的模块在路由链头挂 `requireUser`，然后用 `c.get("authedUser")`（非空），不要每个 handler 各写一遍 `c.get("user")` 判空。**`.use(requireUser)` 的作用域就是模块自己的前缀**，不依赖链上其他模块的注册顺序——`file` 模块刻意不挂它，靠的正是这一点。
- 路由必须**接在链上**（`app.post(...).post(...)`），单独写 `app.post(...)` 不会进 `AppType`。客户端用 `client-type.ts` 的 `hcWithType`，不要直接用 `hc`（前者把类型计算挪到编译期，路由多了 IDE 不会卡）。
- 两个前端都只用 `import type` 引 `@repo/server`，**绝不 runtime import**。**唯一例外是 `@repo/server/dict`**（`shared/dict/`，ISO 3166 国别 + GB/T 2260 省市）：规则的理由是"从根 import 会顺着 `index.ts → infra/db → pg` 把服务端依赖拽进浏览器包"，而 dict 下的文件零 import、纯数据，理由不成立。**代价是 `src/shared/dict/**` 里从此不许出现任何 `import`**——加一行就毁了这个例外的前提，而且不会有任何报错提示你。
- **接口清单由 `scripts/gen-api-docs.ts` 从运行时的 `app.routes` 生成**，产物 `apps/web/public/docs/{api.html,api.md}` 不进 git，`bun run build` 会先跑一遍。接口上方 JSDoc 首段会被抓成说明，值得写得像给调用方看的。它**不写出参字段**，出参以 `routes.ts` 的字段投影和 `hc<AppType>` 推导为准。这份文档走静态资源那条路、挂在 `sessionMiddleware` 之前，**任何人不登录就能访问**；要收起来就把生成目标改成一条带 `requireUser` 的路由。

**每个前端都和自己的 API 同源，所以整个仓库不需要 CORS。** 开发靠两个 `vite.config.ts` 各自代理 `/api` 到同一个后端；生产靠两个端口各自提供完整 `/api`。**不要因为"h5 和管理端是两个域名"就去加 `hono/cors`**——域名不同不等于跨域，两条路各自同源。只有真把前端和 API 拆到不同 origin 才需要那三件事（`hono/cors` + `trustedOrigins` + `VITE_API_URL`），当前架构刻意避开了这种形态。

## 代码结构：靠依赖方向裁决归属

完整判据、目录树、范式和理由在 [docs/code-structure.md](docs/code-structure.md)。**新建模块 / 新建页面 / 拿不准代码该放哪时先读它**，这里只留硬线。

**后端三个桶**（`apps/server/src/`）：`infra/` 知道外部世界、不知道业务；`shared/` 纯逻辑纯类型；`modules/` 可以用前两者，**反过来绝对不行**。判据是「有 I/O、持有连接 → `infra`；纯函数纯类型 → `shared`」，不是"看着像哪类"。新业务在 `modules/` 下开同名目录（`{schema,validation,routes}.ts`），在 `index.ts` 接上 `.route("/api/<模块>", …)`——别往 `modules/example` 里塞，那只是范式演示。

**前端四个桶**（`apps/web/src/` 和 `apps/h5/src/` 各一套）：`app/` 组合根、`routes/` 物理结构 = URL 结构、`features/` 跨页面业务逻辑、`shared/` 不认识任何业务。依赖方向单向，`shared/` 谁都不 import。

- **归属判据**：几个页面在用？1 个 → 留在那个页面的 `-components/`、`-hooks/` 里；≥2 个 → 认识业务进 `features/<域>/`，只认 props 和 DOM 进 `shared/`。**业务逻辑第 2 个消费方就提，纯 UI 容忍到第 3 个**；消费方掉回 1 个要搬回去。
- **铁律：跨路由 import 别人的 `-` 目录 = 该提升了，不是加个 `../../`。** 破了这条上面所有规则都失效。
- 页面本地代码只用四个名字：`-components/`、`-hooks/`、`-queries.ts`、`-utils.ts`。**单文件也必须带 `-` 前缀**——`project/list/queries.ts` 会变成一条真路由，这个坑最容易踩。
- `shared/**` 里不许 import `@repo/server`，唯一例外是 `shared/lib/api.ts`。校验：`grep -r "@repo/server" apps/*/src/shared/` **只应命中 `api.ts`**。
- `src/main.tsx` 和 `src/styles.css` 留在 `src/` 根、不进 `app/`；`routes/__root.tsx` 必须留在 `routes/`（路由生成器要求），真正的布局在 `app/layout/`。
- 文件一律 kebab-case；一个文件一个主导出，文件名 = 导出名的 kebab 形式；组件 props 类型就地写 `type XxxProps`。
- **两个前端之间不共享代码，也不互相 import。** 真出现两边都要的东西，先问是不是该走 `@repo/server` 的 `exports`；开 `packages/` 现在不做，理由同「没有独立的 `packages/db`」。
- **讨论过否掉的方向，别因为"看着更整齐"重新引入**：按通用性分 `components/common` + `components/business`、现阶段的 barrel `index.ts`、在 `features/*/queries.ts` 之外再叠 `services/`、给每个 feature 预建空的四件套。

`supplier` 是**新代码的范式**（后端 `modules/supplier/`、前端 `routes/_authenticated/supplier/`），照着它抄。


## 认证

**这一节只讲管理端。** Better Auth 服务的是 `apps/web` 那套邮箱密码登录，身份落在 `user` 表；相关代码全在 `apps/server/src/modules/auth/`。

- **`index.ts` 里 `authHandler` 的 `.route()` 必须注册在 session 中间件之前。** 这不是官方要求的顺序，是我们自己的选择：`auth.handler()` 直接处理 raw `Request`/`Response`、从不读 Hono context，顺序不影响正确性；排前面纯粹是让 Better Auth 自己的路由跳过后面注册的 session 查询。`routes.ts` 里那行 `app.on(["GET","POST"], "/api/auth/*", …)` 照抄官方文档，**不要改动它的结构**。
- session 中间件把 `user`/`session` 放进 Hono context，受保护接口从 `c.get("user")` 取，为空时返回 `err({ code: "UNAUTHORIZED" })`——**不是 401**，见「前后端边界」。
- 前端守卫是 `routes/_authenticated.tsx`（pathless layout），未登录跳 `/login?redirect=...`；session 缓存在 `features/auth/queries.ts`，走的是 Better Auth 自己的客户端，跟业务接口是两条独立的路，不要混着改。
- **登录/登出后必须 `queryClient.removeQueries({ queryKey: sessionQueryKey })`。** 守卫用 `ensureQueryData`，它**即使数据已过期也会先返回缓存**，所以 `invalidateQueries` 不够——登录成功后守卫会读到旧的 `null` 把用户弹回登录页。必须删掉缓存条目，逼守卫重新请求。

**`apps/h5` 是另一套身份体系，目前还没做。** 公众端走手机号验证码 / 微信授权，身份是 `member`（人员主档），且同一手机号可能对应多个 `member`、登录后要选身份。它不复用 `sessionMiddleware` 和 `requireUser`，接口另占 `/api/h5` 前缀、另写守卫——把"本人视角"和"管理视角"塞进同一个 handler 用 `if` 分叉，是这类系统数据越权最典型的出法。倾向自建轻量 token（验证码 → 签发带 `memberId` 的 token）而不是 Better Auth 的 phoneNumber 插件（后者会为每个手机号建 `user` 行，还得维护 `user ↔ member` 映射和"当前选中身份"），但**这个决定还没拍板，动手前先问**。h5 会话的 cookie 必须显式起一个不和 Better Auth 冲突的名字（cookie 不按端口隔离，理由见 [docker/README.md](docker/README.md)）。

## 渲染模型

`apps/web` 和 `apps/h5` 都是**纯客户端 SPA**，没有 SSR，也没有 server function 这种东西。各自的 `index.html` 是唯一的 HTML 壳，`src/main.tsx` 挂载 `RouterProvider`，`QueryClientProvider` 也在那里。路由的 `beforeLoad`、`loader`、组件全部只在浏览器执行。

安全含义：前端的路由守卫、菜单过滤、按钮显隐**都不是安全边界**，用户绕过界面直接打 `/api/*` 即可。每个受保护的接口必须在 Hono handler 内部独立校验。

## 技术栈

库清单看 `package.json`，这里只写**从代码里看不出来的约束**：

- **`routeTree.gen.ts` 是生成物，绝对不要手改。** 两个 `vite.config.ts` 里 `tanstackRouter()` 都必须排在 `viteReact()` 前面，否则生成的路由不过 React 转换。
- **表单用 TanStack Form，不用 react-hook-form。** 输入组件全是 Base UI **受控**组件，用 RHF 的话每个 Select 都得包 `Controller`；而 shadcn 的 `base-vega` 注册表根本没有 `form.tsx`，RHF 那点集成优势拿不到。TanStack Form 受控优先、原生吃 Standard Schema（zod 4 直接当 validator），校验错误是 `StandardSchemaV1Issue[]`，正好喂给 `ui/field.tsx` 的 `<FieldError errors={…} />`。
- **Biome 的缩进：TS/TSX 是 2 空格，不是 tab**——`biome.json` 顶层的 `formatter.indentStyle: "tab"` 被 `javascript.formatter.indentStyle: "space"` 覆盖了，只有 json 之类才是 tab。字符串双引号。
- **不要把 `bun run check` 当收尾检查。** 根脚本实际是 `biome check --write`，不传路径会扫描并重写全仓所有纳入 Biome 的文件；Windows 上 `core.autocrlf=true` 还会把它放大成大量无关修改标记。日常收尾只跑 `bunx biome check <本次修改文件...>`（不带 `--write`）。确实要全仓格式化时先确认工作树干净，执行后立刻 `git diff --name-only` 核对范围。
- Vitest + happy-dom + Testing Library 目前**只在 `apps/web`**，配置在 `vitest.config.ts`，**刻意**与 `vite.config.ts` 分开。`apps/h5` 还没有测试装置（也没有 `test` 脚本，`--filter '@repo/*' test` 会静默跳过它）。

## 运行时

开发和生产目前都是 Bun：`apps/server/src/index.ts` 的默认导出 `{ port, fetch }` 是 Bun 的服务器约定，Node 不认。同一个文件末尾还有一处显式 `Bun.serve`，那是 h5 的第二个端口（只在设了 `H5_DIST_DIR` 时执行）。这两处加上 `modules/example/routes.ts` 里 `getServerInfo` 的运行时探测，是引用 `Bun` 全局的全部合法位置。

两处 `fetch` 都不能简写成 `fetch: app.fetch`，但**包装时必须把 Bun 的 Server 一起传进去**：

```ts
fetch: (request, server) => app.fetch(request, { server, staticApp: … })
```

Bun 传给 `fetch` 的第二个参数是它自己的 Server 对象，默认会成为 Hono 的 `c.env`。直接用 `app.fetch` 则静态中间件读不到该端口的 `staticApp`；而只传 `{ staticApp }` 又会把 Server 挤掉，`hono/bun` 的 `getConnInfo()` 就拿不到 `requestIP()`——免密登录入口的回环地址检查（`modules/auth/routes.dev.ts`）会直接抛 `TypeError: server.requestIP is not a function`。Hono 的 Bun 适配器认两种形状（`c.env` 本身是 Server，或 `c.env.server` 是 Server），我们要在同一个 env 里塞第二样东西，所以只能用后者。

**在 `c.env` 里加东西时，先 grep 一遍 `hono/bun` 的用法。** 这个坑不会在类型层面暴露，只会在运行时炸在某一条具体路由上。

> 拆 monorepo 之前的规则是"开发 Bun、生产 Node"，那是因为 Nitro 会打包出自包含的 Node 服务器。现在没有 Nitro 了。如果仍要在生产用 Node，需要加 `@hono/node-server` 并改 `start` 脚本 —— 这个决定还没做，动之前先问。

`typeof Bun !== "undefined" ? Bun.version : process.version` 这种运行时探测的写法保留在 `modules/example/routes.ts` 的 `getServerInfo` 里，仍然是引用 `Bun` 全局的唯一合法方式。

## 路径别名

`apps/web` 和 `apps/h5` 里都用 `#/*` 指向各自的 `src/*`（`package.json` 的 `imports` + `tsconfig.json` 的 `paths` 两处都要有）。两个包各自解析各自的 `#/`，互不可见。

**`apps/server` 里只用相对路径导入。** `tsconfig` 的 `paths` 是整个 program 级别的，前端通过 `import type` 把服务端源码拉进自己的 program 后，会拿那个前端的 `#/*` 去解析服务端文件里的 `#/`，直接解析错。相对路径没这个问题。现在有两个前端各带一份 `#/*`，这条规则只会更重要。

## 表格筛选

**全站只有一种筛选交互：改控件只改本地草稿，点蓝色「查询」才生效。** 没有"选完下拉立刻刷新"的页面，弹窗里的选人表格也一样。统一走 `shared/components/filter-bar.tsx` 的 `<FilterBar>` + `<FilterActions>`，不要在页面里自己拼这两颗按钮。细节和范例见 [docs/crud-page-guide.md](docs/crud-page-guide.md) 的「筛选栏统一走 `<FilterBar>`」。

**这颗「查询」同时承担刷新语义。** 条件没变时 `navigate` / `setState` 都是彻底的空操作，点下去什么都不会发生——页面得自己重拉一次，否则按钮在用户眼里就是坏的。写法是 `filter-bar.tsx` 导出的 `isSameFilter`：条件变了就 `navigate`，没变就 `invalidate()`，合起来是「点一次 = 恰好一次请求」。

例外只有一个：分页的「每页 N 条」不算筛选，选完立即生效。

## 404 与错误处理

`apps/web/src/app/router.tsx` 把 `defaultNotFoundComponent` 指向 `src/shared/components/not-found.tsx`。单个路由可以用自己的 `notFoundComponent` 覆盖。目前**还没有**配置 `defaultErrorComponent`。

`apps/h5` 两个都没配，走 TanStack Router 的内置默认（一段裸文案）。做第一个真实页面时顺手补一个移动端的 not-found。

## 样式

深色模式在**两个前端上都是有意禁用**的。`apps/web/src/styles.css` 和 `apps/h5/src/styles.css` 都只定义亮色 token，并把 Tailwind 的 `dark:` 变体绑定到一个永远不会被添加的 `.dark` class 上 —— 在 `apps/web` 上，正是这一点挡住了 shadcn 组件内置的 `dark:` 工具类跟随操作系统 `prefers-color-scheme` 生效；`apps/h5` 没有 shadcn，那行是为了保持两边行为一致，别让某天从 web 拷过去的一段 class 突然在深色系统下变样。**不要擅自**添加 `.dark` token 块、主题切换开关，或 `prefers-color-scheme` 媒体查询，先问过再说。

两份 `styles.css` 的 token **刻意不共享**（理由见「仓库结构」）。改配色时只改对应那一份，不要为了"统一"把它们抽成一份。

**`apps/h5` 走等比缩放**：`styles.css` 里一条 `html { font-size: clamp(...) }` 是总开关，Tailwind v4 的 spacing 和字阶都是 rem，跟着一起缩。所以 **h5 的新字阶一律写 rem**（写 px 会脱离缩放，做出"间距缩了字号没缩"的半吊子效果），**新写 `[Npx]` 任意值前先判断**：跟着别的元素对齐的写 rem，描边/安全区这类物理量留 px。判据、clamp 上下界的算法、以及为什么不用 `postcss-px-to-viewport` / `lib-flexible`，见 [docs/architecture-decisions.md](docs/architecture-decisions.md#appsh5-的移动端适配根字号等比缩放)。`apps/web` 不受影响。
