import {
  SEAT_KINDS,
  SEAT_RANKS,
  type SeatDraft,
  type SeatKind,
  type SeatRank,
  type VenueProjection,
  validateProjection,
  ZONE_KINDS,
  type ZoneDraft,
  type ZoneKind,
} from "../contract";

/**
 * `structural-v1`：表单式场地编辑器的文档模型。
 *
 * 它是最小的一个编辑器实现——**没有几何**，只有"这个场地有哪些区域、每个区域有
 * 哪些位置"。存在的理由有两个：
 *
 * 1. 很多场地本来就不需要画图。"主会场 A 区 120 座、洽谈区 36 个点位"这种
 *    描述已经足够支撑排位，画一张图纯属多余。
 * 2. 它同时充当降级视图。SVG 画布编辑器认不出某份 blob 时，页面退回到这套表单，
 *    照样能看能改——docs/场地排位底层设计.md §9 把"降级视图能用"定为整份
 *    可替换性设计的验收标准。
 *
 * 因为没有几何，它的 `project()` 就是恒等映射：文档本身即投影。这反而最干净地
 * 演示了契约的形状——`data` 里存什么由编辑器自己说了算，服务端不看。
 */

export type StructuralDoc = {
  schemaVersion: 1;
  zones: ZoneDraft[];
  seats: SeatDraft[];
};

// ---------------------------------------------------------------------------
// blob 解析
//
// ⚠️ 这里**故意不用 zod**，尽管仓库里到处都在用它。
//
// web 的测试脚本是 `bun --bun vitest run`（在 Bun 运行时下跑 vitest），而在这个
// 组合下 `import { z } from "zod"` 拿到的是 undefined——一个只有 `typeof z.enum`
// 断言的最小探针也一样失败。此前没人踩到，是因为现有 web 测试没有一个 import 过
// zod（路由文件里的 zod 都不在测试覆盖范围内）。
//
// 这个模块按 docs/场地排位编辑器设计.md §5 属于"必须 100% 单测覆盖"的第一档，
// 可测性压过用库。手写守卫对这个两层结构也就几十行，而且它本身就是纯函数、
// 能被测透。等 web 的测试运行时能吃 zod 了，这里可以换回去。
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

const isOrdinal = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isOneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T => typeof value === "string" && allowed.includes(value as T);

function parseZone(raw: unknown): ZoneDraft | null {
  if (!isRecord(raw)) return null;
  if (!isText(raw.externalId, 128)) return null;
  if (!isText(raw.name, 128)) return null;
  if (!isOneOf<ZoneKind>(raw.kind, ZONE_KINDS)) return null;
  if (!isOrdinal(raw.ordinal)) return null;

  return {
    externalId: raw.externalId,
    name: raw.name,
    kind: raw.kind,
    ordinal: raw.ordinal,
  };
}

function parseSeat(raw: unknown): SeatDraft | null {
  if (!isRecord(raw)) return null;
  if (!isText(raw.externalId, 128)) return null;
  if (!isText(raw.zoneExternalId, 128)) return null;
  if (!isText(raw.label, 64)) return null;
  if (!isOneOf<SeatKind>(raw.kind, SEAT_KINDS)) return null;
  if (!isOneOf<SeatRank>(raw.rank, SEAT_RANKS)) return null;
  if (!isOrdinal(raw.ordinal)) return null;

  return {
    externalId: raw.externalId,
    zoneExternalId: raw.zoneExternalId,
    label: raw.label,
    kind: raw.kind,
    rank: raw.rank,
    ordinal: raw.ordinal,
  };
}

/**
 * 解不出来返回 null，页面据此转降级视图。**任何一个元素不合法就整份判失败**，
 * 不做部分解析——静默丢掉几个座位比整份认不出来危险得多。
 */
export function parseStructuralDoc(raw: unknown): StructuralDoc | null {
  if (!isRecord(raw)) return null;
  if (raw.schemaVersion !== 1) return null;
  if (!Array.isArray(raw.zones) || !Array.isArray(raw.seats)) return null;

  const zones: ZoneDraft[] = [];
  for (const item of raw.zones) {
    const zone = parseZone(item);
    if (!zone) return null;
    zones.push(zone);
  }

  const seats: SeatDraft[] = [];
  for (const item of raw.seats) {
    const seat = parseSeat(item);
    if (!seat) return null;
    seats.push(seat);
  }

  return { schemaVersion: 1, zones, seats };
}

export const emptyDoc = (): StructuralDoc => ({
  schemaVersion: 1,
  zones: [],
  seats: [],
});

/** 恒等投影——文档本身就是核心语义，没有多余的呈现信息要剥掉。 */
export const projectStructural = (doc: StructuralDoc): VenueProjection => ({
  zones: doc.zones.map(
    ({ externalId: id, name, kind, ordinal }): ZoneDraft => ({
      externalId: id,
      name,
      kind,
      ordinal,
    }),
  ),
  seats: doc.seats.map(
    ({
      externalId: id,
      zoneExternalId,
      label,
      kind,
      rank,
      ordinal,
    }): SeatDraft => ({
      externalId: id,
      zoneExternalId,
      label,
      kind,
      rank,
      ordinal,
    }),
  ),
});

/**
 * 从服务端已有的区域/位置反推一份文档。
 *
 * 用在两处：老场地第一次用这个编辑器打开时（blob 是空的但结构已经在库里），
 * 以及 blob 解析失败退回降级视图时。核心表本身就够重建这个编辑器的全部状态——
 * 这正是"结构落成关系行、不只留在 blob 里"换来的东西。
 */
export const docFromProjection = (
  projection: VenueProjection,
): StructuralDoc => ({
  schemaVersion: 1,
  zones: projection.zones.map((zone) => ({ ...zone })),
  seats: projection.seats.map((seat) => ({ ...seat })),
});

/** 编辑器内新建元素用的 id。只要求"同一份文档内唯一 + 保存前后稳定"。 */
export const nextExternalId = (prefix: "z" | "s") =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// 保存前的自检
//
// 服务端会再校验一遍（那才是权威），这份只是让用户在点保存之前就看到问题，
// 而不是等一个 toast 弹出来。
// ---------------------------------------------------------------------------

export type DocIssue = { message: string };

/**
 * 规则本身在 `contract.ts` 的 `validateProjection` 里——两个编辑器共用一份，
 * 不各写各的。这里只是把它套在本编辑器的文档上（投影是恒等映射，所以直接传）。
 */
export const validateDoc = (doc: StructuralDoc): DocIssue[] =>
  validateProjection(projectStructural(doc)).map((message) => ({ message }));

/**
 * 按数量批量生成位置。
 *
 * 这是这个编辑器唯一的"生成"能力，也是它够用的关键：录一个 120 座的区域，
 * 不该让人点 120 次。前缀 + 起始序号 + 数量，编号形如 `A1`…`A120`。
 * 画布编辑器将来的 9 种布局预设是这件事的图形版本。
 */
export function generateSeats(input: {
  zoneExternalId: string;
  prefix: string;
  start: number;
  count: number;
  kind: SeatDraft["kind"];
  rank: SeatDraft["rank"];
  existing: SeatDraft[];
}): SeatDraft[] {
  const taken = new Set(
    input.existing
      .filter((seat) => seat.zoneExternalId === input.zoneExternalId)
      .map((seat) => seat.label),
  );
  const baseOrdinal = input.existing.length;

  const created: SeatDraft[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const label = `${input.prefix}${input.start + index}`;
    // 撞号就跳过而不是报错：用户想在已有 A1–A10 的区域里补到 A20，
    // 让他填 1–20 也应该正常工作。
    if (taken.has(label)) continue;
    taken.add(label);
    created.push({
      externalId: nextExternalId("s"),
      zoneExternalId: input.zoneExternalId,
      label,
      kind: input.kind,
      rank: input.rank,
      ordinal: baseOrdinal + created.length,
    });
  }

  return created;
}
