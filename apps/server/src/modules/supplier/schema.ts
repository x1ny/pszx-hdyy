import { bigint, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { fileAsset } from "../file/schema";

// ---------------------------------------------------------------------------
// 领域词汇表
//
// 这两组值是数据模型的一部分（列里能出现什么），所以定义在 schema.ts，
// validation.ts 再拿它们拼 zod。反过来放会让「表能存什么」取决于「接口收什么」。
//
// **展示用的中文标签不在这里。** 服务端不掺和展示，标签由前端持有，并且写成
// `Record<ServiceCategory, string>` —— 这里加一个值，前端不补标签就编译不过，
// 两边靠类型咬死，不可能漂移。
// ---------------------------------------------------------------------------

export const SUPPLIER_STATUSES = ["enabled", "disabled"] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

/**
 * ⚠️ 待核对：旧系统这批值来自字典表 `sys_dict_data`（dict_type = 'hdgl_fwlm'），
 * 而字典表属于系统管理模块，本次不迁。下面是按业务域推的**占位值**，
 * 导旧数据前必须换成旧库里的真实 dict_value，否则老行的
 * `service_categories` 过不了校验：
 *
 *   select dict_value, dict_label, dict_sort
 *   from sys_dict_data where dict_type = 'hdgl_fwlm' order by dict_sort;
 *
 * 换值时只改这一个数组 + 前端那份 label 映射（类型会逼你改）。
 */
export const SERVICE_CATEGORIES = [
  "venue",
  "catering",
  "accommodation",
  "transport",
  "staging",
  "lighting",
  "photography",
  "makeup",
  "model",
  "printing",
  "security",
  "other",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const supplier = pgTable("supplier", {
  // byDefault 而非 always：导旧数据时要能带着原始 id 插入。
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  name: text("name").notNull(),

  // 旧库是 VARCHAR(512) 逗号拼接 + `LIKE '%值%'` 查询，那个查询有 bug：
  // 查 "model" 会命中 "model_agency"。Postgres 原生数组配 `@>` 是精确的，
  // 顺带干掉两端各一套 split/join 映射。
  serviceCategories: text("service_categories")
    .array()
    .$type<ServiceCategory[]>()
    .notNull(),

  city: text("city").notNull(),
  contactPerson: text("contact_person").notNull(),
  contactPhone: text("contact_phone").notNull(),

  status: text("status").$type<SupplierStatus>().notNull().default("enabled"),

  remark: text("remark"),

  // 旧库还冗余了 create_user_name / update_user_name 两列，这里砍掉了：
  // 列表和详情从来没展示过创建人，而姓名一旦冗余就会跟 user 表对不上。
  // 保留 id 列是因为**事后无法回填**——现在不存，以后想查就永远查不到了。
  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedBy: text("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),

  // withTimezone：node-postgres 会把无时区的 timestamp 按**服务器进程本地时区**
  // 解析，部署机一换时区，历史数据整体平移。timestamptz 没有这个歧义。
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// 故意没有二级索引。旧库那三个（idx_name / idx_city / idx_status）是照抄模板：
// idx_name 服务不了 `LIKE '%x%'`（前导通配符走不了 btree），idx_status 只有两个
// 取值、选择性差到规划器不会用它。供应商是主数据表，量级在几百到几千行，
// 顺序扫描本来就比索引快。真遇到慢查询再按实测加（名称模糊搜索要 pg_trgm，
// 类目包含查询要 GIN）——加索引是一行迁移，删掉一个没人敢动的索引才麻烦。

// ---------------------------------------------------------------------------
// 报价信息
// ---------------------------------------------------------------------------

/**
 * 供应商报价附件。**这张表只存「哪个供应商挂了哪个文件」，不解析报价内容。**
 *
 * 业务反馈要的就是「历史报价」的留档：报价单是 PDF / Excel，金额、有效期、
 * 明细全在文件里，由人去看。真去建一套结构化报价（金额、币种、生效区间、
 * 明细行）等于让运营把文件里的东西再录一遍，两边必然对不上。
 *
 * 文件名、大小、类型都不冗余存——它们是 `file_asset` 的列，join 一下就有，
 * 冗余了就会跟真实文件对不上（同 supplier 不存 create_user_name 的理由）。
 */
export const supplierQuote = pgTable("supplier_quote", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  /**
   * cascade：供应商是物理删除的（见 routes.ts 的 /delete），它名下的报价附件
   * 跟着一起走。不给 cascade 的话，删供应商会被外键直接拦住——那等于把
   * 「删除」这个已有功能改成「传过附件就再也删不掉」，不是这次要做的事。
   *
   * 被删掉的只是这条关联记录，`file_asset` 那行和磁盘上的文件都还在。
   */
  supplierId: bigint("supplier_id", { mode: "number" })
    .notNull()
    .references(() => supplier.id, { onDelete: "cascade" }),

  /**
   * 没有 onDelete，等于 NO ACTION：被引用的 file_asset 删不掉。同
   * invitation_template.template_file_id —— 文件行凭空消失会让这条记录指向
   * 一个不存在的附件，宁可让那次删除报错。
   */
  fileId: uuid("file_id")
    .notNull()
    .references(() => fileAsset.id),

  uploadedBy: text("uploaded_by").references(() => user.id, {
    onDelete: "set null",
  }),

  // 没有 updatedAt / updatedBy：附件传上来就不可变，改 = 删掉重传。
  // 没有可变字段就不需要更新审计列（同 invitation_record）。
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
