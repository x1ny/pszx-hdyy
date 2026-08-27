import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CanvasSeat } from "../core/document";
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
  occupantName?: string;
  planDisabled?: boolean;
};

const selectedSeatStates: [string, SeatState][] = [
  ["normal", {}],
  ["occupied", { occupantName: "王明" }],
  ["VIP", { seat: { ...seat, rank: "vip" } }],
  ["disabled", { planDisabled: true }],
];

describe("SeatNode selection marker", () => {
  it.each(
    selectedSeatStates,
  )("keeps the high-contrast ring and check badge for a selected %s seat", (_name, props) => {
    const { container } = render(
      <svg aria-label="座位节点">
        <SeatNode
          seat={props.seat ?? seat}
          origin={{ x: 0, y: 0 }}
          selected
          offset={null}
          showLabel
          occupantName={props.occupantName}
          planDisabled={props.planDisabled}
        />
      </svg>,
    );

    const marker = container.querySelector("[data-seat-selection]");
    expect(
      container.querySelector("[data-seat-selection-ring]"),
    ).toBeInTheDocument();
    expect(marker).toBeInTheDocument();
    expect(marker?.querySelector("path")).toBeInTheDocument();
    expect(marker?.querySelector("circle")).toHaveAttribute(
      "stroke",
      "var(--foreground)",
    );
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

    expect(container.querySelector("[data-seat-selection]")).toBeNull();
  });
});
