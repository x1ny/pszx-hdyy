import { describe, expect, test } from "bun:test";
import {
  findInvalidAssignments,
  isWritable,
  type PlanSeatDraft,
  type PlanSeatRow,
  planSeatMerge,
} from "./plan";

const row = (over: Partial<PlanSeatRow> & { id: number }): PlanSeatRow => ({
  externalId: `s${over.id}`,
  label: `A${over.id}`,
  kind: "seat",
  rank: "normal",
  enabled: true,
  ordinal: 0,
  ...over,
});

const draft = (
  externalId: string,
  over: Partial<PlanSeatDraft> = {},
): PlanSeatDraft => ({
  externalId,
  label: `A${externalId.slice(1)}`,
  kind: "seat",
  rank: "normal",
  enabled: true,
  ordinal: 0,
  ...over,
});

describe("planSeatMerge", () => {
  test("新 externalId 走插入", () => {
    const plan = planSeatMerge([], [draft("s1"), draft("s2")], new Map());

    expect(plan.insert).toHaveLength(2);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  test("没有任何字段变化时不产生 UPDATE", () => {
    // 1000 个座位各发一条 UPDATE 是这条要防的事。
    const plan = planSeatMerge([row({ id: 1 })], [draft("s1")], new Map());

    expect(plan.insert).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  test("改编号 / 等级 / 顺序都算变化", () => {
    const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })];
    const plan = planSeatMerge(
      rows,
      [
        draft("s1", { label: "改过" }),
        draft("s2", { rank: "vip" }),
        draft("s3", { ordinal: 7 }),
      ],
      new Map(),
    );

    expect(plan.update.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  test("空位置消失就是软删，不进 blocked", () => {
    const plan = planSeatMerge(
      [row({ id: 1 }), row({ id: 2 })],
      [draft("s1")],
      new Map(),
    );

    expect(plan.remove).toEqual([2]);
    expect(plan.blocked).toEqual([]);
  });

  test("有人坐的位置消失 → 整次保存被拒", () => {
    const plan = planSeatMerge(
      [row({ id: 1 }), row({ id: 2, label: "B2" })],
      [draft("s1")],
      new Map([[2, "张三"]]),
    );

    // 被挡下的那行**不进 remove**：整次保存都不该落地，
    // 调用方看到 blocked 非空就直接回滚。
    expect(plan.remove).toEqual([]);
    expect(plan.blocked).toEqual([
      { seatId: 2, label: "B2", memberName: "张三", reason: "removed" },
    ]);
  });

  test("有人坐的位置被禁用，和删除同等处理", () => {
    // 这条是设计里特意补的洞：只比数量的话，"启用位置 1 ≥ 分配 1"照样成立，
    // 人却坐在一个禁用位置上。
    const plan = planSeatMerge(
      [row({ id: 1, label: "A1" })],
      [draft("s1", { enabled: false })],
      new Map([[1, "李四"]]),
    );

    expect(plan.update).toEqual([]);
    expect(plan.blocked).toEqual([
      { seatId: 1, label: "A1", memberName: "李四", reason: "disabled" },
    ]);
  });

  test("没人坐的位置可以随便禁用", () => {
    const plan = planSeatMerge(
      [row({ id: 1 })],
      [draft("s1", { enabled: false })],
      new Map(),
    );

    expect(plan.blocked).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]?.draft.enabled).toBe(false);
  });

  test("禁用 → 启用不需要检查占座", () => {
    // 反方向是安全的：把一个位置重新打开，不会让任何人失去座位。
    const plan = planSeatMerge(
      [row({ id: 1, enabled: false })],
      [draft("s1", { enabled: true })],
      new Map([[1, "王五"]]),
    );

    expect(plan.blocked).toEqual([]);
    expect(plan.update).toHaveLength(1);
  });

  test("已禁用且有人的位置再消失，仍然拦得住", () => {
    const plan = planSeatMerge(
      [row({ id: 9, label: "C9", enabled: false })],
      [],
      new Map([[9, "赵六"]]),
    );

    expect(plan.remove).toEqual([]);
    expect(plan.blocked[0]?.reason).toBe("removed");
  });
});

describe("findInvalidAssignments", () => {
  const seats = new Map([
    [1, { label: "A1", enabled: true, removed: false }],
    [2, { label: "A2", enabled: false, removed: false }],
    [3, { label: "A3", enabled: true, removed: true }],
  ]);

  test("位置有效时放行", () => {
    expect(
      findInvalidAssignments([{ seatId: 1, memberName: "张三" }], seats),
    ).toEqual([]);
  });

  test("坐在禁用位置上要拦", () => {
    const invalid = findInvalidAssignments(
      [{ seatId: 2, memberName: "李四" }],
      seats,
    );
    expect(invalid).toEqual([
      { seatId: 2, label: "A2", memberName: "李四", reason: "disabled" },
    ]);
  });

  test("坐在已软删位置上要拦", () => {
    expect(
      findInvalidAssignments([{ seatId: 3, memberName: "王五" }], seats)[0]
        ?.reason,
    ).toBe("removed");
  });

  test("指向根本不存在的位置也要拦，不能静默放过", () => {
    const invalid = findInvalidAssignments(
      [{ seatId: 99, memberName: "钱七" }],
      seats,
    );
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.label).toBe("#99");
  });
});

describe("isWritable", () => {
  test("作废是终态", () => {
    expect(isWritable("voided")).toBe(false);
  });

  test("其余状态都能继续写——已确认的也能，写完打回 pending", () => {
    for (const status of ["pending", "confirmed", "rejected"]) {
      expect(isWritable(status)).toBe(true);
    }
  });
});
