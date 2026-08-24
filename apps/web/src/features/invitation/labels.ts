import type { InvitationTemplateStatus } from "./queries";

export const TEMPLATE_STATUS_LABELS = {
  enabled: "启用",
  disabled: "停用",
} as const satisfies Record<InvitationTemplateStatus, string>;

export const TEMPLATE_STATUS_CHIP = {
  enabled: "border-success/30 bg-success/10 text-success-foreground",
  disabled: "border-border bg-muted text-muted-foreground",
} as const satisfies Record<InvitationTemplateStatus, string>;

export const TEMPLATE_STATUS_VALUES = Object.keys(
  TEMPLATE_STATUS_LABELS,
) as InvitationTemplateStatus[];

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTimeFormat.format(new Date(iso)) : "-";

/** 今天的 ISO 日期。手拼而不是 toISOString()，后者按 UTC 切，东八区半夜会差一天。 */
export const todayIsoDate = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** 排版用的手机号打码，不是权限控制——完整号码就在同一个响应体里。 */
export const maskMobile = (mobile?: string | null) => {
  if (!mobile) return "-";
  return mobile.length < 7
    ? mobile
    : `${mobile.slice(0, 3)}****${mobile.slice(-4)}`;
};

/**
 * 单批生成/下载的人数上限（文档 §8.4.1、BR-DEV-014D）。
 *
 * 服务端 `CreateInvitationBatchInput` 卡的是同一个数，这里只是**提前告诉用户**，
 * 不是校验——真正的拦截仍然在服务端。改的时候两边一起改。
 */
export const INVITATION_BATCH_MAX = 200;
