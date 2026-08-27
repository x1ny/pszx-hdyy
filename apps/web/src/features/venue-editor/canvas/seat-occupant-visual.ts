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
  /** 只会出现在有团体的个人座位上。 */
  secondaryLabel?: string;
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

/**
 * 固定、确定性的色板。颜色只由稳定正整数 organizationId 决定，不存数据库；
 * fill 用于座位/图例色块，stroke 用于团体次级文字和轮廓。
 */
export const ORGANIZATION_SEAT_PALETTE = [
  { fill: "#2563EB", stroke: "#1D4ED8", foreground: "#FFFFFF" },
  { fill: "#7C3AED", stroke: "#6D28D9", foreground: "#FFFFFF" },
  { fill: "#DB2777", stroke: "#BE185D", foreground: "#FFFFFF" },
  { fill: "#DC2626", stroke: "#B91C1C", foreground: "#FFFFFF" },
  { fill: "#C2410C", stroke: "#9A3412", foreground: "#FFFFFF" },
  { fill: "#A16207", stroke: "#854D0E", foreground: "#FFFFFF" },
  { fill: "#15803D", stroke: "#166534", foreground: "#FFFFFF" },
  { fill: "#0F766E", stroke: "#115E59", foreground: "#FFFFFF" },
  { fill: "#0E7490", stroke: "#155E75", foreground: "#FFFFFF" },
  { fill: "#4F46E5", stroke: "#4338CA", foreground: "#FFFFFF" },
  { fill: "#9333EA", stroke: "#7E22CE", foreground: "#FFFFFF" },
  { fill: "#BE123C", stroke: "#9F1239", foreground: "#FFFFFF" },
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
    secondaryLabel: organizationName,
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
  secondaryLabel?: string;
  primaryFontSize: number;
  secondaryFontSize: number;
  showSeatLabel: boolean;
};

/**
 * 缩小时保留主标签、隐藏次级团体名并更积极截断；放大时限制屏幕字号继续膨胀。
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
    secondaryLabel:
      tiny || !occupant.secondaryLabel
        ? undefined
        : truncateLabel(occupant.secondaryLabel, compact ? 8 : 12),
    primaryFontSize: 9 / fontScale,
    secondaryFontSize: 6.5 / fontScale,
    showSeatLabel: safeScale >= 0.55,
  };
}
