import type {
  SeatDraft,
  SeatKind,
  SeatRank,
  ZoneDraft,
  ZoneKind,
} from "./schema";

/**
 * 画布保存的归并计算。**纯函数，不碰数据库**——routes.ts 负责把算出来的
 * 增删改真正写下去。
 *
 * 拆出来是因为这是整个模块最容易写错、也最好测的一段：给定「库里现在有什么」
 * 和「编辑器这次投影出什么」，算出该插入、该更新、该删除的分别是哪些。
 * 它没有 I/O，所以能被单测彻底覆盖——docs/场地排位编辑器设计.md §5 里
 * 「未验证代码风险最高的部分要靠单测兜住」说的就是这类。
 */

// ---------------------------------------------------------------------------

/** 库里现存的区域行，只取归并要用到的列。 */
export type ZoneRow = {
  id: number;
  externalId: string;
  name: string;
  kind: ZoneKind;
  ordinal: number;
};

/** 库里现存的位置行。 */
export type SeatRow = {
  id: number;
  zoneId: number;
  externalId: string;
  label: string;
  kind: SeatKind;
  rank: SeatRank;
  ordinal: number;
};

/** 位置草稿在解析出 zoneId 之后的样子。 */
export type ResolvedSeatDraft = Omit<SeatDraft, "zoneExternalId"> & {
  zoneId: number;
};

export type MergePlan<TDraft> = {
  insert: TDraft[];
  update: { id: number; draft: TDraft }[];
  /** 要删掉的行 id。 */
  remove: number[];
};

// ---------------------------------------------------------------------------

/**
 * 按 `externalId` 三路归并。
 *
 * `update` 里**只放真正有字段变化的行**。不这么做的话，一次保存会对全部
 * 位置各发一条 UPDATE——1000 个座位就是 1000 条语句，而实际改动通常只有几个。
 */
function merge<
  TRow extends { id: number; externalId: string },
  TDraft extends { externalId: string },
>(
  rows: TRow[],
  drafts: TDraft[],
  changed: (row: TRow, draft: TDraft) => boolean,
): MergePlan<TDraft> {
  const byExternalId = new Map(rows.map((row) => [row.externalId, row]));

  const insert: TDraft[] = [];
  const update: { id: number; draft: TDraft }[] = [];
  const seen = new Set<string>();

  for (const draft of drafts) {
    seen.add(draft.externalId);
    const row = byExternalId.get(draft.externalId);
    if (!row) {
      insert.push(draft);
    } else if (changed(row, draft)) {
      update.push({ id: row.id, draft });
    }
  }

  const remove = rows
    .filter((row) => !seen.has(row.externalId))
    .map((row) => row.id);

  return { insert, update, remove };
}

export function planZones(
  rows: ZoneRow[],
  drafts: ZoneDraft[],
): MergePlan<ZoneDraft> {
  return merge(
    rows,
    drafts,
    (row, draft) =>
      row.name !== draft.name ||
      row.kind !== draft.kind ||
      row.ordinal !== draft.ordinal,
  );
}

export function planSeats(
  rows: SeatRow[],
  drafts: ResolvedSeatDraft[],
): MergePlan<ResolvedSeatDraft> {
  return merge(
    rows,
    drafts,
    (row, draft) =>
      // zoneId 也要比：把一个位置从 A 区拖到 B 区，externalId 不变、区域变了，
      // 这是一次更新而不是删了再建。
      row.zoneId !== draft.zoneId ||
      row.label !== draft.label ||
      row.kind !== draft.kind ||
      row.rank !== draft.rank ||
      row.ordinal !== draft.ordinal,
  );
}

/**
 * 把位置草稿上的 `zoneExternalId` 换成真正的 `zoneId`。
 *
 * 调用方必须先把区域归并完，才拿得到这份映射（新建的区域在插入之后才有 id）。
 * 映射里查不到就是入参自相矛盾——validation.ts 的 superRefine 已经挡过一道，
 * 这里返回 null 是给「校验和归并之间被人改了代码」留的兜底。
 */
export function resolveSeatZones(
  drafts: SeatDraft[],
  zoneIdByExternalId: Map<string, number>,
): ResolvedSeatDraft[] | null {
  const resolved: ResolvedSeatDraft[] = [];

  for (const { zoneExternalId, ...rest } of drafts) {
    const zoneId = zoneIdByExternalId.get(zoneExternalId);
    if (zoneId === undefined) return null;
    resolved.push({ ...rest, zoneId });
  }

  return resolved;
}
