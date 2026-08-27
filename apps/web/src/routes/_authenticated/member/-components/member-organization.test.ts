import { describe, expect, it } from "vitest";
import { isValidOrganizationId } from "../-utils";

describe("member form organization binding", () => {
  it("accepts one organization or an unassigned value", () => {
    expect(isValidOrganizationId(3)).toBe(true);
    expect(isValidOrganizationId(null)).toBe(true);
    expect(isValidOrganizationId(undefined)).toBe(true);
  });

  it("rejects invalid organization ids", () => {
    expect(isValidOrganizationId(0)).toBe(false);
    expect(isValidOrganizationId(1.5)).toBe(false);
    expect(isValidOrganizationId("3")).toBe(false);
  });
});
