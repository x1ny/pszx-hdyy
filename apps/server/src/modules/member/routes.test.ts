import { describe, expect, test } from "bun:test";
import { desc, sql } from "drizzle-orm";
import { db } from "../../infra/db";
import {
  memberListFilter,
  memberReadFields,
  memberRoutes,
  organizationMemberCandidateFields,
  organizationMemberCandidatesFilter,
} from "./routes";
import {
  activityMemberRoutes,
  activityMemberScopeFilter,
  activityMemberSegments,
  projectMemberRoutes,
  projectMemberScopeFilter,
  segmentMemberRoutes,
  segmentMemberScopeFilter,
} from "./routes.relation";
import { activityMember, member, projectMember, segmentMember } from "./schema";
import {
  ListActivityMemberSourcesInput,
  ListActivityMembersInput,
  ListProjectMembersInput,
  ListSegmentMembersInput,
} from "./validation";

/**
 * 钉住 activityCount 那句相关子查询的**渲染结果**，而不是它的取值。
 *
 * 这里不连库：`toSQL()` 只把 query builder 转成 SQL 文本。之所以断言文本，是因为
 * 这个 bug 不会让查询报错——它渲染出一条语法完全合法、只是结果恒定的 SQL，
 * 只有对着数据一行行核对才看得出数字是错的。断言全限定列名，能在写 SQL 的那一刻
 * 就把它拦下来。缘由见 routes.ts 里 memberReadFields 的注释。
 */
describe("memberReadFields.activityCount", () => {
  const rendered = db
    .select(memberReadFields)
    .from(member)
    .orderBy(desc(member.id))
    .toSQL().sql;

  test("单表查询下关联条件仍是全限定列名", () => {
    expect(rendered).toContain(`"activity_member"."member_id" = "member"."id"`);
  });

  test("没有退化成裸列名", () => {
    // 裸列名会在子查询里自我关联成 activity_member.member_id = activity_member.id，
    // count 于是跟外层那一行毫无关系，每个人拿到同一个常数。
    expect(rendered).not.toContain(`"member_id" = "id"`);
  });

  test("裸模板写法确实会被降级——这就是当初错的地方", () => {
    // 反向用例，证明上面两条不是空防。哪天 drizzle 不再降级 select 字段里的
    // Column 片段，这条会失败，那时 memberReadFields 里的 eq() 才可以简化回去。
    const naive = db
      .select({
        id: member.id,
        activityCount: sql<number>`(
          select count(*)::int from ${activityMember}
          where ${activityMember.memberId} = ${member.id}
        )`.as("activity_count"),
      })
      .from(member)
      .toSQL().sql;

    expect(naive).toContain(`where "member_id" = "id"`);
  });
});

describe("人员主档团体读取与筛选", () => {
  test("读取投影从 organization 主档派生团体名称", () => {
    const rendered = db.select(memberReadFields).from(member).toSQL().sql;

    expect(rendered).toContain(`from "organization"`);
    expect(rendered).toContain(
      `"organization"."id" = "member"."organization_id"`,
    );
    expect(rendered).toContain(`as "organization_name"`);
  });

  test("列表筛选使用 member.organization_id 当前归属列", () => {
    const rendered = db
      .select({ id: member.id })
      .from(member)
      .where(memberListFilter({ organizationId: 7 }))
      .toSQL();

    expect(rendered.sql).toContain(`"member"."organization_id" = $1`);
    expect(rendered.params).toEqual([7]);
  });
});

describe("活动人员列表", () => {
  test("来源选项接口只需要活动 id", () => {
    expect(ListActivityMemberSourcesInput.parse({ activityId: 1 })).toEqual({
      activityId: 1,
    });
  });

  test("来源和负责人筛选会去掉首尾空白", () => {
    const parsed = ListActivityMembersInput.parse({
      activityId: 1,
      source: "  企业嘉宾  ",
      ownerName: "  王运营  ",
      page: 1,
      pageSize: 10,
    });

    expect(parsed.source).toBe("企业嘉宾");
    expect(parsed.ownerName).toBe("王运营");
  });

  test("参与环节按开始时间和 id 稳定排序，并关联到当前活动人员", () => {
    const rendered = db
      .select({
        id: activityMember.id,
        segments: activityMemberSegments,
      })
      .from(activityMember)
      .toSQL();

    expect(rendered.sql).toContain(
      `"segment_member"."activity_member_id" = "activity_member"."id"`,
    );
    expect(rendered.sql).toContain(`order by "start_time", "segment_id"`);
    expect(rendered.params).toContain("active");
  });
});

describe("范围人员按团体快照查询", () => {
  test("三层列表输入都接受 organizationId", () => {
    expect(
      ListProjectMembersInput.parse({
        projectId: 1,
        organizationId: 7,
        page: 1,
        pageSize: 10,
      }).organizationId,
    ).toBe(7);
    expect(
      ListActivityMembersInput.parse({
        activityId: 2,
        organizationId: 7,
        page: 1,
        pageSize: 10,
      }).organizationId,
    ).toBe(7);
    expect(
      ListSegmentMembersInput.parse({
        segmentId: 3,
        organizationId: 7,
        page: 1,
        pageSize: 10,
      }).organizationId,
    ).toBe(7);
  });

  test("项目条件使用 project_member 快照列", () => {
    const rendered = db
      .select({ organizationId: projectMember.organizationId })
      .from(projectMember)
      .where(projectMemberScopeFilter(1, 7))
      .toSQL();

    expect(rendered.sql).toContain('"project_member"."project_id"');
    expect(rendered.sql).toContain('"project_member"."organization_id"');
    expect(rendered.params).toEqual([1, 7]);
  });

  test("活动条件使用 activity_member 快照列", () => {
    const rendered = db
      .select({ organizationId: activityMember.organizationId })
      .from(activityMember)
      .where(activityMemberScopeFilter(2, 7))
      .toSQL();

    expect(rendered.sql).toContain('"activity_member"."activity_id"');
    expect(rendered.sql).toContain('"activity_member"."organization_id"');
    expect(rendered.params).toEqual([2, 7]);
  });

  test("环节条件使用 segment_member 快照列", () => {
    const rendered = db
      .select({ organizationId: segmentMember.organizationId })
      .from(segmentMember)
      .where(segmentMemberScopeFilter(3, 7))
      .toSQL();

    expect(rendered.sql).toContain('"segment_member"."segment_id"');
    expect(rendered.sql).toContain('"segment_member"."organization_id"');
    expect(rendered.params).toEqual([3, 7]);
  });
});

describe("按团体添加路由", () => {
  test("候选查询只读当前主档团体且只返回启用人员", () => {
    const rendered = db
      .select(organizationMemberCandidateFields)
      .from(member)
      .where(organizationMemberCandidatesFilter(7, "王", "会长"))
      .toSQL();

    expect(rendered.sql).toContain('"member"."organization_id"');
    expect(rendered.sql).toContain('"member"."status"');
    expect(rendered.sql).not.toContain('"project_member"');
    expect(rendered.sql).not.toContain('"activity_member"');
    expect(rendered.sql).not.toContain('"segment_member"');
    expect(rendered.params).toEqual([7, "enabled", "%王%", "%会长%"]);
  });

  test("候选投影显式带当前状态和 organizationId", () => {
    expect(Object.keys(organizationMemberCandidateFields)).toEqual([
      "id",
      "name",
      "gender",
      "companyPosition",
      "mobile",
      "status",
      "organizationId",
    ]);
  });

  test("主档与三层关系都注册了独立动作", () => {
    const hasPost = (
      routes: ReadonlyArray<{ method: string; path: string }>,
      path: string,
    ) => routes.some((route) => route.method === "POST" && route.path === path);

    expect(hasPost(memberRoutes.routes, "/organizationCandidates")).toBe(true);
    expect(hasPost(projectMemberRoutes.routes, "/addByOrganization")).toBe(
      true,
    );
    expect(hasPost(activityMemberRoutes.routes, "/addByOrganization")).toBe(
      true,
    );
    expect(hasPost(segmentMemberRoutes.routes, "/addByOrganization")).toBe(
      true,
    );
  });
});
