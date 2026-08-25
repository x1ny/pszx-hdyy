import type { MemberStatus } from "./queries.ts";

export const MEMBER_STATUS_LABELS = {
  enabled: "启用",
  disabled: "禁用",
} as const satisfies Record<MemberStatus, string>;

export const MEMBER_STATUS_VALUES = [
  "enabled",
  "disabled",
] as const satisfies readonly MemberStatus[];

export const MEMBER_STATUS_CHIP = {
  enabled: "border-success/30 bg-success/10 text-success-foreground",
  disabled: "border-border bg-muted text-muted-foreground",
} as const satisfies Record<MemberStatus, string>;

export const MEMBER_STATUS_DOT = {
  enabled: "bg-success",
  disabled: "bg-muted-foreground/40",
} as const satisfies Record<MemberStatus, string>;

/**
 * 籍贯的显示串。
 *
 * 直接拼名字快照，不查字典——库里存的就是写入时的中文名（见 member/schema.ts）。
 * 直辖市和港澳台没有市级，只显示省，所以这里是拼接而不是固定的"省 + 市"。
 */
export const formatNativePlace = (
  province: string | null | undefined,
  city: string | null | undefined,
) => [province, city].filter(Boolean).join("") || "-";

export const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return "-";

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
};

const DATE_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 只到天。项目起止时间、活动日期这些看的是“哪一天”，秒级精度是噪音。 */
export const formatDate = (iso: string | null | undefined) =>
  iso ? DATE_FORMAT.format(new Date(iso)) : "-";

export const formatDateRange = (
  start: string | null | undefined,
  end: string | null | undefined,
) => (start || end ? `${formatDate(start)} - ${formatDate(end)}` : "-");

/** 同日活动只显示一次日期，跨日活动分别显示起止日期。 */
export const formatDateTimeRange = (
  start: string | null | undefined,
  end: string | null | undefined,
) => {
  if (!start && !end) return "-";
  if (!start || !end) {
    const only = start || end;
    return only
      ? `${formatDate(only)} ${TIME_FORMAT.format(new Date(only))}`
      : "-";
  }

  const from = new Date(start);
  const to = new Date(end);
  const head = `${formatDate(start)} ${TIME_FORMAT.format(from)}`;

  return DATE_FORMAT.format(from) === DATE_FORMAT.format(to)
    ? `${head} - ${TIME_FORMAT.format(to)}`
    : `${head} - ${formatDate(end)} ${TIME_FORMAT.format(to)}`;
};
