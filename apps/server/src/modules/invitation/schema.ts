import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { member } from "../member/schema";
import { user } from "../auth/schema";

// ---------------------------------------------------------------------------
// 领域词汇表
// ---------------------------------------------------------------------------

/**
 * 发函主体。旧系统靠字典值 + 正则去猜"联盟/商会/专班"该用哪套视觉样式
 * （logo/抬头/称谓），字典标签一改渲染就跟着漂移。这里直接把它存成显式枚举，
 * 前端用 `Record<InvitationIssuer, {...}>` 查表，不再做任何字符串推断。
 */
export const INVITATION_ISSUERS = [
  "alliance",
  "chamber",
  "taskforce",
  "plain",
] as const;
export type InvitationIssuer = (typeof INVITATION_ISSUERS)[number];

export const INVITATION_TEMPLATE_STATUSES = ["enabled", "disabled"] as const;
export type InvitationTemplateStatus =
  (typeof INVITATION_TEMPLATE_STATUSES)[number];

/**
 * 回复状态。这一轮只做管理端（模板/生成/记录），公开确认流程
 * （/public/invitation/{token}）依赖尚未迁移的活动模块，本次不做——
 * 但字段先建好占位，避免以后加列还要回填历史数据。
 */
export const INVITATION_RESPONSE_STATUSES = [
  "pending",
  "accepted",
  "declined",
] as const;
export type InvitationResponseStatus =
  (typeof INVITATION_RESPONSE_STATUSES)[number];

export const invitationTemplate = pgTable("invitation_template", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  name: text("name").notNull(),
  issuer: text("issuer").$type<InvitationIssuer>().notNull(),
  applicableDesc: text("applicable_desc"),
  status: text("status")
    .$type<InvitationTemplateStatus>()
    .notNull()
    .default("enabled"),

  bodyContent: text("body_content").notNull(),

  // 旧版叫 attachmentName/attachmentContent，命名容易让人以为是文件上传。
  // 它本来就是第二段富文本（附则/须知一类的内容），改名去掉这层歧义。
  annexTitle: text("annex_title"),
  annexContent: text("annex_content"),

  contactPerson: text("contact_person").notNull(),
  contactPhone: text("contact_phone").notNull(),
  signOff: text("sign_off").notNull(),

  // 旧版还有个必填的 defaultIssueDate：它存在的唯一作用是"生成时必然被覆盖"，
  // 本质是个必然过期的占位字段，删掉——生成页直接默认当天。

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

export const invitationBatch = pgTable("invitation_batch", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  // 建完行才能拿到自增 id，batchNo 在 routes.ts 里用 id 派生后再 UPDATE 回填，
  // 天然唯一——旧版是随机 3 位数撞库直接抛异常，这里结构上不会撞号。
  batchNo: text("batch_no").notNull().unique(),

  // 项目/活动模块尚未迁移，先留占位列不建外键，照 member.activityCount 的先例。
  projectId: bigint("project_id", { mode: "number" }),
  activityId: bigint("activity_id", { mode: "number" }),

  templateId: bigint("template_id", { mode: "number" }).references(
    () => invitationTemplate.id,
    { onDelete: "set null" },
  ),

  // 下面是生成时刻的快照，由服务端根据 templateId 现查现拼，不信任客户端
  // 传来的正文内容——旧版是模板查了但结果丢弃，正文整段由前端传入。
  templateName: text("template_name").notNull(),
  issuer: text("issuer").$type<InvitationIssuer>().notNull(),
  bodyContent: text("body_content").notNull(),
  annexTitle: text("annex_title"),
  annexContent: text("annex_content"),
  contactPerson: text("contact_person").notNull(),
  contactPhone: text("contact_phone").notNull(),
  signOff: text("sign_off").notNull(),
  issueDate: date("issue_date", { mode: "string" }).notNull(),

  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  // 没有 updatedAt/updatedBy：批次生成后不可变（对齐旧版"只能整批删除重建"的
  // 行为），没有可变字段就不需要更新审计列。
  // 没有 targetCount：冗余计数，列表用 count(*) 子查询代替，见 routes.ts。
});

export const invitationBatchItem = pgTable(
  "invitation_batch_item",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),

    batchId: bigint("batch_id", { mode: "number" })
      .notNull()
      .references(() => invitationBatch.id, { onDelete: "cascade" }),

    memberId: bigint("member_id", { mode: "number" }).references(
      () => member.id,
      { onDelete: "set null" },
    ),

    // 快照：服务端按 memberId 现查 member 表拼出来，不信任客户端传来的这几个字段。
    recipientName: text("recipient_name").notNull(),
    companyPosition: text("company_position"),
    countryRegion: text("country_region"),
    mobile: text("mobile"),

    responseToken: text("response_token").notNull().unique(),
    responseStatus: text("response_status")
      .$type<InvitationResponseStatus>()
      .notNull()
      .default("pending"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    // 同一批次里不允许同一个人员被重复选中——旧版没有这个约束，是真实缺陷。
    // 只约束 memberId 非空的情况：手工录入、memberId 为空的历史数据不受影响。
    uniqueIndex("uk_batch_member")
      .on(table.batchId, table.memberId)
      .where(sql`${table.memberId} is not null`),
  ],
);
