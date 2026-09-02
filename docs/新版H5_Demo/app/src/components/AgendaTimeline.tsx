import { motion } from 'framer-motion'
import type { AgendaItem, AirTransfer, CarTransfer, RailTransfer, Transfer } from '@/types/itinerary'
import { isNavigable, openNavigation } from '@/lib/actions'
import { Icon, PillTag } from '@/components/shared'
import { Copyable, PhoneChip, CarNavChip, TYPE_META } from '@/components/TransfersSection'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

/* ------------------------------------------------------------------ */
/* Agenda row                                                          */
/* ------------------------------------------------------------------ */

function AgendaRow({
  item,
  stagger,
  isLast,
  onShowSeatMap,
}: {
  item: AgendaItem
  stagger: number
  isLast: boolean
  onShowSeatMap: (item: AgendaItem) => void
}) {
  const { show } = useToast()
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
        !isLast && 'border-b border-[var(--line)]',
      )}
    >
      {/* left time column + rail */}
      <div className="relative flex w-14 shrink-0 flex-col items-end pr-2.5 pt-2.5">
        <span
          className="font-num text-time-num text-[var(--ink-1)]"
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
        {/* node dot: card-colored ring lifts it off the rail. ongoing is
            rendered like upcoming — no special in-progress treatment. */}
        <span
          className={cn(
            'absolute right-[-3.5px] top-[18px] h-[8px] w-[8px] rounded-full ring-[3px] ring-[var(--bg-card)]',
            item.status !== 'finished' && 'border-[1.5px] border-[var(--theme-primary)] bg-white',
            finished && 'border-[1.5px] border-[var(--ink-4)] bg-white',
          )}
        />
      </div>

      <div className="relative min-w-0 flex-1 py-2.5">
        <h3 className="text-card-title text-[var(--ink-1)]">{item.title}</h3>

        {/* venue row — plain display; navigation is a dedicated trailing
            button rendered only for navigable destinations (valid geo).
            Tapping anywhere else on the card no longer jumps to the map. */}
        <div className="mt-1 flex w-full items-center gap-1">
          <Icon name="map-pin" size={12} className="shrink-0 text-[var(--ink-3)]" />
          <span className="min-w-0 flex-1 truncate text-body text-[var(--ink-3)]">
            {item.venue}
          </span>
          {navigable && (
            <CarNavChip onClick={handleVenueNav} ariaLabel={`导航到 ${item.venue}`} />
          )}
        </div>

        {/* zone + seat pill + seat-map affordance (zone-bound seats only;
            zone-less notes like 凭胸卡入场/自由站位 are not rendered) */}
        {item.zone && (
          <div className="mt-1.5 flex items-center gap-2.5">
            <PillTag variant="outline">
              {item.zone && <span>{item.zone}</span>}
              {item.seat && <span className="font-num">{item.seat}</span>}
            </PillTag>
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

        {/* group seating caption — for guests whose party members have no
            link access; sits directly under the seat pill */}
        {item.groupSeatNote && (
          <div className="mt-1 flex items-center gap-1 text-caption text-[var(--ink-3)]">
            <Icon name="users-round" size={12} className="shrink-0" />
            <span className="min-w-0">{item.groupSeatNote}</span>
          </div>
        )}

        {/* session remark (guest action items: 上台发言 / 换装提示 …) —
            neutral gray block; the red icon alone carries the attention,
            keeping the page's single-accent system intact */}
        {item.note && (
          <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-[#F5F6F8] px-2 py-1.5">
            <Icon name="megaphone" size={12} className="mt-[3px] shrink-0 text-[var(--theme-primary)]" />
            <span className="min-w-0 text-caption leading-[18px] text-[var(--ink-2)]">
              {item.note}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Transfer rows — rail/air/car entries rendered in the SAME flat       */
/* timeline language as agenda rows (time column + rail + node),        */
/* not as ticket-stub cards.                                            */
/* ------------------------------------------------------------------ */

function RailBody({ t }: { t: RailTransfer }) {
  /* 班次 + 起讫站 only — seat/gate/arrive-early notes are intentionally
     not rendered (kept in data for backend compatibility). */
  return (
    <>
      <Copyable text={t.no} className="font-num text-card-title font-extrabold text-[var(--ink-1)]">
        {t.no}
      </Copyable>
      <div className="mt-0.5 text-body text-[var(--ink-3)]">
        {t.depStation} → {t.arrStation}
      </div>
    </>
  )
}

function AirBody({ t }: { t: AirTransfer }) {
  return (
    <>
      <Copyable text={t.no} className="font-num text-card-title font-extrabold text-[var(--ink-1)]">
        {t.no}
      </Copyable>
      <div className="mt-0.5 text-body text-[var(--ink-3)]">
        {t.depStation} → {t.arrStation}
      </div>
    </>
  )
}

function CarBody({ t }: { t: CarTransfer }) {
  const { show } = useToast()
  return (
    <>
      <h3 className="text-card-title text-[var(--ink-1)]">{t.title}</h3>
      {t.durationMin !== undefined && (
        <div className="mt-0.5 text-caption text-[var(--ink-3)]">
          路程预计 {t.durationMin} 分钟
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-2 text-body text-[var(--ink-2)]">
        <div className="flex min-w-0 items-center gap-1.5">
          <Copyable text={t.plate} ariaLabel={`复制车牌 ${t.plate}`}>
            <span
              className="shrink-0 whitespace-nowrap rounded-md border px-1 py-px font-num text-[11px] font-extrabold"
              style={{
                borderColor: 'var(--car)',
                background: 'var(--car-soft)',
                color: 'var(--car)',
              }}
            >
              {t.plate}
            </span>
          </Copyable>
          <span className="shrink-0">{t.driver}</span>
        </div>
        <PhoneChip phone={t.phone} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Icon name="map-pin" size={12} className="shrink-0 text-[var(--ink-3)]" />
          <span className="truncate text-caption text-[var(--ink-3)]">集合：{t.meetPoint}</span>
        </div>
        {isNavigable(t.geo) && (
          <CarNavChip
            onClick={() => {
              if (isNavigable(t.geo)) {
                openNavigation(t.geo)
                show('已为你打开地图')
              }
            }}
          />
        )}
      </div>
    </>
  )
}

function TransferRow({
  t,
  stagger,
  isLast,
  finished,
}: {
  t: Transfer
  stagger: number
  isLast: boolean
  finished: boolean
}) {
  const meta = TYPE_META[t.type]
  // Time column: rail/air show dep over arr; a car shows the leading HH:mm
  // of useTime ("08:10 发车") with the trailing label underneath.
  let top = ''
  let bottom = ''
  if (t.type === 'car') {
    const m = /^(\d{1,2}:\d{2})\s*(.*)$/.exec(t.useTime)
    top = m?.[1] ?? t.useTime
    bottom = m?.[2] ?? ''
  } else {
    top = t.depTime
    bottom = t.arrTime
  }

  return (
    <motion.div
      initial={{ x: -12, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.4, delay: stagger * 0.05, ease: EASE }}
      className={cn('relative flex gap-2.5', !isLast && 'border-b border-[var(--line)]')}
    >
      {/* left time column + rail (same geometry as AgendaRow) */}
      <div className="relative flex w-14 shrink-0 flex-col items-end pr-2.5 pt-2.5">
        <span className="font-num text-time-num text-[var(--ink-1)]">{top}</span>
        {bottom && (
          <span className="font-num text-xs font-bold leading-4 text-[var(--ink-3)]">{bottom}</span>
        )}
        <span
          className={cn(
            'absolute right-0 top-[9px] w-px bg-[var(--line)]',
            isLast ? 'h-[calc(100%-9px)]' : 'h-[calc(100%+1px)]',
          )}
        />
        {/* node dot: same hollow-ring language as agenda rows — theme red
            while the ride is still ahead, gray once its day has passed */}
        <span
          className={cn(
            'absolute right-[-3.5px] top-[18px] h-[8px] w-[8px] rounded-full border-[1.5px] bg-white ring-[3px] ring-[var(--bg-card)]',
            finished ? 'border-[var(--ink-4)]' : 'border-[var(--theme-primary)]',
          )}
        />
      </div>

      <div className="min-w-0 flex-1 py-2.5">
        <div className="flex gap-2">
          {/* type icon badge in theme accent — icons stay highlighted
              regardless of expiry; only the node ring carries the
              expired/active distinction */}
          <span
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
            style={{ background: 'var(--theme-soft)', color: 'var(--theme-primary)' }}
          >
            <Icon name={meta.icon} size={13} />
          </span>
          <div className="min-w-0 flex-1">
            {t.type === 'rail' && <RailBody t={t} />}
            {t.type === 'air' && <AirBody t={t} />}
            {t.type === 'car' && <CarBody t={t} />}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Merged day timeline (议程 + 行程 in one chronological list)          */
/* ------------------------------------------------------------------ */

/** One row of a day's merged timeline. `time` ("HH:mm") is the sort key. */
export type DayEntry =
  | { kind: 'agenda'; item: AgendaItem; time: string }
  | { kind: 'transfer'; transfer: Transfer; time: string; finished: boolean }

/**
 * Merged 我的行程 timeline for one day: sessions and transfers interleaved
 * chronologically on a single rail. Every transfer — including cars a
 * session references via carId — is a standalone row here, so a
 * pre-session ride sorts before its session.
 */
export default function MergedDayTimeline({
  entries,
  onShowSeatMap,
}: {
  entries: DayEntry[]
  onShowSeatMap: (item: AgendaItem) => void
}) {
  return (
    /* notch color: perforation die-cuts punch through to the white surface
       behind the ticket card (day card or, for single-day events, the
       page sheet — both are --bg-card since 方案 A) */
    <div className="[--notch-bg:var(--bg-card)]">
      {entries.map((e, i) =>
        e.kind === 'agenda' ? (
          <AgendaRow
            key={e.item.id}
            item={e.item}
            stagger={i}
            isLast={i === entries.length - 1}
            onShowSeatMap={onShowSeatMap}
          />
        ) : (
          <TransferRow
            key={e.transfer.id}
            t={e.transfer}
            stagger={i}
            isLast={i === entries.length - 1}
            finished={e.finished}
          />
        ),
      )}
    </div>
  )
}
