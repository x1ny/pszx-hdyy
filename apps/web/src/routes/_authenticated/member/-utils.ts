import type { MemberStatus } from "./-queries";

export const MEMBER_STATUS_LABELS = {
  enabled: "启用",
  disabled: "禁用",
} as const satisfies Record<MemberStatus, string>;

export const MEMBER_STATUS_VALUES = ["enabled", "disabled"] as const satisfies readonly MemberStatus[];

export const MEMBER_STATUS_CHIP = {
  enabled: "border-success/30 bg-success/10 text-success-foreground",
  disabled: "border-border bg-muted text-muted-foreground",
} as const satisfies Record<MemberStatus, string>;

export const MEMBER_STATUS_DOT = {
  enabled: "bg-success",
  disabled: "bg-muted-foreground/40",
} as const satisfies Record<MemberStatus, string>;

export const MEMBER_GENDER_LABELS = {
  男: "男",
  女: "女",
} as const;

export const MEMBER_GENDER_VALUES = ["男", "女"] as const;

export const MEMBER_ID_TYPE_LABELS = {
  身份证: "身份证",
  护照: "护照",
  港澳居民来往内地通行证: "港澳居民来往内地通行证",
  台湾居民来往大陆通行证: "台湾居民来往大陆通行证",
  其他: "其他",
} as const;

export const MEMBER_ID_TYPE_VALUES = [
  "身份证",
  "护照",
  "港澳居民来往内地通行证",
  "台湾居民来往大陆通行证",
  "其他",
] as const;

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

/** 只到天。项目起止时间、活动日期这些看的是"哪一天"，秒级精度是噪音。 */
export const formatDate = (iso: string | null | undefined) =>
  iso ? DATE_FORMAT.format(new Date(iso)) : "-";

export const formatDateRange = (
  start: string | null | undefined,
  end: string | null | undefined,
) => (start || end ? `${formatDate(start)} - ${formatDate(end)}` : "-");

/**
 * 活动时间。同一天的活动（绝大多数）只写一次日期：
 * `2026/04/10 09:00 - 12:00`；跨天才把日期重复出来。
 */
export const formatDateTimeRange = (
  start: string | null | undefined,
  end: string | null | undefined,
) => {
  if (!start && !end) return "-";
  if (!start || !end) {
    const only = start || end;
    return only ? `${formatDate(only)} ${TIME_FORMAT.format(new Date(only))}` : "-";
  }

  const from = new Date(start);
  const to = new Date(end);
  const head = `${formatDate(start)} ${TIME_FORMAT.format(from)}`;

  return DATE_FORMAT.format(from) === DATE_FORMAT.format(to)
    ? `${head} - ${TIME_FORMAT.format(to)}`
    : `${head} - ${formatDate(end)} ${TIME_FORMAT.format(to)}`;
};

export const maskPhone = (phone: string | null | undefined) => {
  if (!phone || phone.length < 7) return phone || "-";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
};

export const getIdNumberValidationRule = (idType?: string) => {
  switch (idType) {
    case "身份证":
      return {
        pattern: /(^\d{15}$)|(^\d{17}[\dXx]$)/,
        message: "请输入正确的身份证号码",
      };
    case "护照":
      return {
        pattern: /^[a-zA-Z0-9]{5,17}$/,
        message: "请输入正确的护照号码",
      };
    case "港澳居民来往内地通行证":
      return {
        pattern: /^[HMhm]\d{8}(\d{2})?$/,
        message: "请输入正确的港澳居民来往内地通行证号码",
      };
    case "台湾居民来往大陆通行证":
      return {
        pattern: /^\d{8}$/,
        message: "请输入正确的台湾居民来往大陆通行证号码",
      };
    default:
      return {
        pattern: /^.{1,64}$/,
        message: "请输入证件号码",
      };
  }
};
