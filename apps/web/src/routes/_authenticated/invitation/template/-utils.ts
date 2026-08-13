export {
  ISSUER_LABELS,
  ISSUER_VALUES,
  ISSUER_VISUAL,
} from "../-shared/issuer-visual.ts";
import type { InvitationTemplateStatus } from "./-queries";

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
