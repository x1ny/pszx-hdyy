import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  ActivityMemberOrderingError,
  allocateActivityMemberPositions,
  applyActivityMemberOrder,
} from "./activity-member-ordering";
import type { Tx } from "./ladder";
import { activityMemberRoutes } from "./routes.relation";
import { activityMember } from "./schema";
import {
  MoveActivityMemberInput,
  SetActivityMemberOrderInput,
} from "./validation";

type Row = Record<string, unknown>;

type FakeState = {
  activityMembers: Row[];
  updates: Array<{ ids: number[]; values: Row }>;
};

const dialect = new PgDialect();

const camelCase = (name: string) =>
  name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

const project = (fields: Row, row: Row): Row =>
  Object.fromEntries(
    Object.entries(fields).map(([alias, column]) => {
      if (
        typeof column !== "object" ||
        column === null ||
        !("name" in column) ||
        typeof column.name !== "string"
      ) {
        throw new Error(`测试替身无法投影 ${alias}`);
      }
      return [alias, row[camelCase(column.name)]];
    }),
  );

const compile = (condition: SQL | undefined) =>
  condition ? dialect.sqlToQuery(condition) : { sql: "", params: [] };

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const equalityValue = (
  sql: string,
  params: unknown[],
  column: string,
): unknown => {
  const match = sql.match(new RegExp(`${escaped(column)} = \\$(\\d+)`));
  return match ? params[Number(match[1]) - 1] : undefined;
};

const filterRows = (rows: Row[], condition?: SQL) => {
  const { sql, params } = compile(condition);
  const activityId = equalityValue(
    sql,
    params,
    '"activity_member"."activity_id"',
  );
  const id = equalityValue(sql, params, '"activity_member"."id"');

  return rows.filter(
    (row) =>
      (activityId === undefined || row.activityId === activityId) &&
      (id === undefined || row.id === id),
  );
};

const fakeTx = (state: FakeState): Tx => {
  const tx = {
    select(fields: Row) {
      return {
        from(table: unknown) {
          if (table !== activityMember) throw new Error("测试替身收到未知表");
          return {
            where(condition: SQL) {
              return Promise.resolve(
                filterRows(state.activityMembers, condition).map((row) =>
                  project(fields, row),
                ),
              );
            },
          };
        },
      };
    },
    update(table: unknown) {
      if (table !== activityMember) throw new Error("测试替身收到未知表");
      return {
        set(values: Row) {
          return {
            async where(condition: SQL) {
              const rows = filterRows(state.activityMembers, condition);
              state.updates.push({
                ids: rows.map((row) => row.id as number),
                values,
              });
              for (const row of rows) Object.assign(row, values);
            },
          };
        },
      };
    },
  };

  return tx as unknown as Tx;
};

const row = (
  id: number,
  activityId: number,
  sortOrder: number | null,
  sortIndex: number,
): Row => ({
  id,
  activityId,
  sortOrder,
  sortIndex,
  updatedAt: new Date(Date.UTC(2026, 8, 10, 0, 0, id)),
  updatedBy: `old-${id}`,
});

const stateWithRows = (activityMembers: Row[]): FakeState => ({
  activityMembers,
  updates: [],
});

describe("活动人员排序输入与路由", () => {
  test("校验可见排序边界，不接受隐藏位置作为输入", () => {
    expect(
      SetActivityMemberOrderInput.parse({
        activityId: 1,
        id: 2,
        sortOrder: 2_147_483_647,
      }),
    ).toEqual({ activityId: 1, id: 2, sortOrder: 2_147_483_647 });
    expect(
      SetActivityMemberOrderInput.parse({
        activityId: 1,
        id: 2,
        sortOrder: null,
      }),
    ).toEqual({ activityId: 1, id: 2, sortOrder: null });
    expect(
      SetActivityMemberOrderInput.safeParse({
        activityId: 1,
        id: 2,
        sortOrder: 2_147_483_648,
      }).success,
    ).toBe(false);
    expect(
      SetActivityMemberOrderInput.parse({
        activityId: 1,
        id: 2,
        sortOrder: 3,
        sortIndex: 99,
      }),
    ).not.toHaveProperty("sortIndex");
    expect(
      MoveActivityMemberInput.safeParse({
        activityId: 1,
        id: 2,
        targetId: 3,
        placement: "sideways",
      }).success,
    ).toBe(false);
  });

  test("注册固定的 setOrder 与 move POST 动作", () => {
    const paths = activityMemberRoutes.routes
      .filter((route) => route.method === "POST")
      .map((route) => route.path);
    expect(paths).toContain("/setOrder");
    expect(paths).toContain("/move");
  });
});

describe("活动人员排序事务编排", () => {
  test("设置数字只更新源行，并将它追加到目标同值组末尾", async () => {
    const state = stateWithRows([
      row(1, 20, 99, 1),
      row(2, 20, 99, 2),
      row(3, 20, 120, 1),
      row(90, 21, 1, 1),
    ]);

    await expect(
      applyActivityMemberOrder(fakeTx(state), {
        activityId: 20,
        operation: { type: "set", sourceId: 3, order: 99 },
        userId: "operator",
      }),
    ).resolves.toEqual({ id: 3, sortOrder: 99, changed: true });

    expect(state.activityMembers.find((item) => item.id === 3)).toMatchObject({
      sortOrder: 99,
      sortIndex: 3,
      updatedBy: "operator",
    });
    expect(state.activityMembers.find((item) => item.id === 2)).toMatchObject({
      sortOrder: 99,
      sortIndex: 2,
      updatedBy: "old-2",
    });
    expect(state.activityMembers.find((item) => item.id === 90)).toMatchObject({
      activityId: 21,
      sortOrder: 1,
      sortIndex: 1,
    });
    expect(state.updates).toHaveLength(1);
  });

  test("移动时完整读取活动范围，邻居保留审计字段，跨活动目标被拒绝", async () => {
    const state = stateWithRows([
      row(1, 20, 99, 1),
      row(2, 20, 99, 2),
      row(3, 20, 120, 1),
      row(90, 21, 1, 1),
    ]);
    const sourceAudit = state.activityMembers.find((item) => item.id === 3);
    const neighborAudit = state.activityMembers.find((item) => item.id === 2);
    if (!sourceAudit || !neighborAudit) throw new Error("缺少测试行");

    await expect(
      applyActivityMemberOrder(fakeTx(state), {
        activityId: 20,
        operation: {
          type: "move",
          sourceId: 3,
          targetId: 2,
          placement: "before",
        },
        userId: "operator",
      }),
    ).resolves.toEqual({ id: 3, sortOrder: 99, changed: true });
    expect(state.activityMembers.find((item) => item.id === 3)).toMatchObject({
      sortOrder: 99,
      sortIndex: 2,
      updatedBy: "operator",
    });
    expect(state.activityMembers.find((item) => item.id === 2)).toMatchObject({
      sortOrder: 99,
      sortIndex: 3,
      updatedAt: neighborAudit.updatedAt,
      updatedBy: neighborAudit.updatedBy,
    });
    expect(state.updates).toHaveLength(2);

    const snapshot = structuredClone(state.activityMembers);
    await expect(
      applyActivityMemberOrder(fakeTx(state), {
        activityId: 20,
        operation: {
          type: "move",
          sourceId: 1,
          targetId: 90,
          placement: "before",
        },
        userId: "operator",
      }),
    ).rejects.toBeInstanceOf(ActivityMemberOrderingError);
    expect(state.activityMembers).toEqual(snapshot);
    expect(state.updates).toHaveLength(2);
    expect(sourceAudit.updatedBy).toBe("operator");
  });

  test("同值 set 是零写入，新增位置取完整范围末尾", async () => {
    const state = stateWithRows([
      row(1, 20, 99, 1),
      row(2, 20, 120, 5),
      row(90, 21, 1, 1),
    ]);
    await expect(
      applyActivityMemberOrder(fakeTx(state), {
        activityId: 20,
        operation: { type: "set", sourceId: 1, order: 99 },
        userId: "operator",
      }),
    ).resolves.toEqual({ id: 1, sortOrder: 99, changed: false });
    expect(state.updates).toHaveLength(0);

    await expect(
      allocateActivityMemberPositions(fakeTx(state), 20, 2),
    ).resolves.toEqual([
      { sortOrder: null, sortIndex: 1 },
      { sortOrder: null, sortIndex: 2 },
    ]);
    expect(state.updates).toHaveLength(0);
  });

  test("未设置排序值使用 null，新增关系追加到未设置组末尾", async () => {
    const state = stateWithRows([
      row(1, 20, null, 1),
      row(2, 20, null, 4),
      row(90, 21, 1, 1),
    ]);

    await expect(
      applyActivityMemberOrder(fakeTx(state), {
        activityId: 20,
        operation: { type: "set", sourceId: 1, order: 0 },
        userId: "operator",
      }),
    ).resolves.toEqual({ id: 1, sortOrder: 0, changed: true });
    expect(state.activityMembers.find((item) => item.id === 1)).toMatchObject({
      sortOrder: 0,
      sortIndex: 1,
      updatedBy: "operator",
    });

    expect(await allocateActivityMemberPositions(fakeTx(state), 20, 2)).toEqual(
      [
        { sortOrder: null, sortIndex: 5 },
        { sortOrder: null, sortIndex: 6 },
      ],
    );
  });

  test("清空排序值会回到未设置组末尾", async () => {
    const state = stateWithRows([
      row(1, 20, 0, 1),
      row(2, 20, null, 1),
      row(3, 20, null, 2),
    ]);

    await expect(
      applyActivityMemberOrder(fakeTx(state), {
        activityId: 20,
        operation: { type: "set", sourceId: 1, order: null },
        userId: "operator",
      }),
    ).resolves.toEqual({ id: 1, sortOrder: null, changed: true });
    expect(state.activityMembers.find((item) => item.id === 1)).toMatchObject({
      sortOrder: null,
      sortIndex: 3,
      updatedBy: "operator",
    });
    expect(state.updates).toHaveLength(1);
  });
});
