import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toScreen, toWorld } from "../core/geometry";
import { useViewport, type Viewport } from "./use-viewport";

const containerRef = {
  current: {
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  } as HTMLElement,
};
const world = { x: -1000, y: -800, width: 4000, height: 2000 };

describe("independent seat viewport", () => {
  it("fits negative coordinates and keeps the view during content changes", () => {
    const { result, rerender } = renderHook(
      ({ bounds }) => useViewport(bounds, containerRef, { preserveView: true }),
      { initialProps: { bounds: world } },
    );
    const topLeft = toScreen(world, result.current.viewport);
    const bottomRight = toScreen(
      { x: world.x + world.width, y: world.y + world.height },
      result.current.viewport,
    );
    expect(topLeft.x).toBeGreaterThanOrEqual(32);
    expect(topLeft.y).toBeGreaterThanOrEqual(32);
    expect(bottomRight.x).toBeLessThanOrEqual(768);
    expect(bottomRight.y).toBeLessThanOrEqual(568);
    act(() => result.current.panBy({ x: 120, y: -30 }));
    const before = result.current.viewport;
    rerender({ bounds: { ...world, width: 40000 } });
    expect(result.current.viewport).toEqual(before);
    act(() => result.current.fit());
    expect(result.current.viewport.scale).toBeLessThan(before.scale);
  });

  it("zooms large layouts continuously around the pointer without jumping to 0.15", () => {
    const bounds = { x: -100000, y: -100000, width: 200000, height: 200000 };
    const { result } = renderHook(() =>
      useViewport(bounds, containerRef, { preserveView: true }),
    );
    const before = result.current.viewport;
    const anchor = { x: 200, y: 100 };
    const point = toWorld(anchor, before);
    act(() => result.current.zoomAt(anchor, 1.08));
    expect(result.current.viewport.scale).toBeCloseTo(before.scale * 1.08, 8);
    expect(toScreen(point, result.current.viewport).x).toBeCloseTo(anchor.x);
    expect(toScreen(point, result.current.viewport).y).toBeCloseTo(anchor.y);
  });

  it("restores only the current editing session's saved view", () => {
    const memory = new Map<string, Viewport>();
    const open = (key: string) =>
      renderHook(() =>
        useViewport(world, containerRef, {
          preserveView: true,
          initialViewport: memory.get(key),
          onViewportChange: (view) => memory.set(key, view),
        }),
      );
    const first = open("a");
    act(() => first.result.current.panBy({ x: 140, y: 80 }));
    const saved = first.result.current.viewport;
    first.unmount();
    const other = open("b");
    expect(other.result.current.viewport).not.toEqual(saved);
    other.unmount();
    const returned = open("a");
    expect(returned.result.current.viewport).toEqual(saved);
    returned.unmount();
    memory.clear();
    expect(open("a").result.current.viewport).not.toEqual(saved);
  });
});
