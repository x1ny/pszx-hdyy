import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Inline SVG icon set (lucide style, stroke 1.75, no icon library)    */
/* ------------------------------------------------------------------ */

export type IconName =
  | 'train-front'
  | 'plane'
  | 'car-front'
  | 'navigation'
  | 'phone'
  | 'calendar-plus'
  | 'share-2'
  | 'map'
  | 'chevron-down'
  | 'chevron-up'
  | 'x'
  | 'map-pin'
  | 'clock'
  | 'zoom-in'
  | 'user-round'
  | 'users-round'
  | 'megaphone'
  | 'lock-keyhole'

const ICON_PATHS: Record<IconName, ReactNode> = {
  'train-front': (
    <>
      <path d="M8 3.1V7a4 4 0 0 0 8 0V3.1" />
      <path d="m9 15-1-1" />
      <path d="m15 15 1-1" />
      <path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z" />
      <path d="m8 19-2 3" />
      <path d="m16 19 2 3" />
    </>
  ),
  plane: (
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
  ),
  'car-front': (
    <>
      <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8" />
      <path d="M7 14h.01" />
      <path d="M17 14h.01" />
      <rect width="18" height="8" x="3" y="10" rx="2" />
      <path d="M5 18v2" />
      <path d="M19 18v2" />
    </>
  ),
  navigation: <polygon points="3 11 22 2 13 21 11 13 3 11" />,
  phone: (
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  ),
  'calendar-plus': (
    <>
      <path d="M16 2v4" />
      <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" />
      <path d="M3 10h18" />
      <path d="M16 19h6" />
      <path d="M19 16v6" />
    </>
  ),
  'share-2': (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </>
  ),
  map: (
    <>
      <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <path d="M15 5.764v15" />
      <path d="M9 3.236v15" />
    </>
  ),
  'chevron-down': <polyline points="6 9 12 15 18 9" />,
  'chevron-up': <polyline points="18 15 12 9 6 15" />,
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  'map-pin': (
    <>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  'zoom-in': (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </>
  ),
  megaphone: (
    <>
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </>
  ),
  'user-round': (
    <>
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </>
  ),
  'users-round': (
    <>
      <path d="M18 21a8 8 0 0 0-16 0" />
      <circle cx="10" cy="8" r="5" />
      <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
    </>
  ),
  'lock-keyhole': (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1" />
    </>
  ),
}

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export function SectionHeader({
  title,
  eyebrow,
  action,
}: {
  title: string
  /** Editorial English micro-label (e.g. "AGENDA") next to the title */
  eyebrow?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <div className="flex items-baseline gap-2">
        <span
          className="inline-block h-[14px] w-[3px] translate-y-[1.5px] rounded-full"
          style={{ background: 'var(--theme-gradient)' }}
        />
        <h2 className="text-h-section tracking-[0.01em] text-[var(--ink-1)]">{title}</h2>
        {eyebrow && (
          <span className="text-eyebrow text-[var(--ink-4)]" aria-hidden>
            {eyebrow}
          </span>
        )}
      </div>
      {action}
    </div>
  )
}

export function IconBadge({
  icon,
  color,
  softColor,
  size = 36,
}: {
  icon: IconName
  color: string
  softColor: string
  size?: number
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[10px]"
      style={{ width: size, height: size, background: softColor, color }}
    >
      <Icon name={icon} size={20} />
    </span>
  )
}

export function PillTag({
  children,
  variant = 'soft',
  className,
  style,
}: {
  children: ReactNode
  /** solid = filled theme bg white text; soft = tinted bg; outline = same-hue wireframe */
  variant?: 'solid' | 'soft' | 'outline'
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-tag', className)}
      style={{
        ...(variant === 'solid'
          ? { background: 'var(--theme-gradient)', color: '#fff' }
          : variant === 'outline'
            ? {
                background: '#fff',
                color: 'var(--theme-primary)',
                border: '1px solid var(--theme-primary)',
              }
            : { background: 'var(--theme-soft)', color: 'var(--theme-primary)' }),
        ...style,
      }}
    >
      {children}
    </span>
  )
}

export function NavChip({
  label = '导航',
  color = 'var(--theme-primary)',
  softColor = 'var(--theme-soft)',
  onClick,
}: {
  label?: string
  color?: string
  softColor?: string
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className="flex h-9 shrink-0 items-center gap-1 rounded-[10px] px-2.5 text-body font-bold"
      style={{ background: softColor, color }}
    >
      <Icon name="navigation" size={14} />
      {label}
    </motion.button>
  )
}

export function TelChip({ phone, className }: { phone: string; className?: string }) {
  return (
    <motion.a
      href={`tel:${phone}`}
      whileTap={{ scale: 0.94 }}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-lg px-2 font-num text-[13px] font-bold',
        className,
      )}
      style={{ background: 'var(--car-soft)', color: 'var(--car)' }}
    >
      <Icon name="phone" size={12} />
      {phone}
    </motion.a>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-xl', className)} />
}

/* ------------------------------------------------------------------ */
/* FullScreenOverlay — scrim + spring panel + scroll lock + back key   */
/* ------------------------------------------------------------------ */

export function FullScreenOverlay({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  // Body scroll lock (incl. iOS fixed hack) + one-step pushState so the
  // Android back button / swipe-back closes the overlay.
  useEffect(() => {
    if (!open) return
    const scrollY = window.scrollY
    const body = document.body
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.overflow = 'hidden'

    history.pushState({ overlay: true }, '')
    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)

    return () => {
      body.style.position = ''
      body.style.top = ''
      body.style.left = ''
      body.style.right = ''
      body.style.overflow = ''
      window.scrollTo(0, scrollY)
      window.removeEventListener('popstate', onPop)
      // If overlay was closed by UI (not by popstate), consume the extra
      // history entry we pushed.
      if (history.state?.overlay) history.back()
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-[rgb(16,20,30)]"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 400) onClose()
            }}
            className="absolute inset-0 mx-auto flex w-full max-w-[393px] flex-col bg-white"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--line)] px-4">
              <h3 className="text-h-section text-[var(--ink-1)]">{title}</h3>
              <button
                type="button"
                aria-label="关闭"
                onClick={onClose}
                className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-2)]"
              >
                <Icon name="x" size={20} />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
