# 权限方案（Authorization）

> **状态：已实施。** 认证（Authentication，"你是谁"）见
> [user-management-design.md](user-management-design.md)，本文只讨论授权
> （Authorization，"你能做什么"）。
>
> 本文替换了 2026-08 那版同名设计稿。那一版的结论是「用 Better Auth 的 `admin`
> 插件 + `createAccessControl`」，**已作废**——它和用户管理定下的方向有四处正面
> 冲突（角色是库里的行不是代码里的字符串、业务失败要走 `ApiResult` 信封而不是
> HTTP 4xx、分页形状、启停用语义），逐条理由见
> [user-management-design.md §4](user-management-design.md)。

## 1. 决策速查

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 权限点粒度 | **一个菜单项 = 一个权限点，共 8 个**。能进就能改，不分 view/edit/delete |
| 2 | 权限点住哪 | **代码**（`shared/permissions.ts`）。角色的勾选住库里 |
| 3 | 存储形状 | `role.permissions text[]` 一列，**不建 `role_permission` 关联表** |
| 4 | 闸门位置 | `index.ts` 一条中间件 + `permission-map.ts` 一张集中映射表 |
| 5 | 漏挂防护 | 一个测试遍历 `app.routes`，未登记的路径直接红 |
| 6 | 超管 | **不特判**。两个内置角色勾满全集，每次启动同步 |
| 7 | 前端拿权限 | 扩 `sessionMiddleware` 已有的那次查询 + `/api/permission/mine`，**共用一个 query key** |
| 8 | 无权限访问 | 渲染 403 页，**不静默重定向** |

## 2. 权限点：8 个，就是侧边栏那 8 项

清单在 `apps/server/src/shared/permissions.ts`：

```
project  activity  supplier  member  venue  invitationTemplate  systemUser  systemRole
```

「工作台」**刻意不设权限点**——它是登录后的落地页，一个权限点都没有的用户也得有
地方可去。

### 2.1 为什么不分 view / edit / delete

交接稿倾向「页面 × 三档动作」约 60 个点，没有采纳：

- **`edit` 和 `delete` 分开在这个系统里没有配置场景。** 8 个人的内部后台，真实的
  角色是"能进这个模块"和"进不去"。没有人会配"能改供应商但不能删供应商"，那一整
  列格子永远跟着 `edit` 同勾同取消。
- **真正想单独控制的危险操作不叫 `delete`**（排位定稿、批量生成、批量导入），硬套
  三档反而表达不了它们。
- **加一档是纯增量，减一档要清 `role.permissions` 的历史值。** 先窄后宽。

### 2.2 为什么活动详情十个 tab 只有一个权限点

活动详情的 URL 下挂着约 100 条接口（排位、人员关系、场地、资源、行程、议程、
邀请函批次）。它们**是同一个人的一条工作流**，不是几个岗位的分工——筹备一场活动
的人需要议程、场地、排位、人员、行程一起用。

代价说清楚：**配不出"现场执行只能动排位、不能改议程"这种角色**。真需要时，加一个
`activity:seating` 这样的点是纯增量改动。

### 2.3 为什么不把权限点搬进数据库

`apps/web` 是 TanStack Router 的文件路由，页面存在与否完全由代码决定。菜单入库
之后，运营在库里加一行指向 `/system/dept`，点进去就是 404——**菜单表的"增删改"
对我们是假能力，只有"隐藏一个已存在的页面"是真的**。完整论证见
[user-management-design.md §3](user-management-design.md)。

## 3. 存储：`role.permissions text[]`

```ts
permissions: text("permissions").array().$type<PermissionKey[]>().notNull().default([])
```

**不建 `role_permission` 关联表。** 那种表存在的意义是让 `permission_id` 外键指向
一张 `permission` 表，而 §2.3 已经决定不做权限点入库——没有可指向的表，关联表就
退化成"给一堆没有关系可言的字符串做范式化"，白得一次 join，而这次 join 在**每条
受闸门的请求**上都要跑。

形状照搬 `supplier.serviceCategories`（同样是代码定义的字符串集合、同样要按值反查、
同样没有外键可加）。迁移只加一列：`0004_living_strong_guy.sql`。

代码里删掉一个权限点时，库里的历史值不会自动清理——读取侧
（`session-middleware.ts`）过滤掉不认识的字符串，不需要写迁移。

## 4. 闸门：一条中间件 + 一张集中表

```
sessionMiddleware  →  permissionGate  →  模块自己的 requireUser  →  handler
```

- 映射表：`apps/server/src/modules/auth/permission-map.ts`
- 中间件：`apps/server/src/modules/auth/require-permission.ts`，挂在 `index.ts` 的
  `app.use("/api/*", permissionGate)`

### 4.1 为什么集中，而不是各模块链头自己挂

全站其他守卫（`requireUser`、h5 的 `requireH5Member`）都写在模块自己的链头上，
这里刻意例外。判据是**漏挂的后果不一样**：

| | 漏挂的后果 |
| --- | --- |
| `requireUser` | 立刻炸——handler 里 `c.get("authedUser")` 是空的 |
| 权限闸门 | **静默全开**，新模块所有接口对所有角色开放，无报错无类型错误 |

所以归属写进一张表，配一个测试（`permission-map.test.ts`）遍历 `app.routes`：
**任何注册了的路径，要么命中前缀表，要么在两份豁免清单里，否则测试红。**
断言的失败信息直接写了修法，读到它的人（或 agent）不用回头翻这份文档。

### 4.2 为什么是一条中间件，不是按前缀各挂一条

因为**豁免是路径级的**：`/api/member/*` 整体归「人员管理」，但
`/api/member/candidates` 必须放行。用 `app.use("/api/member/*", …)` 那种写法表达
不了这个例外——Hono 会把匹配到的中间件全部跑一遍，后面再挂一条"放行"的不会撤销
前面那条的拒绝。所以判断整个收进 `resolvePermission()`：先看路径级豁免，再按
**最长前缀**匹配。

### 4.3 两份豁免清单

`UNGATED_PREFIXES`（整个前缀不受管）：`example` / `file` / `h5` / `h5Access` /
`permission`。最后一个是循环依赖——用权限点挡住"查询自己有哪些权限点"，前端就
永远不知道该显示什么。

`UNGATED_PATHS`（前缀受管、个别路径放行）9 条，**全是跨权限点被调用的只读下拉**，
外加一条自助改密。没有它们的话页面会直接断掉：

| 页面（它的权限点） | 必须调的接口 | 那个前缀归属的点 |
| --- | --- | --- |
| 活动人员 / 环节人员 / 项目人员（`activity` / `project`） | `member/candidates`、`member/organizationCandidates`、`organization/options` | `member` |
| 活动·邀请函（`activity`） | `invitation/template/list`、`/get`、`/preview` | `invitationTemplate` |
| 活动·场地空间（`activity`） | `venue/list` | `venue` |
| 活动列表页（`activity`） | `project/options` | `project` |
| 用户管理（`systemUser`） | `role/list` | `systemRole` |
| 顶栏"修改密码"（**任何登录用户**） | `user/changePassword` | `systemUser` |

泄漏面是"登录的同事能读到场地 / 团体 / 项目 / 角色的名称列表"。8 个人的内部后台
里这不构成越权。**替代方案（给这些接口挂"多点之一"的或语义）没有采纳**：那会让
同一个前缀里并存三种守卫，往那个文件加接口时得逐条推该挂哪种。

`changePassword` 不是"字典型"，它是自助功能——目标用户由 session 决定，handler
明确不收 `userId`（`modules/user/routes.ts` 有注释），本来就只能改自己。

### 4.4 `invitation` 按子路径拆成三个前缀

一个模块横跨两个菜单项，路径本来就分好了：

```
/api/invitation/template  → invitationTemplate   （全局菜单的模板库）
/api/invitation/batch     → activity             （活动详情的邀请函 tab）
/api/invitation/record    → activity             （同上，生成记录下载）
```

`record` 那条是覆盖测试发现的——手工 grep 漏了它。这正是那个测试的价值。

## 5. 鉴权数据流：零额外查询

`sessionMiddleware` 为了判断账号有没有被停用，**本来就要查一次 user 表**。权限点
顺着那次查询一起 join 回来，放进 `c.get("permissions")`：

- `permissionGate` 读 context，不查库
- `/api/permission/mine` 读 context，不查库

权限点和 `status` 的生命周期完全一致——两者都必须每请求重新读（管理员刚取消勾选
一个权限点，那个人下一次点击就该被挡住），也都不进 session cookie 缓存。

`leftJoin` 而不是 `innerJoin`：没挂任何角色的用户仍要能登录（他只是什么都点不了）。

### 5.1 为什么不用 Better Auth 的 `customSession` 插件

交接稿倾向"跟 session 一起回"。`customSession`（1.6.26 确实有）能做到，但：

- 插件必须前后端成对出现，**漏了不报类型错**（`auth-client.ts` 的注释专门警告过
  这个坑：少了 `usernameClient()` 时 `signIn.username` 干脆不存在）。
- 要给 `@repo/server` 加导出让前端拿到 `typeof auth`。
- 它的回调**自己再查一次库**，叠在现有那次 status 查询之上。

走自己的接口则整个待在项目已有的约定里（ApiResult + hc 推导），且总查询次数不增
不减。

## 6. 内置角色：两个，都恒等于全集

| 角色 | 绑定 | 可改 | 可删 | 同步 |
| --- | --- | --- | --- | --- |
| 超级管理员 | `isBuiltin` 引导账号 | ✗ | ✗ | 每次启动同步为全集 |
| 管理员 | 可自由分配 | ✗ | ✗ | 每次启动同步为全集 |

两者的区别只在于**「超级管理员」不该日常挂在同事身上**——它绑着引导出来的那一个
账号，是最后一条回来的路；日常给管理人员分配的是「管理员」。

### 6.1 超管为什么不特判

`permissionGate` 里**没有** `if (isBuiltin)`，也没有按角色名放行的分支。两个内置
角色是真的勾满了全部权限点，角色管理页上那两行显示的「全部权限」是真的。

特判只要一行代码，但会留下"界面显示的权限 ≠ 实际生效的权限"的裂缝——这类裂缝对
agent 特别贵，因为它读到的是界面和表，不是那一行 `if`。

### 6.2 为什么要"每次启动同步"

权限点是代码里的清单，角色的勾选在库里。**新增一个菜单项就多一个权限点，而线上库
里那两个内置角色不会自动获得它**——超管会突然进不去新页面。

写个测试盯不住这件事（测试拦不住已经部署的库），只有"重启即自愈"能。实现是
`bootstrap.ts` 的 `syncBuiltinRoles()`，一个 `onConflictDoUpdate`，跑在
`bootstrapBuiltinAdmin()` 之前。它只同步 `permissions`，**不覆盖 `remark`**——
覆盖备注会把运营写的字每次重启抹掉。

代价：内置角色的权限点在界面上不可编辑。角色 CRUD 因此**显式拒绝**编辑它们，
而不是让运营改完发现改了个寂寞。

## 7. 前端

**这一层不是安全边界。** 用户绕过界面直接打 `/api/*` 即可，它只负责"别让人看见
点不动的东西"。

| 东西 | 位置 |
| --- | --- |
| 菜单标注 | `app/nav.ts`，每项一个 `permission: PermissionKey`（`import type`，编译期咬死） |
| 会话 + 权限 | `features/auth/queries.ts`，**一个 query key** |
| 路由守卫 | `routes/_authenticated.tsx` + `features/auth/route-permissions.ts` |
| 403 页 | `shared/components/forbidden.tsx` |
| 菜单过滤 | `app/layout/nav-main.tsx` |
| 角色页复选框 | `routes/_authenticated/system/role/-components/permission-picker.tsx`，**按 `navMain` 渲染** |

### 7.1 权限为什么和 session 共用一个 query key

AGENTS.md 记着一个坑：登录/登出后必须 `removeQueries({ queryKey: sessionQueryKey })`，
因为守卫用的 `ensureQueryData` **即使数据已过期也会先返回缓存**。开两个 key 就是
两处都要记得删，漏一个的表现是"登录成功但菜单还是上一个人的"。

代价是首屏两次串行往返，`staleTime` 5 分钟，可以接受。

### 7.2 路由守卫为什么按路由 id 而不是 URL 路径

因为 **URL 结构和权限分组对不上**：活动详情挂在 `/project/` 下面
（`/project/1/activity/1/agenda`），按裸路径前缀判断会把它算成「项目管理」。
路由 id 保留了文件结构，最长前缀匹配才分得开。

### 7.3 无权限时渲染 403，不静默跳走

这个系统里页面链接会在同事之间转发（活动详情、排位方案都带 id）。悄悄重定向到
工作台，会把一次权限配置问题伪装成一次页面故障——用户看到"我点了没反应"，来问的
是"系统坏了"。

403 页渲染在 `AppLayout` 的 `Outlet` 位置（`children` 顶替），侧边栏和顶栏还在，
用户不会掉进一个没有导航的死页面。

### 7.4 角色页的复选框为什么从菜单渲染

不另外维护一份"权限点 → 中文名"的清单：权限点和菜单项一一对应，菜单标题就是用户
认得的那个词。两处各写一份必然漂移。

附带好处：**新增一个带 `permission` 的菜单项，角色页自动多出一个可勾选项**，不会
出现"页面上线了但权限点忘了配"。

## 8. 三处覆盖面各有一个测试盯着

权限点清单、菜单、路由守卫表必须一一对应，缺一处都不报错、只静默少一块：

| 测试 | 盯什么 | 漏了会怎样 |
| --- | --- | --- |
| `modules/auth/permission-map.test.ts` | 每条注册路由都登记过 | 新模块静默全开 |
| `app/nav.test.ts`（权限点 ↔ 菜单） | 每个权限点有菜单项 | 角色页勾不到这个点 |
| `app/nav.test.ts`（权限点 ↔ 守卫表） | 每个权限点有路由 | 那个页面前端不设防，用户撞一屏 403 |

## 9. 明确不做的

| | 理由 |
| --- | --- |
| 数据权限 `dataScope`（"只能看本部门数据"） | 依赖部门，而部门不要了 |
| "拒绝"语义（某角色显式禁止某操作） | 权限取并集。一旦有拒绝，"这个人到底能不能点"就要靠优先级推演；实际需求用并集够表达 |
| 菜单表入库 | §2.3 |
| `roleKey`（`@RequiresRole("admin")` 那种） | 一律按权限点判断，不按角色名 |
| 角色的 `status` / 排序字段 | 清空权限点就是"停用"；角色是个位数，排序不值一列 |
| 按钮级权限 | 「能进就能改」之后没有按钮级这一层了 |

## 10. 加一个新模块时要做什么

1. 在 `PERMISSION_BY_PREFIX` 里给新前缀写一个权限点（或加进两份豁免清单之一，
   **写明理由**）；
2. 如果它是一个新菜单项，在 `shared/permissions.ts` 加一个 key、在 `nav.ts` 加
   菜单项、在 `route-permissions.ts` 加路由前缀；
3. 跑 `bun run test`——上面三处漏了哪处，测试会直接告诉你。

新增权限点后线上的两个内置角色靠重启自愈（§6.2），**其他角色不会自动获得新权限
点**，需要运营去勾。这是有意的：那些角色是运营在管的数据，我们不替他们做决定。
