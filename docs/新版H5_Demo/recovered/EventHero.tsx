import { useState } from 'react'
import { motion } from 'framer-motion'
import type { EventInfo } from '@/types/itinerary'
import { addToCalendar, openNavigation } from '@/lib/actions'
import { Icon } from '@/components/shared'
import type { IconName } from '@/components/shared'
import { useToast } from '@/lib/toast-context'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

/**
 * Compact hero action chip: 36px visual height (design.md §1 NavChip spec)
 * with the hit area expanded to ≥44px via a ::before overlay (no layout cost).
 */
function HeroActionChip({
  icon,
  label,
  onClick,
  ariaLabel,
}: {
  icon: IconName
  label: string
  onClick: () => void
  ariaLabel?: string
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className="relative flex h-9 shrink-0 items-center gap-1 rounded-[10px] bg-[var(--theme-soft)] px-2.5 text-body font-bold text-[var(--theme-primary)] before:absolute before:-inset-x-1 before:-inset-y-2 before:content-['']"
    >
      <Icon name={icon} size={14} />
      {label}
    </motion.button>
  )
}

/**
 * Module 1 — 活动概况: 200px hero (gradient + image + texture) with the white
 * content card cutting in from the bottom (24px top radius, rounded
 * transition into the content below). Rows: title (2-line clamp) / date+time
 * / city+venue with nav action / collapsible intro. Add-to-calendar lives in
 * the time row so the overview carries the calendar affordance too.
 */
export default function EventHero({
  userName,
  greeting,
  event,
}: {
  userName: string
  greeting: string
  event: EventInfo
}) {
  const { show } = useToast()
  const [expanded, setExpanded] = useState(false)

  const handleNav = () => {
    openNavigation(event.venueGeo)
    show('已为你打开地图')
  }

  const handleCalendar = async () => {
    const result = await addToCalendar(event)
    show(result === 'downloaded' ? '已保存日历文件' : '已复制时间信息，请粘贴到日历')
  }

  return (
    <section className="relative">
      {/* Hero image area */}
      <div className="relative h-[200px] overflow-hidden bg-theme-gradient">
        <motion.img
          src={event.heroImage}
          alt=""
          initial={{ scale: 1.06, opacity: 0.9 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="absolute inset-0 h-full w-full object-cover object-[center_70%]"
          draggable={false}
        />
        <div
          className="absolute inset-0 opacity-[0.24]"
          style={{
            backgroundImage: 'url(/texture-geometry.svg)',
            backgroundSize: '200px 200px',
            backgroundRepeat: 'repeat',
          }}
        />
        {/* top status row */}
        <div className="absolute right-4 top-3 flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-white/90" />
          <span className="text-caption text-white/95">
            {userName} 的{greeting}
          </span>
        </div>
      </div>

      {/* White card cutting into the hero (rounded bottom transition) */}
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.08, ease: EASE }}
        className="relative -mt-6 rounded-t-[24px] bg-[var(--bg-card)] px-4 pb-4 pt-4"
      >
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } },
          }}
        >
          <motion.h1
            variants={{ hidden: { y: 10, opacity: 0 }, show: { y: 0, opacity: 1 } }}
            transition={{ duration: 0.4, ease: EASE }}
            className="clamp-2 select-text text-display text-[var(--ink-1)]"
          >
            {event.title}
          </motion.h1>

          {/* date + exact time range + add-to-calendar affordance */}
          <motion.div
            variants={{ hidden: { y: 10, opacity: 0 }, show: { y: 0, opacity: 1 } }}
            transition={{ duration: 0.4, ease: EASE }}
            className="mt-2 flex items-center gap-1.5"
          >
            <Icon name="clock" size={14} className="shrink-0 text-[var(--ink-3)]" />
            <span className="text-body text-[var(--ink-2)]">{event.dateText}</span>
            <span className="font-num text-body font-extrabold text-[var(--ink-1)]">
              {event.timeRange}
            </span>
            <span className="flex-1" />
            <HeroActionChip
              icon="calendar-plus"
              label="日历"
              ariaLabel="添加到日历"
              onClick={() => void handleCalendar()}
            />
          </motion.div>

          {/* city + venue + navigation action */}
          <motion.div
            variants={{ hidden: { y: 10, opacity: 0 }, show: { y: 0, opacity: 1 } }}
            transition={{ duration: 0.4, ease: EASE }}
            className="mt-1.5 flex items-center justify-between gap-2"
          >
            <button
              type="button"
              onClick={handleNav}
              aria-label={`导航到 ${event.city}${event.venue}`}
              className="relative flex min-w-0 items-center gap-1.5 text-left before:absolute before:-inset-x-1 before:-inset-y-2 before:content-['']"
            >
              <Icon name="map-pin" size={14} className="shrink-0 text-[var(--ink-3)]" />
              <span className="truncate text-body text-[var(--ink-2)]">
                {event.city} · {event.venue}
              </span>
            </button>
            <HeroActionChip icon="navigation" label="导航" onClick={handleNav} />
          </motion.div>

          {/* collapsible intro: 2 lines collapsed, max 3 expanded */}
          <motion.div
            variants={{ hidden: { y: 10, opacity: 0 }, show: { y: 0, opacity: 1 } }}
            transition={{ duration: 0.4, ease: EASE }}
            className="mt-1.5"
          >
            <p
              className={`select-text text-body text-[var(--ink-3)] transition-all duration-200 ${
                expanded ? 'clamp-3' : 'clamp-2'
              }`}
            >
              {event.intro}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ml-1 inline px-1 py-2 font-bold text-[var(--theme-primary)]"
              >
                {expanded ? '收起' : '展开'}
              </button>
            </p>
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  )
}
