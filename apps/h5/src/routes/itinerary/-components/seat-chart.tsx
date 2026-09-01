import type { ReactNode } from "react";
import type { VenueMapInfo } from "../-data";

/**
 * 座位位置图。
 *
 * 刻意用矢量画而不是放一张图：真实场馆的座位图本来就是示意图，画出来才能
 * 按分区 + 「N排M座」把嘉宾自己那个点标出来——这也意味着接口不用多传任何
 * 坐标字段，现有的 zone / seat 两个字符串就够。
 *
 * 座位点位由每个分区的 `seatX/seatY` 派生：可读性优先于空间保真，间距是排
 * 得开的假间距，只保证顺序和相邻关系对得上。
 */

const VW = 720;
const VH = 560;

interface ZoneLayout {
  tint: string;
  labelColor: string;
  block: { x: number; y: number; w: number; h: number };
  label: { x: number; y: number };
  rows: number;
  seatsPerRow: number;
  /** s、r 都是 1 开始的序号。 */
  seatX: (s: number) => number;
  seatY: (r: number) => number;
  /** 只有靠中轴外侧的两个分区画排号，两边都画会糊成一片。 */
  rowLabelX?: number;
}

const ZONE_LAYOUT: Record<string, ZoneLayout> = {
  A: {
    tint: "#fdecea",
    labelColor: "#e8442e",
    block: { x: 64, y: 80, w: 268, h: 224 },
    label: { x: 82, y: 104 },
    rows: 15,
    seatsPerRow: 20,
    seatX: (s) => 96 + (s - 1) * 11,
    seatY: (r) => 122 + (r - 1) * 12.5,
    rowLabelX: 80,
  },
  B: {
    tint: "#f1ecfe",
    labelColor: "#8b5cf6",
    block: { x: 388, y: 80, w: 268, h: 224 },
    label: { x: 406, y: 104 },
    rows: 15,
    seatsPerRow: 20,
    seatX: (s) => 420 + (s - 1) * 11,
    seatY: (r) => 122 + (r - 1) * 12.5,
  },
  C: {
    tint: "#eaf0ff",
    labelColor: "#2e6bff",
    block: { x: 64, y: 332, w: 268, h: 170 },
    label: { x: 82, y: 356 },
    rows: 10,
    seatsPerRow: 24,
    seatX: (s) => 84 + (s - 1) * 10,
    seatY: (r) => 376 + (r - 1) * 13.5,
    rowLabelX: 72,
  },
  D: {
    tint: "#f1f2f5",
    labelColor: "#7a8494",
    block: { x: 388, y: 332, w: 268, h: 170 },
    label: { x: 406, y: 356 },
    rows: 10,
    seatsPerRow: 24,
    seatX: (s) => 412 + (s - 1) * 10,
    seatY: (r) => 376 + (r - 1) * 13.5,
  },
};

/** 「A区」→「A」；数据里分区名带不带「区」都能对上。 */
export function zoneLetterOf(zone?: string): string {
  return (zone ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
}

/** 「12排08座」→ `{ row: 12, seat: 8 }`；「凭胸卡入场」这类返回 null。 */
function parseSeat(seat?: string): { row: number; seat: number } | null {
  const m = /(\d+)\s*排\s*(\d+)\s*座/.exec(seat ?? "");
  return m ? { row: Number(m[1]), seat: Number(m[2]) } : null;
}

function seatPoint(zone: string | undefined, seat: string | undefined) {
  const layout = ZONE_LAYOUT[zoneLetterOf(zone)];
  const parsed = parseSeat(seat);
  if (!layout || !parsed) return null;
  // 越界的排/座夹回图上——宁可标在边上，也别把标记甩到图外面去。
  const row = Math.min(Math.max(parsed.row, 1), layout.rows);
  const s = Math.min(Math.max(parsed.seat, 1), layout.seatsPerRow);
  return { x: layout.seatX(s), y: layout.seatY(row) };
}

export function SeatChart({
  venueMap,
  seatZone,
  seat,
}: {
  venueMap: VenueMapInfo;
  seatZone?: string;
  seat?: string;
}) {
  const marker = seatPoint(seatZone, seat);
  const fromData = venueMap.zones
    .map((z) => zoneLetterOf(z.key || z.name))
    .filter((k) => k in ZONE_LAYOUT);
  const order =
    fromData.length > 0 ? Array.from(new Set(fromData)) : ["A", "B", "C", "D"];
  const activeZone = zoneLetterOf(seatZone ?? venueMap.userZone);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-line bg-[#fafaf8]">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="block w-full select-none"
        role="img"
        aria-label={
          seat ? `座位位置图，您的座位在 ${seatZone} ${seat}` : "座位位置图"
        }
      >
        <rect
          x="235"
          y="16"
          width="250"
          height="40"
          rx="8"
          fill="var(--color-brand)"
        />
        <text
          x="360"
          y="34"
          textAnchor="middle"
          fontSize="14"
          fontWeight="800"
          fill="#fff"
        >
          舞台
        </text>
        <text
          x="360"
          y="48"
          textAnchor="middle"
          fontSize="8"
          letterSpacing="3"
          fill="#fff"
          opacity="0.8"
        >
          STAGE
        </text>

        {/* 中轴通道 */}
        <line
          x1="360"
          y1="80"
          x2="360"
          y2="502"
          stroke="#ebedf1"
          strokeWidth="2"
          strokeDasharray="2 6"
        />

        {order.map((k) => (
          <ZoneBlock
            key={k}
            layout={ZONE_LAYOUT[k]}
            zoneKey={k}
            highlighted={k === activeZone}
          />
        ))}

        <text x="200" y="540" textAnchor="middle" fontSize="10" fill="#a8b0be">
          西入口
        </text>
        <text x="520" y="540" textAnchor="middle" fontSize="10" fill="#a8b0be">
          东入口
        </text>
        <path
          d="M212 532 l10 0 m-3 -3 l3 3 l-3 3"
          stroke="#a8b0be"
          strokeWidth="1.2"
          fill="none"
        />
        <path
          d="M508 532 l-10 0 m3 -3 l-3 3 l3 3"
          stroke="#a8b0be"
          strokeWidth="1.2"
          fill="none"
        />
      </svg>

      {/* 「您在这里」的标记盖在 SVG 上层用 HTML 画，这样能直接复用 CSS 的
          呼吸动画，不用在 SVG 里再写一套 */}
      {marker && (
        <SeatMarker x={marker.x} y={marker.y} zone={seatZone} seat={seat} />
      )}
    </div>
  );
}

/**
 * 座位标记 + 「您在这里」气泡。
 *
 * 气泡默认在标记正上方居中，但靠边的座位（A区第 2 座、D区最后一列）居中后
 * 会被卡片的 `overflow-hidden` 切掉半截，所以按标记落在图上的横向位置改成
 * 左对齐或右对齐——两侧各留 5px，气泡边缘正好压住标记点。
 */
function SeatMarker({
  x,
  y,
  zone,
  seat,
}: {
  x: number;
  y: number;
  zone?: string;
  seat?: string;
}) {
  const pct = (x / VW) * 100;
  const bubbleAlign =
    pct < 30
      ? "-left-[0.3125rem]"
      : pct > 70
        ? "-right-[0.3125rem]"
        : "-translate-x-1/2 left-0";

  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: `${pct}%`, top: `${(y / VH) * 100}%` }}
    >
      <span className="-left-[0.3125rem] -top-[0.3125rem] absolute h-2.5 w-2.5 animate-pulse-ring rounded-full border-2 border-white bg-brand" />
      <span
        className={`-top-7 absolute whitespace-nowrap rounded bg-brand px-1.5 py-0.5 font-bold text-[0.625rem] text-white leading-4 ${bubbleAlign}`}
      >
        您在这里 · {zone} {seat}
      </span>
    </div>
  );
}

function ZoneBlock({
  layout,
  zoneKey,
  highlighted,
}: {
  layout: ZoneLayout;
  zoneKey: string;
  highlighted: boolean;
}) {
  const seats: ReactNode[] = [];
  for (let r = 1; r <= layout.rows; r++) {
    for (let s = 1; s <= layout.seatsPerRow; s++) {
      seats.push(
        <circle
          key={`${r}-${s}`}
          cx={layout.seatX(s)}
          cy={layout.seatY(r)}
          r="2.6"
          fill="#a8b0be"
          opacity="0.75"
        />,
      );
    }
  }

  const rowNums: ReactNode[] = [];
  if (layout.rowLabelX !== undefined) {
    for (let r = 1; r <= layout.rows; r++) {
      rowNums.push(
        <text
          key={r}
          x={layout.rowLabelX}
          y={layout.seatY(r) + 2.5}
          fontSize="8"
          fill="#a8b0be"
          textAnchor="middle"
        >
          {r}
        </text>,
      );
    }
  }

  return (
    <g>
      <rect
        x={layout.block.x}
        y={layout.block.y}
        width={layout.block.w}
        height={layout.block.h}
        rx="12"
        fill={layout.tint}
        stroke={highlighted ? layout.labelColor : "none"}
        strokeWidth={highlighted ? 2 : 0}
      />
      <text
        x={layout.label.x}
        y={layout.label.y}
        fontSize="15"
        fontWeight="800"
        fill={layout.labelColor}
      >
        {zoneKey}区
      </text>
      {rowNums}
      {seats}
    </g>
  );
}
