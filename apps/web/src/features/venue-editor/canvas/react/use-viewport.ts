import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clamp,
  fitViewport,
  type Point,
  type Rect,
  type Size,
} from "../core/geometry";

export type Viewport = { x: number; y: number; scale: number };

type ViewportOptions = {
  /** 内层内容增删、移动时保持视角；显式适配和容器变化仍可重算。 */
  preserveView?: boolean;
  initialViewport?: Viewport;
  onViewportChange?: (viewport: Viewport) => void;
  maxScale?: number;
};

/** 视口只属于当前编辑会话，不能写进布局或触发业务保存。 */
export function useViewport(
  world: Size | Rect,
  containerRef: RefObject<HTMLElement | null>,
  options: ViewportOptions = {},
) {
  const [viewport, setViewport] = useState<Viewport>(
    () => options.initialViewport ?? { x: 0, y: 0, scale: 1 },
  );
  const touched = useRef(options.initialViewport !== undefined);
  const live = useRef({ world, options });
  live.current = { world, options };

  const fitToContent = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    return fitViewport(live.current.world, rect);
  }, [containerRef]);

  const fitView = useCallback(() => {
    const next = fitToContent();
    if (!next) return;
    setViewport(next);
    touched.current = false;
  }, [fitToContent]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (!live.current.options.initialViewport) fitView();
    const observer = new ResizeObserver(() => {
      if (!touched.current) fitView();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, fitView]);

  useEffect(() => {
    if (options.preserveView) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    setViewport(fitViewport(world, rect));
    touched.current = false;
  }, [world, options.preserveView, containerRef]);

  useEffect(() => {
    live.current.options.onViewportChange?.(viewport);
  }, [viewport]);

  const panBy = useCallback((delta: Point) => {
    touched.current = true;
    setViewport((current) => ({
      ...current,
      x: current.x + delta.x,
      y: current.y + delta.y,
    }));
  }, []);

  const zoomAt = useCallback(
    (anchor: Point, factor: number) => {
      touched.current = true;
      setViewport((current) => {
        // 大布局适配倍率可能低于旧的 0.15，第一次滚轮不能突然跳回旧下限。
        const minScale = Math.min(
          0.15,
          (fitToContent()?.scale ?? 1) / 4,
          current.scale,
        );
        const scale = clamp(
          current.scale * factor,
          minScale,
          Math.max(6, live.current.options.maxScale ?? 6),
        );
        const ratio = scale / current.scale;
        return {
          scale,
          x: anchor.x - (anchor.x - current.x) * ratio,
          y: anchor.y - (anchor.y - current.y) * ratio,
        };
      });
    },
    [fitToContent],
  );

  const zoomToScale = useCallback(
    (target: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      zoomAt(
        { x: rect.width / 2, y: rect.height / 2 },
        target / viewport.scale,
      );
    },
    [containerRef, viewport.scale, zoomAt],
  );

  return { viewport, panBy, zoomAt, zoomToScale, fit: fitView };
}
