import type { AgendaItem, GeoPoint, Transfer } from "./-data";

/* ------------------------------------------------------------------ */
/* 平台动作：地图 / 电话 / 剪贴板                                        */
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

/* ------------------------------------------------------------------ */
/* 日期                                                                */
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
function dayOrdinal(index: number): string {
  return CN_NUM[index] ?? String(index + 1);
}

/** 行程的日期键：`20250618T061000` → `2025-06-18`。 */
export function transferDay(t: Transfer): string {
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(t.sortTime);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** 行程在当天内的排序键：`20250618T061000` → `06:10`。 */
export function transferTime(t: Transfer): string {
  const m = /^\d{8}T(\d{2})(\d{2})/.exec(t.sortTime);
  return m ? `${m[1]}:${m[2]}` : "";
}

/**
 * 一天在列表里的标题。
 *
 * 有议程的那几天顺序编号「第 N 天」；只有交通没有议程的那天不占编号——前一
 * 晚飞过来叫「出发日」、活动结束后返程叫「返程日」、夹在中间的空档叫「自由
 * 活动」。把它们也编成「第 N 天」会让嘉宾以为那天有安排。
 */
export function dayLabelOf(day: string, agendaDays: string[]): string {
  const i = agendaDays.indexOf(day);
  if (i >= 0) return `第${dayOrdinal(i)}天`;
  const first = agendaDays[0];
  const last = agendaDays[agendaDays.length - 1];
  if (first && day < first) return "出发日";
  if (last && day > last) return "返程日";
  return "自由活动";
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
