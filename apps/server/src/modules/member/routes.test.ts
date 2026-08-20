import { describe, expect, test } from "bun:test";
import { desc, sql } from "drizzle-orm";
import { db } from "../../infra/db";
import { memberReadFields } from "./routes";
import { activityMember, member } from "./schema";

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
