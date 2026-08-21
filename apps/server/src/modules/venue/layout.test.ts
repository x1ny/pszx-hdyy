import { describe, expect, test } from "bun:test";
import {
  planSeats,
  planZones,
  resolveSeatZones,
  type SeatRow,
  type ZoneRow,
} from "./layout";
import type { SeatDraft, ZoneDraft } from "./schema";

/**
 * 归并是整个 venue 模块最容易写错的一段，也是唯一完全没有 I/O、能被彻底覆盖的
 * 一段——docs/场地排位编辑器设计.md §5 把这类逻辑列为「必须补单测」的第一档，
 * 理由是参考实现（旧系统）是未经验证的 AI demo，不带任何正确性信用。
 */

const zoneRow = (over: Partial<ZoneRow> = {}): ZoneRow => ({
  id: 1,
  externalId: "z1",
  name: "主会场 A 区",
  kind: "seating",
  ordinal: 0,
  ...over,
});

const zoneDraft = (over: Partial<ZoneDraft> = {}): ZoneDraft => ({
  externalId: "z1",
  name: "主会场 A 区",
  kind: "seating",
  ordinal: 0,
  ...over,
});

const seatRow = (over: Partial<SeatRow> = {}): SeatRow => ({
  id: 10,
  zoneId: 1,
  externalId: "s1",
  label: "A1",
  kind: "seat",
  rank: "normal",
  ordinal: 0,
  ...over,
});

describe("planZones", () => {
  test("库里没有的区域进 insert", () => {
    const plan = planZones([], [zoneDraft({ externalId: "z9" })]);

    expect(plan.insert).toHaveLength(1);
    expect(plan.insert[0]?.externalId).toBe("z9");
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  test("字段没变的区域不进 update", () => {
    const plan = planZones([zoneRow()], [zoneDraft()]);

    // 全量 update 会让一次保存对上千行各发一条 UPDATE，而实际改动通常只有几个。
    expect(plan.update).toEqual([]);
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  test("改名进 update 并带上原行 id", () => {
    const plan = planZones([zoneRow()], [zoneDraft({ name: "主会场 B 区" })]);

    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]?.id).toBe(1);
    expect(plan.update[0]?.draft.name).toBe("主会场 B 区");
  });

  test("投影里消失的区域进 remove", () => {
    const plan = planZones([zoneRow({ id: 7, externalId: "gone" })], []);

    expect(plan.remove).toEqual([7]);
  });
});

describe("planSeats", () => {
  test("跨区域拖动是一次 update，不是删了再建", () => {
    // 归并键是 (场地, externalId) 而不是 (区域, externalId)，为的就是让位置
    // 换区域时保住原行 id。按区域建键的话这里会变成 remove + insert。
    const plan = planSeats(
      [seatRow({ zoneId: 1 })],
      [
        {
          externalId: "s1",
          zoneId: 2,
          label: "A1",
          kind: "seat",
          rank: "normal",
          ordinal: 0,
        },
      ],
    );

    expect(plan.remove).toEqual([]);
    expect(plan.insert).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]?.id).toBe(10);
    expect(plan.update[0]?.draft.zoneId).toBe(2);
  });

  test("等级变化能被识别", () => {
    const plan = planSeats(
      [seatRow()],
      [
        {
          externalId: "s1",
          zoneId: 1,
          label: "A1",
          kind: "seat",
          rank: "vip",
          ordinal: 0,
        },
      ],
    );

    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]?.draft.rank).toBe("vip");
  });

  test("同区域内两个位置对调编号，产出两条 update", () => {
    // 这个用例是 schema.ts 里「不建 unique(zone_id, label)」那条决定的依据：
    // 对调编号是合法操作，而逐语句检查的唯一约束会在第一条 UPDATE 上就炸。
    const plan = planSeats(
      [
        seatRow({ id: 10, externalId: "s1", label: "A1" }),
        seatRow({ id: 11, externalId: "s2", label: "A2" }),
      ],
      [
        {
          externalId: "s1",
          zoneId: 1,
          label: "A2",
          kind: "seat",
          rank: "normal",
          ordinal: 0,
        },
        {
          externalId: "s2",
          zoneId: 1,
          label: "A1",
          kind: "seat",
          rank: "normal",
          ordinal: 0,
        },
      ],
    );

    expect(plan.update.map((item) => [item.id, item.draft.label])).toEqual([
      [10, "A2"],
      [11, "A1"],
    ]);
    expect(plan.remove).toEqual([]);
  });
});

describe("resolveSeatZones", () => {
  const draft = (zoneExternalId: string): SeatDraft => ({
    externalId: "s1",
    zoneExternalId,
    label: "A1",
    kind: "seat",
    rank: "normal",
    ordinal: 0,
  });

  test("按 externalId 换成 zoneId，并且不把 zoneExternalId 带下去", () => {
    const resolved = resolveSeatZones([draft("z1")], new Map([["z1", 42]]));

    expect(resolved).toHaveLength(1);
    expect(resolved?.[0]?.zoneId).toBe(42);
    expect(resolved?.[0]).not.toHaveProperty("zoneExternalId");
  });

  test("指向不存在的区域时整批返回 null", () => {
    // superRefine 已经挡过一道，这里是「校验和归并之间被改坏」的兜底：
    // 宁可整次保存失败，也不要静默丢掉几个位置。
    expect(resolveSeatZones([draft("nope")], new Map([["z1", 42]]))).toBeNull();
  });
});
