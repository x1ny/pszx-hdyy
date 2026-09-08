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
