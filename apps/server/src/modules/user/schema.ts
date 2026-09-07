import {
  bigint,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { PermissionKey } from "../../shared/permissions";
import { user } from "../auth/schema";

// ---------------------------------------------------------------------------
// 角色
//
// **角色管理本身是下一个 PR**，这里只把表结构定死，避免用户管理交付之后再回头
// 改表。用户管理这一版角色是"能选、能存、能显示，但不拦任何操作"的中间态，闸门
// 随角色管理一起上。完整取舍见 docs/user-management-design.md。
// ---------------------------------------------------------------------------

/**
 * 角色主档。运营可自由增删改，权限点则由代码维护——**角色是数据，权限点是代码**。
 *
 * 这个分工的理由：`supplier:create` 这种字符串只有开发能造出来，运营发明不了新
 * 权限点。让角色能自由组合已有权限点，就已经覆盖了"给财务建个只读角色"这类真实
 * 需求；而把权限点也搬进库（RuoYi 的 `sys_menu`）在我们这里是**假能力**——
 * `apps/web` 是文件路由，库里加一行菜单指向不存在的路由只会得到 404。
 *
 * **刻意没有 `status` 列。** 旧系统的角色有启用/停用，但"停用一个角色"的效果等价
 * 于"把人从角色里移出去"或"清空它的权限点"，两个已有操作能表达的事不值得多一个
 * 状态——否则角色管理要额外回答一条"角色停用时挂着它的人权限怎么算"。
 *
 * 也没有 `roleKey` 和显示顺序：前者服务的是 `@RequiresRole("admin")` 这种按角色名
 * 判断，而我们一律按权限点判断。
 */
export const role = pgTable("role", {
  // byDefault 而非 always：和 supplier 同理，导数据时要能带着原始 id 插入。
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  // 角色是物理删除的，没有软删除状态；删掉之后名称才重新可用。同 organization。
  name: text("name").notNull().unique(),

  /**
   * 这个角色勾选的权限点。取值范围是 `shared/permissions.ts` 的 `PermissionKey`
   * ——**代码是清单，库里只存勾选结果**。
   *
   * **为什么是一列而不是 `role_permission` 关联表**：关联表存在的意义是让
   * `permission_id` 外键指向一张 `permission` 表，而我们刻意不做权限点入库
   * （见上面 `role` 的注释）。没有可指向的表，关联表就退化成"给一堆没有关系可言
   * 的字符串做范式化"，白得一次 join——而这次 join 在**每条受闸门的请求**上都要
   * 跑（`session-middleware.ts`）。
   *
   * 形状照搬 `supplier.serviceCategories`：同样是代码定义的字符串集合、同样要按值
   * 反查（`permissions @> ARRAY['systemUser']`）、同样没有外键可加。
   *
   * 代码里删掉一个权限点时，库里的历史值不会自动清理——读取侧
   * （`session-middleware.ts`）会过滤掉不认识的字符串，不需要写迁移。
   */
  permissions: text("permissions")
    .array()
    .$type<PermissionKey[]>()
    .notNull()
    .default([]),

  remark: text("remark"),

  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedBy: text("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/**
 * 用户 ↔ 角色，多对多。
 *
 * **为什么是多对多而不是 `user.role_id` 一列**：多对多能表达单角色（UI 限制成单选
 * 即可，零迁移），单列外键表达不了多角色（要建表、迁数据、改所有读取处）。既然角色
 * 管理是下一个 PR，这里必须选那个不会逼着回头改的形状。旧系统实测也确实在用多角色
 * （`cyq` 一个人挂了三个）。
 *
 * **权限取并集，没有"拒绝"语义。** 一旦引入"某角色显式禁止某操作"，"这个人到底能
 * 不能点这个按钮"就要靠优先级规则推演，排查成本陡增；而实际需求用并集完全够表达。
 */
export const userRole = pgTable(
  "user_role",
  {
    /** cascade：用户是物理删除的（见 routes.ts 的 /delete），关联行跟着走。 */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /**
     * 不设 onDelete，等于 NO ACTION：**只要还有人挂着，角色就不能被删**。
     * 同 `member.organizationId` 对团体的处理——历史引用不能级联消失，也不能在
     * 删除时被静默置空。
     */
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => role.id),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);
