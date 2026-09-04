import { describe, expect, test } from "bun:test";
import { activityRoutes } from "./routes";

describe("activity routes", () => {
  test("exposes the itinerary share action", () => {
    const postPaths = new Set(
      activityRoutes.routes
        .filter((route) => route.method === "POST")
        .map((route) => route.path),
    );

    expect(postPaths).toContain("/shareItinerary");
  });
});
