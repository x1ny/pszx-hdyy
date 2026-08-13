window.Mock = {
  projects: [
    { id: 1, name: "泉州纺织服装时尚周主项目", place: "泉州海丝艺术公园", start: "2026-11-18", end: "2026-11-24", budget: "860,000", status: "已上架", host: "泉州时尚周组委会", organizer: "时尚周活动运营中心", support: "泉州市服装设计协会", guide: "泉州市商务局", desc: "覆盖开幕秀、品牌发布、产业洽谈和嘉宾接待的主项目。" },
    { id: 2, name: "童装品牌订货会项目", place: "石狮服装城展贸中心", start: "2026-11-25", end: "2026-11-26", budget: "420,000", status: "未发布", host: "泉州时尚周组委会", organizer: "品牌合作部", support: "石狮市童装行业协会", guide: "石狮市商务局", desc: "童装品牌订货与新品选品项目。" },
    { id: 3, name: "历史品牌闭门秀项目", place: "泉州滨江会议中心", start: "2026-10-28", end: "2026-10-29", budget: "160,000", status: "已下架", host: "泉州时尚周组委会", organizer: "品牌合作部", support: "泉州纺织服装商会", guide: "泉州市商务局", desc: "已结束并下架的历史闭门展示项目。" },
    { id: 4, name: "海丝面料趋势发布项目", place: "泉州国际会展中心 A 馆", start: "2026-11-19", end: "2026-11-20", budget: "300,000", status: "已上架", host: "泉州时尚周组委会", organizer: "面料趋势中心", support: "福建省纺织服装协会", guide: "泉州市工业和信息化局", desc: "围绕面料趋势、辅料创新和供应链合作的展示项目。" },
    { id: 5, name: "设计师品牌走秀项目", place: "海丝艺术中心主秀场", start: "2026-11-20", end: "2026-11-21", budget: "680,000", status: "已上架", host: "泉州时尚周组委会", organizer: "秀场运营组", support: "泉州市服装设计协会", guide: "泉州市商务局", desc: "面向设计师、品牌方、媒体和买手的走秀发布项目。" },
    { id: 6, name: "闽派服饰新品发布项目", place: "泉州国际会展中心 B 馆", start: "2026-11-21", end: "2026-11-22", budget: "360,000", status: "已上架", host: "泉州时尚周组委会", organizer: "品牌合作部", support: "福建省纺织服装协会", guide: "泉州市工业和信息化局", desc: "集中展示闽派服饰品牌新品与年度系列。" },
    { id: 7, name: "产业链采购对接项目", place: "泉州滨江会议中心", start: "2026-11-23", end: "2026-11-24", budget: "260,000", status: "已上架", host: "泉州时尚周组委会", organizer: "招商合作部", support: "泉州产业投资联盟", guide: "泉州市招商办", desc: "面向采购商、品牌方和供应链企业的合作洽谈项目。" },
    { id: 900, name: "2026 数字服务生态大会", place: "福州海峡国际会展中心", start: "2026-09-18", end: "2026-09-20", budget: "860,000", status: "未发布", host: "品尚征信", organizer: "智能活动运营组", support: "福州市数字经济协会", guide: "福建省数据管理局", desc: "后台保留的历史模拟项目，用于展示系统支持多项目样例。" }
  ],
  activities: [
    { id: 101, projectId: 1, type: "自主策划", name: "泉州纺织服装时尚周开幕秀", place: "海丝艺术公园主秀场", start: "2026-11-18 19:30", end: "2026-11-18 21:30", budget: "520,000", status: "已上架", business: "进行中", display: true, signup: true, configDone: 6, configTotal: 8, host: "泉州时尚周组委会", organizer: "时尚周活动运营中心", support: "泉州市服装设计协会", guide: "泉州市商务局", desc: "时尚周开幕发布、嘉宾观秀和品牌亮相活动。", media: { images: 3, videos: 1, cover: "开幕秀舞台封面图" } },
    { id: 102, projectId: 1, type: "配套活动", name: "品牌买手对接会", place: "海丝艺术中心洽谈 B 区", start: "2026-11-19 10:00", end: "2026-11-19 12:00", budget: "90,000", status: "已上架", business: "进行中", display: true, signup: false, configDone: 3, configTotal: 8, host: "泉州时尚周组委会", organizer: "招商合作部", support: "泉州市服装设计协会", guide: "泉州市商务局", desc: "面向受邀买手、品牌方和渠道代表的闭门对接活动。", media: { images: 1, videos: 0, cover: "买手对接会展示图" } },
    { id: 201, projectId: 2, type: "配套活动", name: "童装品牌选品会", place: "石狮服装城展贸中心", start: "2026-11-25 14:00", end: "2026-11-25 17:00", budget: "80,000", status: "未发布", business: "未开始", display: false, signup: false, configDone: 2, configTotal: 8, host: "泉州时尚周组委会", organizer: "品牌合作部", support: "石狮市童装行业协会", guide: "石狮市商务局", desc: "童装品牌新品选品与渠道交流活动。", media: { images: 0, videos: 0, cover: "未配置" } },
    { id: 401, projectId: 4, type: "自主策划", name: "海丝面料趋势发布", place: "泉州国际会展中心 A 馆", start: "2026-11-19 09:30", end: "2026-11-19 12:00", budget: "180,000", status: "已上架", business: "进行中", display: true, signup: true, configDone: 4, configTotal: 8, host: "泉州时尚周组委会", organizer: "面料趋势中心", support: "福建省纺织服装协会", guide: "泉州市工业和信息化局", desc: "发布年度面料趋势、色彩方向和创新材料应用。", media: { images: 1, videos: 0, cover: "面料趋势发布封面图" } },
    { id: 402, projectId: 4, type: "配套活动", name: "辅料供应链交流会", place: "会展中心会议室 2", start: "2026-11-19 14:00", end: "2026-11-19 16:30", budget: "60,000", status: "已上架", business: "未开始", display: true, signup: false, configDone: 3, configTotal: 8, host: "泉州时尚周组委会", organizer: "面料趋势中心", support: "福建省纺织服装协会", guide: "泉州市工业和信息化局", desc: "定向邀请辅料供应商和品牌研发团队进行交流。", media: { images: 1, videos: 0, cover: "辅料交流会展示图" } },
    { id: 501, projectId: 5, type: "自主策划", name: "泉州时尚周开幕秀", place: "海丝主秀场", start: "2026-11-18 19:30", end: "2026-11-18 21:30", budget: "420,000", status: "已上架", business: "未开始", display: true, signup: true, configDone: 5, configTotal: 8, host: "泉州时尚周组委会", organizer: "活动运营中心", support: "泉州市服装设计协会", guide: "泉州市商务局", desc: "时尚周开幕发布与嘉宾观秀活动。", media: { images: 2, videos: 1, cover: "开幕秀舞台封面图" } },
    { id: 502, projectId: 5, type: "配套活动", name: "品牌嘉宾欢迎会", place: "海丝艺术中心宴会厅", start: "2026-11-18 16:00", end: "2026-11-18 18:00", budget: "90,000", status: "已上架", business: "未开始", display: true, signup: false, configDone: 3, configTotal: 8, host: "泉州时尚周组委会", organizer: "接待保障组", support: "泉州市服装设计协会", guide: "泉州市商务局", desc: "面向受邀嘉宾的欢迎交流活动。", media: { images: 1, videos: 0, cover: "欢迎会展示图" } },
    { id: 601, projectId: 6, type: "自主策划", name: "设计师品牌联合发布", place: "泉州国际会展中心 A 馆", start: "2026-11-21 10:00", end: "2026-11-21 12:00", budget: "210,000", status: "已上架", business: "未开始", display: true, signup: true, configDone: 4, configTotal: 8, host: "泉州时尚周组委会", organizer: "品牌合作部", support: "福建省纺织服装协会", guide: "泉州市工业和信息化局", desc: "设计师品牌新品展示与发布。", media: { images: 2, videos: 0, cover: "品牌发布封面图" } },
    { id: 701, projectId: 7, type: "配套活动", name: "产业合作采购洽谈会", place: "滨江会议中心 2F", start: "2026-11-23 14:00", end: "2026-11-23 17:00", budget: "120,000", status: "已上架", business: "未开始", display: true, signup: false, configDone: 4, configTotal: 8, host: "泉州时尚周组委会", organizer: "招商合作部", support: "泉州产业投资联盟", guide: "泉州市招商办", desc: "采购商、品牌方和供应链企业的合作洽谈活动。", media: { images: 1, videos: 0, cover: "洽谈会展示图" } },
    { id: 9001, projectId: 900, type: "自主策划", name: "主论坛暨新品发布", place: "主会场", start: "2026-09-18 09:00", end: "2026-09-18 17:30", budget: "520,000", status: "未发布", business: "未开始", display: false, signup: false, configDone: 6, configTotal: 8, host: "品尚征信", organizer: "智能活动运营组", support: "福州市数字经济协会", guide: "福建省数据管理局", desc: "后台保留的旧模拟活动，用于展示多活动样例。", media: { images: 3, videos: 1, cover: "主论坛会场封面图" } }
  ],
  sessions: [
    { id: 1, activityId: 101, name: "开幕式", lineType: "主线", lineName: "主线", start: "09:00", end: "09:40", place: "主会场", order: 1, status: "正常", seat: "已确认", resource: "已配置" },
    { id: 2, activityId: 101, name: "开幕大秀", lineType: "主线", lineName: "主线", start: "09:50", end: "11:30", place: "主秀场", order: 2, status: "正常", seat: "待确认", resource: "配置中" },
    { id: 3, activityId: 101, name: "设计师品牌展演", lineType: "并行线", lineName: "品牌展演", start: "14:00", end: "15:30", place: "6号馆 A区", order: 1, status: "正常", seat: "未配置", resource: "仅登记" },
    { id: 4, activityId: 101, name: "面料趋势沙龙", lineType: "并行线", lineName: "趋势沙龙", start: "14:00", end: "15:30", place: "6号馆 B区", order: 1, status: "正常", seat: "未开启", resource: "无需求" },
    { id: 5, activityId: 101, name: "品牌交流酒会", lineType: "主线", lineName: "主线", start: "16:00", end: "17:00", place: "海丝艺术中心", order: 3, status: "正常", seat: "未开启", resource: "待配置" },
    { id: 6, activityId: 401, name: "趋势发布开场", lineType: "主线", lineName: "主线", start: "09:30", end: "09:45", place: "A 馆发布厅", order: 1, status: "正常", seat: "已确认", resource: "已配置" },
    { id: 7, activityId: 401, name: "面料趋势主题发布", lineType: "主线", lineName: "主线", start: "09:50", end: "10:40", place: "A 馆发布厅", order: 2, status: "正常", seat: "已确认", resource: "已配置" },
    { id: 8, activityId: 401, name: "创新材料展示交流", lineType: "主线", lineName: "主线", start: "10:50", end: "12:00", place: "A 馆展示区", order: 3, status: "正常", seat: "未开启", resource: "已配置" }
  ],
  members: [
    { id: 1, name: "陈明远", gender: "男", region: "中国大陆", native: "福建福州", certType: "身份证", certNo: "350102198903120031", company: "泉州鲤城服饰有限公司", title: "副总经理", contact: "13800001234 / 0591-87560001", email: "chen@example.com", lang: "中文", status: "启用" },
    { id: 2, name: "林若溪", gender: "女", region: "中国大陆", native: "福建厦门", certType: "身份证", certNo: "350203199205082428", company: "海丝面料研究中心", title: "产品负责人", contact: "13800001234 / 0592-55670002", email: "lin@example.com", lang: "中文", status: "启用" },
    { id: 3, name: "Michael Tan", gender: "男", region: "新加坡", native: "-", certType: "护照", certNo: "E73088211", company: "Tan Fashion Partners", title: "Partner", contact: "13900005678 / +65 6123 7788", email: "mtan@example.sg", lang: "英文", status: "启用" },
    { id: 4, name: "王婧妍", gender: "女", region: "中国大陆", native: "福建泉州", certType: "身份证", certNo: "350503199103186226", company: "泉州时尚买手联盟", title: "渠道经理", contact: "13800001234 / 0595-88120006", email: "wang@example.com", lang: "中文", status: "启用" },
    { id: 5, name: "许嘉诚", gender: "男", region: "中国大陆", native: "福建晋江", certType: "身份证", certNo: "350582198811093817", company: "晋江品牌供应链协会", title: "秘书长", contact: "13800001234 / 0595-85760008", email: "xu@example.com", lang: "中文", status: "启用" },
    { id: 6, name: "周曼宁", gender: "女", region: "中国大陆", native: "福建石狮", certType: "身份证", certNo: "350581199606214529", company: "石狮服装设计服务中心", title: "设计总监", contact: "13800001234 / 0595-88990012", email: "zhou@example.com", lang: "中文", status: "启用" }
  ],
  resources: [
    { id: 1, type: "用车", scene: "到达接送", name: "机场接送一号车", source: "活动资源台账新建", requirement: "开幕大秀 / 嘉宾到达接送", time: "2026-11-17 20:30", place: "泉州晋江国际机场", people: 2, vehicle: "闽C D2638", driver: "许师傅 139****8621", status: "正常" },
    { id: 5, type: "用车", scene: "到达接送", name: "机场接送二号车", source: "活动资源台账新建", requirement: "开幕大秀 / 嘉宾到达接送", time: "2026-11-17 20:45", place: "泉州晋江国际机场", people: 1, vehicle: "闽C F9106", driver: "林师傅 138****7712", status: "正常" },
    { id: 2, type: "用餐", scene: "活动保障", name: "嘉宾午餐", source: "直接新增", requirement: "活动通用", time: "2026-11-18 12:00", place: "海丝艺术中心宴会厅", people: 24, vehicle: "-", driver: "-", status: "正常" },
    { id: 3, type: "物料", scene: "活动资源台账", name: "桌牌与手卡", source: "活动资源台账新建", requirement: "设计师品牌展演 / 桌牌与手卡", time: "2026-11-18", place: "主秀场", people: 0, vehicle: "-", driver: "-", status: "正常" },
    { id: 4, type: "住宿", scene: "活动保障", name: "嘉宾酒店双床房", source: "直接新增", requirement: "活动通用", time: "2026-11-17 至 2026-11-20", place: "泉州迎宾馆", people: 18, vehicle: "-", driver: "-", status: "正常" }
  ],
  invitations: [
    { id: "B20261118001", activity: "泉州纺织服装时尚周开幕秀", template: "正式邀请函模板", count: 86, generated: 82, failed: 4, notify: "未提醒", time: "2026-08-07 15:42" },
    { id: "B20261119002", activity: "品牌买手对接会", template: "贵宾邀请函模板", count: 36, generated: 36, failed: 0, notify: "已提醒", time: "2026-08-07 16:20" }
  ],
  seating: [
    { id: "S-101-01", activity: "泉州纺织服装时尚周开幕秀", session: "开幕大秀", venue: "主秀场 A 区", status: "待确认", savedBy: "运营人员A", savedAt: "2026-08-07 14:20" },
    { id: "S-101-02", activity: "泉州纺织服装时尚周开幕秀", session: "开幕式", venue: "主秀场 A 区", status: "已确认", savedBy: "运营人员A", savedAt: "2026-08-06 18:10" },
    { id: "S-101-03", activity: "泉州纺织服装时尚周开幕秀", session: "设计师品牌展演", venue: "6号馆 A区", status: "未配置", savedBy: "-", savedAt: "-" }
  ],
  messages: [
    { id: 1, type: "邀请函提醒", target: "82 人", channel: "站内信+短信", status: "待发送", object: "泉州纺织服装时尚周开幕秀", time: "2026-08-07 16:25" },
    { id: 2, type: "座位通知", target: "64 人", channel: "站内信+短信", status: "发送成功", object: "开幕式", time: "2026-08-06 18:22" },
    { id: 3, type: "报名审核通过", target: "陈明远", channel: "站内信+短信", status: "发送失败", object: "泉州纺织服装时尚周开幕秀", time: "2026-08-05 11:05" }
  ]
};
