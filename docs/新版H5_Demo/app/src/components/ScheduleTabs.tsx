import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { AgendaItem, Transfer } from '@/types/itinerary'
import AgendaTimeline from '@/components/AgendaTimeline'
import TransferCards from '@/components/TransfersSection'
import { Icon } from '@/components/shared'
import { cn } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

type TabKey = 'agenda' | 'transfers'

/* ------------------------------------------------------------------ */
/* Day cards — each event day is ONE big card: a header (date tile,    */
/* 第N天, weekday, count, chevron) with collapsible content. Days      */
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
  index,
  day,
  count,
  defaultOpen,
  isCurrent,
  isPast,
  children,
}: {
  index: number
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
      aria-label={`第${index + 1}天 ${day}`}
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
              第{CN_NUM[index] ?? index + 1}天
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
 * 我的议程 / 行程信息 as a segmented tab switch. The active-pill slides
 * via layoutId; panels cross-fade with a short vertical drift, disabled
 * under reduced motion.
 *
 * Multi-day layout: inside each panel, every day is one big collapsible
 * card; days before the current day start collapsed. The agenda panel
 * shows sessions only; car transfers bound via carId fold under their
 * session, while rail/air live in the 行程信息 tab.
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
  const [tab, setTab] = useState<TabKey>('agenda')
  const reduceMotion = useReducedMotion()

  const agendaDays = useMemo(() => uniqueDays(agenda.map((a) => a.date)), [agenda])
  const transferDays = useMemo(() => uniqueDays(transfers.map(transferDay)), [transfers])
  const currentDay = useMemo(() => currentDayOf(agendaDays, agenda), [agendaDays, agenda])

  const agendaByDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>()
    for (const a of agenda) {
      const list = map.get(a.date) ?? []
      list.push(a)
      map.set(a.date, list)
    }
    return map
  }, [agenda])

  const transfersByDay = useMemo(() => {
    const map = new Map<string, Transfer[]>()
    for (const t of transfers) {
      const d = transferDay(t)
      if (!d) continue
      const list = map.get(d) ?? []
      list.push(t)
      map.set(d, list)
    }
    return map
  }, [transfers])

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'agenda', label: '我的议程', count: agenda.length },
    { key: 'transfers', label: '行程信息', count: transfers.length },
  ]

  return (
    <section aria-label="议程与行程">
      <div className="px-4">
        <div
          role="tablist"
          aria-label="议程与行程切换"
          className="grid grid-cols-2 rounded-full bg-[#EBEDF2] p-1"
        >
          {tabs.map((t) => {
            const active = t.key === tab
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className="relative flex h-9 items-center justify-center rounded-full"
              >
                {active && (
                  <motion.span
                    layoutId="schedule-tab-pill"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 500, damping: 38 }
                    }
                    className="absolute inset-0 rounded-full bg-white shadow-[0_1px_4px_rgba(20,26,38,0.1)]"
                  />
                )}
                <span
                  className={cn(
                    'relative z-10 flex items-baseline gap-1 text-body font-bold transition-colors duration-150',
                    active ? 'text-[var(--theme-primary)]' : 'text-[var(--ink-3)]',
                  )}
                >
                  {t.label}
                  <span className="font-num text-[11px] font-extrabold">{t.count}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-2.5 px-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            {/* Single-day events skip the day-card chrome entirely — the
                hero already carries the date, so a 第一天 header would be
                redundant grouping; the timeline / full ticket cards render
                directly. */}
            {tab === 'agenda' ? (
              agendaDays.length <= 1 ? (
                <AgendaTimeline
                  agenda={agenda}
                  transfers={transfers}
                  onShowSeatMap={onShowSeatMap}
                />
              ) : (
                agendaDays.map((d, i) => (
                  <DayCard
                    key={d}
                    index={i}
                    day={d}
                    count={agendaByDay.get(d)?.length ?? 0}
                    defaultOpen={d >= currentDay}
                    isCurrent={d === currentDay}
                    isPast={d < currentDay}
                  >
                    <AgendaTimeline
                      agenda={agendaByDay.get(d) ?? []}
                      transfers={transfers}
                      onShowSeatMap={onShowSeatMap}
                    />
                  </DayCard>
                ))
              )
            ) : transferDays.length <= 1 ? (
              <TransferCards transfers={transfers} />
            ) : (
              transferDays.map((d, i) => (
                <DayCard
                  key={d}
                  index={i}
                  day={d}
                  count={transfersByDay.get(d)?.length ?? 0}
                  defaultOpen={d >= currentDay}
                  isCurrent={d === currentDay}
                  isPast={d < currentDay}
                >
                  <TransferCards transfers={transfersByDay.get(d) ?? []} inset />
                </DayCard>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
