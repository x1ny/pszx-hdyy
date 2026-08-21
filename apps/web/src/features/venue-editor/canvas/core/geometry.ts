/**
 * 几何原语。**零 React、零 DOM**，所以能被单测彻底覆盖。
 *
 * docs/场地排位编辑器设计.md §5 把这一层列为"必须 100% 覆盖"的第一档——参考实现
 * （旧系统）是未经验证的 AI demo，不带任何正确性信用，这里每个函数都得自己站得住。
 *
 * 不引 `@turf`（地理库，带坐标系概念）也不引 `flatten-js`（功能远超需要）：
 * 需要的就是下面这几个十来行的函数，引库只会多一层抽象。
 */

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * 两个对角点 → 规范化矩形（宽高恒非负）。
 * 拖拽画矩形时用户可能从右下往左上拉，不规范化的话宽高会是负数。
 */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export const rectContains = (rect: Rect, point: Point) =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

/** 边界相接算相交——框选时擦到边缘就该选中。 */
export const rectsIntersect = (a: Rect, b: Rect) =>
  !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );

/** 把点夹进矩形内，可留内边距（座位不该贴着区域边框）。 */
export function clampPointToRect(point: Point, rect: Rect, pad = 0): Point {
  const maxX = Math.max(rect.x + pad, rect.x + rect.width - pad);
  const maxY = Math.max(rect.y + pad, rect.y + rect.height - pad);
  return {
    x: clamp(point.x, rect.x + pad, maxX),
    y: clamp(point.y, rect.y + pad, maxY),
  };
}

export const ellipseContains = (rect: Rect, point: Point) => {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  // 半轴退化成 0（刚落笔还没拖开）时按 1 处理，避免除零把命中判定变成恒真/恒假。
  const rx = rect.width / 2 || 1;
  const ry = rect.height / 2 || 1;
  const dx = (point.x - cx) / rx;
  const dy = (point.y - cy) / ry;
  return dx * dx + dy * dy <= 1;
};

/**
 * 射线法判断点是否在多边形内。`polygon` 必须是**绝对坐标**——多边形区域的
 * 顶点存的是相对坐标，调用方要先加上区域左上角再传进来。
 *
 * 支持凹多边形（不要求凸包），这也是选它而不是"用凸包近似"的理由：手画的
 * 场地轮廓完全可能是凹的（比如 L 型大厅）。
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersect =
      pi.y > point.y !== pj.y > point.y &&
      point.x <
        ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + Number.EPSILON) +
          pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 一组点的包围盒。空数组返回零矩形而不是 Infinity。 */
export function boundsOf(points: Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 区域缩放时同比搬运区域内的相对坐标。
 *
 * 原尺寸某一边为 0 时按 1 处理：不这么做会得到 Infinity 或 NaN，
 * 而"把一个零宽区域拉开"是完全正常的操作（先点一下再拖）。
 */
export function scalePoint(point: Point, from: Size, to: Size): Point {
  return {
    x: point.x * (to.width / (from.width || 1)),
    y: point.y * (to.height / (from.height || 1)),
  };
}

/** 点数组 → SVG `points` 属性字符串，`<polygon>`/`<polyline>` 都吃这个格式。 */
export const pointsToSvg = (points: Point[]) =>
  points.map((p) => `${p.x},${p.y}`).join(" ");

/** 相对坐标（多边形顶点、座位坐标通用）批量转绝对坐标。 */
export const toAbsolutePoints = (origin: Point, relative: Point[]): Point[] =>
  relative.map((p) => ({ x: origin.x + p.x, y: origin.y + p.y }));

/** 一组相对坐标随包围盒缩放同步缩放——resize 一个多边形区域时顶点跟着走。 */
export const scalePoints = (points: Point[], from: Size, to: Size): Point[] =>
  points.map((p) => scalePoint(p, from, to));

/** 屏幕坐标 → 世界坐标。视口只有平移和等比缩放，够用且可测。 */
export const toWorld = (
  screen: Point,
  viewport: { x: number; y: number; scale: number },
): Point => ({
  x: (screen.x - viewport.x) / viewport.scale,
  y: (screen.y - viewport.y) / viewport.scale,
});

export const toScreen = (
  world: Point,
  viewport: { x: number; y: number; scale: number },
): Point => ({
  x: world.x * viewport.scale + viewport.x,
  y: world.y * viewport.scale + viewport.y,
});

/**
 * 让整个世界铺满视口，并留白。
 * 缩放上限 1：小场地不该被放大到糊，宁可四周留空。
 */
export function fitViewport(
  world: Size,
  view: Size,
  pad = 32,
): { x: number; y: number; scale: number } {
  const availableWidth = Math.max(1, view.width - pad * 2);
  const availableHeight = Math.max(1, view.height - pad * 2);
  const scale = Math.min(
    1,
    availableWidth / (world.width || 1),
    availableHeight / (world.height || 1),
  );

  return {
    scale,
    x: (view.width - world.width * scale) / 2,
    y: (view.height - world.height * scale) / 2,
  };
}
