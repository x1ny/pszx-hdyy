import type {
  AgendaItem,
  AgendaStatus,
  ItineraryData,
  ItineraryResponse,
  Transfer,
} from '@/types/itinerary'

/**
 * Async data seam for the itinerary page.
 *
 * Contract: `GET /api/itinerary?k={token}` → `{ code, data, message? }`
 * (see design.md §10). The raw payload is untrusted: `normalizeItinerary`
 * validates the envelope, drops malformed entries, guarantees sort order
 * (agenda by `start`, transfers by `sortTime`) and derives agenda status
 * from the current clock as a front-end fallback.
 *
 * Runtime modes:
 * - `VITE_ITINERARY_API` set  → real fetch against that endpoint.
 * - unset (default demo)      → built-in mock payload after realistic
 *   latency so the skeleton state is exercised. `?k=invalid` (or the HTTP
 *   404 equivalent) surfaces the full-screen invalid-link state.
 *
 * `Home` consumes: `fetchItinerary`, `getToken`, `ItineraryError`
 * (`err.code === 404` → invalid phase; anything else → error phase).
 */

const MOCK_LATENCY_MIN = 450
const MOCK_LATENCY_RANGE = 450

/** Endpoint override; unset → mock mode. e.g. VITE_ITINERARY_API=/api/itinerary */
const API_ENDPOINT: string | undefined =
  typeof import.meta.env.VITE_ITINERARY_API === 'string' &&
  import.meta.env.VITE_ITINERARY_API.length > 0
    ? import.meta.env.VITE_ITINERARY_API
    : undefined

/** Business error: `code` mirrors the API envelope (`404` = invalid token). */
export class ItineraryError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.name = 'ItineraryError'
    this.code = code
  }
}

/** Token from `?k=` query param ('' when absent / non-browser). */
export function getToken(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('k') ?? ''
}

export async function fetchItinerary(token: string): Promise<ItineraryData> {
  const raw = API_ENDPOINT ? await requestRemote(API_ENDPOINT, token) : await requestMock(token)
  return normalizeItinerary(raw)
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

async function requestRemote(endpoint: string, token: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${endpoint}?k=${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new ItineraryError(-1, '网络开小差了')
  }
  if (res.status === 404) throw new ItineraryError(404, '链接无效或已过期')
  if (!res.ok) throw new ItineraryError(res.status, '网络开小差了')
  try {
    return (await res.json()) as unknown
  } catch {
    throw new ItineraryError(-2, '网络开小差了')
  }
}

async function requestMock(token: string): Promise<ItineraryResponse> {
  // Realistic jittered latency so the skeleton shimmer is exercised.
  await new Promise((r) =>
    setTimeout(r, MOCK_LATENCY_MIN + Math.random() * MOCK_LATENCY_RANGE),
  )
  // Demo token handling: `?k=invalid` → full-screen invalid-link state.
  if (token === 'invalid') {
    return { code: 404, message: '链接无效或已过期' }
  }
  // Deep copy so callers can mutate safely (structuredClone is baseline
  // for our iOS 14+ / modern WebView targets).
  return { code: 0, data: structuredClone(MOCK_DATA) }
}

/* ------------------------------------------------------------------ */
/* Parsing / normalization (robust against partial or dirty payloads)  */
/* ------------------------------------------------------------------ */

type Record_ = Record<string, unknown>

const isRecord = (v: unknown): v is Record_ => typeof v === 'object' && v !== null
const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback
const asNumber = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const TIME_RE = /^\d{2}:\d{2}$/
const isTime = (v: unknown): v is string => typeof v === 'string' && TIME_RE.test(v)

const VALID_STATUS: readonly AgendaStatus[] = ['upcoming', 'ongoing', 'finished']

function normalizeItinerary(raw: unknown): ItineraryData {
  if (!isRecord(raw)) throw new ItineraryError(-2, '网络开小差了')
  if (raw.code !== 0) {
    const code = typeof raw.code === 'number' ? raw.code : -2
    throw new ItineraryError(code, asString(raw.message, '链接无效或已过期'))
  }

  const data = raw.data
  if (!isRecord(data) || !isRecord(data.user) || !isRecord(data.event)) {
    throw new ItineraryError(-2, '网络开小差了')
  }
  const eventRaw = data.event
  if (asString(eventRaw.title) === '' || asString(eventRaw.dateText) === '') {
    throw new ItineraryError(-2, '网络开小差了')
  }

  // Event day (yyyyMMdd) anchors the front-end status fallback.
  const icsRaw = isRecord(eventRaw.ics) ? eventRaw.ics : {}
  const icsStart = asString(icsRaw.start)
  const eventDay = /^\d{8}/.test(icsStart) ? icsStart.slice(0, 8) : ''

  const agenda: AgendaItem[] = (Array.isArray(data.agenda) ? data.agenda : [])
    .map((item, i): AgendaItem | null => {
      if (!isRecord(item) || !isTime(item.start) || !isTime(item.end)) return null
      const title = asString(item.title)
      if (!title) return null
      return {
        id: asString(item.id, `agenda-${i}`),
        start: item.start,
        end: item.end,
        title,
        venue: asString(item.venue),
        ...(isRecord(item.geo) ? { geo: normalizeGeo(item.geo) } : {}),
        ...(asString(item.zone) ? { zone: asString(item.zone) } : {}),
        ...(asString(item.seat) ? { seat: asString(item.seat) } : {}),
        status: deriveStatus(eventDay, item.start, item.end, item.status),
      }
    })
    .filter((x): x is AgendaItem => x !== null)
    .sort((a, b) => a.start.localeCompare(b.start))

  const transfers: Transfer[] = (Array.isArray(data.transfers) ? data.transfers : [])
    .map((item): Transfer | null => {
      if (!isRecord(item)) return null
      const base = { sortTime: asString(item.sortTime) }
      if (item.type === 'rail' || item.type === 'air') {
        return {
          type: item.type,
          no: asString(item.no),
          depTime: asString(item.depTime),
          arrTime: asString(item.arrTime),
          depStation: asString(item.depStation),
          arrStation: asString(item.arrStation),
          ...(asString(item.seat) ? { seat: asString(item.seat) } : {}),
          ...(asString(item.gate) ? { gate: asString(item.gate) } : {}),
          ...base,
        }
      }
      if (item.type === 'car') {
        return {
          type: 'car',
          title: asString(item.title, '活动用车'),
          useTime: asString(item.useTime),
          plate: asString(item.plate),
          driver: asString(item.driver),
          phone: asString(item.phone),
          meetPoint: asString(item.meetPoint),
          ...(isRecord(item.geo) ? { geo: normalizeGeo(item.geo) } : {}),
          ...base,
        }
      }
      return null // unknown transfer type → skip (forwards-compatible)
    })
    .filter((x): x is Transfer => x !== null)
    .sort((a, b) => a.sortTime.localeCompare(b.sortTime))

  const mapRaw = isRecord(data.venueMap) ? data.venueMap : {}
  const venueMap = {
    image: asString(mapRaw.image, '/venue-map.png'),
    userZone: asString(mapRaw.userZone),
    zones: (Array.isArray(mapRaw.zones) ? mapRaw.zones : [])
      .map((z) => {
        if (!isRecord(z)) return null
        const rect = isRecord(z.rect)
          ? {
              x: asNumber(z.rect.x),
              y: asNumber(z.rect.y),
              w: asNumber(z.rect.w),
              h: asNumber(z.rect.h),
            }
          : undefined
        return {
          key: asString(z.key),
          name: asString(z.name),
          desc: asString(z.desc),
          ...(rect ? { rect } : {}),
        }
      })
      .filter((z): z is NonNullable<typeof z> => z !== null && z.key !== ''),
  }

  return {
    user: {
      name: asString(data.user.name, '嘉宾'),
      greeting: asString(data.user.greeting, '专属行程'),
    },
    event: {
      title: asString(eventRaw.title),
      dateText: asString(eventRaw.dateText),
      timeRange: asString(eventRaw.timeRange),
      city: asString(eventRaw.city),
      venue: asString(eventRaw.venue),
      venueGeo: normalizeGeo(isRecord(eventRaw.venueGeo) ? eventRaw.venueGeo : {}),
      intro: asString(eventRaw.intro),
      heroImage: asString(eventRaw.heroImage, '/hero-quanzhou.png'),
      ics: {
        start: icsStart,
        end: asString(icsRaw.end),
        alarm: asNumber(icsRaw.alarm, 30),
      },
    },
    agenda,
    transfers,
    venueMap,
  }
}

function normalizeGeo(raw: Record_) {
  return {
    lat: asNumber(raw.lat),
    lng: asNumber(raw.lng),
    name: asString(raw.name),
  }
}

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

const yyyymmdd = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

/**
 * Front-end status fallback (design.md §10: 前端也按当前时间兜底计算).
 * - When today IS the event day, the clock wins over the server value.
 * - Otherwise (previewing before/after the event) trust the server status,
 *   defaulting invalid/missing values to 'upcoming'.
 */
function deriveStatus(
  eventDay: string,
  start: string,
  end: string,
  server: unknown,
): AgendaStatus {
  const fallback = VALID_STATUS.includes(server as AgendaStatus)
    ? (server as AgendaStatus)
    : 'upcoming'
  if (!eventDay || yyyymmdd(new Date()) !== eventDay) return fallback
  const cur = new Date().getHours() * 60 + new Date().getMinutes()
  if (cur < toMinutes(start)) return 'upcoming'
  if (cur >= toMinutes(end)) return 'finished'
  return 'ongoing'
}

/* ------------------------------------------------------------------ */
/* Demo payload (mirrors design.md §10 contract; replace via endpoint) */
/* ------------------------------------------------------------------ */

const MOCK_DATA: ItineraryData = {
  user: { name: '陈默', greeting: '专属行程' },
  event: {
    title: '2025 海丝国际时尚周 · 开幕式暨品牌发布盛典',
    dateText: '2025年6月18日 周三',
    timeRange: '09:00–17:30',
    city: '泉州',
    venue: '海峡体育中心 · 体育馆',
    venueGeo: { lat: 24.943, lng: 118.675, name: '泉州海峡体育中心' },
    intro:
      '以海上丝绸之路起点泉州为舞台，汇聚 40+ 设计师品牌与买手，呈现开幕大秀、趋势论坛与产业对接。刺桐花开，潮起东方，请按下方议程与行程准时出席，共同见证年度时尚盛事。',
    heroImage: '/hero-quanzhou.png',
    ics: { start: '20250618T090000', end: '20250618T173000', alarm: 30 },
  },
  agenda: [
    {
      id: 'a1',
      start: '09:00',
      end: '10:30',
      title: '开幕式暨主旨论坛',
      venue: '主体育馆 · 主舞台',
      geo: { lat: 24.943, lng: 118.675, name: '泉州海峡体育中心' },
      zone: 'A区',
      seat: '12排08座',
      status: 'ongoing',
    },
    {
      id: 'a2',
      start: '10:45',
      end: '12:00',
      title: '品牌联合发布会',
      venue: '主展馆 B厅',
      geo: { lat: 24.943, lng: 118.675, name: '泉州海峡体育中心主展馆' },
      zone: 'B区',
      seat: '3排05座',
      status: 'upcoming',
    },
    {
      id: 'a3',
      start: '12:00',
      end: '13:30',
      title: '午间休息 · 自助午餐',
      venue: '二层宴会厅',
      geo: { lat: 24.943, lng: 118.675, name: '泉州海峡体育中心宴会厅' },
      seat: '凭胸卡入场',
      status: 'upcoming',
    },
    {
      id: 'a4',
      start: '14:00',
      end: '16:00',
      title: '海丝时尚趋势工作坊',
      venue: '二层论坛厅 2',
      geo: { lat: 24.943, lng: 118.675, name: '泉州海峡体育中心论坛厅' },
      zone: 'C区',
      seat: '6排11座',
      status: 'upcoming',
    },
    {
      id: 'a5',
      start: '16:15',
      end: '17:30',
      title: '闭幕酒会 · 自由交流',
      venue: '户外刺桐广场',
      geo: { lat: 24.9435, lng: 118.6755, name: '泉州海峡体育中心刺桐广场' },
      seat: '自由站位',
      status: 'upcoming',
    },
  ],
  transfers: [
    {
      type: 'air',
      no: 'MF8501',
      depTime: '07:10',
      arrTime: '09:55',
      depStation: '北京首都 T2',
      arrStation: '泉州晋江国际机场',
      seat: '经济舱 32C',
      gate: '登机口 B12',
      sortTime: '20250618T071000',
    },
    {
      type: 'rail',
      no: 'D3212',
      depTime: '08:02',
      arrTime: '08:31',
      depStation: '厦门北站',
      arrStation: '泉州站',
      seat: '二等座 05车08A',
      gate: '检票口 3A',
      sortTime: '20250618T080200',
    },
    {
      type: 'car',
      title: '活动接驳专车',
      useTime: '08:50 发车',
      plate: '闽C·D8866',
      driver: '王师傅',
      phone: '13806051234',
      meetPoint: '泉州站南广场 大巴停靠区',
      geo: { lat: 24.953, lng: 118.631, name: '泉州站南广场' },
      sortTime: '20250618T085000',
    },
  ],
  venueMap: {
    image: '/venue-map.png',
    userZone: 'A区',
    zones: [
      {
        key: 'A',
        name: 'A区 · 贵宾观礼区',
        desc: '正对主舞台前排，开幕式与发布会指定坐席',
        rect: { x: 14.3, y: 15, w: 34.3, h: 33.3 },
      },
      {
        key: 'B',
        name: 'B区 · 品牌发布区',
        desc: '主展馆B厅坐席，临近品牌静态展',
        rect: { x: 50.8, y: 15, w: 35, h: 33.3 },
      },
      {
        key: 'C',
        name: 'C区 · 论坛工作区',
        desc: '二层论坛厅，工作坊与媒体采访区',
        rect: { x: 14.3, y: 49.7, w: 34.3, h: 27.3 },
      },
      {
        key: 'D',
        name: 'D区 · 公共观礼区',
        desc: '阶梯坐席，自由出入',
        rect: { x: 50.8, y: 49.7, w: 35, h: 27.3 },
      },
    ],
  },
}
