import type { AgendaItem, EventInfo, GeoPoint, Transfer } from "./-data";

/* ------------------------------------------------------------------ */
/* 平台动作：地图 / 电话 / 剪贴板 / 日历 / 分享                          */
/* ------------------------------------------------------------------ */

/** 微信内置浏览器会拦掉唤起 App 的 scheme，导航链接要按它降级。 */
function isWeChat(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /MicroMessenger/i.test(navigator.userAgent)
  );
}

/**
 * 高德 universal link。`callnative=1` 时装了高德就直接唤起 App，没装则落到
 * 高德网页版（网页版自己还提供跳百度/腾讯的入口）；微信里唤起会被拦成一个
 * 断头页，所以直接走网页版。
 */
export function buildNavUrl(geo: GeoPoint): string {
  const name = encodeURIComponent(geo.name);
  const callnative = isWeChat() ? 0 : 1;
  return `https://uri.amap.com/marker?position=${geo.lng},${geo.lat}&name=${name}&src=h5-itinerary&callnative=${callnative}`;
}

/**
 * geo 就是导航按钮的开关：没有坐标、坐标非法（NaN / 0,0 / 超出经纬度范围）
 * 时一律不渲染按钮——脏数据降级成「没有按钮」，而不是跳到南极洲。
 */
export function isNavigable(geo?: GeoPoint | null): geo is GeoPoint {
  if (!geo) return false;
  const { lat, lng } = geo;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** 新开一个 tab 打开地图；被拦截弹窗则原地跳转，别把用户卡在死路上。 */
export function openNavigation(geo: GeoPoint): void {
  const url = buildNavUrl(geo);
  try {
    if (!window.open(url, "_blank", "noopener")) window.location.assign(url);
  } catch {
    window.location.assign(url);
  }
}

/** 号码里的空格和横杠会让部分安卓拨号盘识别失败，统一剥掉。 */
export function buildTelHref(phone: string): string {
  return `tel:${phone.replace(/[\s-]/g, "")}`;
}

/** 复制文本。Clipboard API 优先，老 WebView / 非安全上下文退回 execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** .ics 里逗号、分号、反斜杠和换行都是分隔符，必须转义。 */
function escapeIcs(text: string): string {
  return text.replace(/([\\;,])/g, "\\$1").replace(/\n/g, "\\n");
}

/**
 * 直接在前端拼一份 .ics 下载——这一步不需要后端，日历文件本来就是纯文本。
 * 浏览器不给下载（微信内置浏览器就不给）时退回复制时间文案。
 */
export async function addToCalendar(
  event: EventInfo,
): Promise<"downloaded" | "copied"> {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//h5-itinerary//ZH",
    "BEGIN:VEVENT",
    `UID:${event.ics.start}-${Math.random().toString(36).slice(2)}@itinerary`,
    `DTSTART:${event.ics.start}`,
    `DTEND:${event.ics.end}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `LOCATION:${escapeIcs(`${event.city} ${event.venue}`)}`,
    `DESCRIPTION:${escapeIcs(event.intro)}`,
    "BEGIN:VALARM",
    `TRIGGER:-PT${event.ics.alarm}M`,
    "ACTION:DISPLAY",
    "DESCRIPTION:活动提醒",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  try {
    const url = URL.createObjectURL(
      new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "itinerary.ics";
    a.click();
    URL.revokeObjectURL(url);
    return "downloaded";
  } catch {
    await copyText(
      `${event.title}\n${event.dateText} ${event.timeRange}\n${event.city} ${event.venue}`,
    );
    return "copied";
  }
}

/**
 * 系统分享面板优先；微信里没有 Web Share API，退回复制链接，由用户自己点
 * 右上角转发（真机上还会额外弹一层引导蒙层，见 sticky-share-bar.tsx）。
 */
export async function shareItinerary(payload: {
  title: string;
  text: string;
  url: string;
}): Promise<"shared" | "copied" | "wechat-guide" | "failed"> {
  if (isWeChat()) return "wechat-guide";
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(payload);
      return "shared";
    } catch {
      // 用户主动取消也走这里，继续退回复制即可，不该报错。
    }
  }
  return (await copyText(payload.url)) ? "copied" : "failed";
}

/* ------------------------------------------------------------------ */
/* 日期 / 分组                                                          */
/* ------------------------------------------------------------------ */

const WEEKDAYS = "日一二三四五六";
const CN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

export interface DayParts {
  month: number;
  day: number;
  weekday: string;
}

/** `2025-06-18` → `{ month: 6, day: 18, weekday: "周三" }`（按本地时区）。 */
export function parseDay(iso: string): DayParts | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return {
    month: m,
    day: d,
    weekday: `周${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`,
  };
}

/** 第 1 天 → 「一」，超过十天就退回阿拉伯数字，不硬凑「十一」。 */
export function dayOrdinal(index: number): string {
  return CN_NUM[index] ?? String(index + 1);
}

/** 行程的日期键：`20250618T061000` → `2025-06-18`。 */
export function transferDay(t: Transfer): string {
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(t.sortTime);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

export function uniqueDays(days: string[]): string[] {
  return Array.from(new Set(days.filter(Boolean))).sort();
}

/**
 * 作为「今天」的基准日：真实今天落在活动期内就用它，否则用进行中议程所在的
 * 那天（演示数据固定在 6.19），再兜底到第一天。比这天早的日期默认折叠。
 */
export function currentDayOf(days: string[], agenda: AgendaItem[]): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  if (days.includes(today)) return today;
  return agenda.find((a) => a.status === "ongoing")?.date ?? days[0] ?? "";
}

/** 按天分组，保持传入顺序。 */
export function groupByDay<T>(
  items: T[],
  keyOf: (item: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}
