import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { activity } from "../project/schema";

// ---------------------------------------------------------------------------
// 领域词汇表
//
// 同 supplier：这些值是"列里能出现什么"，属于数据模型；validation.ts 拿它们拼
// zod，展示用的中文标签归前端。
// ---------------------------------------------------------------------------

export const VENUE_STATUSES = ["enabled", "disabled"] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];

/** 区域类型。取值照原型 venue-workbench.html 的区域编辑弹窗，没有自己发明。 */
export const ZONE_KINDS = [
  "seating",
  "function",
  "checkin",
  "material",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/**
 * 位置种类。**只有"能坐人的"两种**，理由见下面 venueSeat 的注释。
 *
 * 结论单 C-006 列的是"座位、桌位、站位"——"桌位"是桌子旁边的一个座位
 * （label 形如「3桌2号」），不是桌子本身，所以它落在 `seat` 上。
 */
export const SEAT_KINDS = ["seat", "standing"] as const;
export type SeatKind = (typeof SEAT_KINDS)[number];

/** 重要等级。结论单 C-006 的"重要等级"，旧系统混在 SeatStatus 里（见 §10）。 */
export const SEAT_RANKS = ["normal", "vip"] as const;
export type SeatRank = (typeof SEAT_RANKS)[number];

// ---------------------------------------------------------------------------
// 场地库主记录
// ---------------------------------------------------------------------------

/**
 * 跨项目、跨活动复用的场地。不属于任何活动，也不知道任何人员。
 *
 * 没有 `configStatus`（旧库的 draft/published）。加个发布态就要回答"草稿态能不能
 * 被活动引用""引用后改回草稿会怎样"，而文档口径里场地库只是基础数据——
 * `status` 一个够用。理由记在 docs/场地排位底层设计.md §3.2。
 */
export const venue = pgTable("venue", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  name: text("name").notNull(),

  /**
   * 地址是一个自由文本字段，不拆"城市 + 详细地址"。原型的筛选项写的是
   * "城市/地址"，同一个输入框既可能填"厦门"也可能填"思明区会展路"，
   * 拆成两列只会让录入的人纠结该填哪边，查询照样得两列都 ilike 一遍。
   */
  address: text("address"),

  description: text("description"),

  status: text("status").$type<VenueStatus>().notNull().default("enabled"),

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

// ---------------------------------------------------------------------------
// 画布 blob
// ---------------------------------------------------------------------------

/**
 * 场地画布。**服务端不解析这里面的任何东西。**
 *
 * 这是整个模块那条分界线的落点（docs/场地排位底层设计.md §1）：
 * 坐标、形状、填充色、布局预设、家具目录、底图——凡是"长什么样、在哪里"
 * 的信息全在 `data` 里，服务端只负责存和取。判据是**有没有别的东西引用它**：
 * 座位被分配引用，所以座位是关系行；座位的坐标没人引用，所以坐标是编辑器的私事。
 *
 * 单独一张表而不是 venue 上的一列：这是个可能上百 KB 的字段，而列表页
 * 一次要查 10 行且从来不用它。混在主表里，每次列表查询都要 TOAST 解压。
 *
 * `rendererKind` 决定前端用哪个渲染器打开它。**一经写入不再更换**——换编辑器
 * 只影响新建的场地，老场地保留老渲染器或走降级视图。这条让 externalId 可以
 * 一直保持编辑器私有，不需要一套编辑器无关的位置标识体系（§4）。
 */
export const venueLayout = pgTable("venue_layout", {
  venueId: bigint("venue_id", { mode: "number" })
    .primaryKey()
    .references(() => venue.id, { onDelete: "cascade" }),

  rendererKind: text("renderer_kind").notNull(),
  rendererVersion: integer("renderer_version").notNull(),

  /**
   * drizzle 给 jsonb 推的类型就是 `unknown`，这里刻意不加 `$type<>()`——
   * 类型层面就说明"服务端不知道这是什么"。前端用 zod 的 safeParse 解，
   * 解不出来走降级视图。
   */
  data: jsonb("data").notNull(),

  updatedBy: text("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ---------------------------------------------------------------------------
// 区域与位置：blob 的规范化投影
// ---------------------------------------------------------------------------

/**
 * 区域。由编辑器的 `project()` 从画布投影出来，不是用户在表单里一条条填的。
 *
 * `externalId` 是编辑器自己生成的稳定标识（旧系统形如 `el_xxx`），用途只有一个：
 * 下次保存画布时做增删改归并。它不承担长期语义，跨编辑器也不要求可比。
 */
export const venueZone = pgTable(
  "venue_zone",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    venueId: bigint("venue_id", { mode: "number" })
      .notNull()
      .references(() => venue.id, { onDelete: "cascade" }),

    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<ZoneKind>().notNull(),

    /** 画布里的展示顺序，投影时按编辑器的图层序给出。 */
    ordinal: integer("ordinal").notNull().default(0),
  },
  (table) => [
    unique("uk_venue_zone_external").on(table.venueId, table.externalId),

    // 给 venue_seat 的复合外键当靶子——保证一个位置的区域和它自己的场地是
    // 同一个，照 agenda 的 fk_segment_line_activity 那套。
    unique("uk_venue_zone_id_venue").on(table.id, table.venueId),

    // 没有单独的 idx_venue_zone_venue：上面那条 unique 的索引以 venue_id 打头，
    // "按场地查区域"直接走它，再建一个是重复索引。
  ],
);

/**
 * 位置。**只存能分配给人的位置**，桌台和陈设不进这张表。
 *
 * 这是把 §1 那条判据（有没有别的东西引用它）贯彻到底的结果：圆桌、长桌、舞台、
 * 讲台、绿植、屏风——没有任何东西会引用一张桌子，`seat_assignment` 也永远不会
 * 指向一个舞台。它们纯粹是"长什么样"，所以留在 blob 里，由渲染器画出来。
 *
 * 旧系统把 12 种家具全塞进同一个 `SeatItem[]`，再用 `seatWeight()` 在统计时把
 * 桌台的权重算成 0——等于用一个运行时函数维护"哪些是真座位"，而这件事完全可以
 * 靠"根本不入库"来表达。顺带说明旧模型的一处不自洽：它给沙发记 2 个座位的容量，
 * 但 `assigneeId` 只有一个，实际只能坐 1 人。这里一个位置就是一个位置，容量恒为 1，
 * 沙发要坐两人就投影成两个位置。
 *
 * 于是"可用点位数"就是 `count(*)`，不需要任何权重函数。
 */
export const venueSeat = pgTable(
  "venue_seat",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // 冗余，理由同 segment_member.activityId：给下面那条复合外键当桥。
    venueId: bigint("venue_id", { mode: "number" }).notNull(),

    zoneId: bigint("zone_id", { mode: "number" }).notNull(),

    externalId: text("external_id").notNull(),

    /** 座位编号，形如 `A1` / `3桌2号`。 */
    label: text("label").notNull(),

    kind: text("kind").$type<SeatKind>().notNull().default("seat"),
    rank: text("rank").$type<SeatRank>().notNull().default("normal"),

    /**
     * 位置顺序。结论单 C-006 的"位置顺序"，将来的批量顺序绑定按它排。
     * 具体怎么编（按行列、按序号、按桌号）是编辑器的事，投影出来只剩一个整数。
     */
    ordinal: integer("ordinal").notNull().default(0),
  },
  (table) => [
    /**
     * 归并键，按**场地**唯一而不是按区域。编辑器生成的元素 id 本来就是全局
     * 唯一的（旧系统形如 `el_<时间戳>_<随机>`），按场地建键换来一个实际好处：
     * 把一个位置从 A 区拖到 B 区，是同一行的 `zone_id` 变了（id 保持不变），
     * 而不是「删一个再建一个」。
     */
    unique("uk_venue_seat_external").on(table.venueId, table.externalId),

    /**
     * ⚠️ 故意**没有** unique(zone_id, label)。
     *
     * 同区域内编号不重复这条规则是要守的，但守在应用层（validation.ts 的
     * superRefine）而不是数据库：把 A1 和 A2 两个位置的编号对调是完全合法的
     * 操作，而 Postgres 的唯一约束默认逐语句检查，两条 UPDATE 里的第一条就会
     * 撞上。DEFERRABLE 能绕开，但 drizzle 没有稳定的表达方式。
     *
     * 之所以敢只靠应用层：`seat` 只有 saveLayout 一条写入路径，那条路径上
     * 100% 会过 superRefine。等出现第二条写入路径，这个判断要重新做。
     */

    /**
     * 复合外键：位置的区域必须属于位置自己的场地。少了它，A 场地的位置可以
     * 挂到 B 场地的区域上，而且**列表查询看不出任何异常**（按 venue_id 查还是
     * 查得到它）。cascade 是因为区域没了，它下面的位置也就不存在了。
     */
    foreignKey({
      columns: [table.zoneId, table.venueId],
      foreignColumns: [venueZone.id, venueZone.venueId],
      name: "fk_venue_seat_zone",
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// 活动场地空间
//
// 从场地库**整份拷贝**下来的一层，之后跟场地库再无关系。
// ---------------------------------------------------------------------------

/**
 * 活动区域的用途。取值照原型 activity-space.html 的编辑弹窗，一个不多一个不少。
 *
 * 这是活动层唯一真正**新增**的语义——场地库那边的 `ZoneKind`（座席区/功能区/
 * 签到区/物料区）说的是"这块地方是什么"，是场地的固有属性；`purpose` 说的是
 * "这场活动拿它干什么"，同一个主会场 A 区这场当主席台、下场当媒体区。
 * 两者不能合并，也不能互相推导（§2.1）。
 */
export const ZONE_PURPOSES = [
  "mainSeating",
  "breakout",
  "checkin",
  "standby",
] as const;
export type ZonePurpose = (typeof ZONE_PURPOSES)[number];

/** 导入时按场地区域类型给一个用途默认值，之后用户随时可改。 */
export const DEFAULT_PURPOSE_BY_KIND: Record<ZoneKind, ZonePurpose> = {
  seating: "mainSeating",
  function: "breakout",
  checkin: "checkin",
  material: "checkin",
};

export const ACTIVITY_VENUE_STATUSES = ["active", "disabled"] as const;
export type ActivityVenueStatus = (typeof ACTIVITY_VENUE_STATUSES)[number];

/**
 * 活动引用的场地。**是一份拷贝，不是一条关联。**
 *
 * `sourceVenueId` 只是出处标记：可空、`set null`、**不参与任何读取路径**。
 * 页面上显示的名称、地址、区域、几何，全部读这一层自己的列和自己的 blob。
 * 场地库那边改名、改区域、甚至整个删掉，这份拷贝一个字都不会变。
 *
 * 这条是刻意的（用户明确要求"选择现有场地时只做一份拷贝而不是关联"），也正是
 * §2.2 那句"快照，不是外键"：活引用意味着上游一改，下游已确认的排位就静默变形。
 * 代价是上游改动不会自动流下来——那需要一个显式的重新导入动作，二次确认后才覆盖。
 *
 * 一个活动可以引用多个场地（§4.2 第 4 条：跨馆很常见，做成一对一后面拆很贵），
 * 所以这里是活动下的一张列表，不是活动上的一列。
 */
export const activityVenue = pgTable(
  "activity_venue",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activity.id, { onDelete: "cascade" }),

    /**
     * 出处，可空。`set null` 而不是 `cascade`：场地库删了一个场地，不该把别人
     * 活动里已经排好位的空间一起带走——那正是"拷贝"要买的东西。
     */
    sourceVenueId: bigint("source_venue_id", { mode: "number" }).references(
      () => venue.id,
      { onDelete: "set null" },
    ),

    /** 下面两列都是导入那一刻的快照，不跟场地库同步。 */
    name: text("name").notNull(),
    address: text("address"),

    /** 本活动对这个场地的使用说明。拷贝下来之后才有的字段，场地库那边没有。 */
    note: text("note"),

    status: text("status")
      .$type<ActivityVenueStatus>()
      .notNull()
      .default("active"),

    ordinal: integer("ordinal").notNull().default(0),

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
    index("idx_activity_venue_activity").on(table.activityId),

    /**
     * 同一个场地不重复导入。**打在 sourceVenueId 上**，而 Postgres 的唯一约束
     * 不约束 NULL——所以场地库那边删了源场地（这一列变 null）之后，多份"来源
     * 已失效"的拷贝可以共存，正好是想要的行为。
     */
    unique("uk_activity_venue_source").on(
      table.activityId,
      table.sourceVenueId,
    ),

    // 给 activity_venue_zone 的复合外键当靶子。
    unique("uk_activity_venue_id_activity").on(table.id, table.activityId),
  ],
);

/**
 * 活动场地的画布 blob。**整份从 `venue_layout` 原样拷贝，服务端不解析一个字节。**
 *
 * 拷贝几何而不是重新画：活动空间页那张分布图（原型 activity-space.html 的
 * `space-map`）要显示区域的真实形状和相对位置，而排位方案建立时还要从这里取出
 * 某块区域的尺寸和它里面座位的坐标。两件事都需要几何，重画一遍没有道理。
 *
 * ⚠️ **活动层不落座位行**（§3.3）。座位的几何和编号确实在这个 blob 里躺着，
 * 但那是不透明字节；哪些座位本环节启用、谁坐哪，是环节方案的决定，活动层
 * 没有任何写入方。要从 blob 里取座位，由**前端的编辑器**解析并投影（它是唯一
 * 认识 blob 格式的东西），服务端始终不碰。
 */
export const activityVenueLayout = pgTable("activity_venue_layout", {
  activityVenueId: bigint("activity_venue_id", { mode: "number" })
    .primaryKey()
    .references(() => activityVenue.id, { onDelete: "cascade" }),

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
 * 活动区域。区域级快照 + 本活动才有的三个字段（用途、可用点位、启用状态）。
 *
 * `capacity`（可用点位）是一个**规划数字，不是权威的座位集合**（§3.3）。导入时
 * 按源区域的座位数填一个初值，之后运营可以改成任意数——"这场活动这块区域只开
 * 236 个位"。它**不作为确认排位时的硬约束**，超了只提示：具体哪些座位不用，是
 * 环节在 `segment_seat.enabled` 上表达的，不是活动层能知道的事。
 */
export const activityVenueZone = pgTable(
  "activity_venue_zone",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    activityVenueId: bigint("activity_venue_id", { mode: "number" }).notNull(),

    // 冗余，理由同 segment_member.activityId：给复合外键当桥，也让"本活动全部
    // 区域"这个最常用的查询不必 join 一次场地表。
    activityId: bigint("activity_id", { mode: "number" }).notNull(),

    /**
     * 出处标记，不参与读取，也故意不设外键。导入区域记源区域 id；在活动空间内
     * 新画的区域留空。源区域之后被删除不会改这一列，因此 `null` 不能解释成
     * “来源已删除”。
     */
    sourceZoneId: bigint("source_zone_id", { mode: "number" }),

    /**
     * 拷贝自源区域的编辑器标识。**它是这一行和 blob 里那个图形的唯一纽带**——
     * 活动空间页要按区域高亮、排位方案要取这块区域的几何，都靠它在 blob 里定位。
     */
    externalId: text("external_id").notNull(),

    name: text("name").notNull(),
    kind: text("kind").$type<ZoneKind>().notNull(),

    purpose: text("purpose").$type<ZonePurpose>().notNull(),

    capacity: integer("capacity").notNull().default(0),

    status: text("status")
      .$type<ActivityVenueStatus>()
      .notNull()
      .default("active"),

    note: text("note"),

    ordinal: integer("ordinal").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_activity_venue_zone_activity").on(table.activityId),

    unique("uk_activity_venue_zone_external").on(
      table.activityVenueId,
      table.externalId,
    ),

    /**
     * 给 segment_seating_plan 的复合外键当靶子——保证一个环节方案引用的区域
     * 和这个环节属于同一个活动。少了它，A 活动的环节能排到 B 活动的区域上，
     * 而且列表查询完全看不出异常。
     */
    unique("uk_activity_venue_zone_id_activity").on(table.id, table.activityId),

    // 区域的场地必须属于同一个活动。
    foreignKey({
      columns: [table.activityVenueId, table.activityId],
      foreignColumns: [activityVenue.id, activityVenue.activityId],
      name: "fk_activity_venue_zone_venue",
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// 归并用的投影类型
//
// 放在 schema.ts 而不是 validation.ts：它描述的是"表里能存什么"，
// validation.ts 再拿它拼 zod 入参。
// ---------------------------------------------------------------------------

/** 编辑器 `project()` 产出的区域。 */
export type ZoneDraft = {
  externalId: string;
  name: string;
  kind: ZoneKind;
  ordinal: number;
};

/** 编辑器 `project()` 产出的位置。`zoneExternalId` 指向同一批 ZoneDraft。 */
export type SeatDraft = {
  externalId: string;
  zoneExternalId: string;
  label: string;
  kind: SeatKind;
  rank: SeatRank;
  ordinal: number;
};
