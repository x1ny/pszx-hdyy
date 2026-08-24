import type {
  AgendaLine,
  AgendaLineType,
  Segment,
  SegmentStatus,
  SegmentType,
} from "./-queries";

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

// ---------------------------------------------------------------------------
// 时间格式化
// ---------------------------------------------------------------------------

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

export const formatTime = (value: string | Date) =>
  timeFormat.format(new Date(value));

const pad2 = (value: number) => String(value).padStart(2, "0");

const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const startOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * 同一天内的 "09:00 - 10:30"；跨日时把日期一起带上。
 *
 * 取结构类型而不是 `Segment`：人员冲突提示里拿到的只是环节的一小撮字段
 * （id / name / 起止时间），没必要为了复用这句格式化把整个 Segment 传进来。
 */
export const formatSegmentRange = (segment: {
  startTime: string;
  endTime: string;
}) => {
  const start = new Date(segment.startTime);
  const end = new Date(segment.endTime);
  const sameDay = localDayKey(start) === localDayKey(end);
  return sameDay
    ? `${formatTime(start)} - ${formatTime(end)}`
    : `${formatTime(start)} - ${dayFormat.format(end)} ${formatTime(end)}`;
};

// ---------------------------------------------------------------------------
// 线内序号：算出来的，不是存的
// ---------------------------------------------------------------------------

/**
 * 列表里的"顺序"列。原型的 `1` / `2` / `1-1` / `2-1` 是
 * `并行线序号-线内序号` 拼出来的展示值，不是录入值——同一议程线内时间重叠
 * 是阻断保存的，时间本身已经把线内顺序全序了，再存一份手填的顺序号只会跟
 * 时间打架（取舍见 docs/agenda-module-plan.md §1.4）。
 *
 * 作废环节不参与编号（它已经不在议程里了），返回 "-"。
 */
export function buildSequenceLabels(
  lines: AgendaLine[],
  segments: Segment[],
): Map<number, string> {
  const parallelIndex = new Map<number, number>();
  let parallelCount = 0;
  for (const line of lines) {
    if (line.lineType === "parallel") {
      parallelCount += 1;
      parallelIndex.set(line.id, parallelCount);
    }
  }

  const labels = new Map<number, string>();
  const counters = new Map<number, number>();

  // segments 由接口按 (startTime, id) 排好序，这里顺序遍历即可。
  for (const segment of segments) {
    if (segment.status !== "active") {
      labels.set(segment.id, "-");
      continue;
    }
    const next = (counters.get(segment.agendaLineId) ?? 0) + 1;
    counters.set(segment.agendaLineId, next);
    const prefix = parallelIndex.get(segment.agendaLineId);
    labels.set(segment.id, prefix ? `${prefix}-${next}` : String(next));
  }

  return labels;
}

// ---------------------------------------------------------------------------
// 议程时间轴
// ---------------------------------------------------------------------------

export type TimelineBlock = {
  segment: Segment;
  leftPct: number;
  widthPct: number;
  /** 结束时间越过当天 24:00，块被轴尾截断，卡片上要标注 */
  continuesNextDay: boolean;
};

export type TimelineLane = {
  line: AgendaLine;
  /** 正常只有一行；同线重叠（历史脏数据）时降级成多行而不是叠着画 */
  rows: TimelineBlock[][];
};

export type TimelineTick = { label: string; leftPct: number };

export type TimelineDay = {
  key: string;
  label: string;
  ticks: TimelineTick[];
  lanes: TimelineLane[];
  /** 跨议程线的时间重叠区块，纯视觉提示，不是业务字段 */
  bands: { leftPct: number; widthPct: number; count: number }[];
};

const MINUTE = 60_000;
const HALF_HOUR = 30 * MINUTE;
const DAY = 24 * 60 * MINUTE;
/** 只有一个 20 分钟环节时，别把它拉成占满整条轴 */
const MIN_SPAN = 2 * 60 * MINUTE;

type DayItem = { segment: Segment; startMs: number; endMs: number };

const tickStep = (span: number) => {
  if (span <= 6 * 60 * MINUTE) return HALF_HOUR;
  if (span <= 12 * 60 * MINUTE) return 60 * MINUTE;
  return 2 * 60 * MINUTE;
};

/**
 * 由已保存的环节推导议程时间轴。BR-DEV-031：时间轴不是独立保存对象，
 * 没有 timeline 表也没有 layout 接口，就是这一个纯函数。
 *
 * 与旧系统 segmentFlowchartBuilder.ts 的两处关键差异：
 *
 * 1. **按自然日分组，一天一条轴。** 旧实现是把一条轴拉长到覆盖整个跨度
 *    （`resolveTickStep` 里有 24h / 7d 的档位），三天的活动画出来每个环节
 *    都是一根细线。
 * 2. **最小宽度交给 CSS，不回头改百分比。** 旧实现用 60 行迭代碰撞检测去
 *    撑轨道宽度（`calculateTrackWidth`），改了百分比刻度线就对不上了；
 *    这里块宽严格按时间比例，太窄的靠 `min-width` + 轨道横向滚动解决。
 *
 * 时区：按**浏览器本地时区**分自然日。活动表没有场地时区字段，跨时区协作时
 * 不同人看到的分组可能差一天——已知边界，见 modules/agenda/schema.ts 的注释。
 */
export function buildAgendaTimeline(
  lines: AgendaLine[],
  segments: Segment[],
): TimelineDay[] {
  // BR-DEV-003B：作废环节不进议程展示。
  const active = segments.filter((segment) => segment.status === "active");
  if (active.length === 0) return [];

  const groups = new Map<string, DayItem[]>();
  for (const segment of active) {
    const start = new Date(segment.startTime);
    const key = localDayKey(start);
    const item: DayItem = {
      segment,
      startMs: start.getTime(),
      endMs: new Date(segment.endTime).getTime(),
    };
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const lineOrder = new Map(lines.map((line, index) => [line.id, index]));

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => {
      const dayStart = startOfLocalDay(new Date(items[0].startMs));
      const dayEnd = dayStart + DAY;

      // 轴范围：当天环节的最早开始 ~ 最晚结束（跨日的截到当天 24:00），
      // 向外取整到半小时。取整基于当天零点而不是 epoch——后者在非整点
      // 时区偏移下会算歪。
      const rawStart = Math.min(...items.map((item) => item.startMs));
      const rawEnd = Math.min(
        Math.max(...items.map((item) => item.endMs)),
        dayEnd,
      );

      let axisStart =
        dayStart + Math.floor((rawStart - dayStart) / HALF_HOUR) * HALF_HOUR;
      let axisEnd =
        dayStart + Math.ceil((rawEnd - dayStart) / HALF_HOUR) * HALF_HOUR;

      if (axisEnd - axisStart < MIN_SPAN) axisEnd = axisStart + MIN_SPAN;
      if (axisEnd > dayEnd) {
        axisEnd = dayEnd;
        axisStart = Math.max(dayStart, axisEnd - MIN_SPAN);
      }

      const span = axisEnd - axisStart;
      const pct = (ms: number) => ((ms - axisStart) / span) * 100;

      const step = tickStep(span);
      const ticks: TimelineTick[] = [];
      const firstAligned =
        dayStart + Math.ceil((axisStart - dayStart) / step) * step;
      if (firstAligned > axisStart) {
        ticks.push({ label: formatTime(new Date(axisStart)), leftPct: 0 });
      }
      for (let t = firstAligned; t <= axisEnd; t += step) {
        ticks.push({ label: formatTime(new Date(t)), leftPct: pct(t) });
      }

      const byLine = new Map<number, DayItem[]>();
      for (const item of items) {
        const bucket = byLine.get(item.segment.agendaLineId);
        if (bucket) bucket.push(item);
        else byLine.set(item.segment.agendaLineId, [item]);
      }

      const lanes: TimelineLane[] = [...byLine.entries()]
        .sort(
          ([a], [b]) =>
            (lineOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (lineOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
        )
        .flatMap(([lineId, laneItems]) => {
          const line = lines.find((candidate) => candidate.id === lineId);
          if (!line) return [];
          return [{ line, rows: packRows(laneItems, dayEnd, pct) }];
        });

      return {
        key,
        label: dayFormat.format(new Date(dayStart)),
        ticks,
        lanes,
        bands: buildBands(items, dayEnd, pct),
      };
    });
}

/**
 * 同一条议程线内理论上不会重叠（保存时已阻断），但布局仍要容错：真遇到
 * 重叠就摞成多行，不要叠在一起画，也不要抛异常。历史脏数据、手工 SQL、
 * 以后放宽规则都会走到这个分支。
 */
function packRows(
  items: DayItem[],
  dayEnd: number,
  pct: (ms: number) => number,
): TimelineBlock[][] {
  const sorted = [...items].sort(
    (a, b) => a.startMs - b.startMs || a.segment.id - b.segment.id,
  );

  const rows: { endMs: number; blocks: TimelineBlock[] }[] = [];

  for (const item of sorted) {
    const clampedEnd = Math.min(item.endMs, dayEnd);
    const block: TimelineBlock = {
      segment: item.segment,
      leftPct: pct(item.startMs),
      // 零时长环节宽度就是 0，靠 CSS min-width 撑出可点击的宽度。
      widthPct: Math.max(pct(clampedEnd) - pct(item.startMs), 0),
      continuesNextDay: item.endMs > dayEnd,
    };

    const row = rows.find((candidate) => item.startMs >= candidate.endMs);
    if (row) {
      row.blocks.push(block);
      row.endMs = Math.max(row.endMs, clampedEnd);
    } else {
      rows.push({ endMs: clampedEnd, blocks: [block] });
    }
  }

  return rows.map((row) => row.blocks);
}

/**
 * 并行区块：BR-DEV-031B 要求"由系统根据时间重叠和议程线自动推导，不作为
 * 业务必填字段"。只用来画一条背景色带做视觉提示，不落库。
 *
 * 要求至少两条**不同的议程线**才算并行——同一条线上的重叠是上面那个降级
 * 分支处理的脏数据，不该被标成"并行"。
 */
function buildBands(
  items: DayItem[],
  dayEnd: number,
  pct: (ms: number) => number,
) {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs);
  const bands: { leftPct: number; widthPct: number; count: number }[] = [];

  let cluster: DayItem[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flush = () => {
    const lineIds = new Set(cluster.map((item) => item.segment.agendaLineId));
    if (cluster.length > 1 && lineIds.size > 1) {
      const start = Math.min(...cluster.map((item) => item.startMs));
      const end = Math.min(
        Math.max(...cluster.map((item) => item.endMs)),
        dayEnd,
      );
      bands.push({
        leftPct: pct(start),
        widthPct: Math.max(pct(end) - pct(start), 0),
        count: cluster.length,
      });
    }
    cluster = [];
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMs >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, Math.min(item.endMs, dayEnd));
  }
  flush();

  return bands;
}
