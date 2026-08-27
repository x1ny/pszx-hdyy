import { describe, expect, it } from "vitest";
import {
  buildSeatOccupantVisual,
  DEFAULT_OCCUPIED_COLOR,
  organizationSeatColor,
  organizationSeatLegend,
  seatOccupantLabelLayout,
} from "./seat-occupant-visual";

describe("seat occupant visual model", () => {
  it("个人座位显示姓名与团体；无团体个人仅显示姓名并使用默认占用样式", () => {
    const grouped = buildSeatOccupantVisual({
      occupantType: "person",
      memberName: "林一",
      organizationId: 7,
      organizationName: "泉州商会",
    });
    expect(grouped).toMatchObject({
      kind: "person",
      primaryLabel: "林一",
      secondaryLabel: "泉州商会",
      organizationId: 7,
      color: organizationSeatColor(7),
    });

    const independent = buildSeatOccupantVisual({
      occupantType: "person",
      memberName: "周二",
      organizationId: null,
      organizationName: null,
    });
    expect(independent).toEqual({
      kind: "person",
      primaryLabel: "周二",
      secondaryLabel: undefined,
      organizationId: undefined,
      organizationName: undefined,
      color: DEFAULT_OCCUPIED_COLOR,
    });
  });

  it("团体占位只以团体名称作为主标签，不虚构个人姓名", () => {
    const visual = buildSeatOccupantVisual({
      occupantType: "organization",
      memberName: "不应显示",
      organizationId: 3,
      organizationName: "纺织协会",
    });
    expect(visual).toMatchObject({
      kind: "organization",
      primaryLabel: "纺织协会",
    });
    expect(visual.secondaryLabel).toBeUndefined();
  });

  it("正整数团体 ID 映射稳定颜色，图例按 ID 去重并复用相同颜色", () => {
    expect(organizationSeatColor(11)).toEqual(organizationSeatColor(11));
    expect(organizationSeatColor(13)).toEqual(organizationSeatColor(1));
    expect(organizationSeatColor(0)).toEqual(DEFAULT_OCCUPIED_COLOR);

    const first = buildSeatOccupantVisual({
      occupantType: "person",
      memberName: "甲",
      organizationId: 8,
      organizationName: "乙协会",
    });
    const duplicate = buildSeatOccupantVisual({
      occupantType: "organization",
      memberName: null,
      organizationId: 8,
      organizationName: "乙协会",
    });
    const second = buildSeatOccupantVisual({
      occupantType: "person",
      memberName: "乙",
      organizationId: 2,
      organizationName: "甲协会",
    });

    expect(organizationSeatLegend([first, duplicate, second])).toEqual([
      {
        organizationId: 2,
        organizationName: "甲协会",
        color: organizationSeatColor(2),
      },
      {
        organizationId: 8,
        organizationName: "乙协会",
        color: organizationSeatColor(8),
      },
    ]);
  });

  it("缩小时保留截断后的主标签并隐藏次级标签，正常缩放展示两层", () => {
    const visual = buildSeatOccupantVisual({
      occupantType: "person",
      memberName: "名字非常长的参会人员代表",
      organizationId: 5,
      organizationName: "名称同样很长的行业协会",
    });

    expect(seatOccupantLabelLayout(visual, 0.4)).toMatchObject({
      primaryLabel: "名字非…",
      secondaryLabel: undefined,
      showSeatLabel: false,
    });
    expect(seatOccupantLabelLayout(visual, 1)).toMatchObject({
      primaryLabel: "名字非常长的参会人…",
      secondaryLabel: "名称同样很长的行业协会",
      showSeatLabel: true,
    });
  });
});
