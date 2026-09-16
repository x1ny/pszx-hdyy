import { describe, expect, test } from "vitest";
import { buildPlanDoc } from "../../plan-doc";
import {
  addZone,
  applyLayoutToZone,
  moveSeats,
  removeSeats,
  removeZones,
} from "./commands";
import { emptyCanvasDoc, parseCanvasDoc } from "./document";
import { execute, initialState, redo, undo } from "./history";
import {
  EMPTY_SELECTION,
  hitTable,
  resolveSeatDragSubject,
} from "./interaction";
import { DEFAULT_LAYOUT_PARAMS } from "./layout";
import {
  addRow,
  DEFAULT_ROW_PARAMS,
  DEFAULT_TABLE_SIDES,
  moveRowOrder,
  removeRow,
  rowParamsFromDrag,
  rowPoints,
  tableGeometry,
  updateRow,
  validRowParams,
} from "./rows";

function fixture() {
  let state = execute(
    initialState(emptyCanvasDoc()),
    addZone({ type: "rect", x: 0, y: 0, width: 100, height: 100 }),
  );
  const zoneId = state.doc.zones[0].externalId;
  state = execute(
    state,
    addRow(
      zoneId,
      { x: -100, y: -200 },
      { ...DEFAULT_ROW_PARAMS, name: "第5排", count: 5 },
      "r1",
    ),
  );
  return { state, zoneId };
}

describe("显式排", () => {
  test("模板增座沿用编号，环形排间距对应相邻座位中心距离", () => {
    let { state, zoneId } = fixture();
    state = execute(
      state,
      applyLayoutToZone(zoneId, "theater", {
        ...DEFAULT_LAYOUT_PARAMS,
        rows: 1,
        cols: 3,
      }),
    );
    const row = state.doc.rows?.[0];
    if (!row) throw new Error("缺排");
    state = execute(state, updateRow(row.externalId, { ...row, count: 4 }));
    expect(state.doc.seats.map((seat) => seat.label)).toEqual([
      "A1",
      "A2",
      "A3",
      "A4",
    ]);
    for (const count of [2, 3, 8, 16]) {
      const points = rowPoints({ ...row, shape: "circle", spacing: 60 }, count);
      expect(
        Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
      ).toBeCloseTo(60);
    }
  });
  test("数量和间距调整保留存活座位 ID、编号、性质，并可撤销重做", () => {
    let { state } = fixture();
    const original = state.doc;
    state = execute(
      state,
      updateRow("r1", {
        ...DEFAULT_ROW_PARAMS,
        name: "贵宾排",
        count: 7,
        spacing: 60,
      }),
    );
    expect(
      state.doc.seats
        .slice(0, 5)
        .map((seat) => [seat.externalId, seat.label, seat.rank]),
    ).toEqual(
      original.seats.map((seat) => [seat.externalId, seat.label, seat.rank]),
    );
    expect(state.doc.seats[1].x - state.doc.seats[0].x).toBe(60);
    expect(undo(state).doc).toEqual(original);
    expect(redo(undo(state)).doc).toEqual(state.doc);
    state = execute(
      state,
      updateRow("r1", { ...DEFAULT_ROW_PARAMS, name: "贵宾排", count: 3 }),
    );
    expect(state.doc.rows?.[0].seatIds).toEqual(
      original.rows?.[0].seatIds.slice(0, 3),
    );
    expect(state.doc.seats).toHaveLength(3);
  });

  test("单座自由移动不改归属和顺序；整排移动同步生成起点", () => {
    let { state } = fixture();
    const row = state.doc.rows?.[0];
    if (!row) throw new Error("缺排");
    state = execute(state, moveSeats([row.seatIds[1]], { x: 12, y: 20 }));
    const movedSeat = state.doc.seats[1];
    expect(state.doc.rows?.[0]).toEqual(row);
    state = execute(
      state,
      updateRow("r1", { ...DEFAULT_ROW_PARAMS, name: row.name, count: 6 }),
    );
    expect(state.doc.seats[1]).toEqual(movedSeat);
    state = execute(
      state,
      moveSeats(state.doc.rows?.[0].seatIds ?? [], { x: 300, y: 200 }),
    );
    expect(state.doc.rows?.[0].x).toBe(200);
    state = execute(
      state,
      updateRow("r1", {
        ...DEFAULT_ROW_PARAMS,
        name: row.name,
        count: 7,
        spacing: 60,
      }),
    );
    expect(state.doc.seats[0].x).toBe(200);
  });

  test("显式顺序不解析排名称；删除座位、排、区域不留悬空关联", () => {
    let { state, zoneId } = fixture();
    state = execute(
      state,
      addRow(
        zoneId,
        { x: 0, y: 0 },
        { ...DEFAULT_ROW_PARAMS, name: "第3排" },
        "r2",
      ),
    );
    state = execute(state, moveRowOrder("r2", -1));
    expect(state.doc.rows?.map((row) => row.name)).toEqual(["第3排", "第5排"]);
    const id = state.doc.seats[0].externalId;
    state = execute(state, removeSeats([id]));
    expect(state.doc.rows?.flatMap((row) => row.seatIds)).not.toContain(id);
    state = execute(state, removeRow("r2"));
    expect(state.doc.rows).toHaveLength(1);
    state = execute(state, removeZones([zoneId]));
    expect(state.doc.rows).toEqual([]);
    expect(state.doc.seats).toEqual([]);
  });

  test.each([
    "theater",
    "runway",
    "banquet",
  ] as const)("%s 模板持久化排，方案复制保留排关系", (preset) => {
    let { state, zoneId } = fixture();
    state = execute(
      state,
      applyLayoutToZone(zoneId, preset, DEFAULT_LAYOUT_PARAMS),
    );
    expect(state.doc.rows).toHaveLength(preset === "runway" ? 12 : 6);
    expect(state.doc.rows?.flatMap((row) => row.seatIds)).toEqual(
      state.doc.seats.map((seat) => seat.externalId),
    );
    expect(parseCanvasDoc(JSON.parse(JSON.stringify(state.doc)))).toEqual(
      state.doc,
    );
    const plan = buildPlanDoc({
      layoutData: state.doc,
      zoneExternalId: zoneId,
      zoneName: "测试",
      zoneKind: "seating",
    });
    expect(plan.doc.rows).toEqual(state.doc.rows);
    expect(plan.seats.map((seat) => seat.externalId)).toEqual(
      state.doc.seats.map((seat) => seat.externalId),
    );
  });

  test("旧文档不猜排；拒绝跨区、重复归属和失效引用", () => {
    expect(parseCanvasDoc(emptyCanvasDoc())?.rows).toBeUndefined();
    const { state } = fixture();
    const row = state.doc.rows?.[0];
    expect(
      parseCanvasDoc({
        ...state.doc,
        rows: [{ ...row, seatIds: ["missing"] }],
      }),
    ).toBeNull();
    expect(
      parseCanvasDoc({
        ...state.doc,
        rows: [row, { ...row, externalId: "other" }],
      }),
    ).toBeNull();
    expect(
      parseCanvasDoc({
        ...state.doc,
        rows: [{ ...row, zoneExternalId: "missing" }],
      }),
    ).toBeNull();
  });

  test("拖动生成反向和斜排，过道计入长度；平移优先于画排", () => {
    const { state } = fixture();
    const params = rowParamsFromDrag(
      { x: 0, y: 0 },
      { x: -240, y: 0 },
      { ...DEFAULT_ROW_PARAMS, aisleEvery: 2 },
    );
    expect(params.count).toBe(4);
    expect(params.angle).toBe(180);
    expect(
      rowParamsFromDrag({ x: 0, y: 0 }, { x: 48, y: 48 }, DEFAULT_ROW_PARAMS)
        .angle,
    ).toBe(45);
    const input = {
      point: { x: 0, y: 0 },
      doc: state.doc,
      selection: EMPTY_SELECTION,
      tool: "row" as const,
    };
    expect(resolveSeatDragSubject(input).kind).toBe("drawRow");
    expect(resolveSeatDragSubject({ ...input, forcePan: true }).kind).toBe(
      "pan",
    );
  });
});

describe("桌：圆桌/方桌是排的两种 shape", () => {
  test("方桌按四侧人数顺时针生成连续座位，两侧为 0 时直接跳到对边", () => {
    const { state, zoneId } = fixture();
    const result = execute(
      state,
      addRow(
        zoneId,
        { x: 0, y: 0 },
        {
          ...DEFAULT_ROW_PARAMS,
          shape: "rect",
          sides: { top: 2, right: 0, bottom: 2, left: 0 },
          spacing: 48,
        },
        "t1",
      ),
    );
    const row = result.doc.rows?.find((item) => item.externalId === "t1");
    if (!row) throw new Error("缺桌");
    expect(row.seatIds).toHaveLength(4);
    const points = row.seatIds.map((id) =>
      result.doc.seats.find((seat) => seat.externalId === id),
    );
    // 上边左→右，直接跳到下边（左右两侧为 0），下边右→左。
    expect(points.map((p) => [p?.x, p?.y])).toEqual([
      [-24, -40.8],
      [24, -40.8],
      [24, 40.8],
      [-24, 40.8],
    ]);
    const shape = tableGeometry(row, row.seatIds.length);
    expect(shape).toEqual({
      shape: "rect",
      cx: 0,
      cy: 0,
      width: 48,
      height: 48,
      angle: 0,
    });
  });

  test("圆桌沿用环形排半径，桌面比座位圈内缩；少于 2 座不画桌面", () => {
    const { state, zoneId } = fixture();
    const result = execute(
      state,
      addRow(
        zoneId,
        { x: 10, y: 20 },
        { ...DEFAULT_ROW_PARAMS, shape: "circle", count: 6, spacing: 48 },
        "t2",
      ),
    );
    const row = result.doc.rows?.find((item) => item.externalId === "t2");
    if (!row) throw new Error("缺桌");
    const shape = tableGeometry(row, row.seatIds.length);
    expect(shape?.shape).toBe("circle");
    if (shape?.shape !== "circle") throw new Error("expected circle");
    expect(shape.cx).toBe(10);
    expect(shape.cy).toBe(20);
    expect(shape.radius).toBeLessThan(48);
    expect(shape.radius).toBeGreaterThan(0);
    expect(tableGeometry({ ...row, shape: "circle" }, 1)).toBeNull();
    expect(tableGeometry({ ...row, shape: "line" }, 6)).toBeNull();
  });

  test("改四侧人数触发重排，位置更新但存活座位 ID 不变；改名不影响几何", () => {
    let { state, zoneId } = fixture();
    state = execute(
      state,
      addRow(
        zoneId,
        { x: 0, y: 0 },
        { ...DEFAULT_ROW_PARAMS, shape: "rect", sides: DEFAULT_TABLE_SIDES },
        "t3",
      ),
    );
    const before = state.doc.rows?.find((row) => row.externalId === "t3");
    if (!before) throw new Error("缺桌");
    expect(before.seatIds).toHaveLength(12);
    const firstSeatId = before.seatIds[0];
    const positionBefore = state.doc.seats.find(
      (seat) => seat.externalId === firstSeatId,
    );
    state = execute(
      state,
      updateRow("t3", {
        ...DEFAULT_ROW_PARAMS,
        name: before.name,
        shape: "rect",
        sides: { ...DEFAULT_TABLE_SIDES, right: 8 },
      }),
    );
    const after = state.doc.rows?.find((row) => row.externalId === "t3");
    expect(after?.seatIds).toHaveLength(14);
    // 座位数变了、位置随参数重算，但排尾之前的座位 ID 保留——用户改人数
    // 不会打散已经排好的座位归属。
    expect(after?.seatIds.slice(0, 12)).toEqual(before.seatIds);
    const positionAfter = state.doc.seats.find(
      (seat) => seat.externalId === firstSeatId,
    );
    expect(positionAfter?.externalId).toBe(firstSeatId);
    expect(positionAfter).not.toEqual(positionBefore);
  });

  test("方桌校验：四侧至少一座，负数或非整数拒绝", () => {
    expect(
      validRowParams({
        ...DEFAULT_ROW_PARAMS,
        shape: "rect",
        sides: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    ).toBe(false);
    expect(
      validRowParams({
        ...DEFAULT_ROW_PARAMS,
        shape: "rect",
        sides: { top: 1.5, right: 0, bottom: 0, left: 0 },
      }),
    ).toBe(false);
    expect(
      validRowParams({
        ...DEFAULT_ROW_PARAMS,
        shape: "rect",
        sides: { top: -1, right: 1, bottom: 0, left: 0 },
      }),
    ).toBe(false);
    expect(
      validRowParams({
        ...DEFAULT_ROW_PARAMS,
        shape: "rect",
        sides: undefined,
      }),
    ).toBe(false);
    expect(
      validRowParams({
        ...DEFAULT_ROW_PARAMS,
        shape: "rect",
        sides: DEFAULT_TABLE_SIDES,
      }),
    ).toBe(true);
  });

  test("方桌随文档序列化往返；sides 缺失或含负数时整份拒绝", () => {
    const { state, zoneId } = fixture();
    const result = execute(
      state,
      addRow(
        zoneId,
        { x: 0, y: 0 },
        { ...DEFAULT_ROW_PARAMS, shape: "rect", sides: DEFAULT_TABLE_SIDES },
        "t4",
      ),
    );
    const roundTripped = parseCanvasDoc(JSON.parse(JSON.stringify(result.doc)));
    expect(roundTripped).toEqual(result.doc);
    const row = result.doc.rows?.find((item) => item.externalId === "t4");
    expect(
      parseCanvasDoc({
        ...result.doc,
        rows: [{ ...row, sides: { top: -1, right: 0, bottom: 0, left: 1 } }],
      }),
    ).toBeNull();
    expect(
      parseCanvasDoc({
        ...result.doc,
        rows: [{ ...row, sides: undefined }],
      }),
    ).toBeNull();
  });

  test("桌的座位不能单独拖动：命中桌上任一座位都拖整桌，不取当前选区", () => {
    const { state, zoneId } = fixture();
    const result = execute(
      state,
      addRow(
        zoneId,
        { x: 0, y: 0 },
        { ...DEFAULT_ROW_PARAMS, shape: "circle", count: 6, spacing: 48 },
        "table",
      ),
    );
    const row = result.doc.rows?.find((item) => item.externalId === "table");
    if (!row) throw new Error("缺桌");
    const point = { x: 48, y: 0 }; // 圆桌半径 48，第一个座位大致在这附近
    const seatId = row.seatIds.find(
      (id) =>
        Math.hypot(
          (result.doc.seats.find((s) => s.externalId === id)?.x ?? 0) - point.x,
          (result.doc.seats.find((s) => s.externalId === id)?.y ?? 0) - point.y,
        ) < 13,
    );
    if (!seatId) throw new Error("测试点没有命中座位，调整坐标");

    // 即使当前只选中了别的座位（甚至没有选中这颗），拖动目标也是整桌。
    const subject = resolveSeatDragSubject({
      point,
      doc: result.doc,
      selection: { zoneIds: [], seatIds: [row.seatIds[3]] },
      tool: "select",
    });
    expect(subject).toEqual({ kind: "moveSeats", seatIds: row.seatIds });
  });

  test("命中桌面本体（座位间的空档）也能拖整桌；直排的座位不受影响", () => {
    const { state, zoneId } = fixture();
    const result = execute(
      state,
      addRow(
        zoneId,
        { x: 0, y: 0 },
        { ...DEFAULT_ROW_PARAMS, shape: "circle", count: 8, spacing: 48 },
        "table",
      ),
    );
    // 圆心附近没有任何座位，只有桌面本体。
    expect(hitTable(result.doc, { x: 0, y: 0 })?.externalId).toBe("table");
    const subject = resolveSeatDragSubject({
      point: { x: 0, y: 0 },
      doc: result.doc,
      selection: EMPTY_SELECTION,
      tool: "select",
    });
    expect(subject.kind).toBe("moveSeats");
    expect(subject.kind === "moveSeats" && subject.seatIds).toEqual(
      result.doc.rows?.find((row) => row.externalId === "table")?.seatIds,
    );

    // 场地外远处不命中任何桌面，退回框选。
    expect(hitTable(result.doc, { x: 9999, y: 9999 })).toBeNull();

    // 直排（fixture 里的 "r1"）不是桌，单座拖动仍是它自己，不牵连整排。
    const plainRow = result.doc.rows?.find((row) => row.externalId === "r1");
    if (!plainRow) throw new Error("缺直排");
    const plainSeatId = plainRow.seatIds[1];
    const plainSeat = result.doc.seats.find(
      (seat) => seat.externalId === plainSeatId,
    );
    if (!plainSeat) throw new Error("缺座位");
    const plainSubject = resolveSeatDragSubject({
      point: { x: plainSeat.x, y: plainSeat.y },
      doc: result.doc,
      selection: EMPTY_SELECTION,
      tool: "select",
    });
    expect(plainSubject).toEqual({
      kind: "moveSeats",
      seatIds: [plainSeatId],
    });
  });
});
