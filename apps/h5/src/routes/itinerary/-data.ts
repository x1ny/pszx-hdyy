/**
 * 行程页的静态演示数据。
 *
 * 这一版只做页面效果，**不接后端**：真实数据将来通过 `/api/h5/...` 按同样的
 * 形状取回来（身份体系还没定案，见 AGENTS.md「认证」），所以这里的类型就是
 * 将来那份接口约定的草稿，字段含义写在注释里。
 *
 * 演示数据刻意覆盖各种形状：已结束 / 未结束的日子、火车 / 飞机 / 用车三类
 * 行程、精确到座和一段区间的座位、有同行人座位说明的、带提示的、以及一整
 * 天只有交通没有议程的「出发日」。
 */

export interface GeoPoint {
  lat: number;
  lng: number;
  /** 传给地图 App 的显示名。 */
  name: string;
}

export interface StaffContact {
  name: string;
  phone: string;
}

export interface EventDetails {
  paragraphs: string[];
  /** 主办 / 承办 / 支持 / 指导，按展示顺序。 */
  organizers: { role: string; name: string }[];
}

export interface EventInfo {
  /** 头图里最多两行，超出截断。 */
  title: string;
  dateText: string;
  timeRange: string;
  city: string;
  venue: string;
  venueGeo: GeoPoint;
  /** 头图里截两行，全文在 details 里。 */
  intro: string;
  details: EventDetails;
  contact: StaffContact;
  heroImage: string;
}

/** 已结束 / 进行中 / 未开始——决定时间轴节点和卡片的三套配色。 */
export type AgendaStatus = "finished" | "ongoing" | "upcoming";

export interface AgendaItem {
  id: string;
  /** `YYYY-MM-DD`，多天活动按它分组。 */
  date: string;
  start: string;
  end: string;
  title: string;
  venue: string;
  /**
   * 只有真正需要开车过去的地点才带坐标——场馆内部的分厅（B厅、二层论坛厅）
   * 走过去就到了，给个导航按钮反而是干扰。带坐标才渲染导航按钮。
   */
  geo?: GeoPoint;
  zone?: string;
  /** 座位号，也可以是一段区间（`6排11-15座`）或「凭胸卡入场」这类说明。 */
  seat?: string;
  /**
   * 关联的用车安排 id。用车本身是时间轴上一个独立的行（按发车时间排在这一
   * 场前面），这个字段只是一条说明性的关联，不再决定渲染位置。
   */
  carId?: string;
  /** 需要嘉宾配合的事项（上台发言、着装要求），渲染成提示块。 */
  note?: string;
  /**
   * 同行人的座位说明（`您的团体成员座位安排在 5排03-05座`）。同行人多半没有
   * 自己的分享链接，座位只能挂在拿到链接的这位嘉宾身上。空 / 无 → 不渲染。
   */
  groupSeatNote?: string;
  status: AgendaStatus;
}

export type TransferType = "rail" | "air" | "car";

interface TransferBase {
  id: string;
  type: TransferType;
  /** 排序键，`yyyyMMddTHHmmss`。 */
  sortTime: string;
}

export interface TicketTransfer extends TransferBase {
  type: "rail" | "air";
  no: string;
  depTime: string;
  arrTime: string;
  depStation: string;
  arrStation: string;
  seat?: string;
  gate?: string;
}

export interface CarTransfer extends TransferBase {
  type: "car";
  title: string;
  useTime: string;
  plate: string;
  driver: string;
  phone: string;
  meetPoint: string;
  durationMin?: number;
  geo?: GeoPoint;
}

export type Transfer = TicketTransfer | CarTransfer;

export interface ZoneInfo {
  key: string;
  name: string;
  desc: string;
}

export interface VenueMapInfo {
  userZone: string;
  zones: ZoneInfo[];
}

export interface ItineraryData {
  user: { name: string; greeting: string };
  event: EventInfo;
  agenda: AgendaItem[];
  transfers: Transfer[];
  venueMap: VenueMapInfo;
}

/**
 * 演示用的准入手机号。
 *
 * 真实版本里这个判断整个在服务端：手机号连同链接 token 一起发过去，换回一份
 * 只能看这一份行程的凭证。前端不留任何可比对的常量，见 key-gate.tsx。
 */
export const DEMO_ACCESS_KEY = "13860681818";

/** 手机号校验的假实现。故意留个延时，把真实网络往返的等待态也演出来。 */
export async function verifyAccessKey(key: string): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  return key.replace(/\D/g, "") === DEMO_ACCESS_KEY;
}

export const ITINERARY: ItineraryData = {
  user: { name: "陈默", greeting: "专属行程" },
  event: {
    title: "2025 海丝国际时尚周",
    dateText: "2025年6月18日–20日 · 共3天",
    timeRange: "09:00–17:30",
    city: "泉州",
    venue: "海峡体育中心 · 体育馆",
    venueGeo: { lat: 24.943, lng: 118.675, name: "泉州海峡体育中心" },
    intro:
      "以海上丝绸之路起点泉州为舞台，汇聚 40+ 设计师品牌与买手，呈现开幕大秀、趋势论坛与产业对接。刺桐花开，潮起东方，请按下方议程与行程准时出席，共同见证年度时尚盛事。",
    details: {
      paragraphs: [
        "海丝国际时尚周创办于 2019 年，是扎根海上丝绸之路起点泉州、辐射海峡两岸的年度时尚产业盛会。2025 年适逢第七届，以「潮起东方」为主题，联动泉州纺织鞋服产业集群，打造集品牌发布、趋势研讨与商贸对接于一体的开放平台。",
        "本届开幕式暨品牌发布盛典汇聚 40 余个设计师品牌与海内外买手，现场呈现开幕大秀、品牌静态展与海丝时尚趋势论坛；傍晚的闭幕酒会移步户外刺桐广场，邀您在千年刺桐花开的城市意象中自由交流、共话合作。",
      ],
      organizers: [
        { role: "主办单位", name: "泉州时尚周组委会" },
        { role: "承办单位", name: "时尚周活动运营中心" },
        { role: "支持单位", name: "泉州市服装设计协会" },
        { role: "指导单位", name: "泉州市商务局" },
      ],
    },
    contact: { name: "林晓彤", phone: "13605950011" },
    heroImage: "/hero-quanzhou.jpg",
  },
  agenda: [
    // ---- 第一天 · 6.18 周三（已结束）----
    {
      id: "a1",
      date: "2025-06-18",
      start: "09:00",
      end: "10:30",
      title: "开幕式暨主旨论坛",
      venue: "主体育馆 · 主舞台",
      geo: { lat: 24.943, lng: 118.675, name: "泉州海峡体育中心" },
      zone: "A区",
      seat: "12排08座",
      carId: "car-shuttle",
      status: "finished",
    },
    {
      id: "a2",
      date: "2025-06-18",
      start: "10:45",
      end: "12:00",
      title: "品牌联合发布会",
      venue: "主展馆 B厅",
      zone: "B区",
      seat: "3排05座",
      status: "finished",
    },
    {
      id: "a3",
      date: "2025-06-18",
      start: "12:00",
      end: "13:30",
      title: "午间休息 · 自助午餐",
      venue: "二层宴会厅",
      status: "finished",
    },
    {
      id: "a4",
      date: "2025-06-18",
      start: "14:00",
      end: "16:00",
      title: "海丝时尚趋势工作坊",
      venue: "二层论坛厅 2",
      zone: "C区",
      // 座位是一段区间——不是每场入场都精确到一个座位号
      seat: "6排11-15座",
      note: "含面料体验环节，建议穿着轻便运动服装",
      status: "finished",
    },
    // ---- 第二天 · 6.19 周四（进行中）----
    {
      id: "b1",
      date: "2025-06-19",
      start: "09:30",
      end: "11:30",
      title: "产业对接会 · 买手洽谈",
      venue: "主展馆 A厅",
      status: "ongoing",
    },
    {
      id: "b2",
      date: "2025-06-19",
      start: "14:00",
      end: "16:30",
      title: "设计师品牌大秀",
      venue: "主体育馆 · 副舞台",
      zone: "A区",
      seat: "5排02座",
      // 这位嘉宾有分享链接，同行的人没有——把他们的座位一起带在这条上
      groupSeatNote: "您的团体成员座位安排在 5排03-05座、6排01-03座",
      note: "开场前 20 分钟请入座完毕，秀间谢绝走动",
      status: "upcoming",
    },
    {
      id: "b3",
      date: "2025-06-19",
      start: "19:00",
      end: "20:30",
      title: "海丝夜游 · 西街文化体验",
      venue: "西街 · 钟楼段",
      geo: { lat: 24.9134, lng: 118.5857, name: "泉州西街钟楼" },
      carId: "car-night",
      status: "upcoming",
    },
    // ---- 第三天 · 6.20 周五（未开始）----
    {
      id: "c1",
      date: "2025-06-20",
      start: "09:30",
      end: "11:00",
      title: "趋势发布闭门会",
      venue: "二层论坛厅 1",
      zone: "C区",
      seat: "2排06座",
      status: "upcoming",
    },
    {
      id: "c2",
      date: "2025-06-20",
      start: "11:15",
      end: "12:00",
      title: "闭幕仪式暨颁奖典礼",
      venue: "主体育馆 · 主舞台",
      zone: "A区",
      seat: "12排08座",
      note: "安排上台领奖环节，请着正装出席",
      status: "upcoming",
    },
    {
      id: "c3",
      date: "2025-06-20",
      start: "12:00",
      end: "13:00",
      title: "闭幕午宴 · 自由交流",
      venue: "二层宴会厅",
      carId: "car-dropoff",
      status: "upcoming",
    },
  ],
  transfers: [
    // ---- 出发日 · 6.17 周二：晚班机抵达，当晚住酒店 ----
    // 这一天没有任何议程，靠它验证「只有交通的日子也要有自己的一张日卡」
    {
      id: "air-mf8501",
      type: "air",
      no: "MF8501",
      depTime: "19:30",
      arrTime: "22:05",
      depStation: "北京首都 T2",
      arrStation: "泉州晋江国际机场",
      seat: "经济舱 32C",
      gate: "登机口 B12",
      sortTime: "20250617T193000",
    },
    // ---- 第一天 · 6.18：早上从酒店接去场馆 ----
    {
      id: "car-shuttle",
      type: "car",
      title: "活动接驳专车 · 往体育馆",
      useTime: "08:10 发车",
      plate: "闽C·D8866",
      driver: "王师傅",
      phone: "13806051234",
      meetPoint: "泉州悦华酒店大堂",
      durationMin: 20,
      geo: { lat: 24.907, lng: 118.585, name: "泉州悦华酒店" },
      sortTime: "20250618T081000",
    },
    {
      id: "car-night",
      type: "car",
      title: "夜游专线 · 往西街",
      useTime: "18:30 发车",
      plate: "闽C·G3355",
      driver: "陈师傅",
      phone: "13706059876",
      meetPoint: "体育馆东门 贵宾通道",
      durationMin: 25,
      geo: { lat: 24.9432, lng: 118.6758, name: "泉州海峡体育中心东门" },
      sortTime: "20250619T183000",
    },
    {
      id: "car-dropoff",
      type: "car",
      title: "闭幕送站专车 · 往泉州站",
      useTime: "13:20 发车",
      plate: "闽C·F2218",
      driver: "李师傅",
      phone: "13905064321",
      meetPoint: "体育馆东门 贵宾通道",
      durationMin: 30,
      geo: { lat: 24.9432, lng: 118.6758, name: "泉州海峡体育中心东门" },
      sortTime: "20250620T132000",
    },
    {
      id: "rail-d3212",
      type: "rail",
      no: "D3212",
      depTime: "14:10",
      arrTime: "14:39",
      depStation: "泉州站",
      arrStation: "厦门北站",
      seat: "二等座 05车08A",
      gate: "检票口 3A",
      sortTime: "20250620T141000",
    },
  ],
  venueMap: {
    userZone: "A区",
    zones: [
      {
        key: "A",
        name: "A区 · 贵宾观礼区",
        desc: "正对主舞台前排，开幕式与发布会指定坐席",
      },
      {
        key: "B",
        name: "B区 · 品牌发布区",
        desc: "主展馆B厅坐席，临近品牌静态展",
      },
      {
        key: "C",
        name: "C区 · 论坛工作区",
        desc: "二层论坛厅，工作坊与媒体采访区",
      },
      { key: "D", name: "D区 · 公共观礼区", desc: "阶梯坐席，自由出入" },
    ],
  },
};
