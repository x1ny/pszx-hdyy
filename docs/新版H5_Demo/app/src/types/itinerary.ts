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

export interface EventDetails {
  /** Full introduction paragraphs. */
  paragraphs: string[]
  /**
   * Organizer units in display order (主办 / 承办 / 支持 / 指导 …).
   * Entries with an empty `role` or `name` are dropped during
   * normalization, so the UI never renders a blank unit card.
   */
  organizers: { role: string; name: string }[]
}

export interface StaffContact {
  name: string
  /** Rendered as a `tel:` chip. */
  phone: string
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
  /** 1–2 lines clamped in the hero; full copy lives in `details`. */
  intro: string
  /** Optional long-form event detail, shown in the 活动详情 overlay. */
  details?: EventDetails
  /** On-site staff contact — guests tap to call when they have questions.
      Rendered as a compact card in the hero (first screen, no scrolling). */
  contact?: StaffContact
  /** Hero image URL (theme-swap point, alongside CSS theme vars). */
  heroImage: string
  ics: EventIcs
}

export type AgendaStatus = 'upcoming' | 'ongoing' | 'finished'

export interface AgendaItem {
  id: string
  /** "YYYY-MM-DD" — multi-day grouping key (day pills in the agenda tab). */
  date: string
  /** "HH:mm" — within-day sort key. */
  start: string
  /** "HH:mm" */
  end: string
  title: string
  venue: string
  /** When present AND valid (see `isNavigable`), the venue row shows a
      map-navigation button. Sub-locations inside the main venue should
      omit it — walking there needs no map. */
  geo?: GeoPoint
  zone?: string
  /** Seat/admission note, e.g. "12排08座" / "凭胸卡入场". */
  seat?: string
  /** Bound car transfer id — rendered as a collapsible 用车安排 block
      under this session in the agenda timeline. */
  carId?: string
  /** Optional per-session remark for guest action items, e.g. "需上台发言"
      / "建议更换运动服装" — rendered as an attention block under the
      session. Absent/empty → not rendered. */
  note?: string
  status: AgendaStatus
}

export type TransferType = 'rail' | 'air' | 'car'

export interface TransferBase {
  /** Referenced by `AgendaItem.carId` for car transfers. */
  id: string
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
  /** Estimated ride duration in minutes — rendered as "路程预计 N 分钟".
      Absent/zero → not rendered. */
  durationMin?: number
  geo?: GeoPoint
}

export type Transfer = RailTransfer | AirTransfer | CarTransfer

export interface ZoneInfo {
  key: string
  name: string
  desc: string
}

export interface VenueMapInfo {
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
