# 用户管理设计

> 本文档记录**管理端用户管理**（`/system/user`）的设计与取舍。需求来源是旧系统
> `ruoyi-antdp` 的 `/system/user`（前端 `src/pages/system/user/index.tsx`，后端
> `fashion_actions_management` 的 `SysUserController.java`），但**不照抄**——下面每
> 一条"不做"都带着理由。
>
> 角色管理是**下一步**的事，本文档只负责把它需要的表和关联一次性定死，避免二次迁移。
> 界面形态（弹窗、状态芯片、操作列对齐、筛选栏）全部沿用
> [crud-page-guide.md](crud-page-guide.md)，本文档不重复。

## 1. 决策速查

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 登录标识 | **账号或邮箱都能登录**，账号是主标识、邮箱选填（见 §8.3） |
| 2 | 角色模型 | 角色在**库里可增删**，限定页面与操作 |
| 3 | 权限承载 | **代码里的权限点清单**，不做菜单表、不做数据权限、不做 `roleKey` |
| 4 | 建模路线 | **自建 `modules/user`**，不装 Better Auth `admin` 插件 |
| 5 | 交付范围 | 本次做完用户管理；角色管理与权限闸门是下一个 PR |
| 6 | 用户↔角色 | **多对多**，权限取**并集**，无"拒绝"语义 |
| 7 | 删除 | 停用 + **物理删除**（对齐旧系统） |
| 8 | 保护 | 不能操作自己 + `isBuiltin` 内置超管不可删/停/改角色 |
| 9 | 密码 | 管理员设初始密码、可重置他人、用户可自改。**不做**等保那套 |
| 10 | user ↔ member | **不关联**，本次不加任何列 |
| 11 | 自助注册 | **Hono 层拦截** `/api/auth/sign-up/*`，不用 `disableSignUp` |
| 12 | 邮箱列 | 保持 `notNull`，空值写**占位邮箱** `<username>@local.invalid` |
| 13 | 生产引导 | 启动时检查**有没有 `isBuiltin` 账号**，缺则按环境变量创建 |
| 14 | 账号名格式 | 插件默认：`3–30` 位，`a-zA-Z0-9_.` |

## 2. 明确不做的东西

对照旧系统逐条说明，避免下一个人以为是漏了。

| 旧系统有 | 我们不做 | 理由 |
| --- | --- | --- |
| 归属部门 `deptId` | ✗ | 产品明确不要 |
| 岗位 `postId` | ✗ | 产品明确不要 |
| 用户性别 `sex` | ✗ | 后台账号的性别不出现在任何列表、不参与任何逻辑。`member` 要性别是因为要打名牌，`user` 没有对应场景 |
| 手机号唯一约束 | ✗ | 手机号在这里只是联系方式，不是登录标识。设唯一的唯一后果是两个同事共用一个工作号时被莫名拦住 |
| 数据权限 `dataScope` | ✗ | "只能看本部门数据"依赖部门，而部门不要了 |
| 角色的 `roleKey` / 显示顺序 | ✗ | `roleKey` 服务的是 `@RequiresRole("admin")` 这种按角色名判断；我们一律按权限点判断 |
| 菜单表 `sys_menu` + 角色菜单树 | ✗ | 见 §3 |
| 导入 / 导出 | ✗ | 8 个内部账号，Excel 往返没有收益 |
| 定期强制改密 / 前端 RSA/SM2 加密 / 图形验证码 | ✗ | 等保要求，本项目不过等保。**若将来要过，这三条都得补，且比现在做贵** |
| 软删除 | ✗ | 已选物理删除；且表上有 `status` 区分启停，再加 `deletedAt` 就是同一张表两套删除语义 |

## 3. 为什么不把菜单搬进数据库

RuoYi 把菜单存进 `sys_menu`（目录/菜单/按钮三种类型同表），角色勾一棵树。**它能这么干，是
因为 RuoYi 前端有 `component` 字段做动态路由——库里加一行菜单，前端真的会长出一个页面。**

`apps/web` 是 TanStack Router 的**文件路由**，`routeTree.gen.ts` 从 `routes/` 目录生成，
页面存在与否完全由代码决定。菜单入库之后，运营在库里加一行指向 `/system/dept`，点进去就是
404。也就是说**菜单表的"增删改"能力对我们是假的，只有"隐藏一个已存在的页面"是真的**。

所以权限点是**代码里的一份清单**（分"页面"和"操作"两类），角色从清单里勾选。运营的自由度是
"随意组合已有权限点、随意起名建角色"，发明不出新权限点——而后者本来也不可能，`supplier:create`
这种字符串只有开发能造出来。

附带两个好处：新增页面时开发加一行清单，角色管理页自动多一个可勾选项，不会出现"页面上线了但
权限点忘了配"；前端菜单过滤和后端接口校验读同一份 key 常量，类型咬死，不会漂移。

## 4. 为什么不用 Better Auth 的 `admin` 插件

`admin` 插件现成提供 `create-user / list-users / set-role / ban-user / set-user-password`
等端点，代价是往 `user` 加 `role, banned, banReason, banExpires`、往 `session` 加
`impersonatedBy`。按 §1 的方向它有四处正面冲突：

- **角色**：它的 `user.role` 是逗号分隔的 text，服务的是它自己**代码里定义**的 access
  control。我们的角色是库里的行、要外键。装了会有两套"角色"概念并存。
- **信封**：它的路由在 `/api/auth/admin/*`，业务失败返回**真 HTTP 4xx**。AGENTS.md 规定业务
  接口一律 `ApiResult` + HTTP 200，前端只看 `result.code`。
- **分页**：`list-users` 的形状不是 `PageInput` → `{list,total}`。
- **停启用**：它给 `banned` boolean，而全站（supplier / member）用的是
  `status: "enabled" | "disabled"`。

**放弃它不损失能力，但要自己补齐三层停用**——它的 ban 顺带做了"撤销 session + 挡住重新
登录"，我们得显式做出来，见 §8.2。（这不是自建的额外代价，而是这个功能本来就需要三层；
用插件只是把它藏起来了。）

唯一需要确认的是"管理员重置他人密码"，不用插件也做得到，且**哈希算法仍归 Better Auth 管**：

```ts
const ctx = await auth.$context;
await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(newPassword));
```

（`@better-auth/core/dist/types/context.d.mts` 的 `AuthContext`，1.6.26 验证过。）

## 5. 数据模型

### 5.1 `user`（Better Auth 表，扩列）

| 列 | 来源 | 说明 |
| --- | --- | --- |
| `id` | Better Auth | text 随机 id。**注意它不是自增数字**，旧系统 `userId == 1L` 那种硬编码超管判断没有对应物，见 §5.3 |
| `name` | Better Auth | **姓名**（= 旧系统的"用户昵称"），界面上展示的中文名 |
| `email` | Better Auth | `notNull + unique`。见 §5.2 |
| `emailVerified` / `image` | Better Auth | 不使用，保留 |
| `username` | `username` 插件 | **登录账号**，唯一，默认小写归一 |
| `displayUsername` | `username` 插件 | 账号原样大小写，界面展示用。旧库有 `Csry` `Htgl` 这种混合大小写，靠它保住 |
| `phone` | 我们 | 手机号，**不设唯一** |
| `status` | 我们 | `"enabled" \| "disabled"`，与 supplier / member 同语义 |
| `remark` | 我们 | 备注 |
| `isBuiltin` | 我们 | 内置超管标记，见 §5.3 |
| `createdBy` / `updatedBy` | 我们 | → `user.id`，`on delete set null` |
| `createdAt` / `updatedAt` | Better Auth | |

**扩列的做法**：`username` / `displayUsername` 由 `bun run auth:generate` 从插件配置生成；
`phone` / `status` / `remark` / `isBuiltin` / `createdBy` / `updatedBy` 手工写进
`modules/auth/schema.ts`。**再次跑 `auth:generate` 会覆盖该文件**，跑完要把手工列补回来——
这是这个模块唯一一处需要人肉看顾的地方。

### 5.2 邮箱为什么用占位值

Q1 定了"邮箱选填"，但 Better Auth 的 `email` 是 `notNull + unique`，且其内部多条路径假设它
非空。旧库 8 个用户里至少 4 个连手机号都空着。

**做法**：库里 `email` 保持 `notNull`；用户没填时服务端写 `<username>@local.invalid`，读出
时剥掉该后缀当空显示。写入 / 读出各一个函数，脏的地方被关在这个边界内。

`.invalid` 是 [RFC 2606](https://www.rfc-editor.org/rfc/rfc2606) 保留的顶级域，**保证永远
不是真实可投递地址**，不存在占位邮箱撞上真人邮箱的可能。

**邮箱同时是一种登录标识（§8.3），所以占位值必须在登录那一层堵掉**——否则等于给每个没填
邮箱的人凭空多一条可推导的标识。判断函数 `isPlaceholderEmail()` 和它的三个兄弟都在
`shared/placeholder-email.ts`（放 `shared/` 是因为纯函数无 I/O，而且 `modules/auth` 和
`modules/user` 都要用——留在后者会成环）。

**不改成 nullable 的理由**：那是偏离框架预期的改动，不会立刻报错，而会在某次 Better Auth
升级后以"某条登录路径突然 500"的形式炸出来——和 `dev-seed/00-user.ts` 里那条"手写密码哈希
会悄悄失配"的告诫是同一类问题。

### 5.3 内置超管 `isBuiltin`

旧系统的超管保护是 `SysUser.isAdmin(userId)`，字面意思就是 `userId == 1L` 硬编码。我们的
`user.id` 是随机字符串，没有对应物，改用一个显式的布尔列。

规则：
- `isBuiltin = true` 的账号**不可删除、不可停用、不可改角色**。
- **任何人不能删除或停用自己**（把自己锁在门外了没人能救）。
- 该列**只由生产引导写入**（§7），界面上没有任何入口能设置它。

### 5.4 `role` / `user_role`

角色管理是下一步，但表结构现在就定死，避免二次迁移。

```
role       id(bigint identity), name(唯一), remark,
           createdBy, updatedBy, createdAt, updatedAt
user_role  userId, roleId  →  复合主键
```

- **`role` 不加 `status`**：停用一个角色等价于"把人从角色里移出去"或"清空它的权限点"，两个
  已有操作能表达的事不值得多一个状态——否则角色管理要多回答一条"角色停用时它的人权限怎么算"。
- **`user_role.userId` 用 `cascade`**：物理删除用户时关联行跟着走。
- **`user_role.roleId` 不设 `onDelete`**（NO ACTION）：**还有人挂着的角色不能删**。同
  `member.organizationId` 对团体的处理。
- **权限取并集，没有"拒绝"语义。** 一旦引入"某角色显式禁止某操作"，"这个人到底能不能点这个
  按钮"就要靠优先级规则推演；而实际需求（"给财务建个只读角色"）用并集完全够表达。

### 5.5 物理删除与 `created_by`

`user.id` 被 **48 处业务外键**引用（venue 6、member 8、seating 6、resource 6、project 5、
agenda 5、invitation 4、supplier 3、organization 2、trip 2、file 1），**全部是
`on delete set null`**；另有 `session` / `account` 两处 `cascade`。

所以物理删除一个用户，不会留下悬空引用，只会把那些 `created_by` 置空。全站目前**只有一处**
展示创建人——邀请函批次列表的 `createdByName: user.name`（`invitation/routes.ts:99`），而且
是 JOIN 不是快照，所以删除后那个人的历史批次创建人列显示 `-`。

> [crud-page-guide.md](crud-page-guide.md) 第 55 行写着"只有当别的表开始外键引用这张表的
> 主键时才补软删——那时候物理删除会留下悬空引用"。**这里不适用**：那 48 处外键是
> `set null`，不会悬空。这是一个有意的、符合指南前提的选择，不是漏看。

## 6. 接口

全部走 `/api/user/*`，POST + `ApiResult`，照 supplier 范式。

| 路径 | 入参 | 说明 |
| --- | --- | --- |
| `/api/user/list` | `PageInput` + `username` / `name` / `phone` / `status` | 排序 `id DESC`（此处是 `createdAt DESC`，因 id 非自增） |
| `/api/user/create` | 账号、姓名、密码、邮箱?、手机号?、角色[]、状态、备注? | 走 `auth.api.signUpEmail` 建 user + account |
| `/api/user/update` | 同上去掉账号与密码 | **账号和密码都不经此接口修改** |
| `/api/user/delete` | `id` | 物理删除。拦自己、拦 `isBuiltin` |
| `/api/user/setStatus` | `id`, `status` | 传目标值不传取反 |
| `/api/user/resetPassword` | `id`, `password` | 管理员重置他人密码 |
| `/api/user/changePassword` | 旧密码, 新密码 | 当前用户自改，走 Better Auth `changePassword` |

**留给角色管理那一步**：`/api/role/*` 与权限点清单。`user/create` 与 `user/update` 已经
收 `roleIds`，届时只需补角色的 CRUD 和闸门，用户管理这边不用改。

## 7. 生产引导

**今天生产库里长出第一个用户的唯一途径是那个公开的注册接口。** 关掉它之后，全新部署的库将
没有任何人能登录——所以引导是本次的必需品，不是附加项。

容器 entrypoint 跑完 `migrate` 之后：

1. 查库里**有没有 `isBuiltin = true` 的账号**。有 → 跳过。
2. 没有 → 读 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，建一个内置超管并挂"超级管理员"角色。
3. 两个变量没设 → **拒绝启动**，打印指引。

**判据是"有没有 `isBuiltin`"而不是"表是不是空的"**：现有的开发持久库和任何已跑起来的环境
里都已经有用户了（全是注册出来的，没有 `isBuiltin`）。按空表判断，这些库永远等不到内置超管；
按 `isBuiltin` 判断，它们下次重启就自动补上——升级路径和全新部署走同一条逻辑。

"缺变量就拒绝启动"和仓库既有做法一致（`getSessionExpiresInSeconds()` 遇非法值直接 throw，
`DEV_AUTH_BYPASS=1` 在生产形态下拒绝启动）。**在部署那一刻响亮地失败，远好过起来之后没人能登录。**

**旧库 8 个用户不导**：密码哈希跨系统迁不了（旧系统 BCrypt/SM2 + 不同参数），导过来所有人还
是要重设密码；而这 8 个里 `15860030301` / `15860030303` 是 RuoYi 自带的"若依"测试账号，
`cyq` / `cjm` 是开发账号，真正要留的只有两三个。

**`role` 表本次只预置一条"超级管理员"**，其余等角色管理落地后由客户自己建。旧库那三个
（`普通角色` / `流程执行角色` / `开发人员`）是 RuoYi 模板自带的名字，照搬等于替产品编角色名。

## 8. 认证链路的改动

### 8.1 关闭自助注册

Better Auth 的 `emailAndPassword.disableSignUp` **不能用**：它的检查写在端点处理函数内部
（`api/routes/sign-up.mjs:144`），**服务端直接调 `auth.api.signUpEmail()` 一样会被挡**。而
`dev-seed/00-user.ts` 和我们的 `user/create` 都要用它。

**做法**：在 `index.ts` 里 `app.route("/", authHandler)` **之前**插一个中间件，拒绝
`/api/auth/sign-up/*`。服务端调用不走 HTTP，完全不受影响；拦截点明摆在 `index.ts` 上。

**配一个测试**断言 `POST /api/auth/sign-up/email` 被拒——否则哪天有人调了中间件顺序，注册
会悄悄重新开放。`routes.dev.test.ts` 有同类测试的现成写法。

同时**删掉登录页的「去注册」按钮和整个 `signUp` 分支**，以及只在注册时用得上的错误文案。

### 8.2 停用要三层，不是一层

最初只做了 `sessionMiddleware` 里判 `user.status` 这一层，**实测发现它远远不够**：

> 停用之后，那个人**仍然能登录成功**（HTTP 200，拿到新 session），Better Auth 的
> `get-session` 也照样认。前端守卫读的正是 `get-session`，于是他被放进应用外壳，然后每
> 一个业务请求返回 `UNAUTHORIZED`——用户看到的是一个处处报错的空壳，而不是一句"账号已
> 停用"。

根因是挂载顺序：`sessionMiddleware` 在 `authHandler` **之后**，`/api/auth/*` 整条链走不到
它。所以停用必须三层一起做，各管一段：

| 层 | 位置 | 管什么 |
| --- | --- | --- |
| 挡新登录 | `auth.ts` 的 `databaseHooks.session.create.before` | 被停用的账号**不发 session**，抛 `ACCOUNT_DISABLED`（登录页据此显示"该账号已被停用"） |
| 踢已登录 | `user/routes.ts` 的 `revokeSessions()` | 停用时删掉他所有 `session` 行，下一次 `get-session` 就是 null，正常跳登录页 |
| 兜底 | `session-middleware.ts` | 判 `status`，盖住上面两者之间的竞态窗口。它本来就每个请求跑一次 `getSession`，不引入额外往返 |

**改任何一层之前先看这三行。** 只留中间件那层，就会退回上面那个坏状态；而只删 session
不挡登录，对方重新登录一次就又进来了。

`revokeSessions()` 在三个地方调用：`/setStatus`、`/update`（编辑弹窗里也能停用，只在
`/setStatus` 里做会漏）、以及 `/resetPassword`——管理员重置密码的场景基本只有"这人登不
进去了"和"这个号可能泄露了"，后者留着旧 session 等于白改。

> **没有自动化测试盯着这三层**：验证需要一个真实数据库，而 `apps/server` 目前只有纯单元
> 测试（`bun test`，不连库）。这一节的行为是手工实测确认的，改动时请重新手工验证。

### 8.3 账号和邮箱都能登录

**这一条是设计中途改的，原方案只支持账号登录。** 改的原因是它会让一批账号直接进不来：

> 关闭自助注册之前建的账号**没有 `username` 列**（那时候是邮箱注册），但它们的密码哈希、
> 邮箱、以及 48 处业务外键上的 `created_by` 关联全都完好。只支持账号登录，等于把这些人
> 锁在门外——而"重建账号"会走物理删除，把他们建过的记录上的创建人置空。

Better Auth 这边不需要额外工作：`/sign-in/username`（插件提供）和 `/sign-in/email`（内置）
是**并存的两个端点**，插件只新增不替换。前端按输入里有没有 `@` 分流（`routes/login.tsx`
的 `looksLikeEmail`）。这个判据是可靠的而不是凑合：账号名的字符集是 `[a-zA-Z0-9_.]`，
`@` 不在里面，所以合法账号名永远不含 `@`。

**代价是邮箱从"联系方式"升级成了"凭证"**，有两条后续影响：

- **在用户管理里改一个人的邮箱 = 改他的一种登录方式。** 编辑弹窗上没有为此加提示（那句
  话对绝大多数操作都是噪音），但改这块代码的人要知道。
- **占位邮箱必须堵掉。** 没填邮箱的人库里存的是 `<账号>@local.invalid`，那是从账号名机械
  派生的，不堵就等于给每个人凭空多一条**可推导**的登录标识。它不是漏洞（照样要密码），
  是纯噪音。闸在 `auth.ts` 的 `hooks.before`，`login-identifiers.test.ts` 盯着它。
  错误码复用 `INVALID_EMAIL_OR_PASSWORD`——换一个专属码等于确认"这个账号存在，只是没填
  邮箱"。

两条路径的失败文案也**必须一模一样**（都是"账号或密码错误"）。一边说账号一边说邮箱，等于
告诉试探的人他猜中的是哪一类标识。

> **老账号仍然建议补上账号名**：邮箱登录让它们能用，但列表里的"登录账号"列会显示 `-`，
> 而且它们永远只有一种登录方式。补的能力目前**还没做**（编辑弹窗里账号名一律禁用），
> 需要时放开"null → 有值"这一个方向即可，不要允许改名——账号名是登录标识。

### 8.4 账号名格式

`username` 插件默认值即所需：`3–30` 位，`/^[a-zA-Z0-9_.]+$/`。旧库 8 个账号全部通过
（`cyq` / `cjm` 正好卡在 3 位下限）。

**不放开中文**：旧库没有一个中文账号，连拿手机号当账号的都是 ASCII；而且中文账号名登录时要
切输入法。姓名由 `name` 列承载，账号名只在登录时出现一次——它不需要好看，需要好打。

## 9. 前端

- `routes/_authenticated/system/user.tsx`：当前是 `PagePlaceholder`，替换成完整 CRUD 页。
  菜单入口 `nav.ts` 已存在，不用加。
- **列**：账号(`displayUsername`)、姓名、手机号、角色、状态、创建时间、操作（修改 / 重置密码 / 删除）
- **筛选**：账号、姓名、手机号、状态。**不放"角色"**——本次只预置一条角色，下拉里只有一个
  选项，做出来是摆设；等角色管理落地再加，那时是一行的事。
- `login.tsx`：邮箱输入框改成账号，删掉注册分支。
- `nav-user.tsx`：头像菜单里加"修改密码"。

**中间态说明**：角色管理和权限闸门是下一个 PR，所以本次角色字段**能选、能存、能显示，但不拦
任何操作**。这是有意的中间态，界面上不加"暂未生效"提示——那个提示要写要删，而中间态只存在
一个迭代。（**该中间态已于角色管理那一轮结束**，见 §10。）

---

## 10. 角色管理与权限闸门

**已实施，设计见 [authorization.md](authorization.md)。** 那份文档讲权限点粒度、闸门
位置、内置角色和前端守卫；这里只记跟用户管理直接相关的三条。

- **`role` 表加了一列 `permissions text[]`**（迁移 `0004`）。形状和不建
  `role_permission` 关联表的理由见 authorization.md §3；§5.4 定下的"没有 status、
  没有 roleKey、没有排序字段、权限取并集"全部保持不变。
- **两个内置角色**：`超级管理员`（绑 `isBuiltin` 引导账号）和 `管理员`（可自由分配），
  权限恒等于代码里的全集，每次启动由 `syncBuiltinRoles()` 同步，都不可改不可删。
  §7 的生产引导流程不变，只是在它之前多跑一步同步。
- **§1 决策 5 的中间态已经结束**：全站接口现在都过 `permissionGate`。上面 §6 那句
  "留给角色管理那一步"的承诺兑现了——`user/create` 和 `user/update` 一行没改。

§1–§9 描述的用户管理本身没有任何改动。
