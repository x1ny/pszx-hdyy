/**
 * 排位占用的纯视觉模型。
 *
 * 不 import 服务端类型，也不写回布局/团体主档。当前 SVG 画布和后续 JPG 导出只要
 * 把接口行投影成这里的输入，就能共享完全相同的标签、颜色与缩放截断口径。
 */

export type SeatOccupantVisualInput = {
  occupantType: "person" | "organization";
  memberName: string | null;
  organizationId: number | null;
  organizationName: string | null;
};

export type SeatOccupantColor = {
  fill: string;
  stroke: string;
  foreground: string;
};

export type SeatOccupantVisual = {
  kind: "person" | "organization";
  /** 个人为姓名，团体占位为团体名称；绝不拿团体名冒充个人姓名。 */
  primaryLabel: string;
  organizationId?: number;
  organizationName?: string;
  color: SeatOccupantColor;
};

export type OrganizationSeatLegendItem = {
  organizationId: number;
  organizationName: string;
  color: SeatOccupantColor;
};

/** 无团体个人保持既有默认占用样式。 */
export const DEFAULT_OCCUPIED_COLOR: SeatOccupantColor = {
  fill: "var(--primary)",
  stroke: "var(--primary)",
  foreground: "var(--primary-foreground)",
};

/** CSS 变量无法写入导出 SVG 时，无团体个人沿用既有的导出品牌蓝。 */
export const DEFAULT_OCCUPIED_EXPORT_COLOR: SeatOccupantColor = {
  fill: "#2563EB",
  stroke: "#2563EB",
  foreground: "#FFFFFF",
};

/**
 * 固定、确定性的色板。颜色只由稳定正整数 organizationId 决定，不存数据库；
 * fill 用于座位/图例色块，stroke 用于右侧团体小字。fill 以相近的 OkLCh 感知
 * 明度控制视觉权重，并把最常见的前三槽排成产品参考图里的绿、橙、紫；stroke
 * 是同色相的深色文字阶，在白底上均满足 4.5:1。相邻槽位刻意跨色相排列，且
 * 排除无团体个人的品牌蓝，避免不同业务含义看起来像同一类。
 */
export const ORGANIZATION_SEAT_PALETTE = [
  { fill: "#1EAB53", stroke: "#27713D", foreground: "#FFFFFF" },
  { fill: "#D18500", stroke: "#865400", foreground: "#FFFFFF" },
  { fill: "#9F75E1", stroke: "#6A5095", foreground: "#FFFFFF" },
  { fill: "#DA637A", stroke: "#934252", foreground: "#FFFFFF" },
  { fill: "#00A598", stroke: "#007067", foreground: "#FFFFFF" },
  { fill: "#AF8A00", stroke: "#765D00", foreground: "#FFFFFF" },
  { fill: "#C16ABA", stroke: "#82477E", foreground: "#FFFFFF" },
  { fill: "#7C9217", stroke: "#59690F", foreground: "#FFFFFF" },
  { fill: "#0097AA", stroke: "#006D7B", foreground: "#FFFFFF" },
  { fill: "#D05F43", stroke: "#944633", foreground: "#FFFFFF" },
  { fill: "#B86797", stroke: "#8B446F", foreground: "#FFFFFF" },
  { fill: "#B97340", stroke: "#8F4D16", foreground: "#FFFFFF" },
] as const satisfies readonly SeatOccupantColor[];

export function organizationSeatColor(organizationId: number) {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return DEFAULT_OCCUPIED_COLOR;
  }
  return ORGANIZATION_SEAT_PALETTE[
    (organizationId - 1) % ORGANIZATION_SEAT_PALETTE.length
  ];
}

export function buildSeatOccupantVisual(
  input: SeatOccupantVisualInput,
): SeatOccupantVisual {
  const hasOrganization =
    input.organizationId !== null &&
    Number.isSafeInteger(input.organizationId) &&
    input.organizationId > 0;
  const organizationName = input.organizationName?.trim() || undefined;
  const organizationId = hasOrganization
    ? (input.organizationId ?? undefined)
    : undefined;
  const organizationColor = organizationId
    ? organizationSeatColor(organizationId)
    : DEFAULT_OCCUPIED_COLOR;

  if (input.occupantType === "organization") {
    return {
      kind: "organization",
      primaryLabel: organizationName ?? "",
      organizationId,
      organizationName,
      color: organizationColor,
    };
  }

  return {
    kind: "person",
    primaryLabel: input.memberName?.trim() ?? "",
    organizationId,
    organizationName,
    color: organizationColor,
  };
}

export function organizationSeatLegend(
  occupants: Iterable<SeatOccupantVisual | undefined>,
) {
  const byOrganization = new Map<number, OrganizationSeatLegendItem>();
  for (const occupant of occupants) {
    if (
      !occupant?.organizationId ||
      !occupant.organizationName ||
      byOrganization.has(occupant.organizationId)
    ) {
      continue;
    }
    byOrganization.set(occupant.organizationId, {
      organizationId: occupant.organizationId,
      organizationName: occupant.organizationName,
      color: organizationSeatColor(occupant.organizationId),
    });
  }
  return [...byOrganization.values()].sort(
    (left, right) => left.organizationId - right.organizationId,
  );
}

const truncateLabel = (label: string, maxLength: number) =>
  label.length > maxLength
    ? `${label.slice(0, Math.max(1, maxLength - 1))}…`
    : label;

export type SeatOccupantLabelLayout = {
  primaryLabel: string;
  primaryFontSize: number;
  showSeatLabel: boolean;
};

/**
 * 缩小时更积极截断姓名/团体占位名；放大时限制屏幕字号继续膨胀。
 * 返回世界坐标字号，SVG 和位图导出可用各自 viewportScale 得到同一视觉层级。
 */
export function seatOccupantLabelLayout(
  occupant: SeatOccupantVisual,
  viewportScale: number,
): SeatOccupantLabelLayout {
  const safeScale =
    Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1;
  const tiny = safeScale < 0.55;
  const compact = safeScale < 0.9;
  const fontScale = Math.min(1.3, Math.max(0.6, safeScale));

  return {
    primaryLabel: truncateLabel(
      occupant.primaryLabel,
      tiny ? 4 : compact ? 6 : 10,
    ),
    primaryFontSize: 9 / fontScale,
    showSeatLabel: safeScale >= 0.55,
  };
}
