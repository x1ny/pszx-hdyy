import { describe, expect, it } from "vitest";
import {
  buildOrganizationSeatInfoById,
  formatActivityZoneOrigin,
} from "./-venue-utils";

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

describe("buildOrganizationSeatInfoById", () => {
  it("只把团体占位聚合到团体座位，个人排座仍由候选人自己的座位显示", () => {
    const result = buildOrganizationSeatInfoById({
      organizations: [{ organizationId: 7, name: "外语志愿者团" }],
      seats: [
        { id: 101, label: "D1", ordinal: 1 },
        { id: 102, label: "D2", ordinal: 2 },
        { id: 104, label: "D4", ordinal: 4 },
      ],
      assignments: [
        {
          segmentSeatId: 104,
          occupantType: "organization",
          organizationId: 7,
          organizationName: "外语志愿者团",
        },
        {
          segmentSeatId: 101,
          occupantType: "person",
          organizationId: 7,
          organizationName: "外语志愿者团",
        },
        {
          segmentSeatId: 102,
          occupantType: "organization",
          organizationId: 7,
          organizationName: "外语志愿者团",
        },
      ],
    });

    expect(result.get(7)).toEqual({
      name: "外语志愿者团",
      seatLabels: ["D2", "D4"],
    });
  });

  it("即使统计接口尚未返回，也能用方案中的团体占位名称建立索引", () => {
    const result = buildOrganizationSeatInfoById({
      organizations: [],
      seats: [{ id: 201, label: "E1", ordinal: 1 }],
      assignments: [
        {
          segmentSeatId: 201,
          occupantType: "organization",
          organizationId: 8,
          organizationName: "媒体待组",
        },
      ],
    });

    expect(result.get(8)).toEqual({
      name: "媒体待组",
      seatLabels: ["E1"],
    });
  });

  it("只有个人排座时保留团体名称，但不虚构团体占位座位", () => {
    const result = buildOrganizationSeatInfoById({
      organizations: [],
      seats: [{ id: 301, label: "F1", ordinal: 1 }],
      assignments: [
        {
          segmentSeatId: 301,
          occupantType: "person",
          organizationId: 9,
          organizationName: "媒体团",
        },
      ],
    });

    expect(result.get(9)).toEqual({
      name: "媒体团",
      seatLabels: [],
    });
  });
});
