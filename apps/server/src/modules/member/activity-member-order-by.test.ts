import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../../infra/db";
import { listSegmentConfigResourceBindingsQuery } from "../agenda/routes";
import { listCandidatesQuery } from "../seating/routes";
import { tripBatchMembersQuery } from "../trip/routes";
import { activityMemberOrderBy } from "./activity-member-order-by";
import { byManualOrder, type ManualOrderRow } from "./plan-manual-order";
import { activityMember } from "./schema";

/**
 * 这份测试挡的是"活动人员名单的顺序在某个出口悄悄分叉"。
 *
 * 它挡得住两件事：有人改掉了已经接线的查询，有人把排序规则又抄了一份。
 * 它**挡不住**"有人新写了一条返回活动人员的查询、压根没排序"——没有运行时
 * 注册表能枚举"哪些查询返回的是人员名单"（权限闸门能有 `permission-map`
 * 那种遍历 `app.routes` 的断言，是因为路由本身就是一张表，排序没有对应物）。
 * 那一类只能靠 `activity-member-order-by.ts` 的注释和文档。别为了补上这个
 * 缺口去造一层排序注册中心。
 *
 * 同 routes.test.ts：`toSQL()` 只渲染文本，不连库。
 */

/** 三列的渲染结果。没有 `nulls last` 是对的——Postgres 的 ASC 默认就是。 */
const ORDER_FRAGMENT =
  'order by "activity_member"."sort_order" asc, ' +
  '"activity_member"."sort_index" asc, ' +
  '"activity_member"."id" asc';

describe("activityMemberOrderBy", () => {
  test("渲染成可见排序值 → 隐藏位置 → id", () => {
    const rendered = db
      .select({ id: activityMember.id })
      .from(activityMember)
      .orderBy(...activityMemberOrderBy)
      .toSQL().sql;

    expect(rendered).toContain(ORDER_FRAGMENT);
  });

  test("没有写死 nulls 顺序", () => {
    const rendered = db
      .select({ id: activityMember.id })
      .from(activityMember)
      .orderBy(...activityMemberOrderBy)
      .toSQL().sql;

    // 写成 `nulls first` 会把"未设置"的人顶到名单最前面，和纯函数那份实现
    // 直接矛盾；补 `coalesce` 则让 0 和未设置无法区分（0008 迁移刚把这两种
    // 状态分开，见 activity-member-ordering-model-plan.md 的 4.1）。
    expect(rendered).not.toContain("nulls first");
    expect(rendered).not.toContain("coalesce");
  });
});

describe("SQL 与纯函数是同一条规则", () => {
  // 已经按规范顺序排好的一组行：先按可见值升序，未设置（null）最后；
  // 同值组内按隐藏位置，再按 id。SQL 那三列读出来必须是同一个序列。
  const inOrder: ManualOrderRow[] = [
    { id: 90, order: 0, sortIndex: 7 },
    { id: 12, order: 1, sortIndex: 2 },
    { id: 34, order: 1, sortIndex: 9 },
    { id: 56, order: 200, sortIndex: 1 },
    { id: 5, order: null, sortIndex: 3 },
    { id: 88, order: null, sortIndex: 4 },
    { id: 99, order: null, sortIndex: 4 },
  ];

  test("byManualOrder 复现同一个序列", () => {
    const shuffled = [...inOrder].reverse();

    expect([...shuffled].sort(byManualOrder).map((row) => row.id)).toEqual(
      inOrder.map((row) => row.id),
    );
  });

  test("未设置排在所有数字之后，0 也在它们之前", () => {
    const sorted = [...inOrder].sort(byManualOrder);
    const firstUnset = sorted.findIndex((row) => row.order === null);

    expect(firstUnset).toBe(4);
    expect(sorted.slice(firstUnset).every((row) => row.order === null)).toBe(
      true,
    );
  });
});

describe("已接线的查询出口", () => {
  test("排位候选人", () => {
    const rendered = listCandidatesQuery(1, {
      segmentId: 2,
      activityId: 1,
    }).toSQL().sql;

    expect(rendered).toContain(ORDER_FRAGMENT);
  });

  test("行程批量选择器（活动范围）", () => {
    expect(tripBatchMembersQuery(1, null).toSQL().sql).toContain(
      ORDER_FRAGMENT,
    );
  });

  test("行程批量选择器（环节范围）也先按活动名单", () => {
    const rendered = tripBatchMembersQuery(1, 2).toSQL().sql;

    expect(rendered).toContain(`${ORDER_FRAGMENT}, "segment_member"."id" asc`);
  });

  test("议程页资源已绑人员", () => {
    const rendered = listSegmentConfigResourceBindingsQuery([1]).toSQL().sql;

    expect(rendered).toContain(
      `${ORDER_FRAGMENT}, "resource_member_binding"."id" asc`,
    );
  });
});

describe("规则只有一份实现", () => {
  const sourceRoot = join(import.meta.dir, "..", "..");

  const sourceFiles = readdirSync(sourceRoot, {
    recursive: true,
    withFileTypes: true,
  }).flatMap((entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    return [join(entry.parentPath, entry.name)];
  });

  test("除了 activity-member-order-by.ts，没人再拼一遍 sortOrder 排序", () => {
    const offenders = sourceFiles.filter(
      (path) =>
        !path.endsWith("activity-member-order-by.ts") &&
        !path.endsWith("activity-member-order-by.test.ts") &&
        /(?:asc|desc)\(\s*activityMember\.sortOrder\s*\)/.test(
          readFileSync(path, "utf8"),
        ),
    );

    // 出现在这里说明某条查询自己拼了排序列。改成 `.orderBy(...activityMemberOrderBy)`，
    // 而不是把文件加进白名单——多一份实现就会多一处漂移。
    expect(offenders).toEqual([]);
  });
});
