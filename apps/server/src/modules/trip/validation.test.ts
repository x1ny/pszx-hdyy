import { describe, expect, test } from "bun:test";
import { CreateTripInput } from "./validation";

const validTrip = {
  activityId: 1,
  activityMemberId: 2,
  transportMode: "train",
  serviceNumber: " G1234 ",
  departureTime: "2026-09-01T08:00:00+08:00",
  arrivalTime: "2026-09-01T10:00:00+08:00",
  departureLocation: " 福州站 ",
  destination: " 厦门北站 ",
};

describe("CreateTripInput", () => {
  test("normalizes optional fields and coerces date strings", () => {
    const result = CreateTripInput.parse(validTrip);

    expect(result.segmentId).toBeNull();
    expect(result.serviceNumber).toBe("G1234");
    expect(result.departureLocation).toBe("福州站");
    expect(result.departureTime).toBeInstanceOf(Date);
  });

  test("requires arrival time to be later than departure time", () => {
    const result = CreateTripInput.safeParse({
      ...validTrip,
      arrivalTime: validTrip.departureTime,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("到达时间必须晚于出发时间");
      expect(result.error.issues[0]?.path).toEqual(["arrivalTime"]);
    }
  });

  test("rejects an unsupported transport mode with a Chinese message", () => {
    const result = CreateTripInput.safeParse({
      ...validTrip,
      transportMode: "ship",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("交通方式不正确");
    }
  });
});
