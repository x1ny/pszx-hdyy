import { describe, expect, test } from "bun:test";
import { SaveVenueLayoutInput } from "./validation";

describe("unbounded venue seats", () => {
  test("accepts 1000 seats while rejecting duplicate identifiers", () => {
    const seats = Array.from({ length: 1000 }, (_, i) => ({
      externalId: `s-${i}`,
      zoneExternalId: "z",
      label: `A${i + 1}`,
      ordinal: i,
    }));
    const input = {
      venueId: 1,
      layout: { rendererKind: "svg-canvas-v1", rendererVersion: 1, data: {} },
      zones: [{ externalId: "z", name: "区域", kind: "seating" }],
      seats,
    };
    expect(SaveVenueLayoutInput.parse(input).seats).toHaveLength(1000);
    expect(
      SaveVenueLayoutInput.safeParse({ ...input, seats: [...seats, seats[0]] })
        .success,
    ).toBe(false);
  });
});

test("业务区域层级必须有效，父区域不能直接挂座位", () => {
  const input = {
    venueId: 1,
    layout: { rendererKind: "svg-canvas-v1", rendererVersion: 1, data: {} },
    zones: [
      { externalId: "g", name: "观众区", kind: "seating", isGroup: true },
      { externalId: "a", name: "A1", kind: "seating", parentExternalId: "g" },
    ],
    seats: [{ externalId: "s", zoneExternalId: "a", label: "1号" }],
  };
  expect(SaveVenueLayoutInput.safeParse(input).success).toBe(true);
  expect(
    SaveVenueLayoutInput.safeParse({
      ...input,
      seats: [{ ...input.seats[0], zoneExternalId: "g" }],
    }).success,
  ).toBe(false);
  expect(
    SaveVenueLayoutInput.safeParse({
      ...input,
      zones: input.zones.map((zone) =>
        zone.externalId === "a"
          ? { ...zone, parentExternalId: "missing" }
          : zone,
      ),
    }).success,
  ).toBe(false);
  expect(
    SaveVenueLayoutInput.safeParse({
      ...input,
      zones: input.zones.map((zone) => ({
        ...zone,
        isGroup: true,
        parentExternalId: "g",
      })),
    }).success,
  ).toBe(false);
});
