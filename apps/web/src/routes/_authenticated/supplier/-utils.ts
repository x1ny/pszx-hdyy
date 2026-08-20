import type { ServiceCategory, SupplierStatus } from "./-queries";

// ---------------------------------------------------------------------------
// 中文标签只存在于前端。
//
// 服务端只管「这个字段允许哪些值」（modules/supplier/schema.ts 的枚举），
// 展示成什么字是前端的事。两边靠下面的 `satisfies Record<枚举, string>` 咬死：
// 服务端加一个类目，这里不补标签就编译不过；服务端删一个，这里的多余键也报错。
// 所以不存在「后端加了值、前端界面显示成英文 key」这种漂移。
// ---------------------------------------------------------------------------

export const SERVICE_CATEGORY_LABELS = {
  venue: "场地服务",
  catering: "餐饮服务",
  accommodation: "住宿安排",
  transport: "交通接驳",
  staging: "舞台搭建",
  lighting: "灯光音响",
  photography: "摄影摄像",
  makeup: "化妆造型",
  model: "模特礼仪",
  printing: "印刷物料",
  security: "安保服务",
  other: "其他",
} as const satisfies Record<ServiceCategory, string>;

export const SUPPLIER_STATUS_LABELS = {
  enabled: "启用",
  disabled: "停用",
} as const satisfies Record<SupplierStatus, string>;

/**
 * 服务类目标签的配色——从灰底黑字的 `variant="secondary"` 换成分类色板的浅底色字。
 *
 * 这不是数据可视化里「颜色编码身份」的场景（不需要过全量配对的色觉障碍校验）：
 * 12 个类目只有 5 个色板槽位，必然复用，但标签**永远跟文字一起出现**，颜色只是
 * 加速扫视、让「灯光音响」和「餐饮服务」一眼看着不是同一类，不是靠颜色单独区分。
 * 固定按 SERVICE_CATEGORY_VALUES 的声明顺序轮转分配，不用哈希——同一个类目
 * 永远是同一个颜色，改代码顺序才会变，不会因为换个浏览器/换次渲染就变色。
 */
export const CATEGORY_BADGE_CLASS = {
  venue: "border-transparent bg-chart-1/10 text-chart-1",
  catering: "border-transparent bg-chart-2/10 text-chart-2",
  accommodation: "border-transparent bg-chart-3/10 text-chart-3",
  transport: "border-transparent bg-chart-4/10 text-chart-4",
  staging: "border-transparent bg-chart-5/10 text-chart-5",
  lighting: "border-transparent bg-chart-1/10 text-chart-1",
  photography: "border-transparent bg-chart-2/10 text-chart-2",
  makeup: "border-transparent bg-chart-3/10 text-chart-3",
  model: "border-transparent bg-chart-4/10 text-chart-4",
  printing: "border-transparent bg-chart-5/10 text-chart-5",
  security: "border-transparent bg-chart-1/10 text-chart-1",
  other: "border-transparent bg-chart-2/10 text-chart-2",
} as const satisfies Record<ServiceCategory, string>;

/**
 * 状态芯片的配色。用的是**保留的状态色**，不是分类色板里的槽位 —— 一个颜色
 * 要么表示「哪一类」要么表示「什么状态」，两用了用户就没法从颜色反推含义。
 * 而且芯片永远带文字，颜色只是加速扫视，不单独承载信息（色觉障碍用户看得懂）。
 *
 * 「停用」用中性灰而不是红：它是「暂时不合作」，不是错误，红色会把它误报成故障。
 */
export const SUPPLIER_STATUS_CHIP = {
  enabled: "border-success/30 bg-success/10 text-success-foreground",
  disabled: "border-border bg-muted text-muted-foreground",
} as const satisfies Record<SupplierStatus, string>;

export const SUPPLIER_STATUS_DOT = {
  enabled: "bg-success",
  disabled: "bg-muted-foreground/40",
} as const satisfies Record<SupplierStatus, string>;

export const SERVICE_CATEGORY_VALUES = Object.keys(
  SERVICE_CATEGORY_LABELS,
) as ServiceCategory[];

export const SUPPLIER_STATUS_VALUES = Object.keys(
  SUPPLIER_STATUS_LABELS,
) as SupplierStatus[];

export const categoryLabel = (value: ServiceCategory) =>
  SERVICE_CATEGORY_LABELS[value] ?? value;

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 接口给的是 ISO 字符串（timestamptz 序列化的结果），按浏览器本地时区展示。 */
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTimeFormat.format(new Date(iso)) : "-";

/**
 * 列表里打码手机号。**这是排版，不是安全措施** —— 完整号码就在同一个响应体里，
 * 打开 devtools 就能看到。真要限制可见性，得在服务端按角色决定返不返这个字段。
 */
export const maskPhone = (phone: string) =>
  phone.length < 7 ? phone : `${phone.slice(0, 3)}****${phone.slice(-4)}`;

// ---------------------------------------------------------------------------
// 报价附件
// ---------------------------------------------------------------------------

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** 二进制单位（1024）。文件管理器显示的是这套，跟用户在本机看到的对得上。 */
export const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    FILE_SIZE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  // 字节数不显示小数（"1.0 B" 很怪），其余保留一位。
  return `${exponent === 0 ? value : value.toFixed(1)} ${FILE_SIZE_UNITS[exponent]}`;
};

/** 附件名里的扩展名，用来在图标位上标一眼「这是什么文件」。 */
export const fileExtension = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toUpperCase().slice(0, 4) : "文件";
};
