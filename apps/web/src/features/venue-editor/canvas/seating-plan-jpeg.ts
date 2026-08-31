import type { CanvasDoc, CanvasSeat, CanvasZone } from "./core/document";
import {
  DEFAULT_OCCUPIED_EXPORT_COLOR,
  type OrganizationSeatLegendItem,
  organizationSeatLegend,
  type SeatOccupantColor,
  type SeatOccupantVisual,
  seatOccupantLabelLayout,
} from "./seat-occupant-visual";

export const SEATING_PLAN_JPEG_MIME = "image/jpeg";
export const SEATING_PLAN_JPEG_EXTENSION = ".jpg";
export const SEATING_PLAN_JPEG_QUALITY = 0.92;

const SVG_MIME = "image/svg+xml;charset=utf-8";
const EXPORT_FONT_FAMILY =
  "Inter Variable, Microsoft YaHei, PingFang SC, Arial, sans-serif";
const PAGE_PADDING = 64;
const HEADER_HEIGHT = 76;
const LEGEND_GAP = 36;
const LEGEND_TITLE_HEIGHT = 28;
const LEGEND_ROW_HEIGHT = 28;
const LEGEND_ITEM_GAP = 24;
const LEGEND_SWATCH_SIZE = 14;
const MIN_CONTENT_WIDTH = 640;
const SEAT_RADIUS = 9;

const EXPORT_COLORS = {
  background: "#FFFFFF",
  border: "#CBD5E1",
  emptySeatBorder: "#BFDBFE",
  foreground: "#0F172A",
  mutedForeground: "#64748B",
  primary: DEFAULT_OCCUPIED_EXPORT_COLOR.fill,
  primaryForeground: DEFAULT_OCCUPIED_EXPORT_COLOR.foreground,
  vip: "#D97706",
} as const;

export type SeatingPlanExportSeatStatus = {
  occupant?: SeatOccupantVisual;
  disabled?: boolean;
};

export type SeatingPlanSvgInput = {
  doc: CanvasDoc;
  seatStatus?: ReadonlyMap<string, SeatingPlanExportSeatStatus>;
  title: string;
  subtitle?: string;
};

export type SeatingPlanJpegInput = SeatingPlanSvgInput & {
  segmentName: string;
  zoneName: string;
};

export type SeatingPlanRasterLimits = {
  desiredScale: number;
  maxDimension: number;
  maxPixels: number;
  minReadableScale: number;
};

export type SeatingPlanRasterPlan = {
  logicalWidth: number;
  logicalHeight: number;
  width: number;
  height: number;
  scale: number;
  downsampled: boolean;
};

export type SeatingPlanSvgDocument = {
  svg: string;
  raster: SeatingPlanRasterPlan;
};

export type SeatingPlanJpegRasterizeInput = {
  width: number;
  height: number;
  mimeType: typeof SEATING_PLAN_JPEG_MIME;
  quality: number;
};

export type SeatingPlanJpegBridge = {
  waitForFonts: () => Promise<void>;
  rasterize: (
    svg: string,
    input: SeatingPlanJpegRasterizeInput,
  ) => Promise<Blob>;
  saveFile: (blob: Blob, fileName: string) => void;
};

export type SeatingPlanJpegResult = {
  blob: Blob;
  fileName: string;
  mimeType: typeof SEATING_PLAN_JPEG_MIME;
  raster: SeatingPlanRasterPlan;
};

export const DEFAULT_SEATING_PLAN_RASTER_LIMITS = {
  desiredScale: 2,
  maxDimension: 8192,
  maxPixels: 24_000_000,
  minReadableScale: 0.75,
} as const satisfies SeatingPlanRasterLimits;

type SeatingPlanJpegOptions = {
  bridge?: SeatingPlanJpegBridge;
  now?: Date;
  rasterLimits?: Partial<SeatingPlanRasterLimits>;
};

type LegendItem = {
  key: string;
  label: string;
  fill: string;
  stroke: string;
  kind: "empty" | "occupied" | "vip" | "disabled" | "organization";
  organizationId?: number;
};

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function finiteNumber(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(3)).toString() : "0";
}

function exportColor(color: string, fallback: string): string {
  return /^#[\da-f]{6}$/i.test(color) ? color : fallback;
}

function resolveOccupantColor(color: SeatOccupantColor): SeatOccupantColor {
  return {
    fill: exportColor(color.fill, EXPORT_COLORS.primary),
    stroke: exportColor(color.stroke, EXPORT_COLORS.primary),
    foreground: exportColor(color.foreground, EXPORT_COLORS.primaryForeground),
  };
}

function assertPositiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name}必须是大于 0 的有限数值`);
  }
}

export function planSeatingPlanRaster(
  logicalSize: { width: number; height: number },
  overrides: Partial<SeatingPlanRasterLimits> = {},
): SeatingPlanRasterPlan {
  const limits = { ...DEFAULT_SEATING_PLAN_RASTER_LIMITS, ...overrides };
  assertPositiveFinite(logicalSize.width, "导出宽度");
  assertPositiveFinite(logicalSize.height, "导出高度");
  assertPositiveFinite(limits.desiredScale, "目标清晰度");
  assertPositiveFinite(limits.maxDimension, "最大边长");
  assertPositiveFinite(limits.maxPixels, "最大像素数");
  assertPositiveFinite(limits.minReadableScale, "最小可读清晰度");

  const dimensionScale = Math.min(
    limits.maxDimension / logicalSize.width,
    limits.maxDimension / logicalSize.height,
  );
  const areaScale = Math.sqrt(
    limits.maxPixels / (logicalSize.width * logicalSize.height),
  );
  const scale = Math.min(limits.desiredScale, dimensionScale, areaScale);

  if (scale < limits.minReadableScale) {
    throw new Error(
      `排位画布过大（${Math.ceil(logicalSize.width)} × ${Math.ceil(logicalSize.height)}），` +
        "在浏览器安全像素上限内无法保证文字可读，请缩小活动区域后重试",
    );
  }

  const width = Math.max(1, Math.floor(logicalSize.width * scale));
  const height = Math.max(1, Math.floor(logicalSize.height * scale));

  return {
    logicalWidth: logicalSize.width,
    logicalHeight: logicalSize.height,
    width,
    height,
    scale,
    downsampled: scale < limits.desiredScale,
  };
}

function renderZone(zone: CanvasZone): string {
  const shape = zone.shape;
  const fill = exportColor(zone.fill, "#E2E8F0");
  const stroke = exportColor(zone.stroke, EXPORT_COLORS.border);
  const common = `fill="${fill}" fill-opacity="0.14" stroke="${stroke}" stroke-width="2"`;
  let geometry: string;

  if (shape.type === "ellipse") {
    geometry = `<ellipse cx="${finiteNumber(shape.x + shape.width / 2)}" cy="${finiteNumber(shape.y + shape.height / 2)}" rx="${finiteNumber(shape.width / 2)}" ry="${finiteNumber(shape.height / 2)}" ${common}/>`;
  } else if (shape.type === "polygon") {
    const points = shape.points
      .map(
        (point) =>
          `${finiteNumber(shape.x + point.x)},${finiteNumber(shape.y + point.y)}`,
      )
      .join(" ");
    geometry = `<polygon points="${points}" ${common}/>`;
  } else {
    geometry = `<rect x="${finiteNumber(shape.x)}" y="${finiteNumber(shape.y)}" width="${finiteNumber(shape.width)}" height="${finiteNumber(shape.height)}" ${common}/>`;
  }

  return `<g data-export-zone-id="${escapeXml(zone.externalId)}">
    ${geometry}
    <text x="${finiteNumber(shape.x + 12)}" y="${finiteNumber(shape.y + 22)}" font-size="14" font-weight="650" fill="${EXPORT_COLORS.foreground}">${escapeXml(zone.name)}</text>
  </g>`;
}

function occupantTitle(occupant: SeatOccupantVisual): string {
  return occupant.kind === "organization"
    ? occupant.primaryLabel
    : [occupant.primaryLabel, occupant.organizationName]
        .filter(Boolean)
        .join(" · ");
}

function renderSeat(
  seat: CanvasSeat,
  zone: CanvasZone,
  status: SeatingPlanExportSeatStatus | undefined,
): string {
  const cx = zone.shape.x + seat.x;
  const cy = zone.shape.y + seat.y;
  const occupant = status?.occupant;
  const disabled = status?.disabled === true;
  const vip = seat.rank === "vip";
  const occupied = occupant !== undefined;
  const color = occupant ? resolveOccupantColor(occupant.color) : undefined;
  const fill =
    color?.fill ?? (vip ? EXPORT_COLORS.vip : EXPORT_COLORS.background);
  const stroke = occupied ? "none" : EXPORT_COLORS.emptySeatBorder;
  const labelLayout = occupant
    ? seatOccupantLabelLayout(occupant, 1)
    : undefined;
  const primaryLabelY = cy + SEAT_RADIUS + 10;
  const title = occupant
    ? `<title>${escapeXml(occupantTitle(occupant))}</title>`
    : "";
  const standingMarker =
    seat.kind === "standing"
      ? `<rect x="${finiteNumber(cx - 4)}" y="${finiteNumber(cy - 4)}" width="8" height="8" fill="none" stroke="${color?.foreground ?? EXPORT_COLORS.mutedForeground}" stroke-width="1.2"/>`
      : "";
  const disabledMarker = disabled
    ? `<line x1="${finiteNumber(cx - SEAT_RADIUS)}" y1="${finiteNumber(cy + SEAT_RADIUS)}" x2="${finiteNumber(cx + SEAT_RADIUS)}" y2="${finiteNumber(cy - SEAT_RADIUS)}" stroke="${EXPORT_COLORS.mutedForeground}" stroke-width="1.5"/>`
    : "";
  const seatLabel =
    !occupied || labelLayout?.showSeatLabel
      ? `<text data-export-seat-label="true" x="${finiteNumber(cx)}" y="${finiteNumber(occupied ? cy - SEAT_RADIUS - 4 : cy + SEAT_RADIUS + 9)}" text-anchor="middle" font-size="${occupied ? "6.5" : "9"}" fill="${EXPORT_COLORS.mutedForeground}">${escapeXml(seat.label)}</text>`
      : "";
  const primaryLabel = labelLayout?.primaryLabel
    ? `<text data-export-occupant-label="primary" x="${finiteNumber(cx)}" y="${finiteNumber(primaryLabelY)}" text-anchor="middle" font-size="${finiteNumber(labelLayout.primaryFontSize)}" fill="${EXPORT_COLORS.foreground}">${escapeXml(labelLayout.primaryLabel)}</text>`
    : "";

  return `<g data-export-seat-id="${escapeXml(seat.externalId)}" data-export-seat-occupant-kind="${occupant?.kind ?? "empty"}"${occupant?.organizationId ? ` data-export-seat-organization-id="${occupant.organizationId}"` : ""} opacity="${disabled ? "0.35" : "1"}">
    ${title}
    <circle cx="${finiteNumber(cx)}" cy="${finiteNumber(cy)}" r="${SEAT_RADIUS}" fill="${fill}" stroke="${stroke}" stroke-width="${occupied ? "0" : "1.2"}"/>
    ${standingMarker}${disabledMarker}${seatLabel}${primaryLabel}
  </g>`;
}

function legendItems(
  organizations: readonly OrganizationSeatLegendItem[],
): LegendItem[] {
  return [
    {
      key: "empty",
      label: "空闲",
      fill: EXPORT_COLORS.background,
      stroke: EXPORT_COLORS.emptySeatBorder,
      kind: "empty",
    },
    {
      key: "independent",
      label: "无团体个人",
      fill: EXPORT_COLORS.primary,
      stroke: EXPORT_COLORS.primary,
      kind: "occupied",
    },
    {
      key: "vip",
      label: "VIP",
      fill: EXPORT_COLORS.vip,
      stroke: EXPORT_COLORS.vip,
      kind: "vip",
    },
    {
      key: "disabled",
      label: "停用",
      fill: EXPORT_COLORS.background,
      stroke: EXPORT_COLORS.mutedForeground,
      kind: "disabled",
    },
    ...organizations.map((organization) => ({
      key: `organization-${organization.organizationId}`,
      label: organization.organizationName,
      fill: organization.color.fill,
      stroke: organization.color.stroke,
      kind: "organization" as const,
      organizationId: organization.organizationId,
    })),
  ];
}

function legendItemWidth(item: LegendItem): number {
  return LEGEND_SWATCH_SIZE + 8 + Math.max(24, item.label.length * 13);
}

function layoutLegend(items: readonly LegendItem[], width: number) {
  const rows: Array<Array<{ item: LegendItem; x: number }>> = [[]];
  let x = 0;
  for (const item of items) {
    const itemWidth = legendItemWidth(item);
    if (x > 0 && x + itemWidth > width) {
      rows.push([]);
      x = 0;
    }
    rows.at(-1)?.push({ item, x });
    x += itemWidth + LEGEND_ITEM_GAP;
  }
  return rows;
}

function renderLegendSwatch(item: LegendItem, x: number, y: number): string {
  const centerX = x + LEGEND_SWATCH_SIZE / 2;
  const centerY = y + LEGEND_SWATCH_SIZE / 2;
  const slash =
    item.kind === "disabled"
      ? `<line x1="${finiteNumber(x)}" y1="${finiteNumber(y + LEGEND_SWATCH_SIZE)}" x2="${finiteNumber(x + LEGEND_SWATCH_SIZE)}" y2="${finiteNumber(y)}" stroke="${EXPORT_COLORS.mutedForeground}" stroke-width="1.5"/>`
      : "";
  return `<g${item.organizationId ? ` data-export-legend-organization-id="${item.organizationId}"` : ""}>
    <circle cx="${finiteNumber(centerX)}" cy="${finiteNumber(centerY)}" r="${finiteNumber(LEGEND_SWATCH_SIZE / 2)}" fill="${item.fill}" stroke="${item.stroke}" stroke-width="1.2"/>
    ${slash}
    <text x="${finiteNumber(x + LEGEND_SWATCH_SIZE + 8)}" y="${finiteNumber(y + 11.5)}" font-size="12" fill="${EXPORT_COLORS.mutedForeground}">${escapeXml(item.label)}</text>
  </g>`;
}

export function buildSeatingPlanSvg(
  input: SeatingPlanSvgInput,
  rasterOverrides: Partial<SeatingPlanRasterLimits> = {},
): SeatingPlanSvgDocument {
  assertPositiveFinite(input.doc.world.width, "画布宽度");
  assertPositiveFinite(input.doc.world.height, "画布高度");

  const worldWidth = input.doc.world.width;
  const worldHeight = input.doc.world.height;
  const contentWidth = Math.max(MIN_CONTENT_WIDTH, worldWidth);
  const logicalWidth = contentWidth + PAGE_PADDING * 2;
  const worldX = PAGE_PADDING + (contentWidth - worldWidth) / 2;
  const worldY = PAGE_PADDING + HEADER_HEIGHT;
  const organizations = organizationSeatLegend(
    input.seatStatus?.values()
      ? [...input.seatStatus.values()].map((status) => status.occupant)
      : [],
  );
  const items = legendItems(organizations);
  const legendRows = layoutLegend(items, contentWidth);
  const legendY = worldY + worldHeight + LEGEND_GAP;
  const logicalHeight =
    legendY +
    LEGEND_TITLE_HEIGHT +
    legendRows.length * LEGEND_ROW_HEIGHT +
    PAGE_PADDING;
  const raster = planSeatingPlanRaster(
    { width: logicalWidth, height: logicalHeight },
    rasterOverrides,
  );
  const zonesById = new Map(
    input.doc.zones.map((zone) => [zone.externalId, zone]),
  );
  const zones = input.doc.zones.map(renderZone).join("\n");
  const seats = input.doc.seats
    .flatMap((seat) => {
      const zone = zonesById.get(seat.zoneExternalId);
      return zone
        ? [renderSeat(seat, zone, input.seatStatus?.get(seat.externalId))]
        : [];
    })
    .join("\n");
  const legend = legendRows
    .flatMap((row, rowIndex) =>
      row.map(({ item, x }) =>
        renderLegendSwatch(
          item,
          PAGE_PADDING + x,
          legendY + LEGEND_TITLE_HEIGHT + rowIndex * LEGEND_ROW_HEIGHT,
        ),
      ),
    )
    .join("\n");
  const subtitle = input.subtitle?.trim()
    ? `<text x="${PAGE_PADDING}" y="${PAGE_PADDING + 42}" font-size="13" fill="${EXPORT_COLORS.mutedForeground}">${escapeXml(input.subtitle.trim())}</text>`
    : "";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${raster.width}" height="${raster.height}" viewBox="0 0 ${finiteNumber(logicalWidth)} ${finiteNumber(logicalHeight)}" role="img" aria-label="${escapeXml(input.title)}">
  <style>text { font-family: ${EXPORT_FONT_FAMILY}; }</style>
  <rect data-export-background="true" x="0" y="0" width="${finiteNumber(logicalWidth)}" height="${finiteNumber(logicalHeight)}" fill="${EXPORT_COLORS.background}"/>
  <text x="${PAGE_PADDING}" y="${PAGE_PADDING + 20}" font-size="22" font-weight="700" fill="${EXPORT_COLORS.foreground}">${escapeXml(input.title)}</text>
  ${subtitle}
  <g data-export-world="true" transform="translate(${finiteNumber(worldX)} ${finiteNumber(worldY)})">
    <rect x="0" y="0" width="${finiteNumber(worldWidth)}" height="${finiteNumber(worldHeight)}" fill="${EXPORT_COLORS.background}" stroke="${EXPORT_COLORS.border}" stroke-width="1.5"/>
    ${zones}
    ${seats}
  </g>
  <g data-export-legend="true">
    <text x="${PAGE_PADDING}" y="${finiteNumber(legendY + 16)}" font-size="14" font-weight="650" fill="${EXPORT_COLORS.foreground}">图例</text>
    ${legend}
  </g>
</svg>`;

  return { svg, raster };
}

function safeFileNamePart(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/[\p{Cc}]/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return normalized || "未命名";
}

function localTimestamp(now: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function buildSeatingPlanJpegFileName(
  segmentName: string,
  zoneName: string,
  now = new Date(),
): string {
  const base = `${safeFileNamePart(segmentName)}-${safeFileNamePart(zoneName)}-排位图-${localTimestamp(now)}`;
  return `${base.slice(0, 180)}${SEATING_PLAN_JPEG_EXTENSION}`;
}

function browserUnavailableError() {
  return new Error("当前浏览器不支持排位图导出，请更换现代浏览器后重试");
}

export const browserSeatingPlanJpegBridge: SeatingPlanJpegBridge = {
  async waitForFonts() {
    if (typeof document === "undefined") throw browserUnavailableError();
    await document.fonts?.ready;
  },
  async rasterize(svg, input) {
    if (
      typeof document === "undefined" ||
      typeof Image === "undefined" ||
      typeof URL === "undefined"
    ) {
      throw browserUnavailableError();
    }

    const svgUrl = URL.createObjectURL(new Blob([svg], { type: SVG_MIME }));
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error("排位图矢量内容加载失败，请重试"));
        image.src = svgUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = input.width;
      canvas.height = input.height;
      const context = canvas.getContext("2d");
      if (!context) throw browserUnavailableError();

      context.fillStyle = EXPORT_COLORS.background;
      context.fillRect(0, 0, input.width, input.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, input.width, input.height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("浏览器生成 JPG 失败，请缩小活动区域后重试")),
          input.mimeType,
          input.quality,
        );
      });
      canvas.width = 1;
      canvas.height = 1;
      return blob;
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  },
  saveFile(blob, fileName) {
    if (typeof document === "undefined" || typeof URL === "undefined") {
      throw browserUnavailableError();
    }
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};

export async function createSeatingPlanJpeg(
  input: SeatingPlanJpegInput,
  options: SeatingPlanJpegOptions = {},
): Promise<SeatingPlanJpegResult> {
  const bridge = options.bridge ?? browserSeatingPlanJpegBridge;
  const document = buildSeatingPlanSvg(input, options.rasterLimits);
  await bridge.waitForFonts();
  const blob = await bridge.rasterize(document.svg, {
    width: document.raster.width,
    height: document.raster.height,
    mimeType: SEATING_PLAN_JPEG_MIME,
    quality: SEATING_PLAN_JPEG_QUALITY,
  });
  if (blob.type !== SEATING_PLAN_JPEG_MIME) {
    throw new Error("浏览器未能生成 JPEG 格式图片，请更换现代浏览器后重试");
  }
  return {
    blob,
    fileName: buildSeatingPlanJpegFileName(
      input.segmentName,
      input.zoneName,
      options.now,
    ),
    mimeType: SEATING_PLAN_JPEG_MIME,
    raster: document.raster,
  };
}

export async function downloadSeatingPlanJpeg(
  input: SeatingPlanJpegInput,
  options: SeatingPlanJpegOptions = {},
): Promise<SeatingPlanJpegResult> {
  const bridge = options.bridge ?? browserSeatingPlanJpegBridge;
  const result = await createSeatingPlanJpeg(input, { ...options, bridge });
  bridge.saveFile(result.blob, result.fileName);
  return result;
}
