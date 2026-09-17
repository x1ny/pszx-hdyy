import { describe, expect, test } from "vitest";
import { buildPlanDoc } from "../../plan-doc";
import { buildSeatingPlanSvg } from "../seating-plan-jpeg";
import { removeZones } from "./commands";
import {
  type CanvasDoc,
  type CanvasMark,
  parseCanvasDoc,
  projectCanvas,
} from "./document";
import { execute, initialState, undo } from "./history";
import { resolveSeatDragSubject } from "./interaction";
import {
  addMark,
  defaultMarkShape,
  MARK_COLORS,
  markLabelLayout,
  markShapeFromPoints,
  markShapeLabel,
  markTextColor,
  moveMark,
  nextMarkColor,
  patchMark,
  removeMark,
  resizeMark,
} from "./marks";

const mark = (patch: Partial<CanvasMark> = {}): CanvasMark => ({
  externalId: "m1",
  zoneExternalId: "zone-a",
  label: "主题板",
  color: "#DC2626",
  shape: { type: "rect", x: 100, y: -200, width: 300, height: 50 },
  ...patch,
});

const fixture = (marks?: CanvasMark[]): CanvasDoc => ({
  schemaVersion: 1,
  world: { width: 1600, height: 1000 },
  zones: [
    {
      externalId: "zone-a",
      name: "主会场",
      kind: "seating",
      ordinal: 0,
      fill: "#2a78d6",
      stroke: "#2a78d6",
      shape: { type: "rect", x: 0, y: 0, width: 400, height: 300 },
    },
  ],
  seats: Array.from({ length: 6 }, (_, index) => ({
    externalId: `s${index}`,
    zoneExternalId: "zone-a",
    label: `${index + 1}号`,
    kind: "seat" as const,
    rank: "normal" as const,
    ordinal: index,
    x: index * 48,
    y: 0,
  })),
  ...(marks ? { marks } : {}),
});

describe("标注的解析", () => {
  test("合法标注原样读回，旋转被丢掉，缺省时没有 marks 字段", () => {
    const rotated = mark({
      shape: {
        type: "ellipse",
        x: 0,
        y: 0,
        width: 40,
        height: 20,
        rotation: 30,
      },
    });
    const parsed = parseCanvasDoc(fixture([rotated]));
    expect(parsed?.marks).toEqual([
      {
        ...rotated,
        shape: { type: "ellipse", x: 0, y: 0, width: 40, height: 20 },
      },
    ]);
    expect(parseCanvasDoc(fixture())).not.toHaveProperty("marks");
  });

  test("文字允许为空，但颜色、尺寸、归属或重复标识不合法时整份拒绝", () => {
    expect(parseCanvasDoc(fixture([mark({ label: "" })]))?.marks).toHaveLength(
      1,
    );
    for (const bad of [
      [mark({ color: "red" })],
      [mark({ label: "长".repeat(33) })],
      [mark({ zoneExternalId: "missing" })],
      [mark({ shape: { type: "rect", x: 0, y: 0, width: 0, height: 10 } })],
      [mark(), mark()],
    ]) {
      expect(parseCanvasDoc(fixture(bad))).toBeNull();
    }
  });

  test("标注不进投影，服务端归并看不到它", () => {
    expect(projectCanvas(fixture([mark()]))).toEqual(projectCanvas(fixture()));
  });
});

describe("标注命令", () => {
  test("新增、移动、改字改色、删除，每步都能撤销", () => {
    let state = initialState(fixture());
    state = execute(state, addMark(mark({ label: "门".repeat(40) })));
    expect(state.doc.marks?.[0]?.label).toHaveLength(32);

    state = execute(state, moveMark("m1", { x: 10, y: -5 }));
    expect(state.doc.marks?.[0]?.shape).toMatchObject({ x: 110, y: -205 });

    state = execute(
      state,
      patchMark("m1", { label: "门口", color: "#15803d" }),
    );
    expect(state.doc.marks?.[0]).toMatchObject({
      label: "门口",
      color: "#15803D",
    });
    state = execute(state, patchMark("m1", { color: "not-a-color" }));
    expect(state.doc.marks?.[0]?.color).toBe("#15803D");

    state = execute(state, removeMark("m1"));
    expect(state.doc.marks).toEqual([]);
    state = undo(state);
    expect(state.doc.marks?.[0]?.label).toBe("门口");
  });

  test("缩放多边形时顶点同比缩放，尺寸有下限", () => {
    const shape = markShapeFromPoints([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 50 },
    ]);
    expect(shape).not.toBeNull();
    if (!shape) return;
    let state = initialState(fixture([mark({ shape })]));
    state = execute(
      state,
      resizeMark("m1", { x: -10, y: -10, width: 200, height: 1 }),
    );
    const resized = state.doc.marks?.[0]?.shape;
    expect(resized).toMatchObject({ x: -10, y: -10, width: 200, height: 8 });
    expect(resized?.type === "polygon" && resized.points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 100, y: 8 },
    ]);
  });

  test("不能挂到不存在的分区；删除分区连带删除标注", () => {
    let state = initialState(fixture());
    state = execute(state, addMark(mark({ zoneExternalId: "missing" })));
    expect(state.doc.marks).toBeUndefined();
    state = initialState(fixture([mark()]));
    state = execute(state, removeZones(["zone-a"]));
    expect(state.doc.marks).toEqual([]);
  });

  test("圆形存成等宽高椭圆，列表里仍叫圆形", () => {
    expect(markShapeLabel(defaultMarkShape("circle", { x: 0, y: 0 }, 48))).toBe(
      "圆形",
    );
    expect(
      markShapeLabel(defaultMarkShape("ellipse", { x: 0, y: 0 }, 48)),
    ).toBe("椭圆");
    expect(markShapeLabel(mark().shape)).toBe("矩形");
  });

  test("点一下放默认尺寸；少于 3 个点或整体过小的多边形不成立", () => {
    expect(defaultMarkShape("circle", { x: 0, y: 0 }, 48)).toMatchObject({
      type: "ellipse",
      x: -48,
      y: -48,
      width: 96,
      height: 96,
    });
    expect(
      markShapeFromPoints([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
    expect(
      markShapeFromPoints([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 2 },
      ]),
    ).toBeNull();
  });
});

describe("颜色", () => {
  test("新标注取第一个没用过的预置色，全用过后循环", () => {
    expect(nextMarkColor([])).toBe(MARK_COLORS[0].value);
    expect(nextMarkColor([{ color: MARK_COLORS[0].value.toLowerCase() }])).toBe(
      MARK_COLORS[1].value,
    );
    const all = MARK_COLORS.map((color) => ({ color: color.value }));
    expect(nextMarkColor(all)).toBe(MARK_COLORS[0].value);
  });

  test("预置色都能直接当文字色，浅色改用前景色", () => {
    for (const color of MARK_COLORS)
      expect(markTextColor(color.value)).toBe(color.value);
    expect(markTextColor("#FDE68A")).toBeNull();
    expect(markTextColor("oops")).toBeNull();
  });
});

describe("标注文字排版", () => {
  const board = mark().shape;
  const door = { type: "rect" as const, x: 0, y: 0, width: 68, height: 135 };

  test("放得下横排；缩小后瘦高形状改竖排，再小就进图例", () => {
    expect(markLabelLayout(board, "主题板", 1)).toMatchObject({
      mode: "horizontal",
      x: 250,
      y: -175,
    });
    expect(markLabelLayout(door, "门口", 1).mode).toBe("horizontal");
    expect(markLabelLayout(door, "门口", 0.25).mode).toBe("vertical");
    expect(markLabelLayout(door, "门口", 0.1).mode).toBe("legend");
    expect(markLabelLayout(board, "主题板", 0.05).mode).toBe("legend");
  });

  test("没字不排；椭圆和多边形按内部可写区域算", () => {
    expect(markLabelLayout(board, "  ", 1).mode).toBe("none");
    const ellipse = {
      type: "ellipse" as const,
      x: 0,
      y: 0,
      width: 50,
      height: 26,
    };
    // 矩形 50×26 能写下 3 个字，椭圆只剩内接部分。
    expect(
      markLabelLayout({ ...ellipse, type: "rect" }, "舞台区", 1).mode,
    ).toBe("horizontal");
    expect(markLabelLayout(ellipse, "舞台区", 1).mode).toBe("legend");
    const triangle = markShapeFromPoints([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 0, y: 300 },
    ]);
    if (!triangle) throw new Error("triangle");
    // 文字落在形心，不是包围盒中心。
    expect(markLabelLayout(triangle, "吧台", 1)).toMatchObject({
      mode: "horizontal",
      x: 100,
      y: 100,
    });
  });
});

describe("排位画布的标注手势", () => {
  const doc = fixture([mark()]);
  const base = {
    doc,
    selection: { zoneIds: [], seatIds: [] },
    hitRadius: 12,
    scale: 1,
  };

  test("标注工具拖出形状，多边形改走逐点点击", () => {
    expect(
      resolveSeatDragSubject({ ...base, point: { x: 0, y: 0 }, tool: "mark" }),
    ).toEqual({ kind: "drawMark", shapeType: "rect", start: { x: 0, y: 0 } });
    expect(
      resolveSeatDragSubject({
        ...base,
        point: { x: 0, y: 0 },
        tool: "mark",
        markShape: "polygon",
      }),
    ).toEqual({ kind: "none" });
  });

  test("座位优先于标注；选中的标注从四角缩放", () => {
    expect(
      resolveSeatDragSubject({
        ...base,
        point: { x: 200, y: -180 },
        tool: "select",
      }),
    ).toEqual({ kind: "moveMark", markId: "m1" });
    expect(
      resolveSeatDragSubject({
        ...base,
        point: { x: 48, y: 0 },
        tool: "select",
      }),
    ).toEqual({ kind: "moveSeats", seatIds: ["s1"] });
    expect(
      resolveSeatDragSubject({
        ...base,
        point: { x: 401, y: -149 },
        tool: "select",
        activeMarkId: "m1",
      }),
    ).toMatchObject({ kind: "resizeMark", markId: "m1", handle: "se" });
  });
});

describe("方案快照与导出", () => {
  test("建方案只带走目标分区的标注", () => {
    const source = fixture([
      mark(),
      mark({ externalId: "m2", zoneExternalId: "zone-b" }),
    ]);
    source.zones.push({
      ...source.zones[0],
      externalId: "zone-b",
      name: "副场",
    });
    const { doc } = buildPlanDoc({
      layoutData: source,
      zoneExternalId: "zone-a",
      zoneName: "主会场",
      zoneKind: "seating",
    });
    expect(doc.marks?.map((item) => item.externalId)).toEqual(["m1"]);
  });

  test("导出图画出标注，并把座位外侧的标注装进画面；放不下的进图例", () => {
    const door = mark({
      externalId: "m2",
      label: "门口",
      color: "#15803D",
      shape: { type: "rect", x: -120, y: 0, width: 4, height: 4 },
    });
    const { svg } = buildSeatingPlanSvg({
      doc: fixture([mark(), door]),
      title: "排位",
    });
    expect(svg).toContain('data-export-mark-id="m1"');
    expect(svg).toContain('data-export-mark-label-mode="horizontal"');
    expect(svg).toContain('data-export-mark-label-mode="legend"');
    expect(svg).toMatch(/data-export-legend-mark="true">[\s\S]*?门口/);
    // 标注在座位上方 200 单位处，外层平移必须把它挪回画面内。
    expect(svg).toMatch(/translate\(\d+(\.\d+)? 2\d\d(\.\d+)?\)/);
  });
});
