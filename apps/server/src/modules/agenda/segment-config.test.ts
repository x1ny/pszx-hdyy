import { describe, expect, test } from "bun:test";
import { normalizeResourceFields } from "./segment-config";
import { SaveSegmentConfigInput } from "./validation";

/**
 * 这个文件测的是聚合保存里**不需要数据库就能测的那一半**：入参形状和用车字段
 * 的收敛。事务顺序、回滚、tempKey 解析要连库才测得了，仓库目前没有集成测试
 * 装置（`routes.test.ts` 那些是钉 SQL 字符串，不执行），只能靠手工路径覆盖。
 *
 * 所以这里挑的每一条都是"写错了不会报错、只会静默产生脏数据"的那种规则。
 */

const baseInput = {
  activityId: 1,
  base: {
    name: "开幕式",
    segmentType: "keynote" as const,
    agendaLineId: null,
    startTime: "2026-04-17T09:00:00.000Z",
    endTime: "2026-04-17T10:00:00.000Z",
    memberEnabled: true,
    seatingEnabled: false,
  },
};

const transportFields = {
  transportScene: "pickup" as const,
  name: "机场一号车",
};

describe("SaveSegmentConfigInput", () => {
  test("segmentId 缺省表示新建", () => {
    const parsed = SaveSegmentConfigInput.parse(baseInput);
    expect(parsed.segmentId).toBeNull();
  });

  test("人员三种意图各自默认空数组，不会因为没传就崩", () => {
    const parsed = SaveSegmentConfigInput.parse(baseInput);
    expect(parsed.members).toEqual({
      add: [],
      addNew: [],
      remove: [],
      updateRoles: [],
      cascadeSeats: false,
    });
  });

  /**
   * `record_only` 的需求项按定义不产生台账记录，checkDemandsLinkable 也会拒绝
   * 关联。在入参层先挡一次，用户看到的才是一句人话而不是写到一半才失败。
   */
  test("仅记录需求的需求项不能带资源安排", () => {
    const result = SaveSegmentConfigInput.safeParse({
      ...baseInput,
      demands: [
        {
          resourceType: "transport",
          handling: "record_only",
          resources: [
            { kind: "create", tempKey: "r1", fields: transportFields },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("仅记录需求");
  });

  test("落实安排的需求项可以带资源安排", () => {
    const result = SaveSegmentConfigInput.safeParse({
      ...baseInput,
      demands: [
        {
          resourceType: "transport",
          handling: "arrange",
          resources: [
            { kind: "create", tempKey: "r1", fields: transportFields },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  /**
   * 绑定目标是两种形状之一：已有的活动人员关系，或本次草稿里刚加的人。
   * 两个都不给的对象必须被拒——放过去的话它会在编排里变成一次静默跳过的绑定。
   */
  test("绑定目标必须是 activityMemberId 或 memberTempKey 之一", () => {
    const withTempKey = SaveSegmentConfigInput.safeParse({
      ...baseInput,
      demands: [
        {
          resourceType: "transport",
          handling: "arrange",
          resources: [
            {
              kind: "create",
              tempKey: "r1",
              fields: transportFields,
              bindTargets: [{ memberTempKey: "m1" }],
            },
          ],
        },
      ],
    });
    expect(withTempKey.success).toBe(true);

    const empty = SaveSegmentConfigInput.safeParse({
      ...baseInput,
      demands: [
        {
          resourceType: "transport",
          handling: "arrange",
          resources: [
            {
              kind: "create",
              tempKey: "r1",
              fields: transportFields,
              bindTargets: [{}],
            },
          ],
        },
      ],
    });
    expect(empty.success).toBe(false);
  });

  /**
   * 资源安排的可选文本必须收敛成 **null 而不是 undefined**：它走的是 update
   * 路径，drizzle 的 `.set()` 会跳过 undefined 的键，于是用户永远清不掉一个
   * 已经填过的字段。这条一旦回归，症状是"删空保存后旧值又回来了"。
   */
  test("资源安排的可选文本清空后是 null，不是 undefined", () => {
    const parsed = SaveSegmentConfigInput.parse({
      ...baseInput,
      demands: [
        {
          resourceType: "transport",
          handling: "arrange",
          resources: [
            {
              kind: "existing",
              resourceId: 9,
              fields: { ...transportFields, location: "  ", driverName: "" },
            },
          ],
        },
      ],
    });

    const entry = parsed.demands[0].resources[0];
    if (entry.kind !== "existing" || !entry.fields) throw new Error("形状不对");
    expect(entry.fields.location).toBeNull();
    expect(entry.fields.driverName).toBeNull();
  });

  test("环节身份的空串收敛成 null（选择器的「请选择」那一项）", () => {
    const parsed = SaveSegmentConfigInput.parse({
      ...baseInput,
      members: { add: [{ tempKey: "m1", memberId: 3, segmentRole: "" }] },
    });
    expect(parsed.members.add[0].segmentRole).toBeNull();
  });
});

describe("normalizeResourceFields", () => {
  const fields = {
    transportScene: "pickup" as const,
    name: "机场一号车",
    quantity: null,
    startTime: null,
    endTime: null,
    location: null,
    vehicleInfo: "闽C·12345",
    driverName: "老陈",
    driverPhone: "13800000000",
    ownerName: null,
    remark: null,
  };

  test("用车记录原样保留车辆和司机信息", () => {
    const result = normalizeResourceFields("transport", fields, "第 1 条");
    if (!result.ok) throw new Error(result.message);
    expect(result.values.vehicleInfo).toBe("闽C·12345");
    expect(result.values.transportScene).toBe("pickup");
  });

  /**
   * 非用车记录上这四列必须为空，表上有 `chk_resource_transport_only` 兜底。
   * 不清的话，"先在用车需求下填了车牌、又把这条安排挪到用餐"就会写出一条带
   * 车牌的用餐记录——运行时是一个 500，不是一句人话。
   */
  test("非用车记录清空用车专属的四列", () => {
    const result = normalizeResourceFields("dining", fields, "第 1 条");
    if (!result.ok) throw new Error(result.message);
    expect(result.values.transportScene).toBeNull();
    expect(result.values.vehicleInfo).toBeNull();
    expect(result.values.driverName).toBeNull();
    expect(result.values.driverPhone).toBeNull();
    // 公共字段不受影响
    expect(result.values.name).toBe("机场一号车");
  });

  test("用车必须选场景", () => {
    const result = normalizeResourceFields(
      "transport",
      { ...fields, transportScene: null },
      "第 1 条",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("用车场景");
  });

  test("结束时间早于开始时间被拒", () => {
    const result = normalizeResourceFields(
      "transport",
      {
        ...fields,
        startTime: new Date("2026-04-17T10:00:00Z"),
        endTime: new Date("2026-04-17T09:00:00Z"),
      },
      "第 1 条",
    );
    expect(result.ok).toBe(false);
  });

  test("开始等于结束是合法的（瞬时资源）", () => {
    const at = new Date("2026-04-17T10:00:00Z");
    const result = normalizeResourceFields(
      "transport",
      { ...fields, startTime: at, endTime: at },
      "第 1 条",
    );
    expect(result.ok).toBe(true);
  });
});
