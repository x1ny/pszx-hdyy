import type { Command } from "./commands";
import {
  type CanvasDoc,
  type CanvasMark,
  MARK_LABEL_MAX,
  type ZoneShape,
} from "./document";
import {
  boundsOf,
  normalizeRect,
  type Point,
  type Rect,
  scalePoints,
  toAbsolutePoints,
} from "./geometry";
import { zoneRect } from "./interaction";

/**
 * 场地标注（主题板、门口、舞台……）的纯逻辑：调色板、命令、命中和文字排版。
 *
 * 标注和桌面图形同类——只用于渲染和导出，不参与排座、不投影。文字排版这一条
 * 同时决定管理端画布、导出图和 H5（H5 有一份同算法的移植，两个前端不共享代码）
 * 里文字画在形状里还是进图例。
 */

/**
 * 预置颜色。都是白底上 ≥4.5:1 的深色阶，所以既能描边、又能直接当文字色；
 * 相邻两色跨色相，新标注按顺序取第一个没用过的，同一分区里默认不撞色。
 */
export const MARK_COLORS = [
  { value: "#15803D", name: "绿" },
  { value: "#7C3AED", name: "紫" },
  { value: "#0E7490", name: "青" },
  { value: "#C2410C", name: "橙" },
  { value: "#2563EB", name: "蓝" },
  { value: "#A16207", name: "黄" },
  { value: "#BE185D", name: "粉" },
  { value: "#475569", name: "灰" },
  // 红色放最后：H5 用主题红标"我的座位"和团体占位，默认不跟它撞色。
  { value: "#DC2626", name: "红" },
] as const;

/** 标注形状的最小边长（画布单位）。只挡误触出来的零尺寸，不限制门、柱这类小物件。 */
export const MARK_MIN_SIZE = 8;

/** 画布和导出图里标注文字的屏幕字号。 */
export const MARK_LABEL_FONT_PX = 12;
/** 竖排相邻两字的中心距，按字号倍数。 */
export const MARK_VERTICAL_ADVANCE = 1.05;

/** 圆形存成宽高相等的椭圆，展示时按宽高还原成"圆形"。 */
export function markShapeLabel(shape: ZoneShape) {
  if (shape.type === "rect") return "矩形";
  if (shape.type === "polygon") return "多边形";
  return Math.abs(shape.width - shape.height) < 0.5 ? "圆形" : "椭圆";
}

export type MarkDrawShape = "rect" | "circle" | "ellipse" | "polygon";

export function nextMarkColor(marks: readonly Pick<CanvasMark, "color">[]) {
  const used = new Set(marks.map((mark) => mark.color.toUpperCase()));
  return (
    MARK_COLORS.find((color) => !used.has(color.value))?.value ??
    MARK_COLORS[marks.length % MARK_COLORS.length].value
  );
}

/**
 * 自定义颜色可能很浅（拾色器随便点出来的淡黄），直接当文字色就看不清。
 * 相对亮度超过阈值时返回 null，调用方改用前景色写字，形状仍用原色。
 */
export function markTextColor(hex: string): string | null {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return null;
  const [r, g, b] = match
    .slice(1)
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.18 ? null : hex;
}

// ---------------------------------------------------------------------------
// 形状
// ---------------------------------------------------------------------------

export const markRect = (mark: Pick<CanvasMark, "shape">): Rect =>
  zoneRect(mark);

export function markPoints(shape: ZoneShape): Point[] {
  return shape.type === "polygon"
    ? toAbsolutePoints({ x: shape.x, y: shape.y }, shape.points)
    : [];
}

/** 拖拽画出的矩形/椭圆/圆。圆就是宽高相等的椭圆，同区域工具的约定。 */
export function markShapeFromDrag(
  type: Exclude<MarkDrawShape, "polygon">,
  rect: Rect,
): ZoneShape {
  const side = Math.max(rect.width, rect.height);
  const circle = type === "circle";
  return {
    type: circle ? "ellipse" : type,
    x: rect.x,
    y: rect.y,
    width: Math.max(MARK_MIN_SIZE, circle ? side : rect.width),
    height: Math.max(MARK_MIN_SIZE, circle ? side : rect.height),
  };
}

/** 点一下没拖动时，按座距给一个能看清、能继续调整的默认尺寸。 */
export function defaultMarkShape(
  type: Exclude<MarkDrawShape, "polygon">,
  center: Point,
  pitch: number,
): ZoneShape {
  const width = type === "rect" ? pitch * 4 : pitch * 2;
  const height = type === "ellipse" ? pitch * 1.4 : pitch * 2;
  const size =
    type === "rect"
      ? { width, height: pitch * 1.2 }
      : { width, height: type === "circle" ? width : height };
  return markShapeFromDrag(type, {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    ...size,
  });
}

/** 点击累积的绝对顶点 → 多边形，顶点转成相对包围盒左上角的坐标。 */
export function markShapeFromPoints(
  points: readonly Point[],
): ZoneShape | null {
  if (points.length < 3) return null;
  const bounds = boundsOf(points);
  if (bounds.width < MARK_MIN_SIZE && bounds.height < MARK_MIN_SIZE)
    return null;
  return {
    type: "polygon",
    x: bounds.x,
    y: bounds.y,
    width: Math.max(MARK_MIN_SIZE, bounds.width),
    height: Math.max(MARK_MIN_SIZE, bounds.height),
    points: points.map((point) => ({
      x: point.x - bounds.x,
      y: point.y - bounds.y,
    })),
  };
}

/** 全部标注的包围盒。适配视野和导出都要把它们装进来，否则画在座位外侧的会被裁掉。 */
export function marksBounds(marks: readonly CanvasMark[]): Rect | null {
  if (marks.length === 0) return null;
  return boundsOf(
    marks.flatMap((mark) => [
      { x: mark.shape.x, y: mark.shape.y },
      {
        x: mark.shape.x + mark.shape.width,
        y: mark.shape.y + mark.shape.height,
      },
    ]),
  );
}

export function unionRect(a: Rect, b: Rect | null): Rect {
  if (!b) return a;
  return normalizeRect(
    { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    {
      x: Math.max(a.x + a.width, b.x + b.width),
      y: Math.max(a.y + a.height, b.y + b.height),
    },
  );
}

// ---------------------------------------------------------------------------
// 文字排版
// ---------------------------------------------------------------------------

/** 中日韩和全角字符按 1em，其余按 0.6em 估宽——只用来判断放不放得下。 */
export function labelWidthEm(label: string) {
  let width = 0;
  for (const char of label) width += /[\u2E80-\uFFEF]/.test(char) ? 1 : 0.6;
  return width;
}

export type MarkLabelMode = "none" | "horizontal" | "vertical" | "legend";

/** 椭圆内接矩形约占包围盒的比例；多边形量不出实际跨度时保守取一半。 */
const ELLIPSE_RATIO = 0.7;
const POLYGON_FALLBACK_RATIO = 0.5;
/** 多边形量出的跨度再留一点余量，斜边附近写字不贴边。 */
const POLYGON_SPAN_RATIO = 0.85;
const LABEL_PADDING_PX = 3;
/** 横排时字高允许超出形状的像素。 */
const OVERFLOW_PX = 2;

/**
 * 过 `center` 的横线（`axis: "x"`）或竖线与多边形相交，取包含 `center` 的那一段
 * 长度。凹多边形也按实际可写的那一段算；量不出来返回 null。
 */
function spanThrough(
  points: readonly Point[],
  center: Point,
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
function writableSize(shape: ZoneShape, center: Point) {
  if (shape.type === "rect")
    return { width: shape.width, height: shape.height };
  if (shape.type === "ellipse")
    return {
      width: shape.width * ELLIPSE_RATIO,
      height: shape.height * ELLIPSE_RATIO,
    };
  const points = markPoints(shape);
  const width = spanThrough(points, center, "x");
  const height = spanThrough(points, center, "y");
  return {
    width:
      width === null
        ? shape.width * POLYGON_FALLBACK_RATIO
        : width * POLYGON_SPAN_RATIO,
    height:
      height === null
        ? shape.height * POLYGON_FALLBACK_RATIO
        : height * POLYGON_SPAN_RATIO,
  };
}

function polygonCentroid(points: readonly Point[]): Point | null {
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
 * 标注文字画在哪、怎么画。形状跟着画布缩放，文字固定屏幕字号，所以缩小到一定
 * 程度文字就放不进形状了：先试横排，形状瘦高时再试竖排（门、柱子常见），
 * 都放不下就交给图例，由颜色对应文字。
 *
 * `scale` 是屏幕像素 ÷ 画布单位；返回的 `x`/`y` 是文字中心的画布坐标。
 */
export function markLabelLayout(
  shape: ZoneShape,
  label: string,
  scale: number,
  fontPx: number = MARK_LABEL_FONT_PX,
): { mode: MarkLabelMode; x: number; y: number } {
  const center = (shape.type === "polygon" &&
    polygonCentroid(markPoints(shape))) || {
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2,
  };
  const text = label.trim();
  if (!text) return { mode: "none", ...center };

  const writable = writableSize(shape, center);
  const innerWidth = writable.width * scale - LABEL_PADDING_PX * 2;
  const innerHeight = writable.height * scale - LABEL_PADDING_PX * 2;
  // 横排：宽度留边距；高度只要求字高不超出形状 2px——扁长的主题板、背景板
  // 缩小后只有十来像素高，字压在上面照样读得清，比挪进图例直观。
  if (
    labelWidthEm(text) * fontPx <= innerWidth &&
    fontPx <= writable.height * scale + OVERFLOW_PX
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

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

const findMark = (doc: CanvasDoc, markId: string) =>
  doc.marks?.find((mark) => mark.externalId === markId);

export const addMark = (mark: CanvasMark): Command => ({
  label: "新增标注",
  apply: (draft) => {
    const zone = draft.zones.find(
      (item) => item.externalId === mark.zoneExternalId,
    );
    if (!zone || zone.isGroup) return;
    draft.marks ??= [];
    draft.marks.push({ ...mark, label: mark.label.slice(0, MARK_LABEL_MAX) });
  },
});

export const moveMark = (markId: string, delta: Point): Command => ({
  label: "移动标注",
  apply: (draft) => {
    const mark = findMark(draft, markId);
    if (!mark) return;
    mark.shape.x += delta.x;
    mark.shape.y += delta.y;
  },
});

export const resizeMark = (markId: string, next: Rect): Command => ({
  label: "调整标注大小",
  apply: (draft) => {
    const mark = findMark(draft, markId);
    if (!mark) return;
    const from = { width: mark.shape.width, height: mark.shape.height };
    const to = {
      width: Math.max(MARK_MIN_SIZE, next.width),
      height: Math.max(MARK_MIN_SIZE, next.height),
    };
    mark.shape.x = next.x;
    mark.shape.y = next.y;
    mark.shape.width = to.width;
    mark.shape.height = to.height;
    if (mark.shape.type === "polygon")
      mark.shape.points = scalePoints(mark.shape.points, from, to);
  },
});

export const patchMark = (
  markId: string,
  patch: Partial<Pick<CanvasMark, "label" | "color">>,
): Command => ({
  label: "修改标注",
  apply: (draft) => {
    const mark = findMark(draft, markId);
    if (!mark) return;
    if (patch.label !== undefined)
      mark.label = patch.label.slice(0, MARK_LABEL_MAX);
    if (patch.color !== undefined && /^#[\da-f]{6}$/i.test(patch.color))
      mark.color = patch.color.toUpperCase();
  },
});

export const removeMark = (markId: string): Command => ({
  label: "删除标注",
  apply: (draft) => {
    if (draft.marks)
      draft.marks = draft.marks.filter((mark) => mark.externalId !== markId);
  },
});
