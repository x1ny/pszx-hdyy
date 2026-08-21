import { memo } from "react";
import type { CanvasDoc, CanvasSeat, CanvasZone } from "../core/document";
import { type Point, pointsToSvg, type Rect } from "../core/geometry";
import {
  handleRects,
  type Selection,
  zonePolygonPoints,
} from "../core/interaction";
import type { Viewport } from "./use-viewport";

/**
 * 纯渲染层。**不含任何交互逻辑**——事件全在父组件的一个 gesture handler 上，
 * 这里只负责把文档画出来。
 *
 * v2：顶层区域分布画布**不再渲染座位**（参考旧系统——最外层只做区域分布，
 * 进入区域后才是排位），所以这个组件现在只画区域形状。座位渲染挪到
 * `SeatNode`（这里导出，供 `zone-seating-view.tsx` 复用）。
 */

/** 座位半径。比 interaction.ts 的命中半径小，好点中又不显得挤。 */
const SEAT_R = 9;

type SeatNodeProps = {
  seat: CanvasSeat;
  origin: Point;
  selected: boolean;
  /** 拖拽期间的临时位移。**不写进文档**，所以整份 doc 不重建、memo 全部生效。 */
  offset: Point | null;
  showLabel: boolean;
  /**
   * 排位方案层才有的两个状态，场地库画布上恒为 undefined。
   *
   * 它们**不属于 `CanvasSeat`**——"谁坐这"和"本环节启不启用"是核心表的语义，
   * 不是编辑器文档的内容（底层设计 §1 那条分界线）。所以按 externalId 从外面
   * 传进来，而不是塞进 doc 里让编辑器去存。
   */
  occupantName?: string;
  planDisabled?: boolean;
};

/**
 * 单个座位。`memo` 是性能的关键一环：拖动时只有被拖的那几个的 `offset` 变了，
 * 其余上千个 props 全等、直接跳过 re-render。
 *
 * 旧系统在这里是反面教材——座位组件没有 memo，且每帧把整个数组提到父组件
 * setState，600 个座位就是每帧 diff 三四千个 SVG 节点。
 */
export const SeatNode = memo(function SeatNode({
  seat,
  origin,
  selected,
  offset,
  showLabel,
  occupantName,
  planDisabled,
}: SeatNodeProps) {
  const cx = origin.x + seat.x + (offset?.x ?? 0);
  const cy = origin.y + seat.y + (offset?.y ?? 0);
  const vip = seat.rank === "vip";
  const occupied = occupantName !== undefined;

  return (
    <g opacity={planDisabled ? 0.35 : 1}>
      <circle
        cx={cx}
        cy={cy}
        r={SEAT_R}
        // 有人 → 实心主色；VIP 空座 → 警示色；普通空座 → 卡片底色。
        // 三种状态各自一个填充，不靠深浅区分。
        fill={
          occupied ? "var(--primary)" : vip ? "var(--warning)" : "var(--card)"
        }
        stroke={selected ? "var(--primary)" : "var(--border)"}
        strokeWidth={selected ? 2.5 : 1.2}
      />
      {seat.kind === "standing" && (
        // 站位画成空心方块，跟座位一眼能分开——不能只靠颜色，色觉障碍用户看不出。
        <rect
          x={cx - 4}
          y={cy - 4}
          width={8}
          height={8}
          fill="none"
          stroke={
            occupied ? "var(--primary-foreground)" : "var(--muted-foreground)"
          }
          strokeWidth={1.2}
        />
      )}
      {planDisabled && (
        // 停用画一道斜杠。同理，不能只靠透明度——那在小尺寸下看不出来。
        <line
          x1={cx - SEAT_R}
          y1={cy + SEAT_R}
          x2={cx + SEAT_R}
          y2={cy - SEAT_R}
          stroke="var(--muted-foreground)"
          strokeWidth={1.5}
        />
      )}
      {showLabel && (
        <text
          x={cx}
          y={cy + SEAT_R + 9}
          textAnchor="middle"
          fontSize={9}
          fill="var(--muted-foreground)"
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {seat.label}
        </text>
      )}
      {showLabel && occupantName && (
        <text
          x={cx}
          y={cy + SEAT_R + 19}
          textAnchor="middle"
          fontSize={9}
          fontWeight={600}
          fill="var(--primary)"
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {occupantName}
        </text>
      )}
    </g>
  );
});

/**
 * 区域内部渲染的那个几何图形，形状分派——rect/ellipse/polygon 各画各的标签。
 * 导出给 `zone-seating-editor.tsx` 复用：排位画布要在背景画出当前区域的轮廓
 * 作为参照（非交互），同一份形状渲染逻辑没有理由抄两遍。
 */
export function ZoneGeometry({ zone }: { zone: CanvasZone }) {
  const { fill, stroke } = zone;
  const common = { fill, fillOpacity: 0.14, stroke, strokeWidth: 2 } as const;

  switch (zone.shape.type) {
    case "rect":
      return (
        <rect
          x={zone.shape.x}
          y={zone.shape.y}
          width={zone.shape.width}
          height={zone.shape.height}
          rx={6}
          {...common}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={zone.shape.x + zone.shape.width / 2}
          cy={zone.shape.y + zone.shape.height / 2}
          rx={zone.shape.width / 2}
          ry={zone.shape.height / 2}
          {...common}
        />
      );
    case "polygon":
      return (
        <polygon points={pointsToSvg(zonePolygonPoints(zone))} {...common} />
      );
    default:
      return null;
  }
}

const ZoneNode = memo(function ZoneNode({
  zone,
  selected,
  offset,
  seatCount,
}: {
  zone: CanvasZone;
  selected: boolean;
  offset: Point | null;
  seatCount: number;
}) {
  // offset 只在拖拽移动时给，用 <g transform> 统一搬运——多边形的顶点是相对
  // 坐标，靠这层 translate 就能跟矩形/椭圆一样平移，不用在几何层面特殊处理。
  const dx = offset?.x ?? 0;
  const dy = offset?.y ?? 0;
  const labelX = zone.shape.x + 10 + dx;
  const labelY = zone.shape.y + dy;

  return (
    <g>
      <g
        transform={offset ? `translate(${dx} ${dy})` : undefined}
        stroke={selected ? "var(--primary)" : undefined}
        strokeWidth={selected ? 2.5 : undefined}
      >
        <ZoneGeometry zone={zone} />
      </g>
      <text
        x={labelX}
        y={labelY + 20}
        fontSize={13}
        fontWeight={600}
        fill={zone.stroke}
        style={{ userSelect: "none", pointerEvents: "none" }}
      >
        {zone.name}
      </text>
      <text
        x={labelX}
        y={labelY + 36}
        fontSize={11}
        fill="var(--muted-foreground)"
        style={{ userSelect: "none", pointerEvents: "none" }}
      >
        {seatCount > 0 ? `座位 ${seatCount}` : "未排位"}
      </text>
    </g>
  );
});

export type CanvasViewProps = {
  doc: CanvasDoc;
  viewport: Viewport;
  selection: Selection;
  /** 正在拖拽的临时位移。这一层只有区域会被拖，座位不在这里渲染。 */
  dragOffset: { zoneIds: Set<string>; delta: Point } | null;
  /** 正在拉的框（新建矩形/椭圆区域，或空白框选），世界坐标。 */
  draftRect: Rect | null;
  /** 正在点击构造的多边形草稿：已确认的顶点 + 当前指针位置（用来画"下一条边"）。 */
  polygonDraft: { points: Point[]; cursor: Point | null } | null;
  /** 缩放中的区域预览。 */
  resizePreview: { zoneId: string; rect: Rect } | null;
};

export function CanvasView({
  doc,
  viewport,
  selection,
  dragOffset,
  draftRect,
  polygonDraft,
  resizePreview,
}: CanvasViewProps) {
  const selectedZones = new Set(selection.zoneIds);

  const seatCountByZone = new Map<string, number>();
  for (const seat of doc.seats) {
    seatCountByZone.set(
      seat.zoneExternalId,
      (seatCountByZone.get(seat.zoneExternalId) ?? 0) + 1,
    );
  }

  return (
    <g
      transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}
    >
      {/* 世界边界 + 网格。网格是纯装饰，不参与吸附（第一版不做吸附）。 */}
      <rect
        x={0}
        y={0}
        width={doc.world.width}
        height={doc.world.height}
        fill="var(--card)"
        stroke="var(--border)"
      />
      <rect
        x={0}
        y={0}
        width={doc.world.width}
        height={doc.world.height}
        fill="url(#venue-grid)"
      />

      {doc.zones.map((zone) => {
        const preview =
          resizePreview?.zoneId === zone.externalId ? resizePreview.rect : null;
        const shown = preview
          ? { ...zone, shape: { ...zone.shape, ...preview } }
          : zone;
        return (
          <ZoneNode
            key={zone.externalId}
            zone={shown}
            selected={selectedZones.has(zone.externalId)}
            offset={
              dragOffset?.zoneIds.has(zone.externalId) ? dragOffset.delta : null
            }
            seatCount={seatCountByZone.get(zone.externalId) ?? 0}
          />
        );
      })}

      {/* 选中区域的缩放手柄。除以 scale 让它在屏幕上大小恒定——
          这是旧代码里少数值得原样保留的细节。手柄按包围盒给，跟形状无关。 */}
      {doc.zones
        .filter((zone) => selectedZones.has(zone.externalId))
        .flatMap((zone) =>
          handleRects(zone, viewport.scale).map(({ handle, rect }) => (
            <rect
              key={`${zone.externalId}-${handle}`}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill="var(--card)"
              stroke="var(--primary)"
              strokeWidth={1.5 / viewport.scale}
            />
          )),
        )}

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

      {polygonDraft && polygonDraft.points.length > 0 && (
        <g>
          {/* 已确认的边，实线；到当前指针的那一段是虚线预览。 */}
          <polyline
            points={pointsToSvg(polygonDraft.points)}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={1.5 / viewport.scale}
          />
          {polygonDraft.cursor && (
            <line
              x1={polygonDraft.points.at(-1)?.x}
              y1={polygonDraft.points.at(-1)?.y}
              x2={polygonDraft.cursor.x}
              y2={polygonDraft.cursor.y}
              stroke="var(--primary)"
              strokeWidth={1.5 / viewport.scale}
              strokeDasharray={`${6 / viewport.scale} ${4 / viewport.scale}`}
            />
          )}
          {polygonDraft.points.map((point, index) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: 顶点没有稳定 id，绘制中顺序即身份
              key={index}
              cx={point.x}
              cy={point.y}
              r={(index === 0 ? 6 : 4) / viewport.scale}
              fill={index === 0 ? "var(--primary)" : "var(--card)"}
              stroke="var(--primary)"
              strokeWidth={1.5 / viewport.scale}
            />
          ))}
        </g>
      )}
    </g>
  );
}
