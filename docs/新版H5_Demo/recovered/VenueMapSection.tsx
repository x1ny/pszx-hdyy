import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { VenueMapInfo } from '@/types/itinerary'
import { Icon } from '@/components/shared'
import MapOverlay from '@/components/MapOverlay'

/**
 * Module 4 — 场地分区地图入口. Default state is exactly one compact 48px row
 * (查看场地分区地图 ▼); it never expands in-flow — tapping opens the
 * full-screen MapOverlay (position: fixed, no document-height impact).
 */
export default function VenueMapSection({ venueMap }: { venueMap: VenueMapInfo }) {
  const [open, setOpen] = useState(false)
  const reduceMotion = useReducedMotion()

  return (
    <section className="px-4" aria-label="场地分区地图">
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-12 w-full items-center gap-2.5 rounded-xl bg-[var(--bg-card)] px-3 shadow-card"
      >
        <Icon name="map" size={18} className="shrink-0 text-[var(--theme-primary)]" />
        <span className="flex min-w-0 flex-1 flex-col items-start justify-center text-left leading-none">
          <span className="truncate text-body font-bold text-[var(--ink-1)]">
            查看场地分区地图
          </span>
          <span className="mt-[3px] text-caption leading-[14px] text-[var(--ink-3)]">
            您所在分区：
            <span className="font-bold text-[var(--theme-primary)]">{venueMap.userZone}</span>
          </span>
        </span>
        <motion.span
          animate={reduceMotion ? undefined : { y: [0, 3, 0] }}
          transition={{ duration: 0.2, repeat: 2, repeatDelay: 3.8, ease: 'easeInOut' }}
          className="flex h-11 w-6 shrink-0 items-center justify-center text-[var(--ink-3)]"
        >
          <Icon name="chevron-down" size={16} />
        </motion.span>
      </motion.button>

      <MapOverlay open={open} onClose={() => setOpen(false)} venueMap={venueMap} />
    </section>
  )
}
