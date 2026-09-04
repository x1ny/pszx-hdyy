import { describe, expect, test } from "bun:test";
import { maskMobile, resolveActivityMemberQuery } from "./auth";
import {
  itineraryCarsQuery,
  itineraryHeroQuery,
  itinerarySeatsQuery,
  itinerarySegmentsQuery,
  itineraryTripsQuery,
} from "./routes";

/**
 * 这里测的四条规则有一个共同点：**页面上看起来永远是"正常"的**。
 *
 * 漏掉一个环节、少一个座位、跨活动放行、重号命中了另一个人 —— 渲染出来都是一张
 * 完好的行程页，没有任何视觉信号。肉眼验收发现不了，只有这里能拦住。
 */

describe("resolveActivityMemberQuery —— 手机号换人员", () => {
  const rendered = resolveActivityMemberQuery(7, "13800000000").toSQL();

  test("活动范围钉死在 SQL 里：拿 A 活动的凭证打不开 B 活动", () => {
    // cookie 里只有手机号，没有活动信息 —— 所以"这个人属不属于这个活动"完全由
    // 这一条 where 决定。它没了，一个活动的凭证就能打开所有活动。
    expect(rendered.sql).toContain('"activity_member"."activity_id" =');
    expect(rendered.params).toContain(7);
  });

  test("按手机号匹配，且禁用的人当作查不到", () => {
    expect(rendered.sql).toContain('"member"."mobile" =');
    expect(rendered.sql).toContain('"member"."status" =');
    expect(rendered.params).toContain("13800000000");
    expect(rendered.params).toContain("enabled");
  });

  test("重号时按 activity_member.id 升序取第一条，顺序是稳定的", () => {
    // 主档上 mobile 没有唯一约束（R-002），重号一定会攒出来。没有 ORDER BY 的话
    // Postgres 不保证顺序，同一个人两次请求可能命中不同的人 —— 那种 bug 查起来
    // 要命，而且只在共用电话的那几户身上出现。
    expect(rendered.sql).toContain('order by "activity_member"."id" asc');
    expect(rendered.sql).toContain("limit");
  });
});

describe("itinerarySegmentsQuery —— 议程按 member_enabled 分流", () => {
  const rendered = itinerarySegmentsQuery(7, 42).toSQL();

  test("只取本活动、未作废的环节", () => {
    expect(rendered.sql).toContain('"activity_segment"."activity_id" =');
    expect(rendered.sql).toContain('"activity_segment"."status" =');
    expect(rendered.params).toContain(7);
    expect(rendered.params).toContain("active");
  });

  test("没开人员管理的环节视为全员参加，不看名单", () => {
    // 运营多半不会给开幕式、午餐这类全员场次开人员管理再逐个拉人。只认
    // segment_member 的话，嘉宾的行程里就没有开幕式 —— 而那正是他最需要的一场。
    expect(rendered.sql).toContain('"activity_segment"."member_enabled" =');
    expect(rendered.params).toContain(false);
  });

  test("开了人员管理的环节由名单说了算，且必须是 or 不是 and", () => {
    expect(rendered.sql).toContain('or exists (select 1 from "segment_member"');
    expect(rendered.sql).toContain('"segment_member"."member_id" =');
    expect(rendered.params).toContain(42);
    // 写成 and 的话没开人员管理的环节会全部消失（它们没有 segment_member 行），
    // 页面上就是"行程尚未安排"，而数据其实是全的。
    expect(rendered.sql).not.toContain(
      'and exists (select 1 from "segment_member"',
    );
  });

  test("按开始时间稳定排序", () => {
    expect(rendered.sql).toContain(
      'order by "activity_segment"."start_time" asc, "activity_segment"."id" asc',
    );
  });
});

describe("itinerarySeatsQuery —— 座位只认已确认方案", () => {
  const rendered = itinerarySeatsQuery(7, 42).toSQL();

  test("pending / rejected 的方案不会给出座位号", () => {
    // 未确认的方案运营还在拖座位，给出去的号随时会变；嘉宾拿到座位号就是照着
    // 坐，给一个还会变的比不给更糟。
    expect(rendered.sql).toContain('"segment_seating_plan"."status" =');
    expect(rendered.params).toContain("confirmed");
  });

  test("撤销的分配不算数", () => {
    expect(rendered.sql).toContain('"seat_assignment"."revoked_at" is null');
  });

  test("只取本人、本活动的分配", () => {
    expect(rendered.sql).toContain('"segment_member"."activity_id" =');
    expect(rendered.sql).toContain('"segment_member"."member_id" =');
    expect(rendered.params).toContain(7);
    expect(rendered.params).toContain(42);
  });

  test("状态过滤写在 join 条件里，未确认的方案不会漏成 null 座位", () => {
    // 挪到 where 里也能过滤，但这里是 inner join，写在哪都一样 —— 真正的要求是
    // **不能**退化成 left join：那样未确认的方案会以 null 的形式漏进结果集。
    expect(rendered.sql).not.toContain("left join");
  });
});

describe("交通两个来源各自的范围", () => {
  test("到离行程按活动人员关系取，不是按人员主档", () => {
    // 按 member_id 取的话，同一个人在别的活动里的行程会串进这个活动的页面。
    const rendered = itineraryTripsQuery(9).toSQL();
    expect(rendered.sql).toContain('"member_trip"."activity_member_id" =');
    expect(rendered.params).toContain(9);
  });

  test("用车只取绑到本人、且未作废的交通类资源", () => {
    const rendered = itineraryCarsQuery(9).toSQL();
    expect(rendered.sql).toContain(
      '"resource_member_binding"."activity_member_id" =',
    );
    expect(rendered.sql).toContain('"activity_resource"."resource_type" =');
    expect(rendered.sql).toContain('"activity_resource"."status" =');
    expect(rendered.params).toContain("transport");
    expect(rendered.params).toContain("active");
  });

  test("用车走 inner join，没绑人的资源不会漏给所有人", () => {
    expect(itineraryCarsQuery(9).toSQL().sql).not.toContain("left join");
  });
});

describe("itineraryHeroQuery", () => {
  const rendered = itineraryHeroQuery(7).toSQL();

  test("只取图片，且顺序稳定 —— 否则每次刷新头图都可能换一张", () => {
    expect(rendered.sql).toContain('"activity_media"."media_type" =');
    expect(rendered.params).toContain("image");
    expect(rendered.sql).toContain(
      'order by "activity_media"."sort_order" asc, "activity_media"."id" asc',
    );
    expect(rendered.sql).toContain("limit");
  });
});

describe("maskMobile", () => {
  test("回传给前端的号码是脱敏的", () => {
    expect(maskMobile("13800001234")).toBe("138****1234");
  });

  test("短到脱敏没有意义的串原样返回，不会截出一个错的号", () => {
    expect(maskMobile("123")).toBe("123");
  });
});
