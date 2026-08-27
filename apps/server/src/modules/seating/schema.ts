import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { activitySegment } from "../agenda/schema";
import { user } from "../auth/schema";
import { segmentMember } from "../member/schema";
import { organization } from "../organization/schema";
import {
  activityVenueZone,
  type SeatKind,
  type SeatRank,
} from "../venue/schema";

/**
 * 环节排位。`/api/seating/*`。
 *
 * 依赖方向是**单向**的：这里只读 venue / member / agenda，那三个模块都不认识
 * 排位（底层设计 §2）。venue 加了对 seating 的依赖，场地库就再也不能独立使用了。
 *
 * 整个模块压在两条不变量上：
 *
 * 1. **布局和分配是两条正交的写路径**（§3.2）。`saveLayout` 改"有哪些位置"，
 *    `assign` 改"谁坐哪"，两条共享状态机但互不调用。旧系统把两条揉成一条
 *    `PUT .../operate` 提交整份 plan_json，后果是每拖动一个座位都在重写全部
 *    人员绑定。所以：**画布保存的请求体里没有人。**
 * 2. **引用位置用主键，不用编号也不用坐标**（§3.1）。旧系统靠遍历 JSON 比对
 *    label 反查座位，改一次编号历史就错位。
 */

/**
 * 方案状态。四个落库，另外两个（未开启排位 / 未配置）是**派生的展示态，不落库**
 * ——落成状态行会立刻产生"环节把排位开关关掉之后这行算什么"的垃圾状态。
 *
 * 没有草稿态（BR-DEV-010）：第一次 saveLayout 直接建 `pending` 的行。
 */
export const PLAN_STATUSES = [
  "pending",
  "confirmed",
  "rejected",
  "voided",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const SEATING_ACTIONS = [
  "saveLayout",
  "assign",
  "unassign",
  "swap",
  "confirm",
  "reject",
  "void",
] as const;
export type SeatingAction = (typeof SEATING_ACTIONS)[number];

/** 座位的占用对象：个人占座或团体占位。 */
export const SEAT_OCCUPANT_TYPES = ["person", "organization"] as const;
export type SeatOccupantType = (typeof SEAT_OCCUPANT_TYPES)[number];

// ---------------------------------------------------------------------------
// 方案
// ---------------------------------------------------------------------------

export const segmentSeatingPlan = pgTable(
  "segment_seating_plan",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    segmentId: bigint("segment_id", { mode: "number" }).notNull(),

    // 冗余，同 segment_member.activityId：既是"本活动全部方案"这个查询的
    // 主索引，也是下面两条复合外键共同锚定的那一列。
    activityId: bigint("activity_id", { mode: "number" }).notNull(),

    activityVenueZoneId: bigint("activity_venue_zone_id", {
      mode: "number",
    }).notNull(),

    status: text("status").$type<PlanStatus>().notNull().default("pending"),

    /**
     * 第几次**确认发布**，confirm 时 +1。
     *
     * 注意它不是"改了几次"：已确认的方案被重新编辑会打回 pending 但 version
     * 不变，直到再次 confirm 才递增。语义是"对外生效过几版"，H5 将来读的是
     * 这个数对应的那份确认快照。
     */
    version: integer("version").notNull().default(0),

    rejectedReason: text("rejected_reason"),

    savedBy: text("saved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    savedAt: timestamp("saved_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_seating_plan_activity").on(table.activityId),

    /**
     * 一个环节最多一个**当前有效**方案。作废的不算，所以是 partial——
     * 一个环节可以有一串历史作废方案 + 至多一个在用的。
     */
    uniqueIndex("uk_seating_plan_segment")
      .on(table.segmentId)
      .where(sql`${table.status} <> 'voided'`),

    // 给 segment_seat / seat_assignment 的复合外键当靶子。
    unique("uk_seating_plan_id_segment").on(table.id, table.segmentId),

    /**
     * 下面两条复合外键**同锚在 `activityId` 上**，于是"A 活动的环节 + B 活动的
     * 场地区域"这种越界组合在数据库层面就不成立，不依赖 handler 记得校验。
     * 做法照抄 agenda/schema.ts 的 fk_segment_line_activity。
     */
    foreignKey({
      columns: [table.segmentId, table.activityId],
      foreignColumns: [activitySegment.id, activitySegment.activityId],
      name: "fk_seating_plan_segment",
    }),
    foreignKey({
      columns: [table.activityVenueZoneId, table.activityId],
      foreignColumns: [activityVenueZone.id, activityVenueZone.activityId],
      name: "fk_seating_plan_zone",
    }),
  ],
);

/**
 * 方案画布 blob。跟 `venue_layout` 同构、同理由：大字段单独一张表，列表页不查，
 * 服务端一个字节都不解析。
 *
 * 这张表存在的前提是"排位方案里的座位可以继续编辑"——从活动区域复制一份座位
 * 之后，还能在方案里拖动、增删、重新导入模板。这条是跟用户确认过的。
 */
export const segmentSeatingLayout = pgTable("segment_seating_layout", {
  planId: bigint("plan_id", { mode: "number" })
    .primaryKey()
    .references(() => segmentSeatingPlan.id, { onDelete: "cascade" }),

  rendererKind: text("renderer_kind").notNull(),
  rendererVersion: integer("renderer_version").notNull(),
  data: jsonb("data").notNull(),

  updatedBy: text("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/**
 * 方案里的位置。从活动区域复制而来，之后**独立演化**。
 *
 * 复制而不是活引用，白拿两个性质（§3.3）：同一区域被多个环节引用时各自一套，
 * 天然互不覆盖；上游底图随便改，改不坏任何已确认的排位。
 */
export const segmentSeat = pgTable(
  "segment_seat",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    planId: bigint("plan_id", { mode: "number" })
      .notNull()
      .references(() => segmentSeatingPlan.id, { onDelete: "cascade" }),

    externalId: text("external_id").notNull(),

    /**
     * 复制来源的编辑器标识。**文本快照，不是外键**——上游底图的位置是物理删除
     * 的（§5），存外键会悬空。它只用于"从场地重新同步"时对齐，没有别的读者。
     */
    sourceExternalId: text("source_external_id"),

    label: text("label").notNull(),
    kind: text("kind").$type<SeatKind>().notNull().default("seat"),
    rank: text("rank").$type<SeatRank>().notNull().default("normal"),

    /**
     * 本环节启不启用这个位置。**这一列只在方案层有，场地库那边没有**——
     * 哪些座位这次不用是环节的决定（C-006），不是场地的属性。
     */
    enabled: boolean("enabled").notNull().default(true),

    ordinal: integer("ordinal").notNull().default(0),

    /**
     * 软删。这里**不能**像场地库那样物理删除：这些行被 `seat_assignment` 引用。
     * 真要删一个有分配的位置，saveLayout 会整次被拒并返回 blocked 清单（§5）。
     */
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    unique("uk_segment_seat_external").on(table.planId, table.externalId),

    // 给 seat_assignment 的复合外键当靶子：分配指向的座位必须属于同一个方案。
    unique("uk_segment_seat_id_plan").on(table.id, table.planId),

    /**
     * 同方案内编号不重复。这里**敢**建数据库约束（场地库那边不敢，见
     * venue_seat 的注释），因为它是 partial index：软删的行不参与，而编号对调
     * 那种逐语句冲突……依然存在。所以应用层仍要先校验，这条只是最后一道网。
     */
    uniqueIndex("uk_segment_seat_label")
      .on(table.planId, table.label)
      .where(sql`${table.removedAt} is null`),
  ],
);

/**
 * 座位分配。每条有效行只指向一个占用对象：个人或团体。
 *
 * 个人指向 `segment_member.id`，而非活动人员：否则非本环节的人也能被排进来，
 * 环节人员层会在数据上被完全旁路。团体则指向 organization 主档，并由写路径
 * 校验它真实出现在方案环节的 `segment_member.organizationId` 范围快照中。
 *
 * 行上**不存 label 快照**（§3.1）：分配发生在确认之前，分配时抄下来的编号到
 * 确认时可能已经改过。"发通知那一刻座位叫什么"由 confirm 的日志快照负责。
 */
export const seatAssignment = pgTable(
  "seat_assignment",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    planId: bigint("plan_id", { mode: "number" }).notNull(),

    // 冗余，给下面第二条复合外键当桥——它把方案和人员锚在同一个环节上。
    segmentId: bigint("segment_id", { mode: "number" }).notNull(),

    segmentSeatId: bigint("segment_seat_id", { mode: "number" }).notNull(),
    occupantType: text("occupant_type")
      .$type<SeatOccupantType>()
      .notNull()
      .default("person"),

    /** 个人占座时必填；由下面 CHECK 与同环节复合外键共同守住。 */
    segmentMemberId: bigint("segment_member_id", { mode: "number" }),

    /** 团体占位时必填；范围关系由 routes.ts 按环节快照校验。 */
    organizationId: bigint("organization_id", { mode: "number" }).references(
      () => organization.id,
      { onDelete: "no action" },
    ),

    assignedBy: text("assigned_by").references(() => user.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    /** 解绑是软的：留一条"这个人本来坐这"的历史，也让唯一索引能放行下一个人。 */
    revokedBy: text("revoked_by").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    /** 一座一人。 */
    uniqueIndex("uk_seat_assignment_seat")
      .on(table.segmentSeatId)
      .where(sql`${table.revokedAt} is null`),

    /**
     * 一人一座（同一方案内）。组织行的 segment_member_id 为 NULL；虽然
     * PostgreSQL 的 UNIQUE 本来也允许多个 NULL，仍把条件写出来，明确约束的
     * 是个人而不是团体。
     */
    uniqueIndex("uk_seat_assignment_member")
      .on(table.planId, table.segmentMemberId)
      .where(
        sql`${table.revokedAt} is null and ${table.segmentMemberId} is not null`,
      ),

    /**
     * 有效目标恰好一个，且必须与 occupant_type 匹配。CHECK 落在库层而非只靠
     * handler，导入脚本或未来新接口也不能写出“既是个人又是团体”的脏行。
     */
    check(
      "chk_seat_assignment_occupant",
      sql`(
        (${table.occupantType} = 'person'
          and ${table.segmentMemberId} is not null
          and ${table.organizationId} is null)
        or
        (${table.occupantType} = 'organization'
          and ${table.segmentMemberId} is null
          and ${table.organizationId} is not null)
      )`,
    ),

    // 座位必须属于这个方案。
    foreignKey({
      columns: [table.segmentSeatId, table.planId],
      foreignColumns: [segmentSeat.id, segmentSeat.planId],
      name: "fk_seat_assignment_seat",
    }),
    // 方案必须属于这个环节。
    foreignKey({
      columns: [table.planId, table.segmentId],
      foreignColumns: [segmentSeatingPlan.id, segmentSeatingPlan.segmentId],
      name: "fk_seat_assignment_plan",
    }),
    /**
     * 个人必须是这个环节的人。segment_member_id 为 null 的团体行按 PostgreSQL
     * MATCH SIMPLE 跳过这条复合外键；那条路径由 organizationId 外键 + routes.ts
     * 的环节团体快照查询守住。
     */
    foreignKey({
      columns: [table.segmentMemberId, table.segmentId],
      foreignColumns: [segmentMember.id, segmentMember.segmentId],
      name: "fk_seat_assignment_member",
    }),
  ],
);

/**
 * 操作留痕。一张表够了。
 *
 * 旧系统把它塞进 `plan_json.operations[]`（滚动保留 500 条），于是每次读日志都
 * 要反序列化整份画布，也没法按人员或时间检索（模块梳理 §5.5）。
 *
 * `confirm` 那条的 payload 装**完整快照**（位置 + 分配 + 当时的 label）：座位通知
 * 名单和历史编号都从这份快照读，不依赖当前的分配行——因为确认之后分配还会变。
 */
export const segmentSeatingLog = pgTable(
  "segment_seating_log",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    planId: bigint("plan_id", { mode: "number" })
      .notNull()
      .references(() => segmentSeatingPlan.id, { onDelete: "cascade" }),

    action: text("action").$type<SeatingAction>().notNull(),
    payload: jsonb("payload"),

    operatorId: text("operator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_seating_log_plan").on(table.planId)],
);
