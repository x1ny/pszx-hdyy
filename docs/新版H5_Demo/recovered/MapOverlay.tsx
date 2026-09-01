import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { VenueMapInfo, ZoneInfo } from '@/types/itinerary'
import { FullScreenOverlay, Icon, PillTag } from '@/components/shared'
import { cn } from '@/lib/utils'

interface Transform {
  scale: number
  x: number
  y: number
}

interface Point {
  x: number
  y: number
}

const MIN_SCALE = 1
const MAX_SCALE = 4
const CENTER_SCALE = 1.8
const DOUBLE_TAP_MS = 300
const INERTIA_MS = 200
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/**
 * Full-screen venue map overlay: fixed layer (FullScreenOverlay supplies the
 * scrim, spring entrance, close button, body scroll lock and back-key close),
 * pinch zoom 1–4× around the pinch midpoint, boundary-clamped drag with
 * release inertia, double-tap/double-click spring reset, red-frame user-zone
 * highlight, and a zone list that centers the map on tap.
 *
 * Gesture math runs on native pointer events and writes straight to the DOM
 * (no per-frame React re-render). Native listeners also stop propagation of
 * pointerdown so the overlay panel's own drag-to-close gesture never fights
 * map panning / list scrolling.
 */
export default function MapOverlay({
  open,
  onClose,
  venueMap,
}: {
  open: boolean
  onClose: () => void
  venueMap: VenueMapInfo
}) {
  // ESC closes the overlay (close button + scrim + back key come from
  // FullScreenOverlay).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <FullScreenOverlay open={open} onClose={onClose} title="场地分区图">
      {/* Mounted only while open → each open starts from a fresh transform
          and the map image is requested only when the overlay opens. */}
      <MapViewport venueMap={venueMap} />
    </FullScreenOverlay>
  )
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

function zoneLetter(userZone: string): string {
  return userZone.replace(/[^A-Za-z]/g, '').toUpperCase() || userZone
}

function MapViewport({ venueMap }: { venueMap: VenueMapInfo }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [imgLoaded, setImgLoaded] = useState(false)
  const [box, setBox] = useState<Box | null>(null)
  const [activeZone, setActiveZone] = useState(() => zoneLetter(venueMap.userZone))

  const reduceMotion = useReducedMotion()
  const reduceRef = useRef(reduceMotion)
  reduceRef.current = reduceMotion

  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 })
  const aspectRef = useRef(4 / 3) // venue-map.png is 1200×900 per asset manifest
  const pointersRef = useRef(new Map<number, Point>())
  const gestureRef = useRef<{
    mode: 'pan' | 'pinch'
    startDist: number
    startMid: Point
    startPointer: Point
    startTransform: Transform
  } | null>(null)
  const samplesRef = useRef<{ t: number; x: number; y: number }[]>([])
  const lastTapRef = useRef(0)

  const userZoneKey = zoneLetter(venueMap.userZone)
  const userRect = venueMap.zones.find((z) => z.key === userZoneKey)?.rect

  /** Viewport size + the letterboxed image rect inside it (object-fit: contain math). */
  const metrics = () => {
    const el = viewportRef.current
    const w = el?.clientWidth ?? 375
    const h = el?.clientHeight ?? 400
    const aspect = aspectRef.current
    let width = w
    let height = w / aspect
    if (height > h) {
      height = h
      width = h * aspect
    }
    return { w, h, box: { left: (w - width) / 2, top: (h - height) / 2, width, height } }
  }

  /** Keep the scaled layer covering the viewport: background never shows. */
  const clampTransform = (t: Transform): Transform => {
    const { w, h } = metrics()
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale))
    const minX = Math.min(0, w - w * scale)
    const minY = Math.min(0, h - h * scale)
    return {
      scale,
      x: Math.min(0, Math.max(minX, t.x)),
      y: Math.min(0, Math.max(minY, t.y)),
    }
  }

  const apply = (next: Transform, animateMs = 0) => {
    const t = clampTransform(next)
    transformRef.current = t
    const layer = layerRef.current
    if (layer) {
      layer.style.transition = animateMs > 0 ? `transform ${animateMs}ms ${EASE}` : 'none'
      layer.style.transform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale})`
    }
    // Counter-scale the flag label so it stays readable at any zoom level.
    if (labelRef.current) {
      labelRef.current.style.transform = `scale(${1 / t.scale})`
    }
  }

  const resetView = () => apply({ scale: 1, x: 0, y: 0 }, reduceRef.current ? 0 : 300)

  const centerZone = (zone: ZoneInfo) => {
    setActiveZone(zone.key)
    if (!zone.rect) return
    const { w, h, box: b } = metrics()
    const cx = b.left + ((zone.rect.x + zone.rect.w / 2) / 100) * b.width
    const cy = b.top + ((zone.rect.y + zone.rect.h / 2) / 100) * b.height
    apply(
      {
        scale: CENTER_SCALE,
        x: w / 2 - cx * CENTER_SCALE,
        y: h / 2 - cy * CENTER_SCALE,
      },
      reduceRef.current ? 0 : 300,
    )
  }

  // Compute the image box once mounted (viewport has real size by then) and
  // keep it in sync on viewport resize / orientation change.
  useEffect(() => {
    const sync = () => {
      setBox(metrics().box)
      apply(transformRef.current) // re-clamp against the new viewport size
    }
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Native gesture handling (pan / pinch / double-tap / inertia). Native
  // listeners are required so pointerdown stopPropagation reaches the overlay
  // panel's drag listener before it can start.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const toLocal = (e: PointerEvent): Point => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

    const onDown = (e: PointerEvent) => {
      e.stopPropagation() // keep the overlay panel's drag-to-close out of map gestures
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* pointer already released */
      }
      const p = toLocal(e)
      pointersRef.current.set(e.pointerId, p)

      const now = performance.now()
      if (pointersRef.current.size === 1) {
        if (now - lastTapRef.current <= DOUBLE_TAP_MS) {
          // Double-tap / double-click → spring back to the overview.
          lastTapRef.current = 0
          pointersRef.current.clear()
          gestureRef.current = null
          samplesRef.current = []
          resetView()
          return
        }
        lastTapRef.current = now
        gestureRef.current = {
          mode: 'pan',
          startDist: 0,
          startMid: p,
          startPointer: p,
          startTransform: { ...transformRef.current },
        }
        samplesRef.current = [{ t: now, x: p.x, y: p.y }]
      } else if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()]
        gestureRef.current = {
          mode: 'pinch',
          startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          startMid: midpoint(a, b),
          startPointer: p,
          startTransform: { ...transformRef.current },
        }
        samplesRef.current = []
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!pointersRef.current.has(e.pointerId)) return
      e.stopPropagation()
      const p = toLocal(e)
      pointersRef.current.set(e.pointerId, p)
      const g = gestureRef.current
      if (!g) return

      if (g.mode === 'pinch' && pointersRef.current.size >= 2) {
        const [a, b] = [...pointersRef.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const mid = midpoint(a, b)
        const scale = g.startTransform.scale * (dist / g.startDist)
        // Zoom around the pinch midpoint: keep the content point that was
        // under the starting midpoint pinned beneath the current midpoint.
        const cx = (g.startMid.x - g.startTransform.x) / g.startTransform.scale
        const cy = (g.startMid.y - g.startTransform.y) / g.startTransform.scale
        apply({ scale, x: mid.x - cx * scale, y: mid.y - cy * scale })
      } else if (g.mode === 'pan' && pointersRef.current.size === 1) {
        apply({
          scale: g.startTransform.scale,
          x: g.startTransform.x + (p.x - g.startPointer.x),
          y: g.startTransform.y + (p.y - g.startPointer.y),
        })
        const now = performance.now()
        samplesRef.current.push({ t: now, x: p.x, y: p.y })
        // keep only the last ~120ms of samples for velocity
        while (samplesRef.current.length > 2 && now - samplesRef.current[0].t > 120) {
          samplesRef.current.shift()
        }
      }
    }

    const onUp = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId)
      const g = gestureRef.current
      if (!g) return

      if (pointersRef.current.size === 1) {
        // Pinch → pan transition: re-anchor the remaining finger.
        const rest = [...pointersRef.current.values()][0]
        gestureRef.current = {
          mode: 'pan',
          startDist: 0,
          startMid: rest,
          startPointer: rest,
          startTransform: { ...transformRef.current },
        }
        samplesRef.current = [{ t: performance.now(), x: rest.x, y: rest.y }]
        return
      }

      if (pointersRef.current.size === 0) {
        gestureRef.current = null
        if (g.mode === 'pan') {
          // A real drag must not count as the first half of a double-tap.
          const up = toLocal(e)
          if (Math.hypot(up.x - g.startPointer.x, up.y - g.startPointer.y) > 12) {
            lastTapRef.current = 0
          }
          // Release inertia: fling velocity carries the pan ~180ms further.
          const s = samplesRef.current
          samplesRef.current = []
          if (s.length >= 2) {
            const first = s[0]
            const last = s[s.length - 1]
            const dt = last.t - first.t
            if (dt > 0) {
              const vx = (last.x - first.x) / dt
              const vy = (last.y - first.y) / dt
              if (Math.hypot(vx, vy) > 0.45 && !reduceRef.current) {
                const t = transformRef.current
                apply(
                  { scale: t.scale, x: t.x + vx * 180, y: t.y + vy * 180 },
                  INERTIA_MS,
                )
              }
            }
          }
        }
      }
    }

    const stopOnly = (e: Event) => e.stopPropagation()
    const prevent = (e: Event) => e.preventDefault()

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    // iOS Safari pinch gesture events would zoom the whole page — suppress.
    el.addEventListener('gesturestart', prevent)
    el.addEventListener('gesturechange', prevent)
    // Belt-and-braces alongside `touch-action: none` for older WebKit.
    el.addEventListener('touchmove', prevent, { passive: false })

    const list = listRef.current
    // List taps/scrolls must not trigger the panel's drag-to-close either.
    list?.addEventListener('pointerdown', stopOnly)

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('gesturestart', prevent)
      el.removeEventListener('gesturechange', prevent)
      el.removeEventListener('touchmove', prevent)
      list?.removeEventListener('pointerdown', stopOnly)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      aspectRef.current = img.naturalWidth / img.naturalHeight
      setBox(metrics().box)
      apply(transformRef.current)
    }
    setImgLoaded(true)
  }

  return (
    <>
      {/* map viewport ~62% */}
      <div
        ref={viewportRef}
        className="relative min-h-0 flex-[62] touch-none select-none overflow-hidden bg-[#FAFAF8]"
        role="application"
        aria-label="场地分区图，双指缩放，双击复位"
      >
        {!imgLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--ink-3)]">
            <Icon name="zoom-in" size={24} />
            <span className="skeleton h-4 w-32 rounded" />
            <span className="text-caption">地图加载中…</span>
          </div>
        )}
        <div
          ref={layerRef}
          className="absolute inset-0 will-change-transform"
          style={{ transformOrigin: '0 0' }}
        >
          {box && (
            <div
              className="absolute"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            >
              <img
                src={venueMap.image}
                alt="场地分区平面图"
                onLoad={onImageLoad}
                onError={() => setImgLoaded(true)}
                className="h-full w-full select-none"
                style={{ WebkitTouchCallout: 'none' }}
                draggable={false}
              />
              {userRect && (
                <div
                  className="map-zone-pulse pointer-events-none absolute rounded-md border-[2.5px] border-[var(--danger)]"
                  style={{
                    left: `${userRect.x}%`,
                    top: `${userRect.y}%`,
                    width: `${userRect.w}%`,
                    height: `${userRect.h}%`,
                  }}
                >
                  <span
                    ref={labelRef}
                    className="absolute -top-6 left-0 whitespace-nowrap rounded bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white"
                    style={{ transformOrigin: 'left bottom' }}
                  >
                    您在这里 · {venueMap.userZone}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-white">
          双指缩放 · 双击复位
        </div>
      </div>

      {/* zone list ~38% */}
      <div
        ref={listRef}
        className="min-h-0 flex-[38] overflow-y-auto overscroll-contain border-t border-[var(--line)] px-4 py-2"
        role="list"
        aria-label="分区列表"
      >
        {venueMap.zones.map((z) => {
          const isUser = z.key === userZoneKey
          const isActive = z.key === activeZone
          return (
            <button
              key={z.key}
              type="button"
              role="listitem"
              aria-pressed={isActive}
              aria-label={`定位到${z.name}`}
              onClick={() => centerZone(z)}
              className={cn(
                'relative flex min-h-[52px] w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                isUser && 'bg-[var(--theme-soft)]',
                !isUser && isActive && 'bg-[var(--bg-page)]',
              )}
            >
              {isUser && (
                <span className="absolute left-0 top-2 h-[calc(100%-16px)] w-[3px] rounded-full bg-[var(--theme-primary)]" />
              )}
              <PillTag
                variant={isUser ? 'solid' : 'soft'}
                style={isUser ? undefined : { background: '#F1F2F5', color: 'var(--ink-2)' }}
              >
                {z.key}
              </PillTag>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'text-body font-bold',
                    isUser ? 'text-[var(--theme-primary)]' : 'text-[var(--ink-1)]',
                  )}
                >
                  {z.name}
                </div>
                <div className="truncate text-caption text-[var(--ink-3)]">{z.desc}</div>
              </div>
              {isActive && z.rect && (
                <Icon
                  name="map-pin"
                  size={14}
                  className={cn(
                    'shrink-0',
                    isUser ? 'text-[var(--theme-primary)]' : 'text-[var(--ink-3)]',
                  )}
                />
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
