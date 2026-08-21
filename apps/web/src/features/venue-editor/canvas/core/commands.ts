import type { Draft } from "immer";
import type { SeatKind, SeatRank, ZoneKind } from "../../contract";
import {
  type CanvasDoc,
  type CanvasSeat,
  type CanvasZone,
  newId,
  ZONE_KIND_DEFAULT_COLOR,
  type ZoneShape,
} from "./document";
import {
  boundsOf,
  clamp,
  clampPointToRect,
  type Point,
  type Rect,
  scalePoint,
  scalePoints,
} from "./geometry";
import { generateLayout, type LayoutParams, type LayoutPreset } from "./layout";

/**
 * 对文档的所有修改都走 Command。
 *
 * 交互层不直接 setState，而是**产出一个 Command 交给 history 执行**。这一条同时
 * 解决四件事（docs/场地排位编辑器设计.md §4.1）：
 *
 * 1. undo 白拿——immer 的 `produceWithPatches` 直接给反向补丁
 * 2. 命令可单测——"把选中的 3 个座位右移 10px"是纯输入输出，能断言
 * 3. commit 边界显式——一次手势 = 一个 Command = 一个 undo 步
 * 4. 操作留痕有出处——`label` 将来可以直接喂给 `segment_seating_log`
 */
export type Command = {
  label: string;
  apply: (draft: Draft<CanvasDoc>) => void;
};

/** 区域最小尺寸。再小就点不中、也放不下任何座位。 */
export const MIN_ZONE_SIZE = 60;
/** 座位到区域边框的最小距离，跟 layout.ts 的内边距同一个量级。 */
const SEAT_PAD = 12;

const findZone = (draft: Draft<CanvasDoc>, zoneId: string) =>
  draft.zones.find((zone) => zone.externalId === zoneId);

// ---------------------------------------------------------------------------
// 区域：形状、位置、颜色
// ---------------------------------------------------------------------------

/**
 * 新增区域。**接受完整的 `ZoneShape`**，不再只认矩形——调用方（画布组件）
 * 按当前工具把拖拽结果或多边形顶点组装成对应的 shape，这里只管落库。
 * 颜色按 `kind` 取默认值，之后用户可以在属性面板里单独改，不再跟 kind 绑定。
 */
export const addZone = (
  shape: ZoneShape,
  kind: ZoneKind = "seating",
): Command => ({
  label: "新增区域",
  apply: (draft) => {
    const color = ZONE_KIND_DEFAULT_COLOR[kind];
    draft.zones.push({
      externalId: newId("z"),
      name: `区域 ${draft.zones.length + 1}`,
      kind,
      ordinal: draft.zones.length,
      fill: color.fill,
      stroke: color.stroke,
      shape,
    });
  },
});

/** 把一段拖拽的对角点组装成矩形/椭圆的 shape。多边形走 `polygonShapeFromPoints`。 */
export function boxShapeFromDrag(
  shapeType: "rect" | "ellipse",
  rect: Rect,
): ZoneShape {
  return {
    type: shapeType,
    x: rect.x,
    y: rect.y,
    width: Math.max(MIN_ZONE_SIZE, rect.width),
    height: Math.max(MIN_ZONE_SIZE, rect.height),
  };
}

/**
 * 把点击累积的一串绝对坐标顶点组装成多边形 shape：算包围盒，顶点转成相对
 * 包围盒左上角的坐标。这条转换只在"完成绘制"这一刻做一次，之后顶点就一直是
 * 相对值——跟座位坐标的道理一样，区域整体移动时不用重算任何一个顶点。
 */
export function polygonShapeFromPoints(points: Point[]): ZoneShape | null {
  if (points.length < 3) return null;
  const bounds = boundsOf(points);
  const width = Math.max(MIN_ZONE_SIZE, bounds.width);
  const height = Math.max(MIN_ZONE_SIZE, bounds.height);
  return {
    type: "polygon",
    x: bounds.x,
    y: bounds.y,
    width,
    height,
    points: points.map((p) => ({ x: p.x - bounds.x, y: p.y - bounds.y })),
  };
}

/**
 * 平移区域。**座位不用动**——它们存的是相对坐标，跟着区域走是白拿的。
 * 多边形的顶点同理，也是相对坐标，平移不需要碰它。
 */
export const moveZones = (zoneIds: string[], delta: Point): Command => ({
  label: "移动区域",
  apply: (draft) => {
    const targets = new Set(zoneIds);
    for (const zone of draft.zones) {
      if (!targets.has(zone.externalId)) continue;
      zone.shape.x = clamp(
        zone.shape.x + delta.x,
        0,
        draft.world.width - zone.shape.width,
      );
      zone.shape.y = clamp(
        zone.shape.y + delta.y,
        0,
        draft.world.height - zone.shape.height,
      );
    }
  },
});

/**
 * 缩放区域，区域内的座位、多边形顶点都按比例同步。
 *
 * 不同步的话，把区域拉小之后座位会溜到框外——那不是"座位在区域里"这个模型该有的
 * 样子，而且投影出去的数据没错、只有视觉错，最难发现。
 */
export const resizeZone = (zoneId: string, next: Rect): Command => ({
  label: "调整区域大小",
  apply: (draft) => {
    const zone = findZone(draft, zoneId);
    if (!zone) return;

    const from = { width: zone.shape.width, height: zone.shape.height };
    const to = {
      width: Math.max(MIN_ZONE_SIZE, next.width),
      height: Math.max(MIN_ZONE_SIZE, next.height),
    };

    zone.shape.x = clamp(next.x, 0, draft.world.width - to.width);
    zone.shape.y = clamp(next.y, 0, draft.world.height - to.height);
    zone.shape.width = to.width;
    zone.shape.height = to.height;

    if (zone.shape.type === "polygon") {
      zone.shape.points = scalePoints(zone.shape.points, from, to);
    }

    for (const seat of draft.seats) {
      if (seat.zoneExternalId !== zoneId) continue;
      const scaled = scalePoint({ x: seat.x, y: seat.y }, from, to);
      const clamped = clampPointToRect(
        scaled,
        { x: 0, y: 0, width: to.width, height: to.height },
        SEAT_PAD,
      );
      seat.x = clamped.x;
      seat.y = clamped.y;
    }
  },
});

/** 改名、改类型、改颜色，合成一个命令——都是"这块区域的属性"，没必要拆三个。 */
export const patchZone = (
  zoneId: string,
  patch: Partial<Pick<CanvasZone, "name" | "kind" | "fill" | "stroke">>,
): Command => ({
  label: "修改区域",
  apply: (draft) => {
    const zone = findZone(draft, zoneId);
    if (!zone) return;
    if (patch.name !== undefined) zone.name = patch.name;
    if (patch.kind !== undefined) zone.kind = patch.kind;
    if (patch.fill !== undefined) zone.fill = patch.fill;
    if (patch.stroke !== undefined) zone.stroke = patch.stroke;
  },
});

/** 删区域连带删它的座位——数据库那边是 cascade，模型层保持一致。 */
export const removeZones = (zoneIds: string[]): Command => ({
  label: "删除区域",
  apply: (draft) => {
    const targets = new Set(zoneIds);
    draft.zones = draft.zones.filter((zone) => !targets.has(zone.externalId));
    draft.seats = draft.seats.filter(
      (seat) => !targets.has(seat.zoneExternalId),
    );
  },
});

// ---------------------------------------------------------------------------
// 座位（进入区域之后的排位画布用）
// ---------------------------------------------------------------------------

/**
 * 按预设重铺一块区域的座位。**整块替换**，不做增量合并。
 *
 * 换布局本来就是"推倒重来"的操作，试图保留上一批座位只会产出一堆位置诡异的
 * 残留。用户手工调过的位置会丢，所以调用方（`template-dialog.tsx`）在已有座位时
 * 要给出提示。
 *
 * `preset`/`params` 只是这条命令的**输入**，不是要落库的状态——`CanvasZone`
 * 不记"上次用的是哪个模板"，模板到这里就是一次性生成座位坐标的工具，用完即弃，
 * 而不是一个跟区域绑定、需要长期维护同步的属性。
 */
export const applyLayoutToZone = (
  zoneId: string,
  preset: LayoutPreset,
  params: LayoutParams,
): Command => ({
  label: "导入模板",
  apply: (draft) => {
    const zone = findZone(draft, zoneId);
    if (!zone) return;

    const generated = generateLayout(preset, params, {
      width: zone.shape.width,
      height: zone.shape.height,
    });

    draft.seats = draft.seats.filter((seat) => seat.zoneExternalId !== zoneId);
    generated.forEach((seat, index) => {
      draft.seats.push({
        externalId: newId("s"),
        zoneExternalId: zoneId,
        label: seat.label,
        kind: "seat",
        rank: "normal",
        ordinal: index,
        x: seat.x,
        y: seat.y,
      });
    });
  },
});

export const addSeat = (zoneId: string, at: Point, label: string): Command => ({
  label: "新增位置",
  apply: (draft) => {
    const zone = findZone(draft, zoneId);
    if (!zone) return;
    const spot = clampPointToRect(
      at,
      { x: 0, y: 0, width: zone.shape.width, height: zone.shape.height },
      SEAT_PAD,
    );
    draft.seats.push({
      externalId: newId("s"),
      zoneExternalId: zoneId,
      label,
      kind: "seat",
      rank: "normal",
      ordinal: draft.seats.filter((s) => s.zoneExternalId === zoneId).length,
      x: spot.x,
      y: spot.y,
    });
  },
});

/**
 * 拖动座位。位置被夹在所属区域内——**不允许拖出区域**。
 *
 * 座位一旦跑到区域外，"这个位置属于哪个区域"就只剩数据上的答案、视觉上是错的。
 * 排位画布本来就是逐区域进入的，也没有"拖到另一个区域"这个入口。
 */
export const moveSeats = (seatIds: string[], delta: Point): Command => ({
  label: "移动位置",
  apply: (draft) => {
    const targets = new Set(seatIds);
    const zoneSize = new Map(
      draft.zones.map((zone) => [
        zone.externalId,
        { width: zone.shape.width, height: zone.shape.height },
      ]),
    );

    for (const seat of draft.seats) {
      if (!targets.has(seat.externalId)) continue;
      const size = zoneSize.get(seat.zoneExternalId);
      if (!size) continue;
      const spot = clampPointToRect(
        { x: seat.x + delta.x, y: seat.y + delta.y },
        { x: 0, y: 0, ...size },
        SEAT_PAD,
      );
      seat.x = spot.x;
      seat.y = spot.y;
    }
  },
});

export const patchSeats = (
  seatIds: string[],
  patch: Partial<Pick<CanvasSeat, "kind" | "rank" | "label">>,
): Command => ({
  label: "修改位置",
  apply: (draft) => {
    const targets = new Set(seatIds);
    for (const seat of draft.seats) {
      if (!targets.has(seat.externalId)) continue;
      if (patch.kind !== undefined) seat.kind = patch.kind as SeatKind;
      if (patch.rank !== undefined) seat.rank = patch.rank as SeatRank;
      // 批量改编号会造出一堆重号，所以只在单选时允许改 label。
      if (patch.label !== undefined && seatIds.length === 1) {
        seat.label = patch.label;
      }
    }
  },
});

export const removeSeats = (seatIds: string[]): Command => ({
  label: "删除位置",
  apply: (draft) => {
    const targets = new Set(seatIds);
    draft.seats = draft.seats.filter((seat) => !targets.has(seat.externalId));
  },
});
