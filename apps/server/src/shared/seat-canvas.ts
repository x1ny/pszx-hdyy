/**
 * `svg-canvas-v1` 画布 blob 的**只读**坐标提取。
 *
 * ---------------------------------------------------------------------------
 * 这是全仓库**唯一一处服务端认识画布格式的地方**，破的是 venue / seating 两个
 * schema 上反复写着的那条"服务端一个字节都不解析"。所以先说清楚边界：
 *
 * - **只读。** 写路径（`venue/saveLayout`、`seating/saveLayout`、`createPlan`）
 *   继续一个字节都不解析——座位由前端投影好传上来，服务端按 `externalId` 归并。
 *   那条不变量保护的是归并逻辑不依赖 blob 结构，这里不碰它。
 * - **只取 H5 必需的字段。** 座位图只读坐标；团体座位范围只读排名和座位在排内
 *   的顺序。不读 zones、颜色、world 尺寸等呈现细节。多读一个字段就多一分将来
 *   编辑器改格式时这里静默失效的面积。
 * - **失败就是 null，不抛。** 唯一的消费方是 h5 的座位图，拿到 null 时降级成
 *   「只给编号不给图」。为一张示意图让嘉宾的整个行程页 500 是不划算的。
 *
 * 为什么这份解析在服务端而不在 h5：画一张正确的图需要**同时**有坐标（只在 blob
 * 里）和"这个位置这次还在不在"（只在 `segment_seat` 行上），两边缺一不可。让 h5
 * 自己 join 的话，服务端得把整份 blob 加整份座位行都发下去，前端再写一遍守卫解析
 * ——耦合一样存在，只是搬了个地方，还多一份手写解析器。
 *
 * 不用 zod：这里的输入是**已经落库的历史数据**，不是请求体。请求体不合法要报错
 * 给调用方，历史数据不合法只能尽力而为——脏坐标跳过那一个座位，而不是让整张图
 * 消失。zod 的语义（整体成功或整体失败）在这里是反的。
 * ---------------------------------------------------------------------------
 */

/** 画布渲染器标识。`segment_seating_layout.renderer_kind` 不是这个值就别解析。 */
export const SEAT_CANVAS_RENDERER_KIND = "svg-canvas-v1";

/** 一个位置在它所属区域内的独立坐标。单位是画布单位，不表达米。 */
export type SeatPoint = { externalId: string; x: number; y: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 手改过的 blob 里塞得进 NaN / Infinity，而它们会一路传染到包围盒、长宽比和
 * 缩放倍率，最终表现是整张图变成空白——不是报错，是安静地什么都不画。挡在这里。
 */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * blob → 座位坐标。
 *
 * 返回 `null` = 这份数据没法画图（不是对象、版本不认、`seats` 不是数组）。
 * 返回 `[]` = 数据是好的，只是一个座位都没有——两者对调用方的意义不同，前者
 * 该降级到「只给编号」，后者是一张空图，所以不能都用空数组表达。
 *
 * 单个座位缺字段或坐标是脏的，**跳过那一个**，其余照常返回。整份作废的代价太大：
 * 一千个座位里有一个坏的，不该让另外九百九十九个也看不见。
 */
export function parseSeatPoints(data: unknown): SeatPoint[] | null {
  if (!isRecord(data)) return null;
  if (data.schemaVersion !== 1) return null;
  if (!Array.isArray(data.seats)) return null;

  const points: SeatPoint[] = [];
  for (const raw of data.seats) {
    if (!isRecord(raw)) continue;
    const { externalId, x, y } = raw;
    if (typeof externalId !== "string" || externalId.length === 0) continue;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
    points.push({ externalId, x, y });
  }

  return points;
}

/** 桌面外框：圆桌/方桌的家具形状，不含座位坐标。单位同画布，不表达米。 */
export type TableShape =
  | { shape: "circle"; x: number; y: number; radius: number }
  | {
      shape: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      angle: number;
    };

const TABLE_MIN_SIDE = 48;
const tableEdgeGap = (spacing: number) => Math.max(16, spacing * 0.35);

function tableSeatRadius(spacing: number, count: number) {
  return count > 1 ? spacing / (2 * Math.sin(Math.PI / count)) : 0;
}

/**
 * blob → 桌面外框（圆桌/方桌的家具形状）。
 *
 * 跟 `apps/web` 的 `core/rows.ts` `tableGeometry` 是**同一份公式的移植**，
 * 理由同 `seatFieldPitch`：两个前端不共享代码，但两端对同一份画布必须算出
 * 同一个桌子形状，否则管理端画布和 h5 座位图会对不上。方桌宽高、圆桌半径
 * 都只按 spacing / 座位数 / 四侧人数现算，编辑器本身也不落库，所以这里
 * 只能跟着重算，不能指望字段里直接有尺寸。
 *
 * 返回 `null` = 这份数据没法解析（不是对象、版本不认、`rows` 不是数组）。
 * `rows` 字段本身可选（旧画布没有），缺省按"没有桌子"处理，返回 `[]`。
 * 单条排缺字段或形状不认识就跳过它自己，不作废整份——道理同 `parseSeatPoints`。
 *
 * 传 `zoneExternalId` 只取该分区的桌子——组合方案一份 blob 装着多个分区
 * （见 `parseSeatSections`），不按分区过滤会把别的分区的桌子混进当前分区的
 * 坐标系，各分区坐标独立，混进来的桌子会画在错误的位置，不只是隐私问题。
 */
export function parseTableShapes(
  data: unknown,
  zoneExternalId?: string,
): TableShape[] | null {
  if (!isRecord(data)) return null;
  if (data.schemaVersion !== 1) return null;
  if (data.rows === undefined) return [];
  if (!Array.isArray(data.rows)) return null;

  const shapes: TableShape[] = [];
  for (const raw of data.rows) {
    if (!isRecord(raw)) continue;
    if (zoneExternalId !== undefined && raw.zoneExternalId !== zoneExternalId)
      continue;
    const { shape, x, y, angle, spacing, seatIds } = raw;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
    if (!isFiniteNumber(spacing) || spacing <= 0) continue;
    const rowAngle = isFiniteNumber(angle) ? angle : 0;

    if (shape === "circle") {
      const count = Array.isArray(seatIds) ? seatIds.length : 0;
      if (count < 2) continue;
      const seatRadius = tableSeatRadius(spacing, count);
      const radius = Math.max(
        TABLE_MIN_SIDE / 4,
        seatRadius - tableEdgeGap(spacing),
      );
      shapes.push({ shape: "circle", x, y, radius });
      continue;
    }

    if (shape === "rect") {
      const sides = raw.sides;
      if (!isRecord(sides)) continue;
      const side = (key: string) =>
        isFiniteNumber(sides[key]) ? Math.max(0, sides[key]) : 0;
      const extent = (count: number) => Math.max(0, count - 1) * spacing;
      const width = Math.max(
        TABLE_MIN_SIDE,
        extent(side("top")),
        extent(side("bottom")),
      );
      const height = Math.max(
        TABLE_MIN_SIDE,
        extent(side("left")),
        extent(side("right")),
      );
      shapes.push({ shape: "rect", x, y, width, height, angle: rowAngle });
    }
  }
  return shapes;
}

/**
 * 运营画的场地标注（主题板、门口、舞台……）：一个形状、一种颜色、一段文字。
 *
 * 文字和颜色是场地信息，不属于任何嘉宾，所以可以随座位图下发；方向由运营显式
 * 画出，不从座位坐标推断。管理端存的多边形顶点是相对包围盒的，这里换成绝对
 * 坐标，H5 直接画。标注不旋转（管理端解析时同样丢掉 `rotation`）。
 *
 * 缺字段、尺寸或颜色非法的单条跳过，道理同 `parseTableShapes`。
 */
export type MapMark = {
  shape: "rect" | "ellipse" | "polygon";
  x: number;
  y: number;
  width: number;
  height: number;
  /** 仅多边形：绝对坐标顶点。 */
  points?: { x: number; y: number }[];
  /** `#rrggbb` */
  color: string;
  /** 可能为空：只画形状、不写字。 */
  label: string;
};

const MARK_LABEL_MAX = 32;
const HEX_COLOR = /^#[\da-f]{6}$/i;

export function parseMapMarks(
  data: unknown,
  zoneExternalId?: string,
): MapMark[] | null {
  if (!isRecord(data)) return null;
  if (data.schemaVersion !== 1) return null;
  if (data.marks === undefined) return [];
  if (!Array.isArray(data.marks)) return null;

  const marks: MapMark[] = [];
  for (const raw of data.marks) {
    if (!isRecord(raw) || !isRecord(raw.shape)) continue;
    if (zoneExternalId !== undefined && raw.zoneExternalId !== zoneExternalId)
      continue;
    const { color, label } = raw;
    const { type, x, y, width, height } = raw.shape;
    if (type !== "rect" && type !== "ellipse" && type !== "polygon") continue;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
    if (!isFiniteNumber(width) || !isFiniteNumber(height)) continue;
    if (width <= 0 || height <= 0) continue;
    if (typeof color !== "string" || !HEX_COLOR.test(color)) continue;
    if (typeof label !== "string") continue;
    const mark: MapMark = {
      shape: type,
      x,
      y,
      width,
      height,
      color,
      label: label.trim().slice(0, MARK_LABEL_MAX),
    };
    if (type === "polygon") {
      const points = Array.isArray(raw.shape.points) ? raw.shape.points : [];
      const absolute = points.flatMap((point) =>
        isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y)
          ? [{ x: x + point.x, y: y + point.y }]
          : [],
      );
      if (absolute.length < 3 || absolute.length !== points.length) continue;
      mark.points = absolute;
    }
    marks.push(mark);
  }
  return marks;
}

type SeatReference = { externalId: string; label: string };

type NumberedLabel = {
  prefix: string;
  number: number;
  rawNumber: string;
  suffix: string;
};

/**
 * 团体占位 → 面向嘉宾的排内范围。
 *
 * 座位画在什么位置和它在一排里的先后是两件事：坐标靠猜不出「5 排后面是 6 排」，
 * 而 `rows[].seatIds` 正是编辑器显式保存的业务顺序。这里按它来合并连续编号，**不
 * 看 `aisleEvery`**；过道只影响画布上的间距，不能把 `03、04` 说成两段座位。
 *
 * 历史布局没有 `rows`、某个位置没挂到排、或者编号不是可连续的数字时，保守退回
 * 到已确认座位行的稳定顺序。座位信息仍能给出，只是不能伪造一个范围。
 */
export function formatOrganizationSeatRanges(
  data: unknown,
  seats: readonly SeatReference[],
) {
  if (seats.length === 0) return "";

  const fallback = seats.map((seat) => seat.label).join("、");
  if (
    !isRecord(data) ||
    data.schemaVersion !== 1 ||
    !Array.isArray(data.rows)
  ) {
    return fallback;
  }

  const labelById = new Map(seats.map((seat) => [seat.externalId, seat.label]));
  const used = new Set<string>();
  const ranges: string[] = [];

  for (const rawRow of data.rows) {
    if (!isRecord(rawRow)) continue;
    if (typeof rawRow.name !== "string" || !Array.isArray(rawRow.seatIds)) {
      continue;
    }

    const rowSeats = rawRow.seatIds.flatMap((externalId) => {
      if (typeof externalId !== "string" || used.has(externalId)) return [];
      const label = labelById.get(externalId);
      if (label === undefined) return [];
      used.add(externalId);
      return [{ label, numbered: parseNumberedLabel(label) }];
    });

    for (const run of splitConsecutiveRuns(rowSeats)) {
      ranges.push(formatRowRun(rawRow.name, run));
    }
  }

  // 一份手改过的历史 blob 可能没把所有座位挂到排上。排过的先按编辑器顺序说，
  // 其余仍按 segment_seat 的 ordinal 顺序补上，绝不静默少报位置。
  for (const seat of seats) {
    if (!used.has(seat.externalId)) ranges.push(seat.label);
  }

  return ranges.length > 0 ? ranges.join("、") : fallback;
}

function parseNumberedLabel(label: string): NumberedLabel | null {
  const match = /^(.*?)(\d+)(\D*)$/.exec(label);
  if (!match) return null;
  const [, prefix, rawNumber, suffix] = match;
  const number = Number(rawNumber);
  return Number.isSafeInteger(number)
    ? { prefix, number, rawNumber, suffix }
    : null;
}

function splitConsecutiveRuns(
  seats: { label: string; numbered: NumberedLabel | null }[],
) {
  const runs: (typeof seats)[] = [];
  for (const seat of seats) {
    const current = runs.at(-1);
    const previous = current?.at(-1);
    if (
      current &&
      previous &&
      previous.numbered &&
      seat.numbered &&
      previous.numbered.prefix === seat.numbered.prefix &&
      previous.numbered.suffix === seat.numbered.suffix &&
      previous.numbered.number + 1 === seat.numbered.number
    ) {
      current.push(seat);
    } else {
      runs.push([seat]);
    }
  }
  return runs;
}

function formatRowRun(
  rowName: string,
  run: { label: string; numbered: NumberedLabel | null }[],
) {
  const first = run[0];
  const last = run.at(-1);
  if (!first || !last || !first.numbered || !last.numbered) {
    return run.map((seat) => seat.label).join("、");
  }

  const prefix = first.numbered.prefix || rowName;
  const start = `${prefix}${first.numbered.rawNumber}`;
  if (run.length === 1) return `${start}${first.numbered.suffix}`;
  return `${start}–${last.numbered.rawNumber}${first.numbered.suffix}`;
}

/** 一片区域里一个座位都没有（或只有一个）时的兜底座距。同画布编辑器的取值。 */
export const DEFAULT_SEAT_PITCH = 34;

/**
 * 一片座位的**典型座距**：每个座位到最近邻的距离，取中位数。
 *
 * 这是 h5 座位图整个呈现层唯一的输入量——圆点画多大、缩放到什么程度就该停止
 * 放大，全部由它派生。所以它跟着坐标一起从服务端发下去，h5 不重算。
 *
 * **这是 `apps/web/src/features/venue-editor/canvas/core/geometry.ts` 里同名函数
 * 的移植**，不是巧合的重复实现。两个前端之间不共享代码（AGENTS.md「代码结构」），
 * 而 h5 和管理端要对同一片座位得出同一个密度判断，否则同一个方案在两端会呈现成
 * 两种密度。放在服务端而不是 h5：这里已经解析了点集，也已经有测试装置。
 *
 * 取中位数而不是最小值：最小值会被任意一对贴得极近的座位一票否决，整片区域的
 * 呈现档位被两个异常点拖到最低。距离为 0 的重合座位直接跳过，同理。
 *
 * 用均匀网格求最近邻，期望 O(n)。格子边长按**长边**估、不按面积——一整排座位
 * （领导席、单排看台）的包围盒高度是 0，按面积算出来的格子会退化到接近 0，
 * 周围 8 格里一个邻居都找不到。这条是单排布局踩出来的。
 */
export function seatFieldPitch(points: readonly { x: number; y: number }[]) {
  if (points.length < 2) return DEFAULT_SEAT_PITCH;

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

  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const cell = Math.max(Number.EPSILON, extent / Math.sqrt(points.length));

  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const buckets = new Map<string, { x: number; y: number }[]>();
  for (const point of points) {
    const k = key(Math.floor(point.x / cell), Math.floor(point.y / cell));
    const bucket = buckets.get(k);
    if (bucket) bucket.push(point);
    else buckets.set(k, [point]);
  }

  const nearest: number[] = [];
  for (const point of points) {
    const cx = Math.floor(point.x / cell);
    const cy = Math.floor(point.y / cell);
    let best = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = buckets.get(key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const other of bucket) {
          const distance = Math.hypot(other.x - point.x, other.y - point.y);
          if (distance > 0 && distance < best) best = distance;
        }
      }
    }
    if (Number.isFinite(best)) nearest.push(best);
  }

  if (nearest.length === 0) return DEFAULT_SEAT_PITCH;
  nearest.sort((left, right) => left - right);
  const median = nearest[Math.floor(nearest.length / 2)];
  return median > 0 ? median : DEFAULT_SEAT_PITCH;
}

/** 多分区只读投影：不修改独立坐标，不向 H5 暴露其他人的编号。 */
export function parseSeatSections(
  data: unknown,
): { externalId: string; name: string; seatIds: string[] }[] {
  if (
    !isRecord(data) ||
    !Array.isArray(data.zones) ||
    !Array.isArray(data.seats)
  )
    return [];
  const seats = data.seats;
  return data.zones.flatMap((zone) => {
    if (
      !isRecord(zone) ||
      zone.isGroup ||
      typeof zone.externalId !== "string" ||
      typeof zone.name !== "string"
    )
      return [];
    return [
      {
        externalId: zone.externalId,
        name: zone.name,
        seatIds: seats.flatMap((seat) =>
          isRecord(seat) &&
          seat.zoneExternalId === zone.externalId &&
          typeof seat.externalId === "string"
            ? [seat.externalId]
            : [],
        ),
      },
    ];
  });
}
