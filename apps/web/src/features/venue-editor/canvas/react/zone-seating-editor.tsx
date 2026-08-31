import { useGesture } from "@use-gesture/react";
import {
  ArrowLeftIcon,
  LayoutTemplateIcon,
  MousePointer2Icon,
  RedoIcon,
  ScanIcon,
  SofaIcon,
  TypeIcon,
  UndoIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import { cn } from "#/shared/lib/utils.ts";
import {
  addSeat,
  applyLayoutToZone,
  moveSeats,
  removeSeats,
} from "../core/commands";
import type { CanvasDoc, CanvasZone } from "../core/document";
import {
  normalizeRect,
  type Point,
  seatFieldPitch,
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
  EMPTY_SELECTION,
  hitSeat,
  marqueeSelect,
  resolveSeatDragSubject,
  type SeatDragSubject,
  type SeatTool,
  type Selection,
} from "../core/interaction";
import {
  NAME_READABLE_PITCH_PX,
  type SeatOccupantVisual,
  scaleForPitch,
  seatRenderSpec,
} from "../seat-occupant-visual";
import { SeatNode, ZoneGeometry } from "./canvas-view";
import { TemplateDialog } from "./template-dialog";
import { useViewport } from "./use-viewport";

/**
 * 排位画布——两级架构的**第二层**，进入一个区域之后才会看到。
 *
 * 参考旧系统 `venue/config/seating/index.tsx`：左边是排位模板卡片
 * （`LayoutPicker`），右边是这块区域自己的座位画布，跟顶层的区域分布画布是
 * 两个完全不同的编辑范围——这里唯一能选中的对象是座位，没有"区域"，
 * 所以工具集、拖拽判定（`resolveSeatDragSubject`）、渲染都比顶层简单。
 *
 * 坐标系是这个组件成立的关键：座位的 x/y 本来就存的是**相对区域左上角**的坐标
 * （`document.ts` 里 `CanvasSeat.x` 的注释），所以这里可以把"整块区域的大小"
 * 直接当成画布的世界尺寸，座位坐标原样使用，不用像顶层那样处理"区域在世界
 * 里的位置"。少一层换算，也少一类可能算错的地方。
 */

const TAP_THRESHOLD_PX = 4;

const TOOL_ITEMS: { value: SeatTool; label: string; icon: typeof SofaIcon }[] =
  [
    { value: "select", label: "选择", icon: MousePointer2Icon },
    { value: "seat", label: "点放位置", icon: SofaIcon },
  ];

export function ZoneSeatingEditor({
  zone,
  state,
  selection,
  onSelectionChange,
  onCommand,
  onBack,
  backLabel,
  title,
  rightPanel,
  legend,
  toolbarActions,
  headerContent,
  frameRef,
  frameClassName,
  isFullscreen,
  onExitFullscreen,
  onEscape,
  seatStatus,
  assignOnly,
}: {
  zone: CanvasZone;
  state: EditorState;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
  onCommand: (run: (current: EditorState) => EditorState) => void;
  onBack: () => void;
  backLabel?: string;
  /** 标题里"{区域名} · {title}"的后半段，默认"排位"。 */
  title?: string;
  rightPanel?: React.ReactNode;
  /** 画布下方的业务图例；排位页用它解释座位与选中状态。 */
  legend?: React.ReactNode;
  /** 工具栏右侧的页面专属操作，例如全屏。 */
  toolbarActions?: React.ReactNode;
  /** 标题下、工具栏前的页面级操作提示；全屏时它仍属于编辑器容器。 */
  headerContent?: React.ReactNode;
  /** 包住标题、工具栏、画布、图例和右侧面板的容器，供页面请求全屏。 */
  frameRef?: React.RefObject<HTMLDivElement | null>;
  /** 全屏/页面铺满时由调用方提供的布局类。 */
  frameClassName?: string;
  /** 全屏时 Escape 只退出全屏，不清空画布当前选择。 */
  isFullscreen?: boolean;
  onExitFullscreen?: () => void;
  /**
   * 调用方可接管入座阶段的 Escape，例如退出团体批量选座模式。
   * 返回 true 时编辑器不再清空 selection。
   */
  onEscape?: () => boolean;
  /**
   * 每个座位在**环节排位方案**里的状态：谁坐、本环节启不启用。
   *
   * 按 externalId 从外面传进来，不进 `CanvasDoc`——"谁坐这"是核心表的语义，
   * 不是编辑器文档的内容（底层设计 §1）。场地库画布用这个组件时不传，
   * 那边根本没有"人"这个概念。
   */
  seatStatus?: ReadonlyMap<
    string,
    { occupant?: SeatOccupantVisual; disabled?: boolean }
  >;
  /**
   * 排位阶段（环节把人放到座位上）**不能再编辑几何**，只能选中座位交给右侧
   * 面板入座——布局这时候已经从活动空间那份拷贝定下来了，改动几何要回活动
   * 空间的编辑器去做，不在这里。
   *
   * 传了这个 flag 之后：工具栏只剩"选择"和"适配"，点放位置/撤销/重做/导入
   * 模板全部不渲染；拖一个已选中的座位不再触发移动，退化成一次纯点击。
   * 场地库和活动空间两处仍然全功能编辑，不传这个 prop。
   */
  assignOnly?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<SeatTool>("select");
  const [spaceDown, setSpaceDown] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const zoneSize = useMemo(
    () => ({ width: zone.shape.width, height: zone.shape.height }),
    [zone.shape.width, zone.shape.height],
  );
  const { viewport, panBy, zoomAt, zoomToScale, fit } = useViewport(
    zoneSize,
    containerRef,
  );

  const zoneSeats = useMemo(
    () =>
      state.doc.seats.filter((seat) => seat.zoneExternalId === zone.externalId),
    [state.doc.seats, zone.externalId],
  );

  /**
   * 这片座位有多密——**整个呈现层唯一的输入量**。跟着座位集合变，
   * 不跟着缩放变，所以只在增删座位时重算一次。
   */
  const worldPitch = useMemo(
    () => seatFieldPitch(zoneSeats.map((seat) => ({ x: seat.x, y: seat.y }))),
    [zoneSeats],
  );
  /**
   * 当前密度下该画多大、写得下几个字。整片区域共用一个对象，
   * `SeatNode` 的 `memo` 才不会因为每个座位各拿一个新对象而全部失效。
   */
  const renderSpec = useMemo(
    () => seatRenderSpec(worldPitch * viewport.scale),
    [worldPitch, viewport.scale],
  );
  /**
   * 命中半径换算回世界坐标。跟视觉半径同源，所以**看得见的地方就点得中**——
   * 以前这里是写死的 13 世界单位，缩放之后和圆点大小完全脱钩。
   */
  const hitRadius = renderSpec.hitRadiusPx / viewport.scale;

  /**
   * 供 `hitSeat`/`marqueeSelect` 用的"零点区域"文档——把这块区域的 shape.x/y
   * 都置零，这样那两个通用函数（本来是给顶层世界坐标写的）在这里算出来的
   * 命中结果，跟这个画布"世界即区域"的坐标系正好对上，不用另写一套。
   */
  const localDoc: CanvasDoc = useMemo(
    () => ({
      schemaVersion: 1,
      world: zoneSize,
      zones: [{ ...zone, shape: { ...zone.shape, x: 0, y: 0 } }],
      seats: zoneSeats,
    }),
    [zone, zoneSize, zoneSeats],
  );

  const live = useRef({
    viewport,
    localDoc,
    selection,
    tool,
    spaceDown,
    hitRadius,
    assignOnly,
    isFullscreen,
    onExitFullscreen,
    onEscape,
  });
  live.current = {
    viewport,
    localDoc,
    selection,
    tool,
    spaceDown,
    hitRadius,
    assignOnly,
    isFullscreen,
    onExitFullscreen,
    onEscape,
  };

  type DragState = {
    subject: SeatDragSubject;
    start: Point;
    delta: Point;
    current: Point;
    movedPx: number;
  };
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
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

  const bindGestures = useGesture(
    {
      onDragStart: ({ event }) => {
        const pointer = event as PointerEvent;
        const point = clientToWorld(pointer.clientX, pointer.clientY);
        const {
          localDoc: d,
          selection: sel,
          tool: t,
          spaceDown: pan,
          hitRadius: radius,
        } = live.current;

        const forcePan = pan || pointer.button === 1;
        let subject = resolveSeatDragSubject({
          point,
          doc: d,
          selection: sel,
          tool: t,
          forcePan,
          hitRadius: radius,
        });

        // 入座阶段不许挪座位——把"拖一个已选中座位"降级成"什么都不做"，
        // tap 阈值判定照样跑，纯点击依然能选中/换选，只是拖不动它。
        if (live.current.assignOnly && subject.kind === "moveSeats") {
          subject = { kind: "none" };
        }

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

        // 位移自己算，不用手势库的 movement——它在合成事件下恒为 0，
        // 这条坑是画区域分布画布时踩出来的（见 canvas-editor.tsx 同名注释）。
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
          panBy({ x: delta.x * vp.scale, y: delta.y * vp.scale });
        }
      },

      onDragEnd: () => {
        const finished = dragRef.current;
        setDragState(null);
        if (!finished) return;

        const { localDoc: d, tool: t } = live.current;
        const delta = finished.delta;
        const point = finished.current;

        if (finished.movedPx < TAP_THRESHOLD_PX) {
          handleTap(point, t);
          return;
        }

        switch (finished.subject.kind) {
          case "moveSeats":
            onCommand((s) =>
              execute(
                s,
                moveSeats(
                  finished.subject.kind === "moveSeats"
                    ? finished.subject.seatIds
                    : [],
                  delta,
                ),
              ),
            );
            return;
          case "marquee": {
            const seatIds = marqueeSelect(
              d,
              finished.subject.start,
              point,
              live.current.hitRadius,
            );
            onSelectionChange({ zoneIds: [], seatIds });
            return;
          }
          default:
        }
      },
    },
    // 同 canvas-editor.tsx：filterTaps 开着会让纯点击不触发 drag，
    // "点一下选中/放座位"就整个失效，tap 判定自己按位移阈值做。
    { drag: { filterTaps: false } },
  );

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

  const handleTap = (point: Point, currentTool: SeatTool) => {
    const { localDoc: d } = live.current;

    // 防御性判断：assignOnly 时工具栏根本不渲染"点放位置"按钮，tool 理论上
    // 不可能是 "seat"，这里再挡一道，不依赖"UI 没渲染就等于不会发生"。
    if (currentTool === "seat" && !live.current.assignOnly) {
      const count = zoneSeats.length;
      onCommand((s) =>
        execute(s, addSeat(zone.externalId, point, `S${count + 1}`)),
      );
      return;
    }

    const seatId = hitSeat(d, point, live.current.hitRadius);
    onSelectionChange(
      seatId ? { zoneIds: [], seatIds: [seatId] } : EMPTY_SELECTION,
    );
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 原生全屏按 Escape 会同时派发 keydown 和 fullscreenchange。这里主动走页面
      // 的退出函数，避免本编辑器把 Escape 当作“取消选择”，进出全屏仍保留选择。
      if (
        event.key === "Escape" &&
        live.current.isFullscreen &&
        live.current.onExitFullscreen
      ) {
        event.preventDefault();
        live.current.onExitFullscreen();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.code === "Space") {
        setSpaceDown(true);
        event.preventDefault();
        return;
      }
      // 撤销/重做/删除都是几何操作，入座阶段整组不认——不止是按钮不渲染，
      // 快捷键也得真的不生效，否则"看不见的功能"比"按钮变灰"更容易让人误触。
      if (live.current.assignOnly) {
        if (event.key === "Escape") {
          if (live.current.onEscape?.()) {
            event.preventDefault();
            return;
          }
          onSelectionChange(EMPTY_SELECTION);
        }
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        onCommand((s) => (event.shiftKey ? redo(s) : undo(s)));
        return;
      }
      if (event.key === "Escape") {
        onSelectionChange(EMPTY_SELECTION);
        setTool("select");
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const sel = live.current.selection;
        if (sel.seatIds.length > 0) {
          onCommand((s) => execute(s, removeSeats(sel.seatIds)));
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
  }, [onCommand, onSelectionChange]);

  const dragOffset = useMemo(() => {
    if (!drag || drag.subject.kind !== "moveSeats") return null;
    return { seatIds: new Set(drag.subject.seatIds), delta: drag.delta };
  }, [drag]);

  const draftRect = useMemo(() => {
    if (!drag || drag.subject.kind !== "marquee") return null;
    return normalizeRect(drag.subject.start, drag.current);
  }, [drag]);

  const cursor = spaceDown ? "grab" : tool === "seat" ? "copy" : "default";
  const selectedSeats = new Set(selection.seatIds);

  const showLabels = renderSpec.seatLabelChars > 0;
  /** 姓名还没写得下时，「看姓名」按钮才有意义。 */
  const nameReadableScale = scaleForPitch(worldPitch, NAME_READABLE_PITCH_PX);
  const namesHidden = renderSpec.nameChars === 0;

  return (
    <div
      ref={frameRef}
      className={cn("flex min-h-0 flex-1 flex-col gap-3", frameClassName)}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "text-muted-foreground",
          )}
          aria-label={backLabel ?? "返回场地区域分布"}
        >
          <ArrowLeftIcon />
        </button>
        <div>
          <h2 className="font-semibold text-lg leading-tight">
            {zone.name} · {title ?? "排位"}
          </h2>
          <p className="text-muted-foreground text-xs">
            {zoneSeats.length > 0
              ? `已有 ${zoneSeats.length} 个座位`
              : assignOnly
                ? "这个区域还没有座位"
                : "还没有座位，先套一个模板"}
          </p>
        </div>
      </div>

      {headerContent}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-card px-2 py-1.5 shadow-sm">
            {(assignOnly
              ? TOOL_ITEMS.filter((item) => item.value === "select")
              : TOOL_ITEMS
            ).map((item) => (
              <Button
                key={item.value}
                type="button"
                variant={tool === item.value ? "default" : "ghost"}
                size="sm"
                className={cn(tool !== item.value && "text-muted-foreground")}
                onClick={() => setTool(item.value)}
              >
                <item.icon />
                {item.label}
              </Button>
            ))}

            {!assignOnly && (
              <>
                <span className="mx-1 h-5 w-px bg-border" aria-hidden />

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={!canUndo(state)}
                  title={
                    undoLabel(state) ? `撤销：${undoLabel(state)}` : "撤销"
                  }
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
                  title={
                    redoLabel(state) ? `重做：${redoLabel(state)}` : "重做"
                  }
                  onClick={() => onCommand(redo)}
                >
                  <RedoIcon />
                </Button>
              </>
            )}

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

            {/* 姓名写不下时，一次跳到写得下的倍率——那个倍率是算得出来的，
                不该让用户滚轮试。写得下之后按钮就没意义了，隐藏。 */}
            {zoneSeats.length > 0 && namesHidden && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                title={`放大到能显示姓名（约 ${nameReadableScale.toFixed(1)} 倍）`}
                onClick={() => zoomToScale(nameReadableScale)}
              >
                <TypeIcon />
                看姓名
              </Button>
            )}

            {(toolbarActions || !assignOnly) && (
              <div className="ml-auto flex items-center gap-1">
                {toolbarActions}
                {!assignOnly && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setTemplateOpen(true)}
                  >
                    <LayoutTemplateIcon />
                    导入模板
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card shadow-sm">
            <div ref={containerRef} className="h-full">
              <svg
                ref={svgRef}
                {...bindGestures()}
                className="h-full w-full touch-none"
                style={{ cursor }}
                role="application"
                aria-label={`${zone.name} 排位画布`}
              >
                <g
                  transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}
                >
                  <rect
                    x={0}
                    y={0}
                    width={zoneSize.width}
                    height={zoneSize.height}
                    fill="var(--card)"
                    stroke="var(--border)"
                  />
                  {/* 区域自己的形状画在背景做参照，不可交互——真正能选中/拖动的只有座位。 */}
                  <ZoneGeometry zone={localDoc.zones[0]} />

                  {zoneSeats.map((seat) => {
                    const status = seatStatus?.get(seat.externalId);
                    return (
                      <SeatNode
                        key={seat.externalId}
                        seat={seat}
                        origin={{ x: 0, y: 0 }}
                        selected={selectedSeats.has(seat.externalId)}
                        offset={
                          dragOffset?.seatIds.has(seat.externalId)
                            ? dragOffset.delta
                            : null
                        }
                        showLabel={showLabels}
                        occupant={status?.occupant}
                        planDisabled={status?.disabled}
                        viewportScale={viewport.scale}
                        spec={renderSpec}
                      />
                    );
                  })}

                  {draftRect && (
                    <rect
                      x={draftRect.x}
                      y={draftRect.y}
                      width={draftRect.width}
                      height={draftRect.height}
                      fill="var(--primary)"
                      fillOpacity={0.08}
                      stroke="var(--primary)"
                      strokeWidth={1.5 / viewport.scale}
                      strokeDasharray={`${6 / viewport.scale} ${4 / viewport.scale}`}
                    />
                  )}
                </g>
              </svg>
            </div>
          </div>

          {legend}
        </div>

        {rightPanel}
      </div>

      {!assignOnly && (
        <TemplateDialog
          open={templateOpen}
          onOpenChange={setTemplateOpen}
          existingSeatCount={zoneSeats.length}
          onApply={(preset, params) =>
            onCommand((s) =>
              execute(s, applyLayoutToZone(zone.externalId, preset, params)),
            )
          }
        />
      )}
    </div>
  );
}
