import { describe, expect, test } from "bun:test";
import { createItineraryShareToken } from "./share-token";

describe("createItineraryShareToken", () => {
  test("returns a short URL-safe token", () => {
    expect(createItineraryShareToken()).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });
});
