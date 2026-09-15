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
import { EMPTY_SELECTION, resolveSeatDragSubject } from "./interaction";
import { DEFAULT_LAYOUT_PARAMS } from "./layout";
import {
  addRow,
  DEFAULT_ROW_PARAMS,
  moveRowOrder,
  removeRow,
  rowParamsFromDrag,
  rowPoints,
  updateRow,
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
