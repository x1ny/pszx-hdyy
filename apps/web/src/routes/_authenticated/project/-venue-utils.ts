import type {
  ActivityVenueStatus,
  PlanStatus,
  ZonePurpose,
} from "./-venue-queries";

/**
 * 中文标签和配色只存在于前端。服务端只管"这个字段允许哪些值"。
 * `satisfies Record<枚举, string>` 咬死：服务端加一个值、这里不补标签就编译不过。
 */

export const ZONE_PURPOSE_LABELS = {
  mainSeating: "主线环节排位",
  breakout: "分论坛/洽谈",
  checkin: "签到物料",
  standby: "备用区域",
} as const satisfies Record<ZonePurpose, string>;

export const ZONE_PURPOSE_VALUES = Object.keys(
  ZONE_PURPOSE_LABELS,
) as ZonePurpose[];

export const ACTIVITY_VENUE_STATUS_LABELS = {
  active: "正常",
  disabled: "已禁用",
} as const satisfies Record<ActivityVenueStatus, string>;

export const ACTIVITY_VENUE_STATUS_CHIP = {
  active: "border-success/30 bg-success/10 text-success-foreground",
  disabled: "border-border bg-muted text-muted-foreground",
} as const satisfies Record<ActivityVenueStatus, string>;

/**
 * 活动内新画的区域没有场地区域出处，服务端会把 `sourceZoneId` 留空。
 *
 * 这列不是带 `onDelete: "set null"` 的外键，因此 `null` 只表示“本活动新建”，
 * 不能被解释成“来源已删除”。把判断收在这里并用测试钉死，避免只看可空字段名
 * 又把两个完全不同的状态混在一起。
 */
export function formatActivityZoneOrigin(
  venueName: string,
  zoneName: string,
  sourceZoneId: number | null,
) {
  return `${venueName} / ${zoneName}${
    sourceZoneId === null ? "（本活动新建）" : ""
  }`;
}

/**
 * 排位状态。**五个展示态，只有四个落库**——"未配置"是环节开了排位开关但还
 * 没有方案行的派生结论，接口那边 `plan` 是 null（docs/场地排位底层设计.md §7）。
 */
export const PLAN_STATUS_LABELS = {
  pending: "待确认",
  confirmed: "已确认",
  rejected: "已退回",
  voided: "已作废",
} as const satisfies Record<PlanStatus, string>;

export const PLAN_STATUS_CHIP = {
  pending: "border-warning/30 bg-warning/10 text-warning-foreground",
  confirmed: "border-success/30 bg-success/10 text-success-foreground",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
  voided: "border-border bg-muted text-muted-foreground",
} as const satisfies Record<PlanStatus, string>;

export const UNCONFIGURED_CHIP =
  "border-border bg-muted text-muted-foreground" as const;

export const PLAN_STATUS_VALUES = Object.keys(
  PLAN_STATUS_LABELS,
) as PlanStatus[];
