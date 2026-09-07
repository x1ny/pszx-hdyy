import { createMiddleware } from "hono/factory";
import { err } from "../../shared/result";
import type { Variables } from "./context";
import { resolvePermission } from "./permission-map";

/**
 * 权限点闸门，**一条中间件管全站**。挂在 `index.ts` 的 `/api/*` 上，紧跟在
 * `sessionMiddleware` 之后、所有业务模块的 `.route()` 之前。
 *
 * ## 为什么是一条，不是每个前缀各挂一条
 *
 * 因为豁免是**路径级**的：`/api/member/*` 整体归「人员管理」，但
 * `/api/member/candidates` 必须放行（活动人员页的选人弹窗要用它）。用
 * `app.use("/api/member/*", …)` 那种按前缀挂的写法表达不了这个例外——Hono 会把
 * 匹配到的中间件全部跑一遍，后面再挂一条"放行"的中间件不会撤销前面那条的拒绝。
 *
 * 所以判断整个收进 `resolvePermission()`：它先看路径级豁免，再按最长前缀匹配。
 * 归属和豁免都在 `permission-map.ts` 一张表里，`permission-map.test.ts` 遍历
 * `routes.routes` 断言每条路径都被登记过——新模块忘了填表就是红测试，而不是
 * 静默全开。
 *
 * ## 它跑在模块的 requireUser 之前
 *
 * 所以不能读 `c.get("authedUser")`，得自己判空 `c.get("user")`。
 * 顺序：`sessionMiddleware` → `permissionGate` → 模块的 `requireUser`。
 *
 * ## 不查库
 *
 * `sessionMiddleware` 为了判断账号有没有被停用本来就要查一次 user 表，权限点是
 * 顺着那次 join 一起回来的，这里只读 context。
 *
 * ## 超管没有特判
 *
 * 内置的「超级管理员」和「管理员」两个角色是真的勾满了全部权限点（引导时写入、
 * 每次启动重新同步，见 `modules/user/bootstrap.ts`）。这里刻意没有
 * `if (isBuiltin)` 或按角色名放行的分支——那会留下"界面显示的权限 ≠ 实际生效的
 * 权限"的裂缝，而现在角色管理页上那两个角色的格子是真的全勾着。
 *
 * 类型上的诚实说明同 `require-user.ts`：中间件的 `c.json()` 不会进 `AppType`，
 * 前端必须走 `code !== "OK"` 的通用错误分支（`shared/lib/api.ts` 的 unwrap）。
 */
export const permissionGate = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const required = resolvePermission(c.req.path);
    if (!required) return next();

    const user = c.get("user");
    if (!user) {
      return c.json(err({ code: "UNAUTHORIZED", message: "未登录" }));
    }

    if (!c.get("permissions").includes(required)) {
      return c.json(err({ code: "FORBIDDEN", message: "没有该功能的权限" }));
    }

    await next();
  },
);
