import type {
  ActivityVenueStatus,
  OrganizationSeatingStat,
  PlanAssignmentRow,
  PlanSeatRow,
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

/**
 * 候选人员列表需要的团体展示信息。
 *
 * `seatLabels` 只包含团体占位，不包含同一团体成员的个人排座。个人排座和
 * 团体占位是两种不同的业务语义，不能因为 `getPlan` 为个人分配也返回了团体
 * 快照，就把个人座位误显示成团体座位。
 */
export type OrganizationSeatInfo = {
  name: string;
  seatLabels: readonly string[];
};

type OrganizationAssignmentForDisplay = Pick<
  PlanAssignmentRow,
  "segmentSeatId" | "occupantType" | "organizationId" | "organizationName"
>;

type SeatForDisplay = Pick<PlanSeatRow, "id" | "label" | "ordinal">;

type OrganizationForDisplay = Pick<
  OrganizationSeatingStat,
  "organizationId" | "name"
>;

/**
 * 把当前排位方案和当前环节团体范围组合成候选列表可直接消费的索引。
 *
 * `assignments` 来自 `getPlan`，服务端已经过滤掉撤销记录；这里仍然只接受
 * `occupantType === "organization"`，因为个人分配行也会带上进入环节时的团体
 * 快照。位置按方案的 `ordinal` 排序，避免数据库返回顺序变化导致界面顺序跳动。
 */
export function buildOrganizationSeatInfoById({
  assignments,
  seats,
  organizations,
}: {
  assignments: readonly OrganizationAssignmentForDisplay[];
  seats: readonly SeatForDisplay[];
  organizations: readonly OrganizationForDisplay[];
}): ReadonlyMap<number, OrganizationSeatInfo> {
  const infoByOrganizationId = new Map<
    number,
    { name: string; seatLabels: string[] }
  >();

  for (const organization of organizations) {
    infoByOrganizationId.set(organization.organizationId, {
      name: organization.name,
      seatLabels: [],
    });
  }

  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const groupSeatsByOrganizationId = new Map<number, SeatForDisplay[]>();

  for (const assignment of assignments) {
    if (assignment.organizationId === null) continue;

    const existing = infoByOrganizationId.get(assignment.organizationId);
    if (!existing) {
      infoByOrganizationId.set(assignment.organizationId, {
        name: assignment.organizationName ?? "",
        seatLabels: [],
      });
    } else if (!existing.name && assignment.organizationName) {
      existing.name = assignment.organizationName;
    }

    // 个人分配同样能提供当前环节的团体名称，但只有团体分配才能提供团体座位。
    if (assignment.occupantType !== "organization") continue;

    const seat = seatById.get(assignment.segmentSeatId);
    if (!seat) continue;

    const groupSeats =
      groupSeatsByOrganizationId.get(assignment.organizationId) ?? [];
    groupSeats.push(seat);
    groupSeatsByOrganizationId.set(assignment.organizationId, groupSeats);
  }

  for (const [organizationId, groupSeats] of groupSeatsByOrganizationId) {
    const info = infoByOrganizationId.get(organizationId);
    if (!info) continue;

    const labels = new Set<string>();
    for (const seat of groupSeats.sort(
      (left, right) => left.ordinal - right.ordinal || left.id - right.id,
    )) {
      labels.add(seat.label);
    }
    info.seatLabels = [...labels];
  }

  const result = new Map<number, OrganizationSeatInfo>();
  for (const [organizationId, info] of infoByOrganizationId) {
    result.set(organizationId, {
      name: info.name,
      seatLabels: [...info.seatLabels],
    });
  }
  return result;
}
