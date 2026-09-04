import { describe, expect, test } from "bun:test";
import {
  AddActivityMembersByOrganizationInput,
  AddProjectMembersByOrganizationInput,
  AddSegmentMembersByOrganizationInput,
  CreateMemberInput,
  ListActivityMembersInput,
  ListMembersInput,
  ListOrganizationMemberCandidatesInput,
  SyncActivityMemberSegmentsInput,
} from "./validation";

const base = { name: "王芳" };

const parse = (region: Record<string, string>) =>
  CreateMemberInput.safeParse({ ...base, ...region });

const firstIssue = (result: ReturnType<typeof parse>) =>
  result.success ? null : result.error.issues[0];

/**
 * 国别/地区 + 籍贯的规则。前端会把这些状态做成禁用和自动清空，这组用例守的是
 * **绕过前端直接打接口**的那条路——服务端才是权威校验方。
 */
describe("CreateMemberInput 的国别与籍贯", () => {
  test("中国籍可以选到省市两级", () => {
    const result = parse({
      countryRegionCode: "CN",
      nativeProvinceCode: "330000",
      nativeCityCode: "330100",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // 只收码，名字由路由层查字典派生 —— 校验结果里不该出现名字。
      expect(result.data).not.toHaveProperty("countryRegion");
      expect(result.data.nativeCityCode).toBe("330100");
    }
  });

  test("只选省不选市是合法的", () => {
    expect(
      parse({ countryRegionCode: "CN", nativeProvinceCode: "440000" }).success,
    ).toBe(true);
  });

  test("直辖市没有市级，省级止步同样合法", () => {
    expect(
      parse({ countryRegionCode: "CN", nativeProvinceCode: "110000" }).success,
    ).toBe(true);
  });

  test("两个字段都不填是合法的（文档 8.1.2：除姓名外都可为空）", () => {
    expect(CreateMemberInput.safeParse(base).success).toBe(true);
  });

  test("外籍不能带籍贯", () => {
    const result = parse({
      countryRegionCode: "US",
      nativeProvinceCode: "330000",
    });

    expect(result.success).toBe(false);
    expect(firstIssue(result)?.message).toBe("外籍无需填写籍贯");
    expect(firstIssue(result)?.path).toEqual(["nativeProvinceCode"]);
  });

  test("国别没填时也不收籍贯", () => {
    const result = parse({ nativeProvinceCode: "330000" });

    expect(result.success).toBe(false);
    expect(firstIssue(result)?.message).toBe("请先选择国别/地区");
  });

  test("市不属于所选省时拒绝", () => {
    const result = parse({
      countryRegionCode: "CN",
      nativeProvinceCode: "330000",
      nativeCityCode: "350500",
    });

    expect(result.success).toBe(false);
    expect(firstIssue(result)?.message).toBe("所选城市不属于该省份");
    expect(firstIssue(result)?.path).toEqual(["nativeCityCode"]);
  });

  test("有市无省时拒绝", () => {
    const result = parse({ countryRegionCode: "CN", nativeCityCode: "330100" });

    expect(result.success).toBe(false);
    expect(firstIssue(result)?.message).toBe("请先选择省份");
  });

  test("字典里没有的码一律拒绝", () => {
    // 港澳台不在国别列表里（它们在籍贯的省级列表），这条同时守住了那个加工规则。
    expect(parse({ countryRegionCode: "TW" }).success).toBe(false);
    expect(parse({ countryRegionCode: "ZZ" }).success).toBe(false);
    expect(
      parse({ countryRegionCode: "CN", nativeProvinceCode: "990000" }).success,
    ).toBe(false);
  });
});

describe("CreateMemberInput 的团体绑定", () => {
  test("允许绑定一个团体或保持为空", () => {
    expect(
      CreateMemberInput.parse({ ...base, organizationId: 3 }).organizationId,
    ).toBe(3);
    expect(
      CreateMemberInput.parse({ ...base, organizationId: null }).organizationId,
    ).toBeNull();
    expect(CreateMemberInput.safeParse(base).success).toBe(true);
  });

  test("拒绝非正整数团体 ID", () => {
    expect(
      CreateMemberInput.safeParse({ ...base, organizationId: 0 }).success,
    ).toBe(false);
    expect(
      CreateMemberInput.safeParse({ ...base, organizationId: 1.5 }).success,
    ).toBe(false);
  });
});

describe("CreateMemberInput 的证件完整性", () => {
  test("证件类型和证件号码必须同时填写或同时留空", () => {
    expect(
      CreateMemberInput.safeParse({ ...base, idType: "身份证" }).success,
    ).toBe(false);
    expect(
      CreateMemberInput.safeParse({
        ...base,
        idNumber: "330102199001011234",
      }).success,
    ).toBe(false);
    expect(
      CreateMemberInput.safeParse({
        ...base,
        idType: "身份证",
        idNumber: "330102199001011234",
      }).success,
    ).toBe(true);
  });
});

describe("ListMembersInput 的团体筛选", () => {
  test("接受正整数团体 ID，缺省时不过滤", () => {
    expect(
      ListMembersInput.parse({ page: 1, pageSize: 10, organizationId: 3 })
        .organizationId,
    ).toBe(3);
    expect(
      ListMembersInput.parse({ page: 1, pageSize: 10 }).organizationId,
    ).toBeUndefined();
  });

  test("拒绝无效团体 ID", () => {
    expect(
      ListMembersInput.safeParse({
        page: 1,
        pageSize: 10,
        organizationId: 0,
      }).success,
    ).toBe(false);
  });
});

describe("按团体添加人员输入", () => {
  test("三层请求都把最终 memberIds 去重并保持首次勾选顺序", () => {
    expect(
      AddProjectMembersByOrganizationInput.parse({
        projectId: 1,
        organizationId: 7,
        memberIds: [3, 1, 3, 2, 1],
      }).memberIds,
    ).toEqual([3, 1, 2]);
    expect(
      AddActivityMembersByOrganizationInput.parse({
        activityId: 2,
        organizationId: 7,
        memberIds: [3, 3],
      }).memberIds,
    ).toEqual([3]);
    expect(
      AddSegmentMembersByOrganizationInput.parse({
        segmentId: 3,
        organizationId: 7,
        memberIds: [2, 2],
      }).memberIds,
    ).toEqual([2]);
  });

  test("团体和范围 id 必须是正整数，最终名单不能为空", () => {
    expect(
      AddProjectMembersByOrganizationInput.safeParse({
        projectId: 1,
        organizationId: 0,
        memberIds: [1],
      }).success,
    ).toBe(false);
    expect(
      AddActivityMembersByOrganizationInput.safeParse({
        activityId: 2,
        organizationId: 7,
        memberIds: [],
      }).success,
    ).toBe(false);
  });

  test("团体候选查询裁剪筛选文本", () => {
    const parsed = ListOrganizationMemberCandidatesInput.parse({
      organizationId: 7,
      name: "  王芳  ",
      companyPosition: "  会长  ",
      page: 1,
      pageSize: 20,
    });

    expect(parsed.name).toBe("王芳");
    expect(parsed.companyPosition).toBe("会长");
  });
});

describe("活动人员列表输入", () => {
  test("支持按成员状态筛选，给邀请函页排除停用人员", () => {
    expect(
      ListActivityMembersInput.parse({
        activityId: 2,
        memberStatus: "enabled",
        page: 1,
        pageSize: 10,
      }).memberStatus,
    ).toBe("enabled");
    expect(
      ListActivityMembersInput.safeParse({
        activityId: 2,
        memberStatus: "unknown",
        page: 1,
        pageSize: 10,
      }).success,
    ).toBe(false);
  });
});

describe("活动人员参与环节同步输入", () => {
  test("期望环节集合去重并保持首次选择顺序", () => {
    expect(
      SyncActivityMemberSegmentsInput.parse({
        activityMemberId: 10,
        segmentIds: [3, 1, 3, 2, 1],
      }),
    ).toEqual({ activityMemberId: 10, segmentIds: [3, 1, 2] });
  });

  test("允许空集合，但拒绝无效 id", () => {
    expect(
      SyncActivityMemberSegmentsInput.parse({
        activityMemberId: 10,
        segmentIds: [],
      }).segmentIds,
    ).toEqual([]);
    expect(
      SyncActivityMemberSegmentsInput.safeParse({
        activityMemberId: 0,
        segmentIds: [1],
      }).success,
    ).toBe(false);
    expect(
      SyncActivityMemberSegmentsInput.safeParse({
        activityMemberId: 10,
        segmentIds: [0],
      }).success,
    ).toBe(false);
  });
});
