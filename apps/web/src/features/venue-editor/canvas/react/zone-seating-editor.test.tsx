import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasDoc, CanvasZone } from "../core/document";
import { initialState } from "../core/history";
import { EMPTY_SELECTION } from "../core/interaction";
import { ZoneSeatingEditor } from "./zone-seating-editor";

const zone: CanvasZone = {
  externalId: "zone-1",
  name: "主会场",
  kind: "seating",
  ordinal: 1,
  shape: { type: "rect", x: 0, y: 0, width: 800, height: 500 },
  fill: "#2a78d6",
  stroke: "#2a78d6",
};

const doc: CanvasDoc = {
  schemaVersion: 1,
  world: { width: 800, height: 500 },
  zones: [zone],
  seats: [],
};

describe("ZoneSeatingEditor headerContent", () => {
  it("renders page operation notices inside the editor frame", () => {
    const frameRef = createRef<HTMLDivElement>();

    render(
      <ZoneSeatingEditor
        zone={zone}
        state={initialState(doc)}
        selection={EMPTY_SELECTION}
        onSelectionChange={vi.fn()}
        onCommand={vi.fn()}
        onBack={vi.fn()}
        assignOnly
        frameRef={frameRef}
        headerContent={<div>正在连续选座</div>}
      />,
    );

    expect(frameRef.current).toContainElement(screen.getByText("正在连续选座"));
  });
});
