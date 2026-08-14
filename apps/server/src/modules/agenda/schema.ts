import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { activity } from "../project/schema";

// ---------------------------------------------------------------------------
// 领域词汇表
// ---------------------------------------------------------------------------

/**
 * 议程线类型。
 *
 * 这是整个模块唯一一处"必须偏离参考实现"的建模，值得写清楚为什么：
 *
 * 旧系统（../ruoyi-antdp 的 segmentFlowchartBuilder.ts）没有议程线这个对象，
 * 它在画图时拿环节名和类型跑正则 `/并行|parallel/i` 猜层级。BR-DEV-031 原文
 * 否掉了这个做法——"主线/并行线由环节配置中的议程线决定，不由系统仅按第一个
 * 环节、时间先后或时间重叠自动判断"。而且正则方案下，"并行进口通道验收"这种
 * 正常的环节名会被误判成并行线，不是理论风险。
 *
 * 原型（agenda-timeline.html 的环节弹窗）走的是另一个极端：把"线路名称""线路
 * 排序"当成**环节自己的字段**。那个模型下同一条线的两个环节各填一次线名和
 * 排序，填不一致时以谁为准无解；更要命的是 BR-DEV-031 的"一个活动一条主线"
 * 在那个模型里根本没法约束——只能查出来有几条，挡不住第二条。
 */
export const AGENDA_LINE_TYPES = ["main", "parallel"] as const;
export type AgendaLineType = (typeof AGENDA_LINE_TYPES)[number];

/** 环节类型。取值照抄原型 agenda-timeline.html 的环节弹窗，没有自己发明。 */
export const SEGMENT_TYPES = [
  "keynote",
  "forum",
  "negotiation",
  "reception",
  "other",
] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

/**
 * 环节状态：正常 / 作废。
 *
 * "作废"承担了这张表的删除语义（BR-DEV-021：已被引用的环节不物理删除）。
 * 所以 routes.ts 里**没有** deleteSegment——同时留删除和作废两个出口，只会
 * 让每个调用方自己纠结用哪个。
 *
 * 注意作废**不占用时间段**：重叠校验只看 active 行。反过来说，把一个作废
 * 环节改回 active 时必须重跑一次重叠校验，因为它让出的时段可能已经被别人
 * 占了。这条在 routes.ts 的 setSegmentStatus 里实现。
 */
export const SEGMENT_STATUSES = ["active", "voided"] as const;
export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];

/** 环节写入动作，落在修改记录里。 */
export const SEGMENT_REVISION_ACTIONS = ["create", "update", "status"] as const;
export type SegmentRevisionAction = (typeof SEGMENT_REVISION_ACTIONS)[number];

// ---------------------------------------------------------------------------
// 议程线
// ---------------------------------------------------------------------------

export const agendaLine = pgTable(
  "activity_agenda_line",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // onDelete 不设 cascade，理由同 activity.projectId：活动不做物理删除，
    // 真有人绕过应用层删了活动，宁可让外键约束报错，也不要静默删空整条议程。
    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activity.id),

    lineType: text("line_type").$type<AgendaLineType>().notNull(),

    // 主线可以不填名字（前端展示成"主线"），并行线必填——"某个枚举值下才必填"
    // 不是列约束能表达的东西，校验在 validation.ts。
    name: text("name"),

    // 展示层序，只对并行线有意义（主线恒为 0 且永远画在第一层）。放在线上
    // 而不是放在环节上，就是上面那段注释说的原型模型的问题。
    sortOrder: bigint("sort_order", { mode: "number" }).notNull().default(0),

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
    index("idx_agenda_line_activity").on(table.activityId),

    // BR-DEV-031 的"一版本不建设活动内多主任务流"落在数据库上，而不是靠每个
    // 接口自觉。partial unique index 只约束主线，并行线想建几条建几条。
    uniqueIndex("uk_agenda_line_main")
      .on(table.activityId)
      .where(sql`${table.lineType} = 'main'`),

    // 这条唯一键**不是给查询用的**，是给 activity_segment 的复合外键当靶子的
    // ——见那张表里 fk_segment_line_activity 的注释。(id) 已经是主键，再加
    // (id, activity_id) 唯一键在 Postgres 里近乎零成本。
    unique("uk_agenda_line_id_activity").on(table.id, table.activityId),
  ],
);

// ---------------------------------------------------------------------------
// 环节
// ---------------------------------------------------------------------------

export const activitySegment = pgTable(
  "activity_segment",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // 冗余列：activityId 本来可以从 agendaLine 推出来。冗余它是因为环节列表、
    // 统计、以及后续的环节人员/排位/资源汇总全都按活动查，每次都 join 一次线
    // 表只为拿一个 activity_id 不值得。
    //
    // 冗余的代价通常是"可能漂移"，但这里**不会**——见下面的复合外键，
    // 数据库直接保证了 segment.activity_id 恒等于它所在议程线的 activity_id。
    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activity.id),

    // 注意这一列**没有单独的 .references()**：它的外键是下面那条复合外键，
    // 单列外键会和复合外键重复约束同一件事。
    agendaLineId: bigint("agenda_line_id", { mode: "number" }).notNull(),

    name: text("name").notNull(),
    segmentType: text("segment_type").$type<SegmentType>().notNull(),

    // 没有单独的 date 列。文档 8.1 的环节字段里写了"日期、开始时间、结束时间"，
    // 但原型表单填的就是 `2026-09-18 09:50` 这样的完整时刻——日期是时间轴的
    // 分组维度，从 startTime 推得出来，单独存一列就多一个会跟 startTime 对不上
    // 的真相源。
    //
    // 时区：timestamptz 存 UTC，"按自然日分组"这件事由前端按**浏览器本地时区**
    // 完成。活动表没有场地时区字段，本期也不打算加（加了没人填），所以跨时区
    // 协作时不同人看到的分组可能差一天。国内单时区场景下不会踩到，这是已知
    // 边界，不是遗漏。
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),

    // BR-DEV-031A：普通环节地点先用文本录入即可，不要求先有场地空间配置。
    locationText: text("location_text"),
    description: text("description"),

    // 负责人本期是文本（原型就是个 input）。等活动人员关系表建成后可以换成
    // 外键，那时要配一支数据迁移——见 docs/agenda-module-plan.md 的待确认项。
    ownerName: text("owner_name"),

    status: text("status").$type<SegmentStatus>().notNull().default("active"),

    // 两个开关本期只是**声明**，没有下游功能接上（BR-DEV-031A：开启排位仅生成
    // "排位未配置"状态和入口，不要求先完成场地/排位配置）。它们是文档 8.1
    // 环节最小字段里列明的环节自身字段，不是对人员/排位模块的依赖。
    memberEnabled: boolean("member_enabled").notNull().default(false),
    seatingEnabled: boolean("seating_enabled").notNull().default(false),

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
    index("idx_segment_activity").on(table.activityId),
    index("idx_segment_line").on(table.agendaLineId),

    // 复合外键：把"环节和它的议程线必须属于同一个活动"从一条应用层约定，
    // 变成数据库保证。没有它的话，updateSegment 少写一行校验，就能把 A 活动的
    // 环节挂到 B 活动的议程线上，而且**查询层面看不出任何异常**——列表按
    // activity_id 查还是能查到它，只有画时间轴时才会发现它挂在一条陌生的线上。
    //
    // 这是用复合外键传播分区键的标准手法，代价只是线表上多一条含 id 的唯一键。
    foreignKey({
      columns: [table.agendaLineId, table.activityId],
      foreignColumns: [agendaLine.id, agendaLine.activityId],
      name: "fk_segment_line_activity",
    }),

    // 注意是 `<=` 而不是 activity 表那样的 `<`。放宽一格是有依据的：旧系统的
    // segmentFlowchartBuilder 里专门写了"零时长环节的 1 分钟占位"逻辑，说明
    // 现网真的存在开始=结束的瞬时环节（签到、剪彩）。重叠判断用半开区间
    // [start, end)，零时长环节因此不会和任何环节冲突，不需要额外分支。
    check("chk_segment_time_range", sql`${table.startTime} <= ${table.endTime}`),

    // 同 uk_agenda_line_id_activity：给 modules/member 的 segment_member 复合
    // 外键当靶子，保证那张表冗余的 activity_id 恒等于本环节的 activity_id。
    unique("uk_segment_id_activity").on(table.id, table.activityId),
  ],
);

// ---------------------------------------------------------------------------
// 环节修改记录
// ---------------------------------------------------------------------------

/** 落进 revision 的快照形状：环节的业务字段，不含审计列。 */
export type SegmentSnapshot = {
  activityId: number;
  agendaLineId: number;
  name: string;
  segmentType: SegmentType;
  startTime: string;
  endTime: string;
  locationText: string | null;
  description: string | null;
  ownerName: string | null;
  status: SegmentStatus;
  memberEnabled: boolean;
  seatingEnabled: boolean;
};

/**
 * C-016 的确认结论：编辑环节后本期记录修改人、修改时间和历史版本，页面先不
 * 体现，也不允许回滚。所以这张表**只写不读**，本期没有查询接口，也因此
 * 没有加任何索引（仓库规矩：索引不预先加，等真有查询再加）。
 *
 * 值得现在就建，理由和"审计列只留 id"是同一个逻辑：**事后加列容易，事后补
 * 历史不可能**。等页面要做版本对比时再建表，在那之前的所有修改就永久缺失了。
 *
 * 存全量快照而不是字段级 diff：环节一行也就十几个字段，快照的存储代价可以
 * 忽略，换来的是"查一条就拿到当时的完整状态"，不用回放。diff 可以事后从
 * 相邻两条快照算出来，反过来不行。
 *
 * segmentId 刻意不加外键——历史记录不该因为主表行的任何变动而受牵连。
 */
export const activitySegmentRevision = pgTable("activity_segment_revision", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  segmentId: bigint("segment_id", { mode: "number" }).notNull(),
  action: text("action").$type<SegmentRevisionAction>().notNull(),
  snapshot: jsonb("snapshot").$type<SegmentSnapshot>().notNull(),

  changedBy: text("changed_by").references(() => user.id, {
    onDelete: "set null",
  }),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
