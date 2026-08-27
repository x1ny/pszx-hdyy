import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { activitySegment } from "../agenda/schema";
import { user } from "../auth/schema";
import { organization } from "../organization/schema";
import { activity, project } from "../project/schema";

// ---------------------------------------------------------------------------
// 领域词汇表
// ---------------------------------------------------------------------------

export const MEMBER_STATUSES = ["enabled", "disabled"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const MEMBER_GENDERS = ["男", "女"] as const;
export type MemberGender = (typeof MEMBER_GENDERS)[number];

export const MEMBER_ID_TYPES = [
  "身份证",
  "护照",
  "港澳居民来往内地通行证",
  "台湾居民来往大陆通行证",
  "其他",
] as const;
export type MemberIdType = (typeof MEMBER_ID_TYPES)[number];

/**
 * 关系的**录入渠道**：这个人是打哪个入口进到这一层的，由系统按入口生成，
 * 页面只读（R-003）。
 *
 * ⚠️ 别和关系表上的 `source` 列搞混。文档里这两个东西叫"数据来源"和"来源"，
 * 名字只差一个字但性质完全相反：`source` 是运营手填的业务来源（"王总客人"
 * "企业嘉宾"），这个枚举是系统写的溯源标记。原型 activity-members.html 的表头
 * 把两列并排摆着，实现时几乎必然混淆——所以这里刻意不叫 dataSource，
 * 叫 originType，让两个概念在代码里长得完全不一样。
 *
 * 各层能产生的值不同（在 validation.ts 里按层收窄，不在这里拆成三个枚举——
 * 拆了之后 ladder 里每写一层就要换一个类型，没有收益）：
 *   - 项目层：manual / import / registration / backfill_from_*
 *   - 活动层：manual / import / project_assign / registration / backfill_from_segment
 *   - 环节层：manual / import / segment_reference
 *
 * backfill_from_* 对应 BR-DEV-026 的自动补齐。刻意区分"从活动补的"和"从环节
 * 补的"而不是笼统一个 backfill：文档 8.1.2 规则 6 明确要求环节导入补出来的
 * 活动关系要记成"环节导入"，运营需要凭这个判断这条关系是不是自己建的。
 */
export const MEMBER_RELATION_ORIGINS = [
  "manual",
  "import",
  "project_assign",
  "segment_reference",
  "registration",
  "backfill_from_activity",
  "backfill_from_segment",
] as const;
export type MemberRelationOrigin = (typeof MEMBER_RELATION_ORIGINS)[number];

/** 环节身份。取值照抄原型 agenda-timeline.html 环节人员弹窗的下拉，没有自己发明。 */
export const SEGMENT_MEMBER_ROLES = [
  "演讲嘉宾",
  "嘉宾",
  "参会人员",
  "工作人员",
] as const;
export type SegmentMemberRole = (typeof SEGMENT_MEMBER_ROLES)[number];

// ---------------------------------------------------------------------------
// 全量人员主档
// ---------------------------------------------------------------------------

export const member = pgTable(
  "member",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    name: text("name").notNull(),
    gender: text("gender").$type<MemberGender>(),
    companyPosition: text("company_position"),
    /**
     * 当前所属团体。单个可空外键直接表达「一人最多一个团体」，不建多对多关系表。
     *
     * 不设 onDelete，默认 NO ACTION：只要还有成员引用，团体就不能被物理删除。
     * 未来活动/项目范围快照引用团体时也必须沿用这一策略，历史引用不能级联消失，
     * 也不能在删除团体时被静默置空。
     */
    organizationId: bigint("organization_id", { mode: "number" }).references(
      () => organization.id,
    ),
    /**
     * 国别/地区与籍贯：**码是权威，名字是写入时的快照。**
     *
     * 两样都存，是因为两条纯路线各有一个真实代价：只存码，三处展示（人员列表、
     * 人员详情、活动人员详情）全要走字典映射，列表页因此得常驻一份字典；只存名，
     * 编辑回填要拿库里的字符串反查字典，对不上的行下拉就是空的——用户点一下保存，
     * 原值被静默清掉。存码解决回填，存名让展示继续傻打字符串。
     *
     * 代价是一条必须守住的约定：**任何查询、筛选、去重都走 `*_code`**，名字列
     * 只用于显示。字典改名时跑一次回填脚本把新名字刷进快照列即可（几年一次）。
     *
     * 客户端只传码，名字由服务端查 `shared/dict/regions.ts` 派生后写入——两样都
     * 让客户端传，迟早出现码是 US、名字是"中国"的行。
     *
     * 籍贯拆成省、市两级：直辖市和港澳台没有市级（字典里就没有），籍贯选到省即止。
     */
    countryRegionCode: text("country_region_code"),
    countryRegion: text("country_region"),
    nativeProvinceCode: text("native_province_code"),
    nativeProvince: text("native_province"),
    nativeCityCode: text("native_city_code"),
    nativeCity: text("native_city"),
    idType: text("id_type").$type<MemberIdType>(),
    idNumber: text("id_number"),
    mobile: text("mobile"),
    phone: text("phone"),
    email: text("email"),
    language: text("language"),
    remark: text("remark"),

    /**
     * 合并去向。本期**没有合并 UI**，这一列现在恒为 null。
     *
     * 明知不做还是先建，理由和 activity_segment_revision 那张"只写不读"的表
     * 一样，但更急迫：主档的唯一性约束是**可选的**（手机号不唯一 R-002、
     * 证件非必填 BR-DEV-028），所以重复人员一定会攒出来——一个人 6 月被导入
     * 时没填证件，8 月报名时填了，就是两条主档。等重复攒够了再加这一列，
     * 那时下游的项目/活动/环节关系、邀请函、排位、行程已经分别挂在两个
     * personId 上，加列容易，把它们并回一条难。
     *
     * 留了这一列，将来的合并动作就是：下游关系按 personId 改指 + 源行写
     * mergedIntoId + 禁用。而不是先补一次迁移再做功能。
     */
    mergedIntoId: bigint("merged_into_id", { mode: "number" }).references(
      (): AnyPgColumn => member.id,
    ),

    status: text("status").$type<MemberStatus>().notNull().default("enabled"),

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
    /**
     * BR-DEV-028 的"同一证件类型 + 证件号码在全量人员库内唯一"。
     *
     * 是 partial unique index 而不是普通 unique，因为证件两列都非必填，而
     * Postgres 的 unique 允许重复的 NULL——真按普通 unique 建，(null, null)
     * 不冲突，看着像生效了，实际只约束了填了证件的那部分行，行为对但语义靠
     * 巧合。写成条件索引是把"只有两列都填了才唯一"这件事说出来。
     *
     * 落到数据库而不是只在 routes 里查一次：现在的 hasDuplicateIdNumber 是
     * 先查后写，两次往返之间有竞态窗口；而且它只比 idNumber 不比 idType，
     * 跟 BR-DEV-028 的口径对不上。索引建了之后应用层那次查询仍然留着——它
     * 负责把违反变成一句人话，索引负责保证违反不了。
     */
    uniqueIndex("uk_member_id_document")
      .on(table.idType, table.idNumber)
      .where(
        sql`${table.idType} is not null and ${table.idNumber} is not null`,
      ),

    // 团体详情统计/列成员，以及物理删除前的引用检查都会按这一列查询。
    index("idx_member_organization").on(table.organizationId),
  ],
);

// ---------------------------------------------------------------------------
// 项目人员关系
// ---------------------------------------------------------------------------

/**
 * 三层关系表里最薄的一层，故意的。
 *
 * 文档 8.1.1 给项目人员列了 7 个字段，其中"关联活动数""最近参与活动"两个是
 * **派生值**——从活动人员关系聚合得出。这里不存它们，查询时算。物化一个派生
 * 值的代价不是那一列的存储，是要额外定义一整套回写时机（活动人员新增要不要
 * 加？活动下架算不算？活动人员移除回退吗？），而文档一条都没定义。几千人的
 * 量级下 count 聚合根本不构成问题，等真慢了再物化，那时至少口径是清楚的。
 *
 * 剩下真正属于这一层的只有 sourceType 和 remark。这一层的价值不在字段，在
 * 它是"人进了项目范围"的落点：到离行程按项目级归集（文档 §7 人员到离行程
 * 记录定义："本质上以项目级归集为主"）就挂在这里。
 */
export const projectMember = pgTable(
  "project_member",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // onDelete 不设 cascade：项目删除只允许没有关联数据的项目，已被引用的
    // 项目由外键阻止，避免误删项目人员关系。
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => project.id),

    /**
     * 同样不设 cascade —— 主档只禁用不删（BR-DEV-021）。
     *
     * member 模块**保留了** /delete 接口，所以这条约束会真的被撞上：删一个
     * 已进过项目的人会撞外键。这不是漏洞，是设计——routes.ts 里 delete 前先
     * 查一次关系，撞上就返回一句"已被引用，请改用禁用"，把数据库的 23503
     * 翻译成运营看得懂的话。约束兜底，接口讲人话。
     */
    memberId: bigint("member_id", { mode: "number" })
      .notNull()
      .references(() => member.id),

    sourceType: text("source_type")
      .$type<MemberRelationOrigin>()
      .notNull()
      .default("manual"),

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
    // 一个人在一个项目里只有一条关系。这条唯一键同时是 ladder 里
    // "有则复用、无则新建"的依据（onConflictDoNothing 打在它上面）。
    unique("uk_project_member").on(table.projectId, table.memberId),

    // "这个人参与了哪些项目" —— H5 我的参与页按当前人员反查，是确定用得上的
    // 访问路径，不属于"等实测再加"的那类索引。
    index("idx_project_member_member").on(table.memberId),

    // 给 activity_member 的复合外键当靶子，见那张表。id 已是主键，多这条
    // 三列唯一键在 Postgres 里近乎零成本。
    unique("uk_project_member_id_project_member").on(
      table.id,
      table.projectId,
      table.memberId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 活动人员关系
// ---------------------------------------------------------------------------

/**
 * 三层里的重心。报名审核、邀请函生成、排位、资源服务绑定、H5 本人信息全部
 * 从这一层取数（BR-DEV-033A 甚至写死了"人员绑定来源必须是活动人员关系"）。
 */
export const activityMember = pgTable(
  "activity_member",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // 下面这四列都**没有单列 .references()**：它们的外键是文件末尾那两条复合
    // 外键，单列外键会和复合外键重复约束同一件事（同 activity_segment 的
    // agendaLineId）。
    activityId: bigint("activity_id", { mode: "number" }).notNull(),

    /**
     * 冗余列：projectId 本来能从 activity 推出来。
     *
     * 冗余它有两个理由。一是查询——项目人员汇总要跨活动统计"这个人在本项目
     * 参与了几场"，冗余之后不用 join activity。二是它是下面复合外键的桥：
     * 靠 (activityId, projectId) → activity(id, projectId) 和
     * (projectMemberId, projectId, memberId) → project_member(...) 两条约束，
     * 数据库直接保证了"活动人员挂的项目关系，必须属于这个活动所在的项目"。
     *
     * 冗余的常见代价是漂移，这里不会——两条复合外键钉死了它。
     */
    projectId: bigint("project_id", { mode: "number" }).notNull(),

    /**
     * ⭐ 指向上一层关系，而不是只存 projectId。
     *
     * 这一列是整个分层模型能不能立住的关键。文档只在写入方向管得严
     * （BR-DEV-026：环节入口进人要自动补齐上层），删除方向是放任的——原型
     * project-members.html 的移除弹窗写着"如该人员已被活动引用，请先到活动
     * 人员页确认是否同步移除"，靠一句提示让人工去别处清。那就能合法造出
     * "活动人员在、项目人员没了"的孤儿，直接违反系统自己在写入侧建立的不变量。
     *
     * 有了这条外键，移除项目人员时数据库会直接拦住（没有 cascade），孤儿在
     * 物理上不可能出现。接口层再把这次拦截翻译成"该人员仍在 N 场活动中"。
     */
    projectMemberId: bigint("project_member_id", { mode: "number" }).notNull(),

    memberId: bigint("member_id", { mode: "number" }).notNull(),

    // 以下三列是运营手填的业务字段，只作用于当前活动（BR-DEV-027）。
    // ownerName 本期是文本，同 activity_segment.ownerName——原型就是个 input。
    source: text("source"),
    groupName: text("group_name"),
    ownerName: text("owner_name"),

    // 系统生成、页面只读（R-003）。
    originType: text("origin_type")
      .$type<MemberRelationOrigin>()
      .notNull()
      .default("manual"),

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
    unique("uk_activity_member").on(table.activityId, table.memberId),

    index("idx_activity_member_member").on(table.memberId),
    // 项目人员汇总跨活动查，见 projectId 那段注释。
    index("idx_activity_member_project").on(table.projectId),

    // 活动必须真实存在，且这一行冗余的 project_id 必须等于该活动的 project_id。
    foreignKey({
      columns: [table.activityId, table.projectId],
      foreignColumns: [activity.id, activity.projectId],
      name: "fk_activity_member_activity",
    }),

    // 挂的项目关系必须(a)存在 (b)属于同一个项目 (c)是同一个人。三件事一条
    // 外键搞定，这是用复合外键传播分区键的标准手法。
    //
    // 顺带解决了 memberId 的冗余问题：它必然等于 project_member.member_id，
    // 而那一列有真正的外键指向 member，所以主档存在性也是传递保证的——
    // 不需要在这里再挂一条 memberId → member.id。
    foreignKey({
      columns: [table.projectMemberId, table.projectId, table.memberId],
      foreignColumns: [
        projectMember.id,
        projectMember.projectId,
        projectMember.memberId,
      ],
      name: "fk_activity_member_project_member",
    }),

    // 给 segment_member 的复合外键当靶子。
    unique("uk_activity_member_id_activity_member").on(
      table.id,
      table.activityId,
      table.memberId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 环节人员关系
// ---------------------------------------------------------------------------

/**
 * 最薄但不可省的一层：一场活动里人员不是全参加所有环节，而排位方案是**按环节**
 * 建的（BR-DEV 8.3 规则 2："不能只按活动保存一个统一排位方案"），同一个人上午
 * 开幕式坐 A1、下午圆桌坐 B3。排位的人员池因此必须是环节粒度。
 *
 * ⚠️ 这里和文档的数据对象清单有一处**故意的偏离**。文档 §8.1 把座位分配写成
 * `分配ID、方案ID、环节ID、活动人员ID、人员ID、座位ID`——引用的是活动人员。
 * 照那么建，就能把一个非本环节人员排进本环节座位，环节人员层在数据上完全是
 * 旁路的，那它就只剩 segmentRole 一个字段、不值得单独一层。排位模块建表时
 * seat_assignment 应指向 segment_member.id，让这一层真正承担它声称的职责。
 */
export const segmentMember = pgTable(
  "segment_member",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    segmentId: bigint("segment_id", { mode: "number" }).notNull(),

    // 冗余，理由同 activity_member.projectId：本活动全环节人员汇总、"引用其他
    // 环节人员"选择器都按活动查；同时充当下面两条复合外键的桥。
    activityId: bigint("activity_id", { mode: "number" }).notNull(),

    // ⭐ 同 activity_member.projectMemberId：链条向上闭合，移除活动人员时
    // 数据库拦住残留的环节关系。
    activityMemberId: bigint("activity_member_id", {
      mode: "number",
    }).notNull(),

    memberId: bigint("member_id", { mode: "number" }).notNull(),

    /** 这一层唯一真正独有的字段。 */
    segmentRole: text("segment_role").$type<SegmentMemberRole>(),

    /**
     * 下面三列**可空，null 表示继承活动层**，读取时 COALESCE 到 activity_member
     * 的同名列。
     *
     * 文档给环节人员也列了来源/分组/负责人，和活动层同名同义。照字面建三个
     * 平行的独立列，实际运营里 90% 的行会填成跟活动层一模一样（纯负担），
     * 剩下 10% 填得不一样时就出现"活动分组=A、环节分组=B、下游读哪个"的
     * 死结——而文档从没定义过正方向的继承规则（8.1.2 规则 6 只规定了环节→
     * 活动补齐时沿用，没说活动→环节）。
     *
     * 可空 + COALESCE 把默认继承和显式覆盖分开表达，两种意图在数据上可区分：
     * null 是"跟着活动走"，有值是"这个环节就是不一样"。
     */
    source: text("source"),
    groupName: text("group_name"),
    ownerName: text("owner_name"),

    originType: text("origin_type")
      .$type<MemberRelationOrigin>()
      .notNull()
      .default("manual"),

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
    // 唯一键打在 activityMemberId 而不是 memberId 上：两者等价（下面的复合
    // 外键保证了一一对应），但打在关系 id 上更贴合"环节人员是活动人员的子集"
    // 这个语义。
    unique("uk_segment_member").on(table.segmentId, table.activityMemberId),

    // H5 我的参与页要按当前人员列出本人参与的环节。
    index("idx_segment_member_member").on(table.memberId),
    // "引用本活动其他环节人员"（原型 agenda-timeline.html 的进入方式之一）
    // 按活动查全部环节人员。
    index("idx_segment_member_activity").on(table.activityId),

    // 环节必须存在，且这一行冗余的 activity_id 必须等于该环节的 activity_id。
    foreignKey({
      columns: [table.segmentId, table.activityId],
      foreignColumns: [activitySegment.id, activitySegment.activityId],
      name: "fk_segment_member_segment",
    }),

    // 挂的活动关系必须存在、属于同一活动、是同一个人。
    foreignKey({
      columns: [table.activityMemberId, table.activityId, table.memberId],
      foreignColumns: [
        activityMember.id,
        activityMember.activityId,
        activityMember.memberId,
      ],
      name: "fk_segment_member_activity_member",
    }),

    // 给 modules/seating 的 seat_assignment 复合外键当靶子，保证一条分配指向的
    // 人和它指向的方案属于同一个环节。同 uk_segment_id_activity 那套做法。
    unique("uk_segment_member_id_segment").on(table.id, table.segmentId),
  ],
);
