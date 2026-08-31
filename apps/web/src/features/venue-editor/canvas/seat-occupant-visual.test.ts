import { describe, expect, it } from "vitest";
import {
  buildSeatOccupantVisual,
  DEFAULT_OCCUPIED_COLOR,
  DEFAULT_OCCUPIED_EXPORT_COLOR,
  NAME_READABLE_PITCH_PX,
  ORGANIZATION_SEAT_PALETTE,
  organizationSeatColor,
  organizationSeatLegend,
  scaleForPitch,
  seatRenderSpec,
  truncateSeatText,
  wrapSeatName,
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

  it("座距越大写得下越多，密到写不下三个字就干脆不画姓名", () => {
    // 姓名一律按"这个座距塞得下几个字"截断，而不是按缩放倍率拍脑袋分档。
    expect(seatRenderSpec(90).nameChars).toBe(6);
    expect(seatRenderSpec(NAME_READABLE_PITCH_PX).nameChars).toBe(3);
    // 40px 是阈值：再密一点就只剩两个字，"张…"没有信息量，退回只显示色块。
    expect(seatRenderSpec(30).nameChars).toBe(0);
    expect(seatRenderSpec(12).nameChars).toBe(0);
  });

  it("横向写不下、纵向还空着时，姓名折成两行", () => {
    // 座距 110px：一行写得下 8 个字，两行就能把 9 字的商会名完整写下
    const roomy = seatRenderSpec(110);
    expect(roomy.nameLines).toBe(2);
    expect(
      wrapSeatName("泉州市纺织服装商会", roomy.nameChars, roomy.nameLines),
    ).toEqual(["泉州市纺织", "服装商会"]);

    // 座距刚够写姓名时纵向挤不下第二行——第二行会撞到下一排座位的编号
    const tight = seatRenderSpec(NAME_READABLE_PITCH_PX);
    expect(tight.nameLines).toBe(1);
    expect(
      wrapSeatName("泉州市纺织服装商会", tight.nameChars, tight.nameLines),
    ).toEqual(["泉州…"]);
  });

  it("折行：一行写得下就不折，放得下就均分，放不下才截断", () => {
    expect(wrapSeatName("王芳", 6, 2)).toEqual(["王芳"]);

    // 9 字 ≤ 6×2，均分成 5+4，而不是塞满第一行留个孤字在第二行
    expect(wrapSeatName("泉州市纺织服装商会", 6, 2)).toEqual([
      "泉州市纺织",
      "服装商会",
    ]);

    // 两行也放不下：前面填满、最后一行截断
    expect(wrapSeatName("一二三四五六七八九十十一十二十三", 4, 2)).toEqual([
      "一二三四",
      "五六七…",
    ]);

    expect(wrapSeatName("王芳", 0, 2)).toEqual([]);
    expect(wrapSeatName("", 6, 2)).toEqual([]);
  });

  it("空间足够时不截断——写得下几个字只由座距决定，没有固定上限", () => {
    // 曾经这里有个 Math.min(6)，于是座位之间空着一大片，
    // "泉州市纺织服装商会"（9 字）照样被砍成 "泉州市纺织…"。
    const roomy = seatRenderSpec(170);
    expect(roomy.nameChars).toBeGreaterThanOrEqual(9);
    expect(truncateSeatText("泉州市纺织服装商会", roomy.nameChars)).toBe(
      "泉州市纺织服装商会",
    );

    // 再宽还能更多，说明确实没有天花板
    expect(seatRenderSpec(400).nameChars).toBeGreaterThan(roomy.nameChars);
  });

  it("符号半径有上限、无下限：上限以下等比，以上钉死", () => {
    // 上限以下严格成比例——这一段里换算回世界坐标是常量，圆点跟着画布缩放
    expect(seatRenderSpec(30).radiusPx).toBeCloseTo(9, 5);
    expect(seatRenderSpec(20).radiusPx / seatRenderSpec(10).radiusPx).toBe(2);

    // 没有下限：缩得很远时一路缩下去，不硬撑一个最小尺寸
    expect(seatRenderSpec(4).radiusPx).toBeCloseTo(1.2, 5);
    expect(seatRenderSpec(1).radiusPx).toBeLessThan(seatRenderSpec(4).radiusPx);

    // 有上限：超过 40px 座距之后不再变大，示意图不需要更大的圆点
    expect(seatRenderSpec(40).radiusPx).toBe(12);
    expect(seatRenderSpec(600).radiusPx).toBe(12);
  });

  it("座位编号比姓名先出现、也先消失", () => {
    const sparse = seatRenderSpec(NAME_READABLE_PITCH_PX);
    const dense = seatRenderSpec(26);
    const tiny = seatRenderSpec(14);

    expect(sparse.seatLabelChars).toBeGreaterThan(0);
    // 姓名已经放弃的档位，短编号还画得下
    expect(dense.nameChars).toBe(0);
    expect(dense.seatLabelChars).toBeGreaterThan(0);
    // 再密就什么字都不画
    expect(tiny.seatLabelChars).toBe(0);
  });

  it("非法座距不会让规格崩成 NaN", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const spec = seatRenderSpec(bad);
      expect(Number.isFinite(spec.radiusPx)).toBe(true);
      expect(Number.isFinite(spec.nameOffsetPx)).toBe(true);
      expect(spec.nameChars).toBe(0);
    }
  });

  it("截断把省略号算进长度里", () => {
    expect(truncateSeatText("张伟", 3)).toBe("张伟");
    expect(truncateSeatText("名字非常长的代表", 3)).toBe("名字…");
    expect(truncateSeatText("名字非常长的代表", 1)).toBe("名…");
  });

  it("按目标座距反推缩放倍率，世界座距为 0 时不做无意义缩放", () => {
    expect(scaleForPitch(20, NAME_READABLE_PITCH_PX)).toBe(2);
    expect(scaleForPitch(0, NAME_READABLE_PITCH_PX)).toBe(1);
  });
});
