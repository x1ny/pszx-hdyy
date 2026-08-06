# 权限方案设计（Authorization）

> **状态：设计中，尚未实施。** 本文描述的文件和代码目前还不存在，实施后请把本行删掉，并把"实施步骤"一节改成"使用说明"。
>
> 认证（Authentication，"你是谁"）已经落地，见 [Better Auth 部分](#前置认证已完成)。本文只讨论授权（Authorization，"你能做什么"）。

## 1. 需求

- 系统级角色划分：如 `admin` 能进后台管理用户，普通 `user` 不能
- **菜单级**：不同角色看到的导航菜单项不同
- **按钮级**：同一个页面里，某些操作按钮只对有权限的角色显示
- 不需要多租户（用户不分属不同组织）
- 暂不需要行级/所有权判断（"只能改自己创建的数据"）

## 2. 选型结论

用 **Better Auth 内置的 `admin` 插件 + `createAccessControl`**，不引入额外依赖。

已核实：Drizzle adapter 那次的假包名问题在这里不存在，以下导入路径都对着本地 `node_modules/better-auth` 实际验证过，均真实存在：

| 用途 | 导入路径 | 验证结果 |
| --- | --- | --- |
| 定义权限矩阵 | `better-auth/plugins/access` → `createAccessControl` | ✅ |
| 默认语句/预设角色 | `better-auth/plugins/admin/access` → `defaultStatements`、`adminAc` | ✅ |
| 服务端插件 | `better-auth/plugins` → `admin` | ✅ |
| 客户端插件 | `better-auth/client/plugins` → `adminClient` | ✅ |
| 服务端权限检查 | `auth.api.userHasPermission` | ✅ |
| 客户端权限检查 | `authClient.admin.checkRolePermission`（同步）/ `hasPermission`（异步） | ✅ |

### 为什么不是其他方案

| 方案 | 不选的原因 |
| --- | --- |
| 自己加个 `role` 字段 | 角色一多，判断逻辑散落各处，且没有类型约束，写错字符串静默失效 |
| `organization` 插件 | 面向多租户 SaaS（用户属于组织，角色在组织内生效），要多 3~4 张表，当前需求用不上，不符合本仓库 lean 的定位 |
| CASL 等外部库 | 强在行级/属性级判断（"只能改自己的数据"），当前不需要；真需要时可以叠加，不冲突 |

### Better Auth 权限模型的能力边界

它是**「角色 → 权限」的静态映射**，回答的是"admin 能不能删 project"。

它**不回答**"这个 project 是不是他建的、他能不能改"。所有权/行级判断得自己在业务查询里带 `userId` 条件。这不是缺陷，是分工——如果将来这类需求变多，再考虑引入 CASL。

## 3. 核心：三层权限模型

这是本方案最重要的部分，**三层缺一不可，且职责不能混淆**。

```
┌─────────────────────────────────────────────────────────┐
│ 定义层  packages/permissions（新建的共享包）               │
│ 唯一的权限事实来源，apps/server 和 apps/web 共用同一份       │
│ ac + roles —— 这正是 monorepo 拆分后必须独立成包的原因      │
└─────────────────────────────────────────────────────────┘
              ↓ 被下面两层引用
┌─────────────────────────────────────────────────────────┐
│ 体验层（UI）  apps/web：路由守卫 / 菜单过滤 / 按钮显隐      │
│ 目的：不让用户看到点不了的东西                              │
│ ⚠️ 不是安全边界                                          │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ 安全层  apps/server：每个受保护的 Hono handler 内部        │
│ 目的：真正的拦截                                          │
│ ✅ 这才是安全边界                                        │
└─────────────────────────────────────────────────────────┘
```

### 为什么体验层不算安全边界

`apps/web` 是**纯客户端 SPA**，路由的 `beforeLoad`、组件渲染**全部在浏览器里执行**。这意味着：

- 隐藏按钮：用户改改浏览器里的 JS 状态就能让它显示出来
- 过滤菜单：同理，且用户可以直接在地址栏输 URL
- 路由守卫 `redirect`：只是让界面跳走，不阻止任何网络请求

前后端拆开之后这一点更直白了：`apps/server` 是一个独立的 HTTP 服务，**攻击者根本不需要经过你的界面**，`curl` 直接打 `/api/*` 即可。所以：

> 每一个受权限保护的操作，对应的 Hono handler 内部**必须**独立校验一次，不能依赖前端已经拦过。

体验层和安全层是**互相独立**的两道，不是"双保险"里可以省掉一个的关系——前端那道纯粹为了体验，后端那道才是真的。

## 4. 文件结构

```
packages/
├── permissions/
│   ├── package.json         ← 新增：包名 @repo/permissions
│   └── src/index.ts         ← 新增：AC 定义（唯一事实来源）
└── db/src/
    └── auth-schema.ts       ← 重新生成：user/session 表加字段

apps/server/src/
├── lib/auth.ts              ← 改：加 admin() 插件
└── index.ts                 ← 改：加带权限校验的 Hono 路由示例

apps/web/src/
├── lib/
│   ├── auth-client.ts       ← 改：加 adminClient() 插件
│   └── use-permission.ts    ← 新增：useCan() hook，菜单/按钮共用
├── components/
│   └── nav.tsx              ← 新增：按权限过滤的导航栏
└── routes/_authenticated/
    ├── dashboard.tsx        ← 改：加按钮级权限示例
    └── admin.tsx            ← 新增：仅 admin 可进的示例页
```

`@repo/permissions` 必须是独立的包：`apps/web` 只能 `import type` 引 `apps/server`，权限定义要在运行时被两边同时用到，不能塞进任何一侧的应用代码里。

## 5. 具体设计

### 5.1 定义层：`packages/permissions/src/index.ts`

```ts
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

const statement = {
  ...defaultStatements,                      // user/session 的管理操作（list/ban/delete...）
  project: ["create", "update", "delete"],   // 示例业务资源，按实际需求改
} as const;

export const ac = createAccessControl(statement);

export const user = ac.newRole({
  project: ["create"],
});

export const admin = ac.newRole({
  project: ["create", "update", "delete"],
  ...adminAc.statements,                     // 继承内置管理员的全部用户管理权限
});

export const roles = { admin, user };
```

**类型安全**：`statement` 用 `as const` 之后，后续所有权限检查里的资源名和操作名都由 TypeScript 推断，写错直接编译报错，不会静默返回 `false`。这是选插件而不是手写 role 判断的主要收益。

### 5.2 接入服务端和客户端

两边**必须传同一份 `ac` 和 `roles`**，否则客户端算出来的权限和服务端不一致——界面显示能点，一点就被后端拒绝。

```ts
// apps/server/src/lib/auth.ts
import { admin as adminPlugin } from "better-auth/plugins";
import { ac, roles } from "@repo/permissions";

export const auth = betterAuth({
  // ...现有配置
  plugins: [adminPlugin({ ac, roles })],
});
```

```ts
// apps/web/src/lib/auth-client.ts
import { adminClient } from "better-auth/client/plugins";
import { ac, roles } from "@repo/permissions";

export const authClient = createAuthClient({
  plugins: [adminClient({ ac, roles })],
});
```

### 5.3 体验层：`useCan()` hook

`checkRolePermission` 是**纯本地同步检查**（内存里算映射，不发网络请求），所以可以在渲染期随便调，不会造成请求风暴。

```ts
// apps/web/src/lib/use-permission.ts
export function useCan() {
  const { data: session } = authClient.useSession();
  const role = session?.user.role;
  return (permissions) =>
    role ? authClient.admin.checkRolePermission({ role, permissions }) : false;
}
```

**按钮级**：

```tsx
const can = useCan();
{can({ project: ["delete"] }) && <button>删除</button>}
```

**菜单级**：菜单项自己声明需要什么权限，渲染时过滤。

```tsx
const navItems = [
  { to: "/dashboard", label: "总览" },                                     // 无限制
  { to: "/admin",     label: "用户管理", permission: { user: ["list"] } },  // 仅 admin 可见
];

const visible = navItems.filter((i) => !i.permission || can(i.permission));
```

导航栏组件挂在 `_authenticated` 布局里，登录后的所有页面自动共用，且自动按权限过滤。

**路由级**：在 `beforeLoad` 里判断，不够权限跳走。

```ts
// apps/web/src/routes/_authenticated/admin.tsx
beforeLoad: ({ context }) => {
  const ok = authClient.admin.checkRolePermission({
    role: context.user.role,
    permissions: { user: ["list"] },
  });
  if (!ok) throw redirect({ to: "/dashboard" });
}
```

### 5.4 安全层：Hono handler 内部校验

**这是唯一真正的边界。** 模板里留一个正确范式，以后照抄不容易漏。注意路由要**接在 `routes` 链上**，否则 `AppType` 推断不到，前端 `hc` 客户端拿不到类型：

```ts
// apps/server/src/index.ts
const routes = app
  // ...现有路由
  .delete("/api/projects/:id", async (c) => {
    const user = c.get("user");                    // session 中间件塞进来的
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);

    const allowed = await auth.api.userHasPermission({
      body: { userId: user.id, permissions: { project: ["delete"] } },
    });
    if (!allowed) return c.json({ error: "Forbidden" } as const, 403);

    const id = c.req.param("id");
    // ...真正的业务逻辑
    return c.json({ ok: true });
  });
```

## 6. 数据库变更

`admin` 插件需要在现有表上加字段（不新增表）：

| 表 | 新增字段 | 说明 |
| --- | --- | --- |
| `user` | `role` | 角色，默认 `user`；多角色用逗号分隔 |
| `user` | `banned` | 是否被封禁 |
| `user` | `banReason` | 封禁原因 |
| `user` | `banExpires` | 封禁到期时间 |
| `session` | `impersonatedBy` | 模拟登录时记录管理员 ID |

封禁和模拟登录是插件白送的能力，用不上也不影响。

## 7. 实施步骤

1. 建 `packages/permissions` 包（根 `package.json` 的 `workspaces` 已经覆盖 `packages/*`，不用改），在 `apps/server` 和 `apps/web` 里加 `"@repo/permissions": "workspace:*"` 依赖后 `bun install`
2. 改 `apps/server/src/lib/auth.ts`、`apps/web/src/lib/auth-client.ts` 接入插件
3. 重新生成 schema 并推送（注意：**不要**用 `auth migrate`，那个只对内置 Kysely 适配器有效）：
   ```bash
   bun run --filter '@repo/server' auth:generate
   bun run db:push
   ```
4. 写 `apps/web/src/lib/use-permission.ts`、`apps/web/src/components/nav.tsx`
5. 写 `apps/web/src/routes/_authenticated/admin.tsx` 示例页
6. 在 `apps/server/src/index.ts` 的路由链上加带校验的接口示例
7. `bun run --filter '@repo/web' generate-routes && bun run typecheck`
8. 验证：把测试账号提成管理员，对比两种角色的表现
   ```sql
   UPDATE "user" SET role = 'admin' WHERE email = 'testuser@example.com';
   ```

## 8. 注意事项

- **服务端和客户端的 `ac`/`roles` 必须是同一份**，否则两边判断不一致
- **不要只靠前端拦截**，见 [第 3 节](#3-核心三层权限模型)
- 新增权限时只改 `permissions.ts` 一个文件，其他地方靠类型推断跟着走
- `session.user.role` 从数据库读出来是 `string`，而 `checkRolePermission` 的 `role` 参数是字面量联合类型（`"admin" | "user"`），实施时需要处理这个类型收窄
- Better Auth 支持一个用户多角色（逗号分隔），当前设计按单角色使用；如果将来要多角色，`useCan()` 的实现要跟着改

## 前置：认证（已完成）

本方案依赖已经落地的认证体系：

- `apps/server/src/lib/auth.ts` — Better Auth 实例（Drizzle adapter + 邮箱密码）
- `apps/server/src/index.ts` — `app.on(["GET","POST"], "/api/auth/*", ...)` 挂载 handler，随后的 session 中间件把 `user`/`session` 放进 Hono context
- `apps/web/src/routes/_authenticated.tsx` — 登录守卫（pathless layout），未登录跳 `/login?redirect=...`
- 受保护页面放在 `apps/web/src/routes/_authenticated/` 下，自动继承登录守卫

权限方案在此基础上叠加一层：登录守卫解决"有没有登录"，本方案解决"登录之后能做什么"。
