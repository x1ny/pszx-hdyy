import type { Command } from "./commands";
import { type CanvasRow, newId } from "./document";
import type { Point } from "./geometry";

export type RowParams = Pick<
  CanvasRow,
  "name" | "shape" | "angle" | "spacing" | "aisleEvery"
> & { count: number };

export const DEFAULT_ROW_PARAMS: RowParams = {
  name: "",
  shape: "line",
  count: 10,
  angle: 0,
  spacing: 48,
  aisleEvery: 0,
};

export function validRowParams(params: RowParams) {
  return (
    Number.isSafeInteger(params.count) &&
    params.count >= 1 &&
    Number.isFinite(params.spacing) &&
    params.spacing > 0 &&
    Number.isFinite(params.angle) &&
    Number.isSafeInteger(params.aisleEvery) &&
    params.aisleEvery >= 0 &&
    params.name.trim().length <= 128
  );
}

/** 拖动指定起点和方向，按座距确定数量；参数创建使用同一生成器。 */
export function rowParamsFromDrag(
  from: Point,
  to: Point,
  params: RowParams,
): RowParams {
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

export function rowPoints(
  row: Pick<
    CanvasRow,
    "shape" | "x" | "y" | "angle" | "spacing" | "aisleEvery"
  >,
  count: number,
): Point[] {
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

function uniqueSeatLabel(used: Set<string>, row: CanvasRow, index: number) {
  const numbering = row.numbering ?? {
    prefix: row.name.slice(0, 40),
    suffix: "座",
    start: 1,
    padding: 2,
  };
  const base = `${numbering.prefix}${String(index + numbering.start).padStart(numbering.padding, "0")}${numbering.suffix}`;
  let label = base;
  for (let suffix = 2; used.has(label); suffix += 1)
    label = `${base}-${suffix}`;
  used.add(label);
  return label;
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
    let number = existing.length + 1;
    while (existing.some((row) => row.name === `第${number}排`)) number += 1;
    const row: CanvasRow = {
      externalId: rowId,
      zoneExternalId: zoneId,
      name: params.name.trim() || `第${number}排`,
      seatIds: [],
      shape: params.shape,
      x: at.x,
      y: at.y,
      angle: params.angle,
      spacing: params.spacing,
      aisleEvery: params.aisleEvery,
    };
    const ordinal =
      doc.seats.reduce(
        (max, seat) =>
          seat.zoneExternalId === zoneId ? Math.max(max, seat.ordinal) : max,
        -1,
      ) + 1;
    const used = new Set(
      doc.seats
        .filter((seat) => seat.zoneExternalId === zoneId)
        .map((seat) => seat.label),
    );
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
    const geometryChanged =
      row.shape !== params.shape ||
      row.angle !== params.angle ||
      row.spacing !== params.spacing ||
      row.aisleEvery !== params.aisleEvery ||
      (row.shape === "circle" && row.seatIds.length !== params.count);
    const removed = new Set(row.seatIds.slice(params.count));
    doc.seats = doc.seats.filter((seat) => !removed.has(seat.externalId));
    row.seatIds = row.seatIds.slice(0, params.count);
    Object.assign(row, {
      name: params.name.trim(),
      shape: params.shape,
      angle: params.angle,
      spacing: params.spacing,
      aisleEvery: params.aisleEvery,
    });
    const points = rowPoints(row, params.count);
    const byId = new Map(doc.seats.map((seat) => [seat.externalId, seat]));
    const used = new Set(
      doc.seats
        .filter((seat) => seat.zoneExternalId === row.zoneExternalId)
        .map((seat) => seat.label),
    );
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
