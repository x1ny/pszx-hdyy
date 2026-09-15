import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasDoc, CanvasZone } from "../core/document";
import { EMPTY_SELECTION } from "../core/interaction";
import { ZonePropertyPanel } from "./property-panel";

const displayOnlyZone: CanvasZone = {
  externalId: "zone-function",
  name: "功能区",
  kind: "function",
  ordinal: 0,
  fill: "#4a3aa7",
  stroke: "#4a3aa7",
  shape: { type: "rect", x: 20, y: 30, width: 180, height: 90 },
};

const seatingZone: CanvasZone = {
  ...displayOnlyZone,
  externalId: "zone-seating",
  name: "座席区",
  kind: "seating",
  ordinal: 1,
};

const doc: CanvasDoc = {
  schemaVersion: 1,
  world: { width: 400, height: 300 },
  zones: [displayOnlyZone, seatingZone],
  seats: [],
};

const panelProps = {
  doc,
  onSelectZone: vi.fn(),
  onClearSelection: vi.fn(),
  onPatchZone: vi.fn(),
  onRemoveZone: vi.fn(),
  onEnterZone: vi.fn(),
};

describe("ZonePropertyPanel seating entry", () => {
  it("does not show seating status or entry for display-only zones", () => {
    render(
      <ZonePropertyPanel
        {...panelProps}
        selection={{ zoneIds: [displayOnlyZone.externalId], seatIds: [] }}
      />,
    );

    expect(screen.queryByRole("button", { name: "进入排位" })).toBeNull();
    expect(screen.queryByText("还没有排位")).toBeNull();
    expect(screen.getByText("180 × 90")).toBeInTheDocument();
  });

  it("only shows the list entry action for seating zones", () => {
    render(<ZonePropertyPanel {...panelProps} selection={EMPTY_SELECTION} />);

    expect(screen.getAllByTitle("进入排位")).toHaveLength(1);
  });
});
