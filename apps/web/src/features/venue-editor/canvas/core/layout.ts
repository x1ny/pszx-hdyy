import type { CanvasRow } from "./document";
import type { Point } from "./geometry";
import { rowPoints, rowRadius } from "./rows";

/**
 * 座位布局生成。按统一默认间距向外展开，不读取外层区域尺寸。
 *
 * **纯函数，不认识 React 也不认识 SVG**——它只产出坐标和编号，怎么画是渲染层的事。
 * 这一层是整个编辑器里最值钱的部分：旧系统那 740 行 `layoutEngine.ts` 的价值全在
 * 这里，而它跟渲染技术无关，将来就算换掉整个画布也原样保留。
 *
 * 第一版只做四种预设（剧场 / 宴会 / 秀场双边 / 自由），依据是
 * docs/场地排位底层设计.md §5.3："布局引擎先只实现剧场、宴会、秀场三种预设加
 * 自由摆放，其余预设后补"。旧系统另有课堂纵列、U 型围合、董事会长桌、酒会散座、
 * 弧形看台五种，形状都在那份代码里，要补时照抄参数即可。
 */

export const LAYOUT_PRESETS = ["theater", "banquet", "runway", "free"] as const;
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number];

/** 编号规则。结论单 C-006 的"位置顺序"落到具体形态就是这个。 */
export const NUMBERING_MODES = ["rowCol", "sequential", "tableSeat"] as const;
export type NumberingMode = (typeof NUMBERING_MODES)[number];

export type LayoutParams = {
  /** 剧场/秀场：排数。 */
  rows: number;
  /** 剧场：每排座位数；秀场：单侧每排座位数。 */
  cols: number;
  /** 剧场：每几列留一条过道，0 表示不留。 */
  aisleEvery: number;
  /** 宴会：桌数。 */
  tableCount: number;
  /** 宴会：每桌座位数。 */
  seatsPerTable: number;
  numbering: NumberingMode;
  /** 编号起始的排字母，例如 "A" → A1 A2…、B1 B2…。 */
  startRowLabel: string;
};

export const DEFAULT_LAYOUT_PARAMS: LayoutParams = {
  rows: 6,
  cols: 10,
  aisleEvery: 5,
  tableCount: 6,
  seatsPerTable: 8,
  numbering: "rowCol",
  startRowLabel: "A",
};

export type GeneratedSeat = Point & { label: string };

/** 示意坐标单位，不表达米或实际场地尺寸。 */
export const LAYOUT_SPACING = { seat: 48, row: 64, table: 96, runway: 160 };

const rowLetter = (start: string, index: number) => {
  const base = start.toUpperCase().charCodeAt(0);
  const code = Number.isNaN(base) ? 65 : base;
  // A…Z、AA…ZZ、AAA…；取消数量上限后也不能在第 703 排产生乱码。
  let ordinal = code - 65 + index + 1;
  let label = "";
  while (ordinal > 0) {
    ordinal -= 1;
    label = String.fromCharCode(65 + (ordinal % 26)) + label;
    ordinal = Math.floor(ordinal / 26);
  }
  return label;
};

function makeLabeler(params: LayoutParams) {
  let running = 0;
  return (row: number, col: number, table?: number) => {
    running += 1;
    switch (params.numbering) {
      case "sequential":
        return `${params.startRowLabel}${running}`;
      case "tableSeat":
        return `${(table ?? row) + 1}桌${col + 1}号`;
      default:
        return `${rowLetter(params.startRowLabel, row)}${col + 1}`;
    }
  };
}

export type GeneratedRow = Omit<
  CanvasRow,
  "externalId" | "zoneExternalId" | "seatIds"
> & {
  seats: GeneratedSeat[];
};

/** 模板显式建立排关系；秀场两侧独立成排，每桌为一条环形排。 */
export function generateLayoutRows(
  preset: LayoutPreset,
  params: LayoutParams,
): GeneratedRow[] {
  const rows: GeneratedRow[] = [];
  const label = makeLabeler(params);
  let running = 0;
  const append = (
    name: string,
    x: number,
    y: number,
    angle: number,
    count: number,
    rowIndex: number,
    colOffset = 0,
    shape: "line" | "circle" = "line",
    aisleEvery = 0,
  ) => {
    if (count <= 0) return;
    const numbering =
      params.numbering === "sequential"
        ? {
            prefix: params.startRowLabel,
            suffix: "",
            start: running + 1,
            padding: 0,
          }
        : params.numbering === "tableSeat"
          ? {
              prefix: `${rowIndex + 1}桌`,
              suffix: "号",
              start: colOffset + 1,
              padding: 0,
            }
          : {
              prefix: rowLetter(params.startRowLabel, rowIndex),
              suffix: "",
              start: colOffset + 1,
              padding: 0,
            };
    running += count;
    const row = {
      name,
      x,
      y,
      angle,
      shape,
      spacing: LAYOUT_SPACING.seat,
      aisleEvery,
      numbering,
    };
    rows.push({
      ...row,
      seats: rowPoints(row, count).map((point, col) => ({
        ...point,
        label: label(
          rowIndex,
          col + colOffset,
          preset === "banquet" ? rowIndex : undefined,
        ),
      })),
    });
  };
  if (preset === "theater") {
    for (let row = 0; row < params.rows; row += 1) {
      append(
        `${rowLetter(params.startRowLabel, row)}排`,
        0,
        row * LAYOUT_SPACING.row,
        0,
        params.cols,
        row,
        0,
        "line",
        params.aisleEvery,
      );
    }
  } else if (preset === "runway") {
    const width = (params.cols - 1) * LAYOUT_SPACING.seat;
    for (let row = 0; row < params.rows; row += 1) {
      append(
        `左${rowLetter(params.startRowLabel, row)}排`,
        width,
        row * LAYOUT_SPACING.row,
        180,
        params.cols,
        row,
      );
      append(
        `右${rowLetter(params.startRowLabel, row)}排`,
        width + LAYOUT_SPACING.runway,
        row * LAYOUT_SPACING.row,
        0,
        params.cols,
        row,
        params.cols,
      );
    }
  } else if (preset === "banquet") {
    const columns = Math.max(1, Math.ceil(Math.sqrt(params.tableCount)));
    const radius = rowRadius(LAYOUT_SPACING.seat, params.seatsPerTable);
    const cell = radius * 2 + LAYOUT_SPACING.table;
    for (let table = 0; table < params.tableCount; table += 1) {
      append(
        `第${table + 1}桌`,
        radius + (table % columns) * cell,
        radius + Math.floor(table / columns) * cell,
        -90,
        params.seatsPerTable,
        table,
        0,
        "circle",
      );
    }
  }
  return rows;
}

export function generateLayout(
  preset: LayoutPreset,
  params: LayoutParams,
): GeneratedSeat[] {
  return generateLayoutRows(preset, params).flatMap((row) => row.seats);
}

/** 每种预设实际会用到哪几个参数，用来决定参数面板显示哪些输入框。 */
export const PRESET_FIELDS: Record<
  LayoutPreset,
  ReadonlyArray<"rows" | "cols" | "aisleEvery" | "tableCount" | "seatsPerTable">
> = {
  theater: ["rows", "cols", "aisleEvery"],
  banquet: ["tableCount", "seatsPerTable"],
  runway: ["rows", "cols"],
  free: [],
};

/** 生成前先算个数，参数面板上实时显示"将生成 N 个座位"。 */
export function countLayout(
  preset: LayoutPreset,
  params: LayoutParams,
): number {
  switch (preset) {
    case "theater":
      return Math.max(0, params.rows) * Math.max(0, params.cols);
    case "banquet":
      return Math.max(0, params.tableCount) * Math.max(0, params.seatsPerTable);
    case "runway":
      return Math.max(0, params.rows) * Math.max(0, params.cols) * 2;
    default:
      return 0;
  }
}
