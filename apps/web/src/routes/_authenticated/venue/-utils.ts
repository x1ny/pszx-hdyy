import type {
  SeatKind,
  SeatRank,
  VenueProjection,
  ZoneKind,
} from "#/features/venue-editor/contract";
import type { VenueLayoutBundle, VenueStatus } from "./-queries";

// ---------------------------------------------------------------------------
// 中文标签只存在于前端。服务端只管"这个字段允许哪些值"，展示成什么字是前端的事。
// 两边靠 `satisfies Record<枚举, string>` 咬死：服务端加一个值、这里不补标签就
// 编译不过，不会出现"界面上显示成英文 key"的漂移。
// ---------------------------------------------------------------------------

export const VENUE_STATUS_LABELS = {
  enabled: "启用",
  disabled: "停用",
} as const satisfies Record<VenueStatus, string>;

export const ZONE_KIND_LABELS = {
  seating: "座席区",
  function: "功能区",
  checkin: "签到区",
  material: "物料区",
} as const satisfies Record<ZoneKind, string>;

export const SEAT_KIND_LABELS = {
  seat: "座位",
  standing: "站位",
} as const satisfies Record<SeatKind, string>;

export const SEAT_RANK_LABELS = {
  normal: "普通",
  vip: "重要",
} as const satisfies Record<SeatRank, string>;

/**
 * 状态芯片用**保留的状态色**，不是分类色板——一个颜色要么表示"哪一类"要么
 * 表示"什么状态"，两用了用户就没法从颜色反推含义。
 *
 * "停用"用中性灰而不是红：它是"这个场地暂时不用了"，不是错误。
 */
export const VENUE_STATUS_CHIP = {
  enabled: "border-success/30 bg-success/10 text-success-foreground",
  disabled: "border-border bg-muted text-muted-foreground",
} as const satisfies Record<VenueStatus, string>;

export const VENUE_STATUS_DOT = {
  enabled: "bg-success",
  disabled: "bg-muted-foreground/40",
} as const satisfies Record<VenueStatus, string>;

/** 区域类型标签配色，按声明顺序轮转分配色板槽位，不哈希。 */
export const ZONE_KIND_BADGE_CLASS = {
  seating: "border-transparent bg-chart-1/10 text-chart-1",
  function: "border-transparent bg-chart-2/10 text-chart-2",
  checkin: "border-transparent bg-chart-3/10 text-chart-3",
  material: "border-transparent bg-chart-4/10 text-chart-4",
} as const satisfies Record<ZoneKind, string>;

/** 重要等级只有两档，用状态色而不是分类色：它表达的是"要不要特别对待"。 */
export const SEAT_RANK_BADGE_CLASS = {
  normal: "border-border bg-muted text-muted-foreground",
  vip: "border-warning/30 bg-warning/10 text-warning-foreground",
} as const satisfies Record<SeatRank, string>;

export const VENUE_STATUS_VALUES = Object.keys(
  VENUE_STATUS_LABELS,
) as VenueStatus[];

export const ZONE_KIND_VALUES = Object.keys(ZONE_KIND_LABELS) as ZoneKind[];

export const SEAT_KIND_VALUES = Object.keys(SEAT_KIND_LABELS) as SeatKind[];

export const SEAT_RANK_VALUES = Object.keys(SEAT_RANK_LABELS) as SeatRank[];

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 接口给的是 ISO 字符串（timestamptz 序列化的结果），按浏览器本地时区展示。 */
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTimeFormat.format(new Date(iso)) : "-";

/**
 * 把 getLayout 返回的区域和位置还原成编辑器认识的投影形状。
 *
 * 一处必要的翻译：接口给位置带的是数字外键 `zoneId`（那是核心表的身份），
 * 而编辑器内部一律按 `externalId` 关联。区域行上两者都有，所以映射得起来。
 *
 * 两个编辑器都要用它——**降级视图和"从表单式升级到画布"走的都是这条路**：
 * 核心表里的结构足够重建任何一个编辑器的初始状态，不依赖 blob 里的任何字节。
 */
export function bundleToProjection(bundle: VenueLayoutBundle): VenueProjection {
  const externalIdByZoneId = new Map(
    bundle.zones.map((zone) => [zone.id, zone.externalId]),
  );

  return {
    zones: bundle.zones.map(({ externalId, name, kind, ordinal }) => ({
      externalId,
      name,
      kind,
      ordinal,
    })),
    seats: bundle.seats.flatMap((seat) => {
      const zoneExternalId = externalIdByZoneId.get(seat.zoneId);
      if (!zoneExternalId) return [];
      return [
        {
          externalId: seat.externalId,
          zoneExternalId,
          label: seat.label,
          kind: seat.kind,
          rank: seat.rank,
          ordinal: seat.ordinal,
        },
      ];
    }),
  };
}
