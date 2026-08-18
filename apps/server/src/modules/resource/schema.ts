import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { activitySegment } from "../agenda/schema";
import { user } from "../auth/schema";
import { activityMember } from "../member/schema";
import { activity } from "../project/schema";

// ---------------------------------------------------------------------------
// 领域词汇表
// ---------------------------------------------------------------------------

/**
 * 资源类型。
 *
 * **只有四类，没有场地和排位**，这是刻意的，不是漏了。
 *
 * 文档 §7.1 把"场地/空间"和"排位"也列进了环节可勾选的资源需求项，但它们的
 * 落实入口根本不在资源台账里（BR-DEV-033C：场地跳活动场地/空间配置，排位跳
 * 环节排位方案）。更要命的是，那两类的真值各自只有一份——一个活动一份场地
 * 空间配置，一个环节一份排位方案——需求项再存一遍"我引用了它"纯属冗余，
 * 且必然漂移：排位方案作废了，需求项还停在"已配置"。
 *
 * 所以这两类将来要做，也应该做成**只读的派生视图**（场地读活动场地配置的
 * 存在性，排位读 activity_segment.seatingEnabled + 排位方案状态），而不是在
 * 这张表里落可写的行。本期两个模块都不建，视图也一并省了。
 *
 * 也没有"供应商服务"和"其他"。原型 agenda-timeline.html 的资源分类下拉里
 * 有这两项，但 BR-DEV-033A 写死了"供应商不作为活动资源类型"——本期供应商只
 * 做主体和历史报价留档，把它放回资源台账等于给砍掉的采购比价开侧门。
 */
export const RESOURCE_TYPES = [
  "transport",
  "dining",
  "accommodation",
  "material",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * 资源类型的中文名。
 *
 * 服务端一般不管展示（那是 web 的 labels.ts 的活），这里留一份是因为**校验
 * 失败的 message 会被前端直接丢进 toast**——"资源类型与所选需求不一致：该需求
 * 要的是 transport"没法看。`satisfies` 保证加类型时不补中文就编译不过。
 */
export const RESOURCE_TYPE_LABELS = {
  transport: "用车",
  dining: "用餐",
  accommodation: "住宿",
  material: "物料",
} as const satisfies Record<ResourceType, string>;

/**
 * 人员服务型资源：需要绑定到具体的人，绑定后（将来）在 H5 展示本人服务安排。
 * 物料是活动通用型，默认不绑人（BR-DEV-033A）。
 *
 * 这个划分不只是展示口径，它直接决定派生状态里"配置中"这一档存不存在——
 * 见 routes.ts 的 demandStatusSql。
 */
export const PERSONAL_SERVICE_TYPES = [
  "transport",
  "dining",
  "accommodation",
] as const satisfies readonly ResourceType[];

/**
 * 处理要求。C-016 确认的两档，是整个模型里最容易被简化掉、但简化了就会
 * 逼业务造假数据的一个字段。
 *
 * 真实场景里大量环节的资源需求只需要留一句说明（"这个环节要准备桌牌手卡"），
 * 执行完全在线下，系统既追踪不到也不需要追踪。如果强制每条需求都必须关联
 * 一条台账记录才算"配好"，业务只会随便建一条空记录把状态刷绿。
 *
 * 所以只有 `arrange` 进待办和完整性检查，`record_only` 只统计不催办。
 */
export const DEMAND_HANDLINGS = ["record_only", "arrange"] as const;
export type DemandHandling = (typeof DEMAND_HANDLINGS)[number];

/**
 * 用车场景。到达接送、离开送站不是独立的资源对象，是用车记录的一个场景字段
 * （BR-DEV-037A 明确"不单独建立接送用车对象"）。
 */
export const TRANSPORT_SCENES = ["activity", "pickup", "dropoff"] as const;
export type TransportScene = (typeof TRANSPORT_SCENES)[number];

/**
 * 资源记录状态：正常 / 作废。
 *
 * 同 activity_segment.status，"作废"承担删除语义——资源记录会被需求项关联、
 * 被人员绑定引用，物理删除会留下悬空引用（crud-page-guide 里"别的表开始外键
 * 引用这张表时才补软删"说的正是这种情况）。
 *
 * 作废的资源**不计入需求项的配置状态**：一条需求关联的两辆车全作废了，它就
 * 该退回"待配置"，而不是停在"已配置"。这是"状态派生"最直接的一个好处——
 * 不需要在作废接口里回写任何东西。
 */
export const RESOURCE_STATUSES = ["active", "voided"] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

// ---------------------------------------------------------------------------
// 派生词汇：需求项配置状态
// ---------------------------------------------------------------------------

/**
 * 需求项的配置状态。**没有对应的列**，每次查询现算——这是本模块的核心取舍，
 * 见 segmentResourceDemand 的注释。
 *
 * 对齐文档 §8.2 的四态，只把"未开启"换成了"仅记录"：矩阵模型下"未开启"就是
 * 这张表里没有这一行，查出来的每一行按定义都是已开启的，留一个查不出来的
 * 状态值只会误导读代码的人。
 */
export const DEMAND_STATUSES = [
  "recorded",
  "pending",
  "configuring",
  "configured",
] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

const PERSONAL_SERVICE_TYPE_SET = new Set<ResourceType>(
  PERSONAL_SERVICE_TYPES,
);

/**
 * 配置状态的**唯一判定处**。
 *
 * 输入只有三个：处理要求、资源类型、以及两个从关联关系上数出来的计数。
 * 不读任何存储的状态列，所以资源作废、解除关联、人员解绑之后不需要任何人
 * 去回写——下次查出来自然就变了。文档只写了正向回写、反向一个字没提，
 * 那个洞在这里从根上不存在。
 *
 * 判定规则：
 * - `record_only` → 仅记录。不进待办，也不算缺失（C-016：只保留说明即可，
 *   不要求补具体安排）。
 * - `arrange` 且没有任何**正常**的关联资源 → 待配置。这是完整性检查真正
 *   要催的那一档。
 * - `arrange`、有关联资源、但属于人员服务型且一个人都没绑 → 配置中。
 *   车订了、名单还没定，对应文档 §8.2 的"已有安排但人员绑定未齐"。
 * - 其余 → 已配置。物料不绑人（BR-DEV-033A），所以关联上就直接是已配置，
 *   永远不会落到"配置中"——同一个状态机套在语义不同的资源类型上，物料那
 *   半边本来就该是死态，这是有意的，不是漏判。
 *
 * ⚠️ "绑了人就算已配置"是一个**故意放宽**的口径。文档 §8.2 还提到"关键字段
 * 未齐"也算配置中，但从没定义过哪些是关键字段（结论单 T-012 至今挂着待确认）。
 * 旧系统在这里给了反面教材：ruoyi-antdp 的 segmentResourceConfig.ts 判定
 * `count > 0 || remark 非空` 就算配好，等于填个备注就把完整性检查刷绿了。
 * 与其自己发明一套没人确认过的必填集合，不如先只认"有安排 + 有名单"这个
 * 客观事实，等业务给出关键字段清单再收紧——收紧只需要改这一个函数。
 */
export const deriveDemandStatus = (input: {
  handling: DemandHandling;
  resourceType: ResourceType;
  activeResourceCount: number;
  boundMemberCount: number;
}): DemandStatus => {
  if (input.handling === "record_only") return "recorded";
  if (input.activeResourceCount === 0) return "pending";
  if (
    PERSONAL_SERVICE_TYPE_SET.has(input.resourceType) &&
    input.boundMemberCount === 0
  ) {
    return "configuring";
  }
  return "configured";
};

// ---------------------------------------------------------------------------
// 环节资源需求项（声明层）
// ---------------------------------------------------------------------------

/**
 * 环节对某类资源的需求声明。**矩阵模型**：一个环节每种资源类型最多一条。
 *
 * 这是本模块唯一一处在文档和原型之间必须选边的建模，理由写清楚：
 *
 * 原型（resource-summary.html 的提示原文"一条需求是一条记录，来源环节只是
 * 该需求的归属字段"、agenda-timeline.html 的新增需求弹窗有需求编号/名称/
 * 范围对象）走的是**自由记录模型**：一个环节可以有多条同类型需求。
 *
 * 结论单 C-016 和开发文档 §8.1/§8.2 走的是**矩阵模型**：字段是"是否开启/
 * 处理要求/落实方式"，状态是"未开启/待配置/配置中/已配置"——"未开启"这个
 * 状态只在矩阵下讲得通，自由记录模型里"没有这条记录"和"不需要这类资源"
 * 根本无法区分，完整性检查也就无从谈起。已按矩阵定稿。
 *
 * 代价要认：同一环节"给嘉宾派车"和"给媒体派车"两笔需求装不下，只能合成一条
 * 用 description 描述。真出现这种诉求时，正确的扩展方向是在本表下面挂一张
 * 明细子表（沿用 activity_resource 那套复合外键），而不是把 UNIQUE 拆掉——
 * 拆掉之后完整性检查会跟着一起塌。
 *
 * ⚠️ 这张表**没有 `enabled` 列**。行存在即已开启，关闭需求项就是删行。
 * 文档 §8.1 的字段清单里有"是否开启"，但留着它就意味着"未开启"有两种表示
 * （无行 / 有行但 enabled=false），每个查询都要记得同时处理两种，迟早漏一处。
 *
 * ⚠️ 也**没有 `配置状态`、`落实方式`、`关联对象类型/ID` 这几列**。
 * - 配置状态是派生量，由关联的资源记录和绑定人数算出来（见 routes.ts）。
 *   落成一列就必须有人在资源作废、解除关联、人员解绑时去回写它，而文档只
 *   写了正向回写、反向一个字没提——那正是这类字段长歪的标准路径。
 * - "落实方式"（新建安排/关联已有安排）存的是**当时点了哪个按钮**，不是数据
 *   的状态：一条需求先新建了一辆车、后来又关联一辆已有的车，这个字段无解。
 *   真正需要持久化的只有"关联到了哪些资源"，那是 resource_demand_link。
 * - 关联对象是多对多的（文档正文和原型 REQ-001 都有一条需求关联 2 条记录），
 *   单值外键装不下。
 */
export const segmentResourceDemand = pgTable(
  "segment_resource_demand",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // 冗余列，同 activity_segment.activityId：需求汇总页按活动查全量，
    // 每次 join 一次环节表只为拿 activity_id 不值得。下面的复合外键保证
    // 它恒等于该环节的 activity_id，不会漂移。
    activityId: bigint("activity_id", { mode: "number" }).notNull(),

    // 没有单列 .references()，外键是下面的复合外键。
    segmentId: bigint("segment_id", { mode: "number" }).notNull(),

    resourceType: text("resource_type").$type<ResourceType>().notNull(),
    handling: text("handling").$type<DemandHandling>().notNull(),

    /**
     * 需求说明。矩阵模型下它同时承担了原型里"需求名称 + 范围/对象"的表达。
     *
     * 没有单独的 `remark` 列——原型的需求弹窗里"需求说明"和"备注"两个多行
     * 文本框并排放着，但矩阵模型下一个环节一种资源只有一行，两个自由文本
     * 字段没人分得清该往哪个填，最后必然一个空着。
     */
    description: text("description"),

    /** 预计数量/规模。非必填——声明阶段经常还不知道具体数。 */
    estimatedCount: integer("estimated_count"),

    // 同 activity_segment.ownerName，本期是文本，原型就是个 input。
    ownerName: text("owner_name"),

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
    // ⭐ 矩阵模型落在数据库上，不靠接口自觉。
    unique("uk_demand_segment_type").on(table.segmentId, table.resourceType),

    index("idx_demand_activity").on(table.activityId),

    // 环节必须存在，且本行冗余的 activity_id 必须等于该环节的 activity_id。
    // 靶子是 activity_segment 的 uk_segment_id_activity。
    foreignKey({
      columns: [table.segmentId, table.activityId],
      foreignColumns: [activitySegment.id, activitySegment.activityId],
      name: "fk_demand_segment_activity",
    }),

    // 给 resource_demand_link 的复合外键当靶子——保证一条关联的需求项和
    // 资源记录属于同一个活动。
    unique("uk_demand_id_activity").on(table.id, table.activityId),
  ],
);

// ---------------------------------------------------------------------------
// 活动级资源台账（记录层）
// ---------------------------------------------------------------------------

/**
 * 资源主记录。**挂在活动上，不挂环节**——这是整套设计相对旧系统最核心的一处
 * 纠正，值得写下原因。
 *
 * 旧系统（fashion_actions_management）把用车/用餐/住宿各建了一张环节级表
 * （FASHION_SEGMENT_TRANSPORT / _DINING / _ACCOMMODATION，都只有 segment_id
 * + estimated_count + remark），等于声明和记录合并在一张表、且都在环节层。
 * 后果是：一辆机场接送车服务的是"下午到达的 8 位嘉宾"，跟他们参加哪个环节
 * 无关；按环节存就得给每个相关环节各登记一遍同一辆车，汇总时数量翻倍，而且
 * 没有任何地方能回答"这场活动一共派了几辆车"。
 *
 * 旧系统里唯一做对的是物料——FASHION_ACTIVITY_MATERIAL（活动级主档）+
 * FASHION_SEGMENT_MATERIAL_REL（环节引用）。本表就是把那个两层结构推广到
 * 全部四类资源。
 */
export const activityResource = pgTable(
  "activity_resource",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // 这里可以用单列外键：本表不需要从别处传播分区键进来，activityId 就是
    // 它自己的一手信息，没有"必须和另一列对上"的约束要表达。
    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activity.id),

    resourceType: text("resource_type").$type<ResourceType>().notNull(),

    /** 仅 resourceType='transport' 时有值，见下面的 CHECK。 */
    transportScene: text("transport_scene").$type<TransportScene>(),

    name: text("name").notNull(),

    /** 数量/规模：几辆车、几人餐、几间房、几件物料。 */
    quantity: integer("quantity"),

    /**
     * 使用时间。两列而不是一列，因为住宿天然是区间（11-17 至 11-20），
     * 用车用餐是时刻（只填 startTime），物料可能只有一个日期。
     * 一列装不下区间，塞进 remark 就没法按时间筛选和排序了。
     */
    startTime: timestamp("start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),

    location: text("location"),

    // 用车专属，且都非必填（C-006 明确"车辆和司机信息可选记录"）。
    vehicleInfo: text("vehicle_info"),
    driverName: text("driver_name"),
    driverPhone: text("driver_phone"),

    ownerName: text("owner_name"),
    remark: text("remark"),

    status: text("status").$type<ResourceStatus>().notNull().default("active"),

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
    index("idx_resource_activity").on(table.activityId),

    /**
     * 用车专属的四列在非用车记录上必须为空。
     *
     * 一条 CHECK 管四列，不是洁癖：前端表单按类型显隐字段，用户"先填了车牌
     * 再把类型改成物料"是最普通不过的操作序列，没有这条约束就会存下一条
     * 带车牌的物料记录，然后在某个按车辆筛选的列表里冒出来。
     */
    check(
      "chk_resource_transport_only",
      sql`${table.resourceType} = 'transport' OR (${table.transportScene} IS NULL AND ${table.vehicleInfo} IS NULL AND ${table.driverName} IS NULL AND ${table.driverPhone} IS NULL)`,
    ),

    // 两列都可空。NULL 参与比较的结果是 NULL，CHECK 遇到 NULL 判定为通过，
    // 显式写出来是为了读的人不用去回忆三值逻辑。
    check(
      "chk_resource_time_range",
      sql`${table.startTime} IS NULL OR ${table.endTime} IS NULL OR ${table.startTime} <= ${table.endTime}`,
    ),

    // 给 resource_demand_link 和 resource_member_binding 的复合外键当靶子。
    unique("uk_resource_id_activity").on(table.id, table.activityId),
  ],
);

// ---------------------------------------------------------------------------
// 需求项 ↔ 资源记录（多对多）
// ---------------------------------------------------------------------------

/**
 * 一条需求可以关联多条资源记录（原型 REQ-001 就是"已关联 2 项：机场接送
 * 一号车、机场接送二号车"）；一条资源记录也可以服务多条需求（文档 §7.1：
 * "可选择关联一个或多个环节需求项"）。所以是多对多，不是外键。
 *
 * 这张表是需求项配置状态的**唯一输入**——状态不落列，就是靠这里的关联数
 * 和被关联资源的 status 现算。
 */
export const resourceDemandLink = pgTable(
  "resource_demand_link",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // 冗余，作用见下面两条复合外键：它是"需求项和资源必须同属一个活动"
    // 这条不变量的桥。没有它，A 活动的需求项能关联 B 活动的用车记录，而且
    // 两边的列表查询都看不出异常。
    activityId: bigint("activity_id", { mode: "number" }).notNull(),

    demandId: bigint("demand_id", { mode: "number" }).notNull(),
    resourceId: bigint("resource_id", { mode: "number" }).notNull(),

    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("uk_link_demand_resource").on(table.demandId, table.resourceId),

    // 台账页要按资源反查"这条车服务了哪几个环节需求"。
    index("idx_link_resource").on(table.resourceId),

    // cascade：关掉需求项就是删行（见 segmentResourceDemand 的注释），关联
    // 关系跟着走是对的——需求都没了，"这条车服务于该需求"这句话不成立。
    // 资源记录本身不受影响，它是活动级的。
    foreignKey({
      columns: [table.demandId, table.activityId],
      foreignColumns: [
        segmentResourceDemand.id,
        segmentResourceDemand.activityId,
      ],
      name: "fk_link_demand_activity",
    }).onDelete("cascade"),

    // 资源侧不设 cascade：资源不做物理删除，只作废（作废后自动不计入配置
    // 状态，见 RESOURCE_STATUSES 的注释）。
    foreignKey({
      columns: [table.resourceId, table.activityId],
      foreignColumns: [activityResource.id, activityResource.activityId],
      name: "fk_link_resource_activity",
    }),
  ],
);

// ---------------------------------------------------------------------------
// 人员服务绑定
// ---------------------------------------------------------------------------

/**
 * 资源记录 ↔ 活动人员。用车/用餐/住宿的服务名单。
 *
 * BR-DEV-033A 写死了"人员绑定来源必须是活动人员关系"，所以这里指向的是
 * activity_member.id 而不是 member.id——绑定的是"这个人在这场活动里的参与
 * 关系"，不是那个人本身。指向主档的话，一个没参加这场活动的人也能被绑进
 * 这场活动的用车，活动人员层在数据上就成了旁路。
 *
 * memberId 是冗余列，作用有二：一是台账页展示服务名单要拿姓名，join member
 * 时少绕一层；二是它参与下面的三列复合外键，顺带保证了"绑定行里的人 = 活动
 * 人员关系里的人"，不可能对不上。
 *
 * ⚠️ 本表**只有绑定关系，没有"已确认/待确认"状态**，这是一处已知的欠债，
 * 不是遗漏：排位有完整的确认闸门（保存即待确认，确认后才发布到 H5），资源
 * 没有——文档只写了"绑定后 H5 展示本人服务安排"。真实业务里用车方案敲定前
 * 会反复改（换车、换时间、换司机），首次绑定之后对资源记录本身的修改是没有
 * 任何闸门的，改了就直接对嘉宾生效。本期 H5 不建设，这个洞暂时不会漏水；
 * 等接 H5 时要在这里补一个 status（或在 activity_resource 上补发布态），
 * 那是加列，不用改结构。
 */
export const resourceMemberBinding = pgTable(
  "resource_member_binding",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    activityId: bigint("activity_id", { mode: "number" }).notNull(),
    resourceId: bigint("resource_id", { mode: "number" }).notNull(),
    activityMemberId: bigint("activity_member_id", {
      mode: "number",
    }).notNull(),
    memberId: bigint("member_id", { mode: "number" }).notNull(),

    remark: text("remark"),

    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("uk_binding_resource_member").on(
      table.resourceId,
      table.activityMemberId,
    ),

    // "某个人在这场活动里有哪些服务安排"——人员详情和将来的 H5 都按这个方向查。
    index("idx_binding_activity_member").on(table.activityMemberId),

    foreignKey({
      columns: [table.resourceId, table.activityId],
      foreignColumns: [activityResource.id, activityResource.activityId],
      name: "fk_binding_resource_activity",
    }).onDelete("cascade"),

    // 靶子是 activity_member 的 uk_activity_member_id_activity_member。
    // 三件事一条外键搞定：活动人员关系存在、属于同一活动、是同一个人。
    //
    // 不设 cascade：活动人员被移除时，数据库直接拦住，由 activityMember 的
    // remove 接口按 BR-DEV-029 的"展示影响清单 + 二次确认"来处理。静默删掉
    // 服务绑定，等于让运营在毫不知情的情况下丢掉一份用车名单。
    foreignKey({
      columns: [table.activityMemberId, table.activityId, table.memberId],
      foreignColumns: [
        activityMember.id,
        activityMember.activityId,
        activityMember.memberId,
      ],
      name: "fk_binding_activity_member",
    }),
  ],
);
