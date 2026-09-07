import { asc, count, desc, eq, ilike, ne } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import { BUILTIN_ROLE_NAME, BUILTIN_ROLE_NAMES } from "./bootstrap";
import { role, userRole } from "./schema";
import {
  CreateRoleInput,
  ListRolesInput,
  RoleIdInput,
  UpdateRoleInput,
} from "./validation";

/**
 * 角色接口，挂在 `/api/role/*`。
 *
 * 单独一个前缀而不是塞进 `/api/user/*`：角色是独立资源，AGENTS.md 的
 * 「前后端边界」要求一个模块有多个子资源时拆前缀，不要在动作名里加前缀区分。
 * 同 supplier / supplierQuote 的处理。
 *
 * **权限点归「角色管理」**，只有 `/list` 例外——用户表单的角色下拉要用它，而那个
 * 页面归「用户管理」。豁免登记在 `modules/auth/permission-map.ts` 的
 * `UNGATED_PATHS` 里，不在这个文件里判断。
 *
 * ## 两个内置角色
 *
 * 「超级管理员」和「管理员」的权限点恒等于代码里的全集，每次启动由
 * `syncBuiltinRoles()` 重新同步。所以下面的 `update` / `delete` **显式拒绝**它们
 * ——放行的话运营改完看着生效了，下次重启被静默改回去，那比直接说"不能改"糟得多。
 */
export const roleRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /**
   * 不分页的精简清单，给**用户表单的角色下拉**用。
   *
   * 和下面的 `/page` 并存不是重复：这条只回 `{id,name}`、不回权限点、不受
   * 「角色管理」权限点管（只有「用户管理」权限的人也要能选角色）。
   *
   * **「超级管理员」不在这条清单里**——它是**可分配角色**的清单，而那个角色绑的是
   * 引导出来的那一个 `isBuiltin` 账号，是系统最后一条回来的路，不该日常挂到同事
   * 身上。要给人全部权限用「管理员」，两者权限完全相同（都恒等于全集）。
   *
   * 想看全部角色（含超管）的是角色管理页，它走 `/page`。
   */
  .post("/list", async (c) => {
    const list = await db
      .select({ id: role.id, name: role.name, remark: role.remark })
      .from(role)
      .where(ne(role.name, BUILTIN_ROLE_NAME))
      // 按 id 升序：角色没有排序字段（刻意不做，见 schema.ts），先建的排前面
      // 是最不会让人意外的顺序。
      .orderBy(asc(role.id));

    return c.json(ok(list));
  })

  /**
   * 角色管理页的分页列表，带权限点和挂人数量。
   *
   * `memberCount` 是子查询而不是 join + group by：列表要按 `createdAt` 排序分页，
   * group by 之后分页的语义会变成"按分组分页"，得多套一层。角色是几十条的量级，
   * 一个相关子查询完全够。
   */
  .post("/page", jsonBody(ListRolesInput), async (c) => {
    const { name, ...page } = c.req.valid("json");
    const where = name ? ilike(role.name, `%${name}%`) : undefined;

    const memberCount = db
      .$count(userRole, eq(userRole.roleId, role.id))
      .as("member_count");

    const [list, [total]] = await Promise.all([
      db
        .select({
          id: role.id,
          name: role.name,
          permissions: role.permissions,
          remark: role.remark,
          createdAt: role.createdAt,
          updatedAt: role.updatedAt,
          memberCount,
        })
        .from(role)
        .where(where)
        // 不按 updatedAt 排序：改一次备注就会跳到列表最前面，用户会以为顺序乱了
        // （crud-page-guide.md 记着这个坑）。
        .orderBy(desc(role.createdAt), desc(role.id))
        .limit(toLimitOffset(page).limit)
        .offset(toLimitOffset(page).offset),
      db.select({ value: count() }).from(role).where(where),
    ]);

    return c.json(
      ok({
        list: list.map((row) => ({
          ...row,
          isBuiltin: BUILTIN_ROLE_NAMES.includes(row.name),
        })),
        total: total?.value ?? 0,
      }),
    );
  })

  .post("/get", jsonBody(RoleIdInput), async (c) => {
    const { id } = c.req.valid("json");

    const [row] = await db
      .select({
        id: role.id,
        name: role.name,
        permissions: role.permissions,
        remark: role.remark,
      })
      .from(role)
      .where(eq(role.id, id));

    return row
      ? c.json(ok({ ...row, isBuiltin: BUILTIN_ROLE_NAMES.includes(row.name) }))
      : c.json(notFound());
  })

  .post("/create", jsonBody(CreateRoleInput), async (c) => {
    const values = c.req.valid("json");

    // 内置角色的名字是被 syncBuiltinRoles() 占着的。让人建一个重名的会撞唯一约束，
    // 这里先给一条说得清的中文。
    if (BUILTIN_ROLE_NAMES.includes(values.name)) {
      return c.json(invalid(`「${values.name}」是系统内置角色名，请换一个`));
    }

    const operatorId = c.get("authedUser").id;
    const [created] = await db
      .insert(role)
      .values({ ...values, createdBy: operatorId, updatedBy: operatorId })
      .onConflictDoNothing({ target: role.name })
      .returning({ id: role.id });

    // onConflictDoNothing + 空返回 = 名字重了。用它而不是先查后插：并发下
    // "查的时候没有、插的时候有了"照样会撞唯一约束。
    if (!created) return c.json(invalid("角色名称已存在"));

    return c.json(ok({ id: created.id }));
  })

  .post("/update", jsonBody(UpdateRoleInput), async (c) => {
    const { id, ...values } = c.req.valid("json");

    const [target] = await db
      .select({ name: role.name })
      .from(role)
      .where(eq(role.id, id));
    if (!target) return c.json(notFound());

    if (BUILTIN_ROLE_NAMES.includes(target.name)) {
      return c.json(
        invalid(`「${target.name}」是系统内置角色，权限恒为全部，不能修改`),
      );
    }
    if (BUILTIN_ROLE_NAMES.includes(values.name)) {
      return c.json(invalid(`「${values.name}」是系统内置角色名，请换一个`));
    }

    const [updated] = await db
      .update(role)
      .set({ ...values, updatedBy: c.get("authedUser").id })
      .where(eq(role.id, id))
      .returning({ id: role.id });

    return updated ? c.json(ok({ id: updated.id })) : c.json(notFound());
  })

  /**
   * 物理删除。
   *
   * **先查挂人数量再删**，不是靠捕获数据库错误：`user_role.roleId` 是 NO ACTION
   * （还有人挂着的角色不能删，见 schema.ts），直接删会抛一个外键约束错误，最后以
   * `INTERNAL_ERROR` + "服务器内部错误" 的形式到达前端——那句话没告诉用户任何
   * 能行动的信息。
   */
  .post("/delete", jsonBody(RoleIdInput), async (c) => {
    const { id } = c.req.valid("json");

    const [target] = await db
      .select({ name: role.name })
      .from(role)
      .where(eq(role.id, id));
    if (!target) return c.json(notFound());

    if (BUILTIN_ROLE_NAMES.includes(target.name)) {
      return c.json(invalid(`「${target.name}」是系统内置角色，不能删除`));
    }

    const holders = await db.$count(userRole, eq(userRole.roleId, id));
    if (holders > 0) {
      return c.json(
        invalid(`还有 ${holders} 个用户挂着这个角色，请先解除后再删除`),
      );
    }

    await db.delete(role).where(eq(role.id, id));
    return c.json(ok({ id }));
  });

const notFound = () => err({ code: "NOT_FOUND" as const, message: "角色不存在" });

const invalid = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });
