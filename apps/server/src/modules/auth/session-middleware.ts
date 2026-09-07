import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { db } from "../../infra/db";
import { auth } from "./auth";
import type { Variables } from "./context";
import { user } from "./schema";

// Populates c.get("user") / c.get("session") for every route registered
// after this middleware. Does not run for /api/auth/* — see routes.ts.
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
  // 多一次按主键的查询：`status` 不是 Better Auth 声明的字段，`getSession()` 不会
  // 带回来。把它声明成 additionalFields 能省下这一跳，但那要求每个字段都记得写
  // `input: false`，否则 `/api/auth/update-user` 就成了自己给自己改状态的入口
  // ——一次主键查询换掉一个提权面，划算。
  const authed = session?.user ?? null;
  const active = authed ? await isEnabled(authed.id) : false;

  c.set("user", active ? authed : null);
  c.set("session", active ? (session?.session ?? null) : null);
  await next();
};

const isEnabled = async (userId: string) => {
  const [row] = await db
    .select({ status: user.status })
    .from(user)
    .where(eq(user.id, userId));

  // 查不到行 = 用户在本次请求期间被删了，同样当未登录处理。
  return row?.status === "enabled";
};
