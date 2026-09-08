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

export type SeatMapLayout = {
  /** 盒子高度，屏幕 px。 */
  height: number;
  /** SVG viewBox，长宽比**恰好等于**盒子的长宽比，所以不会有 letterbox 偏移。 */
  viewBox: string;
  /** 全部座位合成的一条 path。 */
  path: string;
  /** 圆点直径，屏幕 px（配合 `vector-effect="non-scaling-stroke"` 用作描边宽度）。 */
  dotDiameter: number;
  /** 定位钉的屏幕坐标，相对盒子左上角。 */
  pin: { left: number; top: number };
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
  };
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
