import { describe, expect, test } from "bun:test";
import { CreateMemberInput } from "./validation";

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
