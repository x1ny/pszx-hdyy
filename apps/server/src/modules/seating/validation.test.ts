import { describe, expect, test } from "bun:test";
import {
  AssignInput,
  AssignOrganizationInput,
  ListPlansInput,
  OrganizationSeatBatchInput,
  UnassignOrganizationInput,
} from "./validation";

describe("list plans validation", () => {
  test("支持从环节详情传入可选的 segmentId 上下文", () => {
    expect(ListPlansInput.parse({ activityId: 3 })).toEqual({ activityId: 3 });
    expect(ListPlansInput.parse({ activityId: 3, segmentId: 7 })).toEqual({
      activityId: 3,
      segmentId: 7,
    });
    expect(
      ListPlansInput.safeParse({ activityId: 3, segmentId: 0 }).success,
    ).toBe(false);
  });
});

describe("seat assignment validation", () => {
  test("旧个人分配请求保持 segmentMemberId 入参", () => {
    expect(
      AssignInput.parse({ planId: 1, segmentSeatId: 2, segmentMemberId: 3 }),
    ).toEqual({ planId: 1, segmentSeatId: 2, segmentMemberId: 3 });
  });

  test("团体占位要求三个正整数目标", () => {
    expect(
      AssignOrganizationInput.parse({
        planId: 1,
        segmentSeatId: 2,
        organizationId: 3,
      }),
    ).toEqual({ planId: 1, segmentSeatId: 2, organizationId: 3 });
    expect(
      AssignOrganizationInput.safeParse({
        planId: 1,
        segmentSeatId: 2,
        organizationId: 0,
      }).success,
    ).toBe(false);
  });
});

describe("团体批量占位 validation", () => {
  test("支持按剩余人数或自定义正整数预览/提交", () => {
    expect(
      OrganizationSeatBatchInput.parse({
        planId: 1,
        organizationId: 2,
        targetMode: "remaining",
        orderedSeatIds: [9, 3],
      }),
    ).toMatchObject({ targetMode: "remaining", orderedSeatIds: [9, 3] });
    expect(
      OrganizationSeatBatchInput.parse({
        planId: 1,
        organizationId: 2,
        targetMode: "custom",
        targetCount: 7,
        orderedSeatIds: [],
      }),
    ).toMatchObject({ targetMode: "custom", targetCount: 7 });
  });

  test("自定义数量必须为正数，座位 id 不能重复", () => {
    expect(
      OrganizationSeatBatchInput.safeParse({
        planId: 1,
        organizationId: 2,
        targetMode: "custom",
        targetCount: 0,
        orderedSeatIds: [3],
      }).success,
    ).toBe(false);
    expect(
      OrganizationSeatBatchInput.safeParse({
        planId: 1,
        organizationId: 2,
        targetMode: "remaining",
        orderedSeatIds: [3, 3],
      }).success,
    ).toBe(false);
  });

  test("团体全部解除只接受方案和团体两个正整数", () => {
    expect(
      UnassignOrganizationInput.parse({ planId: 1, organizationId: 2 }),
    ).toEqual({ planId: 1, organizationId: 2 });
  });
});
