import { describe, expect, it } from "vitest";
import {
  type OrganizationSeatSelectionCandidate,
  resolveOrganizationSeatSelection,
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

describe("resolveOrganizationSeatSelection", () => {
  it("连续模式从起点按 ordinal 向后取启用空位，并报告中间跳过", () => {
    expect(
      resolveOrganizationSeatSelection({
        mode: "continuous",
        targetCount: 2,
        zoneExternalId: "zone-a",
        requestedExternalIds: ["A2"],
        candidates,
      }),
    ).toEqual({
      selectedExternalIds: ["A4", "A5"],
      skipped: [
        { externalId: "A2", label: "A2", reason: "occupied" },
        { externalId: "A3", label: "A3", reason: "disabled" },
      ],
      overflowCount: 0,
      insufficient: 0,
    });
  });

  it("连续模式不会跨越当前方案区域寻找位置", () => {
    expect(
      resolveOrganizationSeatSelection({
        mode: "continuous",
        targetCount: 3,
        zoneExternalId: "zone-a",
        requestedExternalIds: ["A4"],
        candidates,
      }),
    ).toMatchObject({
      selectedExternalIds: ["A4", "A5"],
      insufficient: 1,
    });
  });

  it("框选无论拖拽方向，都按 ordinal 取前 N 个可用位置", () => {
    const forward = resolveOrganizationSeatSelection({
      mode: "marquee",
      targetCount: 2,
      zoneExternalId: "zone-a",
      requestedExternalIds: ["A1", "A5", "A4"],
      candidates,
    });
    const backward = resolveOrganizationSeatSelection({
      mode: "marquee",
      targetCount: 2,
      zoneExternalId: "zone-a",
      requestedExternalIds: ["A5", "A4", "A1"],
      candidates,
    });

    expect(forward).toMatchObject({
      selectedExternalIds: ["A1", "A4"],
      overflowCount: 1,
      insufficient: 0,
    });
    expect(backward).toEqual(forward);
  });

  it("框选会过滤停用和占用位置，并将不足和跳过信息交给界面", () => {
    expect(
      resolveOrganizationSeatSelection({
        mode: "marquee",
        targetCount: 3,
        zoneExternalId: "zone-a",
        requestedExternalIds: ["A1", "A2", "A3", "A4"],
        candidates,
      }),
    ).toEqual({
      selectedExternalIds: ["A1", "A4"],
      skipped: [
        { externalId: "A2", label: "A2", reason: "occupied" },
        { externalId: "A3", label: "A3", reason: "disabled" },
      ],
      overflowCount: 0,
      insufficient: 1,
    });
  });
});
