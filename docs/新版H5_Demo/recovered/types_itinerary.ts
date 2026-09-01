/**
 * JSON contract for `GET /api/itinerary?k={token}` (design.md §10).
 *
 * Envelope: `{ code: number, data?: ItineraryData, message?: string }`
 * - `code === 0`   → `data` present.
 * - `code === 404` → token invalid/expired → full-screen empty state.
 *
 * Front-end guarantees (applied in `src/lib/itinerary-api.ts`, so
 * components can trust what they receive):
 * - `agenda` sorted by `start`, `transfers` sorted by `sortTime`.
 * - malformed entries are dropped, missing optional fields omitted.
 * - `AgendaItem.status` is recomputed from the local clock when "today" is
 *   the event day (front-end fallback), otherwise the server value wins.
 */

export interface GeoPoint {
  lat: number
  lng: number
  /** Display name passed to the map app (高德 universal link). */
  name: string
}

export interface EventIcs {
  /** Local time, format `yyyyMMddTHHmmss`. */
  start: string
  end: string
  /** VALARM reminder, minutes before start. */
  alarm: number
}

export interface EventInfo {
  /** Max 2 lines in the hero (`line-clamp: 2`). */
  title: string
  /** e.g. "2025年6月18日 周三" */
  dateText: string
  /** e.g. "09:00–17:30" (rendered in Manrope 800). */
  timeRange: string
  city: string
  venue: string
  venueGeo: GeoPoint
  /** 1–2 lines clamped, expandable to 3. */
  intro: string
  /** Hero image URL (theme-swap point, alongside CSS theme vars). */
  heroImage: string
  ics: EventIcs
}

export type AgendaStatus = 'upcoming' | 'ongoing' | 'finished'

export interface AgendaItem {
  id: string
  /** "HH:mm" — primary sort key. */
  start: string
  /** "HH:mm" */
  end: string
  title: string
  venue: string
  /** When present, the venue row becomes a map-navigation action. */
  geo?: GeoPoint
  zone?: string
  /** Seat/admission note, e.g. "12排08座" / "凭胸卡入场". */
  seat?: string
  status: AgendaStatus
}

export type TransferType = 'rail' | 'air' | 'car'

export interface TransferBase {
  type: TransferType
  /** Sort key, format `yyyyMMddTHHmmss`. */
  sortTime: string
}

export interface RailTransfer extends TransferBase {
  type: 'rail'
  no: string
  depTime: string
  arrTime: string
  depStation: string
  arrStation: string
  seat?: string
  gate?: string
}

export interface AirTransfer extends TransferBase {
  type: 'air'
  no: string
  depTime: string
  arrTime: string
  depStation: string
  arrStation: string
  seat?: string
  gate?: string
}

export interface CarTransfer extends TransferBase {
  type: 'car'
  title: string
  useTime: string
  plate: string
  driver: string
  /** Rendered as a `tel:` chip. */
  phone: string
  meetPoint: string
  geo?: GeoPoint
}

export type Transfer = RailTransfer | AirTransfer | CarTransfer

export interface ZoneInfo {
  key: string
  name: string
  desc: string
  /** Highlight rect in percent of the map image (`userZoneRect`). */
  rect?: { x: number; y: number; w: number; h: number }
}

export interface VenueMapInfo {
  /** Loaded lazily — only when the map overlay opens. */
  image: string
  /** Matches a `ZoneInfo.key` suffix, e.g. "A区". */
  userZone: string
  zones: ZoneInfo[]
}

export interface ItineraryData {
  user: { name: string; greeting: string }
  event: EventInfo
  agenda: AgendaItem[]
  /** Missing transfer types are simply not rendered (backwards compatible). */
  transfers: Transfer[]
  venueMap: VenueMapInfo
}

export interface ItineraryResponse {
  code: number
  data?: ItineraryData
  message?: string
}
