import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { AgendaItem, ItineraryData } from '@/types/itinerary'
import { ItineraryError, fetchItinerary, getToken } from '@/lib/itinerary-api'
import { copyText } from '@/lib/actions'
import EventHero from '@/components/EventHero'
import ScheduleTabs from '@/components/ScheduleTabs'
import MapOverlay from '@/components/MapOverlay'
import KeyGate from '@/components/KeyGate'
import { SkeletonCard } from '@/components/shared'
import { ToastProvider } from '@/components/Toast'
import { useToast } from '@/lib/toast-context'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; data: ItineraryData }
  | { phase: 'invalid'; message: string }
  | { phase: 'error'; message: string }

/* ---------------- skeleton ---------------- */

function SkeletonScreen() {
  return (
    <div className="min-h-dvh bg-[var(--bg-card)]">
      <div className="skeleton h-[200px]" />
      <div className="-mt-6 rounded-t-[24px] bg-[var(--bg-card)] px-4 pb-4 pt-4">
        <div className="skeleton h-6 w-[90%] rounded-md" />
        <div className="skeleton mt-2 h-6 w-[60%] rounded-md" />
        <div className="skeleton mt-3 h-4 w-[70%] rounded" />
        <div className="skeleton mt-2 h-4 w-[55%] rounded" />
        <div className="skeleton mt-2 h-4 w-full rounded" />
        <div className="skeleton mt-1.5 h-4 w-[80%] rounded" />
      </div>
      <div className="px-4 pt-4">
        <div className="skeleton h-5 w-24 rounded" />
        <SkeletonCard className="mt-2.5 h-[104px]" />
        <SkeletonCard className="mt-2.5 h-[104px]" />
      </div>
      <div className="px-4 pt-4">
        <div className="skeleton h-5 w-24 rounded" />
        <SkeletonCard className="mt-2.5 h-[112px]" />
        <SkeletonCard className="mt-2.5 h-[112px]" />
      </div>
      <div className="px-4 pt-4">
        <SkeletonCard className="h-12" />
      </div>
    </div>
  )
}

/* ---------------- empty / error states ---------------- */

function InvalidState({ message }: { message: string }) {
  const { show } = useToast()
  return (
    <FullState
      title={message}
      desc="请确认链接完整，或联系活动主办方重新获取"
      actionLabel="复制主办方联系方式"
      actionVariant="outline"
      onAction={async () => (await copyText('400-888-0000')) && show('已复制')}
    />
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <FullState
      title={message}
      desc="请检查网络连接后重试"
      actionLabel="重新加载"
      actionVariant="solid"
      onAction={() => window.location.reload()}
    />
  )
}

function FullState({
  title,
  desc,
  actionLabel,
  actionVariant,
  onAction,
}: {
  title: string
  desc: string
  actionLabel: string
  actionVariant: 'outline' | 'solid'
  onAction: () => void
}) {
  return (
    <div className="app-viewport flex flex-col items-center justify-center px-8 text-center">
      <motion.img
        src="/empty-state.png"
        alt=""
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="w-[180px] rounded-2xl"
        draggable={false}
      />
      <h1 className="mt-4 text-card-title text-[var(--ink-1)]">{title}</h1>
      <p className="mt-1 text-body text-[var(--ink-3)]">{desc}</p>
      <motion.button
        type="button"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.2, ease: EASE }}
        onClick={onAction}
        className={
          actionVariant === 'solid'
            ? 'shadow-share bg-theme-gradient mt-5 h-11 rounded-xl px-6 text-body font-bold text-white'
            : 'mt-5 h-11 rounded-xl border border-[var(--theme-primary)] px-6 text-body font-bold text-[var(--theme-primary)]'
        }
      >
        {actionLabel}
      </motion.button>
    </div>
  )
}

/* ---------------- page ---------------- */

function ItineraryView({ data }: { data: ItineraryData }) {
  // The seat map overlay is owned here; agenda cards open it with their own
  // zone/seat so the chart highlights the attendee's exact seat.
  const [seatTarget, setSeatTarget] = useState<{ zone?: string; seat?: string } | null>(null)

  const section = (i: number, node: React.ReactNode) => (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.45, delay: i * 0.09, ease: EASE }}
    >
      {node}
    </motion.div>
  )

  return (
    // The white sheet slides over the hero poster and runs uninterrupted
    // to the bottom of the page — no white-to-gray seam below the hero
    // card (方案 A). Cards below separate via border + shadow on white.
    <div className="min-h-dvh bg-[var(--bg-card)] pb-6">
      {section(0, <EventHero userName={data.user.name} greeting={data.user.greeting} event={data.event} />)}
      <div className="flex flex-col gap-4 pt-4">
        {section(
          1,
          <ScheduleTabs
            agenda={data.agenda}
            transfers={data.transfers}
            onShowSeatMap={(item: AgendaItem) => setSeatTarget({ zone: item.zone, seat: item.seat })}
          />,
        )}
      </div>
      <MapOverlay
        open={seatTarget !== null}
        onClose={() => setSeatTarget(null)}
        venueMap={data.venueMap}
        seatZone={seatTarget?.zone}
        seat={seatTarget?.seat}
      />
    </div>
  )
}

const UNLOCK_KEY = 'itinerary-unlocked'

function readUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1'
  } catch {
    return false
  }
}

export default function Home() {
  const [unlocked, setUnlocked] = useState(readUnlocked)
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    if (!unlocked) return
    let cancelled = false
    fetchItinerary(getToken())
      .then((data) => !cancelled && setState({ phase: 'ready', data }))
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ItineraryError && err.code === 404) {
          setState({ phase: 'invalid', message: err.message })
        } else {
          setState({ phase: 'error', message: '网络开小差了' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [unlocked])

  const handleUnlock = () => {
    try {
      sessionStorage.setItem(UNLOCK_KEY, '1')
    } catch {
      /* private mode — gate simply re-appears on next launch */
    }
    setUnlocked(true)
  }

  return (
    <ToastProvider>
      {!unlocked && <KeyGate onUnlock={handleUnlock} />}
      {unlocked && state.phase === 'loading' && <SkeletonScreen />}
      {unlocked && state.phase === 'ready' && <ItineraryView data={state.data} />}
      {unlocked && state.phase === 'invalid' && <InvalidState message={state.message} />}
      {unlocked && state.phase === 'error' && <ErrorState message={state.message} />}
    </ToastProvider>
  )
}
