import { describe, expect, test } from "bun:test";
import { desc } from "drizzle-orm";
import { db } from "../../infra/db";
import { venueCountFields } from "./routes";
import { venue } from "./schema";

/**
 * 钉住两句相关子查询的**渲染结果**，而不是它们的取值。
 *
 * 这里不连库：`toSQL()` 只把 query builder 转成 SQL 文本。之所以断言文本，是因为
 * 这个 bug 不会让查询报错——它渲染出一条语法完全合法、只是关联断掉的 SQL
 * （`where "venue_id" = "id"` 在子查询里两边都匹配到子表自己），count 退化成一个
 * 与外层无关的常数。只有对着数据一行行核对才看得出数字是错的。
 *
 * 这个坑在本模块是真的踩到了：第一版写成 `${venueZone.venueId} = ${venue.id}`，
 * 端到端冒烟里一个有 2 区域 3 位置的场地，列表显示 1 和 1。缘由见 routes.ts 里
 * venueCountFields 的注释，以及 member 模块的同款用例。
 */
describe("venueCountFields", () => {
  const rendered = db
    .select({ id: venue.id, ...venueCountFields })
    .from(venue)
    .orderBy(desc(venue.id))
    .toSQL().sql;

  test("区域数的关联条件是全限定列名", () => {
    expect(rendered).toContain(`"venue_zone"."venue_id" = "venue"."id"`);
  });

  test("位置数的关联条件是全限定列名", () => {
    expect(rendered).toContain(`"venue_seat"."venue_id" = "venue"."id"`);
  });

  test("没有退化成裸列名", () => {
    // 出现这个片段就说明 buildSelection 又把列名降级了。
    expect(rendered).not.toContain(`where "venue_id" = "id"`);
  });
});
