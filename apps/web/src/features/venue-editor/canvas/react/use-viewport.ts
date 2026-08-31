import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { clamp, fitViewport, type Point, type Size } from "../core/geometry";

/**
 * 画布视口：平移 + 等比缩放。
 *
 * 手势本身交给 `@use-gesture/react`（在组件里接），这里只管状态和换算——
 * 滚轮、触控板双指、`ctrl+wheel`、触屏捏合这些跨设备差异是库的活，
 * "缩放到哪、夹在什么范围、初始怎么摆"是我们的活。
 */

export type Viewport = { x: number; y: number; scale: number };

/** 缩放范围。下限保证 1600×1000 的世界能整个塞进小窗口，上限够看清座位编号。 */
const MIN_SCALE = 0.15;
/**
 * 上限 6 而不是 3：座距密的区域要放到 3 倍以上才够写下姓名
 * （见 `seatRenderSpec` 的阶梯），卡在 3 会让「放大到姓名可读」到不了位。
 */
const MAX_SCALE = 6;

export function useViewport(
  world: Size,
  containerRef: RefObject<HTMLElement | null>,
) {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  /**
   * 用户有没有手动调过视角。用 ref 不用 state：它只影响"下一次容器变化要不要
   * 自动适配"，本身不需要触发渲染。
   */
  const touched = useRef(false);

  const fit = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    setViewport(fitViewport(world, { width: rect.width, height: rect.height }));
    touched.current = false;
  }, [containerRef, world]);

  // 首次挂载和容器尺寸变化时自动适配。侧边栏折叠、窗口缩放都会走到这里。
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    fit();
    const observer = new ResizeObserver(() => {
      // 只在用户还没自己调过视角时跟随——否则每拖一下窗口，
      // 他调好的视角就被重置掉了。
      if (!touched.current) fit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, fit]);

  const panBy = useCallback((delta: Point) => {
    touched.current = true;
    setViewport((current) => ({
      ...current,
      x: current.x + delta.x,
      y: current.y + delta.y,
    }));
  }, []);

  /**
   * 以某个屏幕点为锚缩放——鼠标指着哪儿就往哪儿放大。
   * 不做锚点的话，缩放时画面会往左上角跑，是最容易被察觉的手感缺陷。
   */
  const zoomAt = useCallback((anchor: Point, factor: number) => {
    touched.current = true;
    setViewport((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = scale / current.scale;
      return {
        scale,
        x: anchor.x - (anchor.x - current.x) * ratio,
        y: anchor.y - (anchor.y - current.y) * ratio,
      };
    });
  }, []);

  /**
   * 直接缩放到某个倍率，以视口中心为锚。
   * 「放大到姓名可读」用它——那个动作有一个算得出来的目标倍率，
   * 不该让用户滚轮试。
   */
  const zoomToScale = useCallback(
    (target: number) => {
      const element = containerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      touched.current = true;
      setViewport((current) => {
        const scale = clamp(target, MIN_SCALE, MAX_SCALE);
        const ratio = scale / current.scale;
        const anchorX = rect.width / 2;
        const anchorY = rect.height / 2;
        return {
          scale,
          x: anchorX - (anchorX - current.x) * ratio,
          y: anchorY - (anchorY - current.y) * ratio,
        };
      });
    },
    [containerRef],
  );

  return {
    viewport,
    panBy,
    zoomAt,
    zoomToScale,
    fit,
    canZoomIn: viewport.scale < MAX_SCALE,
    canZoomOut: viewport.scale > MIN_SCALE,
  };
}
