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

const formatRange = (start: Date, end: Date) => {
  const sameDay = localDayKey(start) === localDayKey(end);
  return sameDay
    ? `${formatTime(start)} - ${formatTime(end)}`
    : `${formatTime(start)} - ${dayFormat.format(end)} ${formatTime(end)}`;
};

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
  return formatRange(new Date(segment.startTime), new Date(segment.endTime));
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
  /** 该块所在自然日的零点，跨日续接块的展示起点使用它（即当天 00:00）。 */
  dayStartMs: number;
  /** 环节从前一天延续过来：当天看到的开头不是它真正的开始时间 */
  continuesFromPrevDay: boolean;
  /** 环节还要延续到后面：当天看到的结尾不是它真正的结束时间 */
  continuesNextDay: boolean;
};

/**
 * 时间轴卡片的起止时间。
 *
 * 续接到当天的块从当天 00:00 开始展示，避免第二天仍显示前一天的原始开始
 * 时间造成歧义；卡片里的名称、类型、地点等信息仍然来自同一个 segment。列表、
 * 详情和编辑表单继续使用 formatSegmentRange() 展示环节的完整真实时间。
 */
export const formatTimelineBlockRange = (
  segment: Pick<Segment, "startTime" | "endTime">,
  block: Pick<TimelineBlock, "dayStartMs" | "continuesFromPrevDay">,
) => {
  const start = block.continuesFromPrevDay
    ? new Date(block.dayStartMs)
    : new Date(segment.startTime);
  return formatRange(start, new Date(segment.endTime));
};

export type TimelineLane = {
  line: AgendaLine;
  /** 正常只有一行；同线重叠（历史脏数据）时降级成多行而不是叠着画 */
  rows: TimelineBlock[][];
};

export type TimelineTick = { label: string; leftPct: number };

export type TimelineBand = {
  /** 整个连续并行区间，用于统计“一处并行”的范围。 */
  leftPct: number;
  widthPct: number;
  /** 该并行区间曾参与的议程线数量。 */
  count: number;
  /**
   * 各议程线真正参与并行的区间。同一条线可能中途退出后再次加入，所以可能
   * 有多段；渲染时只把对应线的这些区间画到它自己的泳道里。
   */
  laneRanges: { lineId: number; leftPct: number; widthPct: number }[];
};

export type TimelineDay = {
  key: string;
  label: string;
  ticks: TimelineTick[];
  lanes: TimelineLane[];
  /** 当天轴上画出来的块数，跨日环节的续接段也算一块 */
  segmentCount: number;
  /** 其中从前一天续过来的块数，用来在日卡片上把"当天新开始"和"续接"分开说 */
  carryOverCount: number;
  /** 跨议程线的真实时间重叠区块，纯视觉提示，不是业务字段 */
  bands: TimelineBand[];
};

const MINUTE = 60_000;
const HALF_HOUR = 30 * MINUTE;
/** 只有一个 20 分钟环节时，别把它拉成占满整条轴 */
const MIN_SPAN = 2 * 60 * MINUTE;
/**
 * 一个环节最多摊开成多少张日卡片。超出活动范围只提示不阻断，万一录进来一个
 * 跨半年的环节，不能真画出 180 张卡片。截断处的块仍然带 `continuesNextDay`，
 * 加上卡片上写的是真实结束时间，界面上看得出来"还没完"。
 */
const MAX_SPAN_DAYS = 31;

type DayItem = {
  segment: Segment;
  /** 该块所属自然日的零点 */
  dayStartMs: number;
  /** 裁剪到当天之内的可见区间，块的位置和宽度按它算 */
  visibleStartMs: number;
  visibleEndMs: number;
  continuesFromPrevDay: boolean;
  continuesNextDay: boolean;
};

const tickStep = (span: number) => {
  if (span <= 6 * 60 * MINUTE) return HALF_HOUR;
  if (span <= 12 * 60 * MINUTE) return 60 * MINUTE;
  return 2 * 60 * MINUTE;
};

/** 按本地日历取次日零点，而不是加 86_400_000——有夏令时的时区加不出零点。 */
const nextLocalDay = (dayStartMs: number) => {
  const date = new Date(dayStartMs);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  ).getTime();
};

/**
 * 把一个环节摊成「它覆盖的每个自然日各一块」。
 *
 * 单日环节摊出来还是一块；8/20 20:00 → 8/22 09:00 摊成三块：8/20 的
 * 20:00–24:00、8/21 的整天、8/22 的 00:00–09:00。三块指向同一个 segment，
 * 由 continuesFromPrevDay / continuesNextDay 表达「这天看到的只是其中一段」。
 */
function expandSegmentDays(segment: Segment): DayItem[] {
  const startMs = new Date(segment.startTime).getTime();
  const endMs = new Date(segment.endTime).getTime();

  const items: DayItem[] = [];
  let dayStartMs = startOfLocalDay(new Date(startMs));

  for (let index = 0; index < MAX_SPAN_DAYS; index += 1) {
    const dayEndMs = nextLocalDay(dayStartMs);

    items.push({
      segment,
      dayStartMs,
      visibleStartMs: Math.max(startMs, dayStartMs),
      visibleEndMs: Math.min(endMs, dayEndMs),
      continuesFromPrevDay: startMs < dayStartMs,
      continuesNextDay: endMs > dayEndMs,
    });

    // `<=` 而不是 `<`：结束时间正好压在零点的环节到此为止，不要在次日再摊出
    // 一个零宽的续接块。
    if (endMs <= dayEndMs) break;
    dayStartMs = dayEndMs;
  }

  return items;
}

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
 * 分组口径是**环节覆盖的自然日**，不是它开始的那一天：跨日环节在它经过的
 * 每一天都要画出来（中间的整天铺满，末日画到真实结束时间），否则续接日的
 * 泳道看上去是空的，运营会往一个已经被占住的时段里排新环节。同理，只被
 * 跨日环节覆盖、当天没有新环节开始的日子也要出卡片。
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
    for (const item of expandSegmentDays(segment)) {
      const key = localDayKey(new Date(item.dayStartMs));
      const bucket = groups.get(key);
      if (bucket) bucket.push(item);
      else groups.set(key, [item]);
    }
  }

  const lineOrder = new Map(lines.map((line, index) => [line.id, index]));

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => {
      const dayStart = items[0].dayStartMs;
      const dayEnd = nextLocalDay(dayStart);

      // 轴范围：当天可见区间的最早开始 ~ 最晚结束，向外取整到半小时。取整
      // 基于当天零点而不是 epoch——后者在非整点时区偏移下会算歪。续接段是从
      // 零点起算的，所以有环节续过来的那天，轴自然就从 00:00 开始。
      const rawStart = Math.min(...items.map((item) => item.visibleStartMs));
      const rawEnd = Math.max(...items.map((item) => item.visibleEndMs));

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
          return [{ line, rows: packRows(laneItems, pct) }];
        });

      // 计数按真正画出来的块走而不是按 items：挂在已删议程线上的脏数据会被
      // 上面的 flatMap 丢掉，卡片上的数字不能把它算进去。
      const drawn = lanes.flatMap((lane) => lane.rows.flat());

      return {
        key,
        label: dayFormat.format(new Date(dayStart)),
        ticks,
        lanes,
        segmentCount: drawn.length,
        carryOverCount: drawn.filter((block) => block.continuesFromPrevDay)
          .length,
        bands: buildBands(items, pct),
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
  pct: (ms: number) => number,
): TimelineBlock[][] {
  const sorted = [...items].sort(
    (a, b) =>
      a.visibleStartMs - b.visibleStartMs || a.segment.id - b.segment.id,
  );

  const rows: { endMs: number; blocks: TimelineBlock[] }[] = [];

  for (const item of sorted) {
    const block: TimelineBlock = {
      segment: item.segment,
      leftPct: pct(item.visibleStartMs),
      // 零时长环节宽度就是 0，靠 CSS min-width 撑出可点击的宽度。
      widthPct: Math.max(pct(item.visibleEndMs) - pct(item.visibleStartMs), 0),
      dayStartMs: item.dayStartMs,
      continuesFromPrevDay: item.continuesFromPrevDay,
      continuesNextDay: item.continuesNextDay,
    };

    const row = rows.find(
      (candidate) => item.visibleStartMs >= candidate.endMs,
    );
    if (row) {
      row.blocks.push(block);
      row.endMs = Math.max(row.endMs, item.visibleEndMs);
    } else {
      rows.push({ endMs: item.visibleEndMs, blocks: [block] });
    }
  }

  return rows.map((row) => row.blocks);
}

/**
 * 并行区块：BR-DEV-031B 要求"由系统根据时间重叠和议程线自动推导，不作为
 * 业务必填字段"。只用来画背景色带做视觉提示，不落库。
 *
 * 要求至少两条**不同的议程线**才算并行——同一条线上的重叠是上面那个降级
 * 分支处理的脏数据，不该被标成"并行"。
 *
 * 吃的是摊到当天的可见区间，所以从前一天续过来的环节压住了当天新开的环节
 * 时，一样会被标成并行。
 *
 * 不能直接拿一组相交环节的最早开始和最晚结束画色带：一个跨日长环节只和
 * 短环节重叠一小时，那样会把剩余十几个小时也误画成并行。这里先按所有起止
 * 边界切出“当前至少两条线同时存在”的精确片段，再把连续且仍有共同参与线的
 * 片段合成一处并行；每条泳道最后只拿自己真正参与的区间。
 */
function buildBands(items: DayItem[], pct: (ms: number) => number) {
  const boundaries = [
    ...new Set(
      items.flatMap((item) =>
        item.visibleEndMs > item.visibleStartMs
          ? [item.visibleStartMs, item.visibleEndMs]
          : [],
      ),
    ),
  ].sort((a, b) => a - b);

  type ParallelSlice = {
    startMs: number;
    endMs: number;
    lineIds: number[];
  };

  const slices: ParallelSlice[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMs = boundaries[index];
    const endMs = boundaries[index + 1];
    const lineIds = [
      ...new Set(
        items
          .filter(
            (item) =>
              item.visibleStartMs < endMs && item.visibleEndMs > startMs,
          )
          .map((item) => item.segment.agendaLineId),
      ),
    ].sort((a, b) => a - b);

    if (lineIds.length > 1) slices.push({ startMs, endMs, lineIds });
  }

  const regions: ParallelSlice[][] = [];
  for (const slice of slices) {
    const current = regions[regions.length - 1];
    const previous = current?.[current.length - 1];
    const staysConnected =
      previous?.endMs === slice.startMs &&
      previous.lineIds.some((lineId) => slice.lineIds.includes(lineId));

    if (current && staysConnected) current.push(slice);
    else regions.push([slice]);
  }

  return regions.map((region): TimelineBand => {
    const laneRanges = new Map<number, { startMs: number; endMs: number }[]>();

    for (const slice of region) {
      for (const lineId of slice.lineIds) {
        const ranges = laneRanges.get(lineId) ?? [];
        const previous = ranges[ranges.length - 1];
        if (previous?.endMs === slice.startMs) previous.endMs = slice.endMs;
        else ranges.push({ startMs: slice.startMs, endMs: slice.endMs });
        laneRanges.set(lineId, ranges);
      }
    }

    const startMs = region[0].startMs;
    const endMs = region[region.length - 1].endMs;

    return {
      leftPct: pct(startMs),
      widthPct: Math.max(pct(endMs) - pct(startMs), 0),
      count: laneRanges.size,
      laneRanges: [...laneRanges.entries()].flatMap(([lineId, ranges]) =>
        ranges.map((range) => ({
          lineId,
          leftPct: pct(range.startMs),
          widthPct: Math.max(pct(range.endMs) - pct(range.startMs), 0),
        })),
      ),
    };
  });
}
