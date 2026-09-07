import type { UserStatus } from "./-queries";

// 中文标签只存在于前端（同 supplier/-utils.ts）。`satisfies Record<枚举, string>`
// 咬死两边：服务端加一个状态、这里不补标签就编译不过。
export const USER_STATUS_LABELS = {
  enabled: "正常",
  disabled: "停用",
} as const satisfies Record<UserStatus, string>;

/**
 * 状态芯片配色，和 supplier 保持一致——"停用"用中性灰而不是红：它是"这个人暂时
 * 不该登录"，不是错误，红色会把它误报成故障。
 */
export const USER_STATUS_CHIP = {
  enabled: "border-success/30 bg-success/10 text-success-foreground",
  disabled: "border-border bg-muted text-muted-foreground",
} as const satisfies Record<UserStatus, string>;

export const USER_STATUS_DOT = {
  enabled: "bg-success",
  disabled: "bg-muted-foreground/40",
} as const satisfies Record<UserStatus, string>;

export const USER_STATUS_VALUES = Object.keys(
  USER_STATUS_LABELS,
) as UserStatus[];

/**
 * 账号名的规则镜像自 `apps/server/src/modules/user/validation.ts`，而那份又必须和
 * Better Auth `username` 插件的配置一致。**三处要一起改。**
 *
 * 放宽这里不会让服务端接受更宽的值，只会让用户先看到一次成功的前端校验、再被
 * 服务端打回来。
 */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

/** 和 Better Auth 默认的 `minPasswordLength` 对齐。 */
export const PASSWORD_MIN_LENGTH = 8;
