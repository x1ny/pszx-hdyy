import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { AgendaItem } from '@/types/itinerary'
import { openNavigation } from '@/lib/actions'
import { Icon, PillTag, SectionHeader } from '@/components/shared'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]
const COLLAPSED_COUNT = 2

function AgendaCard({
  item,
  stagger,
  isLast,
}: {
  item: AgendaItem
  /** stagger index used for the entrance delay */
  stagger: number
  isLast: boolean
}) {
  const { show } = useToast()
  const reduceMotion = useReducedMotion()
  const ongoing = item.status === 'ongoing'
  const finished = item.status === 'finished'

  const handleVenueNav = () => {
    if (!item.geo) return
    openNavigation(item.geo)
    show('已为你打开地图')
  }

  return (
    <motion.div
      initial={{ x: -12, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.4, delay: stagger * 0.05, ease: EASE }}
      className={cn('relative flex gap-2.5', finished && 'opacity-50')}
    >
      {/* left time column + rail */}
      <div className="relative flex w-16 shrink-0 flex-col items-end pr-3 pt-1">
        <span
          className={cn(
            'font-num text-time-num',
            finished ? 'text-[var(--ink-4)]' : 'text-[var(--ink-1)]',
          )}
        >
          {item.start}
        </span>
        <span className="font-num text-xs font-bold leading-4 text-[var(--ink-3)]">
          {item.end}
        </span>
        {/* rail line — continues into the next card, stops at the last one */}
        <span
          className={cn(
            'absolute right-0 top-2 w-px bg-[var(--line)]',
            isLast ? 'h-[calc(100%-8px)]' : 'h-[calc(100%+10px)]',
          )}
        />
        {/* node dot: ongoing = pulsing theme dot, upcoming = hollow ring, finished = grey solid */}
        <span
          className={cn(
            'absolute right-[-3.5px] top-[9px] h-[8px] w-[8px] rounded-full',
            ongoing && 'pulse-dot bg-[var(--theme-primary)]',
            item.status === 'upcoming' &&
              'border-[1.5px] border-[var(--theme-primary)] bg-white',
            finished && 'bg-[var(--ink-4)]',
          )}
        />
      </div>

      {/* card */}
      <motion.div
        whileTap={{ scale: 0.98 }}
        className={cn(
          'relative mb-2.5 min-w-0 flex-1 rounded-[14px] bg-[var(--bg-card)] p-3 shadow-card',
          ongoing && 'border-[1.5px] border-[var(--theme-primary)] bg-[var(--theme-soft)]',
        )}
      >
        {/* ongoing edge: theme border breathes (reduced-motion → static) */}
        {ongoing && !reduceMotion && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -inset-[1.5px] rounded-[14px] border-[1.5px] border-[var(--theme-primary)]"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        {ongoing && (
          <span className="bg-theme-gradient absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold leading-4 text-white">
            进行中
          </span>
        )}
        <h3
          className={cn(
            'text-card-title',
            ongoing && 'pr-14',
            finished ? 'text-[var(--ink-4)]' : 'text-[var(--ink-1)]',
          )}
        >
          {item.title}
        </h3>

        {/* venue row — whole row is the map action; ::before expands the hit area to ≥44px */}
        <button
          type="button"
          onClick={handleVenueNav}
          disabled={!item.geo}
          aria-label={item.geo ? `导航到 ${item.venue}` : undefined}
          className={cn(
            'relative mt-1 flex w-full items-center gap-1 text-left',
            'before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[""]',
            !item.geo && 'cursor-default',
          )}
        >
          <Icon name="map-pin" size={12} className="shrink-0 text-[var(--ink-3)]" />
          <span className="min-w-0 flex-1 truncate text-body text-[var(--ink-3)]">
            {item.venue}
          </span>
          {item.geo && (
            <Icon name="navigation" size={12} className="shrink-0 text-[var(--ink-3)]" />
          )}
        </button>

        {/* zone + seat — visual focus of the card */}
        {(item.zone || item.seat) && (
          <div className="mt-1.5">
            {finished ? (
              <PillTag variant="soft" style={{ background: '#F1F2F5', color: 'var(--ink-4)' }}>
                {item.zone && <span>{item.zone}</span>}
                {item.seat && <span className="font-num">{item.seat}</span>}
              </PillTag>
            ) : (
              <PillTag variant="solid">
                {item.zone && <span>{item.zone}</span>}
                {item.seat && <span className="font-num">{item.seat}</span>}
              </PillTag>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

/**
 * Module 2 — 我的议程: compact vertical timeline sorted by start. Left time
 * range, right card (bold title / venue with map action / highlighted
 * zone+seat). Ongoing = high emphasis, finished = greyed, upcoming = clear.
 * Default renders the first 2; the rest expand/collapse in place.
 */
export default function AgendaTimeline({ agenda }: { agenda: AgendaItem[] }) {
  const [expanded, setExpanded] = useState(false)

  // Defensive re-sort — the API layer already guarantees order (§10).
  const items = useMemo(
    () => agenda.slice().sort((a, b) => a.start.localeCompare(b.start)),
    [agenda],
  )
  const first = items.slice(0, COLLAPSED_COUNT)
  const rest = items.slice(COLLAPSED_COUNT)

  return (
    <section className="px-4">
      <SectionHeader
        title="我的议程"
        action={
          items.length > COLLAPSED_COUNT ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="-my-[11px] flex min-h-[44px] items-center gap-0.5 text-caption font-bold text-[var(--theme-primary)]"
            >
              {expanded ? '收起' : `展开全部（${items.length}）`}
              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} />
            </button>
          ) : undefined
        }
      />

      <div>
        {first.map((item, i) => (
          <AgendaCard
            key={item.id}
            item={item}
            stagger={i}
            isLast={!expanded && i === first.length - 1 && rest.length === 0}
          />
        ))}

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="rest"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="overflow-hidden"
            >
              {rest.map((item, i) => (
                <AgendaCard
                  key={item.id}
                  item={item}
                  stagger={i}
                  isLast={i === rest.length - 1}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
