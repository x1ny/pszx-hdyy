import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { activitySegment } from "../agenda/schema";
import { user } from "../auth/schema";
import { activityMember } from "../member/schema";
import { activity, project } from "../project/schema";

/** 附件原型里的四种交通方式；展示中文留给前端。 */
export const TRANSPORT_MODES = ["train", "flight", "drive", "other"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/**
 * 人员行程是参与人员自身的出行记录，不属于活动资源台账。
 *
 * projectId / activityId / memberId 看似能分别从活动和活动人员关系推出来，但这里
 * 刻意保留：项目级汇总、活动列表和人员详情都是确定存在的读取方向。下面的复合
 * 外键同时保证这些冗余列不会漂移。
 */
export const memberTrip = pgTable(
  "member_trip",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => project.id),
    activityId: bigint("activity_id", { mode: "number" }).notNull(),
    activityMemberId: bigint("activity_member_id", {
      mode: "number",
    }).notNull(),
    memberId: bigint("member_id", { mode: "number" }).notNull(),

    // 行程可以只关联活动；关联环节是运营侧的可选补充信息。
    segmentId: bigint("segment_id", { mode: "number" }),

    transportMode: text("transport_mode").$type<TransportMode>().notNull(),
    serviceNumber: text("service_number"),
    departureTime: timestamp("departure_time", {
      withTimezone: true,
    }).notNull(),
    arrivalTime: timestamp("arrival_time", { withTimezone: true }).notNull(),
    departureLocation: text("departure_location").notNull(),
    destination: text("destination").notNull(),

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
    // 两个真实查询方向：活动内管理、人员详情。项目级汇总后续可按实测再加索引。
    index("idx_member_trip_activity").on(table.activityId),
    index("idx_member_trip_member").on(table.memberId),

    foreignKey({
      columns: [table.activityId, table.projectId],
      foreignColumns: [activity.id, activity.projectId],
      name: "fk_member_trip_activity",
    }),
    foreignKey({
      columns: [table.activityMemberId, table.activityId, table.memberId],
      foreignColumns: [
        activityMember.id,
        activityMember.activityId,
        activityMember.memberId,
      ],
      name: "fk_member_trip_activity_member",
    }),
    foreignKey({
      columns: [table.segmentId, table.activityId],
      foreignColumns: [activitySegment.id, activitySegment.activityId],
      name: "fk_member_trip_segment",
    }),
    check(
      "chk_member_trip_time_range",
      sql`${table.departureTime} < ${table.arrivalTime}`,
    ),
  ],
);
