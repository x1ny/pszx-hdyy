import { describe, expect, test } from "bun:test";
import { AssignInput, AssignOrganizationInput } from "./validation";

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
