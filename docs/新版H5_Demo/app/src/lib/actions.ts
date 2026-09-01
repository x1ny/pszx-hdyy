import type { GeoPoint } from '@/types/itinerary'

/**
 * Platform action helpers: map navigation, tel dialing, clipboard,
 * WeChat detection.
 * Targets: iOS Safari 14+, WeChat webview, Chrome Android.
 */

/* ------------------------------------------------------------------ */
/* Environment detection                                               */
/* ------------------------------------------------------------------ */

export function isWeChat(): boolean {
  if (typeof navigator === 'undefined') return false
  return /MicroMessenger/i.test(navigator.userAgent)
}

/* ------------------------------------------------------------------ */
/* Map navigation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Amap universal link. With `callnative=1` the link auto-launches the Amap
 * app when installed and gracefully falls back to the Amap web page (which
 * itself offers Baidu/Tencent jumps) when it is not. WeChat's webview blocks
 * app-launch schemes, so inside WeChat we go straight to the web version
 * (`callnative=0`) to avoid a broken intermediate page.
 */
export function buildNavUrl(geo: GeoPoint): string {
  const name = encodeURIComponent(geo.name)
  const callnative = isWeChat() ? 0 : 1
  return `https://uri.amap.com/marker?position=${geo.lng},${geo.lat}&name=${name}&src=itinerary-h5&callnative=${callnative}`
}

/**
 * `geo` is the navigation switch: the affordance renders only when the
 * backend supplied coordinates, and dirty payloads (missing/non-finite/
 * 0,0/out-of-range) are rejected here so a bad row degrades to "no nav
 * button" instead of a broken map jump.
 */
export function isNavigable(geo?: GeoPoint | null): geo is GeoPoint {
  if (!geo) return false
  const { lat, lng } = geo
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat === 0 && lng === 0) return false
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

/**
 * Open the map for a location. Primary path: Amap universal link in a new
 * tab. If the popup is blocked (returns null) or window.open throws, fall
 * back to in-place navigation so the user never hits a dead end.
 */
export function openNavigation(geo: GeoPoint): void {
  const url = buildNavUrl(geo)
  try {
    const win = window.open(url, '_blank', 'noopener')
    if (!win) window.location.assign(url)
  } catch {
    window.location.assign(url)
  }
}

/* ------------------------------------------------------------------ */
/* Phone dialing                                                       */
/* ------------------------------------------------------------------ */

/** Normalize a phone number into a tel: href (strips spaces and dashes). */
export function buildTelHref(phone: string): string {
  return `tel:${phone.replace(/[\s-]/g, '')}`
}

/* ------------------------------------------------------------------ */
/* Clipboard                                                           */
/* ------------------------------------------------------------------ */

/** Copy text; Clipboard API first, execCommand fallback for old webviews. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Legacy fallback for non-secure contexts / older webviews.
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
