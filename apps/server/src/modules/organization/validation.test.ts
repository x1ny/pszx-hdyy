import { describe, expect, test } from "bun:test";
import { OrganizationInput, UpdateOrganizationInput } from "./validation";

describe("OrganizationInput", () => {
  test("trims the name and normalizes an empty remark", () => {
    expect(
      OrganizationInput.parse({ name: " 泉州市纺织服装商会 ", remark: " " }),
    ).toEqual({ name: "泉州市纺织服装商会", remark: null });
  });

  test("rejects a blank or overlong name", () => {
    expect(OrganizationInput.safeParse({ name: "   " }).success).toBe(false);
    expect(
      OrganizationInput.safeParse({ name: "团".repeat(256) }).success,
    ).toBe(false);
  });

  test("requires a positive integer id when updating", () => {
    expect(
      UpdateOrganizationInput.safeParse({ id: 1, name: "商会" }).success,
    ).toBe(true);
    expect(
      UpdateOrganizationInput.safeParse({ id: 0, name: "商会" }).success,
    ).toBe(false);
  });
});
