import { describe, expect, test } from "bun:test";
import { activitySegment } from "../agenda/schema";
import { activity } from "../project/schema";
import {
  ensureActivityMembers,
  ensureProjectMembers,
  ensureSegmentMemberFromActivity,
  ensureSegmentMemberFromActivityWithOutcome,
  ensureSegmentMembers,
  type Tx,
} from "./ladder";
import { activityMember, member, projectMember, segmentMember } from "./schema";

type Row = Record<string, unknown>;

type FakeState = {
  members: Row[];
  activities: Row[];
  segments: Row[];
  projectMembers: Row[];
  activityMembers: Row[];
  segmentMembers: Row[];
};

const baseState = (organizationId: number | null): FakeState => ({
  members: [
    {
      id: 1,
      name: "测试人员",
      status: "enabled",
      organizationId,
    },
  ],
  activities: [{ id: 20, projectId: 10 }],
  segments: [
    {
      id: 30,
      activityId: 20,
      status: "active",
      memberEnabled: true,
    },
  ],
  projectMembers: [],
  activityMembers: [],
  segmentMembers: [],
});

const camelCase = (name: string) =>
  name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/**
 * ladder 的测试替身只实现它实际使用的 select/insert 形状。where 条件无需解释：
 * 每个用例只有一个人员、一个活动和一个环节，表里的行天然都属于目标范围。
 */
const fakeTx = (state: FakeState): Tx => {
  const rowsFor = (table: unknown): Row[] => {
    if (table === member) return state.members;
    if (table === activity) return state.activities;
    if (table === activitySegment) return state.segments;
    if (table === projectMember) return state.projectMembers;
    if (table === activityMember) return state.activityMembers;
    if (table === segmentMember) return state.segmentMembers;
    throw new Error("测试替身收到未知表");
  };

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

  const insertRows = (table: unknown, values: Row[]) => {
    const target = rowsFor(table);
    const inserted: Row[] = [];
    for (const value of values) {
      const conflict = target.some((row) => {
        if (table === projectMember) {
          return (
            row.projectId === value.projectId && row.memberId === value.memberId
          );
        }
        if (table === activityMember) {
          return (
            row.activityId === value.activityId &&
            row.memberId === value.memberId
          );
        }
        if (table === segmentMember) {
          return (
            row.segmentId === value.segmentId &&
            row.activityMemberId === value.activityMemberId
          );
        }
        return false;
      });

      if (!conflict) {
        const row = {
          ...value,
          id:
            typeof value.id === "number"
              ? value.id
              : Math.max(0, ...target.map((row) => Number(row.id ?? 0))) + 1,
        };
        target.push(row);
        inserted.push(row);
      }
    }
    return inserted;
  };

  const tx = {
    select(fields: Row) {
      return {
        from(table: unknown) {
          const rows = rowsFor(table).map((row) => project(fields, row));
          const query = Object.assign(Promise.resolve(rows), {
            where() {
              return query;
            },
            limit() {
              return query;
            },
          });
          return query;
        },
      };
    },
    insert(table: unknown) {
      return {
        values(input: Row | Row[]) {
          const values = Array.isArray(input) ? input : [input];
          return {
            onConflictDoNothing() {
              const inserted = insertRows(table, values);
              return Object.assign(Promise.resolve(), {
                returning(fields: Row) {
                  return Promise.resolve(
                    inserted.map((row) => project(fields, row)),
                  );
                },
              });
            },
          };
        },
      };
    },
  };

  return tx as unknown as Tx;
};

describe("member ladder organization snapshots", () => {
  test("主档换团体后再次 ensure 不改写已有项目快照", async () => {
    const state = baseState(7);
    const tx = fakeTx(state);

    await ensureProjectMembers(tx, {
      projectId: 10,
      memberIds: [1],
      sourceType: "manual",
      userId: "tester",
    });
    const current = state.members[0];
    if (!current) throw new Error("缺少测试人员");
    current.organizationId = 9;
    await ensureProjectMembers(tx, {
      projectId: 10,
      memberIds: [1],
      sourceType: "backfill_from_activity",
      userId: "tester",
    });

    expect(state.projectMembers).toHaveLength(1);
    expect(state.projectMembers[0]?.organizationId).toBe(7);
    expect(state.projectMembers[0]?.sourceType).toBe("manual");
  });

  test("从环节入口补齐三层时传播同一份当前团体快照", async () => {
    const state = baseState(7);

    await ensureSegmentMembers(fakeTx(state), {
      segmentId: 30,
      entries: [{ memberId: 1, segmentRole: "企业家嘉宾" }],
      originType: "manual",
      userId: "tester",
    });

    expect(state.projectMembers[0]?.organizationId).toBe(7);
    expect(state.activityMembers[0]?.organizationId).toBe(7);
    expect(state.segmentMembers[0]?.organizationId).toBe(7);
  });

  test("已有项目快照保留，后来新建的活动独立记录当前团体", async () => {
    const state = baseState(9);
    state.projectMembers.push({
      id: 1,
      projectId: 10,
      memberId: 1,
      organizationId: 7,
      sourceType: "manual",
    });

    await ensureActivityMembers(fakeTx(state), {
      activityId: 20,
      entries: [{ memberId: 1 }],
      originType: "manual",
      userId: "tester",
    });

    expect(state.projectMembers[0]?.organizationId).toBe(7);
    expect(state.activityMembers[0]?.organizationId).toBe(9);
  });

  test("已有活动快照优先于当前主档，新增环节继承活动历史", async () => {
    const state = baseState(9);
    state.projectMembers.push({
      id: 1,
      projectId: 10,
      memberId: 1,
      organizationId: 7,
      sourceType: "manual",
    });
    state.activityMembers.push({
      id: 1,
      activityId: 20,
      projectId: 10,
      projectMemberId: 1,
      memberId: 1,
      organizationId: 7,
      originType: "manual",
    });

    await ensureSegmentMembers(fakeTx(state), {
      segmentId: 30,
      entries: [{ memberId: 1 }],
      originType: "manual",
      userId: "tester",
    });

    expect(state.members[0]?.organizationId).toBe(9);
    expect(state.activityMembers[0]?.organizationId).toBe(7);
    expect(state.segmentMembers[0]?.organizationId).toBe(7);
  });

  test("从活动关系直建环节时继承快照，重复 ensure 不覆盖", async () => {
    const state = baseState(9);
    const tx = fakeTx(state);

    const id = await ensureSegmentMemberFromActivity(tx, {
      segmentId: 30,
      activityMember: {
        id: 1,
        activityId: 20,
        memberId: 1,
        organizationId: 7,
      },
      originType: "manual",
      userId: "tester",
    });
    await ensureSegmentMemberFromActivity(tx, {
      segmentId: 30,
      activityMember: {
        id: 1,
        activityId: 20,
        memberId: 1,
        organizationId: 9,
      },
      originType: "manual",
      userId: "tester",
    });

    expect(id).toBe(1);
    expect(state.segmentMembers).toHaveLength(1);
    expect(state.segmentMembers[0]?.organizationId).toBe(7);
  });

  test("从活动关系直建环节时区分本次补建和已有关系", async () => {
    const state = baseState(9);
    const tx = fakeTx(state);
    const input = {
      segmentId: 30,
      activityMember: {
        id: 1,
        activityId: 20,
        memberId: 1,
        organizationId: 7,
      },
      originType: "manual" as const,
      userId: "tester",
    };

    await expect(
      ensureSegmentMemberFromActivityWithOutcome(tx, input),
    ).resolves.toEqual({
      id: 1,
      created: true,
    });
    await expect(
      ensureSegmentMemberFromActivityWithOutcome(tx, input),
    ).resolves.toEqual({
      id: 1,
      created: false,
    });
  });

  test("旧 groupName 不会被当作团体快照", async () => {
    const state = baseState(null);

    await ensureSegmentMembers(fakeTx(state), {
      segmentId: 30,
      entries: [{ memberId: 1, groupName: "嘉宾组" }],
      originType: "manual",
      userId: "tester",
    });

    expect(state.projectMembers[0]?.organizationId).toBeNull();
    expect(state.activityMembers[0]?.organizationId).toBeNull();
    expect(state.segmentMembers[0]?.organizationId).toBeNull();
    expect(state.segmentMembers[0]?.groupName).toBe("嘉宾组");
  });
});
