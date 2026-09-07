import type { Car, Trip } from "./-queries";

/* ------------------------------------------------------------------ */
/* 日期：一律按 Asia/Shanghai 算，不用浏览器本地时区                     */
/* ------------------------------------------------------------------ */

/**
 * 所有时间列在库里都是 `timestamptz`，服务端回的是带偏移的 ISO 串。
 *
 * **分天必须钉死在活动所在的时区**：用浏览器本地时区的话，一个在境外（或者
 * 手机时区设错了）的嘉宾，晚上 8 点的闭幕式会掉到第二天那张日卡里 —— 页面
 * 不报错，只是安排看起来全乱了，而且只对一部分人出现。
 */
const TZ = "Asia/Shanghai";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

/** `en-US` 的 `weekday: "short"` 保证是这七个串，据此换成中文。 */
const WEEKDAY_CN: Record<string, string> = {
  Sun: "周日",
  Mon: "周一",
  Tue: "周二",
  Wed: "周三",
  Thu: "周四",
  Fri: "周五",
  Sat: "周六",
};

export interface ZonedParts {
  /** `2025-06-18`，用作分天的键。 */
  dayKey: string;
  /** `09:00` */
  time: string;
  month: number;
  day: number;
  weekday: string;
}

export function zonedParts(iso: string | null | undefined): ZonedParts | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const picked: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    picked[part.type] = part.value;
  }

  const { year, month, day, hour, minute, weekday } = picked;
  if (!year || !month || !day || !hour || !minute) return null;

  return {
    dayKey: `${year}-${month}-${day}`,
    // hour12:false 在部分实现上把午夜给成 "24"，归一成 "00"。
    time: `${hour === "24" ? "00" : hour}:${minute}`,
    month: Number(month),
    day: Number(day),
    weekday: (weekday && WEEKDAY_CN[weekday]) ?? "",
  };
}

export const dayKeyOf = (iso: string | null | undefined) =>
  zonedParts(iso)?.dayKey ?? "";

/**
 * 反过来：`2025-06-18` → 月/日/星期。
 *
 * 取当天正午而不是零点 —— 零点在时区换算的边界上，差一个小时就退到前一天，
 * 而正午离两边边界都有 12 小时的余量。
 */
export const parseDayKey = (dayKey: string) =>
  zonedParts(`${dayKey}T12:00:00+08:00`);

export const timeOf = (iso: string | null | undefined) =>
  zonedParts(iso)?.time ?? "";

/** 今天（Asia/Shanghai），用来判断哪些日子已经过去。 */
export const todayKey = () => dayKeyOf(new Date().toISOString());

/* ------------------------------------------------------------------ */
/* 进行状态                                                            */
/* ------------------------------------------------------------------ */

export type AgendaStatus = "finished" | "ongoing" | "upcoming";

/**
 * 从真实时刻派生，不再是库里的字段。
 *
 * 页面数据一次拉下来就不动了，所以这个判断在打开页面那一刻算一次即可 ——
 * 不做定时器每分钟重算：整页在活动当天不停变样，比状态晚几分钟更换人烦。
 */
export function statusOf(
  startTime: string,
  endTime: string,
  now = Date.now(),
): AgendaStatus {
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (Number.isFinite(end) && now >= end) return "finished";
  if (Number.isFinite(start) && now >= start) return "ongoing";
  return "upcoming";
}

/* ------------------------------------------------------------------ */
/* 分天                                                                */
/* ------------------------------------------------------------------ */

const CN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** 第 1 天 → 「一」，超过十天退回阿拉伯数字，不硬凑「十一」。 */
const dayOrdinal = (index: number) => CN_NUM[index] ?? String(index + 1);

export function uniqueDays(days: string[]): string[] {
  return Array.from(new Set(days.filter(Boolean))).sort();
}

/**
 * 一天在列表里的标题。
 *
 * 有议程的那几天顺序编号「第 N 天」；只有交通没有议程的那天不占编号 —— 前一
 * 晚飞过来叫「出发日」、结束后返程叫「返程日」、夹在中间的空档叫「自由活动」。
 * 把它们也编成「第 N 天」会让嘉宾以为那天有安排。
 */
export function dayLabelOf(day: string, agendaDays: string[]): string {
  const index = agendaDays.indexOf(day);
  if (index >= 0) return `第${dayOrdinal(index)}天`;
  const first = agendaDays[0];
  const last = agendaDays[agendaDays.length - 1];
  if (first && day < first) return "出发日";
  if (last && day > last) return "返程日";
  return "自由活动";
}

/**
 * 「已结束」的分界日：**就是今天，没有回退逻辑。** 比它早的日子折叠并标已结束，
 * 等于它的那天挂「今天」。
 *
 * 曾经写成「今天不在行程期内就退回第一个未结束的议程日」，那是照着静态演示数据
 * 来的 —— 假数据固定在过去，不回退整页就全灰。接了真实数据之后这个回退是个
 * **实打实的 bug**：嘉宾提前几天打开页面，基准日被推到活动第一天，于是前一晚
 * 飞过来的那张「出发日」（比第一天早）被判成已结束、折起来显示"已结束"，而那
 * 趟航班明明还没起飞。
 *
 * 直接用今天，四种情形都对：在期内 → 当天高亮；在期前 → 一天都不算过去、也
 * 没有哪天冒充「今天」；在期后 → 全部已结束；落在中间的空档 → 之前的算过去。
 */
export const currentDayOf = () => todayKey();

/**
 * 头图那两行：`2025年6月18日–20日 · 共3天` + `09:00–17:30`。
 *
 * 跨天的活动只写一次年月，同月的省掉第二个月份 —— 头图标题下面这行宽度很紧，
 * 「2025年6月18日–2025年6月20日」会挤到换行。
 */
export function formatActivityDate(startTime: string, endTime: string) {
  const start = zonedParts(startTime);
  const end = zonedParts(endTime);
  if (!start) return { dateText: "", timeRange: "" };

  const timeRange = end ? `${start.time}–${end.time}` : start.time;
  const head = `${start.dayKey.slice(0, 4)}年${start.month}月${start.day}日`;

  if (!end || start.dayKey === end.dayKey) {
    return { dateText: `${head} ${start.weekday}`, timeRange };
  }

  const tail =
    start.month === end.month ? `${end.day}日` : `${end.month}月${end.day}日`;
  // 含首尾两天，所以 +1。用 UTC 零点相减避开时区偏移带来的半天误差。
  const days =
    Math.round(
      (Date.parse(`${end.dayKey}T00:00:00Z`) -
        Date.parse(`${start.dayKey}T00:00:00Z`)) /
        86400000,
    ) + 1;

  return { dateText: `${head}–${tail} · 共${days}天`, timeRange };
}

/* ------------------------------------------------------------------ */
/* 交通                                                                */
/* ------------------------------------------------------------------ */

export const TRANSPORT_MODE_LABELS = {
  train: "火车",
  flight: "飞机",
  drive: "驾车",
  other: "其他",
} as const satisfies Record<Trip["transportMode"], string>;

/** 火车 / 飞机有车次航班号，走票务版式；驾车 / 其他只有起讫点和时刻。 */
export const isTicketed = (trip: Trip) =>
  trip.transportMode === "train" || trip.transportMode === "flight";

export const TRANSPORT_SCENE_LABELS = {
  activity: "活动用车",
  pickup: "接站",
  dropoff: "送站",
} as const;

/** 没有有效发车时间的用车归入页尾「待定安排」，不猜日期。 */
export const isScheduled = (car: Car) =>
  Boolean(car.startTime && Number.isFinite(Date.parse(car.startTime)));

/* ------------------------------------------------------------------ */
/* 平台动作：电话 / 剪贴板                                              */
/* ------------------------------------------------------------------ */

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
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    } catch {
      return false;
    }
  }
}
