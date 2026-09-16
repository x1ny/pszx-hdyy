import type { Command } from "./commands";
import { type CanvasDoc, type CanvasRow, newId } from "./document";
import { type Point, rotatePoint } from "./geometry";

export type TableSides = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type RowParams = Pick<
  CanvasRow,
  "name" | "shape" | "angle" | "spacing" | "aisleEvery" | "sides"
> & { count: number };

export const DEFAULT_ROW_PARAMS: RowParams = {
  name: "",
  shape: "line",
  count: 10,
  angle: 0,
  spacing: 48,
  aisleEvery: 0,
};

/** 方桌未配置过任何一侧时的默认起点：两侧各 6 座，对应截图里的两侧长桌。 */
export const DEFAULT_TABLE_SIDES: TableSides = {
  top: 0,
  right: 6,
  bottom: 0,
  left: 6,
};

export const sumSides = (sides: TableSides) =>
  sides.top + sides.right + sides.bottom + sides.left;

export function validRowParams(params: RowParams) {
  if (
    !Number.isFinite(params.spacing) ||
    params.spacing <= 0 ||
    !Number.isFinite(params.angle) ||
    params.name.trim().length > 128
  )
    return false;
  if (params.shape === "rect") {
    const sides = params.sides;
    if (!sides) return false;
    const values = [sides.top, sides.right, sides.bottom, sides.left];
    return (
      values.every((value) => Number.isSafeInteger(value) && value >= 0) &&
      values.reduce((sum, value) => sum + value, 0) >= 1
    );
  }
  return (
    Number.isSafeInteger(params.count) &&
    params.count >= 1 &&
    Number.isSafeInteger(params.aisleEvery) &&
    params.aisleEvery >= 0
  );
}

/**
 * 拖动指定起点和方向，按座距确定数量；参数创建使用同一生成器。
 *
 * 方桌不认拖拽长度——它的座位数由四侧参数配置，不是手画出来的（见
 * `docs/seating-canvas.md`「桌」一节）。拖拽工具对方桌形同点按，原样
 * 返回参数，落点仍由调用方用拖拽起点覆盖 x/y。
 */
export function rowParamsFromDrag(
  from: Point,
  to: Point,
  params: RowParams,
): RowParams {
  if (params.shape === "rect") return params;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (params.shape === "circle") {
    return {
      ...params,
      count: Math.max(
        3,
        Math.round(
          Math.PI /
            Math.asin(
              Math.min(
                1,
                params.spacing / (2 * Math.max(distance, params.spacing)),
              ),
            ),
        ),
      ),
      angle: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
    };
  }
  const slots = distance / params.spacing;
  let count = Math.max(1, Math.floor(slots) + 1);
  if (params.aisleEvery > 0) {
    count = Math.max(
      1,
      Math.floor(slots / (params.aisleEvery + 1)) * params.aisleEvery +
        Math.min(
          params.aisleEvery,
          Math.floor(slots % (params.aisleEvery + 1)) + 1,
        ),
    );
  }
  return {
    ...params,
    shape: "line",
    count,
    angle: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
  };
}

type RowGeometry = Pick<
  CanvasRow,
  "shape" | "x" | "y" | "angle" | "spacing" | "aisleEvery" | "sides"
>;

/**
 * 座位坐标生成。`count` 只对 `line`/`circle` 有意义；`rect` 的座位数由
 * `row.sides` 四侧之和决定，传入的 `count` 被忽略——调用方不需要在传参前
 * 手动同步这个数字（`addRow`/`updateRow` 内部也是这么做的）。
 */
export function rowPoints(row: RowGeometry, count: number): Point[] {
  if (row.shape === "rect") return rectTablePoints(row);

  const radians = (row.angle * Math.PI) / 180;
  const radius = rowRadius(row.spacing, count);
  return Array.from({ length: count }, (_, index) => {
    if (row.shape === "circle") {
      const angle = radians + (index / count) * Math.PI * 2;
      return {
        x: row.x + Math.cos(angle) * radius,
        y: row.y + Math.sin(angle) * radius,
      };
    }
    const slot =
      index + (row.aisleEvery > 0 ? Math.floor(index / row.aisleEvery) : 0);
    return {
      x: row.x + Math.cos(radians) * slot * row.spacing,
      y: row.y + Math.sin(radians) * slot * row.spacing,
    };
  });
}

export function rowRadius(spacing: number, count: number) {
  return count > 1 ? spacing / (2 * Math.sin(Math.PI / count)) : 0;
}

/** 桌面与围坐座位之间的留白，随座距等比缩放，避免小桌子被固定间距撑爆。 */
const tableEdgeGap = (spacing: number) => Math.max(16, spacing * 0.35);

/** 某一侧没有座位时，桌子最短边的下限，避免退化成一条线。 */
const TABLE_MIN_SIDE = 48;

function rectTableSize(sides: TableSides, spacing: number) {
  const extent = (count: number) => Math.max(0, count - 1) * spacing;
  return {
    width: Math.max(TABLE_MIN_SIDE, extent(sides.top), extent(sides.bottom)),
    height: Math.max(TABLE_MIN_SIDE, extent(sides.left), extent(sides.right)),
  };
}

/**
 * 方桌四侧座位坐标。顺时针从上边左端开始：上（左→右）、右（上→下）、
 * 下（右→左）、左（下→上）——保证 `seatIds` 是一条连续的环形顺序，
 * 跟圆桌的编号习惯一致，H5 的排范围合并也按这个顺序读。
 *
 * 每一侧的座位各自以自己的座数居中排布，不受对侧座数影响；桌宽高取两侧
 * 跨度的较大值兜底，所以座数不对称时桌面仍然刚好包住座位多的那一侧。
 */
function rectTablePoints(row: RowGeometry): Point[] {
  const sides = row.sides ?? DEFAULT_TABLE_SIDES;
  const { width, height } = rectTableSize(sides, row.spacing);
  const gap = tableEdgeGap(row.spacing);
  const halfW = width / 2;
  const halfH = height / 2;

  const along = (count: number) => {
    const extent = Math.max(0, count - 1) * row.spacing;
    return Array.from(
      { length: count },
      (_, index) => index * row.spacing - extent / 2,
    );
  };

  const local: Point[] = [
    ...along(sides.top).map((x) => ({ x, y: -halfH - gap })),
    ...along(sides.right).map((y) => ({ x: halfW + gap, y })),
    ...along(sides.bottom)
      .reverse()
      .map((x) => ({ x, y: halfH + gap })),
    ...along(sides.left)
      .reverse()
      .map((y) => ({ x: -halfW - gap, y })),
  ];

  return local.map((point) => {
    const rotated = rotatePoint(point, { x: 0, y: 0 }, row.angle);
    return { x: row.x + rotated.x, y: row.y + rotated.y };
  });
}

export type TableShape =
  | { shape: "circle"; cx: number; cy: number; radius: number }
  | {
      shape: "rect";
      cx: number;
      cy: number;
      width: number;
      height: number;
      angle: number;
    };

/**
 * 排对应的桌面图形，仅渲染用，不落库——跟圆桌半径由座距/座位数派生同理，
 * 方桌的宽高也是按 `sides`/`spacing` 现算，几何只有一份来源。
 * 直排（`shape: "line"`）不是桌，返回 null。
 */
export function tableGeometry(
  row: RowGeometry,
  seatCount: number,
): TableShape | null {
  if (row.shape === "circle") {
    if (seatCount < 2) return null;
    const seatRadius = rowRadius(row.spacing, seatCount);
    const gap = tableEdgeGap(row.spacing);
    return {
      shape: "circle",
      cx: row.x,
      cy: row.y,
      radius: Math.max(TABLE_MIN_SIDE / 4, seatRadius - gap),
    };
  }
  if (row.shape === "rect") {
    const sides = row.sides ?? DEFAULT_TABLE_SIDES;
    const { width, height } = rectTableSize(sides, row.spacing);
    return {
      shape: "rect",
      cx: row.x,
      cy: row.y,
      width,
      height,
      angle: row.angle,
    };
  }
  return null;
}

/**
 * 排没有显式 `numbering` 时的默认编号。直排沿用排名称做前缀（"第5排01座"）；
 * 桌不带桌名前缀——桌名已经显示在桌面中央，每个座位重复一遍没有信息量，
 * 默认就是"1号、2号…"，不管第几桌都从 1 开始。
 */
function defaultNumbering(row: CanvasRow) {
  return row.shape === "line"
    ? { prefix: row.name.slice(0, 40), suffix: "座", start: 1, padding: 2 }
    : { prefix: "", suffix: "号", start: 1, padding: 0 };
}

function uniqueSeatLabel(used: Set<string>, row: CanvasRow, index: number) {
  const numbering = row.numbering ?? defaultNumbering(row);
  const base = `${numbering.prefix}${String(index + numbering.start).padStart(numbering.padding, "0")}${numbering.suffix}`;
  let label = base;
  for (let suffix = 2; used.has(label); suffix += 1)
    label = `${base}-${suffix}`;
  used.add(label);
  return label;
}

function usedSeatLabels(doc: Pick<CanvasDoc, "seats">, row: CanvasRow) {
  const rowSeatIds = new Set(row.seatIds);
  return new Set(
    doc.seats
      .filter((seat) =>
        row.shape === "line"
          ? seat.zoneExternalId === row.zoneExternalId
          : rowSeatIds.has(seat.externalId),
      )
      .map((seat) => seat.label),
  );
}

export const addRow = (
  zoneId: string,
  at: Point,
  params: RowParams,
  rowId = newId("r"),
): Command => ({
  label: "新增排",
  apply: (doc) => {
    if (
      !validRowParams(params) ||
      !doc.zones.some((zone) => zone.externalId === zoneId)
    )
      return;
    doc.rows ??= [];
    const existing = doc.rows.filter((row) => row.zoneExternalId === zoneId);
    // 桌用"桌"不用"排"——两者是同一个 shape 字段的不同取值，默认命名跟着分开。
    const unit = params.shape === "line" ? "排" : "桌";
    let number = existing.length + 1;
    while (existing.some((row) => row.name === `第${number}${unit}`))
      number += 1;
    const row: CanvasRow = {
      externalId: rowId,
      zoneExternalId: zoneId,
      name: params.name.trim() || `第${number}${unit}`,
      seatIds: [],
      shape: params.shape,
      x: at.x,
      y: at.y,
      angle: params.angle,
      spacing: params.spacing,
      aisleEvery: params.aisleEvery,
      ...(params.shape === "rect" ? { sides: params.sides } : {}),
    };
    const ordinal =
      doc.seats.reduce(
        (max, seat) =>
          seat.zoneExternalId === zoneId ? Math.max(max, seat.ordinal) : max,
        -1,
      ) + 1;
    // 普通排在区域内查重；桌席只在桌内查重，允许不同桌从 1 号重新开始。
    const used = usedSeatLabels(doc, row);
    rowPoints(row, params.count).forEach((point, index) => {
      const id = newId("s");
      row.seatIds.push(id);
      doc.seats.push({
        externalId: id,
        zoneExternalId: zoneId,
        label: uniqueSeatLabel(used, row, index),
        kind: "seat",
        rank: "normal",
        ordinal: ordinal + index,
        ...point,
      });
    });
    doc.rows.push(row);
  },
});

/** 数量调整保留前 N 个座位及其编号；只改数量时不重排已有自由移动的座位。 */
export const updateRow = (rowId: string, params: RowParams): Command => ({
  label: "调整排参数",
  apply: (doc) => {
    const row = doc.rows?.find((item) => item.externalId === rowId);
    if (!row || !validRowParams(params) || !params.name.trim()) return;
    // 方桌的座位数由四侧之和决定，不信任调用方是否同步过 params.count。
    const count =
      params.shape === "rect"
        ? sumSides(params.sides ?? DEFAULT_TABLE_SIDES)
        : params.count;
    const sidesChanged =
      params.shape === "rect" &&
      JSON.stringify(row.sides ?? DEFAULT_TABLE_SIDES) !==
        JSON.stringify(params.sides ?? DEFAULT_TABLE_SIDES);
    const geometryChanged =
      row.shape !== params.shape ||
      row.angle !== params.angle ||
      row.spacing !== params.spacing ||
      row.aisleEvery !== params.aisleEvery ||
      sidesChanged ||
      ((row.shape === "circle" || row.shape === "rect") &&
        row.seatIds.length !== count);
    const removed = new Set(row.seatIds.slice(count));
    doc.seats = doc.seats.filter((seat) => !removed.has(seat.externalId));
    row.seatIds = row.seatIds.slice(0, count);
    Object.assign(row, {
      name: params.name.trim(),
      shape: params.shape,
      angle: params.angle,
      spacing: params.spacing,
      aisleEvery: params.aisleEvery,
      sides: params.shape === "rect" ? params.sides : undefined,
    });
    const points = rowPoints(row, count);
    const byId = new Map(doc.seats.map((seat) => [seat.externalId, seat]));
    const used = usedSeatLabels(doc, row);
    let ordinal =
      doc.seats.reduce((max, seat) => Math.max(max, seat.ordinal), -1) + 1;
    points.forEach((point, index) => {
      const seat = byId.get(row.seatIds[index]);
      if (seat) {
        if (geometryChanged) Object.assign(seat, point);
      } else {
        const id = newId("s");
        row.seatIds.push(id);
        doc.seats.push({
          externalId: id,
          zoneExternalId: row.zoneExternalId,
          label: uniqueSeatLabel(used, row, index),
          kind: "seat",
          rank: "normal",
          ordinal: ordinal++,
          ...point,
        });
      }
    });
  },
});

export const removeRow = (rowId: string): Command => ({
  label: "删除排",
  apply: (doc) => {
    const ids = new Set(
      doc.rows?.find((row) => row.externalId === rowId)?.seatIds,
    );
    doc.seats = doc.seats.filter((seat) => !ids.has(seat.externalId));
    doc.rows = doc.rows?.filter((row) => row.externalId !== rowId);
  },
});

export const moveRowOrder = (rowId: string, direction: -1 | 1): Command => ({
  label: "调整排顺序",
  apply: (doc) => {
    const rows = doc.rows;
    const index = rows?.findIndex((row) => row.externalId === rowId) ?? -1;
    if (!rows || index < 0) return;
    const zoneId = rows[index].zoneExternalId;
    let target = index + direction;
    while (
      target >= 0 &&
      target < rows.length &&
      rows[target].zoneExternalId !== zoneId
    )
      target += direction;
    if (target >= 0 && target < rows.length)
      [rows[index], rows[target]] = [rows[target], rows[index]];
  },
});
