import { asc } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { ok } from "../../shared/result";
import { type AuthedVariables, requireUser } from "../auth";
import { role } from "./schema";

/**
 * 角色接口，挂在 `/api/role/*`。
 *
 * **本次只有 `list`，够用户表单的角色下拉用。** 角色管理（增删改 + 权限点勾选）
 * 是下一个 PR，届时在这个文件里往链上接就行——用户管理那边的 `create`/`update`
 * 已经收 `roleIds`，不需要回头改。完整规划见 docs/user-management-design.md。
 *
 * 单独一个前缀而不是塞进 `/api/user/*`：角色是独立资源，AGENTS.md 的
 * 「前后端边界」要求一个模块有多个子资源时拆前缀，不要在动作名里加前缀区分。
 * 同 supplier / supplierQuote 的处理。
 */
export const roleRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /**
   * 不分页。角色是个位数到几十条的配置型数据，`{list,total}` 那套在这里只是多一个
   * 前端要维护的分页状态。同 supplierQuote 的判据。
   */
  .post("/list", async (c) => {
    const list = await db
      .select({ id: role.id, name: role.name, remark: role.remark })
      .from(role)
      // 按 id 升序：角色没有排序字段（刻意不做，见 schema.ts），先建的排前面
      // 是最不会让人意外的顺序。
      .orderBy(asc(role.id));

    return c.json(ok(list));
  });
