import type {
  AgendaItem,
  AgendaStatus,
  EventDetails,
  ItineraryData,
  ItineraryResponse,
  StaffContact,
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
      // Multi-day contract: each item carries its own day; items missing
      // `date` fall back to the event's first day (ics start).
      const date = asString(item.date, isoFromCompact(eventDay))
      return {
        id: asString(item.id, `agenda-${i}`),
        date,
        start: item.start,
        end: item.end,
        title,
        venue: asString(item.venue),
        ...(isRecord(item.geo) ? { geo: normalizeGeo(item.geo) } : {}),
        ...(asString(item.zone) ? { zone: asString(item.zone) } : {}),
        ...(asString(item.seat) ? { seat: asString(item.seat) } : {}),
        ...(asString(item.carId) ? { carId: asString(item.carId) } : {}),
        ...(asString(item.note) ? { note: asString(item.note) } : {}),
        status: deriveStatus(date, item.start, item.end, item.status),
      }
    })
    .filter((x): x is AgendaItem => x !== null)
    .sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`))

  const transfers: Transfer[] = (Array.isArray(data.transfers) ? data.transfers : [])
    .map((item): Transfer | null => {
      if (!isRecord(item)) return null
      const base = {
        id: asString(item.id, `${asString(item.type, 't')}-${asString(item.sortTime)}`),
        sortTime: asString(item.sortTime),
      }
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
          ...(asNumber(item.durationMin) > 0 ? { durationMin: asNumber(item.durationMin) } : {}),
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
    userZone: asString(mapRaw.userZone),
    zones: (Array.isArray(mapRaw.zones) ? mapRaw.zones : [])
      .map((z) => {
        if (!isRecord(z)) return null
        return {
          key: asString(z.key),
          name: asString(z.name),
          desc: asString(z.desc),
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
      details: normalizeEventDetails(eventRaw.details),
      ...normalizeContact(eventRaw.contact),
      heroImage: asString(eventRaw.heroImage, '/hero-quanzhou.jpg'),
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

/** Long-form event detail is optional — absent means the hero keeps the
 *  short intro only and no 查看详情 affordance is rendered. */
function normalizeEventDetails(raw: unknown): EventDetails | undefined {
  if (!isRecord(raw)) return undefined
  const paragraphs = Array.isArray(raw.paragraphs)
    ? raw.paragraphs.map((p) => asString(p)).filter(Boolean)
    : []
  // Empty unit values are dropped here so a missing 支持单位 etc. simply
  // never reaches the UI; the grid reflows around the remaining cards.
  const organizers = Array.isArray(raw.organizers)
    ? raw.organizers
        .filter(isRecord)
        .map((o) => ({ role: asString(o.role), name: asString(o.name) }))
        .filter((o) => o.role !== '' && o.name !== '')
    : []
  if (paragraphs.length === 0 && organizers.length === 0) return undefined
  return { paragraphs, organizers }
}

/** Staff contact is optional; a payload with neither name nor phone is
 *  treated as absent so no empty contact card renders. */
function normalizeContact(raw: unknown): { contact?: StaffContact } {
  if (!isRecord(raw)) return {}
  const name = asString(raw.name)
  const phone = asString(raw.phone)
  if (!name && !phone) return {}
  return { contact: { name, phone } }
}

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

const yyyymmdd = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

/** '20250618' → '2025-06-18' ('' passes through). */
const isoFromCompact = (compact: string): string =>
  /^\d{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : ''

/**
 * Front-end status fallback (design.md §10: 前端也按当前时间兜底计算).
 * - When today IS the item's own day (multi-day aware), the clock wins
 *   over the server value.
 * - Otherwise (previewing before/after that day) trust the server status,
 *   defaulting invalid/missing values to 'upcoming'.
 */
function deriveStatus(
  itemDate: string,
  start: string,
  end: string,
  server: unknown,
): AgendaStatus {
  const fallback = VALID_STATUS.includes(server as AgendaStatus)
    ? (server as AgendaStatus)
    : 'upcoming'
  const itemDay = itemDate.replace(/-/g, '')
  if (!itemDay || yyyymmdd(new Date()) !== itemDay) return fallback
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
    dateText: '2025年6月18日–20日 · 共3天',
    timeRange: '09:00–17:30',
    city: '泉州',
    venue: '海峡体育中心 · 体育馆',
    venueGeo: { lat: 24.943, lng: 118.675, name: '泉州海峡体育中心' },
    intro:
      '以海上丝绸之路起点泉州为舞台，汇聚 40+ 设计师品牌与买手，呈现开幕大秀、趋势论坛与产业对接。刺桐花开，潮起东方，请按下方议程与行程准时出席，共同见证年度时尚盛事。',
    details: {
      paragraphs: [
        '海丝国际时尚周创办于 2019 年，是扎根海上丝绸之路起点泉州、辐射海峡两岸的年度时尚产业盛会。2025 年适逢第七届，以「潮起东方」为主题，联动泉州纺织鞋服产业集群，打造集品牌发布、趋势研讨与商贸对接于一体的开放平台。',
        '本届开幕式暨品牌发布盛典汇聚 40 余个设计师品牌与海内外买手，现场呈现开幕大秀、品牌静态展与海丝时尚趋势论坛；傍晚的闭幕酒会移步户外刺桐广场，邀您在千年刺桐花开的城市意象中自由交流、共话合作。',
      ],
      organizers: [
        { role: '主办单位', name: '泉州时尚周组委会' },
        { role: '承办单位', name: '时尚周活动运营中心' },
        { role: '支持单位', name: '泉州市服装设计协会' },
        { role: '指导单位', name: '泉州市商务局' },
      ],
    },
    contact: { name: '林晓彤', phone: '13605950011' },
    heroImage: '/hero-quanzhou.jpg',
    ics: { start: '20250618T090000', end: '20250620T130000', alarm: 30 },
  },
  /* Multi-day demo (3 days). Navigation policy in action: only items whose
     venue is a real destination carry `geo` — Day 1 opening (attendee may
     self-drive to the venue) and the Day 2 off-site 西街 night tour. All
     in-venue rooms (主展馆/宴会厅/论坛厅) omit `geo`, so no nav button. */
  agenda: [
    // ---- Day 1 · 6.18 周三 ----
    {
      id: 'a1',
      date: '2025-06-18',
      start: '09:00',
      end: '10:30',
      title: '开幕式暨主旨论坛',
      venue: '主体育馆 · 主舞台',
      geo: { lat: 24.943, lng: 118.675, name: '泉州海峡体育中心' },
      zone: 'A区',
      seat: '12排08座',
      carId: 'car-shuttle',
      status: 'finished',
    },
    {
      id: 'a2',
      date: '2025-06-18',
      start: '10:45',
      end: '12:00',
      title: '品牌联合发布会',
      venue: '主展馆 B厅',
      zone: 'B区',
      seat: '3排05座',
      status: 'finished',
    },
    {
      id: 'a3',
      date: '2025-06-18',
      start: '12:00',
      end: '13:30',
      title: '午间休息 · 自助午餐',
      venue: '二层宴会厅',
      status: 'finished',
    },
    {
      id: 'a4',
      date: '2025-06-18',
      start: '14:00',
      end: '16:00',
      title: '海丝时尚趋势工作坊',
      venue: '二层论坛厅 2',
      zone: 'C区',
      seat: '6排11座',
      note: '含面料体验环节，建议穿着轻便运动服装',
      status: 'finished',
    },
    // ---- Day 2 · 6.19 周四 ----
    {
      id: 'b1',
      date: '2025-06-19',
      start: '09:30',
      end: '11:30',
      title: '产业对接会 · 买手洽谈',
      venue: '主展馆 A厅',
      status: 'ongoing',
    },
    {
      id: 'b2',
      date: '2025-06-19',
      start: '14:00',
      end: '16:30',
      title: '设计师品牌大秀',
      venue: '主体育馆 · 副舞台',
      zone: 'A区',
      seat: '5排02座',
      note: '开场前 20 分钟请入座完毕，秀间谢绝走动',
      status: 'upcoming',
    },
    {
      id: 'b3',
      date: '2025-06-19',
      start: '19:00',
      end: '20:30',
      title: '海丝夜游 · 西街文化体验',
      venue: '西街 · 钟楼段',
      geo: { lat: 24.9134, lng: 118.5857, name: '泉州西街钟楼' },
      carId: 'car-night',
      status: 'upcoming',
    },
    // ---- Day 3 · 6.20 周五 ----
    {
      id: 'c1',
      date: '2025-06-20',
      start: '09:30',
      end: '11:00',
      title: '趋势发布闭门会',
      venue: '二层论坛厅 1',
      zone: 'C区',
      seat: '2排06座',
      status: 'upcoming',
    },
    {
      id: 'c2',
      date: '2025-06-20',
      start: '11:15',
      end: '12:00',
      title: '闭幕仪式暨颁奖典礼',
      venue: '主体育馆 · 主舞台',
      zone: 'A区',
      seat: '12排08座',
      note: '安排上台领奖环节，请着正装出席',
      status: 'upcoming',
    },
    {
      id: 'c3',
      date: '2025-06-20',
      start: '12:00',
      end: '13:00',
      title: '闭幕午宴 · 自由交流',
      venue: '二层宴会厅',
      carId: 'car-dropoff',
      status: 'upcoming',
    },
  ],
  transfers: [
    // Day 1 — arrival: early flight in, airport pickup to the venue
    {
      id: 'air-mf8501',
      type: 'air',
      no: 'MF8501',
      depTime: '06:10',
      arrTime: '08:55',
      depStation: '北京首都 T2',
      arrStation: '泉州晋江国际机场',
      seat: '经济舱 32C',
      gate: '登机口 B12',
      sortTime: '20250618T061000',
    },
    {
      id: 'car-shuttle',
      type: 'car',
      title: '活动接驳专车 · 往体育馆',
      useTime: '09:10 发车',
      plate: '闽C·D8866',
      driver: '王师傅',
      phone: '13806051234',
      meetPoint: '晋江机场 T1 到达层 · 6号门',
      durationMin: 40,
      geo: { lat: 24.8008, lng: 118.5896, name: '泉州晋江国际机场' },
      sortTime: '20250618T091000',
    },
    // Day 2 — evening off-site night tour shuttle
    {
      id: 'car-night',
      type: 'car',
      title: '夜游专线 · 往西街',
      useTime: '18:30 发车',
      plate: '闽C·G3355',
      driver: '陈师傅',
      phone: '13706059876',
      meetPoint: '体育馆东门 贵宾通道',
      durationMin: 25,
      geo: { lat: 24.9432, lng: 118.6758, name: '泉州海峡体育中心东门' },
      sortTime: '20250619T183000',
    },
    // Day 3 — departure: station drop-off, then the return rail (last)
    {
      id: 'car-dropoff',
      type: 'car',
      title: '闭幕送站专车 · 往泉州站',
      useTime: '13:20 发车',
      plate: '闽C·F2218',
      driver: '李师傅',
      phone: '13905064321',
      meetPoint: '体育馆东门 贵宾通道',
      durationMin: 30,
      geo: { lat: 24.9432, lng: 118.6758, name: '泉州海峡体育中心东门' },
      sortTime: '20250620T132000',
    },
    {
      id: 'rail-d3212',
      type: 'rail',
      no: 'D3212',
      depTime: '14:10',
      arrTime: '14:39',
      depStation: '泉州站',
      arrStation: '厦门北站',
      seat: '二等座 05车08A',
      gate: '检票口 3A',
      sortTime: '20250620T141000',
    },
  ],
  venueMap: {
    userZone: 'A区',
    zones: [
      { key: 'A', name: 'A区 · 贵宾观礼区', desc: '正对主舞台前排，开幕式与发布会指定坐席' },
      { key: 'B', name: 'B区 · 品牌发布区', desc: '主展馆B厅坐席，临近品牌静态展' },
      { key: 'C', name: 'C区 · 论坛工作区', desc: '二层论坛厅，工作坊与媒体采访区' },
      { key: 'D', name: 'D区 · 公共观礼区', desc: '阶梯坐席，自由出入' },
    ],
  },
}
