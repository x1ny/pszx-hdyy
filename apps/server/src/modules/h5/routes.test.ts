import { describe, expect, test } from "bun:test";
import {
  maskMobile,
  resolveActivityMemberQuery,
  resolveH5ActivityQuery,
} from "./auth";
import {
  itineraryCarsQuery,
  itineraryContactQuery,
  itineraryHeroQuery,
  itinerarySeatsQuery,
  itinerarySegmentsQuery,
  itineraryTripsQuery,
  planLiveSeatIdsQuery,
  seatMapQuery,
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

describe("resolveH5ActivityQuery —— 分享 token 换活动", () => {
  const rendered = resolveH5ActivityQuery("Z1rj6i-L0_qA").toSQL();

  test("只按数据库里的短分享 token 查活动，不读取连续 id", () => {
    expect(rendered.sql).toContain('"activity"."itinerary_share_token" =');
    expect(rendered.params).toContain("Z1rj6i-L0_qA");
    expect(rendered.sql).not.toContain('"activity"."id" =');
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
    //
    // 原先这里断言的是整条 SQL 里没有 "left join"。座位图入口加进来之后那条太宽
    // 了 —— 画布那一路**必须**是 left join（见下一个用例），所以收紧成只钉方案。
    expect(rendered.sql).not.toContain('left join "segment_seating_plan"');
    expect(rendered.sql).not.toContain('left join "seat_assignment"');
  });

  test("画布只探 renderer_kind，绝不把 data 列拉进行程页", () => {
    // 行程页一次返回整页，一位嘉宾可能有三五个带排位的环节。这里多 select 一个
    // `data`，首屏就要顺带拉走几百 KB 的 jsonb 并反序列化 —— 而它唯一的用途只是
    // 决定三颗按钮显不显示。真正的解析在 /getSeatMap，点开才付代价。
    expect(rendered.sql).toContain('"segment_seating_layout"."renderer_kind"');
    expect(rendered.sql).not.toContain('"segment_seating_layout"."data"');
  });

  test("画布那一路是 left join：方案存在但没画过图时，座位号照样给", () => {
    // 退化成 inner join 的话，没画图的方案会连座位号一起消失 —— 嘉宾丢的不是
    // 一张示意图，是他照着坐的那个编号。
    expect(rendered.sql).toContain('left join "segment_seating_layout"');
  });
});

describe("seatMapQuery —— 越权挡在查询形状上", () => {
  const rendered = seatMapQuery(7, 42, 99).toSQL();

  test("入口是 segment_member 且锚死 member_id，改 segmentId 探不到别人", () => {
    // `segmentId` 是不可信输入。这条查询从"这个人的环节人员关系"出发，所以传
    // 任何 segmentId 都只可能查出他自己有座位的那个环节 —— 越权不靠 handler 里
    // 记得写 if 来挡，靠这里的 from / join 形状。
    expect(rendered.sql).toStartWith('select "segment_seating_plan"."id"');
    expect(rendered.sql).toContain('from "segment_member"');
    expect(rendered.sql).toContain('"segment_member"."member_id" =');
    expect(rendered.sql).toContain('"segment_member"."activity_id" =');
    expect(rendered.sql).toContain('"segment_member"."segment_id" =');
    expect(rendered.params).toContain(42);
    expect(rendered.params).toContain(7);
    expect(rendered.params).toContain(99);
  });

  test("和 itinerarySeatsQuery 同一条 confirmed 口径", () => {
    // 两边必须同步：那边决定按钮显不显示，这边决定点开有没有图。一边放宽而
    // 另一边没跟上，表现就是按钮出现了、点开却是「暂不可用」。
    expect(rendered.sql).toContain('"segment_seating_plan"."status" =');
    expect(rendered.params).toContain("confirmed");
    expect(rendered.sql).toContain('"seat_assignment"."revoked_at" is null');
  });

  test("全链 inner join：缺任何一环都该查不到，而不是漏出半份数据", () => {
    expect(rendered.sql).not.toContain("left join");
  });

  test("不 select 任何属于别人的字段", () => {
    // 这条载荷会整份发给公众端。凭证只是一个手机号，挡不住拿到转发链接的人 ——
    // 所以隐私靠"根本不查"，不靠前端拿到了但不渲染。
    expect(rendered.sql).not.toContain('"member"."name"');
    expect(rendered.sql).not.toContain("mobile");
    expect(rendered.sql).not.toContain("organization");
  });
});

describe("planLiveSeatIdsQuery —— 图上的点等于现场真实的位置", () => {
  const rendered = planLiveSeatIdsQuery(5).toSQL();

  test("软删的位置不画", () => {
    expect(rendered.sql).toContain('"segment_seat"."removed_at" is null');
    expect(rendered.sql).toContain('"segment_seat"."plan_id" =');
    expect(rendered.params).toContain(5);
  });

  test("停用的位置**照画** —— 那是「这次不安排人坐」，椅子还在", () => {
    // 加一条 enabled 过滤是很自然的手误，后果是图上凭空少几个点，嘉宾数到自己
    // 那一排会对不上。后台画布上停用的位置也是画出来的，只是灰掉。
    expect(rendered.sql).not.toContain("enabled");
  });

  test("只取 external_id 一列，不把 label 顺手带出来", () => {
    expect(rendered.sql).toStartWith(
      'select "external_id" from "segment_seat"',
    );
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

  test("用车带回后台确认的定位点，供移动端显示导航入口", () => {
    expect(itineraryCarsQuery(9).toSQL().sql).toContain(
      '"activity_resource"."location_point"',
    );
  });

  test("用车走 inner join，没绑人的资源不会漏给所有人", () => {
    expect(itineraryCarsQuery(9).toSQL().sql).not.toContain("left join");
  });
});

describe("itineraryContactQuery —— 现场联系人按活动人员关系取", () => {
  const rendered = itineraryContactQuery(9).toSQL();

  test("按 activity_member_id 查，不是按 member_id", () => {
    // 同一个人在别的活动里可能挂着不同的对接人。按 member_id 查的话，会把
    // 那场活动的联系人串进这场活动的页面——同到离行程、用车两个查询一样的坑。
    expect(rendered.sql).toContain('"activity_member"."id" =');
    expect(rendered.params).toContain(9);
  });

  test("只取 owner_name / owner_phone 两列，不把整行发给浏览器", () => {
    // 单表 select 时 drizzle 出的是不带表名前缀的列名（同 itinerarySegmentsQuery
    // 和 itineraryTripsQuery），所以这里断言的是 select 列表本身的样子。
    expect(rendered.sql).toStartWith(
      'select "owner_name", "owner_phone" from "activity_member"',
    );
    // 这一行上还挂着 remark、source、groupName 这些只给运营看的字段，一个都不能
    // 跟着发到公众端去。
    expect(rendered.sql).not.toContain("remark");
    expect(rendered.sql).not.toContain("source");
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
