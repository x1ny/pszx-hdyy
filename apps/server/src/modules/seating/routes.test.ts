import { describe, expect, test } from "bun:test";
import { db } from "../../infra/db";
import { activitySegment } from "../agenda/schema";
import {
  listCandidatesQuery,
  listOrganizationCandidatesQuery,
  listOrganizationSeatingStatsQuery,
  organizationInSegmentScopeQuery,
} from "./routes";
import { segmentSeatingPlan } from "./schema";
import { currentPlanJoin, inSeatingScope } from "./stats";

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

  test("候选人显式返回环节层团体快照", () => {
    expect(rendered).toContain('"segment_member"."organization_id"');
  });

  test("已占座查询显式限为个人占座，团体不会冒充个人", () => {
    expect(rendered).toContain(
      '"seat_assignment"."occupant_type" = \'person\'',
    );
  });
});

describe("团体占位范围查询", () => {
  const candidatesSql = listOrganizationCandidatesQuery(7).toSQL().sql;
  const scopeSql = organizationInSegmentScopeQuery(db, 7, 3).toSQL().sql;
  const statsSql = listOrganizationSeatingStatsQuery(db, 12, 7).toSQL().sql;

  test("候选团体只从当前环节的 organizationId 快照去重读取", () => {
    expect(candidatesSql).toContain('from "segment_member"');
    expect(candidatesSql).toContain('inner join "organization"');
    expect(candidatesSql).toContain(
      '"organization"."id" = "segment_member"."organization_id"',
    );
    expect(candidatesSql).toContain('"segment_member"."segment_id"');
  });

  test("伪造或跨环节团体 id 会被范围查询排除", () => {
    expect(scopeSql).toContain('"segment_member"."segment_id"');
    expect(scopeSql).toContain('"segment_member"."organization_id"');
    expect(scopeSql).toContain("limit");
  });

  test("统计只看当前环节快照，个人排座和团体占位分别计数", () => {
    expect(statsSql).toContain('from "segment_member"');
    expect(statsSql).toContain('"segment_member"."segment_id"');
    expect(statsSql).toContain('"seat_assignment"."occupant_type" = $');
    expect(statsSql).toContain(
      '"organization_assignment"."occupant_type" = \'organization\'',
    );
    expect(statsSql).toContain(
      '"organization_assignment"."revoked_at" is null',
    );
  });

  test("批量预览只把传入位置当作候选，真正空闲条件仍检查方案、启用和有效占用", () => {
    // 路由中的 availability helper 是事务内查询；这里钉住统计查询没有把团体
    // 位置偷算进个人数，剩余人数才不会被团体占位错误削减。
    expect(statsSql).toContain('count("seat_assignment"."id")::int');
    expect(statsSql).not.toContain('count(distinct "organization_assignment"');
  });
});

describe("排位范围的两个片段", () => {
  // 「哪些环节算开了排位」这条规则漂移过一次（见 stats.ts 的注释），现在有两个
  // 读者：排位页的 listPlans 和活动配置总览。规则本身只有一处，这里钉住它。
  const rendered = db
    .select({ id: activitySegment.id })
    .from(activitySegment)
    .leftJoin(segmentSeatingPlan, currentPlanJoin)
    .where(inSeatingScope)
    .toSQL().sql;

  test("作废方案不算当前方案，排除写在连接条件里", () => {
    // 写进 where 的话，"只有一份作废方案"的环节会被整个滤掉——而它该以
    // 「未配置」出现。
    expect(rendered).toContain("left join");
    expect(rendered.slice(0, rendered.indexOf("where"))).toContain(
      "<> 'voided'",
    );
  });

  test("是并集，不是拿开关硬过滤方案", () => {
    const where = rendered.slice(rendered.indexOf("where"));
    expect(where).toContain('"seating_enabled"');
    expect(where).toContain("is not null");
    expect(where).toContain(" or ");
  });
});
