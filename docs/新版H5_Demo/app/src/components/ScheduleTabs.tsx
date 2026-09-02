import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { AgendaItem, Transfer } from '@/types/itinerary'
import MergedDayTimeline, { type DayEntry } from '@/components/AgendaTimeline'
import { Icon } from '@/components/shared'
import { cn } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

/* ------------------------------------------------------------------ */
/* Day cards — each event day is ONE big card: a header (date tile,    */
/* day label, weekday, count, chevron) with collapsible content. Days  */
/* before the reference day start collapsed; current/future expand.    */
/* ------------------------------------------------------------------ */

interface DayParts {
  month: number
  day: number
  weekday: string
}

/** '2025-06-18' → { month: 6, day: 18, weekday: '周三' } (local time). */
function parseDay(iso: string): DayParts | null {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return { month: m, day: d, weekday: `周${'日一二三四五六'[new Date(y, m - 1, d).getDay()]}` }
}

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

/** Transfer day key: sortTime '20250618T061000' → '2025-06-18'. */
function transferDay(t: Transfer): string {
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(t.sortTime)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

/** Transfer within-day sort key: sortTime '20250618T061000' → '06:10'. */
function transferTime(t: Transfer): string {
  const m = /^\d{8}T(\d{2})(\d{2})/.exec(t.sortTime)
  return m ? `${m[1]}:${m[2]}` : ''
}

function uniqueDays(days: string[]): string[] {
  return Array.from(new Set(days.filter(Boolean))).sort()
}

function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * The reference "current" day of the event: real today when it is an
 * event day; otherwise the ongoing session's day (live/preview); falling
 * back to the first day. Days before it collapse by default.
 */
function currentDayOf(days: string[], agenda: AgendaItem[]): string {
  const today = todayISO()
  if (days.includes(today)) return today
  return agenda.find((a) => a.status === 'ongoing')?.date ?? days[0] ?? ''
}

function DayCard({
  label,
  day,
  count,
  defaultOpen,
  isCurrent,
  isPast,
  children,
}: {
  label: string
  day: string
  count: number
  defaultOpen: boolean
  isCurrent: boolean
  isPast: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const reduceMotion = useReducedMotion()
  const parts = parseDay(day)

  return (
    <section
      aria-label={`${label} ${day}`}
      /* transfer perforation notches inside this card blend with the card
         surface instead of the page */
      className="mb-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-card)] shadow-card [--notch-bg:var(--bg-card)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="relative flex w-full items-center gap-2.5 px-3 py-2.5 text-left before:absolute before:-inset-y-1 before:content-['']"
      >
        {/* date tile — theme-tinted, muted once the day has passed */}
        <span
          aria-hidden
          className={cn(
            'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl',
            isPast ? 'bg-[#F1F2F5] text-[var(--ink-4)]' : 'bg-[var(--theme-soft)] text-[var(--theme-primary)]',
          )}
        >
          <span className="font-num text-[16px] font-extrabold leading-5">
            {parts?.day ?? '–'}
          </span>
          <span className="text-[9px] font-bold leading-3 opacity-70">
            {parts?.weekday ?? ''}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn('text-body font-bold', isPast ? 'text-[var(--ink-3)]' : 'text-[var(--ink-1)]')}>
              {label}
            </span>
            {isCurrent && (
              <span className="bg-theme-gradient rounded-full px-1.5 py-px text-[10px] font-bold leading-4 text-white">
                今天
              </span>
            )}
            {isPast && <span className="text-caption text-[var(--ink-4)]">已结束</span>}
          </span>
          <span className="block text-caption text-[var(--ink-3)]">
            {parts ? `${parts.month}月${parts.day}日 ${parts.weekday}` : day}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-caption font-bold text-[var(--ink-3)]">
          <span className="font-num">{count}</span> 项
          <Icon
            name="chevron-down"
            size={14}
            className={cn('transition-transform duration-200', open && 'rotate-180')}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="day-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--line)] px-2.5 pb-1.5 pt-1.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/**
 * 我的日程 — merged 我的议程 + 行程信息 in ONE chronological view.
 *
 * Grouping & labeling rules:
 * - Days are the union of agenda dates and standalone-transfer days, so a
 *   flight on the day BEFORE the event gets its own day card instead of
 *   being orphaned in a separate tab.
 * - Days containing agenda sessions are numbered 第一天/第二天… in order.
 * - Transfer-only days are labeled by position relative to the event:
 *   before the first session day → 出发日; after the last → 返程日;
 *   a gap day in between → 自由活动.
 * - Every transfer (including cars referenced by a session's carId) is a
 *   standalone row in the merged timeline — a pre-session ride sorts
 *   BEFORE its session, matching real-world chronology.
 * - Days before the current day start collapsed; a single-day schedule
 *   skips the day-card chrome entirely.
 */
export default function ScheduleTabs({
  agenda,
  transfers,
  onShowSeatMap,
}: {
  agenda: AgendaItem[]
  transfers: Transfer[]
  onShowSeatMap: (item: AgendaItem) => void
}) {
  // All transfers are standalone timeline rows, sorted by time — a ride
  // to a session appears before that session, not folded under it.
  const standaloneTransfers = transfers

  const agendaDays = useMemo(() => uniqueDays(agenda.map((a) => a.date)), [agenda])
  const days = useMemo(
    () => uniqueDays([...agendaDays, ...standaloneTransfers.map(transferDay)]),
    [agendaDays, standaloneTransfers],
  )
  const currentDay = useMemo(() => currentDayOf(days, agenda), [days, agenda])

  const entriesByDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>()
    const push = (d: string, entry: DayEntry) => {
      const list = map.get(d) ?? []
      list.push(entry)
      map.set(d, list)
    }
    for (const a of agenda) push(a.date, { kind: 'agenda', item: a, time: a.start })
    for (const t of standaloneTransfers) {
      const d = transferDay(t)
      // Day-level expiry, same granularity as the day card's isPast.
      if (d) push(d, { kind: 'transfer', transfer: t, time: transferTime(t), finished: d < currentDay })
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time))
    return map
  }, [agenda, standaloneTransfers, currentDay])

  /** 第N天 for session days; positional labels for transfer-only days. */
  const dayLabel = (d: string): string => {
    const i = agendaDays.indexOf(d)
    if (i >= 0) return `第${CN_NUM[i] ?? i + 1}天`
    const first = agendaDays[0]
    const last = agendaDays[agendaDays.length - 1]
    if (first && d < first) return '出发日'
    if (last && d > last) return '返程日'
    return '自由活动'
  }

  const totalCount = agenda.length + standaloneTransfers.length

  const sectionLabel = '我的行程'

  return (
    <section aria-label={sectionLabel} className="px-4">
      {/* quiet section header: restores the boundary between the hero
          (what the event is) and the day list (what the guest does) that
          the removed tab bar used to carry. Label is fixed copy per
          product decision (我的行程), independent of user.greeting. */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[12px] font-bold tracking-[0.14em] text-[var(--ink-3)]">{sectionLabel}</h2>
        <span className="text-caption text-[var(--ink-4)]">
          共{days.length}天 · <span className="font-num">{totalCount}</span>项
        </span>
      </div>
      {days.length <= 1 ? (
        <MergedDayTimeline
          entries={entriesByDay.get(days[0] ?? '') ?? []}
          onShowSeatMap={onShowSeatMap}
        />
      ) : (
        days.map((d) => {
          const entries = entriesByDay.get(d) ?? []
          return (
            <DayCard
              key={d}
              label={dayLabel(d)}
              day={d}
              count={entries.length}
              defaultOpen={d >= currentDay}
              isCurrent={d === currentDay}
              isPast={d < currentDay}
            >
              <MergedDayTimeline
                entries={entries}
                onShowSeatMap={onShowSeatMap}
              />
            </DayCard>
          )
        })
      )}
    </section>
  )
}
