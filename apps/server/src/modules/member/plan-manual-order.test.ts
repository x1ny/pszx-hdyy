import { describe, expect, test } from "bun:test";
import {
  type ManualOrderOperation,
  type ManualOrderRow,
  planManualOrder,
} from "./plan-manual-order";

const rows = (): ManualOrderRow[] => [
  { id: 3, order: 120, sortIndex: 1 },
  { id: 2, order: 99, sortIndex: 2 },
  { id: 1, order: 99, sortIndex: 1 },
];

const success = (
  rowsToPlan: readonly ManualOrderRow[],
  operation: ManualOrderOperation,
) => {
  const result = planManualOrder(rowsToPlan, operation);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result;
};

const changedRows = (
  input: readonly ManualOrderRow[],
  result: ReturnType<typeof success>,
) => {
  const updates = new Map(result.updates.map((update) => [update.id, update]));
  return input
    .map((row) => updates.get(row.id) ?? row)
    .sort((left, right) => {
      if (left.order !== right.order) {
        if (left.order === null) return 1;
        if (right.order === null) return -1;
        return left.order - right.order;
      }
      return left.sortIndex - right.sortIndex || left.id - right.id;
    });
};

describe("planManualOrder", () => {
  test("A01: moves C before B and only changes hidden positions in the target group", () => {
    const input = rows();
    const result = success(input, {
      type: "move",
      sourceId: 3,
      targetId: 2,
      placement: "before",
    });
    expect(changedRows(input, result)).toEqual([
      { id: 1, order: 99, sortIndex: 1 },
      { id: 3, order: 99, sortIndex: 2 },
      { id: 2, order: 99, sortIndex: 3 },
    ]);
  });

  test("A02-A08: fixed set and move behavior", () => {
    expect(
      success(rows(), { type: "set", sourceId: 3, order: 99 }),
    ).toMatchObject({
      orderedIds: [1, 2, 3],
      updates: [{ id: 3, order: 99, sortIndex: 3 }],
    });
    expect(
      success(rows(), { type: "set", sourceId: 1, order: 99 }).updates,
    ).toEqual([]);
    expect(
      success(rows(), {
        type: "move",
        sourceId: 2,
        targetId: 3,
        placement: "before",
      }).updates,
    ).toEqual([]);
    const movedAfterC = success(rows(), {
      type: "move",
      sourceId: 1,
      targetId: 3,
      placement: "after",
    });
    expect(changedRows(rows(), movedAfterC)).toEqual([
      { id: 2, order: 99, sortIndex: 2 },
      { id: 3, order: 120, sortIndex: 1 },
      { id: 1, order: 120, sortIndex: 2 },
    ]);
    expect(
      success(rows(), {
        type: "move",
        sourceId: 2,
        targetId: 1,
        placement: "before",
      }).orderedIds,
    ).toEqual([2, 1, 3]);
    expect(
      success(rows(), { type: "set", sourceId: 3, order: 100 }),
    ).toMatchObject({
      orderedIds: [1, 2, 3],
      updates: [{ id: 3, order: 100, sortIndex: 1 }],
    });
    expect(
      success(rows(), {
        type: "move",
        sourceId: 1,
        targetId: 1,
        placement: "before",
      }).updates,
    ).toEqual([]);
  });

  test("A09 and A12: rejects missing and invalid input without changing it", () => {
    const input = rows();
    const original = structuredClone(input);
    expect(
      planManualOrder(input, {
        type: "move",
        sourceId: 1,
        targetId: 9,
        placement: "before",
      }),
    ).toEqual({
      ok: false,
      reason: "TARGET_NOT_FOUND",
    });
    expect(
      planManualOrder(input, { type: "set", sourceId: 1, order: -1 }),
    ).toEqual({
      ok: false,
      reason: "INVALID_ORDER",
    });
    expect(
      planManualOrder([...input, { id: 1, order: 1, sortIndex: 1 }], {
        type: "set",
        sourceId: 1,
        order: 1,
      }),
    ).toEqual({
      ok: false,
      reason: "INVALID_ROWS",
    });
    expect(
      planManualOrder(input, { type: "set", sourceId: 9, order: 1 }),
    ).toEqual({
      ok: false,
      reason: "SOURCE_NOT_FOUND",
    });
    expect(input).toEqual(original);
  });

  test("A10: legacy identical positions use ID as the stable tie-breaker", () => {
    const input = [
      { id: 3, order: 99, sortIndex: 1 },
      { id: 2, order: 99, sortIndex: 1 },
      { id: 1, order: 99, sortIndex: 1 },
    ];
    const result = success(input, {
      type: "move",
      sourceId: 3,
      targetId: 1,
      placement: "before",
    });
    expect(result.orderedIds).toEqual([3, 1, 2]);
    expect(changedRows(input, result)).toEqual([
      { id: 3, order: 99, sortIndex: 1 },
      { id: 1, order: 99, sortIndex: 2 },
      { id: 2, order: 99, sortIndex: 3 },
    ]);
  });

  test("A11: reindexes a saturated target group before appending", () => {
    const input = [
      { id: 1, order: 10, sortIndex: 10 },
      { id: 2, order: 10, sortIndex: 2_147_483_647 },
      { id: 3, order: 20, sortIndex: 1 },
    ];
    const result = success(input, { type: "set", sourceId: 3, order: 10 });
    expect(changedRows(input, result)).toEqual([
      { id: 1, order: 10, sortIndex: 1 },
      { id: 2, order: 10, sortIndex: 2 },
      { id: 3, order: 10, sortIndex: 3 },
    ]);
  });

  test("未设置值排在明确数字之后，设置 0 可将行移到未设置组之前", () => {
    const input: ManualOrderRow[] = [
      { id: 1, order: null, sortIndex: 1 },
      { id: 2, order: null, sortIndex: 2 },
      { id: 3, order: null, sortIndex: 3 },
    ];
    const result = success(input, {
      type: "set",
      sourceId: 3,
      order: 0,
    });

    expect(result.orderedIds).toEqual([3, 1, 2]);
    expect(result.updates).toEqual([{ id: 3, order: 0, sortIndex: 1 }]);
    expect(changedRows(input, result)).toEqual([
      { id: 3, order: 0, sortIndex: 1 },
      { id: 1, order: null, sortIndex: 1 },
      { id: 2, order: null, sortIndex: 2 },
    ]);
  });

  test("清空数字会把记录追加回未设置组，并保留未设置组原顺序", () => {
    const input: ManualOrderRow[] = [
      { id: 1, order: 0, sortIndex: 1 },
      { id: 2, order: null, sortIndex: 1 },
      { id: 3, order: null, sortIndex: 2 },
    ];
    const result = success(input, {
      type: "set",
      sourceId: 1,
      order: null,
    });

    expect(result.orderedIds).toEqual([2, 3, 1]);
    expect(changedRows(input, result)).toEqual([
      { id: 2, order: null, sortIndex: 1 },
      { id: 3, order: null, sortIndex: 2 },
      { id: 1, order: null, sortIndex: 3 },
    ]);
  });

  test("small move enumeration matches an independent delete-and-insert model", () => {
    const input = [
      { id: 1, order: 1, sortIndex: 1 },
      { id: 2, order: 1, sortIndex: 2 },
      { id: 3, order: 2, sortIndex: 1 },
      { id: 4, order: 2, sortIndex: 2 },
    ];
    const original = structuredClone(input);

    for (const source of input) {
      for (const target of input) {
        for (const placement of ["before", "after"] as const) {
          const result = success(input, {
            type: "move",
            sourceId: source.id,
            targetId: target.id,
            placement,
          });
          const expected = input
            .slice()
            .sort(
              (left, right) =>
                left.order - right.order ||
                left.sortIndex - right.sortIndex ||
                left.id - right.id,
            )
            .map((row) => row.id);
          if (source.id !== target.id) {
            const sourceIndex = expected.indexOf(source.id);
            expected.splice(sourceIndex, 1);
            const targetIndex = expected.indexOf(target.id);
            expected.splice(
              targetIndex + (placement === "after" ? 1 : 0),
              0,
              source.id,
            );
          }
          expect(result.orderedIds).toEqual(expected);

          const finalRows = changedRows(input, result);
          expect(finalRows.map((row) => row.id)).toEqual(expected);
          expect(new Set(finalRows.map((row) => row.id)).size).toBe(
            input.length,
          );
          for (const row of finalRows) {
            if (row.id !== source.id) {
              const original = input.find(
                (candidate) => candidate.id === row.id,
              );
              if (!original) {
                throw new Error(`Missing original row ${row.id}`);
              }
              expect(row.order).toBe(original.order);
            }
          }
        }
      }
    }
    expect(input).toEqual(original);
  });
});
