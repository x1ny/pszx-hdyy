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
