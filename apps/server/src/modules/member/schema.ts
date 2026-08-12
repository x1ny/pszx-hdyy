import { bigint, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";

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

export const member = pgTable("member", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),

  name: text("name").notNull(),
  gender: text("gender").$type<MemberGender>(),
  companyPosition: text("company_position"),
  countryRegion: text("country_region"),
  nativePlace: text("native_place"),
  idType: text("id_type").$type<MemberIdType>(),
  idNumber: text("id_number"),
  mobile: text("mobile"),
  phone: text("phone"),
  email: text("email"),
  language: text("language"),
  remark: text("remark"),

  // 活动关联模块尚未迁移；保留旧页面的只读字段，初始值为 0，后续由活动模块维护。
  activityCount: integer("activity_count").notNull().default(0),
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
});
