import { useEffect } from 'react'
import type { VenueMapInfo } from '@/types/itinerary'
import { FullScreenOverlay, PillTag } from '@/components/shared'
import SeatChart, { zoneLetterOf } from '@/components/SeatChart'
import { cn } from '@/lib/utils'

/**
 * 座位图 overlay — pure information display: the detailed seat-position
 * chart with the session's seat marked, plus the zone legend. Opened from
 * an agenda item's 座位图 affordance. FullScreenOverlay supplies the scrim,
 * spring entrance, close button, body scroll lock and back-key close.
 */
export default function MapOverlay({
  open,
  onClose,
  venueMap,
  seatZone,
  seat,
}: {
  open: boolean
  onClose: () => void
  venueMap: VenueMapInfo
  /** Session zone/seat to highlight on the chart. */
  seatZone?: string
  seat?: string
}) {
  // ESC closes the overlay (close button + scrim + back key come from
  // FullScreenOverlay).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <FullScreenOverlay open={open} onClose={onClose} title="座位图">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4 pt-3">
          <SeatChart venueMap={venueMap} seatZone={seatZone} seat={seat} />
        </div>

        {/* zone legend — static rows, no interactions */}
        <div className="px-4 pb-6 pt-2" role="list" aria-label="分区说明">
          {venueMap.zones.map((z) => {
            const isTarget = z.key === zoneLetterOf(seatZone)
            return (
              <div
                key={z.key}
                role="listitem"
                className={cn(
                  'relative flex min-h-[52px] w-full items-center gap-2.5 rounded-lg px-2.5 py-2',
                  isTarget && 'bg-[var(--theme-soft)]',
                )}
              >
                {isTarget && (
                  <span className="absolute left-0 top-2 h-[calc(100%-16px)] w-[3px] rounded-full bg-[var(--theme-primary)]" />
                )}
                <PillTag
                  variant={isTarget ? 'solid' : 'soft'}
                  style={isTarget ? undefined : { background: '#F1F2F5', color: 'var(--ink-2)' }}
                >
                  {z.key}
                </PillTag>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'text-body font-bold',
                      isTarget ? 'text-[var(--theme-primary)]' : 'text-[var(--ink-1)]',
                    )}
                  >
                    {z.name}
                  </div>
                  <div className="text-caption text-[var(--ink-3)]">{z.desc}</div>
                </div>
                {isTarget && (
                  <span className="shrink-0 text-caption font-bold text-[var(--theme-primary)]">
                    我的分区
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </FullScreenOverlay>
  )
}
