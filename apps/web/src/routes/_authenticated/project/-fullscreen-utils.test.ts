import { describe, expect, it } from "vitest";
import {
  isTargetFullscreen,
  supportsFullscreenRequest,
} from "./-fullscreen-utils";

describe("seating canvas fullscreen helpers", () => {
  it("only treats the canvas wrapper as this page's native fullscreen target", () => {
    const canvas = document.createElement("div");
    const anotherElement = document.createElement("div");

    expect(isTargetFullscreen(canvas, canvas)).toBe(true);
    expect(isTargetFullscreen(anotherElement, canvas)).toBe(false);
    expect(isTargetFullscreen(null, canvas)).toBe(false);
  });

  it("detects the Fullscreen API so callers can use the page-fill fallback", () => {
    const supported = document.createElement("div");
    Object.defineProperty(supported, "requestFullscreen", {
      value: () => Promise.resolve(),
    });

    expect(supportsFullscreenRequest(supported)).toBe(true);
    expect(supportsFullscreenRequest(document.createElement("div"))).toBe(
      false,
    );
    expect(supportsFullscreenRequest(null)).toBe(false);
  });
});
