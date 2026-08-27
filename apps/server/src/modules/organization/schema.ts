import { bigint, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";

/**
 * 团体主档。
 *
 * 代码里刻意使用 organization，而不是 group：member 关系表已经有 groupName，
 * 后者表示某一场活动/某一个环节内的临时分组。两种概念不共享表、不自动同步，
 * 详细取舍见 docs/architecture-decisions.md。
 */
export const organization = pgTable(
  "organization",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    name: text("name").notNull(),
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
  },
  (table) => [
    // 团体没有软删除状态；物理删除后名称才重新可用。
    unique("uk_organization_name").on(table.name),
  ],
);
