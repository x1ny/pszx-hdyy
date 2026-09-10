const MAX_SORT_INDEX = 2_147_483_647;

export type ManualOrderRow = Readonly<{
  id: number;
  /** null means the user has not assigned a visible order value yet. */
  order: number | null;
  sortIndex: number;
}>;

export type ManualOrderOperation =
  | { type: "set"; sourceId: number; order: number | null }
  | {
      type: "move";
      sourceId: number;
      targetId: number;
      placement: "before" | "after";
    };

type ManualOrderUpdate = {
  id: number;
  order: number | null;
  sortIndex: number;
};

export type ManualOrderPlan =
  | { ok: true; orderedIds: number[]; updates: ManualOrderUpdate[] }
  | {
      ok: false;
      reason:
        | "INVALID_ROWS"
        | "INVALID_ORDER"
        | "SOURCE_NOT_FOUND"
        | "TARGET_NOT_FOUND"
        | "SORT_INDEX_EXHAUSTED";
    };

const compareNumbers = (left: number, right: number) =>
  left < right ? -1 : left > right ? 1 : 0;

const compareOrders = (left: number | null, right: number | null) => {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareNumbers(left, right);
};

const byManualOrder = (left: ManualOrderRow, right: ManualOrderRow) =>
  compareOrders(left.order, right.order) ||
  compareNumbers(left.sortIndex, right.sortIndex) ||
  compareNumbers(left.id, right.id);

const isValidRow = (row: ManualOrderRow | null | undefined) =>
  row !== null &&
  row !== undefined &&
  Number.isSafeInteger(row.id) &&
  row.id > 0 &&
  (row.order === null || (Number.isSafeInteger(row.order) && row.order >= 0)) &&
  Number.isInteger(row.sortIndex) &&
  row.sortIndex >= 0 &&
  row.sortIndex <= MAX_SORT_INDEX;

const hasChanged = (before: ManualOrderRow, after: ManualOrderRow) =>
  before.order !== after.order || before.sortIndex !== after.sortIndex;

const successfulPlan = (
  originalRows: readonly ManualOrderRow[],
  plannedRows: readonly ManualOrderRow[],
): ManualOrderPlan => {
  const originals = new Map(originalRows.map((row) => [row.id, row]));
  const updates = plannedRows
    .filter((row) => {
      const original = originals.get(row.id);
      return original !== undefined && hasChanged(original, row);
    })
    .map(({ id, order, sortIndex }) => ({ id, order, sortIndex }));

  return {
    ok: true,
    orderedIds: [...plannedRows].sort(byManualOrder).map((row) => row.id),
    updates,
  };
};

const noChange = (rows: readonly ManualOrderRow[]): ManualOrderPlan =>
  successfulPlan(rows, rows);

/**
 * Plans an order-only update for one complete, movable business range.
 * Callers remain responsible for validating business ownership and persisting
 * the returned differences in one transaction.
 */
export function planManualOrder(
  rows: readonly ManualOrderRow[],
  operation: ManualOrderOperation,
): ManualOrderPlan {
  const ids = new Set<number>();
  for (const row of rows) {
    if (!isValidRow(row) || ids.has(row.id)) {
      return { ok: false, reason: "INVALID_ROWS" };
    }
    ids.add(row.id);
  }

  const orderedRows = [...rows].sort(byManualOrder);
  const rowsById = new Map(orderedRows.map((row) => [row.id, row]));
  const source = rowsById.get(operation.sourceId);
  if (!source) {
    return { ok: false, reason: "SOURCE_NOT_FOUND" };
  }

  if (operation.type === "set") {
    if (
      operation.order !== null &&
      (!Number.isSafeInteger(operation.order) || operation.order < 0)
    ) {
      return { ok: false, reason: "INVALID_ORDER" };
    }
    if (source.order === operation.order) {
      return noChange(orderedRows);
    }

    const targetGroup = orderedRows.filter(
      (row) => row.order === operation.order,
    );
    const maxSortIndex = targetGroup.reduce(
      (max, row) => Math.max(max, row.sortIndex),
      0,
    );
    if (maxSortIndex < MAX_SORT_INDEX) {
      return successfulPlan(orderedRows, [
        ...orderedRows.filter((row) => row.id !== source.id),
        { ...source, order: operation.order, sortIndex: maxSortIndex + 1 },
      ]);
    }

    if (targetGroup.length >= MAX_SORT_INDEX) {
      return { ok: false, reason: "SORT_INDEX_EXHAUSTED" };
    }

    const targetIds = new Set(targetGroup.map((row) => row.id));
    return successfulPlan(
      orderedRows,
      orderedRows
        .filter((row) => !targetIds.has(row.id) && row.id !== source.id)
        .concat(
          targetGroup.map((row, index) => ({ ...row, sortIndex: index + 1 })),
          {
            ...source,
            order: operation.order,
            sortIndex: targetGroup.length + 1,
          },
        ),
    );
  }

  const target = rowsById.get(operation.targetId);
  if (!target) {
    return { ok: false, reason: "TARGET_NOT_FOUND" };
  }
  if (source.id === target.id) {
    return noChange(orderedRows);
  }

  const withoutSource = orderedRows.filter((row) => row.id !== source.id);
  const targetIndex = withoutSource.findIndex((row) => row.id === target.id);
  const insertionIndex =
    targetIndex + (operation.placement === "after" ? 1 : 0);
  const movedIds = withoutSource.map((row) => row.id);
  movedIds.splice(insertionIndex, 0, source.id);

  if (movedIds.every((id, index) => id === orderedRows[index]?.id)) {
    return noChange(orderedRows);
  }

  const targetOrder = target.order;
  const targetGroupIds = movedIds.filter(
    (id) => id === source.id || rowsById.get(id)?.order === targetOrder,
  );
  if (targetGroupIds.length > MAX_SORT_INDEX) {
    return { ok: false, reason: "SORT_INDEX_EXHAUSTED" };
  }

  const targetIndexById = new Map(
    targetGroupIds.map((id, index) => [id, index + 1]),
  );
  const plannedRows = orderedRows.map((row) => {
    if (row.id === source.id) {
      return {
        ...row,
        order: targetOrder,
        sortIndex: targetIndexById.get(row.id) as number,
      };
    }
    const sortIndex = targetIndexById.get(row.id);
    return sortIndex === undefined ? row : { ...row, sortIndex };
  });

  return successfulPlan(orderedRows, plannedRows);
}
