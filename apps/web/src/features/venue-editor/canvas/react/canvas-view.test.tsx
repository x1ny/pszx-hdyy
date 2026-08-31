import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CanvasSeat } from "../core/document";
import {
  buildSeatOccupantVisual,
  DEFAULT_OCCUPIED_COLOR,
  organizationSeatColor,
  type SeatOccupantVisual,
  seatRenderSpec,
} from "../seat-occupant-visual";
import { SeatNode } from "./canvas-view";

const seat: CanvasSeat = {
  externalId: "seat-1",
  zoneExternalId: "zone-1",
  label: "A1",
  kind: "seat",
  rank: "normal",
  ordinal: 1,
  x: 20,
  y: 20,
};

type SeatState = {
  seat?: CanvasSeat;
  occupant?: SeatOccupantVisual;
  planDisabled?: boolean;
};

const groupedMember = buildSeatOccupantVisual({
  occupantType: "person",
  memberName: "王明",
  organizationId: 4,
  organizationName: "纺织协会",
});

const independentMember = buildSeatOccupantVisual({
  occupantType: "person",
  memberName: "林一",
  organizationId: null,
  organizationName: null,
});

const organizationPlaceholder = buildSeatOccupantVisual({
  occupantType: "organization",
  memberName: null,
  organizationId: 4,
  organizationName: "纺织协会",
});

const selectedSeatStates: [string, SeatState][] = [
  ["normal", {}],
  ["occupied", { occupant: groupedMember }],
  ["VIP", { seat: { ...seat, rank: "vip" } }],
  ["disabled", { planDisabled: true }],
];

describe("SeatNode selection marker", () => {
  it.each(
    selectedSeatStates,
  )("uses one static glow for a selected %s seat", (_name, props) => {
    const { container } = render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={props.seat ?? seat}
          origin={{ x: 0, y: 0 }}
          selected
          offset={null}
          showLabel
          occupant={props.occupant}
          planDisabled={props.planDisabled}
        />
      </svg>,
    );

    const glow = container.querySelector("[data-seat-selection-glow]");
    expect(glow).toBeInTheDocument();
    expect(glow).toHaveAttribute("fill", "var(--primary)");
    expect(glow).not.toHaveAttribute("class");
    expect(container.querySelector("path")).toBeNull();
  });

  it("does not render selection adornment for an unselected seat", () => {
    const { container } = render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={seat}
          origin={{ x: 0, y: 0 }}
          selected={false}
          offset={null}
          showLabel
        />
      </svg>,
    );

    expect(container.querySelector("[data-seat-selection-glow]")).toBeNull();
  });

  it("renders a normal-weight member name without the organization subtitle or occupied border", () => {
    const { container } = render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={seat}
          origin={{ x: 0, y: 0 }}
          selected={false}
          offset={null}
          showLabel
          occupant={groupedMember}
          viewportScale={1}
        />
      </svg>,
    );

    const primaryLabel = container.querySelector(
      'text[data-seat-occupant-label="primary"]',
    );
    expect(primaryLabel).toHaveTextContent("王明");
    expect(primaryLabel).not.toHaveAttribute("font-weight");
    expect(
      container.querySelector('text[data-seat-occupant-label="secondary"]'),
    ).toBeNull();
    const occupiedCircle = container.querySelector("circle[data-seat-body]");
    expect(occupiedCircle).toHaveAttribute(
      "fill",
      organizationSeatColor(4).fill,
    );
    expect(occupiedCircle).toHaveAttribute("stroke", "none");
  });

  it("keeps the default occupied style for an individual without organization", () => {
    const { container } = render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={seat}
          origin={{ x: 0, y: 0 }}
          selected={false}
          offset={null}
          showLabel
          occupant={independentMember}
        />
      </svg>,
    );

    expect(container.querySelector("circle[data-seat-body]")).toHaveAttribute(
      "fill",
      DEFAULT_OCCUPIED_COLOR.fill,
    );
    expect(
      container.querySelector('text[data-seat-occupant-label="primary"]'),
    ).toHaveTextContent("林一");
    expect(
      container.querySelector('text[data-seat-occupant-label="secondary"]'),
    ).toBeNull();
  });

  it("renders organization placeholder as organization name only", () => {
    const { container } = render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={seat}
          origin={{ x: 0, y: 0 }}
          selected={false}
          offset={null}
          showLabel
          occupant={organizationPlaceholder}
          spec={seatRenderSpec(90)}
        />
      </svg>,
    );

    expect(
      container.querySelector("[data-seat-occupant-kind='organization']"),
    ).toBeInTheDocument();
    expect(
      container.querySelector('text[data-seat-occupant-label="primary"]'),
    ).toHaveTextContent("纺织协会");
    expect(
      container.querySelector('text[data-seat-occupant-label="secondary"]'),
    ).toBeNull();
    expect(container).not.toHaveTextContent("团体占位");
    expect(container).not.toHaveTextContent("团");
  });

  it("uses a pale blue border for an empty seat", () => {
    const { container } = render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={seat}
          origin={{ x: 0, y: 0 }}
          selected={false}
          offset={null}
          showLabel
        />
      </svg>,
    );

    const emptyCircle = container.querySelector("circle[data-seat-body]");
    expect(emptyCircle).toHaveAttribute("stroke", "var(--primary)");
    expect(emptyCircle).toHaveAttribute("stroke-opacity", "0.24");
  });

  const longMember = buildSeatOccupantVisual({
    occupantType: "person",
    memberName: "名字非常长的参会人员代表",
    organizationId: 4,
    organizationName: "名称同样很长的行业协会",
  });

  it("按当前座距截断姓名，不因为缩放而变形", () => {
    const { container } = render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={seat}
          origin={{ x: 0, y: 0 }}
          selected
          offset={null}
          showLabel={false}
          occupant={longMember}
          viewportScale={2}
          spec={seatRenderSpec(44)}
        />
      </svg>,
    );

    expect(
      container.querySelector('text[data-seat-occupant-label="primary"]'),
    ).toHaveTextContent("名字…");
    expect(
      container.querySelector("[data-seat-selection-glow]"),
    ).toBeInTheDocument();
  });

  it("写不下姓名时，已排座的编号和空座一样落在下方", () => {
    const labelY = (occupant?: SeatOccupantVisual) =>
      Number(
        render(
          <svg aria-label="座位节点">
            <SeatNode
              seat={seat}
              origin={{ x: 0, y: 0 }}
              selected={false}
              offset={null}
              showLabel
              occupant={occupant}
              spec={seatRenderSpec(26)}
            />
          </svg>,
        )
          .container.querySelector("text:not([data-seat-occupant-label])")
          ?.getAttribute("y"),
      );

    // 座距 26px：画得下编号、画不下姓名。下方是空的，两者就该在同一条线上。
    // 以前判的是 occupied，已排座的编号会躲到上面，同一排参差不齐。
    expect(labelY(groupedMember)).toBe(labelY(undefined));
    expect(labelY(groupedMember)).toBeGreaterThan(seat.y);
  });

  it("写得下姓名时编号让到上方，避开姓名", () => {
    const labelY = (occupant?: SeatOccupantVisual) =>
      Number(
        render(
          <svg aria-label="座位节点">
            <SeatNode
              seat={seat}
              origin={{ x: 0, y: 0 }}
              selected={false}
              offset={null}
              showLabel
              occupant={occupant}
              spec={seatRenderSpec(90)}
            />
          </svg>,
        )
          .container.querySelector("text:not([data-seat-occupant-label])")
          ?.getAttribute("y"),
      );

    expect(labelY(groupedMember)).toBeLessThan(seat.y);
    expect(labelY(undefined)).toBeGreaterThan(seat.y);
  });

  it("座距密到写不下姓名时不画标签，只留色块", () => {
    const { container } = render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={seat}
          origin={{ x: 0, y: 0 }}
          selected={false}
          offset={null}
          showLabel
          occupant={longMember}
          spec={seatRenderSpec(14)}
        />
      </svg>,
    );

    expect(
      container.querySelector('text[data-seat-occupant-label="primary"]'),
    ).toBeNull();
    // 名字没了，但颜色还在——占用状态不能一起丢
    expect(container.querySelector("circle[data-seat-body]")).toHaveAttribute(
      "fill",
      organizationSeatColor(4).fill,
    );
  });

  /** 走真实管线：座距是世界量，spec 由「世界座距 × 缩放」算出来。 */
  const renderPipeline = (worldPitch: number, viewportScale: number) =>
    render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={seat}
          origin={{ x: 0, y: 0 }}
          selected={false}
          offset={null}
          showLabel={false}
          occupant={longMember}
          viewportScale={viewportScale}
          spec={seatRenderSpec(worldPitch * viewportScale)}
        />
      </svg>,
    ).container;

  const worldAttr = (
    worldPitch: number,
    viewportScale: number,
    selector: string,
    attr: string,
  ) =>
    Number(
      renderPipeline(worldPitch, viewportScale)
        .querySelector(selector)
        ?.getAttribute(attr),
    );

  it("字号走屏幕坐标：放大两倍，世界字号减半、屏幕上不变", () => {
    // 这一条才是重叠会消失的原因——放大时只有座距在变宽，字不跟着长。
    // 以前字号是世界常量，标签宽度和座距同比例变化，比值恒定，放大永远无解。
    const font = (scale: number) =>
      worldAttr(
        60,
        scale,
        'text[data-seat-occupant-label="primary"]',
        "font-size",
      );
    expect(font(1) / font(2)).toBeCloseTo(2, 5);
  });

  it("圆点在上限以下跟着画布等比缩放，上限以上钉死", () => {
    const radius = (worldPitch: number, scale: number) =>
      worldAttr(worldPitch, scale, "circle[data-seat-body]", "r");

    // 座距 20，缩放 1→2 时屏幕座距 20→40，都在 12px 上限以内：
    // 世界半径恒定，圆点严格跟着画布放大
    expect(radius(20, 2)).toBeCloseTo(radius(20, 1), 5);

    // 座距 60，缩放 1→2 时屏幕座距 60→120，都在上限之上：
    // 屏幕半径钉死 12px，世界半径随缩放减半——这是保留上限的明确代价
    expect(radius(60, 1) / radius(60, 2)).toBeCloseTo(2, 5);
  });
});
