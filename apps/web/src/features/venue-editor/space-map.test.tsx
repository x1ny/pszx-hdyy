import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CanvasDoc } from "./canvas/core/document";
import { SpaceMap } from "./space-map";

describe("SpaceMap zone labels", () => {
  it("rotates the read-only zone labels with the zone", () => {
    const doc: CanvasDoc = {
      schemaVersion: 1,
      world: { width: 240, height: 140 },
      zones: [
        {
          externalId: "zone-1",
          name: "主会场",
          kind: "seating",
          ordinal: 0,
          fill: "#2a78d6",
          stroke: "#2a78d6",
          shape: {
            type: "rect",
            x: 10,
            y: 20,
            width: 180,
            height: 60,
            rotation: 18,
          },
        },
      ],
      seats: [],
    };

    const { container } = render(
      <SpaceMap
        doc={doc}
        zones={[
          {
            externalId: "zone-1",
            name: "主会场",
            caption: "未排位",
            disabled: false,
          },
        ]}
      />,
    );

    const labels = container.querySelectorAll("text");
    expect(labels).toHaveLength(2);
    expect(labels[0]?.parentElement).toHaveAttribute(
      "transform",
      "rotate(18 100 50)",
    );
    expect(labels[1]?.parentElement).toBe(labels[0]?.parentElement);
  });
});
