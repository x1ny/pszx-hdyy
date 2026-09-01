import { useEffect } from 'react'
import type { EventInfo } from '@/types/itinerary'
import { FullScreenOverlay } from '@/components/shared'

/**
 * 活动详情 overlay — opened from the hero intro's 查看详情 affordance.
 * Shows the long-form introduction, key stats and attendance tips from
 * `event.details` (falls back to the short intro when the backend does
 * not supply details). FullScreenOverlay supplies the scrim, spring
 * entrance, close button, body scroll lock and back-key close.
 */
export default function EventDetailOverlay({
  open,
  onClose,
  event,
}: {
  open: boolean
  onClose: () => void
  event: EventInfo
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const details = event.details
  const paragraphs = details && details.paragraphs.length > 0 ? details.paragraphs : [event.intro]

  return (
    <FullScreenOverlay open={open} onClose={onClose} title="活动详情">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-3">
        {/* event identity recap */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-card)] p-3">
          <h2 className="text-card-title leading-snug text-[var(--ink-1)]">{event.title}</h2>
          <div className="mt-1.5 flex items-center gap-1.5 text-caption text-[var(--ink-3)]">
            <span>{event.dateText}</span>
            <span className="font-num font-bold text-[var(--ink-2)]">{event.timeRange}</span>
          </div>
          <div className="mt-0.5 text-caption text-[var(--ink-3)]">
            {event.city} · {event.venue}
          </div>
        </div>

        {/* long-form introduction */}
        <h3 className="text-eyebrow mt-4 text-[var(--ink-3)]">活动介绍</h3>
        <div className="mt-1.5 space-y-2">
          {paragraphs.map((p, i) => (
            <p key={i} className="select-text text-body leading-relaxed text-[var(--ink-2)]">
              {p}
            </p>
          ))}
        </div>

        {/* organizer units — blank values were dropped in normalization,
            so the grid only ever renders filled cards and reflows (2-col)
            around however many remain; the whole block hides when empty */}
        {details && details.organizers.length > 0 && (
          <>
            <h3 className="text-eyebrow mt-4 text-[var(--ink-3)]">组织单位</h3>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {details.organizers.map((o, i) => (
                <div
                  key={`${o.role}-${i}`}
                  className="rounded-xl border border-[var(--line)] bg-[var(--bg-card)] px-3 py-2.5"
                >
                  <div className="text-caption text-[var(--ink-3)]">{o.role}</div>
                  <div className="mt-0.5 text-body font-bold leading-snug text-[var(--ink-1)]">
                    {o.name}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </FullScreenOverlay>
  )
}
