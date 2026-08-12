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
