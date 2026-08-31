import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CanvasSeat } from "../core/document";
import {
  buildSeatOccupantVisual,
  DEFAULT_OCCUPIED_COLOR,
  organizationSeatColor,
  type SeatOccupantVisual,
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
    const occupiedCircle = container.querySelector("circle[r='9']");
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

    expect(container.querySelector("circle[r='9']")).toHaveAttribute(
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

    const emptyCircle = container.querySelector("circle[r='9']");
    expect(emptyCircle).toHaveAttribute("stroke", "var(--primary)");
    expect(emptyCircle).toHaveAttribute("stroke-opacity", "0.24");
  });

  it("compacts occupant labels when zoomed out without losing selection marker", () => {
    const longMember = buildSeatOccupantVisual({
      occupantType: "person",
      memberName: "名字非常长的参会人员代表",
      organizationId: 4,
      organizationName: "名称同样很长的行业协会",
    });
    const { container } = render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={seat}
          origin={{ x: 0, y: 0 }}
          selected
          offset={null}
          showLabel={false}
          occupant={longMember}
          viewportScale={0.4}
        />
      </svg>,
    );

    expect(
      container.querySelector('text[data-seat-occupant-label="primary"]'),
    ).toHaveTextContent("名字非…");
    expect(
      container.querySelector('text[data-seat-occupant-label="secondary"]'),
    ).toBeNull();
    expect(
      container.querySelector("[data-seat-selection-glow]"),
    ).toBeInTheDocument();
  });
});
