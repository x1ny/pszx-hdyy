import { describe, expect, test } from "bun:test";
import { tripOptionsSegmentsQuery } from "./routes";

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
