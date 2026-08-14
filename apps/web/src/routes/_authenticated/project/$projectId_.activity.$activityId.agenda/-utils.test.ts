import { describe, expect, it } from "vitest";
import type { AgendaLine, Segment } from "./-queries";
import { buildAgendaTimeline, buildSequenceLabels } from "./-utils";

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

describe("buildAgendaTimeline", () => {
  it("没有正常环节时返回空数组", () => {
    expect(buildAgendaTimeline([MAIN], [])).toEqual([]);
    expect(
      buildAgendaTimeline(
        [MAIN],
        [segment(1, "2026-09-18 09:00", "2026-09-18 10:00", { status: "voided" })],
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

  it("跨日环节挂在开始日，块被当天 24:00 截断并标记", () => {
    const days = buildAgendaTimeline(
      [MAIN],
      [segment(1, "2026-09-18 22:00", "2026-09-19 01:00")],
    );

    expect(days).toHaveLength(1);
    expect(days[0].key).toBe("2026-09-18");

    const block = days[0].lanes[0].rows[0][0];
    expect(block.continuesNextDay).toBe(true);
    expect(block.leftPct + block.widthPct).toBeCloseTo(100, 5);
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
