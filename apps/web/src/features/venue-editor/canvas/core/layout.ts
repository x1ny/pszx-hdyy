import type { Point, Size } from "./geometry";

/**
 * 座位布局生成。给定一块区域的尺寸和一组参数，算出每个座位摆在哪、叫什么。
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

/** 区域内边距：座位不贴边框，留出过道和视觉呼吸。 */
const PAD = 28;

const rowLetter = (start: string, index: number) => {
  const base = start.toUpperCase().charCodeAt(0);
  const code = Number.isNaN(base) ? 65 : base;
  // 超过 Z 之后回到 A 并加一位（AA、AB…），别产出 `[1` 这种字符。
  const offset = code - 65 + index;
  const cycle = Math.floor(offset / 26);
  const letter = String.fromCharCode(65 + (offset % 26));
  return cycle > 0 ? `${String.fromCharCode(64 + cycle)}${letter}` : letter;
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

/** 把 n 个点在一段长度上均分居中，返回每个点的中心坐标。 */
function spread(count: number, length: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [length / 2];
  const step = length / (count - 1);
  return Array.from({ length: count }, (_, index) => index * step);
}

function genTheater(params: LayoutParams, size: Size): GeneratedSeat[] {
  const { rows, cols, aisleEvery } = params;
  if (rows <= 0 || cols <= 0) return [];

  const innerWidth = Math.max(1, size.width - PAD * 2);
  const innerHeight = Math.max(1, size.height - PAD * 2);

  // 过道占一个座位宽的位置，所以按"座位数 + 过道数"分配横向空间。
  const aisles = aisleEvery > 0 ? Math.floor((cols - 1) / aisleEvery) : 0;
  const slots = cols + aisles;
  const xs = spread(slots, innerWidth);
  const ys = spread(rows, innerHeight);

  const label = makeLabeler(params);
  const seats: GeneratedSeat[] = [];

  for (let row = 0; row < rows; row += 1) {
    let slot = 0;
    for (let col = 0; col < cols; col += 1) {
      if (aisleEvery > 0 && col > 0 && col % aisleEvery === 0) slot += 1;
      seats.push({
        x: PAD + (xs[slot] ?? 0),
        y: PAD + (ys[row] ?? 0),
        label: label(row, col),
      });
      slot += 1;
    }
  }

  return seats;
}

function genBanquet(params: LayoutParams, size: Size): GeneratedSeat[] {
  const { tableCount, seatsPerTable } = params;
  if (tableCount <= 0 || seatsPerTable <= 0) return [];

  const innerWidth = Math.max(1, size.width - PAD * 2);
  const innerHeight = Math.max(1, size.height - PAD * 2);

  // 桌子按接近正方形的网格排布，避免一长条。
  const columns = Math.max(1, Math.ceil(Math.sqrt(tableCount)));
  const rows = Math.ceil(tableCount / columns);
  const cellWidth = innerWidth / columns;
  const cellHeight = innerHeight / rows;
  // 座位环绕的半径：取格子短边的三分之一，桌与桌之间才留得下过道。
  const radius = Math.max(12, Math.min(cellWidth, cellHeight) / 3);

  const label = makeLabeler(params);
  const seats: GeneratedSeat[] = [];

  for (let table = 0; table < tableCount; table += 1) {
    const centerX = PAD + (table % columns) * cellWidth + cellWidth / 2;
    const centerY =
      PAD + Math.floor(table / columns) * cellHeight + cellHeight / 2;

    for (let seat = 0; seat < seatsPerTable; seat += 1) {
      // 从正上方开始顺时针，跟真实宴会厅的主位习惯一致。
      const angle = (seat / seatsPerTable) * Math.PI * 2 - Math.PI / 2;
      seats.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        label: label(table, seat, table),
      });
    }
  }

  return seats;
}

/**
 * 秀场双边：中间留 T 台通道，两侧对称看台。
 *
 * 这是时尚周的主场景，也是从零设计最容易漏掉的一种——旧系统的 `runway` 预设
 * 专门做了它（docs/场地排位模块.md §5.3 特别点了名）。
 */
function genRunway(params: LayoutParams, size: Size): GeneratedSeat[] {
  const { rows, cols } = params;
  if (rows <= 0 || cols <= 0) return [];

  const innerWidth = Math.max(1, size.width - PAD * 2);
  const innerHeight = Math.max(1, size.height - PAD * 2);
  // T 台占中间三分之一。
  const runwayWidth = innerWidth / 3;
  const sideWidth = (innerWidth - runwayWidth) / 2;

  const ys = spread(rows, innerHeight);
  const sideXs = spread(cols, sideWidth);
  const label = makeLabeler(params);
  const seats: GeneratedSeat[] = [];

  for (let row = 0; row < rows; row += 1) {
    // 左侧：从 T 台往外编号，靠台的是 1 号——离舞台越近序号越小，符合看座习惯。
    for (let col = 0; col < cols; col += 1) {
      seats.push({
        x: PAD + sideWidth - (sideXs[col] ?? 0),
        y: PAD + (ys[row] ?? 0),
        label: label(row, col),
      });
    }
    // 右侧
    for (let col = 0; col < cols; col += 1) {
      seats.push({
        x: PAD + sideWidth + runwayWidth + (sideXs[col] ?? 0),
        y: PAD + (ys[row] ?? 0),
        label: label(row, cols + col),
      });
    }
  }

  return seats;
}

const GENERATORS: Record<
  LayoutPreset,
  (params: LayoutParams, size: Size) => GeneratedSeat[]
> = {
  theater: genTheater,
  banquet: genBanquet,
  runway: genRunway,
  // 自由摆放：不生成任何座位，用户自己拖进来。
  free: () => [],
};

/**
 * 按预设生成座位。产出的坐标是**相对区域左上角**的，区域移动时座位跟着走，
 * 不需要重算。
 */
export function generateLayout(
  preset: LayoutPreset,
  params: LayoutParams,
  size: Size,
): GeneratedSeat[] {
  return GENERATORS[preset](params, size);
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
