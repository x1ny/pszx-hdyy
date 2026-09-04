import { describe, expect, it, vi } from "vitest";
import type { CanvasDoc } from "./core/document";
import {
  buildSeatOccupantVisual,
  organizationSeatColor,
} from "./seat-occupant-visual";
import {
  buildSeatingPlanJpegFileName,
  buildSeatingPlanSvg,
  createSeatingPlanJpeg,
  downloadSeatingPlanJpeg,
  escapeXml,
  planSeatingPlanRaster,
  SEATING_PLAN_JPEG_MIME,
  type SeatingPlanExportSeatStatus,
  type SeatingPlanJpegBridge,
} from "./seating-plan-jpeg";

const doc: CanvasDoc = {
  schemaVersion: 1,
  world: { width: 520, height: 320 },
  zones: [
    {
      externalId: "zone-rect",
      name: "主会场 & 嘉宾区",
      kind: "seating",
      ordinal: 1,
      fill: "#E2E8F0",
      stroke: "#64748B",
      shape: { type: "rect", x: 20, y: 30, width: 180, height: 120 },
    },
    {
      externalId: "zone-ellipse",
      name: "圆桌区",
      kind: "seating",
      ordinal: 2,
      fill: "#DCFCE7",
      stroke: "#15803D",
      shape: {
        type: "ellipse",
        x: 240,
        y: 30,
        width: 120,
        height: 100,
      },
    },
    {
      externalId: "zone-polygon",
      name: "异形区",
      kind: "function",
      ordinal: 3,
      fill: "#FCE7F3",
      stroke: "#BE185D",
      shape: {
        type: "polygon",
        x: 390,
        y: 170,
        width: 100,
        height: 100,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 10 },
          { x: 70, y: 100 },
        ],
      },
    },
  ],
  seats: [
    {
      externalId: "seat-person",
      zoneExternalId: "zone-rect",
      label: "A&1",
      kind: "seat",
      rank: "normal",
      ordinal: 1,
      x: 50,
      y: 60,
    },
    {
      externalId: "seat-organization",
      zoneExternalId: "zone-rect",
      label: "A2",
      kind: "standing",
      rank: "normal",
      ordinal: 2,
      x: 105,
      y: 60,
    },
    {
      externalId: "seat-independent",
      zoneExternalId: "zone-ellipse",
      label: "B1",
      kind: "seat",
      rank: "vip",
      ordinal: 3,
      x: 60,
      y: 50,
    },
    {
      externalId: "seat-empty",
      zoneExternalId: "zone-polygon",
      label: "C1",
      kind: "seat",
      rank: "normal",
      ordinal: 4,
      x: 45,
      y: 50,
    },
  ],
};

const groupedPerson = buildSeatOccupantVisual({
  occupantType: "person",
  memberName: "林<&>\"'一",
  organizationId: 3,
  organizationName: "纺织 & 服装协会",
});
const organizationPlaceholder = buildSeatOccupantVisual({
  occupantType: "organization",
  memberName: "绝不能显示的虚构姓名",
  organizationId: 3,
  organizationName: "纺织 & 服装协会",
});
const independentPerson = buildSeatOccupantVisual({
  occupantType: "person",
  memberName: "无团体人员",
  organizationId: null,
  organizationName: null,
});

const seatStatus = new Map<string, SeatingPlanExportSeatStatus>([
  ["seat-person", { occupant: groupedPerson }],
  ["seat-organization", { occupant: organizationPlaceholder }],
  ["seat-independent", { occupant: independentPerson, disabled: true }],
]);

const jpegInput = {
  doc,
  seatStatus,
  title: "闭幕式 <最终排位>",
  subtitle: "完整活动区域",
  segmentName: "闭幕式:晚宴",
  zoneName: "主会场/全区",
};

describe("seating plan JPEG export", () => {
  it("完整转义 XML 文本和属性", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("从完整世界坐标生成独立 SVG，包含区域、座位、占用标签与去重图例", () => {
    const { svg, raster } = buildSeatingPlanSvg(jpegInput);

    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('data-export-background="true"');
    expect(svg).toContain('fill="#FFFFFF"');
    expect(svg).toContain('data-export-world="true"');
    expect(svg).toContain('width="520" height="320"');
    expect(svg).toContain("<ellipse");
    expect(svg).toContain("<polygon");
    expect(svg).toContain('points="390,170 490,180 460,270"');
    expect(svg).toContain('data-export-zone-id="zone-rect"');
    expect(svg).toContain("主会场 &amp; 嘉宾区");
    expect(svg).toContain("闭幕式 &lt;最终排位&gt;");
    expect(svg).toContain("A&amp;1");
    expect(svg).toContain("林&lt;&amp;&gt;&quot;&apos;一");
    expect(svg).toContain("纺织 &amp; 服装协会");
    expect(svg).toContain("无团体人员");
    expect(svg).toContain('data-export-seat-occupant-kind="organization"');
    expect(svg).not.toContain(">团</text>");
    expect(svg).not.toContain("绝不能显示的虚构姓名");
    expect(svg).toContain(organizationSeatColor(3).fill);
    expect(svg.match(/data-export-legend-organization-id="3"/g)).toHaveLength(
      1,
    );
    expect(svg).toContain("空闲");
    expect(svg).toContain("无团体个人");
    expect(svg).toContain("VIP");
    expect(svg).toContain("停用");
    expect(svg).not.toContain("selection");
    expect(svg).not.toContain("marquee");
    expect(svg).not.toContain("foreignObject");
    expect(svg).not.toContain("<button");
    expect(svg).toContain('data-export-seat-id="seat-empty"');
    expect(svg).toContain('stroke="#BFDBFE" stroke-width="1.2"');
    expect(svg).toContain('stroke="none" stroke-width="0"');
    expect(svg).not.toContain('data-export-occupant-label="secondary"');
    expect(svg).not.toMatch(
      /data-export-occupant-label="primary"[^>]*font-weight/,
    );
    expect(raster.width).toBe(raster.logicalWidth * 2);
    expect(raster.height).toBe(raster.logicalHeight * 2);
  });

  it("支持预览隐藏顶部标题和区域名称", () => {
    const { svg } = buildSeatingPlanSvg({
      ...jpegInput,
      showTitle: false,
      showZoneNames: false,
    });

    expect(svg).not.toContain(
      '<text x="64" y="84" font-size="22" font-weight="700"',
    );
    expect(svg).not.toContain("主会场 &amp; 嘉宾区</text>");
    expect(svg).toContain('data-export-zone-id="zone-rect"');
  });

  it("按最大边长和像素面积自动降采样，低于可读阈值时给中文错误", () => {
    const downsampled = planSeatingPlanRaster({ width: 5000, height: 2000 });
    expect(downsampled).toMatchObject({ downsampled: true });
    expect(downsampled.width).toBeLessThanOrEqual(8192);
    expect(downsampled.height).toBeLessThanOrEqual(8192);
    expect(downsampled.width * downsampled.height).toBeLessThanOrEqual(
      24_000_000,
    );

    expect(() =>
      planSeatingPlanRaster({ width: 20_000, height: 20_000 }),
    ).toThrow("排位画布过大");
    expect(() =>
      planSeatingPlanRaster({ width: 20_000, height: 20_000 }),
    ).toThrow("无法保证文字可读");
  });

  it("生成 Windows 安全、带本地时间戳和 .jpg 扩展名的文件名", () => {
    const fileName = buildSeatingPlanJpegFileName(
      '闭幕式:<晚宴>?*"',
      "主会场/全区\\A",
      new Date(2026, 7, 27, 14, 5, 9),
    );

    expect(fileName).toBe(
      "闭幕式--晚宴-----主会场-全区-A-排位图-20260827-140509.jpg",
    );
    expect(fileName).not.toMatch(/[<>:"/\\|?*]/);
    expect(fileName.endsWith(".jpg")).toBe(true);
    expect(SEATING_PLAN_JPEG_MIME).toBe("image/jpeg");
  });

  it("通过注入桥接等待字体后再栅格化，并只保存 JPEG Blob", async () => {
    const calls: string[] = [];
    const jpegBlob = new Blob(["jpeg"], { type: "image/jpeg" });
    const bridge: SeatingPlanJpegBridge = {
      waitForFonts: vi.fn(async () => {
        calls.push("fonts");
      }),
      rasterize: vi.fn(async (svg, input) => {
        calls.push("rasterize");
        expect(svg).toContain('data-export-world="true"');
        expect(input).toMatchObject({
          mimeType: "image/jpeg",
          quality: 0.92,
        });
        return jpegBlob;
      }),
      saveFile: vi.fn(() => {
        calls.push("save");
      }),
    };

    const created = await createSeatingPlanJpeg(jpegInput, {
      bridge,
      now: new Date(2026, 7, 27, 14, 5, 9),
    });
    expect(calls).toEqual(["fonts", "rasterize"]);
    expect(created.blob).toBe(jpegBlob);
    expect(created.blob.type).toBe("image/jpeg");
    expect(created.fileName).toContain("20260827-140509.jpg");

    calls.length = 0;
    const downloaded = await downloadSeatingPlanJpeg(jpegInput, {
      bridge,
      now: new Date(2026, 7, 27, 14, 5, 9),
    });
    expect(calls).toEqual(["fonts", "rasterize", "save"]);
    expect(bridge.saveFile).toHaveBeenCalledWith(
      downloaded.blob,
      downloaded.fileName,
    );
  });
});
