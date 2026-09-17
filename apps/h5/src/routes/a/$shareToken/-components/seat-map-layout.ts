/**
 * 座位定位图的排版计算。**纯函数，不碰 DOM**——这里每一处算错的表现都是"图变形
 * 或者整张消失"，而不是报错，所以它必须能被单测钉住。
 *
 * 要解决的问题只有一个：同一套代码要把**形状差异极大**的座位区都排得刚好。实际
 * 会出现的长宽比跨度是这样的（间距取自画布模板：座 48 / 排 64 / T台 160）：
 *
 *   秀场双侧 6排×10座   ≈ 3.2 : 1   ← 时尚周的主场景，又宽又扁
 *   剧场 6排×10座       ≈ 1.65 : 1
 *   宴会 6桌×8座        ≈ 1.6 : 1
 *   剧场 20排×30座      ≈ 1.2 : 1
 *   单排领导席          ≈ ∞ : 1     ← 包围盒高度是 0
 *
 * 所以盒子不能是固定纵横比：3.2:1 的图塞进 4:3 会上下空掉六成、座位点小到看不
 * 见，而那恰好是最常见的一种。做法是**盒子高度跟着内容长宽比走，夹在上下界之间**，
 * 然后两端各夹一次：
 *
 *   - 座位少时夹**屏幕座距上限**，八个座位不会被放大成八颗球；
 *   - 座位多时靠**固定屏幕尺寸的定位钉**（不在这里，见 seat-map.tsx），一千座
 *     的图上圆点只有两三个像素，红点必须不跟着缩。
 */

export type SeatPoint = { x: number; y: number };
/**
 * 运营画的场地标注（主题板、门口等），画布坐标。多边形顶点已是绝对坐标。
 * 形状由服务端 `parseMapMarks` 下发。
 */
export type SeatMapMarkShape = {
  shape: "rect" | "ellipse" | "polygon";
  x: number;
  y: number;
  width: number;
  height: number;
  points?: SeatPoint[];
  label: string;
};

/**
 * 标注文字怎么画：`horizontal`/`vertical` 写在形状里，`legend` 放不下、改由图上方
 * 的颜色图例说明，`none` 是没写字的标注。
 */
export type MarkLabelMode = "none" | "horizontal" | "vertical" | "legend";
export type MarkLabelPlacement = {
  mode: MarkLabelMode;
  /** 文字中心的屏幕坐标，相对盒子左上角。 */
  left: number;
  top: number;
};

export type SeatMapLayout = {
  /** 盒子宽高，屏幕 px。宽度即测量值，高度由内容长宽比推出。 */
  width: number;
  height: number;
  /** SVG viewBox，长宽比**恰好等于**盒子的长宽比，所以不会有 letterbox 偏移。 */
  viewBox: string;
  /** 全部座位合成的一条 path。 */
  path: string;
  /** 圆点直径，屏幕 px（配合 `vector-effect="non-scaling-stroke"` 用作描边宽度）。 */
  dotDiameter: number;
  /** 定位钉的屏幕坐标，相对盒子左上角。 */
  pin: { left: number; top: number };
  /** 与输入 `marks` 一一对应的文字位置。 */
  markLabels: MarkLabelPlacement[];
  /** 屏幕像素 ÷ 画布单位。 */
  scale: number;
};

export const SEAT_MAP = {
  /**
   * 屏幕座距上限。座位少的时候等比 fit 会把它们放大到填满盒子，八个座位变成八颗
   * 巨大的球，看着不像座位图像抽象画。到顶就不再放大，内容居中留白。
   *
   * 管制的是**座距**不是缩放倍率：画布世界单位是 48/64，`scale = 1` 在 343px 宽
   * 的手机上一排只放得下 7 个座位——管理端画布那条 `scale ≤ 1` 的上限在这里不能
   * 直接搬。
   */
  maxPitch: 44,
  /** 圆点半径 = 屏幕座距 × 这个比例，再夹进下面的上下界。 */
  dotRatio: 0.22,
  /**
   * 半径下界。密到一定程度圆点必然糊成一片，那是这片区真实的密度，不该硬撑；
   * 但完全不设下界的话，亚像素的点在高 DPR 屏上会直接消失，整片区变成空白。
   */
  minDotRadius: 1,
  /** 半径上界。示意图不是等比测绘图，圆点大过这个尺寸不再有更多信息量。 */
  maxDotRadius: 5,
  /** 内容四周留白，按座距算——定位钉要有地方站，边上的座位不能贴着框。 */
  padRatio: 0.9,
} as const;

/** 服务端兜底座距（`shared/seat-canvas.ts` 的 DEFAULT_SEAT_PITCH）。 */
const FALLBACK_PITCH = 34;

const isFiniteNumber = (value: number) => Number.isFinite(value);

/**
 * 算出一张图的全部排版参数。**数据不可用时返回 null**，调用方据此显示降级文案，
 * 而不是渲染一个空框。
 */
export function seatMapLayout(input: {
  seats: readonly SeatPoint[];
  mine: SeatPoint;
  /** 场地标注：要完整装进图里，不参与座距和圆点。 */
  marks?: readonly SeatMapMarkShape[];
  /** 标注文字的实际屏幕字号（根字号等比缩放后的像素值）。 */
  labelFontPx?: number;
  /** 典型座距，服务端算好发下来（`seatFieldPitch`）。 */
  pitch: number;
  /** 盒子宽度，屏幕 px。测量出来之前传 0，函数返回 null。 */
  viewWidth: number;
  minHeight: number;
  maxHeight: number;
}): SeatMapLayout | null {
  const { mine, viewWidth, minHeight, maxHeight } = input;

  if (!isFiniteNumber(viewWidth) || viewWidth <= 0) return null;
  if (!isFiniteNumber(mine.x) || !isFiniteNumber(mine.y)) return null;

  // 服务端已经滤过一遍脏坐标，这里再挡一道：单个 NaN 会一路传染到包围盒、
  // 长宽比和缩放倍率，最终表现是整张图安静地变成空白。
  const seats = input.seats.filter(
    (seat) => isFiniteNumber(seat.x) && isFiniteNumber(seat.y),
  );
  if (seats.length === 0) return null;

  const pitch =
    isFiniteNumber(input.pitch) && input.pitch > 0
      ? input.pitch
      : FALLBACK_PITCH;

  /**
   * 内容包围盒 + 留白。**全部座位重合时包围盒是零矩形**（只有一个座位，或者
   * 数据坏成一坨），留白正好把它救回来：加完之后宽高都是 `2 × pad`，不为 0，
   * 后面所有除法都安全。
   */
  const pad = pitch * SEAT_MAP.padRatio;
  let minX = seats[0].x;
  let minY = seats[0].y;
  let maxX = seats[0].x;
  let maxY = seats[0].y;
  for (const seat of seats) {
    if (seat.x < minX) minX = seat.x;
    if (seat.y < minY) minY = seat.y;
    if (seat.x > maxX) maxX = seat.x;
    if (seat.y > maxY) maxY = seat.y;
  }
  // 标注在座位外侧时（门口、主题板），包围盒要把它们也装进来，否则会被裁掉。
  const marks = (input.marks ?? []).filter((box) =>
    [box.x, box.y, box.width, box.height].every(isFiniteNumber),
  );
  for (const box of marks) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  const contentWidth = maxX - minX + pad * 2;
  const contentHeight = maxY - minY + pad * 2;

  // 盒子高度跟着内容长宽比走。单排座位的长宽比是有限的（留白撑起了高度），
  // 但仍然很大，算出来的高度会撞到下界——那正是想要的结果。
  const height = Math.min(
    maxHeight,
    Math.max(minHeight, (viewWidth * contentHeight) / contentWidth),
  );

  const fitScale = Math.min(viewWidth / contentWidth, height / contentHeight);
  const scale = Math.min(fitScale, SEAT_MAP.maxPitch / pitch);

  /**
   * viewBox 的长宽比**做成和盒子完全一致**，于是 `preserveAspectRatio` 不产生
   * 任何 letterbox 偏移，世界坐标到屏幕坐标就是一次纯缩放——定位钉的位置才能
   * 用一行乘法算准。高度被夹住、或者座距撞了上限时，多出来的空间进 viewBox，
   * 表现为内容居中留白。
   */
  const boxWidth = viewWidth / scale;
  const boxHeight = height / scale;
  const boxX = (minX + maxX) / 2 - boxWidth / 2;
  const boxY = (minY + maxY) / 2 - boxHeight / 2;

  const radius = Math.min(
    SEAT_MAP.maxDotRadius,
    Math.max(SEAT_MAP.minDotRadius, pitch * scale * SEAT_MAP.dotRatio),
  );

  return {
    width: viewWidth,
    height,
    /**
     * **不要在这里四舍五入。** path 上的压缩是给上千个点省字符串用的，viewBox
     * 只有四个数，省不出任何东西，却会让长宽比偏掉千分之一——而"viewBox 长宽比
     * 恰好等于盒子长宽比"正是定位钉那行乘法能算准的前提。偏差表现为钉子整体错位
     * 半个像素到几个像素，且只在被夹住的那些形态上出现。
     */
    viewBox: `${boxX} ${boxY} ${boxWidth} ${boxHeight}`,
    path: seatsToPath(seats),
    dotDiameter: radius * 2,
    pin: {
      left: (mine.x - boxX) * scale,
      top: (mine.y - boxY) * scale,
    },
    scale,
    markLabels: (input.marks ?? []).map((mark) => {
      const placement = markLabelPlacement(
        mark,
        scale,
        input.labelFontPx ?? DEFAULT_LABEL_FONT_PX,
      );
      return {
        mode: placement.mode,
        left: (placement.x - boxX) * scale,
        top: (placement.y - boxY) * scale,
      };
    }),
  };
}

/**
 * 标注形状在屏幕上的最小边长。大场里的门、洗手间缩下来只有几个像素，图例
 * 按颜色指过去也找不到；小于这个尺寸时绕中心放大到它，位置不变。
 */
export const MIN_MARK_PX = 10;

export function enlargeMark<T extends SeatMapMarkShape>(
  mark: T,
  scale: number,
): T {
  const min = MIN_MARK_PX / scale;
  if (!Number.isFinite(min) || (mark.width >= min && mark.height >= min))
    return mark;
  const width = Math.max(mark.width, min);
  const height = Math.max(mark.height, min);
  const cx = mark.x + mark.width / 2;
  const cy = mark.y + mark.height / 2;
  const sx = mark.width > 0 ? width / mark.width : 1;
  const sy = mark.height > 0 ? height / mark.height : 1;
  return {
    ...mark,
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    points: mark.points?.map((point) => ({
      x: cx + (point.x - cx) * sx,
      y: cy + (point.y - cy) * sy,
    })),
  };
}

/** `text-caption` 在根字号 16px 时的像素值，测不到根字号时兜底。 */
const DEFAULT_LABEL_FONT_PX = 11;
/** 椭圆内接矩形约占包围盒的比例；多边形量不出实际跨度时保守取一半。 */
const MARK_ELLIPSE_RATIO = 0.7;
const MARK_POLYGON_FALLBACK_RATIO = 0.5;
/** 多边形量出的跨度再留一点余量，斜边附近写字不贴边。 */
const MARK_POLYGON_SPAN_RATIO = 0.85;
const MARK_LABEL_PADDING_PX = 3;
/** 横排时字高允许超出形状的像素。 */
const MARK_OVERFLOW_PX = 2;
/** 竖排相邻两字的中心距，按字号倍数。 */
export const MARK_VERTICAL_ADVANCE = 1.05;

/** 中日韩和全角字符按 1em，其余按 0.6em 估宽——只用来判断放不放得下。 */
function labelWidthEm(label: string) {
  let width = 0;
  for (const char of label) {
    const code = char.codePointAt(0) ?? 0;
    width += code >= 0x2e80 && code <= 0xffef ? 1 : 0.6;
  }
  return width;
}

/**
 * 过 `center` 的横线（`axis: "x"`）或竖线与多边形相交，取包含 `center` 的那一段
 * 长度。凹多边形也按实际可写的那一段算；量不出来返回 null。
 */
function spanThrough(
  points: readonly SeatPoint[],
  center: SeatPoint,
  axis: "x" | "y",
): number | null {
  const along = axis === "x" ? "x" : "y";
  const across = axis === "x" ? "y" : "x";
  const hits: number[] = [];
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    if (a[across] > center[across] === b[across] > center[across]) continue;
    hits.push(
      a[along] +
        ((center[across] - a[across]) * (b[along] - a[along])) /
          (b[across] - a[across]),
    );
  }
  hits.sort((left, right) => left - right);
  for (let k = 0; k + 1 < hits.length; k += 2) {
    if (hits[k] <= center[along] && center[along] <= hits[k + 1])
      return hits[k + 1] - hits[k];
  }
  return null;
}

/** 以 `center` 为中心能写字的宽高（画布单位）。 */
function writableSize(mark: SeatMapMarkShape, center: SeatPoint) {
  if (mark.shape === "rect") return { width: mark.width, height: mark.height };
  if (mark.shape === "ellipse" || !mark.points)
    return {
      width:
        mark.width *
        (mark.shape === "ellipse"
          ? MARK_ELLIPSE_RATIO
          : MARK_POLYGON_FALLBACK_RATIO),
      height:
        mark.height *
        (mark.shape === "ellipse"
          ? MARK_ELLIPSE_RATIO
          : MARK_POLYGON_FALLBACK_RATIO),
    };
  const width = spanThrough(mark.points, center, "x");
  const height = spanThrough(mark.points, center, "y");
  return {
    width:
      width === null
        ? mark.width * MARK_POLYGON_FALLBACK_RATIO
        : width * MARK_POLYGON_SPAN_RATIO,
    height:
      height === null
        ? mark.height * MARK_POLYGON_FALLBACK_RATIO
        : height * MARK_POLYGON_SPAN_RATIO,
  };
}

function polygonCentroid(points: readonly SeatPoint[]): SeatPoint | null {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j].x * points[i].y - points[i].x * points[j].y;
    area += cross;
    x += (points[j].x + points[i].x) * cross;
    y += (points[j].y + points[i].y) * cross;
  }
  if (Math.abs(area) < Number.EPSILON) return null;
  return { x: x / (3 * area), y: y / (3 * area) };
}

/**
 * 标注文字放不放得进形状。**与管理端 `core/marks.ts` 的 `markLabelLayout` 同一
 * 算法**（两个前端不共享代码）：形状跟着图缩放、文字固定屏幕字号，先试横排，
 * 形状瘦高再试竖排（门、柱子），都不行就交给图例。
 */
export function markLabelPlacement(
  mark: SeatMapMarkShape,
  scale: number,
  fontPx: number,
): { mode: MarkLabelMode; x: number; y: number } {
  const center = (mark.shape === "polygon" &&
    mark.points &&
    polygonCentroid(mark.points)) || {
    x: mark.x + mark.width / 2,
    y: mark.y + mark.height / 2,
  };
  const text = mark.label.trim();
  if (!text) return { mode: "none", ...center };

  const writable = writableSize(mark, center);
  const innerWidth = writable.width * scale - MARK_LABEL_PADDING_PX * 2;
  const innerHeight = writable.height * scale - MARK_LABEL_PADDING_PX * 2;
  // 横排：宽度留边距；高度只要求字高不超出形状 2px——扁长的主题板、背景板
  // 缩小后只有十来像素高，字压在上面照样读得清，比挪进图例直观。
  if (
    labelWidthEm(text) * fontPx <= innerWidth &&
    fontPx <= writable.height * scale + MARK_OVERFLOW_PX
  )
    return { mode: "horizontal", ...center };

  // 竖排一列只占一个字宽，两侧各留 1px 即可；门这类窄条靠它把字留在形状里。
  const columnWidth = writable.width * scale - 2;
  const chars = [...text].length;
  if (
    chars > 1 &&
    innerHeight > innerWidth &&
    fontPx <= columnWidth &&
    chars * fontPx * MARK_VERTICAL_ADVANCE <= innerHeight
  )
    return { mode: "vertical", ...center };

  return { mode: "legend", ...center };
}

/**
 * 自定义颜色可能很浅，直接当文字色就看不清：相对亮度过高时返回 null，
 * 调用方改用正文色。阈值对应白底约 4.5:1。
 */
export function markTextColor(hex: string): string | null {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return null;
  const [r, g, b] = match
    .slice(1)
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? null : hex;
}

/**
 * 全部座位 → **一条** path。
 *
 * 一万座也只有一个 DOM 节点：DOM 节点数与座位数无关，这是这张图在极端数量下
 * 不卡的唯一原因。能这么做的前提是所有座位长得一模一样——没有编号、没有姓名、
 * 不分种类等级、不响应点击，那是定位图这个形态挣来的。
 *
 * `M x y h0` 是零长度子路径，配合 `stroke-linecap="round"` 渲染成一个圆点，
 * 半径由描边宽度决定。比逐点写两段圆弧短三倍，一万座的属性串差别是 150KB 和
 * 500KB。
 */
function seatsToPath(seats: readonly SeatPoint[]) {
  let path = "";
  for (const seat of seats) {
    path += `M${round(seat.x)} ${round(seat.y)}h0`;
  }
  return path;
}

/** 画布坐标基本都是 48/64 的整数倍，一位小数足够，能省下可观的属性串长度。 */
const round = (value: number) => Math.round(value * 10) / 10;
