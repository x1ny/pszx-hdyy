import { describe, expect, it } from "vitest";
import type { AgendaLine, Segment } from "#/features/agenda/queries";
import {
  buildAgendaTimeline,
  buildSequenceLabels,
  formatSegmentRange,
  formatTimelineBlockRange,
  TIMELINE_PX_PER_MINUTE,
} from "./-utils";

// 时间轴是这个模块唯一有真实算法的地方，也是唯一不点页面就能验证的地方。
// 用例都写成本地时区的字面时间，函数内部也按本地时区分自然日，所以不受
// 跑测试的机器在哪个时区影响。

const line = (
  id: number,
  lineType: AgendaLine["lineType"],
  name: string | null,
  sortOrder = 0,
): AgendaLine => ({ id, activityId: 1, lineType, name, sortOrder });

let nextId = 0;
const segment = (
  agendaLineId: number,
  start: string,
  end: string,
  overrides: Partial<Segment> = {},
): Segment => {
  nextId += 1;
  return {
    id: nextId,
    activityId: 1,
    agendaLineId,
    name: `环节 ${nextId}`,
    segmentType: "other",
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    locationText: null,
    description: null,
    ownerName: null,
    status: "active",
    memberEnabled: false,
    seatingEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
};

const MAIN = line(1, "main", null);
const FORUM_A = line(2, "parallel", "分论坛 A", 1);
const FORUM_B = line(3, "parallel", "分论坛 B", 2);
const FORUM_C = line(4, "parallel", "分论坛 C", 3);

describe("buildAgendaTimeline", () => {
  it("没有正常环节时返回空数组", () => {
    expect(buildAgendaTimeline([MAIN], [])).toEqual([]);
    expect(
      buildAgendaTimeline(
        [MAIN],
        [
          segment(1, "2026-09-18 09:00", "2026-09-18 10:00", {
            status: "voided",
          }),
        ],
      ),
    ).toEqual([]);
  });

  it("单日串行：一天、一条泳道、一行、无并行带", () => {
    const days = buildAgendaTimeline(
      [MAIN],
      [
        segment(1, "2026-09-18 09:00", "2026-09-18 09:40"),
        segment(1, "2026-09-18 09:50", "2026-09-18 11:30"),
        segment(1, "2026-09-18 16:00", "2026-09-18 17:00"),
      ],
    );

    expect(days).toHaveLength(1);
    expect(days[0].lanes).toHaveLength(1);
    expect(days[0].lanes[0].rows).toHaveLength(1);
    expect(days[0].lanes[0].rows[0]).toHaveLength(3);
    expect(days[0].bands).toHaveLength(0);

    // 轴按半小时向外取整：09:00 ~ 17:00，第一个块贴左边缘
    expect(days[0].lanes[0].rows[0][0].leftPct).toBe(0);
    expect(days[0].ticks[0].label).toBe("09:00");
  });

  it("主线 + 两条并行线同时段：三条泳道、一个并行带，泳道按主线优先排序", () => {
    const days = buildAgendaTimeline(
      [MAIN, FORUM_A, FORUM_B],
      [
        segment(3, "2026-09-18 14:00", "2026-09-18 15:30"),
        segment(1, "2026-09-18 14:00", "2026-09-18 15:00"),
        segment(2, "2026-09-18 14:00", "2026-09-18 15:30"),
      ],
    );

    expect(days[0].lanes.map((lane) => lane.line.id)).toEqual([1, 2, 3]);
    expect(days[0].bands).toHaveLength(1);
    expect(days[0].bands[0].count).toBe(3);
  });

  it("并行带只覆盖真实交集，并且只归属实际参与的议程线", () => {
    const days = buildAgendaTimeline(
      [MAIN, FORUM_A, FORUM_B, FORUM_C],
      [
        // 复现测试截图：11:00 的两条短线形成第一处并行。
        segment(2, "2026-09-18 11:00", "2026-09-18 12:00"),
        segment(3, "2026-09-18 11:00", "2026-09-18 12:00"),
        // 跨日长环节只在 16:23–18:00 和主线重叠，不能把 15:58–24:00
        // 整段铺到所有泳道。
        segment(4, "2026-09-18 15:58", "2026-09-19 21:03"),
        segment(1, "2026-09-18 16:23", "2026-09-18 18:00"),
      ],
    );

    expect(days[0].bands).toHaveLength(2);

    const earlyBand = days[0].bands[0];
    expect(earlyBand.laneRanges.map((range) => range.lineId)).toEqual([2, 3]);

    const lateBand = days[0].bands[1];
    expect(lateBand.laneRanges.map((range) => range.lineId)).toEqual([1, 4]);

    // 当天时间轴为 11:00–24:00，共 780 分钟；真实交集从 16:23 开始，
    // 持续到 18:00（97 分钟）。
    expect(lateBand.leftPct).toBeCloseTo((323 / 780) * 100, 5);
    expect(lateBand.widthPct).toBeCloseTo((97 / 780) * 100, 5);
    expect(lateBand.laneRanges[0].leftPct).toBeCloseTo(lateBand.leftPct, 5);
    expect(lateBand.laneRanges[0].widthPct).toBeCloseTo(lateBand.widthPct, 5);
  });

  it("不同议程线的时间重叠算并行，同一条线的重叠不算", () => {
    // 同一条线上的重叠是保存时被阻断的脏数据，不该被标成"并行"
    const days = buildAgendaTimeline(
      [MAIN],
      [
        segment(1, "2026-09-18 09:00", "2026-09-18 10:00"),
        segment(1, "2026-09-18 09:30", "2026-09-18 10:30"),
      ],
    );

    expect(days[0].bands).toHaveLength(0);
    // 降级成两行，不叠着画
    expect(days[0].lanes[0].rows).toHaveLength(2);
  });

  it("跨自然日的活动按天分组，不是拉长成一条轴", () => {
    const days = buildAgendaTimeline(
      [MAIN],
      [
        segment(1, "2026-09-18 09:00", "2026-09-18 12:00"),
        segment(1, "2026-09-19 09:00", "2026-09-19 12:00"),
        segment(1, "2026-09-20 09:00", "2026-09-20 12:00"),
      ],
    );

    expect(days).toHaveLength(3);
    expect(days.map((day) => day.key)).toEqual([
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    // 每天各自成轴，第一个块都贴左边缘
    for (const day of days) {
      expect(day.lanes[0].rows[0][0].leftPct).toBe(0);
    }
  });

  it("跨日环节在它覆盖的每一天都画出来，中间的整天铺满", () => {
    // 9/18 22:00 → 9/20 09:00：三天各画一块，三块指向同一个环节
    const days = buildAgendaTimeline(
      [MAIN],
      [segment(1, "2026-09-18 22:00", "2026-09-20 09:00")],
    );

    expect(days.map((day) => day.key)).toEqual([
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);

    const blocks = days.map((day) => day.lanes[0].rows[0][0]);
    expect(new Set(blocks.map((block) => block.segment.id)).size).toBe(1);

    // 首日：右侧被自然日切开
    expect(blocks[0].continuesFromPrevDay).toBe(false);
    expect(blocks[0].continuesNextDay).toBe(true);
    expect(blocks[0].leftPct + blocks[0].widthPct).toBeCloseTo(100, 5);

    // 中间日：两侧都被切开，轴从 00:00 起，块铺满全天
    expect(blocks[1].continuesFromPrevDay).toBe(true);
    expect(blocks[1].continuesNextDay).toBe(true);
    expect(days[1].ticks[0].label).toBe("00:00");
    expect(blocks[1].leftPct).toBe(0);
    expect(blocks[1].widthPct).toBeCloseTo(100, 5);

    // 末日：从 00:00 接进来，画到真实结束时间
    expect(blocks[2].continuesFromPrevDay).toBe(true);
    expect(blocks[2].continuesNextDay).toBe(false);
    expect(blocks[2].leftPct).toBe(0);
    expect(days[2].carryOverCount).toBe(1);

    // 时间轴续接块只把卡片起点改成当天 00:00，环节的完整时间仍供详情/编辑使用。
    expect(formatTimelineBlockRange(blocks[0].segment, blocks[0])).toMatch(
      /^22:00 - .* 09:00$/,
    );
    expect(formatTimelineBlockRange(blocks[1].segment, blocks[1])).toMatch(
      /^00:00 - .* 09:00$/,
    );
    expect(formatTimelineBlockRange(blocks[2].segment, blocks[2])).toMatch(
      /^00:00 - 09:00$/,
    );
    expect(formatSegmentRange(blocks[2].segment)).toMatch(/^22:00 - .* 09:00$/);
  });

  it("只被跨日环节覆盖、当天没有新环节开始的日子照样出卡片", () => {
    const days = buildAgendaTimeline(
      [MAIN, FORUM_A],
      [
        segment(2, "2026-09-18 20:00", "2026-09-20 08:00"),
        segment(1, "2026-09-20 09:00", "2026-09-20 10:00"),
      ],
    );

    // 9/19 没有任何环节"开始"，但分论坛 A 那天是被整天占住的
    expect(days.map((day) => day.key)).toEqual([
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(days[1].lanes).toHaveLength(1);
    expect(days[1].lanes[0].line.id).toBe(2);
    expect(days[1].segmentCount).toBe(1);
    expect(days[1].carryOverCount).toBe(1);
  });

  it("结束时间正好压在零点时，次日不再多出一个零宽的续接块", () => {
    const days = buildAgendaTimeline(
      [MAIN],
      [segment(1, "2026-09-18 20:00", "2026-09-19 00:00")],
    );

    expect(days).toHaveLength(1);
    expect(days[0].key).toBe("2026-09-18");
    expect(days[0].lanes[0].rows[0][0].continuesNextDay).toBe(false);
  });

  it("从前一天续过来的环节压住当天的环节，一样算并行", () => {
    const days = buildAgendaTimeline(
      [MAIN, FORUM_A],
      [
        segment(2, "2026-09-18 20:00", "2026-09-19 12:00"),
        segment(1, "2026-09-19 10:00", "2026-09-19 11:00"),
      ],
    );

    expect(days[1].key).toBe("2026-09-19");
    expect(days[1].bands).toHaveLength(1);
    expect(days[1].bands[0].count).toBe(2);
    expect(days[1].segmentCount).toBe(2);
    expect(days[1].carryOverCount).toBe(1);
  });

  it("异常长的跨日环节最多摊 31 天，截断处仍然标成没结束", () => {
    const days = buildAgendaTimeline(
      [MAIN],
      [segment(1, "2026-09-01 09:00", "2026-12-01 09:00")],
    );

    expect(days).toHaveLength(31);
    expect(days[30].lanes[0].rows[0][0].continuesNextDay).toBe(true);
  });

  it("零时长环节宽度为 0 但仍然出现在轴上（可见性交给 CSS min-width）", () => {
    const days = buildAgendaTimeline(
      [MAIN],
      [
        segment(1, "2026-09-18 09:00", "2026-09-18 10:00"),
        segment(1, "2026-09-18 10:30", "2026-09-18 10:30"),
      ],
    );

    const blocks = days[0].lanes[0].rows.flat();
    expect(blocks).toHaveLength(2);
    expect(blocks[1].widthPct).toBe(0);
  });

  it("只有一个短环节时轴不塌成一个点（最小跨度 2 小时）", () => {
    const days = buildAgendaTimeline(
      [MAIN],
      [segment(1, "2026-09-18 09:00", "2026-09-18 09:20")],
    );

    const block = days[0].lanes[0].rows[0][0];
    // 20 分钟 / 2 小时 ≈ 16.7%，而不是撑满 100%
    expect(block.widthPct).toBeCloseTo((20 / 120) * 100, 5);
  });

  // 下面三条守的是同一件事：块的宽度必须严格等于它的时长。短环节看不清要靠
  // 把整条轨道撑宽解决，一旦有人再去给块加 min-width，这三条会一起挂。
  it("同一泳道内相邻的块按时间排开，前一块不会越过后一块的开始时间", () => {
    // 复现截图：08:00–08:30 之后紧跟 09:00–10:30。之前块上的 min-w-28
    // 会把 30 分钟的块撑成 112px（约 97 分钟），直接压住后一块 43px。
    const days = buildAgendaTimeline(
      [MAIN],
      [
        segment(1, "2026-08-20 08:00", "2026-08-20 08:30"),
        segment(1, "2026-08-20 09:00", "2026-08-20 10:30"),
        segment(1, "2026-08-20 16:23", "2026-08-20 22:00"),
      ],
    );

    const row = days[0].lanes[0].rows[0];
    expect(row).toHaveLength(3);
    for (let index = 0; index < row.length - 1; index += 1) {
      expect(row[index].leftPct + row[index].widthPct).toBeLessThanOrEqual(
        row[index + 1].leftPct,
      );
    }
  });

  it("块宽严格等于时长占轴的比例，短环节不会被撑过自己的结束时间", () => {
    const days = buildAgendaTimeline(
      [MAIN, FORUM_A],
      [
        segment(1, "2026-08-20 08:00", "2026-08-20 08:30"),
        segment(1, "2026-08-20 11:00", "2026-08-20 12:00"),
        // 把当天的轴撑到 08:00–24:00，即 16 小时——短块占比最小的场景
        segment(2, "2026-08-20 15:58", "2026-08-21 00:00"),
      ],
    );

    const day = days[0];
    expect(day.spanMinutes).toBe(16 * 60);

    const [half, hour] = day.lanes[0].rows[0];
    expect(half.widthPct).toBeCloseTo((30 / day.spanMinutes) * 100, 10);
    expect(hour.widthPct).toBeCloseTo((60 / day.spanMinutes) * 100, 10);

    // 轨道按 spanMinutes × 每分钟像素撑开后，30 分钟的块拿到 60px、
    // 1 小时的块拿到 120px——短环节的可读性是这么来的，不是靠 min-width。
    const trackPx = day.spanMinutes * TIMELINE_PX_PER_MINUTE;
    expect((half.widthPct / 100) * trackPx).toBeCloseTo(60, 10);
    expect((hour.widthPct / 100) * trackPx).toBeCloseTo(120, 10);
  });

  it("超过 12 小时的一天也按整点打刻度，不再退回两小时一格", () => {
    const days = buildAgendaTimeline(
      [MAIN],
      [segment(1, "2026-08-20 08:00", "2026-08-21 00:00")],
    );

    const labels = days[0].ticks.map((tick) => tick.label);
    expect(labels[0]).toBe("08:00");
    expect(labels[1]).toBe("09:00");
    expect(labels).toHaveLength(17);
  });

  it("时间轴不画作废环节，但正常环节照画", () => {
    const days = buildAgendaTimeline(
      [MAIN],
      [
        segment(1, "2026-09-18 09:00", "2026-09-18 10:00"),
        segment(1, "2026-09-18 11:00", "2026-09-18 12:00", {
          status: "voided",
        }),
      ],
    );

    expect(days[0].lanes[0].rows.flat()).toHaveLength(1);
  });
});

describe("buildSequenceLabels", () => {
  it("主线是 1/2/3，并行线是 线号-线内序号，作废不编号", () => {
    const segments = [
      segment(1, "2026-09-18 09:00", "2026-09-18 09:40"),
      segment(1, "2026-09-18 09:50", "2026-09-18 11:30"),
      segment(2, "2026-09-18 14:00", "2026-09-18 15:30"),
      segment(3, "2026-09-18 14:00", "2026-09-18 15:30"),
      segment(1, "2026-09-18 16:00", "2026-09-18 17:00", { status: "voided" }),
    ];

    const labels = buildSequenceLabels([MAIN, FORUM_A, FORUM_B], segments);

    expect(labels.get(segments[0].id)).toBe("1");
    expect(labels.get(segments[1].id)).toBe("2");
    expect(labels.get(segments[2].id)).toBe("1-1");
    expect(labels.get(segments[3].id)).toBe("2-1");
    expect(labels.get(segments[4].id)).toBe("-");
  });
});
