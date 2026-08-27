import { describe, expect, test } from "bun:test";
import { activitySegment } from "../agenda/schema";
import { activity, project } from "../project/schema";
import {
  addActivityMembersByOrganization,
  addProjectMembersByOrganization,
  addSegmentMembersByOrganization,
  MemberLadderError,
  planOrganizationBatch,
  type Tx,
} from "./ladder";
import { activityMember, member, projectMember, segmentMember } from "./schema";

type Row = Record<string, unknown>;

type FakeState = {
  members: Row[];
  projects: Row[];
  activities: Row[];
  segments: Row[];
  projectMembers: Row[];
  activityMembers: Row[];
  segmentMembers: Row[];
};

const baseState = (): FakeState => ({
  members: [
    { id: 1, name: "甲", status: "enabled", organizationId: 7 },
    { id: 2, name: "乙", status: "enabled", organizationId: 7 },
  ],
  projects: [{ id: 10 }],
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
 * 只实现 organization batch 使用的 Drizzle 链。每个用例只有一组项目/活动/环节，
 * 所以 where 无需解释；所有关系行天然都属于被测范围，更新也只碰 null 快照。
 */
const fakeTx = (
  state: FakeState,
  options: { failOnInsert?: unknown } = {},
): Tx => {
  const rowsFor = (table: unknown): Row[] => {
    if (table === member) return state.members;
    if (table === project) return state.projects;
    if (table === activity) return state.activities;
    if (table === activitySegment) return state.segments;
    if (table === projectMember) return state.projectMembers;
    if (table === activityMember) return state.activityMembers;
    if (table === segmentMember) return state.segmentMembers;
    throw new Error("测试替身收到未知表");
  };

  const projectFields = (fields: Row, row: Row): Row =>
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
    if (options.failOnInsert === table) throw new Error("模拟写入失败");
    const target = rowsFor(table);
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
        target.push({
          ...value,
          id: Math.max(0, ...target.map((row) => Number(row.id ?? 0))) + 1,
        });
      }
    }
  };

  const tx = {
    select(fields: Row) {
      return {
        from(table: unknown) {
          const rows = rowsFor(table).map((row) => projectFields(fields, row));
          const query = Object.assign(Promise.resolve(rows), {
            where() {
              return query;
            },
            orderBy() {
              return query;
            },
            limit() {
              return query;
            },
            for() {
              return query;
            },
          });
          return query;
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Row) {
          return {
            async where() {
              for (const row of rowsFor(table)) {
                if (row.organizationId === null) Object.assign(row, values);
              }
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(input: Row | Row[]) {
          const values = Array.isArray(input) ? input : [input];
          return {
            async onConflictDoNothing() {
              insertRows(table, values);
            },
          };
        },
      };
    },
  };

  return tx as unknown as Tx;
};

/** 模拟 db.transaction 的 copy-on-write：回调抛错时草稿不会写回原状态。 */
const inTransaction = async <T>(
  state: FakeState,
  work: (tx: Tx) => Promise<T>,
  options: { failOnInsert?: unknown } = {},
): Promise<T> => {
  const draft = structuredClone(state);
  const result = await work(fakeTx(draft, options));
  Object.assign(state, draft);
  return result;
};

describe("按团体添加预检计划", () => {
  test("added/existing/skipped 按人员互斥，conflict 按关系计数", () => {
    const plan = planOrganizationBatch({
      organizationId: 7,
      targetLayer: "activity",
      members: [
        { id: 1, name: "甲" },
        { id: 2, name: "乙" },
        { id: 3, name: "丙" },
      ],
      relations: {
        project: [
          { id: 11, memberId: 1, organizationId: 7 },
          { id: 12, memberId: 2, organizationId: null },
          { id: 13, memberId: 3, organizationId: 8 },
        ],
        activity: [
          { id: 22, memberId: 2, organizationId: null },
          { id: 23, memberId: 3, organizationId: 9 },
        ],
      },
    });

    expect(plan.result).toMatchObject({
      added: 1,
      existing: 1,
      conflict: 2,
      skipped: 1,
    });
    expect(plan.result.added + plan.result.existing + plan.result.skipped).toBe(
      3,
    );
    expect(plan.result.items[1]).toMatchObject({
      memberId: 2,
      outcome: "existing",
      filledLayers: ["project", "activity"],
    });
    expect(plan.result.items[2]).toMatchObject({
      memberId: 3,
      outcome: "skipped",
      filledLayers: [],
      conflicts: [
        { layer: "project", existingOrganizationId: 8 },
        { layer: "activity", existingOrganizationId: 9 },
      ],
    });
    expect(plan.eligibleMemberIds).toEqual([1, 2]);
  });
});

describe("按团体添加 ladder", () => {
  test("环节入口对新目标补齐上层，并逐层补记已有 null 快照", async () => {
    const state = baseState();
    state.projectMembers.push(
      { id: 11, projectId: 10, memberId: 1, organizationId: null },
      { id: 12, projectId: 10, memberId: 2, organizationId: null },
    );
    state.activityMembers.push(
      {
        id: 21,
        activityId: 20,
        projectId: 10,
        projectMemberId: 11,
        memberId: 1,
        organizationId: null,
      },
      {
        id: 22,
        activityId: 20,
        projectId: 10,
        projectMemberId: 12,
        memberId: 2,
        organizationId: null,
      },
    );
    state.segmentMembers.push({
      id: 31,
      segmentId: 30,
      activityId: 20,
      activityMemberId: 22,
      memberId: 2,
      organizationId: null,
    });

    const result = await inTransaction(state, (tx) =>
      addSegmentMembersByOrganization(tx, {
        segmentId: 30,
        organizationId: 7,
        memberIds: [1, 2],
        userId: "tester",
      }),
    );

    expect(result).toMatchObject({
      added: 1,
      existing: 1,
      conflict: 0,
      skipped: 0,
    });
    expect(result.items[0]?.filledLayers).toEqual(["project", "activity"]);
    expect(result.items[1]?.filledLayers).toEqual([
      "project",
      "activity",
      "segment",
    ]);
    expect(state.projectMembers.map((row) => row.organizationId)).toEqual([
      7, 7,
    ]);
    expect(state.activityMembers.map((row) => row.organizationId)).toEqual([
      7, 7,
    ]);
    expect(state.segmentMembers.map((row) => row.organizationId)).toEqual([
      7, 7,
    ]);
  });

  test("上层异团体时跳过该人员整条链，其他人员仍成功", async () => {
    const state = baseState();
    state.projectMembers.push({
      id: 11,
      projectId: 10,
      memberId: 1,
      organizationId: 8,
    });

    const result = await inTransaction(state, (tx) =>
      addActivityMembersByOrganization(tx, {
        activityId: 20,
        organizationId: 7,
        memberIds: [1, 2],
        userId: "tester",
      }),
    );

    expect(result).toMatchObject({
      added: 1,
      existing: 0,
      conflict: 1,
      skipped: 1,
    });
    expect(
      state.projectMembers.find((row) => row.memberId === 1),
    ).toMatchObject({ organizationId: 8 });
    expect(state.activityMembers.some((row) => row.memberId === 1)).toBe(false);
    expect(
      state.projectMembers.find((row) => row.memberId === 2),
    ).toMatchObject({ organizationId: 7 });
    expect(
      state.activityMembers.find((row) => row.memberId === 2),
    ).toMatchObject({ organizationId: 7 });
  });

  test("旧 null 项目快照可明确补记且目标层仍计 existing", async () => {
    const state = baseState();
    state.members = [state.members[0] as Row];
    state.projectMembers.push({
      id: 11,
      projectId: 10,
      memberId: 1,
      organizationId: null,
      sourceType: "manual",
    });

    const result = await inTransaction(state, (tx) =>
      addProjectMembersByOrganization(tx, {
        projectId: 10,
        organizationId: 7,
        memberIds: [1],
        userId: "tester",
      }),
    );

    expect(result).toMatchObject({ added: 0, existing: 1, skipped: 0 });
    expect(result.items[0]?.filledLayers).toEqual(["project"]);
    expect(state.projectMembers).toHaveLength(1);
    expect(state.projectMembers[0]).toMatchObject({
      organizationId: 7,
      sourceType: "manual",
    });
  });
});

describe("按团体添加事务原子性", () => {
  test.each([
    {
      name: "人员不存在",
      mutate: (state: FakeState) => {
        state.members = [state.members[0] as Row];
      },
      memberIds: [1, 2],
      message: "不存在",
    },
    {
      name: "人员已停用",
      mutate: (state: FakeState) => {
        const row = state.members[1];
        if (row) row.status = "disabled";
      },
      memberIds: [1, 2],
      message: "已禁用",
    },
    {
      name: "人员提交时已换团体",
      mutate: (state: FakeState) => {
        const row = state.members[1];
        if (row) row.organizationId = 8;
      },
      memberIds: [1, 2],
      message: "已不属于所选团体",
    },
  ])("$name 时整批零写", async ({ mutate, memberIds, message }) => {
    const state = baseState();
    mutate(state);

    const promise = inTransaction(state, (tx) =>
      addActivityMembersByOrganization(tx, {
        activityId: 20,
        organizationId: 7,
        memberIds,
        userId: "tester",
      }),
    );

    expect(promise).rejects.toBeInstanceOf(MemberLadderError);
    expect(promise).rejects.toThrow(message);
    await promise.catch(() => undefined);
    expect(state.projectMembers).toEqual([]);
    expect(state.activityMembers).toEqual([]);
  });

  test.each([
    { status: "voided", memberEnabled: true, message: "已作废" },
    { status: "active", memberEnabled: false, message: "未开启" },
  ])("环节不可用时整批零写", async (segmentState) => {
    const state = baseState();
    const segment = state.segments[0];
    if (!segment) throw new Error("缺少测试环节");
    Object.assign(segment, segmentState);

    const promise = inTransaction(state, (tx) =>
      addSegmentMembersByOrganization(tx, {
        segmentId: 30,
        organizationId: 7,
        memberIds: [1],
        userId: "tester",
      }),
    );

    expect(promise).rejects.toThrow(segmentState.message);
    await promise.catch(() => undefined);
    expect(state.projectMembers).toEqual([]);
    expect(state.activityMembers).toEqual([]);
    expect(state.segmentMembers).toEqual([]);
  });

  test("下层写入失败时回滚已经补建的上层", async () => {
    const state = baseState();
    state.members = [state.members[0] as Row];

    const promise = inTransaction(
      state,
      (tx) =>
        addActivityMembersByOrganization(tx, {
          activityId: 20,
          organizationId: 7,
          memberIds: [1],
          userId: "tester",
        }),
      { failOnInsert: activityMember },
    );

    expect(promise).rejects.toThrow("模拟写入失败");
    await promise.catch(() => undefined);
    expect(state.projectMembers).toEqual([]);
    expect(state.activityMembers).toEqual([]);
  });
});
