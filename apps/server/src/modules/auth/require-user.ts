import { createMiddleware } from "hono/factory";
import { err } from "../../shared/result";
import type { Variables } from "./context";

/**
 * `Variables` 里的 `user` 是 `User | null`（sessionMiddleware 对所有路由都跑，
 * 包括不需要登录的）。业务模块几乎全都要求已登录，与其每个 handler 里写一遍
 * 判空再收窄类型，不如在链条头上收口一次，往 context 里塞一个**非空**的键。
 */
export type AuthedVariables = Variables & {
  authedUser: NonNullable<Variables["user"]>;
};

/**
 * 必须挂在 index.ts 的 sessionMiddleware **之后** —— 它读的就是那个中间件填的值。
 *
 * 一个类型上的诚实说明：Hono 只把 **handler** 的返回并进 `AppType`，中间件里
 * 这个 `c.json(err(...))` 不会出现在客户端推导出的响应联合类型里。所以前端不能
 * 靠类型穷举来处理未登录，必须一律走 `code !== "OK"` 的错误分支
 * （`shared/lib/api.ts` 的 unwrap 就是干这个的）。
 */
export const requireUser = createMiddleware<{ Variables: AuthedVariables }>(
  async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return c.json(err({ code: "UNAUTHORIZED", message: "未登录" }));
    }
    c.set("authedUser", user);
    await next();
  },
);
