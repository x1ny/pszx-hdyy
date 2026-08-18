import type {
  ActivityResource,
  DemandHandling,
  DemandStatus,
  ResourceDemand,
  ResourceStatus,
  ResourceType,
  TransportScene,
} from "./queries";

// ---------------------------------------------------------------------------
// 中文标签与配色
// ---------------------------------------------------------------------------

export const RESOURCE_TYPE_LABELS = {
  transport: "用车",
  dining: "用餐",
  accommodation: "住宿",
  material: "物料",
} as const satisfies Record<ResourceType, string>;

export const RESOURCE_TYPE_VALUES = Object.keys(
  RESOURCE_TYPE_LABELS,
) as ResourceType[];

/**
 * 资源类型是"多个平级分类"，按 chart-1..4 固定轮转（`--chart-*` 是过了色觉
 * 障碍校验的真彩色，不是 shadcn 原装灰阶）。`satisfies` 把两边咬死：服务端
 * 加一类资源，这里不补颜色就编译不过。
 */
export const RESOURCE_TYPE_BADGE_CLASS = {
  transport: "border-transparent bg-chart-1/10 text-chart-1",
  dining: "border-transparent bg-chart-2/10 text-chart-2",
  accommodation: "border-transparent bg-chart-3/10 text-chart-3",
  material: "border-transparent bg-chart-4/10 text-chart-4",
} as const satisfies Record<ResourceType, string>;

/** 人员服务型资源才绑人，物料不绑（BR-DEV-033A）。与服务端同一口径。 */
export const PERSONAL_SERVICE_TYPES: readonly ResourceType[] = [
  "transport",
  "dining",
  "accommodation",
];

export const bindable = (resourceType: ResourceType) =>
  PERSONAL_SERVICE_TYPES.includes(resourceType);

export const DEMAND_HANDLING_LABELS = {
  record_only: "仅记录需求",
  arrange: "需落实安排",
} as const satisfies Record<DemandHandling, string>;

export const DEMAND_HANDLING_VALUES = Object.keys(
  DEMAND_HANDLING_LABELS,
) as DemandHandling[];

/** 处理要求各自的一句话说明，直接放进表单的选项描述里。 */
export const DEMAND_HANDLING_HINTS = {
  record_only: "只留需求说明，不进待办，不要求在台账里建记录",
  arrange: "进资源需求待办，需要在活动资源台账里建记录或关联已有记录",
} as const satisfies Record<DemandHandling, string>;

export const DEMAND_STATUS_LABELS = {
  recorded: "仅记录",
  pending: "待配置",
  configuring: "配置中",
  configured: "已配置",
} as const satisfies Record<DemandStatus, string>;

export const DEMAND_STATUS_VALUES = Object.keys(
  DEMAND_STATUS_LABELS,
) as DemandStatus[];

/**
 * 状态色（success/warning）是保留色，不参与上面的分类轮转——一个颜色要么
 * 表示"哪一类"要么表示"什么状态"，两用了用户没法从颜色反推含义。
 *
 * 只有 pending 是需要被看见的那一档（真正的缺口），所以给 destructive；
 * configuring 是 warning（在路上）；recorded 走中性——它不是待办，不该在
 * 汇总页上和真缺口抢注意力。
 */
export const DEMAND_STATUS_CHIP = {
  recorded: "border-border bg-muted text-muted-foreground",
  pending: "border-destructive/30 bg-destructive/10 text-destructive",
  configuring: "border-warning/30 bg-warning/10 text-warning-foreground",
  configured: "border-success/30 bg-success/10 text-success-foreground",
} as const satisfies Record<DemandStatus, string>;

export const TRANSPORT_SCENE_LABELS = {
  activity: "活动用车",
  pickup: "到达接送",
  dropoff: "离开送站",
} as const satisfies Record<TransportScene, string>;

export const TRANSPORT_SCENE_VALUES = Object.keys(
  TRANSPORT_SCENE_LABELS,
) as TransportScene[];

export const RESOURCE_STATUS_LABELS = {
  active: "正常",
  voided: "作废",
} as const satisfies Record<ResourceStatus, string>;

export const RESOURCE_STATUS_CHIP = {
  active: "border-success/30 bg-success/10 text-success-foreground",
  voided: "border-border bg-muted text-muted-foreground",
} as const satisfies Record<ResourceStatus, string>;

// ---------------------------------------------------------------------------
// Select 的 items
// ---------------------------------------------------------------------------

/**
 * ⚠️ Base UI 的 `<Select>` **必须传 `items`**，否则 `<SelectValue />` 直接把
 * 原始值渲染出来——用户看到的是 `transport`、`arrange`、`all` 这种英文枚举值，
 * 而不是中文标签。踩过一次：新写的几个下拉全都漏了 `items`。
 *
 * 所以标签映射之外还要维护一份 `{ value, label }[]`，各页面统一从这里取，
 * 不要在页面里现拼——现拼就会有下一个漏传的。
 *
 * 「全部」项的 value 是 **null 而不是 "all"**（沿用 supplier 的口径）：
 * 筛选项在 URL 上的语义就是"缺省 = 不筛"，用哨兵字符串的话每个回调都要多写
 * 一次 `value === "all" ? undefined : value` 的转换。
 */
const withAll = <T extends string>(
  allLabel: string,
  values: readonly T[],
  labels: Record<T, string>,
): { value: T | null; label: string }[] => [
  { value: null, label: allLabel },
  ...values.map((value) => ({ value, label: labels[value] })),
];

const plain = <T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
) => values.map((value) => ({ value, label: labels[value] }));

export const RESOURCE_TYPE_ITEMS = plain(
  RESOURCE_TYPE_VALUES,
  RESOURCE_TYPE_LABELS,
);
export const RESOURCE_TYPE_FILTER_ITEMS = withAll(
  "全部类型",
  RESOURCE_TYPE_VALUES,
  RESOURCE_TYPE_LABELS,
);

export const TRANSPORT_SCENE_ITEMS = plain(
  TRANSPORT_SCENE_VALUES,
  TRANSPORT_SCENE_LABELS,
);
export const TRANSPORT_SCENE_FILTER_ITEMS = withAll(
  "全部场景",
  TRANSPORT_SCENE_VALUES,
  TRANSPORT_SCENE_LABELS,
);

export const DEMAND_HANDLING_ITEMS = plain(
  DEMAND_HANDLING_VALUES,
  DEMAND_HANDLING_LABELS,
);

export const DEMAND_STATUS_FILTER_ITEMS = withAll(
  "全部状态",
  DEMAND_STATUS_VALUES,
  DEMAND_STATUS_LABELS,
);

export const RESOURCE_STATUS_VALUES = Object.keys(
  RESOURCE_STATUS_LABELS,
) as ResourceStatus[];

export const RESOURCE_STATUS_FILTER_ITEMS = withAll(
  "全部状态",
  RESOURCE_STATUS_VALUES,
  RESOURCE_STATUS_LABELS,
);

// ---------------------------------------------------------------------------
// 展示口径
// ---------------------------------------------------------------------------

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const timeOnlyFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * 资源的使用时间。住宿是区间（"11-17 14:00 至 11-20 12:00"），用车用餐是
 * 时刻，物料可能两头都空——三种形状一个函数收口，各页面不要自己拼。
 *
 * 跨日时结束端**必须连时刻一起显示**。这里踩过一次：原本跨日只显示到"月-日"，
 * 于是住宿记录渲染成"11-17 14:00 至 11-20"，退房时间凭空消失了——而退房时刻
 * 恰恰是住宿这类资源上最需要看到的信息之一。同日才省略重复的日期。
 */
export const formatResourceTime = (
  resource: Pick<ActivityResource, "startTime" | "endTime">,
) => {
  if (!resource.startTime && !resource.endTime) return "-";
  if (resource.startTime && !resource.endTime) {
    return dateTimeFormat.format(new Date(resource.startTime));
  }
  if (!resource.startTime && resource.endTime) {
    return `至 ${dateTimeFormat.format(new Date(resource.endTime))}`;
  }
  const start = new Date(resource.startTime as string);
  const end = new Date(resource.endTime as string);
  const sameDay = start.toDateString() === end.toDateString();
  return `${dateTimeFormat.format(start)} 至 ${
    sameDay ? timeOnlyFormat.format(end) : dateTimeFormat.format(end)
  }`;
};

/** 用车记录展示成"用车 · 到达接送"，其余类型只有类型名。 */
export const resourceTypeLabel = (
  resource: Pick<ActivityResource, "resourceType" | "transportScene">,
) =>
  resource.resourceType === "transport" && resource.transportScene
    ? `${RESOURCE_TYPE_LABELS.transport} · ${TRANSPORT_SCENE_LABELS[resource.transportScene]}`
    : RESOURCE_TYPE_LABELS[resource.resourceType];

/**
 * 汇总页/议程页统一的"这条需求算不算待办"。
 *
 * 作废环节的需求项不算——环节都不在议程上了，它的用车需求不该再催人配。
 * 服务端照常返回这些行（同 agenda/list 的口径：全量返回、视图各自过滤），
 * 过滤规则收在这里，三个视图不要各写一遍。
 */
export const isOpenTodo = (demand: ResourceDemand) =>
  demand.segmentStatus === "active" &&
  (demand.status === "pending" || demand.status === "configuring");
