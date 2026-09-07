import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { db } from "../../infra/db";
import { isPermissionKey, type PermissionKey } from "../../shared/permissions";
import { role, userRole } from "../user/schema";
import { auth } from "./auth";
import type { Variables } from "./context";
import { user } from "./schema";

// Populates c.get("user") / c.get("session") / c.get("permissions") for every
// route registered after this middleware. Does not run for /api/auth/* — see
// routes.ts.
export const sessionMiddleware: MiddlewareHandler<{
  Variables: Variables;
}> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  // 被停用的账号一律当作未登录。
  //
  // **这是"停用"的执行点，而且是每请求执行一次**——管理员点下停用，那个人下一次
  // 点击就被踢到登录页，不依赖"把他已有的 session 撤销掉"是否漏网。Better Auth
  // 的 `admin` 插件那套 ban 走的是撤销 session（一次性动作），我们没装它，反而
  // 换来了更严格的语义（不用它的完整理由见 docs/user-management-design.md）。
  //
  // 多一次查询：`status` 不是 Better Auth 声明的字段，`getSession()` 不会带回来。
  // 把它声明成 additionalFields 能省下这一跳，但那要求每个字段都记得写
  // `input: false`，否则 `/api/auth/update-user` 就成了自己给自己改状态的入口
  // ——一次查询换掉一个提权面，划算。
  const authed = session?.user ?? null;
  const account = authed ? await loadAccount(authed.id) : null;

  const active = account?.status === "enabled";
  c.set("user", active ? authed : null);
  c.set("session", active ? (session?.session ?? null) : null);
  c.set("permissions", active ? (account?.permissions ?? []) : []);
  await next();
};

/**
 * 状态和权限点**一次 join 取回**，不是两次往返。
 *
 * 权限点顺路挂在这次查询上，是因为它跟 `status` 的生命周期完全一致：两者都必须
 * 每请求重新读（管理员刚取消勾选一个权限点，那个人下一次点击就该被挡住），
 * 也都不能进 session cookie 的缓存。既然为了 `status` 反正要查这张表，权限点
 * 跟着一起回来是零成本的——`requirePermission` 和 `/api/permission/mine` 因此
 * 都不用再查库。
 *
 * `leftJoin` 而不是 `innerJoin`：没挂任何角色的用户仍然要能登录（他只是什么都
 * 点不了），用 inner join 的话他会连 `status` 都查不出来，被当成"用户不存在"。
 */
const loadAccount = async (userId: string) => {
  const rows = await db
    .select({ status: user.status, permissions: role.permissions })
    .from(user)
    .leftJoin(userRole, eq(userRole.userId, user.id))
    .leftJoin(role, eq(role.id, userRole.roleId))
    .where(eq(user.id, userId));

  // 查不到行 = 用户在本次请求期间被删了，同样当未登录处理。
  const first = rows[0];
  if (!first) return null;

  // 多角色取并集。`isPermissionKey` 过滤的是**库里存着、代码里已经删掉**的权限点
  // ——权限点是代码里的清单，删一个不会自动清理 role.permissions 的历史值，
  // 留着它会让一个不存在的字符串一路漂到前端的菜单过滤里。
  const permissions = new Set<PermissionKey>();
  for (const row of rows) {
    for (const item of row.permissions ?? []) {
      if (isPermissionKey(item)) permissions.add(item);
    }
  }

  return { status: first.status, permissions: [...permissions] };
};
