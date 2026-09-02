import { useState } from 'react'
import { motion } from 'framer-motion'
import type { EventInfo } from '@/types/itinerary'
import { Icon } from '@/components/shared'
import EventDetailOverlay from '@/components/EventDetailOverlay'
import { PhoneChip } from '@/components/TransfersSection'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

/**
 * Title reveal borrowed from cinematic opening sequences: each character
 * scales 1.25 → 1 while fading in, 45ms apart. Whitespace is preserved with
 * NBSP so clamp-2 wrapping stays correct.
 */
function RevealTitle({ title }: { title: string }) {
  return (
    <motion.h1
      aria-label={title}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.28 } } }}
      className="clamp-2 select-text text-display text-[var(--ink-1)]"
    >
      {Array.from(title).map((ch, i) => (
        <motion.span
          key={i}
          aria-hidden
          variants={{
            hidden: { opacity: 0, y: 8, scale: 1.25 },
            show: { opacity: 1, y: 0, scale: 1 },
          }}
          transition={{ duration: 0.35, ease: EASE }}
          className="inline-block origin-bottom-left"
        >
          {ch === ' ' ? ' ' : ch}
        </motion.span>
      ))}
    </motion.h1>
  )
}

/**
 * Module 1 — 活动概况: 200px hero (gradient + image + texture) with the white
 * content card cutting in from the bottom (24px top radius, rounded
 * transition into the content below). Rows: title (2-line clamp) / date+time
 * / collapsible intro. The venue line lives in the 活动详情 overlay — the
 * hero stays focused on "what & when".
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
  const [detailOpen, setDetailOpen] = useState(false)

  return (
    <section className="relative">
      {/* Hero image area — fashion-poster key visual (silk ribbons + gold
          line pagodas); the theme gradient stays as the loading fallback and
          re-theming anchor */}
      <div className="relative h-[200px] overflow-hidden bg-theme-gradient">
        <motion.img
          src={event.heroImage}
          alt=""
          initial={{ scale: 1.06, opacity: 0.9 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
        {/* soft melt where the white card cuts in */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/15 to-transparent"
        />
        {/* top status row — frosted light pill with dark text (poster top is airy cream) */}
        <div className="absolute right-4 top-3 flex items-center gap-1.5 rounded-full border border-white/60 bg-white/55 py-1 pl-2.5 pr-3 backdrop-blur-md">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--theme-primary)]" />
          <span className="text-caption font-bold tracking-[0.02em] text-[var(--ink-2)]">
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
          <RevealTitle title={event.title} />

          {/* date + exact time range */}
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
          </motion.div>

          {/* intro: 2-line clamp; 查看详情 opens the full detail overlay
              (only when the backend supplies long-form details) */}
          <motion.div
            variants={{ hidden: { y: 10, opacity: 0 }, show: { y: 0, opacity: 1 } }}
            transition={{ duration: 0.4, ease: EASE }}
            className="mt-1.5"
          >
            <p className="clamp-2 select-text text-body text-[var(--ink-3)]">{event.intro}</p>
            {event.details && (
              <button
                type="button"
                onClick={() => setDetailOpen(true)}
                aria-label="查看活动详情"
                className="relative mt-0.5 flex items-center gap-0.5 py-1 text-body font-bold text-[var(--theme-primary)] before:absolute before:-inset-x-1 before:-inset-y-2 before:content-['']"
              >
                查看详情
                <Icon name="chevron-down" size={12} className="-rotate-90" />
              </button>
            )}
          </motion.div>

          {/* staff contact — on the first screen so a guest with questions
              reaches staff without scrolling; absent from data → no card */}
          {event.contact && (
            <motion.div
              variants={{ hidden: { y: 10, opacity: 0 }, show: { y: 0, opacity: 1 } }}
              transition={{ duration: 0.4, ease: EASE }}
              className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[#FAFBFC] px-2.5 py-2"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--theme-soft)] text-[var(--theme-primary)]">
                <Icon name="user-round" size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-caption text-[var(--ink-3)]">现场联系人</span>
                <span className="block truncate text-body font-bold text-[var(--ink-1)]">
                  {event.contact.name}
                </span>
              </span>
              <PhoneChip
                phone={event.contact.phone}
                ariaLabel={`拨打工作人员 ${event.contact.name} 的电话 ${event.contact.phone}`}
              />
            </motion.div>
          )}
        </motion.div>
      </motion.div>

      {event.details && (
        <EventDetailOverlay
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          event={event}
        />
      )}
    </section>
  )
}
