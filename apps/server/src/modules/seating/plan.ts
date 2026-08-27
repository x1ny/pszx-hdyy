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
  /** 个人姓名或带“团体：”前缀的团体名称。字段名为兼容既有画布提示保留。 */
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
  assignments: { seatId: number; occupantName: string }[],
  seatById: Map<number, { label: string; enabled: boolean; removed: boolean }>,
): BlockedSeat[] {
  const invalid: BlockedSeat[] = [];

  for (const assignment of assignments) {
    const seat = seatById.get(assignment.seatId);
    if (!seat || seat.removed) {
      invalid.push({
        seatId: assignment.seatId,
        label: seat?.label ?? `#${assignment.seatId}`,
        memberName: assignment.occupantName,
        reason: "removed",
      });
      continue;
    }
    if (!seat.enabled) {
      invalid.push({
        seatId: assignment.seatId,
        label: seat.label,
        memberName: assignment.occupantName,
        reason: "disabled",
      });
    }
  }

  return invalid;
}

/**
 * 对调时只移动位置，完整保留占用对象字段。调用方已先保证 rows 只属于两个目标
 * 座位；只有一边有占用时，结果自然退化为把它移动到另一边。
 *
 * 个人和团体都走同一条规则：团体不展开为成员，个人目标也不会被改成团体目标。
 */
export function swapAssignmentSeats<T extends { seatId: number }>(
  rows: readonly T[],
  seatAId: number,
  seatBId: number,
): (T & { seatId: number })[] {
  return rows.map((row) => ({
    ...row,
    seatId: row.seatId === seatAId ? seatBId : seatAId,
  }));
}

/**
 * 团体的颜色槽固定为 12 格；只从团体主键推导，增删或改名都不会导致其他团体变色。
 * 色值由客户端色板按这个 index 取，不把展示色写入排位历史。
 */
export const ORGANIZATION_COLOR_PALETTE_SIZE = 12;

export function organizationColorIndex(organizationId: number): number {
  return (organizationId - 1) % ORGANIZATION_COLOR_PALETTE_SIZE;
}

export type OrganizationSeatSkipReason =
  | "notFound"
  | "removed"
  | "disabled"
  | "occupied";

export type OrganizationSeatAvailability = {
  seatId: number;
  status: "available" | OrganizationSeatSkipReason;
};

export type OrganizationSeatPreview = {
  availableSeatIds: number[];
  plannedSeatIds: number[];
  skipped: { seatId: number; reason: OrganizationSeatSkipReason }[];
  insufficient: number;
};

/**
 * 按调用方传入的位置顺序做团体占位预览。它只筛选，不改排位、不试图寻找相邻座位；
 * 因而同一输入在同一数据库快照下总会给出同一份计划。
 */
export function planOrganizationSeatAssignments(
  targetCount: number,
  seats: readonly OrganizationSeatAvailability[],
): OrganizationSeatPreview {
  if (targetCount < 0) {
    throw new RangeError("团体占位目标数不能为负数");
  }

  const availableSeatIds: number[] = [];
  const skipped: OrganizationSeatPreview["skipped"] = [];

  for (const seat of seats) {
    if (seat.status === "available") {
      availableSeatIds.push(seat.seatId);
    } else {
      skipped.push({ seatId: seat.seatId, reason: seat.status });
    }
  }

  const plannedSeatIds = availableSeatIds.slice(0, targetCount);
  return {
    availableSeatIds,
    plannedSeatIds,
    skipped,
    insufficient: Math.max(0, targetCount - plannedSeatIds.length),
  };
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
