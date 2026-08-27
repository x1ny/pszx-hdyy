import { describe, expect, test } from "bun:test";
import {
  ListOrganizationsInput,
  OrganizationInput,
  UpdateOrganizationInput,
} from "./validation";

describe("OrganizationInput", () => {
  test("trims the name and normalizes an empty remark", () => {
    expect(
      OrganizationInput.parse({
        name: " 泉州市纺织服装商会 ",
        remark: " ",
        memberIds: [],
      }),
    ).toEqual({ name: "泉州市纺织服装商会", remark: null, memberIds: [] });
  });

  test("rejects a blank or overlong name", () => {
    expect(OrganizationInput.safeParse({ name: "   " }).success).toBe(false);
    expect(
      OrganizationInput.safeParse({ name: "团".repeat(256) }).success,
    ).toBe(false);
  });

  test("requires a positive integer id when updating", () => {
    expect(
      UpdateOrganizationInput.safeParse({ id: 1, name: "商会", memberIds: [] })
        .success,
    ).toBe(true);
    expect(
      UpdateOrganizationInput.safeParse({ id: 0, name: "商会" }).success,
    ).toBe(false);
  });

  test("treats members as a complete de-duplicated collection", () => {
    expect(
      OrganizationInput.parse({ name: "商会", memberIds: [3, 1, 3, 2] })
        .memberIds,
    ).toEqual([3, 1, 2]);
    expect(OrganizationInput.safeParse({ name: "商会" }).success).toBe(false);
  });
});

describe("ListOrganizationsInput", () => {
  test("normalizes a blank name filter and uses shared pagination defaults", () => {
    expect(ListOrganizationsInput.parse({ name: "  " })).toEqual({
      name: undefined,
      page: 1,
      pageSize: 10,
    });
  });
});
