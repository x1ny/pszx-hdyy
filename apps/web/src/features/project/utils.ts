import type { ActivityType, ProjectPublishStatus } from "./queries";

// ---------------------------------------------------------------------------
// 中文标签只存在于前端——服务端只管"这个字段允许哪些值"
// （modules/project/schema.ts 的枚举），展示成什么字是前端的事。
// `satisfies Record<枚举, string>` 把两边咬死：服务端加一个值，这里不补
// 标签就编译不过。
// ---------------------------------------------------------------------------

export const PUBLISH_STATUS_LABELS = {
  draft: "未发布",
  published: "已上架",
  delisted: "已下架",
} as const satisfies Record<ProjectPublishStatus, string>;

export const ACTIVITY_TYPE_LABELS = {
  standalone: "自主策划",
  affiliated: "配套活动",
} as const satisfies Record<ActivityType, string>;

export const PUBLISH_STATUS_CHIP = {
  draft: "border-border bg-muted text-muted-foreground",
  published: "border-success/30 bg-success/10 text-success-foreground",
  delisted: "border-destructive/30 bg-destructive/10 text-destructive",
} as const satisfies Record<ProjectPublishStatus, string>;

export const PUBLISH_STATUS_VALUES = Object.keys(
  PUBLISH_STATUS_LABELS,
) as ProjectPublishStatus[];

export const ACTIVITY_TYPE_VALUES = Object.keys(
  ACTIVITY_TYPE_LABELS,
) as ActivityType[];

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 接口给的是 ISO 字符串（timestamptz 序列化的结果），按浏览器本地时区展示。 */
export const formatDateTime = (value: string | Date | null | undefined) =>
  value ? dateTimeFormat.format(new Date(value)) : "-";

const currencyFormat = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 2,
});

/** numeric 列落到 JSON 里是字符串（保精度），展示时才转数字。 */
export const formatBudget = (value: string | null | undefined) =>
  value ? currencyFormat.format(Number(value)) : "-";

const pad2 = (value: number) => String(value).padStart(2, "0");

/**
 * `<input type="datetime-local">` 要的是不带时区的 "YYYY-MM-DDTHH:mm"，
 * 按浏览器本地时区手拼——不能用 `toISOString()`，那个是 UTC，会把显示的
 * 时间平移成跟用户输入不一致的值。
 */
export const toDateTimeLocalValue = (
  value: Date | string | null | undefined,
) => {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};
