import { Hono } from "hono";
import { PERMISSION_KEYS } from "../../shared/permissions";
import { ok } from "../../shared/result";
import { type AuthedVariables, requireUser } from "../auth";

/**
 * 当前用户的权限点，挂在 `/api/permission/*`。
 *
 * **它自己不受权限点管**（登记在 `permission-map.ts` 的 `UNGATED_PREFIXES` 里）：
 * 用权限点去挡"查询自己有哪些权限点"是循环依赖——前端的路由守卫和菜单过滤都要先
 * 拿到这份数据才知道该显示什么。
 *
 * **不查库。** `sessionMiddleware` 为了判断账号有没有被停用，本来就要查一次
 * user 表，权限点是顺着那次 join 一起回来的，这里只是把 context 里的东西转出去。
 */
export const permissionRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /**
   * 当前用户所有角色的权限点并集。
   *
   * 前端拿它做两件事：过滤侧边栏、守卫路由。**两者都不是安全边界**——用户绕过
   * 界面直接打 `/api/*` 即可，真正的闸门在服务端每条路由上（见
   * `modules/auth/permission-map.ts`）。
   */
  .post("/mine", (c) => c.json(ok(c.get("permissions"))))

  /**
   * 权限点全集，按菜单顺序。角色管理页拿它兜底校验，也让接口文档的读者知道
   * 一共有哪些点可勾。
   */
  .post("/catalog", (c) => c.json(ok([...PERMISSION_KEYS])));
