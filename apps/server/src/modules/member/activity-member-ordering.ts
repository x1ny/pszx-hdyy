import { and, eq } from "drizzle-orm";
import type { Tx } from "./ladder";
import {
  type ManualOrderOperation,
  type ManualOrderRow,
  planManualOrder,
} from "./plan-manual-order";
import { activityMember } from "./schema";

const MAX_SORT_INDEX = 2_147_483_647;

type LoadedOrderRow = {
  id: number;
  activityId: number;
  sortOrder: number | null;
  sortIndex: number;
  updatedAt: Date;
  updatedBy: string | null;
};

export type ActivityMemberOrderPosition = {
  sortOrder: number | null;
  sortIndex: number;
};

export class ActivityMemberOrderingError extends Error {}

const fail = (message: string): never => {
  throw new ActivityMemberOrderingError(message);
};

const compareOrderRows = (
  left: Pick<ManualOrderRow, "id" | "order" | "sortIndex">,
  right: Pick<ManualOrderRow, "id" | "order" | "sortIndex">,
) => {
  if (left.order !== right.order) {
    if (left.order === null) return 1;
    if (right.order === null) return -1;
    return left.order - right.order;
  }
  return left.sortIndex - right.sortIndex || left.id - right.id;
};

const loadOrderRows = async (tx: Tx, activityId: number) => {
  const rows = await tx
    .select({
      id: activityMember.id,
      sortOrder: activityMember.sortOrder,
      sortIndex: activityMember.sortIndex,
      updatedAt: activityMember.updatedAt,
      updatedBy: activityMember.updatedBy,
    })
    .from(activityMember)
    .where(eq(activityMember.activityId, activityId));

  // Keep the fallback tolerant of old test fixtures. A null sortOrder is a
  // deliberate "not assigned" value and must not be collapsed to zero.
  return rows.map((row, index) => ({
    id: row.id,
    activityId,
    sortOrder: row.sortOrder ?? null,
    sortIndex: row.sortIndex ?? index + 1,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }));
};

const preserveAudit = (row: LoadedOrderRow) => ({
  ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
  ...(row.updatedBy === undefined ? {} : { updatedBy: row.updatedBy }),
});

const updateHiddenIndex = async (
  tx: Tx,
  row: LoadedOrderRow,
  sortIndex: number,
) => {
  if (row.sortIndex === sortIndex) return;

  await tx
    .update(activityMember)
    .set({ sortIndex, ...preserveAudit(row) })
    .where(
      and(
        eq(activityMember.id, row.id),
        eq(activityMember.activityId, row.activityId),
      ),
    );
};

/**
 * Reserves positions for newly inserted activity-member rows.
 * New rows always start with no visible order. They are appended to the
 * unassigned group, while preserving every existing row's audit fields.
 */
export async function allocateActivityMemberPositions(
  tx: Tx,
  activityId: number,
  count: number,
): Promise<ActivityMemberOrderPosition[]> {
  if (count <= 0) return [];

  const rows = await loadOrderRows(tx, activityId);
  const orderedRows = [...rows].sort((left, right) =>
    compareOrderRows(
      { id: left.id, order: left.sortOrder, sortIndex: left.sortIndex },
      { id: right.id, order: right.sortOrder, sortIndex: right.sortIndex },
    ),
  );
  const sortOrder = null;
  const targetGroup = orderedRows.filter((row) => row.sortOrder === sortOrder);
  if (targetGroup.length > MAX_SORT_INDEX - count) {
    fail("活动人员排序位置已达上限");
  }

  const maxSortIndex = targetGroup.reduce(
    (max, row) => Math.max(max, row.sortIndex),
    0,
  );
  if (maxSortIndex <= MAX_SORT_INDEX - count) {
    return Array.from({ length: count }, (_, index) => ({
      sortOrder,
      sortIndex: maxSortIndex + index + 1,
    }));
  }

  for (const [index, row] of targetGroup.entries()) {
    await updateHiddenIndex(tx, row, index + 1);
  }

  return Array.from({ length: count }, (_, index) => ({
    sortOrder,
    sortIndex: targetGroup.length + index + 1,
  }));
}

const messageForPlanFailure = (
  reason:
    | "INVALID_ROWS"
    | "INVALID_ORDER"
    | "SOURCE_NOT_FOUND"
    | "TARGET_NOT_FOUND"
    | "SORT_INDEX_EXHAUSTED",
) => {
  switch (reason) {
    case "SOURCE_NOT_FOUND":
      return "活动人员关系不存在或不属于该活动";
    case "TARGET_NOT_FOUND":
      return "目标活动人员关系不存在或不属于该活动";
    case "SORT_INDEX_EXHAUSTED":
      return "活动人员排序位置已达上限";
    case "INVALID_ORDER":
      return "排序值不正确";
    default:
      return "活动人员排序数据无效，请联系管理员";
  }
};

/** Plans and persists one activity-member ordering intent in its caller's transaction. */
export async function applyActivityMemberOrder(
  tx: Tx,
  input: {
    activityId: number;
    operation: ManualOrderOperation;
    userId: string;
  },
) {
  const rows = await loadOrderRows(tx, input.activityId);
  const manualRows: ManualOrderRow[] = rows.map(
    ({ id, sortOrder, sortIndex }) => ({
      id,
      order: sortOrder,
      sortIndex,
    }),
  );
  const plan = planManualOrder(manualRows, input.operation);
  if (!plan.ok) {
    throw new ActivityMemberOrderingError(messageForPlanFailure(plan.reason));
  }
  const successfulPlan = plan;

  if (successfulPlan.updates.length === 0) {
    const source = manualRows.find(
      (row) => row.id === input.operation.sourceId,
    );
    if (!source) {
      throw new ActivityMemberOrderingError("活动人员关系不存在或不属于该活动");
    }
    return { id: source.id, sortOrder: source.order, changed: false };
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  for (const update of successfulPlan.updates) {
    const original = rowsById.get(update.id);
    if (!original) {
      throw new ActivityMemberOrderingError(
        "活动人员排序数据无效，请联系管理员",
      );
    }

    const isSource = update.id === input.operation.sourceId;
    if (isSource) {
      await tx
        .update(activityMember)
        .set({
          sortOrder: update.order,
          sortIndex: update.sortIndex,
          updatedBy: input.userId,
        })
        .where(
          and(
            eq(activityMember.id, update.id),
            eq(activityMember.activityId, input.activityId),
          ),
        );
      continue;
    }

    await tx
      .update(activityMember)
      .set({
        sortOrder: update.order,
        sortIndex: update.sortIndex,
        ...preserveAudit(original),
      })
      .where(
        and(
          eq(activityMember.id, update.id),
          eq(activityMember.activityId, input.activityId),
        ),
      );
  }

  const source = manualRows.find((row) => row.id === input.operation.sourceId);
  if (!source) {
    throw new ActivityMemberOrderingError("活动人员关系不存在或不属于该活动");
  }
  const sourceUpdate = successfulPlan.updates.find(
    (update) => update.id === input.operation.sourceId,
  );
  return {
    id: source.id,
    sortOrder: sourceUpdate === undefined ? source.order : sourceUpdate.order,
    changed: true,
  };
}
