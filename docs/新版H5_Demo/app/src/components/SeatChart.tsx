import type { VenueMapInfo } from '@/types/itinerary'

/**
 * Detailed seat-position chart (座位图), drawn as precise vector graphics —
 * real seating charts are diagrams, so this is code-drawn rather than a
 * raster image: zone blocks (A/B front, C/D rear 阶梯), individual seat
 * dots, row numbers, stage, entrances. The tapped session's seat is marked
 * by a pulsing HTML dot layered over the SVG (reuses .pulse-dot styling).
 *
 * Marker position is computed from the session's zone + "N排M座" seat
 * string, so the JSON contract only needs the fields it already carries.
 */

const VW = 720
const VH = 560

interface ZoneLayout {
  tint: string
  labelColor: string
  block: { x: number; y: number; w: number; h: number }
  label: { x: number; y: number }
  rows: number
  seatsPerRow: number
  seatX: (s: number) => number // s = 1-based seat index
  seatY: (r: number) => number // r = 1-based row index
  rowLabelX?: number
}

const ZONE_LAYOUT: Record<string, ZoneLayout> = {
  A: {
    tint: '#FDECEA',
    labelColor: '#E8442E',
    block: { x: 64, y: 80, w: 268, h: 224 },
    label: { x: 82, y: 104 },
    rows: 15,
    seatsPerRow: 20,
    seatX: (s) => 96 + (s - 1) * 11,
    seatY: (r) => 122 + (r - 1) * 12.5,
    rowLabelX: 80,
  },
  B: {
    tint: '#F1ECFE',
    labelColor: '#8B5CF6',
    block: { x: 388, y: 80, w: 268, h: 224 },
    label: { x: 406, y: 104 },
    rows: 15,
    seatsPerRow: 20,
    seatX: (s) => 420 + (s - 1) * 11,
    seatY: (r) => 122 + (r - 1) * 12.5,
  },
  C: {
    tint: '#EAF0FF',
    labelColor: '#2E6BFF',
    block: { x: 64, y: 332, w: 268, h: 170 },
    label: { x: 82, y: 356 },
    rows: 10,
    seatsPerRow: 24,
    seatX: (s) => 84 + (s - 1) * 10,
    seatY: (r) => 376 + (r - 1) * 13.5,
    rowLabelX: 72,
  },
  D: {
    tint: '#F1F2F5',
    labelColor: '#7A8494',
    block: { x: 388, y: 332, w: 268, h: 170 },
    label: { x: 406, y: 356 },
    rows: 10,
    seatsPerRow: 24,
    seatX: (s) => 412 + (s - 1) * 10,
    seatY: (r) => 376 + (r - 1) * 13.5,
  },
}

export function zoneLetterOf(zone?: string): string {
  return (zone ?? '').replace(/[^A-Za-z]/g, '').toUpperCase()
}

/** "12排08座" → { row: 12, seat: 8 }; null for notes like "凭胸卡入场". */
export function parseSeat(seat?: string): { row: number; seat: number } | null {
  const m = /(\d+)\s*排\s*(\d+)\s*座/.exec(seat ?? '')
  if (!m) return null
  return { row: Number(m[1]), seat: Number(m[2]) }
}

function seatPoint(zone: string | undefined, seat: string | undefined) {
  const z = ZONE_LAYOUT[zoneLetterOf(zone)]
  const parsed = parseSeat(seat)
  if (!z || !parsed) return null
  const row = Math.min(Math.max(parsed.row, 1), z.rows)
  const s = Math.min(Math.max(parsed.seat, 1), z.seatsPerRow)
  return { x: z.seatX(s), y: z.seatY(row) }
}

function ZoneBlock({
  layout,
  zoneKey,
  highlighted,
}: {
  layout: ZoneLayout
  zoneKey: string
  highlighted: boolean
}) {
  const seats: React.ReactNode[] = []
  for (let r = 1; r <= layout.rows; r++) {
    for (let s = 1; s <= layout.seatsPerRow; s++) {
      seats.push(
        <circle
          key={`${r}-${s}`}
          cx={layout.seatX(s)}
          cy={layout.seatY(r)}
          r="2.6"
          fill="#A8B0BE"
          opacity="0.75"
        />,
      )
    }
  }
  const rowNums: React.ReactNode[] = []
  if (layout.rowLabelX !== undefined) {
    for (let r = 1; r <= layout.rows; r++) {
      rowNums.push(
        <text
          key={r}
          x={layout.rowLabelX}
          y={layout.seatY(r) + 2.5}
          fontSize="8"
          fill="#A8B0BE"
          textAnchor="middle"
          className="font-num"
        >
          {r}
        </text>,
      )
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
        stroke={highlighted ? layout.labelColor : 'none'}
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
  )
}

export default function SeatChart({
  venueMap,
  seatZone,
  seat,
}: {
  venueMap: VenueMapInfo
  /** The session whose seat is highlighted. */
  seatZone?: string
  seat?: string
}) {
  const marker = seatPoint(seatZone, seat)
  // Render only zones present in the data contract (fallback: all four).
  const fromData = venueMap.zones
    .map((z) => zoneLetterOf(z.key || z.name))
    .filter((k): k is keyof typeof ZONE_LAYOUT => k in ZONE_LAYOUT)
  const order: (keyof typeof ZONE_LAYOUT)[] =
    fromData.length > 0 ? Array.from(new Set(fromData)) : ['A', 'B', 'C', 'D']
  const activeZone = zoneLetterOf(seatZone ?? venueMap.userZone)

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[#FAFAF8]">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="block w-full select-none" role="img" aria-label="座位位置图">
        {/* stage */}
        <rect x="235" y="16" width="250" height="40" rx="8" fill="var(--theme-primary)" />
        <text x="360" y="34" textAnchor="middle" fontSize="14" fontWeight="800" fill="#fff">
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
          className="font-num"
        >
          STAGE
        </text>

        {/* center aisle */}
        <line x1="360" y1="80" x2="360" y2="502" stroke="#EBEDF1" strokeWidth="2" strokeDasharray="2 6" />

        {order.map((k) => (
          <ZoneBlock key={k} layout={ZONE_LAYOUT[k]} zoneKey={k} highlighted={k === activeZone} />
        ))}

        {/* entrances */}
        <text x="200" y="540" textAnchor="middle" fontSize="10" fill="#A8B0BE">
          西入口
        </text>
        <text x="520" y="540" textAnchor="middle" fontSize="10" fill="#A8B0BE">
          东入口
        </text>
        <path d="M212 532 l10 0 m-3 -3 l3 3 l-3 3" stroke="#A8B0BE" strokeWidth="1.2" fill="none" />
        <path d="M508 532 l-10 0 m3 -3 l-3 3 l3 3" stroke="#A8B0BE" strokeWidth="1.2" fill="none" />
      </svg>

      {/* pulsing seat marker (HTML layer reuses the CSS pulse) */}
      {marker && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: `${(marker.x / VW) * 100}%`,
            top: `${(marker.y / VH) * 100}%`,
          }}
        >
          <span className="pulse-dot absolute -left-[5px] -top-[5px] h-[10px] w-[10px] rounded-full border-2 border-white bg-[var(--danger)]" />
          <span className="absolute -top-7 left-0 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white">
            您在这里 · {seatZone} {seat}
          </span>
        </div>
      )}
    </div>
  )
}
