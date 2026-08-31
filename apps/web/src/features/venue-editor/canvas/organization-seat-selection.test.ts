import { describe, expect, it } from "vitest";
import {
  type OrganizationSeatSelectionCandidate,
  resolveOrganizationSeatPick,
} from "./organization-seat-selection";

const candidates: OrganizationSeatSelectionCandidate[] = [
  {
    externalId: "A1",
    label: "A1",
    ordinal: 1,
    zoneExternalId: "zone-a",
    availability: "available",
  },
  {
    externalId: "A2",
    label: "A2",
    ordinal: 2,
    zoneExternalId: "zone-a",
    availability: "occupied",
  },
  {
    externalId: "A3",
    label: "A3",
    ordinal: 3,
    zoneExternalId: "zone-a",
    availability: "disabled",
  },
  {
    externalId: "A4",
    label: "A4",
    ordinal: 4,
    zoneExternalId: "zone-a",
    availability: "available",
  },
  {
    externalId: "A5",
    label: "A5",
    ordinal: 5,
    zoneExternalId: "zone-a",
    availability: "available",
  },
  {
    externalId: "B1",
    label: "B1",
    ordinal: 0,
    zoneExternalId: "zone-b",
    availability: "available",
  },
];

const pick = (
  input: Partial<Parameters<typeof resolveOrganizationSeatPick>[0]>,
) =>
  resolveOrganizationSeatPick({
    action: "toggle",
    zoneExternalId: "zone-a",
    requestedExternalIds: [],
    currentExternalIds: [],
    candidates,
    ...input,
  });

describe("resolveOrganizationSeatPick", () => {
  it("点空位选上，再点一次取消——checkbox 语义", () => {
    const selected = pick({
      action: "toggle",
      requestedExternalIds: ["A4"],
      currentExternalIds: ["A1"],
    });
    expect(selected.selectedExternalIds).toEqual(["A1", "A4"]);

    const cleared = pick({
      action: "toggle",
      requestedExternalIds: ["A4"],
      currentExternalIds: selected.selectedExternalIds,
    });
    expect(cleared.selectedExternalIds).toEqual(["A1"]);
  });

  it("点不可用位置既不选上也不清空已选，只报告原因", () => {
    expect(
      pick({
        action: "toggle",
        requestedExternalIds: ["A2"],
        currentExternalIds: ["A1", "A4"],
      }),
    ).toEqual({
      selectedExternalIds: ["A1", "A4"],
      rejected: [{ externalId: "A2", label: "A2", reason: "occupied" }],
      dropped: [],
    });
  });

  it("框选并入已有选择，不取消框外的，也不重复计入框内已选的", () => {
    expect(
      pick({
        action: "add",
        requestedExternalIds: ["A4", "A5"],
        currentExternalIds: ["A1", "A4"],
      }),
    ).toMatchObject({
      selectedExternalIds: ["A1", "A4", "A5"],
      rejected: [],
    });
  });

  it("框选跳过停用和已占用，无论拖拽方向结果都按 ordinal 排序", () => {
    const forward = pick({
      action: "add",
      requestedExternalIds: ["A1", "A2", "A3", "A4", "A5"],
    });
    const backward = pick({
      action: "add",
      requestedExternalIds: ["A5", "A4", "A3", "A2", "A1"],
    });

    expect(forward).toEqual({
      selectedExternalIds: ["A1", "A4", "A5"],
      rejected: [
        { externalId: "A2", label: "A2", reason: "occupied" },
        { externalId: "A3", label: "A3", reason: "disabled" },
      ],
      dropped: [],
    });
    expect(backward.selectedExternalIds).toEqual(forward.selectedExternalIds);
  });

  it("不跨区域：别的区域的位置既不会被框进来，也不会留在选择里", () => {
    expect(
      pick({
        action: "add",
        requestedExternalIds: ["B1"],
        currentExternalIds: ["A1", "B1"],
      }).selectedExternalIds,
    ).toEqual(["A1"]);
  });

  it("sync 把期间失效的位置移出选择并说明原因", () => {
    const stale = candidates.map((seat) =>
      seat.externalId === "A4"
        ? { ...seat, availability: "occupied" as const }
        : seat,
    );

    expect(
      resolveOrganizationSeatPick({
        action: "sync",
        zoneExternalId: "zone-a",
        requestedExternalIds: [],
        currentExternalIds: ["A1", "A4", "A5"],
        candidates: stale,
      }),
    ).toEqual({
      selectedExternalIds: ["A1", "A5"],
      rejected: [],
      dropped: [{ externalId: "A4", label: "A4", reason: "occupied" }],
    });
  });
});
