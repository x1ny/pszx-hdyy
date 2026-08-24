import { describe, expect, test } from "vitest";
import { isProjectionStable, validateProjection } from "../../contract";
import { canvasEditor } from "../index";
import {
  addSeat,
  addZone,
  applyLayoutToZone,
  boxShapeFromDrag,
  MIN_ZONE_SIZE,
  moveSeats,
  moveZones,
  patchSeats,
  patchZone,
  polygonShapeFromPoints,
  removeSeats,
  removeZones,
  resizeZone,
} from "./commands";
import {
  type CanvasDoc,
  canvasDocFromProjection,
  emptyCanvasDoc,
  parseCanvasDoc,
  projectCanvas,
  ZONE_KIND_DEFAULT_COLOR,
} from "./document";
import {
  boundsOf,
  clampPointToRect,
  ellipseContains,
  fitViewport,
  normalizeRect,
  pointInPolygon,
  pointsToSvg,
  rectContains,
  rectsIntersect,
  scalePoint,
  scalePoints,
  toAbsolutePoints,
  toScreen,
  toWorld,
} from "./geometry";
import { canRedo, canUndo, execute, initialState, redo, undo } from "./history";
import {
  EMPTY_SELECTION,
  handleRects,
  hitSeat,
  hitZone,
  marqueeSelect,
  resizeRect,
  resolveDragSubject,
  resolveSeatDragSubject,
  seatWorldPoint,
  zoneContains,
} from "./interaction";
import {
  countLayout,
  DEFAULT_LAYOUT_PARAMS,
  generateLayout,
  type LayoutParams,
} from "./layout";

/**
 * 画布编辑器的 core 层。**零 React、零 DOM，所以全部可测**——
 * docs/场地排位编辑器设计.md §5 把这一层列为"必须 100% 覆盖"的第一档，
 * 理由是参考实现是未经验证的 AI demo，不带任何正确性信用。
 *
 * v2：按两级架构（顶层区域分布 / 进入区域后的排位）重写。顶层只画形状
 * （矩形/椭圆/多边形）+ 自定义颜色，不再直接摆座位；座位相关的交互判定
 * （`resolveSeatDragSubject`）单独一套，覆盖率同样按 100% 要求。
 *
 * 手势、拖拽这些自动化测不到的（happy-dom 不做布局，getBoundingClientRect
 * 返回全零），靠真浏览器人工过一遍，清单在设计文档 §5。
 */

// ---------------------------------------------------------------------------

describe("geometry", () => {
  test("normalizeRect 处理反向拖拽", () => {
    expect(normalizeRect({ x: 100, y: 80 }, { x: 20, y: 10 })).toEqual({
      x: 20,
      y: 10,
      width: 80,
      height: 70,
    });
  });

  test("normalizeRect 对同一个点给出零矩形而不是负数", () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });

  test("rectContains 把边界算在内", () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectContains(rect, { x: 0, y: 0 })).toBe(true);
    expect(rectContains(rect, { x: 10, y: 10 })).toBe(true);
    expect(rectContains(rect, { x: 10.1, y: 5 })).toBe(false);
  });

  test("rectsIntersect 边缘相接算相交", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsIntersect(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(true);
    expect(rectsIntersect(a, { x: 11, y: 0, width: 5, height: 5 })).toBe(false);
  });

  test("ellipseContains 圆心在内、包围盒角落在外", () => {
    const rect = { x: 0, y: 0, width: 100, height: 60 };
    expect(ellipseContains(rect, { x: 50, y: 30 })).toBe(true);
    // 包围盒角落落在椭圆外——这正是不能直接用 rectContains 近似椭圆的原因。
    expect(ellipseContains(rect, { x: 0, y: 0 })).toBe(false);
  });

  test("ellipseContains 半轴退化成 0 时不除零、不崩", () => {
    const rect = { x: 10, y: 10, width: 0, height: 0 };
    expect(() => ellipseContains(rect, { x: 10, y: 10 })).not.toThrow();
  });

  test("pointInPolygon 命中正方形内部，遗漏正方形外部", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 20, y: 20 }, square)).toBe(false);
  });

  test("pointInPolygon 支持凹多边形（L 型）", () => {
    // L 型：一个 10x10 的方块挖掉右上角 5x5。
    const lShape = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 2 }, lShape)).toBe(true);
    // 被挖掉的那个角
    expect(pointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false);
  });

  test("pointInPolygon 少于 3 个点恒为 false", () => {
    expect(
      pointInPolygon({ x: 0, y: 0 }, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(false);
  });

  test("pointsToSvg 产出 SVG points 属性格式", () => {
    expect(
      pointsToSvg([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]),
    ).toBe("1,2 3,4");
  });

  test("toAbsolutePoints 把相对坐标加上原点", () => {
    expect(toAbsolutePoints({ x: 100, y: 200 }, [{ x: 1, y: 1 }])).toEqual([
      { x: 101, y: 201 },
    ]);
  });

  test("scalePoints 批量缩放", () => {
    const scaled = scalePoints(
      [{ x: 10, y: 10 }],
      { width: 100, height: 100 },
      { width: 50, height: 50 },
    );
    expect(scaled).toEqual([{ x: 5, y: 5 }]);
  });

  test("clampPointToRect 带内边距", () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(clampPointToRect({ x: -50, y: 200 }, rect, 10)).toEqual({
      x: 10,
      y: 90,
    });
  });

  test("clampPointToRect 在区域比内边距还小时不产出反向区间", () => {
    const tiny = { x: 0, y: 0, width: 10, height: 10 };
    const point = clampPointToRect({ x: 100, y: 100 }, tiny, 12);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(point.x).toBe(12);
  });

  test("boundsOf 空数组返回零矩形而不是 Infinity", () => {
    expect(boundsOf([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  test("boundsOf 单点是零尺寸矩形", () => {
    expect(boundsOf([{ x: 3, y: 4 }])).toEqual({
      x: 3,
      y: 4,
      width: 0,
      height: 0,
    });
  });

  test("scalePoint 遇到零尺寸不产出 NaN", () => {
    const scaled = scalePoint(
      { x: 5, y: 5 },
      { width: 0, height: 0 },
      { width: 100, height: 100 },
    );
    expect(Number.isFinite(scaled.x)).toBe(true);
    expect(Number.isFinite(scaled.y)).toBe(true);
  });

  test("toWorld 和 toScreen 互为逆运算", () => {
    const viewport = { x: 120, y: -40, scale: 0.75 };
    const world = { x: 321, y: 654 };
    const round = toWorld(toScreen(world, viewport), viewport);
    expect(round.x).toBeCloseTo(world.x);
    expect(round.y).toBeCloseTo(world.y);
  });

  test("fitViewport 不把小场地放大到糊", () => {
    const viewport = fitViewport(
      { width: 100, height: 100 },
      { width: 1000, height: 1000 },
    );
    expect(viewport.scale).toBe(1);
  });

  test("fitViewport 大场地缩得进视口", () => {
    const viewport = fitViewport(
      { width: 1600, height: 1000 },
      { width: 800, height: 600 },
      32,
    );
    expect(viewport.scale).toBeLessThan(1);
    expect(1600 * viewport.scale).toBeLessThanOrEqual(800 - 32);
  });
});

// ---------------------------------------------------------------------------

describe("layout 预设", () => {
  const size = { width: 600, height: 400 };

  test("剧场预设产出 rows × cols 个座位", () => {
    const params: LayoutParams = { ...DEFAULT_LAYOUT_PARAMS, rows: 4, cols: 8 };
    const seats = generateLayout("theater", params, size);
    expect(seats).toHaveLength(32);
    expect(countLayout("theater", params)).toBe(32);
  });

  test("剧场预设的编号按排字母 + 列号", () => {
    const seats = generateLayout(
      "theater",
      { ...DEFAULT_LAYOUT_PARAMS, rows: 2, cols: 3, aisleEvery: 0 },
      size,
    );
    expect(seats.map((seat) => seat.label)).toEqual([
      "A1",
      "A2",
      "A3",
      "B1",
      "B2",
      "B3",
    ]);
  });

  test("剧场预设的过道让两侧座位分开", () => {
    const withAisle = generateLayout(
      "theater",
      { ...DEFAULT_LAYOUT_PARAMS, rows: 1, cols: 4, aisleEvery: 2 },
      size,
    );
    const gapInside = withAisle[1].x - withAisle[0].x;
    const gapAcross = withAisle[2].x - withAisle[1].x;
    expect(gapAcross).toBeGreaterThan(gapInside);
  });

  test("宴会预设每桌环绕，编号是「N桌M号」", () => {
    const params: LayoutParams = {
      ...DEFAULT_LAYOUT_PARAMS,
      tableCount: 2,
      seatsPerTable: 4,
      numbering: "tableSeat",
    };
    const seats = generateLayout("banquet", params, size);
    expect(seats).toHaveLength(8);
    expect(seats[0].label).toBe("1桌1号");
    expect(seats[4].label).toBe("2桌1号");
  });

  test("秀场双边中间留出 T 台，两侧各一半", () => {
    const seats = generateLayout(
      "runway",
      { ...DEFAULT_LAYOUT_PARAMS, rows: 2, cols: 3 },
      size,
    );
    expect(seats).toHaveLength(12);
    const runwayStart = 28 + (size.width - 56) / 3;
    const runwayEnd = runwayStart + (size.width - 56) / 3;
    const inRunway = seats.filter(
      (seat) => seat.x > runwayStart + 1 && seat.x < runwayEnd - 1,
    );
    expect(inRunway).toHaveLength(0);
  });

  test("自由排座不生成任何座位", () => {
    expect(generateLayout("free", DEFAULT_LAYOUT_PARAMS, size)).toEqual([]);
    expect(countLayout("free", DEFAULT_LAYOUT_PARAMS)).toBe(0);
  });

  test("行数或列数为 0 时不产出座位，也不报错", () => {
    expect(
      generateLayout("theater", { ...DEFAULT_LAYOUT_PARAMS, rows: 0 }, size),
    ).toEqual([]);
  });

  test("所有生成的座位都落在区域内", () => {
    for (const preset of ["theater", "banquet", "runway"] as const) {
      const seats = generateLayout(preset, DEFAULT_LAYOUT_PARAMS, size);
      for (const seat of seats) {
        expect(seat.x).toBeGreaterThanOrEqual(0);
        expect(seat.y).toBeGreaterThanOrEqual(0);
        expect(seat.x).toBeLessThanOrEqual(size.width);
        expect(seat.y).toBeLessThanOrEqual(size.height);
      }
    }
  });

  test("排字母超过 Z 之后不产出乱码", () => {
    const seats = generateLayout(
      "theater",
      { ...DEFAULT_LAYOUT_PARAMS, rows: 28, cols: 1, aisleEvery: 0 },
      { width: 400, height: 2000 },
    );
    expect(seats[26].label).toBe("AA1");
  });
});

// ---------------------------------------------------------------------------
// 顶层：区域分布——commands + interaction
// ---------------------------------------------------------------------------

/** 一个矩形区域，(100,100)-(500,400)。 */
const docWithRectZone = (): CanvasDoc => {
  let state = initialState(emptyCanvasDoc());
  state = execute(
    state,
    addZone(
      boxShapeFromDrag("rect", { x: 100, y: 100, width: 400, height: 300 }),
      "seating",
    ),
  );
  return state.doc;
};

describe("commands · 区域", () => {
  test("新增矩形区域，颜色取自 kind 的默认值", () => {
    const doc = docWithRectZone();
    expect(doc.zones).toHaveLength(1);
    expect(doc.zones[0].shape.type).toBe("rect");
    expect(doc.zones[0].shape.width).toBe(400);
    expect(doc.zones[0].fill).toBe(ZONE_KIND_DEFAULT_COLOR.seating.fill);
  });

  test("boxShapeFromDrag 尺寸不小于下限", () => {
    const shape = boxShapeFromDrag("rect", { x: 0, y: 0, width: 2, height: 2 });
    expect(shape.width).toBe(MIN_ZONE_SIZE);
    expect(shape.height).toBe(MIN_ZONE_SIZE);
  });

  test("boxShapeFromDrag 也能画椭圆", () => {
    const shape = boxShapeFromDrag("ellipse", {
      x: 10,
      y: 10,
      width: 200,
      height: 100,
    });
    expect(shape.type).toBe("ellipse");
  });

  test("boxShapeFromDrag 圆形落库成宽高相等的椭圆", () => {
    // 圆形不是独立的 ZoneShape 分支——它就是宽高摁成同一个值的椭圆，
    // 取拖拽框的长边，不是短边（不然圆会被裁小，超出鼠标划的框看着奇怪）。
    const shape = boxShapeFromDrag("circle", {
      x: 10,
      y: 20,
      width: 200,
      height: 80,
    });
    expect(shape.type).toBe("ellipse");
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    expect(shape.x).toBe(10);
    expect(shape.y).toBe(20);
  });

  test("圆形也不能小于最小尺寸", () => {
    const shape = boxShapeFromDrag("circle", {
      x: 0,
      y: 0,
      width: 2,
      height: 5,
    });
    expect(shape.width).toBe(MIN_ZONE_SIZE);
    expect(shape.height).toBe(MIN_ZONE_SIZE);
  });

  test("polygonShapeFromPoints 算出包围盒和相对顶点", () => {
    const shape = polygonShapeFromPoints([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 200, y: 300 },
    ]);
    expect(shape?.type).toBe("polygon");
    expect(shape?.x).toBe(100);
    expect(shape?.y).toBe(100);
    if (shape?.type === "polygon") {
      // 第一个点是包围盒左上角，相对坐标应为 (0,0)。
      expect(shape.points[0]).toEqual({ x: 0, y: 0 });
    }
  });

  test("polygonShapeFromPoints 少于 3 个点返回 null", () => {
    expect(
      polygonShapeFromPoints([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });

  test("移动区域不会跑出画布世界", () => {
    let state = initialState(docWithRectZone());
    state = execute(
      state,
      moveZones([state.doc.zones[0].externalId], { x: 99999, y: 99999 }),
    );
    const zone = state.doc.zones[0];
    expect(zone.shape.x + zone.shape.width).toBeLessThanOrEqual(
      state.doc.world.width,
    );
    expect(zone.shape.y + zone.shape.height).toBeLessThanOrEqual(
      state.doc.world.height,
    );
  });

  test("缩放不会把区域压到小于下限", () => {
    let state = initialState(docWithRectZone());
    state = execute(
      state,
      resizeZone(state.doc.zones[0].externalId, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    );
    expect(state.doc.zones[0].shape.width).toBe(MIN_ZONE_SIZE);
  });

  test("缩放多边形区域时顶点跟着按比例缩放", () => {
    let state = initialState(emptyCanvasDoc());
    const shape = polygonShapeFromPoints([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    if (!shape) throw new Error("shape is null");
    state = execute(state, addZone(shape, "seating"));
    const zoneId = state.doc.zones[0].externalId;

    state = execute(
      state,
      resizeZone(zoneId, { x: 0, y: 0, width: 200, height: 200 }),
    );

    const resized = state.doc.zones[0].shape;
    if (resized.type !== "polygon") throw new Error("shape changed type");
    // 原来 100x100 缩到 200x200，是两倍；顶点也应该翻倍。
    expect(resized.points[2]).toEqual({ x: 200, y: 200 });
  });

  test("patchZone 能改名称、类型、颜色", () => {
    let state = initialState(docWithRectZone());
    state = execute(
      state,
      patchZone(state.doc.zones[0].externalId, {
        name: "主秀场 A 区",
        kind: "checkin",
        fill: "#ff0000",
        stroke: "#aa0000",
      }),
    );
    expect(state.doc.zones[0]).toMatchObject({
      name: "主秀场 A 区",
      kind: "checkin",
      fill: "#ff0000",
      stroke: "#aa0000",
    });
  });

  test("删区域连带删它的座位", () => {
    let state = initialState(docWithRectZone());
    const zoneId = state.doc.zones[0].externalId;
    state = execute(
      state,
      applyLayoutToZone(zoneId, "theater", DEFAULT_LAYOUT_PARAMS),
    );
    expect(state.doc.seats.length).toBeGreaterThan(0);

    state = execute(state, removeZones([zoneId]));

    expect(state.doc.zones).toEqual([]);
    expect(state.doc.seats).toEqual([]);
  });

  test("immer 冻结产出的文档，绕过 Command 改不动", () => {
    const doc = docWithRectZone();
    expect(() => {
      (doc.zones as unknown as { push: (v: unknown) => void }).push({});
    }).toThrow();
  });
});

describe("commands · 座位（排位画布用）", () => {
  test("应用布局是整块替换，不与旧座位合并", () => {
    let state = initialState(docWithRectZone());
    const zoneId = state.doc.zones[0].externalId;
    state = execute(
      state,
      applyLayoutToZone(zoneId, "theater", {
        ...DEFAULT_LAYOUT_PARAMS,
        rows: 5,
        cols: 5,
      }),
    );
    expect(state.doc.seats).toHaveLength(25);

    state = execute(
      state,
      applyLayoutToZone(zoneId, "theater", {
        ...DEFAULT_LAYOUT_PARAMS,
        rows: 2,
        cols: 2,
      }),
    );
    expect(state.doc.seats).toHaveLength(4);
  });

  test("新增座位被夹在所属区域内", () => {
    let state = initialState(docWithRectZone());
    const zoneId = state.doc.zones[0].externalId;
    state = execute(state, addSeat(zoneId, { x: 99999, y: 99999 }, "A1"));
    const zone = state.doc.zones[0];
    expect(state.doc.seats[0].x).toBeLessThanOrEqual(zone.shape.width);
    expect(state.doc.seats[0].y).toBeLessThanOrEqual(zone.shape.height);
  });

  test("拖动座位被夹在所属区域内", () => {
    let state = initialState(docWithRectZone());
    const zoneId = state.doc.zones[0].externalId;
    state = execute(state, addSeat(zoneId, { x: 50, y: 50 }, "A1"));

    state = execute(
      state,
      moveSeats([state.doc.seats[0].externalId], { x: 99999, y: 99999 }),
    );

    const zone = state.doc.zones[0];
    expect(state.doc.seats[0].x).toBeLessThanOrEqual(zone.shape.width);
    expect(state.doc.seats[0].y).toBeLessThanOrEqual(zone.shape.height);
  });

  test("批量改等级", () => {
    let state = initialState(docWithRectZone());
    const zoneId = state.doc.zones[0].externalId;
    state = execute(
      state,
      applyLayoutToZone(zoneId, "theater", {
        ...DEFAULT_LAYOUT_PARAMS,
        rows: 1,
        cols: 3,
      }),
    );
    const ids = state.doc.seats.map((seat) => seat.externalId);
    state = execute(state, patchSeats(ids, { rank: "vip" }));
    expect(state.doc.seats.every((seat) => seat.rank === "vip")).toBe(true);
  });

  test("多选时不允许批量改编号", () => {
    let state = initialState(docWithRectZone());
    const zoneId = state.doc.zones[0].externalId;
    state = execute(
      state,
      applyLayoutToZone(zoneId, "theater", {
        ...DEFAULT_LAYOUT_PARAMS,
        rows: 1,
        cols: 2,
      }),
    );
    const before = state.doc.seats.map((seat) => seat.label);
    state = execute(
      state,
      patchSeats(
        state.doc.seats.map((seat) => seat.externalId),
        { label: "X" },
      ),
    );
    expect(state.doc.seats.map((seat) => seat.label)).toEqual(before);
  });

  test("单选时可以改编号", () => {
    let state = initialState(docWithRectZone());
    const zoneId = state.doc.zones[0].externalId;
    state = execute(state, addSeat(zoneId, { x: 20, y: 20 }, "A1"));
    state = execute(
      state,
      patchSeats([state.doc.seats[0].externalId], { label: "VIP-1" }),
    );
    expect(state.doc.seats[0].label).toBe("VIP-1");
  });

  test("删除座位", () => {
    let state = initialState(docWithRectZone());
    const zoneId = state.doc.zones[0].externalId;
    state = execute(
      state,
      applyLayoutToZone(zoneId, "theater", {
        ...DEFAULT_LAYOUT_PARAMS,
        rows: 1,
        cols: 3,
      }),
    );
    state = execute(state, removeSeats([state.doc.seats[1].externalId]));
    expect(state.doc.seats).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe("history", () => {
  test("撤销能精确还原上一步", () => {
    let state = initialState(emptyCanvasDoc());
    state = execute(
      state,
      addZone(
        boxShapeFromDrag("rect", { x: 0, y: 0, width: 200, height: 200 }),
        "seating",
      ),
    );

    expect(canUndo(state)).toBe(true);
    state = undo(state);

    expect(state.doc.zones).toEqual([]);
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(true);
  });

  test("重做把撤销掉的改动放回去", () => {
    let state = initialState(emptyCanvasDoc());
    state = execute(
      state,
      addZone(
        boxShapeFromDrag("rect", { x: 0, y: 0, width: 200, height: 200 }),
        "seating",
      ),
    );
    const afterAdd = state.doc;

    state = redo(undo(state));

    expect(state.doc).toEqual(afterAdd);
  });

  test("新操作让重做链失效", () => {
    let state = initialState(emptyCanvasDoc());
    state = execute(
      state,
      addZone(
        boxShapeFromDrag("rect", { x: 0, y: 0, width: 200, height: 200 }),
        "seating",
      ),
    );
    state = undo(state);
    expect(canRedo(state)).toBe(true);

    state = execute(
      state,
      addZone(
        boxShapeFromDrag("rect", { x: 300, y: 0, width: 200, height: 200 }),
        "seating",
      ),
    );

    expect(canRedo(state)).toBe(false);
  });

  test("什么都没改的命令不压栈", () => {
    let state = initialState(emptyCanvasDoc());
    state = execute(state, moveZones(["不存在的区域"], { x: 10, y: 10 }));
    expect(canUndo(state)).toBe(false);
    expect(state.dirty).toBe(false);
  });

  test("撤销一次多座位拖动，全部一起回去", () => {
    let state = initialState(docWithRectZone());
    const zoneId = state.doc.zones[0].externalId;
    state = execute(
      state,
      applyLayoutToZone(zoneId, "theater", {
        ...DEFAULT_LAYOUT_PARAMS,
        rows: 2,
        cols: 2,
      }),
    );
    const before = state.doc.seats.map((seat) => ({ x: seat.x, y: seat.y }));

    state = execute(
      state,
      moveSeats(
        state.doc.seats.map((seat) => seat.externalId),
        { x: 10, y: 10 },
      ),
    );
    state = undo(state);

    expect(state.doc.seats.map((seat) => ({ x: seat.x, y: seat.y }))).toEqual(
      before,
    );
  });
});

// ---------------------------------------------------------------------------
// interaction · 顶层区域分布判定
// ---------------------------------------------------------------------------

describe("interaction · 区域分布画布", () => {
  test("zoneContains 按形状分派：矩形/椭圆/多边形", () => {
    const rectZone = docWithRectZone().zones[0];
    expect(zoneContains(rectZone, { x: 105, y: 105 })).toBe(true);
    expect(zoneContains(rectZone, { x: 0, y: 0 })).toBe(false);

    let state = initialState(emptyCanvasDoc());
    state = execute(
      state,
      addZone(
        boxShapeFromDrag("ellipse", { x: 0, y: 0, width: 100, height: 60 }),
        "seating",
      ),
    );
    const ellipseZone = state.doc.zones[0];
    expect(zoneContains(ellipseZone, { x: 50, y: 30 })).toBe(true);
    expect(zoneContains(ellipseZone, { x: 0, y: 0 })).toBe(false);
  });

  test("hitZone 命中最上层的区域", () => {
    let state = initialState(emptyCanvasDoc());
    state = execute(
      state,
      addZone(
        boxShapeFromDrag("rect", { x: 0, y: 0, width: 200, height: 200 }),
        "seating",
      ),
    );
    state = execute(
      state,
      addZone(
        boxShapeFromDrag("rect", { x: 50, y: 50, width: 200, height: 200 }),
        "function",
      ),
    );
    // (100,100) 落在两块区域的重叠部分，应该命中后画的那个（数组末尾）。
    expect(hitZone(state.doc, { x: 100, y: 100 })).toBe(
      state.doc.zones[1].externalId,
    );
  });

  test("画矩形/椭圆/圆形工具下按下就是拉框画形状", () => {
    const doc = docWithRectZone();
    const rectSubject = resolveDragSubject({
      point: { x: 700, y: 700 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "rect",
      scale: 1,
    });
    expect(rectSubject).toEqual({
      kind: "drawZone",
      shapeType: "rect",
      start: { x: 700, y: 700 },
    });

    const ellipseSubject = resolveDragSubject({
      point: { x: 700, y: 700 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "ellipse",
      scale: 1,
    });
    expect(ellipseSubject.kind).toBe("drawZone");

    // 圆形工具在交互层跟矩形/椭圆走同一条判定分支——它不是一种要单独处理的
    // 拖拽意图，只是 shapeType 换了个值，落库时才在 boxShapeFromDrag 里摁成
    // 宽高相等（见 commands.ts 的对应测试）。
    const circleSubject = resolveDragSubject({
      point: { x: 700, y: 700 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "circle",
      scale: 1,
    });
    expect(circleSubject).toEqual({
      kind: "drawZone",
      shapeType: "circle",
      start: { x: 700, y: 700 },
    });
  });

  test("多边形工具不走拖拽状态机，由组件自己管理点击草稿", () => {
    const doc = docWithRectZone();
    const subject = resolveDragSubject({
      point: { x: 10, y: 10 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "polygon",
      scale: 1,
    });
    expect(subject).toEqual({ kind: "none" });
  });

  test("空格/中键强制平移，压过一切", () => {
    const doc = docWithRectZone();
    const subject = resolveDragSubject({
      point: { x: 200, y: 200 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "select",
      scale: 1,
      forcePan: true,
    });
    expect(subject).toEqual({ kind: "pan" });
  });

  test("选择工具下点空白是框选", () => {
    const doc = docWithRectZone();
    const subject = resolveDragSubject({
      point: { x: 900, y: 900 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "select",
      scale: 1,
    });
    expect(subject.kind).toBe("marquee");
  });

  test("选择工具下点区域内是移动区域", () => {
    const doc = docWithRectZone();
    const subject = resolveDragSubject({
      point: { x: 105, y: 105 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "select",
      scale: 1,
    });
    expect(subject.kind).toBe("moveZones");
  });

  test("选中区域后，角上的手柄优先于区域本体", () => {
    const doc = docWithRectZone();
    const zoneId = doc.zones[0].externalId;
    const subject = resolveDragSubject({
      point: { x: 100, y: 100 }, // 左上角
      doc,
      selection: { zoneIds: [zoneId], seatIds: [] },
      tool: "select",
      scale: 1,
    });
    expect(subject.kind).toBe("resizeZone");
    expect(subject.kind === "resizeZone" && subject.handle).toBe("nw");
  });

  test("没选中的区域不显示手柄，所以角上按下是移动", () => {
    const doc = docWithRectZone();
    const subject = resolveDragSubject({
      point: { x: 100, y: 100 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "select",
      scale: 1,
    });
    expect(subject.kind).toBe("moveZones");
  });

  test("手柄在屏幕上大小恒定：缩得越小，世界坐标里的判定范围越大", () => {
    const zone = docWithRectZone().zones[0];
    const small = handleRects(zone, 0.25)[0].rect;
    const large = handleRects(zone, 1)[0].rect;
    expect(small.width).toBeGreaterThan(large.width);
  });

  test("resizeRect 拖左上角时右下角不动", () => {
    const origin = { x: 100, y: 100, width: 200, height: 200 };
    const next = resizeRect(origin, "nw", { x: 50, y: 50 });
    expect(next).toEqual({ x: 150, y: 150, width: 150, height: 150 });
  });

  test("resizeRect 拖过头时翻转而不是产出负宽高", () => {
    const origin = { x: 100, y: 100, width: 100, height: 100 };
    const next = resizeRect(origin, "nw", { x: 300, y: 300 });
    expect(next.width).toBeGreaterThanOrEqual(0);
    expect(next.height).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// interaction · 排位画布（进入区域之后）
// ---------------------------------------------------------------------------

describe("interaction · 排位画布", () => {
  /** 一块区域，2×2 四个座位。 */
  const scene = () => {
    let state = initialState(docWithRectZone());
    const zoneId = state.doc.zones[0].externalId;
    state = execute(
      state,
      applyLayoutToZone(zoneId, "theater", {
        ...DEFAULT_LAYOUT_PARAMS,
        rows: 2,
        cols: 2,
        aisleEvery: 0,
      }),
    );
    return { doc: state.doc, zoneId };
  };

  test("排位画布没有区域可选——只判定座位命中和框选", () => {
    const { doc } = scene();
    const seatWorld = seatWorldPoint(doc, doc.seats[0].externalId);
    expect(seatWorld).not.toBeNull();
    if (!seatWorld) return;

    const hitting = resolveSeatDragSubject({
      point: seatWorld,
      doc,
      selection: EMPTY_SELECTION,
      tool: "select",
    });
    expect(hitting.kind).toBe("moveSeats");

    const empty = resolveSeatDragSubject({
      point: { x: 9999, y: 9999 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "select",
    });
    expect(empty.kind).toBe("marquee");
  });

  test("放座位工具下不产生拖拽（点击才放）", () => {
    const { doc } = scene();
    const subject = resolveSeatDragSubject({
      point: { x: 10, y: 10 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "seat",
    });
    expect(subject).toEqual({ kind: "none" });
  });

  test("空格/中键强制平移", () => {
    const { doc } = scene();
    const subject = resolveSeatDragSubject({
      point: { x: 10, y: 10 },
      doc,
      selection: EMPTY_SELECTION,
      tool: "select",
      forcePan: true,
    });
    expect(subject).toEqual({ kind: "pan" });
  });

  test("拖一个已选中的座位带上整组，拖没选中的只拖它自己", () => {
    const { doc } = scene();
    const ids = doc.seats.map((seat) => seat.externalId);
    const first = seatWorldPoint(doc, ids[0]);
    if (!first) throw new Error("no seat");

    const grouped = resolveSeatDragSubject({
      point: first,
      doc,
      selection: { zoneIds: [], seatIds: ids },
      tool: "select",
    });
    expect(grouped.kind === "moveSeats" && grouped.seatIds).toEqual(ids);

    const alone = resolveSeatDragSubject({
      point: first,
      doc,
      selection: { zoneIds: [], seatIds: [ids[1]] },
      tool: "select",
    });
    expect(alone.kind === "moveSeats" && alone.seatIds).toEqual([ids[0]]);
  });

  test("框选命中范围内的座位，反向拖也能选中", () => {
    const { doc } = scene();
    const all = marqueeSelect(doc, { x: 0, y: 0 }, { x: 1600, y: 1000 });
    expect(all).toHaveLength(doc.seats.length);

    const backwards = marqueeSelect(doc, { x: 1600, y: 1000 }, { x: 0, y: 0 });
    expect(backwards).toHaveLength(doc.seats.length);

    const none = marqueeSelect(doc, { x: 900, y: 900 }, { x: 950, y: 950 });
    expect(none).toEqual([]);
  });

  test("hitSeat 命中最上层的座位", () => {
    const { doc } = scene();
    const world = seatWorldPoint(doc, doc.seats[0].externalId);
    if (!world) throw new Error("no seat");
    expect(hitSeat(doc, world)).toBe(doc.seats[0].externalId);
  });
});

// ---------------------------------------------------------------------------
// 投影与序列化
// ---------------------------------------------------------------------------

describe("投影与序列化", () => {
  const richDoc = () => {
    let state = initialState(docWithRectZone());
    state = execute(
      state,
      applyLayoutToZone(state.doc.zones[0].externalId, "theater", {
        ...DEFAULT_LAYOUT_PARAMS,
        rows: 2,
        cols: 3,
      }),
    );
    return state.doc;
  };

  test("投影幂等：两次的标识完全一致", () => {
    expect(isProjectionStable(canvasEditor, richDoc())).toBe(true);
  });

  test("投影不带出任何坐标或颜色", () => {
    const projection = projectCanvas(richDoc());
    for (const seat of projection.seats) {
      expect(seat).not.toHaveProperty("x");
      expect(seat).not.toHaveProperty("y");
    }
    for (const zone of projection.zones) {
      expect(zone).not.toHaveProperty("shape");
      expect(zone).not.toHaveProperty("fill");
    }
  });

  test("孤儿座位不进投影", () => {
    const doc = richDoc();
    const withOrphan: CanvasDoc = {
      ...doc,
      seats: [
        ...doc.seats,
        {
          externalId: "s_orphan",
          zoneExternalId: "不存在",
          label: "X1",
          kind: "seat",
          rank: "normal",
          ordinal: 99,
          x: 0,
          y: 0,
        },
      ],
    };
    expect(
      projectCanvas(withOrphan).seats.some((seat) => seat.label === "X1"),
    ).toBe(false);
  });

  test("序列化往返不丢东西（含多边形区域）", () => {
    let state = initialState(emptyCanvasDoc());
    const shape = polygonShapeFromPoints([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 100, y: 150 },
    ]);
    if (!shape) throw new Error("shape is null");
    state = execute(state, addZone(shape, "seating"));
    const doc = state.doc;

    const round = parseCanvasDoc(JSON.parse(JSON.stringify(doc)));
    expect(round).toEqual(doc);
  });

  test("别的渲染器的 blob 解不出来", () => {
    expect(
      canvasEditor.safeParse({ schemaVersion: 1, zones: [], seats: [] }),
    ).toBeNull();
    expect(canvasEditor.safeParse(null)).toBeNull();
    expect(canvasEditor.safeParse("不是对象")).toBeNull();
  });

  test("缺几何或缺颜色的区域不放行", () => {
    const base = {
      schemaVersion: 1,
      world: { width: 100, height: 100 },
      seats: [],
    };
    expect(
      canvasEditor.safeParse({
        ...base,
        zones: [{ externalId: "z1", name: "A", kind: "seating", ordinal: 0 }],
      }),
    ).toBeNull();
    expect(
      canvasEditor.safeParse({
        ...base,
        zones: [
          {
            externalId: "z1",
            name: "A",
            kind: "seating",
            ordinal: 0,
            shape: { type: "rect", x: 0, y: 0, width: 10, height: 10 },
            // 缺 fill/stroke
          },
        ],
      }),
    ).toBeNull();
  });

  test("多边形缺顶点或顶点不足 3 个不放行", () => {
    const zoneBase = {
      externalId: "z1",
      name: "A",
      kind: "seating",
      ordinal: 0,
      fill: "#111111",
      stroke: "#111111",
    };
    expect(
      parseCanvasDoc({
        schemaVersion: 1,
        world: { width: 100, height: 100 },
        seats: [],
        zones: [
          {
            ...zoneBase,
            shape: {
              type: "polygon",
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
            },
          },
        ],
      }),
    ).toBeNull();
  });

  test("从表单式结构升级成画布，区域和座位都还在，颜色有默认值", () => {
    const projection = projectCanvas(richDoc());
    const upgraded = canvasDocFromProjection(projection);

    expect(upgraded.zones.map((z) => z.externalId)).toEqual(
      projection.zones.map((z) => z.externalId),
    );
    expect(upgraded.seats).toHaveLength(projection.seats.length);
    expect(upgraded.zones.every((z) => z.fill.length > 0)).toBe(true);
    expect(projectCanvas(upgraded)).toEqual(projection);
  });

  test("升级后的座位落在各自区域内", () => {
    const upgraded = canvasDocFromProjection(projectCanvas(richDoc()));
    const zoneById = new Map(
      upgraded.zones.map((zone) => [zone.externalId, zone]),
    );

    for (const seat of upgraded.seats) {
      const zone = zoneById.get(seat.zoneExternalId);
      expect(zone).toBeDefined();
      if (!zone) continue;
      expect(seat.x).toBeLessThanOrEqual(zone.shape.width);
      expect(seat.y).toBeLessThanOrEqual(zone.shape.height);
    }
  });

  test("生成出来的文档能通过共用校验", () => {
    expect(validateProjection(projectCanvas(richDoc()))).toEqual([]);
  });
});
