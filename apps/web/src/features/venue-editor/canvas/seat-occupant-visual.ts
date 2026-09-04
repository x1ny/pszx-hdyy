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

/** 超长标签截断，`maxLength` 含省略号本身。 */
export const truncateSeatText = (label: string, maxLength: number) =>
  label.length > maxLength
    ? `${label.slice(0, Math.max(1, maxLength - 1))}…`
    : label;

/**
 * 座位的呈现规格。**每一个数都是屏幕像素**，调用方按自己的缩放倍率换算成
 * 世界坐标（除以 scale）。
 *
 * 这条分界线是整份修复的核心：**位置属于世界坐标，尺寸属于屏幕坐标**。
 * 以前半径和字号都写死在世界坐标里，缩放时标签宽度和座距同比例变化，
 * 比值恒定——所以放大永远不解决重叠。把尺寸搬到屏幕坐标之后，放大只让
 * 座距变宽、字不跟着长，重叠才真的会消失。
 */
export type SeatRenderSpec = {
  /** 座位符号半径 */
  radiusPx: number;
  /**
   * 命中半径。**永远不小于视觉半径**——看得见的地方就点得中。
   *
   * 同时保证一个最小可点尺寸：密集区域圆点会缩成 2px 的点，但那时候仍然要
   * 点得动。允许它超过半个座距、和邻座的命中圈重叠，因为 `hitSeat` 取的是
   * **最近**的那个，重叠只会让"点在两座中间"落到更近的一边，不会选错。
   */
  hitRadiusPx: number;
  /** 姓名**每行**最多渲染几个字符（含省略号）；0 表示这一档不画姓名 */
  nameChars: number;
  /** 姓名最多折几行。纵向还空着时允许折成两行，横向写不下的字接着往下写。 */
  nameLines: number;
  nameFontPx: number;
  /** 姓名行高 */
  nameLineHeightPx: number;
  /** 姓名第一行基线到圆心的距离 */
  nameOffsetPx: number;
  /** 座位编号最多几个字符；0 表示不画 */
  seatLabelChars: number;
  seatLabelFontPx: number;
};

/**
 * 姓名折行。中文按字数切，不找词边界——座位标签这个尺度上没有必要。
 *
 * 整个名字放得下时**均分到各行**，而不是先把第一行塞满：
 * "泉州市纺织服装商会" 按塞满切会得到 "泉州市纺织服装商 / 会"，
 * 末行吊着一个字很难看；均分成 "泉州市纺织 / 服装商会" 才像话。
 * 放不下时才退回"前几行填满、末行截断"。
 */
export function wrapSeatName(
  label: string,
  charsPerLine: number,
  maxLines: number,
): string[] {
  if (!label || charsPerLine <= 0 || maxLines <= 0) return [];
  if (label.length <= charsPerLine) return [label];
  if (maxLines === 1) return [truncateSeatText(label, charsPerLine)];

  const lines: string[] = [];
  if (label.length <= charsPerLine * maxLines) {
    const perLine = Math.ceil(label.length / maxLines);
    for (let start = 0; start < label.length; start += perLine) {
      lines.push(label.slice(start, start + perLine));
    }
    return lines;
  }

  let rest = label;
  while (lines.length < maxLines - 1) {
    lines.push(rest.slice(0, charsPerLine));
    rest = rest.slice(charsPerLine);
  }
  lines.push(truncateSeatText(rest, charsPerLine));
  return lines;
}

/**
 * 姓名可读所需的最小屏幕座距：3 个汉字（12px 字号）加 4px 间隙。
 * 「放大到姓名可读」按钮就是把视口缩放到 `这个值 / 世界座距`。
 */
export const NAME_READABLE_PITCH_PX = 40;

/**
 * 最小可点尺寸（屏幕像素）。鼠标按 12px 给——密集区域座位缩成 2px 的点之后
 * 仍然要点得动，不能让"看得见"和"点得中"一起消失。
 */
export const MIN_TOUCH_TARGET_PX = 12;

/** 一行字在给定座距里塞得下几个汉字——留 4px 不让相邻标签贴脸。 */
const charsThatFit = (pitchPx: number, fontPx: number) =>
  Math.floor((pitchPx - 4) / fontPx);

/**
 * 响应式呈现阶梯。输入只有一个数：**相邻座位在屏幕上差多少像素**。
 *
 * 没有任何"魔法变换"——不挪座位、不改间距、不对不同元素用不同的缩放。
 * 整张图始终等比缩放，这里只决定"在当前这个密度下画得下什么"，
 * 和 CSS 的响应式断点是同一回事。
 */
export function seatRenderSpec(screenPitchPx: number): SeatRenderSpec {
  const pitch =
    Number.isFinite(screenPitchPx) && screenPitchPx > 0 ? screenPitchPx : 1;

  /**
   * 符号半径 = 座距的固定比例，**有上限、没有下限**。
   *
   * 上限 12px：座位图是示意图不是等比测绘图，圆点长到一定程度就没有更多
   * 信息量了，再大只会挤占标签的位置。代价是屏幕座距超过 40px 之后半径
   * 钉死——那一段里放大画布圆点不再跟着变大，这是明确接受的取舍。
   *
   * 不设下限：缩小方向一路等比缩下去，缩得很远时圆点接近消失。那个尺度上
   * 本来也不该看清单个座位，硬撑一个最小尺寸反而会让密集区域糊成一片。
   *
   * `pitch` 已含缩放倍率，所以在上限以下时换算回世界坐标是常量——
   * 那一段里圆点严格跟着画布等比缩放。
   */
  const radiusPx = Math.min(12, pitch * 0.3);

  /**
   * 能写几个字**只由座距决定**，不设固定上限。
   *
   * 这里曾经有个 `Math.min(6, …)`，结果是座位之间明明还空着一大片，
   * "泉州市纺织服装商会" 照样被砍成 "泉州市纺织…"。那个 6 没有任何依据——
   * 会不会撞到邻座，`charsThatFit` 已经算准了，再压一道只会白白截断。
   */
  const nameFontPx =
    pitch >= 60 ? 13 : pitch >= NAME_READABLE_PITCH_PX ? 12 : 11;
  const nameFit = charsThatFit(pitch, nameFontPx);
  // 少于 3 个字的姓名（"张…"）没有信息量，不如不画，让颜色和悬停去承担。
  const nameChars = nameFit >= 3 ? nameFit : 0;

  const seatLabelFontPx = pitch >= NAME_READABLE_PITCH_PX ? 9 : 8;
  const seatLabelFit = charsThatFit(pitch, seatLabelFontPx);
  const seatLabelChars = seatLabelFit >= 2 ? seatLabelFit : 0;

  const nameLineHeightPx = nameFontPx * 1.15;
  const nameOffsetPx = radiusPx + nameFontPx * 0.92 + 2;

  /**
   * 纵向还剩多少地方，决定姓名折不折第二行。
   *
   * 预算按最坏情况算：正下方那个座位如果也排了人，它的**编号在圆点上方**
   * （见 canvas-view 的 seatLabel），所以第二行不能越过 `座距 - 半径 - 编号高度`。
   * `pitch` 取的是最近邻距离，是纵向间距的下界，用它当预算天然保守，
   * 宁可少折一行也不越界。
   */
  const secondLineBottom = nameOffsetPx + nameLineHeightPx;
  const nextRowTop = pitch - radiusPx - seatLabelFontPx - 4;
  const nameLines = nameChars > 0 && secondLineBottom <= nextRowTop ? 2 : 1;

  return {
    radiusPx,
    hitRadiusPx: Math.max(radiusPx, MIN_TOUCH_TARGET_PX),
    nameChars,
    nameLines,
    nameFontPx: nameChars > 0 ? nameFontPx : 0,
    nameLineHeightPx,
    nameOffsetPx,
    seatLabelChars,
    seatLabelFontPx,
  };
}

/**
 * 把缩放倍率换算成"想要多大屏幕座距"所需的缩放。
 * 世界座距为 0（只有一个座位）时返回 1，不做无意义的缩放。
 */
export const scaleForPitch = (worldPitch: number, targetPitchPx: number) =>
  worldPitch > 0 ? targetPitchPx / worldPitch : 1;

/**
 * 把一个排位方案的座位和分配翻译成画布/导出图认识的 `seatStatus`。
 *
 * 抽出来是因为有了第二个消费方：环节配置页要在页面里嵌一张**只读**的座位图。
 * 两边各写一遍的话，"停用的位置画不画成灰的""团体占位用哪个颜色"这类判断迟早
 * 分叉，然后同一个方案在两个页面上长得不一样。
 */
export function buildPlanSeatStatus(input: {
  seats: readonly {
    id: number;
    externalId: string;
    enabled: boolean;
  }[];
  assignments: readonly {
    segmentSeatId: number;
    occupantType: SeatOccupantVisualInput["occupantType"];
    memberName: SeatOccupantVisualInput["memberName"];
    organizationId: SeatOccupantVisualInput["organizationId"];
    organizationName: SeatOccupantVisualInput["organizationName"];
  }[];
}): ReadonlyMap<string, { occupant?: SeatOccupantVisual; disabled?: boolean }> {
  const bySeatId = new Map(
    input.assignments.map((row) => [row.segmentSeatId, row]),
  );

  const map = new Map<
    string,
    { occupant?: SeatOccupantVisual; disabled?: boolean }
  >();

  for (const seat of input.seats) {
    const assignment = bySeatId.get(seat.id);
    map.set(seat.externalId, {
      occupant: assignment
        ? buildSeatOccupantVisual({
            occupantType: assignment.occupantType,
            memberName: assignment.memberName,
            organizationId: assignment.organizationId,
            organizationName: assignment.organizationName,
          })
        : undefined,
      disabled: !seat.enabled,
    });
  }

  return map;
}
