import type { SeatKind, SeatRank } from "../venue/schema";

/**
 * 方案画布保存的归并计算。**纯函数，不碰数据库。**
 *
 * 跟 `venue/layout.ts` 是同一套三路归并，但多了一件场地库那边没有的事：
 * **有分配的位置不许消失，也不许被禁用**（底层设计 §5）。所以这里的产物除了
 * 增删改，还有一份 `blocked` 清单——只要它非空，整次保存就不落地。
 *
 * 为什么是"整次拒绝"而不是"级联解绑"：删座位在编辑器侧就是一次拖动或一次
 * 框选删除，用户很可能根本不知道那个位置上有人。把清单摆出来让他先去解绑
 * 再回来，是唯一不丢信息的路径。
 */

/** 库里现存的方案位置行。 */
export type PlanSeatRow = {
  id: number;
  externalId: string;
  label: string;
  kind: SeatKind;
  rank: SeatRank;
  enabled: boolean;
  ordinal: number;
};

/** 编辑器投影出来的方案位置。 */
export type PlanSeatDraft = {
  externalId: string;
  sourceExternalId?: string | null;
  label: string;
  kind: SeatKind;
  rank: SeatRank;
  enabled: boolean;
  ordinal: number;
};

/** 一条挡住保存的原因。`reason` 直接给前端展示，不再翻译一层。 */
export type BlockedSeat = {
  seatId: number;
  label: string;
  memberName: string;
  reason: "removed" | "disabled";
};

export type PlanMerge = {
  insert: PlanSeatDraft[];
  update: { id: number; draft: PlanSeatDraft }[];
  /** 软删（不是物理删——这些行被 seat_assignment 引用）。 */
  remove: number[];
  blocked: BlockedSeat[];
};

/**
 * @param rows      库里现存的、未软删的位置
 * @param drafts    这次投影出来的位置
 * @param occupied  座位 id → 占座人姓名。只包含**生效中**的分配
 */
export function planSeatMerge(
  rows: PlanSeatRow[],
  drafts: PlanSeatDraft[],
  occupied: Map<number, string>,
): PlanMerge {
  const byExternalId = new Map(rows.map((row) => [row.externalId, row]));

  const insert: PlanSeatDraft[] = [];
  const update: { id: number; draft: PlanSeatDraft }[] = [];
  const blocked: BlockedSeat[] = [];
  const seen = new Set<string>();

  for (const draft of drafts) {
    seen.add(draft.externalId);
    const row = byExternalId.get(draft.externalId);

    if (!row) {
      insert.push(draft);
      continue;
    }

    /**
     * 启用 → 禁用，且位置上有人：和删除同等处理。
     *
     * 漏了这条会出现一个很隐蔽的洞：A 座已分配、B 座空着，把 A 禁用之后
     * "启用位置数 1 ≥ 分配数 1"照样成立，人却实际坐在一个禁用位置上。
     */
    if (row.enabled && !draft.enabled) {
      const memberName = occupied.get(row.id);
      if (memberName) {
        blocked.push({
          seatId: row.id,
          label: row.label,
          memberName,
          reason: "disabled",
        });
        continue;
      }
    }

    if (
      row.label !== draft.label ||
      row.kind !== draft.kind ||
      row.rank !== draft.rank ||
      row.enabled !== draft.enabled ||
      row.ordinal !== draft.ordinal
    ) {
      update.push({ id: row.id, draft });
    }
  }

  const remove: number[] = [];
  for (const row of rows) {
    if (seen.has(row.externalId)) continue;
    const memberName = occupied.get(row.id);
    if (memberName) {
      blocked.push({
        seatId: row.id,
        label: row.label,
        memberName,
        reason: "removed",
      });
      continue;
    }
    remove.push(row.id);
  }

  return { insert, update, remove, blocked };
}

/**
 * 确认前的逐条校验。**不是比数量**——底层设计 §7 特别点了这条。
 *
 * 比数量（"启用位置数 ≥ 分配数"）会漏掉"人坐在一个已被禁用/已被软删的位置上"
 * 这种情况。唯一索引已经保证了一座一人、一人一座，剩下要查的就是每条生效分配
 * 指向的位置**此刻仍然有效**。
 */
export function findInvalidAssignments(
  assignments: { seatId: number; memberName: string }[],
  seatById: Map<number, { label: string; enabled: boolean; removed: boolean }>,
): BlockedSeat[] {
  const invalid: BlockedSeat[] = [];

  for (const assignment of assignments) {
    const seat = seatById.get(assignment.seatId);
    if (!seat || seat.removed) {
      invalid.push({
        seatId: assignment.seatId,
        label: seat?.label ?? `#${assignment.seatId}`,
        memberName: assignment.memberName,
        reason: "removed",
      });
      continue;
    }
    if (!seat.enabled) {
      invalid.push({
        seatId: assignment.seatId,
        label: seat.label,
        memberName: assignment.memberName,
        reason: "disabled",
      });
    }
  }

  return invalid;
}

/**
 * 这个状态还能不能被写。作废是终态，任何写操作都该被挡回去。
 *
 * 注意**没有** `statusAfterWrite()` 这种函数：任何写操作之后方案一律回到
 * `pending`，没有分支可算。状态机只认"发生了写操作"，不认写的是什么（§3.4）
 * ——`saveLayout` 和 `assign` 走的是同一条路，这正是它能在编辑器更换之后
 * 存活的原因。`version` 也不跟着动，它只在 confirm 时 +1。
 */
export function isWritable(status: string): boolean {
  return status !== "voided";
}
