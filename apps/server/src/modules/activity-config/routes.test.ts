import { describe, expect, test } from "bun:test";
import type { SeatingSummary } from "../seating/stats";
import { checkInvitation, checkSeating, checkVenue } from "./routes";

/**
 * 只测判定，不测取数。
 *
 * 判定错了**不会报错**，只会在页面上显示一个错的数字或一个错的颜色——最难发现
 * 的那类 bug。取数那几个 count 反而没什么可测的，而且要测就得连数据库，全仓库
 * 没有一个模块这么做。
 */

const seating = (over: Partial<SeatingSummary> = {}): SeatingSummary => ({
  applicable: 0,
  unconfigured: 0,
  pending: 0,
  confirmed: 0,
  rejected: 0,
  ...over,
});

describe("checkVenue", () => {
  test("有可用区域就算配好，哪怕没有环节开排位", () => {
    const item = checkVenue({
      venues: 1,
      zones: 2,
      capacity: 236,
      venueRows: 1,
      seatingApplicable: 0,
    });
    // done 的判断必须排在适用性前面：已经做过的事不该被说成"不需要做"。
    expect(item.status).toBe("done");
    expect(item.detail).toContain("236");
  });

  test("没配也没有环节开排位 → 不适用，不进分母", () => {
    const item = checkVenue({
      venues: 0,
      zones: 0,
      capacity: 0,
      venueRows: 0,
      seatingApplicable: 0,
    });
    expect(item.status).toBe("not_applicable");
    expect(item.hint).toBeNull();
  });

  test("有环节开排位却没引用场地 → 缺", () => {
    const item = checkVenue({
      venues: 0,
      zones: 0,
      capacity: 0,
      venueRows: 0,
      seatingApplicable: 2,
    });
    expect(item.status).toBe("missing");
    expect(item.hint).toContain("场地库");
  });

  test("引用了场地但一个可用区域都没有 → 仍然算缺，且换一句提示", () => {
    // 源场地本身没画区域时会撞上。这时排位照样建不起来，报 done 是骗人的；
    // 而"去引用一个场地"这句提示会把人指错地方——他已经引用过了。
    const item = checkVenue({
      venues: 0,
      zones: 0,
      capacity: 0,
      venueRows: 1,
      seatingApplicable: 1,
    });
    expect(item.status).toBe("missing");
    expect(item.hint).toContain("启用");
  });
});

describe("checkSeating", () => {
  test("没有环节开排位 → 不适用", () => {
    expect(checkSeating(seating(), false).status).toBe("not_applicable");
  });

  test("全部已确认才算配好", () => {
    const item = checkSeating(seating({ applicable: 3, confirmed: 3 }), true);
    expect(item.status).toBe("done");
  });

  test("待确认不算配好", () => {
    // confirm 才是对外生效的动作（version 只在 confirm 时 +1）。保存了但没人
    // 确认的方案，现实里等于没排。
    const item = checkSeating(
      seating({ applicable: 2, confirmed: 1, pending: 1 }),
      true,
    );
    expect(item.status).toBe("missing");
    expect(item.detail).toContain("1 个待确认");
  });

  test("已驳回和未配置都进 detail，已确认的不进", () => {
    const item = checkSeating(
      seating({ applicable: 4, confirmed: 1, unconfigured: 2, rejected: 1 }),
      true,
    );
    expect(item.detail).toContain("2 个未配置");
    expect(item.detail).toContain("1 个已驳回");
    expect(item.detail).not.toContain("已确认");
  });

  test("场地没配好时，提示指向场地空间而不是排位页", () => {
    // 用户点进排位页能做的只有被区域选择器告知"先去场地空间"，那就直接指过去。
    const item = checkSeating(
      seating({ applicable: 1, unconfigured: 1 }),
      false,
    );
    expect(item.hint).toContain("场地空间");
    // 不能替场地那一项说补法：场地已引用、区域全停用时，"去引用一个场地"
    // 会把人指错地方。具体怎么补归 checkVenue，这里只管把人指过去。
    expect(item.hint).not.toContain("引用一个场地");
    expect(
      checkSeating(seating({ applicable: 1, unconfigured: 1 }), true).hint,
    ).toContain("排位页");
  });
});

describe("checkInvitation", () => {
  test("没生成过 → 不适用，永远不报缺", () => {
    // 系统无从知道这个活动该不该发函，也无从知道谁该收。报缺就是永久红点。
    const item = checkInvitation({ batches: 0, letters: 0 });
    expect(item.status).toBe("not_applicable");
    expect(item.status).not.toBe("missing");
  });

  test("生成过就算配好", () => {
    const item = checkInvitation({ batches: 2, letters: 82 });
    expect(item.status).toBe("done");
    expect(item.detail).toContain("2 批共 82 份");
  });
});

describe("分母", () => {
  test("not_applicable 不进分母，done 和 missing 才进", () => {
    const items = [
      checkVenue({
        venues: 0,
        zones: 0,
        capacity: 0,
        venueRows: 0,
        seatingApplicable: 0,
      }),
      checkSeating(seating(), false),
      checkInvitation({ batches: 1, letters: 5 }),
    ];
    const countable = items.filter(
      (i) => i.status === "done" || i.status === "missing",
    );
    // 场地和排位都不适用，只有发过函的邀请函那一项进分母。
    expect(countable).toHaveLength(1);
    expect(countable[0]?.key).toBe("invitation");
  });
});
