import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * 后台账号的启停。和 supplier / member 用同一组值，不是 Better Auth `admin`
 * 插件那套 `banned` 布尔 —— 全站只应该有一种"启用/停用"语义。
 *
 * **停用的执行分三层，不要以为改这一列就够了**（挡新登录、删已有 session、请求级
 * 兜底）。三层各在哪、为什么少一层就会露出一个"处处报错但不跳登录页"的坏状态，
 * 见 docs/user-management-design.md 的 §8.2。
 */
export const USER_STATUSES = ["enabled", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * ⚠️ **这张表由 `bun run auth:generate` 生成，但下半截的列是手工加的。**
 *
 * 生成器会**整份覆盖本文件**，跑完之后必须把 `phone` 起到 `updatedBy` 为止的
 * 六列、以及上面那个 `USER_STATUSES` 补回来。这是本模块唯一一处需要人肉看顾的
 * 地方，改 Better Auth 插件配置时留意。
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  username: text("username").unique(),
  displayUsername: text("display_username"),

  // ------------------------------------------------------------------------
  // 以下为手工列 —— `auth:generate` 覆盖本文件后要补回来（见表上方注释）
  // ------------------------------------------------------------------------

  /** 联系方式，**刻意不设唯一**：它不是登录标识，两个同事共用一个工作号是合法的。 */
  phone: text("phone"),

  status: text("status").$type<UserStatus>().notNull().default("enabled"),

  remark: text("remark"),

  /**
   * 内置超管标记：不可删除、不可停用、不可改角色。
   *
   * 旧系统那套保护是 `SysUser.isAdmin(userId)`，字面意思就是 `userId == 1L`
   * 硬编码；我们的 `id` 是 Better Auth 生成的随机串，没有对应物，所以改成一个
   * 显式的列。**界面上没有任何入口能设置它**，只由生产引导写入。
   */
  isBuiltin: boolean("is_builtin").notNull().default(false),

  /**
   * 自引用：谁建的这个账号。`set null` 而不是 cascade —— 删掉建号的人不该把他
   * 建过的账号一起带走。
   */
  createdBy: text("created_by").references((): AnyPgColumn => user.id, {
    onDelete: "set null",
  }),
  updatedBy: text("updated_by").references((): AnyPgColumn => user.id, {
    onDelete: "set null",
  }),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
