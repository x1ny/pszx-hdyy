import { describe, expect, test } from "vitest";
import { isProjectionStable } from "../contract";
import { structuralEditor } from "./index";
import {
  docFromProjection,
  emptyDoc,
  generateSeats,
  projectStructural,
  type StructuralDoc,
  validateDoc,
} from "./model";

const doc = (): StructuralDoc => ({
  schemaVersion: 1,
  zones: [
    { externalId: "z1", name: "主秀场 A 区", kind: "seating", ordinal: 0 },
    { externalId: "z2", name: "签到区", kind: "checkin", ordinal: 1 },
  ],
  seats: [
    {
      externalId: "s1",
      zoneExternalId: "z1",
      label: "A1",
      kind: "seat",
      rank: "vip",
      ordinal: 0,
    },
    {
      externalId: "s2",
      zoneExternalId: "z1",
      label: "A2",
      kind: "seat",
      rank: "normal",
      ordinal: 1,
    },
  ],
});

describe("project 的幂等性", () => {
  // docs/场地排位底层设计.md §4 的硬要求：同一份 data 两次投影出的 externalId
  // 必须一致，否则服务端的归并算法每次都判成"删掉全部旧的、插入全部新的"，
  // 有分配的位置会让整次保存被拒。每个编辑器实现都要有这条。
  test("同一份文档两次投影，标识完全一致", () => {
    expect(isProjectionStable(structuralEditor, doc())).toBe(true);
  });

  test("投影是恒等映射，不丢字段", () => {
    const projection = projectStructural(doc());

    expect(projection.zones).toHaveLength(2);
    expect(projection.seats).toHaveLength(2);
    expect(projection.seats[0]).toEqual({
      externalId: "s1",
      zoneExternalId: "z1",
      label: "A1",
      kind: "seat",
      rank: "vip",
      ordinal: 0,
    });
  });
});

describe("safeParse", () => {
  test("能解析自己写出去的文档", () => {
    expect(structuralEditor.safeParse(doc())).toEqual(doc());
  });

  test("别的渲染器的 blob 解不出来，返回 null 而不是抛", () => {
    // 这是降级视图的触发条件：解不出来就从服务端的区域和位置反推。
    expect(
      structuralEditor.safeParse({ elements: [], preset: "theater" }),
    ).toBeNull();
    expect(structuralEditor.safeParse(null)).toBeNull();
    expect(structuralEditor.safeParse("不是对象")).toBeNull();
  });

  test("缺字段的文档不放行", () => {
    expect(
      structuralEditor.safeParse({
        schemaVersion: 1,
        zones: [{ name: "A" }],
        seats: [],
      }),
    ).toBeNull();
  });
});

describe("docFromProjection", () => {
  test("能从核心表的区域和位置重建完整文档", () => {
    // 降级视图靠的就是这条：blob 一个字节都不用，光凭关系表就能重建编辑器状态。
    const source = projectStructural(doc());
    const rebuilt = docFromProjection(source);

    expect(rebuilt).toEqual(doc());
  });

  test("空场地重建成空文档", () => {
    expect(docFromProjection({ zones: [], seats: [] })).toEqual(emptyDoc());
  });
});

describe("validateDoc", () => {
  test("干净的文档没有问题", () => {
    expect(validateDoc(doc())).toEqual([]);
  });

  test("同一区域内编号重复要报出来", () => {
    // 数据库上没建 unique(zone_id, label)（编号对调是合法操作，会撞逐语句检查），
    // 这条规则守在应用层，所以这个用例是那个决定的配套保障。
    const bad = doc();
    bad.seats[1] = { ...bad.seats[1], label: "A1" };

    expect(validateDoc(bad)).toContainEqual({
      message: "同一区域内编号重复：A1",
    });
  });

  test("跨区域同名编号是允许的", () => {
    const ok = doc();
    ok.seats.push({
      externalId: "s3",
      zoneExternalId: "z2",
      label: "A1",
      kind: "standing",
      rank: "normal",
      ordinal: 2,
    });

    expect(validateDoc(ok)).toEqual([]);
  });

  test("位置指向被删掉的区域要报出来", () => {
    const bad = doc();
    bad.zones = bad.zones.filter((zone) => zone.externalId !== "z1");

    expect(validateDoc(bad)).toContainEqual({
      message: "位置 A1 所属的区域已被删除",
    });
  });
});

describe("generateSeats", () => {
  test("按前缀和起始序号批量生成", () => {
    const created = generateSeats({
      zoneExternalId: "z1",
      prefix: "B",
      start: 1,
      count: 3,
      kind: "seat",
      rank: "normal",
      existing: [],
    });

    expect(created.map((seat) => seat.label)).toEqual(["B1", "B2", "B3"]);
  });

  test("已存在的编号自动跳过，不报错", () => {
    // 用户想把已有 A1–A2 的区域补到 A4，填 1–4 应该正常工作。
    const created = generateSeats({
      zoneExternalId: "z1",
      prefix: "A",
      start: 1,
      count: 4,
      kind: "seat",
      rank: "normal",
      existing: doc().seats,
    });

    expect(created.map((seat) => seat.label)).toEqual(["A3", "A4"]);
  });

  test("只跟同一区域的编号比，不跨区域", () => {
    const created = generateSeats({
      zoneExternalId: "z2",
      prefix: "A",
      start: 1,
      count: 2,
      kind: "standing",
      rank: "normal",
      existing: doc().seats,
    });

    expect(created.map((seat) => seat.label)).toEqual(["A1", "A2"]);
  });

  test("生成的标识互不重复", () => {
    const created = generateSeats({
      zoneExternalId: "z1",
      prefix: "C",
      start: 1,
      count: 50,
      kind: "seat",
      rank: "normal",
      existing: [],
    });

    expect(new Set(created.map((seat) => seat.externalId)).size).toBe(50);
  });
});
