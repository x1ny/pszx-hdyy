import { describe, expect, it } from "vitest";
import {
  changeMemberSelection,
  shouldWarnOrganizationMove,
} from "./organization-member-selector";

describe("organization member selection", () => {
  it("selects a page without losing selections from other pages", () => {
    const current = [2, 40];

    expect(changeMemberSelection(current, [1, 2, 3], true)).toEqual([
      1, 2, 3, 40,
    ]);
    expect(current).toEqual([2, 40]);
  });

  it("clears only the current page and preserves off-page selections", () => {
    expect(changeMemberSelection([1, 2, 3, 40], [1, 2, 3], false)).toEqual([
      40,
    ]);
  });

  it("warns only when a selected member will move from another organization", () => {
    expect(shouldWarnOrganizationMove(7, 8, true)).toBe(true);
    expect(shouldWarnOrganizationMove(8, 8, true)).toBe(false);
    expect(shouldWarnOrganizationMove(null, 8, true)).toBe(false);
    expect(shouldWarnOrganizationMove(7, 8, false)).toBe(false);
  });
});
