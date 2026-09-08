import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SEAT_PITCH,
  parseSeatPoints,
  seatFieldPitch,
} from "./seat-canvas";

/**
 * 这里每一条测的都是**同一类故障**：解析出错时页面不会报错，只会安静地少画东西
 * 或者整张图变白。肉眼验收看到的是"图没出来"，看不出是哪一步塌的。
 */

const doc = (seats: unknown[]) => ({
  schemaVersion: 1,
  world: { width: 100, height: 100 },
  zones: [],
  seats,
});

const seat = (externalId: string, x: number, y: number) => ({
  externalId,
  zoneExternalId: "z1",
  label: "A1",
  kind: "seat",
  rank: "normal",
  ordinal: 0,
  x,
  y,
});

describe("parseSeatPoints —— 正常数据", () => {
  test("只带出坐标和标识，其余字段一律不进结果", () => {
    // 多带一个字段就多一分格式变更时静默失效的面积；也是隐私的第一道闸——
    // label 一旦进了这里，就迟早会有人顺手把它发给 h5。
    const points = parseSeatPoints(doc([seat("s1", 10, 20)]));

    expect(points).toEqual([{ externalId: "s1", x: 10, y: 20 }]);
  });

  test("负坐标照常保留", () => {
    // 区域与座位解耦之后座位可以向四周延伸（docs/seating-canvas.md），
    // 负坐标是正常数据，不是脏数据。
    const points = parseSeatPoints(doc([seat("s1", -240, -160)]));

    expect(points).toEqual([{ externalId: "s1", x: -240, y: -160 }]);
  });

  test("空画布返回空数组，不是 null", () => {
    // null 和 [] 对调用方是两件事：null 该降级成"只给编号不给图"，
    // [] 是一张合法的空图。混成一个值，降级分支就再也分不出来了。
    expect(parseSeatPoints(doc([]))).toEqual([]);
  });
});

describe("parseSeatPoints —— 整份作废", () => {
  test.each([
    ["不是对象", "svg-canvas-v1"],
    ["是 null", null],
    ["是数组", [] as unknown],
  ])("%s 时返回 null", (_label, data) => {
    expect(parseSeatPoints(data)).toBeNull();
  });

  test("版本不认识时返回 null，不去猜字段", () => {
    // 换代渲染器的坐标可能根本不叫 x/y。猜错的表现是画出一张位置全错的图，
    // 而那比不给图糟得多——它看起来是对的。
    expect(
      parseSeatPoints({ ...doc([seat("s1", 1, 2)]), schemaVersion: 2 }),
    ).toBeNull();
  });

  test("seats 不是数组时返回 null", () => {
    expect(parseSeatPoints({ schemaVersion: 1, seats: {} })).toBeNull();
  });
});

describe("parseSeatPoints —— 脏座位只跳过它自己", () => {
  test("NaN / Infinity 坐标被剔除，其余照常返回", () => {
    // 手改过的 blob 塞得进这两个值，而它们会一路传染到包围盒、长宽比和缩放
    // 倍率，最终整张图变成空白——不报错，只是什么都不画。
    const points = parseSeatPoints(
      doc([
        seat("bad-nan", Number.NaN, 0),
        seat("bad-inf", 0, Number.POSITIVE_INFINITY),
        seat("good", 5, 6),
      ]),
    );

    expect(points).toEqual([{ externalId: "good", x: 5, y: 6 }]);
  });

  test("缺字段、类型不对、标识为空的座位都被跳过", () => {
    const points = parseSeatPoints(
      doc([
        { externalId: "no-coords" },
        seat("", 1, 1),
        { externalId: 7, x: 1, y: 1 },
        { externalId: "str-coords", x: "1", y: "1" },
        null,
        seat("good", 5, 6),
      ]),
    );

    expect(points).toEqual([{ externalId: "good", x: 5, y: 6 }]);
  });

  test("一千个座位里有一个坏的，另外九百九十九个照样看得见", () => {
    // 整份作废是最容易写出来的实现，也是最糟的：一个坏点毁掉整场活动的座位图。
    const seats = Array.from({ length: 1000 }, (_, index) =>
      seat(`s${index}`, index, 0),
    );
    seats[500] = seat("broken", Number.NaN, 0);

    expect(parseSeatPoints(doc(seats))).toHaveLength(999);
  });
});

describe("seatFieldPitch —— 圆点画多大只由它决定", () => {
  test("规则网格上就是网格间距", () => {
    const points = Array.from({ length: 25 }, (_, index) => ({
      x: (index % 5) * 48,
      y: Math.floor(index / 5) * 48,
    }));

    expect(seatFieldPitch(points)).toBe(48);
  });

  test("单排座位：包围盒高度为 0 也算得出来", () => {
    // 按面积估格子边长的话，高度 0 会让格子退化到接近 0，周围 8 格里一个邻居
    // 都找不到，中位数被少数异常点接管。领导席、单排看台踩出来的。
    const points = Array.from({ length: 12 }, (_, index) => ({
      x: index * 48,
      y: 0,
    }));

    expect(seatFieldPitch(points)).toBe(48);
  });

  test("取中位数，两个贴脸的座位不能把整片区拖到最低档", () => {
    const points = Array.from({ length: 20 }, (_, index) => ({
      x: index * 50,
      y: 0,
    }));
    points.push({ x: 1, y: 0 }); // 和第一个几乎重合

    expect(seatFieldPitch(points)).toBe(50);
  });

  test("重合的座位不算作距离 0", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 80, y: 0 },
    ];

    expect(seatFieldPitch(points)).toBe(40);
  });

  test.each([
    ["空", []],
    ["只有一个座位", [{ x: 5, y: 5 }]],
  ])("%s 时返回兜底值，不返回 0 或 NaN", (_label, points) => {
    // 返回 0 会一路除下去变成 Infinity，表现是整张图消失。
    expect(seatFieldPitch(points)).toBe(DEFAULT_SEAT_PITCH);
  });

  test("全部座位重合时返回兜底值", () => {
    const points = Array.from({ length: 10 }, () => ({ x: 3, y: 4 }));

    expect(seatFieldPitch(points)).toBe(DEFAULT_SEAT_PITCH);
  });
});
