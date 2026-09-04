import type {
  AgendaLine,
  AgendaLineType,
  SegmentStatus,
  SegmentType,
} from "./queries";

/**
 * 议程域的中文标签与配色。
 *
 * 放 features/ 而不是某个路由的 -utils.ts：议程页和环节配置页两个消费方分别
 * 住在两个路由目录下，谁 import 谁都是跨路由深路径（AGENTS.md 里那条铁律）。
 */
// ---------------------------------------------------------------------------
// 中文标签与配色
// ---------------------------------------------------------------------------

export const SEGMENT_TYPE_LABELS = {
  keynote: "主题演讲",
  forum: "分论坛",
  negotiation: "洽谈",
  reception: "接待",
  other: "其他",
} as const satisfies Record<SegmentType, string>;

export const SEGMENT_TYPE_VALUES = Object.keys(
  SEGMENT_TYPE_LABELS,
) as SegmentType[];

/**
 * 环节类型是"多个平级分类"，按 chart-1..5 固定轮转（`--chart-*` 是过了色觉
 * 障碍校验的真彩色）。`satisfies` 把两边咬死：服务端加一个类型，这里不补
 * 颜色就编译不过。
 */
export const SEGMENT_TYPE_BADGE_CLASS = {
  keynote: "border-transparent bg-chart-1/10 text-chart-1",
  forum: "border-transparent bg-chart-2/10 text-chart-2",
  negotiation: "border-transparent bg-chart-3/10 text-chart-3",
  reception: "border-transparent bg-chart-4/10 text-chart-4",
  other: "border-transparent bg-chart-5/10 text-chart-5",
} as const satisfies Record<SegmentType, string>;

export const SEGMENT_STATUS_LABELS = {
  active: "正常",
  voided: "作废",
} as const satisfies Record<SegmentStatus, string>;

/** 状态色（success/warning）是保留色，不参与上面的分类轮转。 */
export const SEGMENT_STATUS_CHIP = {
  active: "border-success/30 bg-success/10 text-success-foreground",
  voided: "border-border bg-muted text-muted-foreground",
} as const satisfies Record<SegmentStatus, string>;

export const AGENDA_LINE_TYPE_LABELS = {
  main: "主线",
  parallel: "并行线",
} as const satisfies Record<AgendaLineType, string>;

/** 主线的名字可以为空，展示时兜成"主线"。 */
export const lineLabel = (line: AgendaLine) =>
  line.name || AGENDA_LINE_TYPE_LABELS[line.lineType];
