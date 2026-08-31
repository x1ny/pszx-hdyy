import { describe, expect, it } from "vitest";
import {
  buildSeatOccupantVisual,
  DEFAULT_OCCUPIED_COLOR,
  DEFAULT_OCCUPIED_EXPORT_COLOR,
  ORGANIZATION_SEAT_PALETTE,
  organizationSeatColor,
  organizationSeatLegend,
  seatOccupantLabelLayout,
} from "./seat-occupant-visual";

const relativeLuminance = (hex: string) => {
  const [red, green, blue] = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = [red, green, blue].map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrastAgainstWhite = (hex: string) =>
  1.05 / (relativeLuminance(hex) + 0.05);

describe("seat occupant visual model", () => {
  it("个人座位只显示姓名，同时保留团体颜色归属；无团体个人使用默认占用样式", () => {
    const grouped = buildSeatOccupantVisual({
      occupantType: "person",
      memberName: "林一",
      organizationId: 7,
      organizationName: "泉州商会",
    });
    expect(grouped).toMatchObject({
      kind: "person",
      primaryLabel: "林一",
      organizationId: 7,
      organizationName: "泉州商会",
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

  it("团体色板以绿橙紫起始、不占用个人蓝，且色槽保持唯一", () => {
    const fills = ORGANIZATION_SEAT_PALETTE.map((color) => color.fill);

    expect(fills.slice(0, 3)).toEqual(["#1EAB53", "#D18500", "#9F75E1"]);
    expect(fills).not.toContain(DEFAULT_OCCUPIED_EXPORT_COLOR.fill);
    expect(new Set(fills).size).toBe(ORGANIZATION_SEAT_PALETTE.length);
  });

  it("团体填充色保持接近的视觉权重，右侧小字颜色满足正文对比度", () => {
    const fillLuminances = ORGANIZATION_SEAT_PALETTE.map((color) =>
      relativeLuminance(color.fill),
    );

    expect(
      Math.max(...fillLuminances) - Math.min(...fillLuminances),
    ).toBeLessThan(0.1);
    for (const color of ORGANIZATION_SEAT_PALETTE) {
      expect(contrastAgainstWhite(color.stroke)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("不同缩放级别只展示截断后的主标签", () => {
    const visual = buildSeatOccupantVisual({
      occupantType: "person",
      memberName: "名字非常长的参会人员代表",
      organizationId: 5,
      organizationName: "名称同样很长的行业协会",
    });

    expect(seatOccupantLabelLayout(visual, 0.4)).toMatchObject({
      primaryLabel: "名字非…",
      showSeatLabel: false,
    });
    expect(seatOccupantLabelLayout(visual, 1)).toMatchObject({
      primaryLabel: "名字非常长的参会人…",
      showSeatLabel: true,
    });
  });
});
