import { describe, expect, test } from "bun:test";
import {
  BatchTripScopeError,
  buildBatchTripRows,
  tripBatchMembersQuery,
  tripBatchOrganizationsQuery,
  tripOptionsSegmentsQuery,
  tripSegmentMembershipQuery,
} from "./routes";
import { CreateBatchTripsInput } from "./validation";

describe("tripOptionsSegmentsQuery", () => {
  const rendered = tripOptionsSegmentsQuery(3).toSQL();

  test("只返回当前活动、未作废且开启环节人员管理的环节", () => {
    expect(rendered.sql).toContain('"activity_segment"."activity_id" =');
    expect(rendered.sql).toContain('"activity_segment"."status" =');
    expect(rendered.sql).toContain('"activity_segment"."member_enabled" =');
    expect(rendered.params).toContain(3);
    expect(rendered.params).toContain("active");
    expect(rendered.params).toContain(true);
  });

  test("仍按环节开始时间和 id 稳定排序", () => {
    expect(rendered.sql).toContain(
      'order by "activity_segment"."start_time" asc, "activity_segment"."id" asc',
    );
  });
});

describe("团体批量行程范围选项", () => {
  test("未选环节时团体选项从活动人员的组织快照取数", () => {
    const rendered = tripBatchOrganizationsQuery(3, null).toSQL();

    expect(rendered.sql).toContain('from "activity_member"');
    expect(rendered.sql).toContain(
      '"organization"."id" = "activity_member"."organization_id"',
    );
    expect(rendered.sql).toContain('"activity_member"."activity_id" =');
    expect(rendered.params).toContain(3);
  });

  test("选择环节后团体和人员都只从环节成员的快照取数", () => {
    const organizations = tripBatchOrganizationsQuery(3, 9).toSQL();
    const members = tripBatchMembersQuery(3, 9).toSQL();

    expect(organizations.sql).toContain('from "segment_member"');
    expect(organizations.sql).toContain(
      '"organization"."id" = "segment_member"."organization_id"',
    );
    expect(members.sql).toContain('from "segment_member"');
    expect(members.sql).toContain('"segment_member"."organization_id"');
    expect(members.sql).toContain('"segment_member"."segment_id" =');
    expect(members.params).toEqual(expect.arrayContaining([3, 9]));
  });
});

describe("行程环节范围校验", () => {
  test("单条创建和修改以 segment_member 证明活动人员确实参加了该环节", () => {
    const rendered = tripSegmentMembershipQuery(3, 7, 9).toSQL();

    expect(rendered.sql).toContain('from "segment_member"');
    expect(rendered.sql).toContain('"segment_member"."activity_member_id" =');
    expect(rendered.sql).toContain('"segment_member"."segment_id" =');
    expect(rendered.sql).toContain('"activity_segment"."activity_id" =');
    expect(rendered.params).toEqual(expect.arrayContaining([3, 7, 9]));
  });
});

describe("团体批量行程计划", () => {
  const input = CreateBatchTripsInput.parse({
    activityId: 3,
    organizationId: 8,
    segmentId: 9,
    activityMemberIds: [12, 15, 12],
    transportMode: "train",
    departureTime: "2026-09-01T08:00:00+08:00",
    arrivalTime: "2026-09-01T10:00:00+08:00",
    departureLocation: "福州站",
    destination: "厦门北站",
  });

  const scopeRows = [
    { activityMemberId: 12, projectId: 4, memberId: 101 },
    { activityMemberId: 15, projectId: 4, memberId: 102 },
  ];

  test("成功时每个最终选择都生成独立行程，重复选择不被去重", () => {
    const rows = buildBatchTripRows(input, scopeRows, "user-1", "范围错误");

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.activityMemberId)).toEqual([12, 15, 12]);
    expect(rows.map((row) => row.memberId)).toEqual([101, 102, 101]);
    expect(rows.every((row) => row.projectId === 4)).toBe(true);
  });

  test("伪造一个范围外人员会在生成任何插入行前中止整批计划", () => {
    expect(() =>
      buildBatchTripRows(
        { ...input, activityMemberIds: [12, 999] },
        scopeRows,
        "user-1",
        "所选人员不在所选环节范围内",
      ),
    ).toThrow(BatchTripScopeError);
  });
});
