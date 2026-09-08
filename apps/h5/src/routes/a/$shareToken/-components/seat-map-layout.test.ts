import { describe, expect, test } from "bun:test";
import { SEAT_MAP, type SeatPoint, seatMapLayout } from "./seat-map-layout";

/**
 * 这里每一条测的都是**不会报错的故障**：图变形、内容跑出框、圆点消失、定位钉指
 * 在错误的位置。渲染出来都是一张"看起来正常"的图，肉眼验收发现不了错位几个像素，
 * 更发现不了它只在秀场或者单排那种形态下才错。
 */

const VIEW = { viewWidth: 343, minHeight: 96, maxHeight: 400 };

/** 画布模板的真实间距，见 canvas/core/layout.ts 的 LAYOUT_SPACING。 */
const SEAT_GAP = 48;
const ROW_GAP = 64;
const RUNWAY_GAP = 160;

const theater = (rows: number, cols: number): SeatPoint[] =>
  Array.from({ length: rows * cols }, (_, index) => ({
    x: (index % cols) * SEAT_GAP,
    y: Math.floor(index / cols) * ROW_GAP,
  }));

/** 秀场：中间留 T 台，两侧对称。时尚周的主场景，也是最扁的一种。 */
const runway = (rows: number, cols: number): SeatPoint[] => {
  const sideWidth = (cols - 1) * SEAT_GAP;
  const seats: SeatPoint[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      seats.push({ x: sideWidth - col * SEAT_GAP, y: row * ROW_GAP });
      seats.push({
        x: sideWidth + RUNWAY_GAP + col * SEAT_GAP,
        y: row * ROW_GAP,
      });
    }
  }
  return seats;
};

const center = (seats: readonly SeatPoint[]) => ({
  x:
    (Math.min(...seats.map((s) => s.x)) + Math.max(...seats.map((s) => s.x))) /
    2,
  y:
    (Math.min(...seats.map((s) => s.y)) + Math.max(...seats.map((s) => s.y))) /
    2,
});

const parseViewBox = (viewBox: string) => {
  const [x, y, width, height] = viewBox.split(" ").map(Number);
  return { x, y, width, height };
};

const layoutOf = (seats: SeatPoint[], pitch = SEAT_GAP, mine = seats[0]) => {
  const result = seatMapLayout({ seats, mine, pitch, ...VIEW });
  if (!result) throw new Error("排版应当成功");
  return result;
};

describe("盒子高度跟着内容长宽比走", () => {
  test("秀场扁条不被撑成方的：比同规模剧场矮得多", () => {
    // 固定纵横比的盒子会把这种图上下空掉六成、座位点压到看不见，而它恰好是
    // 最常见的一种。这条用例存在的全部意义就是钉住"不许改成固定纵横比"。
    const wide = layoutOf(runway(6, 10));
    const square = layoutOf(theater(20, 30));

    expect(wide.height).toBeLessThan(square.height);
    expect(wide.height).toBeLessThan(150);
  });

  test("单排领导席撞到高度下界，不会算出一条零高度的线", () => {
    // 包围盒高度是 0。留白把它撑起来，再由下界兜住。
    const layout = layoutOf(theater(1, 12));

    expect(layout.height).toBe(VIEW.minHeight);
    expect(Number.isFinite(layout.height)).toBe(true);
  });

  test("瘦高的区撞到高度上界，不会顶穿弹层", () => {
    // 2 列 × 30 排，长宽比约 0.03，不夹的话算出来是几千像素。
    const layout = layoutOf(theater(30, 2));

    expect(layout.height).toBe(VIEW.maxHeight);
  });

  test("上界比下界还小时以上界为准 —— 宁可矮，不能溢出", () => {
    const layout = seatMapLayout({
      seats: theater(30, 2),
      mine: { x: 0, y: 0 },
      pitch: SEAT_GAP,
      viewWidth: 343,
      minHeight: 300,
      maxHeight: 120,
    });

    expect(layout?.height).toBe(120);
  });
});

describe("viewBox 长宽比恒等于盒子长宽比", () => {
  // 这是定位钉能算准的**前提**：两者一致，preserveAspectRatio 就不产生 letterbox
  // 偏移，世界坐标到屏幕坐标是一次纯缩放。不一致的话钉子会整体偏移一段，而且只在
  // 被夹住的那些形态上偏——最难发现的一类错位。
  test.each([
    ["秀场", runway(6, 10)],
    ["大剧场", theater(20, 30)],
    ["单排（撞下界）", theater(1, 12)],
    ["瘦高（撞上界）", theater(30, 2)],
    ["八个座位（撞座距上限）", theater(2, 4)],
  ])("%s", (_label, seats) => {
    const layout = layoutOf(seats);
    const box = parseViewBox(layout.viewBox);

    expect(box.width / box.height).toBeCloseTo(
      VIEW.viewWidth / layout.height,
      4,
    );
  });
});

describe("定位钉", () => {
  test("我在正中间时，钉子落在盒子正中", () => {
    const seats = theater(6, 10);
    const layout = layoutOf(seats, SEAT_GAP, center(seats));

    expect(layout.pin.left).toBeCloseTo(VIEW.viewWidth / 2, 4);
    expect(layout.pin.top).toBeCloseTo(layout.height / 2, 4);
  });

  test("我在角上时，钉子在盒内且留出了留白", () => {
    // 留白不够的话钉子会被框裁掉一半 —— 而那正是最需要看清的那个元素。
    const seats = theater(6, 10);
    const layout = layoutOf(seats, SEAT_GAP, seats[0]);

    expect(layout.pin.left).toBeGreaterThan(0);
    expect(layout.pin.top).toBeGreaterThan(0);
    expect(layout.pin.left).toBeLessThan(VIEW.viewWidth);
    expect(layout.pin.top).toBeLessThan(layout.height);
  });

  test("秀场左右两侧的同排座位，钉子落在各自那一侧", () => {
    // 两侧同 y。只按 y 定位的实现会把钉子指到 T 台对面去，而那是完全不同的一排人。
    const seats = runway(6, 10);
    const left = layoutOf(seats, SEAT_GAP, { x: 0, y: 0 });
    const right = layoutOf(seats, SEAT_GAP, {
      x: 9 * SEAT_GAP + RUNWAY_GAP + 9 * SEAT_GAP,
      y: 0,
    });

    expect(left.pin.left).toBeLessThan(VIEW.viewWidth / 2);
    expect(right.pin.left).toBeGreaterThan(VIEW.viewWidth / 2);
    expect(left.pin.top).toBeCloseTo(right.pin.top, 4);
  });
});

describe("圆点大小两端都夹住", () => {
  test("座位少时不放大成球：屏幕座距不超过上限", () => {
    const seats = theater(2, 4);
    const layout = layoutOf(seats);
    const box = parseViewBox(layout.viewBox);
    const screenPitch = SEAT_GAP * (VIEW.viewWidth / box.width);

    expect(screenPitch).toBeLessThanOrEqual(SEAT_MAP.maxPitch + 0.001);
    expect(layout.dotDiameter / 2).toBeLessThanOrEqual(SEAT_MAP.maxDotRadius);
  });

  test("一千座时圆点不缩到消失", () => {
    // 亚像素的点在高 DPR 屏上会直接不见，整片区变成空白。
    const layout = layoutOf(theater(25, 40));

    expect(layout.dotDiameter / 2).toBeGreaterThanOrEqual(
      SEAT_MAP.minDotRadius,
    );
  });
});

describe("一条 path 装下所有座位", () => {
  test("点数等于座位数，且只有一条路径", () => {
    // DOM 节点数与座位数无关，是这张图在一万座下不卡的唯一原因。
    const layout = layoutOf(theater(25, 40));

    expect(layout.path.match(/M/g)).toHaveLength(1000);
    expect(typeof layout.path).toBe("string");
  });

  test("path 里不出现 NaN", () => {
    // 一个 NaN 会让整条路径失效 —— 表现是所有座位一起消失，不报错。
    const layout = layoutOf(theater(6, 10));

    expect(layout.path).not.toContain("NaN");
    expect(layout.viewBox).not.toContain("NaN");
  });
});

describe("坏数据不产出坏图", () => {
  test("全部座位重合：不返回 null，viewBox 有限且非零", () => {
    // 包围盒是零矩形。留白救回来的正是这种情况；救不回来的表现是除零之后
    // 整张图变成空白，而不是报错。
    const seats = Array.from({ length: 10 }, () => ({ x: 3, y: 4 }));
    const layout = layoutOf(seats, 34, { x: 3, y: 4 });
    const box = parseViewBox(layout.viewBox);

    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(Number.isFinite(layout.pin.left)).toBe(true);
    expect(Number.isFinite(layout.pin.top)).toBe(true);
  });

  test("脏坐标只丢掉它自己，其余照画", () => {
    const seats = [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY },
      ...theater(2, 4),
    ];
    const layout = layoutOf(seats, SEAT_GAP, { x: 0, y: 0 });

    expect(layout.path.match(/M/g)).toHaveLength(8);
  });

  test("座距为 0 或 NaN 时走兜底值，不会除出 Infinity", () => {
    for (const pitch of [0, Number.NaN, -5]) {
      const layout = layoutOf(theater(6, 10), pitch);
      expect(Number.isFinite(layout.height)).toBe(true);
      expect(layout.viewBox).not.toContain("Infinity");
    }
  });

  test.each([
    ["宽度还没测出来", { viewWidth: 0 }],
    ["一个座位都不剩", { seats: [] as SeatPoint[] }],
    ["我的坐标是脏的", { mine: { x: Number.NaN, y: 0 } }],
  ])("%s 时返回 null，让调用方显示降级文案", (_label, override) => {
    // 返回一个"看起来能用"的空布局，前端就会渲染一个空框；返回 null 才能让它
    // 改说「座位图暂不可用，您的座位是 A区 3排08座」。
    const result = seatMapLayout({
      seats: theater(6, 10),
      mine: { x: 0, y: 0 },
      pitch: SEAT_GAP,
      ...VIEW,
      ...override,
    });

    expect(result).toBeNull();
  });
});
