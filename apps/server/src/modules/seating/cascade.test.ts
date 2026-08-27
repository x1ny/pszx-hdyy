import { describe, expect, test } from "bun:test";
import { findEmptiedOrganizationScopes } from "./cascade";

describe("团体占位的范围级联", () => {
  test("移除某团体在环节的最后一人时，该范围归零", () => {
    const emptied = findEmptiedOrganizationScopes(
      [{ id: 1, segmentId: 10, organizationId: 100 }],
      [{ id: 1, segmentId: 10, organizationId: 100 }],
    );

    expect([...emptied]).toEqual(["10:100"]);
  });

  test("同团体仍有其他环节人员时，不解除团体占位", () => {
    const emptied = findEmptiedOrganizationScopes(
      [{ id: 1, segmentId: 10, organizationId: 100 }],
      [
        { id: 1, segmentId: 10, organizationId: 100 },
        { id: 2, segmentId: 10, organizationId: 100 },
      ],
    );

    expect([...emptied]).toEqual([]);
  });

  test("活动级批量移除同团体的全部环节人员也只产生一个范围影响", () => {
    const emptied = findEmptiedOrganizationScopes(
      [
        { id: 1, segmentId: 10, organizationId: 100 },
        { id: 2, segmentId: 10, organizationId: 100 },
      ],
      [
        { id: 1, segmentId: 10, organizationId: 100 },
        { id: 2, segmentId: 10, organizationId: 100 },
      ],
    );

    expect([...emptied]).toEqual(["10:100"]);
  });
});
