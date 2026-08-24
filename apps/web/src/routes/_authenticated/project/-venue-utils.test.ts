import { describe, expect, it } from "vitest";
import { formatActivityZoneOrigin } from "./-venue-utils";

describe("formatActivityZoneOrigin", () => {
  it("把活动内新画的区域标成“本活动新建”，而不是误报来源已删除", () => {
    expect(formatActivityZoneOrigin("泉州无区域", "区域 1", null)).toBe(
      "泉州无区域 / 区域 1（本活动新建）",
    );
  });

  it("导入的区域保持场地和区域名称，不追加来源状态", () => {
    expect(formatActivityZoneOrigin("海峡会展中心", "主会场 A 区", 12)).toBe(
      "海峡会展中心 / 主会场 A 区",
    );
  });
});
