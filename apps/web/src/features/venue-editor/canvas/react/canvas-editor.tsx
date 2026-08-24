import { useGesture } from "@use-gesture/react";
import {
  CircleIcon,
  Disc2Icon,
  MousePointer2Icon,
  PentagonIcon,
  RedoIcon,
  ScanIcon,
  SquareIcon,
  UndoIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/shared/components/ui/button.tsx";
import { cn } from "#/shared/lib/utils.ts";
import {
  addZone,
  boxShapeFromDrag,
  moveZones,
  polygonShapeFromPoints,
  removeZones,
  resizeZone,
} from "../core/commands";
import {
  normalizeRect,
  type Point,
  type Rect,
  toWorld,
} from "../core/geometry";
import {
  canRedo,
  canUndo,
  type EditorState,
  execute,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from "../core/history";
import {
  type DragSubject,
  EMPTY_SELECTION,
  hitZone,
  resizeRect,
  resolveDragSubject,
  type Selection,
  type ZoneTool,
} from "../core/interaction";
import { CanvasView } from "./canvas-view";
import { useViewport } from "./use-viewport";

/**
 * 区域分布画布——两级架构的**顶层**。
 *
 * 参考旧系统：最外层只做区域的分布（形状 + 自定义颜色 + 名称/类型），
 * 不在这里摆座位。进入某个区域之后才是排位，那是另一个组件
 * （`zone-seating-editor.tsx`），两者共享同一份 `CanvasDoc`，只是编辑范围
 * 和工具集完全不同——排位画布里没有"区域"这个可选对象，硬塞进同一个组件
 * 只会多出一堆恒假分支，所以拆成两个文件（底层设计的判断见
 * docs/场地排位编辑器设计.md §4.2 的"工具是策略对象"）。
 *
 * 所有对文档的修改都走 `core/commands` 的 Command，由 `core/history` 执行——
 * 组件自己**从不** setState 改文档。拖拽期间只更新一个 `delta`，**文档一个
 * 字节都不动**，所以拖动时只有被拖的那块区域在重画。
 */

/** 小于这个屏幕位移就算点击而不是拖动。 */
const TAP_THRESHOLD_PX = 4;
/** 点击回到多边形起点多近算"闭合"（屏幕像素，按 scale 换算到世界坐标判定）。 */
const CLOSE_SNAP_PX = 12;

const TOOL_ITEMS: {
  value: ZoneTool;
  label: string;
  icon: typeof SquareIcon;
}[] = [
  { value: "select", label: "选择", icon: MousePointer2Icon },
  { value: "rect", label: "矩形", icon: SquareIcon },
  // 圆形拿真正的圆形图标；椭圆换一个不同的图标避免两个按钮长得一样
  // （lucide 没有专门的椭圆图标，Disc2 好歹是个扁一点的形状）。
  { value: "ellipse", label: "椭圆", icon: Disc2Icon },
  { value: "circle", label: "圆形", icon: CircleIcon },
  { value: "polygon", label: "多边形", icon: PentagonIcon },
];

/**
 * 文档状态**不在这个组件里**，由外层持有并通过 `onCommand` 修改。
 *
 * 这么分是因为保存、校验、"有未保存修改"提示都发生在外层——状态放里面就得
 * 再往外抛一份，两边同步迟早会漂。编辑器只负责"把手势翻译成 Command"。
 */
export function CanvasEditor({
  state,
  selection,
  onSelectionChange,
  onCommand,
  onEnterZone,
  rightPanel,
}: {
  state: EditorState;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
  onCommand: (run: (current: EditorState) => EditorState) => void;
  /** 双击一块区域、或属性面板里点"进入排位"，都走这个回调。 */
  onEnterZone: (zoneId: string) => void;
  rightPanel?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<ZoneTool>("select");
  const [spaceDown, setSpaceDown] = useState(false);

  /**
   * 多边形工具的点击草稿：还没闭合的一串顶点。
   *
   * ⚠️ **真值存在 ref 里，state 只是渲染用的镜像**——这条踩过一次真实的坑：
   * 快速连续点几下（脚本里同一个事件循环内连发几个 pointerdown/up，用户手速快
   * 时也会撞上）会被 React 18 自动批处理合并到同一轮更新里，这一轮里每次
   * `handleTap` 读到的 `live.current.polygonPoints` 都是**同一份旧值**（它只在
   * 组件重渲染时才刷新）。于是 `setPolygonPoints([...旧值, 新点])` 连调 4 次，
   * 4 次读到的"旧值"完全一样，最后只有最后一次生效——5 个顶点点下去，画出来
   * 只剩 2 个。
   *
   * 用 ref 当真值就没有这个问题：ref 的读写是同步的，不受 React 批处理影响，
   * 旧系统的 `polyPointsRef` 就是这么做的（docs/场地排位编辑器设计.md §6
   * 提到的"看起来对但没被验证过的做法"之一，这次是真验证过了）。
   */
  const polygonPointsRef = useRef<Point[]>([]);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [polygonCursor, setPolygonCursor] = useState<Point | null>(null);

  const syncPolygonPoints = useCallback((next: Point[]) => {
    polygonPointsRef.current = next;
    setPolygonPoints(next);
  }, []);

  const doc = state.doc;
  const { viewport, panBy, zoomAt, fit } = useViewport(doc.world, containerRef);

  // 手势 handler 里要读到最新的这几个值，用 ref 避免闭包读到上一帧的。
  // 故意**不放** polygonPoints——它的真值在 polygonPointsRef 里，放进这个每次
  // 渲染才刷新的快照会重新引入上面那条注释说的批处理坑。
  const live = useRef({ viewport, doc, selection, tool, spaceDown });
  live.current = { viewport, doc, selection, tool, spaceDown };

  type DragState = {
    subject: DragSubject;
    /** 按下时的世界坐标。位移和终点都由它和 current 算出来。 */
    start: Point;
    /** 世界坐标里的累计位移。 */
    delta: Point;
    /** 当前指针的世界坐标。 */
    current: Point;
    /** 屏幕像素的累计位移，只用来判"这算点击还是拖动"。 */
    movedPx: number;
  };
  const [drag, setDrag] = useState<DragState | null>(null);
  /**
   * 同一份拖拽状态再存一份 ref。
   *
   * `onDragEnd` 要读"这次拖的是什么"，而 state 在同一批更新里可能还没落到闭包上——
   * 松手那一下正好是最容易读到旧值的时刻。ref 是同步的，判定用它、渲染用 state。
   */
  const dragRef = useRef<DragState | null>(null);
  const setDragState = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return toWorld(
        { x: clientX - rect.left, y: clientY - rect.top },
        live.current.viewport,
      );
    },
    [],
  );

  const cancelPolygon = useCallback(() => {
    syncPolygonPoints([]);
    setPolygonCursor(null);
  }, [syncPolygonPoints]);

  const finishPolygon = useCallback(
    (points: Point[]) => {
      const shape = polygonShapeFromPoints(points);
      if (shape) {
        onCommand((s) => execute(s, addZone(shape, "seating")));
      }
      cancelPolygon();
      setTool("select");
    },
    [cancelPolygon, onCommand],
  );

  // ---------------------------------------------------------------------
  // 手势（矩形/椭圆拖拽画形状、区域移动/缩放、框选）
  // ---------------------------------------------------------------------

  /**
   * 用 `bind()` 展开到元素上，不用 `target: ref` 那种配置。
   *
   * 踩过一次：配 `target` 时监听器根本没挂上，控制台还一声不吭——滚轮和拖拽
   * 全都没反应，排查了一轮才定位到。展开 `bind()` 是 React 里最直白的接法，
   * 事件从 JSX 上就能看见挂了没有。
   */
  const bindGestures = useGesture(
    {
      onDragStart: ({ event }) => {
        const pointer = event as PointerEvent;
        const point = clientToWorld(pointer.clientX, pointer.clientY);
        const {
          doc: d,
          selection: sel,
          tool: t,
          spaceDown: pan,
          viewport: vp,
        } = live.current;

        // ⚠️ 这里**不能**对 tool === "polygon" 提前 return。
        //
        // 踩过一次：一开始想着"多边形是点击累加顶点，不需要进拖拽状态机"，
        // 就在这里直接 return 跳过了 setDragState。后果是 dragRef 一直是
        // null，onDragEnd 里 `if (!finished) return` 直接把每一次点击都吞了，
        // handleTap 根本没机会跑——多边形工具点了跟没点一样，浏览器里点了
        // 5 下一个顶点都没出现。
        //
        // 实际上不需要特殊处理：resolveDragSubject 对 tool==="polygon" 本来就
        // 返回 { kind: "none" }，走正常流程建一个"什么都不做"的拖拽状态，
        // onDragEnd 照样能用同一套 tap 阈值判定识别出这是一次点击。

        // 中键或按住空格 = 平移画布，压过一切工具。
        const forcePan = pan || pointer.button === 1;
        const subject = resolveDragSubject({
          point,
          doc: d,
          selection: sel,
          tool: t,
          scale: vp.scale,
          forcePan,
        });

        setDragState({
          subject,
          start: point,
          delta: { x: 0, y: 0 },
          current: point,
          movedPx: 0,
        });
      },

      onDrag: ({ event }) => {
        const pointer = event as PointerEvent;
        const { viewport: vp } = live.current;
        const active = dragRef.current;
        if (!active) return;

        // 位移自己算：按下点 → 当前点。**不用手势库给的 movement**——
        // 它在某些事件路径下恒为 0（合成事件就是），而草稿框却照画不误，
        // 于是表现成"框能拉出来、松手却什么都没发生"，极难定位。
        const current = clientToWorld(pointer.clientX, pointer.clientY);
        const delta = {
          x: current.x - active.start.x,
          y: current.y - active.start.y,
        };

        setDragState({
          ...active,
          delta,
          current,
          movedPx: Math.hypot(delta.x, delta.y) * vp.scale,
        });

        if (active.subject.kind === "pan") {
          // 平移直接作用在视口上，不进文档也不进撤销栈。
          panBy({ x: delta.x * vp.scale, y: delta.y * vp.scale });
        }
      },

      onDragEnd: () => {
        const finished = dragRef.current;
        setDragState(null);
        if (!finished) return;

        // 位移和终点都取自己在 onDrag 里累计的那份，不用手势库给的 movement——
        // 松手事件上的坐标在某些路径下拿不到（合成事件、指针被系统抢走），
        // 而自己累计的这份是每次 move 都更新的，恒定可用。
        const delta = finished.delta;
        const point = finished.current;
        const { tool: t } = live.current;

        // 位移小于阈值当点击处理：只改选中/画多边形顶点，不产生拖拽类命令。
        // 自己判而不用库的 tap，是因为这条判定要跟上面的 delta 用同一份数据。
        if (finished.movedPx < TAP_THRESHOLD_PX) {
          handleTap(point, t);
          return;
        }

        switch (finished.subject.kind) {
          case "drawZone": {
            const rect = normalizeRect(finished.subject.start, point);
            // 太小的框当误操作忽略，不然会在画布上撒一堆看不见的小区域。
            if (rect.width < MIN_DRAW_SIZE || rect.height < MIN_DRAW_SIZE) {
              return;
            }
            const shape = boxShapeFromDrag(finished.subject.shapeType, rect);
            onCommand((s) => execute(s, addZone(shape, "seating")));
            setTool("select");
            return;
          }
          case "moveZones":
            onCommand((s) =>
              execute(
                s,
                moveZones(
                  finished.subject.kind === "moveZones"
                    ? finished.subject.zoneIds
                    : [],
                  delta,
                ),
              ),
            );
            return;
          case "resizeZone": {
            const subject = finished.subject;
            const next = resizeRect(subject.origin, subject.handle, delta);
            onCommand((s) => execute(s, resizeZone(subject.zoneId, next)));
            return;
          }
          case "marquee":
            // 顶层框选目前没有可选对象（座位不在这一层），点一下空白只是清空选中，
            // 拖一下框选也一样——保留这个分支只是让状态机完整，行为等价于空操作。
            onSelectionChange(EMPTY_SELECTION);
            return;
          default:
        }
      },
    },
    // 刻意**不开** filterTaps：开了之后纯点击不会触发 drag，onDragStart 不跑、
    // dragRef 是空的，于是"点一下选中"整个失效。tap 判定自己在 onDragEnd 里
    // 按位移阈值做（TAP_THRESHOLD_PX），不需要库再插一手。
    { drag: { filterTaps: false } },
  );

  /**
   * 滚轮缩放单独挂原生监听，不走 useGesture。
   *
   * 必须 `passive: false` 才能 `preventDefault()` 挡掉浏览器自身的页面缩放/滚动，
   * 而 React 的 `onWheel` 是被动注册的、拦不住。
   */
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        event.deltaY > 0 ? 0.92 : 1.08,
      );
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /** 多边形工具下鼠标移动要更新"下一条边"的虚线预览，即使没有按下也要跟着走。 */
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const onMove = (event: PointerEvent) => {
      if (
        live.current.tool !== "polygon" ||
        polygonPointsRef.current.length === 0
      ) {
        return;
      }
      setPolygonCursor(clientToWorld(event.clientX, event.clientY));
    };
    element.addEventListener("pointermove", onMove);
    return () => element.removeEventListener("pointermove", onMove);
  }, [clientToWorld]);

  const handleTap = (point: Point, currentTool: ZoneTool) => {
    const { doc: d, viewport: vp } = live.current;

    if (currentTool === "polygon") {
      // 读 ref 不读 state：连续快速点击会落在同一批 React 更新里，state
      // 要等重渲染才刷新，ref 是同步的——这正是上面那条长注释踩过的坑。
      const pts = polygonPointsRef.current;

      // 点回起点附近（且已经有至少 3 个点）→ 闭合多边形。
      if (pts.length >= 3) {
        const first = pts[0];
        const distPx =
          Math.hypot(point.x - first.x, point.y - first.y) * vp.scale;
        if (distPx <= CLOSE_SNAP_PX) {
          finishPolygon(pts);
          return;
        }
      }
      syncPolygonPoints([...pts, point]);
      return;
    }

    const zoneId = hitZone(d, point);
    if (zoneId) {
      onSelectionChange({ zoneIds: [zoneId], seatIds: [] });
      return;
    }

    onSelectionChange(EMPTY_SELECTION);
  };

  // ---------------------------------------------------------------------
  // 键盘
  // ---------------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 输入框里按 Delete 不该删区域。
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.code === "Space") {
        setSpaceDown(true);
        event.preventDefault();
        return;
      }

      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        onCommand((s) => (event.shiftKey ? redo(s) : undo(s)));
        return;
      }

      if (event.key === "Escape") {
        if (polygonPointsRef.current.length > 0) {
          cancelPolygon();
          return;
        }
        onSelectionChange(EMPTY_SELECTION);
        setTool("select");
        return;
      }

      // 多边形草稿没闭合时，Enter 也能收尾（跟点回起点等价）。
      if (event.key === "Enter" && polygonPointsRef.current.length >= 3) {
        finishPolygon(polygonPointsRef.current);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        const sel = live.current.selection;
        if (sel.zoneIds.length > 0) {
          onCommand((s) => execute(s, removeZones(sel.zoneIds)));
          onSelectionChange(EMPTY_SELECTION);
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [onCommand, onSelectionChange, cancelPolygon, finishPolygon]);

  // ---------------------------------------------------------------------
  // 拖拽预览
  // ---------------------------------------------------------------------

  const { dragOffset, draftRect, resizePreview } = useMemo(() => {
    if (!drag) {
      return { dragOffset: null, draftRect: null, resizePreview: null };
    }

    switch (drag.subject.kind) {
      case "moveZones":
        return {
          dragOffset: {
            zoneIds: new Set(drag.subject.zoneIds),
            delta: drag.delta,
          },
          draftRect: null,
          resizePreview: null,
        };
      case "drawZone": {
        const rect = normalizeRect(drag.subject.start, drag.current);
        // 圆形工具拖拽时预览框也摁成正方形，跟松手后落库的形状对上——
        // 不然拖出来是长方形虚线框，松手突然跳成圆，手感很怪。
        const preview =
          drag.subject.shapeType === "circle"
            ? {
                x: rect.x,
                y: rect.y,
                width: Math.max(rect.width, rect.height),
                height: Math.max(rect.width, rect.height),
              }
            : rect;
        return { dragOffset: null, draftRect: preview, resizePreview: null };
      }
      case "marquee":
        return {
          dragOffset: null,
          draftRect: normalizeRect(drag.subject.start, drag.current),
          resizePreview: null,
        };
      case "resizeZone": {
        const rect: Rect = resizeRect(
          drag.subject.origin,
          drag.subject.handle,
          drag.delta,
        );
        return {
          dragOffset: null,
          draftRect: null,
          resizePreview: { zoneId: drag.subject.zoneId, rect },
        };
      }
      default:
        return { dragOffset: null, draftRect: null, resizePreview: null };
    }
  }, [drag]);

  const cursor = spaceDown
    ? "grab"
    : tool === "select"
      ? "default"
      : "crosshair";

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
          {TOOL_ITEMS.map((item) => (
            <Button
              key={item.value}
              type="button"
              variant={tool === item.value ? "default" : "ghost"}
              size="sm"
              className={cn(tool !== item.value && "text-muted-foreground")}
              onClick={() => {
                if (tool === "polygon" && item.value !== "polygon")
                  cancelPolygon();
                setTool(item.value);
              }}
            >
              <item.icon />
              {item.label}
            </Button>
          ))}

          <span className="mx-1 h-5 w-px bg-border" aria-hidden />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={!canUndo(state)}
            title={undoLabel(state) ? `撤销：${undoLabel(state)}` : "撤销"}
            onClick={() => onCommand(undo)}
          >
            <UndoIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={!canRedo(state)}
            title={redoLabel(state) ? `重做：${redoLabel(state)}` : "重做"}
            onClick={() => onCommand(redo)}
          >
            <RedoIcon />
          </Button>

          <span className="mx-1 h-5 w-px bg-border" aria-hidden />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            title="缩放到合适大小"
            onClick={fit}
          >
            <ScanIcon />
            适配
          </Button>

          <span className="ml-auto pr-1 text-muted-foreground text-xs">
            {tool === "polygon"
              ? "点击添加顶点 · 点回起点或按 Enter 闭合 · Esc 取消"
              : "双击区域进入排位 · 按住空格拖动画布 · 滚轮缩放 · Ctrl+Z 撤销"}
          </span>
        </div>

        <div ref={containerRef} className="min-h-0 flex-1">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 手势由 useGesture 绑在 ref 上 */}
          <svg
            ref={svgRef}
            {...bindGestures()}
            className="h-full w-full touch-none"
            style={{ cursor }}
            role="application"
            aria-label="场地区域分布画布"
            onDoubleClick={(event) => {
              if (tool !== "select") return;
              const rect = svgRef.current?.getBoundingClientRect();
              if (!rect) return;
              const point = clientToWorld(event.clientX, event.clientY);
              const zoneId = hitZone(doc, point);
              if (zoneId) onEnterZone(zoneId);
            }}
          >
            <defs>
              <pattern
                id="venue-grid"
                width={40}
                height={40}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 40 0 L 0 0 0 40"
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth={0.6}
                />
              </pattern>
            </defs>
            <CanvasView
              doc={doc}
              viewport={viewport}
              selection={selection}
              dragOffset={dragOffset}
              draftRect={draftRect}
              polygonDraft={
                polygonPoints.length > 0
                  ? { points: polygonPoints, cursor: polygonCursor }
                  : null
              }
              resizePreview={resizePreview}
            />
          </svg>
        </div>
      </div>

      {rightPanel}
    </div>
  );
}

/** 矩形/椭圆拖拽画形状的最小尺寸，太小当误操作忽略——跟 MIN_ZONE_SIZE 是两回事：
 * 这个挡的是"手抖点了一下"，MIN_ZONE_SIZE 挡的是"故意画一个但拖得太小"。 */
const MIN_DRAW_SIZE = 8;
