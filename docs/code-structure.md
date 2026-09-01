# 代码结构：前端与后端的目录分层

> 这份文档是从 `AGENTS.md` 拆出来的。根文件里留的是**结论和硬线**，这里是**完整的判据、范式和理由**。
>
> 什么时候该读它：新建模块、新建页面、拿不准某段代码该放哪、或者想动目录结构的时候。日常改一个已有页面不需要读。

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
    └── index.ts              只做组合：挂 authHandler → session 中间件 → 各模块 .route("/api/<模块>", xxxRoutes)
```

**`infra/db.ts` 故意不传 `schema` 参数给 `drizzle()`。** 传了就得把所有模块的表 import 进 `infra/`，违反上面那条依赖方向。代价是拿不到 `db.query.user.findMany()` 这种关系查询语法，改用 `db.select().from(table)`，`table` 从拥有它的模块 import。现在的代码从没用过 `db.query`（Better Auth 是显式接收 schema 的），零损失；真需要关系查询时再单独决定要不要开个 barrel 聚合 schema。

**新增一个业务功能时，在 `modules/` 下新建一个同名目录**（如 `modules/project/{schema,validation,routes}.ts`），在 `index.ts` 里 `.route("/api/<模块名>", projectRoutes)` 接上链条即可——`routes.ts` 里的路径写成相对该前缀的 `/list`、`/create` 这种，不要再带 `/api/xxx` 全路径。表定义放在该模块目录下的 `schema.ts`，会被 `drizzle.config.ts` 的 glob 自动捡到。不要把新路由塞进 `modules/example`——那个目录只是范式演示，真实业务上线后可以整个删掉。

`shared/` 只放真正跨模块、且不碰外部资源的东西（目前只有 `result.ts`）。如果某个类型/工具只有一个模块在用，就放回那个模块目录里；如果它连接外部资源，归 `infra/`，不归 `shared/`。

## 前端目录结构：页面本地优先

**这一整节对 `apps/web` 和 `apps/h5` 同等适用**，两边各自一套四个桶。下面的目录树以 `apps/web` 为例（它是目前唯一填满的那个）；`apps/h5` 结构相同，只是还只有骨架。

**两个前端之间不共享代码，也不互相 import。** 真出现两边都要的东西，先问它是不是属于 `@repo/server` 的 `exports`（类型、字典这类已经是了）；确实是纯前端的共享物再来讨论要不要开 `packages/`——现在不开，理由和「没有独立的 `packages/db`」那条一样。

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
    │   ├── filter-bar.tsx         表格筛选栏 + 「查询/重置」按钮组，全站统一走它
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

唯一例外是 `shared/lib/api.ts`——它是传输层客户端，认识的是整个 `AppType` 契约，不是某个具体业务域，对应后端的 `infra/`（"知道外部世界，不知道任何业务"）。前端就这一个这样的文件，不值得为它单开一层 `infra/` 目录。校验方式：`grep -r "@repo/server" apps/web/src/shared/` **只应命中 `api.ts`**（`apps/h5` 同理）。

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