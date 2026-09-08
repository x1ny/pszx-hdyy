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

export interface TimeRangeDayPart {
  /** 这个时间片所属的 Asia/Shanghai 自然日。 */
  dayKey: string;
  /** 这个自然日里的开始展示时刻。 */
  startTime: string;
  /** 这个自然日里的结束展示时刻。 */
  endTime: string;
}

const DAY_MS = 86_400_000;

/** 把 `YYYY-MM-DD` 当成 UTC 日期处理，避免调用方机器的本地时区介入。 */
const utcDayTimestamp = (dayKey: string) => {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isNaN(timestamp) ? null : timestamp;
};

const dayKeyFromUtcTimestamp = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);

/** 列出两个自然日之间的所有日期（含首尾）。 */
const dayKeysBetween = (startDay: string, endDay: string) => {
  const start = utcDayTimestamp(startDay);
  const end = utcDayTimestamp(endDay);
  if (start === null || end === null || end < start) return [];

  const days: string[] = [];
  for (let timestamp = start; timestamp <= end; timestamp += DAY_MS) {
    days.push(dayKeyFromUtcTimestamp(timestamp));
  }
  return days;
};

/**
 * 把一个议程的完整时间段拆成按自然日展示的时间片。
 *
 * 跨天环节不能把 `14:00–08:00` 原样放在开始日：那既会让时间看起来倒流，
 * 也会让结束日没有任何记录。展示层按活动时区切开，首日用 `24:00` 收尾，
 * 中间日展示 `00:00–24:00`，末日从 `00:00` 开始。数据库里的原始时刻不改，
 * 这样状态判断和接口语义仍然对应同一个完整环节。
 */
export function splitTimeRangeByDay(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): TimeRangeDayPart[] {
  const start = zonedParts(startIso);
  if (!start) return [];

  const end = zonedParts(endIso);
  if (!end) {
    return [{ dayKey: start.dayKey, startTime: start.time, endTime: "" }];
  }

  const startTimestamp = Date.parse(startIso ?? "");
  const endTimestamp = Date.parse(endIso ?? "");
  const dayKeys = dayKeysBetween(start.dayKey, end.dayKey);

  // 正常数据由服务端保证 end >= start。异常数据或同日零时长仍保留一行，
  // 避免展示层因为防御性处理把一个接口返回的环节静默吞掉。
  if (
    !Number.isFinite(startTimestamp) ||
    !Number.isFinite(endTimestamp) ||
    endTimestamp <= startTimestamp ||
    start.dayKey === end.dayKey ||
    dayKeys.length < 2
  ) {
    return [{ dayKey: start.dayKey, startTime: start.time, endTime: end.time }];
  }

  // 结束时刻正好落在某日 00:00 时，前一天的 24:00 已经完整覆盖了这个
  // 时间段，不再生成一条 00:00–00:00 的空记录。
  const endAtMidnight =
    end.time === "00:00" &&
    endTimestamp === Date.parse(`${end.dayKey}T00:00:00+08:00`);
  const visibleDays = endAtMidnight ? dayKeys.slice(0, -1) : dayKeys;

  return visibleDays.map((dayKey, index) => ({
    dayKey,
    startTime: index === 0 ? start.time : "00:00",
    endTime:
      index === visibleDays.length - 1 && !endAtMidnight ? end.time : "24:00",
  }));
}

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

/** 两个 `YYYY-MM-DD` 日键之间相差几天。 */
const dayDistance = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86400000,
  );

export function uniqueDays(days: string[]): string[] {
  return Array.from(new Set(days.filter(Boolean))).sort();
}

/**
 * 一天在列表里的标题。
 *
 * 以第一天有议程的日期为编号锚点，议程时间范围内的日期按日历顺序编号。这样
 * 中间即使没有环节、只有交通行程，也仍然是「第 N 天」，不会出现一个让嘉宾
 * 不理解的「自由活动」标签。议程开始前/结束后的交通日仍单独标为「出发日」/
 * 「返程日」。
 */
export function dayLabelOf(day: string, agendaDays: string[]): string {
  const first = agendaDays[0];
  const last = agendaDays[agendaDays.length - 1];
  if (first && day < first) return "出发日";
  if (last && day > last) return "返程日";
  if (first) {
    const distance = dayDistance(first, day);
    if (Number.isFinite(distance) && distance >= 0) {
      return `第${dayOrdinal(distance)}天`;
    }
  }
  return "行程日";
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
/* 地图导航                                                            */
/* ------------------------------------------------------------------ */

type LocationPoint = NonNullable<Car["locationPoint"]>;

/**
 * 后台百度 JSAPI 保存的是 BD-09；高德 URI 则使用 GCJ-02。
 *
 * 只在浏览器本地做这一次坐标换算，不再把嘉宾的当前位置传回服务端。常量和
 * 公式是公开的 BD-09 ↔ GCJ-02 换算方式；它仅用于导航入口，定位点数据库
 * 仍然原样保存百度坐标，避免丢精度或混用坐标系。
 */
const BD09_X_PI = (Math.PI * 3000.0) / 180.0;

function bd09ToGcj02(longitude: number, latitude: number) {
  const x = longitude - 0.0065;
  const y = latitude - 0.006;
  const distance = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * BD09_X_PI);
  const angle = Math.atan2(y, x) - 0.000003 * Math.cos(x * BD09_X_PI);

  return {
    longitude: distance * Math.cos(angle),
    latitude: distance * Math.sin(angle),
  };
}

const EARTH_SEMI_MAJOR_AXIS = 6378245.0;
const ECCENTRICITY_SQUARED = 0.006693421622965943;

const outsideChina = (longitude: number, latitude: number) =>
  longitude < 72.004 ||
  longitude > 137.8347 ||
  latitude < 0.8293 ||
  latitude > 55.8271;

function transformLatitude(longitude: number, latitude: number) {
  let result =
    -100 +
    2 * longitude +
    3 * latitude +
    0.2 * latitude * latitude +
    0.1 * longitude * latitude +
    0.2 * Math.sqrt(Math.abs(longitude));
  result +=
    ((20 * Math.sin(6 * longitude * Math.PI) +
      20 * Math.sin(2 * longitude * Math.PI)) *
      2) /
    3;
  result +=
    ((20 * Math.sin(latitude * Math.PI) +
      40 * Math.sin((latitude / 3) * Math.PI)) *
      2) /
    3;
  return (
    result +
    ((160 * Math.sin((latitude / 12) * Math.PI) +
      320 * Math.sin((latitude * Math.PI) / 30)) *
      2) /
      3
  );
}

function transformLongitude(longitude: number, latitude: number) {
  let result =
    300 +
    longitude +
    2 * latitude +
    0.1 * longitude * longitude +
    0.1 * longitude * latitude +
    0.1 * Math.sqrt(Math.abs(longitude));
  result +=
    ((20 * Math.sin(6 * longitude * Math.PI) +
      20 * Math.sin(2 * longitude * Math.PI)) *
      2) /
    3;
  result +=
    ((20 * Math.sin(longitude * Math.PI) +
      40 * Math.sin((longitude / 3) * Math.PI)) *
      2) /
    3;
  return (
    result +
    ((150 * Math.sin((longitude / 12) * Math.PI) +
      300 * Math.sin((longitude / 30) * Math.PI)) *
      2) /
      3
  );
}

/** GCJ-02 → WGS-84；Apple 地图 URL 使用后者的纬度、经度顺序。 */
function gcj02ToWgs84(longitude: number, latitude: number) {
  if (outsideChina(longitude, latitude)) return { longitude, latitude };

  const adjustedLongitude = longitude - 105;
  const adjustedLatitude = latitude - 35;
  let deltaLatitude = transformLatitude(adjustedLongitude, adjustedLatitude);
  let deltaLongitude = transformLongitude(adjustedLongitude, adjustedLatitude);
  const radians = (latitude / 180) * Math.PI;
  const sine = Math.sin(radians);
  const magic = 1 - ECCENTRICITY_SQUARED * sine * sine;
  const rootMagic = Math.sqrt(magic);

  deltaLatitude =
    (deltaLatitude * 180) /
    (((EARTH_SEMI_MAJOR_AXIS * (1 - ECCENTRICITY_SQUARED)) /
      (magic * rootMagic)) *
      Math.PI);
  deltaLongitude =
    (deltaLongitude * 180) /
    ((EARTH_SEMI_MAJOR_AXIS / rootMagic) * Math.cos(radians) * Math.PI);

  return {
    longitude: longitude * 2 - (longitude + deltaLongitude),
    latitude: latitude * 2 - (latitude + deltaLatitude),
  };
}

const baiduDirectionParams = (point: LocationPoint) =>
  new URLSearchParams({
    origin: "我的位置",
    destination: `name:${point.name}|latlng:${point.latitude},${point.longitude}`,
    mode: "driving",
    coord_type: point.coordinateSystem,
    src: "webapp.pszx.itinerary",
  });

/**
 * 百度地图 Web URI。起点交由手机地图处理「我的位置」，终点始终使用后台
 * 已确认的 BD-09 坐标；`src` 和 `coord_type` 都是百度 URI 的必填信息。
 */
export function buildBaiduNavigationHref(point: LocationPoint): string {
  const params = baiduDirectionParams(point);
  params.set("output", "html");
  return `https://api.map.baidu.com/direction?${params}`;
}

/** 安装了百度地图时优先使用其原生导航页。 */
export function buildBaiduMapAppHref(point: LocationPoint): string {
  return `baidumap://map/direction?${baiduDirectionParams(point)}`;
}

/**
 * 尝试打开原生应用；若浏览器仍留在当前页面，短暂等待后转到网页地图兜底。
 * 不能、也不需要探测手机已安装的应用；这两个结果正是靠页面是否转入后台来区分。
 */
export function openMapAppWithFallback(appHref: string, fallbackHref: string) {
  let fallbackTimer: number | undefined;
  const cancelFallback = () => {
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", cancelFallback);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") cancelFallback();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", cancelFallback, { once: true });
  fallbackTimer = window.setTimeout(() => {
    cancelFallback();
    if (document.visibilityState === "visible") {
      window.location.assign(fallbackHref);
    }
  }, 1200);
  window.location.assign(appHref);
}

/**
 * 高德 URI 在移动端省略起点时会读取用户当前位置。`callnative=1` 尝试交给
 * 已安装的高德地图，不能调起时仍会保留在网页地图中展示路线。
 */
export function buildAmapNavigationHref(point: LocationPoint): string {
  const destination = bd09ToGcj02(point.longitude, point.latitude);
  const params = new URLSearchParams({
    to: `${destination.longitude},${destination.latitude},${point.name}`,
    mode: "car",
    policy: "1",
    src: "pszx-h5",
    callnative: "1",
  });
  return `https://uri.amap.com/navigation?${params}`;
}

/**
 * 苹果地图会在 iOS / iPadOS 打开系统地图。旧版 `daddr` 链接也能兼容较早
 * 的 iOS，未给起点时由地图以当前位置开始驾车路线。
 */
export function buildAppleMapsNavigationHref(point: LocationPoint): string {
  const gcj02 = bd09ToGcj02(point.longitude, point.latitude);
  const destination = gcj02ToWgs84(gcj02.longitude, gcj02.latitude);
  const params = new URLSearchParams({
    daddr: `${destination.latitude},${destination.longitude}`,
    dirflg: "d",
  });
  return `https://maps.apple.com/?${params}`;
}

/**
 * iPadOS 桌面模式把 UA 伪装成 Mac，需要额外以 `MacIntel + 触点` 判断；普通
 * 桌面浏览器不展示苹果地图，避免给 Android 用户一个无意义的选项。
 */
export function supportsAppleMaps(
  userAgent = navigator.userAgent,
  platform = navigator.platform,
  maxTouchPoints = navigator.maxTouchPoints,
) {
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

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
