import { useCallback, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import type { AirTransfer, CarTransfer, RailTransfer, Transfer } from '@/types/itinerary'
import { buildTelHref, copyText, openNavigation } from '@/lib/actions'
import { Icon, IconBadge, PillTag } from '@/components/shared'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'
import type { IconName } from '@/components/shared'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

const TYPE_META: Record<Transfer['type'], { color: string; soft: string; icon: IconName }> = {
  rail: { color: 'var(--rail)', soft: 'var(--rail-soft)', icon: 'train-front' },
  air: { color: 'var(--air)', soft: 'var(--air-soft)', icon: 'plane' },
  car: { color: 'var(--car)', soft: 'var(--car-soft)', icon: 'car-front' },
}

/* ------------------------------------------------------------------ */
/* Copy-on-tap / long-press with a >=44px hit area                     */
/* ------------------------------------------------------------------ */

/**
 * Tap or long-press copies `text` and fires the toast. The element keeps
 * native text selection enabled (select-text) so iOS/WeChat users can also
 * long-press → select → copy manually. Hit area is extended with padding
 * compensated by a negative margin, so the visual layout stays compact.
 */
export function Copyable({
  text,
  ariaLabel,
  className,
  style,
  children,
}: {
  text: string
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const { show } = useToast()
  const timerRef = useRef<number | undefined>(undefined)
  const longPressFiredRef = useRef(false)

  const doCopy = useCallback(async () => {
    if (await copyText(text)) show('已复制')
  }, [text, show])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const startLongPress = () => {
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true
      void doCopy()
    }, 500)
  }
  const cancelLongPress = () => window.clearTimeout(timerRef.current)

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? `复制 ${text}`}
      className={cn('-m-2 inline-flex select-text items-center p-2', className)}
      style={style}
      onClick={() => {
        // Suppress the synthetic click that follows a completed long-press.
        if (longPressFiredRef.current) {
          longPressFiredRef.current = false
          return
        }
        void doCopy()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void doCopy()
        }
      }}
      onTouchStart={startLongPress}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onTouchCancel={cancelLongPress}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Car-card action chips (local: 44px hit areas, car-green semantics)  */
/* ------------------------------------------------------------------ */

/** Tap-to-call chip. Visual pill is compact; anchor hit area is 44px tall. */
export function PhoneChip({ phone, ariaLabel }: { phone: string; ariaLabel?: string }) {
  return (
    <motion.a
      href={buildTelHref(phone)}
      aria-label={ariaLabel ?? `拨打司机电话 ${phone}`}
      whileTap={{ scale: 0.94 }}
      className="-my-2 inline-flex min-h-[44px] shrink-0 items-center"
    >
      <span
        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 font-num text-[13px] font-bold"
        style={{ background: 'var(--car-soft)', color: 'var(--car)' }}
      >
        <Icon name="phone" size={12} />
        {phone}
      </span>
    </motion.a>
  )
}

/** Meeting-point navigation chip with a 44px hit area. */
export function CarNavChip({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      type="button"
      aria-label="导航到集合点"
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className="-my-2 flex min-h-[44px] shrink-0 items-center"
    >
      <span
        className="flex h-9 items-center gap-1 rounded-[10px] px-2.5 text-body font-bold"
        style={{ background: 'var(--car-soft)', color: 'var(--car)' }}
      >
        <Icon name="navigation" size={14} />
        导航
      </span>
    </motion.button>
  )
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Ticket-stub perforation: full-bleed dashed line with die-cut semicircle
 * notches punched at both card edges (the card's overflow-hidden clips the
 * outer halves). Left margin compensates the icon column (36px badge + 10px
 * gap + 4px extra left padding) so the line spans the whole card.
 */
function Perforation() {
  // Notch color comes from --notch-bg so the die-cut blends with whatever
  // surface the card sits on (page by default; a day card overrides it to
  // its own white surface).
  return (
    <div
      aria-hidden
      className="relative ml-[-50px] mr-[-12px] my-1.5 border-t border-dashed border-[var(--ink-4)]/50"
    >
      <span className="absolute -left-[5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[var(--notch-bg,var(--bg-page))]" />
      <span className="absolute -right-[5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[var(--notch-bg,var(--bg-page))]" />
    </div>
  )
}

/** Split a trailing terminal token ("北京首都 T2" → ["北京首都", "T2"]). */
function splitTerminal(station: string): { name: string; terminal?: string } {
  const m = /^(.*?)\s*(T\d+)$/.exec(station.trim())
  if (m && m[1]) return { name: m[1], terminal: m[2] }
  return { name: station }
}

/** Small boxed terminal tag rendered after an airport name. */
function TerminalTag({ terminal, color }: { terminal: string; color: string }) {
  return (
    <span
      className="ml-1 inline-flex -translate-y-px items-center rounded border px-1 font-num text-[10px] font-bold leading-4"
      style={{ borderColor: color, color }}
    >
      {terminal}
    </span>
  )
}

/**
 * Snapshot of "now" at page load. This H5 is short-lived and re-mounted on
 * each visit, so a module-level timestamp keeps renders pure (react-hooks
 * lint) while staying accurate enough for the in-progress dash animation.
 */
const PAGE_LOADED_AT = Date.now()

/**
 * Departure → arrival window derived from sortTime (day) + HH:mm fields.
 * Handles overnight arrivals. Returns null when parsing fails.
 */
function transferWindow(t: RailTransfer | AirTransfer): { start: number; end: number } | null {
  const day = /^(\d{4})(\d{2})(\d{2})T/.exec(t.sortTime)
  const hm = (s: string) => /^(\d{1,2}):(\d{2})/.exec(s)
  const dep = hm(t.depTime)
  const arr = hm(t.arrTime)
  if (!day || !dep || !arr) return null
  const base = [Number(day[1]), Number(day[2]) - 1, Number(day[3])] as const
  const start = new Date(base[0], base[1], base[2], Number(dep[1]), Number(dep[2])).getTime()
  let end = new Date(base[0], base[1], base[2], Number(arr[1]), Number(arr[2])).getTime()
  if (end < start) end += 86_400_000 // overnight arrival
  return { start, end }
}

/* ------------------------------------------------------------------ */
/* Middle route row: time + station ─ ─ → time + station               */
/* ------------------------------------------------------------------ */

function RouteRow({
  depTime,
  depStation,
  arrTime,
  arrStation,
  color,
  showTerminal,
  active,
}: {
  depTime: string
  depStation: string
  arrTime: string
  arrStation: string
  color: string
  showTerminal?: boolean
  active?: boolean
}) {
  const dep = showTerminal ? splitTerminal(depStation) : { name: depStation }
  const arr = showTerminal ? splitTerminal(arrStation) : { name: arrStation }
  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="min-w-0">
        <div className="font-num text-[18px] font-extrabold leading-6 text-[var(--ink-1)]">
          {depTime}
        </div>
        <div className="truncate text-body text-[var(--ink-3)]">
          {dep.name}
          {dep.terminal && <TerminalTag terminal={dep.terminal} color={color} />}
        </div>
      </div>
      <svg className="h-4 min-w-8 flex-1" viewBox="0 0 80 12" preserveAspectRatio="none" aria-hidden>
        <line
          x1="0"
          y1="6"
          x2="70"
          y2="6"
          stroke={color}
          strokeOpacity="0.4"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          className={active ? 'dash-flow' : undefined}
        />
        <polyline
          points="66,2 72,6 66,10"
          fill="none"
          stroke={color}
          strokeOpacity="0.7"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="min-w-0 text-right">
        <div className="font-num text-[18px] font-extrabold leading-6 text-[var(--ink-1)]">
          {arrTime}
        </div>
        <div className="truncate text-body text-[var(--ink-3)]">
          {arr.name}
          {arr.terminal && <TerminalTag terminal={arr.terminal} color={color} />}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Per-type card bodies                                                */
/* ------------------------------------------------------------------ */

function RailCard({ t, color }: { t: RailTransfer; color: string }) {
  const win = transferWindow(t)
  const active = win !== null && PAGE_LOADED_AT >= win.start && PAGE_LOADED_AT <= win.end
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Copyable
          text={t.no}
          className="font-num text-card-title font-extrabold text-[var(--ink-1)]"
        >
          {t.no}
        </Copyable>
        {t.seat && (
          <PillTag variant="soft" style={{ background: 'var(--rail-soft)', color: 'var(--rail)' }}>
            <span className="font-num">{t.seat}</span>
          </PillTag>
        )}
      </div>
      <Perforation />
      <RouteRow
        depTime={t.depTime}
        depStation={t.depStation}
        arrTime={t.arrTime}
        arrStation={t.arrStation}
        color={color}
        active={active}
      />
      {t.gate && (
        <div className="mt-1 text-caption text-[var(--ink-3)]">
          <span className="font-num font-bold" style={{ color }}>
            {t.gate}
          </span>
          {' · 请提前 20 分钟到站'}
        </div>
      )}
    </>
  )
}

function AirCard({ t, color }: { t: AirTransfer; color: string }) {
  const win = transferWindow(t)
  const active = win !== null && PAGE_LOADED_AT >= win.start && PAGE_LOADED_AT <= win.end
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Copyable
          text={t.no}
          className="font-num text-card-title font-extrabold text-[var(--ink-1)]"
        >
          {t.no}
        </Copyable>
        {t.seat && (
          <PillTag variant="soft" style={{ background: 'var(--air-soft)', color: 'var(--air)' }}>
            <span className="font-num">{t.seat}</span>
          </PillTag>
        )}
      </div>
      <Perforation />
      <RouteRow
        depTime={t.depTime}
        depStation={t.depStation}
        arrTime={t.arrTime}
        arrStation={t.arrStation}
        color={color}
        showTerminal
        active={active}
      />
      {t.gate && (
        <div className="mt-1 text-caption text-[var(--ink-3)]">
          <span className="font-num font-bold" style={{ color }}>
            {t.gate}
          </span>
          {' · 起飞前 45 分钟停止登机'}
        </div>
      )}
    </>
  )
}

function CarCard({ t }: { t: CarTransfer }) {
  const { show } = useToast()
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-card-title text-[var(--ink-1)]">{t.title}</h3>
        <Copyable text={t.plate} ariaLabel={`复制车牌 ${t.plate}`} className="shrink-0">
          <span
            className="rounded-md border px-2 py-0.5 font-num text-[13px] font-extrabold"
            style={{
              borderColor: 'var(--car)',
              background: 'var(--car-soft)',
              color: 'var(--car)',
            }}
          >
            {t.plate}
          </span>
        </Copyable>
      </div>
      <Perforation />
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-[var(--ink-2)]">
        <span className="font-num font-bold text-[var(--ink-1)]">{t.useTime}</span>
        {t.durationMin !== undefined && <span>· 路程预计 {t.durationMin} 分钟</span>}
        <span>· 司机 {t.driver}</span>
        <PhoneChip phone={t.phone} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Icon name="map-pin" size={12} className="shrink-0 text-[var(--ink-3)]" />
          <span className="truncate text-body text-[var(--ink-3)]">集合：{t.meetPoint}</span>
        </div>
        {t.geo && (
          <CarNavChip
            onClick={() => {
              if (t.geo) {
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

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

/**
 * 行程信息 tab panel: transport card group (rail / flight / car),
 * sorted ascending by departure sort time. The tab chrome (header /
 * segmented control) lives in ScheduleTabs.
 */
export default function TransferCards({
  transfers,
  inset = false,
}: {
  transfers: Transfer[]
  /** Inside a day card: flatter sub-panels (soft gray, no shadow) instead
      of full ticket cards, avoiding card-in-card heaviness. */
  inset?: boolean
}) {
  const sorted = useMemo(
    () =>
      transfers
        .slice()
        .sort((a, b) => (a.sortTime < b.sortTime ? -1 : a.sortTime > b.sortTime ? 1 : 0)),
    [transfers],
  )

  if (sorted.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
        {sorted.map((t, i) => {
          const meta = TYPE_META[t.type]
          return (
            <motion.div
              key={`${t.type}-${t.sortTime}`}
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.45, delay: i * 0.09, ease: EASE }}
              whileTap={{ scale: 0.98 }}
              className={
                inset
                  ? 'relative overflow-hidden rounded-xl border border-[var(--line)] bg-[#FAFBFC] p-3 pl-[16px]'
                  : 'relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-card)] p-3 pl-[16px] shadow-card'
              }
            >
              {/* Left semantic color bar: rail blue / flight purple / car green.
                  The perforation notch punches through it — intentional die-cut look. */}
              <motion.span
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.3, delay: i * 0.09, ease: EASE }}
                className="absolute inset-y-0 left-0 w-[3px] origin-top"
                style={{ background: meta.color }}
              />
              <div className="flex gap-2.5">
                <IconBadge icon={meta.icon} color={meta.color} softColor={meta.soft} />
                <div className="min-w-0 flex-1">
                  {t.type === 'rail' && <RailCard t={t} color={meta.color} />}
                  {t.type === 'air' && <AirCard t={t} color={meta.color} />}
                  {t.type === 'car' && <CarCard t={t} />}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
  )
}
