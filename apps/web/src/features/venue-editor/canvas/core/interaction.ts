import type { CanvasDoc, CanvasZone, ZoneShapeType } from "./document";
import {
  ellipseContains,
  normalizeRect,
  type Point,
  pointInPolygon,
  type Rect,
  rectContains,
  rectsIntersect,
  toAbsolutePoints,
} from "./geometry";

/**
 * 交互判定：按下鼠标的那一刻，该开始哪一种拖拽？
 *
 * 这段逻辑**做成纯函数**是有针对性的——旧系统把七八种工具的判定全揉在
 * `onPointerDown` 里按 `effectiveTool` 分支（979 行组件里最长的一个函数），
 * 加一种工具就得动那三个 handler，而且完全没法测。这里输入是"点在哪、文档长什么样、
 * 当前选中了谁、用的哪个工具"，输出是一个描述性的对象，能逐个 case 断言。
 *
 * v2：按两级架构拆成两套判定——`resolveDragSubject` 管顶层的区域分布画布
 * （画形状/选区域/缩放区域），`resolveSeatDragSubject` 管进入区域后的排位画布
 * （选座位/放座位）。两者不共用一个状态机，是因为它们能选中的对象完全不重叠：
 * 排位画布里没有"区域"这个可选对象，硬塞进同一个函数只会多出一堆恒假分支。
 */

// ---------------------------------------------------------------------------
// 顶层：区域分布画布
// ---------------------------------------------------------------------------

/** 顶层画布的工具。画形状的四种 + 选择，**没有"放座位"**——那是进入区域之后的事。 */
export const ZONE_TOOLS = [
  "select",
  "rect",
  "ellipse",
  "circle",
  "polygon",
] as const;
export type ZoneTool = (typeof ZONE_TOOLS)[number];

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export type Selection = {
  zoneIds: string[];
  seatIds: string[];
};

export const EMPTY_SELECTION: Selection = { zoneIds: [], seatIds: [] };

export type DragSubject =
  | { kind: "none" }
  | { kind: "pan" }
  /**
   * 拖拽画矩形/椭圆/圆形。多边形是点击构造，不走这条（见组件里的 polygonDraft
   * 状态）。**"圆形"不是独立的 `ZoneShape` 类型**——一个圆就是宽高相等的椭圆，
   * 数据模型里没有必要为它多开一支：`shapeType: "circle"` 只是告诉
   * `boxShapeFromDrag` 拖拽结束时把宽高摁成同一个值，落库时 `shape.type`
   * 仍然是 `"ellipse"`，跟 `zoneContains`/`ZoneGeometry`/缩放逻辑一个字都不用改。
   */
  | {
      kind: "drawZone";
      shapeType: Extract<ZoneShapeType, "rect" | "ellipse"> | "circle";
      start: Point;
    }
  | { kind: "moveZones"; zoneIds: string[] }
  | { kind: "resizeZone"; zoneId: string; handle: ResizeHandle; origin: Rect }
  | { kind: "moveSeats"; seatIds: string[] }
  /** 空白处拉框选座位。 */
  | { kind: "marquee"; start: Point };

/**
 * 座位命中半径的兜底值（世界坐标）。
 *
 * 正常路径上调用方会按当前密度传一个**屏幕坐标换算过来**的半径进来
 * （`seatRenderSpec().hitRadiusPx / scale`），让"看得见的地方点得中"。
 * 这个常量只在调用方没算的时候兜底。
 */
export const SEAT_HIT_RADIUS = 13;
/** 缩放手柄的边长（屏幕像素，用时要除以 scale 换算到世界坐标）。 */
export const HANDLE_SIZE = 9;

export const zoneRect = (zone: CanvasZone): Rect => ({
  x: zone.shape.x,
  y: zone.shape.y,
  width: zone.shape.width,
  height: zone.shape.height,
});

/** 区域的绝对顶点——只有多边形有意义，其余形状用不到。 */
export const zonePolygonPoints = (zone: CanvasZone): Point[] =>
  zone.shape.type === "polygon"
    ? toAbsolutePoints({ x: zone.shape.x, y: zone.shape.y }, zone.shape.points)
    : [];

/** 座位在世界坐标里的位置 = 所属区域左上角 + 相对坐标。 */
export function seatWorldPoint(doc: CanvasDoc, seatId: string): Point | null {
  const seat = doc.seats.find((item) => item.externalId === seatId);
  if (!seat) return null;
  const zone = doc.zones.find(
    (item) => item.externalId === seat.zoneExternalId,
  );
  if (!zone) return null;
  return { x: zone.shape.x + seat.x, y: zone.shape.y + seat.y };
}

/** 四个角的手柄矩形，按包围盒给——跟具体形状无关。`scale` 保证手柄屏幕大小恒定。 */
export function handleRects(
  zone: CanvasZone,
  scale: number,
): { handle: ResizeHandle; rect: Rect }[] {
  const size = HANDLE_SIZE / Math.max(scale, 0.05);
  const half = size / 2;
  const { x, y, width, height } = zone.shape;

  const corners: Record<ResizeHandle, Point> = {
    nw: { x, y },
    ne: { x: x + width, y },
    sw: { x, y: y + height },
    se: { x: x + width, y: y + height },
  };

  return (Object.keys(corners) as ResizeHandle[]).map((handle) => ({
    handle,
    rect: {
      x: corners[handle].x - half,
      y: corners[handle].y - half,
      width: size,
      height: size,
    },
  }));
}

/** 一个点是否落在某块区域内，按形状分派——矩形/椭圆用几何测试，多边形用射线法。 */
export function zoneContains(zone: CanvasZone, point: Point): boolean {
  switch (zone.shape.type) {
    case "rect":
      return rectContains(zoneRect(zone), point);
    case "ellipse":
      return ellipseContains(zoneRect(zone), point);
    case "polygon":
      return pointInPolygon(point, zonePolygonPoints(zone));
    default:
      return false;
  }
}

export function hitZone(doc: CanvasDoc, point: Point): string | null {
  for (let index = doc.zones.length - 1; index >= 0; index -= 1) {
    const zone = doc.zones[index];
    if (zoneContains(zone, point)) return zone.externalId;
  }
  return null;
}

function hitHandle(
  doc: CanvasDoc,
  selection: Selection,
  point: Point,
  scale: number,
): { zoneId: string; handle: ResizeHandle; origin: Rect } | null {
  // 只有被选中的区域才显示手柄，所以也只有它们能被命中。
  for (const zoneId of selection.zoneIds) {
    const zone = doc.zones.find((item) => item.externalId === zoneId);
    if (!zone) continue;
    for (const { handle, rect } of handleRects(zone, scale)) {
      if (rectContains(rect, point)) {
        return { zoneId, handle, origin: zoneRect(zone) };
      }
    }
  }
  return null;
}

/**
 * 判定这一次按下要开始什么。优先级从高到低：
 *
 * 1. 空格键按住 / 中键 → 平移画布（调用方传 `forcePan`）
 * 2. 画矩形/椭圆/圆形工具 → 拉框画形状
 * 3. 选中区域的缩放手柄
 * 4. 区域本体
 * 5. 空白 → 框选（顶层框选目前没有用途，占位对齐排位画布的手感，选中结果为空）
 *
 * 多边形工具**不在这里判定**——它是点击累加顶点的状态机，跟"按下即知道要做什么"
 * 的拖拽模型不是一回事，由组件自己管理草稿状态（`polygonDraft`）。
 */
export function resolveDragSubject(input: {
  point: Point;
  doc: CanvasDoc;
  selection: Selection;
  tool: ZoneTool;
  scale: number;
  forcePan?: boolean;
}): DragSubject {
  const { point, doc, selection, tool, scale, forcePan } = input;

  if (forcePan) return { kind: "pan" };

  if (tool === "rect" || tool === "ellipse" || tool === "circle") {
    return { kind: "drawZone", shapeType: tool, start: point };
  }
  if (tool === "polygon") return { kind: "none" };

  const handle = hitHandle(doc, selection, point, scale);
  if (handle) {
    return {
      kind: "resizeZone",
      zoneId: handle.zoneId,
      handle: handle.handle,
      origin: handle.origin,
    };
  }

  const zoneId = hitZone(doc, point);
  if (zoneId) {
    const zoneIds = selection.zoneIds.includes(zoneId)
      ? selection.zoneIds
      : [zoneId];
    return { kind: "moveZones", zoneIds };
  }

  return { kind: "marquee", start: point };
}

/** 拖动缩放手柄时，由起始矩形和位移算出新矩形。 */
export function resizeRect(
  origin: Rect,
  handle: ResizeHandle,
  delta: Point,
): Rect {
  const left = handle === "nw" || handle === "sw";
  const top = handle === "nw" || handle === "ne";

  const x1 = left ? origin.x + delta.x : origin.x;
  const y1 = top ? origin.y + delta.y : origin.y;
  const x2 = left ? origin.x + origin.width : origin.x + origin.width + delta.x;
  const y2 = top
    ? origin.y + origin.height
    : origin.y + origin.height + delta.y;

  // 拖过头时靠 normalizeRect 翻转，宽高不会变负。
  return normalizeRect({ x: x1, y: y1 }, { x: x2, y: y2 });
}

// ---------------------------------------------------------------------------
// 进入区域之后：排位画布
// ---------------------------------------------------------------------------

/** 排位画布的工具：选择或点放。没有画形状——区域形状在上一层已经定了。 */
export const SEAT_TOOLS = ["select", "seat"] as const;
export type SeatTool = (typeof SEAT_TOOLS)[number];

export type SeatDragSubject =
  | { kind: "none" }
  | { kind: "pan" }
  | { kind: "moveSeats"; seatIds: string[] }
  | { kind: "marquee"; start: Point };

/**
 * 命中座位，取**最近**的那个。
 *
 * 以前是"倒序遍历、命中即返回"，等价于取数组里靠后的那个而不是离指针最近的。
 * 座距小于命中直径时相邻座位的命中圈重叠，于是点在两座中间会选中错误的一个，
 * 而且错得没有规律——密集区域的排位就是这么点错座的。
 *
 * 仍然倒序遍历、比较用严格小于：距离相等时后画的（视觉上在上层的）赢。
 */
export function hitSeat(
  doc: CanvasDoc,
  point: Point,
  hitRadius: number = SEAT_HIT_RADIUS,
): string | null {
  let hit: string | null = null;
  let nearest = Number.POSITIVE_INFINITY;

  for (let index = doc.seats.length - 1; index >= 0; index -= 1) {
    const seat = doc.seats[index];
    const world = seatWorldPoint(doc, seat.externalId);
    if (!world) continue;
    const distance = Math.hypot(world.x - point.x, world.y - point.y);
    if (distance <= hitRadius && distance < nearest) {
      nearest = distance;
      hit = seat.externalId;
    }
  }

  return hit;
}

/** 框选：返回落在框里的座位。命中半径同 `hitSeat`，擦到边缘就算选中。 */
export function marqueeSelect(
  doc: CanvasDoc,
  from: Point,
  to: Point,
  hitRadius: number = SEAT_HIT_RADIUS,
): string[] {
  const box = normalizeRect(from, to);

  return doc.seats
    .filter((seat) => {
      const world = seatWorldPoint(doc, seat.externalId);
      if (!world) return false;
      return rectsIntersect(box, {
        x: world.x - hitRadius,
        y: world.y - hitRadius,
        width: hitRadius * 2,
        height: hitRadius * 2,
      });
    })
    .map((seat) => seat.externalId);
}

/**
 * 排位画布的按下判定。**没有区域可选**——这一层唯一的对象是座位，
 * 所以判定比顶层简单得多：命中座位就是拖它（或拖已选中的整组），否则框选。
 */
export function resolveSeatDragSubject(input: {
  point: Point;
  doc: CanvasDoc;
  selection: Selection;
  tool: SeatTool;
  forcePan?: boolean;
  /** 当前密度下的命中半径（世界坐标）。不传按兜底常量。 */
  hitRadius?: number;
}): SeatDragSubject {
  const { point, doc, selection, tool, forcePan, hitRadius } = input;

  if (forcePan) return { kind: "pan" };
  if (tool === "seat") return { kind: "none" };

  const seatId = hitSeat(doc, point, hitRadius);
  if (seatId) {
    const seatIds = selection.seatIds.includes(seatId)
      ? selection.seatIds
      : [seatId];
    return { kind: "moveSeats", seatIds };
  }

  return { kind: "marquee", start: point };
}
