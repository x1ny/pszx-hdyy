import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { activitySegment } from "../agenda/schema";
import { seatAssignment, segmentSeat } from "../seating/schema";
import { memberTrip } from "../trip/schema";
import type { Tx } from "./ladder";
import {
  ActivityMemberSegmentSyncError,
  syncActivityMemberSegments,
} from "./participation";
import { activityMember, segmentMember } from "./schema";

type Row = Record<string, unknown>;

type FakeState = {
  activityMembers: Row[];
  segments: Row[];
  segmentMembers: Row[];
  assignments: Row[];
  seats: Row[];
  trips: Row[];
};

type FakeSelectQuery = Promise<Row[]> & {
  where: (condition: SQL) => FakeSelectQuery;
  innerJoin: () => FakeSelectQuery;
  orderBy: () => FakeSelectQuery;
  for: () => FakeSelectQuery;
  limit: () => FakeSelectQuery;
};

const baseState = (): FakeState => ({
  activityMembers: [{ id: 10, activityId: 20, memberId: 1, organizationId: 7 }],
  segments: [
    {
      id: 31,
      activityId: 20,
      name: "开幕式",
      status: "active",
      memberEnabled: true,
      startTime: new Date("2026-09-01T08:00:00Z"),
    },
    {
      id: 32,
      activityId: 20,
      name: "主论坛",
      status: "active",
      memberEnabled: true,
      startTime: new Date("2026-09-01T09:00:00Z"),
    },
    {
      id: 33,
      activityId: 20,
      name: "圆桌会",
      status: "active",
      memberEnabled: true,
      startTime: new Date("2026-09-01T10:00:00Z"),
    },
    {
      id: 34,
      activityId: 20,
      name: "历史环节",
      status: "voided",
      memberEnabled: true,
      startTime: new Date("2026-08-31T08:00:00Z"),
    },
    {
      id: 35,
      activityId: 20,
      name: "关闭人员管理",
      status: "active",
      memberEnabled: false,
      startTime: new Date("2026-08-31T09:00:00Z"),
    },
    {
      id: 99,
      activityId: 21,
      name: "其他活动环节",
      status: "active",
      memberEnabled: true,
      startTime: new Date("2026-09-02T08:00:00Z"),
    },
  ],
  segmentMembers: [],
  assignments: [],
  seats: [],
  trips: [],
});

const camelCase = (name: string) =>
  name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

const dialect = new PgDialect();

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

const inValues = (
  sql: string,
  params: unknown[],
  column: string,
): unknown[] => {
  const match = sql.match(new RegExp(`${escaped(column)} in \\(([^)]+)\\)`));
  if (!match) return [];
  return [...match[1].matchAll(/\$(\d+)/g)].map(
    (placeholder) => params[Number(placeholder[1]) - 1],
  );
};

const filterRows = (table: unknown, rows: Row[], condition?: SQL): Row[] => {
  const { sql, params } = compile(condition);
  if (!sql) return rows;

  if (table === activityMember) {
    const id = equalityValue(sql, params, '"activity_member"."id"');
    return id === undefined ? rows : rows.filter((row) => row.id === id);
  }

  if (table === activitySegment) {
    const ids = inValues(sql, params, '"activity_segment"."id"');
    return ids.length === 0 ? rows : rows.filter((row) => ids.includes(row.id));
  }

  if (table === segmentMember) {
    const idValues = inValues(sql, params, '"segment_member"."id"');
    const segmentIds = inValues(sql, params, '"segment_member"."segment_id"');
    const organizationIds = inValues(
      sql,
      params,
      '"segment_member"."organization_id"',
    );
    const activityMemberId = equalityValue(
      sql,
      params,
      '"segment_member"."activity_member_id"',
    );
    const segmentId = equalityValue(
      sql,
      params,
      '"segment_member"."segment_id"',
    );
    const wantsOrganization = sql.includes(
      '"segment_member"."organization_id" is not null',
    );
    return rows.filter(
      (row) =>
        (idValues.length === 0 || idValues.includes(row.id)) &&
        (segmentIds.length === 0 || segmentIds.includes(row.segmentId)) &&
        (organizationIds.length === 0 ||
          organizationIds.includes(row.organizationId)) &&
        (!wantsOrganization || row.organizationId != null) &&
        (activityMemberId === undefined ||
          row.activityMemberId === activityMemberId) &&
        (segmentId === undefined || row.segmentId === segmentId),
    );
  }

  if (table === seatAssignment) {
    const memberIds = inValues(
      sql,
      params,
      '"seat_assignment"."segment_member_id"',
    );
    const occupantType = equalityValue(
      sql,
      params,
      '"seat_assignment"."occupant_type"',
    );
    const segmentIds = inValues(sql, params, '"seat_assignment"."segment_id"');
    const organizationIds = inValues(
      sql,
      params,
      '"seat_assignment"."organization_id"',
    );
    const wantsLive = sql.includes('"seat_assignment"."revoked_at" is null');
    const wantsRevoked = sql.includes(
      '"seat_assignment"."revoked_at" is not null',
    );
    return rows.filter(
      (row) =>
        (memberIds.length === 0 || memberIds.includes(row.segmentMemberId)) &&
        (segmentIds.length === 0 || segmentIds.includes(row.segmentId)) &&
        (organizationIds.length === 0 ||
          organizationIds.includes(row.organizationId)) &&
        (occupantType === undefined || row.occupantType === occupantType) &&
        (!wantsLive || row.revokedAt == null) &&
        (!wantsRevoked || row.revokedAt != null),
    );
  }

  if (table === segmentSeat) {
    const ids = inValues(sql, params, '"segment_seat"."id"');
    return ids.length === 0 ? rows : rows.filter((row) => ids.includes(row.id));
  }

  if (table === memberTrip) {
    const activityMemberId = equalityValue(
      sql,
      params,
      '"member_trip"."activity_member_id"',
    );
    const segmentIds = inValues(sql, params, '"member_trip"."segment_id"');
    return rows.filter(
      (row) =>
        (activityMemberId === undefined ||
          row.activityMemberId === activityMemberId) &&
        (segmentIds.length === 0 || segmentIds.includes(row.segmentId)),
    );
  }

  throw new Error("测试替身收到未知查询表");
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

const fakeTx = (
  state: FakeState,
  options: { failOnSegmentId?: number } = {},
): Tx => {
  const rowsFor = (table: unknown): Row[] => {
    if (table === activityMember) return state.activityMembers;
    if (table === activitySegment) return state.segments;
    if (table === segmentMember) return state.segmentMembers;
    if (table === seatAssignment) return state.assignments;
    if (table === segmentSeat) return state.seats;
    if (table === memberTrip) return state.trips;
    throw new Error("测试替身收到未知表");
  };

  const tx = {
    select(fields: Row) {
      return {
        from(table: unknown) {
          let condition: SQL | undefined;
          let joined = false;
          const read = () => {
            const rows = filterRows(table, rowsFor(table), condition);
            const readableRows =
              table === seatAssignment && joined
                ? rows.map((row) => ({
                    ...row,
                    label: state.seats.find(
                      (seat) => seat.id === row.segmentSeatId,
                    )?.label,
                    name: state.segments.find(
                      (segment) => segment.id === row.segmentId,
                    )?.name,
                  }))
                : rows;
            return readableRows.map((row) => projectFields(fields, row));
          };
          const query = (): FakeSelectQuery =>
            Object.assign(Promise.resolve(read()), {
              where(next: SQL) {
                condition = next;
                return query();
              },
              innerJoin() {
                joined = true;
                return query();
              },
              orderBy: () => query(),
              for: () => query(),
              limit: () => query(),
            });
          return query();
        },
      };
    },
    insert(table: unknown) {
      return {
        values(input: Row | Row[]) {
          const values = Array.isArray(input) ? input : [input];
          return {
            async onConflictDoNothing() {
              if (table !== segmentMember) {
                throw new Error("测试替身只允许新增环节人员");
              }
              for (const value of values) {
                if (value.segmentId === options.failOnSegmentId) {
                  throw new Error("模拟环节人员写入失败");
                }
                const duplicate = state.segmentMembers.some(
                  (row) =>
                    row.segmentId === value.segmentId &&
                    row.activityMemberId === value.activityMemberId,
                );
                if (duplicate) continue;
                state.segmentMembers.push({
                  segmentRole: null,
                  source: null,
                  groupName: null,
                  ownerName: null,
                  remark: null,
                  ...value,
                  id:
                    Math.max(
                      100,
                      ...state.segmentMembers.map((row) => Number(row.id ?? 0)),
                    ) + 1,
                });
              }
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(condition: SQL) {
          const target = rowsFor(table);
          const deleted = filterRows(table, target, condition);
          const deletedSet = new Set(deleted);
          target.splice(
            0,
            target.length,
            ...target.filter((row) => !deletedSet.has(row)),
          );
          return Object.assign(Promise.resolve(undefined), {
            returning(fields: Row) {
              return Promise.resolve(
                deleted.map((row) => projectFields(fields, row)),
              );
            },
          });
        },
      };
    },
  };

  return tx as unknown as Tx;
};

/** copy-on-write 模拟真实事务：抛错时不把草稿状态写回。 */
const inTransaction = async <T>(
  state: FakeState,
  work: (tx: Tx) => Promise<T>,
  options: { failOnSegmentId?: number } = {},
): Promise<T> => {
  const draft = structuredClone(state);
  const result = await work(fakeTx(draft, options));
  Object.assign(state, draft);
  return result;
};

const membership = (
  id: number,
  segmentId: number,
  overrides: Row = {},
): Row => ({
  id,
  segmentId,
  activityId: 20,
  activityMemberId: 10,
  memberId: 1,
  organizationId: 7,
  originType: "manual",
  ...overrides,
});

describe("活动人员参与环节原子同步", () => {
  test("去重后一次新增多个环节，并继承活动团体快照和默认关系字段", async () => {
    const state = baseState();

    const result = await inTransaction(state, (tx) =>
      syncActivityMemberSegments(tx, {
        activityMemberId: 10,
        segmentIds: [31, 31, 32],
        userId: "tester",
      }),
    );

    expect(result).toMatchObject({
      applied: true,
      added: 2,
      existing: 0,
      removed: 0,
      desiredSegmentIds: [31, 32],
    });
    expect(state.segmentMembers).toHaveLength(2);
    expect(
      state.segmentMembers.map((row) => ({
        segmentId: row.segmentId,
        organizationId: row.organizationId,
        originType: row.originType,
        segmentRole: row.segmentRole,
        source: row.source,
        groupName: row.groupName,
        ownerName: row.ownerName,
        remark: row.remark,
      })),
    ).toEqual([
      {
        segmentId: 31,
        organizationId: 7,
        originType: "segment_reference",
        segmentRole: null,
        source: null,
        groupName: null,
        ownerName: null,
        remark: null,
      },
      {
        segmentId: 32,
        organizationId: 7,
        originType: "segment_reference",
        segmentRole: null,
        source: null,
        groupName: null,
        ownerName: null,
        remark: null,
      },
    ]);
  });

  test("没有有效引用时取消关系，并清理已撤销座位的外键残行", async () => {
    const state = baseState();
    state.segmentMembers.push(membership(101, 31), membership(102, 32));
    state.assignments.push({
      id: 501,
      occupantType: "person",
      segmentMemberId: 101,
      segmentSeatId: 601,
      revokedAt: new Date("2026-08-01T00:00:00Z"),
    });

    const result = await inTransaction(state, (tx) =>
      syncActivityMemberSegments(tx, {
        activityMemberId: 10,
        segmentIds: [32],
        userId: "tester",
      }),
    );

    expect(result).toMatchObject({
      applied: true,
      added: 0,
      existing: 1,
      removed: 1,
    });
    expect(state.segmentMembers.map((row) => row.segmentId)).toEqual([32]);
    expect(state.assignments).toEqual([]);
  });

  test("有效个人座位返回明确清单，并阻止同批新增和删除", async () => {
    const state = baseState();
    state.segmentMembers.push(membership(101, 31));
    state.assignments.push({
      id: 501,
      occupantType: "person",
      segmentMemberId: 101,
      segmentSeatId: 601,
      revokedAt: null,
    });
    state.seats.push({ id: 601, label: "A-01" });

    const result = await inTransaction(state, (tx) =>
      syncActivityMemberSegments(tx, {
        activityMemberId: 10,
        segmentIds: [32],
        userId: "tester",
      }),
    );

    expect(result).toEqual({
      applied: false,
      blocked: [
        {
          segmentMemberId: 101,
          segmentId: 31,
          segmentName: "开幕式",
          seats: [{ assignmentId: 501, seatLabel: "A-01" }],
          organizationSeats: [],
          trips: [],
        },
      ],
      readOnlyRetained: [],
    });
    expect(state.segmentMembers.map((row) => row.segmentId)).toEqual([31]);
    expect(state.assignments).toHaveLength(1);
  });

  test("关联该环节的行程返回明确清单，并阻止整批写入", async () => {
    const state = baseState();
    state.segmentMembers.push(membership(101, 31));
    state.trips.push({
      id: 701,
      activityMemberId: 10,
      segmentId: 31,
      serviceNumber: "G1652",
      departureTime: new Date("2026-09-01T06:00:00Z"),
      departureLocation: "厦门",
      destination: "泉州",
    });

    const result = await inTransaction(state, (tx) =>
      syncActivityMemberSegments(tx, {
        activityMemberId: 10,
        segmentIds: [32],
        userId: "tester",
      }),
    );

    expect(result).toMatchObject({
      applied: false,
      blocked: [
        {
          segmentMemberId: 101,
          segmentId: 31,
          segmentName: "开幕式",
          seats: [],
          trips: [
            {
              tripId: 701,
              serviceNumber: "G1652",
              departureLocation: "厦门",
              destination: "泉州",
            },
          ],
        },
      ],
    });
    expect(state.segmentMembers.map((row) => row.segmentId)).toEqual([31]);
  });

  test("移除最后一名团体成员会使有效团体占位失去范围时整批阻断", async () => {
    const state = baseState();
    state.segmentMembers.push(membership(101, 31));
    state.assignments.push({
      id: 502,
      occupantType: "organization",
      segmentMemberId: null,
      segmentId: 31,
      organizationId: 7,
      segmentSeatId: 602,
      revokedAt: null,
    });
    state.seats.push({ id: 602, label: "团体席 B-01" });

    const result = await inTransaction(state, (tx) =>
      syncActivityMemberSegments(tx, {
        activityMemberId: 10,
        segmentIds: [32],
        userId: "tester",
      }),
    );

    expect(result).toEqual({
      applied: false,
      blocked: [
        {
          segmentMemberId: 101,
          segmentId: 31,
          segmentName: "开幕式",
          seats: [],
          organizationSeats: [
            {
              assignmentId: 502,
              organizationId: 7,
              seatLabel: "团体席 B-01",
            },
          ],
          trips: [],
        },
      ],
      readOnlyRetained: [],
    });
    expect(state.segmentMembers.map((row) => row.segmentId)).toEqual([31]);
    expect(state.assignments).toHaveLength(1);
  });

  test("同环节仍有该团体成员时可移除当前关系并保留团体占位", async () => {
    const state = baseState();
    state.segmentMembers.push(
      membership(101, 31),
      membership(201, 31, {
        activityMemberId: 11,
        memberId: 2,
      }),
    );
    state.assignments.push({
      id: 502,
      occupantType: "organization",
      segmentMemberId: null,
      segmentId: 31,
      organizationId: 7,
      segmentSeatId: 602,
      revokedAt: null,
    });
    state.seats.push({ id: 602, label: "团体席 B-01" });

    const result = await inTransaction(state, (tx) =>
      syncActivityMemberSegments(tx, {
        activityMemberId: 10,
        segmentIds: [],
        userId: "tester",
      }),
    );

    expect(result).toEqual({
      applied: true,
      added: 0,
      existing: 0,
      removed: 1,
      desiredSegmentIds: [],
      readOnlyRetained: [],
    });
    expect(state.segmentMembers).toEqual([
      membership(201, 31, { activityMemberId: 11, memberId: 2 }),
    ]);
    expect(state.assignments).toHaveLength(1);
  });

  test.each([
    { segmentIds: [32, 999], message: "不存在或不属于" },
    { segmentIds: [32, 99], message: "不存在或不属于" },
    { segmentIds: [32, 34], message: "已作废" },
    { segmentIds: [32, 35], message: "未开启人员管理" },
  ])("非法或不可选环节 $segmentIds 整次零写", async ({
    segmentIds,
    message,
  }) => {
    const state = baseState();
    state.segmentMembers.push(membership(101, 31));
    const before = structuredClone(state);

    const promise = inTransaction(state, (tx) =>
      syncActivityMemberSegments(tx, {
        activityMemberId: 10,
        segmentIds,
        userId: "tester",
      }),
    );

    expect(promise).rejects.toBeInstanceOf(ActivityMemberSegmentSyncError);
    expect(promise).rejects.toThrow(message);
    await promise.catch(() => undefined);
    expect(state).toEqual(before);
  });

  test("作废和关闭人员管理的既有关系只读保留", async () => {
    const state = baseState();
    state.segmentMembers.push(
      membership(101, 31),
      membership(104, 34),
      membership(105, 35),
    );

    const result = await inTransaction(state, (tx) =>
      syncActivityMemberSegments(tx, {
        activityMemberId: 10,
        segmentIds: [],
        userId: "tester",
      }),
    );

    expect(result).toEqual({
      applied: true,
      added: 0,
      existing: 0,
      removed: 1,
      desiredSegmentIds: [],
      readOnlyRetained: [
        {
          segmentMemberId: 104,
          segmentId: 34,
          segmentName: "历史环节",
          reason: "segmentVoided",
        },
        {
          segmentMemberId: 105,
          segmentId: 35,
          segmentName: "关闭人员管理",
          reason: "memberManagementDisabled",
        },
      ],
    });
    expect(state.segmentMembers.map((row) => row.segmentId)).toEqual([34, 35]);
  });

  test("任一新增写入失败时，已新增和待删除关系一起回滚", async () => {
    const state = baseState();
    state.segmentMembers.push(membership(101, 31));
    const before = structuredClone(state);

    const promise = inTransaction(
      state,
      (tx) =>
        syncActivityMemberSegments(tx, {
          activityMemberId: 10,
          segmentIds: [32, 33],
          userId: "tester",
        }),
      { failOnSegmentId: 33 },
    );

    expect(promise).rejects.toThrow("模拟环节人员写入失败");
    await promise.catch(() => undefined);
    expect(state).toEqual(before);
  });
});
