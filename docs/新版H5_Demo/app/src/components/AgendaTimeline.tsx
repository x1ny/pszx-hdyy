import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { AgendaItem, CarTransfer, Transfer } from '@/types/itinerary'
import { isNavigable, openNavigation } from '@/lib/actions'
import { Icon, PillTag } from '@/components/shared'
import { Copyable, PhoneChip, CarNavChip } from '@/components/TransfersSection'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

/* ------------------------------------------------------------------ */
/* Bound car block — collapsible 用车安排 under a session               */
/* ------------------------------------------------------------------ */

function BoundCarBlock({ car }: { car: CarTransfer }) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const reduceMotion = useReducedMotion()

  return (
    <div className="mt-2 rounded-xl border border-[var(--line)] bg-[#FAFBFC]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 px-2.5"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--car-soft)', color: 'var(--car)' }}
        >
          <Icon name="car-front" size={14} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-body font-bold text-[var(--ink-1)]">
            用车安排
            <span className="font-num font-extrabold" style={{ color: 'var(--car)' }}>
              {' '}
              {car.useTime}
            </span>
          </span>
          {/* ride duration earns its own caption line — appending it to the
              title row truncated on 375px screens */}
          {car.durationMin !== undefined && (
            <span className="block text-caption leading-4 text-[var(--ink-3)]">
              路程预计 {car.durationMin} 分钟
            </span>
          )}
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className={cn(
            'shrink-0 text-[var(--ink-3)] transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="car-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-dashed border-[var(--line)] px-2.5 pb-2.5 pt-2">
              {/* title + plate */}
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-body font-bold text-[var(--ink-1)]">
                  {car.title}
                </span>
                <Copyable text={car.plate} ariaLabel={`复制车牌 ${car.plate}`} className="shrink-0">
                  <span
                    className="rounded-md border px-2 py-0.5 font-num text-[13px] font-extrabold"
                    style={{
                      borderColor: 'var(--car)',
                      background: 'var(--car-soft)',
                      color: 'var(--car)',
                    }}
                  >
                    {car.plate}
                  </span>
                </Copyable>
              </div>
              {/* driver + ride duration + phone */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-[var(--ink-2)]">
                <span>司机 {car.driver}</span>
                {car.durationMin !== undefined && (
                  <span>· 路程预计 {car.durationMin} 分钟</span>
                )}
                <PhoneChip phone={car.phone} />
              </div>
              {/* meeting point + nav */}
              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1">
                  <Icon name="map-pin" size={12} className="shrink-0 text-[var(--ink-3)]" />
                  <span className="truncate text-body text-[var(--ink-3)]">
                    集合：{car.meetPoint}
                  </span>
                </div>
                {isNavigable(car.geo) && (
                  <CarNavChip
                    onClick={() => {
                      if (isNavigable(car.geo)) {
                        openNavigation(car.geo)
                        show('已为你打开地图')
                      }
                    }}
                  />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Agenda row                                                          */
/* ------------------------------------------------------------------ */

function AgendaRow({
  item,
  car,
  stagger,
  isLast,
  onShowSeatMap,
}: {
  item: AgendaItem
  car?: CarTransfer
  stagger: number
  isLast: boolean
  onShowSeatMap: (item: AgendaItem) => void
}) {
  const { show } = useToast()
  const reduceMotion = useReducedMotion()
  const ongoing = item.status === 'ongoing'
  const finished = item.status === 'finished'
  const navigable = isNavigable(item.geo)

  const handleVenueNav = () => {
    if (!isNavigable(item.geo)) return // type guard narrows item.geo
    openNavigation(item.geo)
    show('已为你打开地图')
  }

  return (
    <motion.div
      initial={{ x: -12, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.4, delay: stagger * 0.05, ease: EASE }}
      className={cn(
        'relative flex gap-2.5',
        finished && 'opacity-50',
        !isLast && 'border-b border-[var(--line)]',
      )}
    >
      {/* left time column + rail */}
      <div className="relative flex w-14 shrink-0 flex-col items-end pr-2.5 pt-2.5">
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
        {/* rail line — reaches the next row's node dot, stops at the last */}
        <span
          className={cn(
            'absolute right-0 top-[9px] w-px bg-[var(--line)]',
            isLast ? 'h-[calc(100%-9px)]' : 'h-[calc(100%+1px)]',
          )}
        />
        {/* node dot: card-colored ring lifts it off the rail */}
        <span
          className={cn(
            'absolute right-[-3.5px] top-[18px] h-[8px] w-[8px] rounded-full ring-[3px] ring-[var(--bg-card)]',
            ongoing && 'pulse-dot bg-[var(--theme-primary)]',
            item.status === 'upcoming' && 'border-[1.5px] border-[var(--theme-primary)] bg-white',
            finished && 'bg-[var(--ink-4)]',
          )}
        />
      </div>

      <div
        className={cn(
          'relative min-w-0 flex-1 py-2.5',
          ongoing && 'rounded-xl bg-[var(--theme-soft)] px-2.5',
        )}
      >
        {/* ongoing edge: theme border breathes (reduced-motion → static) */}
        {ongoing && !reduceMotion && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -inset-[1.5px] rounded-xl border-[1.5px] border-[var(--theme-primary)]"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        {ongoing && (
          <span className="bg-theme-gradient absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-bold leading-4 text-white">
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

        {/* venue row — plain display; navigation is a dedicated trailing
            button rendered only for navigable destinations (valid geo).
            Tapping anywhere else on the card no longer jumps to the map. */}
        <div className="mt-1 flex w-full items-center gap-1">
          <Icon name="map-pin" size={12} className="shrink-0 text-[var(--ink-3)]" />
          <span className="min-w-0 flex-1 truncate text-body text-[var(--ink-3)]">
            {item.venue}
          </span>
          {navigable && (
            <button
              type="button"
              onClick={handleVenueNav}
              aria-label={`导航到 ${item.venue}`}
              className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--theme-primary)] before:absolute before:-inset-2 before:content-['']"
            >
              <Icon name="navigation" size={13} />
            </button>
          )}
        </div>

        {/* zone + seat pill + seat-map affordance (zone-bound seats only;
            zone-less notes like 凭胸卡入场/自由站位 are not rendered) */}
        {item.zone && (
          <div className="mt-1.5 flex items-center gap-2.5">
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
            {item.zone && (
              <button
                type="button"
                onClick={() => onShowSeatMap(item)}
                aria-label={`查看${item.zone}座位图`}
                className="relative flex items-center gap-0.5 text-caption font-bold text-[var(--theme-primary)] before:absolute before:-inset-x-2 before:-inset-y-3 before:content-['']"
              >
                <Icon name="map" size={12} />
                座位图
              </button>
            )}
          </div>
        )}

        {/* session remark (guest action items: 上台发言 / 换装提示 …) —
            warm amber attention block, distinct from informational rows */}
        {item.note && (
          <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-[#FFF7E8] px-2 py-1.5">
            <Icon name="megaphone" size={12} className="mt-[3px] shrink-0 text-[#D97706]" />
            <span className="min-w-0 text-caption leading-[18px] text-[#8A5A0B]">
              {item.note}
            </span>
          </div>
        )}

        {/* bound car arrangement, collapsible */}
        {car && <BoundCarBlock car={car} />}
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Panel (tab content — no header, no collapse)                        */
/* ------------------------------------------------------------------ */

/**
 * 我的议程 panel: sessions only, in one chronological timeline. Car
 * transfers bound via `AgendaItem.carId` render as a collapsible 用车安排
 * block under their session; rail/air live exclusively in the 行程信息
 * tab. Sessions with a zone carry a 座位图 affordance that opens the
 * detailed seat chart.
 */
export default function AgendaTimeline({
  agenda,
  transfers,
  onShowSeatMap,
}: {
  agenda: AgendaItem[]
  transfers: Transfer[]
  onShowSeatMap: (item: AgendaItem) => void
}) {
  const carsById = useMemo(() => {
    const map = new Map<string, CarTransfer>()
    for (const t of transfers) if (t.type === 'car') map.set(t.id, t)
    return map
  }, [transfers])

  const items = useMemo(
    () =>
      agenda
        .slice()
        .sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`)),
    [agenda],
  )

  return (
    <div>
      {items.map((item, i) => (
        <AgendaRow
          key={item.id}
          item={item}
          car={item.carId ? carsById.get(item.carId) : undefined}
          stagger={i}
          isLast={i === items.length - 1}
          onShowSeatMap={onShowSeatMap}
        />
      ))}
    </div>
  )
}
