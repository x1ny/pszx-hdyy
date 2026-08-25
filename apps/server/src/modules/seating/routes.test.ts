import { describe, expect, test } from "bun:test";
import { listCandidatesQuery } from "./routes";

describe("listCandidatesQuery", () => {
  const rendered = listCandidatesQuery(12, {
    segmentId: 7,
    activityId: 3,
  }).toSQL().sql;

  test("只从当前环节关系内选人", () => {
    expect(rendered).toContain('inner join "segment_member" on');
    expect(rendered).toContain(
      '"segment_member"."activity_member_id" = "activity_member"."id"',
    );
    expect(rendered).toContain('"segment_member"."segment_id" =');
  });

  test("不会退回活动人员的左连接", () => {
    expect(rendered).not.toContain('left join "segment_member"');
  });
});
