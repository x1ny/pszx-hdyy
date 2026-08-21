import {
  SEAT_KINDS,
  SEAT_RANKS,
  type SeatDraft,
  type SeatKind,
  type SeatRank,
  type VenueProjection,
  ZONE_KINDS,
  type ZoneDraft,
  type ZoneKind,
} from "../../contract";
import type { Point } from "./geometry";

/**
 * 画布编辑器的文档模型（`svg-canvas-v1`）。
 *
 * 这份结构整份塞进 `layout.data`，**服务端一个字节都不解析**。它跟核心表的关系
 * 由 `projectCanvas()` 单向决定：几何留在这里，"有哪些位置、叫什么、什么性质"
 * 投影出去。docs/场地排位底层设计.md §1 那条分界线就落在这两个类型之间。
 *
 * v2：按参考旧系统重做成两级——这一层（区域分布）只管形状、颜色、名称、类型；
 * 座位排布是**进入某个区域之后**的另一层编辑（见 `react/zone-seating-editor.tsx`），
 * 不在这一层的画布上直接摆座位。两层共享同一份 `CanvasDoc`，只是编辑器 UI 分开。
 */

export const ZONE_SHAPE_TYPES = ["rect", "ellipse", "polygon"] as const;
export type ZoneShapeType = (typeof ZONE_SHAPE_TYPES)[number];

export type ZoneShape =
  | { type: "rect"; x: number; y: number; width: number; height: number }
  | { type: "ellipse"; x: number; y: number; width: number; height: number }
  | {
      type: "polygon";
      x: number;
      y: number;
      width: number;
      height: number;
      /**
       * 相对 (x,y) 左上角的顶点，闭合多边形，至少 3 个点。存相对值的理由跟
       * 座位的相对坐标一样：整块搬动或缩放区域时，顶点不需要单独重算一遍——
       * 移动只改 x/y，缩放按比例重算顶点即可（`scalePolygonPoints`）。
       */
      points: Point[];
    };

/**
 * 三种形状**共享同一组包围盒字段**（x/y/width/height），这不是巧合：
 * 联合类型里所有分支都带这四个字段时，TypeScript 允许直接在联合类型上访问它们，
 * 不需要先按 `type` 判别。全仓库读 `zone.shape.width` 这种代码因此不用因为加了
 * 新形状而改一遍——只有真正要读 `points` 的地方才需要判别 `type === "polygon"`。
 */

export type CanvasZone = {
  externalId: string;
  name: string;
  kind: ZoneKind;
  ordinal: number;
  shape: ZoneShape;
  /**
   * 自定义颜色，十六进制字符串（如 `#2a78d6`）。**不是 CSS 变量**——它要经过
   * `<input type="color">` 编辑、经过 blob 序列化往返，两者都要求原生颜色格式。
   * 新建区域时按 `kind` 给一个默认值（见 `ZONE_KIND_DEFAULT_COLOR`），之后
   * 用户可以自己改，不再跟 kind 绑定。
   */
  fill: string;
  stroke: string;
};

export type CanvasSeat = {
  externalId: string;
  zoneExternalId: string;
  label: string;
  kind: SeatKind;
  rank: SeatRank;
  ordinal: number;
  /**
   * **相对所属区域左上角**的坐标。
   *
   * 存相对值而不是世界坐标：移动区域时座位天然跟着走，一行代码都不用写；
   * 缩放区域时按比例重算（`scalePoint`）。存绝对坐标的话，每次动区域都要遍历
   * 它的全部座位改一遍，而那正是最容易漏掉边界情况的地方。
   */
  x: number;
  y: number;
};

export type CanvasDoc = {
  schemaVersion: 1;
  /** 画布世界尺寸，所有坐标都在这个空间里。 */
  world: { width: number; height: number };
  zones: CanvasZone[];
  seats: CanvasSeat[];
};

export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 1000;

/**
 * 区域类型的默认颜色，只在**新建时**取用一次，之后就是这块区域自己的数据，
 * 跟 kind 脱钩——改 kind 不会跟着改颜色，改颜色也不会跟着改 kind。
 * 数值取自 `apps/web/src/styles.css` 的 `--chart-1..4`，跟其余模块的分类色板
 * 保持同一套视觉语言。
 */
export const ZONE_KIND_DEFAULT_COLOR: Record<
  ZoneKind,
  { fill: string; stroke: string }
> = {
  seating: { fill: "#2a78d6", stroke: "#2a78d6" },
  function: { fill: "#4a3aa7", stroke: "#4a3aa7" },
  checkin: { fill: "#1baf7a", stroke: "#1baf7a" },
  material: { fill: "#eb6834", stroke: "#eb6834" },
};

export const emptyCanvasDoc = (): CanvasDoc => ({
  schemaVersion: 1,
  world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
  zones: [],
  seats: [],
});

/**
 * 元素标识。只要求"同一份文档内唯一 + 保存前后稳定"——它是服务端归并的键，
 * 不承担跨编辑器的语义（底层设计 §4）。
 */
export const newId = (prefix: "z" | "s") =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// 投影：编辑器私有格式 → 核心语义
// ---------------------------------------------------------------------------

/**
 * 整份设计的枢纽。**坐标和颜色一个都不往外带**——它们没人引用，是编辑器的私事。
 *
 * 硬要求：同一份 doc 两次投影出的 `externalId` 必须完全一致，否则服务端的归并
 * 会判成"删掉全部旧的、插入全部新的"。这里是纯映射、不生成任何新 id，所以天然
 * 满足；`core.test.ts` 有一条钉死它。
 */
export function projectCanvas(doc: CanvasDoc): VenueProjection {
  const zones: ZoneDraft[] = doc.zones.map((zone) => ({
    externalId: zone.externalId,
    name: zone.name,
    kind: zone.kind,
    ordinal: zone.ordinal,
  }));

  const known = new Set(zones.map((zone) => zone.externalId));

  const seats: SeatDraft[] = doc.seats
    // 区域被删时命令层已经连带清了座位，这里再挡一道：宁可少投影一个，
    // 也不要发一条指向不存在区域的记录出去被服务端整批拒绝。
    .filter((seat) => known.has(seat.zoneExternalId))
    .map((seat) => ({
      externalId: seat.externalId,
      zoneExternalId: seat.zoneExternalId,
      label: seat.label,
      kind: seat.kind,
      rank: seat.rank,
      ordinal: seat.ordinal,
    }));

  return { zones, seats };
}

// ---------------------------------------------------------------------------
// blob 解析
//
// 同 structural：**不能用 zod**。web 的测试脚本是 `bun --bun vitest run`，
// 在那个运行时下 `import { z } from "zod"` 拿到的是 undefined。这个模块必须能被
// 单测覆盖，所以手写守卫。详见 docs/场地排位编辑器设计.md §8 末尾。
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

const isColor = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 32;

const isOneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T => typeof value === "string" && allowed.includes(value as T);

const isPointArray = (value: unknown): value is Point[] =>
  Array.isArray(value) &&
  value.length >= 3 &&
  value.every(
    (item) =>
      isRecord(item) && isFiniteNumber(item.x) && isFiniteNumber(item.y),
  );

function parseShape(raw: unknown): ZoneShape | null {
  if (!isRecord(raw)) return null;
  if (!isOneOf<ZoneShapeType>(raw.type, ZONE_SHAPE_TYPES)) return null;
  if (!["x", "y", "width", "height"].every((key) => isFiniteNumber(raw[key]))) {
    return null;
  }
  const box = {
    x: raw.x as number,
    y: raw.y as number,
    width: raw.width as number,
    height: raw.height as number,
  };

  if (raw.type === "polygon") {
    if (!isPointArray(raw.points)) return null;
    return { type: "polygon", ...box, points: raw.points };
  }
  return { type: raw.type, ...box };
}

function parseZone(raw: unknown): CanvasZone | null {
  if (!isRecord(raw)) return null;
  if (!isText(raw.externalId, 128)) return null;
  if (!isText(raw.name, 128)) return null;
  if (!isOneOf<ZoneKind>(raw.kind, ZONE_KINDS)) return null;
  if (!isFiniteNumber(raw.ordinal)) return null;
  if (!isColor(raw.fill) || !isColor(raw.stroke)) return null;

  const shape = parseShape(raw.shape);
  if (!shape) return null;

  return {
    externalId: raw.externalId,
    name: raw.name,
    kind: raw.kind,
    ordinal: raw.ordinal,
    fill: raw.fill,
    stroke: raw.stroke,
    shape,
  };
}

function parseSeat(raw: unknown): CanvasSeat | null {
  if (!isRecord(raw)) return null;
  if (!isText(raw.externalId, 128)) return null;
  if (!isText(raw.zoneExternalId, 128)) return null;
  if (!isText(raw.label, 64)) return null;
  if (!isOneOf<SeatKind>(raw.kind, SEAT_KINDS)) return null;
  if (!isOneOf<SeatRank>(raw.rank, SEAT_RANKS)) return null;
  if (!isFiniteNumber(raw.ordinal)) return null;
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) return null;

  return {
    externalId: raw.externalId,
    zoneExternalId: raw.zoneExternalId,
    label: raw.label,
    kind: raw.kind,
    rank: raw.rank,
    ordinal: raw.ordinal,
    x: raw.x,
    y: raw.y,
  };
}

/** 任何一个元素不合法就整份判失败——静默丢掉几个座位比整份认不出来危险得多。 */
export function parseCanvasDoc(raw: unknown): CanvasDoc | null {
  if (!isRecord(raw)) return null;
  if (raw.schemaVersion !== 1) return null;
  if (!Array.isArray(raw.zones) || !Array.isArray(raw.seats)) return null;

  const world = isRecord(raw.world) ? raw.world : null;
  if (!world || !isFiniteNumber(world.width) || !isFiniteNumber(world.height)) {
    return null;
  }

  const zones: CanvasZone[] = [];
  for (const item of raw.zones) {
    const zone = parseZone(item);
    if (!zone) return null;
    zones.push(zone);
  }

  const seats: CanvasSeat[] = [];
  for (const item of raw.seats) {
    const seat = parseSeat(item);
    if (!seat) return null;
    seats.push(seat);
  }

  return {
    schemaVersion: 1,
    world: { width: world.width, height: world.height },
    zones,
    seats,
  };
}

// ---------------------------------------------------------------------------
// 从核心表反推
// ---------------------------------------------------------------------------

/**
 * 没有几何信息时（老场地、或者上一个编辑器是表单式的），按区域顺序摆成网格，
 * 每块区域里的座位按预设重新铺一遍。生成的都是矩形——反推只是给个能看能改的
 * 起点，用户进画布后随时可以改形状、改颜色。
 *
 * 这条通道让 `structural-v1` → 画布的升级成立（底层设计 §4）：结构里没有坐标，
 * 画布可以从零布局它。反过来不行——画布降级到表单会丢掉全部几何。
 */
export function canvasDocFromProjection(
  projection: VenueProjection,
): CanvasDoc {
  const columns = Math.max(
    1,
    Math.ceil(Math.sqrt(projection.zones.length || 1)),
  );
  const cellWidth = WORLD_WIDTH / columns;
  const rows = Math.max(1, Math.ceil(projection.zones.length / columns));
  const cellHeight = WORLD_HEIGHT / rows;
  const gap = 24;

  const zones: CanvasZone[] = projection.zones.map((zone, index) => {
    const color = ZONE_KIND_DEFAULT_COLOR[zone.kind];
    return {
      externalId: zone.externalId,
      name: zone.name,
      kind: zone.kind,
      ordinal: zone.ordinal,
      fill: color.fill,
      stroke: color.stroke,
      shape: {
        type: "rect",
        x: (index % columns) * cellWidth + gap,
        y: Math.floor(index / columns) * cellHeight + gap,
        width: Math.max(80, cellWidth - gap * 2),
        height: Math.max(80, cellHeight - gap * 2),
      },
    };
  });

  const zoneById = new Map(zones.map((zone) => [zone.externalId, zone]));
  const placed = new Map<string, number>();

  const seats: CanvasSeat[] = projection.seats.flatMap((seat) => {
    const zone = zoneById.get(seat.zoneExternalId);
    if (!zone) return [];

    // 在区域内铺成网格，行宽按区域宽度自适应。
    const index = placed.get(zone.externalId) ?? 0;
    placed.set(zone.externalId, index + 1);
    const perRow = Math.max(1, Math.floor((zone.shape.width - 40) / 34));

    return [
      {
        externalId: seat.externalId,
        zoneExternalId: seat.zoneExternalId,
        label: seat.label,
        kind: seat.kind,
        rank: seat.rank,
        ordinal: seat.ordinal,
        x: 24 + (index % perRow) * 34,
        y: 24 + Math.floor(index / perRow) * 34,
      },
    ];
  });

  return {
    schemaVersion: 1,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    zones,
    seats,
  };
}
