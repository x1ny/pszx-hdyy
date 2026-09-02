import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { fileAsset } from "../file/schema";
import { activityMember } from "../member/schema";
import { organization } from "../organization/schema";
import { activity } from "../project/schema";

// ---------------------------------------------------------------------------
// 领域词汇表
// ---------------------------------------------------------------------------

export const INVITATION_TEMPLATE_STATUSES = ["enabled", "disabled"] as const;
export type InvitationTemplateStatus =
  (typeof INVITATION_TEMPLATE_STATUSES)[number];

/**
 * 系统变量白名单。值由系统在生成时自动填，用户在任何页面上都看不到输入框。
 *
 * 只有两个，不是漏了：正文按业务决策**写死在 docx 模板里**，活动名称/时间/
 * 地点因此也跟着写死了，真正需要按人按批变的只剩这两样。要加第三个时，
 * 加在这里 + 在渲染层补上取值。
 *
 * ⚠️ 名字就是模板里 `{{}}` 之间的字面文本，改一个字等于让所有存量模板的那个
 * 占位符失配。
 */
export const INVITATION_SYSTEM_VARIABLES = ["姓名", "发函日期"] as const;
export type InvitationSystemVariable =
  (typeof INVITATION_SYSTEM_VARIABLES)[number];

export const INVITATION_VARIABLE_KINDS = ["system", "custom"] as const;
export type InvitationVariableKind = (typeof INVITATION_VARIABLE_KINDS)[number];

/** 邀请函的收件对象：可以是一名活动人员，也可以是一个活动中的团体。 */
export const INVITATION_RECIPIENT_TYPES = ["member", "organization"] as const;
export type InvitationRecipientType =
  (typeof INVITATION_RECIPIENT_TYPES)[number];

/**
 * 上传 docx 时解析出来的变量契约——「这个模板里有哪些占位符」，**不含取值**。
 *
 * 取值不在模板上：自定义变量一律在生成页填（业务决策），所以值属于批次而不
 * 属于模板，见 `invitationBatch.variables`。
 */
export type InvitationTemplateVariable = {
  name: string;
  kind: InvitationVariableKind;
};

/** 生成时填的自定义变量取值：变量名 → 用户输入。系统变量不在这里。 */
export type InvitationVariableValues = Record<string, string>;

// ---------------------------------------------------------------------------
// 发函文件模板
// ---------------------------------------------------------------------------

/**
 * 模板 = 一个真实的 .docx 文件 + 它里面有哪些占位符。**版式不在数据库里，
 * 也不在代码里，就在那个文件里。**
 *
 * 上一版是反过来的：issuer 枚举决定 logo/抬头/称谓，正文/落款/联系人各占一列，
 * 前端再用 `docx` 库按这些列拼版面。拿到业务方三份真实模板后这条路走不通——
 * 排版规格细到「固定值 28 磅行距」「首行缩进 2 字符」「logo 2.4cm×5.71cm 左上角
 * 对齐」「红头下面两条一粗一细的红线」，用代码复刻既抄不全，抄的过程中还必然
 * 失真（标题用的方正小标宋简体是商业字体，前端根本不能分发）。
 *
 * 所以旧的七列（issuer / bodyContent / annexTitle / annexContent /
 * contactPerson / contactPhone / signOff）全部删除，换成下面两列。
 *
 * 模板是**全局池**，不带 activityId：三份真实模板是按发函主体（联盟/商会/
 * 专班）分的，不是按活动分的。
 */
export const invitationTemplate = pgTable("invitation_template", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  name: text("name").notNull(),
  applicableDesc: text("applicable_desc"),
  status: text("status")
    .$type<InvitationTemplateStatus>()
    .notNull()
    .default("enabled"),

  /**
   * 版式的唯一来源。
   *
   * 没有 onDelete：file_asset 的行被删掉会让这里的版式凭空消失，宁可让那次
   * 删除因为外键失败而报错。换模板文件 = 传一个新 file_asset 换 id，老文件行
   * 留着不动——历史批次的快照还指着它（见 invitationBatch.templateFileId）。
   */
  templateFileId: uuid("template_file_id")
    .notNull()
    .references(() => fileAsset.id),

  /**
   * 上传时解析一次存下来，作为模板与生成页之间的契约：生成页据此决定要渲染
   * 哪几个输入框，不用先把 docx 下载回来重新解析一遍。
   *
   * jsonb 而不是子表：它是文件的派生物，永远整份重写、永远整份读出，没有任何
   * 「按单个变量查模板」的访问路径。
   */
  variables: jsonb("variables")
    .$type<InvitationTemplateVariable[]>()
    .notNull()
    .default([]),

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
// 生成批次
// ---------------------------------------------------------------------------

/**
 * 一次生成操作的分组，也是留档的单位。职责有两个：装下这一次填的变量取值，
 * 和留下「谁在什么时候用哪个模板给哪些人员/团体生成过」的痕迹。
 *
 * 生成后不可变，所以没有 updatedAt / updatedBy。
 */
export const invitationBatch = pgTable(
  "invitation_batch",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    // 建完行才拿得到自增 id，batchNo 在 routes 里用 id 派生后回填，天然唯一。
    batchNo: text("batch_no").notNull().unique(),

    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activity.id),

    /**
     * 生成口径快照。member 是逐人生成，organization 是每个团体只生成
     * 一份；不能只从记录数量反推，因为批次详情/列表需要明确告诉运营本批的
     * 选择口径。
     */
    recipientType: text("recipient_type")
      .$type<InvitationRecipientType>()
      .notNull()
      .default("member"),

    /**
     * 没有 onDelete，等于 NO ACTION：**被引用过的模板在数据库层面就删不掉**，
     * 这正是 BR-DEV-021 要的（已被引用的模板不物理删除，只禁用/作废）。接口层
     * 把这次外键失败翻译成「该模板已被 N 次生成引用，请改为禁用」。
     */
    templateId: bigint("template_id", { mode: "number" })
      .notNull()
      .references(() => invitationTemplate.id),

    /**
     * 快照：这一批当时用的是模板文件的**哪个版本**。
     *
     * 只存 templateId 是不够的——业务方换一次模板文件，历史批次重新下载就会
     * 变成新版式。已经发出去的公函不该因为后来改了模板而变样。
     */
    templateFileId: uuid("template_file_id")
      .notNull()
      .references(() => fileAsset.id),

    /** 快照：模板改名后，历史记录仍显示当时的名字。 */
    templateName: text("template_name").notNull(),

    /**
     * 快照：这次填的自定义变量取值。
     *
     * 存在批次上而不是每条记录上——同一批 82 个人的联系人/落款是同一组值，
     * 存 82 遍是纯冗余。按人变的只有 {{姓名}}，那个在 invitationRecord。
     */
    variables: jsonb("variables")
      .$type<InvitationVariableValues>()
      .notNull()
      .default({}),

    /**
     * 系统变量 {{发函日期}} 的取值。独立成列而不是塞进 variables：它是一等
     * 概念，要排序、要筛选。
     */
    issueDate: date("issue_date", { mode: "string" }).notNull(),

    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // 生成记录页永远是「当前活动的批次列表」，这是它唯一的过滤条件。
    index("idx_invitation_batch_activity").on(table.activityId),
    check(
      "ck_invitation_batch_recipient_type",
      sql`${table.recipientType} in ('member', 'organization')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 邀请函记录
// ---------------------------------------------------------------------------

/**
 * 每批独立留档：一次生成就是一份不可变的档案，**后续再生成不影响已有批次**。
 *
 * 曾经按「一人一函、重新生成即覆盖」建过一版，实测下来不可接受：给同一批人重做
 * 一次，上一批就整个变成 0 份、按钮全灰，历史批次在列表上看着像坏了；而那批
 * 文件在现实里可能已经发出去了，事后还要能重新下载。
 *
 * 代价是「这个人的邀请函」在活动维度上不再唯一。目前没有消费方受影响——下载
 * 永远发生在某个批次的上下文里（按 record id 定位，没有歧义）。将来如果出现
 * 活动人员列表上的「邀请状态」这类活动级视图，再定义「以最新批次为准」即可，
 * 那是个查询口径问题，不需要动这张表。
 */
export const invitationRecord = pgTable(
  "invitation_record",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    /** 收件对象类型快照，和批次一致，便于记录层约束两种目标列互斥。 */
    recipientType: text("recipient_type")
      .$type<InvitationRecipientType>()
      .notNull()
      .default("member"),

    // memberId 只有个人记录才有值；个人记录的外键是下面那条复合外键，单列
    // 外键会和复合外键重复约束同一件事（同 activity_member 的做法）。
    activityId: bigint("activity_id", { mode: "number" }).notNull(),
    memberId: bigint("member_id", { mode: "number" }),

    /**
     * 团体记录只指向团体主档，不指向团体里的某一个人。这样团队邀请函
     * 才不会因为选了 4 个成员而产生 4 条记录，也不会把其中某个人错误当成
     * 下载文件的收件人。
     */
    organizationId: bigint("organization_id", { mode: "number" }).references(
      () => organization.id,
    ),

    /** cascade：批次没了，它名下的记录也就没了。 */
    batchId: bigint("batch_id", { mode: "number" })
      .notNull()
      .references(() => invitationBatch.id, { onDelete: "cascade" }),

    /**
     * 快照：{{姓名}} 当时渲染进文件的值。
     *
     * 只快照「被渲染进文件的值」，单位/职务/手机号这些**只在列表上展示**的
     * 字段不快照——它们通过 memberId 现查即可。快照的意义是保住产物的可重现
     * 性，不是给列表做缓存。
     */
    recipientName: text("recipient_name").notNull(),

    // 没有 updatedAt：记录生成后不可变（改内容 = 重新生成一个批次），
    // 没有可变字段就不需要更新审计列。同 invitationBatch。
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // 同一批次里同一个人/团体只能出现一次。两个唯一约束分开写，是因为
    // PostgreSQL 对 NULL 不互相冲突：个人记录的 organizationId、团体记录的
    // memberId 都为空。
    unique("uk_invitation_record_member").on(table.batchId, table.memberId),
    unique("uk_invitation_record_organization").on(
      table.batchId,
      table.organizationId,
    ),

    check(
      "ck_invitation_record_recipient_target",
      sql`(
        (${table.recipientType} = 'member' and ${table.memberId} is not null and ${table.organizationId} is null)
        or
        (${table.recipientType} = 'organization' and ${table.memberId} is null and ${table.organizationId} is not null)
      )`,
    ),

    /**
     * ⭐ 复合外键：个人邀请函只能发给**本活动的活动人员**。团体记录的
     * organizationId 不参与这条复合外键，由接口层校验该团体在本活动有启用成员。
     *
     * 业务决策是「先选活动，从活动人员里选人」（对齐 BR-DEV-033A）。在接口层
     * 校验一次是不够的——只要出现第二个写入口（导入、脚本、以后的批量工具），
     * 个人记录的这条不变量就会被绕过。靠 activity_member 上的 uk_activity_member
     * 当靶子，数据库直接钉死。
     *
     * 顺带解决了个人记录 activityId / memberId 各自的存在性：它们必然是
     * activity_member 里真实存在的一行，而那张表对 activity 和 member 都有真外键。
     *
     * 没有 cascade：移除活动人员时数据库会拦住。这是要的行为——文档要求移除
     * 人员时「展示清单并二次确认」后才解除邀请函等下游关联，那个确认动作应该
     * 显式删记录，而不是让一次误删悄悄带走一批公函留痕。
     */
    foreignKey({
      columns: [table.activityId, table.memberId],
      foreignColumns: [activityMember.activityId, activityMember.memberId],
      name: "fk_invitation_record_activity_member",
    }),

    // 批次详情要列出本批人员，是确定用得上的访问路径。
    index("idx_invitation_record_batch").on(table.batchId),
  ],
);

// ---------------------------------------------------------------------------
// 下载审计
// ---------------------------------------------------------------------------

export const INVITATION_DOWNLOAD_SCOPES = ["single", "batch"] as const;
export type InvitationDownloadScope =
  (typeof INVITATION_DOWNLOAD_SCOPES)[number];

export const INVITATION_DOWNLOAD_RESULTS = ["success", "failed"] as const;
export type InvitationDownloadResult =
  (typeof INVITATION_DOWNLOAD_RESULTS)[number];

/**
 * BR-DEV-014：邀请函下载是敏感操作，单个和批量都要记下载人、下载时间、活动、
 * 人员范围、文件数量、下载结果。
 *
 * 这张表是「文件必须由服务端交付」的直接理由——上一版 docx 在**客户端**生成，
 * 服务端根本不知道下载发生过，审计只能靠前端自觉上报，而那是可以绕过的
 * （拿到快照自己渲染，一条日志都不留）。
 *
 * 各列都不加外键：审计留痕不该因为业务行被删而受牵连（同
 * activity_segment_revision 的处理）。
 */
export const invitationDownloadLog = pgTable("invitation_download_log", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  activityId: bigint("activity_id", { mode: "number" }).notNull(),
  scope: text("scope").$type<InvitationDownloadScope>().notNull(),

  /** 收件对象范围：单份下载记 memberId 或 organizationId，批量下载记 batchId。 */
  batchId: bigint("batch_id", { mode: "number" }),
  memberId: bigint("member_id", { mode: "number" }),
  organizationId: bigint("organization_id", { mode: "number" }),

  fileCount: integer("file_count").notNull(),

  result: text("result").$type<InvitationDownloadResult>().notNull(),
  failReason: text("fail_reason"),

  downloadedBy: text("downloaded_by").references(() => user.id, {
    onDelete: "set null",
  }),
  downloadedAt: timestamp("downloaded_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
