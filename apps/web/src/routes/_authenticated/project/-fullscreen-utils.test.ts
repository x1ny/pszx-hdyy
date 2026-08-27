import { describe, expect, it } from "vitest";
import {
  isTargetFullscreen,
  supportsFullscreenRequest,
} from "./-fullscreen-utils";

describe("seating fullscreen helpers", () => {
  it("only treats the expected element as this page's native fullscreen target", () => {
    const pageRoot = document.documentElement;
    const anotherElement = document.createElement("div");

    expect(isTargetFullscreen(pageRoot, pageRoot)).toBe(true);
    expect(isTargetFullscreen(anotherElement, pageRoot)).toBe(false);
    expect(isTargetFullscreen(null, pageRoot)).toBe(false);
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
