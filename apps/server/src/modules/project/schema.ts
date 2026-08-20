import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { fileAsset } from "../file/schema";

// ---------------------------------------------------------------------------
// 领域词汇表
//
// 项目和活动共用同一套"发布状态"取值——业务口径上两者的发布生命周期完全
// 一致（未发布/已上架/已下架），没有理由维护两份同名不同值的枚举。
//
// 这里**没有"业务状态"（未开始/进行中/已结束）这回事**，项目和活动都没有。
// 早先按 8.1 核心对象那张表的字面描述给两者都加过这个概念，后来对照
// docs/20260811交接/prototype 的实际界面（活动列表表头是"活动/所属项目/
// 地点/时间/预算/媒体/发布状态/配置项/操作"，没有业务状态列；mock-data.js
// 虽然给 activity 记录塞了一个 business 字段，但从没有任何页面渲染它）
// 才确认这是文档层面的过度设计，原型才是真正经过界面设计推敲的产物，
// 优先级更高。已经踩过一次坑：先按文档加了列，再删列、再删前端算出来的
// 展示逻辑——教训是拿不准的字段先看原型有没有渲染，而不是看文档列没列。
/**
 * 发布状态：面向 H5 的展示总闸，由业务人员显式操作（"上架"/"下架"按钮），
 * 不是任何时间或其他状态推导出来的。
 *
 * "已下架"承担了已被使用项目或活动的删除语义：数据留痕，且不会让
 * activity.projectId、后续排位/资源/邀请函等大量下游外键变成悬空引用。
 * 物理删除只对没有下游关联数据的项目或活动开放，且不做业务数据级联删除。
 */
export const PUBLISH_STATUSES = ["draft", "published", "delisted"] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

/**
 * 活动类型。项目没有这个维度——"自主策划/配套活动"描述的是活动相对于
 * 所属项目的关系，项目本身无所谓类型。
 */
export const ACTIVITY_TYPES = ["standalone", "affiliated"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_MEDIA_TYPES = ["image", "video"] as const;
export type ActivityMediaType = (typeof ACTIVITY_MEDIA_TYPES)[number];

export const project = pgTable("project", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  name: text("name").notNull(),
  location: text("location"),

  // 数据库列暂保留可空以兼容历史项目；新增和编辑项目由 validation.ts
  // 要求填写完整的时间范围。
  startTime: timestamp("start_time", { withTimezone: true }),
  endTime: timestamp("end_time", { withTimezone: true }),

  totalBudget: numeric("total_budget", { precision: 14, scale: 2 }),

  // 主办/承办/支持/指导单位：本期均为纯文本，不接字典或组织库维护
  // （见 docs/20260811交接 的开发默认口径）。四个概念在活动行业里含义
  // 不同，各自独立填写，不是同一个字段拆出来的近义词。
  hostOrg: text("host_org"),
  organizerOrg: text("organizer_org"),
  supportOrg: text("support_org"),
  guidingOrg: text("guiding_org"),

  // 纯文本简介，暂不接富文本。项目简介会直接渲染在免登录的公众 H5 页面，
  // 而邀请函模板那套富文本方案（rich-text-editor + dangerouslySetInnerHTML）
  // 目前落在后台内部预览场景，把同样的机制搬到公众页面之前，必须先补一层
  // 服务端消毒（如 DOMPurify），否则是一个可以被任何有编辑权限的运营人员
  // 触发的存储型 XSS。本期没有这个消毒链路，先用纯文本；真要富排版，应该
  // 作为独立的安全评审项，而不是顺手把组件搬过来。
  description: text("description"),

  publishStatus: text("publish_status")
    .$type<PublishStatus>()
    .notNull()
    .default("draft"),

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

export const activity = pgTable(
  "activity",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // 活动必须归属项目，且这是活动唯一的访问路径——活动没有独立一级菜单，
    // 永远从项目详情进入活动列表（WHERE project_id = ? 是它从第一天起
    // 唯一会被用到的过滤条件）。这不属于"不确定用不用得上，等实测"的
    // 默认不加索引原则，这里是确定用得上。
    //
    // onDelete 特意不设 cascade：物理删除项目只允许没有关联数据的项目，
    // 已被引用的项目由外键阻止，避免误删活动及其下游数据。
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => project.id),

    activityType: text("activity_type").$type<ActivityType>().notNull(),

    name: text("name").notNull(),
    location: text("location"),

    // 必填：环节/议程、H5 展示条件都要挂在真实时刻上。允许为空只会把
    // NULL 检查散播到一堆下游查询。
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),

    totalBudget: numeric("total_budget", { precision: 14, scale: 2 }),

    hostOrg: text("host_org"),
    organizerOrg: text("organizer_org"),
    supportOrg: text("support_org"),
    guidingOrg: text("guiding_org"),
    description: text("description"), // 理由同 project.description

    // 发布状态、展示开关、报名开关是三个独立的闸门，故意不合并成一个。
    // "已上架但临时不在 H5 展示"（内容还要再核一遍）和"直接下架"是两种
    // 不同的运营动作，合并成一个字段就没法表达前者；报名开关同理独立于
    // 展示开关——运营人员可能想让活动可见但暂停接收新报名。
    publishStatus: text("publish_status")
      .$type<PublishStatus>()
      .notNull()
      .default("draft"),
    displayEnabled: boolean("display_enabled").notNull().default(false),
    registrationEnabled: boolean("registration_enabled")
      .notNull()
      .default(false),

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
    index("idx_activity_project").on(table.projectId),
    // 数据完整性约束，不是性能索引，两者"要不要预先加"的判断标准不一样：
    // 索引的成本是写放大和维护负担，效果依赖真实查询模式，值得等实测再加；
    // 这条 check 近乎零成本，且挡住的是任何写入路径（未来的批量导入脚本、
    // 手工 SQL、忘记校验的新接口）都可能产生的脏数据，没有理由拖到出现
    // 脏数据之后再补。
    check(
      "chk_activity_time_range",
      sql`${table.startTime} < ${table.endTime}`,
    ),

    // 不是给查询用的，是给 modules/member 的 activity_member 复合外键当靶子
    // ——那张表冗余存了 project_id，靠这条唯一键保证它恒等于本活动的
    // project_id。(id) 已是主键，再加 (id, project_id) 近乎零成本。
    // 同 activity_agenda_line 的 uk_agenda_line_id_activity。
    unique("uk_activity_id_project").on(table.id, table.projectId),
  ],
);

// 活动图片/视频画廊。没有直接在 activity 表上加一个 mediaUrls 数组字段，
// 是因为这本质是一对多关系、且需要排序——数组字段既没法约束每个元素
// 指向真实存在的 file_asset，也没法优雅表达"删除第 3 张图""把第 5 张
// 挪到第 1 张"这类需求。file 模块已经有独立的 file_asset 生命周期，这张
// 表只做关联和排序，不重复存储文件元信息。
export const activityMedia = pgTable(
  "activity_media",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // cascade：媒体记录离开所属活动没有独立存在的意义。这和上面
    // activity.projectId 故意不设 cascade 是同一个判断标准的两面——
    // 关键看"级联删除会不会带走一整棵有独立价值的子树"，画廊图片不是。
    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activity.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => fileAsset.id, { onDelete: "cascade" }),

    mediaType: text("media_type").$type<ActivityMediaType>().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),

    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // 没有 updatedAt/updatedBy：这张表唯一会变的字段是 sortOrder（拖拽
    // 重排），不是需要审计追踪的业务编辑动作，改了即生效。
  },
  (table) => [
    // 同一个文件不该在同一个活动的画廊里出现两次；这条唯一索引的左前缀
    // (activityId) 顺带覆盖了"查某活动的所有媒体"，不用再单独建索引。
    uniqueIndex("uk_activity_media").on(table.activityId, table.fileId),
  ],
);
