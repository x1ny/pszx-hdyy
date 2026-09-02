import { useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import type { Transfer } from '@/types/itinerary'
import { buildTelHref, copyText } from '@/lib/actions'
import { Icon } from '@/components/shared'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'
import type { IconName } from '@/components/shared'

/* ------------------------------------------------------------------ */
/* Transport type meta — drives icon + accent color of the flat        */
/* transfer rows in the merged day timeline (议程融合的行程行).        */
/* ------------------------------------------------------------------ */

export const TYPE_META: Record<Transfer['type'], { color: string; soft: string; icon: IconName }> = {
  rail: { color: 'var(--rail)', soft: 'var(--rail-soft)', icon: 'train-front' },
  air: { color: 'var(--air)', soft: 'var(--air-soft)', icon: 'plane' },
  car: { color: 'var(--car)', soft: 'var(--car-soft)', icon: 'car-front' },
}

/** Semantic color of a transfer type — timeline node dot tint. */
export function transferColor(t: Transfer): string {
  return TYPE_META[t.type].color
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
/* Car-row action chips (local: 44px hit areas, car-green semantics)   */
/* ------------------------------------------------------------------ */

/* One chip spec for every row-level action: h-7 pill, 12px, 44px hit area.
   ACTION chips (call / navigate) use theme-red soft — red means actionable,
   and neutral gray reads as "expired" next to the past-day styling. */

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
        className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 font-num text-[12px] font-bold"
        style={{ background: 'var(--car-soft)', color: 'var(--car)' }}
      >
        <Icon name="phone" size={12} className="text-[var(--theme-primary)]" />
        {phone}
      </span>
    </motion.a>
  )
}

/** Navigation chip — shared by agenda venue rows and car meeting points so
    the same action has the same look everywhere. */
export function CarNavChip({ onClick, ariaLabel }: { onClick: () => void; ariaLabel?: string }) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel ?? '导航到集合点'}
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className="-my-2 flex min-h-[44px] shrink-0 items-center"
    >
      <span
        className="flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-bold"
        style={{ background: 'var(--theme-soft)', color: 'var(--theme-primary)' }}
      >
        <Icon name="navigation" size={12} />
        导航
      </span>
    </motion.button>
  )
}
