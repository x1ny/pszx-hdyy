import { and, asc, count, desc, eq, ilike, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { toDisplayEmail, toStoredEmail } from "../../shared/placeholder-email";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, auth, requireUser } from "../auth";
import { session, user } from "../auth/schema";
import { BUILTIN_ROLE_NAME } from "./bootstrap";
import { role, userRole } from "./schema";
import {
  ChangePasswordInput,
  CreateUserInput,
  ListUsersInput,
  ResetPasswordInput,
  SetUserStatusInput,
  UpdateUserInput,
  UserIdInput,
} from "./validation";

/**
 * 显式列出返回列，不用 `select().from(user)`。除了 supplier 那条理由（加列不该
 * 顺带改 API 契约）之外，这里还有一条更硬的：**`user` 表上有 Better Auth 的
 * `emailVerified` / `image`，以及未来可能被插件加进来的列**，全量 select 会把
 * 它们一路发到浏览器。
 */
const userFields = {
  id: user.id,
  username: user.displayUsername,
  name: user.name,
  email: user.email,
  phone: user.phone,
  status: user.status,
  remark: user.remark,
  isBuiltin: user.isBuiltin,
  createdAt: user.createdAt,
};

const notFound = () =>
  err({ code: "NOT_FOUND" as const, message: "用户不存在" });

/**
 * 停用一个账号时，把他手上已经签发的 session 全部删掉。
 *
 * 三层里的中间那层，缺了它会露出一个很难看的中间态：`sessionMiddleware` 判 status
 * 只作用在**业务接口**上，`/api/auth/*` 走不到它（挂载顺序，见 index.ts）。于是
 * 一个已登录的人被停用之后，Better Auth 的 `getSession` 仍然返回有效 session，
 * 前端守卫据此放他留在页面里，而每个业务请求都返回 UNAUTHORIZED —— 界面处处报错
 * 但就是不跳登录页。删掉 session 行，他下一次 `getSession` 就是 null，正常跳走。
 *
 * 另外两层：`auth.ts` 的 `databaseHooks.session.create.before` 挡住重新登录，
 * `session-middleware.ts` 兜住这两者之间的竞态窗口。
 */
const revokeSessions = (userId: string) =>
  db.delete(session).where(eq(session.userId, userId));

const invalid = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

/**
 * 占位邮箱只应该在库里存在，出了这一层就一律是"用户填的邮箱或 null"。
 * 每个返回用户行的接口都要过这个函数——漏一个，前端就会显示
 * `zhangsan@local.invalid`。
 */
const present = <T extends { email: string }>(row: T) => ({
  ...row,
  email: toDisplayEmail(row.email),
});

/** 按用户批量取角色。列表和详情共用，避免两处各写一遍 join。 */
const loadRoles = async (userIds: string[]) => {
  const grouped = new Map<string, { id: number; name: string }[]>();
  if (userIds.length === 0) return grouped;

  const rows = await db
    .select({ userId: userRole.userId, id: role.id, name: role.name })
    .from(userRole)
    .innerJoin(role, eq(userRole.roleId, role.id))
    .where(inArray(userRole.userId, userIds))
    // 固定顺序，否则同一个用户的角色芯片会在两次刷新之间换位置。
    .orderBy(asc(role.id));

  for (const { userId, ...item } of rows) {
    const list = grouped.get(userId);
    if (list) list.push(item);
    else grouped.set(userId, [item]);
  }
  return grouped;
};

/**
 * 覆盖式重写某个用户的角色。
 *
 * 这里发的是**完整目标名单**（先删后插），而不是环节配置那种增量意图——用户的
 * 角色只有一个编辑入口（用户管理表单），不存在两个入口并发改同一批关联的问题，
 * 所以不需要 `add`/`remove` 那套。
 */
const replaceRoles = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  roleIds: number[],
) => {
  await tx.delete(userRole).where(eq(userRole.userId, userId));
  if (roleIds.length > 0) {
    await tx
      .insert(userRole)
      .values(roleIds.map((roleId) => ({ userId, roleId })));
  }
};

/**
 * 「超级管理员」不可分配给任何人——它绑的是引导出来的那一个 `isBuiltin` 账号，
 * 是系统最后一条回来的路。要给人全部权限用「管理员」，两者权限完全相同。
 *
 * `/api/role/list` 已经把它从下拉里去掉了，但**那不是边界**：前端过滤只是别让人
 * 看见点不动的东西，直接打接口照样能传这个 id 进来（见 AGENTS.md「渲染模型」）。
 *
 * 返回 null = 通过。
 */
const rejectBuiltinRole = async (roleIds: number[]) => {
  if (roleIds.length === 0) return null;

  const [found] = await db
    .select({ id: role.id })
    .from(role)
    .where(and(inArray(role.id, roleIds), eq(role.name, BUILTIN_ROLE_NAME)));

  return found
    ? `「${BUILTIN_ROLE_NAME}」不能分配给其他账号，需要全部权限请用「管理员」`
    : null;
};

/**
 * Better Auth 的接口在唯一冲突等情况下抛 `APIError`（带真 HTTP 状态），而我们的
 * 约定是业务失败一律 HTTP 200 + `code`。这里把它翻成中文的 VALIDATION_ERROR。
 *
 * 只认账号和邮箱两种冲突：其余异常继续往上抛，交给 `index.ts` 的 `app.onError`
 * ——把未知异常也吞成"校验失败"，会让真正的故障看起来像用户填错了。
 */
const toConflictMessage = (error: unknown) => {
  const code = (error as { body?: { code?: string } })?.body?.code;
  if (code === "USERNAME_IS_ALREADY_TAKEN") return "该账号已存在";
  if (code === "USER_ALREADY_EXISTS" || code === "EMAIL_ALREADY_EXISTS") {
    return "该邮箱已被占用";
  }
  return null;
};

export const userRoutes = new Hono<{ Variables: AuthedVariables }>()
  // 整条链都要求登录。前端的菜单和路由守卫不是安全边界，这里才是。
  //
  // ⚠️ 这里**还没有**按角色/权限点的判断——角色管理是下一个 PR，闸门随它一起
  // 上。在那之前，任何登录用户都能管用户，这是有意的中间态。
  .use(requireUser)

  .post("/list", jsonBody(ListUsersInput), async (c) => {
    const { username, name, phone, status, page, pageSize } =
      c.req.valid("json");

    const where = and(
      // 搜 displayUsername 而不是 username：用户搜的是他在界面上看见的那个写法。
      // ilike 本来就大小写不敏感，所以搜 "csry" 一样能命中 "Csry"。
      username ? ilike(user.displayUsername, `%${username}%`) : undefined,
      name ? ilike(user.name, `%${name}%`) : undefined,
      phone ? ilike(user.phone, `%${phone}%`) : undefined,
      status ? eq(user.status, status) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select(userFields)
        .from(user)
        .where(where)
        // **按 createdAt 倒序，不是 id。** supplier 那边排 `id DESC` 是因为它的
        // id 是单调递增的 identity；`user.id` 是 Better Auth 生成的随机字符串，
        // 排它等于随机排序。createdAt 同样满足"不会因为编辑而变化"这个要求
        // （编辑跳行的坑见 crud-page-guide），再拿 id 兜底保证翻页稳定。
        .orderBy(desc(user.createdAt), desc(user.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(user).where(where),
    ]);

    const roles = await loadRoles(list.map((row) => row.id));

    return c.json(
      ok({
        list: list.map((row) => ({
          ...present(row),
          roles: roles.get(row.id) ?? [],
        })),
        total: totalRows[0]?.total ?? 0,
      }),
    );
  })

  // 单独走一次 get 而不从列表缓存里捞：深链直接进编辑态时列表根本没加载过。
  .post("/get", jsonBody(UserIdInput), async (c) => {
    const { id } = c.req.valid("json");

    const [row] = await db.select(userFields).from(user).where(eq(user.id, id));
    if (!row) return c.json(notFound());

    const roles = await loadRoles([id]);
    return c.json(ok({ ...present(row), roles: roles.get(id) ?? [] }));
  })

  .post("/create", jsonBody(CreateUserInput), async (c) => {
    const { username, password, name, email, roleIds, ...rest } =
      c.req.valid("json");
    const operatorId = c.get("authedUser").id;

    // 在建号**之前**拦：建号走 auth.api，不在下面那个事务里，放到后面拦就会留下
    // 一个已经创建、但角色没写成的账号。
    const builtinRoleError = await rejectBuiltinRole(roleIds);
    if (builtinRoleError) return c.json(invalid(builtinRoleError));

    // **走 Better Auth 的注册接口，不手写 user/account 两张表。** 密码哈希的
    // 算法和参数归它管，手写一份必然在某次升级之后悄悄失配，而失配的表现是
    // 「登录返回 401」这种完全不指向此处的症状。同 dev-seed/00-user.ts。
    //
    // 注意这条路径**不受"关闭自助注册"影响**：注册是在 Hono 层被拦掉的
    // （见 index.ts），服务端直接调用不走 HTTP。
    let createdId: string;
    try {
      const created = await auth.api.signUpEmail({
        body: {
          email: toStoredEmail(email, username),
          password,
          name,
          // 插件会把它小写归一存进 `username`，并把原样大小写填进
          // `displayUsername`（username/index.mjs:77）。
          username,
        },
      });
      createdId = created.user.id;
    } catch (error) {
      const message = toConflictMessage(error);
      if (!message) throw error;
      return c.json(invalid(message));
    }

    // 剩下的列 Better Auth 不认识（没声明成 additionalFields），只能补一次更新。
    //
    // ⚠️ 这一步和上面的注册**不在同一个事务里**——`auth.api` 用的是它自己的连接，
    // 没法并进 `db.transaction`。极端情况下会留下一个"建出来了但没有角色/备注"的
    // 账号；它是可登录、可编辑的正常账号，不是脏数据，所以不做补偿删除。
    await db.transaction(async (tx) => {
      await tx
        .update(user)
        .set({ ...rest, createdBy: operatorId, updatedBy: operatorId })
        .where(eq(user.id, createdId));
      await replaceRoles(tx, createdId, roleIds);
    });

    const [row] = await db
      .select(userFields)
      .from(user)
      .where(eq(user.id, createdId));
    const roles = await loadRoles([createdId]);

    return row
      ? c.json(ok({ ...present(row), roles: roles.get(createdId) ?? [] }))
      : c.json(notFound());
  })

  .post("/update", jsonBody(UpdateUserInput), async (c) => {
    const { id, email, roleIds, ...rest } = c.req.valid("json");
    const operatorId = c.get("authedUser").id;

    const [target] = await db
      .select({
        isBuiltin: user.isBuiltin,
        username: user.username,
      })
      .from(user)
      .where(eq(user.id, id));
    if (!target) return c.json(notFound());

    // 内置超管不可停用、不可改角色（可以改姓名/手机号/备注/邮箱）。
    if (target.isBuiltin) {
      if (rest.status !== "enabled") {
        return c.json(invalid("内置管理员不能停用"));
      }
      const current = (await loadRoles([id])).get(id) ?? [];
      const same =
        current.length === roleIds.length &&
        current.every((item) => roleIds.includes(item.id));
      if (!same) return c.json(invalid("内置管理员的角色不能修改"));
    } else {
      // 只有内置超管账号能挂「超级管理员」，而它走的正是上面那条"角色必须不变"的
      // 分支。其他人一律拒绝。
      const builtinRoleError = await rejectBuiltinRole(roleIds);
      if (builtinRoleError) return c.json(invalid(builtinRoleError));
    }

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(user)
          .set({
            ...rest,
            // 账号名不可改（登录标识），所以占位邮箱按库里的账号名重算。
            email: toStoredEmail(email, target.username ?? id),
            updatedBy: operatorId,
          })
          .where(eq(user.id, id));
        await replaceRoles(tx, id, roleIds);
      });
    } catch (error) {
      // 邮箱唯一约束是数据库层的，撞了会抛 pg 错误而不是 Better Auth 的 APIError。
      if ((error as { code?: string })?.code === "23505") {
        return c.json(invalid("该邮箱已被占用"));
      }
      throw error;
    }

    // 这个接口也能改状态，所以同样要踢人——只在 /setStatus 里做的话，从编辑弹窗
    // 里把人停用就漏掉了。
    if (rest.status === "disabled") await revokeSessions(id);

    const [row] = await db.select(userFields).from(user).where(eq(user.id, id));
    const roles = await loadRoles([id]);

    return row
      ? c.json(ok({ ...present(row), roles: roles.get(id) ?? [] }))
      : c.json(notFound());
  })

  .post("/setStatus", jsonBody(SetUserStatusInput), async (c) => {
    const { id, status } = c.req.valid("json");
    const operatorId = c.get("authedUser").id;

    // 不能停用自己：把自己锁在门外了没人能救。这条比"内置超管"那条更重要——
    // 后者防的是误删最后一个管理员，而这条防的是当场自锁。
    if (id === operatorId) return c.json(invalid("不能停用自己"));

    const [target] = await db
      .select({ isBuiltin: user.isBuiltin })
      .from(user)
      .where(eq(user.id, id));
    if (!target) return c.json(notFound());
    if (target.isBuiltin && status === "disabled") {
      return c.json(invalid("内置管理员不能停用"));
    }

    const [row] = await db
      .update(user)
      .set({ status, updatedBy: operatorId })
      .where(eq(user.id, id))
      .returning(userFields);

    if (!row) return c.json(notFound());
    if (status === "disabled") await revokeSessions(id);

    return c.json(ok(present(row)));
  })

  .post("/delete", jsonBody(UserIdInput), async (c) => {
    const { id } = c.req.valid("json");
    const operatorId = c.get("authedUser").id;

    if (id === operatorId) return c.json(invalid("不能删除自己"));

    const [target] = await db
      .select({ isBuiltin: user.isBuiltin })
      .from(user)
      .where(eq(user.id, id));
    if (!target) return c.json(notFound());
    if (target.isBuiltin) return c.json(invalid("内置管理员不能删除"));

    // **物理删除。** 全站 48 处业务外键引用 `user.id`，全部是 `on delete set
    // null`，所以这里不会留下悬空引用，只会把那些 `created_by` 置空；`session`
    // 和 `account` 是 cascade，登录凭证跟着一起走。
    //
    // 唯一的可见后果：邀请函批次列表的"创建人"列（那是 JOIN 不是快照）会显示
    // `-`。前端的删除确认弹窗要把"不可恢复"说出来。
    const [row] = await db
      .delete(user)
      .where(eq(user.id, id))
      .returning({ id: user.id });

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/resetPassword", jsonBody(ResetPasswordInput), async (c) => {
    const { id, password } = c.req.valid("json");

    const [target] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, id));
    if (!target) return c.json(notFound());

    // **内置超管的密码是可以重置的**（不像删除/停用/改角色）——否则忘了密码就
    // 永远进不去了。
    //
    // 不装 `admin` 插件也能给别人改密码，而且哈希仍然归 Better Auth 管：
    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(
      id,
      await ctx.password.hash(password),
    );

    // 顺手把他现有的 session 都清掉。管理员重置密码的场景基本只有两种——"这人
    // 登不进去了"和"这个号可能泄露了"，后者如果留着旧 session，改密码就白改了。
    await revokeSessions(id);

    return c.json(ok({ id }));
  })

  .post("/changePassword", jsonBody(ChangePasswordInput), async (c) => {
    const { currentPassword, newPassword } = c.req.valid("json");

    // 目标用户由 session 决定，**不从入参取**——收一个 userId 就等于把"改任何人
    // 密码"的能力挂在这个只该改自己的接口上。
    try {
      await auth.api.changePassword({
        body: { currentPassword, newPassword },
        headers: c.req.raw.headers,
      });
    } catch (error) {
      // 原密码不对是最常见的失败，翻成中文；其余继续抛给 onError。
      const code = (error as { body?: { code?: string } })?.body?.code;
      if (code === "INVALID_PASSWORD") return c.json(invalid("当前密码不正确"));
      throw error;
    }

    return c.json(ok({ ok: true }));
  });
